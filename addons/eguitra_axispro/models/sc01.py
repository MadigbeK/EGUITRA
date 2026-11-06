"""Méthode SC-01 V2.0 (cahier des charges du 4 novembre 2026) : ce que la référence ajoute au dossier.

Recevabilité (4 conditions, passage au Gate 1 quand le projet est déclaré recevable au Gate 0), versions
d'évaluation figées (jamais modifiables), états de la barre des 7 étapes, décision de comité en une action,
validation des « Non applicable » par un administrateur, journal de chaque modification d'un critère, états de
vérification et nom normalisé des pièces, suivi promoteur, message de relance de l'annexe D, et tableau de
pilotage de l'accueil et du portefeuille (une seule requête, 500 dossiers en moins de 2 secondes).

Le gate d'un dossier de cette méthode ne change que par la recevabilité et par une décision de comité. Une
décision n'immobilise pas le dossier : elle est scellée comme les autres, le dossier reste modifiable et le
comité suivant statue sur le gate atteint. Un dossier d'une politique plus ancienne garde tout le comportement
précédent : chaque méthode redéfinie ici renvoie à celle du module pour lui.
"""

import re
import unicodedata
from collections import defaultdict
from datetime import datetime

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError

from .. import scoring as method
from .dossier import RECOMMENDATIONS, _system

SECTORS = (
    "Mines et infrastructures minières", "Énergie", "Industrie et transformation", "Agro-industrie",
    "Infrastructures et logistique", "Économie numérique", "Tourisme et loisirs", "Immobilier", "Autre",
)
ADMISSIBILITY = (
    ("rec_sector", "Secteur dans le champ MB AxisPro / KUC"),
    ("rec_country", "Pays d'implantation couvert"),
    ("rec_size", "Taille compatible avec le mandat"),
    ("rec_promoter", "Promoteur identifié (nom, contact, statut juridique)"),
)
ADMISSIBILITY_FIELDS = {key for key, _label in ADMISSIBILITY}
VERIFICATIONS = [
    ("to_check", "À vérifier"), ("conforming", "Conforme"), ("unsigned", "Non signé"), ("expired", "Périmé"),
    ("incomplete", "Incomplet"),
]
# État de la pièce (ancienne data room) et état de vérification se suivent : une pièce non conforme est à reprendre.
VERIFICATION_STATES = {"to_check": "received", "conforming": "validated", "unsigned": "rejected", "expired": "rejected",
                       "incomplete": "rejected"}
STATE_VERIFICATIONS = {"received": "to_check", "validated": "conforming", "rejected": "incomplete"}
RG_IDENTITY = "Renseignez au moins l'intitulé et le promoteur."
RG_ADMISSIBLE = "Cochez les 4 conditions de recevabilité avant de déclarer le projet recevable."
RG_NOTED = "Vous avez noté des critères de ce dossier : vous ne pouvez pas voter sa décision de comité."
RG_OBSERVATION = "Observation obligatoire pour « Incomplet » et « Non applicable » : saisissez-la."
OBSERVATION_STATUSES = ("partial", "na")
BUSINESS_PLAN_NOTE = "Business plan déposé à la création : statut à fixer après vérification"
APD_READY_PLUS = ("APD READY", "ADVANCED / BANKABLE CANDIDATE")
# Champs d'un critère journalisés avec l'ancienne et la nouvelle valeur (RG-07-04), en plus du statut.
JOURNALED_FIELDS = {"comment": "Observation", "responsible": "Responsable", "due_date": "Échéance",
                    "reference": "Référence", "deliverable": "Document à produire"}
JOURNAL_VALUE = 200
TONES = {"overdue": "rouge", "due": "orange", "never": "orange", "complete": "vert", "recent": "neutre",
         "inactive": "neutre"}


def is_sc01(policy):
    return policy.method == method.METHOD_SC01


def _grid(policy):
    """Grille d'une politique pour le calcul des indicateurs (scoring.sc01_brief), lue une fois par requête."""
    gates = policy.gate_ids.sorted("sequence")
    index = {g.id: i for i, g in enumerate(gates)}
    return {
        "settings": method.sc01_settings(policy.scoring_settings()),
        "gates": gates, "index": index, "last_gate": max(len(gates) - 1, 0),
        "holds": {i: g.threshold_hold for i, g in enumerate(gates) if g.threshold_hold},
        "criteria": [{"id": c.id, "weight": c.weight, "requirement": c.requirement_type, "bankability": c.bankability,
                      "critical": c.critical, "knockout": c.knockout, "gate_index": index.get(c.gate_id.id, 0)}
                     for c in policy.criterion_ids.sorted("sequence")],
    }


