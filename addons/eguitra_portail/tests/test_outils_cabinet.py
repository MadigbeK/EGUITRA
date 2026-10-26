"""Outils du cabinet MB AxisPro Consulting pour le portail des porteurs : rappels du matin, ciblage par
secteur, liste d'attente, événement modifié, rendez-vous, compteurs de la synthèse, saisies mal
formées et écritures réservées au profil cabinet."""

from datetime import datetime, time, timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_axispro.tests.test_axispro import GRID
from odoo.addons.eguitra_portail.controllers import cabinet as cabinet_api
from odoo.addons.eguitra_portail.models.agenda import PortailEvent

FUTURE = (fields.Datetime.now() + timedelta(days=20)).replace(microsecond=0)


def at_time(moment):
    """Horloge du noyau arrêtée à `moment` (inscriptions et dates d'attente), le temps d'un bloc."""
    return patch.object(fields.Datetime, "now", staticmethod(lambda *args, **kwargs: moment))


@tagged("post_install", "-at_install")
class TestOutilsCabinet(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["ir.config_parameter"].sudo().set_param("eguitra_api.mfa_required", "0")
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.policy = cls.env["axispro.policy"].import_grid(cls.cabinet, "Politique des outils", "grille.csv", GRID)
        cls.policy.action_activate()
        cabinet_only = {"company_id": cls.cabinet.id, "company_ids": [(6, 0, cls.cabinet.ids)]}
        cls.consultant = cls._create_user("consultant.outils", "cabinet", **cabinet_only)
        cls.pa, cls.pb, cls.pc, cls.pd = (cls._create_user(f"porteur.outils{i}", "porteur", **cabinet_only)
                                          for i in range(1, 5))
        Dossier = cls.env["axispro.dossier"]
        Partner = cls.env["res.partner"]

        def dossier(name, sector, user):
            return Dossier.create({
                "name": name, "promoter_id": Partner.create({"name": f"{name} SARL"}).id, "company_id": cls.cabinet.id,
                "consultant_id": cls.consultant.id, "sector": sector, "portal_user_ids": [(6, 0, user.ids)],
            })

        cls.dossier_a = dossier("Centrale solaire", "Énergie solaire", cls.pa)
        cls.dossier_b = dossier("Séchage de mangues", "Agro-industrie", cls.pb)
        cls.dossier_c = dossier("Négoce de riz", "Commerce général", cls.pc)
        cls.dossier_d = dossier("Biomasse de Kindia", "energie renouvelable (biomasse)", cls.pd)

    def setUp(self):
        super().setUp()
        self.cabinet_token = self.open_session("consultant.outils", app="axispro")["access_token"]

    def call(self, *args, **kwargs):
        # Écritures du test encore en attente (état d'un dossier, d'une inscription) : en base avant
        # que le noyau, qui répond dans un autre fil, ne les lise.
        self.env.flush_all()
        return super().call(*args, **kwargs)

    def event(self, **values):
        return self.env["portail.event"].create(dict({
            "name": "Atelier plan de trésorerie", "kind": "atelier", "start": FUTURE, "end": FUTURE + timedelta(hours=3),
            "capacity": 0, "state": "published", "company_id": self.cabinet.id,
        }, **values))

    def notes(self, user, prefix=""):
        self.env.invalidate_all()
        return self.env["portail.notification"].search(
            [("user_id", "=", user.id), ("title", "=like", f"{prefix}%")])

    # ─── I-P2 : rappels du matin ─────────────────────────────────────────

    def test_rappels_du_matin_au_calendrier_de_conakry_et_memorises(self):
        """Le lendemain civil à Conakry, pas la fenêtre de 12 à 36 heures : un webinaire du soir est
        annoncé la veille (« demain »), jamais le matin même. Chaque rappel est mémorisé : la tâche
        relancée n'envoie rien deux fois ; en retard, elle rattrape ce qui n'a pas été annoncé, en
        disant « aujourd'hui »."""
        day = (fields.Datetime.now() + timedelta(days=10)).date()

        def moment(offset, hour, minute=0):
            return datetime.combine(day + timedelta(days=offset), time(hour, minute))

        Notification = self.env["portail.notification"]
        Meeting = self.env["portail.meeting"]
        rdv = Meeting.create({"dossier_id": self.dossier_a.id, "subject": "Revue du plan", "state": "confirmed",
                              "start": moment(1, 9)})
        soir = self.event(name="Webinaire du soir", start=moment(0, 19, 30), end=moment(0, 21))
        tardif = self.event(name="Atelier tardif", start=moment(1, 20), end=moment(1, 22))
        soir.register(self.pa)
        tardif.register(self.pa)
        self.env["axispro.action"].create({"dossier_id": self.dossier_a.id, "name": "Fournir les statuts",
                                           "assignee": "porteur", "due_date": day + timedelta(days=2)})

        def rappels():
            self.env.invalidate_all()
            return Notification.search([("user_id", "=", self.pa.id), ("reminder_key", "!=", False)]).mapped("title")

        Notification._cron_reminders(now=moment(-1, 7))
        self.assertCountEqual(rappels(), ["Rappel : Webinaire du soir demain à 19 h 30"])

        Notification._cron_reminders(now=moment(0, 7))
        attendus = ["Rappel : Webinaire du soir demain à 19 h 30", "Rappel : rendez-vous demain à 09 h 00",
                    "Rappel : Atelier tardif demain à 20 h 00", "Échéance dans deux jours : Fournir les statuts"]
        self.assertCountEqual(rappels(), attendus, "Le webinaire de ce soir n'est pas rappelé une seconde fois")
        Notification._cron_reminders(now=moment(0, 7))
        self.assertCountEqual(rappels(), attendus, "Tâche relancée le même jour : aucun doublon")

        rdv.start = moment(1, 11)
        Meeting.create({"dossier_id": self.dossier_a.id, "subject": "Point banque", "state": "confirmed",
                        "start": moment(1, 15)})
        Notification._cron_reminders(now=moment(1, 7))
        self.assertCountEqual(rappels(), attendus + ["Rappel : rendez-vous aujourd'hui à 11 h 00",
                                                     "Rappel : rendez-vous aujourd'hui à 15 h 00"],
                              "Nouvelle date rappelée, rendez-vous non annoncé rattrapé ; l'action déjà rappelée ne l'est plus")

    # ─── I-P3 : ciblage par secteur ──────────────────────────────────────

    def test_ciblage_par_secteur_sans_accents(self):
        """« energie » vise « Énergie solaire » et « Énergie » vise « energie renouvelable », comme
        l'aperçu de l'écran : le porteur est prévenu et voit la publication."""
        Announcement = self.env["portail.announcement"]
        energie = Announcement.create({"name": "Fonds vert", "audience": "sectors", "sector_keywords": "Énergie",
                                       "company_id": self.cabinet.id})
        self.assertEqual(energie._audience_users(), self.pa | self.pd)
        large = Announcement.create({"name": "Appel régional", "audience": "sectors", "sector_keywords": "energie, AGRO",
                                     "company_id": self.cabinet.id})
        self.assertEqual(large._audience_users(), self.pa | self.pb | self.pd)
        large.action_publish()
        self.assertTrue(self.notes(self.pa, "Appel régional"))
        self.assertFalse(self.notes(self.pc, "Appel régional"))
        porteur = self.open_session("porteur.outils1", app="portail")["access_token"]
        status, liste = self.call("GET", "/portail/actualites", token=porteur)
        self.assertEqual(status, 200, liste)
        self.assertIn(large.id, [a["id"] for a in liste])

    # ─── I-P4 : liste d'attente ──────────────────────────────────────────

    def test_liste_d_attente_dans_l_ordre_d_attente(self):
        """Une promotion commune, dans l'ordre d'attente : quand la capacité augmente ou qu'une place
        se libère ; un nouvel inscrit ne passe pas devant ; un porteur qui se réinscrit reprend en fin
        de liste ; rien sur un événement annulé."""
        event = self.event(capacity=1)
        t0 = FUTURE - timedelta(days=10)
        with at_time(t0):
            ra = event.register(self.pa)
        with at_time(t0 + timedelta(hours=1)):
            rb = event.register(self.pb)
        with at_time(t0 + timedelta(hours=2)):
            rc = event.register(self.pc)
        self.assertEqual((ra.state, rb.state, rc.state), ("registered", "waitlist", "waitlist"))

        status, row = self.call("PATCH", f"/axispro/portail/evenements/{event.id}", {"capacity": 2},
                                token=self.cabinet_token)
        self.assertEqual(status, 200, row)
        self.env.invalidate_all()
        self.assertEqual((rb.state, rc.state), ("registered", "waitlist"), "La place ajoutée va au premier en attente")
        self.assertTrue(self.notes(self.pb, "Place confirmée"))
        self.assertFalse(self.notes(self.pc, "Place confirmée"))

        with at_time(t0 + timedelta(hours=3)):
            rd = event.register(self.pd)
        self.assertEqual(rd.state, "waitlist")
        with at_time(t0 + timedelta(hours=4)):
            rc.cancel()
        with at_time(t0 + timedelta(hours=5)):
            event.register(self.pc)
        status, inscriptions = self.call("GET", f"/axispro/portail/evenements/{event.id}/inscriptions",
                                         token=self.cabinet_token)
        self.assertEqual(status, 200, inscriptions)
        rangs = {r["user"]: r["waitlist_rank"] for r in inscriptions if r["state"] == "waitlist"}
        self.assertEqual(rangs, {self.pd.name: 1, self.pc.name: 2}, "Réinscrit : en fin de liste")

        ra.cancel()
        self.assertEqual((rd.state, rc.state), ("registered", "waitlist"), "La place libérée suit l'ordre d'attente")
        self.assertTrue(self.notes(self.pd, "Place confirmée"))

        # Place libre restée sans promotion (capacité changée hors du noyau) : elle revient d'abord à la liste.
        self.env.cr.execute("UPDATE portail_event SET capacity = 3 WHERE id = %s", (event.id,))
        self.env.invalidate_all()
        with at_time(t0 + timedelta(hours=6)):
            event.register(self.pa)
        self.assertEqual((rc.state, ra.state), ("registered", "waitlist"), "Un nouvel inscrit ne passe pas devant")

        event.action_cancel()
        rb.cancel()
        event.capacity = 10
        self.assertEqual(ra.state, "waitlist", "Aucune promotion sur un événement annulé")
        self.assertFalse(self.notes(self.pa, "Place confirmée"))

    def test_inscriptions_simultanees_sous_verrou_de_ligne(self):
        """Inscription et désinscription prennent le verrou de ligne de l'événement : deux inscriptions
        simultanées passent l'une après l'autre et la jauge n'est jamais dépassée."""
        event = self.event(capacity=1)
        with patch.object(PortailEvent, "_lock_seats", autospec=True, side_effect=PortailEvent._lock_seats) as lock:
            registration = event.register(self.pa)
            event.register(self.pb)
            registration.cancel()
        self.assertGreaterEqual(lock.call_count, 3)
        self.assertEqual(event.seats_taken(), 1)

    # ─── I-P5 : événement publié modifié ─────────────────────────────────

    def test_evenement_modifie_previent_inscrits_et_nouveau_public(self):
        event = self.event(audience="dossiers", dossier_ids=[(6, 0, self.dossier_a.ids)], location="Kaloum")
        event.register(self.pa)
        payload = {"name": event.name, "kind": "atelier", "start": FUTURE.isoformat(),
                   "end": (FUTURE + timedelta(hours=3)).isoformat(), "location": "Kaloum", "online_url": "",
                   "capacity": 0, "audience": "dossiers", "dossier_ids": self.dossier_a.ids, "gate_codes": "",
                   "sector_keywords": ""}
        status, row = self.call("PATCH", f"/axispro/portail/evenements/{event.id}", payload, token=self.cabinet_token)
        self.assertEqual(status, 200, row)
        self.assertFalse(self.notes(self.pa, "Changement"), "Formulaire renvoyé sans changement : personne n'est dérangé")

        lendemain = FUTURE + timedelta(days=1)
        changed = dict(payload, location="Kipé", start=lendemain.isoformat(),
                       end=(lendemain + timedelta(hours=3)).isoformat())
        status, row = self.call("PATCH", f"/axispro/portail/evenements/{event.id}", changed, token=self.cabinet_token)
        self.assertEqual(status, 200, row)
        note = self.notes(self.pa, "Changement")
        self.assertEqual(len(note), 1)
        self.assertIn("Nouveau lieu : Kipé.", note.body)
        self.assertIn("Nouvel horaire", note.body)

        status, row = self.call("PATCH", f"/axispro/portail/evenements/{event.id}",
                                dict(changed, audience="all", dossier_ids=[]), token=self.cabinet_token)
        self.assertEqual(status, 200, row)
        for porteur in (self.pb, self.pc, self.pd):
            self.assertTrue(self.notes(porteur, event.name), "Public élargi : l'annonce de l'événement")
        self.assertFalse(self.notes(self.pa, event.name), "L'inscrit n'est pas réinvité")

    # ─── M9 : rendez-vous ────────────────────────────────────────────────

    def test_rendez_vous_jamais_confirme_dans_le_passe_et_compte_rendu_notifie(self):
        meeting = self.env["portail.meeting"].create({"dossier_id": self.dossier_a.id, "subject": "Point bancaire",
                                                      "requested_by": self.pa.id, "slot_1": FUTURE})
        path = f"/axispro/portail/rendez-vous/{meeting.id}"
        passe = (fields.Datetime.now() - timedelta(hours=2)).replace(microsecond=0).isoformat()
        status, body = self.call("PATCH", path, {"action": "confirm", "start": passe}, token=self.cabinet_token)
        self.assertEqual(status, 422, body)
        status, body = self.call("POST", "/axispro/portail/rendez-vous", {
            "dossier_id": self.dossier_a.id, "subject": "Rattrapage", "start": passe}, token=self.cabinet_token)
        self.assertEqual(status, 422, body)
        self.assertFalse(self.env["portail.meeting"].search([("subject", "=", "Rattrapage")]), "Rien n'est créé")

        status, body = self.call("PATCH", path, {"action": "confirm", "start": FUTURE.isoformat()}, token=self.cabinet_token)
        self.assertEqual((status, body["state"]), (200, "confirmed"), body)
        status, body = self.call("PATCH", path, {"action": "minutes", "minutes": "Trop tôt"}, token=self.cabinet_token)
        self.assertEqual(status, 422, "Le compte rendu suit le rendez-vous tenu")
        status, body = self.call("PATCH", path, {"action": "done"}, token=self.cabinet_token)
        self.assertEqual((status, body["state"]), (200, "done"), body)
        self.assertFalse(self.notes(self.pa, "Compte rendu"))

        status, body = self.call("PATCH", path, {"action": "minutes", "minutes": "Décision : dossier à la banque."},
                                 token=self.cabinet_token)
        self.assertEqual(status, 200, body)
        self.assertEqual(len(self.notes(self.pa, "Compte rendu disponible : Point bancaire")), 1)
        self.call("PATCH", path, {"action": "minutes", "minutes": "Décision : dossier à la banque."},
                  token=self.cabinet_token)
        self.assertEqual(len(self.notes(self.pa, "Compte rendu")), 1, "Même texte : pas de nouvelle notification")
        self.call("PATCH", path, {"action": "minutes", "minutes": "Décision : dossier à la banque le 12."},
                  token=self.cabinet_token)
        self.assertEqual(len(self.notes(self.pa, "Compte rendu mis à jour : Point bancaire")), 1)

    def test_rendez_vous_demandes_toujours_rendues_historique_borne(self):
        Meeting = self.env["portail.meeting"]
        base = {"dossier_id": self.dossier_a.id, "subject": "Rendez-vous"}
        demande = Meeting.create(dict(base, state="requested", slot_1=FUTURE))
        confirme = Meeting.create(dict(base, state="confirmed", start=FUTURE))
        Meeting.create([dict(base, state="done", start=FUTURE - timedelta(days=40 + i)) for i in range(3)])
        with patch.object(cabinet_api, "MEETING_HISTORY_LIMIT", 1):
            status, rows = self.call("GET", "/axispro/portail/rendez-vous", token=self.cabinet_token)
        self.assertEqual(status, 200, rows)
        ids = [r["id"] for r in rows]
        self.assertIn(demande.id, ids)
        self.assertIn(confirme.id, ids)
        self.assertEqual(len([r for r in rows if r["state"] == "done"]), 1, "Historique borné")

    # ─── M9 : compteurs de la synthèse ───────────────────────────────────

    def test_compteurs_des_accuses_de_lecture(self):
        """Accusés en attente : les porteurs du public sans accusé. L'accusé d'un ancien lecteur, sorti
        du public, ne compense pas celui d'un porteur visé."""
        self.dossier_d.state = "closed"
        announcement = self.env["portail.announcement"].create({"name": "À lire et confirmer", "require_ack": True,
                                                                "company_id": self.cabinet.id})
        announcement.action_publish()
        now = fields.Datetime.now()
        self.env["portail.announcement.read"].create([
            {"announcement_id": announcement.id, "user_id": u.id, "acknowledged_at": now} for u in (self.pa, self.pd)])
        status, synthese = self.call("GET", "/axispro/portail/synthese", token=self.cabinet_token)
        self.assertEqual(status, 200, synthese)
        self.assertEqual(synthese["announcements"]["ack_pending"], 2, "B et C n'ont pas accusé lecture")
        _s, admin = self.call("GET", "/axispro/portail/annonces", token=self.cabinet_token)
        stats = next(a for a in admin if a["id"] == announcement.id)["stats"]
        self.assertEqual(stats, {"audience": 3, "read": 1, "acknowledged": 1})

    def test_satisfaction_calculee_sur_tous_les_avis(self):
        Feedback = self.env["portail.feedback"]
        Feedback.create([
            {"dossier_id": self.dossier_a.id, "user_id": self.pa.id, "score": 5, "recommend": 10},
            {"dossier_id": self.dossier_b.id, "user_id": self.pb.id, "score": 4, "recommend": 9},
            {"dossier_id": self.dossier_c.id, "user_id": self.pc.id, "score": 2, "recommend": 3, "topic": "consultant"},
        ])
        with patch.object(cabinet_api, "FEEDBACK_LIMIT", 2):
            _s, avis = self.call("GET", "/axispro/portail/avis", token=self.cabinet_token)
            status, synthese = self.call("GET", "/axispro/portail/synthese", token=self.cabinet_token)
        self.assertEqual(status, 200, synthese)
        self.assertEqual(len(avis), 2, "Détail borné")
        fb = synthese["feedback"]
        self.assertEqual((fb["count"], fb["average"], fb["nps"], fb["promoters"], fb["passives"], fb["detractors"]),
                         (3, 3.7, 33, 2, 0, 1))
        self.assertEqual(fb["scores"], {"1": 0, "2": 1, "3": 0, "4": 1, "5": 1})
        self.assertEqual({t["topic"]: t["count"] for t in fb["topics"]}, {"global": 2, "consultant": 1})

    # ─── M3 : saisies mal formées ────────────────────────────────────────

    def test_saisies_mal_formees_refusees_en_400(self):
        """Une saisie mal formée est refusée (400, invalid_parameter), jamais une erreur interne ni un 0."""
        event = self.event(capacity=2)
        registration = event.register(self.pa)
        meeting = self.env["portail.meeting"].create({"dossier_id": self.dossier_a.id, "subject": "Point",
                                                      "slot_1": FUTURE})
        start, end = FUTURE.isoformat(), (FUTURE + timedelta(hours=2)).isoformat()
        cases = [
            ("POST", "/axispro/portail/evenements", {"name": "X", "start": start, "end": end, "capacity": "vingt"}),
            ("POST", "/axispro/portail/evenements", {"name": "X", "start": start, "end": end, "capacity": 2.5}),
            ("PATCH", f"/axispro/portail/evenements/{event.id}", {"dossier_ids": ["abc"]}),
            ("PATCH", f"/axispro/portail/evenements/{event.id}", {"dossier_ids": 12}),
            ("PATCH", f"/axispro/portail/evenements/{event.id}", {"kind": ["atelier"]}),
            ("PATCH", f"/axispro/portail/evenements/{event.id}", {"start": "bientôt"}),
            ("POST", "/axispro/portail/annonces", {"title": "X", "expire_date": "bientôt"}),
            ("POST", "/axispro/portail/annonces", {"title": "X", "audience": {"all": True}}),
            ("POST", "/axispro/portail/rubriques", {"name": "X", "sequence": "dix"}),
            ("POST", "/axispro/portail/rubriques", {"name": "X", "color": ["azur"]}),
            ("POST", "/axispro/portail/articles", {"title": "X", "category_id": "abc"}),
            ("POST", "/axispro/portail/rendez-vous", {"dossier_id": "abc", "subject": "X", "start": start}),
            ("POST", "/axispro/portail/rendez-vous",
             {"dossier_id": self.dossier_a.id, "subject": "X", "start": start, "duration": "une heure"}),
            ("PATCH", f"/axispro/portail/rendez-vous/{meeting.id}", {"action": "confirm", "start": start, "duration": "1h"}),
            ("PATCH", f"/axispro/portail/rendez-vous/{meeting.id}", {"action": "confirm", "start": start, "mode": ["video"]}),
            ("PATCH", f"/axispro/portail/inscriptions/{registration.id}", {"state": ["registered"]}),
        ]
        for method, path, payload in cases:
            with self.subTest(method=method, path=path, payload=payload):
                status, body = self.call(method, path, payload, token=self.cabinet_token)
                self.assertEqual((status, body.get("error")), (400, "invalid_parameter"), body)
        self.env.invalidate_all()
        self.assertEqual((event.capacity, meeting.state), (2, "requested"), "Rien n'a changé")

    # ─── Rôles par profil ────────────────────────────────────────────────

    def test_ecritures_reservees_au_profil_cabinet(self):
        """Écriture : profil cabinet seul. La direction, l'administration, la finance et le porteur
        sont refusés (403) sur chaque route d'écriture des outils du portail, sans rien changer ; la
        direction et l'administration lisent."""
        cabinet_only = {"company_id": self.cabinet.id, "company_ids": [(6, 0, self.cabinet.ids)]}
        self._create_user("dg.outils", "direction", **cabinet_only)
        self._create_user("admin.outils", "admin", **cabinet_only)
        self._create_user("daf.outils", "finance", **cabinet_only)
        tokens = {
            "direction": self.open_session("dg.outils", app="axispro")["access_token"],
            "admin": self.open_session("admin.outils", app="axispro")["access_token"],
            "finance": self.open_session("daf.outils")["access_token"],
            "porteur": self.open_session("porteur.outils1", app="portail")["access_token"],
        }
        event = self.event(capacity=5)
        registration = event.register(self.pa)
        meeting = self.env["portail.meeting"].create({"dossier_id": self.dossier_a.id, "subject": "Point",
                                                      "slot_1": FUTURE})
        announcement = self.env["portail.announcement"].create({"name": "Brouillon", "company_id": self.cabinet.id})
        category = self.env["portail.category"].create({"name": "Financer", "company_id": self.cabinet.id})
        article = self.env["portail.article"].create({"name": "Guide", "body": "Texte", "company_id": self.cabinet.id})
        start = FUTURE.isoformat()
        routes = [
            ("POST", f"/axispro/portail/conversations/{self.dossier_a.id}", {"body": "Bonjour"}),
            ("POST", "/axispro/portail/annonces", {"title": "Nouvelle"}),
            ("PATCH", f"/axispro/portail/annonces/{announcement.id}", {"title": "Modifiée"}),
            ("POST", f"/axispro/portail/annonces/{announcement.id}/publier", {}),
            ("POST", "/axispro/portail/rubriques", {"name": "Nouvelle"}),
            ("PATCH", f"/axispro/portail/rubriques/{category.id}", {"name": "Modifiée"}),
            ("POST", "/axispro/portail/articles", {"title": "Nouveau"}),
            ("PATCH", f"/axispro/portail/articles/{article.id}", {"title": "Modifié"}),
            ("POST", f"/axispro/portail/articles/{article.id}/publier", {}),
            ("DELETE", f"/axispro/portail/articles/{article.id}/fichiers/1", None),
            ("POST", "/axispro/portail/evenements", {"name": "Nouveau", "start": start, "end": start}),
            ("PATCH", f"/axispro/portail/evenements/{event.id}", {"capacity": 1}),
            ("POST", f"/axispro/portail/evenements/{event.id}/annuler", {}),
            ("PATCH", f"/axispro/portail/inscriptions/{registration.id}", {"state": "cancelled"}),
            ("POST", "/axispro/portail/rendez-vous", {"dossier_id": self.dossier_a.id, "subject": "X", "start": start}),
            ("PATCH", f"/axispro/portail/rendez-vous/{meeting.id}", {"action": "confirm", "start": start}),
        ]
        for profile, token in tokens.items():
            for method, path, payload in routes:
                with self.subTest(profile=profile, method=method, path=path):
                    status, body = self.call(method, path, payload, token=token)
                    self.assertEqual((status, body.get("error")), (403, "forbidden"), body)
        self.env.invalidate_all()
        self.assertEqual((event.state, event.capacity, registration.state, meeting.state, announcement.state,
                          announcement.name, category.name, article.state),
                         ("published", 5, "registered", "requested", "draft", "Brouillon", "Financer", "draft"))
        for profile in ("direction", "admin"):
            with self.subTest(profile=profile, lecture=True):
                status, body = self.call("GET", "/axispro/portail/evenements", token=tokens[profile])
                self.assertEqual(status, 200, body)
