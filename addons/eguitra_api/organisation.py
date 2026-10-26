"""Organisation de la plateforme : deux sociétés distinctes, des applications, des profils.

EGUITRA GROUP SARLU (entité « groupe ») et MB AxisPro Consulting (entité « cabinet ») sont deux
entreprises différentes du même groupe : même direction générale, mêmes locaux, métiers distincts.
Le département finance tient leurs deux comptabilités, séparément, dans la même base.

- EGUITRA Finance sert les deux sociétés : la société de travail se choisit à l'écran, la vue
  consolidée est réservée à la direction et à la finance. Ses modules métier (chantiers, immobilier)
  ne concernent qu'EGUITRA GROUP.
- Transport (NIMOVA · Transport, décision du gérant du 22 octobre 2026) est une application à part
  entière, comme Finance et AxisPro Suite : flotte, rotations, rentabilité, propriétaires des
  ensembles gérés ; elle ne sert qu'EGUITRA GROUP.
- AxisPro Suite et le portail des porteurs de projets ne servent que MB AxisPro Consulting.
- Rotations (saisie mobile des rotations) ne sert qu'EGUITRA GROUP.
- Analyse (NIMOVA · Analyse) sert les deux sociétés, avec des analyses propres à chacune : celles du
  groupe sous /analyse/groupe/, celles du cabinet sous /analyse/cabinet/.

Un compte reçoit des profils (eguitra_base, PROFILE_GROUPS) et des sociétés ; ses applications en
découlent : un profil peut tout ouvrir (administration, direction) ou une seule application.

Une nouvelle application s'inscrit dans APPS (et dans apps/web/lib/config.ts) ; un nouveau module
réservé à une société, dans MODULE_ENTITY ; un nouveau profil propre à une société, dans
PROFILE_ENTITY.
"""

ENTITY_NAMES = {"groupe": "EGUITRA GROUP SARLU", "cabinet": "MB AxisPro Consulting"}

# Application -> profils qui l'ouvrent et société servie (None : les deux sociétés).
APPS = {
    # Achats : pièces d'achat, engagements de dépense et fournisseurs, dans l'une ou l'autre société.
    "finance": {"profiles": {"admin", "direction", "finance", "achats", "exploitation", "chantiers", "immobilier"},
                "entity": None},
    "axispro": {"profiles": {"admin", "direction", "cabinet", "associe"}, "entity": "cabinet"},
    "portail": {"profiles": {"porteur"}, "entity": "cabinet"},
    "mobile": {"profiles": {"admin", "exploitation"}, "entity": "groupe"},
    "transport": {"profiles": {"admin", "direction", "finance", "exploitation"}, "entity": "groupe"},
    "analyse": {"profiles": {"admin", "direction", "finance", "cabinet", "associe"}, "entity": None},
    # RH (NIMOVA · RH) : personnel, absences et paie, gestion commune aux deux sociétés. Un compte lié
    # à un dossier salarié l'ouvre aussi, réduite à « Mon espace » (eguitra_rh, res.users._eguitra_apps).
    # model : l'application n'existe que là où son module est installé (la production peut recevoir le
    # code sans l'installer).
    "rh": {"profiles": {"admin", "direction", "rh"}, "entity": None, "model": "eguitra.rh.employee"},
}

# Préfixe des routes de l'API -> société servie par le module : ses routes refusent de travailler
# dans l'autre société, quelle que soit l'application qui les appelle.
MODULE_ENTITY = {
    "/transport/": "groupe",
    "/chantiers": "groupe",
    "/immobilier/": "groupe",
    "/axispro/": "cabinet",
    "/portail/": "cabinet",
    "/analyse/groupe/": "groupe",
    "/analyse/cabinet/": "cabinet",
}

# Profil propre à une société : un compte qui le porte doit être ouvert à cette société.
PROFILE_ENTITY = {
    "exploitation": "groupe",
    "chantiers": "groupe",
    "immobilier": "groupe",
    "cabinet": "cabinet",
    "associe": "cabinet",
    "porteur": "cabinet",
}


# Application dont la session n'ouvre que certaines routes (méthode, route déclarée) : la session de
# Rotations, jusqu'à 90 jours sur un téléphone du parc, ne sert qu'à la saisie des rotations et au
# compte (profil, mot de passe). Elle n'ouvre ni Transport (rentabilité, tarifs) ni Finance dans le même
# navigateur : il faut s'y connecter.
SESSION_ROUTES = {
    "mobile": {
        "name": "Rotations",
        "routes": frozenset({
            ("GET", "/auth/me"),
            ("POST", "/auth/password"),
            ("GET", "/transport/referentials"),
            ("GET", "/transport/rotations"),
            ("POST", "/transport/sync"),
        }),
    },
}


def module_entity(route):
    return next((entity for prefix, entity in MODULE_ENTITY.items() if route.startswith(prefix)), None)


def _que(nom):
    """« que » élidé devant une voyelle : « qu'EGUITRA GROUP », « que MB AxisPro Consulting »."""
    return "qu'" if nom[:1].upper() in "AEIOUYÉÈÊÀÂÎÔÛ" else "que "


def wrong_company_message(entity):
    nom = ENTITY_NAMES[entity]
    return (f"Ce module ne concerne {_que(nom)}{nom} : choisissez cette société en haut de l'écran, "
            "ou ouvrez l'application qui la sert.")
