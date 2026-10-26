"""Verrou de départ (spécification §4) : aucune rotation ne passe « en route » tant qu'un motif de sécurité
bloquant reste ouvert. L'évaluation vit dans le noyau : Transport l'appelle par ses crochets
(_departure_blockers avant le départ, _departure_waived pour la trace, _validation_blockers avant la
validation), quel que soit le client (écran, téléphone, appel direct).

Motifs du lot 1, activables par type de véhicule et par site (eguitra.hsseq.lock.reason) :
- V01 aucun contrôle avant départ pour la rotation (et son ensemble), ou seulement un contrôle incomplet
  (point bloquant ajouté à la grille après la saisie, en attente d'un contrôle complémentaire) ;
- V02 une non-conformité d'un point bloquant encore ouverte sur l'ensemble, d'une rotation à l'autre ;
- V03 alcootest du conducteur de la rotation absent, non réalisé ou positif (un positif le retire de la
  rotation ; V03 reste alors ouvert pour lui) ;
- V04 statut RH du conducteur (eguitra_rh) : habilitation exigée pour le profil de l'ensemble de la
  rotation (eguitra.hsseq.qualification.rule, à défaut l'obligation de RH) expirée, aptitude inapte ou
  échue ; habilitation absente ou chauffeur sans dossier salarié selon les dates de mise en service des
  paramètres (avant : avertissement) ;
- V05 assurance ou visite technique expirée (Transport, _expired_documents) ; absente selon la date de mise
  en service des documents (avant : avertissement).
Motifs du lot 2, livrés désactivés (hsseq ou admin les activent par type de véhicule et par site) :
- V06 barémage ou certificat d'étanchéité expiré, ou absent selon la date de mise en service des
  documents (citernes seulement) ;
- V07 charge pesée au-delà de la charge utile (bennes seulement, _overload de Transport), levé par une
  nouvelle pesée après délestage ;
- V08 plan de trajet absent ou non validé, conduite de nuit prévue sur une route interdite de nuit ou
  conduite prévue au-delà du maximum journalier (eguitra.hsseq.journey) ;
- V09 véhicule immobilisé par un événement en cours d'enquête (eguitra.hsseq.immobilization).
V01 et V03 ne sont jamais dérogeables, V02 et V04 à V09 le sont ; une dérogation active couvre son motif
pour la rotation.

Le verrou s'applique aux rotations chargées à partir de la date de mise en service des paramètres
(lock_start_date) ; ces rotations ne se valident qu'après leur passage « en route » (motif H01).
Format d'un motif : {code, label, source, since, waivable, severity}, plus detail, resolution, pending
(« pas encore fait » : V01, V03 non réalisé) et waiver_id dans l'évaluation d'HSSEQ.
"""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.eguitra_transport.blocking import motif

from .common import EXPLOITATION_GROUP, VEHICLE_KINDS, day_start, today, vehicle_kind
from .waiver import NOT_WAIVABLE, ROTATION_ENDED

V05_KINDS = ("insurance", "inspection")
V06_KINDS = ("calibration", "tightness")
# Lot en service : les motifs des lots suivants ne s'évaluent ni ne s'activent.
CURRENT_LOT = 2
DOCUMENT_LABELS = {"insurance": "assurance", "inspection": "visite technique", "calibration": "barémage",
                   "tightness": "certificat d'étanchéité"}


class EguitraHsseqLockReason(models.Model):
    _name = "eguitra.hsseq.lock.reason"
    _description = "Motif du verrou de départ"
    _order = "code"

    code = fields.Char("Code", required=True, index=True)
    name = fields.Char("Motif", required=True)
    source = fields.Char("Source de la donnée", required=True)
    resolution = fields.Char("Levée")
    waivable = fields.Boolean("Dérogeable", default=True)
    lot = fields.Integer("Lot", default=1)
    enabled = fields.Boolean("Actif", default=True)
    tanker = fields.Boolean("Citernes", default=True)
    tipper = fields.Boolean("Bennes", default=True)
    disabled_site_ids = fields.Many2many("eguitra.hsseq.site", "eguitra_hsseq_lock_reason_site_rel", "reason_id",
                                         "site_id", "Sites où le motif est désactivé")

    _code_unique = models.Constraint("unique(code)", "Ce motif existe déjà.")

    def _vehicle_kinds(self):
        self.ensure_one()
        return [kind for kind, _label in VEHICLE_KINDS if self[kind]]

    def _applies(self, kind, site):
        self.ensure_one()
        return bool(self.enabled and self.lot <= CURRENT_LOT and self[kind]
                    and not (site and site in self.disabled_site_ids))

    @api.model
    def _settings_map(self):
        return {r.code: r for r in self.sudo().search([])}


