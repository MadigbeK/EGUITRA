"""Politique d'évaluation versionnée : stage gates, domaines, critères, pièces standard.

La grille du cabinet (111 critères sur 15 domaines, 8 stage gates, 42 pièces de data room) est une
donnée, importée depuis un classeur et modifiable par le cabinet sans intervention technique.
Chaque modification crée une nouvelle version ; un dossier reste évalué selon la version en
vigueur à son ouverture, rappelée dans chaque rapport (offre, chapitre 3.7).
"""

import io

from odoo import api, fields, models
from odoo.exceptions import UserError

STATUS_VALUES = {"met": 1.0, "partial": 0.5, "not_met": 0.0}
GRID_COLUMNS = ("type", "code", "libelle", "domaine", "gate", "poids", "critique", "eliminatoire", "preuve", "aide")


class AxisproPolicy(models.Model):
    _name = "axispro.policy"
    _description = "Politique d'évaluation AxisPro"
    _order = "version desc"

    name = fields.Char("Intitulé", required=True)
    version = fields.Integer("Version", required=True, default=1)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    state = fields.Selection([("draft", "Brouillon"), ("active", "En vigueur"), ("archived", "Archivée")],
                             default="draft", required=True)
    date_active = fields.Date("En vigueur depuis", readonly=True)
    go_threshold = fields.Float("Seuil GO (score sur 100)", default=70.0)
    conditional_threshold = fields.Float("Seuil conditionnel (score sur 100)", default=50.0)
    notes = fields.Text("Principes de la politique", help="Rappelés dans chaque rapport de décision.")
    gate_ids = fields.One2many("axispro.gate", "policy_id", "Stage gates")
    domain_ids = fields.One2many("axispro.domain", "policy_id", "Domaines")
    criterion_ids = fields.One2many("axispro.criterion", "policy_id", "Critères")
    document_type_ids = fields.One2many("axispro.document.type", "policy_id", "Pièces standard")

    @api.model
    def active_policy(self, company):
        return self.search([("company_id", "=", company.id), ("state", "=", "active")], limit=1)

    def action_activate(self):
        self.ensure_one()
        if not self.criterion_ids or not self.gate_ids:
            raise UserError("Une politique sans gates ni critères ne peut pas entrer en vigueur.")
        self.search([("company_id", "=", self.company_id.id), ("state", "=", "active"), ("id", "!=", self.id)]).write(
            {"state": "archived"}
        )
        self.write({"state": "active", "date_active": fields.Date.context_today(self)})
        return True

    @api.model
    def import_grid(self, company, name, filename, content, go=70.0, conditional=50.0, notes=None):
        """Nouvelle version de la politique depuis un classeur (XLSX ou CSV, colonnes GRID_COLUMNS).

        Lignes de type « gate », « domaine », « critere » et « piece ». Le poids d'un domaine est sa
        pondération dans le score global ; celui d'un critère, sa pondération dans son domaine.
        """
        rows = _read_rows(filename, content)
        last = self.search([("company_id", "=", company.id)], order="version desc", limit=1)
        policy = self.create({
            "name": name, "version": (last.version + 1) if last else 1, "company_id": company.id,
            "go_threshold": go, "conditional_threshold": conditional, "notes": notes,
        })
        gates, domains, errors = {}, {}, []
        seq = 0
        for kind in ("gate", "domaine", "critere", "piece"):
            for line_no, row in rows:
                if row["type"] != kind:
                    continue
                seq += 1
                code, label = row["code"], row["libelle"]
                if not code or not label:
                    errors.append(f"Ligne {line_no} : code et libellé obligatoires.")
                    continue
                if kind == "gate":
                    gates[code] = self.env["axispro.gate"].create(
                        {"policy_id": policy.id, "code": code, "name": label, "sequence": seq, "description": row["aide"]}
                    )
                elif kind == "domaine":
                    domains[code] = self.env["axispro.domain"].create(
                        {"policy_id": policy.id, "code": code, "name": label, "sequence": seq, "weight": _num(row["poids"], 1)}
                    )
                elif kind == "critere":
                    if row["domaine"] not in domains or row["gate"] not in gates:
                        errors.append(f"Ligne {line_no} ({code}) : domaine ou gate inconnu.")
                        continue
                    self.env["axispro.criterion"].create({
                        "policy_id": policy.id, "code": code, "name": label, "sequence": seq,
                        "domain_id": domains[row["domaine"]].id, "gate_id": gates[row["gate"]].id,
                        "weight": _num(row["poids"], 1), "critical": _bool(row["critique"]),
                        "knockout": _bool(row["eliminatoire"]), "evidence_required": _bool(row["preuve"]),
                        "guidance": row["aide"] or False,
                    })
                else:
                    self.env["axispro.document.type"].create({
                        "policy_id": policy.id, "code": code, "name": label, "sequence": seq,
                        "gate_id": gates[row["gate"]].id if row["gate"] in gates else False,
                        "required": not row["critique"] or _bool(row["critique"]), "category": row["domaine"] or False,
                        "guidance": row["aide"] or False,
                    })
        if errors:
            raise UserError("Grille refusée :\n" + "\n".join(errors[:20]))
        return policy

    def copy_as_new_version(self):
        """Nouvelle version modifiable, copie conforme de celle-ci."""
        self.ensure_one()
        last = self.search([("company_id", "=", self.company_id.id)], order="version desc", limit=1)
        new = self.copy({"version": last.version + 1, "state": "draft", "date_active": False,
                         "gate_ids": False, "domain_ids": False, "criterion_ids": False, "document_type_ids": False})
        gates = {g: g.copy({"policy_id": new.id}) for g in self.gate_ids}
        domains = {d: d.copy({"policy_id": new.id}) for d in self.domain_ids}
        for c in self.criterion_ids:
            c.copy({"policy_id": new.id, "gate_id": gates[c.gate_id].id, "domain_id": domains[c.domain_id].id})
        for t in self.document_type_ids:
            t.copy({"policy_id": new.id, "gate_id": gates[t.gate_id].id if t.gate_id else False})
        return new


