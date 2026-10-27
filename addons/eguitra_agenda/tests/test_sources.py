from datetime import date

from dateutil.relativedelta import relativedelta

from odoo import fields
from odoo.tests import tagged

from .common import AgendaCase


@tagged("post_install", "-at_install")
class TestSourcesMetier(AgendaCase):
    """Sources métier : proposées selon les profils et les modules installés, choisies par chacun, calculées à
    la lecture (sans doublon quand la source change) et bornées aux droits du module."""

    def sources(self, user, first, last, codes=None):
        path = f"/agenda/sources?start={first.isoformat()}&end={last.isoformat()}"
        if codes:
            path += "&codes=" + ",".join(codes)
        return self.ok("GET", path, user)["items"]

    def available(self, user):
        return {s["code"]: s for s in self.ok("GET", "/agenda/me", user)["sources"]}

    def test_sources_selon_le_profil(self):
        finance = self.available(self.alice)
        exploitation = self.available(self.bruno)
        if "eguitra.tax.return" in self.env:
            self.assertIn("finance_fiscal", finance)
            self.assertNotIn("finance_fiscal", exploitation, "Pas de fiscalité hors des profils de la finance")
            self.assertIn("finance_fournisseurs", self.available(self.awa), "Achats : échéances fournisseurs")
            self.assertNotIn("finance_clients", self.available(self.awa), "Achats : jamais les ventes")
        if "axispro.review" in self.env and self.cabinet:
            self.assertIn("axispro_comites", self.available(self.consultant))
            self.assertNotIn("axispro_comites", finance, "Un compte du seul groupe n'a pas les comités du cabinet")
        # Une source demandée sans y avoir droit ne rend rien.
        today = fields.Date.today()
        self.assertEqual(self.sources(self.bruno, today, today + relativedelta(days=30), ["finance_fiscal"]), [])
        status, _b = self.call("GET", f"/agenda/sources?start={today}&end={today + relativedelta(days=90)}",
                               token=self.token(self.alice))
        self.assertEqual(status, 422, "Soixante-deux jours au plus")

    def test_choix_des_sources(self):
        if "eguitra.tax.return" not in self.env:
            self.skipTest("Module Finance absent de la base de test")
        before = self.available(self.alice)
        self.assertTrue(before["finance_fiscal"]["shown"], "Affichée par défaut")
        self.assertFalse(before["finance_clients"]["shown"], "Les échéances des factures sont à cocher")
        self.ok("PATCH", "/agenda/preferences", self.alice, {"sources": ["finance_clients", "inconnue"]})
        after = self.available(self.alice)
        self.assertEqual({c for c, s in after.items() if s["shown"]}, {"finance_clients"})
        prefs = self.ok("PATCH", "/agenda/preferences", self.alice, {"sources": None})
        self.assertIsNone(prefs["sources"], "Retour aux sources par défaut")

    def test_declarations_et_clotures(self):
        if "eguitra.tax.return" not in self.env:
            self.skipTest("Module Finance absent de la base de test")
        month = fields.Date.today().replace(day=1) + relativedelta(months=1)
        deadline = month + relativedelta(months=1, day=15)
        items = self.sources(self.alice, deadline, deadline, ["finance_fiscal"])
        keys = {i["key"]: i for i in items}
        vat = keys[f"fiscal:{self.groupe.id}:vat:{month.isoformat()}"]
        self.assertEqual((vat["date"], vat["status"], vat["href"]), (deadline.isoformat(), "à préparer", "/finance/fiscalite"))
        self.assertIn(f"fiscal:{self.groupe.id}:withholding:{month.isoformat()}", keys)
        self.assertEqual(len(items), 2, "Les deux déclarations de la seule société d'Alice")
        # La source change : la déclaration préparée change d'état, sans doublon.
        self.env["eguitra.tax.return"].create({"company_id": self.groupe.id, "period": month, "kind": "vat"})
        items = self.sources(self.alice, deadline, deadline, ["finance_fiscal"])
        vat = next(i for i in items if i["key"] == f"fiscal:{self.groupe.id}:vat:{month.isoformat()}")
        self.assertEqual((len(items), vat["status"]), (2, "préparée"))
        last_day = month + relativedelta(months=1, days=-1)
        closes = self.sources(self.alice, last_day, last_day, ["finance_clotures"])
        self.assertEqual([(c["title"], c["status"]) for c in closes][0][1], "à clôturer")

    def test_validations_en_attente(self):
        if "eguitra.approval.request" not in self.env:
            self.skipTest("Module des approbations absent de la base de test")
        today = fields.Date.today()
        supplier = self.env["res.partner"].create({"name": "Fournisseur de l'essai"})
        self.env["eguitra.approval.request"].sudo().create({
            "name": "Facture fournisseur FAC-118", "company_id": self.groupe.id, "document": "in_invoice",
            "res_model": "res.partner", "res_id": supplier.id, "requested_by": self.bruno.id,
            "step_ids": [(0, 0, {"sequence": 1, "label": "Visa de la finance", "profile": "finance"})],
        })
        items = self.sources(self.alice, today, today, ["approbations"])
        self.assertEqual([(i["title"], i["href"]) for i in items],
                         [("À valider : Facture fournisseur FAC-118", "/finance/approbations")])
        self.assertEqual(self.sources(self.bruno, today, today, ["approbations"]), [],
                         "Le demandeur ne tranche pas sa propre demande")
        self.assertEqual(self.sources(self.alice, today + relativedelta(days=1), today + relativedelta(days=2),
                                      ["approbations"]), [], "Placée aujourd'hui seulement")

    def test_conges_de_l_equipe(self):
        if "eguitra.rh.leave" not in self.env:
            self.skipTest("Module RH absent de la base de test")
        Employee = self.env["eguitra.rh.employee"]
        chef = Employee.create({"name": "Alice Chef", "hire_date": date(2024, 1, 1), "base_salary": 5_000_000,
                                "user_id": self.alice.id})
        bruno = Employee.create({"name": "Bruno Collaborateur", "hire_date": date(2024, 1, 1), "base_salary": 3_000_000,
                                 "manager_id": chef.id, "user_id": self.bruno.id})
        Employee.create({"name": "Carla Autre", "hire_date": date(2024, 1, 1), "base_salary": 3_000_000,
                         "user_id": self.carla.id})
        leave_type = self.env["eguitra.rh.leave.type"].search([("code", "=", "MAL")], limit=1)
        leave = self.env["eguitra.rh.leave"].create({"employee_id": bruno.id, "type_id": leave_type.id,
                                                     "date_from": self.at(1, 0).date(), "date_to": self.at(2, 0).date()})
        leave.action_approve(force=True)
        first, last = self.at(0, 0).date(), self.at(6, 0).date()
        self.assertIn("rh_equipe", self.available(self.alice), "Responsable hiérarchique")
        items = self.sources(self.alice, first, last, ["rh_equipe"])
        self.assertEqual([(i["title"], i["date"], i["end_date"]) for i in items],
                         [(f"Bruno Collaborateur : {leave_type.name}", self.at(1, 0).date().isoformat(),
                           self.at(2, 0).date().isoformat())])
        mine = self.sources(self.bruno, first, last, ["rh_absences"])
        self.assertEqual([i["title"] for i in mine], [leave_type.name], "Ses propres absences")
        self.assertEqual(self.sources(self.carla, first, last, ["rh_equipe"]), [], "Une collègue d'une autre équipe")
        self.assertNotIn("rh_equipe", self.available(self.carla))
        # La source change (absence annulée) : l'agenda suit, sans rien garder.
        leave.sudo().write({"state": "cancelled"})
        self.assertEqual(self.sources(self.alice, first, last, ["rh_equipe"]), [], "Absence annulée : disparue d'elle-même")
