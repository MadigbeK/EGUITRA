"""Seuils d'alerte paramétrables et alertes de gestion de chaque société.

Chaque règle compare une valeur constatée à un seuil de la société : elle porte un domaine
(trésorerie, clients, financement…), une gravité (bloquante, critique, élevée, moyenne), une action
recommandée et l'écran où agir. Une alerte bloquante interdit la clôture mensuelle. Les règles
conformes se lisent aussi (/finance/alerts?all=1) : la direction voit ce qui est contrôlé, pas
seulement ce qui dérape. Les modules métier ajoutent leurs alertes en héritant de _company_alerts.

Un seuil de montant, de durée ou de taux laissé à 0 désactive sa règle : la règle « Seuils à
renseigner » le signale, pour qu'aucun contrôle ne soit éteint sans que personne ne le sache.
"""

import itertools
from datetime import timedelta

from odoo import api, fields, models

from ..formats import accord, pluriel

# Règles calculées pendant un appel de active_alerts (alertes, puis règles conformes) : le contexte
# ne porte qu'un numéro d'appel, le cache vit le temps de l'appel.
_RULE_CALLS = itertools.count(1)
_RULE_CACHE = {}

ALERT_CODES = [
    ("cash_min", "Trésorerie minimale (GNF)"),
    ("cash_account_negative", "Compte de banque ou de caisse à solde négatif"),
    ("transit_account", "Compte de passage 585 non soldé"),
    ("receivable_overdue_days", "Créances échues depuis plus de (jours)"),
    ("receivable_overdue_amount", "Encours clients échu maximal (GNF)"),
    ("receivable_overdue_share_pct", "Part échue de l'encours clients maximale (%)"),
    ("dso_target_days", "Délai moyen de recouvrement cible (jours)"),
    ("client_concentration_pct", "Concentration maximale sur un client (% du chiffre d'affaires)"),
    ("payable_overdue_amount", "Dettes fournisseurs échues tolérées (GNF)"),
    ("dscr_min", "Couverture minimale du service de la dette (DSCR)"),
    ("net_result_negative", "Résultat net cumulé négatif"),
    ("close_delay_days", "Clôture mensuelle en retard de plus de (jours)"),
    ("transport_margin_min", "Marge transport minimale (%)"),
    ("transport_unbilled", "Rotations validées non facturées depuis plus de (jours)"),
    ("vehicle_deficit", "Ensembles routiers déficitaires après structure tolérés (nombre)"),
    ("budget_overrun_pct", "Dépassement budgétaire toléré (%)"),
    ("approval_delay_days", "Validation en attente depuis plus de (jours)"),
]

# Gravités du prototype de la direction : bloquante, critique, élevée, moyenne.
SEVERITIES = [("info", "Moyenne"), ("warning", "Élevée"), ("critical", "Critique"), ("blocking", "Bloquante")]
SEVERITY_ORDER = {"blocking": 0, "critical": 1, "warning": 2, "info": 3}
STATUS_ORDER = {"alert": 0, "ok": 1, "na": 2}

# Valeur par défaut et gravité de chaque seuil (prototype de la direction ; la trésorerie minimale
# dépend de la société et se fixe avec la direction).
DEFAULTS = {
    "cash_min": (0, "critical"),
    "cash_account_negative": (0, "warning"),
    "transit_account": (0, "blocking"),
    "receivable_overdue_days": (90, "warning"),
    "receivable_overdue_amount": (0, "warning"),
    "receivable_overdue_share_pct": (20, "warning"),
    "dso_target_days": (60, "warning"),
    "client_concentration_pct": (40, "info"),
    "payable_overdue_amount": (0, "warning"),
    "dscr_min": (1.2, "critical"),
    "net_result_negative": (0, "warning"),
    "close_delay_days": (10, "warning"),
    "transport_margin_min": (30, "warning"),
    "transport_unbilled": (0, "info"),
    "vehicle_deficit": (0, "warning"),
    "budget_overrun_pct": (10, "info"),
    "approval_delay_days": (3, "info"),
}

