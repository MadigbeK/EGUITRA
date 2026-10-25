"""Alcootests (spécification §4 V03, §9.4). Le résultat, la valeur mesurée, l'appareil, le motif d'un test
non réalisé, l'auteur et le retrait du conducteur ne sont lisibles que par le profil hsseq (champs réservés
à son groupe dans le noyau, détail servi par l'API à ce seul profil, chaque lecture journalisée) ; les
autres lisent un statut (conforme, non conforme, non réalisé), le conducteur seulement « fait » et l'heure.

Un positif retire le conducteur de la rotation : Transport doit en affecter un autre, qui refait un
alcootest ; V03 reste ouvert pour lui sur cette rotation, sans dérogation possible.

Données chiffrées au repos : non réalisé au lot 1 (dispositif de clé à valider, note de cadrage §5).
"""

from odoo import api, fields, models

from .common import BREATH_RESULTS, BREATH_STATUSES, HsseqError

DETAIL_GROUP = "eguitra_base.group_profile_hsseq"
# Champs du détail, réservés au profil hsseq (exclus aussi de la piste d'audit lue par l'administration).
DETAIL_FIELDS = ("performed", "result", "reading_mg_l", "device", "not_done_reason", "performed_by", "driver_removed",
                 "cancel_reason")


class EguitraHsseqBreathTest(models.Model):
    _name = "eguitra.hsseq.breath.test"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Alcootest HSSEQ"
    _order = "reported_at desc, id desc"
    _check_company_auto = True
    _journal_key = "breath_test"
    # Jamais le résultat ni la valeur : le journal est lu par la direction.
    _journal_fields = ("rotation_id", "driver_id")

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", check_company=True, index=True,
                                  ondelete="restrict", help="Vide : test saisi avant l'affectation, rattaché au départ.")
    driver_id = fields.Many2one("eguitra.transport.driver", "Conducteur", required=True, check_company=True,
                                index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", index=True)
    performed = fields.Boolean("Réalisé", groups=DETAIL_GROUP)
    result = fields.Selection(BREATH_RESULTS, "Résultat", groups=DETAIL_GROUP)
    reading_mg_l = fields.Float("Valeur mesurée (mg/l)", digits=(6, 3), groups=DETAIL_GROUP)
    device = fields.Char("Appareil", groups=DETAIL_GROUP)
    not_done_reason = fields.Char("Motif du test non réalisé", groups=DETAIL_GROUP)
    performed_by = fields.Many2one("res.users", "Réalisé par", groups=DETAIL_GROUP)
    driver_removed = fields.Boolean("Conducteur retiré de la rotation", groups=DETAIL_GROUP)
    # Annulation d'un test saisi par erreur (profil hsseq seul) : le test sort du verrou et des indicateurs.
    active = fields.Boolean(default=True)
    cancel_reason = fields.Text("Motif de l'annulation", groups=DETAIL_GROUP)
    cancelled_by = fields.Many2one("res.users", "Annulé par", groups=DETAIL_GROUP)
    cancelled_at = fields.Datetime("Annulé le", groups=DETAIL_GROUP)
    status = fields.Selection(BREATH_STATUSES, "Statut", compute="_compute_status", store=True, index=True)
    test_date = fields.Date("Jour du test", compute="_compute_test_date", store=True, index=True)
    client_uuid = fields.Char("Identifiant de saisie", copy=False, index=True)
    reported_at = fields.Datetime("Saisi le", required=True, default=fields.Datetime.now)
    synced_at = fields.Datetime("Reçu le", required=True, default=fields.Datetime.now, readonly=True)
    offline = fields.Boolean("Saisi hors ligne")

    _client_uuid_unique = models.Constraint("unique(client_uuid)", "Cet alcootest a déjà été reçu.")

    @api.depends("performed", "result")
    def _compute_status(self):
        for test in self.sudo():
            if not test.performed:
                test.status = "not_done"
            else:
                test.status = "non_compliant" if test.result == "positive" else "compliant"

    @api.depends("reported_at")
    def _compute_test_date(self):
        for test in self:
            test.test_date = fields.Datetime.context_timestamp(test, test.reported_at).date() if test.reported_at \
                else False

    @api.model
    def _hsseq_create(self, values):
        """Saisie d'un alcootest (en sudo, après contrôle des droits par l'appelant). Un positif retire le
        conducteur de la rotation encore saisie."""
        if values.get("performed") and values.get("result") not in dict(BREATH_RESULTS):
            raise HsseqError("missing_fields", "Résultat de l'alcootest réalisé manquant (negative ou positive).",
                             fields=["result"], status=400)
        if not values.get("performed") and not (values.get("not_done_reason") or "").strip():
            raise HsseqError("missing_fields", "Motif de l'alcootest non réalisé manquant.",
                             fields=["not_done_reason"], status=400)
        rotation = self.env["eguitra.transport.rotation"].sudo().browse(values.get("rotation_id") or [])
        site = rotation.vehicle_id.site_id or self.env["eguitra.transport.vehicle"].sudo().search(
            [("driver_id", "=", values["driver_id"]), ("site_id", "!=", False)], limit=1).site_id
        test = self.sudo().create(dict(values, performed_by=self.env.uid, site_id=site.id or False))
        if rotation:
            test._remove_driver(rotation)
        return test

    def _remove_driver(self, rotation):
        """Positif : le conducteur est retiré de la rotation encore saisie (Transport en affecte un autre)."""
        test = self.sudo()
        if test.status != "non_compliant":
            return
        test.driver_removed = True
        if rotation.state == "draft" and rotation.driver_id == test.driver_id:
            rotation.sudo().write({"driver_id": False})
            test._journal("driver_removed", note=f"Conducteur retiré de la rotation {rotation.name}")

    def _attach_rotation(self, rotation):
        """Test saisi sans rotation, rattaché à la rotation de son conducteur (au départ)."""
        for test in self.sudo():
            test.write({"rotation_id": rotation.id, "site_id": rotation.vehicle_id.site_id.id or test.site_id.id})
            test._journal("attach", note=f"Rattaché à la rotation {rotation.name}")
            test._remove_driver(rotation)

    def action_cancel(self, reason):
        """Annulation d'un test saisi par erreur, avec motif ; le conducteur retiré par un positif est rétabli
        sur la rotation encore saisie (si elle n'en a pas reçu un autre)."""
        self.ensure_one()
        test = self.sudo()
        if not test.active:
            raise HsseqError("invalid_transition", "Cet alcootest est déjà annulé.")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de l'annulation est obligatoire.", fields=["reason"])
        before = test.status
        test.write({"active": False, "cancel_reason": reason.strip(), "cancelled_by": self.env.uid,
                    "cancelled_at": fields.Datetime.now()})
        test._journal("cancel", field="status", old=before, new="cancelled", note=reason.strip())
        rotation = test.rotation_id
        if test.driver_removed and rotation and rotation.state == "draft" and not rotation.driver_id:
            rotation.write({"driver_id": test.driver_id.id})
            test._journal("driver_restored", note=f"Conducteur rétabli sur la rotation {rotation.name}")
        return True

    def _done(self):
        self.ensure_one()
        return self.status != "not_done"
