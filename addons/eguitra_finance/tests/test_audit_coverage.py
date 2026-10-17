from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_approval.hooks import AUDITED_MODELS as APPROVAL_MODELS
from odoo.addons.eguitra_base.models.eguitra_setup import CORE_AUDITED_MODELS
from odoo.addons.eguitra_finance.hooks import FINANCE_AUDITED_MODELS


@tagged("post_install", "-at_install")
class TestAuditCoverage(TransactionCase):
    """Piste d'audit (courrier du responsable financier, attente 14) : chaque modèle de gestion a sa
    règle de journalisation des créations, modifications et suppressions."""

    def test_modeles_de_gestion_journalises(self):
        Rule = self.env["auditlog.rule"].sudo()
        missing = [
            model for model in CORE_AUDITED_MODELS + FINANCE_AUDITED_MODELS + APPROVAL_MODELS
            if not Rule.search_count([("model_id.model", "=", model), ("log_write", "=", True), ("log_unlink", "=", True)])
        ]
        self.assertEqual(missing, [], "Modèles sans piste d'audit")
