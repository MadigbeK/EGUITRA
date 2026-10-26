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
