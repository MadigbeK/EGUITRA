"""Relances des clients : niveaux selon le retard, file d'envoi, lettres, envoi par courriel.

Chaque nuit, les factures clients échues et non soldées sont regroupées par client ; une relance
est créée quand le retard atteint un nouveau niveau (rappel, relance ferme, mise en demeure).
Les deux premiers niveaux partent seuls par courriel si le client a une adresse et si un serveur
d'envoi est paramétré ; la mise en demeure attend toujours la décision de la finance.
"""

from markupsafe import Markup, escape

from odoo import api, fields, models
from odoo.exceptions import UserError

LEVELS = [
    ("1", "Rappel"),
    ("2", "Relance ferme"),
    ("3", "Mise en demeure"),
]
DEFAULT_DAYS = "1,15,30"  # retard minimal (jours) de chaque niveau ; paramètre eguitra_finance.reminder_days
AUTO_SEND_LEVELS = ("1", "2")


def _gnf(amount):
    return f"{amount:,.0f}".replace(",", " ") + " GNF"


class EguitraReminder(models.Model):
    _name = "eguitra.reminder"
    _description = "Relance client"
    _order = "date desc, id desc"

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Client", required=True, index=True)
    date = fields.Date(required=True, default=fields.Date.context_today)
    level = fields.Selection(LEVELS, "Niveau", required=True)
    days_overdue = fields.Integer("Retard (jours)")
    amount_due = fields.Monetary("Montant échu")
    invoice_ids = fields.Many2many("account.move", string="Factures relancées")
    state = fields.Selection([("to_send", "À envoyer"), ("sent", "Envoyée"), ("cancelled", "Annulée")],
                             default="to_send", required=True, index=True)
    channel = fields.Selection([("email", "Courriel"), ("letter", "Courrier remis ou posté")], "Envoi")
    sent_at = fields.Datetime(readonly=True)
    sent_by = fields.Many2one("res.users", readonly=True)

    @api.model
    def _thresholds(self):
        raw = self.env["ir.config_parameter"].sudo().get_param("eguitra_finance.reminder_days", DEFAULT_DAYS)
        try:
            days = [int(x) for x in raw.split(",")][:3]
        except ValueError:
            days = [int(x) for x in DEFAULT_DAYS.split(",")]
        return dict(zip([code for code, _l in LEVELS], days, strict=False))

    @api.model
    def generate(self, companies=None, today=None):
        """Crée les relances dues ; renvoie les relances créées."""
        today = today or fields.Date.context_today(self)
        thresholds = self._thresholds()
        created = self.browse()
        for company in companies or self.env["res.company"].search([]):
            invoices = self.env["account.move"].search([
                ("company_id", "=", company.id), ("move_type", "=", "out_invoice"), ("state", "=", "posted"),
                ("payment_state", "in", ("not_paid", "partial")), ("invoice_date_due", "<", today),
            ])
            for partner in invoices.partner_id.commercial_partner_id:
                mine = invoices.filtered(lambda m, p=partner: m.partner_id.commercial_partner_id == p)
                overdue = max((today - m.invoice_date_due).days for m in mine)
                level = max((lvl for lvl, days in thresholds.items() if overdue >= days), default=None)
                if not level:
                    continue
                oldest_due = min(mine.mapped("invoice_date_due"))
                already = self.search_count([
                    ("company_id", "=", company.id), ("partner_id", "=", partner.id), ("state", "!=", "cancelled"),
                    ("level", ">=", level), ("date", ">=", oldest_due),
                ])
                if already:
                    continue
                reminder = self.create({
                    "company_id": company.id, "partner_id": partner.id, "date": today, "level": level,
                    "days_overdue": overdue, "amount_due": sum(mine.mapped("amount_residual")),
                    "invoice_ids": [(6, 0, mine.ids)],
                })
                created |= reminder
        return created

    @api.model
    def _cron_generate(self):
        reminders = self.generate()
        if self.env["ir.mail_server"].sudo().search_count([]):
            for reminder in reminders.filtered(lambda r: r.level in AUTO_SEND_LEVELS and r.partner_id.email):
                reminder.action_send("email")

    def letter(self):
        """Texte de la lettre de relance (repris par l'impression et le courriel)."""
        self.ensure_one()
        company = self.company_id
        intro = {
            "1": "Sauf erreur de notre part, les factures ci-dessous restent impayées à ce jour. Nous vous remercions "
                 "de bien vouloir procéder à leur règlement.",
            "2": "Malgré notre précédent rappel, les factures ci-dessous restent impayées. Nous vous demandons de "
                 "procéder à leur règlement sous huit jours.",
            "3": "Malgré nos relances, les factures ci-dessous restent impayées. Nous vous mettons en demeure de "
                 "régler la somme due sous huit jours à compter de la réception de la présente ; à défaut, nous "
                 "engagerons les démarches de recouvrement.",
        }[self.level]
        return {
            "subject": f"{dict(LEVELS)[self.level]} : factures impayées, {company.name}",
            "company": company.name,
            "partner": self.partner_id.name,
            "date": self.date,
            "level": self.level,
            "level_label": dict(LEVELS)[self.level],
            "intro": intro,
            "invoices": [
                {"name": m.name, "date": m.invoice_date, "due": m.invoice_date_due, "total": m.amount_total,
                 "residual": m.amount_residual}
                for m in self.invoice_ids.sorted("invoice_date_due")
            ],
            "amount_due": self.amount_due,
            "closing": "Si votre règlement a croisé ce courrier, nous vous prions de ne pas en tenir compte.",
        }

    def action_send(self, channel):
        for reminder in self:
            if reminder.state == "cancelled":
                raise UserError("Cette relance est annulée.")
            if channel == "email":
                if not reminder.partner_id.email:
                    raise UserError(f"{reminder.partner_id.name} n'a pas d'adresse électronique.")
                if not self.env["ir.mail_server"].sudo().search_count([]):
                    raise UserError("Aucun serveur d'envoi de courriel n'est paramétré : imprimez la lettre.")
                data = reminder.letter()
                rows = Markup("").join(
                    Markup("<tr><td>{}</td><td>{}</td><td style='text-align:right'>{}</td></tr>").format(
                        i["name"], i["due"].strftime("%d/%m/%Y") if i["due"] else "", _gnf(i["residual"]))
                    for i in data["invoices"]
                )
                body = Markup(
                    "<p>Madame, Monsieur,</p><p>{}</p><table border='1' cellpadding='4' style='border-collapse:collapse'>"
                    "<tr><th>Facture</th><th>Échéance</th><th>Reste dû</th></tr>{}</table>"
                    "<p>Total échu : <b>{}</b></p><p>{}</p><p>{}</p>"
                ).format(data["intro"], rows, _gnf(data["amount_due"]), data["closing"], escape(data["company"]))
                self.env["mail.mail"].sudo().create({
                    "subject": data["subject"], "body_html": body, "email_to": reminder.partner_id.email,
                    "email_from": reminder.company_id.email or False, "auto_delete": False,
                }).send()
            reminder.write({"state": "sent", "channel": channel, "sent_at": fields.Datetime.now(),
                            "sent_by": self.env.user.id})
        return True
