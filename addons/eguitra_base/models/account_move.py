"""Factures et avoirs des clients imprimés au modèle des sociétés du groupe (views/report_invoice.xml).

Le gabarit reprend la structure des modèles de facture remis par EGUITRA GROUP SARLU et MB AxisPro
Consulting : en-tête de la société (raison sociale, adresse, contacts, NIF et RCCM), titre, numéro et
date, bloc du client, référence de l'offre, objet (« Commentaire ou indication »), tableau des lignes
(rubriques numérotées en chiffres romains avec leur sous-total, notes), totaux par groupe de taxe, montant
en toutes lettres, conditions et modes de règlement avec tous les comptes bancaires marqués, signataire.
Les valeurs sont préparées ici (_eguitra_report_values) : le gabarit ne fait que les placer.
"""

import re

from odoo import api, fields, models

from ..lettres import amount_in_words, capitalize, money, number, number_trim, roman
from .account_journal import DEFAULT_PAYMENT_METHODS, DEFAULT_SIGNATORY, REFUNDS

SALE_DOCUMENTS = ("out_invoice", "out_refund")
INVOICE_REPORT = "eguitra_base.report_invoice_document"
# Vert de la charte d'EGUITRA GROUP, à défaut de la couleur principale de la société.
ACCENT = "#006C1B"
COLOR = re.compile(r"^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$")
LINE_TYPES = ("product", "line_section", "line_subsection", "line_note")


