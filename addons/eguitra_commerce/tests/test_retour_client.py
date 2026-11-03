"""Retour du client du 2 novembre 2026 sur les bons de commande : circuit (contrôle par le chef comptable ou le
DAF, puis direction générale selon le seuil), séparation des responsabilités, remplacement de l'ancien
circuit par défaut, bon imprimé (approbateurs, fonctions, dates et heures de Conakry, empreinte,
signature manuscrite), TVA (avec, sans, mixte, arrondis), historique, pièces jointes et leur archivage, devis
retenu repris de l'engagement, conditions de paiement et de livraison. Données fictives."""

import base64
import io

from PIL import Image

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_base.lettres import amount_in_words, capitalize, money

from ..models.approval import (
    PO_DOCUMENT,
    PO_SMALL_RULE_NAME_V2,
    PURCHASE_ORDER_RULES,
    PURCHASE_ORDER_RULES_V1,
    REPLACED_PREFIX,
    ensure_purchase_order_rules,
    rename_small_purchase_order_rule,
    upgrade_purchase_order_rules,
)
from ..models.purchase_order import company_address
from .common import CommerceDataMixin

PDF = b"%PDF-1.4 devis du fournisseur (test)"


def png(width=240, height=80):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, "PNG")
    return buffer.getvalue()


