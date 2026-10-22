# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Portail des porteurs, données de démonstration de la recette : contenus du centre de ressources
publiés, communications, événements et formations, rendez-vous, échanges avec pièce jointe, piste de
financement. Fictives, repérées « (démo) », jamais en production. À lancer après
donnees_demo_expert.py et comptes_test.py ; relancé, le script ne crée rien en double.

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \
      --log-level=warn < ../scripts/recette/portail_demo.py
"""

import base64
from datetime import datetime, time, timedelta

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Démonstration du portail : base de recette uniquement."

env = env(su=True, context=dict(env.context, tracking_disable=True))
cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
env = env(context=dict(env.context, allowed_company_ids=cabinet.ids))
consultant = (env["res.users"].search([("login", "=", "test.consultant")], limit=1)
              or env["res.users"].search([("login", "=", "recette.admin")], limit=1))
dossiers = env["axispro.dossier"].search([("company_id", "=", cabinet.id), ("portal_user_ids", "!=", False)])
assert dossiers, "Aucun dossier ouvert au portail : lancer d'abord donnees_demo_expert.py et comptes_test.py."
now = datetime.now().replace(second=0, microsecond=0)
today = now.date()


def at(days, hour, minute=0):
    """Date et heure de Conakry (UTC) dans `days` jours."""
    return datetime.combine(today + timedelta(days=days), time(hour, minute))


# Centre de ressources : les contenus proposés à l'installation, relus pour la démonstration.
drafts = env["portail.article"].search([("company_id", "=", cabinet.id), ("state", "=", "draft")])
drafts.write({"author_id": consultant.id})
drafts.action_publish()
modeles = env["portail.category"].search([("company_id", "=", cabinet.id), ("name", "=", "Business plan et prévisions")], limit=1)
if not env["portail.article"].search_count([("name", "=", "Modèle de plan de trésorerie sur 12 mois (démo)")]):
    article = env["portail.article"].create({
        "name": "Modèle de plan de trésorerie sur 12 mois (démo)", "kind": "modele", "category_id": modeles.id,
        "summary": "Un tableau à compléter mois par mois : encaissements, décaissements, solde.",
        "body": "Téléchargez le modèle, complétez vos **encaissements** et **décaissements** prévus, puis déposez-le "
                "dans vos pièces.\n\n> Votre consultant le reprend dans le modèle financier du dossier.",
        "gate_codes": "G1, G2", "tags": "trésorerie, modèle", "company_id": cabinet.id, "author_id": consultant.id,
    })
    attachment = env["ir.attachment"].create({
        "name": "plan-de-tresorerie.pdf", "mimetype": "application/pdf", "res_model": "portail.article",
        "res_id": article.id, "datas": base64.b64encode(b"%PDF-1.4\n% Modele de plan de tresorerie (demo)\n%%EOF\n"),
    })
    article.attachment_ids = [(4, attachment.id)]
    article.action_publish()

# Communications.
ANNONCES = [
    {"name": "Appel à projets agro-industrie : dépôt avant le 30 novembre (démo)", "kind": "opportunity", "pinned": True,
     "body": "Un fonds de développement finance des unités de **transformation agricole** de 200 à 800 millions de GNF.\n\n"
             "# Conditions\n- Société immatriculée en Guinée\n- Apport personnel d'au moins 20 %\n- Plan d'affaires sur cinq ans\n\n"
             "> Votre consultant vous aide à monter la candidature : écrivez-lui depuis la messagerie.",
     "audience": "sectors", "sector_keywords": "agro, mangue, transformation", "cta_url": "/portail/messages",
     "cta_label": "Écrire à mon consultant"},
    {"name": "Nouvelle liste des pièces à fournir pour l'étape G1 (démo)", "kind": "important", "require_ack": True,
     "body": "La liste des pièces de l'étape **Étude de faisabilité** évolue : les devis doivent dater de moins de trois mois.\n\n"
             "Merci de confirmer votre lecture.", "audience": "all"},
    {"name": "Le cabinet sera fermé le 1er novembre (démo)", "kind": "info",
     "body": "Les bureaux de MB AxisPro seront fermés. La messagerie du portail reste ouverte.", "audience": "all",
     "expire_date": today + timedelta(days=15)},
]
for values in ANNONCES:
    if not env["portail.announcement"].search_count([("name", "=", values["name"])]):
        announcement = env["portail.announcement"].create(dict(values, company_id=cabinet.id, author_id=consultant.id))
        announcement.action_publish()

# Événements et formations.
EVENEMENTS = [
    {"name": "Atelier : bâtir son plan de financement (démo)", "kind": "atelier", "start": at(6, 9), "end": at(6, 12),
     "location": "Locaux de MB AxisPro, Kaloum", "capacity": 12, "speaker": "Équipe financement du cabinet",
     "description": "# Au programme\n- Besoins et ressources\n- Apport, prêt, subvention : le bon dosage\n- Exercices sur vos chiffres\n\n"
                    "Apportez votre ordinateur et vos devis."},
    {"name": "Webinaire : comprendre le DSCR en 45 minutes (démo)", "kind": "webinaire", "start": at(10, 15),
     "end": at(10, 15, 45), "online_url": "https://meet.example.com/dscr-demo", "capacity": 0,
     "description": "Le ratio que regarde votre banquier, expliqué pas à pas, avec des exemples guinéens."},
    {"name": "Rencontre avec des financeurs (démo)", "kind": "rencontre", "start": at(21, 10), "end": at(21, 13),
     "location": "Hôtel de Conakry, salle Niger", "capacity": 2, "registration_deadline": at(18, 18),
     "description": "Cinq minutes pour présenter votre projet à trois établissements de crédit, puis échanges libres."},
    {"name": "Permanence du cabinet : vos questions (démo)", "kind": "permanence", "start": at(-12, 14), "end": at(-12, 17),
     "location": "Locaux de MB AxisPro, Kaloum", "description": "Venez sans rendez-vous avec vos questions."},
]
for values in EVENEMENTS:
    event = env["portail.event"].search([("name", "=", values["name"])], limit=1)
    if not event:
        event = env["portail.event"].create(dict(values, company_id=cabinet.id))
        if values["start"] > now:
            event.action_publish()
        else:
            event.state = "published"
            for user in dossiers.portal_user_ids[:2]:
                env["portail.event.registration"].create({"event_id": event.id, "user_id": user.id, "state": "attended"})

# Rendez-vous, échanges et financement, pour chaque dossier ouvert au portail.
for dossier in dossiers:
    porteur = dossier.portal_user_ids[:1]
    Meeting = env["portail.meeting"].with_context(allowed_company_ids=cabinet.ids)
    if not Meeting.search_count([("dossier_id", "=", dossier.id)]):
        Meeting.create({"dossier_id": dossier.id, "requested_by": consultant.id, "consultant_id": consultant.id,
                        "subject": "Revue des devis d'équipement (démo)", "mode": "office", "duration": 60,
                        "location": "Locaux de MB AxisPro, Kaloum"}).confirm(at(4, 10))
        done = Meeting.create({"dossier_id": dossier.id, "requested_by": porteur.id, "consultant_id": consultant.id,
                               "subject": "Lancement de l'accompagnement (démo)", "mode": "video", "duration": 45,
                               "slot_1": at(-5, 10)})
        done.confirm(at(-5, 10), online_url="https://meet.example.com/lancement-demo")
        done.mark_done("# Points retenus\n- Calendrier de constitution du dossier validé\n- Pièces juridiques à déposer sous quinze jours\n\n"
                       "> Prochain point : revue des devis.")
        Meeting.create({"dossier_id": dossier.id, "requested_by": porteur.id, "consultant_id": consultant.id,
                        "subject": "Question sur le différé de remboursement (démo)", "mode": "phone",
                        "agenda": "Durée du différé possible pour la phase de construction.",
                        "slot_1": at(3, 11), "slot_2": at(5, 15)})
    if not dossier.message_ids.filtered(lambda m: "(démo)" in (m.body or "")):
        Message = env["axispro.message"]
        Message.create({"dossier_id": dossier.id, "author_id": consultant.id, "date": now - timedelta(days=3),
                        "body": "Bonjour, j'ai relu votre plan d'affaires : il manque les devis des équipements. Pouvez-vous les déposer ? (démo)"})
        Message.create({"dossier_id": dossier.id, "author_id": porteur.id, "date": now - timedelta(days=2),
                        "body": "Bonjour, je les demande aux fournisseurs et je vous les envoie cette semaine. (démo)"})
        Message.create({"dossier_id": dossier.id, "author_id": consultant.id, "date": now - timedelta(hours=5),
                        "body": "Parfait. Je vous ai aussi inscrit à l'atelier sur le plan de financement. (démo)"})
    if not dossier.funding_ids:
        funder = env["res.partner"].search([("name", "=", "Banque de démonstration (démo)")], limit=1) or \
            env["res.partner"].create({"name": "Banque de démonstration (démo)", "is_company": True})
        env["axispro.funding"].create({"dossier_id": dossier.id, "funder_id": funder.id, "instrument": "bank_loan",
                                       "amount_requested": dossier.financing_need or 250_000_000, "state": "review",
                                       "next_step": "Comité de crédit de la banque", "next_date": today + timedelta(days=14)})

env.cr.commit()
print(f"Portail : {len(dossiers)} dossier(s) ouvert(s) au portail, "
      f"{env['portail.article'].search_count([('state', '=', 'published')])} contenus publiés, "
      f"{env['portail.announcement'].search_count([])} communications, {env['portail.event'].search_count([])} événements.")