class AccountMove(models.Model):
    _inherit = "account.move"

    eguitra_object = fields.Char(
        "Objet de la facture", tracking=True,
        help="« Commentaire ou indication » des factures : location de véhicule, crépissage du bâtiment "
             "principal, location d'un appartement…",
    )

    # ─── Gabarit de la facture ────────────────────────────────────────────

    def _get_name_invoice_report(self):
        """Factures et avoirs des clients : gabarit des sociétés du groupe ; pièces d'achat : celui du noyau."""
        self.ensure_one()
        if self.move_type in SALE_DOCUMENTS:
            return INVOICE_REPORT
        return super()._get_name_invoice_report()

    # ─── Numérotation reprise de l'ancien système ─────────────────────────

    def _eguitra_legacy_number(self):
        """Dernier numéro de l'ancien système à continuer : la pièce est la première numérotée de son
        journal de vente (de sa suite : les avoirs ont la leur quand le journal les sépare)."""
        self.ensure_one()
        journal = self.journal_id
        number = journal.eguitra_legacy_last_number
        if not number or journal.type != "sale" or not self.date or self.origin_payment_id:
            return False
        if journal.refund_sequence and self.move_type in REFUNDS:
            return False
        if self._get_last_sequence(relaxed=True):
            return False
        return number

    def _get_next_sequence_format(self):
        # EXTENDS sequence.mixin : la première facture du journal continue l'ancien système ; le noyau
        # incrémente ensuite ce compteur (_locked_increment), puis retrouve ce numéro pour les suivantes.
        number = self._eguitra_legacy_number()
        if number:
            return self.journal_id._eguitra_legacy_format(number, self[self._sequence_date_field])
        return super()._get_next_sequence_format()

    # ─── Valeurs du gabarit ───────────────────────────────────────────────

    def _eguitra_money(self, value):
        return money(value, self.currency_id.name, self.currency_id.decimal_places)

    def _eguitra_report_lines(self):
        """Lignes du tableau principal, dans l'ordre de la facture (le transport en retire ses rotations)."""
        return self.invoice_line_ids.filtered(lambda l: l.display_type in LINE_TYPES).sorted(
            lambda l: (l.sequence, l.id))

    def _eguitra_report_rows(self, lines):
        """Lignes du tableau : rubriques (sections du noyau) numérotées I, II, III… et closes par leur
        sous-total, sous-rubriques, notes, lignes numérotées 1, 2, 3… sur toute la facture."""
        unit = self.env.ref("uom.product_uom_unit", raise_if_not_found=False)
        products = lines.filtered(lambda l: l.display_type == "product")
        show_unit = any(l.product_uom_id and l.product_uom_id != unit for l in products)
        show_discount = any(l.discount for l in products)
        digits = self.currency_id.decimal_places
        rows, count, rubric = [], 0, 0
        section, section_total, section_lines = None, 0.0, 0

        def close():
            if section is not None and section_lines:
                rows.append({"kind": "subtotal", "label": f"Sous-total {section}",
                             "amount": number(section_total, digits)})

        for line in lines:
            if line.display_type == "line_section":
                close()
                rubric += 1
                section, section_total, section_lines = (line.name or "").strip(), 0.0, 0
                rows.append({"kind": "section", "label": f"{roman(rubric)}. {section}"})
            elif line.display_type in ("line_subsection", "line_note"):
                kind = "subsection" if line.display_type == "line_subsection" else "note"
                rows.append({"kind": kind, "label": line.name or ""})
            else:
                count += 1
                rows.append({
                    "kind": "line", "number": count, "name": line.name or "",
                    "unit": line.product_uom_id.name if show_unit and line.product_uom_id else "",
                    "quantity": number_trim(line.quantity),
                    "price": number_trim(line.price_unit, max(digits, 2)),
                    "discount": f"{number_trim(line.discount, 2)} %" if line.discount else "",
                    "amount": number(line.price_subtotal, digits),
                })
                if section is not None:
                    section_total += line.price_subtotal
                    section_lines += 1
        close()
        return rows, show_unit, show_discount

    def _eguitra_report_references(self):
        """Références imprimées à droite du bloc du client : (libellé, valeur)."""
        self.ensure_one()
        refund = self.move_type == "out_refund"
        references = []
        if self.ref:
            references.append(("Référence" if refund else "Référence offre", self.ref))
        if refund and self.reversed_entry_id.name:
            references.append(("Facture d'origine", self.reversed_entry_id.name))
        return references

    def _eguitra_report_totals(self, with_payments):
        """Totaux : montant HT, chaque groupe de taxe (TVA 18 %, retenues), net à payer ; « Paiement perçu »
        et « Reste à payer » quand une facture validée est partiellement réglée (impression avec règlements)."""
        tax_totals = self.tax_totals or {}
        rows = []
        for index, subtotal in enumerate(tax_totals.get("subtotals") or []):
            rows.append({"label": "Montant HT" if index == 0 else subtotal["name"],
                         "amount": self._eguitra_money(subtotal["base_amount_currency"])})
            for group in subtotal.get("tax_groups") or []:
                rows.append({"label": group["group_name"], "amount": self._eguitra_money(group["tax_amount_currency"])})
        if not rows:
            rows.append({"label": "Montant HT", "amount": self._eguitra_money(self.amount_untaxed)})
        if "cash_rounding_base_amount_currency" in tax_totals:
            rows.append({"label": "Arrondi", "amount": self._eguitra_money(tax_totals["cash_rounding_base_amount_currency"])})
        refund = self.move_type == "out_refund"
        rows.append({"label": "TOTAL TTC" if refund else "NET À PAYER (TTC)",
                     "amount": self._eguitra_money(self.amount_total), "main": True})
        currency = self.currency_id
        residual = self.amount_residual
        if (with_payments and self.state == "posted" and not currency.is_zero(residual)
                and currency.compare_amounts(residual, self.amount_total) < 0):
            rows.append({"label": "Paiement perçu", "amount": self._eguitra_money(self.amount_total - residual)})
            rows.append({"label": "Reste à payer", "amount": self._eguitra_money(residual), "main": True})
        return rows

    def _eguitra_report_values(self, with_payments=False):
        """Toutes les valeurs du gabarit de la facture (views/report_invoice.xml), déjà mises en forme."""
        self.ensure_one()
        company = self.company_id
        partner = self.partner_id
        commercial = partner.commercial_partner_id
        refund = self.move_type == "out_refund"
        vat_label = company.account_fiscal_country_id.vat_label or "NIF"
        day = self.invoice_date or self.date or fields.Date.context_today(self)

        bp = company.zip and (company.zip if company.zip.upper().startswith("BP") else f"BP {company.zip}")
        company_lines = [", ".join(p for p in (company.street, company.street2) if p),
                         " – ".join(p for p in (bp, company.city) if p)]
        if company.phone:
            company_lines.append(f"Contact : {company.phone}")
        if company.email:
            company_lines.append(f"E-mail : {company.email}")
        legal = [f"{vat_label} : {company.vat}" if company.vat else "",
                 f"RCCM : {company.company_registry}" if company.company_registry else ""]
        company_lines.append(" · ".join(p for p in legal if p))

        client = [("Nom", commercial.name or partner.name or "")]
        if partner != commercial and partner.name:
            client.append(("À l'attention de", partner.name))
        address = ", ".join(p for p in (partner.street, partner.street2, partner.zip, partner.city) if p)
        for label, value in (("Adresse", address), ("Contact", partner.phone or commercial.phone),
                             ("E-mail", partner.email or commercial.email), (vat_label, commercial.vat)):
            if value:
                client.append((label, value))

        rows, show_unit, show_discount = self._eguitra_report_rows(self._eguitra_report_lines())
        banner = None
        if self.state == "draft":
            banner = (f"BROUILLON : {'avoir' if refund else 'facture'} non validé{'' if refund else 'e'}, sans "
                      "numéro ni valeur comptable. Le numéro est attribué à la validation.")
        elif self.state == "cancel":
            banner = f"ANNULÉ{'' if refund else 'E'} : ce document ne doit pas être réglé."
        journal = self.journal_id
        color = company.primary_color if company.primary_color and COLOR.match(company.primary_color) else ACCENT
        currency = self.currency_id.name
        return {
            "accent": color,
            "css": self._eguitra_report_css(color),
            "banner": banner,
            "title": "AVOIR" if refund else "FACTURE",
            "number": self.name if self.name and self.name != "/" and self.state != "draft" else None,
            "status": "Brouillon" if self.state == "draft" else None,
            "place_date": f"{company.city}, le {day:%d/%m/%Y}" if company.city else f"Date : {day:%d/%m/%Y}",
            "company_name": company.name,
            "company_lines": [line for line in company_lines if line],
            "client": client,
            "references": self._eguitra_report_references(),
            "object": (self.eguitra_object or "").strip() or None,
            "rows": rows,
            "show_unit": show_unit,
            "show_discount": show_discount,
            # Tableau réduit à la désignation et au montant (lignes sous le tableau du transport).
            "simple_rows": False,
            "price_label": f"PU HT ({currency})",
            "amount_label": f"Montant HT ({currency})",
            "totals": self._eguitra_report_totals(with_payments),
            "words_intro": "Arrêté le présent avoir à la somme de :" if refund
                           else "Arrêtée la présente facture à la somme de :",
            "words": capitalize(amount_in_words(self.amount_total, self.currency_id)),
            "terms": None if refund else {
                "due": f"Le {self.invoice_date_due:%d/%m/%Y}" if self.invoice_date_due else None,
                "term": self.invoice_payment_term_id.name or None,
                "methods": journal.eguitra_payment_methods or DEFAULT_PAYMENT_METHODS,
                "banks": company._eguitra_invoice_banks(),
            },
            "signatory": journal.eguitra_signatory or DEFAULT_SIGNATORY,
        }

    @api.model
    def _eguitra_report_css(self, color):
        """Feuille de style du gabarit, à la couleur de la société (sans guillemets : elle est écrite telle
        quelle dans une balise style)."""
        return (
            ".o_eg_invoice { font-size: 10pt; color: #1d1d1b; }"
            ".o_eg_invoice table { width: 100%; border-collapse: collapse; }"
            ".o_eg_invoice td, .o_eg_invoice th { vertical-align: top; }"
            f".o_eg_accent {{ color: {color}; }}"
            ".o_eg_banner { border: 1.5pt solid #b42318; color: #b42318; text-align: center; font-weight: bold;"
            " padding: 2mm; margin-bottom: 4mm; }"
            f".o_eg_company_name {{ font-size: 13pt; font-weight: bold; color: {color}; }}"
            ".o_eg_title { text-align: right; }"
            f".o_eg_title_main {{ font-size: 20pt; font-weight: bold; letter-spacing: 1pt; color: {color}; }}"
            ".o_eg_status { font-weight: bold; color: #b42318; }"
            ".o_eg_parties { margin-top: 5mm; }"
            f".o_eg_box {{ border: 1pt solid {color}; padding: 2mm 3mm; }}"
            f".o_eg_label {{ font-weight: bold; color: #ffffff; background-color: {color}; padding: 0.8mm 2mm;"
            " margin-bottom: 1.5mm; }"
            ".o_eg_key { font-weight: bold; }"
            ".o_eg_refs { padding-left: 6mm; }"
            ".o_eg_object { margin-top: 4mm; }"
            ".o_eg_lines { margin-top: 4mm; }"
            f".o_eg_lines th {{ background-color: {color}; color: #ffffff; padding: 1.5mm; text-align: left;"
            " font-weight: bold; }"
            ".o_eg_lines td { border-bottom: 0.5pt solid #c8d0c8; padding: 1.2mm 1.5mm; }"
            ".o_eg_lines .o_eg_desc { white-space: pre-line; }"
            ".o_eg_lines .o_eg_num, .o_eg_totals .o_eg_num { text-align: right; white-space: nowrap; }"
            ".o_eg_section td { font-weight: bold; background-color: #edf3ed; }"
            ".o_eg_subsection td { font-weight: bold; }"
            ".o_eg_subtotal td { font-weight: bold; }"
            ".o_eg_note td { font-style: italic; }"
            ".o_eg_bottom { margin-top: 4mm; }"
            ".o_eg_words { padding-right: 6mm; }"
            ".o_eg_totals td { padding: 1mm 1.5mm; }"
            f".o_eg_main td {{ font-weight: bold; font-size: 11pt; border-top: 1.5pt solid {color}; }}"
            ".o_eg_footer { margin-top: 6mm; page-break-inside: avoid; }"
            ".o_eg_bank { margin-top: 1mm; }"
            ".o_eg_sign { text-align: center; width: 38%; }"
            ".o_eg_sign_space { height: 22mm; }"
        )


class ResCompany(models.Model):
    _inherit = "res.company"

    def _eguitra_invoice_banks(self):
        """Comptes bancaires portés sur les factures : journaux de banque de la société marqués « afficher
        sur les factures » et dotés d'un numéro de compte, dans l'ordre des journaux."""
        self.ensure_one()
        journals = self.env["account.journal"].sudo().search([
            ("company_id", "=", self.id), ("type", "=", "bank"), ("eguitra_show_on_invoices", "=", True),
            ("bank_account_id", "!=", False),
        ], order="sequence, id")
        return [{
            "bank": journal.bank_id.name or journal.name,
            "number": journal.bank_account_id.acc_number,
            "iban": journal.bank_account_id.eguitra_iban or None,
            "swift": journal.bank_id.bic or None,
            "currency": journal.currency_id.name if journal.currency_id and journal.currency_id != self.currency_id else None,
        } for journal in journals]
