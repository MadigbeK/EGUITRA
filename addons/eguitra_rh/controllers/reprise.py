"""Import des salariés (reprise des fiches existantes), par la RH ou l'administration.

GET /rh/employees/import/template?format=xlsx|csv : modèle (colonnes de reprise.HEADERS ; le classeur
porte aussi les valeurs admises et une notice).

POST /rh/employees/import (multipart : file, photos facultatif, mode=preview|import) :
- aperçu d'abord (mode=preview) : chaque ligne, créée, mise à jour, inchangée ou refusée avec ses motifs,
  et sa photo trouvée ou manquante ; l'import est rejoué dans un point de sauvegarde annulé à la fin, si
  bien que l'aperçu rend aussi les refus des contrôles du noyau ;
- puis l'import (mode=import) : tout ou rien, comme les autres reprises du projet ; une seule ligne
  refusée et rien n'est enregistré ;
- un salarié existant (même matricule, sinon même courriel, sinon même nom, dans la société de la ligne)
  est mis à jour, jamais dupliqué ; une cellule vide ne change rien au dossier ;
- département créé s'il n'existe pas, dans la société de la ligne ; société de travail par défaut ;
- rien n'est inventé : une date d'entrée ou un salaire absent laisse la fiche « à compléter »
  (employee.to_complete), et aucune paie de la société n'est validée tant qu'il manque ;
- personne n'importe son propre dossier (quatre yeux, comme refuse_own).
"""

import base64
import csv
import io
from datetime import date, datetime

from odoo import http
from odoo.exceptions import UserError, ValidationError
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route
from odoo.addons.eguitra_api.files import XLSX, XLSX_OPTIONS, xlsx_row

from ..models.employee import CATEGORIES, CONTRACTS
from ..photo import PhotoError, normalize
from ..reprise import (
    CATEGORY_ALIASES,
    COMPANY_LABELS,
    CONTRACT_ALIASES,
    HEADERS,
    MAX_ROWS,
    MAX_TABLE,
    MAX_ZIP,
    RepriseError,
    amount,
    choice,
    columns,
    photo_key,
    plain,
    read_photos,
    read_table,
)
from .common import WRITE, company_ref, today
from .hsseq import _cell, _cell_date

FIELD_LABELS = {"name": "Nom complet", "job_title": "Poste", "department_id": "Département", "email": "Courriel",
                "phone": "Téléphone", "contract_type": "Contrat", "category": "Catégorie", "hire_date": "Date d'entrée",
                "contract_end": "Fin du contrat", "base_salary": "Salaire de base", "matricule": "Matricule"}


class _Preview(Exception):
    """Fin de l'aperçu : tout ce qui a été écrit est annulé."""


def _text(value, limit=200):
    value = _cell(value)
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        value = value.strftime("%d/%m/%Y")
    return " ".join(str(value).split())[:limit] or None


def _company_of(value, companies):
    """Société d'une cellule : nom complet, « Groupe » ou « Cabinet » (ou un nom qui les contient)."""
    wanted = plain(value)
    for company in companies:
        if wanted == plain(company.name):
            return company
    entity = None
    if "cabinet" in wanted or "axispro" in wanted:
        entity = "cabinet"
    elif "groupe" in wanted or "group" in wanted or "eguitra" in wanted:
        entity = "groupe"
    matches = companies.filtered(lambda c: c.eguitra_entity == entity) if entity else companies.browse()
    return matches[0] if len(matches) == 1 else None


