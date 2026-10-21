"""Organisation de la plateforme : deux sociétés distinctes, des applications, des profils.

EGUITRA GROUP SARLU (entité « groupe ») et MB AxisPro (entité « cabinet ») sont deux
entreprises différentes du même groupe : même direction générale, mêmes locaux, métiers distincts.
Le département finance tient leurs deux comptabilités, séparément, dans la même base.

- EGUITRA Finance sert les deux sociétés : la société de travail se choisit à l'écran, la vue
  consolidée est réservée à la direction et à la finance. Ses modules métier (transport, chantiers,
  immobilier) ne concernent qu'EGUITRA GROUP.
- AxisPro Suite et le portail des porteurs de projets ne servent que MB AxisPro.
- Rotations (saisie mobile des rotations) ne sert qu'EGUITRA GROUP.
- Analyse (NIMOVA · Analyse) sert les deux sociétés, avec des analyses propres à chacune : celles du
  groupe sous /analyse/groupe/, celles du cabinet sous /analyse/cabinet/.

Un compte reçoit des profils (eguitra_base, PROFILE_GROUPS) et des sociétés ; ses applications en
découlent : un profil peut tout ouvrir (administration, direction) ou une seule application.

Une nouvelle application s'inscrit dans APPS (et dans apps/web/lib/config.ts) ; un nouveau module
réservé à une société, dans MODULE_ENTITY ; un nouveau profil propre à une société, dans
PROFILE_ENTITY.
"""

ENTITY_NAMES = {"groupe": "EGUITRA GROUP SARLU", "cabinet": "MB AxisPro"}

# Application -> profils qui l'ouvrent et société servie (None : les deux sociétés).
APPS = {
    "finance": {"profiles": {"admin", "direction", "finance", "exploitation", "chantiers", "immobilier"}, "entity": None},
    "axispro": {"profiles": {"admin", "direction", "cabinet"}, "entity": "cabinet"},
    "portail": {"profiles": {"porteur"}, "entity": "cabinet"},
    "mobile": {"profiles": {"admin", "exploitation"}, "entity": "groupe"},
    "analyse": {"profiles": {"admin", "direction", "finance", "cabinet"}, "entity": None},
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
    "porteur": "cabinet",
}


def module_entity(route):
    return next((entity for prefix, entity in MODULE_ENTITY.items() if route.startswith(prefix)), None)


def wrong_company_message(entity):
    return (f"Ce module ne concerne que {ENTITY_NAMES[entity]} : choisissez cette société dans la colonne "
            "de gauche, ou ouvrez l'application qui la sert.")
