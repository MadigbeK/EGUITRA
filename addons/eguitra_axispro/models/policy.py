"""Politique d'évaluation versionnée : stage gates, compartiments, domaines, critères, pièces standard.

La grille du cabinet (version 3 de l'outil de scoring : 104 critères sur 14 domaines répartis en
8 compartiments, 7 stage gates, 39 pièces de data room) est une donnée, importée depuis un classeur
(format d'import de la plateforme, ou outil de scoring du cabinet tel quel : grille_cabinet.py) et
modifiable par le cabinet sans intervention technique. Un compartiment regroupe les domaines confiés
à un même consultant.
Chaque modification crée une nouvelle version ; un dossier reste évalué selon la version en
vigueur à son ouverture, rappelée dans chaque rapport (offre, chapitre 3.7).

La politique porte aussi les réglages de la méthode d'évaluation (scoring.py) : pondération à plat
ou par domaine, knock-out incomplet bloquant, preuve exigée, non applicables exclus, péremption des
preuves, seuils des classes et DSCR bancaire. Les règles de passage, seuils et domaines cibles des
gates sont des données de la grille.
"""

import io
import math
import re
import unicodedata

from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.eguitra_api.files import XLSX_OPTIONS, workbook_rows, workbook_sheets, xlsx_row

from .. import grille_cabinet
from ..engine import INDICATORS, suggest
from ..scoring import DEFAULT_POLICY, REQUIREMENTS, RULES

STATUS_VALUES = {"met": 1.0, "partial": 0.5, "not_met": 0.0}
GRID_COLUMNS = ("type", "code", "libelle", "domaine", "gate", "poids", "critique", "eliminatoire", "preuve", "aide")
# Colonnes facultatives :
# - critère adossé à un indicateur du modèle financier (indicateur, seuil, seuil_partiel) ;
# - méthode MB AxisPro : exigence (bloquant, apd, closing), bancabilite, livrable (critère, domaine
#   ou gate), role (« capex » : critère contrôlé contre l'investissement de la fiche) ;
# - gates : entree, passage, regle, seuil_attente, seuil_go, portee (globale ou cumulee), domaines
#   (codes séparés par « ; »), completude_min (complétude documentaire exigée pour examiner le gate) ;
# - domaines : compartiment (« C0 — Coordination et cadrage projet » : code puis intitulé) ;
# - pièces : criteres (codes des critères justifiés par la pièce, séparés par « ; »).
OPTIONAL_COLUMNS = ("indicateur", "seuil", "seuil_partiel", "exigence", "bancabilite", "livrable", "role",
                    "entree", "passage", "regle", "seuil_attente", "seuil_go", "portee", "domaines", "criteres",
                    "compartiment", "completude_min")
