from odoo.tests import tagged

from .common import AgendaCase


@tagged("post_install", "-at_install")
class TestPhotos(AgendaCase):
    """Photos des comptes dans l'agenda : chaque personne citée (propriétaire d'un agenda, délégations,
    organisateur, participants internes, annuaire) porte la version de sa photo ; None sans vraie photo
    (avatar dessiné du noyau) et pour un participant externe."""

    def version(self, user):
        status, me = self.call("GET", "/auth/me", token=self.token(user))
        self.assertEqual(status, 200, me)
        return me["avatar"]

    def test_photos_dans_l_agenda(self):
        self.set_photo(self.dana)
        self.set_photo(self.alice, color=(150, 60, 20))
        dana, alice = self.version(self.dana), self.version(self.alice)
        self.assertTrue(dana and alice)
        self.assertNotEqual(dana, alice)

        d = self.ok("POST", "/agenda/delegations", self.dana, {"delegate_id": self.awa.id})
        self.assertEqual((d["owner"]["avatar"], d["delegate"]["avatar"]), (dana, None))
        me = self.ok("GET", "/agenda/me", self.awa)
        self.assertEqual(me["user"]["avatar"], None)
        row = next(c for c in me["calendars"] if c["id"] == self.personal(self.dana).id)
        self.assertEqual(row["owner"]["avatar"], dana, "Agenda du mandant : sa photo")
        self.assertEqual(me["delegations_received"][0]["owner"]["avatar"], dana)
        self.assertEqual(self.ok("GET", "/agenda/me", self.dana)["user"]["avatar"], dana)

        ev = self.create(self.dana, "Point photo", attendees=[
            {"user_id": self.alice.id}, {"user_id": self.bruno.id},
            {"email": "conseil@cabinet-externe.gn", "name": "Conseil externe"}])["event"]
        self.assertEqual(ev["organizer"]["avatar"], dana)
        attendees = {a["name"]: a["avatar"] for a in ev["attendees"]}
        self.assertEqual((attendees[self.alice.name], attendees[self.bruno.name], attendees["Conseil externe"]),
                         (alice, None, None))
        detail = self.ok("GET", f"/agenda/events/{ev['id']}", self.alice)
        self.assertEqual(detail["organizer"]["avatar"], dana)
        self.assertEqual({a["name"]: a["avatar"] for a in detail["attendees"]}, attendees)

        found = self.ok("GET", "/agenda/users?q=dana.agenda", self.alice)
        self.assertEqual([(u["id"], u["avatar"]) for u in found], [(self.dana.id, dana)])
        response = self.url_open(f"/api/v1/users/{self.dana.id}/avatar", timeout=60,
                                 headers={"Authorization": f"Bearer {self.token(self.alice)}", "X-Eguitra-App": "test"})
        self.assertEqual(response.status_code, 200)

    def test_pas_de_photo_hors_des_societes_communes(self):
        if not self.cabinet:
            self.skipTest("Société du cabinet absente de la base de test")
        self.set_photo(self.consultant)
        # Le consultant (cabinet seul) n'est pas proposé à Alice ; Dana (deux sociétés) voit sa photo.
        found = self.ok("GET", "/agenda/users?q=consultant.agenda", self.dana)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0]["avatar"])
        ev = self.create(self.dana, "Revue croisée", attendees=[{"user_id": self.consultant.id},
                                                               {"user_id": self.alice.id}])["event"]
        detail = self.ok("GET", f"/agenda/events/{ev['id']}", self.alice)
        consultant = next(a for a in detail["attendees"] if a["user_id"] == self.consultant.id)
        self.assertIsNone(consultant["avatar"], "Aucune société commune avec Alice : pas de photo")
