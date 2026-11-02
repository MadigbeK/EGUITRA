"""Reprise des salariés : lecture du fichier (XLSX ou CSV), des colonnes et des valeurs, et de l'archive
des photos. Sans accès à la base : le rapprochement avec les dossiers et l'écriture sont dans
controllers/reprise.py.

Archive des photos (ZIP facultatif) : bornée en taille, en nombre de fichiers et en volume décompressé ;
les chemins de l'archive sont ignorés (seul le nom du fichier compte, rien n'est jamais extrait sur le
disque) ; chaque photo passe ensuite par les mêmes contrôles que l'envoi unitaire (photo.normalize).
"""

import csv
import io
import os
import re
import unicodedata
import zipfile

from .photo import MAX_PHOTO

MAX_TABLE = 5 * 1024 * 1024
MAX_ROWS = 2000
MAX_ZIP = 100 * 1024 * 1024
MAX_ZIP_FILES = 1000
MAX_ZIP_TOTAL = 300 * 1024 * 1024
ZIP_ERRORS = (zipfile.BadZipFile, zipfile.LargeZipFile, ValueError, EOFError, OSError, NotImplementedError,
              RuntimeError)

# Modèle : en-têtes dans cet ordre ; à l'import, les variantes ci-dessous sont reconnues (casse, accents,
# apostrophes et tirets bas ignorés).
HEADERS = ["Matricule", "Nom complet", "Poste", "Département", "Courriel professionnel", "Téléphone", "Contrat",
           "Catégorie", "Société", "Date d'entrée", "Fin du contrat", "Salaire de base"]
COLUMNS = {
    "matricule": "matricule",
    "nom complet": "name", "nom et prenoms": "name", "nom et prenom": "name", "nom prenoms": "name",
    "nom": "name", "salarie": "name", "employe": "name",
    "poste": "job_title", "fonction": "job_title", "intitule du poste": "job_title",
    "departement": "department", "service": "department",
    "courriel professionnel": "email", "courriel": "email", "email": "email", "e mail": "email",
    "adresse electronique": "email", "adresse e mail": "email",
    "telephone": "phone", "tel": "phone", "telephone professionnel": "phone", "mobile": "phone",
    "contrat": "contract_type", "type de contrat": "contract_type", "statut": "contract_type",
    "categorie": "category",
    "societe": "company", "employeur": "company",
    "date d entree": "hire_date", "date d embauche": "hire_date", "embauche": "hire_date", "entree": "hire_date",
    "fin du contrat": "contract_end", "date de fin du contrat": "contract_end", "fin de contrat": "contract_end",
    "salaire de base": "base_salary", "salaire": "base_salary", "salaire de base mensuel": "base_salary",
}
# Valeurs admises (en plus des libellés du module : CDI, CDD, Stage, Apprentissage ; Cadre, Agent de
# maîtrise, Employé, Ouvrier).
CONTRACT_ALIASES = {
    "contrat a duree indeterminee": "cdi", "contrat a duree determinee": "cdd", "stagiaire": "stage",
    "apprenti": "apprentissage",
}
CATEGORY_ALIASES = {"agent de maitrise": "maitrise", "maitrise": "maitrise", "employee": "employe"}
COMPANY_LABELS = {"groupe": "Groupe", "cabinet": "Cabinet"}


class RepriseError(ValueError):
    """Fichier refusé en entier (format, colonnes, archive) : message en français."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def plain(value):
    """Texte comparable : minuscules, sans accents, apostrophes, tirets bas ni espaces superflus."""
    value = str(value or "").replace("'", " ").replace("’", " ")
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return " ".join(value.lower().replace("_", " ").split())


def photo_key(value):
    """Nom de rapprochement d'une photo : « Aïssata Thiam » et « aissata_thiam.png » donnent aissata_thiam,
    « EG-0001 » donne eg_0001."""
    return re.sub(r"[^a-z0-9]+", "_", plain(value)).strip("_")


def choice(value, options, aliases=None):
    """Code d'une valeur de liste (code ou libellé du module, ou variante admise), None si inconnue."""
    wanted = plain(value)
    for code, label in options:
        if wanted in (plain(code), plain(label)):
            return code
    return (aliases or {}).get(wanted)


