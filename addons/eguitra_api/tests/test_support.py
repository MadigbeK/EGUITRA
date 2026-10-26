import re
from datetime import date, datetime, timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from ..suivi import business_hours, quarter_label
from .common import ApiCase


@tagged("post_install", "-at_install")
class TestSupport(ApiCase):
    """Espace partagé de suivi des demandes (offre, chapitres 6.4, 7.2 et 7.4) : dépôt numéroté, prise en
    charge avec accusé de réception, fil, résolution, clôture ou réouverture par l'auteur, crédit
    d'évolutions, délais en heures ouvrées ; visibilité et refus par profil."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.groupe = cls.env.ref("base.main_company")
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        deux = cls.groupe | cls.cabinet
        cls.admin = cls._create_user("support.admin", "admin", company_ids=[(6, 0, deux.ids)])
        cls.compta = cls._create_user("compta.support", "finance")
        cls.collegue = cls._create_user("collegue.support", "finance")
        cls.dg = cls._create_user("dg.support", "direction")
        if cls.cabinet:
            cabinet_seul = {"company_id": cls.cabinet.id, "company_ids": [(6, 0, cls.cabinet.ids)]}
            cls._create_user("consultant.support", "cabinet", **cabinet_seul)
            cls._create_user("porteur.support", "porteur", **cabinet_seul)

    def deposer(self, token, **values):
        payload = dict({
            "kind": "anomalie", "severity": "majeure", "app": "finance", "title": "Import du relevé refusé",
            "description": "Le relevé de septembre de la BICIGUI est refusé à l'import, message « format inconnu ».",
        }, **values)
        status, body = self.call("POST", "/support/requests", payload, token=token)
        self.assertEqual(status, 200, body)
        return body

    def gerer(self, token, request_id, **values):
        return self.call("PATCH", f"/support/requests/{request_id}", values, token=token)

    def test_depot_numerote(self):
        token = self.open_session("compta.support")["access_token"]
        premiere = self.deposer(token)
        seconde = self.deposer(token, kind="question", severity="mineure", app="plateforme", title="Export du grand livre")
        numero = re.compile(rf"^DEM-{fields.Date.today().year}-(\d{{4}})$")
        n1, n2 = numero.match(premiere["name"]), numero.match(seconde["name"])
        self.assertTrue(n1 and n2, (premiere["name"], seconde["name"]))
        self.assertEqual(int(n2.group(1)), int(n1.group(1)) + 1, "Numérotation suivie, sans trou")
        self.assertEqual((premiere["state"], premiere["author"]["id"], premiere["company"]["id"]),
                         ("submitted", self.compta.id, self.groupe.id))
        self.assertTrue(premiere["mine"])
        self.assertEqual(premiere["can"], {"comment": True, "close": False, "reopen": False, "manage": False})
        self.assertEqual(premiere["comments"], [])
        self.assertEqual((premiere["take_over"]["target_hours"], premiere["take_over"]["done"]), (4, False),
                         "Majeure : prise en charge sous 4 heures ouvrées")
        self.assertIsNone(seconde["credit"], "Le crédit ne concerne que les évolutions")

        status, body = self.call("POST", "/support/requests", {"kind": "plainte", "title": "x", "description": "y"},
                                 token=token)
        self.assertEqual(status, 400, body)
        status, body = self.call("POST", "/support/requests", {"kind": "question", "title": "x"}, token=token)
        self.assertEqual((status, body["error"]), (400, "missing_fields"), body)
        status, rows = self.call("GET", "/support/requests", token=token)
        self.assertEqual(status, 200, rows)
        self.assertLessEqual({premiere["id"], seconde["id"]}, {r["id"] for r in rows})
        self.assertTrue(all(r["mine"] for r in rows), "Chacun ne voit que ses demandes")
        status, rows = self.call("GET", "/support/requests?kind=question", token=token)
        self.assertEqual([r["id"] for r in rows], [seconde["id"]])
        status, rows = self.call("GET", "/support/requests?state=resolved,closed", token=token)
        self.assertEqual((status, rows), (200, []))
        status, body = self.call("GET", "/support/requests?state=perdue", token=token)
        self.assertEqual(status, 400, body)

    def test_prise_en_charge_jusqu_a_la_cloture(self):
        auteur = self.open_session("compta.support")["access_token"]
        admin = self.open_session("support.admin")["access_token"]
        rid = self.deposer(auteur, severity="mineure")["id"]

        status, rows = self.call("GET", "/support/requests?state=submitted", token=admin)
        self.assertIn(rid, [r["id"] for r in rows], "L'administration voit toutes les demandes")
        status, body = self.gerer(admin, rid, state="taken", severity="majeure")
        self.assertEqual(status, 200, body)
        self.assertEqual((body["state"], body["severity"], body["taken_by"]["id"]), ("taken", "majeure", self.admin.id))
        self.assertTrue(body["date_taken"] and body["take_over"]["done"])
        accuse = body["comments"][-1]
        self.assertTrue(accuse["event"])
        self.assertIn("accusé de réception", accuse["body"])
        self.assertIn("Gravité retenue : Majeure (proposée : Mineure)", accuse["body"])

        status, body = self.call("POST", f"/support/requests/{rid}/comments", {"body": "Capture envoyée par courriel."},
                                 token=auteur)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["comments"][-1]["body"], body["comments"][-1]["mine"], body["comments"][-1]["event"]),
                         ("Capture envoyée par courriel.", True, False))
        self.assertEqual(body["comment_count"], 1, "Les événements de suivi ne comptent pas comme des messages")

        status, body = self.gerer(admin, rid, state="resolved")
        self.assertEqual(status, 422, "Une résolution sans réponse écrite est refusée")
        status, body = self.gerer(admin, rid, state="resolved", response="Format camt.053 accepté ; relancez l'import.")
        self.assertEqual((status, body["state"]), (200, "resolved"), body)
        self.assertTrue(body["date_resolved"])
        status, body = self.call("GET", f"/support/requests/{rid}", token=auteur)
        self.assertEqual(body["can"], {"comment": True, "close": True, "reopen": True, "manage": False})
        self.assertEqual(body["response"], "Format camt.053 accepté ; relancez l'import.")

        status, body = self.call("POST", f"/support/requests/{rid}/close", token=auteur)
        self.assertEqual((status, body["state"]), (200, "closed"), body)
        self.assertTrue(body["date_closed"])
        self.assertIn("Résolution confirmée", body["comments"][-1]["body"])
        self.assertEqual(body["can"], {"comment": False, "close": False, "reopen": False, "manage": False})
        status, body = self.call("POST", f"/support/requests/{rid}/comments", {"body": "Merci"}, token=auteur)
        self.assertEqual(status, 422, "Une demande close ne se commente plus")
        status, body = self.gerer(admin, rid, response="Complément")
        self.assertEqual(status, 422, "Une demande close ne se modifie plus")

    def test_reouverture_par_l_auteur(self):
        auteur = self.open_session("compta.support")["access_token"]
        admin = self.open_session("support.admin")["access_token"]
        rid = self.deposer(auteur)["id"]
        status, body = self.call("POST", f"/support/requests/{rid}/close", token=auteur)
        self.assertEqual(status, 422, "Seule une demande résolue se clôt")

        status, body = self.gerer(admin, rid, state="resolved", response="Corrigé dans la version du jour.")
        self.assertEqual((status, body["state"]), (200, "resolved"), body)
        self.assertTrue(body["date_taken"], "Résoudre une demande déposée vaut prise en charge")
        self.assertIn("accusé de réception", body["comments"][0]["body"])

        status, body = self.call("POST", f"/support/requests/{rid}/reopen", {}, token=auteur)
        self.assertEqual((status, body["error"]), (400, "missing_fields"), "Le motif de la réouverture est demandé")
        status, body = self.call("POST", f"/support/requests/{rid}/reopen",
                                 {"body": "Toujours refusé pour le relevé d'août."}, token=auteur)
        self.assertEqual((status, body["state"], body["date_resolved"]), (200, "in_progress", None), body)
        self.assertEqual([c["body"] for c in body["comments"][-2:]],
                         ["Toujours refusé pour le relevé d'août.", "Demande rouverte."])
        status, body = self.call("POST", f"/support/requests/{rid}/close", token=auteur)
        self.assertEqual(status, 422, "Une demande rouverte ne se clôt qu'une fois résolue à nouveau")

    def test_evolution_imputee_sur_le_credit(self):
        Request = self.env["eguitra.support.request"]
        Request.search([]).unlink()  # trimestre vierge
        auteur = self.open_session("compta.support")["access_token"]
        admin = self.open_session("support.admin")["access_token"]
        evolutions = [self.deposer(auteur, kind="evolution", severity="mineure", title=f"Colonne {i} au grand livre")["id"]
                      for i in range(4)]
        e1, e2, e3, e4 = evolutions

        status, body = self.gerer(admin, e1, state="taken", qualification="incluse", credit_days=1.5,
                                  planned_date="2026-12-15")
        self.assertEqual(status, 200, body)
        self.assertEqual((body["qualification"], body["credit_days"], body["planned_date"]),
                         ("incluse", 1.5, "2026-12-15"))
        self.assertTrue(body["credit_date"])
        trimestre = quarter_label(fields.Date.today())
        self.assertEqual((body["credit"]["label"], body["credit"]["used"], body["credit"]["remaining"]), (trimestre, 1.5, 4.5))
        self.assertNotIn("requests", body["credit"], "Le détail du crédit n'est remis qu'à l'administration")
        self.assertIn("1,5 jour imputé sur le crédit du trimestre", body["comments"][-1]["body"])
        self.assertIn("Livraison proposée le 15/12/2026", body["comments"][-1]["body"])

        status, body = self.gerer(admin, e2, credit_days=2.5)
        self.assertEqual(status, 422, "Une évolution incluse est estimée à 2 jours-homme au plus")
        for rid in (e2, e3):
            status, body = self.gerer(admin, rid, credit_days=2)
            self.assertEqual((status, body["qualification"]), (200, "incluse"), body)
        status, body = self.gerer(admin, e4, credit_days=1)
        self.assertEqual(status, 422, "Le crédit du trimestre (6 jours) est dépassé")
        self.assertIn("il reste 0,5 jour", body["message"])
        status, body = self.gerer(admin, e4, qualification="facturable")
        self.assertEqual((status, body["credit_days"]), (200, 0.0), body)
        self.assertIn("Évolution facturable", body["comments"][-1]["body"])
        status, body = self.gerer(admin, e4, credit_days=0.5)
        self.assertEqual(status, 422, "Une évolution facturable ne consomme pas de crédit")

        status, body = self.gerer(admin, e3, state="refused", response="Retirée par le client au comité.")
        self.assertEqual((status, body["state"], body["credit_days"]), (200, "refused", 0.0), body)
        self.assertEqual(body["credit"]["used"], 3.5, "Le refus rend le crédit")

        anomalie = self.deposer(auteur)["id"]
        status, body = self.gerer(admin, anomalie, credit_days=1)
        self.assertEqual(status, 422, "Seule une évolution consomme du crédit")
        status, body = self.gerer(admin, anomalie, kind="evolution")
        self.assertEqual(status, 200, body)
        self.assertIn("Type : Anomalie → Demande d'évolution", body["comments"][-1]["body"])

        status, synthese = self.call("GET", "/support/summary", token=admin)
        self.assertEqual(status, 200, synthese)
        courant = synthese["credit"]["quarters"][0]
        self.assertEqual((courant["label"], courant["used"], courant["remaining"]), (trimestre, 3.5, 2.5))
        self.assertEqual([r["id"] for r in courant["requests"]], [e1, e2])
        self.assertEqual(synthese["kinds"]["evolution"], 5)
        self.assertEqual(synthese["counts"]["refused"], 1)

    def test_cloisonnement_et_refus_par_profil(self):
        auteur = self.open_session("compta.support")["access_token"]
        collegue = self.open_session("collegue.support")["access_token"]
        dg = self.open_session("dg.support")["access_token"]
        rid = self.deposer(auteur)["id"]

        # Un compte ne voit pas la demande d'un autre, et rien ne lui dit qu'elle existe.
        status, rows = self.call("GET", "/support/requests", token=collegue)
        self.assertEqual(status, 200, rows)
        self.assertNotIn(rid, [r["id"] for r in rows])
        for method, path, payload in (
            ("GET", f"/support/requests/{rid}", None),
            ("POST", f"/support/requests/{rid}/comments", {"body": "Moi aussi"}),
            ("POST", f"/support/requests/{rid}/close", None),
            ("POST", f"/support/requests/{rid}/reopen", {"body": "Toujours là"}),
        ):
            status, body = self.call(method, path, payload, token=collegue)
            self.assertEqual(status, 404, (path, body))

        # La finance ne prend pas en charge une demande, pas même la sienne, ni ne lit la synthèse.
        status, body = self.gerer(auteur, rid, state="taken")
        self.assertEqual((status, body["error"]), (403, "forbidden"), body)
        status, body = self.call("GET", "/support/summary", token=auteur)
        self.assertEqual(status, 403, body)
        # Le modèle refuse aussi, quel que soit l'appelant.
        self.env.invalidate_all()
        demande = self.env["eguitra.support.request"].browse(rid)
        with self.assertRaises(AccessError):
            demande.with_user(self.compta).write({"response": "Réglé par moi-même"})
        with self.assertRaises(UserError):
            demande.with_user(self.compta).write({"state": "taken"})
        with self.assertRaises(AccessError):
            demande.with_user(self.collegue).write({"state": "closed"})

        # La direction lit les demandes de ses sociétés, sans les commenter ni les faire avancer.
        status, rows = self.call("GET", "/support/requests", token=dg)
        self.assertIn(rid, [r["id"] for r in rows])
        status, body = self.call("GET", f"/support/requests/{rid}", token=dg)
        self.assertEqual(status, 200, body)
        self.assertFalse(body["mine"])
        self.assertEqual(body["can"], {"comment": False, "close": False, "reopen": False, "manage": False})
        status, body = self.call("POST", f"/support/requests/{rid}/comments", {"body": "Vu"}, token=dg)
        self.assertEqual(status, 403, body)
        status, body = self.gerer(dg, rid, state="taken")
        self.assertEqual(status, 403, body)
        status, rows = self.call("GET", "/support/requests?mine=1", token=dg)
        self.assertEqual((status, rows), (200, []), "Filtre « les miennes »")

        if not self.cabinet:
            self.skipTest("Pas de société du cabinet dans la base de test")
        # La direction d'une seule société ne voit pas les demandes de l'autre ; l'administration les voit.
        consultant = self.open_session("consultant.support", app="axispro")["access_token"]
        cabinet_rid = self.deposer(consultant, app="axispro")["id"]
        status, body = self.call("GET", f"/support/requests/{cabinet_rid}", token=dg)
        self.assertEqual(status, 404, body)
        admin = self.open_session("support.admin")["access_token"]
        status, body = self.call("GET", f"/support/requests/{cabinet_rid}", token=admin)
        self.assertEqual((status, body["company"]["id"]), (200, self.cabinet.id), body)

        # Un porteur de projet n'a aucun accès : il s'adresse à son consultant.
        porteur = self.open_session("porteur.support", app="portail")["access_token"]
        for method, path, payload in (
            ("GET", "/support/requests", None),
            ("POST", "/support/requests", {"kind": "question", "title": "Mon dossier", "description": "Où en est-il ?"}),
            ("GET", f"/support/requests/{cabinet_rid}", None),
            ("POST", f"/support/requests/{cabinet_rid}/comments", {"body": "Bonjour"}),
            ("PATCH", f"/support/requests/{cabinet_rid}", {"state": "taken"}),
            ("GET", "/support/summary", None),
        ):
            status, body = self.call(method, path, payload, token=porteur)
            self.assertEqual(status, 403, (method, path, body))

    def test_delais_en_heures_ouvrees(self):
        self.assertEqual(business_hours(datetime(2026, 10, 23, 17), datetime(2026, 10, 26, 12)), 5.0,
                         "Du vendredi 17 h au lundi 12 h : une heure le vendredi, quatre le lundi")
        self.assertEqual(business_hours(datetime(2026, 10, 24, 9), datetime(2026, 10, 25, 20)), 0.0, "Week-end")
        self.assertEqual(business_hours(datetime(2026, 10, 19, 7), datetime(2026, 10, 19, 19)), 10.0, "De 8 h à 18 h")
        self.assertEqual(business_hours(datetime(2026, 10, 19, 9), datetime(2026, 10, 20, 9), {date(2026, 10, 20)}), 9.0,
                         "Jour férié")

        Request = self.env["eguitra.support.request"]
        Request.search([]).unlink()
        valeurs = {"kind": "anomalie", "app": "finance", "description": "Saisie impossible", "author_id": self.compta.id}
        rapide = Request.create(dict(valeurs, severity="bloquante", title="Saisie bloquée"))
        lente = Request.create(dict(valeurs, severity="majeure", title="Relances absentes"))
        attente = Request.create(dict(valeurs, severity="bloquante", title="Application inaccessible"))
        for demande, depot, prise in ((rapide, datetime(2026, 10, 19, 9), datetime(2026, 10, 19, 10, 30)),
                                      (lente, datetime(2026, 10, 23, 17), datetime(2026, 10, 26, 12))):
            demande.write({"state": "taken"})
            demande.write({"date_submitted": depot, "date_taken": prise})
        attente.write({"date_submitted": datetime(2026, 10, 26, 8)})
        maintenant = datetime(2026, 10, 26, 11)
        aucun = frozenset()
        self.assertEqual(rapide._delays(maintenant, aucun)["take_over"],
                         {"target_hours": 2, "hours": 1.5, "done": True, "late": False})
        self.assertEqual(lente._delays(maintenant, aucun)["take_over"],
                         {"target_hours": 4, "hours": 5.0, "done": True, "late": True})
        self.assertEqual(attente._delays(maintenant, aucun)["take_over"],
                         {"target_hours": 2, "hours": 3.0, "done": False, "late": True})
        self.assertFalse(attente._delays(maintenant, aucun)["resolution"]["late"], "Bloquante : résolution sous 8 heures")

        synthese = Request.with_user(self.admin)._summary(now=maintenant)
        groupes = {g["key"]: g for g in synthese["take_over"]["by_severity"]}
        self.assertEqual((groupes["bloquante"]["count"], groupes["bloquante"]["average_hours"], groupes["bloquante"]["late"]),
                         (1, 1.5, 0))
        self.assertEqual((groupes["majeure"]["count"], groupes["majeure"]["max_hours"], groupes["majeure"]["late"]),
                         (1, 5.0, 1))
        self.assertEqual(groupes["evolution"]["target_hours"], 20, "Évolution : qualifiée sous 2 jours ouvrés")
        self.assertEqual((synthese["take_over"]["count"], synthese["take_over"]["average_hours"]), (2, 3.25))
        self.assertEqual((synthese["take_over"]["waiting"], synthese["take_over"]["waiting_late"]), (1, 1))
        self.assertEqual((synthese["counts"]["taken"], synthese["counts"]["submitted"], synthese["open"]), (2, 1, 3))

    def test_cloture_d_office_apres_cinq_jours_ouvres(self):
        Request = self.env["eguitra.support.request"]
        valeurs = {"kind": "question", "app": "plateforme", "title": "Mot de passe", "description": "Comment le changer ?",
                   "author_id": self.compta.id}
        ancienne, recente = Request.create(valeurs), Request.create(valeurs)
        (ancienne | recente).write({"state": "resolved", "response": "Menu du compte, « Changer le mot de passe »."})
        ancienne.write({"date_resolved": fields.Datetime.now() - timedelta(days=20)})
        self.assertEqual(Request._cron_close_resolved(), ancienne)
        self.assertEqual((ancienne.state, recente.state), ("closed", "resolved"))
        self.assertTrue(ancienne.date_closed)
        self.assertIn("close d'office", ancienne.comment_ids[-1].body)
