# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Comptes de test de la recette : un compte par métier, pour les utilisateurs réels d'EGUITRA GROUP
et de MB AxisPro qui testent la plateforme et font leurs retours. Recette seulement.

Chaque compte reçoit les profils et les sociétés de son métier (deux sociétés distinctes : un
profil métier d'EGUITRA n'est ouvert qu'à EGUITRA GROUP, le cabinet qu'à MB AxisPro),
un mot de passe provisoire à remplacer à la première connexion et la double authentification à
activer sur le téléphone du testeur. Un compte = une personne (le téléphone qui reçoit les codes).

Lancement sur le serveur, depuis infra/ (les mots de passe ne sortent que dans le fichier protégé) :

  umask 077; docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette \
      --no-http --log-level=warn < ../scripts/recette/comptes_test.py > secrets/comptes-test.log
  grep '^COMPTE' secrets/comptes-test.log >> secrets/comptes-test-recette.tsv; grep '^RESUME' secrets/comptes-test.log
  rm secrets/comptes-test.log

Relancé, le script garde les comptes existants (mot de passe et double authentification) ; avec
COMPTES_TEST_REINITIALISER=test.dg,test.daf (ou « tous »), il leur redonne un mot de passe
provisoire et remet leur double authentification à zéro.
"""

import os
import secrets
import string

from odoo import Command

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Comptes de test : base de recette uniquement."

Company = env["res.company"].sudo()
SOCIETES = {
    "groupe": Company.search([("eguitra_entity", "=", "groupe")], limit=1),
    "cabinet": Company.search([("eguitra_entity", "=", "cabinet")], limit=1),
}
assert all(SOCIETES.values()), "Sociétés de la plateforme introuvables."

# identifiant, nom affiché, profils, sociétés (la première est la société par défaut), métier testé
COMPTES = [
    ("test.dg", "Test - Direction générale", ["direction"], ["groupe", "cabinet"]),
    ("test.daf", "Test - Responsable financier", ["finance"], ["groupe", "cabinet"]),
    ("test.comptable", "Test - Comptable", ["finance"], ["groupe", "cabinet"]),
    ("test.exploitation", "Test - Responsable exploitation transport", ["exploitation"], ["groupe"]),
    ("test.parc", "Test - Agent de parc", ["exploitation"], ["groupe"]),
    ("test.chantiers", "Test - Conducteur de travaux", ["chantiers"], ["groupe"]),
    ("test.immobilier", "Test - Gestionnaire immobilier", ["immobilier"], ["groupe"]),
    ("test.consultant", "Test - Consultant du cabinet", ["cabinet"], ["cabinet"]),
    ("test.admin", "Test - Administrateur", ["admin"], ["groupe", "cabinet"]),
    ("test.porteur", "Test - Porteur de projet", ["porteur"], ["cabinet"]),
]
# Le porteur de test suit le second dossier de démonstration (le premier a déjà porteur.demo).
DOSSIER_PORTEUR = "Unité de séchage de mangues (démo)"

reinit = {x.strip() for x in os.environ.get("COMPTES_TEST_REINITIALISER", "").split(",") if x.strip()}
ALPHABET = "".join(c for c in string.ascii_letters + string.digits if c not in "Il1O0o")


def mot_de_passe():
    return "Test-" + "".join(secrets.choice(ALPHABET) for _ in range(12))


Users = env["res.users"].sudo().with_context(no_reset_password=True, active_test=False)
Token = env["eguitra.api.token"].sudo()
for login, nom, profils, entites in COMPTES:
    societes = Company.browse([SOCIETES[e].id for e in entites])
    user = Users.search([("login", "=", login)], limit=1)
    nouveau = not user
    password = None
    if nouveau:
        password = mot_de_passe()
        user = Users.create({
            "name": nom, "login": login, "password": password, "eguitra_password_temporary": True,
            "company_id": societes[0].id, "company_ids": [Command.set(societes.ids)], "lang": "fr_FR",
            "tz": "Africa/Conakry",
        })
    else:
        user.write({"name": nom, "active": True, "company_id": societes[0].id,
                    "company_ids": [Command.set(societes.ids)]})
        if login in reinit or "tous" in reinit:
            password = mot_de_passe()
            user.write({"password": password, "eguitra_password_temporary": True})
            user.totp_secret = False
            Token._revoke_user(user)
    user._eguitra_set_profiles(profils)
    if profils == ["porteur"]:
        dossier = env["axispro.dossier"].sudo().search([("name", "=", DOSSIER_PORTEUR)], limit=1)
        if dossier:
            dossier.portal_user_ids = [Command.link(user.id)]
    if password:
        print(f"COMPTE\t{login}\t{password}\t{nom}")
    print(f"RESUME\t{login}\t{'créé' if nouveau else ('réinitialisé' if password else 'inchangé')}\t"
          f"profils={','.join(user._eguitra_profiles())}\tapplications={','.join(user._eguitra_apps())}\t"
          f"sociétés={', '.join(user.company_ids.mapped('name'))}")

env.cr.commit()