def label_key(text):
    """Intitulé normalisé (minuscules, sans accents, lettres et chiffres seuls) : clé d'un critère ou d'une pièce
    d'une version de la grille à l'autre."""
    plain = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in plain if ch.isalnum())


def _gate_number(gate, position, count):
    """Numéro du gate d'arrivée d'une bascule : celui que porte son code (« Gate 3 »), à défaut sa position."""
    found = re.search(r"\d+", gate.code or "")
    number = int(found.group()) if found else position
    return min(number, count - 1)


def _text(value):
    return "" if value in (None, False) else str(value)[:JOURNAL_VALUE]


class AxisproVersion(models.Model):
    """Version figée de l'évaluation (EC-08) : scores et notes à la date, jamais modifiables. Elle ne se crée que
    par dossier.freeze_version(), sous le contrôle du noyau ; les profils n'ont que la lecture."""

    _name = "axispro.version"
    _description = "Version figée d'une évaluation"
    _order = "dossier_id, rank desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True, readonly=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    rank = fields.Integer("Rang", required=True, readonly=True)
    date = fields.Datetime(default=fields.Datetime.now, required=True, readonly=True)
    readiness = fields.Float(readonly=True)
    apd = fields.Float(readonly=True)
    bankability = fields.Float(readonly=True)
    completeness = fields.Float(readonly=True)
    knockouts = fields.Integer(readonly=True)
    knockouts_next = fields.Integer(readonly=True)
    gate_id = fields.Many2one("axispro.gate", ondelete="set null", readonly=True)
    gate_index = fields.Integer(readonly=True)
    gate_code = fields.Char(readonly=True)
    gate_name = fields.Char(readonly=True)
    classification = fields.Char(readonly=True)
    decision = fields.Char(readonly=True)
    snapshot = fields.Json("Notes et domaines à la date", readonly=True)
    user_id = fields.Many2one("res.users", "Par", default=lambda self: self.env.user, required=True, readonly=True)

    _unique = models.Constraint("unique(dossier_id, rank)", "Une version de ce rang existe déjà pour ce dossier.")

    def write(self, vals):
        raise UserError("Une version figée ne se modifie jamais : figez-en une nouvelle.")

    def unlink(self):
        raise UserError("Une version figée ne se supprime jamais.")


