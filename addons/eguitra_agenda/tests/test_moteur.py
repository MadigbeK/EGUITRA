"""Moteur de l'agenda (moteur.py), sans base : règles de récurrence, fuseaux, créneaux, iCalendar."""

import time
from datetime import date, datetime, timedelta

from odoo.tests import TransactionCase, tagged

from .. import moteur as m

PARIS = "Europe/Paris"


def at(*args):
    return datetime(*args)


@tagged("post_install", "-at_install")
class TestMoteurRecurrence(TransactionCase):
    def test_hebdomadaire_certains_jours_et_libelle(self):
        start = at(2026, 11, 2, 9, 0)  # lundi
        rule = m.build_rrule({"freq": "weekly", "days": ["WE", "MO"], "end": "count", "count": 6}, start)
        self.assertEqual(rule, "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6")
        found = m.occurrences(start, start + timedelta(hours=1), rule, m.DEFAULT_TZ, at(2026, 11, 1), at(2027, 1, 1))
        self.assertEqual(found, [at(2026, 11, 2, 9), at(2026, 11, 4, 9), at(2026, 11, 9, 9), at(2026, 11, 11, 9),
                                 at(2026, 11, 16, 9), at(2026, 11, 18, 9)])
        self.assertEqual(m.rrule_label(rule), "Chaque semaine le lundi et mercredi, 6 fois")
        self.assertEqual(m.parse_rrule(rule)["days"], ["MO", "WE"])

    def test_mensuelle_par_rang_deuxieme_mardi(self):
        start = at(2026, 11, 10, 14, 0)  # 2e mardi de novembre 2026
        rule = m.build_rrule({"freq": "monthly", "monthly": "rank", "end": "until", "until": "2027-01-31"}, start)
        self.assertEqual(rule, "FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270131T235959")
        found = m.occurrences(start, start + timedelta(hours=2), rule, m.DEFAULT_TZ, at(2026, 1, 1), at(2028, 1, 1))
        self.assertEqual(found, [at(2026, 11, 10, 14), at(2026, 12, 8, 14), at(2027, 1, 12, 14)])
        self.assertEqual(m.rrule_label(rule), "Chaque mois, le 2e mardi, jusqu'au 31/01/2027")
        spec = m.parse_rrule(rule)
        self.assertEqual((spec["monthly"], spec["rank"], spec["rank_day"], spec["end"]), ("rank", 2, "TU", "until"))

    def test_mensuelle_dernier_vendredi_et_par_date(self):
        start = at(2026, 10, 30, 8, 0)
        last = m.build_rrule({"freq": "monthly", "monthly": "rank", "rank": -1, "rank_day": "FR", "end": "count",
                              "count": 3}, start)
        self.assertEqual(m.first_occurrences(start, last, m.DEFAULT_TZ, 5),
                         [at(2026, 10, 30, 8), at(2026, 11, 27, 8), at(2026, 12, 25, 8)])
        start = at(2027, 1, 31, 8, 0)
        by_date = m.build_rrule({"freq": "monthly", "monthly": "date", "end": "count", "count": 3}, start)
        self.assertEqual(by_date, "FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3")
        self.assertEqual(m.first_occurrences(start, by_date, m.DEFAULT_TZ, 3),
                         [at(2027, 1, 31, 8), at(2027, 3, 31, 8), at(2027, 5, 31, 8)],
                         "Les mois sans 31 sont sautés, comme le veut la norme")

    def test_quotidienne_annuelle_intervalle(self):
        start = at(2026, 12, 24, 10, 0)
        daily = m.build_rrule({"freq": "daily", "interval": 2, "end": "count", "count": 3}, start)
        self.assertEqual(m.first_occurrences(start, daily, m.DEFAULT_TZ, 9),
                         [at(2026, 12, 24, 10), at(2026, 12, 26, 10), at(2026, 12, 28, 10)])
        yearly = m.build_rrule({"freq": "yearly", "end": "never"}, start)
        self.assertEqual(yearly, "FREQ=YEARLY;BYMONTHDAY=24;BYMONTH=12")
        self.assertEqual(m.first_occurrences(start, yearly, m.DEFAULT_TZ, 2), [at(2026, 12, 24, 10), at(2027, 12, 24, 10)])
        self.assertEqual(m.rrule_label(yearly), "Chaque année, le 24 décembre")
        self.assertIsNone(m.last_occurrence(start, yearly, m.DEFAULT_TZ), "Une série sans fin n'a pas de dernière occurrence")

    def test_heure_murale_gardee_avec_l_heure_d_ete(self):
        # Paris passe à l'heure d'hiver le 25 octobre 2026 : 9 h reste 9 h, l'instant UTC change.
        start = m.to_utc(at(2026, 10, 19, 9, 0), PARIS)
        self.assertEqual(start, at(2026, 10, 19, 7, 0))
        rule = m.build_rrule({"freq": "weekly", "end": "count", "count": 2}, m.to_local(start, PARIS))
        self.assertEqual(m.first_occurrences(start, rule, PARIS, 2), [at(2026, 10, 19, 7), at(2026, 10, 26, 8)])
        self.assertIsNone(m.fixed_offset(PARIS))
        self.assertEqual(m.fixed_offset(m.DEFAULT_TZ), 0, "Conakry : UTC+0 toute l'année")

    def test_coupure_d_une_serie(self):
        start = at(2026, 11, 2, 9, 0)
        rule = "FREQ=WEEKLY;BYDAY=MO;COUNT=10"
        split = at(2026, 11, 23, 9, 0)  # 4e occurrence
        self.assertEqual(m.count_before(start, rule, m.DEFAULT_TZ, split), 3)
        self.assertTrue(m.is_occurrence(start, rule, m.DEFAULT_TZ, split))
        self.assertFalse(m.is_occurrence(start, rule, m.DEFAULT_TZ, split + timedelta(hours=1)))
        head = m.with_until(rule, m.to_local(split, m.DEFAULT_TZ) - timedelta(seconds=1))
        self.assertEqual(head, "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261123T085959")
        self.assertEqual(len(m.first_occurrences(start, head, m.DEFAULT_TZ, 20)), 3)
        self.assertEqual(m.with_count(head, 7), "FREQ=WEEKLY;BYDAY=MO;COUNT=7")
        self.assertEqual(m.last_occurrence(start, rule, m.DEFAULT_TZ), at(2027, 1, 4, 9))

    def test_regles_refusees(self):
        start = at(2026, 11, 2, 9, 0)
        for spec in ({"freq": "hourly"}, {"freq": "weekly", "interval": 0}, {"freq": "daily", "end": "count", "count": 5000},
                     {"freq": "daily", "end": "until", "until": "2026-10-01"},
                     {"freq": "monthly", "monthly": "rank", "rank": 5, "rank_day": "MO"}):
            with self.assertRaises(m.RuleError, msg=str(spec)):
                m.build_rrule(spec, start)
        for text in ("FREQ=SECONDLY", "FREQ=DAILY;COUNT=3;UNTIL=20261231T000000", "FREQ=DAILY;BYHOUR=3",
                     "FREQ=DAILY;UNTIL=20261231T000000Z"):
            with self.assertRaises(m.RuleError, msg=text):
                m.check_rrule(text)
        self.assertEqual(m.normalize_rrule("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T090000Z;WKST=MO", PARIS),
                         "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T100000")

    def test_regles_pathologiques_refusees_vite(self):
        """Une règle qui ne tomberait jamais (le 31 février, un 6e lundi) ferait tourner le calcul jusqu'à
        l'an 9999 : elle est refusée avant toute itération ; une règle admise reste bornée (vingt ans)."""
        debut = time.monotonic()
        for text in ("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31", "FREQ=YEARLY;BYMONTH=2,4;BYMONTHDAY=31",
                     "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=6", "FREQ=MONTHLY;BYDAY=6MO", "FREQ=DAILY;BYMONTH=2;BYMONTHDAY=31",
                     "FREQ=WEEKLY;BYDAY=2MO", "FREQ=MONTHLY;BYMONTHDAY=13;BYDAY=FR", "FREQ=MONTHLY;BYMONTHDAY=32"):
            with self.assertRaises(m.RuleError, msg=text):
                m.check_rrule(text)
        with self.assertRaises(m.RuleError):
            m.build_rrule({"freq": "yearly", "monthly": "date", "month_day": 31, "month": 2}, at(2026, 11, 2, 9))
        start = at(2026, 11, 2, 9)
        self.assertEqual(m.occurrences(start, start + timedelta(hours=1), "FREQ=DAILY", m.DEFAULT_TZ,
                                       at(9000, 1, 1), at(9000, 2, 1)), [], "Au-delà de l'horizon, rien")
        self.assertFalse(m.is_occurrence(start, "FREQ=DAILY", m.DEFAULT_TZ, at(9000, 1, 1, 9)))
        self.assertIsNone(m.last_occurrence(start, "FREQ=DAILY;UNTIL=20991231T235959", m.DEFAULT_TZ),
                          "Fin au-delà de l'horizon : traitée comme sans fin")
        self.assertLess(time.monotonic() - debut, 2, "Refus et calculs rapides")
        self.assertEqual(m.check_rrule("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2"), "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2")
        self.assertEqual(m.first_occurrences(at(2026, 11, 1, 9), "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2", m.DEFAULT_TZ, 1),
                         [at(2026, 11, 10, 9)])
        text = "\r\n".join(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:fev@ex", "DTSTART:20270210T090000Z",
                            "DTEND:20270210T100000Z", "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31", "SUMMARY:Impossible",
                            "END:VEVENT", "END:VCALENDAR"])
        ev = m.parse_ics(text)[0]
        self.assertEqual((ev["rrule"], ev["rrule_dropped"]), (None, True), "Importé une fois, règle écartée")


