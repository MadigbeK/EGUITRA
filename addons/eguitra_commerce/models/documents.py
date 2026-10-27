"""Documents imprimés et envoyés des achats et des ventes : offres (« OFFRE ») et bons de commande (« BON DE
COMMANDE »), au gabarit des factures de la société (eguitra_base : identité de la société, bloc du tiers,
références, objet, rubriques numérotées I, II… avec leur sous-total, unités, remises, totaux par groupe de
taxe, montant en toutes lettres, conditions, signataire), dans sa charte (logo, couleur, à défaut le vert
d'EGUITRA GROUP).

Envoi par courriel : seulement si un serveur d'envoi est paramétré (infra/mail-server.sh), comme les relances
des clients (eguitra_finance) ; le document part en PDF joint, et un échec d'envoi est dit à l'utilisateur.
"""

import base64

from markupsafe import Markup, escape

from odoo.exceptions import UserError

from odoo.addons.eguitra_base.lettres import money, number, number_trim, roman
from odoo.addons.eguitra_base.models.account_move import ACCENT, COLOR

LINE_KINDS = ("line_section", "line_subsection", "line_note")


def accent_of(company):
    return company.primary_color if company.primary_color and COLOR.match(company.primary_color) else ACCENT


def report_css_and_accent(env, company):
    """Couleur de la société et feuille de style du gabarit des factures, reprise telle quelle."""
    color = accent_of(company)
    return color, env["account.move"]._eguitra_report_css(color)


def company_block(company):
    """Identité de la société sous sa raison sociale : adresse, contacts, NIF et RCCM."""
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


def partner_block(partner, company):
    """Bloc du client ou du fournisseur : (libellé, valeur)."""
    vat_label = company.account_fiscal_country_id.vat_label or "NIF"
    commercial = partner.commercial_partner_id
    block = [("Nom", commercial.name or partner.name or "")]
    if partner != commercial and partner.name:
        block.append(("À l'attention de", partner.name))
    address = ", ".join(p for p in (partner.street, partner.street2, partner.zip, partner.city) if p)
    for label, value in (("Adresse", address), ("Contact", partner.phone or commercial.phone),
                         ("E-mail", partner.email or commercial.email), (vat_label, commercial.vat)):
        if value:
            block.append((label, value))
    return block


def rows_of(env, lines, currency, quantity="product_uom_qty", uom="product_uom_id"):
    """Lignes du tableau, comme celles de la facture : rubriques numérotées I, II… closes par leur
    sous-total, sous-rubriques et notes, lignes numérotées 1, 2, 3… Rend (lignes, colonne Unité, colonne
    Remise)."""
    unit = env.ref("uom.product_uom_unit", raise_if_not_found=False)
    products = lines.filtered(lambda l: not l.display_type)
    show_unit = any(l[uom] and l[uom] != unit for l in products)
    show_discount = any(l.discount for l in products)
    digits = currency.decimal_places
    rows, count, rubric = [], 0, 0
    state = {"section": None, "total": 0.0, "lines": 0}

    def close():
        if state["section"] is not None and state["lines"]:
            rows.append({"kind": "subtotal", "label": f"Sous-total {state['section']}",
                         "amount": number(state["total"], digits)})

    for line in lines:
        if line.display_type == "line_section":
            close()
            rubric += 1
            state.update(section=(line.name or "").strip(), total=0.0, lines=0)
            rows.append({"kind": "section", "label": f"{roman(rubric)}. {state['section']}"})
        elif line.display_type in ("line_subsection", "line_note"):
            rows.append({"kind": "subsection" if line.display_type == "line_subsection" else "note",
                         "label": line.name or ""})
        else:
            count += 1
            rows.append({
                "kind": "line", "number": count, "name": line.name or "",
                "unit": line[uom].name if show_unit and line[uom] else "",
                "quantity": number_trim(line[quantity]),
                "price": number_trim(line.price_unit, max(digits, 2)),
                "discount": f"{number_trim(line.discount, 2)} %" if line.discount else "",
                "amount": number(line.price_subtotal, digits),
            })
            if state["section"] is not None:
                state["total"] += line.price_subtotal
                state["lines"] += 1
    close()
    return rows, show_unit, show_discount