class AxisproDossierSc01(models.Model):
    _inherit = "axispro.dossier"

    rec_sector = fields.Boolean(ADMISSIBILITY[0][1])
    rec_country = fields.Boolean(ADMISSIBILITY[1][1])
    rec_size = fields.Boolean(ADMISSIBILITY[2][1])
    rec_promoter = fields.Boolean(ADMISSIBILITY[3][1])
    admissible = fields.Boolean("Projet recevable", copy=False)
    admissible_date = fields.Date("Déclaré recevable le", readonly=True, copy=False)
    admissible_by = fields.Many2one("res.users", "Déclaré recevable par", readonly=True, copy=False)
    version_ids = fields.One2many("axispro.version", "dossier_id", "Versions figées")

    # ─── Recevabilité (RG-05-02, RG-05-03) ────────────────────────────────

    def write(self, vals):
        if "admissible" not in vals and not ADMISSIBILITY_FIELDS & set(vals):
            return super().write(vals)
        declared = self.browse()
        for dossier in self.filtered(lambda d: is_sc01(d.policy_id)):
            if vals.get("admissible", dossier.admissible):
                if not all(vals.get(key, dossier[key]) for key in ADMISSIBILITY_FIELDS):
                    raise UserError(RG_ADMISSIBLE)
                if not dossier.admissible:
                    declared |= dossier
        if "admissible" in vals and not vals["admissible"]:
            vals = dict(vals, admissible_date=False, admissible_by=False)
        result = super().write(vals)
        for dossier in declared:
            dossier._declare_admissible()
        return result

    def _declare_admissible(self):
        """Date et auteur de la déclaration ; au Gate 0, passage au Gate 1 inscrit au journal."""
        self.ensure_one()
        values = {"admissible_date": fields.Date.context_today(self), "admissible_by": self.env.user.id}
        gates = self.policy_id.gate_ids.sorted("sequence")
        first, second = gates[:1], gates[1:2]
        moved = second and (not self.current_gate_id or self.current_gate_id == first)
        if moved:
            values["current_gate_id"] = second.id
        # Contrôles faits : écriture du noyau.
        self.sudo().with_context(axispro_unlocked=True).write(values)
        note = "Projet déclaré recevable."
        if moved:
            note = f"Projet déclaré recevable : passage de {first.code} à {second.code}."
        self.log("gate", note=note)

    def admissibility(self):
        self.ensure_one()
        return {
            "conditions": [{"key": key, "label": label, "checked": bool(self[key])} for key, label in ADMISSIBILITY],
            "admissible": self.admissible, "date": self.admissible_date or None,
            "by": self.sudo().admissible_by.name or None,
        }

    # ─── Résultats, étapes et versions ────────────────────────────────────

    def _named_passage(self, passage):
        """Conditions de passage, avec le code et le nom du gate visé."""
        target = self.policy_id.gate_ids.sorted("sequence")[passage["to"]] if passage.get("to") is not None else None
        return dict(passage, to_code=target.code if target else None, to_name=target.name if target else None)

    def steps(self, result=None):
        """Barre des 7 étapes (6.12) : état court et coche de chaque étape. Vide pour une ancienne politique."""
        self.ensure_one()
        if not is_sc01(self.policy_id):
            return []
        r = result or self.evaluate()
        identity = bool(self.name and self.promoter_id)
        pieces = len(self.document_ids)
        relances = len(self.relance_ids)
        decisions = self.review_ids.filtered(lambda x: x.state == "locked").sorted(lambda x: (x.date, x.id))
        step5 = (f"{relances} relance(s)" if relances else f"{r['missing']} gaps" if r["missing"] else "Rien à relancer")
        rows = [
            ("Fiche projet", "À compléter" if not identity else "Recevable" if self.admissible else "À statuer",
             identity and self.admissible),
            ("Pièces", f"{pieces} pièce(s)", pieces > 0),
            ("Scoring", f"{r['assessed']} / {r['criteria']} notés", r["assessed"] >= r["criteria"] > 0),
            ("Résultats", f"{method.fnum(r['readiness'])} / 100", r["assessed"] > 0),
            ("Relances", step5, relances > 0 or not r["missing"]),
            ("Comité", method.DECISIONS.get(decisions[-1].decision, "Aucune décision") if decisions else "Aucune décision",
             bool(decisions)),
            ("Dossier complet", ".zip", False),
        ]
        return [{"step": i, "name": name, "state": state, "done": bool(done)}
                for i, (name, state, done) in enumerate(rows, start=1)]

    def freeze_version(self):
        """Fige l'évaluation à la date (EC-08), en v1, v2… Le verrou de la ligne du dossier sérialise deux clics
        simultanés : le rang ne se reprend jamais."""
        self.ensure_one()
        self._check_open()
        self.env.cr.execute("SELECT id FROM axispro_dossier WHERE id = %s FOR UPDATE", (self.id,))
        r = self.evaluate()
        Version = self.env["axispro.version"].sudo()
        last = Version.search([("dossier_id", "=", self.id)], order="rank desc", limit=1)
        gate = self.current_gate_id
        version = Version.create({
            "dossier_id": self.id, "rank": last.rank + 1, "readiness": r["readiness"], "apd": r["apd"],
            "bankability": r["bankability"], "completeness": r["completeness"], "knockouts": len(r["knockouts"]),
            "knockouts_next": len(r["knockouts_next"]), "gate_id": gate.id or False, "gate_index": r["gate"],
            "gate_code": gate.code or False, "gate_name": gate.name or False, "classification": r["classification"],
            "decision": r["decision"], "user_id": self.env.user.id,
            "snapshot": {
                "notes": [{"rank": x["rank"], "code": x["code"], "status": x["entered"], "retained": x["status"],
                           "comment": x["comment"], "responsible": x["responsible"],
                           "due_date": x["due_date"].isoformat() if x["due_date"] else None,
                           "reference": x["reference"]} for x in r["lines"]],
                "domains": [{"code": d["code"], "name": d["name"], "score": d["score"], "priority": d["priority"]}
                            for d in r["domains"]],
            },
        })
        self.log("revision", note=f"Version v{version.rank} de l'évaluation figée "
                                  f"(Readiness {method.fnum(r['readiness'])}).")
        return version.with_env(self.env)

    # ─── Pièces ───────────────────────────────────────────────────────────

    def next_piece_rank(self, letter):
        """Rang suivant dans une catégorie (RG-06-01), sous le verrou de la ligne du dossier ; jamais repris."""
        self.ensure_one()
        self.env.cr.execute("SELECT id FROM axispro_dossier WHERE id = %s FOR UPDATE", (self.id,))
        documents = self.env["axispro.document"].sudo().search([("dossier_id", "=", self.id),
                                                                ("category_letter", "=", letter)],
                                                               order="category_rank desc", limit=1)
        return documents.category_rank + 1

    # ─── Comité (EC-10) ───────────────────────────────────────────────────

    def next_gate(self):
        """Gate qui suit le gate courant (vide au dernier)."""
        self.ensure_one()
        gates = self.policy_id.gate_ids.sorted("sequence")
        gate = self.current_gate_id
        return gates.filtered(lambda g: g.sequence > gate.sequence)[:1] if gate else gates[1:2]

    def noted_by_me(self):
        """RG-00-01 : le compte a changé le statut d'au moins un critère de ce dossier (journal, non modifiable)."""
        self.ensure_one()
        return bool(self.env["axispro.journal"].sudo().search_count(
            [("dossier_id", "=", self.id), ("kind", "=", "status"), ("user_id", "=", self.env.uid)], limit=1))

    def check_committee(self, decision=None):
        """Refus d'enregistrer une décision de comité : dossier clos, droit, RG-00-01, quatre yeux, dernier gate.
        L'exception porte le motif que l'écran affiche."""
        self.ensure_one()
        self._check_open()
        self._check_decision_right("enregistrer la décision du comité")
        if not _system(self.env) and self.noted_by_me():
            raise AccessError(RG_NOTED)
        self._check_four_eyes("enregistrer la décision de son comité")
        if not self.next_gate():
            raise UserError("Le dossier est au dernier gate : aucun passage à décider.")
        if decision == "postponed":
            raise UserError("Décision inconnue de la méthode : GO, CONDITIONAL GO, HOLD ou NO-GO.")

    def committee_refusal(self):
        """Motif en clair quand le compte ne peut pas enregistrer de décision, sinon None."""
        try:
            self.check_committee()
        except UserError as refusal:
            return refusal.args[0]
        return None

    def committee_decide(self, decision, day=None, members=None, motive=None, conditions=None):
        """« Enregistrer la décision » : une seule action, qui crée la décision et la scelle (RG-10-03). Le comité
        n'écrit pas les revues du cabinet : création par le noyau, sceau sous l'identité de l'utilisateur."""
        self.ensure_one()
        review = self.env["axispro.review"].sudo().create({
            "dossier_id": self.id, "date": day or fields.Date.context_today(self),
            "gate_id": self.current_gate_id.id or False, "decision": decision, "members": members or False,
            "motive": motive or False, "conditions": conditions or False, "revision": self.revision,
            "policy_version": self.policy_id.version,
        })
        review = review.with_env(self.env)
        review.action_lock()
        return review

    def _committee_outcome(self, decision):
        """Effet d'une décision scellée (RG-10-02) : GO et CONDITIONAL GO, gate suivant ; HOLD, maintien ; NO-GO,
        dossier clos, jamais supprimé."""
        self.ensure_one()
        values = {"decision": decision}
        if decision in ("go", "conditional"):
            values["current_gate_id"] = self.next_gate().id
        elif decision == "no_go":
            values["state"] = "closed"
        return values

    # ─── Bascule d'un dossier sur la grille V2.0 ───────────────────────────

    def switch_policy(self, target):
        """Passe le dossier d'une ancienne politique à la grille `target` de la méthode SC-01 V2.0 : évaluations,
        pièces, rattachements et affectations suivent par libellé de critère, de pièce ou code de compartiment ;
        un critère sans équivalent reste non évalué et le critère perdu est cité au journal. Un verrou de comité est
        levé (révision suivante), la décision scellée reste lue telle quelle. Au-delà du Gate 0, le dossier est tenu
        pour recevable. Rend le bilan, ou None si le dossier suit déjà la méthode. Réservé au script d'exploitation
        scripts/grille/basculer_v2.py (compte système) ; aucune route de l'API ne l'appelle."""
        self.ensure_one()
        if not _system(self.env):
            raise AccessError("La bascule d'un dossier se lance par le script d'exploitation.")
        if not is_sc01(target):
            raise UserError("La bascule vise une politique de la méthode SC-01 V2.0.")
        if is_sc01(self.policy_id):
            return None
        dossier = self.with_context(axispro_unlocked=True)
        criteria = {label_key(c.name): c for c in target.criterion_ids}
        kept, lost = {}, []
        previous = dossier.evaluation_ids
        for e in previous.sorted(lambda e: (e.criterion_id.sequence, e.id)):
            criterion = criteria.get(label_key(e.criterion_id.name))
            if criterion and criterion.id not in kept:
                kept[criterion.id] = e
            elif e.status != "not_assessed" or e.comment:
                lost.append(e.criterion_id.name)
        for action in dossier.action_ids.filtered("criterion_id"):
            action.criterion_id = criteria.get(label_key(action.criterion_id.name), self.env["axispro.criterion"])
        self._switch_documents(target)
        old_gates = dossier.policy_id.gate_ids.sorted("sequence")
        new_gates = target.gate_ids.sorted("sequence")
        current = dossier.current_gate_id or old_gates[:1]
        number = _gate_number(current, list(old_gates.ids).index(current.id) if current else 0, len(new_gates))
        values = {"policy_id": target.id, "current_gate_id": new_gates[number].id}
        if dossier.locked_review_id:
            values.update(locked_review_id=False, revision=dossier.revision + 1)
        if not dossier.dscr_manual:
            values["dscr_manual"] = (dossier.financial_indicators() or {}).get("dscr_min") or 0.0
        dossier.write(values)
        for assignment in dossier.assignment_ids:
            compartment = target.compartment_ids.filtered(lambda k: k.code == assignment.compartment_id.code)
            if compartment:
                assignment.compartment_id = compartment
            else:
                assignment.unlink()
        new_rows = []
        for criterion in target.criterion_ids:
            row = {"dossier_id": dossier.id, "criterion_id": criterion.id}
            e = kept.get(criterion.id)
            if e:
                row.update(status=e.status, comment=e.comment, deliverable=e.deliverable, responsible=e.responsible,
                           due_date=e.due_date, assessed_by=e.assessed_by.id, assessed_at=e.assessed_at,
                           document_ids=[(6, 0, e.document_ids.ids)])
            new_rows.append(row)
        previous.unlink()
        self.env["axispro.evaluation"].create(new_rows)
        if number > 0:
            dossier.write(dict.fromkeys(ADMISSIBILITY_FIELDS | {"admissible"}, True))
        summary = {"reference": dossier.reference, "moved": len(kept), "lost": lost, "gate": number,
                   "not_assessed": len(new_rows) - len(kept),
                   "na_pending": sum(1 for row in new_rows if row.get("status") == "na")}
        note = (f"Bascule sur la grille V2.0 (version {target.version}) : {len(kept)} critères repris, "
                f"{summary['not_assessed']} non évalués, gate {number}.")
        if lost:
            note += " Critères sans équivalent : " + " ; ".join(lost) + "."
        dossier.log("import", note=note)
        return summary

    def _switch_documents(self, target):
        """Pièces d'un dossier basculé : pièce standard retrouvée par son intitulé, catégorie et rang de la grille."""
        types = {label_key(t.name): t for t in target.document_type_ids}
        ranks = defaultdict(int)
        for doc in self.document_ids.sorted("id").with_context(axispro_unlocked=True):
            doc_type = types.get(label_key(doc.document_type_id.name)) if doc.document_type_id else None
            letter = method.category_letter(doc_type.category) if doc_type else ""
            ranks[letter] += 1
            doc.write({
                "document_type_id": doc_type.id if doc_type else False, "category_letter": letter or False,
                "category_rank": ranks[letter] if letter else 0,
                "original_name": doc.original_name or doc.attachment_id.name,
            })

    # ─── Relances (EC-09) ─────────────────────────────────────────────────

    def relance_items(self, result=None):
        """Pièces manquantes du dossier, tri 7.4, 20 au plus : le cahier des charges cite l'intitulé du critère dans
        le message, à la différence de l'ancienne règle (models/relance.py), qui reste pour les anciennes politiques."""
        self.ensure_one()
        r = result or self.evaluate()
        if r.get("method") != method.METHOD_SC01:
            return super().relance_items(r)
        today = fields.Date.context_today(self)
        evaluations = {e.criterion_id.id: e.id for e in self.evaluation_ids}
        to_lift = {k["id"] for k in r["knockouts_next"]}
        labels = {"partial": "Incomplet / à actualiser", "not_met": "Non disponible"}
        return [{
            "key": f"crit-{g['id']}", "label": g["name"], "state": "partial" if g["status"] == "partial" else "missing",
            "status": g["status"], "status_label": labels[g["status"]], "priority": round(g["priority"], 2),
            "blocking": bool(g.get("critical")) or g["id"] in to_lift, "knockout": bool(g.get("knockout")),
            "knockout_gate": g["gate_index"] if g.get("knockout") else None, "rank": g["rank"],
            "domain": g["domain"].get("name"), "due_date": g["due_date"],
            "overdue": bool(g["due_date"] and g["due_date"] < today), "observation": g["comment"],
            "evaluation_id": evaluations.get(g["id"]), "criteria": [g["code"]],
        } for g in r["gaps_top"]]

    def followup(self, items=None, result=None):
        """Suivi promoteur (RG-02-03), sur tous les manques du dossier et non sur les 20 du message."""
        self.ensure_one()
        if not is_sc01(self.policy_id):
            return super().followup(items, result)
        r = result or self.evaluate()
        last = self.relance_ids[:1]
        info = method.sc01_followup(r["missing"], r["overdue"], last.date or None, fields.Date.context_today(self),
                                    r["policy"]["relance_days"], self.state == "open")
        if self.state == "on_hold":
            info["label"] = "Suspendu"
        return dict(info, count=len(self.relance_ids), last_channel=last.channel or None)

    def relance_message(self, items=None, result=None):
        """Message de relance de l'annexe D, au mot près."""
        self.ensure_one()
        if not is_sc01(self.policy_id):
            return super().relance_message(items, result)
        r = result or self.evaluate()
        items = self.relance_items(r) if items is None else items
        target = self.policy_id.gate_ids.sorted("sequence")[r["target_gate"]]
        return method.sc01_relance_message(self.reference, self.name, self.contact()["name"], r["target_gate"],
                                           target.name, items, self.consultant_id.name)

    # ─── Pilotage (EC-01, EC-02) ──────────────────────────────────────────

    def pilotage(self, filtre=None):
        """Accueil et portefeuille en une réponse. Les notes se lisent en une requête par table et chaque grille une
        seule fois : le calcul par dossier reste une passe sur 111 critères (scoring.sc01_brief). Un dossier d'une
        ancienne politique passe, lui, par l'évaluation complète, le temps de sa bascule."""
        today = fields.Date.context_today(self)
        dossiers = self.search([], order="reference desc, id desc")
        ids = dossiers.ids
        notes, touched, pieces, relances = self._pilotage_tables(ids)
        grids = {}
        rows = []
        for d in dossiers:
            policy = d.policy_id
            if not is_sc01(policy):
                rows.append(self._pilotage_legacy(d, today))
                continue
            grid = grids.get(policy.id)
            if grid is None:
                grid = grids[policy.id] = _grid(policy)
            index = grid["index"].get(d.current_gate_id.id, 0)
            brief = method.sc01_brief(grid["settings"], grid["criteria"], notes.get(d.id, {}), index, grid["last_gate"],
                                      d.admissible, d.dscr_manual or None, grid["holds"], today)
            count, last_date = relances.get(d.id, (0, None))
            followup = method.sc01_followup(brief["missing"], brief["overdue"], last_date, today,
                                            grid["settings"]["relance_days"], d.state == "open")
            if d.state == "on_hold":
                followup["label"] = "Suspendu"
            rows.append(dict(
                self._pilotage_row(d, index),
                target_gate=brief["passage"]["to"], readiness=brief["readiness"], apd=brief["apd"],
                bankability=brief["bankability"], completeness=brief["completeness"], knockouts=brief["knockouts"],
                knockouts_next=brief["knockouts_next"], classification=brief["classification"],
                decision=brief["decision"], decision_label=method.DECISIONS[brief["decision"]],
                ready_for_committee=brief["passage"]["ready_for_committee"], next_due=brief["next_due"],
                next_due_overdue=bool(brief["next_due"] and brief["next_due"] < today),
                followup=dict(followup, count=count),
            ))
        for row in rows:
            row["pieces"] = pieces.get(row["id"], 0)
            row["updated_at"] = max(filter(None, (row["updated_at"], touched.get(row["id"]))), default=None)
        return self._pilotage_payload(rows, today, filtre, dossiers)

    def _pilotage_tables(self, ids):
        """Notes, dernière modification, nombre de pièces et relances des dossiers que le compte peut lire (ids) :
        lecture directe en base, sans repasser par l'ORM enregistrement par enregistrement."""
        self.env["axispro.evaluation"].flush_model(["dossier_id", "criterion_id", "status", "na_validated", "due_date"])
        self.env["axispro.document"].flush_model(["dossier_id"])
        self.env["axispro.relance"].flush_model(["dossier_id", "date"])
        cr = self.env.cr
        notes = defaultdict(dict)
        touched = {}

        def touch(key, value):
            if value and (key not in touched or value > touched[key]):
                touched[key] = value

        cr.execute("SELECT dossier_id, criterion_id, status, na_validated, due_date, write_date "
                   "FROM axispro_evaluation WHERE dossier_id = ANY(%s)", (ids,))
        for dossier_id, criterion_id, status, validated, due, written in cr.fetchall():
            notes[dossier_id][criterion_id] = {"status": status, "na_validated": validated, "due_date": due}
            touch(dossier_id, written)
        cr.execute("SELECT dossier_id, count(*), max(write_date) FROM axispro_document "
                   "WHERE dossier_id = ANY(%s) GROUP BY dossier_id", (ids,))
        pieces = {}
        for dossier_id, count, written in cr.fetchall():
            pieces[dossier_id] = count
            touch(dossier_id, written)
        cr.execute("SELECT dossier_id, count(*), max(date), max(write_date) FROM axispro_relance "
                   "WHERE dossier_id = ANY(%s) GROUP BY dossier_id", (ids,))
        relances = {}
        for dossier_id, count, last, written in cr.fetchall():
            relances[dossier_id] = (count, last)
            touch(dossier_id, written)
        return notes, touched, pieces, relances

    @staticmethod
    def _pilotage_row(d, index):
        """Partie de la ligne commune aux deux méthodes."""
        gate = d.current_gate_id
        return {
            "id": d.id, "reference": d.reference, "name": d.name, "promoter": d.promoter_id.name, "state": d.state,
            "consultant": d.consultant_id.name or None, "method": d.policy_id.method, "admissible": d.admissible,
            "gate": {"index": index, "code": gate.code or None, "name": gate.name or None},
            "updated_at": d.write_date, "identity_complete": bool(d.name and d.promoter_id),
        }

    def _pilotage_legacy(self, d, today):
        """Ligne d'un dossier d'une ancienne politique, tirée de son évaluation complète."""
        result = d.evaluate()
        score = d.scoring(result)
        followup = d.followup(result=result)
        gates = d.policy_id.gate_ids.sorted("sequence")
        index = {g.id: i for i, g in enumerate(gates)}.get(d.current_gate_id.id, 0)
        labels = {"complete": "Dossier complet", "overdue": f"{followup['overdue']} échéance(s) dépassée(s)",
                  "never": "Jamais relancé", "due": "À relancer", "recent": "Relancé récemment",
                  "inactive": "Suspendu" if d.state == "on_hold" else "Clos"}
        due = [g["due_date"] for g in d.gaps(0, result) if g["due_date"]]
        next_due = min(due) if due else None
        recommendation = score["recommendation"]
        return dict(
            self._pilotage_row(d, index),
            target_gate=index + 1 if index + 1 < len(gates) else None, readiness=score["readiness"], apd=score["apd"],
            bankability=score["bankability"], completeness=score["completeness"], knockouts=len(score["knockouts"]),
            knockouts_next=0, classification=score["classification"], decision=recommendation,
            decision_label=dict(RECOMMENDATIONS).get(recommendation, recommendation), ready_for_committee=False,
            next_due=next_due, next_due_overdue=bool(next_due and next_due < today),
            followup=dict(followup, label=labels[followup["state"]], tone=TONES[followup["state"]]),
        )

    def _pilotage_payload(self, rows, today, filtre, dossiers):
        active = [r for r in rows if r["state"] != "closed"]
        to_chase = sorted((r for r in active if r["followup"]["due"]),
                          key=lambda r: (r["followup"]["state"] != "overdue", r["next_due"] or today.max, r["reference"]))
        blocked = [r for r in active if r["knockouts"]]
        ready = [r for r in active if r["ready_for_committee"]]
        apd_ready = [r for r in active if not r["knockouts"] and r["classification"] in APD_READY_PLUS]
        to_complete = []
        for r in active:
            if not r["identity_complete"]:
                to_complete.append(dict(r, reason="Identité incomplète"))
            elif r["method"] == method.METHOD_SC01 and not r["admissible"]:
                to_complete.append(dict(r, reason="Recevabilité à statuer"))
        policy = self.env["axispro.policy"].active_policy(self.env.company) or dossiers[:1].policy_id
        gates = policy.gate_ids.sorted("sequence")
        counts = defaultdict(int)
        for r in active:
            counts[r["gate"]["index"]] += 1
        most = max(counts.values(), default=0)
        by_gate = [{"index": i, "code": g.code, "name": g.name, "count": counts[i],
                    "pct": round(counts[i] / most * 100) if most else 0} for i, g in enumerate(gates)]
        recent = sorted(active, key=lambda r: r["updated_at"] or datetime.min, reverse=True)[:5]
        selected = {"relance": to_chase, "bloques": blocked, "apd": apd_ready}.get(filtre, rows)
        return {
            "today": today,
            "counters": {"projects": len(active), "to_chase": len(to_chase), "blocked": len(blocked),
                         "ready": len(ready), "apd_ready_plus": len(apd_ready)},
            "to_chase": to_chase, "ready": ready, "blocked": blocked, "to_complete": to_complete, "by_gate": by_gate,
            "recent": recent, "rows": sorted(selected, key=lambda r: r["reference"], reverse=True),
        }


