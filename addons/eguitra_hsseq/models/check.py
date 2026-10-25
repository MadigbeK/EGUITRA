"""Contrôles avant départ (spécification §5) : grilles paramétrables par nature et par type de véhicule
(citerne, benne), points bloquants ou non ; contrôle saisi sur NIMOVA Terrain (hors ligne possible),
réponse conforme, non conforme ou sans objet par point ; chaque non-conformité est suivie jusqu'à sa
levée par le chef de parc (photo de la correction obligatoire).

Une grille garde sa version : toute modification (grille ou points) l'incrémente, et un contrôle garde les
libellés et le caractère bloquant de la version sur laquelle il a été saisi. Un point déjà répondu ne se
supprime pas, il s'archive. Le point « alcootest du conducteur négatif » (linked_to = breath_test) ne se
répond pas dans le contrôle : il relève du formulaire d'alcootest et du motif V03 (confidentialité §9.4).

Le contrôle est accepté sans ses photos, qui suivent par /hsseq/attachments rattachées à chaque
non-conformité : photos_missing tant qu'il en manque une. Une non-conformité bloquante compte pour V02 avec
ou sans photo, d'une rotation à l'autre, tant qu'elle n'est pas levée.
"""

from odoo import api, fields, models

from .common import ANSWERS, CHECK_KINDS, CHECK_RESULTS, NONCONFORMITY_STATUSES, VEHICLE_KINDS, HsseqError, vehicle_kind

LINKS = [("breath_test", "Formulaire d'alcootest")]


class EguitraHsseqCheckTemplate(models.Model):
    _name = "eguitra.hsseq.check.template"
    _description = "Grille de contrôle HSSEQ"
    _order = "kind, vehicle_kind, name"

    name = fields.Char("Grille", required=True)
    kind = fields.Selection(CHECK_KINDS, "Nature", required=True, default="pre_departure")
    vehicle_kind = fields.Selection(VEHICLE_KINDS, "Type de véhicule", required=True)
    version = fields.Integer("Version", default=1, readonly=True)
    active = fields.Boolean(default=True)
    item_ids = fields.One2many("eguitra.hsseq.check.item", "template_id", "Points",
                               context={"active_test": False})

    def write(self, vals):
        result = super().write(vals)
        if set(vals) - {"version"}:
            self._bump_version()
        return result

    def _bump_version(self):
        """Nouvelle version de la grille (une par modification ; hsseq_no_bump : le chargement des données
        initiales, ou l'appelant qui regroupe plusieurs modifications en une version)."""
        if self.env.context.get("hsseq_no_bump"):
            return
        for template in self:
            template.with_context(hsseq_no_bump=True).write({"version": template.version + 1})

    def _items(self, active_only=True):
        self.ensure_one()
        items = self.with_context(active_test=False).item_ids
        return (items.filtered("active") if active_only else items).sorted(lambda i: (i.sequence, i.id))

    def _answerable_items(self):
        return self._items().filtered(lambda i: not i.linked_to)

    def _version_items(self, version):
        """Points à répondre de la version donnée de la grille (y compris ceux retirés depuis)."""
        self.ensure_one()
        return self._items(active_only=False).filtered(lambda i: not i.linked_to and i._in_version(version))


class EguitraHsseqCheckItem(models.Model):
    _name = "eguitra.hsseq.check.item"
    _description = "Point d'une grille de contrôle HSSEQ"
    _order = "template_id, sequence, id"

    template_id = fields.Many2one("eguitra.hsseq.check.template", required=True, ondelete="cascade", index=True)
    label = fields.Char("Point", required=True)
    blocking = fields.Boolean("Bloquant", help="Point critique : non conforme, il bloque le départ (V02).")
    sequence = fields.Integer("Ordre", default=10)
    linked_to = fields.Selection(LINKS, "Relié à", help="Point qui ne se répond pas dans le contrôle.")
    active = fields.Boolean(default=True)
    since_version = fields.Integer("Dans la grille depuis la version", default=1)
    retired_version = fields.Integer("Retiré de la grille à la version", help="0 : toujours dans la grille.")

    def _in_version(self, version):
        self.ensure_one()
        return self.since_version <= version and (not self.retired_version or self.retired_version > version)

    @api.model_create_multi
    def create(self, vals_list):
        Template = self.env["eguitra.hsseq.check.template"]
        if not self.env.context.get("hsseq_no_bump"):
            for vals in vals_list:
                if vals.get("template_id") and "since_version" not in vals:
                    vals["since_version"] = Template.browse(vals["template_id"]).version + 1
        items = super().create(vals_list)
        items.template_id._bump_version()
        return items

    def write(self, vals):
        """Archivé, un point sort de la version suivante de la grille ; réactivé, il y revient (sauf version
        fixée par l'appelant, qui regroupe ses modifications en une version)."""
        automatic = "active" in vals and not self.env.context.get("hsseq_no_bump")
        if automatic and not {"since_version", "retired_version"} & set(vals):
            for item in self:
                if bool(vals["active"]) == item.active:
                    continue
                following = item.template_id.version + 1
                if vals["active"]:
                    extra = {"retired_version": 0, "since_version": following}
                else:
                    extra = {"retired_version": following}
                super(EguitraHsseqCheckItem, item).write(extra)
        result = super().write(vals)
        self.template_id._bump_version()
        return result

    def unlink(self):
        """Un point déjà répondu s'archive (les contrôles passés gardent leur libellé)."""
        used = self.env["eguitra.hsseq.check.answer"].sudo().search([("item_id", "in", self.ids)]).item_id
        templates = self.template_id
        used.write({"active": False})
        result = super(EguitraHsseqCheckItem, self - used).unlink()
        templates.exists()._bump_version()
        return result


