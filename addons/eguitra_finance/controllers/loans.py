"""Dette et financement : emprunts, crédits-bails, échéanciers, règlements, DSCR."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from .common import FIN_READ, FIN_WRITE, as_float, companies, parse_date, today
from .moves import chosen_account

# Paramètres de l'échéancier : fixés à la création, corrigeables tant que le financement est en brouillon.
SCHEDULE_KEYS = ("kind", "periodicity", "method", "partner_id", "principal", "annual_rate", "start_date",
                 "first_due_date", "duration_months", "grace_months", "principal_account_id", "interest_account_id",
                 "journal_id")
SELECTIONS = {"kind": ("loan", "lease"), "periodicity": ("monthly", "quarterly", "semiannual", "annual"),
              "method": ("annuity", "linear")}
ACCOUNTS = (("principal_account_id", "Compte de dette"), ("interest_account_id", "Compte de charges financières"))


def _loan(loan_id):
    loan = request.env["eguitra.loan"].browse(loan_id).exists()
    if not loan:
        raise ApiError(404, "not_found", "Financement introuvable.")
    return loan


def _integer(data, key, label, minimum):
    value = data.get(key)
    try:
        number = float(value if value not in (None, "") else 0)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"{label} : nombre entier attendu.") from e
    if not number.is_integer() or number < minimum:
        raise ApiError(422, "business_rule", f"{label} : nombre entier d'au moins {minimum} attendu.")
    return int(number)


def _schedule_values(data, company, loan=None):
    """Paramètres de l'échéancier reçus de l'écran : tous à la création, ceux qui changent pour la correction
    d'un brouillon (loan). Comptes du financement fixés avec le droit « Saisie libre des comptes » ; un compte
    inchangé à la correction ne l'exige pas."""
    values = {}
    for key, allowed in SELECTIONS.items():
        if data.get(key):
            if data[key] not in allowed:
                raise ApiError(400, "invalid_parameter", f"Valeur inconnue : {key}.")
            values[key] = data[key]
    if "partner_id" in data:
        if not data["partner_id"]:
            raise ApiError(400, "missing_fields", "Le prêteur est obligatoire.", fields=["partner_id"])
        values["partner_id"] = int(data["partner_id"])
    if "principal" in data:
        values["principal"] = as_float(data["principal"], "principal")
        if values["principal"] <= 0:
            raise ApiError(422, "business_rule", "Le montant emprunté doit être positif.")
    if "annual_rate" in data:
        values["annual_rate"] = as_float(data["annual_rate"] or 0, "annual_rate")
        if values["annual_rate"] < 0:
            raise ApiError(422, "business_rule", "Le taux annuel ne peut pas être négatif.")
    if "start_date" in data:
        values["start_date"] = parse_date(data, "start_date")
        if not values["start_date"]:
            raise ApiError(400, "missing_fields", "La date de déblocage est obligatoire.", fields=["start_date"])
    if "first_due_date" in data:
        values["first_due_date"] = parse_date(data, "first_due_date") or False
    if "duration_months" in data:
        values["duration_months"] = _integer(data, "duration_months", "Durée (mois)", 1)
    if "grace_months" in data:
        values["grace_months"] = _integer(data, "grace_months", "Différé (mois)", 0)
    duration = values.get("duration_months", loan.duration_months if loan else 0)
    grace = values.get("grace_months", loan.grace_months if loan else 0)
    if duration and grace >= duration:
        raise ApiError(422, "business_rule", "Le différé doit être plus court que la durée du financement.")
    for key, label in ACCOUNTS:
        if key in data:
            current = loan[key] if loan else None
            values[key] = chosen_account(data[key], company, label, allowed=current).id if data[key] else False
    if "journal_id" in data:
        journal = request.env["account.journal"].browse(int(data["journal_id"])).exists() if data["journal_id"] else None
        if data["journal_id"] and (not journal or journal.company_id != company or journal.type not in ("bank", "cash")):
            raise ApiError(422, "business_rule", "Journal de règlement : un journal de banque ou de caisse de la société.")
        values["journal_id"] = journal.id if journal else False
    return values


