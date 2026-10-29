# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration du service client (eguitra_service_client), pour la base de recette : fictives, repérées
par « (démo) », adresses en .invalid (aucun courriel ne peut partir vers elles), jamais en production.

Pour que le cahier 12 se joue :
- tiers fictifs : « Démo - Transports Kaloum (client) » et « Démo - Résidence Les Palmiers (locataire) » pour
  EGUITRA GROUP SARLU, « Démo - Coopérative de Kindia (client du cabinet) » pour MB AxisPro Consulting ;
- une équipe « Exploitation (démo) » (test.exploitation, test.parc) ;
- une dizaine de dossiers à divers états et sur tous les canaux : téléphone, visite, courrier, courriel simulé
  (traité par la relève, sans réseau : expéditeur non vérifié), WhatsApp simulé (fenêtre de 24 heures fermée),
  espace client (test.client, test.client.cabinet), un dossier en retard escaladé, un dossier résolu noté 4 sur 5,
  un dossier rouvert, un dossier clos ;
- les accusés de réception et demandes de satisfaction automatiques sont suspendus pendant le chargement (rien ne
  part), puis remis comme avant.

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \\
      < ../scripts/recette/donnees_demo_service_client.py

Lancer d'abord scripts/recette/comptes_test.py (comptes test.serviceclient, test.client, test.client.cabinet).
Relancé, le script ne crée rien en double (dossiers repérés par leur objet).
"""

from datetime import timedelta

from odoo import Command, fields

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Données de démonstration du service client : base de recette uniquement."
assert "eguitra.sc.ticket" in env, "Module eguitra_service_client non installé."

env = env(context=dict(env.context, tracking_disable=True))
Users = env["res.users"].sudo()
Company = env["res.company"].sudo()
groupe = Company.search([("eguitra_entity", "=", "groupe")], limit=1)
cabinet = Company.search([("eguitra_entity", "=", "cabinet")], limit=1)
(groupe | cabinet)._eguitra_sc_setup()
Ticket = env["eguitra.sc.ticket"].sudo()
report = []


def user(login):
    found = Users.search([("login", "=", login)], limit=1)
    return found


agent = user("test.serviceclient") or user("recette.admin")
assert agent, "Lancer d'abord scripts/recette/comptes_test.py."


def partner(name, company, **values):
    found = env["res.partner"].sudo().search([("name", "=", name)], limit=1)
    return found or env["res.partner"].sudo().create(dict({"name": name, "is_company": True, "customer_rank": 1,
                                                            "company_id": company.id}, **values))


kaloum = partner("Démo - Transports Kaloum (client)", groupe, phone="+224 620 00 00 01",
                 email="achats@transports-kaloum.invalid")
palmiers = partner("Démo - Résidence Les Palmiers (locataire)", groupe, phone="+224 620 00 00 03",
                   email="gestion@palmiers.invalid")
kindia = partner("Démo - Coopérative de Kindia (client du cabinet)", cabinet, email="bureau@coop-kindia.invalid")
for login, tiers in (("test.client", kaloum), ("test.client.cabinet", kindia)):
    compte = user(login)
    if compte and tiers not in compte.eguitra_sc_partner_ids:
        compte.write({"eguitra_sc_partner_ids": [Command.link(tiers.id)]})

Team = env["eguitra.sc.team"].sudo()
membres = user("test.exploitation") | user("test.parc")
equipe = Team.search([("name", "=", "Exploitation (démo)"), ("company_id", "=", groupe.id)], limit=1) or Team.create({
    "name": "Exploitation (démo)", "company_id": groupe.id, "member_ids": [Command.set(membres.ids)],
    "leader_id": user("test.exploitation").id or False})

# Rien ne part pendant le chargement : accusés et satisfaction suspendus, remis ensuite comme avant.
Settings = env["eguitra.sc.settings"]
gardes = {}
for company in (groupe, cabinet):
    s = Settings._get(company)
    gardes[company.id] = (s.ack_enabled, s.satisfaction_enabled)
    s.write({"ack_enabled": False, "satisfaction_enabled": False})
eg = Settings._get(groupe)
if not eg.mail_address:
    eg.write({"mail_address": "service.client@eguitra-demo.invalid"})


def category(company, code):
    return env["eguitra.sc.category"].sudo().search([("company_id", "=", company.id), ("code", "=", code)], limit=1)


def ticket(subject, company=groupe, **values):
    found = Ticket.search([("subject", "=", subject), ("company_id", "=", company.id)], limit=1)
    if found:
        return found, False
    created = Ticket.create(dict({"subject": subject, "company_id": company.id}, **values))
    report.append(f"{created.name} : {subject}")
    return created, True


def as_agent(record, who=None):
    return record.with_user(who or agent)


# 1. Téléphone : manquant sur une livraison, confié à l'exploitation, réponse donnée, en cours.
t, new = ticket("Manquant de 1 500 litres à la livraison de Kamsar (démo)", channel="phone", partner_id=kaloum.id,
                contact_name="M. Bangoura (achats)", contact_phone="+224 620 00 00 01", kind="complaint",
                category_id=category(groupe, "produit").id, priority="high",
                description="Le client signale 1 500 litres manquants sur la rotation du 27 octobre (démo).")
if new:
    as_agent(t).assign(user("test.exploitation") or None, equipe)
    as_agent(t).reply("Nous vérifions le bon de livraison et la jauge au départ ; nous vous rappelons avant midi.")
    as_agent(t).post_note("Comparer le ticket de pesée du dépôt et celui du client (démo).")

# 2. Courriel simulé (relève sans réseau) : facture contestée, expéditeur non vérifié (aucune authentification).
raw = (
    "From: Service achats <achats@transports-kaloum.invalid>\r\nTo: service.client@eguitra-demo.invalid\r\n"
    "Subject: Facture EG24138 contestée (démo)\r\nMessage-ID: <demo-facture-1@transports-kaloum.invalid>\r\n"
    "Date: Mon, 26 Oct 2026 09:30:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n"
    "Bonjour, la facture EG24138 compte deux rotations que nous n'avons pas commandées (démo).\r\n"
).encode()
if not Ticket.search_count([("subject", "=", "Facture EG24138 contestée (démo)")]):
    outcome, mail_ticket = env["eguitra.sc.mail.gateway"].sudo()._process(groupe, raw)
    if mail_ticket:
        mail_ticket.write({"category_id": category(groupe, "facturation").id, "kind": "complaint"})
        report.append(f"{mail_ticket.name} : courriel simulé ({outcome}, expéditeur non vérifié)")

# 3. WhatsApp simulé : numéro inconnu, fenêtre de 24 heures fermée (le modèle approuvé serait exigé).
t, new = ticket("Retard de livraison à Boké (démo)", channel="whatsapp", contact_name="Mamadou (chauffeur client)",
                contact_phone="+224 621 00 00 02", sender_unverified=True, category_id=category(groupe, "retard").id,
                kind="complaint")
if new:
    t.client_message("Bonjour, le camion devait arriver hier à Boké, toujours rien (démo).", "whatsapp",
                     author_name="Mamadou", unverified=True, notify=False,
                     external={"wa_message_id": "wamid.demo.boke.1"})
    t.write({"wa_last_inbound": fields.Datetime.now() - timedelta(hours=30)})

# 4. Espace client : demande de test.client.
client = user("test.client")
t, new = ticket("Relevé de compte d'octobre (démo)", channel="portal", partner_id=kaloum.id,
                contact_name=client.name if client else "Client", category_id=category(groupe, "facturation").id,
                description="Pouvez-vous nous envoyer le relevé de compte arrêté au 31 octobre (démo) ?")
if new:
    if client:
        t.write({"client_user_id": client.id})
    t.client_message(t.description, "portal", user=client or None, notify=False)

# 5. Visite : fuite d'eau d'un locataire, en attente du client.
t, new = ticket("Fuite d'eau dans l'appartement B2 (démo)", channel="visit", partner_id=palmiers.id,
                contact_name="Mme Soumah", category_id=category(groupe, "loyer").id, priority="high")
if new:
    as_agent(t).assign(user("test.immobilier") or None)
    as_agent(t).reply("Le plombier passe jeudi matin ; merci de confirmer votre présence.")
    as_agent(t).set_state("waiting")

# 6. En retard : urgent, ouvert il y a trois jours ouvrés, sans réponse ; escalade jouée.
t, new = ticket("Camion immobilisé chargé à Coyah (démo)", channel="phone", partner_id=kaloum.id,
                contact_name="M. Bangoura (achats)", priority="urgent", kind="complaint",
                category_id=category(groupe, "livraison").id, user_id=agent.id)
if new:
    t.write({"date_open": fields.Datetime.now() - timedelta(days=5)})
    t._compute_deadlines()
    Ticket._cron_escalate()

# 7. Résolu et noté 4 sur 5.
t, new = ticket("Attestation de livraison pour la douane (démo)", channel="phone", partner_id=kaloum.id,
                contact_name="M. Bangoura (achats)", kind="request", category_id=category(groupe, "livraison").id)
if new:
    as_agent(t).reply("L'attestation est prête, à retirer à l'accueil.")
    as_agent(t).set_state("resolved")
    t.record_satisfaction(4, "Réponse rapide (démo).", channel="phone")

# 8. Rouvert : résolu, puis le client répond.
t, new = ticket("Location d'un camion-benne pour le chantier de Dubréka (démo)", channel="letter",
                partner_id=kaloum.id, contact_name="M. Bangoura (achats)", category_id=category(groupe, "location").id)
if new:
    as_agent(t).reply("Devis envoyé par courrier le 26 octobre (démo).")
    as_agent(t).set_state("resolved")
    t.client_message("Le devis ne mentionne pas le chauffeur : est-il compris ? (démo)", "letter",
                     author_name="M. Bangoura")

# 9. Clos : information donnée par téléphone.
t, new = ticket("Changement d'adresse de facturation (démo)", channel="phone", partner_id=palmiers.id,
                contact_name="Mme Soumah", kind="information", category_id=category(groupe, "autre").id)
if new:
    as_agent(t).reply("Adresse notée ; elle figurera sur les prochaines factures.")
    as_agent(t).set_state("closed")

# 10. MB AxisPro Consulting : demande de l'espace client, confiée au consultant.
client_cabinet = user("test.client.cabinet")
t, new = ticket("Date de remise du rapport d'évaluation (démo)", company=cabinet, channel="portal",
                partner_id=kindia.id, contact_name=client_cabinet.name if client_cabinet else "Client",
                category_id=category(cabinet, "cabinet").id)
if new:
    if client_cabinet:
        t.write({"client_user_id": client_cabinet.id})
    t.client_message("Quand recevrons-nous le rapport d'évaluation de notre projet ? (démo)", "portal",
                     user=client_cabinet or None, notify=False)
    consultant = user("test.consultant")
    if consultant:
        as_agent(t).assign(consultant)

# 11. MB AxisPro Consulting : facture d'honoraires, nouveau dossier saisi au téléphone.
ticket("Facture d'honoraires à scinder en deux échéances (démo)", company=cabinet, channel="phone",
       partner_id=kindia.id, contact_name="Mme Camara (trésorière)", category_id=category(cabinet, "facturation").id)

for company in (groupe, cabinet):
    ack, satisfaction = gardes[company.id]
    Settings._get(company).write({"ack_enabled": ack, "satisfaction_enabled": satisfaction})

env.cr.commit()
print("Service client (démo) :", len(report), "élément(s) créé(s)")
for line in report:
    print(" -", line)
