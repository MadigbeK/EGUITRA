"""Moteur de rapports — compose un SELECT paramétré SÛR depuis une définition.

Sécurité : aucune entrée client n'est interpolée en SQL brut.
- report key → validé contre REPORTS
- colonnes / tri → validés contre le whitelist du rapport (clés)
- période / filtres → valeurs liées en paramètres (:date_from, :f_xxx)
Le seul SQL "libre" provient des exprs du registre (côté serveur, de confiance).
"""
from __future__ import annotations

from datetime import date, timedelta

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.reports.registry import REPORTS, Report

log = structlog.get_logger()

MAX_LIMIT = 5000
DEFAULT_LIMIT = 200

# Détection du coût produit, mise en cache après la 1re requête.
_cost_expr: str | None = None


async def resolve_cost_expr(odoo: AsyncSession) -> str:
    """Détecte où vit standard_price ; '0' si absent → marges = CA (dégradé propre)."""
    global _cost_expr
    if _cost_expr is not None:
        return _cost_expr
    try:
        rows = (await odoo.execute(text(
            "SELECT table_name FROM information_schema.columns "
            "WHERE column_name='standard_price' "
            "AND table_name IN ('product_template','product_product')"
        ))).scalars().all()
        tables = set(rows)
        if "product_template" in tables:
            _cost_expr = "COALESCE(pt.standard_price,0)"
        elif "product_product" in tables:
            _cost_expr = "COALESCE(pp.standard_price,0)"
        else:
            _cost_expr = "0"
    except Exception as e:  # noqa: BLE001
        log.warning("reports.cost_detect_failed", error=str(e))
        _cost_expr = "0"
    return _cost_expr


