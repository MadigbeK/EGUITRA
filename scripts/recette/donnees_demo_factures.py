# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Réglages de démonstration des factures au modèle du client, pour la base de recette : fictifs, repérés par
« (démo) », jamais en production (à la mise en service, l'administration saisit les vraies valeurs :
docs/projet/ETAT.md, 27/10).

Pour que les cahiers 02 et 03 se jouent (parties « Factures au modèle de la société » et « Facture des
rotations ») :
- identité de chaque société complétée là où elle est vide (téléphones et courriel fictifs, ville) ; slogan
  d'EGUITRA GROUP SARLU ;
- un compte bancaire fictif par société, coché « afficher sur les factures » (banque, numéro, IBAN, SWIFT
  fictifs) ;
- modes de règlement du cabinet (« espèces, virement bancaire ou chèque ») ;
- un journal de vente vide par société, au dernier numéro de l'ancien système, pour l'aperçu de la
  prochaine facture (FIN-56) : EG24137 pour EGUITRA GROUP SARLU, MBAX/2026/0026 pour MB AxisPro Consulting.

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \\
      < ../scripts/recette/donnees_demo_factures.py

Relancé, le script ne crée rien en double et ne remplace aucune valeur déjà saisie.
"""

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Réglages de démonstration des factures : base de recette uniquement."
assert "eguitra_legacy_last_number" in env["account.journal"]._fields, "Socle sans les factures au modèle."

admin = env["res.users"].search([("login", "=", "recette.admin")], limit=1)
env = env(user=admin.id or env.uid, su=True, context=dict(env.context, tracking_disable=True))

SLOGAN = "Votre partenaire global pour un avenir durable"
SOCIETES = {
    # Clé : début du nom de la société ; valeurs fictives (numéros en 600, domaine .test).
    "EGUITRA": {
        "identite": {"street": "Quartier de démonstration (démo)", "city": "Conakry",
                     "phone": "600 00 00 01 / 600 00 00 02", "email": "contact@eguitra-demo.test"},
        "slogan": SLOGAN,
        "banque": ("Banque essai (démo)", "BQDEM", "Banque Démo Guinée", "DEMOGNC1", "990001112223334",
                   "GN00 9900 0111 2223 3344"),
        "vente": ("Ventes, essai de numérotation (démo)", "VESS", "EG24137", None),
    },
    "MB AxisPro": {
        "identite": {"street": "Quartier de démonstration (démo)", "city": "Conakry",
                     "phone": "600 00 00 03", "email": "contact@mbaxispro-demo.test"},
        "slogan": None,
        "banque": ("Banque essai cabinet (démo)", "BQDMC", "Banque Démo Guinée", "DEMOGNC1", "990004445556667",
                   "GN00 9900 0444 5556 6677"),
        "vente": ("Honoraires, essai de numérotation (démo)", "VMBX", "MBAX/2026/0026",
                  "Par espèces, virement bancaire ou chèque"),
    },
}

Journal = env["account.journal"]
report = []
for prefix, conf in SOCIETES.items():
    company = env["res.company"].search([("name", "=like", f"{prefix}%")], limit=1)
    if not company:
        report.append(f"{prefix} : société absente")
        continue
    values = {k: v for k, v in conf["identite"].items() if not company[k]}
    if conf["slogan"] and not company.report_header:
        values["report_header"] = conf["slogan"]
    if values:
        company.write(values)

    name, code, bank_name, bic, number, iban = conf["banque"]
    bank_journal = Journal.search([("company_id", "=", company.id), ("code", "=", code)], limit=1)
    if not bank_journal:
        bank_journal = Journal.with_company(company).create({
            "name": name, "type": "bank", "code": code, "company_id": company.id, "bank_acc_number": number,
        })
        bank = env["res.bank"].search([("bic", "=", bic)], limit=1) or env["res.bank"].create(
            {"name": bank_name, "bic": bic})
        bank_journal.bank_account_id.write({"bank_id": bank.id, "eguitra_iban": iban})
    if not Journal.search_count([("company_id", "=", company.id), ("type", "=", "bank"),
                                 ("eguitra_show_on_invoices", "=", True)]):
        bank_journal.eguitra_show_on_invoices = True

    sale_name, sale_code, last_number, methods = conf["vente"]
    sale = Journal.search([("company_id", "=", company.id), ("code", "=", sale_code)], limit=1)
    if not sale:
        sale = Journal.with_company(company).create({
            "name": sale_name, "type": "sale", "code": sale_code, "company_id": company.id,
            "eguitra_legacy_last_number": last_number,
        })
    if methods:
        for journal in Journal.search([("company_id", "=", company.id), ("type", "=", "sale")]):
            if journal.eguitra_payment_methods != methods:
                journal.eguitra_payment_methods = methods
    report.append(f"{company.name} : identité {len(values)} champ(s) complété(s), compte bancaire "
                  f"{bank_journal.name}, prochaine facture de « {sale.name} » : {sale._eguitra_next_number()}")

env.cr.commit()
print("Factures (démo) : " + " ; ".join(report))
