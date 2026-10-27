import io
import zipfile
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo.tests import tagged

from ..models.cockpit import INDICATORS, month_start
from ..models.common import indicator_status
from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestReports(HsseqCase):
    """Rapport mensuel HSSE au format d'un donneur d'ordre : modèle paramétrable, valeurs calculées et
    saisies, plan contre réalisé, cumul et état, synthèse du comité, validation par hsseq après le gel du
    5 du mois suivant, sorties Excel et PDF, modèle NIMOVA ; droits par profil."""

    def _template(self, login="kadi.hsseq"):
        flat = [1] * 12
        status, template = self.api(login, "POST", "/hsseq/reports/templates", {
            "name": "Rapport HSSE du donneur d'ordre (fictif)", "client_label": "Pétrolier fictif",
            "indicators": [
                {"code": "A1-1", "label": "Contrôles inopinés sur la route", "nature": "proactive", "mode": "manual",
                 "unit": "nbre", "direction": "up", "aggregation": "sum", "targets": flat},
                {"code": "A1-12", "label": "Presque-accidents déclarés", "nature": "proactive", "mode": "computed",
                 "key": "weak_signals", "targets": flat},
                {"code": "A1-10", "label": "Réalisation des contrôles avant départ", "nature": "proactive",
                 "mode": "computed", "key": "check_completion"},
                {"code": "B1-1", "label": "Accidents sur route", "nature": "reactive", "mode": "computed",
                 "key": "road_accidents", "targets": [0] * 12},
                {"code": "B1-3", "label": "Déversements", "nature": "reactive", "mode": "manual", "unit": "litres",
                 "direction": "down", "aggregation": "sum", "targets": [0] * 12, "alert_threshold": 50},
            ]})
        self.assertEqual(status, 200, template)
        return template

    def test_etat_d_un_indicateur(self):
        self.assertEqual(indicator_status(None, 10, "up"), "no_data")
        self.assertEqual(indicator_status(5, None, "up"), "no_data")
        self.assertEqual([indicator_status(v, 100, "up", 0.95, 0.85) for v in (96, 90, 80)], ["met", "watch", "missed"])
        self.assertEqual([indicator_status(v, 0, "down", 0.95, 0.85) for v in (0, 1)], ["met", "missed"],
                         "Cible nulle : pas de marge")
        self.assertEqual([indicator_status(v, 2, "down", threshold=5) for v in (2, 4, 5)], ["met", "watch", "missed"],
                         "Seuil d'alerte explicite")

    def test_modele_nimova(self):
        template = self.env["eguitra.hsseq.report.template"].search([("code", "=", "NIMOVA")])
        self.assertEqual(len(template), 1, "Modèle NIMOVA créé par le module")
        self.assertEqual(len(template._indicators()), len(INDICATORS), "Un indicateur par indicateur du cockpit")
        self.assertTrue(all(i.mode == "computed" for i in template._indicators()))
        status, report = self.api("dg.hsseq", "GET", f"/hsseq/reports/{template.id}/{self.day:%Y-%m}")
        self.assertEqual(status, 200, report)
        completion = next(i for i in report["indicators"] if i["key"] == "check_completion")
        self.assertEqual(completion["series"][-1]["target"], 100.0, "Cible des paramètres à défaut du modèle")

    def test_rapport_du_mois_et_saisies(self):
        template = self._template()
        self.assertEqual([i["code"] for i in template["indicators"]], ["A1-1", "A1-12", "A1-10", "B1-1", "B1-3"],
                         "Proactifs puis réactifs, dans l'ordre de saisie")
        self.event(event_type="near_miss")
        self.event(event_type="road_accident")
        path = f"/hsseq/reports/{template['id']}/{self.day:%Y-%m}"
        status, report = self.api("kadi.hsseq", "GET", path)
        self.assertEqual(status, 200, report)
        rows = {i["code"]: i for i in report["indicators"]}
        self.assertEqual(len(report["months"]), self.day.month, "De janvier au mois du rapport")
        self.assertEqual((rows["A1-12"]["value"], rows["B1-1"]["value"]), (1.0, 1.0))
        self.assertEqual(rows["B1-1"]["status"], "missed", "Un accident pour une cible nulle : non conforme")
        self.assertEqual(rows["A1-1"]["status"], "no_data", "Indicateur saisi, pas encore renseigné")
        self.assertEqual(rows["A1-1"]["series"][-1]["target"], 1, "Plan du mois")
        self.assertIn("B1-1", [p["code"] for p in report["summary"]["attention_points"]])
        self.assertEqual(report["summary"]["by_status"]["no_data"] >= 1, True)
        status, body = self.api("kadi.hsseq", "PATCH", path, {"values": [{"indicator_id": rows["B1-1"]["id"], "value": 0}]})
        self.assertEqual((status, body["error"]), (422, "business_rule"), "Un indicateur calculé ne se saisit pas")
        status, report = self.api("kadi.hsseq", "PATCH", path, {
            "values": [{"indicator_id": rows["A1-1"]["id"], "value": 1, "comment": "Contrôle sur la RN1"},
                       {"indicator_id": rows["B1-3"]["id"], "value": 30},
                       {"indicator_id": rows["B1-1"]["id"], "comment": "Accrochage sans blessé, enquête ouverte"}],
            "comment": "Mois marqué par un accident de la route."})
        self.assertEqual(status, 200, report)
        rows = {i["code"]: i for i in report["indicators"]}
        self.assertEqual((rows["A1-1"]["value"], rows["A1-1"]["comment"], rows["A1-1"]["series"][-1]["source"]),
                         (1.0, "Contrôle sur la RN1", "manual"))
        self.assertEqual(rows["B1-3"]["status"], "watch", "30 litres pour une cible nulle, sous le seuil d'alerte de 50")
        self.assertEqual(rows["B1-1"]["comment"], "Accrochage sans blessé, enquête ouverte")
        self.assertEqual(report["comment"], "Mois marqué par un accident de la route.")
        status, body = self.api("kadi.hsseq", "POST", f"{path}/validate")
        self.assertEqual((status, body["error"]), (422, "month_not_frozen"), "Mois en cours : pas encore figé")
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq"):
            status, _b = self.api(login, "PATCH", path, {"comment": "x"})
            self.assertEqual(status, 403, f"{login} ne renseigne pas le rapport")
            status, _b = self.api(login, "POST", f"{path}/validate")
            self.assertEqual(status, 403, f"{login} ne valide pas le rapport")
        auditor = self._create_user("awa.auditrice", "auditeur")
        auditor.write({"hsseq_audit_until": self.day + timedelta(days=5), "hsseq_audit_site_ids": [(6, 0, self.site.ids)]})
        for login in ("ibrahima", "awa.auditrice"):
            for sub in ("", "/report.xlsx", "/report.pdf"):
                status, _b = self.api(login, "GET", path + sub)
                self.assertEqual(status, 403, f"{login} ne lit pas le rapport de la société {sub}")
            status, _b = self.api(login, "GET", "/hsseq/reports/templates")
            self.assertEqual(status, 403)
        status, _b = self.api("ibrahima", "POST", "/hsseq/reports/templates", {"name": "x"})
        self.assertEqual(status, 403, "Modèles : admin et hsseq")
        # Sorties : classeur (synthèse du comité, plan contre réalisé) et PDF du noyau.
        token = self.token("dg.hsseq")
        self.env.flush_all()
        response = self.url_open(f"/api/v1{path}/report.xlsx", headers={"Authorization": f"Bearer {token}",
                                                                         "X-Eguitra-App": "test"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        book = zipfile.ZipFile(io.BytesIO(response.content))
        content = book.read("xl/workbook.xml").decode() + book.read("xl/sharedStrings.xml").decode()
        for text in ("Synthèse comité", "Indicateurs", "Contrôles inopinés sur la route", "Pétrolier fictif"):
            self.assertIn(text, content)
        response = self.url_open(f"/api/v1{path}/report.pdf", headers={"Authorization": f"Bearer {token}",
                                                                        "X-Eguitra-App": "test"}, timeout=120)
        self.assertEqual(response.status_code, 200)

    def test_gel_validation_et_reouverture(self):
        template = self._template()
        previous = month_start(self.day) - relativedelta(months=1)
        # Le modèle commence au mois précédent (sinon ses mois antérieurs à sa création ne sont pas listés).
        status, _b = self.api("kadi.hsseq", "PATCH", f"/hsseq/reports/templates/{template['id']}",
                              {"start_month": f"{previous:%Y-%m}"})
        self.assertEqual(status, 200)
        self.event(event_type="road_accident", occurred_at=previous + timedelta(days=3, hours=10))
        path = f"/hsseq/reports/{template['id']}/{previous:%Y-%m}"
        status, months = self.api("kadi.hsseq", "GET", f"/hsseq/reports?template_id={template['id']}&year={previous.year}")
        self.assertEqual(status, 200, months)
        self.assertIn(f"{previous:%Y-%m}", [m["month"] for m in months["items"]])
        if self.day.day < 5:
            return  # le mois précédent se fige le 5
        self.env["eguitra.hsseq.report.month"]._cron_freeze()
        # Modèle sans société : il sert les deux, un mois figé par société ; celui de la société du test.
        record = self.env["eguitra.hsseq.report.month"].search([("template_id", "=", template["id"]),
                                                                ("company_id", "=", self.company.id),
                                                                ("month", "=", previous)])
        self.assertTrue(record.frozen_on, "Figé le 5 du mois suivant")
        self.event(event_type="road_accident", occurred_at=previous + timedelta(days=4, hours=10))
        status, report = self.api("kadi.hsseq", "GET", path)
        rows = {i["code"]: i for i in report["indicators"]}
        self.assertEqual((report["frozen"], rows["B1-1"]["value"]), (True, 1.0), "Valeur figée : l'ajout tardif n'y entre pas")
        self.assertIn("validate", report["transitions"])
        status, validated = self.api("kadi.hsseq", "POST", f"{path}/validate")
        self.assertEqual((status, validated["state"], validated["validated_by"]["id"]), (200, "validated", self.hsseq.id))
        status, body = self.api("kadi.hsseq", "PATCH", path, {"comment": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Validé : plus de saisie")
        status, body = self.api("kadi.hsseq", "POST", f"{path}/reopen", {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, reopened = self.api("kadi.hsseq", "POST", f"{path}/reopen", {"reason": "Déversement déclaré en retard"})
        self.assertEqual((status, reopened["state"]), (200, "draft"))
        status, body = self.api("kadi.hsseq", "GET", f"/hsseq/reports/{template['id']}/{self.day + relativedelta(months=2):%Y-%m}")
        self.assertEqual(status, 422, "Mois à venir")

    def test_modification_du_modele(self):
        template = self._template()
        status, detail = self.api("admin.hsseq", "GET", f"/hsseq/reports/templates/{template['id']}")
        self.assertEqual(status, 200, detail)
        rows = detail["indicators"]
        status, body = self.api("admin.hsseq", "PATCH", f"/hsseq/reports/templates/{template['id']}", {
            "indicators": [dict(r, label=r["label"] + " (révisé)") if r["code"] == "A1-1" else r for r in rows
                           if r["code"] != "B1-3"]})
        self.assertEqual(status, 200, body)
        self.assertEqual([i["code"] for i in body["indicators"] if i["active"]], ["A1-1", "A1-12", "A1-10", "B1-1"],
                         "Indicateur absent du PATCH : retiré")
        self.assertTrue(body["indicators"][0]["label"].endswith("(révisé)"))
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/reports/templates/{template['id']}", {
            "indicators": [{"code": "Z-1", "label": "Sans clé", "mode": "computed"}]})
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"), "Un indicateur calculé désigne sa valeur")
        status, keys = self.api("dg.hsseq", "GET", "/hsseq/reports/keys")
        self.assertIn("road_accidents", [k["key"] for k in keys])
