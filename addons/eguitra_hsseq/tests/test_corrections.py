from datetime import timedelta

from odoo.tests import tagged

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestCorrections(HsseqCase):
    """Manques et défauts relevés par les écrans du lot 2 (contrat, §15) et par NIMOVA Terrain : un test par
    défaut corrigé."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def test_clients_dans_les_referentiels(self):
        """Clients (identifiant, nom) servis à l'administration, la direction et hsseq, pour les audits, les
        exigences et les modèles de rapport ; à personne d'autre."""
        for login in ("kadi.hsseq", "dg.hsseq", "admin.hsseq"):
            status, refs = self.api(login, "GET", "/hsseq/referentials")
            self.assertEqual(status, 200, refs)
            self.assertIn({"id": self.customer.id, "name": self.customer.name}, refs["clients"], login)
            self.assertNotIn(self.supplier.id, [c["id"] for c in refs["clients"]], "Un fournisseur n'est pas un client")
        for login in ("ibrahima", "rh.hsseq", "awa.auditrice"):
            status, refs = self.api(login, "GET", "/hsseq/referentials")
            self.assertEqual((status, refs["clients"]), (200, []), login)
        status, refs = self.driver_api("GET", "/hsseq/referentials")
        self.assertEqual(refs["clients"], [])

    def test_registre_des_risques_filtres_et_compteurs(self):
        """Compteurs par état aux filtres de la liste ; filtre par case de la matrice (brute ou résiduelle) ;
        actions d'un risque ; délai de revue servi."""
        Risk = self.env["eguitra.hsseq.risk"]
        base = {"company_id": self.company.id, "owner_id": self.hsseq.id, "hazard": "Danger", "site_id": self.site.id}
        safety = Risk.create(dict(base, nature="safety_hazard", feared_event="Renversement", raw_severity=4,
                                  raw_probability=4, residual_severity=2, residual_probability=3))
        safety.action_activate()
        aspect = Risk.create(dict(base, nature="environmental_aspect", feared_event="Déversement", raw_severity=3,
                                  raw_probability=3, residual_severity=3, residual_probability=3))
        archived = Risk.create(dict(base, nature="safety_hazard", feared_event="Chute", raw_severity=2,
                                    raw_probability=2, residual_severity=1, residual_probability=1))
        archived.action_archive_risk("Activité arrêtée")
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/risks?nature=safety_hazard")
        self.assertEqual(status, 200, listing)
        self.assertEqual(listing["counts"]["by_status"], {"draft": 0, "active": 1, "archived": 1},
                         "Compteurs aux filtres de la liste")
        status, cell = self.api("kadi.hsseq", "GET", "/hsseq/risks?raw_severity=4&raw_probability=4")
        self.assertEqual([r["id"] for r in cell["items"]], [safety.id], "Case brute 4 × 4")
        status, cell = self.api("kadi.hsseq", "GET", "/hsseq/risks?residual_severity=3&residual_probability=3")
        self.assertEqual([r["id"] for r in cell["items"]], [aspect.id], "Case résiduelle 3 × 3")
        status, body = self.api("kadi.hsseq", "GET", "/hsseq/risks?raw_severity=9")
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"))
        Action = self.env["eguitra.hsseq.action"]
        mine = Action.create({"origin": "risk", "risk_id": safety.id, "description": "Butée de roue",
                              "owner_id": self.parc.id, "due_date": self.day + timedelta(days=10)})
        Action.create({"origin": "event", "event_id": self.event().id, "description": "Autre action",
                       "owner_id": self.parc.id, "due_date": self.day + timedelta(days=10)})
        status, actions = self.api("kadi.hsseq", "GET", f"/hsseq/actions?risk_id={safety.id}")
        self.assertEqual([a["id"] for a in actions["items"]], [mine.id], "Actions d'un risque")
        status, settings = self.api("kadi.hsseq", "GET", "/hsseq/settings")
        self.assertEqual(settings["risk_review_months"], 12)
        status, refs = self.api("ibrahima", "GET", "/hsseq/referentials")
        self.assertEqual(refs["risk_review_months"], 12, "Délai de revue servi aux écrans du registre")
