"""Clôture de l'exercice (offre, chapitres 6.3 et 7.1) : état des douze mois, OD d'affectation du résultat
décidée par l'assemblée (brouillon, circuit des OD), verrouillage définitif et ses refus."""

from dateutil.relativedelta import relativedelta

from odoo import Command
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .exercices_common import ALLOCATION, CURRENT, PREVIOUS, TwoYearsMixin


@tagged("post_install", "-at_install")
class TestClotureExercice(TwoYearsMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_two_years()
        cls.year = cls.previous_end.year
        cls._create_user("compta.exercice", "finance")
        cls._create_user("dg.exercice", "direction")
        cls._create_user("compta.sans.droit", "finance")._eguitra_set_rights({"free_accounts": False})
        cls.accounts = {prefix: cls.plan_account(prefix, name, kind) for prefix, name, kind, _amount in ALLOCATION}
        # Les douze mois de l'exercice précédent, chacun avec une écriture (sans effet sur le résultat), clôturés
        # dans l'ordre.
        Close = cls.env["eguitra.period.close"]
        general = cls.env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "general"), ("code", "!=", "AN")],
            order="sequence, id", limit=1)
        month = cls.previous_start
        while month <= cls.previous_end:
            cls.env["account.move"].create({
                "move_type": "entry", "journal_id": general.id, "date": month + relativedelta(days=4),
                "ref": "Approvisionnement de la caisse",
                "line_ids": [Command.create({"name": "Caisse", "account_id": cls.cash.default_account_id.id,
                                             "debit": 1_000_000}),
                             Command.create({"name": "Banque", "account_id": cls.bank.default_account_id.id,
                                             "credit": 1_000_000})],
            }).action_post()
            Close._get(cls.company, month).action_close()
            month += relativedelta(months=1)
        cls.december = Close._get(cls.company, cls.previous_end)
        cls.env.flush_all()

    def setUp(self):
        super().setUp()
        self._tokens = {}

    def _token(self, login):
        """Une session par compte et par test (la double authentification s'active à la première)."""
        if login not in self._tokens:
            self._tokens[login] = self.open_session(login)["access_token"]
        return self._tokens[login]

    def _status(self, login="compta.exercice", year=None):
        status, body = self.call("GET", f"/finance/closing/year?year={year or self.year}", token=self._token(login))
        self.assertEqual(status, 200, body)
        return body

    def _payload(self, **changes):
        payload = {"year": self.year, "date": self.today.isoformat(), "note": "Assemblée générale ordinaire",
                   "lines": [{"account_id": self.accounts[prefix].id, "amount": amount}
                             for prefix, _name, _kind, amount in ALLOCATION]}
        payload.update(changes)
        return payload

    def _allocate(self, login="compta.exercice", **changes):
        return self.call("POST", "/finance/closing/year/allocation", self._payload(**changes), token=self._token(login))

    def test_etat_de_l_exercice(self):
        body = self._status()
        self.assertEqual(body["months_closed"], 12)
        self.assertEqual([m["state"] for m in body["months"]], ["closed"] * 12)
        self.assertEqual(body["fiscal_year"], {"start": self.previous_start.isoformat(), "end": self.previous_end.isoformat()})
        self.assertEqual(body["result"], PREVIOUS, "Résultat de l'exercice")
        self.assertEqual(body["to_allocate"], PREVIOUS, "Rien d'affecté encore")
        self.assertEqual(body["previous_unallocated"], 0, "Aucun exercice antérieur")
        self.assertEqual(body["allocations"], [])
        self.assertTrue(body["allocation"]["can_allocate"], body["allocation"])
        self.assertEqual(body["unaffected_account"]["id"], self.unaffected.id)
        self.assertTrue({"111", "118", "121", "465"} <= {a["code"][:3] for a in body["allocation_accounts"]})
        self.assertFalse(body["locked"])
        self.assertTrue(body["lock"]["can_lock"], body["lock"])
        self.assertEqual(self._status("dg.exercice")["result"], PREVIOUS, "La direction lit l'état de l'exercice")
        status, default = self.call("GET", "/finance/closing/year", token=self._token("compta.exercice"))
        self.assertEqual((status, default["year"]), (200, self.year), "Par défaut, l'exercice précédent")

        current = self._status(year=self.fy_end.year)
        self.assertEqual(current["result"], CURRENT)
        self.assertEqual(current["previous_unallocated"], PREVIOUS, "Résultat antérieur restant à affecter")
        self.assertFalse(current["lock"]["can_lock"])
        self.assertIn("year_running", [c["code"] for c in current["lock"]["blocking"]], "Exercice en cours")
        self.assertIn("months_open", [c["code"] for c in current["lock"]["blocking"]])
        self.assertFalse(current["allocation"]["can_allocate"])

    def test_od_d_affectation_du_resultat(self):
        status, body = self._allocate()
        self.assertEqual(status, 200, body)
        move = self.env["account.move"].browse(body["created"]["id"])
        self.assertEqual(move.state, "draft", "Créée en brouillon : elle suit le circuit des OD")
        self.assertEqual(move.ref, f"Affectation du résultat {self.year}")
        self.assertEqual((move.journal_id.type, move.date), ("general", self.today))
        self.assertNotEqual(move.journal_id.code, "AN", "Journal des opérations diverses")
        self.assertTrue(move.eguitra_manual_entry, "Saisie des applications : circuit de validation des OD")
        self.assertEqual(move.eguitra_allocation_year, self.year)
        counterpart = move.line_ids.filtered(lambda line: line.account_id == self.unaffected)
        self.assertEqual((counterpart.debit, counterpart.credit), (PREVIOUS, 0), "Débit du compte d'affectation")
        credits = {line.account_id.id: line.credit for line in move.line_ids - counterpart}
        self.assertEqual(credits, {self.accounts[prefix].id: amount for prefix, _n, _k, amount in ALLOCATION})
        self.assertEqual((body["to_allocate"], body["allocated"]["draft"]), (0, PREVIOUS))
        self.assertEqual([a["id"] for a in body["allocations"]], [move.id])
        self.assertFalse(body["allocation"]["can_allocate"], "Résultat entièrement affecté")

        status, again = self._allocate()
        self.assertEqual((status, again["error"]), (422, "business_rule"), "Une seconde OD est refusée")

        # Validée au terme du circuit, elle fait passer le résultat antérieur en réserves.
        move.with_context(eguitra_approval_granted=True).sudo().action_post()
        self.env.flush_all()
        sheet = self.env["eguitra.syscohada"].balance_sheet(self.company, self.today)
        self.assertAlmostEqual(sheet["result_previous_unallocated"], 0, 0)
        self.assertAlmostEqual(sheet["difference"], 0, 0, msg="Bilan équilibré après l'affectation")
        body = self._status()
        self.assertEqual((body["allocated"]["posted"], body["to_allocate"]), (PREVIOUS, 0))
        self.assertEqual(self._status(year=self.fy_end.year)["previous_unallocated"], 0, "Plus rien d'antérieur à affecter")

    def test_affectation_refusee(self):
        status, body = self._allocate("dg.exercice")
        self.assertEqual(status, 403, "Route de la finance : la direction ne crée pas l'OD")
        status, body = self._allocate("compta.sans.droit")
        self.assertEqual(status, 403, "OD : droit « Saisie libre des comptes »")

        lines = self._payload()["lines"]
        refusals = {
            "total": dict(lines=lines[:-1]),
            "compte": dict(lines=lines[:-1] + [{"account_id": self.acc_services.id, "amount": 500_000_000}]),
            "nul": dict(lines=lines[:-1] + [{"account_id": self.accounts["465"].id, "amount": 0},
                                            {"account_id": self.accounts["121"].id, "amount": 500_000_000}]),
            "négatif": dict(lines=lines + [{"account_id": self.accounts["121"].id, "amount": -1}]),
            "date": dict(date=self.previous_end.isoformat()),
        }
        messages = {"total": "doit être égal", "compte": "ni une réserve", "nul": "montant", "négatif": "montant",
                    "date": "après la clôture"}
        for case, changes in refusals.items():
            status, body = self._allocate(**changes)
            self.assertEqual((status, body.get("error")), (422, "business_rule"), (case, body))
            self.assertIn(messages[case], body["message"], case)
        self.assertFalse(self.env["account.move"].search_count([("eguitra_allocation_year", "=", self.year)]),
                         "Aucune OD créée par un envoi refusé")

    def test_verrouillage_definitif(self):
        status, body = self.call("POST", "/finance/closing/year/lock", {"year": self.year},
                                 token=self._token("compta.exercice"))
        self.assertEqual(status, 403, "La finance seule ne verrouille pas l'exercice")

        status, body = self.call("POST", "/finance/closing/year/lock", {"year": self.year}, token=self._token("dg.exercice"))
        self.assertEqual(status, 200, body)
        self.assertTrue(body["locked"])
        self.assertEqual(body["hard_lock_date"], self.previous_end.isoformat())
        self.env.invalidate_all()
        self.assertEqual(self.company.hard_lock_date, self.previous_end, "Date de verrouillage définitive du noyau")
        self.assertEqual([e["action"] for e in body["events"]], ["year_lock"], "Tracé au registre des clôtures")
        self.assertEqual(self.december.event_ids[:1].action, "year_lock")
        status, registry = self.call("GET", f"/finance/closing?year={self.year}", token=self._token("dg.exercice"))
        self.assertEqual([e["action"] for e in registry["months"][-1]["events"]], ["close"],
                         "Le registre du mois ne montre que ses clôtures et réouvertures")

        status, body = self.call("POST", "/finance/closing/year/lock", {"year": self.year}, token=self._token("dg.exercice"))
        self.assertEqual(status, 422, "Déjà verrouillé")
        status, body = self.call("POST", "/finance/closing/reopen",
                                 {"period": self.previous_end.replace(day=1).isoformat(), "reason": "Correction tardive"},
                                 token=self._token("dg.exercice"))
        self.assertEqual(status, 422, "Un mois d'un exercice verrouillé ne se rouvre plus")
        status, body = self._allocate()
        self.assertEqual(status, 200, "L'affectation se passe après le verrouillage, à la date de l'assemblée")

    def test_verrouillage_refuse_si_un_mois_reste_ouvert(self):
        self.december.action_reopen("Facture de décembre oubliée")
        self.env.flush_all()
        body = self._status("dg.exercice")
        self.assertEqual(body["months_closed"], 11)
        self.assertFalse(body["lock"]["can_lock"])
        status, body = self.call("POST", "/finance/closing/year/lock", {"year": self.year}, token=self._token("dg.exercice"))
        self.assertEqual((status, body.get("error")), (422, "business_rule"), body)
        self.assertIn(f"{self.previous_end:%m/%Y}", body["message"], "Le mois ouvert est nommé")
        self.env.invalidate_all()
        self.assertFalse(self.company.hard_lock_date)
        status, body = self._allocate()
        self.assertEqual(status, 422, "L'assemblée statue sur des comptes arrêtés")
        self.assertIn("clôturez d'abord", body["message"])

    def test_brouillon_bloque_le_verrouillage(self):
        journal = self.env["account.journal"].search(
            [("company_id", "=", self.company.id), ("type", "=", "general"), ("code", "!=", "AN")], limit=1)
        self.env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "date": self.previous_end, "ref": "Régularisation oubliée",
            "line_ids": [Command.create({"name": "Régularisation", "account_id": self.acc_purchase.id, "debit": 1_000_000}),
                         Command.create({"name": "Régularisation", "account_id": self.accounts["121"].id,
                                         "credit": 1_000_000})],
        })
        self.env.flush_all()
        body = self._status("dg.exercice")
        self.assertIn("draft_moves", [c["code"] for c in body["lock"]["blocking"]])
        status, body = self.call("POST", "/finance/closing/year/lock", {"year": self.year}, token=self._token("dg.exercice"))
        self.assertEqual(status, 422, body)
        self.assertIn("brouillon", body["message"])