# Seuils dont la valeur 0 éteint la règle (les autres sont des tolérances : 0 = aucune tolérance,
# ou des règles sans valeur).
ZERO_DISABLES = {
    "cash_min", "receivable_overdue_days", "receivable_overdue_amount", "receivable_overdue_share_pct",
    "dso_target_days", "client_concentration_pct", "dscr_min", "close_delay_days", "transport_margin_min",
    "approval_delay_days",
}
# Seuils propres au transport : sans objet dans une société qui n'exerce pas ce métier.
TRANSPORT_CODES = {"transport_margin_min", "transport_unbilled", "vehicle_deficit"}

DOMAINS = {
    "cash_min": "Trésorerie", "cash_account_negative": "Trésorerie", "transit_account": "Trésorerie",
    "receivable_overdue_days": "Clients", "receivable_overdue_amount": "Clients",
    "receivable_overdue_share_pct": "Clients", "dso_target_days": "Clients", "client_concentration_pct": "Clients",
    "payable_overdue_amount": "Fournisseurs", "dscr_min": "Financement", "net_result_negative": "Rentabilité",
    "close_delay_days": "Comptabilité", "transport_margin_min": "Transport", "transport_unbilled": "Transport",
    "vehicle_deficit": "Transport", "budget_overrun_pct": "Budget", "approval_delay_days": "Validation",
}
UNITS = {
    "cash_min": "gnf", "cash_account_negative": "count", "transit_account": "gnf",
    "receivable_overdue_days": "gnf", "receivable_overdue_amount": "gnf", "receivable_overdue_share_pct": "pct",
    "dso_target_days": "days", "client_concentration_pct": "pct", "payable_overdue_amount": "gnf",
    "dscr_min": "ratio", "net_result_negative": "gnf", "close_delay_days": "days", "transport_margin_min": "pct",
    "transport_unbilled": "gnf", "vehicle_deficit": "count", "budget_overrun_pct": "count",
    "approval_delay_days": "count",
}
# Unité du seuil quand elle diffère de celle de la valeur constatée (none : règle sans valeur de seuil).
THRESHOLD_UNITS = {
    "cash_account_negative": "none", "transit_account": "none", "net_result_negative": "none",
    "receivable_overdue_days": "days", "close_delay_days": "days", "transport_unbilled": "days",
    "budget_overrun_pct": "pct", "approval_delay_days": "days",
}
ACTIONS = {
    "cash_min": "Accélérer le recouvrement des créances échues et renégocier l'échéancier des fournisseurs.",
    "cash_account_negative": "Approvisionner le compte par un virement interne ou régulariser l'opération en cause.",
    "transit_account": "Un virement interne a été saisi sans sa contrepartie : passer l'écriture de réception.",
    "receivable_overdue_days": "Mise en demeure, provision pour dépréciation et suspension des livraisons.",
    "receivable_overdue_amount": "Relancer les clients concernés et conditionner les nouvelles commandes au règlement.",
    "receivable_overdue_share_pct": "Revoir les conditions de paiement et conditionner les nouvelles commandes.",
    "dso_target_days": "Mettre en place une relance systématique à J+7 après l'échéance.",
    "client_concentration_pct": "Engager une stratégie de diversification commerciale.",
    "payable_overdue_amount": "Prioriser les fournisseurs stratégiques : carburant, maintenance, assurances.",
    "dscr_min": "Présenter un plan de reprofilage avant la prochaine échéance ; le recouvrement des créances "
                "échues reste le levier le plus rapide.",
    "net_result_negative": "Réunir un comité de direction sur la structure de coûts et la politique tarifaire.",
    "close_delay_days": "Terminer les rapprochements et lancer la clôture du mois.",
    "transport_margin_min": "Réviser la grille tarifaire et analyser la consommation par camion.",
    "transport_unbilled": "Émettre les factures correspondantes : chiffre d'affaires en attente.",
    "vehicle_deficit": "Un camion peut dégager une marge directe correcte et rester déficitaire : revoir son "
                       "affectation, son tarif ou sa cession.",
    "budget_overrun_pct": "Justifier les dépassements avec les responsables et réviser l'enveloppe si nécessaire.",
    "approval_delay_days": "Relancer les approbateurs ou réaffecter les validations en attente.",
}
LINKS = {
    "cash_min": "/finance/pilotage", "cash_account_negative": "/finance/tresorerie",
    "transit_account": "/finance/tresorerie", "receivable_overdue_days": "/finance/relances",
    "receivable_overdue_amount": "/finance/tiers", "receivable_overdue_share_pct": "/finance/tiers",
    "dso_target_days": "/finance/relances", "client_concentration_pct": "/finance/tiers",
    "payable_overdue_amount": "/finance/tiers", "dscr_min": "/finance/dette", "net_result_negative": "/finance/etats",
    "close_delay_days": "/finance/clotures", "transport_margin_min": "/transport/rentabilite",
    "transport_unbilled": "/transport/rotations", "vehicle_deficit": "/transport/rentabilite",
    "budget_overrun_pct": "/finance/pilotage", "approval_delay_days": "/finance/approbations",
}


