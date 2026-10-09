"""Router /reports/* — moteur de rapports BI (staff / direction).

- GET  /reports/catalog        → rapports dispo + colonnes + presets
- POST /reports/run            → exécute un rapport (filtres date/colonnes)
- POST /reports/export         → même chose en CSV (UTF-8 BOM)
"""

from __future__ import annotations

import csv
import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.odoo_session import get_odoo_session
from app.models.users import User
from app.reports import engine
from app.reports.registry import list_catalog

router = APIRouter()


def _require_staff(user: User) -> None:
    if user.role == "client":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="staff_only")


class RunRequest(BaseModel):
    report: str
    period: str | None = None  # token : today|month|12m|all...
    date_from: date | None = None  # surcharge explicite
    date_to: date | None = None
    columns: list[str] | None = None
    filters: dict[str, str] | None = None
    sort: str | None = None
    sort_dir: str = "desc"
    limit: int = Field(default=200, ge=1, le=5000)
    offset: int = Field(default=0, ge=0)


def _resolve_dates(req: RunRequest) -> tuple[date | None, date | None]:
    if req.date_from or req.date_to:
        return req.date_from, req.date_to
    return engine.resolve_period(req.period)


@router.get("/catalog", summary="Catalogue des rapports disponibles")
async def catalog(user: User = Depends(get_current_user)):
    _require_staff(user)
    return list_catalog()


@router.post("/run", summary="Exécuter un rapport")
async def run(
    req: RunRequest,
    user: User = Depends(get_current_user),
    odoo: AsyncSession = Depends(get_odoo_session),
):
    _require_staff(user)
    date_from, date_to = _resolve_dates(req)
    try:
        result = await engine.run_report(
            odoo,
            req.report,
            date_from=date_from,
            date_to=date_to,
            columns=req.columns,
            filters=req.filters,
            sort=req.sort,
            sort_dir=req.sort_dir,
            limit=req.limit,
            offset=req.offset,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"report_error: {e}")
    result["period"] = {
        "from": date_from.isoformat() if date_from else None,
        "to": date_to.isoformat() if date_to else None,
    }
    return result


@router.post("/export", summary="Exporter un rapport en CSV")
async def export(
    req: RunRequest,
    user: User = Depends(get_current_user),
    odoo: AsyncSession = Depends(get_odoo_session),
):
    _require_staff(user)
    date_from, date_to = _resolve_dates(req)
    try:
        result = await engine.run_report(
            odoo,
            req.report,
            date_from=date_from,
            date_to=date_to,
            columns=req.columns,
            filters=req.filters,
            sort=req.sort,
            sort_dir=req.sort_dir,
            limit=5000,
            offset=0,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    cols = result["columns"]
    buf = io.StringIO()
    buf.write("﻿")  # BOM Excel
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow([c["label"] for c in cols])
    for row in result["rows"]:
        writer.writerow([row.get(c["key"], "") for c in cols])
    # ligne totaux
    if result.get("totals"):
        totline = []
        for i, c in enumerate(cols):
            if i == 0:
                totline.append("TOTAL")
            elif c["key"] in result["totals"]:
                totline.append(result["totals"][c["key"]])
            else:
                totline.append("")
        writer.writerow(totline)

    content = buf.getvalue().encode("utf-8")
    filename = f"rapport_{req.report}_{(date_to or date.today()).isoformat()}.csv"
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
