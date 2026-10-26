import json
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.eguitra_transport.blocking import RotationBlocked

from ..models.common import HsseqError
from .common import HsseqCase

BRAKES = "Freins et ralentisseur, essai statique"
LIGHTS = "Éclairage et feux de détresse"
VEST = "Gilet haute visibilité porté"


@tagged("post_install", "-at_install")
class TestLock(HsseqCase):
    """Contrôles avant départ, verrou V01 à V05, dérogations, rattachement des saisies sans rotation et
    crochets de Transport (départ en route, validation)."""

    def test_grilles_initiales(self):
        for template, kind in ((self.tanker_template, "tanker"), (self.tipper_template, "tipper")):
            items = template._items()
            self.assertEqual(template.vehicle_kind, kind)
            self.assertEqual(len(items.filtered("blocking")), 8, "Huit points critiques par type (§5)")
            self.assertEqual(len(items.filtered(lambda i: not i.blocking)), 5, "Cinq points communs non bloquants")
            self.assertEqual(items.filtered("linked_to").label, "Alcootest du conducteur négatif")
        status, templates = self.driver_api("GET", "/hsseq/checks/templates?vehicle_kind=tanker")
        self.assertEqual(status, 200, templates)
        [grid] = [t for t in templates if t["id"] == self.tanker_template.id]
        version = grid["version"]
        self.assertTrue(grid["updated_at"])
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/checks/templates/{grid['id']}", {
            "items": [dict(i, label=i["label"] + " ") if i["label"] == LIGHTS else i for i in grid["items"]]
            + [{"label": "Gilet haute visibilité porté", "blocking": False, "sequence": 200}]})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["version"], version + 1, "Une modification, une version")

    def _new_version(self, blocking=True):
        """Nouvelle version de la grille citerne, en vigueur dès maintenant : un point ajouté (bloquant par
        défaut), l'éclairage retiré ; la version d'avant était en vigueur depuis deux jours. Rend la version
        d'avant, ses réponses conformes et le point ajouté."""
        template = self.tanker_template
        template.version_ids.write({"effective_from": fields.Datetime.now() - timedelta(days=2)})
        old_version, old_answers = template.version, self.answers(template)
        status, grids = self.api("kadi.hsseq", "GET", "/hsseq/checks/templates?vehicle_kind=tanker")
        grid = next(g for g in grids if g["id"] == template.id)
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/checks/templates/{template.id}", {
            "items": [i for i in grid["items"] if i["label"] != LIGHTS]
            + [{"label": VEST, "blocking": blocking, "sequence": 200}]})
        self.assertEqual((status, body["version"]), (200, old_version + 1), body)
        return old_version, old_answers, template._items().filtered(lambda i: i.label == VEST)

    @staticmethod
    def _before():
        """Heure de saisie d'un contrôle fait hors ligne avant la modification de la grille."""
        return fields.Datetime.to_string(fields.Datetime.now() - timedelta(hours=1))

    def test_controle_hors_ligne_sur_une_version_plus_ancienne(self):
        """Saisi avant la modification de la grille : seuls les points de sa version sont exigés ; un point
        ajouté depuis est « non évalué », un point retiré depuis reste accepté."""
        template = self.tanker_template
        old_version, old_answers, added = self._new_version()
        lights = template._items(active_only=False).filtered(lambda i: i.label == LIGHTS)
        self.assertEqual((lights.active, lights.retired_version), (False, old_version + 1), "Retiré : archivé")
        rot = self._rotation()
        payload = {"client_uuid": "ctl-v-old", "template_id": template.id, "template_version": old_version,
                   "reported_at": self._before(), "rotation_id": rot.id, "offline": True, "answers": old_answers}
        status, check = self.api("ibrahima", "POST", "/hsseq/checks", payload)
        self.assertEqual(status, 200, check)
        answers = {a["item_id"]: a["answer"] for a in check["answers"]}
        self.assertEqual(answers[added.id], "not_evaluated", "Point ajouté après la saisie : non évalué, sans erreur")
        self.assertEqual(answers[lights.id], "ok", "Point retiré depuis : sa réponse est gardée")
        self.assertEqual((check["result"], check["template"]["version"]), ("incomplete", old_version),
                         "Point bloquant non évalué : jamais conforme")
        self.assertEqual([i["item_id"] for i in check["awaiting_items"]], [added.id])
        self.assertIn("complement", check["transitions"])
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", dict(
            payload, client_uuid="ctl-v-cur", template_version=old_version + 1, reported_at=None))
        self.assertEqual((status, body["error"], body["fields"]), (422, "incomplete_answers", [added.id]),
                         "Version courante : le nouveau point est exigé")
        brakes = template._items().filtered(lambda i: i.label == BRAKES)
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", dict(
            payload, client_uuid="ctl-v-gap", answers=[a for a in old_answers if a["item_id"] != brakes.id]))
        self.assertEqual((status, body["error"], body["fields"]), (422, "incomplete_answers", [brakes.id]),
                         "Un point de sa propre version manque")

    def test_version_en_vigueur_a_l_heure_de_saisie(self):
        """La version citée est celle qui était en vigueur à l'heure de saisie, sinon 422 ; sans version
        citée, la version courante. Une ancienne version ne sert plus à esquiver un point ajouté depuis."""
        template = self.tanker_template
        old_version, old_answers, added = self._new_version()
        self.assertEqual([(v.version, v.effective_from <= fields.Datetime.now()) for v in template.version_ids],
                         [(old_version, True), (old_version + 1, True)], "Historique des versions et de leur entrée en vigueur")
        rot = self._rotation()
        base = {"template_id": template.id, "rotation_id": rot.id}
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", dict(
            base, client_uuid="ver-1", template_version=old_version, answers=old_answers))
        self.assertEqual((status, body["error"], body["fields"]), (422, "invalid_parameter", ["template_version"]),
                         "Ancienne version pour une saisie faite après la modification : refusée")
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", dict(
            base, client_uuid="ver-2", template_version=old_version + 1, reported_at=self._before(),
            answers=self.answers(template)))
        self.assertEqual((status, body["error"]), (422, "invalid_parameter"),
                         "Version pas encore en vigueur à l'heure de saisie : refusée")
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", dict(
            base, client_uuid="ver-3", template_version=old_version, answers=old_answers,
            reported_at=fields.Datetime.to_string(fields.Datetime.now() - timedelta(days=5))))
        self.assertEqual((status, body["error"]), (422, "invalid_parameter"), "Aucune version en vigueur à cette heure")
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", dict(base, client_uuid="ver-4", answers=old_answers))
        self.assertEqual((status, body["error"], body["fields"]), (422, "incomplete_answers", [added.id]),
                         "Sans version citée : la version courante, le point ajouté est exigé")
        status, check = self.api("ibrahima", "POST", "/hsseq/checks", dict(
            base, client_uuid="ver-5", answers=self.answers(template)))
        self.assertEqual((status, check["template"]["version"], check["result"]), (200, old_version + 1, "compliant"),
                         check)
        self.assertFalse(self.env["eguitra.hsseq.check"].search_count(
            [("client_uuid", "in", ("ver-1", "ver-2", "ver-3", "ver-4"))]), "Rien n'est enregistré d'un refus")

    def test_point_bloquant_non_evalue_attend_un_controle_complementaire(self):
        """Un point bloquant ajouté après la saisie n'est jamais conforme : V01 reste « à faire » jusqu'au
        contrôle complémentaire qui y répond."""
        old_version, old_answers, added = self._new_version()
        rot = self._rotation()
        self.breath(rot)
        status, check = self.api("ibrahima", "POST", "/hsseq/checks", {
            "client_uuid": "cmp-0", "template_id": self.tanker_template.id, "template_version": old_version,
            "reported_at": self._before(), "rotation_id": rot.id, "offline": True, "answers": old_answers})
        self.assertEqual((status, check["result"]), (200, "incomplete"), check)
        evaluation = rot._hsseq_evaluate()
        [v01] = evaluation["reasons"]
        self.assertEqual((v01["code"], v01["pending"], v01["waivable"]), ("V01", True, False))
        self.assertIn(VEST, v01["detail"])
        self.assertTrue(evaluation["pending_checks_only"], "Le verrou le signale « à contrôler »")
        self.assertFalse(evaluation["allowed"])
        with self.assertRaises(RotationBlocked):
            rot.with_user(self.parc).action_depart()
        path = f"/hsseq/checks/{check['id']}/complement"
        brakes = self.tanker_template._items().filtered(lambda i: i.label == BRAKES)
        status, body = self.api("ibrahima", "POST", path, {"client_uuid": "cmp-x",
                                                           "answers": [{"item_id": brakes.id, "answer": "ok"}]})
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"), "Point déjà répondu par le contrôle")
        for login in ("sekou.parc", "dg.hsseq", "admin.hsseq", "rh.hsseq"):
            status, _b = self.api(login, "POST", path, {"client_uuid": f"cmp-{login}",
                                                        "answers": [{"item_id": added.id, "answer": "ok"}]})
            self.assertIn(status, (403, 404), f"{login} ne complète pas ce contrôle")
        status, complement = self.driver_api("POST", path, {
            "client_uuid": "cmp-1", "answers": [{"item_id": added.id, "answer": "ok"}]})
        self.assertEqual(status, 200, complement)
        self.assertEqual((complement["complement_of"]["id"], complement["result"]), (check["id"], "compliant"))
        status, again = self.driver_api("POST", path, {"client_uuid": "cmp-1",
                                                       "answers": [{"item_id": added.id, "answer": "ok"}]})
        self.assertEqual((status, again["id"]), (200, complement["id"]), "Renvoi idempotent")
        status, origin = self.api("kadi.hsseq", "GET", f"/hsseq/checks/{check['id']}")
        self.assertEqual((origin["result"], origin["awaiting_items"], [c["id"] for c in origin["complements"]]),
                         ("compliant", [], [complement["id"]]))
        self.assertNotIn("complement", origin["transitions"])
        self.assertEqual(self.codes(rot), [], "Contrôle complété : V01 levé")
        status, body = self.api("ibrahima", "POST", path, {"client_uuid": "cmp-2",
                                                           "answers": [{"item_id": added.id, "answer": "ok"}]})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Plus rien à compléter")
        status, cockpit = self.api("kadi.hsseq", "GET", "/hsseq/cockpit")
        self.assertEqual(status, 200, cockpit)

    def test_controle_complementaire_non_conforme(self):
        """Le contrôle complémentaire ouvre ses non-conformités (V02) et donne son résultat au contrôle
        d'origine ; il suit le contrôle d'origine dans le temps et ne se complète pas lui-même."""
        old_version, old_answers, added = self._new_version()
        rot = self._rotation()
        self.breath(rot)
        Check = self.env["eguitra.hsseq.check"]
        before = fields.Datetime.now() - timedelta(hours=1)
        original = Check._hsseq_create({
            "company_id": self.company.id, "template_id": self.tanker_template.id, "vehicle_id": self.truck.id,
            "rotation_id": rot.id, "driver_id": rot.driver_id.id, "author_id": self.parc.id, "reported_at": before,
            "template_version": old_version}, old_answers)
        self.assertEqual(original.result, "incomplete")
        with self.assertRaises(HsseqError) as refus:
            original._hsseq_complete({"author_id": self.parc.id, "reported_at": before - timedelta(minutes=5)},
                                     [{"item_id": added.id, "answer": "ok"}])
        self.assertEqual(refus.exception.code, "invalid_parameter", "Saisi avant le contrôle d'origine")
        with self.assertRaises(HsseqError) as refus:
            original._hsseq_complete({"author_id": self.parc.id}, [])
        self.assertEqual((refus.exception.code, refus.exception.fields), ("incomplete_answers", [added.id]))
        complement = original._hsseq_complete({"author_id": self.parc.id}, [{"item_id": added.id, "answer": "not_ok"}])
        self.assertEqual((complement.rotation_id, complement.vehicle_id), (rot, self.truck))
        self.assertEqual((complement.result, original.result), ("blocking", "blocking"))
        self.assertEqual(self.codes(rot), ["V02"], "Contrôle complété : V01 levé, la non-conformité bloque")
        with self.assertRaises(HsseqError) as refus:
            complement._hsseq_complete({"author_id": self.parc.id}, [{"item_id": added.id, "answer": "ok"}])
        self.assertEqual(refus.exception.code, "invalid_transition")

    def test_point_non_bloquant_non_evalue(self):
        """Un point non bloquant ajouté après la saisie reste à évaluer sans retenir V01."""
        old_version, old_answers, added = self._new_version(blocking=False)
        rot = self._rotation()
        self.breath(rot)
        status, check = self.api("ibrahima", "POST", "/hsseq/checks", {
            "client_uuid": "nb-0", "template_id": self.tanker_template.id, "template_version": old_version,
            "reported_at": self._before(), "rotation_id": rot.id, "answers": old_answers})
        self.assertEqual((status, check["result"], len(check["awaiting_items"])), (200, "compliant", 1), check)
        self.assertEqual(self.codes(rot), [])

    def test_non_evalue_jamais_recu_du_client(self):
        """« Non évalué » n'est posé que par la plateforme : reçu du client, il est refusé (422)."""
        template = self.tanker_template
        rot = self._rotation()
        answers = self.answers(template)
        answers[0]["answer"] = "not_evaluated"
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", {
            "client_uuid": "ne-1", "template_id": template.id, "rotation_id": rot.id, "answers": answers})
        self.assertEqual((status, body["error"], body["fields"]), (422, "invalid_parameter", ["answers"]), body)
        self.assertFalse(self.env["eguitra.hsseq.check"].search_count([("client_uuid", "=", "ne-1")]))
        with self.assertRaises(HsseqError) as refus:
            self.env["eguitra.hsseq.check"]._hsseq_create({
                "company_id": self.company.id, "template_id": template.id, "vehicle_id": self.truck.id,
                "rotation_id": rot.id, "author_id": self.parc.id}, [{"item_id": a["item_id"], "answer": a["answer"]}
                                                                    for a in answers])
        self.assertEqual((refus.exception.code, refus.exception.status), ("invalid_parameter", 422),
                         "Refusé aussi par le noyau, quel que soit l'appelant")
        old_version, old_answers, added = self._new_version()
        status, check = self.api("ibrahima", "POST", "/hsseq/checks", {
            "client_uuid": "ne-2", "template_id": template.id, "template_version": old_version,
            "reported_at": self._before(), "rotation_id": rot.id, "answers": old_answers})
        self.assertEqual((status, check["result"]), (200, "incomplete"), check)
        status, body = self.api("ibrahima", "POST", f"/hsseq/checks/{check['id']}/complement", {
            "client_uuid": "ne-3", "answers": [{"item_id": added.id, "answer": "not_evaluated"}]})
        self.assertEqual((status, body["error"]), (422, "invalid_parameter"), "Ni dans un contrôle complémentaire")
        self.assertIn("V01", self.codes(rot))

    def test_controle_et_v02_d_une_rotation_a_l_autre(self):
        rot = self._rotation()
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", {
            "client_uuid": "ctl-1", "template_id": self.tanker_template.id, "rotation_id": rot.id,
            "answers": self.answers(self.tanker_template)[:3]})
        self.assertEqual((status, body["error"]), (422, "incomplete_answers"), body)
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", {
            "client_uuid": "ctl-1", "template_id": self.tipper_template.id, "rotation_id": rot.id,
            "answers": self.answers(self.tipper_template)})
        self.assertEqual((status, body["error"]), (422, "vehicle_kind_mismatch"), body)
        payload = {"client_uuid": "ctl-1", "template_id": self.tanker_template.id, "rotation_id": rot.id,
                   "reported_at": fields.Datetime.to_string(fields.Datetime.now()), "offline": True, "duration_s": 190,
                   "latitude": 9.53, "longitude": -13.68, "gps_accuracy": 12,
                   "answers": self.answers(self.tanker_template, failing=(BRAKES, LIGHTS))}
        status, check = self.api("ibrahima", "POST", "/hsseq/checks", payload)
        self.assertEqual(status, 200, check)
        self.assertEqual((check["result"], check["photos_missing"], len(check["nonconformities"])), ("blocking", True, 2),
                         "Accepté sans ses photos, signalées ensuite")
        self.assertFalse(check["rights"]["can_approve"], "Pas de contre-visa au lot 1")
        status, again = self.api("ibrahima", "POST", "/hsseq/checks", payload)
        self.assertEqual((status, again["id"]), (200, check["id"]), "Renvoi idempotent")
        brakes = next(nc for nc in check["nonconformities"] if nc["item"]["label"] == BRAKES)
        status, photo = self.upload("ibrahima", model="nonconformity", id=brakes["id"])
        self.assertEqual(status, 200, photo)
        self.assertIn("V02", self.codes(rot), "Point critique non conforme")
        # D'une rotation à l'autre : la non-conformité suit l'ensemble.
        other = self._rotation()
        self.check(other)
        self.assertIn("V02", self.codes(other))
        status, body = self.api("ibrahima", "POST", f"/hsseq/checks/{check['id']}/lift",
                                {"nonconformity_id": brakes["id"], "comment": "Garnitures remplacées"})
        self.assertEqual((status, body["error"]), (422, "photo_missing"), "Levée sans photo de la correction")
        status, fix = self.upload("ibrahima", name="correction.png")
        status, lifted = self.api("ibrahima", "POST", f"/hsseq/checks/{check['id']}/lift", {
            "nonconformity_id": brakes["id"], "comment": "Garnitures remplacées", "attachment_ids": [fix["id"]]})
        self.assertEqual(status, 200, lifted)
        row = next(nc for nc in lifted["nonconformities"] if nc["id"] == brakes["id"])
        self.assertEqual((row["status"], row["lift_photos"][0]["id"]), ("lifted", fix["id"]))
        self.assertNotIn("V02", self.codes(other), "Levée : V02 tombe pour toutes les rotations de l'ensemble")

    def test_verrou_v01_a_v05(self):
        rot = self._rotation()
        evaluation = rot._hsseq_evaluate()
        self.assertTrue(evaluation["lock_active"])
        self.assertEqual([r["code"] for r in evaluation["reasons"]], ["V01", "V03"])
        self.assertTrue(evaluation["pending_checks_only"], "Contrôle et alcootest à faire : « À contrôler »")
        self.assertTrue(all(r["severity"] == "block" for r in evaluation["reasons"]))
        self.assertFalse(evaluation["allowed"])
        self.check(rot)
        self.assertEqual(self.codes(rot), ["V03"])
        self.breath(rot, "not_done")
        [v03] = rot._hsseq_evaluate()["reasons"]
        self.assertTrue(v03["pending"], "Alcootest non réalisé : à faire")
        self.breath(rot)
        self.assertEqual(rot._hsseq_evaluate()["reasons"], [], "Contrôle et alcootest négatif : départ autorisé")
        # V04 : habilitation obligatoire expirée (RH).
        qual = self.employee.qualification_ids.filtered(lambda q: q.type_id.code == "MATIERES_DANGEREUSES")
        qual.expiry_date = self.day - timedelta(days=2)
        [v04] = rot._hsseq_evaluate()["reasons"]
        self.assertEqual((v04["code"], v04["pending"], v04["waivable"]), ("V04", False, True))
        qual.unlink()
        evaluation = rot._hsseq_evaluate()
        self.assertEqual((evaluation["reasons"], [w["code"] for w in evaluation["warnings"]]), ([], ["V04"]),
                         "Habilitation absente avant la date de mise en service : avertissement")
        self.settings.qualifications_required_from = self.day - timedelta(days=1)
        self.assertEqual(self.codes(rot), ["V04"], "Après la date : l'absence bloque comme l'expiration")
        self.settings.qualifications_required_from = False
        # V05 : assurance expirée (Transport).
        insurance = self.truck.document_ids.filtered(lambda d: d.kind == "insurance")
        insurance.expiry_date = self.day - timedelta(days=1)
        self.assertEqual(self.codes(rot), ["V05"])
        insurance.unlink()
        self.assertEqual(self.codes(rot), [], "Assurance absente avant la date de mise en service : avertissement")
        self.settings.documents_required_from = self.day
        self.assertEqual(self.codes(rot), ["V05"])
        self.settings.documents_required_from = False
        # Paramétrage : un motif désactivé pour le site ne s'évalue plus.
        self.env.ref("eguitra_hsseq.reason_v01").disabled_site_ids = self.site
        fresh = self._rotation()
        self.breath(fresh)
        self.assertEqual(self.codes(fresh), [])

    def test_v03_positif_retire_le_conducteur(self):
        rot = self._rotation()
        self.check(rot)
        test = self.breath(rot, "positive")
        self.assertTrue(test.driver_removed)
        self.assertFalse(rot.driver_id, "Positif : conducteur retiré de la rotation")
        [v03] = rot._hsseq_evaluate()["reasons"]
        self.assertEqual((v03["code"], v03["pending"], v03["waivable"]), ("V03", False, False),
                         "Positif : un échec, pas une saisie à faire ; jamais dérogeable")
        rot.driver_id = self.driver
        self.breath(rot)
        self.assertEqual(self.codes(rot), ["V03"], "Le même conducteur reste exclu de la rotation")
        self.assertIsNone(rot._hsseq_evaluate(detail=False)["reasons"][0]["detail"], "Détail de V03 hors hsseq : nul")

    def test_annulation_d_un_alcootest_saisi_par_erreur(self):
        rot = self._rotation()
        self.check(rot)
        test = self.breath(rot, "positive")
        self.assertFalse(rot.driver_id)
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq"):
            status, _b = self.api(login, "POST", f"/hsseq/breath-tests/{test.id}/cancel", {"reason": "Erreur"})
            self.assertEqual(status, 403, f"{login} n'annule pas un alcootest")
        status, _b = self.driver_api("POST", f"/hsseq/breath-tests/{test.id}/cancel", {"reason": "Erreur"})
        self.assertEqual(status, 403, "Le conducteur n'annule pas un alcootest")
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/breath-tests/{test.id}/cancel", {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, cancelled = self.api("kadi.hsseq", "POST", f"/hsseq/breath-tests/{test.id}/cancel",
                                     {"reason": "Saisi sur le mauvais conducteur"})
        self.assertEqual((status, cancelled["cancelled"]), (200, True), cancelled)
        self.assertEqual(rot.driver_id, self.driver, "Le conducteur retiré par le positif est rétabli")
        [v03] = rot._hsseq_evaluate()["reasons"]
        self.assertEqual((v03["code"], v03["pending"]), ("V03", True), "L'alcootest est à refaire")
        entry = self.env["eguitra.hsseq.journal"].search([("model", "=", "breath_test"), ("res_id", "=", test.id),
                                                          ("action", "=", "cancel")])
        self.assertEqual((entry.old_value, entry.new_value, entry.user_id), ("non_compliant", "cancelled", self.hsseq),
                         "Annulation journalisée : avant, après, auteur")
        status, cockpit = self.api("kadi.hsseq", "GET", "/hsseq/cockpit")
        positives = next(i for i in cockpit["indicators"] if i["code"] == "breath_test_positives")["value"]
        self.assertEqual(positives, 0, "Un test annulé ne compte plus dans les indicateurs")
        status, _b = self.api("ibrahima", "GET", f"/hsseq/breath-tests/{test.id}")
        self.assertEqual(status, 404, "Test annulé : connu du seul profil hsseq")

    def test_depart_et_validation_par_transport(self):
        rot = self._rotation()
        with self.assertRaises(RotationBlocked) as refus:
            rot.with_user(self.parc).action_depart()
        self.assertEqual({b["code"] for b in refus.exception.blockers if b["severity"] == "block"}, {"V01", "V03"})
        self.assertEqual(set(refus.exception.blockers[0]), {"code", "label", "source", "since", "waivable", "severity"})
        with self.assertRaises(RotationBlocked):
            rot.action_validate()
        self.check(rot)
        self.breath(rot)
        with self.assertRaises(AccessError):
            rot.with_user(self.hsseq).action_depart()
        with self.assertRaises(AccessError):
            rot.with_user(self.parc2).action_depart()
        rot.with_user(self.parc).action_depart()
        self.assertEqual(rot.state, "en_route")
        rot.action_validate()
        self.assertEqual(rot.state, "done", "Passée par « en route » : la validation est permise")
        status, body = self.api("ibrahima", "POST", f"/transport/rotations/{self._rotation().id}/depart")
        self.assertEqual((status, body["error"]), (422, "departure_blocked"), body)
        self.assertTrue(body["blockers"])

    def test_validation_exige_le_depart(self):
        rot = self._rotation()
        with self.assertRaises(RotationBlocked) as refus:
            rot.action_validate()
        self.assertIn("H01", [b["code"] for b in refus.exception.blockers])
        old = self._rotation(date_loading=self.day - timedelta(days=60))
        old.action_validate()
        self.assertEqual(old.state, "done", "Avant la mise en service du verrou : Transport comme avant")
        self.settings.lock_start_date = False
        free = self._rotation()
        self.assertFalse(free._hsseq_lock_active())
        self.assertEqual([b["code"] for b in free._departure_blockers()], [], "Verrou pas en service : rien ne bloque")

    def test_derogations(self):
        rot = self._rotation()
        self.check(rot, failing=(BRAKES,))
        self.breath(rot)
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers",
                                {"rotation_id": rot.id, "reason_code": "V01", "justification": "Contrôle fait sur papier"})
        self.assertEqual((status, body["error"]), (422, "not_waivable"))
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers",
                                {"rotation_id": rot.id, "reason_code": "V03", "justification": "Appareil en panne"})
        self.assertEqual((status, body["error"]), (422, "not_waivable"))
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers",
                                {"rotation_id": rot.id, "reason_code": "V05", "justification": "Assurance en cours"})
        self.assertEqual((status, body["error"]), (422, "reason_not_open"))
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers", {"rotation_id": rot.id, "reason_code": "V02"})
        self.assertEqual((status, body["error"]), (422, "reason_required"), "Justification écrite obligatoire")
        status, waiver = self.api("ibrahima", "POST", "/hsseq/waivers", {
            "rotation_id": rot.id, "reason_code": "V02", "justification": "Réparation de fortune validée par le garage"})
        self.assertEqual((status, waiver["status"]), (200, "pending_hsseq"), waiver)
        self.assertEqual([a["level"] for a in waiver["approvals"]], [1], "La demande vaut première validation")
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers", {
            "rotation_id": rot.id, "reason_code": "V02", "justification": "Deuxième demande"})
        self.assertEqual(status, 409, "Une demande en cours pour ce motif")
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/waivers", {
            "rotation_id": rot.id, "reason_code": "V02", "justification": "Le responsable HSSEQ ne demande pas"})
        self.assertEqual(status, 403)
        self.assertFalse(rot._hsseq_evaluate()["allowed"], "En attente de la seconde validation")
        status, active = self.api("kadi.hsseq", "POST", f"/hsseq/waivers/{waiver['id']}/approve")
        self.assertEqual((status, active["status"]), (200, "active"), active)
        self.assertEqual([a["by"]["id"] for a in active["approvals"]], [self.parc.id, self.hsseq.id],
                         "Deux validations, deux personnes distinctes")
        self.assertTrue(active["management_notified_at"], "Directeur général prévenu")
        evaluation = rot._hsseq_evaluate()
        self.assertTrue(evaluation["allowed"])
        self.assertEqual(evaluation["reasons"][0]["waiver_id"], waiver["id"])
        rot.with_user(self.parc).action_depart()
        self.assertEqual([w["code"] for w in json.loads(rot.departure_log)["waived"]], ["V02"], "Dérogation tracée au départ")
        rot.action_validate()
        self.assertEqual(self.env["eguitra.hsseq.waiver"].browse(waiver["id"]).status, "expired",
                         "Expire à la fin de la rotation")

    def test_quatre_yeux_meme_avec_deux_profils(self):
        """Un compte exploitation et hsseq demande : il ne donne pas lui-même la seconde validation."""
        both = self._create_user("double.casquette", "exploitation", "hsseq")
        self.site.manager_ids = [(4, both.id)]
        rot = self._rotation()
        self.check(rot, failing=(BRAKES,))
        waiver = self.env["eguitra.hsseq.waiver"].with_user(both)._hsseq_request(rot, "V02", "Réparation provisoire")
        with self.assertRaises(HsseqError) as refus:
            waiver.with_user(both).action_approve()
        self.assertEqual(refus.exception.code, "four_eyes")
        status, body = self.api("double.casquette", "POST", f"/hsseq/waivers/{waiver.id}/approve")
        self.assertEqual((status, body["error"]), (422, "four_eyes"), body)
        status, body = self.api("double.casquette", "POST", f"/hsseq/waivers/{waiver.id}/refuse", {"reason": "Non"})
        self.assertEqual((status, body["error"]), (422, "four_eyes"), body)
        waiver.with_user(self.hsseq2).action_approve()
        self.assertEqual(waiver.status, "active")

    def test_rattachement_des_saisies_sans_rotation(self):
        """Contrôle et alcootest saisis avant l'affectation : rattachés dans leur fenêtre, une seule fois."""
        early = self.check(rotation=None, reported_at=fields.Datetime.now() - timedelta(hours=13))
        test_old = self.breath(rotation=None, reported_at=fields.Datetime.now() - timedelta(hours=5))
        rot = self._rotation()
        self.assertEqual(self.codes(rot), ["V01", "V03"], "Hors de la fenêtre (12 h, 4 h) : rien n'est rattaché")
        recent = self.check(rotation=None)
        test = self.breath(rotation=None)
        self.assertEqual(self.codes(rot), [], "Dans la fenêtre : la saisie compte pour la rotation")
        status, evaluation = self.api("ibrahima", "POST", "/hsseq/lock/evaluate", {"rotation_id": rot.id})
        self.assertEqual((status, evaluation["allowed"]), (200, True), evaluation)
        self.assertEqual((recent.rotation_id, test.rotation_id), (rot, rot), "Rattachés à l'évaluation demandée")
        self.assertFalse(early.rotation_id or test_old.rotation_id)
        journal = self.env["eguitra.hsseq.journal"].search([("model", "=", "check"), ("res_id", "=", recent.id),
                                                            ("action", "=", "attach")])
        self.assertTrue(journal, "Rattachement tracé au journal")
        second = self._rotation()
        self.assertEqual(self.codes(second), ["V01", "V03"], "Pas de double rattachement")

    def test_api_evaluation_et_departs(self):
        rot = self._rotation()
        status, evaluation = self.driver_api("POST", "/hsseq/lock/evaluate", {"rotation_id": rot.id})
        self.assertEqual(status, 200, evaluation)
        self.assertEqual({"rotation_id", "allowed", "reasons", "active_waiver", "checked_at"} - set(evaluation), set())
        v03 = next(r for r in evaluation["reasons"] if r["code"] == "V03")
        self.assertIsNone(v03["detail"], "Détail de V03 nul hors du profil hsseq")
        self.assertEqual(rot.state, "draft", "L'évaluation ne change pas l'état")
        self.assertTrue(self.env["eguitra.hsseq.lock.log"].search_count([("rotation_id", "=", rot.id)]),
                        "Chaque évaluation est journalisée")
        status, departures = self.api("ibrahima", "GET", "/hsseq/lock/departures")
        self.assertEqual(status, 200, departures)
        item = next(i for i in departures["items"] if i["rotation"]["id"] == rot.id)
        self.assertTrue(item["pending_checks_only"])
        status, mine = self.driver_api("GET", "/hsseq/me/rotations")
        self.assertEqual((status, [r["id"] for r in mine["items"]]), (200, [rot.id]), mine)
        self.assertEqual(set(mine["items"][0]["lock"]) >= {"allowed", "pending_checks_only", "reasons"}, True)
        status, _b = self.api("dg.hsseq", "GET", "/hsseq/me/rotations")
        self.assertEqual(status, 403, "Rotations du jour : refusées à la direction")
        status, reasons = self.api("kadi.hsseq", "GET", "/hsseq/lock/reasons")
        self.assertEqual([r["code"] for r in reasons], [f"V0{i}" for i in range(1, 10)])
        status, body = self.api("kadi.hsseq", "PATCH", "/hsseq/lock/reasons", {"code": "V07", "active": True})
        self.assertEqual((status, body["error"]), (422, "not_in_lot_1"))
        status, body = self.api("admin.hsseq", "PATCH", "/hsseq/lock/reasons",
                                {"code": "V02", "vehicle_kinds": ["tanker"], "disabled_sites": [self.site2.id]})
        self.assertEqual((status, body["vehicle_kinds"], body["disabled_sites"][0]["id"]), (200, ["tanker"], self.site2.id))
