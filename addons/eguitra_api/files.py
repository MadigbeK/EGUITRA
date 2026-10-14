"""Fichiers reçus des applications : le format est lu dans le contenu, jamais pris sur parole.

Le type qu'annonce le navigateur est choisi librement par l'expéditeur : un exécutable annoncé
« PDF » passerait. Le format des pièces conservées (data room, justificatifs) est donc reconnu à
sa signature ; les documents à macros et les anciens formats Office (qui peuvent en porter sans
contrôle simple) sont refusés, et le nom du fichier reçoit l'extension du format reconnu. Les
classeurs importés sont bornés (taille une fois décompressés, nombre de lignes) pour qu'un petit
fichier ne sature pas la mémoire du serveur.
"""

import io
import os
import zipfile

from odoo.exceptions import UserError

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EXTENSIONS = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", DOCX: ".docx", XLSX: ".xlsx"}
ACCEPTED = "PDF, JPEG, PNG, Word (.docx) ou Excel (.xlsx)"
MAX_UNCOMPRESSED = 50 * 1024 * 1024
MAX_ROWS = 20000
ZIP_ERRORS = (zipfile.BadZipFile, zipfile.LargeZipFile, ValueError, EOFError, OSError, NotImplementedError)


def _zip_names(content):
    try:
        return zipfile.ZipFile(io.BytesIO(content)).namelist()
    except ZIP_ERRORS:
        return []


def detect_type(content):
    """Format reconnu à la signature du contenu, ou None s'il n'est pas accepté."""
    if b"%PDF-" in content[:1024]:  # les lecteurs tolèrent quelques octets avant l'en-tête
        return "application/pdf"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"PK\x03\x04"):
        names = _zip_names(content)
        if any(name.lower().endswith("vbaproject.bin") for name in names):
            return None  # document à macros, même sous une extension .docx ou .xlsx
        if "word/document.xml" in names:
            return DOCX
        if "xl/workbook.xml" in names:
            return XLSX
    return None


def checked_name(filename, mimetype, default="piece"):
    """Nom sans chemin, avec l'extension du format reconnu (« facture.exe » en PDF devient « facture.pdf »)."""
    name = os.path.basename((filename or "").replace("\\", "/")).strip() or default
    stem, ext = os.path.splitext(name)
    expected = EXTENSIONS[mimetype]
    if ext.lower() == expected or (mimetype == "image/jpeg" and ext.lower() == ".jpeg"):
        return name
    return (stem or default) + expected


def workbook_rows(content, max_rows=MAX_ROWS):
    """Lignes de la première feuille d'un classeur XLSX, après contrôle de sa taille décompressée."""
    try:
        infos = zipfile.ZipFile(io.BytesIO(content)).infolist()
    except ZIP_ERRORS as exc:
        raise UserError("Classeur illisible : enregistrez-le au format XLSX ou CSV.") from exc
    # Les macros d'un classeur importé ne sont jamais exécutées (lecture des seules valeurs) et le
    # fichier n'est pas conservé : un .xlsm est accepté ici, contrairement aux pièces déposées.
    if sum(info.file_size for info in infos) > MAX_UNCOMPRESSED:
        raise UserError("Classeur trop volumineux : scindez-le ou enregistrez-le au format CSV.")
    import openpyxl

    try:
        sheet = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True).worksheets[0]
        rows = []
        for row in sheet.iter_rows(values_only=True):
            if len(rows) >= max_rows:
                raise UserError(f"Classeur trop long : {max_rows} lignes au plus.")
            rows.append(list(row))
    except UserError:
        raise
    except Exception as exc:  # classeur corrompu ou d'un autre format
        raise UserError("Classeur illisible : enregistrez-le au format XLSX ou CSV.") from exc
    return rows
