"""19.0.1.3.0 : marque « second facteur passé » des lignées de jetons (audit du noyau, I-A4).

Une session ouverte pendant la suspension de la double authentification (paramètre
eguitra_api.mfa_required à 0, le cas de la production et de la recette depuis le 21 octobre 2026)
lui survivait : jusqu'à 7 jours, 90 pour Rotations, sans code. Désormais chaque lignée porte
mfa_passed, et une lignée qui ne le porte pas est refusée (appel et renouvellement) dès que le
paramètre revient à 1.

Les jetons déjà émis ne disent pas si leur connexion a passé le code : ils sont marqués « non passé ».
Tant que le paramètre vaut 0, rien ne change ; à son rétablissement, chacun se reconnecte une fois,
avec son code, comme le veut l'offre (chapitre 5.3).
"""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("UPDATE eguitra_api_token SET mfa_passed = FALSE WHERE mfa_passed IS NULL")
    _logger.info("eguitra_api 19.0.1.3.0 : jetons existants marqués sans second facteur : %s", cr.rowcount)