@tagged("post_install", "-at_install")
class TestMoteurCreneaux(TransactionCase):
    def setUp(self):
        super().setUp()
        self.work = m.check_work_hours({"0": [["08:00", "12:00"], ["13:00", "17:00"]], "1": [["08:00", "17:00"]],
                                        "2": [["08:00", "17:00"]], "3": [["08:00", "17:00"]], "4": [["08:00", "17:00"]]})

    def test_heures_de_travail(self):
        self.assertEqual(self.work["0"], [[480, 720], [780, 1020]])
        monday = at(2026, 11, 2)
        self.assertTrue(m.within_work(self.work, m.DEFAULT_TZ, monday.replace(hour=8), monday.replace(hour=9)))
        self.assertFalse(m.within_work(self.work, m.DEFAULT_TZ, monday.replace(hour=11, minute=30),
                                       monday.replace(hour=12, minute=30)), "La pause de midi coupe la plage")
        self.assertFalse(m.within_work(self.work, m.DEFAULT_TZ, at(2026, 11, 7, 9), at(2026, 11, 7, 10)), "Samedi")
        self.assertTrue(m.within_work(None, m.DEFAULT_TZ, at(2026, 11, 7, 3), at(2026, 11, 7, 4)))
        for bad in ({"7": [["08:00", "09:00"]]}, {"0": [["10:00", "09:00"]]}, {"0": [["08:00", "12:00"], ["11:00", "13:00"]]},
                    {"0": [["8h61", "12:00"]]}):
            with self.assertRaises(m.RuleError, msg=str(bad)):
                m.check_work_hours(bad)
        self.assertEqual(m.DEFAULT_WORK_HOURS["0"], [[480, 1020]], "Défaut : 8 h 00 à 17 h 00")

    def test_creneau_commun_heures_tampon_et_classement(self):
        monday = at(2026, 11, 2)
        alice = {"key": "alice", "work": self.work, "tz": m.DEFAULT_TZ,
                 "busy": [(monday.replace(hour=8), monday.replace(hour=10))]}
        bruno = {"key": "bruno", "work": self.work, "tz": m.DEFAULT_TZ,
                 "busy": [(monday.replace(hour=10, minute=30), monday.replace(hour=11))]}
        carla = {"key": "carla", "work": self.work, "tz": m.DEFAULT_TZ,
                 "busy": [(monday.replace(hour=13), monday.replace(hour=17))]}
        slots = m.find_slots(monday, monday + timedelta(days=1), timedelta(hours=1), [alice, bruno], [carla])
        # 10 h 00 - 11 h 00 heurte Bruno ; 11 h 00 - 12 h 00 convient à tous, Carla comprise.
        self.assertEqual(slots[0]["start"], monday.replace(hour=11))
        self.assertEqual(slots[0]["optional_free"], ["carla"])
        self.assertTrue(all(s["start"].hour >= 13 for s in slots[1:]), "Puis l'après-midi, sans Carla")
        self.assertFalse([s for s in slots if s["start"] < monday.replace(hour=8)], "Hors des heures de travail")
        # Avec 30 minutes de tampon, 11 h 00 est trop près de la fin de Bruno (11 h 00) et 11 h 30 déborde sur
        # la pause : le premier créneau est 13 h 00, sans Carla.
        padded = m.find_slots(monday, monday + timedelta(days=1), timedelta(hours=1), [alice, bruno], [carla], buffer=30)
        self.assertEqual(padded[0]["start"], monday.replace(hour=13))
        self.assertEqual(padded[0]["optional_free"], [])
        self.assertNotIn(monday.replace(hour=11), [s["start"] for s in padded])
        # Les propositions ne se chevauchent pas.
        for a, b in zip(slots, slots[1:]):
            self.assertFalse(a["start"] < b["stop"] and b["start"] < a["stop"])

    def test_creneau_avec_un_fuseau_different_et_maintenant(self):
        monday = at(2026, 11, 2)
        conakry = {"key": "c", "work": self.work, "tz": m.DEFAULT_TZ, "busy": []}
        paris = {"key": "p", "work": self.work, "tz": PARIS, "busy": []}  # 8 h à Paris = 7 h UTC en novembre
        slots = m.find_slots(monday, monday + timedelta(days=1), timedelta(hours=1), [conakry, paris], limit=50)
        self.assertEqual(slots[0]["start"], monday.replace(hour=8))
        self.assertTrue(all(s["stop"] <= monday.replace(hour=16) for s in slots), "17 h à Paris = 16 h à Conakry")
        later = m.find_slots(monday, monday + timedelta(days=1), timedelta(hours=1), [conakry], now=monday.replace(hour=9, minute=7))
        self.assertEqual(later[0]["start"], monday.replace(hour=9, minute=15), "Jamais dans le passé, au quart d'heure")

    def test_creneau_libre_le_plus_proche(self):
        day = at(2026, 11, 3)
        busy = [(day.replace(hour=9), day.replace(hour=11)), (day.replace(hour=11), day.replace(hour=12))]
        hour = timedelta(hours=1)
        self.assertEqual(m.nearest_free(busy, day.replace(hour=9, minute=30), hour), day.replace(hour=8))
        self.assertEqual(m.nearest_free(busy, day.replace(hour=11, minute=30), hour), day.replace(hour=12))
        self.assertEqual(m.nearest_free(busy, day.replace(hour=10), hour), day.replace(hour=12),
                         "À égale distance, le plus tard : on ne revient pas en arrière")
        self.assertEqual(m.nearest_free(busy, day.replace(hour=9, minute=30), hour, now=day.replace(hour=8, minute=30)),
                         day.replace(hour=12), "Pas de créneau dans le passé")
        self.assertEqual(m.nearest_free(busy, day.replace(hour=7), hour, work=self.work), day.replace(hour=8),
                         "Dans les heures de travail")
        self.assertEqual(m.merge([(day.replace(hour=9), day.replace(hour=11)), (day.replace(hour=10), day.replace(hour=12))]),
                         [(day.replace(hour=9), day.replace(hour=12))])


