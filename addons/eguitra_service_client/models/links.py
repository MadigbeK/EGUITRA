"""Liens d'un dossier vers les fiches des autres modules (facture, rotation, bail ou bien, chantier, dossier
AxisPro, offre), et réclamation de qualité vers HSSEQ. Aucune dépendance : chaque fiche n'existe que si son module
est installé ; la recherche ne rend que les fiches de la société du dossier et, s'il en a un, de son client."""

from odoo import api, models
from odoo.exceptions import UserError

from .common import LINK_MODELS, clean_line

MAX_RESULTS = 20
# Priorité du dossier -> gravité de la réclamation HSSEQ.
SEVERITY = {"urgent": "critical", "high": "major", "normal": "minor", "low": "minor"}


class EguitraScLinks(models.AbstractModel):
    _name = "eguitra.sc.links"
    _description = "Fiches liées aux dossiers du service client"

    @api.model
    def available(self):
        """Natures de fiches proposées : celles dont le module est installé."""
        return [{"model": model, "type": spec[0]} for model, spec in LINK_MODELS.items() if model in self.env]

    @api.model
    def search_records(self, model, query, company, partner=None):
        """Fiches de la société (et du client du dossier) dont le nom ou la référence contient la recherche."""
        if model not in LINK_MODELS or model not in self.env:
            raise UserError("Nature de fiche inconnue ou module absent.")
        _nature, partner_field, _href, extra = LINK_MODELS[model]
        Model = self.env[model].sudo()
        domain = list(extra)
        if "company_id" in Model._fields:
            domain.append(("company_id", "=", company.id))
        if partner and partner_field:
            domain.append((partner_field, "child_of", partner.commercial_partner_id.id))
        query = clean_line(query, 80)
        if query:
            names = [f for f in ("name", "reference", "code") if f in Model._fields]
            clause = [(names[0], "ilike", query)]
            for name in names[1:]:
                clause = ["|"] + clause + [(name, "ilike", query)]
            domain += clause
        rows = []
        for record in Model.search(domain, limit=MAX_RESULTS, order="id desc"):
            detail = []
            if partner_field and record[partner_field]:
                detail.append(record[partner_field].name)
            for field in ("invoice_date", "date_loading", "date_start", "date_order"):
                if field in record._fields and record[field]:
                    detail.append(record[field].strftime("%d/%m/%Y"))
                    break
            if "amount_total" in record._fields and record.amount_total:
                detail.append(f"{record.amount_total:,.0f}".replace(",", " ") + " GNF")
            rows.append({"id": record.id, "label": record.display_name, "detail": " · ".join(detail)})
        return rows

    # ─── HSSEQ ───────────────────────────────────────────────────────────

    @api.model
    def hsseq_link(self, ticket, mode, complaint_id=None, nature=None):
        """Réclamation de qualité (produit transporté, déversement, sécurité) : crée la réclamation client d'HSSEQ
        ou rejoint une réclamation existante du même client, dans la même société."""
        if "eguitra.hsseq.complaint" not in self.env:
            raise UserError("Le module HSSEQ n'est pas installé.")
        ticket = ticket.sudo()
        if ticket.hsseq_complaint_id:
            raise UserError(f"Ce dossier est déjà lié à la réclamation HSSEQ {ticket.hsseq_reference}.")
        if not ticket.partner_id:
            raise UserError("Rattachez d'abord le dossier à un client : la réclamation HSSEQ en exige un.")
        Complaint = self.env["eguitra.hsseq.complaint"].sudo()
        if mode == "join":
            complaint = Complaint.browse(int(complaint_id or 0)).exists()
            if not complaint or complaint.company_id != ticket.company_id or \
                    complaint.partner_id.commercial_partner_id != ticket.partner_id.commercial_partner_id:
                raise UserError("Réclamation HSSEQ introuvable pour ce client dans la société.")
        elif mode == "create":
            natures = dict(Complaint._fields["nature"].selection)
            nature = nature or ticket.category_id.hsseq_nature or "other"
            if nature not in natures:
                nature = "other" if "other" in natures else next(iter(natures))
            values = {
                "company_id": ticket.company_id.id, "partner_id": ticket.partner_id.commercial_partner_id.id,
                "received_on": ticket.date_open.date(), "nature": nature,
                "severity": SEVERITY.get(ticket.priority, "minor"),
                "description": f"{ticket.subject}\n\n{ticket.description or ''}\n\nDossier du service client "
                               f"{ticket.name}.".strip(),
            }
            if ticket.link_model == "eguitra.transport.rotation" and ticket._linked_record():
                values["rotation_id"] = ticket.link_id
            complaint = Complaint.create(values)
        else:
            raise UserError("Choisissez : créer la réclamation HSSEQ ou en rejoindre une.")
        ticket.write({"hsseq_complaint_id": complaint.id, "hsseq_reference": complaint.reference})
        verb = "créée" if mode == "create" else "rejointe"
        ticket._event(f"Réclamation HSSEQ {complaint.reference} {verb} : le responsable HSSEQ en suit l'enquête.")
        return complaint

    @api.model
    def hsseq_candidates(self, ticket):
        """Réclamations HSSEQ ouvertes du client du dossier, à rejoindre."""
        if "eguitra.hsseq.complaint" not in self.env or not ticket.partner_id:
            return []
        complaints = self.env["eguitra.hsseq.complaint"].sudo().search([
            ("company_id", "=", ticket.company_id.id), ("status", "!=", "closed"),
            ("partner_id", "child_of", ticket.partner_id.commercial_partner_id.id),
        ], limit=20)
        return [{"id": c.id, "reference": c.reference, "received_on": c.received_on, "status": c.status,
                 "description": clean_line(c.description, 120)} for c in complaints]
