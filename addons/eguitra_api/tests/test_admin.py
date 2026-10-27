from datetime import date

from odoo.tests import tagged

from ..organisation import wrong_company_message
from .common import ApiCase
from .profils import RefusParProfil


@tagged("post_install", "-at_install")
class TestAdmin(RefusParProfil, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._create_user("aissatou", "admin")
        cls._create_user("fatou", "finance")

    def test_application_rh_selon_son_module(self):
        admin = self.env["res.users"].search([("login", "=", "aissatou")])
        self.assertEqual("rh" in admin._eguitra_apps(), "eguitra.rh.employee" in self.env,
                         "L'espace RH n'existe que là où son module est installé")

    def test_profil_requis(self):
        session = self.open_session("fatou")
        status, body = self.call("GET", "/admin/users", token=session["access_token"])
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "forbidden")

    def test_cycle_de_vie_utilisateur(self):
        token = self.open_session("aissatou")["access_token"]

        status, profils = self.call("GET", "/admin/profiles", token=token)
        self.assertEqual(status, 200)
        self.assertEqual([p["code"] for p in profils], ["admin", "direction", "finance", "achats", "exploitation",
                                                        "chantiers", "immobilier", "cabinet", "associe", "rh", "porteur"])
        associe = next(p for p in profils if p["code"] == "associe")
        self.assertEqual((associe["name"], associe["entity"]), ("Associé du cabinet", "cabinet"),
                         "Profil propre à MB AxisPro Consulting")
        rh = next(p for p in profils if p["code"] == "rh")
        self.assertEqual((rh["name"], rh["entity"]), ("Ressources humaines", None), "Profil commun aux deux sociétés")
        achats = next(p for p in profils if p["code"] == "achats")
        self.assertEqual((achats["name"], achats["entity"]), ("Achats", None), "Profil commun aux deux sociétés")
        self.assertIn("pièces d'achat", achats["description"])

        status, acheteuse = self.call("POST", "/admin/users", {
            "name": "Mariama Achats", "login": "mariama.achats", "password": "Provisoire-2026", "profiles": ["achats"],
        }, token=token)
        self.assertEqual(status, 200, acheteuse)
        self.assertEqual((acheteuse["profiles"], acheteuse["apps"]), (["achats"], ["finance"]))
        # Droit déclaré par eguitra_finance : absent quand ce module n'est pas installé.
        self.assertFalse(acheteuse["rights"].get("free_accounts"), "Saisie libre des comptes non accordée")

        status, user = self.call("POST", "/admin/users", {
            "name": "Ibrahima Exploitation", "login": "Ibrahima", "password": "Provisoire-2026",
            "profiles": ["exploitation"],
        }, token=token)
        self.assertEqual(status, 200, user)
        self.assertEqual(user["login"], "ibrahima")
        self.assertEqual(user["profiles"], ["exploitation"])
        self.assertTrue(user["password_change_required"])
        self.assertEqual(sorted(user["apps"]), ["finance", "mobile", "transport"])

        status, _b = self.call("POST", "/admin/users", {
            "name": "Doublon", "login": "ibrahima", "password": "Provisoire-2026", "profiles": ["finance"],
        }, token=token)
        self.assertEqual(status, 409)

        status, refus = self.call("PATCH", f"/admin/users/{user['id']}", {"profiles": ["porteur", "finance"]}, token=token)
        self.assertEqual(status, 422, refus)

        status, maj = self.call("PATCH", f"/admin/users/{user['id']}", {"profiles": ["exploitation", "chantiers"]}, token=token)
        self.assertEqual(status, 200, maj)
        self.assertEqual(maj["profiles"], ["exploitation", "chantiers"])

        session = self.open_session("ibrahima", password="Provisoire-2026")
        status, body = self.call("GET", "/admin/profiles", token=session["access_token"])
        self.assertEqual((status, body["error"]), (403, "password_change_required"))
        status, _b = self.call("POST", f"/admin/users/{user['id']}/reset-mfa", token=token)
        self.assertEqual(status, 200)
        status, _b = self.call("GET", "/auth/me", token=session["access_token"])
        self.assertEqual(status, 401, "La réinitialisation ferme les sessions")

        status, desactive = self.call("PATCH", f"/admin/users/{user['id']}", {"active": False}, token=token)
        self.assertEqual(status, 200)
        self.assertFalse(desactive["active"])

    def test_mot_de_passe_commun_de_la_recette(self):
        self.env["ir.config_parameter"].sudo().set_param("eguitra_api.shared_password", "1")
        token = self.open_session("aissatou")["access_token"]
        status, user = self.call("POST", "/admin/users", {
            "name": "Testeur Recette", "login": "testeur.recette", "password": "Commun-recette-2026",
            "profiles": ["finance"],
        }, token=token)
        self.assertEqual(status, 200, user)
        self.assertFalse(user["password_change_required"], "Pas de changement imposé : il serait refusé")
        status, body = self.call(
            "POST", f"/admin/users/{user['id']}/password", {"password": "Autre-mot-2026"}, token=token
        )
        self.assertEqual((status, body["error"]), (403, "password_locked"))

    def test_profils_coherents_avec_les_societes(self):
        """Un profil propre à une société exige que le compte y soit ouvert."""
        cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        groupe = self.env.ref("base.main_company")
        self._create_user("admin.deux", "admin", company_ids=[(6, 0, (groupe | cabinet).ids)])
        token = self.open_session("admin.deux")["access_token"]
        compte = {"name": "Consultant", "login": "consultant.x", "password": "Provisoire-2026", "profiles": ["cabinet"]}
        status, body = self.call("POST", "/admin/users", dict(compte, company_ids=[groupe.id]), token=token)
        self.assertEqual(status, 422, body)
        self.assertIn("MB AxisPro Consulting", body["message"])
        status, user = self.call("POST", "/admin/users", dict(compte, company_ids=[cabinet.id]), token=token)
        self.assertEqual((status, sorted(user["apps"])), (200, ["analyse", "axispro"]), user)
        status, body = self.call("PATCH", f"/admin/users/{user['id']}", {"profiles": ["cabinet", "chantiers"]}, token=token)
        self.assertEqual(status, 422, "Le profil chantiers exige EGUITRA GROUP")
        status, body = self.call("PATCH", f"/admin/users/{user['id']}", {"profiles": ["cabinet", "finance"]}, token=token)
        self.assertEqual((status, sorted(body["apps"])), (200, ["analyse", "axispro", "finance"]),
                         "Un comptable du cabinet ouvre Finance, AxisPro Suite et Analyse, dans le seul cabinet")
        status, profils = self.call("GET", "/admin/profiles", token=token)
        self.assertEqual({p["code"]: p["entity"] for p in profils}["cabinet"], "cabinet")

    def test_admin_ne_se_retire_pas_ses_droits(self):
        session = self.open_session("aissatou")
        me = session["user"]
        status, _b = self.call("PATCH", f"/admin/users/{me['id']}", {"profiles": ["finance"]}, token=session["access_token"])
        self.assertEqual(status, 422)

    def test_comptes_techniques_hors_portee(self):
        token = self.open_session("aissatou")["access_token"]
        admin_noyau = self.env.ref("base.user_admin")
        status, _b = self.call(
            "POST", f"/admin/users/{admin_noyau.id}/password", {"password": "Piratage-2026!"}, token=token
        )
        self.assertEqual(status, 404)
        status, users = self.call("GET", "/admin/users", token=token)
        self.assertNotIn(admin_noyau.id, [u["id"] for u in users])

    def test_journaux_bornes_aux_societes_de_l_administrateur(self):
        other = self.env["res.company"].create({"name": "Société hors périmètre"})
        bakary = self._create_user("bakary", "finance", company_id=other.id, company_ids=[(6, 0, other.ids)])
        self.call("GET", "/auth/me", token=self.open_session("bakary")["access_token"])
        token = self.open_session("aissatou")["access_token"]
        status, logs = self.call("GET", "/admin/access-log", token=token)
        self.assertEqual(status, 200, logs)
        self.assertNotIn("Bakary", [log["user"] for log in logs], "Accès d'une société hors périmètre invisibles")

        model = self.env["ir.model"]._get("res.partner")
        inside = self.env["res.partner"].create({"name": "Client du groupe", "company_id": self.env.company.id})
        outside = self.env["res.partner"].create({"name": "Client hors périmètre", "company_id": other.id})
        Log = self.env["auditlog.log"]
        seen = Log.create({"name": inside.name, "model_id": model.id, "res_id": inside.id, "user_id": bakary.id,
                           "method": "write"})
        hidden = Log.create({"name": outside.name, "model_id": model.id, "res_id": outside.id, "user_id": bakary.id,
                             "method": "write"})
        status, audit = self.call("GET", "/admin/audit?model=res.partner", token=token)
        self.assertEqual(status, 200, audit)
        ids = [entry["id"] for entry in audit]
        self.assertIn(seen.id, ids)
        self.assertNotIn(hidden.id, ids, "Piste d'audit d'une société hors périmètre invisible")

    def test_piste_d_audit_parcourue_en_entier(self):
        """Pagination par curseur (paged=1, before_id) : chaque page reprend après la dernière entrée examinée par
        la précédente, jusqu'au début de la piste (next_before_id nul), sans doublon ni manque ; filtres par
        enregistrement et par auteur ; sans paged, la réponse reste une liste."""
        partner = self.env["res.partner"].create({"name": "Client suivi", "company_id": self.env.company.id})
        model = self.env["ir.model"]._get("res.partner")
        fatou = self.env["res.users"].search([("login", "=", "fatou")])
        Log = self.env["auditlog.log"]
        for i in range(5):
            Log.create({"name": partner.name, "model_id": model.id, "res_id": partner.id,
                        "user_id": (fatou if i % 2 else self.env.user).id, "method": "write"})
        # Toute la piste de l'enregistrement, création comprise si le module d'audit l'a déjà inscrite.
        domain = [("model_id", "=", model.id), ("res_id", "=", partner.id)]
        expected = Log.search(domain, order="id desc").ids
        self.env.flush_all()  # visible des requêtes HTTP
        token = self.open_session("aissatou")["access_token"]
        seen, cursor = [], None
        for _page in range(len(expected) + 1):
            path = f"/admin/audit?model=res.partner&res_id={partner.id}&paged=1&limit=2"
            status, page = self.call("GET", path + (f"&before_id={cursor}" if cursor else ""), token=token)
            self.assertEqual(status, 200, page)
            self.assertLessEqual(len(page["items"]), 2)
            seen += [entry["id"] for entry in page["items"]]
            cursor = page["next_before_id"]
            if not cursor:
                break
        self.assertIsNone(cursor, "La pagination atteint le début de la piste")
        self.assertEqual(seen, expected, "Toute la piste, de la plus récente à la plus ancienne, une seule fois")
        status, page = self.call("GET", f"/admin/audit?model=res.partner&res_id={partner.id}&user_id={fatou.id}&paged=1",
                                 token=token)
        self.assertEqual([entry["id"] for entry in page["items"]], Log.search(domain + [("user_id", "=", fatou.id)], order="id desc").ids,
                         "Filtre par auteur")
        self.assertIsNone(page["next_before_id"])
        status, rows = self.call("GET", f"/admin/audit?model=res.partner&res_id={partner.id}", token=token)
        self.assertEqual((status, [entry["id"] for entry in rows]), (200, expected), "Sans paged : la liste, comme avant")
        # Piste d'audit et journal des accès : administration seule.
        self.assertRefuseHors(("admin",), "GET", "/admin/audit?paged=1")
        self.assertRefuseHors(("admin",), "GET", "/admin/access-log")

    def test_perimetre_d_un_administrateur_partiel(self):
        """Comptes du plan, fiches société et comptes multi-sociétés hors du périmètre restent invisibles."""
        other = self.env["res.company"].create({"name": "Société hors périmètre"})
        Account = self.env["account.account"]
        mine = Account.create({"name": "Compte du groupe", "code": "471901", "account_type": "asset_current",
                               "company_ids": [(6, 0, self.env.company.ids)]})
        foreign = Account.create({"name": "Compte hors périmètre", "code": "471902", "account_type": "asset_current",
                                  "company_ids": [(6, 0, other.ids)]})
        Log = self.env["auditlog.log"]

        def log(record):
            model = self.env["ir.model"]._get(record._name)
            return Log.create({"name": record.display_name, "model_id": model.id, "res_id": record.id,
                               "user_id": self.env.uid, "method": "write"})

        seen, hidden, hidden_company = log(mine), log(foreign), log(other)
        token = self.open_session("aissatou")["access_token"]
        status, audit = self.call("GET", "/admin/audit?model=account.account", token=token)
        self.assertEqual(status, 200, audit)
        ids = [entry["id"] for entry in audit]
        self.assertIn(seen.id, ids)
        self.assertNotIn(hidden.id, ids, "Historique d'un compte d'une autre société")
        status, audit = self.call("GET", "/admin/audit?model=res.company", token=token)
        self.assertNotIn(hidden_company.id, [entry["id"] for entry in audit], "Fiche d'une autre société")
        gerant = self._create_user("gerant", "direction", company_ids=[(6, 0, (self.env.company | other).ids)])
        status, users = self.call("GET", "/admin/users", token=token)
        self.assertNotIn(gerant.id, [u["id"] for u in users], "Compte ouvert aussi à une autre société")
        hidden_user = log(gerant)
        status, audit = self.call("GET", "/admin/audit?model=res.users", token=token)
        self.assertNotIn(hidden_user.id, [entry["id"] for entry in audit],
                         "Historique d'un compte ouvert aussi à une autre société")

    def test_identite_des_societes(self):
        token = self.open_session("aissatou")["access_token"]
        status, rows = self.call("GET", "/admin/companies", token=token)
        self.assertEqual(status, 200, rows)
        company = self.env.company
        # Image PNG valide d'un pixel : le noyau vérifie que le logo est une vraie image.
        png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        status, row = self.call("PATCH", f"/admin/companies/{company.id}", {
            "street": "Kaloum, avenue de la République", "city": "Conakry", "vat": "123456789",
            "company_registry": "GN.TCC.2020.B.00001", "email": "finance@exemple.gn", "logo": f"data:image/png;base64,{png}",
        }, token=token)
        self.assertEqual(status, 200, row)
        self.assertEqual(row["company_registry"], "GN.TCC.2020.B.00001")
        self.assertIn("RCCM GN.TCC.2020.B.00001", str(company.report_footer), "Mentions légales au pied des documents")
        self.assertEqual(self.env.ref("base.gn").vat_label, "NIF")
        self.assertTrue(row["logo"].startswith("data:image/png;base64,"))
        status, _b = self.call("PATCH", f"/admin/companies/{company.id}",
                               {"logo": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="}, token=token)
        self.assertEqual(status, 415, "Logo SVG refusé")
        other = self.env["res.company"].create({"name": "Société hors périmètre"})
        status, _b = self.call("PATCH", f"/admin/companies/{other.id}", {"city": "Kindia"}, token=token)
        self.assertEqual(status, 404, "Société hors du périmètre de l'administrateur")
        status, _b = self.call("GET", "/admin/companies", token=self.open_session("fatou")["access_token"])
        self.assertEqual(status, 403)

    def test_slogan_des_societes(self):
        """Slogan en tête des documents (factures) : texte simple, jamais du HTML ; administration seule."""
        token = self.open_session("aissatou")["access_token"]
        company = self.env.company
        status, row = self.call("PATCH", f"/admin/companies/{company.id}",
                                {"slogan": "Notre <b>slogan</b> & nos valeurs", "phone": "620 00 00 01 / 620 00 00 02"},
                                token=token)
        self.assertEqual(status, 200, row)
        self.assertEqual((row["slogan"], row["phone"]), ("Notre <b>slogan</b> & nos valeurs", "620 00 00 01 / 620 00 00 02"))
        self.env.invalidate_all()
        self.assertNotIn("<b>", str(company.report_header), "Balises échappées avant d'entrer dans le noyau")
        self.assertRefuseHors(("admin",), "PATCH", f"/admin/companies/{company.id}", {"slogan": "Refusé"})
        status, rows = self.call("GET", "/admin/companies", token=token)
        self.assertEqual(next(r for r in rows if r["id"] == company.id)["slogan"], "Notre <b>slogan</b> & nos valeurs")
        status, row = self.call("PATCH", f"/admin/companies/{company.id}", {"slogan": ""}, token=token)
        self.assertEqual((status, row["slogan"]), (200, None))

    def test_piste_d_audit_des_lignes_rattachees_a_leur_parent(self):
        """Audit du noyau, I-A6 : éléments de salaire et tarifs relèvent de la société de leur parent.

        Les modèles viennent d'eguitra_rh et d'eguitra_transport : infra/test.sh eguitra_api eguitra_rh
        eguitra_transport."""
        other = self.env["res.company"].create({"name": "Société hors périmètre"})
        Log = self.env["auditlog.log"]

        def log(record):
            model = self.env["ir.model"]._get(record._name)
            return Log.create({"name": record.display_name, "model_id": model.id, "res_id": record.id,
                               "user_id": self.env.uid, "method": "write"})

        cas = []
        if "eguitra.rh.employee.line" in self.env:
            rubric = self.env["eguitra.rh.rubric"].search([("system", "=", False)], limit=1)
            for company in (self.env.company, other):
                employee = self.env["eguitra.rh.employee"].create(
                    {"name": f"Salarié {company.name}", "hire_date": date(2025, 1, 1), "company_id": company.id})
                line = self.env["eguitra.rh.employee.line"].create(
                    {"employee_id": employee.id, "rubric_id": rubric.id, "amount": 250_000})
                cas.append(("eguitra.rh.employee.line", log(line), company == other))
        if "eguitra.transport.tariff" in self.env:
            client = self.env["res.partner"].create({"name": "Client du transport"})
            for company in (self.env.company, other):
                route = self.env["eguitra.transport.route"].create({"name": f"Route {company.name}", "company_id": company.id})
                tariff = self.env["eguitra.transport.tariff"].create(
                    {"route_id": route.id, "partner_id": client.id, "rate": 1_000_000})
                cas.append(("eguitra.transport.tariff", log(tariff), company == other))
        if not cas:
            self.skipTest("eguitra_rh et eguitra_transport absents de la base de test")

        token = self.open_session("aissatou")["access_token"]
        for model, entry, hors_perimetre in cas:
            status, audit = self.call("GET", f"/admin/audit?model={model}", token=token)
            self.assertEqual(status, 200, audit)
            ids = [e["id"] for e in audit]
            if hors_perimetre:
                self.assertNotIn(entry.id, ids, f"{model} d'une autre société : historique invisible")
            else:
                self.assertIn(entry.id, ids, f"{model} de la société de l'administrateur : historique visible")

    def test_message_de_module_d_une_autre_societe(self):
        """Audit du noyau, M2 : « qu'EGUITRA GROUP SARLU », « que MB AxisPro Consulting »."""
        self.assertIn("ne concerne qu'EGUITRA GROUP SARLU :", wrong_company_message("groupe"))
        self.assertIn("ne concerne que MB AxisPro Consulting :", wrong_company_message("cabinet"))
