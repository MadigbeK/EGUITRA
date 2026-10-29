"""Espace client : le client ne voit que les dossiers de son tiers, jamais les notes internes ni le responsable au-delà
de son prénom ; dépôt, réponse, pièces, satisfaction ; comptes invités par courriel, sans prise de contrôle possible
d'un compte existant."""

import base64
import os
import re

from odoo.tests import tagged

from .common import PDF, ScCase


@tagged("post_install", "-at_install")
class TestEspaceClient(ScCase):
    def setUp(self):
        super().setUp()
        self.mail_server()
        self.mine = self.ticket(subject="Facture de septembre (essai)", user_id=self.agent.id)
        self.mine.with_user(self.agent).reply("Bonjour, nous vérifions la facture.", channel="portal")
        self.mine.with_user(self.agent).post_note("Note interne : client difficile, ne pas transmettre.")
        self.other = self.ticket(subject="Dossier du client B (essai)", partner_id=self.client_b.id,
                                 contact_email="contact@client-b.gn")

    # ─── Lecture bornée ──────────────────────────────────────────────────

    def test_le_client_ne_voit_que_ses_dossiers(self):
        rows = self.api("GET", "/espace-client/tickets", self.user_a)
        self.assertEqual([r["name"] for r in rows], [self.mine.name])
        self.api("GET", f"/espace-client/tickets/{self.other.id}", self.user_a, status=404)
        cabinet = self.ticket(company=self.cabinet, partner_id=self.client_c.id, contact_email="contact@client-c.gn")
        self.api("GET", f"/espace-client/tickets/{cabinet.id}", self.user_a, status=404)
        self.assertEqual([r["name"] for r in self.api("GET", "/espace-client/tickets", self.user_c)], [cabinet.name])

    def test_ni_notes_ni_responsable_ni_echeances(self):
        detail = self.api("GET", f"/espace-client/tickets/{self.mine.id}", self.user_a)
        text = str(detail)
        self.assertNotIn("Note interne", text)
        self.assertNotIn("client difficile", text)
        self.assertEqual(detail["handled_by"], "Agent.Sc".split()[0])
        self.assertNotIn(self.agent.login, text)
        for key in ("first_response_due", "resolution_due", "escalation", "delivery_state", "user"):
            self.assertNotIn(key, text, f"{key} ne sort jamais vers le client")
        self.assertEqual([m["body"] for m in detail["messages"]], ["Bonjour, nous vérifions la facture."])
        self.assertEqual(detail["state_label"], "En cours de traitement")

    def test_routes_internes_refusees_au_client(self):
        status, _b = self.call("GET", "/service-client/tickets", token=self.token(self.user_a))
        self.assertEqual(status, 403)
        status, body = self.call("POST", "/auth/login", {"login": self.user_a.login, "password": "Motdepasse-2026!",
                                                         "app": "service-client"})
        self.assertEqual((status, body.get("error")), (403, "app_forbidden"))

    # ─── Dépôt et échanges ───────────────────────────────────────────────

    def test_deposer_une_demande(self):
        category = self.env["eguitra.sc.category"].sudo().search([("company_id", "=", self.groupe.id),
                                                                   ("code", "=", "retard")])
        me = self.api("GET", "/espace-client/me", self.user_a)
        self.assertEqual([c["name"] for c in me["companies"]], [self.groupe.name])
        detail = self.api("POST", "/espace-client/tickets", self.user_a, {
            "subject": "Camion en retard (essai)", "description": "Le camion annoncé hier n'est pas arrivé.",
            "category_id": category.id})
        ticket = self.env["eguitra.sc.ticket"].sudo().browse(detail["id"])
        self.assertEqual((ticket.channel, ticket.partner_id, ticket.kind, ticket.client_user_id),
                         ("portal", self.client_a, "complaint", self.user_a))
        self.assertRegex(ticket.name, r"^SC/EG/")
        self.assertTrue(ticket.message_ids.filtered(lambda m: m.auto), "Accusé de réception dans l'espace")
        self.assertTrue(self.notifications(self.agent, "new_ticket"), "Les agents sont prévenus")
        self.api("POST", "/espace-client/tickets", self.user_a, {"subject": "x", "description": "y",
                                                                 "category_id": 999999}, status=422)

    def test_repondre_rouvre_un_dossier_resolu_et_confirmer(self):
        self.mine.with_user(self.agent).set_state("resolved")
        detail = self.api("POST", f"/espace-client/tickets/{self.mine.id}/messages", self.user_a,
                          {"body": "Toujours pas d'avoir reçu."})
        self.assertEqual(self.mine.state, "reopened")
        self.assertEqual(detail["messages"][-1]["body"], "Toujours pas d'avoir reçu.")
        self.assertTrue(self.notifications(self.agent, "client_message"))
        self.mine.with_user(self.agent).set_state("resolved")
        self.api("POST", f"/espace-client/tickets/{self.mine.id}/confirm", self.user_a)
        self.assertEqual(self.mine.state, "closed")
        self.api("POST", f"/espace-client/tickets/{self.mine.id}/messages", self.user_a, {"body": "Encore"},
                 status=422)

    def test_pieces_jointes(self):
        response = self.upload(f"/espace-client/tickets/{self.mine.id}/messages", self.user_a,
                               files={"files": ("bon.pdf", PDF, "application/pdf")}, data={"body": "Le bon signé."})
        attachment = response["messages"][-1]["attachments"][0]
        self.assertEqual(attachment["name"], "bon.pdf")
        file = self.url_open(f"/api/v1/espace-client/tickets/{self.mine.id}/attachments/{attachment['id']}",
                             headers={"Authorization": f"Bearer {self.token(self.user_a)}"})
        self.assertEqual((file.status_code, file.content), (200, PDF))
        self.upload(f"/espace-client/tickets/{self.mine.id}/messages", self.user_a,
                    files={"files": ("piege.pdf", b"MZ" + b"\x00" * 40, "application/pdf")}, status=415)
        # Pièce d'une note interne : jamais téléchargeable par le client.
        note_file = self.env["ir.attachment"].sudo().create({"name": "interne.pdf", "datas": base64.b64encode(PDF),
                                                             "res_model": "eguitra.sc.ticket", "res_id": self.mine.id})
        self.mine.with_user(self.agent).post_note("Pièce interne", attachments=note_file.ids)
        status, _b = self.call("GET", f"/espace-client/tickets/{self.mine.id}/attachments/{note_file.id}",
                               token=self.token(self.user_a))
        self.assertEqual(status, 404)
        status, _b = self.call("GET", f"/espace-client/tickets/{self.mine.id}/attachments/{attachment['id']}",
                               token=self.token(self.user_b))
        self.assertEqual(status, 404, "Pièce d'un autre client")

    def test_satisfaction(self):
        self.api("POST", f"/espace-client/tickets/{self.mine.id}/satisfaction", self.user_a, {"score": 5}, status=422)
        self.mine.with_user(self.agent).set_state("resolved")
        detail = self.api("GET", f"/espace-client/tickets/{self.mine.id}", self.user_a)
        self.assertTrue(detail["satisfaction"]["can_rate"])
        self.api("POST", f"/espace-client/tickets/{self.mine.id}/satisfaction", self.user_a,
                 {"score": 2, "comment": "Trop lent"})
        self.assertEqual((self.mine.satisfaction_score, self.mine.satisfaction_channel), (2, "portal"))
        self.assertTrue(self.notifications(self.agent, "satisfaction_low"), "Une note basse prévient le responsable")
        self.api("POST", f"/espace-client/tickets/{self.mine.id}/satisfaction", self.user_a, {"score": 4}, status=422)

    # ─── Comptes et invitations ──────────────────────────────────────────

    def invite_link(self, mail):
        match = re.search(r"/invitation/([A-Za-z0-9_-]{20,100})", mail.body_html)
        self.assertTrue(match, mail.body_html)
        return match.group(1)

    def test_invitation_par_courriel_puis_mot_de_passe(self):
        body = self.api("POST", "/service-client/client-accounts", self.agent_eg, {
            "partner_id": self.client_a.id, "name": "Mamadou Bah", "email": "mamadou@client-a.gn"})
        self.assertTrue(body["created"] and body["invitation_sent"])
        self.assertIsNone(body["invitation_link"], "Le lien part par courriel, jamais dans la réponse")
        token = self.invite_link(self.mails(email_to="mamadou@client-a.gn"))
        status, check = self.call("POST", "/espace-client/invitation/check", {"token": token})
        self.assertEqual((status, check["login"], check["mfa_required"]), (200, "mamadou@client-a.gn", False))
        status, body = self.call("POST", "/espace-client/invitation/accept", {"token": token,
                                                                              "password": "Nouveau-Mot-2026!"})
        self.assertEqual(status, 200, body)
        session = self.open_session("mamadou@client-a.gn", app="espace-client", password="Nouveau-Mot-2026!")
        self.assertEqual(session["user"]["apps"], ["espace-client"])
        status, _b = self.call("POST", "/espace-client/invitation/accept", {"token": token, "password": "Autre-2026!x"})
        self.assertEqual(status, 404, "Un lien ne sert qu'une fois")

    def test_invitation_sans_serveur_de_courrier(self):
        self.env["ir.mail_server"].sudo().search([]).unlink()
        body = self.api("POST", "/service-client/client-accounts", self.agent, {
            "partner_id": self.client_b.id, "email": "fanta@client-b.gn", "name": "Fanta"})
        self.assertTrue(body["invitation_link"].startswith("https://nimova.test/invitation/"),
                        "Compte jamais connecté : le lien est remis une fois à l'agent")

    def test_aucune_prise_de_controle_d_un_compte_existant(self):
        """Revue de sécurité : un compte interne, ou d'une autre société, n'est jamais rattaché ; un compte déjà
        utilisé ne reçoit son lien que par son courriel ; la double authentification reste exigée."""
        interne = self._create_user("interne@eguitra.test", "finance")
        autre_societe = self._client("cabinet@client-c.gn", self.client_c, self.cabinet)
        for email in (interne.login, autre_societe.login, "INTERNE@eguitra.test"):
            with self.subTest(email=email):
                status, body = self.call("POST", "/service-client/client-accounts", {
                    "partner_id": self.client_a.id, "email": email}, token=self.token(self.agent_eg))
                self.assertEqual(status, 422, body)
                self.assertIn("déjà utilisée", body["message"])
                self.assertNotIn(self.cabinet.name, body["message"], "Rien n'est dit du compte existant")
        self.assertNotIn(self.client_a, autre_societe.eguitra_sc_partner_ids)
        self.assertTrue(interne.has_group("eguitra_base.group_profile_finance"), "Compte interne intact")
        self.assertFalse(interne.eguitra_sc_partner_ids)
        # Compte d'une autre société : l'agent d'EGUITRA GROUP SARLU ne le gère pas.
        status, _b = self.call("POST", f"/service-client/client-accounts/{self.user_c.id}/invite",
                               token=self.token(self.agent_eg))
        self.assertEqual(status, 404)
        self.logged_in(self.user_a)
        body = self.api("POST", f"/service-client/client-accounts/{self.user_a.id}/invite", self.agent_eg)
        self.assertTrue(body["reset"])
        self.assertIsNone(body["invitation_link"], "Compte déjà utilisé : jamais de lien dans la réponse")
        self.env["ir.mail_server"].sudo().search([]).unlink()
        status, body = self.call("POST", f"/service-client/client-accounts/{self.user_a.id}/invite",
                                 token=self.token(self.agent_eg))
        self.assertEqual(status, 422, "Sans serveur de courrier, pas de réinitialisation")

    def test_compte_retrouve_par_son_identifiant_seulement(self):
        """Revue de sécurité : un compte n'est retrouvé que par son identifiant, jamais par son champ courriel
        (modifiable, ni par un joker) ; un compte qui suit déjà un autre client ne le suit en plus que sur
        confirmation de l'agent, journalisée dans la piste d'audit."""
        existant = self._client("fanta@client-b.gn", self.client_b, self.groupe)
        existant.sudo().write({"email": "%@client-a.gn"})
        body = self.api("POST", "/service-client/client-accounts", self.agent_eg, {
            "partner_id": self.client_a.id, "email": "awa@client-a.gn", "name": "Awa Diallo"})
        self.assertTrue(body["created"], "Le joker du champ courriel ne retrouve aucun compte")
        self.assertEqual(existant.eguitra_sc_partner_ids, self.client_b)
        status, body = self.call("POST", "/service-client/client-accounts", {
            "partner_id": self.client_a.id, "email": "fanta@client-b.gn"}, token=self.token(self.agent_eg))
        self.assertEqual((status, body["error"]), (409, "confirm_required"))
        self.assertEqual(existant.eguitra_sc_partner_ids, self.client_b, "Rien sans confirmation")
        body = self.api("POST", "/service-client/client-accounts", self.agent_eg, {
            "partner_id": self.client_a.id, "email": "fanta@client-b.gn", "confirm_link": True})
        self.assertFalse(body["created"])
        self.assertEqual(existant.eguitra_sc_partner_ids, self.client_a | self.client_b)
        self.assertTrue(self.env["auditlog.log"].sudo().search_count([
            ("model_id.model", "=", "res.users"), ("res_id", "=", existant.id), ("method", "=", "write"),
            ("user_id", "=", self.agent_eg.id)]), "Rattachement confirmé tracé avec son auteur")

    def test_reinitialisation_exige_la_double_authentification(self):
        secret = base64.b32encode(os.urandom(20)).decode()
        self.assertTrue(self.user_a.with_user(self.user_a)._totp_try_setting(secret, int(self.totp_code(secret))))
        self.logged_in(self.user_a)
        self.api("POST", f"/service-client/client-accounts/{self.user_a.id}/invite", self.agent_eg)
        mail = self.env["mail.mail"].sudo().search([("email_to", "=", self.user_a.email),
                                                    ("subject", "ilike", "Nouveau mot de passe")])
        self.assertEqual(len(mail), 1)
        token = self.invite_link(mail)
        status, check = self.call("POST", "/espace-client/invitation/check", {"token": token})
        self.assertTrue(check["mfa_required"])
        status, body = self.call("POST", "/espace-client/invitation/accept", {"token": token, "password": "Repris-2026!x"})
        self.assertEqual((status, body["error"]), (401, "mfa_required"))
        status, body = self.call("POST", "/espace-client/invitation/accept",
                                 {"token": token, "password": "Repris-2026!x", "code": "000000"})
        self.assertEqual(status, 401)
        self.assertTrue(self.env["eguitra.api.login.attempt"].sudo().search_count(
            [("login", "=", self.user_a.login), ("success", "=", False), ("kind", "=", "mfa")]), "Échec compté")
        status, body = self.call("POST", "/espace-client/invitation/accept",
                                 {"token": token, "password": "Repris-2026!x", "code": self.totp_code(secret, 1)})
        self.assertEqual(status, 200, body)

    def test_liens_publics_bornes(self):
        for _i in range(10):
            self.call("POST", "/espace-client/invitation/check", {"token": "x" * 30})
        status, body = self.call("POST", "/espace-client/invitation/check", {"token": "x" * 30})
        self.assertEqual((status, body["error"]), (429, "rate_limited"))

    def test_retrait_du_dernier_tiers_desactive_le_compte(self):
        self.api("DELETE", f"/service-client/client-accounts/{self.user_b.id}/partners/{self.client_b.id}", self.agent)
        self.assertFalse(self.user_b.active)
