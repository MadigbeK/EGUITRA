"""Outils du cabinet MB AxisPro Consulting pour le portail des porteurs : rappels du matin, ciblage par
secteur, liste d'attente, événement modifié, rendez-vous, compteurs de la synthèse, saisies mal
formées et écritures réservées au profil cabinet."""

from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_axispro.tests.test_axispro import GRID
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

    def event(self, **values):
        return self.env["portail.event"].create(dict({
            "name": "Atelier plan de trésorerie", "kind": "atelier", "start": FUTURE, "end": FUTURE + timedelta(hours=3),
            "capacity": 0, "state": "published", "company_id": self.cabinet.id,
        }, **values))

    def notes(self, user, prefix=""):
        self.env.invalidate_all()
        return self.env["portail.notification"].search(
            [("user_id", "=", user.id), ("title", "=like", f"{prefix}%")])

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