class EguitraHsseqLockLog(models.Model):
    _name = "eguitra.hsseq.lock.log"
    _description = "Évaluation du verrou de départ"
    _order = "id desc"

    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", required=True, index=True,
                                  ondelete="cascade")
    company_id = fields.Many2one(related="rotation_id.company_id", store=True, index=True)
    user_id = fields.Many2one("res.users", "Par", default=lambda self: self.env.uid)
    at = fields.Datetime("Le", default=fields.Datetime.now)
    allowed = fields.Boolean("Départ autorisé")
    lock_active = fields.Boolean("Verrou en service")
    codes = fields.Char("Motifs ouverts")
    waived = fields.Char("Motifs dérogés")


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    hsseq_waiver_ids = fields.One2many("eguitra.hsseq.waiver", "rotation_id", "Dérogations HSSEQ")

    # ─── Évaluation ───────────────────────────────────────────────────────

    def _hsseq_settings(self):
        self.ensure_one()
        return self.env["eguitra.hsseq.settings"]._get(self.company_id)

    def _hsseq_lock_active(self):
        """Le verrou vaut pour une rotation chargée à partir de sa mise en service (paramètres de la société)."""
        self.ensure_one()
        start = self._hsseq_settings().lock_start_date
        return bool(start and self.date_loading and self.date_loading >= start)

    def _hsseq_day(self):
        """Jour d'évaluation : la date de chargement, sinon aujourd'hui si elle est passée."""
        self.ensure_one()
        return max(today(self.env), self.date_loading or today(self.env))

    def _hsseq_reasons(self, apply_waivers=True, detail=True, attach=False):
        """Motifs HSSEQ de la rotation : {"reasons": motifs bloquants, "warnings": avertissements, "waived":
        motifs couverts par une dérogation active}. detail=False : le détail de V03 est retiré (hors hsseq).

        Un contrôle ou un alcootest saisi sans rotation, dans la fenêtre des paramètres, compte pour la
        rotation de son ensemble ou de son conducteur ; attach=True (évaluation demandée, départ) l'y
        rattache, et il ne compte plus pour une autre rotation."""
        self.ensure_one()
        rot = self.sudo()
        day = rot._hsseq_day()
        kind = vehicle_kind(rot.vehicle_id)
        site = rot.vehicle_id.site_id
        settings = rot._hsseq_settings()
        config = self.env["eguitra.hsseq.lock.reason"]._settings_map()
        reasons, warnings = [], []

        def add(code, since=None, info=None, pending=False, severity="block"):
            conf = config.get(code)
            if not conf or not conf._applies(kind, site):
                return
            entry = dict(motif(code, conf.name, conf.source, since=since, waivable=conf.waivable and code not in NOT_WAIVABLE,
                               severity=severity),
                         detail=info, resolution=conf.resolution or None, pending=pending, waiver_id=None)
            (reasons if severity == "block" else warnings).append(entry)

        # V01 : contrôle avant départ de la rotation, pour son ensemble (ou contrôle récent sans rotation). Un
        # contrôle dont un point bloquant reste non évalué (ajouté à la grille après la saisie) ne le lève pas
        # tant qu'un contrôle complémentaire n'y a pas répondu : V01 reste « à faire ».
        Check = self.env["eguitra.hsseq.check"].sudo()
        checks = Check.search([("rotation_id", "=", rot.id), ("vehicle_id", "=", rot.vehicle_id.id),
                               ("kind", "=", "pre_departure"), ("complement_of_id", "=", False)],
                              order="reported_at desc, id desc")
        if not checks:
            checks = rot._hsseq_recent_check(settings)
            if checks and attach:
                checks._attach_rotation(rot)
        if not checks:
            add("V01", since=rot.create_date, pending=True)
        elif all(c._pending_answers() for c in checks):
            pending = checks[0]._pending_answers()
            add("V01", since=checks[0].reported_at, pending=True,
                info=f"Contrôle {checks[0].reference} incomplet : contrôle complémentaire attendu sur "
                     f"{', '.join(pending.mapped('label'))} (points bloquants ajoutés à la grille après la saisie).")
        # V02 : non-conformité bloquante ouverte sur l'ensemble, d'une rotation à l'autre.
        open_ncs = self.env["eguitra.hsseq.nonconformity"].sudo().search([
            ("vehicle_id", "=", rot.vehicle_id.id), ("blocking", "=", True), ("status", "=", "open")],
            order="found_at")
        if open_ncs:
            add("V02", since=open_ncs[0].found_at, info=", ".join(dict.fromkeys(open_ncs.mapped("label"))))
        # V03 : alcootest du conducteur de la rotation.
        rot._hsseq_v03(add, settings, attach)
        # V04 : statut RH du conducteur (habilitations, aptitude, dossier salarié).
        if rot.driver_id:
            rot._hsseq_v04(add, day, settings)
        # V05 : documents du véhicule (Transport).
        rot._hsseq_v05(add, day, settings)
        # V06 : barémage et étanchéité de la citerne (Transport).
        rot._hsseq_v06(add, day, settings)
        # V07 : charge pesée au-delà de la charge utile (benne).
        rot._hsseq_v07(add)
        # V08 : plan de trajet.
        rot._hsseq_v08(add, settings)
        # V09 : véhicule immobilisé par un événement en cours d'enquête.
        rot._hsseq_v09(add)

        waived = []
        if apply_waivers:
            waivers = rot.hsseq_waiver_ids._refresh().filtered(lambda w: w.status == "active")
            by_code = {w.reason_code: w for w in waivers}
            for entry in list(reasons):
                waiver = by_code.get(entry["code"])
                if waiver and entry["waivable"]:
                    entry["waiver_id"] = waiver.id
                    waived.append(entry)
        if not detail:
            for entry in reasons + warnings:
                if entry["code"] == "V03":
                    entry["detail"] = None
        return {"reasons": reasons, "warnings": warnings, "waived": waived}

    def _hsseq_recent_check(self, settings):
        """Contrôle avant départ de l'ensemble saisi sans rotation dans la fenêtre des paramètres : le plus
        récent qui soit complet, sinon le plus récent."""
        since = fields.Datetime.now() - timedelta(hours=settings.check_window_hours or 0)
        checks = self.env["eguitra.hsseq.check"].sudo().search([
            ("rotation_id", "=", False), ("vehicle_id", "=", self.vehicle_id.id), ("kind", "=", "pre_departure"),
            ("complement_of_id", "=", False), ("reported_at", ">=", since)], order="reported_at desc, id desc")
        return checks.filtered(lambda c: not c._pending_answers())[:1] or checks[:1]

    def _hsseq_recent_tests(self, driver, settings):
        """Alcootest du conducteur saisi sans rotation dans la fenêtre : le plus récent, ou un positif s'il y
        en a un (un test négatif ultérieur n'efface pas un positif)."""
        since = fields.Datetime.now() - timedelta(hours=settings.breath_test_window_hours or 0)
        tests = self.env["eguitra.hsseq.breath.test"].sudo().search([
            ("rotation_id", "=", False), ("driver_id", "=", driver.id), ("reported_at", ">=", since)],
            order="reported_at desc, id desc")
        return tests.filtered(lambda t: t.status == "non_compliant")[:1] or tests[:1]

    def _hsseq_v03(self, add, settings, attach=False):
        Test = self.env["eguitra.hsseq.breath.test"].sudo()
        driver = self.driver_id
        if not driver:
            removed = Test.search([("rotation_id", "=", self.id), ("status", "=", "non_compliant")],
                                  order="reported_at desc", limit=1)
            if removed:
                add("V03", since=removed.reported_at, info="Alcootest positif : conducteur retiré, à remplacer.")
            else:
                add("V03", since=self.create_date, info="Aucun conducteur affecté à la rotation.", pending=True)
            return
        tests = Test.search([("rotation_id", "=", self.id), ("driver_id", "=", driver.id)],
                            order="reported_at desc, id desc")
        if not tests:
            tests = self._hsseq_recent_tests(driver, settings)
            if tests and attach:
                tests._attach_rotation(self)
        positive = tests.filtered(lambda t: t.status == "non_compliant")[:1]
        if positive:
            add("V03", since=positive.reported_at, info="Alcootest positif : conducteur retiré de la rotation.")
        elif not tests:
            add("V03", since=self.create_date, info="Alcootest non réalisé.", pending=True)
        elif tests[0].status == "not_done":
            add("V03", since=tests[0].reported_at, info="Alcootest non réalisé.", pending=True)

    def _hsseq_v04(self, add, day, settings):
        Employee = self.env["eguitra.rh.employee"].sudo()
        status = Employee._hsseq_driver_status(self.driver_id, day)
        if not status["employee_id"]:
            text = f"{self.driver_id.name} : aucun dossier salarié en cours n'est lié à ce chauffeur."
            severity = "block" if settings._required_from("employee_file_required_from", day) else "warn"
            add("V04", info=text, severity=severity)
            return
        blocking, warning, since = [], list(status.get("warnings") or []), None
        employee = Employee.browse(status["employee_id"])
        if employee._fitness_state(day) in ("inapte", "echue"):
            # Statut seul, sans motif médical.
            blocking.append("Aptitude médicale non valable.")
        for row in employee._hsseq_obligations(day, vehicle_kind(self.vehicle_id)):
            if row["state"] == "expiree":
                blocking.append(f"{row['name']} : expirée.")
                if row["expiry"] and (since is None or row["expiry"] < since):
                    since = row["expiry"]
            elif row["state"] == "absente":
                text = f"{row['name']} : absente."
                if settings._required_from("qualifications_required_from", day):
                    blocking.append(text)
                else:
                    warning.append(text)
        if blocking:
            # Expirée le lendemain de sa date d'échéance.
            add("V04", since=day_start(since + timedelta(days=1)) if since else None, info=" ".join(blocking))
        if warning:
            add("V04", info=" ".join(dict.fromkeys(warning)), severity="warn")

    def _hsseq_v05(self, add, day, settings):
        vehicle = self.vehicle_id
        if not vehicle or not hasattr(vehicle, "_expired_documents"):
            return
        expired = vehicle._expired_documents(day, kinds=V05_KINDS)
        if expired:
            first = min(expired.mapped("expiry_date"))
            add("V05", since=day_start(first + timedelta(days=1)), info=", ".join(
                f"{DOCUMENT_LABELS.get(d.kind, d.kind)} expirée le {d.expiry_date:%d/%m/%Y}" for d in expired))
        missing = vehicle._missing_documents(kinds=V05_KINDS)
        if missing:
            text = ", ".join(f"{DOCUMENT_LABELS.get(k, k)} non renseignée" for k in missing)
            add("V05", info=text, severity="block" if settings._required_from("documents_required_from", day) else "warn")

    def _hsseq_v06(self, add, day, settings):
        vehicle = self.vehicle_id
        if vehicle_kind(vehicle) != "tanker" or not hasattr(vehicle, "_expired_documents"):
            return
        expired = vehicle._expired_documents(day, kinds=V06_KINDS)
        if expired:
            first = min(expired.mapped("expiry_date"))
            add("V06", since=day_start(first + timedelta(days=1)), info=", ".join(
                f"{DOCUMENT_LABELS.get(d.kind, d.kind)} expiré le {d.expiry_date:%d/%m/%Y}" for d in expired))
        missing = vehicle._missing_documents(kinds=V06_KINDS)
        if missing:
            text = ", ".join(f"{DOCUMENT_LABELS.get(k, k)} non renseigné" for k in missing)
            add("V06", info=text, severity="block" if settings._required_from("documents_required_from", day) else "warn")

    def _hsseq_v07(self, add):
        if vehicle_kind(self.vehicle_id) != "tipper" or not hasattr(self, "_overload"):
            return
        overload = self._overload()
        if overload > 0:
            net = self.weight_gross - self.weight_tare
            add("V07", info=f"Poids net {net:.2f} t pour une charge utile de {self.vehicle_id.payload_tonnes:.2f} t : "
                            f"délester de {overload:.2f} t, puis nouvelle pesée.")

    def _hsseq_v08(self, add, settings):
        journey = self._hsseq_journey()
        problems = []
        if not journey:
            problems.append("Aucun plan de trajet pour la rotation.")
        elif journey.status != "validated":
            problems.append("Plan de trajet à valider par l'exploitation.")
        if journey:
            problems += [issue["label"] for issue in journey._issues(settings)]
        if problems:
            add("V08", since=journey.write_date if journey else self.create_date, info=" ".join(problems))

    def _hsseq_v09(self, add):
        immobilization = self.vehicle_id.hsseq_immobilization_id
        if immobilization:
            event = immobilization.event_id
            add("V09", since=immobilization.since,
                info=f"{self.vehicle_id.name} immobilisé par l'événement {event.reference} ({event.title}).")

    def _hsseq_evaluate(self, detail=True, log=False, attach=False):
        """Évaluation du verrou au format de POST /hsseq/lock/evaluate."""
        self.ensure_one()
        result = self._hsseq_reasons(detail=detail, attach=attach and self.state == "draft")
        active = self._hsseq_lock_active()
        open_block = [r for r in result["reasons"] if not r["waiver_id"]]
        allowed = not active or not open_block
        waivers = self.sudo().hsseq_waiver_ids.filtered(lambda w: w.status == "active")
        waiver = waivers[:1]
        evaluation = {
            "rotation_id": self.id, "allowed": allowed, "lock_active": active, "reasons": result["reasons"],
            "warnings": result["warnings"],
            "active_waiver": {"id": waiver.id, "reason_code": waiver.reason_code,
                              "approved_by": [{"id": a["by"].id, "name": a["by"].name} for a in waiver._approvals()],
                              "expires": waiver.expires or None} if waiver else None,
            "active_waivers": [{"id": w.id, "reason_code": w.reason_code, "expires": w.expires or None} for w in waivers],
            "pending_checks_only": bool(open_block) and all(r["pending"] for r in open_block),
            "checked_at": fields.Datetime.now(),
        }
        if log:
            self.env["eguitra.hsseq.lock.log"].sudo().create({
                "rotation_id": self.id, "allowed": allowed, "lock_active": active,
                "codes": ",".join(r["code"] for r in open_block) or False,
                "waived": ",".join(r["code"] for r in result["waived"]) or False})
        return evaluation

    # ─── Crochets de Transport ────────────────────────────────────────────

    def _departure_blockers(self):
        blockers = super()._departure_blockers()
        if not self._hsseq_lock_active():
            return blockers
        result = self._hsseq_reasons(detail=False)
        keys = ("code", "label", "source", "since", "waivable", "severity")
        blockers += [{k: r[k] for k in keys} for r in result["reasons"] if not r["waiver_id"]]
        blockers += [{k: r[k] for k in keys} for r in result["warnings"]]
        return blockers

    def _departure_waived(self):
        """Appelé par Transport au départ accordé : rattache à la rotation les saisies de terrain faites sans
        elle (contrôle, alcootest), et liste les motifs dérogés pour la trace du départ."""
        waived = super()._departure_waived()
        if not self._hsseq_lock_active():
            return waived
        keys = ("code", "label", "source", "since", "waivable", "severity", "waiver_id")
        return waived + [{k: r[k] for k in keys} for r in self._hsseq_reasons(detail=False, attach=True)["waived"]]

    def _depart_refusal(self):
        """Motif du refus du départ pour le compte, ou None. Le départ est donné par un chef de parc (profil
        exploitation) ou par l'administration, jamais par la finance ni la direction (contrôle de profil de
        Transport). Verrou HSSEQ en service pour la rotation (lock_start_date atteinte) : le chef de parc ne
        fait partir qu'un ensemble de ses sites (fermé par défaut : ni sans site rattaché, ni un ensemble
        sans site, que seule l'administration fait partir) ; avant, seul le contrôle de profil compte. Le
        verrou s'applique ensuite à tous de la même façon.

        Crochet de Transport (branche claude/transport-depart) : super() refuse d'abord la finance et la
        direction (DEPART_PROFILES : admin, exploitation) ; tant qu'il n'est pas fusionné, le même contrôle est
        fait ici, et la surcharge d'action_depart ci-dessous l'appelle. À la fusion, elle disparaît."""
        self.ensure_one()
        parent = getattr(super(), "_depart_refusal", None)
        refusal = parent() if parent else None
        if refusal:
            return refusal
        if self.env.su:
            return None
        user = self.env.user
        user_profiles = user._eguitra_profiles()
        if "admin" in user_profiles:
            return None
        if "exploitation" not in user_profiles or not user.has_group(EXPLOITATION_GROUP):
            return "Le départ en route est donné par un chef de parc (profil Exploitation transport) ou par " \
                   "l'administration."
        if not self._hsseq_lock_active():
            return None
        site = self.sudo().vehicle_id.site_id
        if not site:
            return f"Rotation {self._label()} : ensemble rattaché à aucun site, seule l'administration le fait partir."
        if not site or site not in user._hsseq_site_ids():
            return f"Rotation {self._label()} : ensemble hors de vos sites."
        return None

    def action_depart(self):
        for rot in self:
            refusal = rot._depart_refusal()
            if refusal:
                raise AccessError(refusal)
        return super().action_depart()

    def _validation_blockers(self):
        """Une rotation soumise au verrou ne se valide qu'après son départ « en route »."""
        blockers = super()._validation_blockers()
        if self._hsseq_lock_active() and not self.departed_at:
            blockers.append(motif("H01", "Départ non enregistré : la rotation passe « en route » avant d'être validée.",
                                  "NIMOVA · HSSEQ, verrou de départ"))
        return blockers

    def write(self, vals):
        result = super().write(vals)
        if vals.get("state") in ROTATION_ENDED:
            self.sudo().hsseq_waiver_ids._expire()
        return result
