"""WhatsApp simulé (API Cloud de Meta remplacée, aucun appel réseau) : vérification de l'adresse, signature valide ou
invalide, idempotence, rattachement au dossier ouvert, numéro inconnu, fenêtre de 24 heures et modèle approuvé,
statuts, médias, satisfaction."""

import json
from datetime import timedelta

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import tagged

from .. import whatsapp as wa
from .common import PNG, ScCase


@tagged("post_install", "-at_install")
class TestWhatsApp(ScCase):
    def tickets(self, number="224621111111"):
        return self.env["eguitra.sc.ticket"].sudo().search([("contact_phone_norm", "=", number)])

    # ─── Vérification et signature ───────────────────────────────────────

    def test_verification_de_l_adresse(self):
        path = "/api/v1/service-client/whatsapp/webhook"
        with self.meta():
            ok = self.url_open(f"{path}?hub.mode=subscribe&hub.verify_token=verification-essai&hub.challenge=12345")
            self.assertEqual((ok.status_code, ok.text), (200, "12345"))
            bad = self.url_open(f"{path}?hub.mode=subscribe&hub.verify_token=autre&hub.challenge=12345")
            self.assertEqual(bad.status_code, 403)
        with self.no_meta():
            inactive = self.url_open(f"{path}?hub.mode=subscribe&hub.verify_token=verification-essai&hub.challenge=1")
            self.assertEqual(inactive.status_code, 404, "Sans configuration, le canal est inactif")
            status, _r = self.post_webhook(self.wa_payload())
            self.assertEqual(status, 404, "Sans secret, aucune notification n'est lue")

    def test_signature_exigee(self):
        with self.meta() as meta:
            status, _r = self.post_webhook(self.wa_payload(), signature=False)
            self.assertEqual(status, 401, "Message non signé refusé")
            status, _r = self.post_webhook(self.wa_payload(), signature="sha256=" + "0" * 64)
            self.assertEqual(status, 401, "Signature invalide refusée")
            status, _r = self.post_webhook(self.wa_payload(), secret="autre-secret")
            self.assertEqual(status, 401, "Signée avec un autre secret")
            self.assertFalse(self.tickets(), "Rien n'est lu d'un message refusé")
            status, response = self.post_webhook(self.wa_payload())
            self.assertEqual(status, 200, response.text)
            self.assertFalse(meta.calls, "La notification est traitée sans appeler Meta")
        self.assertEqual(len(self.tickets()), 1)

    def test_notification_trop_volumineuse(self):
        with self.meta():
            payload = self.wa_payload(text="x" * (wa.MAX_PAYLOAD + 10))
            status, _r = self.post_webhook(payload)
        self.assertEqual(status, 413)

    # ─── Réception ───────────────────────────────────────────────────────

    def test_numero_connu_rattache_au_dossier_ouvert(self):
        with self.meta():
            self.post_webhook(self.wa_payload())
            ticket = self.tickets()
            self.assertEqual((ticket.channel, ticket.partner_id, ticket.sender_unverified),
                             ("whatsapp", self.client_a, False), "Le numéro est celui du client A")
            self.post_webhook(self.wa_payload(text="Avez-vous des nouvelles ?", wamid="wamid.recu.2"))
        self.assertEqual(len(self.tickets()), 1, "Le second message rejoint le dossier ouvert")
        bodies = ticket.message_ids.filtered(lambda m: m.direction == "in").mapped("body")
        self.assertEqual(len(bodies), 2)
        self.assertTrue(ticket.wa_last_inbound)

    def test_numero_inconnu_ouvre_un_dossier_non_verifie(self):
        with self.meta():
            self.post_webhook(self.wa_payload(sender="224629999999", wamid="wamid.inconnu"))
        ticket = self.tickets("224629999999")
        self.assertTrue(ticket.sender_unverified)
        self.assertFalse(ticket.partner_id)

    def test_idempotence(self):
        payload = self.wa_payload()
        with self.meta():
            self.post_webhook(payload)
            self.post_webhook(payload)
        ticket = self.tickets()
        self.assertEqual(len(ticket), 1)
        self.assertEqual(len(ticket.message_ids.filtered(lambda m: m.direction == "in")), 1, "Un message reçu une fois")

    def test_numero_d_une_autre_plateforme_ignore(self):
        with self.meta():
            status, _r = self.post_webhook(self.wa_payload(phone_id="999"))
        self.assertEqual(status, 200)
        self.assertFalse(self.tickets())
        self.assertTrue(self.env["eguitra.sc.inbound"].sudo().search([("external_id", "=", "wamid.recu.1"),
                                                                       ("outcome", "=", "rejected")]))

    def test_accuse_de_reception_envoye_par_la_tache(self):
        with self.meta() as meta:
            self.post_webhook(self.wa_payload())
            ack = self.tickets().message_ids.filtered(lambda m: m.auto)
            self.assertEqual(ack.delivery_state, "queued", "Rien n'est envoyé pendant la notification")
            self.env["eguitra.sc.whatsapp"]._cron_run()
            self.assertEqual(ack.delivery_state, "sent")
            self.assertEqual(len(meta.sent("text")), 1)
            self.assertEqual(meta.sent("text")[0]["json"]["to"], "224621111111")

    # ─── Envoi : fenêtre de 24 heures ────────────────────────────────────

    def test_reponse_dans_la_fenetre(self):
        with self.meta() as meta:
            self.post_webhook(self.wa_payload())
            ticket = self.tickets()
            message = ticket.with_user(self.agent).reply("Votre livraison part cet après-midi.")
            self.assertEqual(message.delivery_state, "sent")
            self.assertTrue(message.wa_message_id.startswith("wamid.envoi."))
            self.assertEqual(meta.sent("text")[-1]["json"]["text"]["body"], "Votre livraison part cet après-midi.")
            self.env["eguitra.sc.whatsapp"]._receive({"object": "whatsapp_business_account", "entry": [{"changes": [{
                "field": "messages", "value": {"metadata": {"phone_number_id": "100200300"}, "statuses": [
                    {"id": message.wa_message_id, "status": "read"}]}}]}]})
            self.assertEqual(message.delivery_state, "read")

    def test_hors_fenetre_sans_modele_refuse(self):
        with self.meta() as meta:
            self.post_webhook(self.wa_payload())
            ticket = self.tickets()
            ticket.write({"wa_last_inbound": fields.Datetime.now() - timedelta(hours=25)})
            with self.assertRaises(UserError) as error:
                ticket.with_user(self.agent).reply("Nous revenons vers vous.")
            self.assertIn("modèle", str(error.exception))
            self.assertFalse(meta.sent("text"), "Aucun texte hors de la fenêtre")

    def test_hors_fenetre_avec_modele_puis_message_parti_a_la_reponse(self):
        self.settings_eg.write({"wa_template": "suivi_dossier", "wa_template_lang": "fr"})
        with self.meta() as meta:
            self.post_webhook(self.wa_payload())
            ticket = self.tickets()
            ticket.write({"wa_last_inbound": fields.Datetime.now() - timedelta(hours=30)})
            message = ticket.with_user(self.agent).reply("Le camion est reparti.")
            template = meta.sent("template")
            self.assertEqual(len(template), 1)
            self.assertEqual(template[0]["json"]["template"]["name"], "suivi_dossier")
            params = template[0]["json"]["template"]["components"][0]["parameters"]
            self.assertEqual([p["text"] for p in params][1], ticket.name)
            self.assertEqual(message.delivery_state, "waiting_window")
            self.post_webhook(self.wa_payload(text="Oui ?", wamid="wamid.recu.3"))
            self.assertEqual(message.delivery_state, "queued")
            self.env["eguitra.sc.whatsapp"]._cron_run()
            self.assertEqual(message.delivery_state, "sent")
            self.assertIn("Le camion est reparti.", [c["json"]["text"]["body"] for c in meta.sent("text")])

    def test_canal_inactif(self):
        ticket = self.ticket(channel="whatsapp", contact_phone="+224 621 11 11 11")
        with self.no_meta():
            status = self.env["eguitra.sc.whatsapp"]._status(self.groupe)
            self.assertFalse(status["active"])
            self.assertIn("WHATSAPP", status["message"])
            with self.assertRaises(UserError):
                ticket.with_user(self.agent).reply("Bonjour")

    # ─── Médias ──────────────────────────────────────────────────────────

    def test_media_telecharge_borne(self):
        with self.meta() as meta:
            meta.media["m1"] = ({"url": "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=m1",
                                 "mime_type": "image/png", "file_size": len(PNG)}, PNG)
            meta.media["m2"] = ({"url": "https://pirate.test/fichier", "mime_type": "image/png"}, PNG)
            self.post_webhook(self.wa_payload(text="Photo du camion", media={"id": "m1", "mime_type": "image/png"}))
            self.post_webhook(self.wa_payload(text="Autre", wamid="wamid.recu.4",
                                              media={"id": "m2", "mime_type": "image/png"}))
            self.env["eguitra.sc.whatsapp"]._cron_run()
        jobs = self.env["eguitra.sc.media.job"].sudo().search([])
        self.assertEqual(sorted(jobs.mapped("state")), ["done", "refused"])
        ticket = self.tickets()
        self.assertEqual(len(ticket.message_ids.attachment_ids), 1)
        self.assertEqual(ticket.message_ids.attachment_ids.mimetype, "image/png")
        self.assertIn("hôte", " ".join(ticket.message_ids.mapped("body")), "Média d'un hôte inattendu refusé")

    # ─── Satisfaction ────────────────────────────────────────────────────

    def test_note_de_satisfaction_par_un_chiffre(self):
        with self.meta() as meta:
            self.post_webhook(self.wa_payload())
            ticket = self.tickets()
            ticket.with_user(self.agent).reply("C'est réglé.")
            ticket.with_user(self.agent).set_state("resolved")
            self.assertTrue(ticket.satisfaction_requested)
            self.post_webhook(self.wa_payload(text="4 merci", wamid="wamid.recu.5"))
            self.assertEqual((ticket.satisfaction_score, ticket.satisfaction_comment), (4, "merci"))
            self.assertEqual(ticket.state, "resolved", "Une note ne rouvre pas le dossier")
            self.env["eguitra.sc.whatsapp"]._cron_run()
            self.assertTrue(any("Merci pour votre avis" in c["json"]["text"]["body"] for c in meta.sent("text")))

    def test_signature_pure(self):
        raw = json.dumps({"a": 1}).encode()
        self.assertTrue(wa.check_signature("s", raw, wa.sign("s", raw)))
        self.assertFalse(wa.check_signature("s", raw + b" ", wa.sign("s", raw)), "Corps modifié")
        self.assertFalse(wa.check_signature("s", raw, None))
        self.assertFalse(wa.check_signature("", raw, wa.sign("", raw)), "Sans secret, rien n'est accepté")
        self.assertEqual(wa.normalize_phone("621 11 11 11"), "224621111111")
        self.assertIsNone(wa.rating_of("12"))