def amount(value):
    """Montant d'une cellule (« 2 500 000 », « 2500000,00 ») ; ValueError si illisible."""
    if isinstance(value, bool):
        raise ValueError(value)
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[\s  ]|GNF", "", str(value), flags=re.I).replace(",", ".")
    if text.count(".") > 1:  # « 2.500.000 »
        text = text.replace(".", "")
    return float(text)


def read_table(content):
    """Lignes du fichier : classeur XLSX (feuille « Salariés », sinon la première) ou texte CSV (séparateur
    ; , ou tabulation, UTF-8 ou Windows-1252)."""
    if len(content) > MAX_TABLE:
        raise RepriseError(413, "too_large", "Fichier trop volumineux (5 Mo maximum).")
    if content.startswith(b"PK\x03\x04"):
        from odoo.addons.eguitra_api.files import workbook_rows

        return workbook_rows(content, MAX_ROWS + 10, sheets=("Salariés",))
    if b"\x00" in content[:4096] or content.startswith(b"%PDF"):
        raise RepriseError(415, "unsupported_type", "Format non reconnu : classeur Excel (.xlsx) ou fichier CSV.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252", errors="replace")
    first = text.split("\n", 1)[0]
    delimiter = max((";", ",", "\t"), key=first.count)
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    if len(rows) > MAX_ROWS + 10:
        raise RepriseError(422, "business_rule", f"Fichier trop long : {MAX_ROWS} salariés au plus par import.")
    return rows


def columns(header):
    index = {}
    for i, label in enumerate(header):
        key = COLUMNS.get(plain(label))
        if key:
            index.setdefault(key, i)
    return index


def read_photos(content):
    """Photos d'une archive ZIP : ({clé : [(nom, octets ou None, motif du refus ou None)]}, [(nom, motif)]
    des fichiers écartés). Les chemins de l'archive sont ignorés ; rien n'est extrait sur le disque."""
    if len(content) > MAX_ZIP:
        raise RepriseError(413, "too_large", "Archive des photos trop volumineuse (100 Mo maximum).")
    if not content.startswith(b"PK"):
        raise RepriseError(415, "unsupported_type", "Les photos s'envoient dans une archive ZIP.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        infos = [info for info in archive.infolist() if not info.is_dir()]
    except ZIP_ERRORS as e:
        raise RepriseError(422, "invalid_zip", "Archive ZIP illisible.") from e
    if len(infos) > MAX_ZIP_FILES:
        raise RepriseError(422, "too_many_files", f"Archive trop fournie : {MAX_ZIP_FILES} fichiers au plus.")
    if sum(info.file_size for info in infos) > MAX_ZIP_TOTAL:
        raise RepriseError(413, "too_large", "Archive trop volumineuse une fois décompressée (300 Mo au plus).")
    photos, ignored = {}, []
    for info in infos:
        path = info.filename.replace("\\", "/")
        name = path.rsplit("/", 1)[-1]
        if not name or name.startswith(".") or path.startswith("__MACOSX/") or "/__MACOSX/" in path:
            continue  # fichiers techniques des archives (macOS, fichiers cachés)
        key = photo_key(os.path.splitext(name)[0])
        if not key:
            ignored.append((name, "nom de fichier sans lettre ni chiffre"))
            continue
        if info.flag_bits & 0x1:
            photos.setdefault(key, []).append((name, None, "fichier chiffré"))
            continue
        if info.file_size > MAX_PHOTO:
            photos.setdefault(key, []).append((name, None, "photo trop volumineuse : 5 Mo au plus"))
            continue
        try:
            with archive.open(info) as handle:
                data = handle.read(MAX_PHOTO + 1)
        except ZIP_ERRORS:
            photos.setdefault(key, []).append((name, None, "fichier abîmé dans l'archive"))
            continue
        if len(data) > MAX_PHOTO:  # taille annoncée par l'archive mensongère
            photos.setdefault(key, []).append((name, None, "photo trop volumineuse : 5 Mo au plus"))
            continue
        photos.setdefault(key, []).append((name, data, None))
    return photos, ignored

