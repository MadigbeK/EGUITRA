# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration complémentaires, pour présenter la plateforme sur la recette : un
exercice vivant (à-nouveaux, ventes et achats de chaque mois, encaissements et règlements,
rotations sur quatre mois, emprunt, immobilisations amorties) et deux pièces d'achat en attente
d'approbation. Fictives, repérées « DEMO2 », jamais en production. À lancer après
donnees_demo.py ; relancé, le script ne crée rien en double.

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \
      < ../scripts/recette/donnees_demo_presentation.py
"""

from datetime import date, timedelta

from odoo import Command

TODAY = date.today()
YEAR = TODAY.year
admin = env["res.users"].search([("login", "=", "recette.admin")], limit=1)
comptable = env["res.users"].search([("login", "=", "comptable.demo")], limit=1)
env = env(user=admin.id or env.uid, su=True, context=dict(env.context, tracking_disable=True))
groupe = env["res.company"].search([("eguitra_entity", "=", "groupe")], limit=1)
cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
genv = env(context=dict(env.context, allowed_company_ids=groupe.ids))
cenv = env(context=dict(env.context, allowed_company_ids=cabinet.ids))
GRANTED = {"eguitra_approval_granted": True}  # historique fictif : pas de circuit d'approbation


def account(e, company, *prefixes):
    for prefix in prefixes:
        found = e["account.account"].search([("code", "=like", prefix + "%"), ("company_ids", "in", company.ids)],
                                            limit=1, order="code")
        if found:
            return found
    raise ValueError(f"Aucun compte {prefixes} pour {company.name}")


def partner(name, **values):
    record = env["res.partner"].search([("name", "=", name)], limit=1)
    return record or env["res.partner"].create({"name": name, "is_company": True, **values})


def bank_of(e, company):
    return e["account.journal"].search([("company_id", "=", company.id), ("type", "=", "bank")], limit=1)


def section(label, fn):
    try:
        with env.cr.savepoint():
            print(f"OK    {label} : {fn()}")
    except Exception as exc:  # noqa: BLE001 - une section en échec n'empêche pas les autres
        print(f"ÉCHEC {label} : {exc}")


def opening():
    done = []
    for e, company, amount in ((genv, groupe, 850_000_000), (cenv, cabinet, 120_000_000)):
        Move = e["account.move"]
        if Move.search_count([("ref", "=", f"DEMO2-AN-{company.id}")]):
            continue
        journal = e["account.journal"].search([("company_id", "=", company.id), ("code", "=", "AN")], limit=1) \
            or e["account.journal"].create({"name": "À-nouveaux", "code": "AN", "type": "general",
                                            "company_id": company.id})
        move = Move.create({
            "move_type": "entry", "journal_id": journal.id, "date": date(YEAR, 1, 1), "ref": f"DEMO2-AN-{company.id}",
            "line_ids": [
                Command.create({"name": "Solde d'ouverture de la banque (démo)",
                                "account_id": bank_of(e, company).default_account_id.id, "debit": amount}),
                Command.create({"name": "Report à nouveau (démo)", "account_id": account(e, company, "121", "101").id,
                                "credit": amount}),
            ],
        })
        move.with_context(**GRANTED).action_post()
        done.append(company.name)
    return ", ".join(done) or "déjà en place"


def pay(e, company, moves, delay):
    bank = bank_of(e, company)
    for move in moves:
        paid_on = move.invoice_date + timedelta(days=delay)
        if paid_on > TODAY:
            continue
        wizard = e["account.payment.register"].with_context(active_model="account.move", active_ids=move.ids).create(
            {"journal_id": bank.id, "payment_date": paid_on})
        wizard.with_context(**GRANTED)._create_payments()


def sales_and_purchases():
    Move = genv["account.move"]
    if Move.search_count([("ref", "=like", "DEMO2-V%")]):
        return "déjà en place"
    clients = [partner("Démo - Distributeur pétrolier A", customer_rank=1),
               partner("Démo - Société minière B", customer_rank=1)]
    fuel_supplier = partner("Démo - Fournisseur de carburant", supplier_rank=1)
    garage = partner("Démo - Garage poids lourds", supplier_rank=1)
    revenue = account(genv, groupe, "706")
    fuel = account(genv, groupe, "6053", "605", "604")
    repair = account(genv, groupe, "6242", "624")
    sale_tax = groupe.account_sale_tax_id
    purchase_tax = groupe.account_purchase_tax_id
    sales, bills = Move.browse(), Move.browse()
    for m in range(1, TODAY.month + 1):
        for day, client, amount, label in (
            (12, clients[0], 160_000_000 + 6_000_000 * m, "Transport d'hydrocarbures, première quinzaine"),
            (24, clients[1], 120_000_000 + 15_000_000 * (m % 3), "Transport d'hydrocarbures, seconde quinzaine"),
        ):
            when = date(YEAR, m, day)
            if when > TODAY:
                continue
            sales |= Move.create({
                "move_type": "out_invoice", "partner_id": client.id, "invoice_date": when,
                "ref": f"DEMO2-V{m:02d}{day}",
                "invoice_line_ids": [Command.create({"name": f"{label} (démo)", "quantity": 1, "price_unit": amount,
                                                     "account_id": revenue.id,
                                                     "tax_ids": [Command.set(sale_tax.ids)] if sale_tax else []})],
            })
        for day, supplier, acc, amount, label in (
            (8, fuel_supplier, fuel, 62_000_000 + 4_000_000 * (m % 4), "Gasoil de la flotte"),
            (18, garage, repair, 9_000_000 + 3_000_000 * (m % 3), "Entretien et pièces"),
        ):
            when = date(YEAR, m, day)
            if when > TODAY:
                continue
            bills |= Move.create({
                "move_type": "in_invoice", "partner_id": supplier.id, "invoice_date": when, "ref": f"DEMO2-A{m:02d}{day}",
                "invoice_line_ids": [Command.create({"name": f"{label} (démo)", "quantity": 1, "price_unit": amount,
                                                     "account_id": acc.id,
                                                     "tax_ids": [Command.set(purchase_tax.ids)] if purchase_tax else []})],
            })
    (sales | bills).with_context(**GRANTED).action_post()
    pay(genv, groupe, sales, 40)   # les clients paient à 40 jours : les dernières factures restent dues
    pay(genv, groupe, bills, 25)
    return f"{len(sales)} factures de vente, {len(bills)} pièces d'achat, règlements jusqu'à aujourd'hui"


def cabinet_fees():
    Move = cenv["account.move"]
    if Move.search_count([("ref", "=like", "DEMO2-H%")]):
        return "déjà en place"
    clients = [partner("Démo - Briqueterie de Kindia SARL", customer_rank=1),
               partner("Démo - Vergers de Mamou SA", customer_rank=1)]
    revenue = account(cenv, cabinet, "706")
    tax = cabinet.account_sale_tax_id
    fees = Move.browse()
    for m in range(1, TODAY.month + 1):
        when = date(YEAR, m, 20)
        if when > TODAY:
            continue
        fees |= Move.create({
            "move_type": "out_invoice", "partner_id": clients[m % 2].id, "invoice_date": when, "ref": f"DEMO2-H{m:02d}",
            "invoice_line_ids": [Command.create({"name": "Honoraires d'accompagnement (démo)", "quantity": 1,
                                                 "price_unit": 18_000_000 + 2_000_000 * (m % 4),
                                                 "account_id": revenue.id,
                                                 "tax_ids": [Command.set(tax.ids)] if tax else []})],
        })
    fees.with_context(**GRANTED).action_post()
    pay(cenv, cabinet, fees, 30)
    return f"{len(fees)} factures d'honoraires"


def rotations():
    Rotation = genv["eguitra.transport.rotation"]
    if Rotation.search_count([("delivery_note", "=like", "BL-DEMO2-%")]):
        return "déjà en place"
    vehicles = genv["eguitra.transport.vehicle"].search([("name", "=like", "DEMO-%")], order="name")
    routes = genv["eguitra.transport.route"].search([("name", "=like", "%(démo)")], order="id")
    clients = [partner("Démo - Distributeur pétrolier A", customer_rank=1),
               partner("Démo - Société minière B", customer_rank=1)]
    created = Rotation.browse()
    for i in range(30):
        route = routes[i % len(routes)]
        labe = "Labé" in route.name  # route peu rentable : déclenche l'alerte de marge
        created |= Rotation.create({
            "date_loading": TODAY - timedelta(days=4 * i + 3), "vehicle_id": vehicles[i % len(vehicles)].id,
            "partner_id": clients[i % 2].id, "route_id": route.id, "product": "essence" if i % 4 == 0 else "gasoil",
            "delivery_note": f"BL-DEMO2-{i + 1:03d}", "volume_loaded": 33.0, "volume_delivered": 33.0 - (i % 5) * 0.04,
            "fuel_cost": (8_100_000 if labe else 3_300_000) + 120_000 * (i % 3),
            "toll_cost": 400_000 if labe else 250_000, "driver_fees": 1_200_000 if labe else 650_000,
            "source": "mobile" if i % 2 else "office",
        })
    validated = created.filtered(lambda r: r.date_loading <= TODAY - timedelta(days=6))
    validated.action_validate()
    invoices = validated.filtered(lambda r: r.date_loading <= TODAY - timedelta(days=20)).action_invoice()
    invoices.with_context(**GRANTED).action_post()
    return f"{len(created)} rotations, {len(validated)} validées, {len(invoices)} factures"


def loan_and_assets():
    Loan = genv["eguitra.loan"]
    if Loan.search_count([("name", "=", "DEMO2-EMP-01")]):
        return "déjà en place"
    bank = bank_of(genv, groupe)
    lender = partner("Démo - Banque de financement", supplier_rank=1)
    debt = account(genv, groupe, "162", "16")
    start = date(YEAR, 2, 1)
    disbursement = genv["account.move"].create({
        "move_type": "entry", "journal_id": bank.id, "date": start, "ref": "DEMO2-EMP-01 déblocage",
        "line_ids": [Command.create({"name": "Déblocage de l'emprunt (démo)", "account_id": bank.default_account_id.id,
                                     "debit": 1_000_000_000}),
                     Command.create({"name": "Déblocage de l'emprunt (démo)", "account_id": debt.id,
                                     "partner_id": lender.id, "credit": 1_000_000_000})],
    })
    disbursement.with_context(**GRANTED).action_post()
    loan = Loan.create({
        "name": "DEMO2-EMP-01", "partner_id": lender.id, "kind": "loan", "principal": 1_000_000_000,
        "annual_rate": 12.0, "start_date": start, "first_due_date": date(YEAR, 3, 1), "duration_months": 36,
        "periodicity": "monthly", "method": "annuity", "principal_account_id": debt.id,
        "interest_account_id": account(genv, groupe, "6712", "671").id, "journal_id": bank.id,
    })
    loan.action_activate()
    for line in loan.line_ids.filtered(lambda l: l.due_date <= TODAY):
        line.action_pay()

    journal = genv["account.journal"].search([("company_id", "=", groupe.id), ("type", "=", "general")], limit=1)
    profile = genv["account.asset.profile"].create({
        "name": "Matériel de transport, 5 ans (démo)", "account_asset_id": account(genv, groupe, "2451", "245").id,
        "account_depreciation_id": account(genv, groupe, "2845", "284").id,
        "account_expense_depreciation_id": account(genv, groupe, "6813", "681").id, "journal_id": journal.id,
        "method": "linear", "method_number": 5, "method_period": "month", "company_id": groupe.id,
    })
    assets = genv["account.asset"].browse()
    for name, value, when in (("Ensemble citerne DEMO-04 (démo)", 900_000_000, date(YEAR, 2, 15)),
                              ("Véhicule de liaison (démo)", 180_000_000, date(YEAR, 4, 1))):
        purchase = genv["account.move"].create({
            "move_type": "entry", "journal_id": bank.id, "date": when, "ref": f"Achat {name}",
            "line_ids": [Command.create({"name": f"Achat {name}", "account_id": profile.account_asset_id.id,
                                         "debit": value}),
                         Command.create({"name": f"Achat {name}", "account_id": bank.default_account_id.id,
                                         "credit": value})],
        })
        purchase.with_context(**GRANTED).action_post()
        asset = genv["account.asset"].create({"name": name, "profile_id": profile.id, "purchase_value": value,
                                              "date_start": when, "company_id": groupe.id})
        asset.compute_depreciation_board()
        asset.validate()
        assets |= asset
    genv["account.asset"]._eguitra_cron_depreciate()
    paid = len(loan.line_ids.filtered("paid"))
    return f"emprunt de 1 Md GNF ({paid} échéances réglées), {len(assets)} immobilisations amorties"


def pending_approvals():
    if not comptable:
        return "compte comptable.demo absent"
    Move = genv["account.move"].with_user(comptable)
    if genv["account.move"].search_count([("ref", "=like", "DEMO2-APP-%")]):
        return "déjà en place"
    garage = partner("Démo - Garage poids lourds", supplier_rank=1)
    fuel_supplier = partner("Démo - Fournisseur de carburant", supplier_rank=1)
    tax = groupe.account_purchase_tax_id
    bills = Move.browse()
    for ref, who, acc, amount, label in (
        ("DEMO2-APP-1", garage, account(genv, groupe, "6242", "624"), 15_000_000, "Remplacement des pneus DEMO-03"),
        ("DEMO2-APP-2", fuel_supplier, account(genv, groupe, "6053", "605", "604"), 72_000_000,
         "Stock tampon de gasoil avant la saison des pluies"),
    ):
        bills |= Move.create({
            "move_type": "in_invoice", "partner_id": who.id, "invoice_date": TODAY - timedelta(days=1), "ref": ref,
            "invoice_line_ids": [Command.create({"name": f"{label} (démo)", "quantity": 1, "price_unit": amount,
                                                 "account_id": acc.id,
                                                 "tax_ids": [Command.set(tax.ids)] if tax else []})],
        })
    for bill in bills:
        bill._eguitra_post_or_submit()
    return f"{len(bills)} pièces soumises par comptable.demo"


def payroll_and_overheads():
    """Salaires et charges fixes de chaque mois : un résultat plausible pour une entreprise de transport."""
    Move = genv["account.move"]
    if Move.search_count([("ref", "=like", "DEMO2-S%")]):
        return "déjà en place"
    journal = genv["account.journal"].search([("company_id", "=", groupe.id), ("type", "=", "general")], limit=1)
    bank = bank_of(genv, groupe)
    salaries = account(genv, groupe, "6611", "661")
    payable = account(genv, groupe, "422", "42")
    overheads = [(account(genv, groupe, "6222", "622"), 22_000_000, "Loyer du dépôt et des bureaux"),
                 (account(genv, groupe, "625", "62"), 14_000_000, "Assurances de la flotte"),
                 (account(genv, groupe, "6281", "628", "62"), 6_000_000, "Télécommunications et frais divers")]
    moves = Move.browse()
    for m in range(1, TODAY.month):  # mois révolus
        end = date(YEAR, m, 28)
        amount = 145_000_000 + 5_000_000 * (m % 3)
        lines = [Command.create({"name": f"Salaires de {m:02d}/{YEAR} (démo)", "account_id": salaries.id, "debit": amount}),
                 Command.create({"name": f"Salaires de {m:02d}/{YEAR} (démo)", "account_id": payable.id, "credit": amount})]
        moves |= Move.create({"move_type": "entry", "journal_id": journal.id, "date": end, "ref": f"DEMO2-S{m:02d}",
                              "line_ids": lines})
        paid = [Command.create({"name": f"Virement des salaires {m:02d}/{YEAR} (démo)", "account_id": payable.id,
                                "debit": amount})]
        total = amount
        for acc, value, label in overheads:
            paid.append(Command.create({"name": f"{label} {m:02d}/{YEAR} (démo)", "account_id": acc.id, "debit": value}))
            total += value
        paid.append(Command.create({"name": f"Décaissements de {m:02d}/{YEAR} (démo)",
                                    "account_id": bank.default_account_id.id, "credit": total}))
        moves |= Move.create({"move_type": "entry", "journal_id": bank.id, "date": end, "ref": f"DEMO2-SP{m:02d}",
                              "line_ids": paid})
    moves.with_context(**GRANTED).action_post()
    return f"{len(moves)} écritures (salaires, loyers, assurances, frais), mois révolus"


def bank_clearing():
    """Règlements passés en banque, comme après le rapprochement des relevés : les comptes d'attente
    des paiements entrants et sortants sont apurés contre le compte bancaire, et lettrés."""
    done = []
    for e, company in ((genv, groupe), (cenv, cabinet)):
        Move = e["account.move"]
        if Move.search_count([("ref", "=", f"DEMO2-RAPPRO-{company.id}")]):
            continue
        bank = bank_of(e, company)
        # Comptes d'attente : ceux où les règlements ont été passés (hors comptes de tiers).
        payments = e["account.payment"].search([("company_id", "=", company.id), ("move_id.state", "=", "posted")])
        waiting = payments.move_id.line_ids.account_id.filtered(
            lambda a: a.reconcile and a.account_type not in ("asset_receivable", "liability_payable"))
        lines = e["account.move.line"].search([
            ("company_id", "=", company.id), ("parent_state", "=", "posted"), ("reconciled", "=", False),
            ("account_id", "in", waiting.ids),
        ])
        if not lines:
            continue
        entries, groups = [], []
        for acc in lines.account_id:
            open_lines = lines.filtered(lambda l, a=acc: l.account_id == a)
            balance = sum(open_lines.mapped("balance"))
            if not balance:
                continue
            groups.append((acc, open_lines))
            entries.append(Command.create({"name": f"Rapprochement bancaire (démo) - {acc.name}", "account_id": acc.id,
                                           "debit": -balance if balance < 0 else 0, "credit": balance if balance > 0 else 0}))
            entries.append(Command.create({"name": f"Rapprochement bancaire (démo) - {acc.name}",
                                           "account_id": bank.default_account_id.id,
                                           "debit": balance if balance > 0 else 0, "credit": -balance if balance < 0 else 0}))
        move = Move.create({"move_type": "entry", "journal_id": bank.id, "date": TODAY - timedelta(days=1),
                            "ref": f"DEMO2-RAPPRO-{company.id}", "line_ids": entries})
        move.with_context(**GRANTED).action_post()
        for acc, open_lines in groups:
            (open_lines | move.line_ids.filtered(lambda l, a=acc: l.account_id == a)).reconcile()
        done.append(company.name)
    return ", ".join(done) or "rien à apurer"


section("À-nouveaux des deux sociétés", opening)
section("Salaires et charges fixes (groupe)", payroll_and_overheads)
section("Ventes, achats et règlements de l'exercice (groupe)", sales_and_purchases)
section("Honoraires du cabinet", cabinet_fees)
section("Rotations des quatre derniers mois", rotations)
section("Emprunt et immobilisations", loan_and_assets)
section("Pièces en attente d'approbation", pending_approvals)
section("Règlements passés en banque", bank_clearing)
env.cr.commit()
print("Données de présentation prêtes.")
