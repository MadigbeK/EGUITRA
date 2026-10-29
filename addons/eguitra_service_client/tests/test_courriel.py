"""Courriel entrant simulé : nouveau message, réponse rattachée, expéditeur non vérifié ou forgé, boucles, rebonds,
pièces jointes, idempotence ; réponses envoyées par courriel ; relève sans boîte configurée. Aucun réseau."""

import os
from unittest.mock import patch

from odoo.tests import tagged

from .. import courriel
from .common import PDF, ScCase

# En-tête de notre serveur de réception (authserv-id réglé dans les réglages de la société).
OURS = "mx.eguitra.test"


def auth(result="dmarc=pass header.from=client-a.gn", server=OURS):
    return {"Authentication-Results": f"{server}; {result}"}


@tagged("post_install", "-at_install")
class TestCourriel(ScCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings_eg.write({"mail_authserv_id": OURS})

    def setUp(self):
        super().setUp()
        self.mail_server()

    def receive(self, sender="Awa Diallo <awa@client-a.gn>", headers=None, **kw):
        return self.receive_mail(self.raw_mail(sender, headers=auth() if headers is None else headers, **kw))

    # ─── Nouveau message ─────────────────────────────────────────────────

    def test_nouveau_message_d_un_contact_authentifie(self):
        outcome, ticket = self.receive()
        self.assertEqual(outcome, "ticket")
        self.assertEqual((ticket.channel, ticket.partner_id, ticket.sender_unverified), ("email", self.client_a, False))
        self.assertRegex(ticket.name, r"^SC/EG/\d{4}/\d{4}$")
        self.assertEqual(ticket.contact_email, "awa@client-a.gn")
        incoming = ticket.message_ids.filtered(lambda m: m.direction == "in")
        self.assertEqual((incoming.email_message_id, incoming.body), ("<m1@client-a.gn>", "Bonjour, il manque deux palettes."))
        ack = self.mails(email_to="awa@client-a.gn")
        self.assertEqual(len(ack), 1, "Accusé de réception")
        self.assertIn(f"[{ticket.name}]", ack.subject)
        self.assertIn("auto-replied", ack.headers or "", "Une réponse automatique se déclare comme telle")
        self.assertIn(courriel.OWN_HEADER, ack.headers or "")
        self.assertFalse(ticket.date_first_response, "L'accusé n'est pas une première réponse")

    def test_expediteur_inconnu_non_verifie(self):
        _outcome, ticket = self.receive(sender="inconnu@ailleurs.gn",
                                        headers=auth("dmarc=pass header.from=ailleurs.gn"))
        self.assertTrue(ticket.sender_unverified)
        self.assertFalse(ticket.partner_id)

    # ─── Usurpation de l'expéditeur (revue de sécurité) ──────────────────

    def test_expediteur_forge_sans_authentification(self):
        """Adresse d'un contact, aucun en-tête d'authentification : jamais rattaché au client, aucune réponse
        automatique."""
        _outcome, ticket = self.receive(headers={})
        self.assertTrue(ticket.sender_unverified)
        self.assertFalse(ticket.partner_id, "Un expéditeur non vérifié ne se rattache jamais au tiers du client")
        self.assertFalse(self.mails(email_to="awa@client-a.gn"), "Aucune réponse automatique")
        self.assertIn("non vérifié", " ".join(ticket.message_ids.mapped("body")))
        self.assertIn(self.client_a.name, " ".join(ticket.message_ids.mapped("body")),
                      "L'agent est averti que l'adresse est celle d'un contact, à vérifier")

    def test_en_tete_d_un_autre_serveur_ou_plus_bas(self):
        """Seul l'en-tête du dessus, de notre serveur, compte : un en-tête écrit par l'expéditeur plus bas, ou d'un
        autre serveur, n'authentifie rien."""
        _o, ailleurs = self.receive(message_id="<m-ailleurs@client-a.gn>",
                                    headers=auth(server="mx.pirate.test"))
        self.assertTrue(ailleurs.sender_unverified)
        # Notre serveur a écrit l'en-tête du dessus (« none ») ; celui du dessous, « pass », vient de l'expéditeur.
        raw = self.raw_mail("awa@client-a.gn", message_id="<m-dessous@client-a.gn>",
                            headers={"Authentication-Results": f"{OURS}; dmarc=none"})
        raw = raw.replace(b"Content-Type: text/plain", b"Authentication-Results: " + OURS.encode()
                          + b"; dmarc=pass header.from=client-a.gn\r\nContent-Type: text/plain")
        _o, dessous = self.receive_mail(raw)
        self.assertTrue(dessous.sender_unverified, "L'en-tête « pass » plus bas est ignoré")
        self.assertFalse(dessous.partner_id)

    def test_dkim_du_domaine_de_l_expediteur_seulement(self):
        _o, autre = self.receive(message_id="<dkim1@client-a.gn>", headers=auth("dkim=pass header.d=pirate.test"))
        self.assertTrue(autre.sender_unverified, "Signature DKIM d'un autre domaine")
        _o, bon = self.receive(message_id="<dkim2@client-a.gn>", headers=auth("dkim=pass header.d=client-a.gn"))
        self.assertFalse(bon.sender_unverified)
        self.assertEqual(bon.partner_id, self.client_a)
        _o, echec = self.receive(message_id="<dkim3@client-a.gn>", headers=auth("dmarc=fail header.from=client-a.gn"))
        self.assertTrue(echec.sender_unverified)

    def test_sans_identifiant_de_serveur_regle_tout_est_non_verifie(self):
        self.settings_eg.write({"mail_authserv_id": False})
        with patch.dict(os.environ, {"SC_MAIL_AUTHSERV_ID": ""}):
            _o, ticket = self.receive()
        self.assertTrue(ticket.sender_unverified)
        with patch.dict(os.environ, {"SC_MAIL_AUTHSERV_ID": OURS}):
            _o, ticket = self.receive(message_id="<m-env@client-a.gn>")
        self.assertFalse(ticket.sender_unverified, "Identifiant donné par la variable du serveur")

    def test_reponse_forgee_ne_rejoint_pas_le_dossier(self):
        _o, ticket = self.receive()
        outgoing = ticket.with_user(self.agent).reply("Nous regardons.", channel="email")
        before = len(ticket.message_ids)
        outcome, other = self.receive(message_id="<forge@pirate.test>", subject=f"RE: [{ticket.name}] Livraison",
                                      headers={"In-Reply-To": outgoing.email_message_id})
        self.assertEqual(outcome, "ticket", "Un expéditeur non vérifié ouvre son propre dossier")
        self.assertNotEqual(other, ticket)
        self.assertEqual(len(ticket.message_ids), before, "Le dossier du client n'a rien reçu")
        self.assertTrue(other.sender_unverified)
        self.assertIn(ticket.name, " ".join(other.message_ids.mapped("body")), "L'agent voit le dossier probable")

    # ─── Réponses rattachées ─────────────────────────────────────────────

    def test_reponse_par_les_en_tetes(self):
        _o, ticket = self.receive()
        ticket.with_user(self.agent).set_state("waiting")
        outgoing = ticket.with_user(self.agent).reply("Pouvez-vous préciser le numéro du bon ?", channel="email")
        headers = dict(auth(), **{"In-Reply-To": outgoing.email_message_id})
        outcome, same = self.receive(message_id="<m2@client-a.gn>", subject="Re: votre demande", body="Bon 4521.",
                                     headers=headers)
        self.assertEqual((outcome, same), ("attached", ticket))
        self.assertEqual(ticket.message_ids.filtered(lambda m: m.direction == "in")[-1:].body, "Bon 4521.")

    def test_reponse_par_la_reference_de_l_objet(self):
        _o, ticket = self.receive()
        outcome, same = self.receive(message_id="<m3@client-a.gn>", subject=f"RE: [{ticket.name}] Livraison")
        self.assertEqual((outcome, same), ("attached", ticket))
        # Même référence, autre client authentifié : un nouveau dossier, jamais celui d'un autre.
        outcome, other = self.receive(sender="contact@client-b.gn", message_id="<m4@client-b.gn>",
                                      subject=f"[{ticket.name}] curiosité", headers=auth("dkim=pass header.d=client-b.gn"))
        self.assertEqual(outcome, "ticket")
        self.assertEqual(other.partner_id, self.client_b)

    def test_reponse_a_un_dossier_resolu_le_rouvre_et_clos_ouvre_une_suite(self):
        _o, ticket = self.receive()
        ticket.with_user(self.agent).set_state("resolved")
        self.receive(message_id="<m5@client-a.gn>", subject=f"[{ticket.name}] encore")
        self.assertEqual(ticket.state, "reopened")
        ticket.with_user(self.agent).set_state("closed")
        outcome, suite = self.receive(message_id="<m6@client-a.gn>", subject=f"[{ticket.name}] toujours")
        self.assertEqual(outcome, "ticket")
        self.assertEqual(suite.previous_id, ticket)

    def test_idempotence(self):
        first = self.receive()
        second = self.receive()
        self.assertEqual(second, ("duplicate", None))
        self.assertEqual(self.env["eguitra.sc.ticket"].sudo().search_count([("contact_email", "=", "awa@client-a.gn")]),
                         1, first)

    # ─── Boucles et rebonds ──────────────────────────────────────────────

    def test_envois_automatiques_refuses(self):
        cases = {
            "auto": ("awa@client-a.gn", {"Auto-Submitted": "auto-replied"}),
            "absence": ("awa@client-a.gn", {"X-Autoreply": "yes"}),
            "rebond": ("MAILER-DAEMON@client-a.gn", {}),
            "liste": ("news@client-a.gn", {"Precedence": "bulk"}),
            "boucle": ("service.client@eguitra.test", {}),
            "retour": ("awa@client-a.gn", {courriel.OWN_HEADER: "SC/EG/2026/0001"}),
        }
        for i, (case, (sender, headers)) in enumerate(cases.items()):
            with self.subTest(case=case):
                outcome, ticket = self.receive(sender=sender, message_id=f"<auto{i}@client-a.gn>",
                                               headers=dict(auth(), **headers))
                self.assertEqual((outcome, ticket), ("rejected", None))
        outcome, _t = self.receive(subject="Réponse automatique : absent jusqu'au 3 novembre", message_id="<abs@x.gn>")
        self.assertEqual(outcome, "rejected")
        self.assertFalse(self.mails(email_to="awa@client-a.gn"), "Aucun accusé de réception à un envoi automatique")
        journal = self.env["eguitra.sc.inbound"].sudo().search([("outcome", "=", "rejected")])
        self.assertGreaterEqual(len(journal), len(cases) + 1)

    def test_expediteur_trop_bavard(self):
        Inbound = self.env["eguitra.sc.inbound"]
        for i in range(20):
            Inbound._log("email", f"<x{i}@client-a.gn>", self.groupe, "awa@client-a.gn", "attached")
        outcome, _t = self.receive(message_id="<x21@client-a.gn>")
        self.assertEqual(outcome, "rejected")

    # ─── Pièces jointes ──────────────────────────────────────────────────

    def test_pieces_jointes_bornees(self):
        _o, ticket = self.receive(attachments=[("bon.pdf", "application/pdf", PDF),
                                               ("virus.exe", "application/octet-stream", b"MZ" + b"\x00" * 50)])
        files = ticket.message_ids.attachment_ids
        self.assertEqual(files.mapped("name"), ["bon.pdf"])
        self.assertIn("virus.exe", " ".join(ticket.message_ids.mapped("body")), "La pièce refusée est citée")
        big = PDF + b"0" * (10 * 1024 * 1024)
        _o, other = self.receive(message_id="<big@client-a.gn>", attachments=[("gros.pdf", "application/pdf", big)])
        self.assertFalse(other.message_ids.attachment_ids)
        self.assertIn("trop volumineuse", " ".join(other.message_ids.mapped("body")))

    # ─── Réponses envoyées ───────────────────────────────────────────────

    def test_reponse_de_l_agent_par_courriel(self):
        _o, ticket = self.receive()
        message = ticket.with_user(self.agent).reply("Bonjour, la livraison part demain.")
        self.assertEqual(message.delivery_state, "sent")
        mail = self.mails(message_id=message.email_message_id)
        self.assertEqual(mail.email_to, "awa@client-a.gn")
        self.assertIn("<m1@client-a.gn>", mail.headers, "En réponse au message du client (In-Reply-To)")
        self.assertEqual(mail.email_from, "service.client@eguitra.test")
        self.assertTrue(ticket.date_first_response)
        self.assertEqual(ticket.state, "in_progress")

    def test_sans_serveur_de_courrier(self):
        _o, ticket = self.receive()
        self.env["ir.mail_server"].sudo().search([]).unlink()
        message = ticket.with_user(self.agent).reply("Réponse.", channel="email")
        self.assertEqual(message.delivery_state, "not_sent")
        self.assertIn("serveur", message.delivery_error)
        self.assertFalse(ticket.date_first_response, "Une réponse non envoyée n'est pas une première réponse")

    # ─── Relève ──────────────────────────────────────────────────────────

    def test_releve_inactive_sans_boite(self):
        with patch.dict(os.environ, {"SC_IMAP_GROUPE_USER": "", "SC_IMAP_GROUPE_PASSWORD": "", "SC_IMAP_HOST": ""}):
            status = self.env["eguitra.sc.mail.gateway"]._status(self.groupe)
            self.assertFalse(status["active"])
            self.assertIn("SC_IMAP", status["message"])
            self.assertEqual(self.env["eguitra.sc.mail.gateway"]._cron_fetch(), 0)

    def test_releve_imap_simulee(self):
        raw = self.raw_mail("awa@client-a.gn", message_id="<imap@client-a.gn>", headers=auth())
        stored = []

        class FakeImap:
            def select(self, box):
                return "OK", [b"1"]

            def uid(self, command, *args):
                if command == "search":
                    return "OK", [b"7"]
                if command == "fetch" and args[1] == "(RFC822.SIZE)":
                    return "OK", [b"7 (UID 7 RFC822.SIZE %d)" % len(raw)]
                if command == "fetch":
                    return "OK", [(b"7 (UID 7 BODY[] {%d}" % len(raw), raw), b")"]
                if command == "store":
                    stored.append(args)
                    return "OK", []
                return "NO", []

            def logout(self):
                return "BYE", []

        env = {"SC_IMAP_HOST": "imap.eguitra.test", "SC_IMAP_GROUPE_USER": "service.client@eguitra.test",
               "SC_IMAP_GROUPE_PASSWORD": "mot-de-passe-essai"}
        Gateway = type(self.env["eguitra.sc.mail.gateway"])
        with patch.dict(os.environ, env), patch.object(Gateway, "_connect", lambda self, cfg: FakeImap()):
            self.assertTrue(self.env["eguitra.sc.mail.gateway"]._status(self.groupe)["active"])
            self.assertEqual(self.env["eguitra.sc.mail.gateway"]._cron_fetch(), 1)
        self.assertEqual(stored, [(b"7", "+FLAGS", "(\\Seen)")], "Marqué lu une fois traité")
        self.assertTrue(self.env["eguitra.sc.ticket"].sudo().search([("contact_email", "=", "awa@client-a.gn")]))