def _row(loan, lines=False):
    data = {
        "id": loan.id,
        "name": loan.name,
        "kind": loan.kind,
        "lender": {"id": loan.partner_id.id, "name": loan.partner_id.name},
        "purpose": loan.purpose or None,
        "principal": loan.principal,
        "annual_rate": loan.annual_rate,
        "start_date": loan.start_date,
        "duration_months": loan.duration_months,
        "grace_months": loan.grace_months,
        "periodicity": loan.periodicity,
        "method": loan.method,
        "state": loan.state,
        "outstanding": loan.outstanding,
        "first_due_date": loan.first_due_date or None,
        "principal_account": loan.principal_account_id.code or None,
        "interest_account": loan.interest_account_id.code or None,
        "journal": loan.journal_id.name or None,
        # Identifiants, pour reprendre le brouillon dans le formulaire de correction.
        "principal_account_id": loan.principal_account_id.id or None,
        "interest_account_id": loan.interest_account_id.id or None,
        "journal_id": loan.journal_id.id or None,
    }
    if lines:
        data["schedule"] = [
            {"id": l.id, "sequence": l.sequence, "due_date": l.due_date, "principal": l.principal,
             "interest": l.interest, "total": l.total, "remaining": l.remaining, "paid": l.paid,
             # Règlement soumis au circuit des décaissements (pending), refusé, en brouillon, ou à régler.
             "settlement": l.settlement_state(),
             "move_id": l.move_id.id or None, "statement_line_id": l.statement_line_id.id or None}
            for l in loan.line_ids
        ]
    return data


class EguitraFinanceLoans(http.Controller):
    @api_route("/finance/loans", profiles=FIN_READ)
    def list_loans(self, **kw):
        loans = request.env["eguitra.loan"].search([("company_id", "in", companies(kw).ids)])
        # Échéanciers et comptabilité : encours comptable, écart, dette nette, gearing, dette / EBE.
        summary = request.env["eguitra.finance.metrics"].sudo().debt_position(companies(kw), today())
        return {"items": [_row(l) for l in loans], "summary": summary}

    @api_route("/finance/loans/<int:loan_id>", profiles=FIN_READ)
    def get_loan(self, loan_id, **_kw):
        return _row(_loan(loan_id), lines=True)

    @api_route("/finance/loans", methods=("POST",), profiles=FIN_WRITE)
    def create_loan(self, **_kw):
        data = read_json()
        require(data, "name", "partner_id", "principal", "start_date", "duration_months")
        values = {k: data[k] for k in ("name", "purpose") if data.get(k)}
        # Comptes du financement : contrepartie de ses échéances et de ses opérations de trésorerie,
        # fixés avec le droit « Saisie libre des comptes ».
        values.update(_schedule_values(data, request.env.company))
        values["company_id"] = request.env.company.id
        loan = request.env["eguitra.loan"].create(values)
        loan.compute_schedule()
        if data.get("activate"):
            loan.action_activate()
        return _row(loan, lines=True)

    @api_route("/finance/loans/<int:loan_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_loan(self, loan_id, **_kw):
        """Référence et objet d'un financement ; en brouillon, aussi les paramètres de l'échéancier (nature,
        prêteur, montant, taux, déblocage, première échéance, durée, différé, périodicité, méthode, comptes,
        journal), recalculé aussitôt. Mis en service, le financement garde son échéancier."""
        loan = _loan(loan_id)
        data = read_json()
        values = {k: (data[k] or False) for k in ("name", "purpose") if k in data}
        if "name" in values and not values["name"]:
            raise ApiError(400, "missing_fields", "La référence est obligatoire.", fields=["name"])
        changed = [k for k in SCHEDULE_KEYS if k in data]
        if changed and loan.state != "draft":
            raise ApiError(422, "business_rule", "Financement mis en service : son échéancier ne se modifie plus ; "
                                                 "seuls sa référence et son objet changent.")
        schedule = _schedule_values(data, loan.company_id, loan) if changed else {}
        loan.write(dict(values, **schedule))
        if schedule:
            loan.compute_schedule()
        return _row(loan, lines=True)

    @api_route("/finance/loans/<int:loan_id>/activate", methods=("POST",), profiles=FIN_WRITE)
    def activate(self, loan_id, **_kw):
        loan = _loan(loan_id)
        loan.action_activate()
        return _row(loan, lines=True)

    @api_route("/finance/loans/lines/<int:line_id>/pay", methods=("POST",), profiles=FIN_WRITE)
    def pay(self, line_id, **_kw):
        line = request.env["eguitra.loan.line"].browse(line_id).exists()
        if not line:
            raise ApiError(404, "not_found", "Échéance introuvable.")
        line.action_pay(parse_date(read_json(), "date"))
        return _row(line.loan_id, lines=True)