def resolve_period(period: str | None) -> tuple[date | None, date | None]:
    """Token période → (date_from, date_to). 'all'/None → pas de filtre."""
    if not period or period == "all":
        return None, None
    today = date.today()
    if period == "today":
        return today, today
    if period == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if period == "7d":
        return today - timedelta(days=7), today
    if period == "30d":
        return today - timedelta(days=30), today
    if period == "month":
        return today.replace(day=1), today
    if period == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    if period == "quarter":
        q_first_month = 3 * ((today.month - 1) // 3) + 1
        return today.replace(month=q_first_month, day=1), today
    if period == "year":
        return today.replace(month=1, day=1), today
    if period == "12m":
        return today - timedelta(days=365), today
    return None, None


def _agg_wrap(agg: str, expr: str) -> str:
    a = (agg or "").lower()
    if a == "count":
        return "COUNT(*)"
    if a in ("sum", "avg", "min", "max"):
        # Si l'expr est déjà agrégée (mode group, expr contient déjà SUM(...)),
        # on ne ré-emballe pas : on détecte un mot-clé agg en tête.
        head = expr.lstrip().upper()
        if head.startswith(("SUM(", "AVG(", "MIN(", "MAX(", "COUNT(", "ROUND(", "CASE")):
            return expr
        return f"{a.upper()}({expr})"
    return expr


async def run_report(
    odoo: AsyncSession,
    report_key: str,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    columns: list[str] | None = None,
    filters: dict | None = None,
    sort: str | None = None,
    sort_dir: str = "desc",
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> dict:
    rep: Report | None = REPORTS.get(report_key)
    if rep is None:
        raise ValueError(f"unknown_report:{report_key}")

    filters = filters or {}
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    offset = max(0, int(offset or 0))
    sort_dir = "ASC" if str(sort_dir).lower() == "asc" else "DESC"

    # Colonnes sélectionnées (validées) ou défaut
    by_key = {c.key: c for c in rep.columns}
    if columns:
        sel = [by_key[k] for k in columns if k in by_key]
    else:
        sel = [c for c in rep.columns if c.default]
    if not sel:
        sel = list(rep.columns)

    cost = await resolve_cost_expr(odoo)

    def _expr(c) -> str:
        return c.expr.replace("{cost}", cost)

    # SELECT
    if rep.mode == "group":
        select_parts = []
        group_dims = []
        for c in sel:
            e = _expr(c)
            if c.agg:
                select_parts.append(f"{_agg_wrap(c.agg, e)} AS {c.key}")
            else:
                select_parts.append(f"{e} AS {c.key}")
                group_dims.append(e)
    else:
        select_parts = [f"{_expr(c)} AS {c.key}" for c in sel]
        group_dims = []

    # WHERE
    where = ["1=1"]
    params: dict = {}
    if rep.base_where:
        where.append(rep.base_where)
    if rep.date_field and date_from:
        where.append(f"{rep.date_field}::date >= :date_from")
        params["date_from"] = date_from
    if rep.date_field and date_to:
        where.append(f"{rep.date_field}::date <= :date_to")
        params["date_to"] = date_to
    for f in rep.filters:
        v = filters.get(f.key)
        if v not in (None, "", "all"):
            where.append(f.sql)
            params[f"f_{f.key}"] = v
    where_sql = " AND ".join(where)

    # ORDER BY — par alias de colonne (sûr : alias = clé validée)
    order_key = sort if (sort and sort in by_key and sort in {c.key for c in sel}) else None
    if not order_key:
        order_key = rep.default_order if rep.default_order in {c.key for c in sel} else sel[0].key
        if not sort:
            sort_dir = "ASC" if rep.default_order_dir == "asc" else "DESC"
    order_sql = f'ORDER BY "{order_key}" {sort_dir} NULLS LAST'

    base_sql = f"SELECT {', '.join(select_parts)} {rep.base} WHERE {where_sql}"
    if group_dims:
        base_sql += f" GROUP BY {', '.join(group_dims)}"
    data_sql = f"{base_sql} {order_sql} LIMIT :limit OFFSET :offset"

    qp = {**params, "limit": limit, "offset": offset}
    rows = (await odoo.execute(text(data_sql), qp)).mappings().all()

    # Totaux : agrège les colonnes mesures sur l'ensemble filtré (sans LIMIT)
    totals: dict = {}
    agg_cols = [c for c in sel if c.agg in ("sum", "count", "avg")]
    if agg_cols:
        tparts = []
        for c in agg_cols:
            e = _expr(c)
            if rep.mode == "group":
                # ré-agrège la mesure brute : on retire l'enveloppe agg externe
                # en recomposant depuis l'expr de base si possible. Sinon SUM de l'alias
                # via sous-requête.
                tparts.append(f"{_agg_wrap(c.agg, e)} AS {c.key}")
            else:
                tparts.append(f"{_agg_wrap(c.agg, e)} AS {c.key}")
        try:
            if rep.mode == "group":
                # SUM/COUNT sur la base brute (grand total, pas par groupe)
                tsql = (
                    f"SELECT {', '.join(tparts)} {rep.base} WHERE {where_sql}"
                )
            else:
                tsql = f"SELECT {', '.join(tparts)} {rep.base} WHERE {where_sql}"
            trow = (await odoo.execute(text(tsql), params)).mappings().first()
            if trow:
                totals = {k: (float(v) if v is not None else 0) for k, v in trow.items()}
        except Exception as e:  # noqa: BLE001
            log.warning("reports.totals_failed", report=report_key, error=str(e))
            totals = {}

    # count total (pour pagination) — léger : COUNT(*) sur la même base/where
    total_count = None
    try:
        if rep.mode == "group":
            csql = f"SELECT COUNT(*) FROM (SELECT 1 {rep.base} WHERE {where_sql}"
            csql += (f" GROUP BY {', '.join(group_dims)}" if group_dims else "") + ") z"
        else:
            csql = f"SELECT COUNT(*) {rep.base} WHERE {where_sql}"
        total_count = (await odoo.execute(text(csql), params)).scalar()
    except Exception:  # noqa: BLE001
        total_count = None

    return {
        "report": report_key,
        "label": rep.label,
        "mode": rep.mode,
        "columns": [
            {"key": c.key, "label": c.label, "type": c.type, "align": c.align, "agg": c.agg}
            for c in sel
        ],
        "rows": [dict(r) for r in rows],
        "totals": totals,
        "total_count": int(total_count) if total_count is not None else len(rows),
        "limit": limit,
        "offset": offset,
        "has_next": (total_count is not None and offset + limit < total_count),
    }
