"""Documents d'une opération de transport, qui apparaissent d'eux-mêmes quand leurs informations sont complètes.

Quatre documents : ordre de transport (OT, porté par la commande du client), ordre de mission (OM), budget de
voyage (BV) et lettre de voiture (LV). Pour chacun, l'écran reçoit « prêt » (le PDF se télécharge) ou la liste
de ce qui manque, en clair ; les quatre s'impriment aussi d'un clic en un seul PDF.

Les PDF suivent le gabarit et la charte de la société (eguitra_base : logo et slogan en en-tête, raison
sociale, adresse, contacts, NIF et RCCM, couleur de la société, à défaut le vert d'EGUITRA GROUP, mêmes
blocs et même feuille de style que les factures) ; les valeurs sont préparées ici, déjà mises en forme, et
les gabarits (report/documents.xml) ne font que les placer.
"""

from odoo import fields, models

from odoo.addons.eguitra_base.lettres import amount_in_words, capitalize, number, number_trim
from odoo.addons.eguitra_base.models.account_move import ACCENT, COLOR

from ..blocking import motif
from .budget import KINDS, UNITS
from .mission import DIRECTIONS
from .order import ORDER_STATES

DOCUMENT_LABELS = {"order": "Ordre de transport", "mission": "Ordre de mission", "budget": "Budget de voyage",
                   "waybill": "Lettre de voiture"}
# Feuille de style propre aux documents du transport, ajoutée à celle des factures.
EXTRA_CSS = (
    ".o_td_intro { margin-top: 4mm; }"
    ".o_td_section { margin-top: 4mm; page-break-inside: avoid; }"
    ".o_td_kv td { padding: 0.6mm 1.5mm; border: none; }"
    ".o_td_kv .o_td_k { font-weight: bold; white-space: nowrap; width: 22%; }"
    ".o_td_check { font-family: DejaVu Sans, sans-serif; }"
    ".o_td_note { margin-top: 4mm; border: 1pt solid #1d1d1b; padding: 2mm 3mm; font-style: italic; text-align: center; }"
    ".o_td_sign { width: 100%; margin-top: 8mm; page-break-inside: avoid; }"
    ".o_td_sign td { width: 50%; text-align: center; vertical-align: top; }"
    ".o_td_space { height: 20mm; }"
    ".o_td_list { margin: 1mm 0 0 0; padding-left: 5mm; }"
    ".o_td_small { font-size: 8.5pt; }"
    ".o_td_total td { font-weight: bold; }"
)


def accent_of(company):
    return company.primary_color if company.primary_color and COLOR.match(company.primary_color) else ACCENT


def company_lines(company):
    """Identité de la société sous sa raison sociale : adresse, contacts, NIF et RCCM (comme la facture)."""
    vat_label = company.account_fiscal_country_id.vat_label or "NIF"
    bp = company.zip and (company.zip if company.zip.upper().startswith("BP") else f"BP {company.zip}")
    lines = [", ".join(p for p in (company.street, company.street2) if p), " – ".join(p for p in (bp, company.city) if p)]
    if company.phone:
        lines.append(f"Contact : {company.phone}")
    if company.email:
        lines.append(f"E-mail : {company.email}")
    legal = [f"{vat_label} : {company.vat}" if company.vat else "",
             f"RCCM : {company.company_registry}" if company.company_registry else ""]
    lines.append(" · ".join(p for p in legal if p))
    return [line for line in lines if line]


def fmt_date(value):
    return f"{value:%d/%m/%Y}" if value else ""


def fmt_amount(value, currency):
    return number(value, currency.decimal_places)


def checkbox(value):
    return "☒" if value else "☐"


def unit_label(code):
    return dict(UNITS).get(code, "")


def doc_head(env, company, title, number_, day, banner=None, status=None):
    """En-tête d'un document : identité de la société, titre, numéro, lieu et date (gabarit des factures)."""
    color = accent_of(company)
    return {
        "css": env["account.move"]._eguitra_report_css(color) + EXTRA_CSS,
        "accent": color, "company_name": company.name, "company_lines": company_lines(company),
        "title": title, "number": number_ if number_ and number_ != "/" else None,
        "place_date": f"{company.city}, le {fmt_date(day)}" if company.city else f"Date : {fmt_date(day)}",
        "banner": banner, "status": status,
    }