WEIGHTINGS = [("flat", "À plat sur toute la grille"), ("domain", "Par domaine, selon leur pondération")]
SCOPES = [("global", "Toute la grille"), ("cumulative", "Critères des gates atteints")]
REQUIREMENT_ALIASES = {
    "bloquant": "blocking", "blocking": "blocking",
    "apd": "apd", "pendantapd": "apd", "pendant apd": "apd", "pendant l'apd": "apd",
    "closing": "closing", "dd-spv-closing": "closing", "dd spv closing": "closing", "dd, spv, closing": "closing",
    "dd-closing": "closing", "dd closing": "closing", "dd et closing": "closing", "due diligence et closing": "closing",
}


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
    threshold_bankable = fields.Float("Seuil BANKABLE CANDIDATE (sur 100)", default=80.0)
    go_threshold = fields.Float("Seuil APD READY (sur 100)", default=65.0)
    conditional_threshold = fields.Float("Seuil CONDITIONAL GO (sur 100)", default=50.0)
    threshold_hold = fields.Float("Seuil HOLD (sur 100)", default=30.0)
    dscr_target = fields.Float("DSCR bancaire", default=1.3)
    weighting = fields.Selection(WEIGHTINGS, "Pondération des scores", default="flat", required=True)
    ko_partial_blocks = fields.Boolean("Un knock-out incomplet bloque aussi", default=True)
    evidence_check = fields.Boolean("Preuve obligatoire pour valider un critère exigeant", default=True,
                                    help="Sans pièce, un critère à preuve requise (colonne « preuve » de la grille) "
                                         "déclaré disponible est compté comme incomplet ; la saisie n'est pas modifiée.")
    exclude_na = fields.Boolean("Exclure les non applicables du score", default=True)
    expiry_check = fields.Boolean("Signaler les preuves périmées", default=True)
    capex_criterion_id = fields.Many2one("axispro.criterion", "Critère contrôlé contre l'investissement",
                                         ondelete="set null")
    notes = fields.Text("Principes de la politique", help="Rappelés dans chaque rapport de décision.")
    gate_ids = fields.One2many("axispro.gate", "policy_id", "Stage gates")
    compartment_ids = fields.One2many("axispro.compartment", "policy_id", "Compartiments")
    domain_ids = fields.One2many("axispro.domain", "policy_id", "Domaines")
    criterion_ids = fields.One2many("axispro.criterion", "policy_id", "Critères")
    document_type_ids = fields.One2many("axispro.document.type", "policy_id", "Pièces standard")

    @api.model
    def active_policy(self, company):
        return self.search([("company_id", "=", company.id), ("state", "=", "active")], limit=1)

    def scoring_settings(self):
        """Réglages passés à la méthode d'évaluation (scoring.compute)."""
        self.ensure_one()
        return {
            "weighting": self.weighting, "ko_partial_blocks": self.ko_partial_blocks,
            "evidence_check": self.evidence_check, "exclude_na": self.exclude_na, "expiry_check": self.expiry_check,
            "threshold_bankable": self.threshold_bankable, "threshold_apd": self.go_threshold,
            "threshold_conditional": self.conditional_threshold, "threshold_hold": self.threshold_hold,
            "dscr_target": self.dscr_target or DEFAULT_POLICY["dscr_target"],
        }

    def integrity(self):
        """Contrôle de cohérence de la grille, affiché avant la mise en vigueur."""
        self.ensure_one()
        notes = []
        ko_not_critical = self.criterion_ids.filtered(lambda c: c.knockout and not c.critical)
        if ko_not_critical:
            notes.append(f"{len(ko_not_critical)} critère(s) éliminatoire(s) non marqué(s) critique(s) : "
                         + ", ".join(ko_not_critical.mapped("code")) + ".")
        orphan_docs = self.document_type_ids.filtered(lambda t: not t.criterion_ids)
        if orphan_docs and any(self.document_type_ids.mapped("criterion_ids")):
            notes.append(f"{len(orphan_docs)} pièce(s) sans critère rattaché : " + ", ".join(orphan_docs.mapped("code")) + ".")
        linked = self.document_type_ids.mapped("criterion_ids")
        unproven = self.criterion_ids - linked
        if linked and unproven:
            notes.append(f"{len(unproven)} critère(s) sans pièce de data room rattachée.")
        empty_gates = self.gate_ids.filtered(lambda g: not self.criterion_ids.filtered(lambda c, g=g: c.gate_id == g))
        loose = self.domain_ids.filtered(lambda d: not d.compartment_id)
        if self.compartment_ids and loose:
            notes.append(f"{len(loose)} domaine(s) sans compartiment : " + ", ".join(loose.mapped("name")) + ".")
        return {
            "criteria": len(self.criterion_ids), "domains": len(self.domain_ids), "gates": len(self.gate_ids),
            "compartments": len(self.compartment_ids),
            "documents": len(self.document_type_ids), "weight": sum(self.criterion_ids.mapped("weight")),
            "knockouts": len(self.criterion_ids.filtered("knockout")),
            "critical": len(self.criterion_ids.filtered("critical")),
            "bankability": len(self.criterion_ids.filtered("bankability")),
            "requirements": {k: len(self.criterion_ids.filtered(lambda c, k=k: c.requirement_type == k)) for k in REQUIREMENTS},
            "links": sum(len(t.criterion_ids) for t in self.document_type_ids),
            "gates_without_criteria": empty_gates.mapped("code"),
            "notes": notes,
        }

    def action_activate(self):
        self.ensure_one()
        if not self.criterion_ids or not self.gate_ids:
            raise UserError("Une politique sans gates ni critères ne peut pas entrer en vigueur.")
        self._check_thresholds()
        self.search([("company_id", "=", self.company_id.id), ("state", "=", "active"), ("id", "!=", self.id)]).write(
            {"state": "archived"}
        )
        self.write({"state": "active", "date_active": fields.Date.context_today(self)})
        return True

    def _check_thresholds(self):
        """Seuils de classement entre 0 et 100 et ordonnés : HOLD ≤ CONDITIONAL GO ≤ APD READY ≤ BANKABLE."""
        for policy in self:
            values = [policy.threshold_hold, policy.conditional_threshold, policy.go_threshold,
                      policy.threshold_bankable]
            if any(not 0 <= v <= 100 for v in values) or values != sorted(values):
                raise UserError("Seuils de la politique incohérents : ils vont de 0 à 100, HOLD ≤ CONDITIONAL GO ≤ "
                                "APD READY ≤ BANKABLE.")

    def _inheritance(self):
        """Repères d'une version, repris par la suivante quand elle vient de l'outil du cabinet : codes,
        aides, livrables et indicateurs des critères, codes et rattachements des pièces (par libellé)."""
        self.ensure_one()
        criteria = {
            grille_cabinet.label_key(c.name): {
                "code": c.code, "guidance": c.guidance or "", "deliverable": c.deliverable or "",
                "domain_deliverable": c.domain_id.deliverable or "", "indicator": c.indicator or "",
                "indicator_threshold": f"{c.indicator_threshold:g}" if c.indicator else "",
                "indicator_partial": f"{c.indicator_partial:g}" if c.indicator and c.indicator_has_partial else "",
                "capex": c == self.capex_criterion_id,
            } for c in self.criterion_ids
        }
        pieces = {
            grille_cabinet.label_key(t.name): {
                "code": t.code, "guidance": t.guidance or "",
                "criteria": [grille_cabinet.label_key(c.name) for c in t.criterion_ids],
            } for t in self.document_type_ids
        }
        return {"criteria": criteria, "pieces": pieces}

    @api.model
    def import_grid(self, company, name, filename, content, go=None, conditional=50.0, notes=None):
        """Nouvelle version de la politique depuis un classeur (XLSX ou CSV, colonnes GRID_COLUMNS et,
        au choix, OPTIONAL_COLUMNS), ou depuis l'outil de scoring du cabinet tel quel (grille_cabinet.py).

        Lignes de type « gate », « domaine », « critere » et « piece ». Le poids d'un critère est sa
        pondération dans le score ; celui d'un domaine ne sert qu'en pondération par domaine. Une
        grille au format MB AxisPro (colonne « exigence ») est notée à plat, comme la méthode du
        cabinet ; une grille à l'ancien format garde la pondération par domaine. L'outil du cabinet
        apporte ses propres seuils et réglages, qui l'emportent sur ceux du formulaire, et reprend les
        repères de la version en vigueur (codes, aides, rattachements des pièces).
        """
        last = self.search([("company_id", "=", company.id)], order="version desc", limit=1)
        settings = {}
        sheets = workbook_sheets(content) if filename.lower().endswith((".xlsx", ".xlsm")) else {}
        if grille_cabinet.is_cabinet_workbook(sheets):
            reference = self.active_policy(company) or last
            rows, settings, problems = grille_cabinet.grid_rows(
                sheets, lambda: dict.fromkeys(GRID_COLUMNS + OPTIONAL_COLUMNS, ""),
                reference._inheritance() if reference else None)
            if problems:
                raise UserError("Outil de scoring refusé :\n" + "\n".join(problems[:20]))
            method = True
        else:
            rows, header = _read_rows(filename, content)
            method = "exigence" in header
        if notes:
            settings.pop("notes", None)
        policy = self.create(dict({
            "name": name, "version": (last.version + 1) if last else 1, "company_id": company.id,
            "go_threshold": go if go is not None else (65.0 if method else 70.0), "conditional_threshold": conditional,
            "notes": notes, "weighting": "flat" if method else "domain",
        }, **settings))
        gates, domains, criteria, errors = {}, {}, {}, []
        compartments = {}
        gate_domains, seen = {}, {}
        seq = 0
        kinds = ("gate", "domaine", "critere", "piece")

        def num(line_no, code, column, default=0.0, low=None, high=None):
            """Nombre d'une cellule : vide, la valeur par défaut ; illisible ou hors bornes, une erreur."""
            value = _num(row_value(line_no, column), None)
            if value is None:
                if row_value(line_no, column) in (None, ""):
                    return default
                errors.append(f"Ligne {line_no} ({code}) : « {row_value(line_no, column)} » n'est pas un nombre "
                              f"(colonne {column}).")
                return default
            if not math.isfinite(value) or (low is not None and value < low) or (high is not None and value > high):
                errors.append(f"Ligne {line_no} ({code}) : {column} hors limites ({fnum_plain(value)}).")
                return default
            return value

        def flag(line_no, code, column):
            """Oui ou non ; toute autre réponse est une erreur (un éliminatoire ne disparaît pas en silence)."""
            value = row_value(line_no, column)
            if _plain(value) not in TRUE_TOKENS | FALSE_TOKENS:
                errors.append(f"Ligne {line_no} ({code}) : « {value} » attendu oui ou non (colonne {column}).")
                return False
            return _bool(value)

        by_line = dict(rows)

        def row_value(line_no, column):
            return by_line[line_no].get(column, "")

        for line_no, row in rows:
            if row["type"] not in kinds:
                errors.append(f"Ligne {line_no} : type « {row['type']} » inconnu (gate, domaine, critere ou piece).")
            elif row["code"]:
                key = (row["type"], row["code"])
                if key in seen:
                    errors.append(f"Ligne {line_no} ({row['code']}) : code déjà employé à la ligne {seen[key]}.")
                else:
                    seen[key] = line_no
        for kind in kinds:
            for line_no, row in rows:
                if row["type"] != kind or (row["code"] and seen.get((kind, row["code"])) != line_no):
                    continue
                seq += 1
                code, label = row["code"], row["libelle"]
                if not code or not label:
                    errors.append(f"Ligne {line_no} : code et libellé obligatoires.")
                    continue
                if kind == "gate":
                    rule = (row["regle"] or "generic").strip().lower()
                    if rule not in RULES:
                        errors.append(f"Ligne {line_no} ({code}) : règle de gate inconnue « {row['regle']} ».")
                        continue
                    gates[code] = self.env["axispro.gate"].create({
                        "policy_id": policy.id, "code": code, "name": label, "sequence": seq,
                        "description": row["aide"] or False, "entry_requirements": row["entree"] or False,
                        "deliverables": row["livrable"] or False, "exit_criteria": row["passage"] or False,
                        "rule_code": rule, "threshold_hold": num(line_no, code, "seuil_attente", 0.0, 0, 100),
                        "threshold_go": num(line_no, code, "seuil_go", 0.0, 0, 100),
                        "min_completeness": num(line_no, code, "completude_min", 0.0, 0, 100),
                        "score_scope": "cumulative" if _plain(row["portee"]).startswith("cumul") else "global",
                    })
                    gate_domains[code] = (line_no, _codes(row["domaines"]))
                elif kind == "domaine":
                    compartment = False
                    if row["compartiment"]:
                        key, title = _compartment(row["compartiment"])
                        if key not in compartments:
                            compartments[key] = self.env["axispro.compartment"].create({
                                "policy_id": policy.id, "code": key, "name": title,
                                "sequence": len(compartments) + 1,
                            })
                        compartment = compartments[key].id
                    domains[code] = self.env["axispro.domain"].create({
                        "policy_id": policy.id, "code": code, "name": label, "sequence": seq,
                        "weight": num(line_no, code, "poids", 1.0, 0), "deliverable": row["livrable"] or False,
                        "compartment_id": compartment,
                    })
                elif kind == "critere":
                    if row["domaine"] not in domains or row["gate"] not in gates:
                        errors.append(f"Ligne {line_no} ({code}) : domaine ou gate inconnu.")
                        continue
                    requirement = REQUIREMENT_ALIASES.get(_plain(row["exigence"]), "apd")
                    if row["exigence"] and _plain(row["exigence"]) not in REQUIREMENT_ALIASES:
                        errors.append(f"Ligne {line_no} ({code}) : exigence inconnue « {row['exigence']} ».")
                        continue
                    values = {
                        "policy_id": policy.id, "code": code, "name": label, "sequence": seq,
                        "domain_id": domains[row["domaine"]].id, "gate_id": gates[row["gate"]].id,
                        "weight": num(line_no, code, "poids", 1.0, 0), "critical": flag(line_no, code, "critique"),
                        "knockout": flag(line_no, code, "eliminatoire"),
                        "evidence_required": flag(line_no, code, "preuve"),
                        "guidance": row["aide"] or False, "requirement_type": requirement,
                        "bankability": flag(line_no, code, "bancabilite") if method else True,
                        "deliverable": row["livrable"] or False,
                    }
                    if row["indicateur"]:
                        indicator = _indicator(row["indicateur"])
                        if not indicator or row["seuil"] == "":
                            errors.append(f"Ligne {line_no} ({code}) : indicateur inconnu ou seuil manquant.")
                            continue
                        values.update({"indicator": indicator, "indicator_threshold": num(line_no, code, "seuil"),
                                       "indicator_has_partial": row["seuil_partiel"] != "",
                                       "indicator_partial": num(line_no, code, "seuil_partiel")})
                    criteria[code] = self.env["axispro.criterion"].create(values)
                    if _plain(row["role"]) == "capex":
                        policy.capex_criterion_id = criteria[code]
                else:
                    linked, unknown = [], []
                    for c in _codes(row["criteres"]):
                        (linked if c in criteria else unknown).append(c)
                    if unknown:
                        errors.append(f"Ligne {line_no} ({code}) : critère(s) inconnu(s) {', '.join(unknown)}.")
                        continue
                    self.env["axispro.document.type"].create({
                        "policy_id": policy.id, "code": code, "name": label, "sequence": seq,
                        "gate_id": gates[row["gate"]].id if row["gate"] in gates else False,
                        "required": not row["critique"] or flag(line_no, code, "critique"),
                        "category": row["domaine"] or False,
                        "guidance": row["aide"] or False,
                        "criterion_ids": [(6, 0, [criteria[c].id for c in linked])],
                    })
        # Compartiments dans l'ordre de leurs codes (C0, C1… C10), quel que soit l'ordre des domaines.
        for i, k in enumerate(sorted(compartments.values(), key=lambda k: _natural(k.code)), start=1):
            k.sequence = i
        for code, (line_no, codes) in gate_domains.items():
            unknown = [c for c in codes if c not in domains]
            if unknown:
                errors.append(f"Ligne {line_no} ({code}) : domaine(s) inconnu(s) {', '.join(unknown)}.")
            gates[code].domain_ids = [(6, 0, [domains[c].id for c in codes if c in domains])]
        if not policy.capex_criterion_id:
            capex = policy.criterion_ids.filtered(lambda c: _plain(c.name).startswith("capex detaille"))[:1]
            policy.capex_criterion_id = capex
        if not errors:
            try:
                policy._check_thresholds()
            except UserError as e:
                errors.append(str(e.args[0]))
        if errors:
            raise UserError("Grille refusée :\n" + "\n".join(errors[:20]))
        return policy

    def copy_as_new_version(self):
        """Nouvelle version modifiable, copie conforme de celle-ci (règles, rattachements compris)."""
        self.ensure_one()
        last = self.search([("company_id", "=", self.company_id.id)], order="version desc", limit=1)
        new = self.copy({"version": last.version + 1, "state": "draft", "date_active": False, "capex_criterion_id": False,
                         "gate_ids": False, "domain_ids": False, "criterion_ids": False, "document_type_ids": False,
                         "compartment_ids": False})
        compartments = {k: k.copy({"policy_id": new.id}) for k in self.compartment_ids}
        domains = {d: d.copy({"policy_id": new.id,
                              "compartment_id": compartments[d.compartment_id].id if d.compartment_id else False})
                   for d in self.domain_ids}
        gates = {g: g.copy({"policy_id": new.id, "domain_ids": [(6, 0, [domains[d].id for d in g.domain_ids])]})
                 for g in self.gate_ids}
        criteria = {c: c.copy({"policy_id": new.id, "gate_id": gates[c.gate_id].id, "domain_id": domains[c.domain_id].id})
                    for c in self.criterion_ids}
        for t in self.document_type_ids:
            t.copy({"policy_id": new.id, "gate_id": gates[t.gate_id].id if t.gate_id else False,
                    "criterion_ids": [(6, 0, [criteria[c].id for c in t.criterion_ids])]})
        if self.capex_criterion_id:
            new.capex_criterion_id = criteria[self.capex_criterion_id]
        return new


