from odoo.tests import tagged

from .common import AgendaCase, z


@tagged("post_install", "-at_install")
class TestDelegation(AgendaCase):
    """Délégation (l'assistante) : créer, modifier, supprimer et répondre au nom de son mandant, marquage
    « par X pour le compte de Y », journal et piste d'audit, invitations reçues, événements privés selon le
    droit, retrait à tout moment, délégation posée par la direction ou l'administration pour un dirigeant."""

    def delegate(self, owner, delegate, **options):
        return self.ok("POST", "/agenda/delegations", owner, dict({"delegate_id": delegate.id}, **options))

    def test_l_assistante_gere_l_agenda_de_son_mandant(self):
        d = self.delegate(self.dana, self.awa, receive_invitations=True)
        self.assertEqual((d["owner"]["id"], d["delegate"]["id"], d["see_private"]), (self.dana.id, self.awa.id, False))
        me = self.ok("GET", "/agenda/me", self.awa)
        dana_cal = self.personal(self.dana)
        row = next(c for c in me["calendars"] if c["id"] == dana_cal.id)
        self.assertEqual((row["level"], row["can_write"]), ("manage", True))
        self.assertTrue(self.env["eguitra.agenda.notification"].sudo().search(
            [("user_id", "=", self.awa.id), ("kind", "=", "delegation")]))

        # Création pour le compte du mandant, visible et journalisée.
        ev = self.ok("POST", "/agenda/events", self.awa, {
            "calendar_id": dana_cal.id, "name": "Rendez-vous banque", "start": z(self.at(1, 10)),
            "stop": z(self.at(1, 11)), "attendees": [{"user_id": self.alice.id}]})["event"]
        self.assertEqual((ev["organizer"]["id"], ev["created_by"], ev["created_on_behalf"]),
                         (self.dana.id, self.awa.name, self.dana.name), "Par Awa pour le compte de Dana")
        self.assertEqual([r["title"] for r in self.events(self.dana, [dana_cal])], ["Rendez-vous banque"])
        invitation = self.env["eguitra.agenda.notification"].sudo().search([("user_id", "=", self.alice.id),
                                                                           ("kind", "=", "invitation")])
        self.assertIn(self.dana.name, invitation.title, "L'invitation vient du mandant")
        body = self.ok("PATCH", f"/agenda/events/{ev['id']}", self.awa, {"location": "Siège de la banque"})
        self.assertEqual((body["event"]["modified_by"], body["event"]["modified_on_behalf"]), (self.awa.name, self.dana.name))
        journal = self.ok("GET", f"/agenda/journal?calendar_id={dana_cal.id}", self.awa)
        actions = [(j["action"], j["by"], j["on_behalf"]) for j in journal]
        self.assertIn(("event_create", self.awa.name, self.dana.name), actions)
        self.assertIn(("event_update", self.awa.name, self.dana.name), actions)
        self.assertEqual(self.ok("GET", "/agenda/journal", self.dana)[0]["by"], self.awa.name,
                         "Le mandant lit le journal de son agenda")
        status, _b = self.call("GET", f"/agenda/journal?calendar_id={dana_cal.id}", token=self.token(self.alice))
        self.assertEqual(status, 404)
        # Piste d'audit : l'auteur réel (le délégué) et le compte pour lequel il agit, sans le contenu.
        logs = self.env["auditlog.log"].sudo().search([("model_id.model", "=", "eguitra.agenda.event"),
                                                        ("res_id", "=", ev["id"])])
        self.assertTrue(logs, "Création et modification journalisées")
        self.assertEqual(set(logs.mapped("user_id").ids), {self.awa.id})
        lines = logs.mapped("line_ids")
        self.assertIn("on_behalf_of_id", lines.mapped("field_id.name"))
        if "fields_to_exclude_ids" in self.env["auditlog.rule"]._fields:
            self.assertFalse(lines.filtered(lambda l: l.field_id.name in ("name", "location", "description")),
                             "Ni le titre, ni le lieu, ni la description dans la piste d'audit")
        self.ok("DELETE", f"/agenda/events/{ev['id']}", self.awa)
        self.assertIn("event_delete", [j["action"] for j in self.ok("GET", "/agenda/journal", self.dana)])

    def test_repondre_et_recevoir_les_invitations(self):
        self.delegate(self.dana, self.awa, receive_invitations=True)
        ev = self.create(self.alice, "Conseil d'administration", day=2, attendees=[{"user_id": self.dana.id}])["event"]
        copies = self.env["eguitra.agenda.notification"].sudo().search([("user_id", "=", self.awa.id),
                                                                       ("kind", "=", "invitation")])
        self.assertEqual(len(copies), 1, "La déléguée reçoit aussi l'invitation")
        self.assertIn(self.dana.name, copies.title)
        detail = self.ok("GET", f"/agenda/events/{ev['id']}", self.awa)
        self.assertEqual([r["user_id"] for r in detail["respond_for"]], [self.dana.id])
        detail = self.ok("POST", f"/agenda/events/{ev['id']}/respond", self.awa,
                         {"state": "accepted", "for_user_id": self.dana.id, "comment": "Mme la DG sera présente"})
        line = next(a for a in detail["attendees"] if a["user_id"] == self.dana.id)
        self.assertEqual((line["state"], line["responded_by"]), ("accepted", self.awa.name))
        notice = self.env["eguitra.agenda.notification"].sudo().search([("user_id", "=", self.alice.id),
                                                                       ("kind", "=", "response")])
        self.assertIn("pour son compte", notice.body)
        status, _b = self.call("POST", f"/agenda/events/{ev['id']}/respond",
                               {"state": "declined", "for_user_id": self.dana.id}, token=self.token(self.bruno))
        self.assertIn(status, (403, 404), "Seul le délégué répond au nom du mandant")
        # Sans l'option, pas de copie des invitations.
        self.ok("PATCH", f"/agenda/delegations/{self.delegation_id(self.dana, self.awa)}", self.dana,
                {"receive_invitations": False})
        self.create(self.alice, "Second conseil", day=3, attendees=[{"user_id": self.dana.id}])
        self.assertEqual(self.env["eguitra.agenda.notification"].sudo().search_count(
            [("user_id", "=", self.awa.id), ("kind", "=", "invitation")]), 1)

    def delegation_id(self, owner, delegate):
        return self.env["eguitra.agenda.delegation"].sudo().search(
            [("owner_id", "=", owner.id), ("delegate_id", "=", delegate.id)]).id

    def test_evenements_prives_selon_le_droit(self):
        dana_cal = self.personal(self.dana)
        private = self.create(self.dana, "Consultation médicale", day=1, privacy="private")["event"]
        self.delegate(self.dana, self.awa)
        rows = self.events(self.awa, [dana_cal])
        self.assertEqual([(r["title"], r["masked"]) for r in rows], [("Occupé", True)])
        status, _b = self.call("PATCH", f"/agenda/events/{private['id']}", {"name": "Modifié"}, token=self.token(self.awa))
        self.assertEqual(status, 403, "Ni modification d'un événement privé sans le droit")
        status, _b = self.call("POST", "/agenda/events", {"calendar_id": dana_cal.id, "name": "Privé", "privacy": "private",
                                                          "start": z(self.at(2, 9)), "stop": z(self.at(2, 10))},
                               token=self.token(self.awa))
        self.assertEqual(status, 403, "Ni création d'un événement privé")
        self.ok("PATCH", f"/agenda/delegations/{self.delegation_id(self.dana, self.awa)}", self.dana, {"see_private": True})
        rows = self.events(self.awa, [dana_cal])
        self.assertEqual([(r["title"], r["masked"]) for r in rows], [("Consultation médicale", False)])
        self.env.invalidate_all()
        self.assertTrue(self.env["eguitra.agenda.event"].with_user(self.awa).search([("id", "=", private["id"])]),
                        "Règle du noyau : le délégué autorisé lit l'événement privé")
        self.ok("PATCH", f"/agenda/events/{private['id']}", self.awa, {"location": "Clinique Ambroise Paré"})

    def test_retrait_a_tout_moment(self):
        d = self.delegate(self.dana, self.awa)
        dana_cal = self.personal(self.dana)
        self.create(self.dana, "Point du lundi")
        self.assertTrue(self.events(self.awa, [dana_cal]))
        status, _b = self.call("PATCH", f"/agenda/delegations/{d['id']}", {"see_private": True}, token=self.token(self.awa))
        self.assertEqual(status, 403, "La déléguée ne s'accorde pas plus de droits")
        self.ok("DELETE", f"/agenda/delegations/{d['id']}", self.dana)
        self.assertEqual(self.events(self.awa, [dana_cal]), [], "Retirée, la délégation ne donne plus rien")
        self.assertTrue(self.env["eguitra.agenda.notification"].sudo().search(
            [("user_id", "=", self.awa.id), ("title", "ilike", "ne gérez plus")]))
        d = self.delegate(self.dana, self.awa)
        self.ok("DELETE", f"/agenda/delegations/{d['id']}", self.awa)
        self.assertFalse(self.env["eguitra.agenda.delegation"].sudo().search([("owner_id", "=", self.dana.id)]),
                         "La déléguée peut y renoncer")
        status, body = self.call("POST", "/agenda/delegations", {"delegate_id": self.alice.id}, token=self.token(self.alice))
        self.assertEqual(status, 422, "On ne se délègue pas son propre agenda")
        if self.cabinet:
            status, body = self.call("POST", "/agenda/delegations", {"delegate_id": self.consultant.id},
                                     token=self.token(self.alice))
            self.assertEqual(status, 403, "Aucune société partagée")

    def test_posee_par_l_administration_pour_un_dirigeant(self):
        body = self.ok("POST", "/agenda/delegations", self.admin, {
            "owner_id": self.dana.id, "delegate_id": self.awa.id, "reason": "Assistante de direction"})
        self.assertEqual((body["owner"]["id"], body["granted_by"]["id"], body["reason"]),
                         (self.dana.id, self.admin.id, "Assistante de direction"))
        notice = self.env["eguitra.agenda.notification"].sudo().search([("user_id", "=", self.dana.id),
                                                                       ("kind", "=", "delegation")])
        self.assertIn(self.admin.name, notice.title, "Le dirigeant est prévenu de qui a posé la délégation")
        journal = self.env["eguitra.agenda.journal"].sudo().search([("calendar_id", "=", self.personal(self.dana).id),
                                                                    ("action", "=", "delegation_add")])
        self.assertEqual(journal.user_id, self.admin)
        self.assertTrue(self.env["auditlog.log"].sudo().search([("model_id.model", "=", "eguitra.agenda.delegation"),
                                                                ("user_id", "=", self.admin.id)]),
                        "Inscrite dans la piste d'audit")
        executives = self.ok("GET", "/agenda/admin/executives", self.admin)
        row = next(e for e in executives if e["id"] == self.dana.id)
        self.assertEqual([d["delegate"]["id"] for d in row["delegations"]], [self.awa.id])
        # L'administration ne lit pas pour autant l'agenda du dirigeant.
        self.create(self.dana, "Entretien confidentiel")
        self.assertEqual(self.events(self.admin, [self.personal(self.dana)]), [])
        # Jamais à soi-même, jamais pour un compte qui n'est pas un dirigeant, jamais sans le profil.
        status, _b = self.call("POST", "/agenda/delegations", {"owner_id": self.dana.id, "delegate_id": self.admin.id},
                               token=self.token(self.admin))
        self.assertEqual(status, 403, "Nul ne se donne l'agenda d'un autre")
        status, _b = self.call("POST", "/agenda/delegations", {"owner_id": self.alice.id, "delegate_id": self.awa.id},
                               token=self.token(self.admin))
        self.assertEqual(status, 422, "Un compte qui n'est pas dirigeant délègue lui-même")
        status, _b = self.call("POST", "/agenda/delegations", {"owner_id": self.dana.id, "delegate_id": self.bruno.id},
                               token=self.token(self.carla))
        self.assertEqual(status, 403, "La finance ne pose pas de délégation pour un autre")
        status, _b = self.call("GET", "/agenda/admin/executives", token=self.token(self.carla))
        self.assertEqual(status, 403)
        # Le dirigeant la retire lui-même.
        self.ok("DELETE", f"/agenda/delegations/{body['id']}", self.dana)
