# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration des achats et des ventes (eguitra_commerce), pour la base de recette : fictives,
repérées par « (démo) », jamais en production.

Pour que le cahier 11 se joue :
- un catalogue par société (location de camion-benne au jour, terrassement au m³, crépissage au m², ciment
  et gasoil achetés ; pour MB AxisPro Consulting, jours d'accompagnement et étude au forfait) ;
- EGUITRA GROUP SARLU : l'offre « Crépissage du bâtiment administratif (démo) » acceptée et facturée par
  acomptes (avance de démarrage 50 %, deuxième acompte 30 %, validés), et l'offre « Location de deux
  camions-bennes (démo) » envoyée, qui expire dans cinq jours ;
- un bon de commande « Ciment du chantier (démo) » approuvé (saisi par test.achats, approuvé par test.daf),
  reçu en partie (120 sacs sur 200) avec la pièce d'achat du fournisseur en brouillon : 150 sacs à 97 500
  pour 120 reçus à 95 000, soit un écart de quantité et de prix ;
- MB AxisPro Consulting : une offre d'accompagnement en brouillon.

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \\
      < ../scripts/recette/donnees_demo_commerce.py

Relancé, le script ne crée rien en double.
"""

from datetime import timedelta

from odoo import Command, fields

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Données de démonstration des achats et des ventes : base de recette uniquement."
assert "eguitra.commerce.receipt" in env, "Module eguitra_commerce non installé."

admin = env["res.users"].search([("login", "=", "recette.admin")], limit=1)
env = env(user=admin.id or env.uid, su=True, context=dict(env.context, tracking_disable=True, mail_notrack=True,
                                                         mail_create_nosubscribe=True))
today = fields.Date.context_today(env.user)
report = []

Company = env["res.company"]
groupe = Company.search([("eguitra_entity", "=", "groupe")], limit=1)
cabinet = Company.search([("eguitra_entity", "=", "cabinet")], limit=1)
(groupe | cabinet)._eguitra_commerce_setup()
Uom = env["uom.uom"]


def uom(xmlid=None, *names):
    record = env.ref(xmlid, raise_if_not_found=False) if xmlid else Uom
    for name in names:
        if record:
            break
        record = Uom.search([("name", "=", name)], limit=1)
    return record or Uom.create({"name": names[-1], "relative_factor": 1.0})


UNIT, DAY = uom("uom.product_uom_unit", "Unités"), uom("uom.product_uom_day", "Jours")
M2, M3, FFT = uom(None, "m²"), uom(None, "m³"), uom(None, "fft")


def partner(name, **values):
    record = env["res.partner"].search([("name", "=", name)], limit=1)
    return record or env["res.partner"].create({"name": name, "is_company": True, **values})


def tax(company, use):
    return company.account_sale_tax_id if use == "sale" else company.account_purchase_tax_id


def account(company, prefix):
    return env["account.account"].search([("code", "=like", f"{prefix}%"), ("company_ids", "in", company.ids)],
                                         order="code", limit=1)


def item(company, name, kind, unit, sale_price=0.0, purchase_price=0.0, sale=True, purchase=False):
    Template = env["product.template"].with_company(company)
    template = Template.search([("name", "=", name), ("company_id", "=", company.id)], limit=1)
    if not template:
        template = Template.create({
            "name": name, "type": kind, "company_id": company.id, "eguitra_catalogue": True, "uom_id": unit.id,
            "list_price": sale_price, "standard_price": purchase_price, "sale_ok": sale, "purchase_ok": purchase,
            "taxes_id": [Command.set(tax(company, "sale").ids if sale else [])],
            "supplier_taxes_id": [Command.set(tax(company, "purchase").ids if purchase else [])],
            "invoice_policy": "order", "purchase_method": "receive",
            "property_account_income_id": (account(company, "706") or account(company, "70")).id if sale else False,
            "property_account_expense_id": (account(company, "6041") or account(company, "60")).id if purchase else False,
        })
    return template.product_variant_id


# ─── Catalogues ──────────────────────────────────────────────────────────────

camion = item(groupe, "Location de camion-benne, par jour (démo)", "service", DAY, sale_price=1_500_000)
deblai = item(groupe, "Terrassement en déblai, au m³ (démo)", "service", M3, sale_price=25_000)
crepi = item(groupe, "Crépissage, au mètre carré (démo)", "service", M2, sale_price=35_000)
ciment = item(groupe, "Ciment CPA 42,5, sac de 50 kg (démo)", "consu", UNIT, purchase_price=95_000, sale=False,
              purchase=True)
gasoil = item(groupe, "Gasoil, au litre (démo)", "consu", UNIT, purchase_price=12_000, sale=False, purchase=True)
item(cabinet, "Accompagnement de porteur de projet, par jour (démo)", "service", DAY, sale_price=2_000_000)
etude = item(cabinet, "Étude de faisabilité, au forfait (démo)", "service", FFT, sale_price=8_000_000)
report.append("catalogues : 5 articles pour EGUITRA GROUP SARLU, 2 pour MB AxisPro Consulting")

Order = env["sale.order"]
client = partner("Démo - Maître d'ouvrage", customer_rank=1)
mine = partner("Démo - Société minière B", customer_rank=1)


def sale_line(product, name, qty, price, unit=None):
    return Command.create({"product_id": product.id, "name": name, "product_uom_qty": qty, "price_unit": price,
                           "product_uom_id": (unit or product.uom_id).id,
                           "tax_ids": [Command.set(product.taxes_id.filtered(lambda t: t.company_id == product.company_id).ids)]})


# ─── Offre acceptée, facturée par acomptes ───────────────────────────────────

if not Order.search_count([("eguitra_object", "=", "Crépissage du bâtiment administratif (démo)")]):
    offer = Order.with_company(groupe)._eguitra_quiet().create({
        "partner_id": client.id, "company_id": groupe.id, "eguitra_object": "Crépissage du bâtiment administratif (démo)",
        "eguitra_offer_date": today - timedelta(days=12), "validity_date": today + timedelta(days=3),
        "eguitra_conditions": "Exécution en trois semaines après l'avance de démarrage (démo).",
        "order_line": [
            Command.create({"display_type": "line_section", "name": "Façades"}),
            sale_line(crepi, "Crépissage des façades nord et sud", 420, 35_000),
            sale_line(crepi, "Crépissage des façades est et ouest", 260, 35_000),
            Command.create({"display_type": "line_section", "name": "Abords"}),
            sale_line(deblai, "Déblai et évacuation des gravats", 80, 25_000),
            Command.create({"display_type": "line_note", "name": "Échafaudages fournis par l'entreprise (démo)."}),
        ],
    })
    offer.action_eguitra_mark_sent()
    offer.action_eguitra_accept()
    for value, label in ((50, "Avance de démarrage 50 %"), (30, "Deuxième acompte 30 %")):
        invoices = offer.eguitra_create_invoice("percentage", value, label=label)
        invoices.action_post()
    report.append(f"offre {offer.name} acceptée, deux acomptes facturés (50 % et 30 %)")

# ─── Offre envoyée, qui expire bientôt ───────────────────────────────────────

if not Order.search_count([("eguitra_object", "=", "Location de deux camions-bennes (démo)")]):
    offer = Order.with_company(groupe)._eguitra_quiet().create({
        "partner_id": mine.id, "company_id": groupe.id, "eguitra_object": "Location de deux camions-bennes (démo)",
        "eguitra_offer_date": today - timedelta(days=10), "validity_date": today + timedelta(days=5),
        "order_line": [sale_line(camion, "Camion-benne 20 m³ avec chauffeur, carburant exclu", 2 * 15, 1_500_000)],
    })
    offer.action_eguitra_mark_sent()
    report.append(f"offre {offer.name} envoyée, expire dans cinq jours")

if not Order.search_count([("eguitra_object", "=", "Étude de faisabilité d'une unité de séchage (démo)")]):
    porteur = partner("Démo - Porteur de projet accompagné")
    offer = Order.with_company(cabinet)._eguitra_quiet().create({
        "partner_id": porteur.id, "company_id": cabinet.id,
        "eguitra_object": "Étude de faisabilité d'une unité de séchage (démo)",
        "order_line": [sale_line(etude, "Étude de faisabilité technique et financière", 1, 8_000_000)],
    })
    report.append(f"offre {offer.name} (MB AxisPro Consulting) en brouillon")

# ─── Bon de commande reçu en partie, pièce d'achat en écart ──────────────────

PO = env["purchase.order"]
if not PO.search_count([("eguitra_object", "=", "Ciment du chantier (démo)")]):
    quincaillerie = partner("Démo - Quincaillerie du port", supplier_rank=1)
    buyer = env["res.users"].search([("login", "=", "test.achats")], limit=1)
    approver = env["res.users"].search([("login", "=", "test.daf")], limit=1)
    planned = fields.Datetime.now() + timedelta(days=3)
    Orders = PO.with_user(buyer.id or env.uid).sudo().with_company(groupe)._eguitra_quiet()
    po = Orders.create({
        "partner_id": quincaillerie.id, "company_id": groupe.id, "eguitra_object": "Ciment du chantier (démo)",
        "date_planned": planned, "eguitra_conditions": "Livraison au chantier de l'entrepôt de stockage (démo).",
        "order_line": [
            Command.create({"product_id": ciment.id, "name": "Ciment CPA 42,5, sac de 50 kg", "product_qty": 200,
                            "price_unit": 95_000, "product_uom_id": UNIT.id, "date_planned": planned,
                            "tax_ids": [Command.set(tax(groupe, "purchase").ids)]}),
        ],
    })
    po.action_eguitra_submit()
    request = po._eguitra_last_request()
    if request.state == "pending" and approver:
        for _step in request.step_ids:
            if request.state != "pending":
                break
            decider = approver if request._can_decide(approver) else env["res.users"].search(
                [("login", "=", "test.dg")], limit=1)
            request.with_user(decider).action_approve("Démonstration")
    if po.state != "purchase":
        po._eguitra_approve()
    po.action_eguitra_mark_sent()
    po.eguitra_receive({po.order_line: 120}, date=today, note="Première livraison, 120 sacs (démo)",
                       received_by=buyer or env.user)
    bill = po.eguitra_create_bill(ref="FAC-QDP-0001 (démo)", quantities={po.order_line: 150},
                                  prices={po.order_line: 97_500})
    match = bill._eguitra_match()
    report.append(f"bon de commande {po.name} reçu en partie (120/200), pièce d'achat en brouillon avec "
                  f"{len(match['issues'])} écart(s)")

env.cr.commit()
print("Achats et ventes (démo) : " + " ; ".join(report))
