"""Journal HSSEQ (spécification §7 « JournalHSSEQ », §11 traçabilité) : création, modification champ par
champ (valeur avant et après), transitions, notifications, lecture du détail d'un alcootest, évaluations du
verrou. Il double la piste d'audit de la plateforme (auditlog, posée par post_init_hook) pour les écrans :
historique d'une fiche et GET /hsseq/log. Écrit en sudo, jamais modifié ; lu par hsseq et la direction."""

from odoo import api, fields, models


class EguitraHsseqJournal(models.Model):
    _name = "eguitra.hsseq.journal"
    _description = "Journal HSSEQ"
    _order = "at desc, id desc"

    model = fields.Char("Fiche", required=True, index=True, help="Clé de l'API : event, action, check, breath_test…")
    res_id = fields.Integer("Identifiant", required=True, index=True)
    action = fields.Char("Opération", required=True, help="create, write, une transition, read_detail, notify…")
    field = fields.Char("Champ")
    old_value = fields.Text("Valeur avant")
    new_value = fields.Text("Valeur après")
    note = fields.Text("Précision")
    user_id = fields.Many2one("res.users", "Par", default=lambda self: self.env.uid, index=True)
    at = fields.Datetime("Le", default=fields.Datetime.now, required=True, index=True)
    company_id = fields.Many2one("res.company", index=True)

    @api.model
    def _log(self, model, record, action, note=None, field=None, old=None, new=None):
        return self.sudo().create({
            "model": model, "res_id": record.id, "action": action, "note": note or False, "field": field or False,
            "old_value": old if old not in (None, False) else False,
            "new_value": new if new not in (None, False) else False,
            "company_id": record.company_id.id if "company_id" in record._fields else False,
            "user_id": self.env.uid,
        })


class EguitraHsseqJournaled(models.AbstractModel):
    """Fiche journalisée : création et modification des champs de _journal_fields, avec les valeurs avant et
    après. Les champs sensibles (résultat d'un alcootest) n'y figurent jamais."""

    _name = "eguitra.hsseq.journaled"
    _description = "Fiche HSSEQ journalisée"
    _journal_key = None
    _journal_fields = ()

    def _journal_value(self, name):
        field = self._fields[name]
        value = self.sudo()[name]
        if field.type == "many2one":
            return value.display_name or ""
        if field.type in ("many2many", "one2many"):
            return ", ".join(value.mapped("display_name"))
        if value in (False, None):
            return ""
        return str(value)

    def _journal(self, action, note=None, field=None, old=None, new=None):
        Journal = self.env["eguitra.hsseq.journal"]
        for record in self:
            Journal._log(self._journal_key, record, action, note=note, field=field, old=old, new=new)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._journal("create")
        return records

    def write(self, vals):
        tracked = [name for name in self._journal_fields if name in vals]
        before = {rec.id: {name: rec._journal_value(name) for name in tracked} for rec in self} if tracked else {}
        result = super().write(vals)
        if tracked:
            rows = []
            for rec in self:
                for name in tracked:
                    old, new = before[rec.id][name], rec._journal_value(name)
                    if old != new:
                        rows.append({"model": rec._journal_key, "res_id": rec.id, "action": "write", "field": name,
                                     "old_value": old or False, "new_value": new or False,
                                     "company_id": rec.company_id.id, "user_id": self.env.uid})
            if rows:
                self.env["eguitra.hsseq.journal"].sudo().create(rows)
        return result