class EguitraHsseqCheck(models.Model):
    _name = "eguitra.hsseq.check"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Contrôle avant départ HSSEQ"
    _order = "reported_at desc, id desc"
    _check_company_auto = True
    _journal_key = "check"
    _journal_fields = ("result",)

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    template_id = fields.Many2one("eguitra.hsseq.check.template", "Grille", required=True, ondelete="restrict")
    template_version = fields.Integer("Version de la grille")
    kind = fields.Selection(related="template_id.kind", store=True)
    vehicle_kind = fields.Selection(VEHICLE_KINDS, "Type de véhicule")
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", required=True, check_company=True,
                                 index=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", check_company=True, index=True)
    driver_id = fields.Many2one("eguitra.transport.driver", "Conducteur", check_company=True, index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True)
    author_id = fields.Many2one("res.users", "Contrôlé par", required=True, default=lambda self: self.env.uid,
                                index=True)
    client_uuid = fields.Char("Identifiant de saisie", copy=False, index=True)
    reported_at = fields.Datetime("Saisi le", required=True, default=fields.Datetime.now, index=True)
    synced_at = fields.Datetime("Reçu le", required=True, default=fields.Datetime.now, readonly=True)
    offline = fields.Boolean("Saisi hors ligne")
    duration_s = fields.Integer("Durée de saisie (s)")
    latitude = fields.Float("Latitude", digits=(10, 6))
    longitude = fields.Float("Longitude", digits=(10, 6))
    gps_accuracy = fields.Float("Précision de la position (m)", digits=(8, 1))
    answer_ids = fields.One2many("eguitra.hsseq.check.answer", "check_id", "Réponses")
    nonconformity_ids = fields.One2many("eguitra.hsseq.nonconformity", "check_id", "Non-conformités")
    result = fields.Selection(CHECK_RESULTS, "Résultat", compute="_compute_result", store=True, index=True)

    _client_uuid_unique = models.Constraint("unique(client_uuid)", "Ce contrôle a déjà été reçu.")

    @api.depends("answer_ids.answer", "answer_ids.blocking")
    def _compute_result(self):
        for check in self:
            failed = check.answer_ids.filtered(lambda a: a.answer == "not_ok")
            if failed.filtered("blocking"):
                check.result = "blocking"
            elif failed:
                check.result = "non_compliant"
            else:
                check.result = "compliant"

    @api.model
    def _hsseq_create(self, values, answers):
        """Contrôle et ses réponses : chaque point de la grille (hors point relié à l'alcootest) a sa réponse,
        sinon incomplete_answers ; grille du type du véhicule, sinon vehicle_kind_mismatch. Chaque réponse non
        conforme ouvre une non-conformité."""
        template = self.env["eguitra.hsseq.check.template"].sudo().browse(values["template_id"])
        vehicle = self.env["eguitra.transport.vehicle"].sudo().browse(values["vehicle_id"])
        kind = vehicle_kind(vehicle)
        if template.vehicle_kind != kind:
            raise HsseqError("vehicle_kind_mismatch", f"La grille « {template.name} » vaut pour un autre type de "
                                                      f"véhicule que {vehicle.name}.", fields=["template_id"])
        version = values.get("template_version") or template.version
        if not 1 <= version <= template.version:
            raise HsseqError("invalid_parameter", f"Version {version} inconnue pour la grille « {template.name} ».",
                             fields=["template_version"], status=400)
        # Saisie hors ligne sur une version plus ancienne : seuls les points de cette version sont exigés ; un
        # point retiré depuis reste accepté, un point ajouté depuis est noté « non évalué ».
        items = template._version_items(version)
        by_id = {item.id: item for item in template._items(active_only=False)}
        given = {}
        for answer in answers:
            item = by_id.get(answer["item_id"])
            if not item:
                raise HsseqError("invalid_parameter", f"Point {answer['item_id']} absent de la grille.",
                                 fields=["answers"], status=400)
            if item.linked_to:
                continue  # répondu par son propre formulaire
            given[item.id] = answer
        missing = [item.id for item in items if item.id not in given]
        if missing:
            raise HsseqError("incomplete_answers", "Chaque point de la grille attend sa réponse.", fields=missing)
        later = template._answerable_items().filtered(lambda i: i.id not in given and i not in items)
        check = self.sudo().create(dict(values, template_version=version, vehicle_kind=kind,
                                        site_id=values.get("site_id") or vehicle.site_id.id))
        Answer = self.env["eguitra.hsseq.check.answer"].sudo()
        for item_id, answer in given.items():
            item = by_id[item_id]
            row = Answer.create({"check_id": check.id, "item_id": item.id, "label": item.label,
                                 "blocking": item.blocking, "sequence": item.sequence, "answer": answer["answer"],
                                 "comment": answer.get("comment") or False})
            if row.answer == "not_ok":
                self.env["eguitra.hsseq.nonconformity"].sudo().create({
                    "check_id": check.id, "answer_id": row.id, "item_id": item.id, "label": item.label,
                    "blocking": item.blocking, "comment": row.comment, "found_at": check.reported_at})
        for item in later:
            Answer.create({"check_id": check.id, "item_id": item.id, "label": item.label, "blocking": item.blocking,
                           "sequence": item.sequence, "answer": "not_evaluated"})
        check.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.check") or "/"
        return check

    def _photos_missing(self):
        self.ensure_one()
        return any(nc._photos_missing() for nc in self.nonconformity_ids)