def _num(value, default=0.0):
    if value in (None, ""):
        return default
    try:
        return float(str(value).replace(",", ".").strip())
    except ValueError:
        return default


def _bool(value):
    return str(value or "").strip().lower() in ("1", "oui", "o", "x", "yes", "vrai", "true")


def _read_rows(filename, content):
    if filename.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl

        try:
            sheet = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True).worksheets[0]
            raw = [list(r) for r in sheet.iter_rows(values_only=True)]
        except Exception as exc:  # classeur corrompu ou d'un autre format
            raise UserError("Classeur illisible : enregistrez-le au format XLSX ou CSV.") from exc
    else:
        import csv

        text = content.decode("utf-8-sig", errors="replace")
        try:
            delimiter = csv.Sniffer().sniff(text[:2048], delimiters=";,\t").delimiter
        except csv.Error:  # une seule colonne ou séparateur ambigu
            delimiter = ";" if text.count(";") >= text.count(",") else ","
        raw = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    if not raw:
        raise UserError("Classeur vide.")
    header = [str(h or "").strip().lower().replace("é", "e").replace("è", "e") for h in raw[0]]
    missing = [c for c in GRID_COLUMNS if c not in header]
    if missing:
        raise UserError("Colonnes manquantes : " + ", ".join(missing))
    index = {c: header.index(c) for c in GRID_COLUMNS}
    rows = []
    for n, values in enumerate(raw[1:], start=2):
        if not any(v not in (None, "") for v in values):
            continue
        row = {c: (str(values[i]).strip() if i < len(values) and values[i] is not None else "") for c, i in index.items()}
        row["type"] = row["type"].lower().replace("è", "e").replace("é", "e")
        rows.append((n, row))
    return rows


def grid_template():
    """Classeur modèle de la grille, avec quelques lignes d'exemple."""
    import xlsxwriter

    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, {"in_memory": True})
    sheet = book.add_worksheet("Grille")
    bold = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
    sheet.write_row(0, 0, GRID_COLUMNS, bold)
    examples = [
        ("gate", "G0", "Idée et opportunité", "", "", "", "", "", "", "Le projet répond-il à un besoin avéré ?"),
        ("domaine", "D01", "Marché et demande", "", "", "10", "", "", "", ""),
        ("critere", "C001", "Étude de marché documentée", "D01", "G0", "3", "oui", "non", "oui", "Joindre l'étude."),
        ("piece", "P01", "Statuts de la société", "Juridique", "G0", "", "oui", "", "", "Copie certifiée."),
    ]
    for r, row in enumerate(examples, start=1):
        sheet.write_row(r, 0, row)
    sheet.set_column(0, 1, 10)
    sheet.set_column(2, 2, 45)
    sheet.set_column(9, 9, 50)
    book.close()
    return out.getvalue()


class AxisproGate(models.Model):
    _name = "axispro.gate"
    _description = "Stage gate"
    _order = "policy_id, sequence"

    policy_id = fields.Many2one("axispro.policy", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer()
    code = fields.Char(required=True)
    name = fields.Char(required=True)
    description = fields.Text()


class AxisproDomain(models.Model):
    _name = "axispro.domain"
    _description = "Domaine d'évaluation"
    _order = "policy_id, sequence"

    policy_id = fields.Many2one("axispro.policy", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer()
    code = fields.Char(required=True)
    name = fields.Char(required=True)
    weight = fields.Float("Pondération", default=1.0)


class AxisproCriterion(models.Model):
    _name = "axispro.criterion"
    _description = "Critère d'évaluation"
    _order = "policy_id, sequence"

    policy_id = fields.Many2one("axispro.policy", required=True, ondelete="cascade", index=True)
    domain_id = fields.Many2one("axispro.domain", required=True, ondelete="cascade")
    gate_id = fields.Many2one("axispro.gate", required=True, ondelete="cascade")
    sequence = fields.Integer()
    code = fields.Char(required=True)
    name = fields.Char("Critère", required=True)
    guidance = fields.Text("Question ou aide à l'évaluation")
    weight = fields.Float("Poids dans le domaine", default=1.0)
    critical = fields.Boolean("Critique")
    knockout = fields.Boolean("Éliminatoire", help="Non satisfait : NO-GO quel que soit le score.")
    evidence_required = fields.Boolean("Preuve requise")


class AxisproDocumentType(models.Model):
    _name = "axispro.document.type"
    _description = "Pièce standard de la data room"
    _order = "policy_id, sequence"

    policy_id = fields.Many2one("axispro.policy", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer()
    code = fields.Char(required=True)
    name = fields.Char("Pièce", required=True)
    category = fields.Char("Rubrique")
    gate_id = fields.Many2one("axispro.gate", "Attendue au gate", ondelete="set null")
    required = fields.Boolean("Obligatoire", default=True)
    guidance = fields.Text("Consignes au porteur")
