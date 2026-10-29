"""Parcours d'un dossier : numérotation par société, échéances, états, attente du client, escalade, satisfaction,
fusion, clôture d'office, piste d'audit, fil non modifiable."""

from datetime import timedelta

from freezegun import freeze_time

from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import ScCase, next_monday


@tagged("post_install", "-at_install")
class TestDossier(ScCase):
    def test_numerotation_propre_a_chaque_societe(self):
        a = self.ticket()
        b = self.ticket()
        c = self.ticket(company=self.cabinet, partner_id=self.client_c.id)
        year = a.date_open.year
        self.assertRegex(a.name, rf"^SC/EG/{year}/\d{{4}}$")
        self.assertRegex(c.name, rf"^SC/MBAX/{year}/\d{{4}}$")
        self.assertEqual(int(b.name[-4:]), int(a.name[-4:]) + 1, "Compteur sans trou de la société")
        d = self.ticket(company=self.cabinet, partner_id=self.client_c.id)
        self.assertEqual(int(d.name[-4:]), int(c.name[-4:]) + 1, "Compteur propre au cabinet, sans trou")

    def test_client_d_une_autre_societe_refuse(self):
        with self.assertRaises(UserError):
            self.ticket(partner_id=self.client_c.id)

    def test_echeances_selon_la_priorite_et_la_categorie(self):
        monday = next_monday(9)
        with freeze_time(monday):
            normal = self.ticket()
            urgent = self.ticket(priority="urgent")
            category = self.env["eguitra.sc.category"].sudo().search([("company_id", "=", self.groupe.id),
                                                                       ("code", "=", "facturation")])
            category.first_hours = 2
            short = self.ticket(category_id=category.id)
        self.assertEqual(normal.date_first_response_due, monday + timedelta(hours=8), "8 h ouvrées : lundi 17 h")
        self.assertEqual(urgent.date_first_response_due, monday + timedelta(hours=1))
        self.assertEqual(short.date_first_response_due, monday + timedelta(hours=2), "Le plus court : la catégorie")
        self.assertEqual(urgent.date_resolution_due, monday + timedelta(hours=8))
        urgent.write({"priority": "low"})
        self.assertEqual(urgent.date_first_response_due, monday + timedelta(days=1, hours=7),
                         "Changer la priorité recalcule les échéances (16 h ouvrées)")

    def test_parcours_complet(self):
        ticket = self.ticket()
        self.assertEqual(ticket.state, "new")
        ticket.with_user(self.agent).assign(self.fatou)
        self.assertEqual((ticket.state, ticket.user_id), ("assigned", self.fatou))
        self.assertTrue(self.notifications(self.fatou, "assigned"), "Le responsable est prévenu")
        message = ticket.with_user(self.fatou).reply("Nous vous rappelons dans l'heure.")
        self.assertEqual(message.delivery_state, "manual", "Dossier téléphonique : réponse de vive voix notée")
        self.assertEqual(ticket.state, "in_progress")
        self.assertTrue(ticket.date_first_response)
        ticket.with_user(self.fatou).set_state("waiting")
        ticket.client_message("Voici le numéro du bon : 4521.", "phone")
        self.assertEqual(ticket.state, "in_progress", "La réponse du client relance le dossier")
        ticket.with_user(self.fatou).set_state("resolved")
        self.assertTrue(ticket.date_resolved)
        self.assertTrue(ticket.satisfaction_requested)
        with self.assertRaises(UserError):
            ticket.with_user(self.fatou).set_state("closed")  # un métier ne clôt pas
        ticket.with_user(self.agent).set_state("closed")
        ticket.with_user(self.agent).set_state("reopened")
        self.assertEqual(ticket.state, "reopened")
        self.assertFalse(ticket.date_closed)
        events = ticket.message_ids.filtered(lambda m: m.kind == "event").mapped("body")
        self.assertTrue(any("Résolu" in e for e in events), events)

    def test_passages_d_etat_interdits(self):
        ticket = self.ticket()
        with self.assertRaises(UserError):
            ticket.with_user(self.agent).set_state("reopened")
        with self.assertRaises(UserError):
            ticket.with_user(self.agent).set_state("inconnu")
        with self.assertRaises(UserError):
            ticket.with_user(self.agent).assign(self.achats)  # n'ouvre pas le service client
        with self.assertRaises(UserError):
            ticket.with_user(self.agent).assign(self.consultant)  # pas ouvert à EGUITRA GROUP SARLU

    def test_attente_du_client_reporte_la_resolution(self):
        monday = next_monday(9)
        with freeze_time(monday):
            ticket = self.ticket()
            due = ticket.date_resolution_due
            ticket.with_user(self.agent).set_state("waiting")
        with freeze_time(monday + timedelta(hours=3)):
            ticket.with_user(self.agent).set_state("in_progress")
        self.assertEqual(ticket.paused_hours, 3.0)
        self.assertEqual(ticket.date_resolution_due, due + timedelta(hours=3))

    def test_escalade_au_responsable_puis_a_la_direction(self):
        monday = next_monday(9)
        with freeze_time(monday):
            ticket = self.ticket(priority="urgent", user_id=self.agent_eg.id)
        with freeze_time(monday + timedelta(hours=1, minutes=30)):
            self.env["eguitra.sc.ticket"]._cron_escalate()
        self.assertEqual(ticket.escalated_first, 1)
        self.assertTrue(self.notifications(self.agent_eg, "escalation"))
        self.assertFalse(self.notifications(self.dg, "escalation"), "Pas encore la direction")
        with freeze_time(monday + timedelta(hours=1, minutes=45)):
            self.env["eguitra.sc.ticket"]._cron_escalate()
        self.assertEqual(len(self.notifications(self.agent_eg, "escalation")), 1, "Une seule fois par niveau")
        with freeze_time(monday + timedelta(hours=6)):
            self.env["eguitra.sc.ticket"]._cron_escalate()
        self.assertEqual(ticket.escalated_first, 2)
        self.assertTrue(self.notifications(self.dg, "escalation"), "4 heures ouvrées de retard : la direction")
        with freeze_time(monday + timedelta(hours=6, minutes=5)):
            ticket.with_user(self.agent_eg).reply("Désolés du retard, nous traitons.")
            self.env["eguitra.sc.ticket"]._cron_escalate()
        self.assertEqual(ticket._late(monday + timedelta(hours=6, minutes=5)), None)

    def test_en_attente_du_client_pas_de_retard_de_resolution(self):
        monday = next_monday(9)
        with freeze_time(monday):
            ticket = self.ticket()
            ticket.with_user(self.agent).reply("Il nous faut le bon de livraison.")
            ticket.with_user(self.agent).set_state("waiting")
        self.assertIsNone(ticket._late(monday + timedelta(days=30)))

    def test_satisfaction_recueillie_par_l_agent(self):
        ticket = self.ticket()
        with self.assertRaises(UserError):
            ticket.record_satisfaction(4)
        ticket.with_user(self.agent).set_state("resolved")
        events = " ".join(ticket.message_ids.mapped("body"))
        self.assertIn("à recueillir", events, "Dossier téléphonique : l'agent recueille la note")
        with self.assertRaises(UserError):
            ticket.record_satisfaction(6)
        ticket.record_satisfaction(4, "Rapide", channel="phone")
        self.assertEqual((ticket.satisfaction_score, ticket.satisfaction_comment), (4, "Rapide"))
        with self.assertRaises(UserError):
            ticket.record_satisfaction(5)

    def test_fusion_des_doublons(self):
        keep = self.ticket(subject="Retard de livraison (essai)")
        dup = self.ticket(subject="Toujours rien (essai)", priority="high")
        dup.client_message("Je relance.", "phone")
        dup.merge_into(keep)
        self.assertEqual((dup.state, dup.merged_into_id), ("closed", keep))
        self.assertIn("Je relance.", keep.message_ids.mapped("body"))
        self.assertEqual(keep.priority, "high", "Le dossier gardé prend la priorité la plus haute")
        self.assertEqual(dup._final(), keep)
        other = self.ticket(partner_id=self.client_b.id)
        with self.assertRaises(UserError):
            other.merge_into(keep)
        with self.assertRaises(UserError):
            self.ticket(company=self.cabinet, partner_id=self.client_c.id).merge_into(keep)
        with self.assertRaises(UserError):
            dup.with_user(self.agent).reply("x")

    def test_cloture_d_office_des_dossiers_resolus(self):
        ticket = self.ticket()
        with freeze_time(next_monday(9) - timedelta(days=8)):
            ticket.with_user(self.agent).set_state("resolved")
        with freeze_time(next_monday(9)):
            closed = self.env["eguitra.sc.ticket"]._cron_auto_close()
        self.assertIn(ticket, closed)
        self.assertEqual(ticket.state, "closed")

    def test_reponses_types(self):
        template = self.env["eguitra.sc.template"].sudo().search([("company_id", "=", self.groupe.id),
                                                                   ("name", "=", "Accusé de réception")])
        ticket = self.ticket()
        text = template.render(ticket, self.agent)
        self.assertIn(ticket.name, text)
        self.assertIn("Awa Diallo", text)
        self.assertIn(self.groupe.name, text)
        self.assertNotIn("{", text)

    def test_preparation_des_societes(self):
        Category = self.env["eguitra.sc.category"].sudo()
        groupe = set(Category.search([("company_id", "=", self.groupe.id)]).mapped("code"))
        cabinet = set(Category.search([("company_id", "=", self.cabinet.id)]).mapped("code"))
        self.assertLessEqual({"livraison", "retard", "produit", "facturation", "location", "travaux", "loyer", "autre"},
                             groupe)
        self.assertEqual(cabinet, {"facturation", "cabinet", "autre"})
        (self.groupe | self.cabinet)._eguitra_sc_setup()
        self.assertEqual(len(Category.search([("company_id", "=", self.groupe.id)])), len(groupe), "Sans doublon")

    def test_fil_non_modifiable_et_audit(self):
        ticket = self.ticket()
        note = ticket.with_user(self.agent).post_note("Rappeler demain.")
        with self.assertRaises(AccessError):
            note.with_user(self.agent).write({"body": "Autre chose"})
        with self.assertRaises(AccessError):
            self.env["eguitra.sc.message"].with_user(self.agent).create({"ticket_id": ticket.id, "body": "x"})
        with self.assertRaises(AccessError):
            ticket.with_user(self.agent).write({"date_first_response": False})
        Rule = self.env["auditlog.rule"].sudo()
        for model in ("eguitra.sc.ticket", "eguitra.sc.message", "eguitra.sc.invitation"):
            self.assertTrue(Rule.search_count([("model_id.model", "=", model), ("state", "=", "confirmed")]), model)
        ticket.with_user(self.agent).write({"priority": "high"})
        self.assertTrue(self.env["auditlog.log"].sudo().search_count([
            ("model_id.model", "=", "eguitra.sc.ticket"), ("res_id", "=", ticket.id), ("method", "=", "write")]))
