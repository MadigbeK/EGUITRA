import io
import zipfile
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import PASSWORD, ApiCase
from odoo.addons.eguitra_axispro.controllers import common

GRID = (
    "type;code;libelle;domaine;gate;poids;critique;eliminatoire;preuve;aide\n"
    "gate;G0;Idée et opportunité;;;;;;;\n"
    "gate;G1;Étude de faisabilité;;;;;;;\n"
    "domaine;D01;Marché;;;2;;;;\n"
    "domaine;D02;Juridique;;;1;;;;\n"
    "critere;C001;Étude de marché documentée;D01;G0;3;oui;non;non;Fournir l'étude de marché.\n"
    "critere;C002;Clients identifiés;D01;G0;1;non;non;non;Lister les premiers clients.\n"
    "critere;C003;Société immatriculée;D02;G0;1;non;oui;non;Immatriculer la société.\n"
    "critere;C004;Plan de financement;D01;G1;2;non;non;non;Établir le plan de financement.\n"
    "piece;P01;Statuts de la société;Juridique;G0;;oui;;;Copie certifiée.\n"
    "piece;P02;Plan d'affaires;Projet;G1;;oui;;;\n"
).encode()


@tagged("post_install", "-at_install")
class TestAxispro(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.policy = cls.env["axispro.policy"].import_grid(cls.cabinet, "Politique 2026", "grille.csv", GRID,
                                                          notes="Bancabilité selon les exigences des banques locales.")
        cls.policy.action_activate()
        cls.promoter = cls.env["res.partner"].create({"name": "Société Minière du Nord"})
        cls.consultant = cls._create_user("consultant", "cabinet", company_id=cls.cabinet.id,
                                          company_ids=[(6, 0, cls.cabinet.ids)])

    def _dossier(self):
        return self.env["axispro.dossier"].create({"name": "Usine de briques", "promoter_id": self.promoter.id,
                                                   "company_id": self.cabinet.id})

    def _set(self, dossier, code, status):
        dossier.evaluation_ids.filtered(lambda e: e.criterion_id.code == code).write({"status": status})

    def test_import_et_version(self):
        self.assertEqual(self.policy.version, 1)
        self.assertEqual(len(self.policy.criterion_ids), 4)
        self.assertEqual(len(self.policy.document_type_ids), 2)
        v2 = self.policy.copy_as_new_version()
        self.assertEqual(v2.version, 2)
        self.assertEqual(len(v2.criterion_ids), 4)
        v2.action_activate()
        self.assertEqual(self.policy.state, "archived")
        dossier = self._dossier()
        self.assertEqual(dossier.policy_id, v2, "Un nouveau dossier suit la politique en vigueur")

    def test_grille_invalide(self):
        with self.assertRaises(UserError):
            self.env["axispro.policy"].import_grid(self.cabinet, "X", "g.csv", b"type;code\ngate;G0\n")
        with self.assertRaises(UserError):
            self.env["axispro.policy"].import_grid(self.cabinet, "X", "g.xlsx", b"pas un classeur")

    def test_grille_csv_virgules(self):
        policy = self.env["axispro.policy"].import_grid(self.cabinet, "Virgules", "g.csv", GRID.replace(b";", b","))
        self.assertEqual(len(policy.criterion_ids), 4)
        self.assertEqual(policy.state, "draft", "Une grille importée attend son activation")

    def test_score_et_recommandation(self):
        dossier = self._dossier()
        self.assertEqual(len(dossier.evaluation_ids), 4)
        self.assertEqual(dossier.scoring()["recommendation"], "pending")
        self._set(dossier, "C001", "met")
        self.assertEqual(dossier.scoring()["recommendation"], "pending", "Gate courant incomplet : à compléter")
        self._set(dossier, "C002", "partial")
        self._set(dossier, "C003", "met")
        score = dossier.scoring()
        marche = next(d for d in score["domains"] if d["code"] == "D01")
        # Méthode MB AxisPro Consulting : un critère non encore évalué (C004, gate suivant) compte comme non disponible.
        self.assertAlmostEqual(marche["score"], (3 * 1 + 1 * 0.5 + 2 * 0) / 6 * 100)
        self.assertAlmostEqual(score["global_score"], (marche["score"] * 2 + 100 * 1) / 3)
        self.assertEqual(score["recommendation"], "go", "Ancienne grille : pondération par domaine, seuil de 70")

        self._set(dossier, "C003", "not_met")
        self.assertEqual(dossier.scoring()["recommendation"], "no_go", "Un éliminatoire non satisfait impose le NO-GO")
        gaps = dossier.gaps()
        self.assertEqual(gaps[0]["code"], "C003", "L'éliminatoire est l'écart prioritaire")

    def test_societe_par_defaut_du_cabinet(self):
        groupe = self.env["res.company"].search([("eguitra_entity", "=", "groupe")], limit=1)
        self._create_user("dg", "direction", company_id=groupe.id, company_ids=[(6, 0, (groupe | self.cabinet).ids)])
        token = self.open_session("dg", app="axispro")["access_token"]
        status, body = self.call("GET", "/axispro/policy", token=token, headers={"X-Eguitra-App": "axispro"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["id"], self.policy.id, "AxisPro Suite travaille dans la société du cabinet")
        status, body = self.call("GET", "/auth/me", token=token, headers={"X-Eguitra-App": "axispro"})
        self.assertEqual(body["company_id"], self.cabinet.id)
        status, body = self.call("GET", "/auth/me", token=token, headers={"X-Eguitra-App": "finance"})
        self.assertEqual(body["company_id"], groupe.id, "La finance garde la société de l'utilisateur")

    def test_passage_de_gate(self):
        dossier = self._dossier()
        self.assertEqual(dossier.current_gate_id.code, "G0")
        with self.assertRaises(UserError):
            dossier.action_advance_gate()
        for code in ("C001", "C002", "C003"):
            self._set(dossier, code, "met")
        dossier.action_advance_gate()
        self.assertEqual(dossier.current_gate_id.code, "G1")

    def test_comite_verrouille_et_comparaison(self):
        dossier = self._dossier()
        self._set(dossier, "C001", "partial")
        r1 = self.env["axispro.review"].create({"dossier_id": dossier.id, "decision": "conditional",
                                                "snapshot": dossier.scoring()})
        r1.action_lock()
        with self.assertRaises(UserError):
            r1.write({"decision": "go"})
        with self.assertRaises(UserError, msg="Dossier figé par la décision verrouillée"):
            self._set(dossier, "C001", "met")
        self.assertEqual(r1.verify(), {"sealed": True, "intact": True, "unchanged": True, "fingerprint": r1.fingerprint})
        dossier.action_new_revision()
        self.assertEqual(dossier.revision, 2)
        self._set(dossier, "C001", "met")
        r2 = self.env["axispro.review"].create({"dossier_id": dossier.id, "decision": "go", "snapshot": dossier.scoring()})
        diff = r2.compare(r1)
        marche = next(d for d in diff["domains"] if d["code"] == "D01")
        self.assertGreater(marche["delta"], 0)
        self.assertEqual(dossier.decision, "conditional", "Seule une décision verrouillée devient la décision du dossier")
        token = self.open_session("consultant", app="axispro")["access_token"]
        status, body = self.call("GET", "/axispro/reviews?state=locked", token=token)
        self.assertEqual(status, 200, body)
        self.assertIn(r1.id, [r["id"] for r in body])
        self.assertNotIn(r2.id, [r["id"] for r in body])
        self.assertEqual(next(r for r in body if r["id"] == r1.id)["dossier"]["id"], dossier.id)

    def test_axispro_toujours_dans_le_cabinet(self):
        """Un compte ouvert aux deux sociétés ne peut pas faire travailler AxisPro Suite dans le groupe."""
        groupe = self.env.ref("base.main_company")
        self._create_user("dg.deux", "direction", "cabinet", company_id=groupe.id,
                          company_ids=[(6, 0, (groupe | self.cabinet).ids)])
        token = self.open_session("dg.deux", app="axispro")["access_token"]
        headers = {"X-Eguitra-App": "axispro", "X-Eguitra-Company": str(groupe.id)}
        status, me = self.call("GET", "/auth/me", token=token, headers=headers)
        self.assertEqual(status, 200, me)
        self.assertEqual(me["company_id"], self.cabinet.id, "La société demandée est ignorée dans AxisPro")
        status, me = self.call("GET", "/auth/me", token=token,
                               headers={"X-Eguitra-App": "finance", "X-Eguitra-Company": str(groupe.id)})
        self.assertEqual(me["company_id"], groupe.id, "EGUITRA Finance garde le choix de la société")

    def test_cloisonnement_entre_societes(self):
        """Un profil direction sans la société du cabinet ne lit rien du cabinet, même par identifiant."""
        dossier = self._dossier()
        attachment = self.env["ir.attachment"].create({"name": "statuts.pdf", "raw": b"%PDF-1.4 statuts"})
        doc = self.env["axispro.document"].create({"dossier_id": dossier.id, "name": "Statuts",
                                                   "attachment_id": attachment.id})
        r1, r2 = self.env["axispro.review"].create([
            {"dossier_id": dossier.id, "decision": "go", "snapshot": dossier.scoring()} for _ in range(2)
        ])
        groupe = self.env.ref("base.main_company")
        dg = self._create_user("dg.groupe", "direction", company_id=groupe.id, company_ids=[(6, 0, groupe.ids)])
        status, body = self.call("POST", "/auth/login", {"login": "dg.groupe", "password": PASSWORD, "app": "axispro"})
        self.assertEqual(status, 403, "AxisPro Suite fermé à un compte sans la société du cabinet")
        token = self.open_session("dg.groupe", app="finance")["access_token"]
        for path in (f"/axispro/documents/{doc.id}/download", f"/axispro/reviews/compare?a={r1.id}&b={r2.id}",
                     "/axispro/policies", f"/axispro/policies/{self.policy.id}"):
            status, body = self.call("GET", path, token=token)
            self.assertEqual(status, 422, f"{path} : module du cabinet refusé hors de sa société")
        # Règles d'accès du noyau, en dernier rempart : rien du cabinet n'est lisible depuis le groupe.
        for model in ("axispro.document", "axispro.review", "axispro.policy", "axispro.dossier"):
            self.assertFalse(self.env[model].with_user(dg).with_context(allowed_company_ids=groupe.ids).search([]),
                             f"{model} du cabinet invisible")
        status, consultant = self.call("GET", "/axispro/policies",
                                       token=self.open_session("consultant", app="axispro")["access_token"])
        self.assertIn(self.policy.id, [p["id"] for p in consultant], "Le cabinet garde l'accès à sa grille")

    def test_portail_du_porteur(self):
        dossier = self._dossier()
        autre = self._dossier()
        token = self.open_session("consultant", app="axispro")["access_token"]
        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/portal-access",
                                 {"login": "promoteur.smn", "name": "Promoteur SMN", "password": PASSWORD}, token=token)
        self.assertEqual(status, 200, body)
        self.call("POST", f"/axispro/dossiers/{dossier.id}/messages", {"body": "Note interne", "internal": True}, token=token)
        self.call("POST", f"/axispro/dossiers/{dossier.id}/messages", {"body": "Merci d'envoyer vos statuts."}, token=token)

        first = self.open_session("promoteur.smn", app="portail")
        porteur = first["access_token"]
        pieces = f"/portail/dossiers/{dossier.id}/pieces.pdf"
        status, body = self.call("GET", pieces, token=porteur)
        self.assertEqual((status, body["error"]), (403, "password_change_required"),
                         "Le mot de passe provisoire doit être remplacé avant tout accès")
        status, body = self.call("POST", "/auth/password", {"old_password": PASSWORD, "new_password": "Porteur-Nouveau-2026"},
                                 token=porteur)
        self.assertEqual(status, 200, body)
        porteur = self.open_session("promoteur.smn", app="portail", password="Porteur-Nouveau-2026",
                                    secret=first["_secret"])["access_token"]
        self.assertEqual(self.call("GET", pieces, token=porteur)[0], 200, "Le porteur lit les pièces de son dossier")
        status, _b = self.call("GET", f"/portail/dossiers/{autre.id}/pieces.pdf", token=porteur)
        self.assertEqual(status, 404, "et jamais celles d'un autre dossier")
        # Fil des messages sans les notes internes : eguitra_portail (test_portail).

        statuts = self.policy.document_type_ids.filtered(lambda t: t.code == "P01")
        response = self.url_open(
            f"/api/v1/portail/dossiers/{dossier.id}/documents",
            files={"file": ("statuts.pdf", io.BytesIO(b"%PDF-1.4 statuts"), "application/pdf")},
            data={"document_type_id": str(statuts.id)},
            headers={"Authorization": f"Bearer {porteur}"}, method="POST", timeout=60,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["version"], 1)
        status, cabinet_view = self.call("GET", f"/axispro/dossiers/{dossier.id}/documents", token=token)
        p01 = next(d for d in cabinet_view["standard"] if d["code"] == "P01")
        self.assertEqual(p01["state"], "received")

        response = self.url_open(
            f"/api/v1/portail/dossiers/{dossier.id}/documents",
            files={"file": ("virus.exe", io.BytesIO(b"MZ"), "application/x-msdownload")},
            headers={"Authorization": f"Bearer {porteur}"}, method="POST", timeout=60,
        )
        self.assertEqual(response.status_code, 415, "Seuls les formats bureautiques sont acceptés")

        status, _b = self.call("GET", f"/axispro/dossiers/{dossier.id}", token=porteur)
        self.assertEqual(status, 403, "Le porteur n'accède pas à l'API du cabinet")

    def test_portail_rattachement_d_un_porteur_existant(self):
        """Audit des rôles I3 : un compte porteur existant n'est rattaché qu'aux dossiers de son promoteur."""
        dossier = self._dossier()
        tiers = self.env["res.partner"].create({"name": "Cimenterie de Kamsar"})
        etranger = self.env["axispro.dossier"].create({"name": "Cimenterie", "promoter_id": tiers.id,
                                                       "company_id": self.cabinet.id})
        contact = self.env["res.partner"].create({"name": "Directeur financier", "parent_id": self.promoter.id})
        extension = self.env["axispro.dossier"].create({"name": "Extension de l'usine", "promoter_id": contact.id,
                                                        "company_id": self.cabinet.id})
        token = self.open_session("consultant", app="axispro")["access_token"]
        acces = {"login": "porteur.smn", "name": "Porteur SMN", "password": PASSWORD}
        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/portal-access", acces, token=token)
        self.assertEqual(status, 200, body)
        status, body = self.call("POST", f"/axispro/dossiers/{etranger.id}/portal-access", acces, token=token)
        self.assertEqual(status, 409, "Compte qui suit le dossier d'un autre promoteur : rattachement refusé")
        self.assertIn(dossier.reference, body["message"])
        status, body = self.call("POST", f"/axispro/dossiers/{extension.id}/portal-access", acces, token=token)
        self.assertEqual(status, 200, "Même promoteur (contact de sa société) : rattachement permis")
        self.env.invalidate_all()
        porteur = self.env["res.users"].search([("login", "=", "porteur.smn")])
        self.assertEqual(set(self.env["axispro.dossier"].search([("portal_user_ids", "in", porteur.id)]).ids),
                         {dossier.id, extension.id})
        self._create_user("porteur.libre", "porteur", company_id=self.cabinet.id, company_ids=[(6, 0, self.cabinet.ids)])
        status, body = self.call("POST", f"/axispro/dossiers/{etranger.id}/portal-access",
                                 dict(acces, login="porteur.libre"), token=token)
        self.assertEqual(status, 200, "Compte porteur qui ne suit aucun dossier : rattachement permis")

    def test_depots_du_porteur_controles(self):
        dossier = self._dossier()
        porteur = self._create_user("porteur.depots", "porteur", company_id=self.cabinet.id,
                                    company_ids=[(6, 0, self.cabinet.ids)])
        dossier.portal_user_ids = [(4, porteur.id)]
        token = self.open_session("porteur.depots", app="portail")["access_token"]

        def deposer(name, content):
            return self.url_open(
                f"/api/v1/portail/dossiers/{dossier.id}/documents",
                files={"file": (name, io.BytesIO(content), "application/octet-stream")},
                headers={"Authorization": f"Bearer {token}"}, method="POST", timeout=60,
            )

        response = deposer("statuts.exe", b"%PDF-1.4 statuts")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["name"], response.json()["mimetype"]), ("statuts.pdf", "application/pdf"),
                         "Format lu dans le contenu ; le nom prend l'extension du format reconnu")
        self.assertEqual(deposer("facture.pdf", b"MZ\x90\x00 programme").status_code, 415,
                         "Un exécutable nommé .pdf est refusé")
        macros = io.BytesIO()
        with zipfile.ZipFile(macros, "w") as archive:
            archive.writestr("word/document.xml", "<w:document/>")
            archive.writestr("word/vbaProject.bin", "macros")
        self.assertEqual(deposer("rapport.docx", macros.getvalue()).status_code, 415, "Document à macros refusé")
        with patch.object(common, "MAX_DOSSIER_FILES", 1):
            self.assertEqual(deposer("bilan.pdf", b"%PDF-1.4 bilan").status_code, 422, "Espace du dossier borné")
        # Messages bornés par jour : messagerie du portail (eguitra_portail, test_portail).

    def test_depot_refuse_sur_un_dossier_clos(self):
        """Un dossier clos se consulte mais ne reçoit plus de pièce du porteur ; la messagerie (fil du
        portail, eguitra_portail) applique la même règle."""
        dossier = self._dossier()
        porteur = self._create_user("porteur.clos", "porteur", company_id=self.cabinet.id,
                                    company_ids=[(6, 0, self.cabinet.ids)])
        dossier.portal_user_ids = [(4, porteur.id)]
        token = self.open_session("porteur.clos", app="portail")["access_token"]

        def deposer():
            return self.url_open(
                f"/api/v1/portail/dossiers/{dossier.id}/documents",
                files={"file": ("bilan.pdf", io.BytesIO(b"%PDF-1.4 bilan"), "application/pdf")},
                headers={"Authorization": f"Bearer {token}"}, method="POST", timeout=60,
            )

        self.assertEqual(deposer().status_code, 200)
        dossier.state = "closed"
        response = deposer()
        self.assertEqual((response.status_code, response.json()["message"]), (422, "Ce dossier est clos."))
        self.assertEqual(self.call("GET", f"/portail/dossiers/{dossier.id}/pieces.pdf", token=token)[0], 200,
                         "Les pièces restent lisibles")

    def test_anciennes_routes_du_portail_retirees(self):
        """Les routes de l'ancien portail qu'aucun écran n'appelait plus (doublons de /espace, /tableau,
        /pieces et /fil d'eguitra_portail) n'existent plus ; la vue du dossier montrait au porteur
        l'intitulé des critères de ses premiers écarts."""
        dossier = self._dossier()
        porteur = self._create_user("porteur.ancien", "porteur", company_id=self.cabinet.id,
                                    company_ids=[(6, 0, self.cabinet.ids)])
        dossier.portal_user_ids = [(4, porteur.id)]
        token = self.open_session("porteur.ancien", app="portail")["access_token"]
        for method, path in (("GET", "/portail/dossiers"), ("GET", f"/portail/dossiers/{dossier.id}"),
                             ("GET", f"/portail/dossiers/{dossier.id}/documents"),
                             ("GET", f"/portail/dossiers/{dossier.id}/messages"),
                             ("POST", f"/portail/dossiers/{dossier.id}/messages")):
            status, _body = self.call(method, path, {"body": "Bonjour"} if method == "POST" else None, token=token)
            self.assertEqual(status, 404, f"{method} {path} retirée")
        self.assertFalse(dossier.message_ids, "Aucun message déposé par l'ancienne route")

    def test_activites_du_cabinet(self):
        """Les services du cabinet sont des activités de MB AxisPro Consulting, proposées aux lignes de facture."""
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        names = self.env["account.analytic.account"].search([("plan_id", "=", plan.id),
                                                             ("company_id", "=", self.cabinet.id)]).mapped("name")
        for name in ("Gestion de projets", "Formation et coaching", "Conseil", "Audit d'évaluation des transporteurs",
                     "Certification"):
            self.assertIn(name, names)
        dossier = self._dossier()
        self.env["axispro.timesheet"].create({"dossier_id": dossier.id, "hours": 2, "description": "Analyse"})
        invoice = self.env["axispro.timesheet"].search([("dossier_id", "=", dossier.id)]).action_invoice(100_000)
        activities = self.env["account.analytic.account"].browse(
            [int(i) for line in invoice.invoice_line_ids for key in (line.analytic_distribution or {}) for i in key.split(",")])
        self.assertIn("Gestion de projets", activities.mapped("name"), "Honoraires des dossiers : gestion de projets")

    def test_rapport_xlsx_et_facturation(self):
        dossier = self._dossier()
        token = self.open_session("consultant", app="axispro")["access_token"]
        response = self.url_open(f"/api/v1/axispro/dossiers/{dossier.id}/report.xlsx",
                                 headers={"Authorization": f"Bearer {token}"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"PK"))
        status, report = self.call("GET", f"/axispro/dossiers/{dossier.id}/report", token=token)
        self.assertEqual(report["policy"]["version"], 1, "La politique appliquée est rappelée")
        self.call("POST", "/axispro/timesheets", {"dossier_id": dossier.id, "hours": 6, "description": "Analyse"}, token=token)
        status, invoice = self.call("POST", f"/axispro/dossiers/{dossier.id}/invoice", {"hourly_rate": 500_000}, token=token)
        self.assertEqual(status, 200, invoice)
        self.assertEqual(invoice["amount_untaxed"], 3_000_000)

    def test_totaux_des_temps_sur_tout_le_filtre(self):
        """Audit de l'application web (I-D13) : les totaux des temps portent sur toutes les saisies du
        filtre, pas sur la liste bornée qu'affiche l'écran."""
        dossier, autre = self._dossier(), self._dossier()
        Timesheet = self.env["axispro.timesheet"]
        Timesheet.create([{"dossier_id": dossier.id, "hours": 1.5, "description": f"Analyse {i}"} for i in range(4)])
        Timesheet.create({"dossier_id": dossier.id, "hours": 2, "description": "Revue interne", "billable": False})
        Timesheet.create({"dossier_id": autre.id, "hours": 3, "description": "Visite du site"})
        token = self.open_session("consultant", app="axispro")["access_token"]
        status, rows = self.call("GET", f"/axispro/timesheets?dossier_id={dossier.id}&limit=2", token=token)
        self.assertEqual((status, len(rows)), (200, 2), "Liste bornée")
        status, summary = self.call("GET", f"/axispro/timesheets/summary?dossier_id={dossier.id}", token=token)
        self.assertEqual(status, 200, summary)
        self.assertEqual((summary["count"], summary["hours"], summary["unbilled"]), (5, 8.0, 6.0),
                         "Totaux de toutes les saisies, le temps non facturable hors des heures à facturer")
        self.assertEqual([(r["id"], r["hours"]) for r in summary["dossiers"]], [(dossier.id, 8.0)])
        status, summary = self.call("GET", f"/axispro/timesheets/summary?dossier_id={autre.id}&unbilled=1", token=token)
        self.assertEqual((summary["count"], summary["hours"], summary["unbilled"]), (1, 3.0, 3.0))
        status, summary = self.call("GET", "/axispro/timesheets/summary", token=token)
        self.assertGreaterEqual(summary["hours"], 11.0)
        self.assertEqual({dossier.id, autre.id} - {r["id"] for r in summary["dossiers"]}, set())

    def test_acces_du_porteur_retire_et_responsable_change(self):
        """Audit du noyau (I-X5, M8) : l'accès d'un porteur se retire, le responsable du dossier se
        change, chaque fois au journal ; un compte porteur existant garde son mot de passe et l'écran le
        sait (password_changed) ; refus 403 des profils autres que le cabinet."""
        dossier = self._dossier()
        dossier.consultant_id = self.consultant
        token = self.open_session("consultant", app="axispro")["access_token"]
        path = f"/axispro/dossiers/{dossier.id}/portal-access"
        status, body = self.call("POST", path, {"login": "porteur.retrait", "name": "Porteur", "password": "court"},
                                 token=token)
        self.assertEqual((status, body.get("fields")), (400, ["password"]), "Mot de passe provisoire trop court")
        status, body = self.call("POST", path, {"login": "porteur.retrait", "name": "Porteur", "password": PASSWORD},
                                 token=token)
        self.assertEqual((status, body["portal_access"]["created"]), (200, True), body)
        autre = self.env["axispro.dossier"].create({"name": "Extension", "promoter_id": self.promoter.id,
                                                    "company_id": self.cabinet.id})
        status, body = self.call("POST", f"/axispro/dossiers/{autre.id}/portal-access",
                                 {"login": "porteur.retrait", "name": "Porteur"}, token=token)
        self.assertEqual((status, body["portal_access"]["password_changed"]), (200, False),
                         "Compte existant : rattaché sans mot de passe, et l'écran le dit")
        porteur = self.env["res.users"].search([("login", "=", "porteur.retrait")])
        self._create_user("dg.portail", "direction", company_id=self.cabinet.id, company_ids=[(6, 0, self.cabinet.ids)])
        dg = self.open_session("dg.portail", app="axispro")["access_token"]
        for method, route, payload in (("DELETE", f"{path}/{porteur.id}", None),
                                       ("POST", f"/axispro/dossiers/{dossier.id}/lead", {"user_id": self.consultant.id})):
            status, body = self.call(method, route, payload, token=dg)
            self.assertEqual((status, body.get("error")), (403, "forbidden"), f"{route} : direction refusée")
        status, body = self.call("DELETE", f"{path}/{porteur.id}", token=token)
        self.assertEqual((status, [u["id"] for u in body["portal_users"]]), (200, []), body)
        self.env.invalidate_all()
        self.assertTrue(porteur.active, "Le compte sert encore l'autre dossier du promoteur")
        status, body = self.call("DELETE", f"/axispro/dossiers/{autre.id}/portal-access/{porteur.id}", token=token)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertFalse(porteur.active, "Plus aucun dossier : compte désactivé")
        self.assertIn("Accès au portail retiré", " ".join(dossier.journal_ids.mapped("note")))
        second = self._create_user("consultant.relais", "cabinet", company_id=self.cabinet.id,
                                   company_ids=[(6, 0, self.cabinet.ids)])
        relais = self.open_session("consultant.relais", app="axispro")["access_token"]
        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/lead", {"user_id": second.id}, token=relais)
        self.assertEqual(status, 403, "Seul le responsable en place confie le dossier")
        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/lead", {"user_id": second.id}, token=token)
        self.assertEqual((status, body["consultant_id"]), (200, second.id), body)
        self.env.invalidate_all()
        entry = dossier.journal_ids.filtered(lambda j: j.note == "Responsable du dossier")
        self.assertEqual((entry.before, entry.after), (self.consultant.name, second.name))

    def test_dossier_clos_fige_cote_cabinet(self):
        """Audit du noyau (M8) : un dossier clos se consulte mais ne s'évalue plus et ne reçoit plus de
        revue tant qu'il n'est pas rouvert ; chaque changement d'état est au journal."""
        dossier = self._dossier()
        token = self.open_session("consultant", app="axispro")["access_token"]
        evaluation = dossier.evaluation_ids[:1]
        status, body = self.call("PATCH", f"/axispro/dossiers/{dossier.id}", {"state": "closed"}, token=token)
        self.assertEqual((status, body["state"]), (200, "closed"), body)
        status, body = self.call("PATCH", f"/axispro/evaluations/{evaluation.id}", {"status": "met"}, token=token)
        self.assertEqual(status, 422, "Évaluation refusée sur un dossier clos")
        self.assertIn("clos", body["message"])
        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/reviews", {"decision": "go"}, token=token)
        self.assertEqual(status, 422, "Pas de revue de comité sur un dossier clos")
        self.assertEqual(self.call("GET", f"/axispro/dossiers/{dossier.id}", token=token)[0], 200, "Il se consulte")
        status, body = self.call("PATCH", f"/axispro/dossiers/{dossier.id}", {"state": "open"}, token=token)
        self.assertEqual((status, body["state"]), (200, "open"), body)
        status, body = self.call("PATCH", f"/axispro/evaluations/{evaluation.id}", {"status": "met"}, token=token)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        states = dossier.journal_ids.filtered(lambda j: j.kind == "state")
        self.assertEqual(sorted(states.mapped("after")), ["Clos", "En cours"])

    def test_statut_zero_lu_dans_un_classeur(self):
        """Audit du noyau (M8) : un statut 0 (nombre lu dans un classeur) vaut « non disponible »."""
        from odoo.addons.eguitra_axispro.controllers.rapports import _status_of

        self.assertEqual((_status_of(0), _status_of(0.0), _status_of(1), _status_of(0.5)),
                         ("not_met", "not_met", "met", "partial"))
        self.assertIsNone(_status_of(None))

    def test_facture_d_honoraires_refusee_a_l_admin(self):
        """Audit des rôles I6 : seul le cabinet facture les honoraires ; l'admin ne fait que consulter."""
        dossier = self._dossier()
        self.env["axispro.timesheet"].create({"dossier_id": dossier.id, "hours": 2, "description": "Analyse"})
        self._create_user("admin.cabinet", "admin", company_id=self.cabinet.id, company_ids=[(6, 0, self.cabinet.ids)])
        token = self.open_session("admin.cabinet", app="axispro")["access_token"]
        self.assertEqual(self.call("GET", f"/axispro/dossiers/{dossier.id}", token=token)[0], 200, "L'admin consulte")
        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/invoice", {"hourly_rate": 500_000}, token=token)
        self.assertEqual((status, body["error"]), (403, "forbidden"), "mais ne facture pas")
        self.env.invalidate_all()
        self.assertFalse(self.env["axispro.timesheet"].search([("dossier_id", "=", dossier.id)]).invoice_id,
                         "Aucun temps facturé")
