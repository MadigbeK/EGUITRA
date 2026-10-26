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