def _num(value, default=0.0):
    if value in (None, ""):
        return default
    try:
        return float(str(value).replace(",", ".").strip())
    except ValueError:
        return default


def _plain(value):
    """Texte en minuscules, sans accents (comparaisons de libellés saisis)."""
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    return text.strip().lower()


def _codes(value):
    return [c.strip() for c in str(value or "").replace(",", ";").split(";") if c.strip()]


def _natural(code):
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", code or "")]


def _compartment(value):
    """(code, intitulé) d'un compartiment : « C0 — Coordination et cadrage projet », ou intitulé seul
    (le code en est tiré)."""
    code, title = grille_cabinet.compartment(value)
    return code or (grille_cabinet.label_key(title)[:12].upper() or "K"), title


def _indicator(value):
    """Code d'un indicateur à partir de son code ou de son libellé."""
    text = str(value or "").strip().lower()
    for key, (label, _higher, _unit) in INDICATORS.items():
        if text in (key, label.lower()):
            return key
    return None


TRUE_TOKENS = {"1", "oui", "o", "x", "yes", "y", "vrai", "true"}
FALSE_TOKENS = {"", "0", "non", "n", "no", "faux", "false", "-"}


def _bool(value):
    return _plain(value) in TRUE_TOKENS


def fnum_plain(value):
    return f"{value:g}".replace(".", ",")


