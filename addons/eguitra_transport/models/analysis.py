"""Rentabilité complète du transport : coûts déclarés et comptabilisés, charges de structure, contrôles.

Coûts déclarés : frais saisis sur les rotations (et coût net des manquants). Coûts comptabilisés :
lignes analytiques des pièces validées sur les comptes de classe 6, imputées sur l'axe Ensemble
routier (regroupement par ensemble et par mois) ou Route (par route). L'écart des deux révèle les
frais non déclarés, les pièces non imputées, ou des frais déclarés qui n'ont pas de pièce.

Charges de structure (méthode du prototype de la direction), par société et sur la période :
  part du transport = chiffre d'affaires des rotations / produits de classe 7 ;
  structure = max(0, charges de l'activité Transport pétrolier + charges non affectées à une
              activité × part du transport + dotations de la flotte - coûts directs) ;
  structure au km = structure / km parcourus ; par ligne : km × structure au km ;
  résultat net = marge - structure.
Dotations de la flotte : celles des immobilisations rattachées aux ensembles ; à défaut d'aucun
rattachement, les crédits du compte 2845 hors à-nouveaux. Leurs pièces sont écartées des autres
masses pour n'être comptées qu'une fois.

Risque de double compte (documenté pour le DAF) : les charges de l'activité transport contiennent les
achats réels (carburant, péages) que les rotations déclarent aussi ; la formule retranche les coûts
directs déclarés, ce qui n'est juste que si déclarations et pièces se recouvrent. Des pièces non
saisies sous-estiment la structure (plancher à zéro), des déclarations sans pièce la gonflent d'autant.
La variante « comptabilisée » retranche à la place les coûts comptabilisés sur l'axe Ensemble routier
et calcule le résultat sur ces coûts : elle suppose les achats de la flotte imputés à la fois sur
l'activité et sur l'ensemble. Les deux résultats sont donnés côte à côte.
"""

from odoo import api, fields, models

from odoo.addons.eguitra_finance.models.finance_metrics import ACC_CODE
from odoo.addons.eguitra_finance.models.syscohada import OPENING_JOURNAL

from ..nombres import fmt_money, fmt_pct, fmt_rate
from .official_rate import gap_pct

AAL_CODE = ACC_CODE.replace("aml.", "aal.")
IN_SERVICE = ("service", "maintenance")
ROUND_TRIP_TOLERANCE = 0.15
FUEL_TOLERANCE = 0.4
# Objectifs et seuils d'alerte des indicateurs de flotte, repris du modèle d'indicateurs du client
# (feuille « Paramètres Objectifs ») : (objectif %, alerte sous %).
FLEET_TARGETS = {"availability": (90, 85), "utilization": (85, 75), "on_time": (95, 90), "fill_rate": (90, 80)}


