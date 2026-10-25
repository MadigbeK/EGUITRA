import io
from datetime import date, timedelta

from odoo import fields

from odoo.addons.eguitra_transport.tests.common import TransportCase

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
MANDATORY = ("PERMIS", "CONDUITE_DEFENSIVE", "MATIERES_DANGEREUSES")


class HsseqCase(TransportCase):
    """Jeu de données HSSEQ : un site (Parc de Matoto) et son chef de parc, un second chef de parc sur un autre
    site, deux responsables HSSEQ, la direction, l'administration, un compte RH, un conducteur (compte du
    salarié RH lié au chauffeur de l'ensemble ER-01, habilitations à jour), le verrou en service depuis
    30 jours. Hérite du jeu du transport (ER-01, route, client, ibrahima en exploitation, fatou en finance)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env
        cls.day = date.today()
        cls.settings = env["eguitra.hsseq.settings"]._get(cls.company)
        cls.settings.write({"lock_start_date": cls.day - timedelta(days=30)})
        cls.hsseq = cls._create_user("kadi.hsseq", "hsseq")
        cls.hsseq2 = cls._create_user("binta.hsseq", "hsseq")
        cls.dg = cls._create_user("dg.hsseq", "direction")
        cls.admin = cls._create_user("admin.hsseq", "admin")
        cls.rh = cls._create_user("rh.hsseq", "rh")
        cls.parc = env["res.users"].search([("login", "=", "ibrahima")])
        cls.parc2 = cls._create_user("sekou.parc", "exploitation")
        cls.conducteur = cls._create_user("mamadou.conducteur", "conducteur")
        cls.site = env["eguitra.hsseq.site"].create({"name": "Parc de Matoto", "code": "MAT", "company_id": cls.company.id,
                                                     "manager_ids": [(6, 0, cls.parc.ids)]})
        cls.site2 = env["eguitra.hsseq.site"].create({"name": "Base de Boffa", "code": "BOF", "company_id": cls.company.id,
                                                      "default_vehicle_kind": "tipper",
                                                      "manager_ids": [(6, 0, cls.parc2.ids)]})
        cls.truck.site_id = cls.site
        cls.employee = env["eguitra.rh.employee"].create({
            "name": "Mamadou Diallo", "hire_date": date(2024, 1, 1), "base_salary": 3_000_000,
            "driver_id": cls.driver.id, "user_id": cls.conducteur.id, "medical_fitness": "apte",
            "medical_fitness_until": cls.day + timedelta(days=300)})
        Type = env["eguitra.rh.qualification.type"]
        for code in MANDATORY:
            env["eguitra.rh.qualification"].create({
                "employee_id": cls.employee.id, "type_id": Type.search([("code", "=", code)]).id,
                "obtained_date": date(2024, 1, 1), "expiry_date": cls.day + timedelta(days=400)})
        if "eguitra.transport.vehicle.document" in env:
            for kind in ("insurance", "inspection", "calibration", "tightness"):
                env["eguitra.transport.vehicle.document"].create({
                    "vehicle_id": cls.truck.id, "kind": kind, "expiry_date": cls.day + timedelta(days=200)})
        cls.tanker_template = env.ref("eguitra_hsseq.template_tanker")
        cls.tipper_template = env.ref("eguitra_hsseq.template_tipper")

    def setUp(self):
        super().setUp()
        self._tokens = {}

    # ─── Outils ───────────────────────────────────────────────────────────

    def app_of(self, login):
        """Application de connexion du compte : HSSEQ s'il l'ouvre, sinon NIMOVA Terrain, sinon la première."""
        apps = self.env["res.users"].search([("login", "=", login)])._eguitra_apps()
        return next((a for a in ("hsseq", "terrain") if a in apps), apps[0] if apps else "hsseq")

    def token(self, login, app=None):
        if login not in self._tokens:
            app = app or self.app_of(login)
            self._tokens[login] = (self.open_session(login, app=app)["access_token"], app)
        return self._tokens[login][0]

    def headers(self, login):
        app = self._tokens[login][1]
        return {"X-Eguitra-App": "terrain"} if app == "terrain" else None

    def api(self, login, method, path, payload=None, app=None):
        token = self.token(login, app)
        result = self.call(method, path, payload, token=token, headers=self.headers(login))
        # Écritures faites par la requête : relues depuis la base.
        self.env.invalidate_all()
        return result

    def driver_api(self, method, path, payload=None):
        return self.api("mamadou.conducteur", method, path, payload, app="terrain")

    def upload(self, login, content=PNG, name="photo.png", **fields_):
        token = self.token(login)
        headers = {"Authorization": f"Bearer {token}", **(self.headers(login) or {})}
        response = self.url_open("/api/v1/hsseq/attachments", data={k: str(v) for k, v in fields_.items()},
                                 files={"file": (name, io.BytesIO(content), "image/png")}, headers=headers,
                                 method="POST", timeout=60)
        self.env.invalidate_all()
        return response.status_code, response.json()

    def answers(self, template, failing=(), photos=None):
        """Réponses à toute la grille (points reliés exclus) : conforme, sauf les libellés de failing."""
        rows = []
        for item in template._answerable_items():
            row = {"item_id": item.id, "answer": "not_ok" if item.label in failing else "ok"}
            if photos and item.label in photos:
                row["attachment_ids"] = photos[item.label]
            rows.append(row)
        return rows

    def check(self, rotation=None, failing=(), template=None, vehicle=None, user=None, **values):
        """Contrôle avant départ saisi en base (comme par NIMOVA Terrain)."""
        template = template or self.tanker_template
        vehicle = vehicle or (rotation.vehicle_id if rotation else self.truck)
        answers = [{"item_id": a["item_id"], "answer": a["answer"]} for a in self.answers(template, failing)]
        base = {"company_id": vehicle.company_id.id, "template_id": template.id, "vehicle_id": vehicle.id,
                "rotation_id": rotation.id if rotation else False, "driver_id": (rotation or vehicle).driver_id.id,
                "author_id": (user or self.parc).id, "reported_at": fields.Datetime.now()}
        base.update(values)
        return self.env["eguitra.hsseq.check"]._hsseq_create(base, answers)

    def breath(self, rotation=None, result="negative", driver=None, **values):
        driver = driver or (rotation.driver_id if rotation else self.driver)
        base = {"company_id": self.company.id, "rotation_id": rotation.id if rotation else False, "driver_id": driver.id,
                "performed": result != "not_done", "result": result if result != "not_done" else False,
                "not_done_reason": "Appareil en panne" if result == "not_done" else False,
                "reading_mg_l": 0.4 if result == "positive" else 0.0, "reported_at": fields.Datetime.now()}
        base.update(values)
        return self.env["eguitra.hsseq.breath.test"].with_user(self.parc)._hsseq_create(base)

    def codes(self, rotation, **kw):
        return [r["code"] for r in rotation._hsseq_evaluate(**kw)["reasons"]]

    def event(self, **values):
        base = {"title": "Citerne immobilisée sans balisage", "event_type": "hazard", "description": "De nuit, sur la RN1.",
                "occurred_at": fields.Datetime.now() - timedelta(hours=3), "company_id": self.company.id,
                "reported_by": self.parc.id, "vehicle_id": self.truck.id}
        base.update(values)
        return self.env["eguitra.hsseq.event"].create(base)
