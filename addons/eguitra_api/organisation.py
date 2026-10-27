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
# actions : pour une route qui porte son action dans l'adresse (<string:action>), les seules actions
# ouvertes à la session.
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
    # NIMOVA Terrain (application native, sessions longues sur les téléphones de service et la tablette du
    # dépôt ; apps/terrain) : les formulaires de terrain d'HSSEQ, la saisie des rotations, le départ en
    # route et le compte. Ni Finance, ni Transport au-delà, ni l'administration, ni la configuration
    # d'HSSEQ : il faut se connecter à l'application voulue. Les routes d'un module non installé ne
    # gênent pas : elles n'existent simplement pas.
    "terrain": {
        "name": "NIMOVA Terrain",
        "routes": frozenset({
            ("GET", "/auth/me"),
            ("POST", "/auth/password"),
            # Rotations, comme l'application web de Rotations, et le départ en route du chef de parc.
            ("GET", "/transport/referentials"),
            ("GET", "/transport/rotations"),
            ("POST", "/transport/sync"),
            ("POST", "/transport/rotations/<int:rotation_id>/<string:action>"),
            # HSSEQ : référentiels et grilles en cache, départs du jour et verrou, fiches de terrain,
            # photos, levée, dérogation, documents à lire, annuaire de crise, espace du conducteur.
            ("GET", "/hsseq/referentials"),
            ("GET", "/hsseq/checks/templates"),
            ("GET", "/hsseq/me"),
            ("GET", "/hsseq/me/rotations"),
            ("POST", "/hsseq/lock/evaluate"),
            ("GET", "/hsseq/checks"),
            ("GET", "/hsseq/checks/<int:check_id>"),
            ("POST", "/hsseq/checks"),
            ("POST", "/hsseq/checks/<int:check_id>/complement"),
            ("POST", "/hsseq/checks/<int:check_id>/lift"),
            ("GET", "/hsseq/checks/nonconformities"),
            ("POST", "/hsseq/breath-tests"),
            ("POST", "/hsseq/events"),
            ("POST", "/hsseq/attachments"),
            ("GET", "/hsseq/attachments/<int:attachment_id>/download"),
            ("POST", "/hsseq/waivers"),
            ("GET", "/hsseq/my/documents"),
            ("POST", "/hsseq/procedures/<int:procedure_id>/acknowledge"),
            ("POST", "/hsseq/bulletins/<int:bulletin_id>/acknowledge"),
            ("GET", "/hsseq/my/crisis-contacts"),
        }),
        # Sur une rotation, le seul passage en route : la validation, l'annulation et la remise en
        # brouillon restent au bureau.
        "actions": {
            ("POST", "/transport/rotations/<int:rotation_id>/<string:action>"): frozenset({"depart"}),
        },
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
