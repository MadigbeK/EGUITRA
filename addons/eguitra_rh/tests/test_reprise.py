"""Import des salariés : modèle, aperçu, création, mise à jour sans doublon, photos rattachées, archive
piégée, tout ou rien, fiche à compléter (paie bloquée), refus par profil, séparation des sociétés.
Données fictives seulement."""

import io
import zipfile
from datetime import date
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from odoo.addons.eguitra_api.files import XLSX
from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_rh import reprise

from .test_photo import image

HEADER = "Matricule;Nom complet;Poste;Département;Courriel professionnel;Téléphone;Contrat;Catégorie;Société;" \
         "Date d'entrée;Fin du contrat;Salaire de base"


def csv_file(*lines):
    return ("\n".join((HEADER,) + lines) + "\n").encode("utf-8")


def zip_file(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return out.getvalue()


@tagged("post_install", "-at_install")
class TestRepriseSalaries(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.rh_user = cls._create_user("reprise.rh", "rh")
        cls.admin_user = cls._create_user("reprise.admin", "admin")
        cls.dg_user = cls._create_user("reprise.dg", "direction")
        cls.finance_user = cls._create_user("reprise.finance", "finance")
        cls.worker_user = cls._create_user("reprise.salarie", "exploitation")
        cls.company = cls.rh_user.company_id
        Employee = cls.env["eguitra.rh.employee"]
        cls.known = Employee.create({"name": "Mamadou Fictif", "hire_date": date(2023, 3, 1), "base_salary": 2_000_000,
                                     "job_title": "Chauffeur", "email": "m.fictif@exemple.test"})
        cls.worker = Employee.create({"name": "Salarié Reprise", "hire_date": date(2024, 1, 1),
                                      "base_salary": 2_000_000, "user_id": cls.worker_user.id})

    def _token(self, login="reprise.rh"):
        return self.open_session(login, app="rh")["access_token"]

    def _import(self, token, content, photos=None, mode="preview", name="salaries.csv"):
        files = {"file": (name, io.BytesIO(content), "text/csv")}
        if photos is not None:
            files["photos"] = ("photos.zip", io.BytesIO(photos), "application/zip")
        response = self.url_open("/api/v1/rh/employees/import", data={"mode": mode}, files=files, method="POST",
                                 timeout=60, headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"})
        try:
            return response.status_code, response.json()
        except ValueError:
            return response.status_code, response.text

    def _count(self):
        return self.env["eguitra.rh.employee"].with_context(active_test=False).search_count([])

    def test_modele_xlsx_et_csv(self):
        import openpyxl

        token = self._token()
        headers = {"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}
        response = self.url_open("/api/v1/rh/employees/import/template?format=xlsx", timeout=60, headers=headers)
        self.assertEqual(response.status_code, 200, response.text[:300])
        self.assertEqual(response.headers["Content-Type"], XLSX)
        book = openpyxl.load_workbook(io.BytesIO(response.content), read_only=True)
        self.assertEqual(book.sheetnames, ["Salariés", "Valeurs admises", "Notice"])
        self.assertEqual(list(next(book["Salariés"].iter_rows(values_only=True))), reprise.HEADERS)
        allowed = [r[0] for r in book["Valeurs admises"].iter_rows(values_only=True) if r[0]]
        self.assertEqual(allowed[:5], ["Contrat", "CDI", "CDD", "Stage", "Apprentissage"])
        response = self.url_open("/api/v1/rh/employees/import/template?format=csv", timeout=60, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode("utf-8-sig").strip(), ";".join(reprise.HEADERS))

    def test_apercu_puis_import(self):
        token = self._token()
        content = csv_file(
            ";Aïssata Thiam;Comptable;Comptabilité importée;a.thiam@exemple.test;620 00 00 01;CDI;Cadre;;"
            "05/01/2025;;3 500 000",
            ";Ibrahima Sans Date;Magasinier;Comptabilité importée;;;CDI;Employé;;;;",
            f"{self.known.matricule};Mamadou Fictif;Chef de parc;;;;;;;;;",
        )
        photos = zip_file([("photos/aissata_thiam.png", image("PNG", (900, 1200))),
                           (f"{self.known.matricule.lower()}.jpg", image("JPEG", (400, 400))),
                           ("inconnu.png", image())])
        before = self._count()
        status, preview = self._import(token, content, photos)
        self.assertEqual(status, 200, preview)
        self.assertFalse(preview["imported"])
        self.assertEqual(self._count(), before, "L'aperçu n'enregistre rien")
        self.assertFalse(self.env["eguitra.rh.department"].search([("name", "=", "Comptabilité importée")]))
        summary = preview["summary"]
        self.assertEqual((summary["create"], summary["update"], summary["refused"]), (2, 1, 0), preview)
        self.assertEqual((summary["photos_found"], summary["photos_missing"], summary["to_complete"]), (2, 1, 1))
        self.assertEqual(preview["departments_created"], ["Comptabilité importée"])
        self.assertEqual(preview["photos_unmatched"], ["inconnu.png"])
        lines = {x["name"]: x for x in preview["lines"]}
        self.assertEqual(lines["Mamadou Fictif"]["changes"], ["Poste"])
        self.assertTrue(lines["Ibrahima Sans Date"]["to_complete"])
        self.assertEqual(lines["Ibrahima Sans Date"]["missing"], ["date d'entrée", "salaire de base"])

        status, done = self._import(token, content, photos, mode="import")
        self.assertEqual(status, 200, done)
        self.assertTrue(done["imported"])
        self.assertEqual(self._count(), before + 2)
        Employee = self.env["eguitra.rh.employee"]
        aissata = Employee.search([("name", "=", "Aïssata Thiam")])
        self.assertEqual((aissata.job_title, aissata.contract_type, aissata.category, aissata.base_salary,
                          aissata.hire_date), ("Comptable", "cdi", "cadre", 3_500_000, date(2025, 1, 5)))
        self.assertEqual(aissata.department_id.company_id, aissata.company_id, "Département créé dans la société")
        self.assertTrue(aissata.photo_version, "Photo rattachée par le nom")
        self.assertFalse(aissata.to_complete)
        self.known.invalidate_recordset()
        self.assertEqual(self.known.job_title, "Chef de parc", "Mis à jour, jamais dupliqué")
        self.assertEqual(self.known.email, "m.fictif@exemple.test", "Une cellule vide ne change rien")
        self.assertTrue(self.known.photo_version, "Photo rattachée par le matricule")
        sans_date = Employee.search([("name", "=", "Ibrahima Sans Date")])
        self.assertTrue(sans_date.to_complete)
        self.assertFalse(sans_date.hire_date, "Aucune date inventée")
        self.assertEqual(sans_date.department_id, aissata.department_id, "Un seul département créé")

        # Réimport : rien n'est dupliqué ; le courriel retrouve le dossier sans matricule.
        again = csv_file(";Aïssata T.;;;a.thiam@exemple.test;;;;;;;", ";Ibrahima Sans Date;;;;;;;;;;")
        status, preview = self._import(token, again)
        self.assertEqual(status, 200, preview)
        self.assertEqual((preview["summary"]["create"], preview["summary"]["update"],
                          preview["summary"]["unchanged"]), (0, 1, 1), preview)

        # Fiche à compléter : la paie de la société n'est pas validée tant que la date et le salaire manquent.
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, date(2026, 9, 1))
        with self.assertRaisesRegex(UserError, "fiches à compléter.*Ibrahima Sans Date"):
            payroll.with_user(self.dg_user).action_validate()

    def test_tout_ou_rien(self):
        token = self._token()
        before = self._count()
        content = csv_file(";Nouvelle Fictive;;;;;CDI;;;01/02/2026;;1 000 000",
                           ";Contrat Inconnu;;;;;Intérim;;;;;",
                           ";CDD Sans Fin;;;;;CDD;;;01/02/2026;;900 000",
                           ";Date Fausse;;;;;CDI;;;31/31/2026;;",
                           ";Sans Contrat;;;;;;;;;;")
        status, preview = self._import(token, content)
        self.assertEqual(status, 200, preview)
        refused = {x["name"]: x["errors"] for x in preview["lines"] if x["errors"]}
        self.assertEqual(set(refused), {"Contrat Inconnu", "CDD Sans Fin", "Date Fausse", "Sans Contrat"})
        self.assertIn("CDI, CDD, Stage ou Apprentissage", refused["Contrat Inconnu"][0])
        status, body = self._import(token, content, mode="import")
        self.assertEqual(status, 422, body)
        self.assertIn("rien n'est enregistré", body["message"])
        self.assertEqual(self._count(), before, "Une ligne refusée : aucune n'est enregistrée")
        status, body = self._import(token, b"%PDF-1.4 faux tableau", name="salaries.csv")
        self.assertEqual(status, 415, body)
        status, body = self._import(token, b"Colonne;Autre\nA;B\n")
        self.assertEqual(status, 422, "Colonne Nom complet attendue")

    def test_archive_piegee(self):
        token = self._token()
        content = csv_file(";Kadiatou Fictive;;;;;CDI;;;01/02/2026;;1 000 000",
                           ";Fanta Fictive;;;;;CDI;;;01/02/2026;;1 000 000",
                           ";Binta Fictive;;;;;CDI;;;01/02/2026;;1 000 000")
        photos = zip_file([("../../../etc/kadiatou_fictive.png", image()),
                           ("fanta_fictive.jpg", b"%PDF-1.4 pas une image"),
                           ("binta_fictive.png", b"\x00" * (5 * 1024 * 1024 + 1))])
        status, preview = self._import(token, content, photos)
        self.assertEqual(status, 200, preview)
        lines = {x["name"]: x for x in preview["lines"]}
        self.assertEqual(lines["Kadiatou Fictive"]["photo"], "found", "Chemin de l'archive ignoré : seul le nom compte")
        self.assertEqual(lines["Kadiatou Fictive"]["photo_file"], "kadiatou_fictive.png")
        self.assertEqual(lines["Fanta Fictive"]["photo"], "error")
        self.assertIn("JPEG, PNG ou WebP", lines["Fanta Fictive"]["errors"][0])
        self.assertEqual(lines["Binta Fictive"]["photo"], "error")
        self.assertIn("5 Mo", lines["Binta Fictive"]["errors"][0])
        status, body = self._import(token, content, b"pas une archive")
        self.assertEqual(status, 415, body)
        with patch.object(reprise, "MAX_ZIP_FILES", 2):
            status, body = self._import(token, content, photos)
        self.assertEqual(status, 422, "Trop de fichiers dans l'archive")
        with patch.object(reprise, "MAX_ZIP", 1000):
            status, body = self._import(token, content, photos)
        self.assertEqual(status, 413, "Archive trop volumineuse")

    def test_refus_par_profil(self):
        content = csv_file(";Profil Refusé;;;;;CDI;;;01/02/2026;;1 000 000")
        for login, app in (("reprise.dg", "rh"), ("reprise.finance", "finance"), ("reprise.salarie", "rh")):
            token = self.open_session(login, app=app)["access_token"]
            status, _b = self._import(token, content)
            self.assertEqual(status, 403, login)
            status, _b = self.call("GET", "/rh/employees/import/template", token=token)
            self.assertEqual(status, 403, login)
        status, body = self._import(self._token("reprise.admin"), content)
        self.assertEqual(status, 200, body)

    def test_son_propre_dossier_refuse(self):
        own = self.env["eguitra.rh.employee"].create({"name": "Reprise RH Elle-Même", "hire_date": date(2024, 1, 1),
                                                      "base_salary": 2_000_000, "user_id": self.rh_user.id})
        status, preview = self._import(self._token(), csv_file(f"{own.matricule};Reprise RH Elle-Même;Directrice;;;;;;;;;"))
        self.assertEqual(status, 200, preview)
        self.assertIn("propre dossier", preview["lines"][0]["errors"][0])

    def test_separation_des_societes(self):
        other = self.env["res.company"].search([("id", "!=", self.company.id)], limit=1)
        if not other:
            self.skipTest("Une seule société dans la base de test")
        twin = self.env["eguitra.rh.employee"].create({"name": "Homonyme Fictif", "hire_date": date(2024, 1, 1),
                                                       "base_salary": 1_000_000, "company_id": other.id})
        token = self._token()  # compte RH ouvert à sa seule société
        content = csv_file(f";Autre Société;;;;;CDI;;{other.name};01/02/2026;;1 000 000",
                           ";Homonyme Fictif;;;;;CDI;;;01/02/2026;;1 000 000")
        status, preview = self._import(token, content)
        self.assertEqual(status, 200, preview)
        lines = preview["lines"]
        self.assertIn("non ouverte à votre compte", lines[0]["errors"][0])
        self.assertEqual((lines[1]["action"], lines[1]["errors"]), ("create", []),
                         "Le dossier de l'autre société n'est ni vu ni mis à jour")
        self.assertEqual(lines[1]["company"]["id"], self.company.id)
        twin.invalidate_recordset()
        self.assertEqual(twin.name, "Homonyme Fictif")

        self._create_user("reprise.groupe", "rh", company_ids=[(6, 0, [self.company.id, other.id])],
                          company_id=self.company.id)
        token = self.open_session("reprise.groupe", app="rh")["access_token"]
        status, done = self._import(token, csv_file(f";Consultante Fictive;Analyste;Conseil importé;;;CDI;;{other.name};"
                                                    "01/02/2026;;4 000 000"), mode="import")
        self.assertEqual(status, 200, done)
        created = self.env["eguitra.rh.employee"].search([("name", "=", "Consultante Fictive")])
        self.assertEqual(created.company_id, other)
        self.assertEqual(created.department_id.company_id, other, "Département créé dans la société de la ligne")
