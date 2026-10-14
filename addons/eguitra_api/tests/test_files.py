import io
import zipfile

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.files import DOCX, XLSX, checked_name, detect_type, workbook_rows


def _zip(members):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return out.getvalue()


def _workbook(rows):
    import openpyxl

    book = openpyxl.Workbook()
    for row in range(rows):
        book.active.append([f"ligne {row}", row])
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


@tagged("post_install", "-at_install")
class TestFiles(TransactionCase):
    def test_format_lu_dans_le_contenu(self):
        self.assertEqual(detect_type(b"%PDF-1.7\n..."), "application/pdf")
        self.assertEqual(detect_type(b"\xff\xd8\xff\xe0JFIF"), "image/jpeg")
        self.assertEqual(detect_type(b"\x89PNG\r\n\x1a\n...."), "image/png")
        self.assertEqual(detect_type(_zip({"word/document.xml": "<w/>"})), DOCX)
        self.assertEqual(detect_type(_workbook(2)), XLSX)
        self.assertIsNone(detect_type(b"MZ\x90\x00"), "Exécutable")
        self.assertIsNone(detect_type(b"<html><script>alert(1)</script>"), "Page web")
        self.assertIsNone(detect_type(_zip({"programme.exe": b"MZ"})), "Archive quelconque")
        self.assertIsNone(detect_type(_zip({"word/document.xml": "<w/>", "word/vbaProject.bin": b"x"})), "Macros")
        self.assertIsNone(detect_type(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"), "Ancien format Office")

    def test_nom_du_fichier(self):
        self.assertEqual(checked_name("C:\\Users\\Moussa\\facture.exe", "application/pdf"), "facture.pdf")
        self.assertEqual(checked_name("../../etc/statuts.pdf", "application/pdf"), "statuts.pdf")
        self.assertEqual(checked_name("Photo.JPEG", "image/jpeg"), "Photo.JPEG")
        self.assertEqual(checked_name("", "image/png"), "piece.png")

    def test_classeur_borne(self):
        self.assertEqual(len(workbook_rows(_workbook(30))), 30)
        with self.assertRaises(UserError):
            workbook_rows(_workbook(30), max_rows=10)
        bombe = _zip({"xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": b"0" * (60 * 1024 * 1024)})
        self.assertLess(len(bombe), 1024 * 1024, "Quelques centaines de Ko compressés")
        with self.assertRaises(UserError):
            workbook_rows(bombe)
        with self.assertRaises(UserError):
            workbook_rows(b"pas un classeur")
