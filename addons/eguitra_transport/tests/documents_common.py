"""Jeu de données de la chaîne documentaire : un ensemble citerne en tracteur et remorque, un convoyeur, une route
avec ses frais de route par jour, ses péages et une étape type, le prix du carburant, une station, un compte de
direction ; outils : ordre de transport, opération, rendu HTML des documents."""

import html
import re
from datetime import timedelta

from .common import TransportCase


class DocumentsCase(TransportCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env
        cls.company.write({"city": "Conakry", "transport_fuel_station_id": cls.supplier.id,
                           "transport_operations_manager": "Responsable démo"})
        cls.co_driver = env["eguitra.transport.driver"].create({"name": "Convoyeur démo", "crew_role": "assistant"})
        cls.tanker = env["eguitra.transport.vehicle"].create({
            "name": "ER-02", "tractor_plate": "RC-2002-A", "trailer_plate": "RC-2002-C", "capacity_liters": 40000,
            "driver_id": cls.driver.id, "fuel_consumption": 45,
        })
        cls.route.write({"origin": "Conakry", "destination": "Siguiri", "road_fee_per_day": 150_000,
                         "std_tolls": 300_000, "duration_days": 6,
                         "step_ids": [(0, 0, {"place": "Mamou", "city": "Mamou", "country": "Guinée",
                                              "direction": "out", "stop_reason": "Pause et contrôle"})]})
        env["eguitra.transport.fuel.price"].create({"date_from": cls.today - timedelta(days=30), "price": 12_000})
        cls._create_user("mariam", "direction")
        cls._create_user("ousmane", "exploitation")
        # Seconde comptable : la clôture d'un voyage revient à un autre compte que celui qui a saisi les dépenses.
        cls._create_user("kadiatou", "finance")

    # ─── Outils ───────────────────────────────────────────────────────────

    def _order(self, **values):
        base = {"partner_id": self.customer.id, "product_id": self.gasoil.id, "quantity": 40000, "quantity_uom": "l",
                "packaging": "Vrac liquide", "route_id": self.route.id, "client_ref": "CMD-DEMO-1"}
        base.update(values)
        return self.env["eguitra.transport.order"].create(base)

    def _operation(self, order=None, **values):
        base = {"vehicle_id": self.tanker.id, "partner_id": self.customer.id, "route_id": self.route.id,
                "product_id": self.gasoil.id, "co_driver_id": self.co_driver.id,
                "date_planned_departure": self.today, "date_planned_arrival": self.today + timedelta(days=2),
                "date_planned_return": self.today + timedelta(days=5), "volume_planned": 40}
        if order:
            base["order_id"] = order.id
        base.update(values)
        return self.env["eguitra.transport.rotation"].create(base)

    def _html(self, report, records):
        content, _kind = self.env["ir.actions.report"]._render_qweb_html(report, records.ids)
        text = re.sub(r"<[^>]+>", " ", content.decode() if isinstance(content, bytes) else str(content))
        return re.sub(r"[ \t\r\n]+", " ", html.unescape(text)).replace("\xa0", " ")

    def _token(self, login):
        tokens = self.__dict__.setdefault("_tokens", {})
        if login not in tokens:
            tokens[login] = self.open_session(login)["access_token"]
        return tokens[login]

    def _api(self, login, method, path, payload=None):
        self.env.flush_all()
        status, body = self.call(method, path, payload, token=self._token(login))
        self.env.invalidate_all()
        return status, body
