from datetime import date, timedelta

from odoo.tests import tagged

from ..nombres import fmt_pct
from .common import TransportCase


@tagged("post_install", "-at_install")
class TestBaremeOfficiel(TransportCase):
    """Barème officiel du transport des hydrocarbures (arrêté A/2019/816/MH), écarts des tarifs pratiqués
    et indicateurs de flotte du modèle du client."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.scale = cls.env.ref("eguitra_transport.official_scale_2019")
        cls.Rate = cls.env["eguitra.transport.official.rate"]
        cls._create_user("mariam", "achats")

    def _line(self, depot, destination):
        line = self.Rate.search([("scale_id", "=", self.scale.id), ("depot", "=", depot),
                                 ("destination", "=", destination)])
        self.assertEqual(len(line), 1, destination)
        return line

    def test_donnees_de_l_annexe_signee(self):
        self.assertEqual((self.scale.date_from, self.scale.date_signed), (date(2019, 4, 1), date(2019, 3, 19)))
        counts = {d: self.Rate.search_count([("scale_id", "=", self.scale.id), ("depot", "=", d)])
                  for d in ("conakry_sgp", "kankan_sgp", "nzerekore_sgp", "kamsar_cbg")}
        self.assertEqual(counts, {"conakry_sgp": 116, "kankan_sgp": 51, "nzerekore_sgp": 19, "kamsar_cbg": 14})
        # Le PDF signé fait foi là où le tableur de la SONAP diffère.
        expected = {("conakry_sgp", "Balandougouba"): 1252.14, ("conakry_sgp", "Garafiri"): 325.16,
                    ("conakry_sgp", "Gbenko"): 1205.70, ("conakry_sgp", "Tougnifily"): 213.45,
                    ("kankan_sgp", "Balato"): 225.02, ("kankan_sgp", "Komodou"): 126.56,
                    ("kankan_sgp", "Mandiana"): 131.37, ("conakry_sgp", "Siguiri"): 1142.35,
                    ("kamsar_cbg", "Tanènè"): 191.84, ("nzerekore_sgp", "Yomou"): 92.70}
        for (depot, destination), rate in expected.items():
            self.assertEqual(self._line(depot, destination).rate, rate, destination)
        # Distance du tableur incohérente avec le tarif signé : non reprise.
        self.assertFalse(self._line("conakry_sgp", "Kiniéro").distance_km)
        self.assertAlmostEqual(self._line("conakry_sgp", "Siguiri").distance_km, 1087.9, places=1)

    def test_rattachement_et_ecarts(self):
        siguiri = self._line("conakry_sgp", "Siguiri")
        self.assertEqual(self.route._suggest_official_rate(), siguiri, "Arrivée et dépôt lus dans « Conakry - Siguiri »")
        kankan = self.env["eguitra.transport.route"].create({"name": "Kankan - Siguiri", "distance_km": 200})
        self.assertEqual(kankan._suggest_official_rate(), self._line("kankan_sgp", "Siguiri"))
        self.assertFalse(self.env["eguitra.transport.route"].create({"name": "Dépôt - Inconnu"})._suggest_official_rate())
        self.route.write({"official_rate_id": siguiri.id, "default_rate": 1_142_350})
        tariff = self.route.tariff_ids[:1]
        line, gap = tariff._official_gap()
        self.assertEqual(line, siguiri)
        self.assertAlmostEqual(gap, (1_200_000 / 1_142_350 - 1) * 100)
        rot = self._rotation()
        self.assertAlmostEqual(rot._official_gap()[1], gap, msg="La rotation prend le tarif du client")
        controls = {c["code"]: c for c in self.env["eguitra.transport.analysis"].controls(self.company)}
        control = controls["official_rate_gap"]
        self.assertFalse(control["ok"])
        self.assertTrue(any("tarif par défaut" not in item and fmt_pct(gap, sign=True) in item for item in control["items"]))
        self.assertFalse(any("tarif par défaut" in item for item in control["items"]), "Tarif par défaut au barème")
        self.company.transport_official_rate_tolerance = 10
        controls = {c["code"]: c for c in self.env["eguitra.transport.analysis"].controls(self.company)}
        self.assertTrue(controls["official_rate_gap"]["ok"], "Écart de 5 % dans une tolérance de 10 %")

    def test_nouveau_bareme_et_date_de_chargement(self):
        siguiri = self._line("conakry_sgp", "Siguiri")
        self.route.official_rate_id = siguiri
        start = date.today() + timedelta(days=30)
        new = self.env["eguitra.transport.official.scale"].create({
            "name": "Arrêté de démonstration", "date_from": start,
            "rate_ids": [(0, 0, {"depot": "conakry_sgp", "sequence": 100, "destination": "SIGUIRI", "rate": 1300})]})
        self.assertEqual(self.route._official_at(date.today()), siguiri, "Barème de 2019 jusqu'au nouvel arrêté")
        self.assertEqual(self.route._official_at(start), new.rate_ids, "Même destination, nouveau barème")
        self.assertFalse(self.route._official_at(date(2018, 12, 31)), "Avant tout barème : pas de référence")
        later = self._rotation(date_loading=start)
        self.assertEqual(later._official_gap()[0], new.rate_ids)

    def test_api_et_profils(self):
        token = self.open_session("ibrahima")["access_token"]
        status, body = self.call("GET", "/transport/official-rates?depot=kamsar_cbg", token=token)
        self.assertEqual((status, len(body["items"])), (200, 14), body)
        self.assertEqual(body["scale"]["name"], "Arrêté A/2019/816/MH")
        status, body = self.call("GET", "/transport/official-rates?q=siguiri", token=token)
        self.assertEqual({i["depot"] for i in body["items"]}, {"conakry_sgp", "kankan_sgp"})
        status, body = self.call("GET", "/transport/official-rates?depot=lune", token=token)
        self.assertEqual(status, 400)
        siguiri = self._line("conakry_sgp", "Siguiri")
        status, routes = self.call("GET", "/transport/routes", token=token)
        row = next(r for r in routes if r["id"] == self.route.id)
        self.assertEqual((row["official_rate_id"], row["official_suggestion"]["id"]), (None, siguiri.id))
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"official_rate_id": siguiri.id}, token)
        self.assertEqual(status, 200, body)
        status, routes = self.call("GET", "/transport/routes", token=token)
        row = next(r for r in routes if r["id"] == self.route.id)
        self.assertEqual(row["official_rate"]["rate_per_m3"], 1_142_350)
        self.assertTrue(row["default_rate_gap"]["flagged"], "Tarif par défaut de 1 000 000 le m³ : -12 %")
        self.assertTrue(row["tariffs"][0]["official_gap"]["flagged"])
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"official_rate_id": 999999}, token)
        self.assertEqual(status, 422, body)
        # Tolérance : paramètre de la finance.
        status, _b = self.call("PATCH", "/transport/settings", {"official_rate_tolerance": 6}, token)
        self.assertEqual(status, 403)
        finance = self.open_session("fatou")["access_token"]
        status, body = self.call("PATCH", "/transport/settings", {"official_rate_tolerance": 6}, finance)
        self.assertEqual((status, body["official_rate_tolerance"]), (200, 6), body)
        status, body = self.call("PATCH", "/transport/settings", {"official_rate_tolerance": 150}, finance)
        self.assertEqual(status, 400)
        # Hors des profils du Transport, le barème est refusé.
        status, _b = self.call("GET", "/transport/official-rates", token=self.open_session("mariam")["access_token"])
        self.assertEqual(status, 403)

    def test_indicateurs_de_flotte(self):
        self.env["eguitra.transport.vehicle"].create({"name": "ER-02", "capacity_liters": 40000, "state": "maintenance",
                                                     "year": date.today().year - 10})
        self.truck.year = date.today().year - 4
        self.route.duration_days = 5
        today = date.today()
        on_time = self._rotation(date_loading=today, date_return=today + timedelta(days=4))
        late = self._rotation(date_loading=today, date_return=today + timedelta(days=8), volume_loaded=30,
                              volume_delivered=29.9)
        (on_time | late).action_validate()
        kpis = self.env["eguitra.transport.analysis"].fleet_kpis(self.company, today, today + timedelta(days=9))
        self.assertEqual(kpis["availability"]["value"], 50, "Un ensemble en service sur deux")
        self.assertTrue(kpis["availability"]["below_alert"], "Sous le seuil d'alerte du client (85 %)")
        self.assertEqual(kpis["availability"]["target"], 90)
        self.assertAlmostEqual(kpis["fill_rate"]["value"], 70 / 80 * 100)
        self.assertEqual(kpis["on_time"]["value"], 50)
        self.assertAlmostEqual(kpis["utilization"]["value"], (4 + 8) / (2 * 10) * 100)
        self.assertEqual(kpis["fleet_age_years"], 7)
        report = self.env["eguitra.transport.analysis"].report(self.company, today, today + timedelta(days=9))
        self.assertIn("fleet", report)