@tagged("post_install", "-at_install")
class TestRetourClientAchats(CommerceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_commerce()
        cls.acheteur = cls.make_user("acheteur.retour", "achats")
        cls.comptable = cls.make_user("comptable.retour", "finance")
        cls.daf = cls.make_user("daf.retour", "finance")
        cls.dg = cls.make_user("dg.retour", "direction")
        cls.admin = cls.make_user("admin.retour", "admin")
        cls.chef_chantier = cls.make_user("chantier.retour", "chantiers")
        cls.groupe.write({"eguitra_three_quotes_threshold": 0.0})

    def _approve_all(self, request, users=None):
        users = users or (self.comptable, self.daf, self.dg)
        while request.state == "pending":
            decider = next((u for u in users if request._can_decide(u)), None)
            self.assertTrue(decider, f"Personne pour l'étape « {request.current_step_id.label} »")
            request.with_user(decider).action_approve(f"Vu ({decider.name})")

    def _submitted(self, amount, taxes=None, **values):
        po = self.make_po(user=self.acheteur, lines=[self.po_line("Fournitures (test)", 1, amount, taxes=taxes)], **values)
        po.action_eguitra_submit()
        return po, self.request_of(po)

    # ─── Circuit : contrôle, puis direction générale ─────────────────────

    def _rules(self, company, active=True):
        Rule = self.env["eguitra.approval.rule"].sudo().with_context(active_test=False)
        domain = [("company_id", "=", company.id), ("document", "=", PO_DOCUMENT)]
        return Rule.search(domain + ([("active", "=", True)] if active else []))

    def _set_rules(self, company, rules):
        self._rules(company, active=False).unlink()
        for values in rules:
            self.env["eguitra.approval.rule"].sudo().create(dict(values, company_id=company.id))

    def test_regle_jusqu_a_10_m_renommee(self):
        """Migration 19.0.1.1.3 : la règle « jusqu'à 10 M » perd sa mention « niveau à définir », là où son libellé
        est resté celui de la version 19.0.1.1.1 ; profil, plafond et règle retouchée ou archivée inchangés."""
        small = self._rules(self.groupe).filtered(lambda r: r.sequence == 2 and r.max_amount)
        small.name = PO_SMALL_RULE_NAME_V2
        other = self._rules(self.cabinet).filtered(lambda r: r.sequence == 2 and r.max_amount)
        other.name = "Approbation : directeur général adjoint (test)"
        archived = small.copy({"name": PO_SMALL_RULE_NAME_V2, "active": False})
        po, request = self._submitted(3_000_000)
        self.assertEqual(rename_small_purchase_order_rule(self.env), small)
        self.assertEqual((small.name, small.approver_profile, small.max_amount),
                         ("Approbation : direction générale (jusqu'à 10 M GNF HT)", "direction", 10_000_000))
        self.assertEqual(other.name, "Approbation : directeur général adjoint (test)", "Règle retouchée : laissée")
        self.assertEqual(archived.name, PO_SMALL_RULE_NAME_V2, "Règle archivée : laissée")
        self.assertEqual(request.step_ids[1].label, PO_SMALL_RULE_NAME_V2, "Demande ouverte : étapes figées")
        self.assertFalse(rename_small_purchase_order_rule(self.env), "Relancée, la migration ne change rien")

    def test_circuit_par_defaut_et_idempotent(self):
        rules = self._rules(self.groupe)
        self.assertEqual(len(rules), len(PURCHASE_ORDER_RULES))
        control = rules.filtered(lambda r: r.sequence == 1)
        small = rules.filtered(lambda r: r.sequence == 2 and r.max_amount)
        large = rules.filtered(lambda r: r.sequence == 2 and r.min_amount)
        self.assertEqual((control.approver_profile, control.min_amount, control.max_amount), ("finance", 0, 0))
        self.assertEqual((small.approver_profile, small.min_amount, small.max_amount), ("direction", 0, 10_000_000))
        self.assertEqual((large.approver_profile, large.min_amount, large.max_amount), ("direction", 10_000_000, 0))
        self.assertEqual(small.name, "Approbation : direction générale (jusqu'à 10 M GNF HT)",
                         "La direction générale approuve aussi les bons de 10 M ou moins (réponse du 3 novembre)")
        ensure_purchase_order_rules(self.env)
        self.assertEqual(len(self._rules(self.groupe, active=False)), len(PURCHASE_ORDER_RULES),
                         "Relancée, la mise en place ne crée rien en double")
        small.active = False
        ensure_purchase_order_rules(self.env)
        self.assertEqual(len(self._rules(self.groupe, active=False)), len(PURCHASE_ORDER_RULES),
                         "Une règle désactivée par l'administration n'est pas recréée")
        self._rules(self.cabinet, active=False).unlink()
        self.assertEqual(self.env["eguitra.approval.rule"]._eguitra_po_document(self.cabinet), "commitment",
                         "Sans règle propre, le circuit des engagements s'applique, comme avant")

    def test_circuit_selon_le_seuil(self):
        rules = self._rules(self.groupe)
        control = rules.filtered(lambda r: r.sequence == 1)
        small = rules.filtered(lambda r: r.sequence == 2 and r.max_amount)
        large = rules.filtered(lambda r: r.sequence == 2 and r.min_amount)
        preview = self.make_po(lines=[self.po_line("Petit achat (test)", 1, 5_000_000)])._eguitra_circuit_preview()
        self.assertEqual(preview["steps"], 2)
        self.assertEqual({r["id"]: r["applies"] for r in preview["rules"]},
                         {control.id: True, small.id: True, large.id: False})
        po, request = self._submitted(10_000_000)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"])
        self.assertTrue(request.step_ids[0].label.startswith("Contrôle"))
        self.assertEqual(request.step_ids[1].rule_id, small, "Exactement 10 M : règle « jusqu'à 10 M » (plafond inclus)")
        po, request = self._submitted(10_000_001)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"],
                         "Deux règles de même niveau, plages disjointes : une seule étape de direction")
        self.assertEqual(request.step_ids[1].rule_id, large, "10 000 001 : règle « plus de 10 M »")
        po, request = self._submitted(150_000)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"],
                         "En attendant la décision de la direction générale, elle approuve aussi les petits bons")
        small.approver_profile = "admin"
        po, request = self._submitted(150_000)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "admin"],
                         "Niveau des petits bons changé dans Circuits, sans développement")
        po, request = self._submitted(12_000_000)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"], "Les grands bons ne changent pas")

    def test_chef_comptable_ou_daf_controle(self):
        for controller in (self.comptable, self.daf):
            po, request = self._submitted(10_000_000)
            request.with_user(controller).action_approve("Conforme, budget disponible")
            self.assertEqual(request.step_ids[0].decided_by, controller)
            other = self.daf if controller == self.comptable else self.comptable
            with self.assertRaises(AccessError, msg="Une seule étape de contrôle : l'autre n'approuve pas en plus"):
                request.with_user(other).action_approve()
            request.with_user(self.dg).action_approve()
            self.assertEqual(po.eguitra_status, "approved")
            self.assertEqual(len(request.step_ids), 2)

    def test_separation_des_responsabilites(self):
        po, request = self._submitted(10_000_001)
        with self.assertRaises(AccessError, msg="Celui qui émet et soumet le bon ne tranche rien"):
            request.with_user(self.acheteur).action_approve()
        with self.assertRaises(AccessError, msg="La direction ne fait pas le contrôle"):
            request.with_user(self.dg).action_approve()
        request.with_user(self.comptable).action_approve("Devis et budget vérifiés")
        self.assertEqual(po.state, "to approve", "Reste l'approbation de la direction générale")
        with self.assertRaises(AccessError, msg="Le contrôleur n'approuve pas"):
            request.with_user(self.comptable).action_approve()
        with self.assertRaises(AccessError, msg="Le DAF non plus : l'approbation revient à la direction"):
            request.with_user(self.daf).action_approve()
        with self.assertRaises(AccessError, msg="Ni l'émetteur"):
            request.with_user(self.acheteur).action_approve()
        request.with_user(self.dg).action_approve()
        self.assertEqual(po.eguitra_status, "approved")
        self.assertEqual(len(request.step_ids.decided_by), 2, "Deux personnes différentes")
        # Société sans réserve de l'émission (comme MB AxisPro Consulting) : le comptable qui saisit un bon ne le
        # contrôle pas, le contrôle revient à une autre personne.
        self.groupe.eguitra_po_issue_reserved = False
        own = self.make_po(user=self.comptable, lines=[self.po_line("Ramettes (test)", 10, 50_000)])
        own.with_user(self.acheteur).sudo().action_eguitra_submit()
        with self.assertRaises(AccessError):
            self.request_of(own).with_user(self.comptable).action_approve()
        self.request_of(own).with_user(self.daf).action_approve()
        # La direction qui émet un bon ne l'approuve pas : une autre personne de la direction le fera.
        dg_po = self.make_po(user=self.dg, lines=[self.po_line("Mobilier de direction (test)", 1, 2_000_000)])
        dg_po.with_user(self.dg).sudo().action_eguitra_submit()
        dg_request = self.request_of(dg_po)
        dg_request.with_user(self.daf).action_approve()
        with self.assertRaises(AccessError):
            dg_request.with_user(self.dg).action_approve()

    def test_migration_ancien_defaut_remplace_circuit_modifie_laisse(self):
        self._set_rules(self.groupe, PURCHASE_ORDER_RULES_V1)
        modified = [dict(values) for values in PURCHASE_ORDER_RULES_V1]
        modified[2]["min_amount"] = 20_000_000
        self._set_rules(self.cabinet, modified)
        # Demande ouverte sous l'ancien circuit : trois étapes, contrôle déjà donné.
        po, request = self._submitted(12_000_000)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "finance", "direction"])
        request.with_user(self.comptable).action_approve()

        replaced, kept = upgrade_purchase_order_rules(self.env)
        self.assertIn(self.groupe, replaced)
        self.assertIn(self.cabinet, kept)
        self.assertEqual(sorted((r.sequence, r.approver_profile, r.min_amount, r.max_amount)
                                for r in self._rules(self.groupe)),
                         [(1, "finance", 0, 0), (2, "direction", 0, 10_000_000), (2, "direction", 10_000_000, 0)])
        archived = self._rules(self.groupe, active=False).filtered(lambda r: not r.active)
        self.assertEqual(len(archived), 3, "Anciennes règles archivées, jamais supprimées")
        self.assertTrue(all(r.name.startswith(REPLACED_PREFIX) for r in archived))
        self.assertEqual(sorted(self._rules(self.cabinet).mapped("min_amount")), [0, 0, 20_000_000],
                         "Circuit modifié par l'administration : laissé tel quel")
        replaced, kept = upgrade_purchase_order_rules(self.env)
        self.assertNotIn(self.groupe, replaced, "Relancée, la migration ne refait rien")
        self.assertNotIn(self.groupe, kept)

        # La demande ouverte garde ses trois étapes et s'achève comme prévu.
        self.assertEqual(len(request.step_ids), 3)
        request.with_user(self.daf).action_approve()
        request.with_user(self.dg).action_approve()
        self.assertEqual(po.eguitra_status, "approved")
        # Un bon soumis ensuite suit le nouveau circuit.
        po, request = self._submitted(12_000_000)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"])

    # ─── Bon imprimé : circuit, preuve, signature ─────────────────────────

    def test_bon_imprime_avec_circuit_dates_empreinte_et_signature(self):
        self.dg.partner_id.function = "Directeur général (test)"
        self.comptable._eguitra_set_signature(png(), self.comptable)
        po, request = self._submitted(12_000_000)
        self._approve_all(request)
        circuit = po._eguitra_report_values()["circuit"]
        self.assertIn(self.acheteur.name, circuit["established"])
        self.assertIn("soumis par", circuit["established"])
        self.assertEqual(len(circuit["rows"]), 2)
        by_name = {row["name"]: row for row in circuit["rows"]}
        self.assertEqual(set(by_name), {self.comptable.name, self.dg.name})
        self.assertTrue(by_name[self.comptable.name]["step"].startswith("Contrôle"))
        self.assertTrue(by_name[self.dg.name]["step"].startswith("Approbation"))
        for row in circuit["rows"]:
            self.assertTrue(row["decision"].startswith("Approuvé"))
            self.assertRegex(row["date"], r"^\d{2}/\d{2}/\d{4} à \d{2}:\d{2}$", "Date et heure de Conakry")
        self.assertEqual(by_name[self.dg.name]["function"], "Directeur général (test)")
        self.assertEqual(by_name[self.comptable.name]["function"], "Finance et comptabilité", "À défaut, le profil")
        self.assertTrue(by_name[self.comptable.name]["signature"].startswith("data:image/png;base64,"))
        self.assertIsNone(by_name[self.dg.name]["signature"], "Pas de signature déposée : rien d'imprimé")
        self.assertIn(f"n° {request.id}", circuit["proof"])
        self.assertIn(request.fingerprint[:16], circuit["proof"])
        self.assertIsNone(circuit["warning"])
        text = self.html_of("eguitra_commerce.action_report_purchase_order", po)
        for expected in ("CIRCUIT D'APPROBATION", "Date et heure (Conakry)", "Directeur général (test)",
                         request.fingerprint[:16], "Signature électronique simple", "Établi par"):
            self.assertIn(expected, text)

    def test_signature_controlee(self):
        with self.assertRaises(UserError, msg="Un PDF n'est pas une image de signature"):
            self.daf._eguitra_set_signature(PDF, self.daf)
        with self.assertRaises(UserError, msg="Trop lourde"):
            self.daf._eguitra_set_signature(b"\x89PNG\r\n\x1a\n" + b"0" * (600 * 1024), self.daf)
        self.daf._eguitra_set_signature(png(1200, 400), self.admin)
        self.assertEqual((self.daf.eguitra_signature_mimetype, self.daf.eguitra_signature_by),
                         ("image/png", self.admin))
        image = Image.open(io.BytesIO(base64.b64decode(self.daf.eguitra_signature)))
        self.assertLessEqual(image.size[0], 600, "Ramenée à 600 points de large au plus")
        self.daf._eguitra_clear_signature()
        self.assertFalse(self.daf.eguitra_signature)

    # ─── TVA ──────────────────────────────────────────────────────────────

    def test_tva_avec_sans_et_mixte(self):
        currency = self.groupe.currency_id

        def fmt(value):
            return money(value, currency.name, currency.decimal_places)

        with_tax = self.make_po(lines=[self.po_line("Ciment (test)", 1, 1_000_000)])
        self.assertAlmostEqual(with_tax.amount_tax, 180_000)
        values = with_tax._eguitra_report_values()
        labels = [row["label"] for row in values["totals"]]
        self.assertEqual((labels[0], labels[-1]), ("Montant HT", "TOTAL TTC"))
        self.assertTrue(any("18" in label for label in labels[1:-1]), f"TVA par taux : {labels}")
        self.assertEqual(values["totals"][-1]["amount"], fmt(1_180_000))
        self.assertIn("toutes taxes comprises", values["words_intro"])
        self.assertEqual(values["words"], capitalize(amount_in_words(1_180_000, currency)))

        without = self.make_po(lines=[self.po_line("Prestation exonérée (test)", 2, 750_000, taxes=self.env["account.tax"])],
                               eguitra_tax_exemption="Exonération de TVA (mention de test)")
        self.assertEqual(without.amount_tax, 0)
        values = without._eguitra_report_values()
        self.assertEqual([row["label"] for row in values["totals"]], ["Montant hors taxes", "TOTAL (sans TVA)"])
        self.assertEqual(values["totals"][-1]["amount"], fmt(1_500_000))
        self.assertIn("sans TVA", values["words_intro"])
        self.assertEqual(values["words"], capitalize(amount_in_words(1_500_000, currency)))
        text = self.html_of("eguitra_commerce.action_report_purchase_order", without)
        self.assertIn("TOTAL (sans TVA)", text)
        self.assertNotIn("TOTAL TTC", text)
        self.assertIn("Exonération de TVA (mention de test)", text)

        mixed = self.make_po(lines=[self.po_line("Matériel taxé (test)", 1, 1_000_000),
                                    self.po_line("Débours non taxés (test)", 1, 500_000, taxes=self.env["account.tax"])])
        self.assertAlmostEqual((mixed.amount_untaxed, mixed.amount_tax, mixed.amount_total), (1_500_000, 180_000, 1_680_000))
        rows = {row["label"]: row["amount"] for row in mixed._eguitra_report_values()["totals"]}
        self.assertEqual(rows["dont hors TVA (exonéré ou non soumis)"], fmt(500_000))
        self.assertEqual(rows["TOTAL TTC"], fmt(1_680_000))

    def test_arrondis_en_francs_guineens(self):
        po = self.make_po(lines=[self.po_line("Pièces détachées (test)", 3, 333_333)])
        currency = po.currency_id
        self.assertAlmostEqual(po.amount_untaxed, 999_999)
        self.assertAlmostEqual(po.amount_tax, currency.round(999_999 * 0.18))
        self.assertAlmostEqual(po.amount_total, po.amount_untaxed + po.amount_tax)
        self.assertEqual(po._eguitra_report_values()["totals"][-1]["amount"],
                         money(po.amount_total, currency.name, currency.decimal_places))

    # ─── Historique ───────────────────────────────────────────────────────

    def test_historique_du_bon(self):
        po = self.make_po(user=self.acheteur, lines=[self.po_line("Câbles (test)", 10, 200_000)])
        po.with_user(self.acheteur).sudo().write({"partner_ref": "DEV-HIST-01", "order_line": [
            Command.clear(), Command.create({"product_id": self.generic_purchase.id, "name": "Câbles (test)",
                                             "product_qty": 12, "price_unit": 200_000, "date_planned": self.planned,
                                             "eguitra_account_id": self.acc_purchase.id,
                                             "product_uom_id": self.generic_purchase.uom_id.id,
                                             "tax_ids": [Command.set(self.tax_purchase.ids)]})]})
        po.action_eguitra_submit()
        self.request_of(po).with_user(self.comptable).action_reject("Joindre le devis")
        po.action_eguitra_submit()
        self._approve_all(self.request_of(po))
        po.action_eguitra_mark_sent()
        po.eguitra_receive({po.order_line: 12}, note="Livraison complète (test)")
        po.eguitra_create_bill(ref="FAC-HIST-01")
        history = po._eguitra_history()
        kinds = [event["kind"] for event in history]
        for kind in ("created", "modified", "submitted", "rejected", "approved", "sent", "received", "billed"):
            self.assertIn(kind, kinds)
        self.assertEqual(kinds[0], "created")
        self.assertEqual(kinds.count("submitted"), 2)
        modified = next(e for e in history if e["kind"] == "modified")
        self.assertIn("Référence du devis ou de la proforma : – → DEV-HIST-01", modified["detail"])
        self.assertIn("Lignes :", modified["detail"])
        rejected = next(e for e in history if e["kind"] == "rejected")
        self.assertEqual((rejected["user"], rejected["detail"]), (self.comptable.name, "Joindre le devis"))
        self.assertTrue(all(e["date_label"] for e in history))
        event = po.eguitra_event_ids[:1]
        with self.assertRaises(UserError, msg="L'historique ne se modifie pas"):
            event.write({"summary": "Effacé"})
        with self.assertRaises(UserError, msg="Ni ne se supprime"):
            event.unlink()

    def test_annulation_a_l_historique(self):
        po = self.make_po(user=self.acheteur)
        po.action_eguitra_cancel(reason="Besoin abandonné (test)")
        cancelled = po.eguitra_event_ids.filtered(lambda e: e.kind == "cancelled")
        self.assertEqual((cancelled.detail, po.eguitra_status), ("Besoin abandonné (test)", "cancelled"))

    # ─── Pièces jointes, devis retenu, conditions ─────────────────────────

    def _attach(self, po, category="quote", name="devis.pdf"):
        attachment = self.env["ir.attachment"].sudo().create({
            "name": name, "datas": base64.b64encode(PDF), "mimetype": "application/pdf",
            "res_model": po._name, "res_id": po.id})
        return self.env["eguitra.commerce.purchase.document"].sudo().create({
            "order_id": po.id, "category": category, "name": name, "attachment_id": attachment.id})

    def test_pieces_jointes_archivees_une_fois_soumis(self):
        po = self.make_po(user=self.acheteur)
        wrong = self._attach(po, "other", "mauvaise-piece.pdf")
        wrong.unlink()
        self.assertIn("document_removed", po.eguitra_event_ids.mapped("kind"), "Retrait écrit à l'historique")
        quote = self._attach(po)
        po.action_eguitra_submit()
        with self.assertRaises(UserError, msg="Bon soumis : pièces archivées"):
            quote.unlink()
        with self.assertRaises(UserError):
            quote.write({"category": "contract"})
        self._approve_all(self.request_of(po))
        contract = self._attach(po, "contract", "contrat.pdf")
        self.assertEqual(po.eguitra_document_ids, quote | contract, "Une pièce s'ajoute encore, rien ne se perd")
        with self.assertRaises(UserError):
            contract.unlink()

    def test_devis_retenu_repris_de_l_engagement(self):
        commitment = self.env["eguitra.commitment"].with_user(self.chef_chantier).create({
            "partner_id": self.supplier.id, "object": "Gasoil du chantier (test)", "amount": 8_000_000,
            "account_id": self.acc_purchase.id, "company_id": self.groupe.id,
        })
        quote = self.env["eguitra.commerce.supplier.quote"].with_user(self.chef_chantier).create({
            "commitment_id": commitment.id, "partner_id": self.supplier.id, "amount": 8_000_000,
            "reference": "DEV-ENG-42", "date": fields.Date.today(),
        })
        quote.attachment_id = self.env["ir.attachment"].sudo().create({
            "name": "devis-eng-42.pdf", "datas": base64.b64encode(PDF), "mimetype": "application/pdf",
            "res_model": quote._name, "res_id": quote.id})
        quote.action_select("Seul fournisseur disponible (test)")
        commitment.action_submit()
        self._approve_all(self.request_of(commitment), users=(self.comptable, self.daf, self.dg))
        self.assertEqual(commitment.state, "approved")
        po = self.make_po(user=self.acheteur, eguitra_commitment_id=commitment.id,
                          lines=[self.po_line("Gasoil (litres)", 640, 12_500)])
        self.assertEqual((po.partner_ref, po.eguitra_quote_date, po.eguitra_quote_kind),
                         ("DEV-ENG-42", quote.date, "quote"))
        document = po.eguitra_document_ids
        self.assertEqual((len(document), document.category), (1, "quote"))
        self.assertIn(commitment.name, document.origin)
        self.assertEqual(base64.b64decode(document.attachment_id.datas), PDF)
        self.assertNotEqual(document.attachment_id, quote.attachment_id, "Copie propre au bon (archive)")
        text = self.html_of("eguitra_commerce.action_report_purchase_order", po)
        self.assertIn(f"Devis du fournisseur : DEV-ENG-42 du {quote.date:%d/%m/%Y}", text)

    def test_conditions_structurees_imprimees(self):
        term = self.env["account.payment.term"].create({"name": "45 jours (test)", "line_ids": [
            Command.create({"value": "percent", "value_amount": 100, "nb_days": 45, "delay_type": "days_after"})]})
        po = self.make_po(payment_term_id=term.id, eguitra_payment_note="Par virement (test)",
                          eguitra_delivery_days=15, eguitra_quote_kind="proforma", partner_ref="PRO-77",
                          eguitra_conditions="Garantie d'un an (test).")
        self.assertEqual(po.eguitra_delivery_place, company_address(self.groupe), "Par défaut, l'adresse de la société")
        rows = dict(po._eguitra_terms_rows())
        self.assertEqual(rows["Conditions de paiement"], "45 jours (test) – Par virement (test)")
        self.assertIn("15 jours", rows["Délai de livraison"])
        self.assertIn(f"{po.date_planned:%d/%m/%Y}", rows["Délai de livraison"])
        self.assertEqual(rows["Lieu de livraison"], company_address(self.groupe))
        text = self.html_of("eguitra_commerce.action_report_purchase_order", po)
        for expected in ("Conditions de paiement : 45 jours (test) – Par virement (test)", "Lieu de livraison :",
                         "Facture proforma : PRO-77", "Autres conditions :", "Garantie d'un an (test)."):
            self.assertIn(expected, text)
        before = po._eguitra_fingerprint()
        po.eguitra_delivery_place = "Chantier de démonstration (test)"
        self.assertNotEqual(po._eguitra_fingerprint(), before, "Le lieu de livraison fait partie de ce qui est approuvé")
        self.assertIn("Lieu de livraison", po.eguitra_event_ids.filtered(lambda e: e.kind == "modified")[-1:].detail)