class EguitraHsseqCheckAnswer(models.Model):
    _name = "eguitra.hsseq.check.answer"
    _description = "Réponse d'un contrôle HSSEQ"
    _order = "check_id, sequence, id"

    check_id = fields.Many2one("eguitra.hsseq.check", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="check_id.company_id", store=True, index=True)
    item_id = fields.Many2one("eguitra.hsseq.check.item", "Point", required=True, ondelete="restrict", index=True)
    label = fields.Char("Point (libellé de la version saisie)", required=True)
    blocking = fields.Boolean("Bloquant")
    sequence = fields.Integer("Ordre")
    answer = fields.Selection(ANSWERS, "Réponse", required=True)
    comment = fields.Text("Commentaire")


class EguitraHsseqNonconformity(models.Model):
    _name = "eguitra.hsseq.nonconformity"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Non-conformité d'un contrôle HSSEQ"
    _order = "found_at desc, id desc"
    _journal_key = "nonconformity"
    _journal_fields = ("status", "lift_comment")

    check_id = fields.Many2one("eguitra.hsseq.check", "Contrôle", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="check_id.company_id", store=True, index=True)
    answer_id = fields.Many2one("eguitra.hsseq.check.answer", ondelete="cascade")
    item_id = fields.Many2one("eguitra.hsseq.check.item", "Point", ondelete="restrict")
    label = fields.Char("Point", required=True)
    blocking = fields.Boolean("Bloquant", index=True)
    vehicle_id = fields.Many2one(related="check_id.vehicle_id", store=True, index=True)
    rotation_id = fields.Many2one(related="check_id.rotation_id", store=True, index=True)
    site_id = fields.Many2one(related="check_id.site_id", store=True, index=True)
    found_at = fields.Datetime("Constatée le", required=True, default=fields.Datetime.now)
    comment = fields.Text("Commentaire")
    status = fields.Selection(NONCONFORMITY_STATUSES, "Statut", required=True, default="open", index=True)
    lifted_at = fields.Datetime("Levée le", readonly=True)
    lifted_by = fields.Many2one("res.users", "Levée par", readonly=True)
    lift_comment = fields.Text("Correction")
    action_id = fields.Many2one("eguitra.hsseq.action", "Action corrective", ondelete="set null")

    def _photos(self):
        return self.env["eguitra.hsseq.attachment"]._for("nonconformity", self, role="photo")

    def _lift_photos(self):
        return self.env["eguitra.hsseq.attachment"]._for("nonconformity", self, role="lift")

    def _photos_missing(self):
        """Non-conformité ouverte sans aucune photo rattachée."""
        self.ensure_one()
        return self.status == "open" and not self.env["eguitra.hsseq.attachment"]._for("nonconformity", self)

    def action_lift(self, comment, attachments):
        """Levée après correction : au moins une photo de la correction, déposée sur la non-conformité."""
        self.ensure_one()
        if self.status != "open":
            raise HsseqError("invalid_transition", "Cette non-conformité est déjà levée.")
        foreign = attachments.filtered(lambda a: a.object != "nonconformity" or a.res_id != self.id)
        if foreign:
            raise HsseqError("invalid_parameter", "Photo d'une autre fiche.", fields=["attachment_ids"], status=400)
        photos = attachments.filtered(lambda a: (a.mimetype or "").startswith("image/"))
        if not photos:
            raise HsseqError("photo_missing", "La levée exige au moins une photo de la correction, déposée sur la "
                                              "non-conformité.", fields=["attachment_ids"])
        attachments.sudo().write({"role": "lift"})
        self.write({"status": "lifted", "lifted_at": fields.Datetime.now(), "lifted_by": self.env.uid,
                    "lift_comment": (comment or "").strip() or False})
        self._journal("lift")
        return True
