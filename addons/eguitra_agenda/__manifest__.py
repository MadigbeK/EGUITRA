{
    "name": "EGUITRA - Agenda",
    "summary": "Agenda professionnel des comptes internes (NIMOVA · Agenda) : agendas personnels, d'équipe et de "
               "ressources (salles, véhicules, équipements), séries et exceptions, invitations avec fichier iCalendar, "
               "partage à trois niveaux, délégation (l'assistante), disponibilités et recherche de créneau, absence du "
               "bureau, rappels et récapitulatif du matin, échéances des autres modules, lien d'abonnement, import et "
               "export iCalendar, prise de rendez-vous en ligne (désactivée par défaut)",
    "version": "19.0.1.0.0",
    "category": "Productivity",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_api", "mail"],
    "data": [
        "security/ir.model.access.csv",
        "security/agenda_rules.xml",
        "data/agenda_data.xml",
        "data/cron.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
