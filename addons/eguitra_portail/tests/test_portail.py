import io
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_axispro.tests.test_axispro import GRID

PDF = b"%PDF-1.4\n% statuts\n%%EOF\n"
FUTURE = (fields.Datetime.now() + timedelta(days=20)).replace(microsecond=0)


@tagged("post_install", "-at_install")
class TestPortail(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["ir.config_parameter"].sudo().set_param("eguitra_api.mfa_required", "0")
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.policy = cls.env["axispro.policy"].import_grid(cls.cabinet, "Politique portail", "grille.csv", GRID)
        cls.policy.action_activate()
        cabinet_only = {"company_id": cls.cabinet.id, "company_ids": [(6, 0, cls.cabinet.ids)]}
        cls.consultant = cls._create_user("consultante", "cabinet", **cabinet_only)
        cls.porteur_a = cls._create_user("porteur.a", "porteur", **cabinet_only)
        cls.porteur_b = cls._create_user("porteur.b", "porteur", **cabinet_only)
        Dossier = cls.env["axispro.dossier"]
        cls.dossier_a = Dossier.create({
            "name": "Briqueterie", "promoter_id": cls.env["res.partner"].create({"name": "Briques SA"}).id,
            "company_id": cls.cabinet.id, "consultant_id": cls.consultant.id, "sector": "Matériaux de construction",
            "portal_user_ids": [(6, 0, cls.porteur_a.ids)],
        })
        cls.dossier_b = Dossier.create({
            "name": "Séchage de mangues", "promoter_id": cls.env["res.partner"].create({"name": "Mangues SARL"}).id,
            "company_id": cls.cabinet.id, "consultant_id": cls.consultant.id, "sector": "Agro-industrie",
            "portal_user_ids": [(6, 0, cls.porteur_b.ids)],
        })

    def setUp(self):
        super().setUp()
        self.porteur = self.open_session("porteur.a", app="portail")["access_token"]
        self.cabinet_token = self.open_session("consultante", app="axispro")["access_token"]

    def post_form(self, path, token, data=None, file=None):
        files = {"file": (file[0], io.BytesIO(file[1]), "application/octet-stream")} if file else None
        response = self.url_open("/api/v1" + path, data=data or {}, files=files, method="POST", timeout=60,
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"})
        return response.status_code, response.json()

    def notifications(self, user):
        return self.env["portail.notification"].sudo().search([("user_id", "=", user.id)])

    def test_espace_et_cloisonnement(self):
        status, espace = self.call("GET", "/portail/espace", token=self.porteur)
        self.assertEqual(status, 200, espace)
        self.assertEqual([d["id"] for d in espace["dossiers"]], [self.dossier_a.id], "Le porteur ne voit que son dossier")
        self.assertEqual(espace["user"]["company"], "Briques SA")
        for route in ("tableau", "projet", "pieces", "actions", "fil", "rendez-vous"):
            status, _b = self.call("GET", f"/portail/dossiers/{self.dossier_b.id}/{route}", token=self.porteur)
            self.assertEqual(status, 404, f"{route} : dossier d'un autre porteur")
        status, tableau = self.call("GET", f"/portail/dossiers/{self.dossier_a.id}/tableau", token=self.porteur)
        self.assertEqual(status, 200, tableau)
        self.assertTrue(0 <= tableau["preparation"]["score"] <= 100)
        self.assertEqual(tableau["preparation"]["pieces"]["due"], 1, "Statuts attendus à l'étape G0")
        self.assertTrue(any(s["kind"] == "piece" for s in tableau["next_steps"]))
        self.assertNotIn("scoring", tableau["dossier"], "Jamais le détail du scoring")
        status, projet = self.call("GET", f"/portail/dossiers/{self.dossier_a.id}/projet", token=self.porteur)
        self.assertEqual(status, 200, projet)
        self.assertEqual(projet["team"][0]["role"], "Consultant principal")
        self.assertEqual(projet["timeline"][-1]["kind"], "start")
        status, _b = self.call("GET", "/axispro/portail/synthese", token=self.porteur)
        self.assertEqual(status, 403, "Le porteur n'accède pas aux outils du cabinet")

    def test_messagerie_pieces_jointes_et_non_lus(self):
        status, body = self.post_form(f"/axispro/portail/conversations/{self.dossier_a.id}", self.cabinet_token,
                                      {"body": "Note pour l'équipe", "internal": "1"})
        self.assertEqual(status, 200, body)
        status, body = self.post_form(f"/axispro/portail/conversations/{self.dossier_a.id}", self.cabinet_token,
                                      {"body": "Bonjour, merci d'envoyer vos statuts."})
        self.assertEqual(status, 200, body)
        self.assertTrue(self.notifications(self.porteur_a).filtered(lambda n: n.kind == "message"))
        _s, espace = self.call("GET", "/portail/espace", token=self.porteur)
        self.assertEqual(espace["counts"]["messages"], 1, "La note interne n'est ni visible ni comptée")
        _s, fil = self.call("GET", f"/portail/dossiers/{self.dossier_a.id}/fil", token=self.porteur)
        self.assertEqual([m["body"] for m in fil["messages"]], ["Bonjour, merci d'envoyer vos statuts."])
        self.assertFalse(fil["more"], "Aucun message plus ancien")
        _s, espace = self.call("GET", "/portail/espace", token=self.porteur)
        self.assertEqual(espace["counts"]["messages"], 1, "Une lecture (GET) ne marque rien comme lu")
        dernier = fil["messages"][-1]["id"]
        status, lu = self.call("POST", f"/portail/dossiers/{self.dossier_a.id}/fil/lu", {"message_id": dernier},
                               token=self.porteur)
        self.assertEqual((status, lu["unread"]), (200, 0), lu)
        _s, espace = self.call("GET", "/portail/espace", token=self.porteur)
        self.assertEqual(espace["counts"]["messages"], 0, "Lus une fois affichés par l'écran")
        status, _b = self.call("POST", f"/portail/dossiers/{self.dossier_b.id}/fil/lu", {}, token=self.porteur)
        self.assertEqual(status, 404, "Messages du dossier d'un autre porteur")
        status, _b = self.call("POST", f"/portail/dossiers/{self.dossier_a.id}/fil/lu", {}, token=self.cabinet_token)
        self.assertEqual(status, 403, "Route du seul porteur")

        status, message = self.post_form(f"/portail/dossiers/{self.dossier_a.id}/fil", self.porteur,
                                         {"body": "Voici les statuts."}, ("statuts.pdf", PDF))
        self.assertEqual(status, 200, message)
        self.assertEqual(message["attachments"][0]["name"], "statuts.pdf")
        self.assertTrue(message["from_me"])
        _s, suite = self.call("GET", f"/portail/dossiers/{self.dossier_a.id}/fil?after={dernier}", token=self.porteur)
        self.assertEqual([m["id"] for m in suite["messages"]], [message["id"]], "Relecture : les seuls nouveaux messages")
        self.assertIn("statuts.pdf", self.dossier_a.document_ids.mapped("name"), "La pièce jointe rejoint la data room")
        self.assertTrue(self.notifications(self.consultant).filtered(lambda n: n.kind == "message"))
        _s, conversations = self.call("GET", "/axispro/portail/conversations", token=self.cabinet_token)
        row = next(c for c in conversations if c["dossier"]["id"] == self.dossier_a.id)
        self.assertEqual((row["unread"], row["waiting"]), (1, True))
        status, _b = self.post_form(f"/portail/dossiers/{self.dossier_a.id}/fil", self.porteur, {"body": "  "})
        self.assertEqual(status, 400, "Message vide refusé")

    def test_communications_ciblees(self):
        Announcement = self.env["portail.announcement"]
        pour_b = Announcement.create({"name": "Pour les mangues", "audience": "dossiers",
                                      "dossier_ids": [(6, 0, self.dossier_b.ids)], "company_id": self.cabinet.id})
        pour_b.action_publish()
        status, tous = self.call("POST", "/axispro/portail/annonces", {
            "title": "Appel à projets", "body": "**Date limite** le 30 novembre.", "kind": "opportunity",
            "require_ack": True, "publish": True}, token=self.cabinet_token)
        self.assertEqual(status, 200, tous)
        self.assertTrue(self.notifications(self.porteur_a).filtered(lambda n: n.kind == "announcement"))
        self.assertFalse(self.notifications(self.porteur_a).filtered(lambda n: n.title == "Pour les mangues"))
        _s, liste = self.call("GET", "/portail/actualites", token=self.porteur)
        self.assertEqual([a["id"] for a in liste], [tous["id"]], "Seules les communications de son public")
        status, _b = self.call("GET", f"/portail/actualites/{pour_b.id}", token=self.porteur)
        self.assertEqual(status, 404)
        _s, detail = self.call("GET", f"/portail/actualites/{tous['id']}", token=self.porteur)
        self.assertEqual((detail["read"], detail["acknowledged"], detail["excerpt"]),
                         (False, False, "Date limite le 30 novembre."), "Une lecture (GET) n'enregistre rien")
        status, lue = self.call("POST", f"/portail/actualites/{tous['id']}/lue", token=self.porteur)
        self.assertEqual((status, lue["read"], lue["acknowledged"]), (200, True, False), lue)
        status, _b = self.call("POST", f"/portail/actualites/{pour_b.id}/lue", token=self.porteur)
        self.assertEqual(status, 404, "Communication hors de son public")
        status, _b = self.call("POST", f"/portail/actualites/{tous['id']}/lue", token=self.cabinet_token)
        self.assertEqual(status, 403, "Route du seul porteur")
        _s, detail = self.call("POST", f"/portail/actualites/{tous['id']}/accuse", token=self.porteur)
        self.assertTrue(detail["acknowledged"])
        _s, admin = self.call("GET", "/axispro/portail/annonces", token=self.cabinet_token)
        stats = next(a for a in admin if a["id"] == tous["id"])["stats"]
        self.assertEqual(stats, {"audience": 2, "read": 1, "acknowledged": 1})
        status, _b = self.call("POST", f"/axispro/portail/annonces/{tous['id']}/supprimer", token=self.cabinet_token)
        self.assertEqual(status, 422, "Une communication publiée s'archive, elle ne se supprime pas")

    def test_ressources(self):
        status, article = self.call("POST", "/axispro/portail/articles", {
            "title": "Comprendre le DSCR", "body": "# Le calcul\nTrésorerie disponible divisée par le service de la dette.",
            "gate_codes": "G0", "kind": "guide"}, token=self.cabinet_token)
        self.assertEqual(status, 200, article)
        _s, ressources = self.call("GET", "/portail/ressources", token=self.porteur)
        self.assertNotIn(article["id"], [a["id"] for a in ressources["articles"]], "Un brouillon reste invisible")
        status, _b = self.call("GET", f"/portail/ressources/{article['id']}", token=self.porteur)
        self.assertEqual(status, 404)
        status, _b = self.call("POST", f"/portail/ressources/{article['id']}/lu", token=self.porteur)
        self.assertEqual(status, 404, "Un brouillon ne se lit pas, pas même par la route qui enregistre la lecture")
        _s, publie = self.call("POST", f"/axispro/portail/articles/{article['id']}/publier", token=self.cabinet_token)
        self.assertEqual(publie["state"], "published")
        _s, ressources = self.call("GET", "/portail/ressources", token=self.porteur)
        row = next(a for a in ressources["articles"] if a["id"] == article["id"])
        self.assertTrue(row["recommended"], "Recommandé à l'étape G0 du dossier")
        _s, detail = self.call("GET", f"/portail/ressources/{article['id']}", token=self.porteur)
        self.assertIn("Le calcul", detail["body"])
        self.assertFalse(detail["viewed"], "Une lecture (GET) n'enregistre rien")
        self.assertEqual(self.env["portail.article"].browse(article["id"]).view_count, 0)
        status, lu = self.call("POST", f"/portail/ressources/{article['id']}/lu", token=self.porteur)
        self.assertEqual((status, lu["viewed"]), (200, True), lu)
        status, _b = self.call("POST", f"/portail/ressources/{article['id']}/lu", token=self.cabinet_token)
        self.assertEqual(status, 403, "Route du seul porteur")
        _s, reaction = self.call("POST", f"/portail/ressources/{article['id']}/reaction",
                                 {"helpful": True, "bookmarked": True}, token=self.porteur)
        self.assertEqual((reaction["helpful"], reaction["bookmarked"]), ("yes", True))
        _s, admin = self.call("GET", f"/axispro/portail/articles/{article['id']}", token=self.cabinet_token)
        self.assertEqual((admin["stats"]["views"], admin["stats"]["helpful"], admin["stats"]["bookmarks"]), (1, 1, 1))

    def test_evenement_et_liste_d_attente(self):
        start = FUTURE
        status, event = self.call("POST", "/axispro/portail/evenements", {
            "name": "Atelier plan de financement", "kind": "atelier", "start": start.isoformat(),
            "end": (start + timedelta(hours=3)).isoformat(), "capacity": 1, "online_url": "https://visio.example.com/a",
            "publish": True}, token=self.cabinet_token)
        self.assertEqual(status, 200, event)
        _s, liste = self.call("GET", "/portail/evenements", token=self.porteur)
        self.assertIsNone(liste[0]["online_url"], "Lien communiqué aux seuls inscrits")
        _s, inscrit = self.call("POST", f"/portail/evenements/{event['id']}/inscription", {"note": "Question"},
                                token=self.porteur)
        self.assertEqual((inscrit["my_registration"]["state"], inscrit["online_url"]),
                         ("registered", "https://visio.example.com/a"))
        porteur_b = self.open_session("porteur.b", app="portail")["access_token"]
        _s, attente = self.call("POST", f"/portail/evenements/{event['id']}/inscription", {}, token=porteur_b)
        self.assertEqual(attente["my_registration"]["state"], "waitlist", "Complet : liste d'attente")
        _s, _b = self.call("POST", f"/portail/evenements/{event['id']}/desinscription", token=self.porteur)
        registration = self.env["portail.event.registration"].search(
            [("event_id", "=", event["id"]), ("user_id", "=", self.porteur_b.id)])
        self.assertEqual(registration.state, "registered", "La place libérée revient à la liste d'attente")
        self.assertTrue(self.notifications(self.porteur_b).filtered(lambda n: n.title.startswith("Place confirmée")))

    def test_rendez_vous(self):
        status, body = self.call("POST", f"/portail/dossiers/{self.dossier_a.id}/rendez-vous", {
            "subject": "Point sur le plan de financement", "mode": "video",
            "slots": [(fields.Datetime.now() - timedelta(days=1)).isoformat()]}, token=self.porteur)
        self.assertEqual(status, 422, "Un créneau passé est refusé")
        status, demande = self.call("POST", f"/portail/dossiers/{self.dossier_a.id}/rendez-vous", {
            "subject": "Point sur le plan de financement", "mode": "video", "agenda": "Différé et garanties",
            "slots": [FUTURE.isoformat() + "Z", (FUTURE + timedelta(days=1)).isoformat()]}, token=self.porteur)
        self.assertEqual(status, 200, demande)
        self.assertEqual((demande["state"], len(demande["slots"])), ("requested", 2))
        self.assertTrue(self.notifications(self.consultant).filtered(lambda n: n.kind == "meeting"))
        status, confirme = self.call("PATCH", f"/axispro/portail/rendez-vous/{demande['id']}", {
            "action": "confirm", "start": demande["slots"][1], "online_url": "https://visio.example.com/rdv"},
            token=self.cabinet_token)
        self.assertEqual(status, 200, confirme)
        self.assertEqual(confirme["state"], "confirmed")
        self.assertTrue(self.notifications(self.porteur_a).filtered(lambda n: n.title.startswith("Rendez-vous confirmé")))
        _s, agenda = self.call("GET", "/portail/agenda", token=self.porteur)
        self.assertIn(f"meeting-{demande['id']}", [i["key"] for i in agenda])
        _s, annule = self.call("POST", f"/portail/rendez-vous/{demande['id']}/annuler", {"reason": "Empêchement"},
                               token=self.porteur)
        self.assertEqual((annule["state"], annule["cancelled_by"], annule["cabinet_note"]), ("cancelled", "porteur", "Empêchement"))

    def test_notifications_du_dossier(self):
        self.env["axispro.action"].create({"dossier_id": self.dossier_a.id, "name": "Fournir le bilan d'ouverture",
                                           "assignee": "porteur", "due_date": fields.Date.today() + timedelta(days=10)})
        self.dossier_a.current_gate_id = self.policy.gate_ids.sorted("sequence")[-1]
        kinds = set(self.notifications(self.porteur_a).mapped("kind"))
        self.assertTrue({"action", "gate"} <= kinds, kinds)
        _s, liste = self.call("GET", "/portail/notifications", token=self.porteur)
        self.assertGreaterEqual(liste["unread"], 2)
        _s, lues = self.call("POST", "/portail/notifications/lues", {}, token=self.porteur)
        self.assertEqual(lues["unread"], 0)
        self.assertFalse(self.notifications(self.porteur_b), "Rien pour le porteur d'un autre dossier")

    def test_avis_et_profil(self):
        status, _b = self.call("POST", "/portail/avis", {"dossier_id": self.dossier_a.id, "score": 6}, token=self.porteur)
        self.assertEqual(status, 422, "Note de 1 à 5")
        status, avis = self.call("POST", "/portail/avis", {"dossier_id": self.dossier_a.id, "score": 5, "recommend": 9,
                                                           "comment": "Très bon suivi."}, token=self.porteur)
        self.assertEqual(status, 200, avis)
        _s, again = self.call("POST", "/portail/avis", {"dossier_id": self.dossier_a.id, "score": 4}, token=self.porteur)
        self.assertEqual((again["id"], again["score"], again["recommend"]), (avis["id"], 4, None),
                         "Un avis par sujet et par mois : mis à jour")
        status, _b = self.call("POST", "/portail/avis", {"dossier_id": self.dossier_b.id, "score": 5}, token=self.porteur)
        self.assertEqual(status, 404)
        _s, synthese = self.call("GET", "/axispro/portail/synthese", token=self.cabinet_token)
        self.assertEqual(synthese["feedback"]["count"], 1)
        _s, profil = self.call("PATCH", "/portail/profil", {"user": {"phone": "+224 620 00 00 00"},
                                                            "entreprise": {"city": "Kindia", "website": "briques.gn"}},
                               token=self.porteur)
        self.assertEqual(profil["user"]["phone"], "+224 620 00 00 00", "Ses propres coordonnées changent")
        self.assertTrue(profil["request_sent"])
        self.assertFalse(profil["entreprise"]["city"], "La fiche de l'entreprise ne change pas sans le cabinet")
        demande = self.dossier_a.message_ids.filtered(lambda m: m.body.startswith("Demande de mise à jour"))
        self.assertIn("Ville : Kindia", demande.body)
        self.assertIn("Site internet : https://briques.gn", demande.body)
        self.assertTrue(self.notifications(self.consultant).filtered(lambda n: n.kind == "message"))
