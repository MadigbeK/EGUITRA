"""Calendrier ouvré du service client (delais.py), sans base."""

from datetime import date, datetime

from odoo.tests import TransactionCase, tagged

from .. import delais as d


def at(*args):
    return datetime(*args)


@tagged("post_install", "-at_install")
class TestDelais(TransactionCase):
    def test_heures_ouvrees_par_dessus_le_week_end(self):
        # Vendredi 30 octobre 2026, 16 h, plus 2 heures ouvrées (8 h à 17 h) : lundi 2 novembre, 9 h.
        self.assertEqual(d.add_business_hours(at(2026, 10, 30, 16), 2), at(2026, 11, 2, 9))
        self.assertEqual(d.business_hours(at(2026, 10, 30, 16), at(2026, 11, 2, 9)), 2.0)

    def test_arrivee_hors_des_heures(self):
        self.assertEqual(d.add_business_hours(at(2026, 10, 31, 10), 1), at(2026, 11, 2, 9), "Samedi : lundi à l'ouverture")
        self.assertEqual(d.add_business_hours(at(2026, 11, 2, 6, 30), 1), at(2026, 11, 2, 9), "Avant l'ouverture")
        self.assertEqual(d.add_business_hours(at(2026, 11, 2, 19), 1), at(2026, 11, 3, 9), "Après la fermeture")

    def test_echeance_a_la_fermeture_et_journees_entieres(self):
        self.assertEqual(d.add_business_hours(at(2026, 11, 2, 8), 9), at(2026, 11, 2, 17), "Pile à la fermeture")
        self.assertEqual(d.add_business_hours(at(2026, 11, 2, 8), 40), at(2026, 11, 6, 12), "Quatre jours et quatre heures")

    def test_heures_reglables_et_jours_feries(self):
        self.assertEqual(d.add_business_hours(at(2026, 11, 2, 7, 30), 1, open_at=7.5, close_at=16.0),
                         at(2026, 11, 2, 8, 30))
        feries = frozenset({date(2026, 11, 2)})
        self.assertEqual(d.add_business_hours(at(2026, 11, 2, 9), 1, holidays=feries), at(2026, 11, 3, 9))
        self.assertEqual(d.business_hours(at(2026, 11, 2, 8), at(2026, 11, 3, 17), holidays=feries), 9.0)

    def test_controle_des_heures(self):
        self.assertEqual(d.check_hours(8, 17.5), (8.0, 17.5))
        for start, end in ((17, 8), (8, 8.5), (-1, 10), (8, 25), ("x", 10)):
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                d.check_hours(start, end)

    def test_delai_le_plus_court_de_la_priorite_et_de_la_categorie(self):
        self.assertEqual(d.target_hours(8, 2), 2.0)
        self.assertEqual(d.target_hours(4, 16), 4.0)
        self.assertEqual(d.target_hours(8, 0), 8.0, "Catégorie sans délai propre")
        self.assertIsNone(d.target_hours(0, 0))