def _read_rows(filename, content):
    if filename.lower().endswith((".xlsx", ".xlsm")):
        raw = workbook_rows(content)
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
    header = [_plain(h) for h in raw[0]]
    missing = [c for c in GRID_COLUMNS if c not in header]
    if missing:
        raise UserError("Colonnes manquantes : " + ", ".join(missing))
    index = {c: header.index(c) for c in GRID_COLUMNS + OPTIONAL_COLUMNS if c in header}
    rows = []
    for n, values in enumerate(raw[1:], start=2):
        if not any(v not in (None, "") for v in values):
            continue
        row = dict.fromkeys(OPTIONAL_COLUMNS, "")
        row.update({c: (str(values[i]).strip() if i < len(values) and values[i] is not None else "")
                    for c, i in index.items()})
        row["type"] = _plain(row["type"])
        rows.append((n, row))
    return rows, set(header)


def grid_template():
    """Classeur modèle de la grille, avec quelques lignes d'exemple."""
    import xlsxwriter

    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
    sheet = book.add_worksheet("Grille")
    bold = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
    xlsx_row(sheet, 0, GRID_COLUMNS + OPTIONAL_COLUMNS, bold)
    blank = [""] * len(OPTIONAL_COLUMNS)

    def line(base, **extra):
        values = list(base) + [""] * (len(GRID_COLUMNS) - len(base)) + blank
        for key, value in extra.items():
            values[len(GRID_COLUMNS) + OPTIONAL_COLUMNS.index(key)] = value
        return values

    examples = [
        line(("gate", "G0", "Project Intake", "", "", "", "", "", "", "Le projet entre-t-il dans le champ du cabinet ?"),
             regle="intake", entree="Fiche projet reçue ; promoteur, secteur et pays identifiés.",
             livrable="Accusé de réception ; fiche d'enregistrement.", passage="Décision de recevabilité."),
        line(("gate", "G1", "Prequalification"), regle="prequalification", seuil_attente="30", seuil_go="50",
             portee="cumulee", completude_min="40"),
        line(("domaine", "DOM01", "Marché", "", "", "1"), livrable="Étude de marché ou note de débouché à commander",
             compartiment="C3 — Marché et commercial"),
        line(("critere", "C001", "Étude de marché documentée", "DOM01", "G1", "2", "oui", "non", "oui"),
             exigence="bloquant", bancabilite="oui"),
        line(("critere", "C002", "Couverture du service de la dette", "DOM01", "G1", "2", "oui", "non", "non",
              "DSCR minimal du modèle financier."), exigence="apd", bancabilite="oui", indicateur="dscr_min",
             seuil="1,3", seuil_partiel="1,1"),
        line(("piece", "D001", "Statuts de la société", "A. Corporate / KYC", "G1", "", "oui"), criteres="C001"),
    ]
    for r, row in enumerate(examples, start=1):
        xlsx_row(sheet, r, row)
    sheet.set_column(0, 1, 10)
    sheet.set_column(2, 2, 45)
    sheet.set_column(9, 9, 40)
    sheet.set_column(10, 24, 16)
    help_sheet = book.add_worksheet("Aide")
    xlsx_row(help_sheet, 0, ("Colonne", "Contenu"), bold)
    help_rows = [
        ("exigence", "bloquant, apd ou closing (due diligence et closing, DD-Closing ou DD-SPV-Closing : hors APD Readiness)"),
        ("bancabilite", "oui si le critère compte dans le Bankability Score"),
        ("livrable", "document à produire (critère ou domaine) ; livrables attendus (gate)"),
        ("role", "capex : critère comparé à l'investissement saisi dans la fiche"),
        ("regle", "règle de passage du gate : " + ", ".join(RULES)),
        ("seuil_attente", "en dessous : HOLD (score sur 100, complétude data room, domaines cibles)"),
        ("seuil_go", "au-dessus : GO, entre les deux : CONDITIONAL GO (préqualification)"),
        ("portee", "globale (toute la grille) ou cumulee (critères des gates atteints)"),
        ("domaines", "codes des domaines contrôlés par le gate, séparés par ;"),
        ("criteres", "pour une pièce : codes des critères qu'elle justifie, séparés par ;"),
        ("compartiment", "pour un domaine : compartiment qui le porte, « C0 — Coordination et cadrage projet »"),
        ("completude_min", "pour un gate : complétude documentaire exigée pour l'examiner (en %, 0 : aucune)"),
        ("Outil du cabinet", "le classeur de scoring du cabinet (onglets Scoring, Stage_Gate, Data_Room_Index, "
                             "Parametres) s'importe aussi tel quel"),
    ]
    for r, row in enumerate(help_rows, start=1):
        xlsx_row(help_sheet, r, row)
    help_sheet.set_column(0, 0, 16)
    help_sheet.set_column(1, 1, 90)
    indicators = book.add_worksheet("Indicateurs")
    xlsx_row(indicators, 0, ("Code", "Indicateur", "Sens", "Unité"), bold)
    for r, (key, (label, higher, unit)) in enumerate(INDICATORS.items(), start=1):
        xlsx_row(indicators, r, (key, label, "au moins le seuil" if higher else "au plus le seuil", unit))
    indicators.set_column(0, 0, 18)
    indicators.set_column(1, 1, 40)
    indicators.set_column(2, 3, 18)
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
    entry_requirements = fields.Text("Exigences d'entrée")
    deliverables = fields.Text("Livrables attendus")
    exit_criteria = fields.Text("Critères de passage")
    rule_code = fields.Selection(list(RULES.items()), "Règle de passage", default="generic", required=True)
    threshold_hold = fields.Float("Seuil d'attente", help="En dessous : HOLD. 0 : pas de seuil.")
    threshold_go = fields.Float("Seuil GO", help="Préqualification : au-dessus GO, entre les deux CONDITIONAL GO.")
    score_scope = fields.Selection(SCOPES, "Portée du score", default="global", required=True)
    min_completeness = fields.Float("Complétude documentaire minimale (%)",
                                    help="Exigence d'entrée : en dessous, le gate ne s'examine pas (HOLD). 0 : aucune. "
                                         "Mesurée sur la même portée que le score.")
    domain_ids = fields.Many2many("axispro.domain", "axispro_gate_domain_rel", "gate_id", "domain_id",
                                  "Domaines contrôlés")


