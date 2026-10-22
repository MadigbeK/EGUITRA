"""Relances des clients : niveaux selon le retard, file d'envoi, lettres, envoi par courriel.

Chaque nuit, les factures clients échues et non soldées sont regroupées par client ; une relance
est créée quand le retard atteint un nouveau niveau (rappel, relance ferme, mise en demeure). Les
créances reprises de l'ancien système (à-nouveaux et écritures de la reprise, éclatés par facture
avec leur échéance) sont relancées comme les factures.
Les deux premiers niveaux partent seuls par courriel si le client a une adresse et si un serveur
d'envoi est paramétré ; la mise en demeure attend toujours la décision de la finance.
"""

import base64

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


def _taken_name(line):
    """Référence d'une créance reprise : libellé de la ligne d'à-nouveau (« Facture … du … »), sinon
    numéro de la pièce de l'ancien système (référence « Reprise … » de l'écriture)."""
    ref = line.move_id.ref or ""
    if line.move_id.journal_id.code != "AN" and ref.startswith("Reprise "):
        return ref[len("Reprise "):]
    return line.name or ref or line.move_id.name


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
    line_ids = fields.Many2many("account.move.line", "eguitra_reminder_move_line_rel", "reminder_id", "line_id",
                                string="Créances reprises relancées",
                                help="Factures de l'ancien système reprises en écritures (à-nouveaux, reprise).")
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
            # Une facture en litige n'est pas relancée tant que le litige dure.
            invoices = self.env["account.move"].search([
                ("company_id", "=", company.id), ("move_type", "=", "out_invoice"), ("state", "=", "posted"),
                ("payment_state", "in", ("not_paid", "partial")), ("invoice_date_due", "<", today),
                ("eguitra_dispute", "=", False),
            ])
            # Créances reprises : lignes client ouvertes et échues des écritures (pas des factures).
            lines = self.env["account.move.line"].search([
                ("company_id", "=", company.id), ("account_id.account_type", "=", "asset_receivable"),
                ("parent_state", "=", "posted"), ("move_id.move_type", "=", "entry"), ("reconciled", "=", False),
                ("amount_residual", ">", 0), ("date_maturity", "<", today), ("partner_id", "!=", False),
                ("move_id.eguitra_dispute", "=", False),
            ])
            partners = invoices.partner_id.commercial_partner_id | lines.partner_id.commercial_partner_id
            for partner in partners:
                mine = invoices.filtered(lambda m, p=partner: m.partner_id.commercial_partner_id == p)
                taken = lines.filtered(lambda line, p=partner: line.partner_id.commercial_partner_id == p)
                dues = mine.mapped("invoice_date_due") + taken.mapped("date_maturity")
                overdue = max((today - due).days for due in dues)
                level = max((lvl for lvl, days in thresholds.items() if overdue >= days), default=None)
                if not level:
                    continue
                oldest_due = min(dues)
                already = self.search_count([
                    ("company_id", "=", company.id), ("partner_id", "=", partner.id), ("state", "!=", "cancelled"),
                    ("level", ">=", level), ("date", ">=", oldest_due),
                ])
                if already:
                    continue
                reminder = self.create({
                    "company_id": company.id, "partner_id": partner.id, "date": today, "level": level,
                    "days_overdue": overdue,
                    "amount_due": sum(mine.mapped("amount_residual")) + sum(taken.mapped("amount_residual")),
                    "invoice_ids": [(6, 0, mine.ids)], "line_ids": [(6, 0, taken.ids)],
                })
                created |= reminder
        return created

    @api.model
    def _cron_generate(self):
        reminders = self.generate()
        if self.env["ir.mail_server"].sudo().search_count([]):
            for reminder in reminders.filtered(lambda r: r.level in AUTO_SEND_LEVELS and r.partner_id.email):
                reminder.action_send("email")

    def _montant(self, amount):
        """Montant en GNF, pour la lettre en PDF."""
        return _gnf(amount)

    def pdf(self):
        """Lettre de relance en PDF, à la mise en page de la société (logo et couleurs de ses documents)."""
        self.ensure_one()
        content, _type = self.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "eguitra_finance.action_report_reminder", self.ids)
        return content

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
            "invoices": sorted([
                {"name": m.name, "date": m.invoice_date, "due": m.invoice_date_due, "total": m.amount_total,
                 "residual": m.amount_residual}
                for m in self.invoice_ids
            ] + [
                # Facture de l'ancien système : libellé de l'à-nouveau, sinon numéro de la pièce reprise.
                {"name": _taken_name(line), "date": line.date, "due": line.date_maturity,
                 "total": line.balance, "residual": line.amount_residual}
                for line in self.line_ids
            ], key=lambda i: (i["due"] or fields.Date.today(), i["name"] or "")),
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
                # Couleur des documents de la société (charte d'EGUITRA GROUP : vert empire) ; la lettre
                # en PDF, jointe, porte le logo (les images d'un courriel sont souvent bloquées).
                couleur = reminder.company_id.primary_color or "#373737"
                rows = Markup("").join(
                    Markup("<tr><td style='padding:6px;border-bottom:1px solid #dddddd'>{}</td>"
                           "<td style='padding:6px;border-bottom:1px solid #dddddd'>{}</td>"
                           "<td style='padding:6px;border-bottom:1px solid #dddddd;text-align:right'>{}</td></tr>").format(
                        i["name"], i["due"].strftime("%d/%m/%Y") if i["due"] else "", _gnf(i["residual"]))
                    for i in data["invoices"]
                )
                entete = Markup("<th style='padding:6px;text-align:{};background:{};color:#ffffff'>{}</th>")
                body = Markup(
                    "<div style='font-family:Arial,sans-serif;color:#373737;max-width:640px'>"
                    "<div style='background:{};color:#ffffff;padding:14px 18px;font-size:16px;font-weight:bold'>{}</div>"
                    "<div style='padding:18px'><p>Madame, Monsieur,</p><p>{}</p>"
                    "<table style='border-collapse:collapse;width:100%'><tr>{}{}{}</tr>{}</table>"
                    "<p>Total échu : <b style='color:{}'>{}</b></p><p>{}</p>"
                    "<p>La lettre de relance est jointe en PDF.</p><p>La Direction financière<br/>{}</p></div></div>"
                ).format(couleur, escape(data["company"]), data["intro"],
                         entete.format("left", couleur, "Facture"), entete.format("left", couleur, "Échéance"),
                         entete.format("right", couleur, "Reste dû"), rows, couleur, _gnf(data["amount_due"]),
                         data["closing"], escape(data["company"]))
                piece = self.env["ir.attachment"].sudo().create({
                    "name": f"Relance {reminder.partner_id.name} {reminder.date:%d-%m-%Y}.pdf", "type": "binary",
                    "datas": base64.b64encode(reminder.pdf()), "mimetype": "application/pdf",
                    "res_model": reminder._name, "res_id": reminder.id,
                })
                self.env["mail.mail"].sudo().create({
                    "subject": data["subject"], "body_html": body, "email_to": reminder.partner_id.email,
                    "email_from": reminder.company_id.email or False, "auto_delete": False,
                    "attachment_ids": [(6, 0, piece.ids)],
                }).send()
            reminder.write({"state": "sent", "channel": channel, "sent_at": fields.Datetime.now(),
                            "sent_by": self.env.user.id})
        return True
