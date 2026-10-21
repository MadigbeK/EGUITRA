# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Mot de passe commun à tous les comptes de la recette, que personne ne modifie (décision du gérant,
21 octobre 2026 : un seul mot de passe à remettre aux testeurs). Recette seulement.

Chaque compte actif (sauf les comptes techniques du noyau) reçoit le même mot de passe, sans
changement imposé à la première connexion ; les sessions ouvertes sont fermées. Le paramètre
eguitra_api.shared_password = 1 fait refuser ensuite tout changement de mot de passe, par
l'utilisateur comme par un administrateur (403 password_locked) ; les comptes créés ensuite par
l'administration gardent le mot de passe saisi à la création.

Lancement sur le serveur, depuis infra/ (le mot de passe ne sort que dans le fichier protégé ;
MOT_DE_PASSE=... pour le choisir, sinon il est tiré au hasard) :

  umask 077; docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette \
      --no-http --log-level=warn < ../scripts/recette/mot_de_passe_commun.py > secrets/recette-mot-de-passe-commun.txt
  grep -v '^MOT_DE_PASSE' secrets/recette-mot-de-passe-commun.txt

Retour aux mots de passe individuels : paramètre eguitra_api.shared_password à 0, puis redonner un
mot de passe provisoire à chaque compte (scripts/recette/comptes_test.py, COMPTES_TEST_REINITIALISER).
"""

import os
import secrets
import string

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Mot de passe commun : base de recette uniquement."

ALPHABET = "".join(c for c in string.ascii_letters + string.digits if c not in "Il1O0o")
password = os.environ.get("MOT_DE_PASSE") or "Recette-Nimova-" + "".join(secrets.choice(ALPHABET) for _ in range(6))

techniques = [env.ref(xmlid, raise_if_not_found=False) for xmlid in ("base.user_root", "base.user_admin", "base.public_user")]
Users = env["res.users"].sudo().with_context(no_reset_password=True)
comptes = Users.search([("active", "=", True), ("id", "not in", [u.id for u in techniques if u])])
comptes.write({"password": password, "eguitra_password_temporary": False})
Token = env["eguitra.api.token"].sudo()
for user in comptes:
    Token._revoke_user(user)
env["ir.config_parameter"].sudo().set_param("eguitra_api.shared_password", "1")
env.cr.commit()

print(f"MOT_DE_PASSE\t{password}")
print(f"COMPTES\t{len(comptes)}\t{', '.join(sorted(comptes.mapped('login')))}")
