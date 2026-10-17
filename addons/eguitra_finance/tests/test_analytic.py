from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestAnalyticAxes(FinanceDataMixin, ApiCase):
    """Axes analytiques tenus par la finance et imputation sur tous les axes à la saisie."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls._create_user("fatou", "finance")
        cls._create_user("ibrahima", "exploitation")
        cls._create_user("kadiatou", "finance", company_ids=[(6, 0, (cls.company | cls.cabinet).ids)])
        cls.plan_activity = cls.env.ref("eguitra_base.analytic_plan_activite")
        cls.plan_chantier = cls.env.ref("eguitra_base.analytic_plan_chantier")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def _create(self, payload, token=None):
        return self.call("POST", "/finance/analytic-accounts", payload, token=token or self.token)

    def test_axes_selon_la_societe(self):
        status, axes = self.call("GET", "/finance/analytic-axes", token=self.token)
        self.assertEqual(status, 200, axes)
        keys = [a["key"] for a in axes]
        self.assertEqual(keys, ["activite", "centre_cout", "chantier", "vehicule", "route", "bien"],
                         "EGUITRA GROUP : axes communs et axes des métiers du groupe")
        self.assertEqual([a["key"] for a in axes if a["managed"]], ["activite", "centre_cout"])
        token = self.open_session("kadiatou")["access_token"]
        status, axes = self.call("GET", "/finance/analytic-axes", token=token,
                                 headers={"X-Eguitra-Company": str(self.cabinet.id)})
        self.assertEqual(status, 200, axes)
        self.assertEqual([a["key"] for a in axes], ["activite", "centre_cout", "dossier"],
                         "MB AxisPro Consulting : axes communs et dossiers du cabinet")

    def test_activite_et_centre_de_cout(self):
        status, activity = self._create({"plan": "activite", "name": "Négoce de produits pétroliers",
                                         "code": "neg", "income_account_id": self.acc_services.id})
        self.assertEqual(status, 200, activity)
        self.assertEqual(activity["code"], "NEG")
        self.assertEqual(activity["income_account"]["id"], self.acc_services.id)
        status, body = self._create({"plan": "activite", "name": "négoce de produits pétroliers"})
        self.assertEqual((status, body["error"]), (409, "conflict"), "Libellé déjà pris sur l'axe")
        status, body = self._create({"plan": "activite", "name": "Location", "income_account_id": self.acc_purchase.id})
        self.assertEqual(status, 422, "Le compte de produit d'une activité est en classe 7")

        status, center = self._create({"plan": "centre_cout", "name": "Atelier de Matoto",
                                       "activity_id": activity["id"]})
        self.assertEqual(status, 200, center)
        self.assertEqual(center["activity"]["id"], activity["id"])
        status, body = self._create({"plan": "centre_cout", "name": "Siège", "income_account_id": self.acc_services.id})
        self.assertEqual(status, 422, "Un centre de coût ne porte pas de compte de produit")

        status, renamed = self.call("PATCH", f"/finance/analytic-accounts/{center['id']}",
                                    {"name": "Atelier de Matoto (parc)", "active": False}, token=self.token)
        self.assertEqual(status, 200, renamed)
        self.assertFalse(renamed["active"])
        status, listing = self.call("GET", "/finance/analytic-accounts?plan=centre_cout", token=self.token)
        self.assertNotIn(center["id"], [a["id"] for a in listing], "Un centre archivé n'est plus proposé")
        status, listing = self.call("GET", "/finance/analytic-accounts?plan=centre_cout&active=all", token=self.token)
        self.assertIn(center["id"], [a["id"] for a in listing])

        status, body = self._create({"plan": "chantier", "name": "Route Kankan"})
        self.assertEqual(status, 422, "Les axes métier naissent avec leur fiche")
        chantier = self.env["account.analytic.account"].create(
            {"name": "Chantier test", "plan_id": self.plan_chantier.id, "company_id": self.company.id})
        status, body = self.call("PATCH", f"/finance/analytic-accounts/{chantier.id}", {"name": "Autre"}, token=self.token)
        self.assertEqual(status, 422)
        token = self.open_session("ibrahima")["access_token"]
        status, _b = self._create({"plan": "activite", "name": "Interdit"}, token=token)
        self.assertEqual(status, 403, "Référentiel tenu par la finance et l'administration")

    def test_facture_imputee_sur_plusieurs_axes(self):
        _s, activity = self._create({"plan": "activite", "name": "Transport de conteneurs",
                                     "income_account_id": self.acc_services.id})
        _s, center = self._create({"plan": "centre_cout", "name": "Base de Kamsar", "activity_id": activity["id"]})
        chantier = self.env["account.analytic.account"].create(
            {"name": "Chantier Boké", "plan_id": self.plan_chantier.id, "company_id": self.company.id})
        status, move = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"name": "Transport de 12 conteneurs", "quantity": 12, "price_unit": 5_000_000,
                       "analytic_distribution": {str(activity["id"]): 100, str(center["id"]): 100,
                                                 str(chantier.id): 100}}],
        }, token=self.token)
        self.assertEqual(status, 200, move)
        line = move["lines"][0]
        self.assertEqual(line["account"]["id"], self.acc_services.id, "Compte de produit déduit de l'activité")
        self.assertEqual(set(line["analytic_distribution"]), {str(activity["id"]), str(center["id"]), str(chantier.id)})
        self.assertEqual({a["axis"] for a in line["analytic"]}, {"activite", "centre_cout", "chantier"})
        invoice = self.env["account.move"].browse(move["id"])
        invoice.with_context(eguitra_approval_granted=True).action_post()
        status, rows = self.call("GET", f"/finance/analytics?plan=centre_cout&date_to={self.today}", token=self.token)
        self.assertEqual(status, 200, rows)
        self.assertEqual(next(r for r in rows["rows"] if r["analytic_account_id"] == center["id"])["income"], 60_000_000)

    def test_repartitions_refusees(self):
        first = self.env["account.analytic.account"].create(
            {"name": "Activité A", "plan_id": self.plan_activity.id, "company_id": self.company.id})
        second = self.env["account.analytic.account"].create(
            {"name": "Activité B", "plan_id": self.plan_activity.id, "company_id": self.company.id})
        other = self.env["account.analytic.account"].create(
            {"name": "Activité du cabinet", "plan_id": self.plan_activity.id, "company_id": self.cabinet.id})

        def invoice(dist):
            return self.call("POST", "/finance/moves", {
                "move_type": "in_invoice", "partner_id": self.supplier.id,
                "lines": [{"name": "Gasoil", "price_unit": 1_000_000, "account_id": self.acc_purchase.id,
                           "analytic_distribution": dist}],
            }, token=self.token)

        status, body = invoice({str(first.id): 60, str(second.id): 50})
        self.assertEqual(status, 422, "110 % sur l'axe Activité")
        self.assertIn("Activité", body["message"])
        status, body = invoice({str(other.id): 100})
        self.assertEqual(status, 422, "Compte analytique de l'autre société")
        status, body = invoice({"abc": 100})
        self.assertEqual(status, 400)
        status, move = invoice({str(first.id): 60, str(second.id): 40})
        self.assertEqual(status, 200, move)

    def _purchase(self, dist=None, post=False):
        return self.call("POST", "/finance/moves", {
            "move_type": "in_invoice", "partner_id": self.supplier.id, "post": post,
            "lines": [{"name": "Électricité du siège", "price_unit": 2_000_000, "account_id": self.acc_purchase.id,
                       "analytic_distribution": dist}],
        }, token=self.token)

    def test_imputations_automatiques(self):
        Analytic = self.env["account.analytic.account"]
        plan_center = self.env.ref("eguitra_base.analytic_plan_centre_cout")
        own = Analytic.create({"name": "Siège", "plan_id": self.plan_activity.id, "company_id": self.company.id})
        partner_activity = Analytic.create({"name": "Stations", "plan_id": self.plan_activity.id,
                                            "company_id": self.company.id})
        center = Analytic.create({"name": "Direction générale", "plan_id": plan_center.id, "company_id": self.company.id})
        prefix = self.acc_purchase.code[:4]
        status, rule = self.call("POST", "/finance/analytic-rules", {
            "account_prefix": prefix, "analytic_distribution": {str(center.id): 100}}, token=self.token)
        self.assertEqual(status, 200, rule)
        self.assertEqual(rule["axes"], ["Centre de coût"])
        status, body = self.call("POST", "/finance/analytic-rules", {"analytic_distribution": {str(center.id): 100}},
                                 token=self.token)
        self.assertEqual(status, 400, "Une règle sans critère s'appliquerait à toutes les lignes")
        status, body = self.call("POST", "/finance/analytic-rules", {"account_prefix": "6a"}, token=self.token)
        self.assertEqual(status, 400)
        status, rule2 = self.call("POST", "/finance/analytic-rules", {
            "partner_id": self.supplier.id, "analytic_distribution": {str(partner_activity.id): 100}}, token=self.token)
        self.assertEqual(status, 200, rule2)

        status, move = self._purchase({str(own.id): 100})
        self.assertEqual(status, 200, move)
        dist = move["lines"][0]["analytic_distribution"]
        self.assertEqual(set(dist), {str(own.id), str(center.id)},
                         "L'activité saisie prime ; la règle du préfixe complète le centre de coût")
        status, move = self._purchase()
        self.assertEqual(set(move["lines"][0]["analytic_distribution"]), {str(partner_activity.id), str(center.id)},
                         "Sans saisie, les règles de deux axes différents se cumulent")
        status, simulation = self.call(
            "GET", f"/finance/analytic-rules/simulate?account_id={self.acc_purchase.id}&partner_id={self.supplier.id}",
            token=self.token)
        self.assertEqual(status, 200, simulation)
        self.assertEqual({s["name"] for s in simulation["distribution"]}, {"Stations", "Direction générale"})

        status, _b = self.call("DELETE", f"/finance/analytic-rules/{rule2['id']}", token=self.token)
        self.assertEqual(status, 200)
        status, rules = self.call("GET", "/finance/analytic-rules", token=self.token)
        self.assertEqual([r["id"] for r in rules if r["id"] in (rule["id"], rule2["id"])], [rule["id"]])

    def test_imputation_obligatoire(self):
        activity = self.env["account.analytic.account"].create(
            {"name": "Holding", "plan_id": self.plan_activity.id, "company_id": self.company.id})
        prefix = self.acc_purchase.code[:4]
        status, body = self.call("POST", "/finance/analytic-requirements", {"plan": "activite", "prefix": prefix},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        status, requirements = self.call("GET", "/finance/analytic-requirements", token=self.token)
        requirement = next(r for r in requirements if r["prefix"] == prefix)
        self.assertEqual(sorted(requirement["domains"]), ["bill", "general", "invoice"])
        self.assertEqual(requirement["axis"], "activite")

        status, body = self._purchase(post=True)
        self.assertEqual((status, body["error"]), (422, "analytic_required"), body)
        self.assertIn("Activité", body["message"])
        status, body = self._purchase({str(activity.id): 100}, post=True)
        self.assertEqual(status, 200, body)

        status, _b = self.call("DELETE", f"/finance/analytic-requirements/{requirement['id']}", token=self.token)
        self.assertEqual(status, 200)
        status, body = self._purchase(post=True)
        self.assertEqual(status, 200, "Obligation levée")
