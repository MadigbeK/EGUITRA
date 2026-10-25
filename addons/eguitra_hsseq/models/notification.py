"""Notifications d'HSSEQ, dans l'application et par courriel (spécification §9.1, §11 ; pas de SMS au lot 1) :
déclaration d'un événement, criticité significative ou élevée au classement, dérogation demandée ou
activée, relances et escalade des actions. Le courriel part par la file d'envoi du noyau (serveur de
courrier de la plateforme, infra/mail-server.sh) ; la notification dans l'application reste lisible par
GET /hsseq/notifications."""

from markupsafe import Markup, escape

from odoo import api, fields, models

from .common import NOTIFICATION_CHANNELS


class EguitraHsseqNotification(models.Model):
    _name = "eguitra.hsseq.notification"
    _description = "Notification HSSEQ"
    _order = "create_date desc, id desc"

    user_id = fields.Many2one("res.users", "Destinataire", required=True, index=True, ondelete="cascade")
    channel = fields.Selection(NOTIFICATION_CHANNELS, "Canal", required=True, default="app")
    kind = fields.Char("Nature", required=True, help="reported, high, significant, waiver_requested, waiver_active…")
    subject = fields.Char("Objet", required=True)
    body = fields.Text("Message")
    model = fields.Char("Fiche", index=True)
    res_id = fields.Integer("Identifiant", index=True)
    company_id = fields.Many2one("res.company", index=True)
    read_at = fields.Datetime("Lue le")
    mail_id = fields.Many2one("mail.mail", "Courriel", ondelete="set null")

    @api.model
    def _notify(self, users, kind, subject, body, record, model_key):
        """Notifie chaque destinataire dans l'application, et par courriel s'il a une adresse."""
        users = users.filtered(lambda u: u.active and not u.share)
        if not users:
            return self.browse()
        company = record.company_id if "company_id" in record._fields else self.env.company
        rows = []
        for user in users:
            base = {"user_id": user.id, "kind": kind, "subject": subject, "body": body, "model": model_key,
                    "res_id": record.id, "company_id": company.id}
            rows.append(dict(base, channel="app"))
            if user.email:
                html = Markup("<div style='font-family:Arial,sans-serif;color:#1d2320;max-width:640px'>"
                              "<p style='font-size:15px;font-weight:bold'>{}</p><p>{}</p>"
                              "<p style='color:#5b6662;font-size:12px'>NIMOVA · HSSEQ, {}</p></div>").format(
                    subject, escape(body or "").replace("\n", Markup("<br/>")), company.name)
                mail = self.env["mail.mail"].sudo().create({
                    "subject": f"[HSSEQ] {subject}", "body_html": html, "email_to": user.email,
                    "email_from": company.email or False, "auto_delete": True,
                })
                rows.append(dict(base, channel="email", mail_id=mail.id))
        notifications = self.sudo().create(rows)
        self.env["eguitra.hsseq.journal"]._log(model_key, record, "notify", note=f"{kind} : {', '.join(users.mapped('name'))}")
        return notifications

    def _row(self):
        return {"id": self.id, "kind": self.kind, "channel": self.channel, "subject": self.subject,
                "body": self.body or None, "model": self.model or None, "res_id": self.res_id or None,
                "to": {"id": self.user_id.id, "name": self.user_id.name}, "sent_at": self.create_date,
                "read_at": self.read_at or None}

    @api.model
    def _for(self, model_key, record):
        return self.sudo().search([("model", "=", model_key), ("res_id", "=", record.id)])
