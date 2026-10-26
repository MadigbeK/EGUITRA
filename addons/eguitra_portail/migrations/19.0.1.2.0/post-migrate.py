"""19.0.1.2.0 : liste d'attente dans l'ordre d'attente.

Les inscriptions déjà en liste d'attente prennent pour date « en attente depuis » celle de leur
inscription : leur ordre ne change pas (l'ancien code promouvait dans l'ordre des inscriptions).

Passage unique : sans effet si on le rejoue (seuls les champs encore vides sont remplis)."""


def migrate(cr, version):
    cr.execute("""
        UPDATE portail_event_registration
           SET waitlist_since = create_date
         WHERE state = 'waitlist' AND waitlist_since IS NULL
    """)
