from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_approval.hooks import AUDITED_MODELS as APPROVAL_MODELS
from odoo.addons.eguitra_base.models.eguitra_setup import CORE_AUDITED_MODELS
from odoo.addons.eguitra_finance.hooks import FINANCE_AUDITED_MODELS


@tagged("post_install", "-at_install")
class TestAuditCoverage(TransactionCase):
    """Piste d'audit (courrier du responsable financier, attente 14) : chaque modèle de gestion a sa
    règle de journalisation des créations, modifications et suppressions. Les modèles d'eguitra_approval,
    qui dépend de ce module, ne sont vérifiés que s'il est installé."""

    def test_modeles_de_gestion_journalises(self):
        Rule = self.env["auditlog.rule"].sudo()
        approval = [model for model in APPROVAL_MODELS if model in self.env]
        missing = [
            model for model in CORE_AUDITED_MODELS + FINANCE_AUDITED_MODELS + approval
            if not Rule.search_count([("model_id.model", "=", model), ("log_write", "=", True), ("log_unlink", "=", True)])
        ]
        self.assertEqual(missing, [], "Modèles sans piste d'audit")