class EguitraTransportAnalysis(models.AbstractModel):
    _name = "eguitra.transport.analysis"
    _description = "Rentabilité du transport"

    # ─── Briques SQL ──────────────────────────────────────────────────────

    def _fleet_moves(self, company, date_from, date_to):
        """Pièces des dotations de la flotte et leur montant, et l'origine de ce montant."""
        vehicles = self.env["eguitra.transport.vehicle"].sudo().with_context(active_test=False).search(
            [("company_id", "=", company.id), ("asset_id", "!=", False)])
        if vehicles:
            lines = self.env["account.asset.line"].sudo().search([
                ("asset_id", "in", vehicles.asset_id.ids), ("type", "=", "depreciate"), ("move_check", "=", True),
                ("line_date", ">=", date_from), ("line_date", "<=", date_to),
            ])
            return lines.move_id.ids, sum(lines.mapped("amount")), "assets"
        self.env.cr.execute(
            f"""SELECT aml.move_id, aml.credit FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                   AND aj.code != %s AND {ACC_CODE} LIKE '2845%%' AND aml.credit > 0""",
            (company.id, date_from, date_to, OPENING_JOURNAL),
        )
        rows = self.env.cr.fetchall()
        return list({r[0] for r in rows}), sum(float(r[1]) for r in rows), "2845"

    def _analytic_costs(self, companies, date_from, date_to, column, excluded, account_id=None, by_month=False):
        """Charges (classe 6) des lignes analytiques d'un axe, hors pièces exclues : {clé: montant}."""
        where = ["aal.company_id = ANY(%(companies)s)", "aal.date BETWEEN %(start)s AND %(end)s",
                 f"aal.{column} IS NOT NULL", f"{AAL_CODE} LIKE '6%%'",
                 "(aal.move_line_id IS NULL OR NOT (aml.move_id = ANY(%(excluded)s)))"]
        params = {"companies": companies.ids, "start": date_from, "end": date_to, "excluded": list(excluded) or [0]}
        if account_id:
            where.append(f"aal.{column} = %(account)s")
            params["account"] = account_id
        key = "to_char(date_trunc('month', aal.date), 'YYYY-MM')" if by_month else f"aal.{column}"
        self.env.cr.execute(
            f"""SELECT {key}, COALESCE(SUM(-aal.amount), 0)
                  FROM account_analytic_line aal
                  JOIN account_account aa ON aa.id = aal.general_account_id
             LEFT JOIN account_move_line aml ON aml.id = aal.move_line_id
                 WHERE {' AND '.join(where)}
              GROUP BY 1""",
            params,
        )
        return {k: float(v) for k, v in self.env.cr.fetchall()}

    def _ledger(self, company, date_from, date_to, prefix, excluded):
        """Solde (débit - crédit) des comptes d'une classe, pièces validées hors à-nouveaux et hors exclues."""
        self.env.cr.execute(
            f"""SELECT COALESCE(SUM(aml.balance), 0) FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                   AND aj.code != %s AND {ACC_CODE} LIKE %s AND NOT (aml.move_id = ANY(%s))""",
            (company.id, date_from, date_to, OPENING_JOURNAL, prefix + "%", list(excluded) or [0]),
        )
        return float(self.env.cr.fetchone()[0])

    # ─── Charges de structure ─────────────────────────────────────────────

    def _structure_company(self, company, date_from, date_to):
        Rotation = self.env["eguitra.transport.rotation"].sudo()
        activity_col = self.env.ref("eguitra_base.analytic_plan_activite")._column_name()
        vehicle_col = self.env.ref("eguitra_base.analytic_plan_vehicule")._column_name()
        domain = [("company_id", "=", company.id), ("state", "in", ("done", "invoiced")),
                  ("date_loading", ">=", date_from), ("date_loading", "<=", date_to)]
        [(revenue, rebilled, cost, net_shortage, km)] = Rotation._read_group(
            domain, aggregates=["revenue:sum", "taxes_rebilled:sum", "total_cost:sum", "shortage_net_cost:sum",
                                "distance_km:sum"])
        # Produits du transport comme la classe 7 les porte : prix du transport et taxes refacturées.
        revenue, km = (revenue or 0.0) + (rebilled or 0.0), km or 0.0
        direct = (cost or 0.0) + (net_shortage or 0.0)
        fleet_moves, depreciation, source = self._fleet_moves(company, date_from, date_to)
        activity = Rotation._activity_account(company)
        activity_charges = self._analytic_costs(company, date_from, date_to, activity_col, fleet_moves,
                                                account_id=activity.id).get(activity.id, 0.0)
        # Charges non affectées : classe 6 moins ce que l'axe Activité a reçu (toutes activités).
        attributed = sum(self._analytic_costs(company, date_from, date_to, activity_col, fleet_moves).values())
        charges = self._ledger(company, date_from, date_to, "6", fleet_moves)
        corporate = max(0.0, charges - attributed)
        income = -self._ledger(company, date_from, date_to, "7", [])
        share = min(1.0, revenue / income) if income > 0 else None
        booked_direct = sum(self._analytic_costs(company, date_from, date_to, vehicle_col, fleet_moves).values())
        pool = activity_charges + corporate * (share or 0.0) + depreciation
        return {
            "company": {"id": company.id, "name": company.name},
            "transport_revenue": revenue, "income_total": income, "revenue_share": share * 100 if share is not None else None,
            "activity_charges": activity_charges, "corporate_charges": corporate, "fleet_depreciation": depreciation,
            "depreciation_source": source, "direct_costs": direct, "booked_direct_costs": booked_direct, "km": km,
            "structure": max(0.0, pool - direct), "structure_booked": max(0.0, pool - booked_direct),
            "fleet_moves": fleet_moves,
        }

    @api.model
    def structure(self, companies, date_from, date_to):
        # Sociétés du transport seulement (vue groupe : le cabinet n'a ni rotation ni structure de flotte).
        Rotation = self.env["eguitra.transport.rotation"].sudo()
        scope = companies.filtered(lambda c: c.eguitra_entity == "groupe"
                                   or Rotation.search_count([("company_id", "=", c.id)], limit=1))
        details = [self._structure_company(c, date_from, date_to) for c in scope]
        km = sum(d["km"] for d in details)
        total = sum(d["structure"] for d in details)
        booked = sum(d["structure_booked"] for d in details)
        return {
            "companies": [{k: v for k, v in d.items() if k != "fleet_moves"} for d in details],
            "structure": total, "structure_booked": booked, "km": km,
            "per_km": total / km if km else None, "per_km_booked": booked / km if km else None,
            "fleet_moves": [m for d in details for m in d["fleet_moves"]],
        }

    # ─── Coûts comptabilisés par regroupement ─────────────────────────────

    def _booked(self, companies, date_from, date_to, group_by, excluded):
        """Coûts comptabilisés par clé de regroupement ; None si l'axe ne s'y prête pas (chauffeur, client)."""
        if group_by in ("vehicle", "month"):
            plan, model = "eguitra_base.analytic_plan_vehicule", "eguitra.transport.vehicle"
        elif group_by == "route":
            plan, model = "eguitra_base.analytic_plan_route", "eguitra.transport.route"
        else:
            return None, {}
        column = self.env.ref(plan)._column_name()
        amounts = self._analytic_costs(companies, date_from, date_to, column, excluded, by_month=group_by == "month")
        if group_by == "month":
            return amounts, {}
        records = self.env[model].sudo().with_context(active_test=False).search(
            [("company_id", "in", companies.ids), ("analytic_account_id", "in", list(amounts))])
        by_key = {r.id: amounts.get(r.analytic_account_id.id, 0.0) for r in records}
        return by_key, {r.id: r.display_name for r in records}

    # ─── Rapport ──────────────────────────────────────────────────────────

    @staticmethod
    def _complete(row, per_km, per_km_booked, booked):
        km = row.get("km") or 0.0
        row["structure"] = km * per_km if per_km is not None else 0.0
        row["net_result"] = row["margin"] - row["structure"]
        row["booked_cost"] = booked
        if booked is None:
            row["cost_gap"] = row["booked_result"] = None
        else:
            row["cost_gap"] = booked - row["declared_cost"]
            structure_booked = km * per_km_booked if per_km_booked is not None else 0.0
            row["booked_result"] = row["revenue"] + row["taxes_rebilled"] - booked - structure_booked
        return row

    @staticmethod
    def _empty_row(key, label):
        return {"key": key, "label": label, "rotations": 0, "volume": 0.0, "volume_loaded": 0.0, "revenue": 0.0,
                "billed_amount": 0.0, "cost": 0.0, "declared_cost": 0.0, "taxes_rebilled": 0.0, "standard_cost": 0.0,
                "estimated_margin": 0.0, "km": 0.0,
                "fuel_liters": 0.0, "fuel_km": 0.0, "revenue_per_km": None, "cost_per_km": None, "cost_per_liter": None,
                "fuel_per_100km": None, "margin": 0.0, "margin_rate": None, "shortage": 0.0, "shortage_excess": 0.0,
                "shortage_tolerated": 0.0, "shortage_rate": None, "shortage_value": 0.0, "shortage_deduction": 0.0,
                "shortage_claim": 0.0, "shortage_net_cost": 0.0, "excess_rotations": 0, "costs": {}}

    @api.model
    def report(self, companies, date_from, date_to, group_by="vehicle"):
        """Rentabilité par ensemble, route, chauffeur, client ou mois : coûts déclarés et comptabilisés,
        km et ratios, charges de structure et résultat net, indicateurs et contrôles."""
        self.env.flush_all()
        Rotation = self.env["eguitra.transport.rotation"]
        structure = self.structure(companies, date_from, date_to)
        excluded = structure.pop("fleet_moves")
        per_km, per_km_booked = structure["per_km"], structure["per_km_booked"]

        def build(group):
            rows = Rotation.profitability(companies, date_from, date_to, group)
            booked, names = self._booked(companies, date_from, date_to, group, excluded)
            if booked is not None:
                seen = {r["key"] for r in rows}
                # Ensemble ou route qui a des pièces mais aucune rotation sur la période.
                rows += [self._empty_row(key, names.get(key, key)) for key, amount in booked.items()
                         if key not in seen and amount]
            for row in rows:
                self._complete(row, per_km, per_km_booked, booked.get(row["key"], 0.0) if booked is not None else None)
            return rows

        rows = build(group_by)
        vehicles = rows if group_by == "vehicle" else build("vehicle")
        active = [r for r in vehicles if r["rotations"]]
        deficit = [r for r in active if r["net_result"] < 0]
        revenue = sum(r["revenue"] for r in vehicles)
        margin = sum(r["margin"] for r in vehicles)
        km = sum(r["km"] for r in vehicles)
        declared = sum(r["declared_cost"] for r in vehicles)
        booked_total = sum(r["booked_cost"] or 0.0 for r in vehicles)
        income = sum(c["income_total"] for c in structure["companies"])
        threshold = self.env["eguitra.alert.threshold"].sudo().search(
            [("company_id", "in", companies.ids), ("code", "=", "transport_margin_min")], limit=1)
        margin_rate = margin / revenue * 100 if revenue else None
        fuel_km = sum(r["fuel_km"] for r in vehicles)
        indicators = {
            "transport_revenue": revenue, "income_total": income,
            "revenue_share": revenue / income * 100 if income > 0 else None,
            "margin": margin, "margin_rate": margin_rate, "margin_threshold": threshold.value if threshold else None,
            "below_threshold": bool(threshold and threshold.value and margin_rate is not None
                                    and margin_rate < threshold.value),
            "km": km, "revenue_per_km": revenue / km if km else None, "cost_per_km": declared / km if km else None,
            "fuel_per_100km": sum(r["fuel_liters"] for r in vehicles if r["fuel_km"]) / fuel_km * 100 if fuel_km else None,
            "structure": structure["structure"], "structure_per_km": per_km,
            "structure_booked": structure["structure_booked"], "structure_booked_per_km": per_km_booked,
            "net_result": sum(r["net_result"] for r in vehicles),
            "vehicles": len(active), "deficit_vehicles": len(deficit),
            "deficit_loss": sum(r["net_result"] for r in deficit),
            "declared_cost": declared, "booked_cost": booked_total, "cost_gap": booked_total - declared,
            "standard_cost": sum(r["standard_cost"] for r in vehicles),
            "estimated_margin": sum(r["estimated_margin"] for r in vehicles),
            "shortage_excess": sum(r["shortage_excess"] for r in vehicles),
            "shortage_value": sum(r["shortage_value"] for r in vehicles),
        }
        order = (lambda r: r["label"]) if group_by == "month" else (lambda r: -(r["revenue"] or 0))
        return {"group": group_by, "date_from": date_from, "date_to": date_to, "rows": sorted(rows, key=order),
                "indicators": indicators, "structure": structure, "controls": self.controls(companies),
                "fleet": self.fleet_kpis(companies, date_from, date_to),
                "deficit": [{"key": r["key"], "label": r["label"], "net_result": r["net_result"]} for r in deficit]}

    # ─── Indicateurs de la flotte (modèle d'indicateurs du client) ────────

    @api.model
    def fleet_kpis(self, companies, date_from, date_to):
        """Indicateurs de flotte du modèle du client que les données permettent de calculer, avec ses
        objectifs et seuils d'alerte (FLEET_TARGETS) :
          disponibilité = ensembles en service / ensembles de la flotte (hors cédés), à ce jour ;
          utilisation = jours en rotation / (ensembles de la flotte × jours de la période) ;
          remplissage = volume chargé / capacité des citernes, sur les rotations de la période ;
          respect des délais = rotations revenues (ou livrées) dans la durée standard de leur route ;
          rotations annulées et âge moyen de la flotte (année de fabrication).
        Rotations validées ou facturées de la période, comme la rentabilité."""
        Vehicle = self.env["eguitra.transport.vehicle"].sudo()
        Rotation = self.env["eguitra.transport.rotation"].sudo()
        fleet = Vehicle.search([("company_id", "in", companies.ids), ("state", "!=", "sold")])
        base = [("company_id", "in", companies.ids), ("date_loading", ">=", date_from), ("date_loading", "<=", date_to)]
        rotations = Rotation.search(base + [("state", "in", ("done", "invoiced"))])
        days = (date_to - date_from).days + 1
        filled = rotations.filtered(lambda r: r.vehicle_id.capacity_liters and r.volume_loaded)
        timed = rotations.filtered(lambda r: (r.date_return or r.date_delivery) and r.route_id.duration_days)
        on_time = timed.filtered(lambda r: r.duration_days <= r.route_id.duration_days)
        years = [v.year for v in fleet if v.year]
        today = fields.Date.context_today(self)

        def kpi(code, value, basis):
            target, alert = FLEET_TARGETS.get(code, (None, None))
            return {"value": value, "target": target, "alert": alert, "basis": basis,
                    "below_alert": value is not None and alert is not None and value < alert}

        in_service = len(fleet.filtered(lambda v: v.state == "service"))
        return {
            "availability": kpi("availability", in_service / len(fleet) * 100 if fleet else None, len(fleet)),
            "utilization": kpi("utilization", min(100.0, sum(rotations.mapped("duration_days")) / (len(fleet) * days) * 100)
                               if fleet else None, len(rotations)),
            "fill_rate": kpi("fill_rate", sum(r.volume_loaded * 1000 for r in filled)
                             / sum(r.vehicle_id.capacity_liters for r in filled) * 100 if filled else None, len(filled)),
            "on_time": kpi("on_time", len(on_time) / len(timed) * 100 if timed else None, len(timed)),
            "cancelled": Rotation.search_count(base + [("state", "=", "cancelled")]),
            "fleet_age_years": today.year - sum(years) / len(years) if years else None,
            "vehicles": len(fleet), "in_service": in_service,
        }

    # ─── Contrôles ────────────────────────────────────────────────────────

    @api.model
    def _check_official_rates(self, companies, routes, open_rotations, check):
        """Tarifs des routes rattachées au barème officiel, de leurs clients et des rotations ouvertes,
        comparés au tarif officiel en vigueur : écart au-delà de la tolérance de la société."""
        tolerance = companies[:1].transport_official_rate_tolerance
        day = fields.Date.context_today(self)
        items = []

        def note(label, rate, line):
            gap = gap_pct(rate, line)
            if gap is not None and abs(gap) > tolerance:
                items.append(f"{label} : {fmt_pct(gap, sign=True)} du barème ({fmt_money(line._rate_per_m3())} le m³)")

        for route in routes.filtered("official_rate_id"):
            line = route._official_at(day)
            note(f"{route.name}, tarif par défaut", route.default_rate, line)
            for tariff in route.tariff_ids:
                note(f"{route.name}, {tariff.partner_id.name}", tariff.rate, line)
        for rot in open_rotations.filtered("route_id.official_rate_id"):
            line, _gap = rot._official_gap()
            note(f"Rotation {rot._label()}", rot.rate, line)
        scale = self.env["eguitra.transport.official.scale"]._in_force(day)
        check("official_rate_gap",
              f"Tarifs proches du barème officiel (écart de {fmt_rate(tolerance)} au plus)",
              items,
              f"Barème de référence : {scale.name or 'aucun'}. Vérifiez le tarif du client ou la destination du "
              "barème rattachée à la route (Routes et tarifs) ; l'écart est signalé, rien n'est bloqué.")

    @api.model
    def controls(self, companies):
        """Contrôles permanents de la flotte et des rotations (vigilance, non bloquants)."""
        env = self.env
        Vehicle = env["eguitra.transport.vehicle"]
        in_service = Vehicle.search([("company_id", "in", companies.ids), ("state", "in", IN_SERVICE)])
        checks = []

        def check(code, label, items, hint):
            checks.append({"code": code, "label": label, "ok": not items, "count": len(items),
                           "items": items[:20], "hint": hint})

        check("vehicle_documents",
              "Documents des ensembles en service à jour (assurance, visite technique ; barémage et étanchéité des citernes)",
              [issue["message"] for v in in_service for issue in v._document_issues()],
              "Un document manquant ou expiré s'opposera au départ de l'ensemble ; renouvelez-le (Flotte et chauffeurs).")
        check("vehicle_without_asset", "Ensembles en service rattachés à une immobilisation",
              [v.name for v in in_service.sudo().filtered(lambda v: not v.asset_id)],
              "Rattachez la fiche d'immobilisation (Flotte) : ses dotations entrent dans la structure du transport.")
        drivers = {}
        for vehicle in in_service.filtered("driver_id"):
            drivers.setdefault(vehicle.driver_id, []).append(vehicle.name)
        check("driver_several_vehicles", "Un chauffeur habituel par ensemble en service",
              [f"{d.name} : {', '.join(names)}" for d, names in drivers.items() if len(names) > 1],
              "Un même chauffeur ne conduit pas deux ensembles à la fois : corrigez le chauffeur habituel.")
        routes = env["eguitra.transport.route"].search([("company_id", "in", companies.ids)])
        check("round_trip_inconsistent",
              f"Aller-retour des routes cohérent avec l'aller (écart de {ROUND_TRIP_TOLERANCE * 100:.0f} % au plus)",
              [f"{r.name} : {r.distance_return_km} km pour {r.distance_km} km à l'aller"
               for r in routes.filtered(lambda r: r._round_trip_inconsistent(ROUND_TRIP_TOLERANCE))],
              "Le kilométrage des rotations, et donc les coûts au km et la structure, en dépendent.")
        check("route_without_distance", "Routes avec une distance",
              [r.name for r in routes.filtered(lambda r: not r._round_trip_km())],
              "Sans distance, les rotations n'ont pas de kilométrage : ni coût au km ni part de structure.")
        # Carburant de référence : litres par km comparés à la médiane des routes renseignées.
        ratios = {r: r._fuel_per_km() for r in routes}
        known = sorted(v for v in ratios.values() if v)
        median = known[len(known) // 2] if len(known) >= 3 else None
        check("route_fuel_inconsistent",
              f"Carburant de référence des routes cohérent (écart de {FUEL_TOLERANCE * 100:.0f} % au plus avec la "
              "médiane au km)",
              [f"{r.name} : {v:.2f} L/km pour {median:.2f} L/km en médiane".replace(".", ",")
               for r, v in ratios.items() if v and median and abs(v - median) > FUEL_TOLERANCE * median],
              "Un forfait de carburant trop bas gonfle la marge estimée de la route ; corrigez-le d'après les bons "
              "de carburant.")
        Rotation = env["eguitra.transport.rotation"]
        open_rotations = Rotation.search([("company_id", "in", companies.ids), ("state", "in", ("draft", "done"))])
        self._check_official_rates(companies, routes, open_rotations, check)
        check("over_capacity", "Volumes chargés dans la capacité des citernes",
              [f"{r._label()} : {r.volume_loaded:g} m³ pour {r.vehicle_id.capacity_liters / 1000:g} m³".replace(".", ",")
               for r in open_rotations.filtered("over_capacity")],
              "La validation est refusée tant que le volume ou la capacité n'est pas corrigé.")
        unclaimed = Rotation.search([("company_id", "in", companies.ids), ("state", "=", "invoiced"),
                                     ("shortage_claim", ">", 0), ("shortage_claim_move_id", "=", False)])
        check("shortage_claim_missing", "Créances sur les chauffeurs passées",
              [f"{r.name} : {r.driver_id.name or 'chauffeur non renseigné'}" for r in unclaimed],
              "Chauffeur sans fiche tiers : créez sa fiche, puis passez la créance en opération diverse.")
        return checks
