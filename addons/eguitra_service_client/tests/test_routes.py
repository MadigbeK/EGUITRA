"""Routes internes : refus par profil de chaque route, dossiers assignés aux métiers, lecture de la direction,
séparation des sociétés, saisie pendant un appel, tableau de bord et exports, échéances pour l'agenda."""

from odoo.tests import tagged

from .common import ScCase

T = "/service-client/tickets"


@tagged("post_install", "-at_install")
class TestRoutes(ScCase):
    def setUp(self):
        super().setUp()
        self.assigned = self.ticket(subject="Facture contestée (essai)", user_id=self.fatou.id)
        self.free = self.ticket(subject="Demande d'information (essai)", kind="information")
        self.cabinet_ticket = self.ticket(company=self.cabinet, partner_id=self.client_c.id,
                                          contact_email="contact@client-c.gn", subject="Rapport du dossier (essai)")

    # ─── Refus par profil ────────────────────────────────────────────────

    def test_refus_par_profil_de_chaque_route(self):
        tid = self.free.id
        ALL = ("admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet")
        AGENTS = ("admin",)
        READ_ALL = ("admin", "direction")
        routes = [
            (ALL, "GET", "/service-client/context", None),
            (ALL, "GET", T, None),
            (ALL, "GET", f"{T}/{tid}", None),
            (ALL, "POST", f"{T}/{tid}/state", {"state": "resolved"}),
            (ALL, "POST", f"{T}/{tid}/reply", {"body": "x"}),
            (ALL, "POST", f"{T}/{tid}/note", {"body": "x"}),
            (ALL, "GET", "/service-client/notifications", None),
            (ALL, "GET", "/service-client/deadlines", None),
            (ALL, "GET", "/service-client/categories", None),
            (AGENTS, "POST", T, {"subject": "x", "contact_name": "y"}),
            (AGENTS, "PATCH", f"{T}/{tid}", {"priority": "high"}),
            (AGENTS, "POST", f"{T}/{tid}/merge", {"into_id": self.assigned.id}),
            (AGENTS, "POST", f"{T}/{tid}/satisfaction", {"score": 5}),
            (AGENTS, "POST", f"{T}/{tid}/hsseq", {"mode": "create"}),
            (AGENTS, "GET", "/service-client/clients?q=client", None),
            (AGENTS, "GET", "/service-client/links?model=account.move", None),
            (AGENTS, "GET", "/service-client/client-accounts", None),
            (AGENTS, "POST", "/service-client/client-accounts", {"partner_id": self.client_a.id, "email": "x@y.gn"}),
            (AGENTS, "POST", "/service-client/templates", {"name": "x", "body": "y"}),
            (READ_ALL, "GET", "/service-client/dashboard", None),
            (READ_ALL, "GET", "/service-client/settings", None),
            (("admin",), "PATCH", "/service-client/settings", {"auto_close_days": 3}),
            (("admin",), "POST", "/service-client/categories", {"name": "x"}),
            (("admin",), "POST", "/service-client/teams", {"name": "x"}),
            (("admin",), "GET", "/service-client/inbound", None),
            ((), "GET", "/espace-client/tickets", None),
            ((), "POST", "/espace-client/tickets", {"subject": "x", "description": "y"}),
        ]
        for autorises, method, path, payload in routes:
            self.assertRefuseHors(autorises, method, path, payload, prefixe="refus.sc")
        self.free.invalidate_recordset()
        self.assertEqual((self.free.state, self.free.priority), ("new", "normal"), "Aucun refus n'a rien changé")

    def test_agent_et_client_refuses_ailleurs(self):
        for path in ("/espace-client/tickets", "/espace-client/me"):
            self.api("GET", path, self.agent, status=403)
        for path in ("/service-client/tickets", "/service-client/dashboard", "/service-client/settings"):
            self.api("GET", path, self.user_a, status=403)
        self.api("GET", "/service-client/dashboard", self.fatou, status=403)
        self.api("PATCH", "/service-client/settings", self.agent, {"auto_close_days": 2}, status=403)

    # ─── Métiers, direction, agents ──────────────────────────────────────

    def test_le_metier_ne_voit_que_ses_dossiers(self):
        rows = self.api("GET", T, self.fatou)["items"]
        self.assertEqual([r["id"] for r in rows], [self.assigned.id])
        self.api("GET", f"{T}/{self.free.id}", self.fatou, status=404)
        detail = self.api("POST", f"{T}/{self.assigned.id}/reply", self.fatou, {"body": "L'avoir est en cours."})
        self.assertEqual(detail["state"], "in_progress")
        self.api("POST", f"{T}/{self.assigned.id}/note", self.fatou, {"body": "Avoir n° 12 préparé."})
        self.api("POST", f"{T}/{self.assigned.id}/state", self.fatou, {"state": "resolved"})
        self.api("POST", f"{T}/{self.assigned.id}/state", self.fatou, {"state": "closed"}, status=422)
        self.api("PATCH", f"{T}/{self.assigned.id}", self.fatou, {"priority": "urgent"}, status=403)

    def test_equipe_du_metier(self):
        team = self.env["eguitra.sc.team"].sudo().create({"name": "Exploitation (essai)", "company_id": self.groupe.id,
                                                          "member_ids": [(6, 0, self.bruno.ids)]})
        self.free.sudo().write({"team_id": team.id})
        rows = self.api("GET", T, self.bruno)["items"]
        self.assertEqual([r["id"] for r in rows], [self.free.id])
        self.api("POST", f"{T}/{self.free.id}/reply", self.bruno, {"body": "Le camion arrive."})

    def test_la_direction_lit_tout_et_ne_traite_que_ses_dossiers(self):
        ids = {r["id"] for r in self.api("GET", T, self.dg)["items"]}
        self.assertLessEqual({self.assigned.id, self.free.id}, ids)
        self.api("POST", f"{T}/{self.free.id}/reply", self.dg, {"body": "x"}, status=403)
        self.api("GET", "/service-client/dashboard", self.dg)

    def test_notes_internes_visibles_des_comptes_internes(self):
        self.assigned.with_user(self.agent).post_note("À rappeler après 15 h.")
        detail = self.api("GET", f"{T}/{self.assigned.id}", self.fatou)
        self.assertIn("À rappeler après 15 h.", [m["body"] for m in detail["messages"] if m["kind"] == "note"])

    # ─── Séparation des sociétés ─────────────────────────────────────────

    def test_separation_des_societes(self):
        ids = {r["id"] for r in self.api("GET", T, self.agent)["items"]}
        self.assertNotIn(self.cabinet_ticket.id, ids, "Société de travail : EGUITRA GROUP SARLU")
        self.api("GET", f"{T}/{self.cabinet_ticket.id}", self.agent, status=404)
        rows = self.api("GET", T, self.agent, company=self.cabinet)["items"]
        self.assertEqual([r["id"] for r in rows], [self.cabinet_ticket.id])
        status, body = self.call("GET", T, token=self.token(self.agent_eg), headers={"X-Eguitra-Company": str(self.cabinet.id)})
        self.assertEqual((status, body["error"]), (403, "company_forbidden"))
        self.cabinet_ticket.sudo().write({"user_id": self.consultant.id})
        rows = self.api("GET", T, self.consultant)["items"]
        self.assertEqual([r["id"] for r in rows], [self.cabinet_ticket.id])
        self.api("POST", T, self.agent, {"subject": "x", "partner_id": self.client_c.id}, status=422)

    # ─── Saisie pendant un appel ─────────────────────────────────────────

    def test_saisie_rapide_pendant_un_appel(self):
        found = self.api("GET", "/service-client/clients?q=621 11 11", self.agent)
        partner = next(p for p in found["partners"] if p["id"] == self.client_a.id)
        self.assertIn(self.assigned.id, [t["id"] for t in partner["open"]], "Dossiers en cours du client")
        context = self.api("GET", "/service-client/context", self.agent)
        retard = next(c for c in context["categories"] if c["code"] == "retard")
        detail = self.api("POST", T, self.agent, {
            "subject": "Camion annoncé non arrivé (essai)", "partner_id": self.client_a.id, "channel": "phone",
            "category_id": retard["id"], "priority": "high", "user_id": self.bruno.id,
            "answer": "Nous appelons le chauffeur et vous rappelons."})
        self.assertEqual((detail["kind"], detail["user"]["id"], detail["state"]), ("complaint", self.bruno.id,
                                                                                    "in_progress"))
        self.assertTrue(detail["first_response"], "Réponse donnée pendant l'appel : première réponse")
        self.assertEqual(detail["contact"]["name"], self.client_a.name)
        contact = self.api("POST", T, self.agent, {"subject": "Question (essai)", "contact_name": "Mme Camara",
                                                   "contact_phone": "+224 664 00 00 00"})
        self.assertIsNone(contact["partner"])
        found = self.api("GET", "/service-client/clients?q=664 00 00", self.agent)
        self.assertEqual(found["contacts"][0]["name"], "Mme Camara", "Contact non client retrouvé")
        self.api("POST", T, self.agent, {"subject": "Sans client"}, status=400)

    def test_modification_fusion_et_satisfaction_par_l_api(self):
        detail = self.api("PATCH", f"{T}/{self.free.id}", self.agent, {"priority": "urgent", "user_id": self.agent_eg.id})
        self.assertEqual((detail["priority"], detail["state"]), ("urgent", "assigned"))
        kept = self.api("POST", f"{T}/{self.free.id}/merge", self.agent, {"into_id": self.assigned.id})
        self.assertEqual(kept["id"], self.assigned.id)
        self.api("POST", f"{T}/{self.assigned.id}/state", self.agent, {"state": "resolved"})
        detail = self.api("POST", f"{T}/{self.assigned.id}/satisfaction", self.agent, {"score": 5, "comment": "Merci"})
        self.assertEqual(detail["satisfaction"]["score"], 5)
        self.api("POST", f"{T}/{self.assigned.id}/merge", self.agent, {"into_id": self.cabinet_ticket.id}, status=404)

    def test_reponse_type_rendue(self):
        template = self.api("GET", "/service-client/templates", self.agent)[0]
        body = self.api("GET", f"{T}/{self.free.id}/templates/{template['id']}", self.agent)["body"]
        self.assertIn(self.free.name, body)

    # ─── Tableau de bord, exports et échéances ───────────────────────────

    def test_tableau_de_bord_et_exports(self):
        self.free.sudo().write({"kind": "complaint"})
        data = self.api("GET", "/service-client/dashboard", self.agent)
        self.assertGreaterEqual(data["kpis"]["open"], 2)
        self.assertTrue(any(r["label"] == self.client_a.name for r in data["complaints_by_client"]))
        for fmt, mime in (("xlsx", "spreadsheetml"), ("csv", "text/csv")):
            with self.subTest(fmt=fmt):
                response = self.url_open(f"/api/v1/service-client/dashboard?format={fmt}",
                                         headers={"Authorization": f"Bearer {self.token(self.agent)}"})
                self.assertEqual(response.status_code, 200)
                self.assertIn(mime, response.headers["Content-Type"])

    def test_echeances_pour_l_agenda(self):
        items = self.api("GET", "/service-client/deadlines", self.agent)["items"]
        self.assertIn(self.free.id, {i["res_id"] for i in items})
        self.assertTrue(all(i["res_model"] == "eguitra.sc.ticket" for i in items))
        mine = self.api("GET", "/service-client/deadlines", self.fatou)["items"]
        self.assertEqual({i["res_id"] for i in mine}, {self.assigned.id}, "Le métier : ses dossiers seulement")

    def test_reglages_par_l_administration(self):
        settings = self.api("PATCH", "/service-client/settings", self.admin, {
            "work_start": 7.5, "work_end": 16.5, "first_normal": 4, "public_url": "https://client.nimova.test"})
        self.assertEqual((settings["work_start"], settings["delays"]["normal"]["first"]), (7.5, 4.0))
        self.assertEqual(settings["public_url"], "https://client.nimova.test")
        self.api("PATCH", "/service-client/settings", self.admin, {"public_url": "http://non-chiffre.test"}, status=422)
        self.api("PATCH", "/service-client/settings", self.admin, {"work_start": 18, "work_end": 8}, status=422)
        self.assertIn("WhatsApp", self.api("GET", "/service-client/settings", self.agent)["channels"]["whatsapp"]["message"])