class AxisproEvaluationSc01(models.Model):
    _inherit = "axispro.evaluation"

    reference = fields.Char("Référence / fichier")
    na_validated = fields.Boolean("Non applicable validé", readonly=True, copy=False)
    na_validated_by = fields.Many2one("res.users", "Validé par", readonly=True, copy=False)
    na_validated_at = fields.Datetime("Validé le", readonly=True, copy=False)

    def write(self, vals):
        """RG-07-04 : chaque saisie est journalisée (ancienne et nouvelle valeur) ; RG-07-03 : un statut qui change
        retire la validation d'un « Non applicable »."""
        sc01 = self.filtered(lambda e: is_sc01(e.dossier_id.policy_id))
        journaled = JOURNALED_FIELDS.keys() & vals.keys()
        before = {e.id: {key: e[key] for key in journaled} for e in sc01} if journaled else {}
        revoked = self.filtered(lambda e: e.na_validated and e.status != vals["status"]) if "status" in vals else self.browse()
        result = super().write(vals)
        if revoked:
            super(AxisproEvaluationSc01, revoked).write({"na_validated": False, "na_validated_by": False,
                                                         "na_validated_at": False})
        for e in sc01.filtered(lambda e: e.id in before):
            for key in journaled:
                old, new = _text(before[e.id][key]), _text(e[key])
                if old != new:
                    e.dossier_id.log("evaluation", note=JOURNALED_FIELDS[key], criterion=e.criterion_id,
                                     before=old or "(vide)", after=new or "(vide)")
        return result

    def action_validate_na(self, validated=True):
        """Validation d'un « Non applicable » par un administrateur, avec son auteur et sa date (RG-07-03)."""
        self.ensure_one()
        if not _system(self.env) and not self.env.user.has_group("eguitra_base.group_profile_associe"):
            raise AccessError("Réservé à un administrateur : vous ne pouvez pas valider un « Non applicable ».")
        self.dossier_id._check_open()
        if self.status != "na":
            raise UserError(f"Critère {self.criterion_id.code} : seul un « Non applicable » se valide.")
        super(AxisproEvaluationSc01, self.sudo()).write({
            "na_validated": bool(validated), "na_validated_by": self.env.user.id if validated else False,
            "na_validated_at": fields.Datetime.now() if validated else False,
        })
        self.dossier_id.log("evaluation", note="Validation du « Non applicable »", criterion=self.criterion_id,
                            before="Validé" if not validated else "En attente",
                            after="Validé" if validated else "En attente")
        return True


