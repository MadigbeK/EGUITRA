import io
from datetime import datetime, time, timedelta

from odoo import fields
from odoo.tests import tagged

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestCorrectionsLot3(HsseqCase):
    """Manques relevés par les écrans du lot 3 (contrat, §16) et restes du lot 2 : un test par défaut corrigé."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _import(self, content, name="violations.csv", **form):
        token = self.token("kadi.hsseq")
        self.env.flush_all()
        response = self.url_open("/api/v1/hsseq/telematics/import", data={k: str(v) for k, v in form.items()},
                                 files={"file": (name, io.BytesIO(content), "text/csv")},
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}, method="POST",
                                 timeout=60)
        self.env.invalidate_all()
        return response.status_code, response.json()

    def test_telematique_heure_apercu_voyages_et_import_refuse(self):
        """Colonnes Date et Heure combinées ; aperçu à blanc au format des violations ; filtre driver_id ;
        nombre de voyages de la liste ; un import refusé laisse sa trace."""
        yesterday = self.day - timedelta(days=1)
        content = "\n".join(["Date;Heure;Véhicule;Chauffeur;Type;Identifiant",
                             f"{yesterday:%d/%m/%Y};08:30;ER-01;Chauffeur inconnu;Excès de vitesse;H-1",
                             f"{yesterday:%d/%m/%Y};14h05;ER-01;Mamadou Diallo;Freinage brusque;H-2"]).encode()
        status, preview = self._import(content, source="GPS", dry_run=1)
        self.assertEqual(status, 200, preview)
        first = preview["preview"][0]
        self.assertEqual((first["vehicle"]["id"], first["occurred_at"][:16], first["import"]),
                         (self.truck.id, f"{yesterday:%Y-%m-%d}T08:30", None), "Format violation_row, heure gardée")
        self.assertIn("« Chauffeur inconnu »", preview["warnings"][0]["message"], "Le nom lu est cité")
        status, batch = self._import(content, source="GPS")
        self.assertEqual((status, batch["state"], batch["created"]), (200, "done", 2), batch)
        Violation = self.env["eguitra.hsseq.telematics.violation"]
        self.assertEqual(Violation.search([("external_id", "=", "H-2")]).occurred_at,
                         datetime.combine(yesterday, time(14, 5)))
        other = self.env["eguitra.transport.driver"].create({"name": "Lamine Barry"})
        Violation.create({"company_id": self.company.id, "occurred_at": fields.Datetime.now(),
                          "vehicle_id": self.truck.id, "driver_id": other.id, "violation_type": "night_driving",
                          "source": "GPS"})
        status, listing = self.api("kadi.hsseq", "GET", f"/hsseq/telematics/violations?driver_id={other.id}")
        self.assertEqual([v["violation_type"] for v in listing["items"]], ["night_driving"], "Filtre driver_id")
        self._rotation().write({"state": "done"})
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/telematics/violations")
        counts = listing["counts"]
        self.assertEqual(counts["departures"], 1, "Voyages de la période (le mois en cours par défaut)")
        self.assertEqual(counts["per_100_trips"], round(counts["violations_in_period"] * 100, 2))
        status, body = self._import("Date;Véhicule;Type\n01/01/2026 08:00;ZZ-99;Excès de vitesse".encode(), source="GPS")
        self.assertEqual((status, body["error"]), (422, "import_rejected"), body)
        status, imports = self.api("kadi.hsseq", "GET", "/hsseq/telematics/imports?state=rejected")
        [rejected] = imports["items"]
        self.assertEqual((rejected["id"], rejected["error_count"], rejected["errors"][0]["line"], rejected["created"]),
                         (body["import_id"], 1, 2, 0), "Trace de l'import refusé")

    def test_revue_intitule_auditeur_actions_et_compte_rendu(self):
        """Intitulé d'une période d'un mois ou de plusieurs (élision) ; message d'une période inversée ;
        l'auditeur lit les noms du personnel interne, jamais celui d'un conducteur ni un indicateur
        d'alcootest ; il lit les actions de la revue ; le compte rendu d'une revue préparée montre ses
        éléments d'entrée."""
        from datetime import date

        from ..controllers.reviews import pdf_context
        from ..models.cockpit import period_label

        self.assertEqual((period_label(date(2026, 10, 1), date(2026, 10, 31)),
                          period_label(date(2026, 10, 1), date(2026, 12, 31)),
                          period_label(date(2026, 3, 1), date(2026, 5, 31))),
                         ("octobre 2026", "d'octobre 2026 à décembre 2026", "de mars 2026 à mai 2026"))
        status, body = self.api("dg.hsseq", "POST", "/hsseq/reviews", {
            "period_start": str(self.day), "period_end": str(self.day - timedelta(days=40)), "planned_date": str(self.day)})
        self.assertEqual((status, body["message"]), (400, "La fin de la période précède son début."))
        event = self.event(event_type="road_accident", title="Sortie de route de démonstration")
        event.action_classify({"potential_severity": 5, "probability": 4})
        status, review = self.api("dg.hsseq", "POST", "/hsseq/reviews", {
            "period_start": str(self.day.replace(day=1)), "period_end": str(self.day), "planned_date": str(self.day),
            "participant_ids": [self.dg.id, self.conducteur.id]})
        self.assertEqual(status, 200, review)
        self.assertEqual(review["title"], f"Revue de direction HSSEQ, {period_label(self.day, self.day)}")
        status, decided = self.api("dg.hsseq", "POST", f"/hsseq/reviews/{review['id']}/decisions", {
            "description": "Recycler la conduite défensive",
            "action": {"owner_id": self.hsseq.id, "due_date": str(self.day + timedelta(days=30))}})
        action_id = decided["decisions"][0]["action"]["id"]
        status, read = self.api("awa.auditrice", "GET", f"/hsseq/reviews/{review['id']}")
        self.assertEqual(status, 200, read)
        names = {p["id"]: p["name"] for p in read["participants"]}
        self.assertEqual((names[self.dg.id], names[self.conducteur.id]), (self.dg.name, None),
                         "Personnel interne nommé, conducteur jamais")
        self.assertEqual(read["decisions"][0]["owner"], {"id": self.hsseq.id, "name": self.hsseq.name})
        self.assertFalse([i for i in read["inputs"]["indicators"] if i["code"].startswith("breath_test")],
                         "Aucun indicateur d'alcootest")
        status, action = self.api("awa.auditrice", "GET", f"/hsseq/actions/{action_id}")
        self.assertEqual((status, action["origin"]), (200, "review"), "Action de revue lisible (plus de 404)")
        status, listing = self.api("awa.auditrice", "GET", "/hsseq/actions?origin=review")
        self.assertEqual([a["id"] for a in listing["items"]], [action_id])
        record = self.env["eguitra.hsseq.review"].browse(review["id"])
        context = pdf_context(record, record._compute_inputs(), user=self.dg)
        html, _type = self.env["ir.actions.report"]._render_qweb_html("eguitra_hsseq.action_report_review",
                                                                      record.ids, data={"report": context})
        html = html.decode()
        for text in ("Indicateurs de la période", "Taux de fréquence", "Sortie de route de démonstration",
                     "(revue préparée)"):
            self.assertIn(text, html, "Compte rendu d'une revue préparée : ses éléments d'entrée")

    def test_documents_doublons_participants_tri_conducteurs_et_exports(self):
        """Référence de procédure ou numéro de version en double : 409 ; participants exigés à la réalisation
        d'un exercice ; tri des procédures ; conducteurs parmi les comptes servis ; filtres propres à chaque
        feuille des exports."""
        import zipfile

        base = {"title": "Dépotage", "version": "1", "effective_date": str(self.day)}
        status, first = self.api("kadi.hsseq", "POST", "/hsseq/procedures", dict(base, code="PR-B"))
        self.assertEqual(status, 200, first)
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/procedures", dict(base, code="PR-B"))
        self.assertEqual((status, body["error"], body["fields"]), (409, "conflict", ["code"]))
        status, second = self.api("kadi.hsseq", "POST", "/hsseq/procedures", dict(base, code="PR-A"))
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/procedures/{second['id']}", {"code": "PR-B"})
        self.assertEqual((status, body["error"]), (409, "conflict"))
        status, body = self.api("kadi.hsseq", "PATCH",
                                f"/hsseq/procedures/{first['id']}/versions/{first['draft_version']['id']}", {"version": "1"})
        self.assertEqual(status, 200, "Même numéro sur la même version : accepté")
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/procedures?sort=-code")
        self.assertEqual([p["code"] for p in listing["items"]], ["PR-B", "PR-A"], "Tri respecté")
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/procedures?status=published")
        self.assertEqual((listing["items"], listing["counts"]["by_status"]["draft"]), ([], 2),
                         "Compteurs aux autres filtres que l'état")
        status, plan = self.api("kadi.hsseq", "POST", "/hsseq/emergency-plans", {
            "site_id": self.site.id, "scenario": "fire", "title": "Incendie au parc", "response": "Évacuer"})
        status, drill = self.api("kadi.hsseq", "POST", f"/hsseq/emergency-plans/{plan['id']}/drills",
                                 {"planned_date": str(self.day)})
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/drills/{drill['id']}/perform", {"debrief": "Bilan"})
        self.assertEqual((status, body["error"]), (422, "participants_required"))
        status, refs = self.api("kadi.hsseq", "GET", "/hsseq/referentials")
        owners = {o["id"]: o for o in refs["owners"]}
        self.assertEqual(owners[self.conducteur.id], {"id": self.conducteur.id, "name": self.conducteur.name,
                                                      "driver": True}, "Conducteur, par son nom seulement")
        status, refs = self.api("awa.auditrice", "GET", "/hsseq/referentials")
        self.assertNotIn(self.conducteur.id, [o["id"] for o in refs["owners"]], "Jamais pour l'auditeur")
        # Exports : filtres propres à chaque feuille.
        Spill = self.env["eguitra.hsseq.spill"]
        for location, status_ in (("Quai ouvert", "open"), ("Quai clos", "closed")):
            Spill.create({"company_id": self.company.id, "site_id": self.site.id, "occurred_at": fields.Datetime.now(),
                          "volume_liters": 10, "location": location, "status": status_})
        self.env["eguitra.hsseq.waste"].create({"company_id": self.company.id, "site_id": self.site.id,
                                                "waste_kind": "other", "description": "Fûts du magasin", "quantity": 2})
        token = self.token("kadi.hsseq")
        self.env.flush_all()

        def export(path):
            response = self.url_open(f"/api/v1{path}", headers={"Authorization": f"Bearer {token}",
                                                                 "X-Eguitra-App": "test"}, timeout=60)
            self.assertEqual(response.status_code, 200)
            return zipfile.ZipFile(io.BytesIO(response.content)).read("xl/sharedStrings.xml").decode()

        content = export("/hsseq/environment/export.xlsx?spills_status=closed&status=collected")
        self.assertIn("Quai clos", content)
        self.assertNotIn("Quai ouvert", content, "Filtre de la feuille des déversements")
        self.assertIn("Fûts du magasin", content, "Le filtre non préfixé ne borne plus les déchets")
        self.env["eguitra.hsseq.drill"].browse(drill["id"]).write({"participants_count": 4})
        self.api("kadi.hsseq", "POST", f"/hsseq/drills/{drill['id']}/perform", {"debrief": "Évacuation réussie"})
        self.api("kadi.hsseq", "POST", f"/hsseq/emergency-plans/{plan['id']}/drills",
                 {"planned_date": str(self.day + timedelta(days=30))})
        content = export("/hsseq/documents/export.xlsx?drills_status=done")
        self.assertIn("Évacuation réussie", content)
        self.assertIn("Incendie au parc", content, "Plans sans le filtre des exercices")

    def test_actions_de_revue_bornees_pour_l_auditeur(self):
        """L'auditeur ne lit une action de revue que pour une société de son compte et tant que son accès
        court ; le nom d'un responsable conducteur ne lui est jamais servi."""
        other = self.env["res.company"].create({"name": "MB AxisPro Consulting (test)"})
        Review = self.env["eguitra.hsseq.review"]

        def review_action(company, owner):
            review = Review.create({"company_id": company.id, "title": "Revue (test)", "period_start": self.day,
                                    "period_end": self.day, "planned_date": self.day})
            decision = self.env["eguitra.hsseq.review.decision"].create({"review_id": review.id,
                                                                         "description": "Décision (test)"})
            return decision._create_action({"owner_id": owner.id, "due_date": self.day + timedelta(days=30)})

        mine = review_action(self.company, self.conducteur)
        theirs = review_action(other, self.hsseq)
        status, action = self.api("awa.auditrice", "GET", f"/hsseq/actions/{mine.id}")
        self.assertEqual((status, action["owner"]), (200, {"id": self.conducteur.id, "name": None}),
                         "Responsable conducteur sans nom")
        status, _b = self.api("awa.auditrice", "GET", f"/hsseq/actions/{theirs.id}")
        self.assertEqual(status, 404, "Action de revue d'une autre société")
        status, listing = self.api("awa.auditrice", "GET", "/hsseq/actions?origin=review")
        self.assertEqual([a["id"] for a in listing["items"]], [mine.id])
        self.auditor.hsseq_audit_until = self.day - timedelta(days=1)
        status, _b = self.api("awa.auditrice", "GET", f"/hsseq/actions/{mine.id}")
        self.assertEqual(status, 403, "Après la date de fin d'accès")
