import io
import zipfile
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import PASSWORD, ApiCase
from odoo.addons.eguitra_axispro.controllers import common, portal

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
        self.assertAlmostEqual(marche["score"], (3 * 1 + 1 * 0.5) / 4 * 100)
        self.assertAlmostEqual(score["global_score"], (87.5 * 2 + 100 * 1) / 3)
        self.assertEqual(score["recommendation"], "go")

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
        self._create_user("dg.groupe", "direction", company_id=groupe.id, company_ids=[(6, 0, groupe.ids)])
        token = self.open_session("dg.groupe", app="axispro")["access_token"]
        status, _b = self.call("GET", f"/axispro/documents/{doc.id}/download", token=token)
        self.assertEqual(status, 403, "Pièce de la data room du cabinet")
        status, _b = self.call("GET", f"/axispro/reviews/compare?a={r1.id}&b={r2.id}", token=token)
        self.assertEqual(status, 403, "Revues de comité du cabinet")
        status, policies = self.call("GET", "/axispro/policies", token=token)
        self.assertEqual((status, policies), (200, []), "Grilles du cabinet")
        status, _b = self.call("GET", f"/axispro/policies/{self.policy.id}", token=token)
        self.assertEqual(status, 403)
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
        status, body = self.call("GET", "/portail/dossiers", token=porteur)
        self.assertEqual((status, body["error"]), (403, "password_change_required"),
                         "Le mot de passe provisoire doit être remplacé avant tout accès")
        status, body = self.call("POST", "/auth/password", {"old_password": PASSWORD, "new_password": "Porteur-Nouveau-2026"},
                                 token=porteur)
        self.assertEqual(status, 200, body)
        porteur = self.open_session("promoteur.smn", app="portail", password="Porteur-Nouveau-2026",
                                    secret=first["_secret"])["access_token"]
        status, mine = self.call("GET", "/portail/dossiers", token=porteur)
        self.assertEqual([d["id"] for d in mine], [dossier.id], "Le porteur ne voit que son dossier")
        status, _b = self.call("GET", f"/portail/dossiers/{autre.id}", token=porteur)
        self.assertEqual(status, 404)
        status, msgs = self.call("GET", f"/portail/dossiers/{dossier.id}/messages", token=porteur)
        self.assertEqual([m["body"] for m in msgs], ["Merci d'envoyer vos statuts."])

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

    def test_depots_du_porteur_controles(self):
        dossier = self._dossier()
        porteur = self._create_user("porteur.depots", "porteur")
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
        with patch.object(portal, "MAX_DAILY_MESSAGES", 1):
            path = f"/portail/dossiers/{dossier.id}/messages"
            self.assertEqual(self.call("POST", path, {"body": "Bonjour"}, token=token)[0], 200)
            self.assertEqual(self.call("POST", path, {"body": "Encore"}, token=token)[0], 429, "Messages bornés par jour")

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