def totals_of(record, main_label="TOTAL TTC"):
    """Totaux : montant HT, chaque groupe de taxe, total TTC (même lecture que la facture)."""
    currency = record.currency_id

    def fmt(value):
        return money(value, currency.name, currency.decimal_places)

    tax_totals = record.tax_totals or {}
    rows = []
    for index, subtotal in enumerate(tax_totals.get("subtotals") or []):
        rows.append({"label": "Montant HT" if index == 0 else subtotal.get("name"),
                     "amount": fmt(subtotal.get("base_amount_currency", record.amount_untaxed))})
        for group in subtotal.get("tax_groups") or []:
            rows.append({"label": group.get("group_name"), "amount": fmt(group.get("tax_amount_currency", 0.0))})
    if not rows:
        rows.append({"label": "Montant HT", "amount": fmt(record.amount_untaxed)})
        if record.amount_tax:
            rows.append({"label": "Taxes", "amount": fmt(record.amount_tax)})
    rows.append({"label": main_label, "amount": fmt(record.amount_total), "main": True})
    return rows


# ─── Envoi par courriel ──────────────────────────────────────────────────


def mail_server_ready(env):
    """Un serveur d'envoi de courriel est-il paramétré ? Sans lui, rien ne part par courriel."""
    return bool(env["ir.mail_server"].sudo().search_count([]))


def _body(company, title, paragraphs):
    color = accent_of(company)
    text = Markup("").join(Markup("<p style='margin:0 0 10px'>{}</p>").format(
        escape(p).replace("\n", Markup("<br/>"))) for p in paragraphs if p)
    return Markup(
        "<div style='font-family:Arial,sans-serif;color:#1d1d1b;max-width:640px'>"
        "<div style='background:{};color:#ffffff;padding:12px 16px;font-size:15px;font-weight:bold'>{}</div>"
        "<div style='padding:16px'>{}<p style='margin-top:18px'>{}</p></div></div>"
    ).format(color, title, text, company.name)


def send_mail(env, email_to, subject, title, paragraphs, company=None, attachments=None):
    """Courriel par la file d'envoi du noyau ; None sans serveur paramétré ou sans adresse."""
    if not email_to or not mail_server_ready(env):
        return None
    company = company or env.company
    values = {"subject": subject, "body_html": _body(company, title, paragraphs), "email_to": email_to,
              "email_from": company.email or False, "auto_delete": False}
    if attachments:
        values["attachment_ids"] = [(6, 0, attachments.ids)]
    return env["mail.mail"].sudo().create(values)


def send_document(record, report, filename, email_to, subject, title, paragraphs):
    """Document en PDF joint à un courriel envoyé sur-le-champ ; refus clair sans serveur, sans adresse ou
    en cas d'échec (l'état du document ne change alors pas)."""
    env = record.env
    if not email_to:
        raise UserError(f"{record.partner_id.name} n'a pas d'adresse électronique : imprimez le document.")
    if not mail_server_ready(env):
        raise UserError("Aucun serveur d'envoi de courriel n'est paramétré : imprimez le document et remettez-le.")
    pdf, _kind = env["ir.actions.report"].sudo()._render_qweb_pdf(report, record.ids)
    attachment = env["ir.attachment"].sudo().create({
        "name": filename, "type": "binary", "datas": base64.b64encode(pdf), "mimetype": "application/pdf",
        "res_model": record._name, "res_id": record.id,
    })
    mail = send_mail(env, email_to, subject, title, paragraphs, company=record.company_id, attachments=attachment)
    mail.send(raise_exception=False)
    if mail.state == "exception":
        raise UserError(f"Le courriel à {email_to} n'est pas parti : {mail.failure_reason or 'serveur d’envoi en échec'}. "
                        "Réessayez ou imprimez le document.")
    return mail


def document_filename(record, kind):
    return f"{kind} {(record.name or '').replace('/', '-')}.pdf"
