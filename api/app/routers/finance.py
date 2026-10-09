"""Router /finance/* — indicateurs du tableau de bord dirigeant (lecture Odoo).

Toutes les lectures passent par la base Odoo en lecture seule. Les écritures
(factures, paiements, approbations) passeront par JSON-RPC dans les routers
dédiés ventes / achats / trésorerie.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.odoo_session import get_odoo_session
from app.models.users import User

router = APIRouter()

STAFF_ROLES = {"super_admin", "dg", "finance", "exploitation", "chantiers", "immobilier", "cabinet"}


def _require_staff(user: User) -> None:
    if user.role not in STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="staff_only")


def _num(v) -> float:
    if v is None:
        return 0.0
    return float(v) if isinstance(v, (Decimal, int, float)) else float(str(v))


class MoisMontant(BaseModel):
    mois: str
    montant: float


class DashboardDirigeant(BaseModel):
    exercice: int
    ca_exercice: float
    ca_mois: float
    ca_mois_precedent: float
    achats_exercice: float
    resultat_exercice: float
    tresorerie: float
    encours_clients: float
    encours_clients_echu: float
    encours_fournisseurs: float
    nb_factures_clients_impayees: int
    nb_factures_fournisseurs_a_payer: int
    ca_par_mois: list[MoisMontant]
    tresorerie_par_compte: list[dict]


@router.get("/dashboard", response_model=DashboardDirigeant, summary="Tableau de bord du dirigeant")
async def dashboard(
    user: User = Depends(get_current_user),
    odoo: AsyncSession = Depends(get_odoo_session),
) -> DashboardDirigeant:
    _require_staff(user)
    today = date.today()
    debut_exercice = today.replace(month=1, day=1)
    debut_mois = today.replace(day=1)
    debut_mois_prec = (debut_mois.replace(day=1) - timedelta(days=1)).replace(day=1)

    async def scalar(sql: str, **p) -> float:
        return _num((await odoo.execute(text(sql), p)).scalar())

    ca_sql = (
        "SELECT COALESCE(SUM(amount_untaxed_signed),0) FROM account_move "
        "WHERE state='posted' AND move_type IN ('out_invoice','out_refund') "
        "AND invoice_date >= :d1 AND invoice_date <= :d2"
    )
    ca_exercice = await scalar(ca_sql, d1=debut_exercice, d2=today)
    ca_mois = await scalar(ca_sql, d1=debut_mois, d2=today)
    ca_mois_prec = await scalar(ca_sql, d1=debut_mois_prec, d2=debut_mois - timedelta(days=1))

    achats_exercice = await scalar(
        "SELECT COALESCE(-SUM(amount_untaxed_signed),0) FROM account_move "
        "WHERE state='posted' AND move_type IN ('in_invoice','in_refund') "
        "AND invoice_date >= :d1 AND invoice_date <= :d2",
        d1=debut_exercice, d2=today,
    )

    # Résultat = produits - charges sur les comptes de classe 6 et 7 (SYSCOHADA) via les types Odoo
    resultat = await scalar(
        "SELECT COALESCE(-SUM(aml.balance),0) FROM account_move_line aml "
        "JOIN account_move am ON am.id = aml.move_id "
        "JOIN account_account aa ON aa.id = aml.account_id "
        "WHERE am.state='posted' AND aml.date >= :d1 AND aml.date <= :d2 "
        "AND aa.account_type IN ('income','income_other','expense','expense_depreciation','expense_direct_cost')",
        d1=debut_exercice, d2=today,
    )

    tresorerie = await scalar(
        "SELECT COALESCE(SUM(aml.balance),0) FROM account_move_line aml "
        "JOIN account_move am ON am.id = aml.move_id "
        "JOIN account_account aa ON aa.id = aml.account_id "
        "WHERE am.state='posted' AND aa.account_type = 'asset_cash'"
    )

    enc = (await odoo.execute(text(
        "SELECT COALESCE(SUM(amount_residual_signed),0) AS total, "
        "COALESCE(SUM(CASE WHEN invoice_date_due < CURRENT_DATE THEN amount_residual_signed ELSE 0 END),0) AS echu, "
        "COUNT(*) AS nb FROM account_move WHERE state='posted' AND move_type='out_invoice' "
        "AND payment_state IN ('not_paid','partial')"
    ))).mappings().first()
    enf = (await odoo.execute(text(
        "SELECT COALESCE(-SUM(amount_residual_signed),0) AS total, COUNT(*) AS nb FROM account_move "
        "WHERE state='posted' AND move_type='in_invoice' AND payment_state IN ('not_paid','partial')"
    ))).mappings().first()

    mois = (await odoo.execute(text(
        "SELECT to_char(date_trunc('month', invoice_date),'YYYY-MM') AS mois, "
        "COALESCE(SUM(amount_untaxed_signed),0) AS montant FROM account_move "
        "WHERE state='posted' AND move_type IN ('out_invoice','out_refund') "
        "AND invoice_date >= :d1 GROUP BY 1 ORDER BY 1"
    ), {"d1": debut_exercice})).mappings().all()

    comptes = (await odoo.execute(text(
        "SELECT COALESCE(aa.name->>'fr_FR', aa.name->>'en_US') AS libelle, "
        "COALESCE(SUM(aml.balance),0) AS solde FROM account_move_line aml "
        "JOIN account_move am ON am.id = aml.move_id "
        "JOIN account_account aa ON aa.id = aml.account_id "
        "WHERE am.state='posted' AND aa.account_type='asset_cash' GROUP BY 1 ORDER BY 2 DESC"
    ))).mappings().all()

    return DashboardDirigeant(
        exercice=today.year,
        ca_exercice=ca_exercice,
        ca_mois=ca_mois,
        ca_mois_precedent=ca_mois_prec,
        achats_exercice=achats_exercice,
        resultat_exercice=resultat,
        tresorerie=tresorerie,
        encours_clients=_num(enc["total"]) if enc else 0.0,
        encours_clients_echu=_num(enc["echu"]) if enc else 0.0,
        encours_fournisseurs=_num(enf["total"]) if enf else 0.0,
        nb_factures_clients_impayees=int(enc["nb"]) if enc else 0,
        nb_factures_fournisseurs_a_payer=int(enf["nb"]) if enf else 0,
        ca_par_mois=[MoisMontant(mois=m["mois"], montant=_num(m["montant"])) for m in mois],
        tresorerie_par_compte=[{"libelle": c["libelle"], "solde": _num(c["solde"])} for c in comptes],
    )
