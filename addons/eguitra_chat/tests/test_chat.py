import io
from unittest.mock import patch

from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from ..models import chat

PDF = b"%PDF-1.4\n% releve\n%%EOF\n"
EXE = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00"
ZIP = b"PK\x03\x04\x14\x00\x00\x00\x08\x00" + b"\x00" * 20


@tagged("post_install", "-at_install")
class TestDiscussion(ApiCase):
    """Discussion interne : conversations à deux, de groupe et de fiche ; confidentialité (membres seuls,
    administration comprise, par les règles d'enregistrement), sociétés, porteurs et comptes sans profil
    refusés, non-lus, pièces jointes contrôlées, retrait d'un message, compte archivé retiré."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["ir.config_parameter"].sudo().set_param("eguitra_api.mfa_required", "0")
        cls.groupe = cls.env.ref("base.main_company")
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        deux = cls.groupe | cls.cabinet
        cls.alice = cls._create_user("alice.chat", "finance")
        cls.bruno = cls._create_user("bruno.chat", "exploitation")
        cls.carla = cls._create_user("carla.chat", "finance")
        cls.dana = cls._create_user("dana.chat", "direction")
        cls.admin = cls._create_user("admin.chat", "admin", company_ids=[(6, 0, deux.ids)])
        cls.sans_profil = cls._create_user("salarie.chat")
        if cls.cabinet:
            cabinet_seul = {"company_id": cls.cabinet.id, "company_ids": [(6, 0, cls.cabinet.ids)]}
            cls.consultant = cls._create_user("consultant.chat", "cabinet", **cabinet_seul)
            cls.porteur = cls._create_user("porteur.chat", "porteur", **cabinet_seul)

    # ─── Outils ──────────────────────────────────────────────────────────

    def session(self, login, app="finance"):
        return self.open_session(login, app=app)["access_token"]

    def direct(self, token, user):
        status, body = self.call("POST", "/chat/conversations", {"kind": "direct", "user_id": user.id}, token=token)
        self.assertEqual(status, 200, body)
        return body

    def post(self, token, channel_id, body="", files=(), reply_to=None):
        data = {"body": body}
        if reply_to:
            data["reply_to"] = str(reply_to)
        uploads = [("file", (name, io.BytesIO(content), "application/octet-stream")) for name, content in files]
        response = self.url_open(f"/api/v1/chat/conversations/{channel_id}/messages", data=data, files=uploads or None,
                                 method="POST", timeout=60,
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"})
        return response.status_code, response.json()

    def write(self, token, channel_id, body):
        status, message = self.post(token, channel_id, body)
        self.assertEqual(status, 200, message)
        return message

    def unread(self, token):
        status, body = self.call("GET", "/chat/unread", token=token)
        self.assertEqual(status, 200, body)
        return body["unread"]

    def messages(self, token, channel_id):
        status, body = self.call("GET", f"/chat/conversations/{channel_id}/messages", token=token)
        self.assertEqual(status, 200, body)
        return body

    # ─── Conversations à deux et non-lus ─────────────────────────────────

    def test_conversation_a_deux_et_non_lus(self):
        alice, bruno = self.session("alice.chat"), self.session("bruno.chat")
        conversation = self.direct(alice, self.bruno)
        self.assertEqual((conversation["kind"], conversation["title"]), ("direct", self.bruno.name))
        self.assertEqual(self.direct(alice, self.bruno)["id"], conversation["id"], "Une seule conversation par paire")
        self.assertEqual(self.direct(bruno, self.alice)["id"], conversation["id"])
        cid = conversation["id"]
        premier = self.write(alice, cid, "Bonjour Bruno")
        self.write(alice, cid, "Le relevé de septembre est arrivé.")
        self.assertEqual(self.unread(bruno), 2)
        self.assertEqual(self.unread(alice), 0, "Ses propres messages ne sont jamais non lus")
        _s, liste = self.call("GET", "/chat/conversations", token=bruno)
        ligne = next(r for r in liste if r["id"] == cid)
        self.assertEqual((ligne["unread"], ligne["title"], ligne["last_message"]["excerpt"]),
                         (2, self.alice.name, "Le relevé de septembre est arrivé."))
        status, body = self.call("POST", f"/chat/conversations/{cid}/read", {"message_id": premier["id"]}, token=bruno)
        self.assertEqual((status, body["unread"]), (200, 1), body)
        status, body = self.call("POST", f"/chat/conversations/{cid}/read", {}, token=bruno)
        self.assertEqual(body["unread"], 0, "Lu jusqu'au dernier message")
        self.call("POST", f"/chat/conversations/{cid}/read", {"message_id": premier["id"]}, token=bruno)
        self.assertEqual(self.unread(bruno), 0, "Le dernier message lu ne recule pas")

        status, reponse = self.post(bruno, cid, "Merci, je regarde.", reply_to=premier["id"])
        self.assertEqual(status, 200, reponse)
        self.assertEqual((reponse["reply_to"]["id"], reponse["reply_to"]["excerpt"]), (premier["id"], "Bonjour Bruno"))
        self.assertEqual(self.unread(alice), 1)
        status, body = self.call("GET", f"/chat/conversations/{cid}/updates?after={premier['id']}", token=alice)
        self.assertEqual((status, [m["body"] for m in body["messages"]]),
                         (200, ["Le relevé de septembre est arrivé.", "Merci, je regarde."]), body)
        status, body = self.post(alice, cid, "   ")
        self.assertEqual(status, 400, "Message vide refusé")
        status, body = self.call("DELETE", f"/chat/conversations/{cid}/members/{self.alice.id}", token=alice)
        self.assertEqual(status, 422, "Une conversation à deux ne se quitte pas")

    # ─── Confidentialité ─────────────────────────────────────────────────

    def test_non_membre_et_administration_ne_lisent_pas(self):
        alice, carla, admin = self.session("alice.chat"), self.session("carla.chat"), self.session("admin.chat")
        cid = self.direct(alice, self.bruno)["id"]
        status, message = self.post(alice, cid, "Projet de budget, confidentiel", files=[("budget.pdf", PDF)])
        self.assertEqual(status, 200, message)
        mid, aid = message["id"], message["attachments"][0]["id"]
        for token, qui in ((carla, "un non-membre"), (admin, "l'administration")):
            _s, liste = self.call("GET", "/chat/conversations", token=token)
            self.assertNotIn(cid, [r["id"] for r in liste], f"Liste : invisible pour {qui}")
            for method, path in (
                ("GET", f"/chat/conversations/{cid}"),
                ("GET", f"/chat/conversations/{cid}/messages"),
                ("GET", f"/chat/conversations/{cid}/updates?after=0"),
                ("POST", f"/chat/conversations/{cid}/read"),
                ("POST", f"/chat/conversations/{cid}/members"),
                ("POST", f"/chat/messages/{mid}/withdraw"),
                ("GET", f"/chat/messages/{mid}/files/{aid}"),
            ):
                status, body = self.call(method, path, {} if method == "POST" else None, token=token)
                self.assertIn(status, (403, 404), f"{method} {path} : refusé à {qui} ({body})")
            status, body = self.post(token, cid, "Intrusion")
            self.assertIn(status, (403, 404), body)
        self.assertEqual(self.env["eguitra.chat.message"].sudo().search_count([("channel_id", "=", cid)]), 1)

        # Règles d'enregistrement, pas seulement les routes : ni l'administration de la plateforme, ni
        # l'administrateur du noyau (groupe Paramètres) ne lisent la conversation par le modèle.
        self.env.invalidate_all()
        for user in (self.admin, self.env.ref("base.user_admin"), self.carla):
            Message = self.env["eguitra.chat.message"].with_user(user)
            self.assertFalse(Message.search([("channel_id", "=", cid)]), user.login)
            self.assertFalse(self.env["eguitra.chat.channel"].with_user(user).search([("id", "=", cid)]), user.login)
            self.assertFalse(self.env["eguitra.chat.member"].with_user(user).search([("channel_id", "=", cid)]))
            with self.assertRaises(AccessError):
                Message.browse(mid).read(["body"])
        self.assertTrue(self.env["eguitra.chat.message"].with_user(self.bruno).search([("channel_id", "=", cid)]))
        # Les messages ne sont pas recopiés dans la piste d'audit lue par l'administration.
        self.assertFalse(self.env["auditlog.rule"].sudo().search([("model_id.model", "=", "eguitra.chat.message")]))
        self.assertTrue(self.env["auditlog.rule"].sudo().search([("model_id.model", "=", "eguitra.chat.channel")]))

    def test_comptes_d_une_autre_societe_refuses(self):
        if not self.cabinet:
            self.skipTest("Société du cabinet absente de la base de test")
        alice, admin = self.session("alice.chat"), self.session("admin.chat")
        status, body = self.call("POST", "/chat/conversations", {"kind": "direct", "user_id": self.consultant.id},
                                 token=alice)
        self.assertEqual(status, 403, body)
        status, body = self.call("POST", "/chat/conversations", {
            "kind": "group", "name": "Groupe mixte", "user_ids": [self.bruno.id, self.consultant.id]}, token=alice)
        self.assertEqual(status, 403, body)
        self.assertFalse(self.env["eguitra.chat.channel"].sudo().search([("name", "=", "Groupe mixte")]))
        _s, trouves = self.call("GET", "/chat/users?q=consultant.chat", token=alice)
        self.assertEqual(trouves, [], "Le cabinet n'est pas proposé à un compte du seul groupe")
        _s, trouves = self.call("GET", "/chat/users?q=chat", token=alice)
        self.assertLessEqual({self.bruno.id, self.carla.id}, {u["id"] for u in trouves})
        self.assertNotIn(self.alice.id, [u["id"] for u in trouves], "Pas soi-même")

        _s, trouves = self.call("GET", "/chat/users?q=consultant.chat", token=admin)
        self.assertEqual([u["id"] for u in trouves], [self.consultant.id], "L'administrateur partage le cabinet")
        self.direct(admin, self.consultant)
        status, groupe = self.call("POST", "/chat/conversations", {
            "kind": "group", "name": "Facturation des honoraires", "user_ids": [self.alice.id, self.consultant.id]},
            token=admin)
        self.assertEqual((status, groupe["members_count"]), (200, 3), groupe)
        status, body = self.call("POST", f"/chat/conversations/{groupe['id']}/members", {"user_ids": [self.bruno.id]},
                                 token=admin)
        self.assertEqual(status, 200, body)

    def test_porteur_et_compte_sans_profil_refuses(self):
        if not self.cabinet:
            self.skipTest("Société du cabinet absente de la base de test")
        alice = self.session("alice.chat")
        cid = self.direct(alice, self.bruno)["id"]
        porteur = self.session("porteur.chat", app="portail")
        sans_profil = self.env["eguitra.api.token"].sudo()._issue_session(self.sans_profil, "finance")["access_token"]
        for token in (porteur, sans_profil):
            for method, path, payload in (
                ("GET", "/chat/unread", None),
                ("GET", "/chat/conversations", None),
                ("GET", "/chat/users?q=alice", None),
                ("POST", "/chat/conversations", {"kind": "direct", "user_id": self.alice.id}),
                ("POST", "/chat/objects", {"model": "eguitra.support.request", "id": 1}),
                ("GET", f"/chat/conversations/{cid}", None),
                ("GET", f"/chat/conversations/{cid}/messages", None),
            ):
                status, body = self.call(method, path, payload, token=token)
                self.assertEqual(status, 403, f"{method} {path} : {body}")
            status, body = self.post(token, cid, "Bonjour")
            self.assertEqual(status, 403, body)
        for user in (self.porteur, self.sans_profil):
            status, body = self.call("POST", "/chat/conversations", {"kind": "direct", "user_id": user.id}, token=alice)
            self.assertEqual(status, 422, f"{user.login} ne reçoit pas de messages : {body}")
        _s, trouves = self.call("GET", "/chat/users?q=chat", token=alice)
        self.assertFalse({self.porteur.id, self.sans_profil.id} & {u["id"] for u in trouves})
        # Le modèle refuse aussi, quel que soit l'appelant.
        with self.assertRaises(AccessError):
            self.env["eguitra.chat.channel"].with_user(self.sans_profil).open_direct(self.alice.id)

    # ─── Discussion d'une fiche ──────────────────────────────────────────

    def test_discussion_d_une_fiche(self):
        """Mécanisme éprouvé sur une demande de l'espace de suivi (eguitra_api, toujours installé) : lisible
        de son auteur, de la direction de sa société et de l'administration, pas d'un collègue."""
        demande = self.env["eguitra.support.request"].with_user(self.alice).create({
            "kind": "question", "severity": "mineure", "app": "finance", "title": "Lettrage des relevés",
            "description": "Comment lettrer un relevé déjà importé ?",
        })
        self.env.flush_all()
        alice, carla = self.session("alice.chat"), self.session("carla.chat")
        dana, admin = self.session("dana.chat"), self.session("admin.chat")
        fiche = {"model": "eguitra.support.request", "id": demande.id}
        with patch.dict(chat.OBJECT_MODELS, {"eguitra.support.request": "Demande"}):
            status, conversation = self.call("POST", "/chat/objects", fiche, token=alice)
            self.assertEqual(status, 200, conversation)
            self.assertEqual((conversation["kind"], conversation["object"]["type"], conversation["object"]["id"]),
                             ("object", "Demande", demande.id))
            cid = conversation["id"]
            self.write(alice, cid, "Je joins la capture demain.")
            status, body = self.call("POST", "/chat/objects", fiche, token=carla)
            self.assertEqual(status, 403, f"Qui ne lit pas la fiche n'ouvre pas sa discussion : {body}")
            status, body = self.call("GET", f"/chat/conversations/{cid}/messages", token=carla)
            self.assertEqual(status, 404, body)
            for token in (dana, admin):
                status, body = self.call("POST", "/chat/objects", fiche, token=token)
                self.assertEqual((status, body.get("id")), (200, cid), "Même discussion pour tous les lecteurs")
                self.assertEqual(self.unread(token), 0, "L'historique trouvé en rejoignant n'est pas non lu")
                self.assertEqual([m["body"] for m in self.messages(token, cid)["messages"]],
                                 ["Je joins la capture demain."])
            self.write(alice, cid, "Capture jointe.")
            self.assertEqual(self.unread(dana), 1)

            # La fiche passe dans l'autre société : la direction du groupe ne la lit plus, ni sa discussion.
            if self.cabinet:
                demande.sudo().company_id = self.cabinet
                self.env.flush_all()
                status, body = self.call("GET", f"/chat/conversations/{cid}/messages", token=dana)
                self.assertEqual(status, 403, body)
                _s, liste = self.call("GET", "/chat/conversations", token=dana)
                self.assertNotIn(cid, [r["id"] for r in liste])
                self.assertEqual(self.unread(dana), 0, "Non-lus d'une fiche qu'on ne lit plus : écartés")
                self.assertEqual(self.messages(alice, cid)["messages"][-1]["body"], "Capture jointe.")

            status, body = self.call("POST", "/chat/objects", {"model": "res.partner", "id": self.alice.partner_id.id},
                                     token=alice)
            self.assertEqual(status, 422, "Seules les fiches prévues portent une discussion")
            status, body = self.call("POST", "/chat/objects", {"model": "eguitra.support.request", "id": 999999},
                                     token=alice)
            self.assertEqual(status, 404, body)

    def test_discussion_d_un_dossier_axispro(self):
        if "axispro.dossier" not in self.env or not self.cabinet:
            self.skipTest("Module AxisPro absent de la base de test")
        from odoo.addons.eguitra_axispro.tests.test_axispro import GRID

        env = self.env(context=dict(self.env.context, allowed_company_ids=self.cabinet.ids))
        env["axispro.policy"].import_grid(self.cabinet, "Politique discussion", "grille.csv", GRID).action_activate()
        dossier = env["axispro.dossier"].create({
            "name": "Briqueterie de Kindia", "promoter_id": env["res.partner"].create({"name": "Briques SA"}).id,
            "company_id": self.cabinet.id, "consultant_id": self.consultant.id,
        })
        self.env.flush_all()
        consultant = self.session("consultant.chat", app="axispro")
        fiche = {"model": "axispro.dossier", "id": dossier.id}
        status, conversation = self.call("POST", "/chat/objects", fiche, token=consultant)
        self.assertEqual((status, conversation.get("object", {}).get("type")), (200, "Dossier"), conversation)
        status, body = self.call("POST", "/chat/objects", fiche, token=self.session("alice.chat"))
        self.assertEqual(status, 403, f"Un compte du seul groupe ne lit pas le dossier : {body}")

    # ─── Pièces jointes ──────────────────────────────────────────────────

    def test_pieces_jointes_controlees(self):
        alice, bruno, carla = self.session("alice.chat"), self.session("bruno.chat"), self.session("carla.chat")
        cid = self.direct(alice, self.bruno)["id"]
        status, message = self.post(alice, cid, "", files=[("releve.exe", PDF)])
        self.assertEqual(status, 200, message)
        piece = message["attachments"][0]
        self.assertEqual((piece["name"], piece["mimetype"]), ("releve.pdf", "application/pdf"),
                         "Nom ramené au format reconnu")
        response = self.url_open(f"/api/v1/chat/messages/{message['id']}/files/{piece['id']}",
                                 headers={"Authorization": f"Bearer {bruno}", "X-Eguitra-App": "test"})
        self.assertEqual((response.status_code, response.content), (200, PDF))
        status, _b = self.call("GET", f"/chat/messages/{message['id']}/files/{piece['id']}", token=carla)
        self.assertEqual(status, 404, "Pièce d'une conversation dont on n'est pas membre")

        avant = self.env["eguitra.chat.message"].sudo().search_count([("channel_id", "=", cid)])
        for nom, contenu in (("installeur.exe", EXE), ("archive.zip", ZIP), ("facture.pdf", b"pas un PDF")):
            status, body = self.post(alice, cid, "Voici le fichier", files=[(nom, contenu)])
            self.assertEqual((status, body.get("error")), (415, "unsupported_type"), f"{nom} : {body}")
        status, body = self.post(alice, cid, "Trop de pièces", files=[(f"p{i}.pdf", PDF) for i in range(6)])
        self.assertEqual(status, 422, body)
        self.env.invalidate_all()
        self.assertEqual(self.env["eguitra.chat.message"].sudo().search_count([("channel_id", "=", cid)]), avant,
                         "Aucun message enregistré quand une pièce est refusée")

    # ─── Retrait d'un message ────────────────────────────────────────────

    def test_message_retire(self):
        alice, bruno = self.session("alice.chat"), self.session("bruno.chat")
        cid = self.direct(alice, self.bruno)["id"]
        repere = self.messages(bruno, cid)["cursor"]
        status, message = self.post(alice, cid, "Texte envoyé par erreur", files=[("note.pdf", PDF)])
        self.assertEqual(status, 200, message)
        self.write(alice, cid, "Le bon texte.")
        status, body = self.call("POST", f"/chat/messages/{message['id']}/withdraw", token=bruno)
        self.assertEqual(status, 403, "Seul l'auteur retire son message")
        status, retire = self.call("POST", f"/chat/messages/{message['id']}/withdraw", token=alice)
        self.assertEqual(status, 200, retire)
        self.assertEqual((retire["withdrawn"], retire["body"], retire["attachments"]), (True, None, []))
        self.assertEqual(self.unread(bruno), 1, "Un message retiré ne compte pas en non-lus")
        fil = self.messages(bruno, cid)["messages"]
        vu = next(m for m in fil if m["id"] == message["id"])
        self.assertEqual((vu["withdrawn"], vu["body"], vu["attachments"]), (True, None, []), "« Message retiré » pour tous")
        status, body = self.call("GET", f"/chat/conversations/{cid}/updates?after={fil[-1]['id']}&since={repere}",
                                 token=bruno)
        self.assertEqual((status, [m["id"] for m in body["changed"]]), (200, [message["id"]]),
                         "La relecture signale le retrait")
        status, body = self.call("POST", f"/chat/messages/{message['id']}/withdraw", token=alice)
        self.assertEqual(status, 422, "Déjà retiré")
        piece = message["attachments"][0]["id"]
        status, body = self.call("GET", f"/chat/messages/{message['id']}/files/{piece}", token=bruno)
        self.assertEqual(status, 404, "La pièce d'un message retiré n'est plus servie")
        status, body = self.post(bruno, cid, "Pardon ?", reply_to=message["id"])
        self.assertEqual(status, 422, "On ne répond pas à un message retiré")
        # Trace gardée en base, jamais servie.
        self.env.invalidate_all()
        trace = self.env["eguitra.chat.message"].sudo().browse(message["id"])
        self.assertEqual((trace.body, bool(trace.withdrawn_date), len(trace.attachment_ids)),
                         ("Texte envoyé par erreur", True, 1))

    # ─── Groupes ─────────────────────────────────────────────────────────

    def test_groupe_et_membres(self):
        alice, bruno, carla = self.session("alice.chat"), self.session("bruno.chat"), self.session("carla.chat")
        status, groupe = self.call("POST", "/chat/conversations", {
            "kind": "group", "name": "  Clôture\nd'octobre ", "user_ids": [self.bruno.id, self.alice.id]}, token=alice)
        self.assertEqual(status, 200, groupe)
        cid = groupe["id"]
        self.assertEqual((groupe["title"], groupe["members_count"], groupe["owner"]), ("Clôture d'octobre", 2, True))
        self.assertEqual(groupe["can"], {"post": True, "add": True, "remove": True, "rename": True, "leave": True})
        self.assertEqual(self.unread(bruno), 0, "Les événements du fil ne comptent pas en non-lus")
        self.assertEqual(self.messages(bruno, cid)["messages"][0]["kind"], "event")
        self.write(bruno, cid, "Les rapprochements sont faits.")

        status, body = self.call("POST", f"/chat/conversations/{cid}/members", {"user_ids": [self.carla.id]}, token=bruno)
        self.assertEqual(status, 403, "Seul le responsable ajoute des membres")
        status, body = self.call("PATCH", f"/chat/conversations/{cid}", {"name": "Autre nom"}, token=bruno)
        self.assertEqual(status, 403, body)
        status, body = self.call("POST", f"/chat/conversations/{cid}/members", {"user_ids": [self.carla.id]}, token=alice)
        self.assertEqual((status, body["members_count"]), (200, 3), body)
        self.assertEqual(self.unread(carla), 0, "Un membre ajouté n'hérite pas de non-lus")
        self.assertIn("Les rapprochements sont faits.", [m["body"] for m in self.messages(carla, cid)["messages"]],
                      "Il lit l'historique")

        status, body = self.call("DELETE", f"/chat/conversations/{cid}/members/{self.alice.id}", token=carla)
        self.assertEqual(status, 403, "Seul le responsable retire un autre membre")
        status, body = self.call("DELETE", f"/chat/conversations/{cid}/members/{self.carla.id}", token=carla)
        self.assertEqual((status, body), (200, {"left": True}))
        status, body = self.call("GET", f"/chat/conversations/{cid}", token=carla)
        self.assertEqual(status, 404, "Parti, il ne lit plus la conversation")

        status, body = self.call("DELETE", f"/chat/conversations/{cid}/members/{self.alice.id}", token=alice)
        self.assertEqual((status, body), (200, {"left": True}))
        status, body = self.call("GET", f"/chat/conversations/{cid}", token=bruno)
        self.assertTrue(body["owner"], "Le responsable parti, le plus ancien membre le devient")
        status, body = self.call("PATCH", f"/chat/conversations/{cid}", {"name": "Clôture de novembre"}, token=bruno)
        self.assertEqual((status, body["title"]), (200, "Clôture de novembre"), body)

    # ─── Compte archivé ──────────────────────────────────────────────────

    def test_compte_archive_retire_par_l_administration(self):
        alice, bruno, admin = self.session("alice.chat"), self.session("bruno.chat"), self.session("admin.chat")
        direct = self.direct(alice, self.bruno)["id"]
        self.write(bruno, direct, "Je pars en congé.")
        status, groupe = self.call("POST", "/chat/conversations", {
            "kind": "group", "name": "Parc", "user_ids": [self.alice.id]}, token=bruno)
        self.assertEqual(status, 200, groupe)

        status, body = self.call("POST", f"/chat/admin/users/{self.bruno.id}/remove", token=admin)
        self.assertEqual(status, 422, f"Compte encore actif : {body}")
        self.bruno.sudo().active = False
        self.env.flush_all()
        status, body = self.call("POST", f"/chat/admin/users/{self.bruno.id}/remove", token=alice)
        self.assertEqual(status, 403, "Réservé à l'administration")
        status, body = self.call("POST", f"/chat/admin/users/{self.bruno.id}/remove", token=admin)
        self.assertEqual((status, body), (200, {"removed": 2}), "Le nombre seul, sans nommer les conversations")
        self.assertFalse(self.env["eguitra.chat.member"].sudo().search([("user_id", "=", self.bruno.id)]))

        status, detail = self.call("GET", f"/chat/conversations/{direct}", token=alice)
        self.assertEqual(status, 200, detail)
        self.assertEqual((detail["can"]["post"], detail["title"]), (False, f"{self.bruno.name} (compte archivé)"))
        status, body = self.post(alice, direct, "Bon congé")
        self.assertEqual(status, 422, body)
        self.assertEqual(self.messages(alice, direct)["messages"][0]["body"], "Je pars en congé.", "Historique gardé")
        status, detail = self.call("GET", f"/chat/conversations/{groupe['id']}", token=alice)
        self.assertTrue(detail["owner"], "Le groupe passe au membre restant")
        status, body = self.call("GET", f"/chat/conversations/{direct}", token=admin)
        self.assertEqual(status, 404, "L'administration ne lit pas pour autant la conversation")

    # ─── Journal des accès ───────────────────────────────────────────────

    def test_relectures_hors_du_journal_des_acces(self):
        alice = self.session("alice.chat")
        cid = self.direct(alice, self.bruno)["id"]
        Log = self.env["eguitra.api.access.log"].sudo()

        def compte():
            self.env.invalidate_all()
            return Log.search_count([("user_id", "=", self.alice.id), ("path", "like", "/api/v1/chat/")])

        avant = compte()
        self.unread(alice)
        self.call("GET", f"/chat/conversations/{cid}/updates?after=0", token=alice)
        self.call("POST", f"/chat/conversations/{cid}/read", {}, token=alice)
        self.assertEqual(compte(), avant, "Les relectures périodiques réussies ne sont pas journalisées")
        self.messages(alice, cid)
        self.assertEqual(compte(), avant + 1, "L'ouverture d'une conversation l'est")
        self.call("GET", "/chat/conversations/999999/updates", token=alice)
        self.assertEqual(compte(), avant + 2, "Un refus l'est toujours")
