"""Relances du porteur de projet pour les pièces manquantes (souhait du cabinet, décision du gérant du
3 novembre 2026) : coordonnées du contact chez le promoteur, pièces attendues classées par priorité,
message préparé, relance enregistrée (date, canal, note, message), suivi « à relancer » du dossier.

Le porteur ne lit jamais l'intitulé d'un critère de la grille (même règle que le plan d'actions,
pilotage.NEUTRAL_ACTION) : le message ne cite que des pièces standard de la data room et des documents
à produire. Le périmètre s'arrête au gate qui suit le gate courant : on ne réclame pas au stade de
l'intake les pièces du financial close.

Suivi : dossier complet quand aucune pièce n'est attendue ; « échéance dépassée » dès qu'un écart a
une échéance passée ; « jamais relancé », puis « à relancer » quand la dernière relance a quatorze
jours ou plus ; sinon « relancé ». Un dossier suspendu ou clos ne se relance pas.
"""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .pilotage import NEUTRAL_ACTION

RELANCE_DAYS = 14
RELANCE_TOP = 20
CHANNELS = [
    ("email", "Courriel"),
    ("phone", "Téléphone"),
    ("whatsapp", "WhatsApp"),
    ("meeting", "Réunion"),
    ("letter", "Courrier"),
    ("portal", "Message du portail"),
]


class AxisproRelance(models.Model):
    _name = "axispro.relance"
    _description = "Relance du porteur de projet"
    _order = "date desc, id desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    date = fields.Date(required=True, default=fields.Date.context_today)
    channel = fields.Selection(CHANNELS, "Canal", required=True, default="email")
    note = fields.Text("Note")
    body = fields.Text("Message")
    pieces = fields.Integer("Pièces demandées", readonly=True)
    user_id = fields.Many2one("res.users", "Par", default=lambda self: self.env.user, required=True, readonly=True)
    message_id = fields.Many2one("axispro.message", "Message du portail", readonly=True, ondelete="set null")

    @api.constrains("date")
    def _check_date(self):
        today = fields.Date.context_today(self)
        for relance in self:
            if relance.date > today:
                raise ValidationError("Une relance se date d'aujourd'hui au plus tard.")