def doc_datetime(record, value):
    """Date et heure à l'heure de l'utilisateur (Conakry) : « 22/10/2026 08:30 »."""
    if not value:
        return ""
    return f"{fields.Datetime.context_timestamp(record, value):%d/%m/%Y %H:%M}"


class EguitraTransportOrder(models.Model):
    _inherit = "eguitra.transport.order"

    def _document_status(self):
        self.ensure_one()
        missing = [] if self.state != "cancelled" else ["ordre annulé"]
        missing += self._missing()
        warnings = []
        if self.state == "draft":
            warnings.append("Ordre en brouillon : à faire signer par le client, puis à valider.")
        return {"code": "order", "label": DOCUMENT_LABELS["order"], "ready": not missing, "missing": missing,
                "warnings": warnings, "number": self.name if self.name != "/" else None, "record_id": self.id,
                "pdf": f"/transport/orders/{self.id}/pdf"}

    def _doc_values(self):
        """Valeurs de l'ordre de transport imprimé."""
        self.ensure_one()
        company, client = self.company_id, self.partner_id.commercial_partner_id
        banner = None
        if self.state == "draft":
            banner = "BROUILLON : ordre à faire signer par le client puis à valider."
        elif self.state == "cancelled":
            banner = "ANNULÉ : cet ordre de transport ne vaut plus."
        head = doc_head(self.env, company, "ORDRE DE TRANSPORT", self.name, self.date, banner=banner,
                              status=f"Statut : {dict(ORDER_STATES)[self.state]}")
        partner = self.partner_id
        address = ", ".join(p for p in (partner.street, partner.street2, partner.zip, partner.city) if p)
        product = self.product_id.name or ""
        currency = self.currency_id
        rotations = self.rotation_ids.filtered(lambda r: r.state != "cancelled").sorted(
            lambda r: (r.date_planned_departure or r.date_loading, r.id))
        signatory = company.transport_order_signatory or "La Direction générale"
        return dict(
            head,
            client=[("Nom", client.name or "")] + ([("Adresse", address)] if address else [])
            + ([("Contact", partner.phone or client.phone)] if (partner.phone or client.phone) else []),
            references=[("Référence du client", self.client_ref)] if self.client_ref else [],
            intro=f"{client.name} demande et autorise {company.name} à effectuer les opérations de transport et/ou de "
                  "manutention pour son compte suivant les détails ci-dessous :",
            states=[(label, checkbox(self.state == code or (code == "validated" and self.state in ("executed", "closed"))
                                     or (code == "executed" and self.state == "closed")))
                    for code, label in ORDER_STATES if code in ("validated", "executed", "closed")],
            service=[("Transport", checkbox(self.service_transport)), ("Avec chargement", checkbox(self.with_loading)),
                     ("Avec déchargement", checkbox(self.with_unloading)), ("Avec stockage", checkbox(self.with_storage))],
            goods=[("Nature", product), ("Description", self.goods_description or ""),
                   ("Conditionnement", self.packaging or ""), ("Quantité", self._quantity_label()),
                   ("Poids brut", self._quantity_label(self.weight_gross)),
                   ("Poids net", self._quantity_label(self.weight_net)),
                   ("Valeur", f"{fmt_amount(self.goods_value, currency)} {currency.name}" if self.goods_value else ""),
                   ("Assurance complémentaire", "Oui" if self.extra_insurance else "Non"),
                   ("Documents joints", self.attached_documents or "")],
            destination=[("Origine", self.origin or self.route_id.origin or ""),
                         ("Destination", self.destination or self.route_id.destination or ""),
                         ("Pays", self.destination_country or ""), ("Destinataire réel", self._consignee()),
                         ("Adresse de facturation", self._billing_address())],
            note=self.note or "",
            operations=[{"name": r._label(), "vehicle": r.vehicle_id.name or "",
                         "tractor": r.tractor_id._label() if r.tractor_id else "",
                         "trailer": r.trailer_id._label() if r.trailer_id else "",
                         "driver": r.driver_id.name or "", "etd": fmt_date(r.date_planned_departure),
                         "volume": f"{number_trim((r.volume_loaded or r.volume_planned) * 1000)} L"
                         if (r.volume_loaded or r.volume_planned) else ""} for r in rotations],
            sign_client=self.client_signatory or "",
            sign_company_title=f"Pour {company.name}",
            sign_company=signatory,
            sign_company_name=company.transport_order_signatory_name or "",
        )


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    # ─── Panneau « Documents » ────────────────────────────────────────────

    def _budget_missing(self):
        self.ensure_one()
        budgets = self._live_budgets()
        missing = []
        if not budgets.filtered(lambda b: b.kind == "initial"):
            missing.append("le budget initial (pré-rempli depuis la route)")
        for budget in budgets:
            if not budget.line_ids or budget.amount_total <= 0:
                missing.append(f"les lignes du budget {budget.name}")
            if budget.line_ids.filtered(lambda l: l.kind == "nature" and not l.partner_id):
                missing.append(f"la station des bons carburant du budget {budget.name}")
        return missing

    def _transport_documents(self):
        """Les quatre documents de l'opération : prêt (PDF) ou ce qui manque."""
        self.ensure_one()
        cancelled = ["opération annulée"] if self.state == "cancelled" else []
        if self.order_id:
            order = self.order_id._document_status()
        else:
            order = {"code": "order", "label": DOCUMENT_LABELS["order"], "ready": False,
                     "missing": ["rattacher l'opération à un ordre de transport du client"], "warnings": [],
                     "number": None, "record_id": None, "pdf": None}
        mission, waybill = self._mission(), self._waybill()
        budgets = self._live_budgets()
        budget_warnings = [f"Budget {b.name} ({b._label().lower()}) {dict(b._fields['state'].selection)[b.state].lower()} : "
                           "le document porte la mention." for b in budgets if b.state != "approved"]
        docs = [
            order,
            {"code": "mission", "label": DOCUMENT_LABELS["mission"], "missing": cancelled + self._mission_missing(),
             "warnings": [], "number": mission.name or None, "record_id": mission.id or None},
            {"code": "budget", "label": DOCUMENT_LABELS["budget"], "missing": cancelled + self._budget_missing(),
             "warnings": budget_warnings, "number": ", ".join(budgets.mapped("name")) or None,
             "record_id": budgets[:1].id or None},
            {"code": "waybill", "label": DOCUMENT_LABELS["waybill"], "missing": cancelled + self._waybill_missing(),
             "warnings": [], "number": waybill.name or None, "record_id": waybill.id or None},
        ]
        for doc in docs[1:]:
            doc["ready"] = not doc["missing"]
            doc["pdf"] = f"/transport/rotations/{self.id}/documents/{doc['code']}.pdf"
        return docs

    def _departure_blockers(self):
        """Opération d'un ordre de transport : un ordre de mission incomplet ou un budget de voyage non approuvé
        sont signalés au départ (vigilances, jamais bloquantes : le verrou de sécurité reste celui d'HSSEQ)."""
        blockers = super()._departure_blockers()
        if not self.order_id:
            return blockers
        missing = self._mission_missing()
        if missing:
            blockers.append(motif("T02", f"Ordre de mission incomplet : il manque {', '.join(missing)}.", "transport",
                                  severity="warn"))
        budgets = self._live_budgets()
        if budgets and not budgets.filtered(lambda b: b.kind == "initial" and b.state == "approved"):
            blockers.append(motif("T03", "Budget de voyage initial non approuvé : ni avance ni bon carburant ne sont "
                                         "remis.", "transport", severity="warn"))
        return blockers

    def _ready_documents(self):
        """Codes des documents prêts, dans l'ordre d'impression."""
        self.ensure_one()
        return [doc["code"] for doc in self._transport_documents() if doc["ready"]]

    def _materialize_documents(self, codes):
        """Les documents imprimés reçoivent leur numéro : ordre de mission et lettre de voiture créés au besoin."""
        self.ensure_one()
        self._ensure_number()
        if "mission" in codes:
            self._ensure_mission()
        if "waybill" in codes:
            self._ensure_waybill()

    # ─── Valeurs des documents imprimés ───────────────────────────────────

    def _doc_operation(self):
        """Éléments communs de l'opération : engins, équipage, dates prévues et réelles, route."""
        self.ensure_one()
        driver, co = self.driver_id, self.co_driver_id
        return {
            "number": self._label(),
            "tractor": self.tractor_id._label() if self.tractor_id else "",
            "tractor_fleet": self.tractor_id.fleet_number or "", "tractor_plate": self.tractor_id.plate or "",
            "trailer": self.trailer_id._label() if self.trailer_id else "",
            "trailer_fleet": self.trailer_id.fleet_number or "", "trailer_plate": self.trailer_id.plate or "",
            "driver": driver.name or "", "driver_phone": driver.phone or "",
            "co_driver": co.name or "", "co_driver_phone": co.phone or "",
            "departure": fmt_date(self.departed_at.date() if self.departed_at else self.date_loading),
            "etd": fmt_date(self.date_planned_departure), "eta": fmt_date(self.date_planned_arrival),
            "etr": fmt_date(self.date_planned_return),
            "origin": self.route_id.origin or "", "destination": self.route_id.destination or "",
            "route": self.route_id.name or "", "distance": f"{number_trim(self.route_id.distance_km)} km"
            if self.route_id.distance_km else "",
            "days": number_trim(self._planned_days(), 1),
            "order": self.order_id.name if self.order_id else "",
            "client": self.partner_id.commercial_partner_id.name or "",
            "product": self.product_id.name or "",
            "packaging": (self.order_id.packaging if self.order_id else "") or "",
            "quantity": f"{number_trim((self.volume_loaded or self.volume_planned) * 1000)} L"
            if (self.volume_loaded or self.volume_planned) else "",
        }

    def _doc_mission_values(self):
        self.ensure_one()
        mission = self._mission()
        op = self._doc_operation()
        crew = f"{op['driver']}, chauffeur"
        if op["co_driver"]:
            crew += f", et à {op['co_driver']}, convoyeur,"
        directions = dict(DIRECTIONS)
        head = doc_head(self.env, self.company_id, "ORDRE DE MISSION", mission.name if mission else None,
                              mission.date if mission else fields.Date.context_today(self))
        return dict(
            head, op=op,
            intro=f"Il est ordonné, pour des raisons de service, à {crew} d'effectuer la présente mission avec les "
                  "modalités suivantes :",
            steps=[dict(step, direction=directions.get(step["direction"], "")) for step in self._mission_steps()],
            period=[("Départ prévu", op["etd"]), ("Arrivée prévue", op["eta"]),
                    ("Retour prévu", op["etr"] or "Fin de la mission")],
            references=[(label, value) for label, value in (("Opération", op["number"]), ("Ordre de transport", op["order"]),
                                                            ("Client", op["client"]), ("Route", op["route"])) if value],
            authorities=(mission._authorities_note() if mission else self.company_id.transport_authorities_note) or "",
            note=(mission.note if mission else "") or "",
            sign_title=f"Pour {self.company_id.name}",
            sign_label="Le Responsable des opérations",
            sign_name=self.company_id.transport_operations_manager or "",
        )

    def _doc_budget_values(self, budget):
        """Une page par budget : en-tête de l'opération, évolution des budgets, détail du budget, total en lettres."""
        self.ensure_one()
        currency = self.company_id.currency_id
        op = self._doc_operation()
        budgets = self._live_budgets()
        states = dict(budget._fields["state"].selection)
        banner = None
        if budget.state != "approved":
            banner = (f"{states[budget.state].upper()} : budget non approuvé, il ne vaut pas autorisation de "
                      "décaissement ni de remise de bon carburant.")
        title = "BUDGET DE VOYAGE"
        subtitle = budget._label() + (f" : {budget.reason}" if budget.reason else "")
        head = doc_head(self.env, self.company_id, title, budget.name, budget.date, banner=banner, status=subtitle)

        def rows(kind):
            return [{"rubric": line.rubric_id.name, "description": line.description or "",
                     "station": line.partner_id.name or "", "quantity": number_trim(line.quantity, 2),
                     "unit": unit_label(line.unit), "price": fmt_amount(line.price_unit, currency),
                     "amount": fmt_amount(line.amount, currency), "reference": line.reference or ""}
                    for line in budget.line_ids.filtered(lambda l, k=kind: l.kind == k)]

        approval = budget._eguitra_approval_info()
        approvers = [f"{s['label']} : {s['decided_by']}" for s in (approval or {}).get("steps", [])
                     if s["state"] == "approved" and s["decided_by"]]
        return dict(
            head, op=op, budget_name=budget.name,
            evolution=[{"number": b.number, "name": b.name, "date_start": fmt_date(b.date_start),
                        "date_end": fmt_date(b.date_end), "days": number_trim(b.days, 1), "label": b._label()
                        + (f" : {b.reason}" if b.reason else ""), "amount": fmt_amount(b.amount_total, currency),
                        "state": states[b.state], "current": b == budget} for b in budgets],
            evolution_days=number_trim(sum(budgets.mapped("days")), 1),
            evolution_total=fmt_amount(sum(budgets.filtered(lambda b: b.state != "rejected").mapped("amount_total")),
                                       currency),
            sections=[{"label": label, "rows": rows(code),
                       "total": fmt_amount(budget.amount_nature if code == "nature" else budget.amount_cash, currency)}
                      for code, label in KINDS if budget.line_ids.filtered(lambda l, c=code: l.kind == c)],
            total=fmt_amount(budget.amount_total, currency), currency=currency.name,
            words=capitalize(amount_in_words(budget.amount_total, currency)),
            approvers=approvers,
            vouchers=[f"{v.name} : {v.partner_id.name}, {fmt_amount(v.amount, currency)} {currency.name}"
                      for v in budget.voucher_ids.filtered(lambda v: v.state != "cancelled")],
            sign_label="Responsable des opérations",
            sign_name=self.company_id.transport_operations_manager or "",
        )

    def _doc_waybill_values(self):
        self.ensure_one()
        waybill = self._waybill()
        op = self._doc_operation()
        company = self.company_id
        head = doc_head(self.env, company, "LETTRE DE VOITURE", waybill.name if waybill else None,
                              waybill.date if waybill else fields.Date.context_today(self))
        packages = waybill._packages() if waybill else self._default_packages()
        uom = packages[0]["uom"] if packages else "L"
        free = waybill.free_days if waybill else (self.partner_id.commercial_partner_id.transport_demurrage_free_days
                                                  or company.transport_demurrage_free_days)
        notes = [f"Franchise d'immobilisation des camions : {free} jour{'s' if free > 1 else ''}."]
        if company.transport_waybill_note:
            notes += [line.strip() for line in company.transport_waybill_note.splitlines() if line.strip()]
        reception = None
        if waybill:
            reception = {
                "receiver": waybill.receiver_name or "",
                "arrival": doc_datetime(self, waybill.vehicle_arrival_at),
                "unloading": doc_datetime(self, waybill.unloading_at),
                "departure": doc_datetime(self, waybill.vehicle_departure_at),
                "received": number_trim(waybill.received_qty, 2) if waybill.received_qty else "",
                "shortage": number_trim(waybill.shortage_qty, 2) if waybill.received_qty else "",
                "damaged": number_trim(waybill.damaged_qty, 2) if waybill.damaged_qty else "",
                "cause": waybill.damage_cause or "",
                "visa": "Visée" if waybill.receiver_visa else "",
                "immobilized": (f"{waybill.immobilized_days} jour{'s' if waybill.immobilized_days > 1 else ''}, dont "
                                f"{waybill.billable_days} au-delà de la franchise") if waybill.immobilized_days else "",
            }
        instructions = self.env["eguitra.transport.driver.instruction"].sudo().search(
            [("company_id", "=", company.id)]).mapped("name")
        loading_at = waybill.loading_at if waybill else False
        arrival_at = waybill.arrival_planned_at if waybill else False
        return dict(
            head, op=op,
            references=[("Ordre de transport", op["order"]), ("Bon de livraison", self.delivery_note or ""),
                        ("Connaissement", (waybill.bill_of_lading if waybill else "") or ""),
                        ("Référence du client", waybill._client_ref() if waybill else
                         ((self.order_id.client_ref if self.order_id else "") or ""))],
            packages=[dict(p, gross=number_trim(p["gross"], 2) if p["gross"] else "",
                           net=number_trim(p["net"], 2) if p["net"] else "", count=p["count"] or "") for p in packages],
            uom=uom,
            loading=[("Chargeur", waybill._shipper() if waybill else self.partner_id.commercial_partner_id.name or ""),
                     ("Lieu de chargement", waybill._loading_place() if waybill else op["origin"]),
                     ("Date et heure de chargement", doc_datetime(self, loading_at) or fmt_date(self.date_loading))],
            delivery=[("Destinataire", waybill._consignee() if waybill else
                       (self.order_id._consignee() if self.order_id else op["client"])),
                      ("Destination", waybill._destination() if waybill else op["destination"]),
                      ("Arrivée estimée", doc_datetime(self, arrival_at) or op["eta"])],
            parties=[("Transitaire", (waybill.forwarder if waybill else "") or ""),
                     ("Agent livreur", (waybill.delivery_agent if waybill else "") or ""),
                     ("Commis chargeur", (waybill.loader_clerk if waybill else "") or "")],
            reception=reception, notes=notes, instructions=instructions,
            note=(waybill.note if waybill else "") or "",
        )