class EguitraRhReprise(http.Controller):
    @api_route("/rh/employees/import/template", profiles=WRITE)
    def import_template(self, **kw):
        fmt = (kw.get("format") or "xlsx").lower()
        stamp = f"{today():%Y%m%d}"
        if fmt == "csv":
            out = io.StringIO()
            csv.writer(out, delimiter=";").writerow(HEADERS)
            return request.make_response(("﻿" + out.getvalue()).encode("utf-8"), headers=[
                ("Content-Type", "text/csv; charset=utf-8"), ("Cache-Control", "no-store"),
                ("Content-Disposition", content_disposition(f"import_salaries_{stamp}.csv")),
            ])
        if fmt != "xlsx":
            raise ApiError(400, "invalid_parameter", "Format du modèle : xlsx ou csv.")
        import xlsxwriter

        env = request.env
        companies = env.companies
        departments = env["eguitra.rh.department"].search(["|", ("company_id", "=", False),
                                                           ("company_id", "in", companies.ids)])
        contracts = [label for _code, label in CONTRACTS]
        categories = [label for _code, label in CATEGORIES]
        company_values = [c.name for c in companies] + [COMPANY_LABELS[e] for e in ("groupe", "cabinet")
                                                       if companies.filtered(lambda c, e=e: c.eguitra_entity == e)]
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        head = book.add_format({"bold": True, "bg_color": "#10133A", "font_color": "#FFFFFF"})
        sheet = book.add_worksheet("Salariés")
        xlsx_row(sheet, 0, HEADERS, head)
        last = MAX_ROWS
        for col, values in ((6, contracts), (7, categories), (8, company_values)):
            if values and len(",".join(values)) <= 255:  # limite d'une liste de validation du tableur
                sheet.data_validation(1, col, last, col, {"validate": "list", "source": values,
                                                          "error_type": "warning"})
        sheet.set_column(9, 10, 14, book.add_format({"num_format": "dd/mm/yyyy"}))
        sheet.set_column(11, 11, 16, book.add_format({"num_format": "# ##0"}))
        for col, width in enumerate((12, 30, 26, 22, 30, 18, 14, 18, 26)):
            sheet.set_column(col, col, width)
        sheet.freeze_panes(1, 2)

        values = book.add_worksheet("Valeurs admises")
        lists = (("Contrat", contracts), ("Catégorie", categories), ("Société", company_values),
                 ("Départements existants", [d.name for d in departments]))
        for col, (title, items) in enumerate(lists):
            xlsx_row(values, 0, [title], head, col=col)
            for row, item in enumerate(items, start=1):
                xlsx_row(values, row, [item], col=col)
            values.set_column(col, col, 28)

        notice = book.add_worksheet("Notice")
        for row, line in enumerate((
            "Import des salariés (NIMOVA · RH)",
            "",
            "Une ligne par salarié, à partir de la ligne 2. Seul « Nom complet » est obligatoire pour mettre à jour "
            "un dossier ; pour un nouveau salarié, « Contrat » l'est aussi (CDI, CDD, Stage ou Apprentissage).",
            "Matricule : facultatif. Vide, le matricule est attribué (EG-0001, AX-0001…). Un salarié déjà enregistré "
            "est retrouvé par son matricule, sinon par son courriel, sinon par son nom, dans la société de la ligne : "
            "il est mis à jour, jamais dupliqué.",
            "Société : nom de la société, « Groupe » ou « Cabinet ». Vide : la société de travail de la personne qui "
            "importe.",
            "Département : créé dans la société de la ligne s'il n'existe pas encore.",
            "Dates au format JJ/MM/AAAA. « Fin du contrat » est obligatoire pour un CDD.",
            "Une cellule vide ne change rien à un dossier existant.",
            "Date d'entrée ou salaire de base manquant : la fiche est importée « à compléter » ; aucune paie de la "
            "société n'est validée tant qu'ils ne sont pas saisis sur la fiche.",
            "Photos (facultatif) : une archive ZIP d'images JPEG, PNG ou WebP de 5 Mo au plus, chacune nommée par "
            "le matricule (eg-0001.jpg) ou par le nom sans accents ni espaces (aissata_thiam.png).",
            "L'import montre d'abord un aperçu ; rien n'est enregistré si une ligne est refusée.",
            "Personne n'importe son propre dossier : un autre membre du service RH s'en charge.",
        )):
            notice.write_string(row, 0, line, head if row == 0 else None)
        notice.set_column(0, 0, 120)
        book.close()
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", XLSX), ("Cache-Control", "no-store"),
            ("Content-Disposition", content_disposition(f"import_salaries_{stamp}.xlsx")),
        ])

    @api_route("/rh/employees/import", methods=("POST",), profiles=WRITE)
    def import_employees(self, **_kw):
        form = request.httprequest.form
        commit = (form.get("mode") or "preview") == "import"
        upload = request.httprequest.files.get("file")
        if not upload or not upload.filename:
            raise ApiError(400, "missing_fields", "Choisissez le fichier des salariés (XLSX ou CSV).", fields=["file"])
        archive = request.httprequest.files.get("photos")
        try:
            rows = read_table(upload.read(MAX_TABLE + 1))
            photos, ignored = read_photos(archive.read(MAX_ZIP + 1)) if archive and archive.filename else ({}, [])
        except RepriseError as e:
            raise ApiError(e.status, e.code, e.message) from e
        lines = self._plan(rows, photos)
        used = {line["photo_key"] for line in lines if line.get("photo_key")}
        unmatched = sorted(name for key, files in photos.items() if key not in used for name, _d, _e in files)

        try:
            with request.env.cr.savepoint():
                self._apply(lines, commit)
                if not commit or any(line["errors"] for line in lines):
                    raise _Preview
        except _Preview:
            pass
        result = {
            "imported": commit and not any(line["errors"] for line in lines),
            "lines": [{k: v for k, v in line.items() if not k.startswith("_") and k != "photo_key"} for line in lines],
            "summary": {
                "create": sum(1 for x in lines if x["action"] == "create" and not x["errors"]),
                "update": sum(1 for x in lines if x["action"] == "update" and not x["errors"]),
                "unchanged": sum(1 for x in lines if x["action"] == "unchanged" and not x["errors"]),
                "refused": sum(1 for x in lines if x["errors"]),
                "to_complete": sum(1 for x in lines if x["to_complete"] and not x["errors"]),
                "photos_found": sum(1 for x in lines if x["photo"] == "found"),
                "photos_missing": sum(1 for x in lines if x["photo"] == "missing"),
            },
            "departments_created": sorted({x["department_new"] for x in lines if x.get("department_new")}),
            "photos_unmatched": unmatched,
            "photos_ignored": [{"name": n, "reason": r} for n, r in ignored],
        }
        if commit and not result["imported"]:
            refused = result["summary"]["refused"]
            raise ApiError(422, "business_rule", f"{refused} ligne{'s' if refused > 1 else ''} refusée"
                                                 f"{'s' if refused > 1 else ''} : rien n'est enregistré.",
                           errors=[f"Ligne {x['line']} : {e}" for x in lines for e in x["errors"]][:50],
                           preview=result)
        return result

    # ─── Préparation : rapprochement et contrôle de chaque ligne ─────────

    def _plan(self, rows, photos):
        env = request.env
        rows = [row for row in rows if any(_cell(v) is not None for v in row)]
        if not rows:
            raise ApiError(422, "business_rule", "Fichier vide : partez du modèle d'import.")
        index = columns(rows[0])
        if "name" not in index:
            raise ApiError(422, "business_rule", "Colonne « Nom complet » attendue : partez du modèle d'import.")
        if len(rows) - 1 > MAX_ROWS:
            raise ApiError(422, "business_rule", f"Fichier trop long : {MAX_ROWS} salariés au plus par import.")
        companies = env.companies
        Employee = env["eguitra.rh.employee"].with_context(active_test=False)
        staff = Employee.search([("company_id", "in", companies.ids)])
        by_name, by_email, by_matricule = {}, {}, {}
        for emp in staff:
            by_name.setdefault((emp.company_id.id, plain(emp.name)), []).append(emp)
            if emp.email:
                by_email.setdefault((emp.company_id.id, emp.email.strip().lower()), []).append(emp)
            if emp.matricule:
                by_matricule.setdefault(emp.matricule.upper(), []).append(emp)
        departments = env["eguitra.rh.department"].search(["|", ("company_id", "=", False),
                                                           ("company_id", "in", companies.ids)])
        seen_employees, seen_new, new_matricules = {}, {}, {}
        lines = []

        def cell(row, key):
            i = index.get(key)
            return row[i] if i is not None and i < len(row) else None

        for number, row in enumerate(rows[1:], start=2):
            errors, warnings, values = [], [], {}
            name = _text(cell(row, "name"))
            matricule = (_text(cell(row, "matricule"), 20) or "").upper() or None
            line = {"line": number, "name": name or "", "matricule": matricule, "company": None, "action": "create",
                    "employee_id": None, "errors": errors, "warnings": warnings, "changes": [],
                    "to_complete": False, "missing": [], "photo": None, "photo_file": None,
                    "department_new": None}
            lines.append(line)
            if not name:
                errors.append("nom complet manquant.")
            company_cell = _text(cell(row, "company"))
            company = _company_of(company_cell, companies) if company_cell else env.company
            if not company:
                errors.append(f"société « {company_cell} » inconnue ou non ouverte à votre compte (nom de la société, "
                              "« Groupe » ou « Cabinet »).")
                continue
            line["company"] = company_ref(company)

            # Salarié existant : matricule, sinon courriel, sinon nom, dans la société de la ligne.
            email = _text(cell(row, "email"), 120)
            if email and ("@" not in email or " " in email):
                errors.append(f"courriel « {email} » invalide.")
                email = None
            emp = None
            if matricule:
                found = by_matricule.get(matricule, [])
                here = [e for e in found if e.company_id == company]
                if here:
                    emp = here[0]
                elif found:
                    errors.append(f"le matricule {matricule} est celui d'un salarié de {found[0].company_id.name} : "
                                  "vérifiez la colonne Société.")
                    continue
            if not emp and email:
                found = by_email.get((company.id, email.lower()), [])
                if len(found) > 1:
                    errors.append(f"plusieurs salariés portent le courriel {email} : indiquez le matricule.")
                    continue
                emp = found[0] if found else None
            if not emp and name:
                found = by_name.get((company.id, plain(name)), [])
                if len(found) > 1:
                    errors.append(f"plusieurs salariés s'appellent {name} : indiquez le matricule.")
                    continue
                emp = found[0] if found else None
            if emp:
                if matricule and matricule != (emp.matricule or "").upper():
                    warnings.append(f"matricule {matricule} ignoré : dossier retrouvé par son "
                                    f"{'courriel' if email and (emp.email or '').lower() == email.lower() else 'nom'} "
                                    f"({emp.matricule}).")
                line.update(action="update", employee_id=emp.id, matricule=emp.matricule)
                if emp.sudo().user_id == env.user:
                    errors.append("votre propre dossier est mis à jour par un autre membre du service RH.")
                    continue
                if emp.id in seen_employees:
                    errors.append(f"même salarié que la ligne {seen_employees[emp.id]}.")
                    continue
                seen_employees[emp.id] = number
            elif name:
                key = (company.id, plain(name))
                if key in seen_new:
                    errors.append(f"même salarié que la ligne {seen_new[key]}.")
                    continue
                seen_new[key] = number
                if matricule:
                    if (company.id, matricule) in new_matricules:
                        errors.append(f"matricule {matricule} déjà donné ligne {new_matricules[(company.id, matricule)]}.")
                    new_matricules[(company.id, matricule)] = number

            # Valeurs : une cellule vide ne change rien.
            if name:
                values["name"] = name
            for key in ("job_title", "phone"):
                value = _text(cell(row, key), 120)
                if value:
                    values[key] = value
            if email:
                values["email"] = email
            contract = _text(cell(row, "contract_type"))
            if contract:
                code = choice(contract, CONTRACTS, CONTRACT_ALIASES)
                if code:
                    values["contract_type"] = code
                else:
                    errors.append(f"contrat « {contract} » inconnu (CDI, CDD, Stage ou Apprentissage).")
            elif not emp:
                errors.append("contrat manquant (CDI, CDD, Stage ou Apprentissage).")
            category = _text(cell(row, "category"))
            if category:
                code = choice(category, CATEGORIES, CATEGORY_ALIASES)
                if code:
                    values["category"] = code
                else:
                    errors.append(f"catégorie « {category} » inconnue ({', '.join(label for _c, label in CATEGORIES)}).")
            for key, label in (("hire_date", "date d'entrée"), ("contract_end", "fin du contrat")):
                try:
                    value = _cell_date(cell(row, key))
                except ValueError:
                    errors.append(f"{label} illisible (attendue au format JJ/MM/AAAA).")
                    continue
                if value:
                    values[key] = value
            salary = _cell(cell(row, "base_salary"))
            if salary is not None:
                try:
                    values["base_salary"] = amount(salary)
                    if values["base_salary"] < 0:
                        raise ValueError(salary)
                except ValueError:
                    values.pop("base_salary", None)
                    errors.append(f"salaire de base « {salary} » illisible.")
            department = _text(cell(row, "department"), 120)
            if department:
                wanted = plain(department)
                # Département de la société d'abord, sinon commun aux deux sociétés.
                found = [d for d in departments if plain(d.name) == wanted and d.company_id == company] or \
                    [d for d in departments if plain(d.name) == wanted and not d.company_id]
                if found:
                    values["department_id"] = found[0].id
                else:
                    line["department_new"] = department
                    line["_department"] = (company.id, department)

            # Contrôles du dossier tel qu'il sera après l'import.
            after = {k: values.get(k, emp[k] if emp else False) for k in ("contract_type", "hire_date", "contract_end",
                                                                             "base_salary")}
            if after["contract_type"] == "cdd" and not after["contract_end"]:
                errors.append("un CDD a une date de fin : remplissez « Fin du contrat ».")
            if after["hire_date"] and after["contract_end"] and after["contract_end"] < after["hire_date"]:
                errors.append("la fin du contrat précède la date d'entrée.")
            missing = []
            if not after["hire_date"]:
                missing.append("date d'entrée")
            if not after["base_salary"] and after["contract_type"] in ("cdi", "cdd", False, None):
                missing.append("salaire de base")
            line.update(to_complete=bool(missing), missing=missing)
            if missing:
                warnings.append(f"fiche à compléter ({', '.join(missing)}) : pas de paie avant leur saisie.")

            if emp:
                changes = {}
                for key, value in values.items():
                    current = emp[key]
                    current = current.id if hasattr(current, "_name") else current
                    if current != value:
                        changes[key] = value
                values = changes
                line["changes"] = sorted(FIELD_LABELS.get(k, k) for k in values) + (
                    ["Département"] if line.get("_department") else [])
            elif matricule:
                values["matricule"] = matricule
            line["_values"] = values

            # Photo : matricule, sinon nom sans accents ni espaces.
            keys = [photo_key(k) for k in (line["matricule"], name) if k]
            if photos:
                key = next((k for k in keys if k in photos), None)
                if not key:
                    line["photo"] = "missing"
                else:
                    line["photo_key"] = key
                    files = photos[key]
                    if len(files) > 1:
                        line["photo"] = "error"
                        errors.append(f"plusieurs photos pour ce salarié ({', '.join(f[0] for f in files)}).")
                        continue
                    file_name, data, refusal = files[0]
                    line["photo_file"] = file_name
                    if refusal:
                        line["photo"] = "error"
                        errors.append(f"photo {file_name} : {refusal}.")
                        continue
                    try:
                        line["_photo"] = base64.b64encode(normalize(data))
                        line["photo"] = "found"
                    except PhotoError as e:
                        line["photo"] = "error"
                        errors.append(f"photo {file_name} : {e.message[0].lower()}{e.message[1:]}")
            if emp and not values and not line.get("_photo") and not line.get("_department") and not errors:
                line["action"] = "unchanged"
        return lines

    # ─── Écriture (dans le point de sauvegarde de l'appelant) ────────────

    def _apply(self, lines, commit):
        env = request.env
        Employee = env["eguitra.rh.employee"].with_context(active_test=False)
        Department = env["eguitra.rh.department"]
        created_departments = {}
        for line in lines:
            if line["errors"] or line["action"] == "unchanged":
                continue
            values = dict(line.get("_values") or {})
            try:
                with env.cr.savepoint():
                    if line.get("_department"):
                        company_id, label = line["_department"]
                        key = (company_id, plain(label))
                        if key not in created_departments:
                            created_departments[key] = Department.create({"name": label, "company_id": company_id})
                        values["department_id"] = created_departments[key].id
                    # La photo n'est écrite qu'à l'import : l'aperçu la contrôle sans la stocker.
                    if commit and line.get("_photo"):
                        values["photo"] = line["_photo"]
                    if line["action"] == "create":
                        emp = Employee.create(dict(values, company_id=line["company"]["id"]))
                        line["employee_id"] = emp.id if commit else None
                        line["matricule"] = emp.matricule
                    elif values:
                        Employee.browse(line["employee_id"]).write(values)
            except (UserError, ValidationError) as e:
                line["errors"].append(str(e.args[0]) if e.args else str(e))