@tagged("post_install", "-at_install")
class TestMoteurIcs(TransactionCase):
    def test_aller_retour_d_une_serie_avec_exception(self):
        start = at(2026, 11, 2, 9, 0)
        event = {
            "uid": "a1@nimova", "sequence": 2, "summary": "Point hebdomadaire ; finance, achats", "location": "Salle A",
            "description": "Ordre du jour :\n1. Trésorerie", "url": "https://meet.example.org/abc", "start": start,
            "stop": start + timedelta(minutes=45), "tz": m.DEFAULT_TZ, "rrule": "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T235959",
            "exdates": [at(2026, 11, 16, 9)], "privacy": "private", "show_as": "busy",
            "organizer": {"name": "Alice Camara", "email": "alice@exemple.gn"},
            "attendees": [{"name": "Bruno, Diallo", "email": "bruno@exemple.gn", "state": "accepted", "required": False}],
        }
        text = m.ics_calendar([event], method="REQUEST")
        self.assertTrue(all(len(line.encode()) <= 75 for line in text.split("\r\n")), "Lignes pliées à 75 octets")
        text = text.replace("\r\n ", "")
        self.assertIn("METHOD:REQUEST", text)
        self.assertIn("BEGIN:VTIMEZONE", text)
        self.assertIn("DTSTART;TZID=Africa/Conakry:20261102T090000", text)
        self.assertIn("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T235959Z", text)
        self.assertIn("SUMMARY:Point hebdomadaire \\; finance\\, achats", text)
        self.assertIn('ATTENDEE;CN="Bruno, Diallo";ROLE=OPT-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:bruno@exemple.gn', text)
        back = m.parse_ics(m.ics_calendar([event], method="REQUEST"))
        self.assertEqual(len(back), 1)
        ev = back[0]
        self.assertEqual((ev["start"], ev["stop"], ev["summary"], ev["location"]),
                         (start, start + timedelta(minutes=45), event["summary"], "Salle A"))
        self.assertEqual(ev["rrule"], "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T235959")
        self.assertEqual(ev["exdates"], [at(2026, 11, 16, 9)])
        self.assertEqual((ev["privacy"], ev["url"], ev["uid"]), ("private", "https://meet.example.org/abc", "a1@nimova"))
        self.assertEqual(ev["attendees"][0]["state"], "accepted")
        self.assertFalse(ev["attendees"][0]["required"])
        self.assertIn("Trésorerie", ev["description"])

    def test_lecture_d_un_fichier_d_un_autre_agenda(self):
        text = "\r\n".join([
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Exemple//FR",
            "BEGIN:VEVENT", "UID:jour@ex", "DTSTART;VALUE=DATE:20261225", "DTEND;VALUE=DATE:20261227",
            "SUMMARY:Congés de fin d'année", "END:VEVENT",
            "BEGIN:VEVENT", "UID:paris@ex", "DTSTART;TZID=Europe/Paris:20261105T100000", "DURATION:PT1H30M",
            "SUMMARY:Visio avec le fournisseur", "DESCRIPTION:Ligne 1\\nLigne 2 avec un très long texte qui doit être",
            " replié sur plusieurs lignes", "BEGIN:VALARM", "ACTION:DISPLAY", "SUMMARY:Ne pas lire", "END:VALARM",
            "END:VEVENT",
            "BEGIN:VEVENT", "UID:annule@ex", "DTSTART:20261110T090000Z", "DTEND:20261110T100000Z", "STATUS:CANCELLED",
            "SUMMARY:Annulé", "END:VEVENT",
            "BEGIN:VTODO", "SUMMARY:Tâche", "END:VTODO",
            "END:VCALENDAR",
        ])
        events = m.parse_ics(text.encode())
        self.assertEqual([e["uid"] for e in events], ["jour@ex", "paris@ex"], "Annulés et tâches ignorés")
        allday = events[0]
        self.assertTrue(allday["allday"])
        self.assertEqual((allday["start_date"], allday["end_date"]), (date(2026, 12, 25), date(2026, 12, 26)))
        visio = events[1]
        self.assertEqual((visio["start"], visio["stop"]), (at(2026, 11, 5, 9, 0), at(2026, 11, 5, 10, 30)))
        self.assertEqual(visio["summary"], "Visio avec le fournisseur", "Le résumé de l'alarme n'écrase pas l'événement")
        self.assertEqual(visio["description"], "Ligne 1\nLigne 2 avec un très long texte qui doit êtrereplié sur plusieurs lignes")
        with self.assertRaises(m.RuleError):
            m.parse_ics(b"pas un agenda")

    def test_echappement_et_pliage(self):
        self.assertEqual(m.ics_unescape(m.ics_escape("a;b,c\\d\ne")), "a;b,c\\d\ne")
        long = "DESCRIPTION:" + "é" * 80
        folded = m.fold(long)
        self.assertTrue(all(len(part.encode()) <= 75 for part in folded.split("\r\n")))
        self.assertEqual(folded.replace("\r\n ", ""), long)
