import logging

from odoo import api, models

_logger = logging.getLogger(__name__)

# Modèles du noyau dont chaque création, modification et suppression est journalisée
# avec les valeurs avant et après (offre, chapitre 5.3). Les modules métier ajoutent les leurs.
CORE_AUDITED_MODELS = [
    "account.move",
    "account.move.line",
    "account.payment",
    "account.account",
    "account.journal",
    "account.tax",
    "account.analytic.account",
    "res.partner",
    "res.partner.bank",
    "res.company",
    "res.users",
    "res.currency.rate",
]


class EguitraSetup(models.AbstractModel):
    _name = "eguitra.setup"
    _description = "Outils de paramétrage de la plateforme EGUITRA"

    @api.model
    def ensure_audit_rules(self, model_names):
        """Crée et active une règle de piste d'audit complète pour chaque modèle (idempotent)."""
        Rule = self.env["auditlog.rule"].sudo()
        for model_name in model_names:
            model = self.env["ir.model"].sudo()._get(model_name)
            if not model:
                _logger.warning("Piste d'audit : modèle %s introuvable", model_name)
                continue
            rule = Rule.search([("model_id", "=", model.id)], limit=1)
            values = {
                "log_create": True,
                "log_write": True,
                "log_unlink": True,
                "log_read": False,
                "log_type": "full",
                "capture_record": True,
            }
            if rule:
                if rule.state != "confirmed":
                    rule.write(dict(values, state="confirmed"))
            else:
                Rule.create(
                    dict(values, name=f"EGUITRA - {model.name}", model_id=model.id, state="confirmed")
                )

    @api.model
    def clear_placeholder_logos(self):
        """Retire le logo d'exemple du noyau (« Your logo ») : sans logo, factures et lettres portent
        la raison sociale ; le vrai logo se dépose dans Administration > Sociétés."""
        Company = self.env["res.company"].sudo()
        placeholder = Company._get_logo()
        companies = Company.search([]).filtered(lambda c: c.logo and c.logo == placeholder)
        companies.write({"logo": False})
        return companies

    @api.model
    def ensure_document_settings(self):
        """Documents imprimés en français : l'identifiant fiscal de Guinée s'intitule « NIF »
        (sinon les factures afficheraient « Tax ID »)."""
        guinea = self.env.ref("base.gn").sudo()
        if not guinea.vat_label:
            guinea.vat_label = "NIF"

    @api.model
    def ensure_cabinet_company(self):
        """Crée MB AxisPro avec le plan SYSCOHADA Guinée, si elle n'existe pas."""
        Company = self.env["res.company"].sudo()
        cabinet = Company.search([("eguitra_entity", "=", "cabinet")], limit=1)
        if cabinet:
            return cabinet
        gnf = self.env.ref("base.GNF")
        if not gnf.active:
            gnf.active = True
        cabinet = Company.create(
            {
                "name": "MB AxisPro",
                "country_id": self.env.ref("base.gn").id,
                "currency_id": gnf.id,
                "eguitra_entity": "cabinet",
            }
        )
        self.env["account.chart.template"].try_loading("gn", company=cabinet, install_demo=False)
        # Les administrateurs du noyau gèrent les deux sociétés.
        for user in (self.env.ref("base.user_root"), self.env.ref("base.user_admin")):
            user.sudo().write({"company_ids": [(4, cabinet.id)]})
        return cabinet