class AxisproDocumentSc01(models.Model):
    _inherit = "axispro.document"

    verification = fields.Selection(VERIFICATIONS, "Vérification", default="to_check", required=True)
    category_letter = fields.Char("Catégorie", size=1, readonly=True, index=True)
    category_rank = fields.Integer("Rang dans la catégorie", readonly=True)
    source = fields.Selection([("team", "Équipe"), ("portal", "Portail du porteur")], "Origine", default="team", readonly=True)
    original_name = fields.Char("Nom d'origine", readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        share = self.env.user.share
        for vals in vals_list:
            if vals.get("verification"):
                vals.setdefault("state", VERIFICATION_STATES[vals["verification"]])
            elif vals.get("state"):
                vals["verification"] = STATE_VERIFICATIONS[vals["state"]]
            # Un dépôt du porteur arrive toujours « À vérifier » (RG-06-04).
            vals["source"] = "portal" if share else vals.get("source", "team")
        return super().create(vals_list)

    def write(self, vals):
        if "verification" in vals:
            vals = dict(vals, state=VERIFICATION_STATES[vals["verification"]])
        elif "state" in vals:
            vals = dict(vals, verification=STATE_VERIFICATIONS[vals["state"]])
        before = {d.id: d.verification for d in self} if "verification" in vals else {}
        result = super().write(vals)
        labels = dict(VERIFICATIONS)
        for doc in self.filtered(lambda d: d.id in before and before[d.id] != d.verification
                                 and is_sc01(d.dossier_id.policy_id)):
            doc.dossier_id.log("document", note=f"Vérification de {doc.name} : {labels[before[doc.id]]} → "
                                                f"{labels[doc.verification]}.")
        return result


class ResUsersAxispro(models.Model):
    _inherit = "res.users"

    def axispro_own_projects_only(self):
        """Évaluateur sans autre droit : limité à ses projets par les règles d'accès (section 3). Public : lu par ces
        règles, évaluées hors du modèle."""
        self.ensure_one()
        profiles = set(self.sudo()._eguitra_profiles())
        return "cabinet" in profiles and not profiles & {"associe", "direction", "admin", "lecteur"}
