from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install")
class TestSocle(TransactionCase):
    def test_societes(self):
        groupe = self.env.ref("base.main_company")
        self.assertEqual(groupe.name, "EGUITRA GROUP SARLU")
        self.assertEqual(groupe.eguitra_entity, "groupe")
        self.assertEqual(groupe.currency_id.name, "GNF")

        cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")])
        self.assertEqual(len(cabinet), 1)
        self.assertEqual(cabinet.name, "MB AxisPro")
        self.assertEqual(cabinet.currency_id.name, "GNF")
        self.assertEqual(cabinet.chart_template, "gn")
        nb_comptes = self.env["account.account"].search_count([("company_ids", "in", cabinet.ids)])
        self.assertGreater(nb_comptes, 500, "Le plan SYSCOHADA doit être chargé pour le cabinet")

    def test_creation_cabinet_idempotente(self):
        premier = self.env["eguitra.setup"].ensure_cabinet_company()
        second = self.env["eguitra.setup"].ensure_cabinet_company()
        self.assertEqual(premier, second)

    def test_axes_analytiques(self):
        noms = set(self.env["account.analytic.plan"].search([]).mapped("name"))
        for axe in ("Activité", "Centre de coût", "Chantier", "Ensemble routier", "Route",
                    "Bien immobilier", "Dossier AxisPro"):
            self.assertIn(axe, noms)

    def test_profils(self):
        Users = self.env["res.users"].with_context(no_reset_password=True)
        finance = Users.create({
            "name": "Comptable Test",
            "login": "comptable.test",
            "group_ids": [(4, self.env.ref("eguitra_base.group_profile_finance").id)],
        })
        self.assertEqual(finance._eguitra_profiles(), ["finance"])
        self.assertTrue(finance.has_group("account.group_account_manager"))

        achats = Users.create({
            "name": "Acheteuse Test",
            "login": "achats.socle",
            "group_ids": [(4, self.env.ref("eguitra_base.group_profile_achats").id)],
        })
        self.assertEqual(achats._eguitra_profiles(), ["achats"])
        self.assertTrue(achats.has_group("account.group_account_invoice"), "Facturation : pièces d'achat en brouillon")
        self.assertFalse(achats.has_group("account.group_account_user"))

        rh = Users.create({
            "name": "RH Test",
            "login": "rh.socle",
            "group_ids": [(4, self.env.ref("eguitra_base.group_profile_rh").id)],
        })
        self.assertEqual(rh._eguitra_profiles(), ["rh"])
        self.assertFalse(rh.has_group("account.group_account_invoice"), "La RH ne saisit pas de pièces comptables")

        admin = Users.create({
            "name": "Admin Test",
            "login": "admin.test",
            "group_ids": [(4, self.env.ref("eguitra_base.group_profile_admin").id)],
        })
        self.assertEqual(admin._eguitra_profiles(), ["admin", "direction", "finance"])

        porteur = Users.create({
            "name": "Porteur Test",
            "login": "porteur.test",
            "group_ids": [(6, 0, [self.env.ref("eguitra_base.group_profile_porteur").id])],
        })
        self.assertTrue(porteur.share, "Un porteur de projet est un utilisateur du portail")
        self.assertEqual(porteur._eguitra_profiles(), ["porteur"])

    def test_piste_audit(self):
        regle = self.env["auditlog.rule"].search([("model_id.model", "=", "res.partner")])
        self.assertEqual(regle.state, "confirmed")
        self.assertEqual(regle.log_type, "full")

        tiers = self.env["res.partner"].create({"name": "TOTAL GUINEE"})
        tiers.write({"name": "TOTALENERGIES GUINEE"})
        lignes = self.env["auditlog.log.line"].search([
            ("log_id.model_id.model", "=", "res.partner"),
            ("log_id.res_id", "=", tiers.id),
            ("field_id.name", "=", "name"),
            ("log_id.method", "=", "write"),
        ])
        self.assertTrue(lignes, "La modification doit être journalisée")
        self.assertIn("TOTAL GUINEE", lignes[0].old_value)
        self.assertIn("TOTALENERGIES GUINEE", lignes[0].new_value)

    def test_logo_d_exemple_retire(self):
        companies = self.env["res.company"].search([])
        placeholder = self.env["res.company"]._get_logo()
        self.assertFalse(companies.filtered(lambda c: c.logo == placeholder),
                         "Aucune société ne garde le logo d'exemple « Your logo » du noyau")