class AxisproDossierRelance(models.Model):
    _inherit = "axispro.dossier"

    contact_name = fields.Char("Contact chez le promoteur")
    contact_email = fields.Char("Courriel du contact")
    contact_phone = fields.Char("Téléphone du contact")
    relance_ids = fields.One2many("axispro.relance", "dossier_id", "Relances du porteur")

    def contact(self):
        """Coordonnées utilisées pour relancer : celles du dossier, à défaut celles du promoteur."""
        self.ensure_one()
        promoter = self.promoter_id
        return {"name": self.contact_name or None, "email": self.contact_email or promoter.email or None,
                "phone": self.contact_phone or promoter.phone or None}

    def relance_items(self, result=None):
        """Pièces et documents attendus du porteur jusqu'au gate suivant, du plus prioritaire au moins
        prioritaire : pièces standard non disponibles (priorité du plus urgent de leurs critères en
        écart), puis documents à produire des écarts sans pièce rattachée, regroupés par document (sans
        document à produire : une seule ligne neutre). `key` : identifiant stable de la ligne."""
        self.ensure_one()
        r = result or self.evaluate()
        index = {g.code: i for i, g in enumerate(self.policy_id.gate_ids.sorted("sequence"))}
        scope = (index.get(self.current_gate_id.code, 0) if self.current_gate_id else 0) + 1
        gaps = {g["criterion_id"]: g for g in self.gaps(0, r) if index.get(g["gate"], 0) <= scope}
        types = {t.id: t for t in self.policy_id.document_type_ids}
        items = []
        linked = set()
        for doc in self.documents_status(r):
            criteria = types[doc["document_type_id"]].criterion_ids.ids
            linked.update(criteria)
            if doc["available"] or index.get(doc["gate"], 0) > scope:
                continue
            related = [gaps[c] for c in criteria if c in gaps]
            # Pièce sans critère : attendue si obligatoire. Pièce dont aucun critère n'est en écart
            # (justifiés autrement, ou hors du périmètre) : plus attendue.
            if (criteria and not related) or (not criteria and not doc["required"]):
                continue
            items.append(self._relance_item(f"doc-{doc['document_type_id']}", doc["name"], related, doc=doc))
        evaluations = {e.criterion_id.id: e for e in self.evaluation_ids}
        groups = {}
        for gap in gaps.values():
            if gap["criterion_id"] in linked:
                continue
            # Document à produire comme pour le plan d'actions : jamais l'intitulé ni l'aide du critère.
            criterion = self.env["axispro.criterion"].browse(gap["criterion_id"])
            evaluation = evaluations.get(criterion.id)
            todo = ((evaluation and evaluation.deliverable) or criterion.deliverable or criterion.domain_id.deliverable
                    or NEUTRAL_ACTION)
            groups.setdefault(" ".join(todo.split())[:200], []).append(gap)
        taken = {i["label"].casefold() for i in items}
        for label, related in groups.items():
            if label.casefold() not in taken:
                key = f"lib-{min(g['criterion_id'] for g in related)}"
                items.append(self._relance_item(key, label, related))
        # La ligne neutre ferme la liste, quelle que soit sa priorité.
        items.sort(key=lambda i: (i["label"] == NEUTRAL_ACTION, -i["priority"], i["label"].casefold()))
        return items

    @staticmethod
    def _relance_item(key, label, gaps, doc=None):
        due = [g["due_date"] for g in gaps if g["due_date"]]
        return {
            "key": key, "label": label,
            "category": doc["category"] if doc else None,
            "state": "to_redo" if doc and doc["state"] == "rejected" else
                     "partial" if gaps and all(g["status"] == "partial" for g in gaps) else "missing",
            "priority": max((g["priority"] for g in gaps), default=0.0),
            "blocking": any(g["knockout"] or g["critical"] or g["blocking"] for g in gaps),
            "knockout": any(g["knockout"] for g in gaps),
            "due_date": min(due) if due else None,
            # Cabinet seulement : critères que la pièce justifie (jamais dans le message au porteur).
            "criteria": [g["code"] for g in gaps],
        }

    def followup(self, items=None, result=None):
        """Suivi des relances du dossier (voir l'en-tête du module) ; `due` : le porteur est à relancer."""
        self.ensure_one()
        items = self.relance_items(result) if items is None else items
        today = fields.Date.context_today(self)
        last = self.relance_ids[:1]
        overdue = sum(1 for i in items if i["due_date"] and i["due_date"] < today)
        info = {"missing": len(items), "overdue": overdue, "count": len(self.relance_ids),
                "last_date": last.date or None, "last_channel": last.channel or None,
                "next_date": last.date + timedelta(days=RELANCE_DAYS) if last else None, "delay_days": RELANCE_DAYS}
        if self.state != "open":
            return dict(info, state="inactive", due=False)
        if not items:
            return dict(info, state="complete", due=False)
        if overdue:
            return dict(info, state="overdue", due=True)
        if not last:
            return dict(info, state="never", due=True)
        if (today - last.date).days >= RELANCE_DAYS:
            return dict(info, state="due", due=True)
        return dict(info, state="recent", due=False)

    def relance_message(self, items=None, result=None):
        """Message de relance prêt à envoyer (courriel, WhatsApp, portail), modifiable avant l'envoi."""
        self.ensure_one()
        items = (self.relance_items(result) if items is None else items)[:RELANCE_TOP]
        contact = self.contact()
        gates = self.policy_id.gate_ids.sorted("sequence")
        following = gates.filtered(lambda g: not self.current_gate_id or g.sequence > self.current_gate_id.sequence)[:1]
        stage = f"à l'étape « {following.name} »" if following else "au comité"

        def line(item):
            text = f"- {item['label']}"
            if item["state"] == "to_redo":
                text += " (pièce à reprendre)"
            elif item["state"] == "partial":
                text += " (à compléter ou à actualiser)"
            if item["due_date"]:
                text += f", attendu pour le {item['due_date'].strftime('%d/%m/%Y')}"
            return text

        first = [i for i in items if i["blocking"]]
        others = [i for i in items if not i["blocking"]]
        parts = [
            f"Objet : {self.reference} · Pièces attendues pour le projet « {self.name} »",
            "",
            f"Bonjour {contact['name'] or 'Madame, Monsieur'},",
            "",
            f"Dans le cadre de l'évaluation du projet « {self.name} », nous avons analysé les pièces reçues à ce "
            f"jour. Pour poursuivre l'instruction et présenter le dossier {stage}, nous restons dans l'attente des "
            "éléments suivants.",
        ]
        if first:
            parts += ["", "Pièces prioritaires (elles conditionnent la suite du dossier) :", *map(line, first)]
        if others:
            parts += ["", "Autres pièces attendues :", *map(line, others)]
        if not items:
            parts += ["", "Toutes les pièces attendues à ce stade nous sont parvenues : merci."]
        parts += [
            "",
            "Vous pouvez nous les transmettre en réponse à ce message"
            + (" ou les déposer directement sur votre espace du portail" if self.portal_user_ids else "")
            + ". Nous restons à votre disposition pour en parler.",
            "",
            "Cordialement,",
            self.consultant_id.name or "Votre consultant",
            self.company_id.name,
        ]
        return "\n".join(parts)
