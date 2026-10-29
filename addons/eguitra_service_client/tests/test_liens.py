"""Liens vers les fiches des autres modules (selon les modules installés) et réclamation de qualité vers HSSEQ."""

from odoo import Command
from odoo.tests import tagged

from .common import ScCase

T = "/service-client/tickets"


@tagged("post_install", "-at_install")
class TestLiens(ScCase):
    def invoice(self, partner, company=None):
        company = company or self.groupe
        # Code de compte propre à chaque société : recherche et journal dans la société de la facture.
        env = self.env["account.account"].sudo().with_company(company)
        account = env.search([("code", "=like", "70%"), ("company_ids", "in", company.ids)], order="code", limit=1)
        journal = self.env["account.journal"].sudo().search([("type", "=", "sale"), ("company_id", "=", company.id)],
                                                            limit=1)
        self.assertTrue(account and journal, f"Compte de produit et journal de vente de {company.name}")
        return self.env["account.move"].sudo().with_company(company).create({
            "move_type": "out_invoice", "partner_id": partner.id, "company_id": company.id, "journal_id": journal.id,
            "invoice_line_ids": [Command.create({"name": "Transport (essai)", "quantity": 1, "price_unit": 1_000_000,
                                                 "account_id": account.id, "tax_ids": [Command.set([])]})],
        })

    def test_facture_du_client_seulement(self):
        ticket = self.ticket(kind="complaint", category_id=self.env["eguitra.sc.category"].sudo().search(
            [("company_id", "=", self.groupe.id), ("code", "=", "facturation")]).id)
        mine, other = self.invoice(self.client_a), self.invoice(self.client_b)
        found = self.api("GET", f"/service-client/links?model=account.move&partner_id={self.client_a.id}", self.agent)
        self.assertEqual([r["id"] for r in found], [mine.id], "Les seules factures du client du dossier")
        self.api("GET", "/service-client/links?model=account.move", self.agent, status=422)
        detail = self.api("PATCH", f"{T}/{ticket.id}", self.agent, {"link_model": "account.move", "link_id": mine.id})
        self.assertEqual((detail["link"]["type"], detail["link"]["id"]), ("Facture", mine.id))
        self.api("PATCH", f"{T}/{ticket.id}", self.agent, {"link_model": "account.move", "link_id": other.id},
                 status=422)
        self.api("PATCH", f"{T}/{ticket.id}", self.agent, {"link_model": "res.users", "link_id": self.agent.id},
                 status=422)
        client = self.api("GET", f"/espace-client/tickets/{ticket.id}", self.user_a)
        self.assertEqual(client["link"]["type"], "Facture", "Le client lit la nature et le numéro, rien de plus")
        self.assertNotIn("href", client["link"])

    def test_facture_d_une_autre_societe_refusee(self):
        if not self.cabinet:
            self.skipTest("Société du cabinet absente")
        ticket = self.ticket(partner_id=False)
        other = self.invoice(self.client_c, self.cabinet)
        self.api("PATCH", f"{T}/{ticket.id}", self.agent, {"link_model": "account.move", "link_id": other.id},
                 status=422)

    def test_natures_proposees_selon_les_modules(self):
        links = {row["model"] for row in self.api("GET", "/service-client/context", self.agent)["links"]}
        self.assertIn("account.move", links)
        for model in ("eguitra.transport.rotation", "eguitra.chantier", "eguitra.lease", "axispro.dossier", "sale.order"):
            self.assertEqual(model in links, model in self.env, model)

    def test_chantier_et_bien_s_ils_sont_installes(self):
        if "eguitra.chantier" not in self.env:
            self.skipTest("Module BTP absent")
        chantier = self.env["eguitra.chantier"].sudo().create({"name": "Entrepôt (essai)", "partner_id": self.client_a.id,
                                                               "company_id": self.groupe.id})
        ticket = self.ticket()
        detail = self.api("PATCH", f"{T}/{ticket.id}", self.agent, {"link_model": "eguitra.chantier",
                                                                    "link_id": chantier.id})
        self.assertEqual(detail["link"]["label"], "Entrepôt (essai)")
        if "eguitra.property" in self.env:
            bien = self.env["eguitra.property"].sudo().create({"name": "Villa (essai)", "company_id": self.groupe.id})
            detail = self.api("PATCH", f"{T}/{ticket.id}", self.agent, {"link_model": "eguitra.property",
                                                                        "link_id": bien.id})
            self.assertEqual(detail["link"]["type"], "Bien")

    def test_reclamation_hsseq_creee_puis_rejointe(self):
        if "eguitra.hsseq.complaint" not in self.env:
            self.skipTest("Module HSSEQ absent")
        produit = self.env["eguitra.sc.category"].sudo().search([("company_id", "=", self.groupe.id),
                                                                  ("code", "=", "produit")])
        first = self.ticket(kind="complaint", category_id=produit.id, priority="high",
                            subject="Manquant de 2 000 litres (essai)")
        detail = self.api("GET", f"{T}/{first.id}", self.agent)
        self.assertTrue(detail["hsseq_suggested"])
        detail = self.api("POST", f"{T}/{first.id}/hsseq", self.agent, {"mode": "create"})
        complaint = self.env["eguitra.hsseq.complaint"].sudo().browse(detail["hsseq"]["id"])
        self.assertEqual((complaint.partner_id, complaint.nature, complaint.severity),
                         (self.client_a, "shortage", "major"))
        self.assertIn(first.name, complaint.description)
        self.api("POST", f"{T}/{first.id}/hsseq", self.agent, {"mode": "create"}, status=422)
        second = self.ticket(kind="complaint", category_id=produit.id)
        candidates = self.api("GET", f"{T}/{second.id}/hsseq", self.agent)["complaints"]
        self.assertIn(complaint.id, [c["id"] for c in candidates])
        detail = self.api("POST", f"{T}/{second.id}/hsseq", self.agent, {"mode": "join", "complaint_id": complaint.id})
        self.assertEqual(detail["hsseq"]["reference"], complaint.reference)
        other = self.ticket(kind="complaint", partner_id=self.client_b.id, contact_email="contact@client-b.gn")
        self.api("POST", f"{T}/{other.id}/hsseq", self.agent, {"mode": "join", "complaint_id": complaint.id},
                 status=422)
        contact = self.ticket(kind="complaint", partner_id=False)
        self.api("POST", f"{T}/{contact.id}/hsseq", self.agent, {"mode": "create"}, status=422)