class AxisproCompartment(models.Model):
    _name = "axispro.compartment"
    _description = "Compartiment d'expertise (domaines confiés à un même consultant)"
    _order = "policy_id, sequence"

    policy_id = fields.Many2one("axispro.policy", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer()
    code = fields.Char(required=True)
    name = fields.Char(required=True)
    domain_ids = fields.One2many("axispro.domain", "compartment_id", "Domaines")


class AxisproDomain(models.Model):
    _name = "axispro.domain"
    _description = "Domaine d'évaluation"
    _order = "policy_id, sequence"

    policy_id = fields.Many2one("axispro.policy", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer()
    code = fields.Char(required=True)
    name = fields.Char(required=True)
    weight = fields.Float("Pondération", default=1.0)
    deliverable = fields.Char("Livrable type pour combler un écart")
    compartment_id = fields.Many2one("axispro.compartment", "Compartiment", ondelete="set null", index=True)


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
    weight = fields.Float("Poids", default=1.0)
    critical = fields.Boolean("Critique")
    knockout = fields.Boolean("Éliminatoire", help="Non satisfait : NO-GO quel que soit le score.")
    evidence_required = fields.Boolean("Preuve requise")
    requirement_type = fields.Selection(list(REQUIREMENTS.items()), "Exigence", default="apd", required=True)
    bankability = fields.Boolean("Pertinent pour la bancabilité", default=True)
    deliverable = fields.Char("Document à produire")
    # Critère adossé à un indicateur du modèle financier : statut suggéré à l'évaluateur.
    indicator = fields.Selection([(k, v[0]) for k, v in INDICATORS.items()], "Indicateur du modèle financier")
    indicator_threshold = fields.Float("Seuil de satisfaction")
    indicator_has_partial = fields.Boolean("Seuil partiel défini")
    indicator_partial = fields.Float("Seuil de satisfaction partielle")

    def default_deliverable(self):
        self.ensure_one()
        return self.deliverable or self.domain_id.deliverable or self.guidance or f"Compléter : {self.name}"

    def suggestion(self, indicators):
        """Statut suggéré par le modèle financier (None sans indicateur ou sans modèle)."""
        self.ensure_one()
        if not self.indicator or indicators is None:
            return None
        result = suggest(self.indicator, self.indicator_threshold,
                         self.indicator_partial if self.indicator_has_partial else None, indicators)
        label, higher, unit = INDICATORS[self.indicator]
        return dict(result, indicator=self.indicator, label=label, unit=unit, higher=higher,
                    threshold=self.indicator_threshold,
                    partial=self.indicator_partial if self.indicator_has_partial else None)


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
    criterion_ids = fields.Many2many("axispro.criterion", "axispro_document_type_criterion_rel", "document_type_id",
                                     "criterion_id", "Critères justifiés")
