from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import HsseqCase

PDF = b"%PDF-1.4\n%%EOF\n"
CLEAN = {"title": "Freinage tardif à l'approche d'un ralentisseur",
         "body": "De nuit, une citerne a freiné tardivement à l'approche d'un ralentisseur non signalé.",
         "key_messages": "Réduisez la vitesse de nuit et anticipez le freinage."}


@tagged("post_install", "-at_install")
class TestDocuments(HsseqCase):
    """Documents et urgences (lot 3) : procédures versionnées, public visé et accusé de lecture par version
    (taux de lecture, relance), alertes flash anonymisées (refus d'un nom ou d'une immatriculation à la
    diffusion), lecture et accusé depuis NIMOVA Terrain, plans d'intervention et exercices, annuaire de crise
    du site du conducteur ; refus par profil des routes d'écriture."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _procedure(self, **values):
        payload = {"code": "PR-HSE-001", "title": "Dépotage d'une citerne", "audience_profiles": ["conducteur", "exploitation"],
                   "site_ids": [self.site.id], "version": "1", "effective_date": str(self.day)}
        payload.update(values)
        status, procedure = self.api("kadi.hsseq", "POST", "/hsseq/procedures", payload)
        self.assertEqual(status, 200, procedure)
        return procedure

    def _publish(self, procedure, version):
        status, document = self.upload("kadi.hsseq", content=PDF, name="procedure.pdf", model="procedure_version",
                                       id=version["id"])
        self.assertEqual((status, document["role"]), (200, "document"), document)
        status, published = self.api("kadi.hsseq", "POST",
                                     f"/hsseq/procedures/{procedure['id']}/versions/{version['id']}/publish")
        self.assertEqual(status, 200, published)
        return published, document

    def _download(self, login, url):
        token = self.token(login)
        self.env.flush_all()
        return self.url_open(f"/api/v1{url}", headers={"Authorization": f"Bearer {token}",
                                                        **(self.headers(login) or {"X-Eguitra-App": "test"})},
                             timeout=60).status_code

    def test_procedure_versionnee_et_accuse_de_lecture(self):
        procedure = self._procedure()
        version = procedure["draft_version"]
        path = f"/hsseq/procedures/{procedure['id']}"
        status, body = self.api("kadi.hsseq", "POST", f"{path}/versions/{version['id']}/publish")
        self.assertEqual((status, body["error"]), (422, "document_missing"), "Document joint avant publication")
        published, document = self._publish(procedure, version)
        self.assertEqual((published["status"], published["current_version"]["version"]), ("published", "1"))
        self.assertEqual(published["read"], {"targets": 2, "read": 0, "rate": 0.0},
                         "Visés : le conducteur de l'ensemble du site et le chef de parc du site")
        notified = self.env["eguitra.hsseq.notification"].search([("user_id", "=", self.conducteur.id),
                                                                   ("kind", "=", "procedure_published")])
        self.assertTrue(notified, "Le conducteur visé est prévenu")
        status, mine = self.driver_api("GET", "/hsseq/my/documents")
        self.assertEqual(status, 200, mine)
        [row] = [p for p in mine["procedures"] if p["id"] == procedure["id"]]
        self.assertEqual((row["read"], row["version"]["version"], len(row["document"])), (False, "1", 1))
        self.assertEqual(mine["unread_count"], 1)
        self.assertEqual(self._download("mamadou.conducteur", document["url"]), 200, "Le conducteur visé lit le document")
        self.assertEqual(self._download("sekou.parc", document["url"]), 404, "Compte non visé")
        read_at = (fields.Datetime.now() - timedelta(minutes=10)).isoformat() + "Z"
        status, ack = self.driver_api("POST", f"{path}/acknowledge", {"read_at": read_at})
        self.assertEqual((status, ack["read"]), (200, True), ack)
        status, again = self.driver_api("POST", f"{path}/acknowledge", {})
        self.assertEqual((status, again["read_at"]), (200, ack["read_at"]), "Accusé idempotent")
        status, _b = self.api("sekou.parc", "POST", f"{path}/acknowledge", {})
        self.assertEqual(status, 404, "Procédure qui ne le vise pas")
        status, detail = self.api("kadi.hsseq", "GET", path)
        self.assertEqual(detail["read"], {"targets": 2, "read": 1, "rate": 50.0})
        self.assertEqual(([r["user"]["id"] for r in detail["readers"]], [u["id"] for u in detail["unread"]]),
                         ([self.conducteur.id], [self.parc.id]))
        self.assertEqual(detail["readers"][0]["source"], "terrain")
        status, reminded = self.api("kadi.hsseq", "POST", f"{path}/remind")
        self.assertEqual((status, reminded["reminded"]), (200, 1), "Relance des seuls comptes qui n'ont pas lu")
        self.assertTrue(self.env["eguitra.hsseq.notification"].search([("user_id", "=", self.parc.id),
                                                                        ("kind", "=", "read_reminder")]))
        # Nouvelle version : la lecture se demande de nouveau.
        status, body = self.api("kadi.hsseq", "POST", f"{path}/versions", {"version": "2",
                                                                           "effective_date": str(self.day)})
        self.assertEqual(status, 200, body)
        status, body = self.api("kadi.hsseq", "POST", f"{path}/versions", {"version": "3",
                                                                           "effective_date": str(self.day)})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Un seul brouillon à la fois")
        status, procedure = self.api("kadi.hsseq", "GET", path)
        published, _doc = self._publish(procedure, procedure["draft_version"])
        self.assertEqual((published["current_version"]["version"], published["read"]["read"]), ("2", 0))
        self.assertEqual([v["status"] for v in published["versions"]], ["published", "superseded"])
        status, body = self.driver_api("POST", f"{path}/acknowledge", {"version_id": version["id"]})
        self.assertEqual((status, body["error"]), (409, "conflict"), "Accusé d'une version remplacée")
        status, mine = self.driver_api("GET", "/hsseq/my/documents?unread=1")
        self.assertEqual([p["id"] for p in mine["procedures"]], [procedure["id"]])
        status, audited = self.api("awa.auditrice", "GET", path)
        self.assertEqual((status, audited["readers"], audited["unread"]), (200, None, None),
                         "Auditeur : le taux, sans les noms")
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"):
            for method, sub, payload in (("POST", "", {"code": "X", "title": "x", "version": "1",
                                                       "effective_date": str(self.day)}),
                                         ("PATCH", f"/{procedure['id']}", {"title": "y"}),
                                         ("POST", f"/{procedure['id']}/remind", {}),
                                         ("POST", f"/{procedure['id']}/archive", {"reason": "x"})):
                status, _b = self.api(login, method, f"/hsseq/procedures{sub}", payload)
                self.assertEqual(status, 403, f"{login} {method} {sub}")
        status, _b = self.driver_api("GET", "/hsseq/procedures")
        self.assertEqual(status, 403, "Gestion des procédures : pas le conducteur")

    def test_relance_planifiee_des_lectures(self):
        procedure = self._procedure(code="PR-HSE-002")
        self._publish(procedure, procedure["draft_version"])
        version = self.env["eguitra.hsseq.procedure.version"].browse(procedure["draft_version"]["id"])
        Ack = self.env["eguitra.hsseq.acknowledgment"]
        Ack._cron_reminders()
        self.assertFalse(version.reminded_on, "Publiée aujourd'hui : pas encore de relance")
        version.published_at = fields.Datetime.now() - timedelta(days=8)
        Ack._cron_reminders()
        self.assertEqual(version.reminded_on, self.day)
        reminders = self.env["eguitra.hsseq.notification"].search([("kind", "=", "read_reminder"),
                                                                    ("channel", "=", "app")])
        self.assertEqual(set(reminders.user_id.ids), {self.conducteur.id, self.parc.id})

    def test_alerte_flash_anonymisee(self):
        status, bulletin = self.api("kadi.hsseq", "POST", "/hsseq/bulletins", dict(
            CLEAN, body="Le conducteur Mamadou Diallo a freiné tardivement."))
        self.assertEqual((status, bulletin["kind"], bulletin["status"]), (200, "flash_alert", "draft"), bulletin)
        self.assertTrue(bulletin["reference"].startswith("ALF/"))
        self.assertEqual({(f["kind"], f["field"]) for f in bulletin["anonymity_findings"]}, {("person", "body")},
                         "Contrôle visible avant diffusion")
        path = f"/hsseq/bulletins/{bulletin['id']}"
        status, body = self.api("kadi.hsseq", "POST", f"{path}/publish")
        self.assertEqual((status, body["error"], body["fields"]), (422, "not_anonymized", ["body"]), body)
        self.assertIn("Mamadou Diallo", body["message"])
        for text in ("Le camion RC 1234 A a freiné tardivement.", "L'ensemble ER-01 a freiné tardivement.",
                     "Un camion AB-777-CD a freiné tardivement."):
            status, _b = self.api("kadi.hsseq", "PATCH", path, {"body": text})
            status, body = self.api("kadi.hsseq", "POST", f"{path}/publish")
            self.assertEqual((status, body["error"]), (422, "not_anonymized"), f"Immatriculation : {text}")
        status, _b = self.api("kadi.hsseq", "PATCH", path, {"body": CLEAN["body"], "title": "Diallo Mamadou au volant"})
        status, body = self.api("kadi.hsseq", "POST", f"{path}/publish")
        self.assertEqual((status, body["fields"]), (422, ["title"]), "Nom dans le titre, prénom et nom inversés")
        # Événement d'origine : un seul mot du nom de son déclarant suffit à refuser.
        event = self.event()
        status, lesson = self.api("kadi.hsseq", "POST", "/hsseq/bulletins", dict(
            CLEAN, kind="lesson", event_id=event.id, body="Situation signalée par Ibrahima au quai de chargement."))
        self.assertTrue(lesson["reference"].startswith("REX/"))
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/bulletins/{lesson['id']}/publish")
        self.assertEqual((status, body["error"]), (422, "not_anonymized"))
        status, _b = self.api("kadi.hsseq", "PATCH", path, {"title": CLEAN["title"]})
        status, published = self.api("kadi.hsseq", "POST", f"{path}/publish")
        self.assertEqual((status, published["status"]), (200, "published"), published)
        self.assertEqual(published["read"]["targets"], 3, "Conducteur et chefs de parc de tous les sites")
        status, body = self.api("kadi.hsseq", "PATCH", path, {"body": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Diffusée : plus de modification")
        status, mine = self.driver_api("GET", "/hsseq/my/documents")
        [row] = [b for b in mine["bulletins"] if b["id"] == bulletin["id"]]
        self.assertEqual((row["read"], row["body"]), (False, CLEAN["body"]))
        self.assertNotIn("event", row, "Jamais l'événement d'origine au lecteur")
        status, ack = self.driver_api("POST", f"{path}/acknowledge", {})
        self.assertEqual((status, ack["read"]), (200, True), ack)
        status, _b = self.driver_api("POST", f"/hsseq/bulletins/{lesson['id']}/acknowledge", {})
        self.assertEqual(status, 404, "Brouillon : pas encore diffusé")
        status, audited = self.api("awa.auditrice", "GET", path)
        self.assertEqual((status, audited["event"], audited["readers"]), (200, None, None))
        status, listing = self.api("awa.auditrice", "GET", "/hsseq/bulletins")
        self.assertEqual([b["id"] for b in listing["items"]], [bulletin["id"]], "L'auditeur ne lit pas les brouillons")
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"):
            status, _b = self.api(login, "POST", "/hsseq/bulletins", CLEAN)
            self.assertEqual(status, 403, f"{login} ne rédige pas d'alerte")
            status, _b = self.api(login, "POST", f"/hsseq/bulletins/{lesson['id']}/publish")
            self.assertEqual(status, 403, f"{login} ne diffuse pas d'alerte")
        status, _b = self.driver_api("POST", "/hsseq/bulletins", CLEAN)
        self.assertEqual(status, 403)

    def test_plans_exercices_et_annuaire_de_crise(self):
        contacts = {}
        for key, site, order, function in (("site", self.site, 1, "Chef de dépôt"), ("common", None, 2, "Sapeurs-pompiers"),
                                           ("other", self.site2, 1, "Chef de base")):
            status, contact = self.api("kadi.hsseq", "POST", "/hsseq/crisis-contacts", {
                "site_id": site.id if site else None, "function": function, "name": f"Contact {key}",
                "phone": "620000001", "call_order": order})
            self.assertEqual(status, 200, contact)
            contacts[key] = contact["id"]
        status, directory = self.driver_api("GET", "/hsseq/my/crisis-contacts")
        self.assertEqual(status, 200, directory)
        self.assertEqual([c["id"] for c in directory["items"]], [contacts["site"], contacts["common"]],
                         "Annuaire du site de son ensemble, contacts communs compris, dans l'ordre d'appel")
        status, audited = self.api("awa.auditrice", "GET", "/hsseq/crisis-contacts")
        self.assertEqual({c["id"] for c in audited}, {contacts["site"], contacts["common"]})
        status, plan = self.api("kadi.hsseq", "POST", "/hsseq/emergency-plans", {
            "site_id": self.site.id, "scenario": "spill", "title": "Déversement au dépotage",
            "response": "Arrêter le dépotage, contenir, alerter.", "contact_ids": [contacts["site"], contacts["common"]]})
        self.assertEqual((status, len(plan["contacts"])), (200, 2), plan)
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/emergency-plans", {
            "site_id": self.site.id, "scenario": "spill", "title": "Doublon", "response": "x"})
        self.assertEqual(status, 422, "Un plan en vigueur par site et par scénario")
        status, drill = self.api("kadi.hsseq", "POST", f"/hsseq/emergency-plans/{plan['id']}/drills",
                                 {"planned_date": str(self.day - timedelta(days=1))})
        self.assertEqual((status, drill["status"], drill["overdue"]), (200, "planned", True), drill)
        path = f"/hsseq/drills/{drill['id']}"
        status, body = self.api("kadi.hsseq", "POST", f"{path}/perform", {})
        self.assertEqual((status, body["error"]), (422, "debrief_required"))
        status, done = self.api("kadi.hsseq", "POST", f"{path}/perform", {
            "debrief": "Kit antidéversement incomplet au quai 2.", "participants_count": 9})
        self.assertEqual((status, done["status"], done["performed_date"]), (200, "done", str(self.day)), done)
        status, action = self.api("kadi.hsseq", "POST", "/hsseq/actions", {
            "origin": "drill", "origin_id": drill["id"], "description": "Compléter le kit antidéversement",
            "owner_id": self.parc.id, "due_date": str(self.day + timedelta(days=7))})
        self.assertEqual((status, action["origin"], action["site"]["id"]), (200, "drill", self.site.id), action)
        status, mine = self.api("ibrahima", "GET", "/hsseq/emergency-plans")
        self.assertEqual(([p["id"] for p in mine["items"]], mine["items"][0]["last_drill"]), ([plan["id"]], str(self.day)))
        status, other = self.api("sekou.parc", "GET", "/hsseq/emergency-plans")
        self.assertEqual(other["items"], [], "Plans d'un autre site")
        status, _b = self.api("sekou.parc", "GET", path)
        self.assertEqual(status, 404)
        routes = [
            ("POST", "/hsseq/emergency-plans", {"site_id": self.site.id, "scenario": "fire", "title": "x", "response": "x"}),
            ("PATCH", f"/hsseq/emergency-plans/{plan['id']}", {"title": "y"}),
            ("POST", f"/hsseq/emergency-plans/{plan['id']}/drills", {"planned_date": str(self.day)}),
            ("PATCH", path, {"debrief": "y"}),
            ("POST", f"{path}/reopen", {"reason": "x"}),
            ("POST", "/hsseq/crisis-contacts", {"function": "x", "name": "x", "phone": "1"}),
            ("PATCH", f"/hsseq/crisis-contacts/{contacts['site']}", {"phone": "2"}),
        ]
        for method, route, payload in routes:
            for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"):
                status, _b = self.api(login, method, route, payload)
                self.assertEqual(status, 403, f"{login} {method} {route}")
            status, _b = self.driver_api(method, route, payload)
            self.assertEqual(status, 403, f"conducteur {method} {route}")