def _gnf(amount):
    return f"{amount:,.0f} GNF".replace(",", " ")


def _fr(value, digits=1):
    """12,5 : nombre à la française."""
    return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")


def _soft(severity):
    """Gravité d'une règle dérivée (prévision, historique) : jamais bloquante pour la clôture."""
    return "critical" if severity == "blocking" else severity


class EguitraAlertThreshold(models.Model):
    _name = "eguitra.alert.threshold"
    _description = "Seuil d'alerte"
    _order = "company_id, code"

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    code = fields.Selection(ALERT_CODES, required=True)
    value = fields.Float(help="Valeur du seuil ; 0 désactive les seuils de montant, de durée et de taux.")
    severity = fields.Selection(
        SEVERITIES,
        default="warning",
        required=True,
        help="Une alerte bloquante interdit la clôture mensuelle.",
    )
    active = fields.Boolean(default=True)

    _code_company_unique = models.Constraint("unique(company_id, code)", "Un seul seuil par code et par société.")

    @api.model
    def _thresholds(self, company):
        records = self.sudo().search([("company_id", "=", company.id)])
        return {r.code: r for r in records}

    def _alert(self, threshold, title, message, value=None, link=None, company=None, **extra):
        """Alerte (ou règle conforme, status='ok') ; domaine, unité, action et lien par défaut selon le code."""
        code = threshold.code
        data = {
            "key": code,
            "code": code,
            "status": "alert",
            "severity": threshold.severity,
            "domain": DOMAINS.get(code, "Contrôle"),
            "title": title,
            "message": message,
            "value": value,
            "threshold": threshold.value,
            "unit": UNITS.get(code, "gnf"),
            "threshold_unit": THRESHOLD_UNITS.get(code, UNITS.get(code, "gnf")),
            "action": ACTIONS.get(code),
            "link": link if link is not None else LINKS.get(code),
            "company": (company or threshold.company_id).name,
        }
        data.update(extra)
        return data

    def _ok(self, threshold, title, message, value=None, **extra):
        """Règle conforme (ou sans objet avec status='na') : pas d'action à mener."""
        extra.setdefault("status", "ok")
        extra.setdefault("action", None)
        return self._alert(threshold, title, message, value, **extra)

    # ─── Règles de la société ─────────────────────────────────────────────

    @api.model
    def _rules(self, company, today):
        """Règles de gestion d'une société : alertes (status='alert'), règles conformes ('ok') et
        règles sans objet ('na', faute de données : pas de budget, pas de dette…)."""
        self.env.flush_all()
        metrics = self.env["eguitra.finance.metrics"]
        thresholds = self._thresholds(company)
        transport = company.eguitra_entity != "cabinet" and "eguitra.transport.rotation" in self.env
        fy_start, _fy_end = metrics.fiscal_year_bounds(company, today)
        rules = []

        def on(code):
            """Seuil actif de la règle, ou None si la règle est éteinte (seuil absent ou à 0)."""
            t = thresholds.get(code)
            if not t or (code in ZERO_DISABLES and not t.value):
                return None
            if code in TRANSPORT_CODES and not transport:
                return None
            return t

        def add(t, alert, title_alert, title_ok, message, value=None, **extra):
            if alert:
                rules.append(self._alert(t, title_alert, message, value, **extra))
            else:
                rules.append(self._ok(t, title_ok, message, value, **extra))

        receivables = metrics.open_items(company, "asset_receivable", today)
        payables = metrics.open_items(company, "liability_payable", today)

        # --- Trésorerie ---
        t = on("cash_min")
        if t:
            cash = metrics.cash(company, today)
            add(t, cash < t.value, "Trésorerie sous le seuil de sécurité", "Trésorerie au-dessus du seuil de sécurité",
                f"Trésorerie nette de {_gnf(cash)} pour un seuil de {_gnf(t.value)}.", cash)
            low = metrics.monthly_cash(company, today, threshold=t.value)["summary"]["low_point"]
            if low:
                message = f"Point bas de l'exercice fin {low['label']} : {_gnf(low['end'])}."
                if low["end"] < t.value:
                    rules.append(self._alert(
                        t, "Mois sous le seuil de sécurité", message, low["end"], key="cash_min.months",
                        severity="info" if t.severity == "info" else "warning",
                        action="Vérifier la concentration des échéances sur le mois concerné.",
                    ))
                else:
                    rules.append(self._ok(t, "Aucun mois sous le seuil de sécurité", message, low["end"],
                                          key="cash_min.months"))
            forecast = metrics.cash_forecast(company, today)
            lows = [m for m in [forecast["month_end"], *forecast["months"]] if m["end"] < t.value]
            if lows:
                first = lows[0]
                rules.append(self._alert(
                    t, "Trésorerie prévue sous le seuil", f"Trésorerie prévue de {_gnf(first['end'])} fin {first['label']}, "
                    f"compte tenu des échéances clients, fournisseurs et d'emprunt.", first["end"], key="cash_min.forecast",
                    severity=_soft(t.severity),
                    action="Avancer les encaissements attendus ou étaler les décaissements de la période.",
                ))
            else:
                rules.append(self._ok(t, "Trésorerie prévue au-dessus du seuil",
                                      "Fin de mois et trois mois suivants au-dessus du seuil.",
                                      forecast["month_end"]["end"], key="cash_min.forecast"))

        t = thresholds.get("cash_account_negative")
        if t:
            negative = [j for j in metrics.cash_by_journal(company, today) if j["balance"] < -0.5]
            add(t, bool(negative), "Compte de trésorerie à solde négatif", "Aucun compte de trésorerie à solde négatif",
                ("Comptes concernés : " + ", ".join(j["name"] for j in negative) + ".") if negative
                else "Tous les comptes de banque et de caisse sont créditeurs ou nuls.", len(negative))

        t = thresholds.get("transit_account")
        if t:
            balance = metrics._sum_balance(company, ["585"], None, today)
            add(t, abs(balance) > 0.5, "Compte de passage non soldé", "Compte de passage 585 soldé",
                "Un virement interne n'a pas été réceptionné (compte 585)." if abs(balance) > 0.5
                else "Tous les virements internes sont réceptionnés.", balance)

        # --- Clients ---
        t = on("receivable_overdue_days")
        if t:
            limit = today - timedelta(days=int(t.value))
            # Restes dus positifs seulement : un avoir non imputé ou un règlement d'avance n'est pas une
            # créance ancienne.
            self.env.cr.execute(
                """SELECT COALESCE(SUM(aml.amount_residual), 0), COUNT(DISTINCT aml.move_id)
                     FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
                    WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aa.account_type = 'asset_receivable'
                      AND NOT aml.reconciled AND aml.date_maturity < %s AND aml.amount_residual > 0""",
                (company.id, limit),
            )
            amount, count = self.env.cr.fetchone()
            add(t, bool(count), "Créances anciennes", f"Aucune créance échue depuis plus de {int(t.value)} jours",
                f"{pluriel(count, 'facture')} {accord(count, 'échue')} depuis plus de {int(t.value)} jours." if count
                else "Les créances échues sont récentes.", float(amount))

        t = on("receivable_overdue_amount")
        if t:
            overdue = receivables["overdue"]
            add(t, overdue > t.value, "Encours échu élevé", "Encours clients échu dans la limite",
                f"Encours clients échu de {_gnf(overdue)} pour un maximum de {_gnf(t.value)}.", overdue)

        t = on("receivable_overdue_share_pct")
        if t:
            share = receivables["overdue"] / receivables["total"] * 100 if receivables["total"] > 0 else 0.0
            add(t, share > t.value, "Part des créances échues trop élevée", "Part des créances échues dans l'encours",
                f"{_fr(share)} % de l'encours clients est échu ({_gnf(receivables['overdue'])}).", share)

        capital = None
        if on("dso_target_days") or on("client_concentration_pct"):
            capital = metrics.working_capital(company, fy_start, today)
        t = on("dso_target_days")
        if t:
            dso = capital["dso"]
            if dso is None:
                rules.append(self._ok(t, "Délai moyen de recouvrement", "Aucune vente sur l'exercice.", None,
                                      status="na"))
            else:
                add(t, dso > t.value, "Délai de recouvrement au-delà de la cible", "Délai moyen de recouvrement",
                    f"DSO de {_fr(dso)} jours pour une cible de {_fr(t.value, 0)} jours.", dso)

        t = on("client_concentration_pct")
        if t:
            top = capital["concentration"]
            if top["pct"] is None:
                rules.append(self._ok(t, "Concentration sur un seul client", "Aucune vente sur l'exercice.", None,
                                      status="na"))
            else:
                add(t, top["pct"] > t.value, "Concentration sur un seul client", "Concentration sur un seul client",
                    f"Premier client ({top['partner'] or '?'}) : {_fr(top['pct'])} % du chiffre d'affaires de "
                    "l'exercice.", top["pct"])

        # --- Fournisseurs ---
        t = thresholds.get("payable_overdue_amount")
        if t:
            overdue = payables["overdue"]
            add(t, overdue > t.value + 0.5, "Dettes fournisseurs échues", "Dettes fournisseurs à jour",
                f"Dettes fournisseurs échues : {_gnf(overdue)}.", overdue)

        # --- Financement ---
        t = on("dscr_min")
        if t:
            dscr = metrics.dscr(company, today)
            if dscr["dscr"] is None:
                rules.append(self._ok(t, "Couverture du service de la dette",
                                      "Aucun service de dette sur douze mois.", None, status="na"))
            else:
                add(t, dscr["dscr"] < t.value, "Couverture du service de la dette insuffisante",
                    "Couverture du service de la dette",
                    f"DSCR de {_fr(dscr['dscr'], 2)} pour un minimum de {_fr(t.value, 2)}.", dscr["dscr"])

        # --- Rentabilité ---
        t = thresholds.get("net_result_negative")
        if t:
            result = self.env["eguitra.syscohada"].income_statement(company, fy_start, today)["totals"].get("XI", 0.0)
            add(t, result < 0, "Résultat net négatif", "Résultat net positif",
                f"Résultat net cumulé de l'exercice : {_gnf(result)}.", result)

        # --- Comptabilité ---
        t = on("close_delay_days")
        if t:
            last_month_end = today.replace(day=1) - timedelta(days=1)
            closed = self.env["eguitra.period.close"].sudo().search_count([
                ("company_id", "=", company.id), ("period", "=", last_month_end.replace(day=1)), ("state", "=", "closed"),
            ])
            has_entries = self.env["account.move"].sudo().search_count([
                ("company_id", "=", company.id), ("state", "=", "posted"), ("date", "<=", last_month_end),
            ], limit=1)
            late = has_entries and not closed and (today - last_month_end).days > t.value
            add(t, late, "Clôture en retard", "Clôtures à jour",
                f"Le mois de {last_month_end:%m/%Y} n'est pas clôturé." if late
                else f"Le mois de {last_month_end:%m/%Y} est clôturé ou dans le délai.", None)

        # --- Budget ---
        t = thresholds.get("budget_overrun_pct")
        if t:
            status = metrics.budget_status(company, today, threshold=t.value)
            if not status:
                rules.append(self._ok(t, "Lignes budgétaires dans l'enveloppe", "Aucun budget pour l'exercice.", None,
                                      status="na"))
            else:
                over = status["overruns"]
                add(t, bool(over), "Lignes budgétaires en dépassement", "Lignes budgétaires dans l'enveloppe",
                    ("Concernées : " + " ; ".join(f"{o['code']} {o['name']}" for o in over[:5]) + ".") if over
                    else f"Budget cumulé respecté à fin {status['through']:%m/%Y}, tolérance {_fr(t.value, 0)} %.", len(over))

        # --- Transport ---
        if transport:
            rules += self._transport_rules(company, today, on)

        # --- Paramétrage : seuils laissés à 0 ---
        zero = [
            r for code, r in thresholds.items()
            if code in ZERO_DISABLES and not r.value and (code not in TRANSPORT_CODES or transport)
        ]
        labels = dict(self._fields["code"].selection)
        vigilance = {
            "key": "settings.zero", "code": "settings", "severity": "info", "domain": "Paramétrage",
            "value": len(zero), "threshold": 0, "unit": "count", "threshold_unit": "none",
            "link": "/finance/admin/parametres",
            "company": company.name,
        }
        if zero:
            rules.append(dict(vigilance, status="alert", title="Seuils à renseigner",
                              message="Règles éteintes faute de seuil : " + ", ".join(labels[r.code] for r in zero) + ".",
                              action="Fixer ces seuils avec la direction, ou les désactiver s'ils sont sans objet."))
        else:
            rules.append(dict(vigilance, status="ok", title="Tous les seuils sont renseignés",
                              message="Aucune règle n'est éteinte par un seuil à 0.", action=None))
        return rules

    def _transport_rules(self, company, today, on):
        """Règles du transport sur l'exercice : marge globale, rotations non facturées, camions
        déficitaires après charges de structure (si le module transport les calcule)."""
        metrics = self.env["eguitra.finance.metrics"]
        fy_start, _fy_end = metrics.fiscal_year_bounds(company, today)
        kpis = metrics.transport_kpis(company, fy_start, today)
        rules = []
        if not kpis:
            return rules

        t = on("transport_margin_min")
        if t:
            if kpis["margin_rate"] is None:
                rules.append(self._ok(t, "Marge directe du transport", "Aucune rotation validée sur l'exercice.", None,
                                      status="na", key="transport_margin_min.global"))
            else:
                rate = kpis["margin_rate"]
                rules.append(
                    (self._alert if rate < t.value else self._ok)(
                        t, "Marge directe du transport sous le seuil" if rate < t.value else "Marge directe du transport",
                        f"Marge directe de {_fr(rate)} % sur {pluriel(kpis['rotations'], 'rotation')} de l'exercice, "
                        f"seuil {_fr(t.value, 0)} %.", rate, key="transport_margin_min.global",
                    )
                )

        t = on("transport_unbilled")
        if t:
            limit = today - timedelta(days=int(t.value or 0))
            late = [r for r in kpis["unbilled"]["items"] if r["date"] <= limit]
            amount = sum(r["revenue"] for r in late)
            rules.append(
                (self._alert if late else self._ok)(
                    t, "Rotations non facturées" if late else "Rotations réalisées et facturées",
                    f"{pluriel(len(late), 'rotation')} {accord(len(late), 'validée')} {accord(len(late), 'non facturée', 'non facturées')}, "
                    f"{_gnf(amount)} de chiffre d'affaires en attente."
                    if late else "Toutes les rotations validées sont facturées.", amount,
                )
            )

        t = on("vehicle_deficit")
        if t:
            vehicles = kpis["vehicles"]
            if vehicles["basis"] != "net":
                rules.append(self._ok(t, "Camions à résultat net positif après structure",
                                      "Résultat après charges de structure non calculé par le module transport.",
                                      None, status="na"))
            else:
                deficit = vehicles["deficit"]
                rules.append(
                    (self._alert if len(deficit) > t.value else self._ok)(
                        t, "Camions déficitaires après structure" if len(deficit) > t.value
                        else "Camions à résultat net positif après structure",
                        (f"{len(deficit)} sur {vehicles['count']} : " + ", ".join(v["label"] for v in deficit[:6])
                         + f", perte cumulée de {_gnf(-vehicles['loss'])}.") if deficit
                        else "Toute la flotte couvre ses charges de structure.", len(deficit),
                    )
                )
        return rules

    # ─── Lecture ──────────────────────────────────────────────────────────

    @api.model
    def _company_rules(self, company, today):
        """Règles d'une société, calculées une fois par appel de active_alerts."""
        cache = _RULE_CACHE.get(self.env.context.get("eguitra_rule_cache"))
        key = (company.id, today)
        if cache is not None and key in cache:
            return cache[key]
        rules = self._rules(company, today)
        if cache is not None:
            cache[key] = rules
        return rules

    @api.model
    def _company_alerts(self, company, today):
        """Alertes d'une société ; les modules métier complètent cette liste par héritage."""
        return [r for r in self._company_rules(company, today) if r["status"] == "alert"]

    @api.model
    def active_alerts(self, companies, today, include_ok=False):
        """Alertes actives des sociétés, de la plus grave à la moins grave ; avec include_ok, les
        règles conformes et sans objet suivent."""
        token = next(_RULE_CALLS)
        _RULE_CACHE[token] = {}
        cached = self.with_context(eguitra_rule_cache=token)
        alerts = []
        try:
            for company in companies:
                found = cached._company_alerts(company, today)
                alerts += found
                if include_ok:
                    raised = {a.get("key") or a["code"] for a in found}
                    alerts += [r for r in cached._company_rules(company, today)
                               if r["status"] != "alert" and r["key"] not in raised]
        finally:
            _RULE_CACHE.pop(token, None)
        for a in alerts:  # alertes des modules métier : clés communes
            a.setdefault("status", "alert")
            a.setdefault("key", a.get("code"))
            a.setdefault("domain", DOMAINS.get(a.get("code"), "Contrôle"))
            a.setdefault("unit", UNITS.get(a.get("code"), "gnf"))
            a.setdefault("threshold_unit", THRESHOLD_UNITS.get(a.get("code"), a["unit"]))
            a.setdefault("action", ACTIONS.get(a.get("code")) if a["status"] == "alert" else None)
        return sorted(alerts, key=lambda a: (STATUS_ORDER.get(a["status"], 3), SEVERITY_ORDER.get(a["severity"], 4)))

    @api.model
    def ensure_defaults_all(self):
        for company in self.env["res.company"].sudo().search([]):
            self.ensure_defaults(company)

    @api.model
    def ensure_defaults(self, company):
        """Seuils par défaut d'une société, à ajuster par l'administration (un seuil désactivé
        n'est pas recréé)."""
        existing = set(self.sudo().with_context(active_test=False).search(
            [("company_id", "=", company.id)]).mapped("code"))
        for code, (value, severity) in DEFAULTS.items():
            if code not in existing:
                self.sudo().create({"company_id": company.id, "code": code, "value": value, "severity": severity})
