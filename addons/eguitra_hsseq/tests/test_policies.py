import io
import zipfile
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import fields
from odoo.tests import tagged

from ..models.common import AUDIENCE_PROFILES, HsseqError
from .common import HsseqCase

PDF = b"%PDF-1.4\n%%EOF\n"
TEXT = ("La direction s'engage à protéger la santé et la sécurité de chaque salarié et sous-traitant, à prévenir "
        "les pollutions et à livrer sans écart.")
CLEAN = {"title": "Freinage tardif à l'approche d'un ralentisseur",
         "body": "De nuit, une citerne a freiné tardivement à l'approche d'un ralentisseur non signalé."}


@tagged("post_install", "-at_install")
class TestPolicies(HsseqCase):
    """Référentiel documentaire HSE (29/10) : types et références, hiérarchie et arbre, politique approuvée par
    la direction (quatre yeux), refus et retrait, revue périodique et ses alertes, action tirée d'une revue,
    diffusion et accusés (NIMOVA Terrain compris), tableau de bord et son export, document à afficher en PDF,
    refus par profil de chaque route ; non-régression des procédures publiées directement et des alertes
    flash."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})
        # Compte qui rédige et dirige : il ne peut pas approuver la politique qu'il a soumise.
        cls.dirhsseq = cls._create_user("moussa.dirhsseq", "direction", "hsseq")

    # ─── Outils ───────────────────────────────────────────────────────────

    def _create(self, login="kadi.hsseq", **values):
        payload = {"doc_type": "policy", "title": "Politique santé, sécurité et environnement", "version": "1",
                   "effective_date": str(self.day), "body": TEXT, "audience_profiles": ["conducteur", "exploitation"],
                   "site_ids": [self.site.id]}
        payload.update(values)
        status, doc = self.api(login, "POST", "/hsseq/procedures", payload)
        self.assertEqual(status, 200, doc)
        return doc

    def _go(self, login, doc, transition, payload=None):
        """Geste sur la version en préparation du document."""
        version = doc["draft_version"]
        return self.api(login, "POST", f"/hsseq/procedures/{doc['id']}/versions/{version['id']}/{transition}",
                        payload or {})

    def _approved_policy(self, **values):
        doc = self._create(**values)
        status, doc = self._go("kadi.hsseq", doc, "submit")
        self.assertEqual(status, 200, doc)
        status, doc = self._go("dg.hsseq", doc, "approve")
        self.assertEqual((status, doc.get("status")), (200, "published"), doc)
        return doc

    def _get(self, login, url):
        token = self.token(login)
        self.env.flush_all()
        return self.url_open(f"/api/v1{url}", headers={"Authorization": f"Bearer {token}",
                                                        **(self.headers(login) or {"X-Eguitra-App": "test"})},
                             timeout=120)

    # ─── Types et hiérarchie ──────────────────────────────────────────────

    def test_types_references_et_hierarchie(self):
        policy = self._create()
        self.assertEqual((policy["doc_type"], policy["code"], policy["status"]), ("policy", "POL-HSE-001", "draft"))
        status, default = self.api("kadi.hsseq", "POST", "/hsseq/procedures", {
            "doc_type": "policy", "title": "Politique alcool et drogues", "version": "1",
            "effective_date": str(self.day)})
        self.assertEqual((status, default["code"], set(default["audience"]["profiles"])),
                         (200, "POL-HSE-002", set(AUDIENCE_PROFILES)), "Suite du type ; une politique vise tout le personnel")
        status, legacy = self.api("kadi.hsseq", "POST", "/hsseq/procedures", {
            "title": "Chargement au dépôt", "version": "1", "effective_date": str(self.day)})
        self.assertEqual((legacy["doc_type"], legacy["code"]), ("procedure", "PR-HSE-001"),
                         "Sans type : une procédure, comme avant")
        procedure = self._create(doc_type="procedure", title="Dépotage d'une citerne", parent_id=policy["id"], body=None)
        self.assertEqual((procedure["code"], procedure["parent"]["id"]), ("PR-HSE-002", policy["id"]))
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/procedures", {
            "doc_type": "work_instruction", "title": "Mode opératoire", "parent_id": policy["id"], "version": "1",
            "effective_date": str(self.day)})
        self.assertEqual((status, body["error"], body["fields"]), (422, "invalid_parent", ["parent_id"]),
                         "Une instruction de travail se rattache à une procédure")
        instruction = self._create(doc_type="work_instruction", title="Branchement du flexible", parent_id=procedure["id"],
                                   body=None)
        instruction_rule = self._create(doc_type="instruction", title="Consigne de dépotage", parent_id=instruction["id"],
                                        body="Moteur coupé, cales en place, extincteur à portée de main.")
        form = self._create(doc_type="form", title="Fiche de dépotage", parent_id=procedure["id"], body=None)
        self.assertEqual((instruction["code"], instruction_rule["code"], form["code"]),
                         ("IT-HSE-001", "CS-HSE-001", "FO-HSE-001"))
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/procedures/{policy['id']}", {"parent_id": procedure["id"]})
        self.assertEqual((status, body["error"]), (422, "invalid_parent"), "Une politique ne se rattache à aucun document")
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/procedures/{procedure['id']}", {"doc_type": "form"})
        self.assertEqual((status, body["error"]), (422, "invalid_parent"), "Ses documents rattachés exigent une procédure")
        manual = self._create(doc_type="procedure", code="PR-HSE-007", title="Saisie manuelle", body=None,
                              site_ids=[self.site2.id])
        following = self._create(doc_type="procedure", title="Suite", body=None)
        self.assertEqual((manual["code"], following["code"]), ("PR-HSE-007", "PR-HSE-008"),
                         "Référence suivante après la plus grande, saisie à la main comprise")
        # Arbre : chaque politique et ce qui la met en œuvre, par type puis référence.
        status, tree = self.api("kadi.hsseq", "GET", "/hsseq/procedures/tree")
        self.assertEqual(status, 200, tree)
        roots = {n["code"]: n for n in tree["items"]}
        self.assertEqual([c["code"] for c in roots["POL-HSE-001"]["children"]], ["PR-HSE-002"])
        [pr] = roots["POL-HSE-001"]["children"]
        self.assertEqual([c["code"] for c in pr["children"]], ["IT-HSE-001", "FO-HSE-001"])
        self.assertEqual([c["code"] for c in pr["children"][0]["children"]], ["CS-HSE-001"])
        self.assertIn("PR-HSE-001", roots, "Document sans rattachement à la racine")
        self.assertEqual(tree["total_count"], 9)
        # Liste filtrable par type et par site, compteurs par type aux autres filtres.
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/procedures?doc_type=policy")
        self.assertEqual({p["code"] for p in listing["items"]}, {"POL-HSE-001", "POL-HSE-002"})
        self.assertEqual((listing["counts"]["by_type"]["policy"], listing["counts"]["by_type"]["procedure"]), (2, 4))
        status, listing = self.api("kadi.hsseq", "GET", f"/hsseq/procedures?site_id={self.site.id}")
        codes = {p["code"] for p in listing["items"]}
        self.assertNotIn("PR-HSE-007", codes, "Document du seul site de Boffa")
        self.assertIn("POL-HSE-002", codes, "Document de tous les sites")
        status, detail = self.api("kadi.hsseq", "GET", f"/hsseq/procedures/{procedure['id']}")
        self.assertEqual(([c["code"] for c in detail["children"]], detail["parent"]["code"]),
                         (["IT-HSE-001", "FO-HSE-001"], "POL-HSE-001"))
        # Une consigne courte se publie sur son texte ; son type ne change plus ensuite.
        status, published = self._go("kadi.hsseq", instruction_rule, "publish")
        self.assertEqual((status, published["status"], published["poster"]), (200, "published", True), published)
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/procedures/{instruction_rule['id']}", {"doc_type": "form"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"))

    # ─── Politique : approbation de la direction ──────────────────────────

    def test_politique_approuvee_par_la_direction_quatre_yeux(self):
        doc = self._create(body=None, objectives=[
            {"label": "Zéro accident du travail avec arrêt"},
            {"label": "Taux de fréquence sous 3", "indicator_code": "frequency_rate", "target": 3},
            {"label": "Tous les départs contrôlés", "indicator_code": "check_completion"}])
        objectives = doc["draft_version"]["objectives"]
        self.assertEqual([(o["label"], o["indicator_code"], o["target"]) for o in objectives],
                         [("Zéro accident du travail avec arrêt", None, None),
                          ("Taux de fréquence sous 3", "frequency_rate", 3.0),
                          ("Tous les départs contrôlés", "check_completion", 100.0)],
                         "Cible des réglages à défaut")
        self.assertTrue({o["status"] for o in objectives[1:]} <= {"met", "watch", "missed", "no_data"})
        path = f"/hsseq/procedures/{doc['id']}"
        status, body = self._go("kadi.hsseq", doc, "publish")
        self.assertEqual((status, body["error"]), (422, "direction_approval_required"), "Pas de publication directe")
        status, body = self._go("kadi.hsseq", doc, "submit")
        self.assertEqual((status, body["error"]), (422, "text_missing"), "Texte de l'engagement d'abord")
        status, doc = self.api("kadi.hsseq", "PATCH", f"{path}/versions/{doc['draft_version']['id']}", {"body": TEXT})
        self.assertEqual(status, 200, doc)
        status, doc = self._go("kadi.hsseq", doc, "submit")
        self.assertEqual((status, doc["draft_version"]["status"], doc["version_actions"]), (200, "submitted", ["withdraw"]),
                         doc)
        self.assertTrue(self.env["eguitra.hsseq.notification"].search([
            ("kind", "=", "document_submitted"), ("user_id", "=", self.dg.id), ("res_id", "=", doc["id"])]),
            "La direction est prévenue")
        status, body = self.api("kadi.hsseq", "PATCH", f"{path}/versions/{doc['draft_version']['id']}", {"body": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Soumise : plus de modification")
        for login in ("kadi.hsseq", "binta.hsseq", "admin.hsseq"):
            status, body = self._go(login, doc, "approve")
            self.assertEqual(status, 403, f"{login} n'approuve pas une politique")
        status, seen = self.api("dg.hsseq", "GET", path)
        self.assertEqual(seen["version_actions"], ["approve", "reject"])
        status, approved = self._go("dg.hsseq", doc, "approve")
        self.assertEqual(status, 200, approved)
        current = approved["current_version"]
        self.assertEqual((approved["status"], current["status"], current["approved_by"]["id"], approved["draft_version"]),
                         ("published", "published", self.dg.id, None))
        self.assertTrue(current["approved_at"])
        self.assertEqual(approved["review"]["next_review_date"], str(self.day + relativedelta(months=12)),
                         "Revue annuelle par défaut")
        self.assertTrue({"submit", "approve"} <= {h["action"] for h in approved["history"]}, "Journal HSSEQ")
        # Quatre yeux : la direction qui a soumis la politique ne l'approuve pas.
        second = self._create(login="moussa.dirhsseq", title="Politique de conduite")
        status, second = self._go("moussa.dirhsseq", second, "submit")
        self.assertEqual((status, second["version_actions"]), (200, ["withdraw"]))
        status, body = self._go("moussa.dirhsseq", second, "approve")
        self.assertEqual((status, body["error"]), (422, "four_eyes"))
        status, body = self._go("dg.hsseq", second, "approve")
        self.assertEqual(status, 200, body)
        # Nouvelle version : texte et objectifs repris ; refus motivé, puis retrait.
        status, revised = self.api("kadi.hsseq", "POST", f"{path}/versions", {
            "version": "2", "effective_date": str(self.day), "change_summary": "Cible revue"})
        self.assertEqual((revised["draft_version"]["body"], len(revised["draft_version"]["objectives"])), (TEXT, 3))
        status, revised = self._go("kadi.hsseq", revised, "submit")
        status, body = self._go("dg.hsseq", revised, "reject")
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, rejected = self._go("dg.hsseq", revised, "reject", {"reason": "Cible trop faible"})
        self.assertEqual((rejected["draft_version"]["status"], rejected["draft_version"]["reject_reason"],
                          rejected["current_version"]["version"]), ("draft", "Cible trop faible", "1"))
        self.assertTrue(self.env["eguitra.hsseq.notification"].search([
            ("kind", "=", "document_rejected"), ("user_id", "=", self.hsseq.id)]), "Le rédacteur est prévenu")
        status, again = self._go("kadi.hsseq", rejected, "submit")
        status, body = self._go("dg.hsseq", again, "withdraw")
        self.assertEqual(status, 403, "Le retrait revient au Responsable HSSEQ")
        status, withdrawn = self._go("kadi.hsseq", again, "withdraw")
        self.assertEqual((status, withdrawn["draft_version"]["status"]), (200, "draft"))
        # L'auditeur lit l'approbation, sans commande ni nom de lecteur.
        status, audited = self.api("awa.auditrice", "GET", path)
        self.assertEqual((status, audited["current_version"]["approved_by"]["id"], audited["readers"],
                          audited["version_actions"]), (200, self.dg.id, None, []))

    def test_quatre_yeux_retient_chaque_modificateur(self):
        """Revue de sécurité : un compte qui a modifié le texte, les objectifs ou une pièce d'une version ne
        l'approuve pas, même s'il ne l'a ni créée ni soumise."""
        doc = self._create(title="Politique de conduite défensive")
        path = f"/hsseq/procedures/{doc['id']}"
        status, edited = self.api("moussa.dirhsseq", "PATCH", f"{path}/versions/{doc['draft_version']['id']}",
                                  {"body": f"{TEXT} Conduite défensive pour tous."})
        self.assertEqual(status, 200, edited)
        self.assertEqual({u["id"] for u in edited["draft_version"]["edited_by"]}, {self.hsseq.id, self.dirhsseq.id})
        status, submitted = self._go("kadi.hsseq", edited, "submit")
        self.assertEqual(status, 200, submitted)
        status, seen = self.api("moussa.dirhsseq", "GET", path)
        self.assertEqual(seen["version_actions"], ["withdraw"], "Ni approbation ni refus pour un modificateur")
        status, body = self._go("moussa.dirhsseq", submitted, "approve")
        self.assertEqual((status, body["error"]), (422, "four_eyes"), "Modificateur du texte")
        status, approved = self._go("dg.hsseq", submitted, "approve")
        self.assertEqual(status, 200, approved)
        # Les objectifs seuls, puis une pièce jointe seule, suffisent à faire d'un compte un rédacteur.
        for change in ("objectives", "attachment"):
            other = self._create(title=f"Politique d'essai ({change})")
            version_id = other["draft_version"]["id"]
            if change == "objectives":
                status, body = self.api("moussa.dirhsseq", "PATCH", f"/hsseq/procedures/{other['id']}/versions/{version_id}",
                                        {"objectives": [{"label": "Zéro déversement", "indicator_code": "spills",
                                                         "target": 0}]})
            else:
                status, body = self.upload("moussa.dirhsseq", content=PDF, name="politique.pdf",
                                           model="procedure_version", id=version_id)
            self.assertEqual(status, 200, body)
            status, other = self._go("kadi.hsseq", other, "submit")
            status, body = self._go("moussa.dirhsseq", other, "approve")
            self.assertEqual((status, body["error"]), (422, "four_eyes"), change)
        # Le noyau le refuse aussi hors de l'API.
        version = self.env["eguitra.hsseq.procedure.version"].browse(other["draft_version"]["id"])
        with self.assertRaises(HsseqError):
            version.with_user(self.dirhsseq).action_approve()

    def test_objectifs_lus_dans_la_portee_du_lecteur(self):
        """Revue de sécurité : la valeur d'un objectif relié au cockpit se calcule dans la portée du lecteur,
        comme au cockpit : toute la société pour la lecture complète, les seuls sites de l'auditeur sinon."""
        doc = self._approved_policy(objectives=[{"label": "Zéro déversement", "indicator_code": "spills",
                                                 "target": 0}])
        self.env["eguitra.hsseq.spill"].create({
            "company_id": self.company.id, "site_id": self.site2.id, "occurred_at": fields.Datetime.now() - timedelta(hours=2),
            "volume_liters": 20, "location": "Quai de Boffa", "status": "open"})
        path = f"/hsseq/procedures/{doc['id']}"
        status, full = self.api("kadi.hsseq", "GET", path)
        [objective] = full["current_version"]["objectives"]
        self.assertEqual((objective["value"], objective["status"]), (1, "missed"), "Toute la société")
        status, audited = self.api("awa.auditrice", "GET", path)
        self.assertEqual(status, 200, audited)
        [objective] = audited["current_version"]["objectives"]
        self.assertEqual(objective["value"], 0, "Déversement d'un autre site : hors de la portée de l'auditeur")

    # ─── Revue périodique ─────────────────────────────────────────────────

    def test_revue_periodique_alerte_et_action(self):
        doc = self._approved_policy()
        path = f"/hsseq/procedures/{doc['id']}"
        Document = self.env["eguitra.hsseq.procedure"]
        record = Document.browse(doc["id"])
        Notification = self.env["eguitra.hsseq.notification"]
        status, body = self.api("kadi.hsseq", "PATCH", path, {"next_review_date": str(self.day)})
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"), "Prochaine revue après aujourd'hui")
        status, patched = self.api("kadi.hsseq", "PATCH", path, {"next_review_date": str(self.day + timedelta(days=10))})
        self.assertEqual((status, patched["review"]["state"]), (200, "due"), patched)
        Document._cron_review_alerts()
        due = [("kind", "=", "document_review_due"), ("res_id", "=", record.id), ("channel", "=", "app")]
        users = set(Notification.search(due).user_id.ids)
        self.assertTrue({self.hsseq.id, self.hsseq2.id, self.dg.id} <= users,
                        "Responsables HSSEQ et direction prévenus avant l'échéance")
        Document._cron_review_alerts()
        self.assertEqual(len(set(Notification.search(due).user_id.ids)), len(users))
        self.assertEqual(Notification.search_count(due), len(users), "Une seule alerte avant l'échéance")
        record.write({"next_review_date": self.day - timedelta(days=3)})
        Document._cron_review_alerts()
        overdue = [("kind", "=", "document_review_overdue"), ("res_id", "=", record.id), ("channel", "=", "app")]
        count = Notification.search_count(overdue)
        self.assertTrue(count, "Revue en retard relancée")
        Document._cron_review_alerts()
        self.assertEqual(Notification.search_count(overdue), count, "Une relance par semaine")
        # Revue tracée : reconduite, avec l'action qui en découle.
        for payload, expected in (({"outcome": "renewed"}, (400, "missing_fields")),
                                  ({"outcome": "kept", "comment": "x"}, (400, "invalid_parameter")),
                                  ({"outcome": "renewed", "comment": "x", "reviewed_on": str(self.day + timedelta(days=1))},
                                   (400, "invalid_parameter"))):
            status, body = self.api("kadi.hsseq", "POST", f"{path}/reviews", payload)
            self.assertEqual((status, body["error"]), expected, payload)
        status, renewed = self.api("kadi.hsseq", "POST", f"{path}/reviews", {
            "outcome": "renewed", "comment": "Politique toujours adaptée aux activités.",
            "action": {"description": "Afficher la politique au quai de chargement", "owner_id": self.parc.id,
                       "due_date": str(self.day + timedelta(days=15))}})
        self.assertEqual(status, 200, renewed)
        self.assertEqual((renewed["review"]["next_review_date"], renewed["review"]["last_review_date"],
                          renewed["review"]["state"]),
                         (str(self.day + relativedelta(months=12)), str(self.day), "scheduled"))
        [review] = renewed["reviews"]
        [action] = review["actions"]
        self.assertEqual((review["outcome"], review["reviewer"]["id"], action["origin"], action["origin_id"],
                          action["site"]["id"]), ("renewed", self.hsseq.id, "document", doc["id"], self.site.id))
        status, listing = self.api("kadi.hsseq", "GET", f"/hsseq/actions?origin=document&document_id={doc['id']}")
        self.assertEqual([a["id"] for a in listing["items"]], [action["id"]])
        self.assertTrue(listing["items"][0]["origin_label"].startswith(doc["code"]))
        status, mine = self.api("ibrahima", "GET", f"/hsseq/actions/{action['id']}")
        self.assertEqual(status, 200, "Le responsable lit son action")
        # Nouvelle version à rédiger : brouillon repris, plus de relance tant qu'il est en préparation.
        status, revised = self.api("kadi.hsseq", "POST", f"{path}/reviews", {
            "outcome": "revised", "comment": "Ajouter les sous-traitants."})
        self.assertEqual(status, 200, revised)
        draft = revised["draft_version"]
        self.assertEqual((draft["version"], draft["status"], draft["body"]), ("2", "draft", TEXT))
        self.assertIn("Revue du", draft["change_summary"])
        self.assertTrue(revised["review"]["in_progress"])
        self.assertEqual(revised["reviews"][0]["new_version"]["id"], draft["id"])
        record.write({"next_review_date": self.day - timedelta(days=1)})
        before = Notification.search_count(overdue)
        Document._cron_review_alerts()
        self.assertEqual(Notification.search_count(overdue), before, "Nouvelle version en préparation : pas de relance")
        status, revised = self._go("kadi.hsseq", revised, "submit")
        status, approved = self._go("dg.hsseq", revised, "approve")
        self.assertEqual((approved["current_version"]["version"], approved["review"]["next_review_date"],
                          approved["review"]["in_progress"]), ("2", str(self.day + relativedelta(months=12)), False))
        # Revue d'un document qui n'est pas en vigueur : refusée.
        draft_doc = self._create(title="Politique qualité")
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/procedures/{draft_doc['id']}/reviews",
                                {"outcome": "renewed", "comment": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"))

    # ─── Diffusion, accusés, tableau de bord ──────────────────────────────

    def test_diffusion_accuses_et_tableau_de_bord(self):
        doc = self._approved_policy()
        self.assertTrue(self.env["eguitra.hsseq.notification"].search([
            ("kind", "=", "procedure_published"), ("user_id", "=", self.conducteur.id), ("res_id", "=", doc["id"])]),
            "Le conducteur visé est prévenu")
        status, mine = self.driver_api("GET", "/hsseq/my/documents")
        self.assertEqual(status, 200, mine)
        [row] = [p for p in mine["procedures"] if p["id"] == doc["id"]]
        self.assertEqual((row["doc_type"], row["body"], row["read"], row["version"]["approved_by"]["id"], row["document"]),
                         ("policy", TEXT, False, self.dg.id, []), "La politique passe sur NIMOVA Terrain, texte compris")
        status, ack = self.driver_api("POST", f"/hsseq/procedures/{doc['id']}/acknowledge",
                                      {"version_id": row["version"]["id"]})
        self.assertEqual((status, ack["read"]), (200, True), ack)
        status, other = self.api("sekou.parc", "GET", "/hsseq/my/documents")
        self.assertNotIn(doc["id"], [p["id"] for p in other["procedures"]], "Chef de parc d'un autre site : pas visé")
        status, board = self.api("kadi.hsseq", "GET", "/hsseq/procedures/dashboard")
        self.assertEqual(status, 200, board)
        [line] = [r for r in board["read_by_document"] if r["id"] == doc["id"]]
        self.assertEqual((line["targets"], line["read"], line["rate"]), (2, 1, 50.0))
        by_site = {(r["site"] or {}).get("id"): r for r in board["read_by_site"]}
        self.assertEqual((by_site[self.site.id]["targets"], by_site[self.site.id]["read"]), (2, 1))
        people = {p["user"]["id"]: p for p in board["missing_by_person"]}
        self.assertEqual([d["code"] for d in people[self.parc.id]["documents"]], [doc["code"]])
        self.assertNotIn(self.conducteur.id, people, "Le conducteur a lu")
        [policies] = [t for t in board["by_type"] if t["doc_type"] == "policy"]
        self.assertEqual(policies["published"], 1)
        self.assertEqual(board["totals"]["in_force"], 1)
        status, audited = self.api("awa.auditrice", "GET", "/hsseq/procedures/dashboard")
        self.assertEqual((status, audited["missing_by_person"]), (200, None), "Jamais de nom pour l'auditeur")
        self.assertEqual({(r["site"] or {}).get("id") for r in audited["read_by_site"]}, {self.site.id})
        status, body = self.api("awa.auditrice", "GET", f"/hsseq/procedures/dashboard?site_id={self.site2.id}")
        self.assertEqual(status, 403, "Site hors du périmètre de l'auditeur")
        status, filtered = self.api("kadi.hsseq", "GET", f"/hsseq/procedures/dashboard?site_id={self.site2.id}")
        self.assertEqual(filtered["read_by_document"], [], "Document du seul parc de Matoto")
        # Export Excel : les accusés manquants par personne, jamais pour l'auditeur.
        response = self._get("kadi.hsseq", "/hsseq/procedures/dashboard/export.xlsx")
        self.assertEqual(response.status_code, 200)
        book = zipfile.ZipFile(io.BytesIO(response.content))
        self.assertIn("Accusés manquants", book.read("xl/workbook.xml").decode())
        self.assertIn(doc["code"], book.read("xl/sharedStrings.xml").decode())
        response = self._get("awa.auditrice", "/hsseq/procedures/dashboard/export.xlsx")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Accusés manquants",
                         zipfile.ZipFile(io.BytesIO(response.content)).read("xl/workbook.xml").decode())

    # ─── Document à afficher ──────────────────────────────────────────────

    def test_document_a_afficher_en_pdf(self):
        from ..controllers.policies import poster_context

        doc = self._approved_policy(objectives=[
            {"label": "Zéro accident du travail avec arrêt"},
            {"label": "Taux de fréquence", "indicator_code": "frequency_rate", "target": 3}])
        record = self.env["eguitra.hsseq.procedure"].browse(doc["id"])
        Report = self.env["ir.actions.report"]

        def html(version):
            context = poster_context(record, version, self.dg)
            content, _type = Report._render_qweb_html("eguitra_hsseq.action_report_policy", record.ids,
                                                      data={"report": context})
            return content.decode()

        page = html(record.current_version_id)
        for text in ("Politique", "protéger la santé et la sécurité", "Nos objectifs", "Zéro accident du travail",
                     "Cible : 3", "La Direction générale", self.dg.name, "Approuvé le",
                     f"{doc['code']}, version 1"):
            self.assertIn(text, page, text)
        self.assertNotIn("PROJET NON APPROUVÉ", page)
        status, revised = self.api("kadi.hsseq", "POST", f"/hsseq/procedures/{doc['id']}/versions",
                                   {"version": "2", "effective_date": str(self.day)})
        record.invalidate_recordset()
        draft = record._draft_version()
        page = html(draft)
        self.assertIn("PROJET NON APPROUVÉ", page)
        self.assertIn("Approbation à venir", page)
        # Le PDF : pour la gestion et les comptes visés ; un projet, pour la seule lecture complète.
        poster = f"/hsseq/procedures/{doc['id']}/poster.pdf"
        response = self._get("ibrahima", poster)
        self.assertEqual((response.status_code, response.headers.get("Content-Type")), (200, "application/pdf"),
                         "Chef de parc visé")
        for login in ("sekou.parc", "rh.hsseq", "fatou"):
            self.assertEqual(self._get(login, poster).status_code, 404, f"{login} n'est pas visé")
        self.assertEqual(self._get("awa.auditrice", f"{poster}?version_id={draft.id}").status_code, 404,
                         "Projet : pas pour l'auditeur")
        status, _b = self.driver_api("GET", poster)
        self.assertEqual(status, 403, "Session de NIMOVA Terrain : le texte se lit dans « Documents »")
        procedure = self._create(doc_type="procedure", title="Procédure sans texte", body=None)
        status, _doc = self.upload("kadi.hsseq", content=PDF, name="procedure.pdf", model="procedure_version",
                                   id=procedure["draft_version"]["id"])
        status, procedure = self._go("kadi.hsseq", procedure, "publish")
        self.assertEqual((status, procedure["poster"]), (200, False))
        response = self._get("kadi.hsseq", f"/hsseq/procedures/{procedure['id']}/poster.pdf")
        self.assertEqual(response.status_code, 422, "Document qui se lit dans sa pièce jointe")

    # ─── Refus par profil et non-régression ───────────────────────────────

    def test_refus_par_profil_et_non_regression(self):
        policy = self._create()
        status, policy = self._go("kadi.hsseq", policy, "submit")
        procedure = self._create(doc_type="procedure", title="Dépotage", body="Étapes du dépotage.")
        status, procedure = self._go("kadi.hsseq", procedure, "submit")
        self.assertEqual(status, 200, procedure)
        published = self._approved_policy(title="Politique en vigueur")
        refused = ("ibrahima", "rh.hsseq", "fatou")
        for route in ("/hsseq/procedures/tree", "/hsseq/procedures/dashboard", "/hsseq/procedures/dashboard/export.xlsx"):
            for login in refused:
                status, _b = self.api(login, "GET", route)
                self.assertEqual(status, 403, f"{login} GET {route}")
            status, _b = self.driver_api("GET", route)
            self.assertEqual(status, 403, f"conducteur GET {route}")
        for login in ("dg.hsseq", "admin.hsseq", "ibrahima", "rh.hsseq", "awa.auditrice"):
            for transition in ("submit", "withdraw"):
                status, _b = self._go(login, policy, transition)
                self.assertEqual(status, 403, f"{login} {transition}")
        for login in ("kadi.hsseq", "binta.hsseq", "admin.hsseq", "ibrahima", "rh.hsseq", "awa.auditrice"):
            for transition, payload in (("approve", {}), ("reject", {"reason": "x"})):
                status, _b = self._go(login, policy, transition, payload)
                self.assertEqual(status, 403, f"{login} {transition} d'une politique")
        for login in ("dg.hsseq", "ibrahima", "awa.auditrice"):
            for transition, payload in (("approve", {}), ("reject", {"reason": "x"})):
                status, _b = self._go(login, procedure, transition, payload)
                self.assertEqual(status, 403, f"{login} {transition} d'une procédure")
        for login in ("dg.hsseq", "admin.hsseq", "ibrahima", "rh.hsseq", "awa.auditrice"):
            status, _b = self.api(login, "POST", f"/hsseq/procedures/{published['id']}/reviews",
                                  {"outcome": "renewed", "comment": "x"})
            self.assertEqual(status, 403, f"{login} ne note pas de revue")
        status, _b = self.driver_api("POST", f"/hsseq/procedures/{published['id']}/reviews",
                                     {"outcome": "renewed", "comment": "x"})
        self.assertEqual(status, 403)
        # Réglages : périodicité par type et seconde personne pour les procédures.
        status, _b = self.api("ibrahima", "PATCH", "/hsseq/settings", {"document_four_eyes": True})
        self.assertEqual(status, 403)
        status, settings = self.api("kadi.hsseq", "PATCH", "/hsseq/settings",
                                    {"document_four_eyes": True, "review_months_procedure": 6})
        self.assertEqual((status, settings["document_four_eyes"], settings["review_months_procedure"],
                          settings["review_months_policy"]), (200, True, 6, 12), settings)
        status, body = self.api("kadi.hsseq", "PATCH", "/hsseq/settings", {"review_months_form": 0})
        self.assertEqual(status, 422, "Au moins un mois")
        # Procédure : publication directe refusée par les quatre yeux, approuvée par un second Responsable HSSEQ.
        direct = self._create(doc_type="procedure", title="Contrôle avant départ", body=None)
        status, _doc = self.upload("kadi.hsseq", content=PDF, name="procedure.pdf", model="procedure_version",
                                   id=direct["draft_version"]["id"])
        status, body = self._go("kadi.hsseq", direct, "publish")
        self.assertEqual((status, body["error"]), (422, "four_eyes"))
        status, seen = self.api("kadi.hsseq", "GET", f"/hsseq/procedures/{direct['id']}")
        self.assertEqual(seen["version_actions"], ["submit"])
        status, submitted = self._go("kadi.hsseq", seen, "submit")
        status, body = self._go("kadi.hsseq", submitted, "approve")
        self.assertEqual((status, body["error"]), (422, "four_eyes"))
        status, approved = self._go("binta.hsseq", submitted, "approve")
        self.assertEqual((status, approved["current_version"]["approved_by"]["id"], approved["review"]["next_review_date"]),
                         (200, self.hsseq2.id, str(self.day + relativedelta(months=6))))
        # Sans quatre yeux, la procédure se publie toujours d'un geste ; l'alerte flash aussi.
        self.api("kadi.hsseq", "PATCH", "/hsseq/settings", {"document_four_eyes": False})
        legacy = self._create(doc_type="procedure", title="Chargement", body=None)
        self.upload("kadi.hsseq", content=PDF, name="procedure.pdf", model="procedure_version",
                    id=legacy["draft_version"]["id"])
        status, legacy = self._go("kadi.hsseq", legacy, "publish")
        self.assertEqual((status, legacy["status"], legacy["current_version"]["approved_by"]["id"]),
                         (200, "published", self.hsseq.id))
        status, bulletin = self.api("kadi.hsseq", "POST", "/hsseq/bulletins", CLEAN)
        status, bulletin = self.api("kadi.hsseq", "POST", f"/hsseq/bulletins/{bulletin['id']}/publish")
        self.assertEqual((status, bulletin["status"]), (200, "published"), bulletin)
