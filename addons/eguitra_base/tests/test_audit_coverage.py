from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_base.models.eguitra_setup import AUDIT_EXCLUDED_MODELS, PLATFORM_PREFIXES


@tagged("post_install", "-at_install")
class TestAuditCoverage(TransactionCase):
    """Piste d'audit (offre, chapitre 5.3 ; attente 14) : chaque modèle suivi des modules installés a sa
    règle complète, et tout modèle de la plateforme est soit suivi, soit écarté explicitement : un
    nouveau modèle oublié dans les listes AUDITED_MODELS fait échouer ce test."""

    def test_modeles_suivis_ont_leur_regle(self):
        Rule = self.env["auditlog.rule"].sudo()
        missing = [
            name for name in self.env["eguitra.setup"].audited_models()
            if not Rule.search_count([
                ("model_id.model", "=", name), ("state", "=", "confirmed"),
                ("log_create", "=", True), ("log_write", "=", True), ("log_unlink", "=", True),
            ])
        ]
        self.assertEqual(missing, [], "Modèles sans piste d'audit")

    def test_parametres_systeme_suivis(self):
        self.assertIn("ir.config_parameter", self.env["eguitra.setup"].audited_models(),
                      "L'interrupteur de la double authentification doit être tracé")

    def test_tout_modele_de_la_plateforme_est_suivi_ou_ecarte(self):
        audited = set(self.env["eguitra.setup"].audited_models())
        forgotten = sorted(
            name for name, model in self.env.registry.items()
            if name.startswith(PLATFORM_PREFIXES) and not model._abstract and not model._transient
            and model._auto and name not in audited and name not in AUDIT_EXCLUDED_MODELS
        )
        self.assertEqual(forgotten, [], "Ajouter ces modèles à la liste AUDITED_MODELS de leur module, "
                                        "ou à AUDIT_EXCLUDED_MODELS avec la raison")

    def test_regles_posees_par_la_migration(self):
        """ensure_all_audit_rules (migration de fin) rétablit une règle retirée."""
        rule = self.env["auditlog.rule"].sudo().search([("model_id.model", "=", "ir.config_parameter")])
        rule.unlink()
        self.env["eguitra.setup"].ensure_all_audit_rules()
        self.assertTrue(self.env["auditlog.rule"].sudo().search_count([("model_id.model", "=", "ir.config_parameter")]))
