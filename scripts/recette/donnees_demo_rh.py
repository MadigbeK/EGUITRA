# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration RH pour la base de recette : fictives, repérées par « (démo) », jamais en
production.

Personnel fictif des deux sociétés (départements, contrats variés, éléments fixes, documents à
échéance), absences, une avance, et la paie validée du mois précédent pour que les écrans de NIMOVA ·
RH ne soient pas vides. Les comptes de test test.dg, test.exploitation et test.parc sont liés à des
dossiers salariés pour essayer « Mon espace » (demande d'absence, décision du responsable).

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \
      < ../scripts/recette/donnees_demo_rh.py

Relancé, le script ne crée rien en double.
"""

from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from odoo import Command

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Données de démonstration RH : base de recette uniquement."

TODAY = date.today()
admin = env["res.users"].search([("login", "=", "recette.admin")], limit=1)
env = env(user=admin.id or env.uid, su=True, context=dict(env.context, tracking_disable=True))
groupe = env["res.company"].search([("eguitra_entity", "=", "groupe")], limit=1)
cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
Employee = env["eguitra.rh.employee"].with_context(active_test=False)
rubric = {r.code: r for r in env["eguitra.rh.rubric"].search([])}
leave_type = {t.code: t for t in env["eguitra.rh.leave.type"].search([])}
plan = env.ref("eguitra_base.analytic_plan_activite")

# Le compte d'administration de recette porte aussi le profil RH pour les démonstrations.
if admin:
    admin.write({"group_ids": [Command.link(env.ref("eguitra_base.group_profile_rh").id)]})


def activity(company, name):
    Analytic = env["account.analytic.account"]
    account = Analytic.search([("plan_id", "=", plan.id), ("name", "=", name), ("company_id", "in", [False, company.id])],
                              limit=1)
    return account or Analytic.create({"name": name, "plan_id": plan.id, "company_id": company.id})


def department(company, name):
    Dept = env["eguitra.rh.department"]
    return Dept.search([("company_id", "=", company.id), ("name", "=", name)], limit=1) or \
        Dept.create({"company_id": company.id, "name": name})


def employee(company, name, **values):
    full = f"{name} (démo)"
    record = Employee.search([("company_id", "=", company.id), ("name", "=", full)], limit=1)
    if record:
        return record
    lines = values.pop("lines", [])
    record = Employee.create(dict(values, company_id=company.id, name=full,
                                  line_ids=[Command.create({"rubric_id": rubric[c].id, "amount": a}) for c, a in lines]))
    return record


def user(login):
    return env["res.users"].search([("login", "=", login)], limit=1)


# ─── EGUITRA GROUP ──────────────────────────────────────────────────────

direction = department(groupe, "Direction générale")
finance_d = department(groupe, "Finance et comptabilité")
transport_d = department(groupe, "Transport")
btp_d = department(groupe, "BTP")
transport_a = activity(groupe, "Transport")
btp_a = activity(groupe, "BTP")
general_a = activity(groupe, "Administration générale")

dg = employee(groupe, "Mamadou Sylla", job_title="Directeur des opérations", department_id=direction.id,
              category="cadre", hire_date=date(2019, 3, 1), base_salary=18_000_000, cnss_number="GN-CNSS-0001",
              gender="homme", birth_date=date(1978, 5, 12), id_number="CNI-0001", bank_name="Ecobank",
              bank_account="GN01 0001 0001", activity_account_id=general_a.id,
              lines=[("LOGT", 3_000_000), ("TRANSP", 1_000_000), ("RESP", 2_000_000)])
daf = employee(groupe, "Fatoumata Camara", job_title="Responsable financière", department_id=finance_d.id,
               manager_id=dg.id, category="cadre", hire_date=date(2021, 9, 1), base_salary=9_500_000,
               cnss_number="GN-CNSS-0002", gender="femme", birth_date=date(1986, 11, 3), id_number="CNI-0002",
               bank_name="Société Générale", bank_account="GN02 0002 0002", activity_account_id=general_a.id,
               lines=[("LOGT", 1_500_000), ("TRANSP", 600_000)])
comptable = employee(groupe, "Ibrahima Barry", job_title="Comptable", department_id=finance_d.id, manager_id=daf.id,
                     category="employe", hire_date=date(2023, 2, 1), base_salary=4_200_000, cnss_number="GN-CNSS-0003",
                     gender="homme", birth_date=date(1993, 1, 20), id_number="CNI-0003", bank_name="Ecobank",
                     bank_account="GN03 0003 0003", activity_account_id=general_a.id, lines=[("TRANSP", 400_000)])
chef_parc = employee(groupe, "Sékou Touré", job_title="Chef de parc", department_id=transport_d.id, manager_id=dg.id,
                     category="maitrise", hire_date=date(2020, 6, 15), base_salary=6_000_000, cnss_number="GN-CNSS-0004",
                     gender="homme", birth_date=date(1982, 8, 30), id_number="CNI-0004", bank_name="Orabank",
                     bank_account="GN04 0004 0004", activity_account_id=transport_a.id,
                     lines=[("TRANSP", 500_000), ("PANIER", 300_000)])
drivers = []
for index, (name, hired) in enumerate([("Alpha Diallo", date(2022, 4, 1)), ("Mamady Keïta", date(2024, 1, 8)),
                                       ("Ousmane Bangoura", date(2025, 7, 1))], start=5):
    drivers.append(employee(groupe, name, job_title="Chauffeur poids lourd", department_id=transport_d.id,
                            manager_id=chef_parc.id, category="ouvrier", hire_date=hired, base_salary=3_200_000,
                            cnss_number=f"GN-CNSS-{index:04d}", gender="homme", id_number=f"CNI-{index:04d}",
                            payment_method="mobile", mobile_money=f"+224 620 00 00 0{index}",
                            activity_account_id=transport_a.id, lines=[("PANIER", 400_000)]))
conducteur = employee(groupe, "Aïssatou Bah", job_title="Conductrice de travaux", department_id=btp_d.id,
                      manager_id=dg.id, category="cadre", contract_type="cdd", hire_date=date(2026, 3, 1),
                      contract_end=TODAY + timedelta(days=20), base_salary=7_000_000, cnss_number="GN-CNSS-0008",
                      gender="femme", birth_date=date(1990, 4, 18), id_number="CNI-0008", bank_name="Ecobank",
                      bank_account="GN08 0008 0008", activity_account_id=btp_a.id, lines=[("TRANSP", 600_000)])
stagiaire = employee(groupe, "Kadiatou Soumah", job_title="Stagiaire comptable", department_id=finance_d.id,
                     manager_id=daf.id, contract_type="stage", hire_date=TODAY.replace(day=1) - relativedelta(months=1),
                     contract_end=TODAY + relativedelta(months=4), trial_end=TODAY + timedelta(days=10),
                     base_salary=1_500_000, gender="femme", payment_method="especes", activity_account_id=general_a.id)
recrue = employee(groupe, "Thierno Baldé", job_title="Mécanicien", department_id=transport_d.id, manager_id=chef_parc.id,
                  category="ouvrier", hire_date=TODAY - timedelta(days=40), trial_end=TODAY + timedelta(days=12),
                  base_salary=2_800_000, gender="homme", payment_method="virement")

# Documents à échéance (alertes de l'échéancier).
for emp, kind, label, expiry in [(drivers[0], "permis", "Permis C", TODAY + timedelta(days=18)),
                                 (drivers[1], "visite_medicale", "Visite médicale annuelle", TODAY - timedelta(days=5)),
                                 (dg, "passeport", "Passeport", TODAY + relativedelta(years=3))]:
    if not emp.document_ids.filtered(lambda d, label=label: d.name == label):
        env["eguitra.rh.document"].create({"employee_id": emp.id, "kind": kind, "name": label, "expiry_date": expiry})

# Habilitations, aptitude (statut seul) et EPI des chauffeurs, pour la matrice et le verrou V04 d'HSSEQ :
# Alpha Diallo à jour, Mamady Keïta avec la conduite défensive à renouveler et l'aptitude à revoir sous
# 7 jours, Ousmane Bangoura avec les matières dangereuses expirées (départ refusé).
Driver = env["eguitra.transport.driver"]
QualType = {t.code: t for t in env["eguitra.rh.qualification.type"].search([])}
for index, emp in enumerate(drivers):
    if not emp.driver_id:
        emp.driver_id = (Driver.search([("company_id", "=", groupe.id), ("name", "=", emp.name)], limit=1)
                         or Driver.create({"company_id": groupe.id, "name": emp.name}))
    if not emp.qualification_ids:
        echeances = {
            0: {"PERMIS": 900, "CONDUITE_DEFENSIVE": 400, "MATIERES_DANGEREUSES": 1200, "SECOURISME": 300},
            1: {"PERMIS": 700, "CONDUITE_DEFENSIVE": 20, "MATIERES_DANGEREUSES": 800},
            2: {"PERMIS": 1500, "CONDUITE_DEFENSIVE": 500, "MATIERES_DANGEREUSES": -12, "ACCES_SITE_MINIER": 60},
        }[index]
        for code, days in echeances.items():
            env["eguitra.rh.qualification"].create({
                "employee_id": emp.id, "type_id": QualType[code].id, "obtained_date": TODAY - relativedelta(years=2),
                "expiry_date": TODAY + timedelta(days=days), "reference": f"{code[:3]}-{emp.matricule}",
                "issuer": "Démonstration"})
    if not emp.medical_fitness:
        emp.write({"medical_fitness": "apte", "medical_fitness_date": TODAY - relativedelta(months=11),
                   "medical_fitness_until": TODAY + timedelta(days=(200, 6, 150)[index])})
    if not emp.ppe_issue_ids:
        for item in ("casque", "chaussures", "gilet"):
            env["eguitra.rh.ppe.issue"].create({"employee_id": emp.id, "item": item, "date": TODAY - relativedelta(months=4),
                                                "renewal_date": TODAY + relativedelta(months=8), "acknowledged": True})

# ─── MB AxisPro Consulting ─────────────────────────────────────────────────────────

cabinet_d = department(cabinet, "Conseil et accompagnement")
conseil_a = activity(cabinet, "Conseil et accompagnement de projets")
associe = employee(cabinet, "Nènè Kouyaté", job_title="Associée gérante", department_id=cabinet_d.id, category="cadre",
                   hire_date=date(2020, 1, 6), base_salary=12_000_000, cnss_number="GN-CNSS-0101", gender="femme",
                   birth_date=date(1984, 2, 9), id_number="CNI-0101", bank_name="Ecobank", bank_account="GN11 0101",
                   activity_account_id=conseil_a.id, lines=[("LOGT", 2_000_000), ("TRANSP", 800_000)])
consultant = employee(cabinet, "Moussa Doumbouya", job_title="Consultant", department_id=cabinet_d.id,
                      manager_id=associe.id, category="cadre", hire_date=date(2024, 10, 1), base_salary=6_500_000,
                      cnss_number="GN-CNSS-0102", gender="homme", id_number="CNI-0102", bank_name="Orabank",
                      bank_account="GN12 0102", activity_account_id=conseil_a.id, lines=[("TRANSP", 500_000)])

# ─── Comptes de test liés (Mon espace) ──────────────────────────────────

for login, emp in [("test.dg", dg), ("test.exploitation", chef_parc), ("test.parc", drivers[0]),
                   ("test.consultant", consultant), ("test.salarie", recrue)]:
    account = user(login)
    if account and not emp.user_id and not Employee.search([("user_id", "=", account.id),
                                                            ("company_id", "=", emp.company_id.id)]):
        emp.user_id = account

# ─── Absences, avance ───────────────────────────────────────────────────

Leave = env["eguitra.rh.leave"]


def leave(emp, code, start, end, state="approved"):
    if Leave.search_count([("employee_id", "=", emp.id), ("date_from", "=", start)]):
        return
    record = Leave.create({"employee_id": emp.id, "type_id": leave_type[code].id, "date_from": start, "date_to": end,
                           "note": "Démonstration"})
    if state == "approved":
        record.action_approve(force=True)


monday = TODAY - timedelta(days=TODAY.weekday())
leave(comptable, "CP", monday + timedelta(days=14), monday + timedelta(days=19))
leave(drivers[1], "MAL", TODAY - timedelta(days=1), TODAY + timedelta(days=2))
leave(drivers[0], "CP", monday + timedelta(days=21), monday + timedelta(days=26), state="submitted")
leave(conducteur, "PERM", monday + timedelta(days=8), monday + timedelta(days=8), state="submitted")
previous = TODAY.replace(day=1) - relativedelta(months=1)
leave(drivers[2], "ABSI", previous + timedelta(days=(7 - previous.weekday()) % 7 + 2),
      previous + timedelta(days=(7 - previous.weekday()) % 7 + 2))
# Accident du travail du mois précédent (taux de fréquence et de gravité d'HSSEQ).
leave(chef_parc, "AT", previous + timedelta(days=(7 - previous.weekday()) % 7 + 1),
      previous + timedelta(days=(7 - previous.weekday()) % 7 + 3))

if not env["eguitra.rh.advance"].search_count([("employee_id", "=", drivers[2].id)]):
    env["eguitra.rh.advance"].create({"employee_id": drivers[2].id, "kind": "avance", "amount": 1_200_000,
                                      "installment": 400_000, "first_month": previous, "note": "Avance (démo)"})

# ─── Paie du mois précédent, validée ────────────────────────────────────

# Quatre yeux : la RH prépare la paie, la direction la valide, jamais le compte qui l'a préparée. Donnée
# de démonstration : préparée par le compte d'administration de recette, validée (en sudo, sous son
# identité) par le compte de test de la direction ; sans lui, laissée en préparation.
validator = user("test.dg")
if validator == env.user:
    validator = None
Payroll = env["eguitra.rh.payroll"]
for company in (groupe, cabinet):
    if not Payroll.search_count([("company_id", "=", company.id), ("month", "=", previous)]):
        payroll = Payroll.with_company(company).prepare(company, previous)
        if validator:
            payroll.with_user(validator).sudo().action_validate()
        else:
            print(f"{payroll.name} ({company.name}) laissée en préparation : aucun second compte pour la valider.")

env.cr.commit()
print("Personnel de démonstration :", Employee.search_count([("name", "like", "(démo)")]), "salariés")
