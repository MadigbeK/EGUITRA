/**
 * Maquette du lot 3 HSSEQ : télématique (eguitra_hsseq/controllers/telematics.py, models/telematics.py).
 * Routes et données fictives ; `H` porte les références de serveur.mjs (HS_REFS).
 *
 * Tables, aux noms de champs du noyau : DB.hsseq.telematicsImports (eguitra.hsseq.telematics.import :
 * name, company_id, state, source, imported_by, imported_at, row_count, created_count, duplicate_count,
 * warnings, errors, error_count) et DB.hsseq.violations (eguitra.hsseq.telematics.violation : company_id, occurred_at,
 * vehicle_id, site_id, driver_id, rotation_id, violation_type, source, value, limit_value,
 * duration_minutes, location, external_id, import_id). site_id est le site de l'ensemble, lu à la volée
 * comme le champ lié du noyau ; le cockpit de serveur.mjs lit ces deux tables (violations du mois,
 * violations par 100 voyages, dernier import).
 *
 * Import (hsseq seul) : fichier CSV (UTF-8 ou Latin-1, séparateur « ; », « , » ou tabulation) ou
 * classeur Excel (.xlsx, lu ici par un petit lecteur de zip, sans macro), 5 Mo au plus, tout ou rien
 * (une ligne en erreur refuse le fichier : 422 import_rejected avec errors[] ; l'import confirmé refusé
 * laisse sa trace, import « rejected » avec ses erreurs, et sert son import_id), dry_run=1 pour le
 * contrôle à blanc ; mêmes colonnes (date et heure en une colonne ou en deux), mêmes messages, mêmes
 * doublons (bornés à la société de l'ensemble) et même rattachement à la rotation que
 * models/telematics.py. Le contrôle à blanc sert `preview` au format des lignes de la liste
 * (preview_row du noyau : id et import nuls).
 *
 * Lecture des violations : administration, direction, hsseq ; chef de parc et auditeur bornés aux
 * véhicules de leurs sites (fermé par défaut), sans le nom du chauffeur pour l'auditeur ; filtres de type,
 * ensemble, site, conducteur, import, rotation et période ; counts.departures et per_100_trips rapportent
 * les violations de la période (le mois en cours à ce jour sans dates) aux voyages partis sous les mêmes
 * filtres (trip_domain du noyau). Historique des imports : administration, direction, hsseq, filtre state.
 */

import { inflateRawSync } from "node:zlib";

const TYPES = { speeding: "Excès de vitesse", harsh_braking: "Freinage brusque", night_driving: "Conduite de nuit", driving_time: "Temps de conduite dépassé" };
const CODES = Object.keys(TYPES);
/** VIOLATION_READ et IMPORT_READ du contrôleur. */
const LECTURE_VIOLATIONS = ["admin", "direction", "hsseq", "exploitation", "auditeur"];
const LECTURE_IMPORTS = ["admin", "direction", "hsseq"];
const MAX_IMPORT = 5 * 1024 * 1024;
const MAX_ROWS = 20000;
const MAX_REPORTED = 200;
/** Taille décompressée au plus d'un classeur (contrôle de eguitra_api/files.py). */
const MAX_DECOMPRESSE = 50 * 1024 * 1024;
/** États d'une rotation partie (departed_states du noyau). */
const PARTIES = ["en_route", "done", "invoiced"];

/** En-têtes reconnus (HEADERS du modèle), une fois mis « à plat » : sans accent, en minuscules. */
const ENTETES = {
  occurred_at: ["date", "date heure", "date et heure", "horodatage", "occurred at", "timestamp"],
  time: ["heure", "heure de l evenement", "heure locale", "time"],
  vehicle: ["vehicule", "ensemble", "immatriculation", "code vehicule", "vehicle", "plaque"],
  driver: ["chauffeur", "conducteur", "driver"],
  violation_type: ["type", "type de violation", "violation", "infraction", "evenement", "alerte"],
  source: ["source", "systeme", "fournisseur", "boitier"],
  value: ["valeur", "vitesse", "vitesse relevee", "value"],
  limit_value: ["seuil", "limite", "vitesse autorisee", "limit"],
  duration_minutes: ["duree", "duree min", "duree minutes", "duree (min)"],
  location: ["lieu", "position", "localisation", "location", "adresse"],
  external_id: ["identifiant", "id", "reference", "external id", "numero"],
};
/** Mots d'un type (TYPE_WORDS du modèle), le plus long d'abord : « temps de conduite » avant « conduite de nuit ». */
const MOTS_TYPES = Object.entries({
  speeding: ["exces de vitesse", "survitesse", "vitesse", "speeding", "overspeed"],
  harsh_braking: ["freinage brusque", "freinage", "harsh braking", "harsh brake"],
  night_driving: ["conduite de nuit", "nuit", "night driving", "night"],
  driving_time: ["temps de conduite", "temps de conduite depasse", "conduite continue", "driving time", "fatigue"],
})
  .flatMap(([code, mots]) => mots.map((mot) => [mot, code]))
  .sort((a, b) => b[0].length - a[0].length);

/* ─── Lecture d'une cellule (fonctions du modèle) ───────────────────────── */

/** Texte « à plat » (plain du modèle) : sans accent, en minuscules, ponctuation réduite à des espaces. */
function plat(valeur) {
  const texte = String(valeur || "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  return texte.replace(/[^a-z0-9()]+/g, " ").trim().replace(/ +/g, " ");
}
/** Code ou immatriculation sans séparateur (compact du modèle) : « RC 4521 A » et « rc4521a » se valent. */
const compact = (valeur) => plat(valeur).replace(/[^a-z0-9]/g, "");

/** Date et heure lue dans une cellule de classeur (le datetime d'openpyxl), sans fuseau. */
class Horodatage {
  constructor(iso) {
    this.iso = iso;
  }
  toString() {
    return this.iso.replace("T", " ");
  }
}

const deux = (n) => String(n).padStart(2, "0");
/** Horodatage naïf « AAAA-MM-JJTHH:MM:SS » de composantes, nul si elles ne forment pas une date réelle. */
function composer(a, mo, j, h = 0, mi = 0, s = 0) {
  const t = Date.UTC(a, mo - 1, j, h, mi, s);
  const d = new Date(t);
  if (Number.isNaN(t) || d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j || h > 23 || mi > 59 || s > 59) return null;
  return d.toISOString().slice(0, 19);
}

/**
 * Horodatage d'une cellule (parse_datetime du modèle) : date et heure du classeur, ou texte ISO 8601
 * (décalage ramené en UTC, l'heure de Conakry), jj/mm/aaaa hh:mm[:ss], jj-mm-aaaa hh:mm[:ss],
 * aaaa-mm-jj hh:mm[:ss]. Lève une Error au message du noyau.
 */
function lireMoment(valeur) {
  if (valeur instanceof Horodatage) return valeur.iso;
  const texte = String(valeur ?? "").trim();
  if (!texte) throw new Error("date absente");
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(texte);
  if (iso) {
    const naif = composer(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0));
    if (naif) {
      if (!iso[7] || iso[7] === "Z") return naif;
      const signe = iso[7][0] === "-" ? -1 : 1;
      const [hh, mm = "0"] = iso[7].slice(1).replace(":", "").match(/^(\d{2})(\d{2})?$/).slice(1);
      return new Date(Date.parse(`${naif}Z`) - signe * (+hh * 60 + +mm) * 60000).toISOString().slice(0, 19);
    }
  }
  const formats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
    /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
  ];
  for (const f of formats) {
    const m = f.exec(texte);
    const naif = m && composer(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    if (naif) return naif;
  }
  const inverse = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(texte);
  const naif = inverse && composer(+inverse[1], +inverse[2], +inverse[3], +inverse[4], +inverse[5], +(inverse[6] ?? 0));
  if (naif) return naif;
  throw new Error(`date illisible : ${texte}`);
}

/**
 * Heure d'une cellule (parse_time du modèle) : heure du classeur (son heure), fraction de jour, ou texte
 * hh:mm[:ss] (« 8h30 » accepté). Rend « HH:MM:SS » ; lève une Error au message du noyau.
 */
function lireHeure(valeur) {
  if (valeur instanceof Horodatage) return valeur.iso.slice(11, 19);
  if (typeof valeur === "number" && valeur >= 0 && valeur < 1) {
    const s = Math.min(Math.round(valeur * 86400), 86399);
    return `${deux(Math.floor(s / 3600))}:${deux(Math.floor((s % 3600) / 60))}:${deux(s % 60)}`;
  }
  const texte = String(valeur ?? "").trim().toLowerCase().replace(/ /g, "").replace(/h/g, ":").replace(/:+$/, "");
  if (!texte) throw new Error("heure absente");
  const m = /^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(texte);
  if (m && +m[1] <= 23 && +(m[2] ?? 0) <= 59 && +(m[3] ?? 0) <= 59) return `${deux(+m[1])}:${deux(+(m[2] ?? 0))}:${deux(+(m[3] ?? 0))}`;
  throw new Error(`heure illisible : ${valeur}`);
}

/** Nombre d'une cellule (parse_number du modèle) : virgule ou point, espaces et unités ignorés ; nul s'il manque. */
function lireNombre(valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  if (typeof valeur === "number") return valeur;
  const nettoye = String(valeur).replace(/[\s  ]/g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  if (["", "-", "."].includes(nettoye)) return null;
  const n = Number(nettoye);
  if (!Number.isFinite(n)) throw new Error("nombre illisible");
  return n;
}

/** Type d'une cellule (violation_type du modèle) : code, libellé ou mot reconnu ; nul sinon. */
function lireType(valeur) {
  const texte = plat(valeur);
  if (Object.hasOwn(TYPES, texte)) return texte;
  if (Object.hasOwn(TYPES, texte.replace(/ /g, "_"))) return texte.replace(/ /g, "_");
  for (const [mot, code] of MOTS_TYPES) if (texte === mot || ` ${texte} `.includes(` ${mot} `)) return code;
  return null;
}

/** Texte d'une cellule comme `str()` du noyau : un nombre entier sans décimale, un horodatage lisible. */
const texteCellule = (valeur) => (valeur === null || valeur === undefined ? "" : valeur instanceof Horodatage ? valeur.toString() : String(valeur));

/* ─── Lecture du fichier (read_rows du contrôleur) ──────────────────────── */

/** Lignes d'un texte CSV, comme csv.reader : champs entre guillemets, guillemets doublés, ligne vide rendue vide. */
function lireCsv(texte, separateur) {
  const lignes = [];
  let ligne = [];
  let champ = "";
  let entre = false;
  let quote = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entre) {
      if (c !== '"') champ += c;
      else if (texte[i + 1] === '"') {
        champ += '"';
        i++;
      } else entre = false;
      continue;
    }
    if (c === '"' && champ === "" && !quote) {
      entre = true;
      quote = true;
    } else if (c === separateur) {
      ligne.push(champ);
      champ = "";
      quote = false;
    } else if (c === "\r" || c === "\n") {
      ligne.push(champ);
      lignes.push(ligne.length === 1 && ligne[0] === "" && !quote ? [] : ligne);
      ligne = [];
      champ = "";
      quote = false;
      if (c === "\r" && texte[i + 1] === "\n") i++;
    } else champ += c;
  }
  if (champ !== "" || ligne.length || quote) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes;
}

/** Séparateur d'un CSV : le plus fréquent de la première ligne remplie, parmi « ; », « , » et la tabulation. */
function separateurDe(echantillon) {
  if (!echantillon.trim()) return ",";
  const premiere = echantillon.split(/\r?\n|\r/).find((l) => l.trim()) ?? echantillon;
  const compte = (texte, s) => texte.split(s).length - 1;
  const meilleur = [";", ",", "\t"].reduce((a, b) => (compte(premiere, b) > compte(premiere, a) ? b : a));
  return compte(premiere, meilleur) ? meilleur : [";", ",", "\t"].reduce((a, b) => (compte(echantillon, b) > compte(echantillon, a) ? b : a));
}

const illisible = (ApiError) => new ApiError(422, "business_rule", "Classeur illisible : enregistrez-le au format XLSX ou CSV.");

/** Fichiers d'une archive zip (répertoire central), lus à la demande et décompressés sous une borne. */
function archiveZip(buf, ApiError) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw illisible(ApiError);
  const entrees = new Map();
  let pos = buf.readUInt32LE(fin + 16);
  for (let n = buf.readUInt16LE(fin + 10); n > 0; n--) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw illisible(ApiError);
    const longueurNom = buf.readUInt16LE(pos + 28);
    const nom = buf.toString("utf8", pos + 46, pos + 46 + longueurNom);
    entrees.set(nom, { methode: buf.readUInt16LE(pos + 10), compresse: buf.readUInt32LE(pos + 20), taille: buf.readUInt32LE(pos + 24), local: buf.readUInt32LE(pos + 42) });
    pos += 46 + longueurNom + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  const total = [...entrees.values()].reduce((s, e) => s + e.taille, 0);
  if (total > MAX_DECOMPRESSE) throw new ApiError(422, "business_rule", "Classeur trop volumineux : scindez-le ou enregistrez-le au format CSV.");
  return {
    noms: [...entrees.keys()],
    lire(nom) {
      const e = entrees.get(nom);
      if (!e) return null;
      const debut = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const brut = buf.subarray(debut, debut + e.compresse);
      try {
        return (e.methode === 8 ? inflateRawSync(brut, { maxOutputLength: MAX_DECOMPRESSE }) : brut).toString("utf8");
      } catch {
        throw illisible(ApiError);
      }
    },
  };
}

const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const xml = (texte) => texte.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITES[e.toLowerCase()]));
const attributs = (texte) => Object.fromEntries([...texte.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], xml(m[2])]));
/** Textes d'un élément de chaînes partagées ou d'une chaîne en ligne, sans la phonétique (rPh). */
const textes = (bloc) => [...bloc.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xml(m[1])).join("");

/**
 * Lignes de la première feuille d'un classeur .xlsx (workbook_rows du noyau, valeurs seules) : texte,
 * nombre, booléen, ou Horodatage pour une cellule au format de date ; lignes absentes rendues vides pour
 * garder leur numéro.
 */
function lignesClasseur(buf, ApiError) {
  const zip = archiveZip(buf, ApiError);
  const classeur = zip.lire("xl/workbook.xml");
  if (!classeur) throw illisible(ApiError);
  const feuille = /<sheet\b([^>]*)\/?>/.exec(classeur);
  const lien = feuille ? attributs(feuille[1])["r:id"] : null;
  const liens = zip.lire("xl/_rels/workbook.xml.rels") ?? "";
  const cible = [...liens.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => attributs(m[1])).find((a) => a.Id === lien)?.Target ?? "worksheets/sheet1.xml";
  const donnees = zip.lire(cible.startsWith("/") ? cible.slice(1) : `xl/${cible}`);
  if (donnees === null) throw illisible(ApiError);
  const partagees = [...(zip.lire("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textes(m[1]));
  // Formats de date : numéros réservés d'Excel, ou format propre qui écrit un jour, un mois ou une heure.
  const styles = zip.lire("xl/styles.xml") ?? "";
  const propres = new Map([...styles.matchAll(/<numFmt\b([^>]*)\/?>/g)].map((m) => attributs(m[1])).map((a) => [Number(a.numFmtId), a.formatCode ?? ""]));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const dates = [...xfs.matchAll(/<xf\b([^>]*)\/?>/g)].map((m) => {
    const id = Number(attributs(m[1]).numFmtId ?? 0);
    const code = (propres.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
    return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (propres.has(id) && /[dmyhs]/i.test(code));
  });
  const colonne = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const lignes = [];
  for (const m of donnees.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (lignes.length >= MAX_ROWS) throw new ApiError(422, "business_rule", `Classeur trop long : ${MAX_ROWS} lignes au plus.`);
    const numero = Number(attributs(m[1]).r) || lignes.length + 1;
    while (lignes.length < numero - 1) lignes.push([]);
    const ligne = [];
    for (const c of (m[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attributs(c[1]);
      const contenu = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(contenu)?.[1];
      let valeur = null;
      if (a.t === "s") valeur = v === undefined ? null : (partagees[Number(v)] ?? null);
      else if (a.t === "inlineStr") valeur = textes(contenu);
      else if (a.t === "str" || a.t === "e") valeur = v === undefined ? null : xml(v);
      else if (a.t === "b") valeur = v === "1";
      else if (a.t === "d") valeur = v ? new Horodatage(xml(v).slice(0, 19)) : null;
      else if (v !== undefined) {
        const n = Number(v);
        valeur = dates[Number(a.s ?? 0)] ? new Horodatage(new Date(Math.round((Date.UTC(1899, 11, 30) + n * 86400000) / 1000) * 1000).toISOString().slice(0, 19)) : n;
      }
      const i = a.r ? colonne(a.r) : ligne.length;
      while (ligne.length < i) ligne.push(null);
      ligne[i] = valeur;
    }
    lignes.push(ligne);
  }
  return lignes;
}

/** Format reconnu au contenu (detect_type de eguitra_api/files.py) : XLSX, autre format accepté ailleurs, ou rien. */
function formatDe(data) {
  if (data.subarray(0, 1024).includes("%PDF-")) return "pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (data.includes("vbaProject.bin")) return null;
    if (data.includes("word/document.xml")) return "docx";
    if (data.includes("xl/workbook.xml")) return "xlsx";
  }
  return null;
}

/* ─── Générateur déterministe des données (mulberry32) ──────────────────── */

function alea(graine) {
  let a = [...graine].reduce((h, c) => Math.imul(h ^ c.codePointAt(0), 16777619), 2166136261) >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (liste) => liste[Math.floor(next() * liste.length)],
    weighted: (paires) => {
      let x = next() * paires.reduce((s, [, w]) => s + w, 0);
      for (const [valeur, w] of paires) {
        x -= w;
        if (x < 0) return valeur;
      }
      return paires[paires.length - 1][0];
    },
  };
}

const jourPlus = (jour, n) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const zulu = (naif) => (naif ? `${String(naif).slice(0, 19)}Z` : null);

/** Lieux des itinéraires de Transport (route_id) et de la mine, avec la vitesse permise aux poids lourds. */
const LIEUX = {
  1: [["RN1, descente de Kouria", 70], ["RN1, traversée de Coyah", 50], ["RN1, sortie de Kindia", 70]],
  2: [["RN1, traversée de Coyah", 50], ["Route de Fria, Tondon", 70], ["Route de Fria, pont du Konkouré", 70]],
  3: [["RN1, col de Kindia", 70], ["RN1, Linsan", 70], ["RN1, entrée de Mamou", 50]],
  4: [["RN3, traversée de Dubréka", 50], ["RN3, carrefour de Boffa", 70], ["RN3, Kolaboui", 70]],
  5: [["RN3, Kolaboui", 70], ["Route de Kamsar, carrefour de Sangarédi", 70], ["RN3, traversée de Dubréka", 50]],
  6: [["RN1, traversée de Mamou", 50], ["RN5, Pita", 70], ["RN5, entrée de Labé", 50]],
  7: [["RN1, Dabola", 70], ["RN6, Kouroussa", 70], ["RN6, pont du Niandan", 70]],
  8: [["RN6, Kouroussa", 70], ["RN30, carrefour de Mandiana", 70], ["Route de Siguiri, Doko", 70]],
  9: [["Autoroute Fidel Castro, Kaloum", 50], ["Route du Niger, Gbessia", 50]],
};
const LIEUX_MINE = [["Piste minière, fosse 3 de Boffa", 40], ["Corridor Boffa - Dapilon, km 18", 40], ["Port de Dapilon, rampe d'accès", 30]];
const LIEUX_PARC = [["Route du Niger, Matoto", 50], ["Autoroute Fidel Castro, Kaloum", 50]];

/** Enregistre les routes du module et sème ses tables ; appelé une fois par serveur.mjs, après seed(). */
export function enregistrerTelematique(H) {
  const { route, ApiError, DB, TODAY, COMPANIES, hsVehicle, hsVehicleRef, hsVehicleSite, hsSiteRef, hsDriver, hsRotation, hsRotationRef, hsUser, hsFull, hsSites, hsPersonalHidden, hsForbidden, hsBad, hsMissing, hsRule, hsLog, hsNow, hsPage, hsSort, hsList } = H;
  const HS = DB.hsseq;
  HS.telematicsImports = [];
  HS.violations = [];
  Object.assign(HS.seq, { violation: 0, telematics_import: 0 });

  /* ─── Référentiels de la mise en correspondance ───────────────────────── */

  /** Ensembles des sociétés du compte, actifs ou non (with_context(active_test=False) du noyau). */
  const ensembles = (societes) => [...DB.vehicles, ...HS.tippers].filter((v) => societes.includes(v.company_id ?? 1));
  const chauffeurs = (societes) => [...DB.drivers, ...HS.drivers].filter((d) => societes.includes(d.company_id ?? 1));
  /** Rotation partie du véhicule en cours au moment donné (_rotation_at) : chargée ce jour-là ou avant, pas encore revenue. */
  function rotationAu(vehiculeId, moment) {
    const jour = moment.slice(0, 10);
    return [...DB.rotations.filter((r) => r.company_id === 1), ...HS.rotations]
      .filter((r) => r.vehicle_id === vehiculeId && PARTIES.includes(r.state) && r.date_loading <= jour && (r.date_return ? r.date_return >= jour : !r.date_delivery || r.date_delivery >= jour))
      .sort((a, b) => b.date_loading.localeCompare(a.date_loading) || b.id - a.id)[0] ?? null;
  }
  /** Violation enregistrée : le site est celui de l'ensemble, relu à chaque lecture (champ lié du noyau). */
  function nouvelle(valeurs) {
    const v = { id: ++HS.seq.violation, ...valeurs };
    Object.defineProperty(v, "site_id", { enumerable: true, get: () => (hsVehicle(v.vehicle_id) ? hsVehicleSite(hsVehicle(v.vehicle_id)) : null) });
    HS.violations.push(v);
    return v;
  }

  /**
   * Lignes d'un fichier (en-tête en première ligne) : valeurs à créer, erreurs [{ line, message }],
   * avertissements et doublons (_parse du modèle), mêmes messages que le noyau.
   */
  function analyser(lignes, societes, sourceDefaut) {
    if (!lignes.length) return { valeurs: [], erreurs: [{ line: 1, message: "Fichier vide." }], avertissements: [], doublons: 0 };
    const index = {};
    lignes[0].forEach((entete, i) => {
      const cle = plat(entete);
      for (const [champ, alias] of Object.entries(ENTETES)) if (alias.includes(cle) && !(champ in index)) index[champ] = i;
    });
    if (["occurred_at", "vehicle", "violation_type"].some((k) => !(k in index))) {
      return { valeurs: [], erreurs: [{ line: 1, message: "Colonnes attendues : date, véhicule, type (puis chauffeur, source, valeur, seuil, durée, lieu, identifiant)." }], avertissements: [], doublons: 0 };
    }
    if (!("source" in index) && !String(sourceDefaut ?? "").trim()) {
      return { valeurs: [], erreurs: [{ line: 1, message: "Source manquante : une colonne « source » ou le champ source du formulaire (OBC, GPS, IVMS…)." }], avertissements: [], doublons: 0 };
    }
    const vehicules = new Map();
    for (const v of ensembles(societes)) for (const libelle of [v.name, v.tractor_plate, v.trailer_plate]) if (compact(libelle) && !vehicules.has(compact(libelle))) vehicules.set(compact(libelle), v);
    const conducteurs = new Map();
    for (const d of chauffeurs(societes)) if (!conducteurs.has(`${d.company_id ?? 1}|${plat(d.name)}`)) conducteurs.set(`${d.company_id ?? 1}|${plat(d.name)}`, d);
    const cellule = (ligne, cle) => (cle in index && index[cle] < ligne.length ? ligne[index[cle]] : null);
    const limite = Date.parse(`${hsNow()}`) + 5 * 60000;
    const valeurs = [];
    const erreurs = [];
    const avertissements = [];
    const vus = new Set();
    let doublons = 0;
    lignes.slice(1).forEach((ligne, i) => {
      const numero = i + 2;
      if (!ligne.some((c) => c !== null && c !== undefined && c !== "")) return;
      let moment;
      try {
        moment = lireMoment(cellule(ligne, "occurred_at"));
        // Colonne « Heure » à part : elle complète la date.
        const heure = cellule(ligne, "time");
        if ("time" in index && heure !== null && heure !== undefined && heure !== "") moment = `${moment.slice(0, 10)}T${lireHeure(heure)}`;
      } catch (e) {
        erreurs.push({ line: numero, message: `Date ou heure : ${e.message}.` });
        return;
      }
      if (Date.parse(`${moment}Z`) > limite) {
        erreurs.push({ line: numero, message: "Date dans le futur." });
        return;
      }
      const vehicule = vehicules.get(compact(cellule(ligne, "vehicle")));
      if (!vehicule) {
        erreurs.push({ line: numero, message: `Véhicule inconnu : ${texteCellule(cellule(ligne, "vehicle")) || "(vide)"}.` });
        return;
      }
      const type = lireType(cellule(ligne, "violation_type"));
      if (!type) {
        erreurs.push({ line: numero, message: `Type inconnu : ${texteCellule(cellule(ligne, "violation_type")) || "(vide)"} (excès de vitesse, freinage brusque, conduite de nuit, temps de conduite).` });
        return;
      }
      let nombres;
      try {
        nombres = Object.fromEntries(["value", "limit_value", "duration_minutes"].map((k) => [k, lireNombre(cellule(ligne, k))]));
      } catch {
        erreurs.push({ line: numero, message: "Valeur, seuil ou durée : nombre illisible." });
        return;
      }
      const source = (texteCellule(cellule(ligne, "source")) || String(sourceDefaut ?? "")).trim().slice(0, 64);
      const externe = texteCellule(cellule(ligne, "external_id")).trim().slice(0, 128) || false;
      const cle = externe ? `ext|${source}|${externe}` : `ligne|${vehicule.id}|${type}|${moment}`;
      // Doublons cherchés dans la société de l'ensemble.
      const societe = vehicule.company_id ?? 1;
      const existe = externe
        ? HS.violations.some((x) => x.company_id === societe && x.external_id === externe && x.source === source)
        : HS.violations.some((x) => x.company_id === societe && x.vehicle_id === vehicule.id && x.violation_type === type && x.occurred_at === zulu(moment));
      if (vus.has(cle) || existe) {
        doublons += 1;
        return;
      }
      vus.add(cle);
      const rotation = rotationAu(vehicule.id, moment);
      let conducteur = null;
      const nom = texteCellule(cellule(ligne, "driver")).trim();
      if (nom) {
        conducteur = conducteurs.get(`${vehicule.company_id ?? 1}|${plat(nom)}`) ?? null;
        if (!conducteur) avertissements.push({ line: numero, message: `Chauffeur non reconnu : « ${nom} » ; celui de la rotation est retenu s'il y en a une.` });
      }
      const chauffeur = conducteur?.id ?? rotation?.driver_id ?? null;
      valeurs.push({
        company_id: vehicule.company_id ?? 1, occurred_at: zulu(moment), vehicle_id: vehicule.id, driver_id: chauffeur || false, rotation_id: rotation?.id || false,
        violation_type: type, source, value: nombres.value || 0, limit_value: nombres.limit_value || 0, duration_minutes: nombres.duration_minutes || 0,
        location: texteCellule(cellule(ligne, "location")).trim().slice(0, 200) || false, external_id: externe,
      });
    });
    return { valeurs, erreurs, avertissements, doublons };
  }

  /* ─── Lignes servies ──────────────────────────────────────────────────── */

  /** violation_row du contrôleur ; le nom du chauffeur n'est pas servi à l'auditeur (driver_ref). */
  function violationRow(ctx, v) {
    const d = v.driver_id ? hsDriver(v.driver_id) : null;
    const lot = v.import_id ? HS.telematicsImports.find((x) => x.id === v.import_id) : null;
    return {
      id: v.id, occurred_at: v.occurred_at, violation_type: v.violation_type, vehicle: hsVehicleRef(v.vehicle_id), site: hsSiteRef(v.site_id),
      driver: d ? { id: d.id, name: hsPersonalHidden(ctx) ? null : d.name } : null, rotation: hsRotationRef(hsRotation(v.rotation_id)),
      source: v.source, value: v.value || null, limit_value: v.limit_value || null, duration_minutes: v.duration_minutes || null,
      location: v.location || null, external_id: v.external_id || null, import: lot ? { id: lot.id, name: lot.name } : null,
    };
  }
  /** preview_row du contrôleur : violation à créer, au format de violation_row (id et import nuls). */
  function apercuRow(ctx, v) {
    const vehicule = hsVehicle(v.vehicle_id);
    return { ...violationRow(ctx, { ...v, site_id: vehicule ? hsVehicleSite(vehicule) : null, import_id: null }), id: null };
  }
  /** import_row du contrôleur. */
  const importRow = (b) => ({
    id: b.id, name: b.name, company: { id: b.company_id, name: COMPANIES[b.company_id]?.name ?? "" }, state: b.state ?? "done", source: b.source || null,
    imported_by: hsUser(b.imported_by), imported_at: b.imported_at, rows: b.row_count, created: b.created_count, duplicates: b.duplicate_count,
    warnings: b.warnings ?? [], errors: b.errors ?? [], error_count: b.error_count ?? 0,
  });

  /** Sociétés de travail (companies du contrôleur) : toutes celles du compte, ou celle du filtre company_id. */
  function societes(ctx, q) {
    const v = q.company_id;
    if (v === undefined || v === null || v === "" || v === "all") return ctx.user.companies;
    if (!/^\d+$/.test(String(v))) throw hsBad("Société invalide.");
    if (!ctx.user.companies.includes(Number(v))) throw hsForbidden("Société non autorisée.");
    return [Number(v)];
  }
  /** Identifiant d'un filtre (int_or_none du contrôleur) : nul s'il manque, 400 s'il n'est pas entier. */
  function entier(q, cle) {
    const v = q[cle];
    if (v === undefined || v === null || v === "" || v === "0") return null;
    if (!/^\d+$/.test(String(v))) throw hsBad(`Identifiant invalide : ${cle}.`, [cle]);
    return Number(v);
  }
  /** Date d'un filtre (date_value du contrôleur) : « AAAA-MM-JJ », 400 sinon. */
  function jour(q, cle) {
    const v = q[cle];
    if (v === undefined || v === null || v === "") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (!m || !composer(+m[1], +m[2], +m[3])) throw hsBad(`Date invalide : ${cle}.`, [cle]);
    return m[0];
  }

  /* ─── Routes ──────────────────────────────────────────────────────────── */

  route("POST", "/hsseq/telematics/import", ["hsseq"], (ctx) => {
    const envoi = ctx.multipart();
    const fichier = envoi.files.find((f) => f.field === "file");
    if (!fichier || !fichier.filename) throw hsMissing("Fichier manquant.", ["file"]);
    const source = String(envoi.fields.source ?? "").trim().slice(0, 64);
    const aBlanc = ["1", "true"].includes(String(envoi.fields.dry_run ?? "").toLowerCase());
    const data = fichier.data;
    if (data.length > MAX_IMPORT) throw new ApiError(413, "too_large", "Fichier trop volumineux (5 Mo au plus).");
    const format = formatDe(data);
    let lignes;
    if (format === "xlsx") {
      try {
        lignes = lignesClasseur(data, ApiError);
      } catch (e) {
        // Archive tronquée ou mal formée : le message du noyau pour un classeur corrompu.
        if (e instanceof ApiError) throw e;
        throw illisible(ApiError);
      }
    } else if (format !== null || data.subarray(0, 2).toString("latin1") === "PK" || data.includes(0)) {
      throw new ApiError(415, "unsupported_type", "Formats acceptés : CSV ou Excel (.xlsx), sans macro.");
    } else {
      let texte;
      try {
        texte = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        texte = data.toString("latin1");
      }
      lignes = lireCsv(texte, separateurDe(texte.slice(0, 4096)));
      if (lignes.length > MAX_ROWS + 1) throw hsRule("business_rule", `Fichier trop long : ${MAX_ROWS} lignes au plus.`);
    }
    const { valeurs, erreurs, avertissements, doublons } = analyser(lignes, ctx.user.companies, source);
    const lues = lignes.slice(1).filter((l) => l.some((c) => c !== null && c !== undefined && c !== "")).length;
    if (erreurs.length) {
      const message = `Import refusé, aucune violation enregistrée : ${erreurs.length} ligne(s) en erreur.`;
      if (aBlanc) throw hsRule("import_rejected", message, { errors: erreurs.slice(0, MAX_REPORTED) });
      // Trace de l'import refusé : import « rejected » avec ses erreurs, rien d'autre n'est écrit.
      const refuse = {
        id: ++HS.seq.telematics_import, name: String(fichier.filename).slice(0, 200), company_id: ctx.company, state: "rejected", source: source || false,
        imported_by: ctx.user.id, imported_at: hsNow(), row_count: lues, created_count: 0, duplicate_count: 0, warnings: avertissements.slice(0, MAX_REPORTED),
        errors: erreurs.slice(0, MAX_REPORTED), error_count: erreurs.length,
      };
      HS.telematicsImports.push(refuse);
      hsLog("telematics_import", refuse.id, ctx.user.id, "rejected", null, null, null, refuse.imported_at, `${erreurs.length} ligne(s) en erreur`);
      throw hsRule("import_rejected", message, { errors: erreurs.slice(0, MAX_REPORTED), import_id: refuse.id });
    }
    if (aBlanc) {
      return { dry_run: true, rows: lues, to_create: valeurs.length, duplicates: doublons, warnings: avertissements.slice(0, MAX_REPORTED), preview: valeurs.slice(0, 50).map((v) => apercuRow(ctx, v)) };
    }
    const maintenant = hsNow();
    const lot = {
      id: ++HS.seq.telematics_import, name: String(fichier.filename).slice(0, 200), company_id: ctx.company, state: "done", source: source || false, imported_by: ctx.user.id,
      imported_at: maintenant, row_count: lues, created_count: valeurs.length, duplicate_count: doublons, warnings: avertissements.slice(0, MAX_REPORTED), errors: [], error_count: 0,
    };
    HS.telematicsImports.push(lot);
    for (const v of valeurs) nouvelle({ ...v, driver_id: v.driver_id || null, rotation_id: v.rotation_id || null, location: v.location || null, external_id: v.external_id || null, import_id: lot.id });
    hsLog("telematics_import", lot.id, ctx.user.id, "import", null, null, null, maintenant, `${valeurs.length} violation(s), ${doublons} doublon(s)`);
    return { ...importRow(lot), dry_run: false };
  });

  route("GET", "/hsseq/telematics/imports", LECTURE_IMPORTS, (ctx) => {
    const q = ctx.query;
    const ids = societes(ctx, q);
    const etats = hsList(q.state);
    const liste = hsSort(HS.telematicsImports.filter((b) => ids.includes(b.company_id) && (!etats || etats.includes(b.state ?? "done"))), q.sort, { imported_at: (b) => b.imported_at }, "-imported_at");
    return hsPage(ctx, liste, {}, importRow);
  });

  route("GET", "/hsseq/telematics/violations", LECTURE_VIOLATIONS, (ctx) => {
    const q = ctx.query;
    const ids = societes(ctx, q);
    // Portée fermée par défaut : hors lecture complète, les véhicules des sites du compte (aucun sans site).
    const sites = hsFull(ctx) ? null : hsSites(ctx);
    const types = hsList(q.violation_type);
    const filtres = Object.fromEntries(["vehicle_id", "site_id", "import_id", "rotation_id", "driver_id"].map((k) => [k, entier(q, k)]));
    const du = jour(q, "date_from");
    const au = jour(q, "date_to");
    const base = HS.violations.filter(
      (v) =>
        ids.includes(v.company_id) &&
        (!sites || (v.site_id !== null && sites.includes(v.site_id))) &&
        Object.entries(filtres).every(([k, id]) => id === null || v[k] === id) &&
        (!du || v.occurred_at.slice(0, 10) >= du) &&
        (!au || v.occurred_at.slice(0, 10) <= au),
    );
    const selection = base.filter((v) => !types || types.includes(v.violation_type));
    // Voyages (rotations parties) de la période et des mêmes filtres (trip_domain du contrôleur) : la
    // période choisie, sinon le mois en cours à ce jour ; l'ensemble donne le site (portée et filtre).
    const debut = du ?? `${TODAY.slice(0, 7)}-01`;
    const fin = au ?? TODAY;
    const voyages = [...DB.rotations.filter((r) => r.company_id === 1), ...HS.rotations].filter((r) => {
      const v = hsVehicle(r.vehicle_id);
      const siteV = v ? hsVehicleSite(v) : null;
      return ids.includes(r.company_id ?? 1) && PARTIES.includes(r.state) && r.date_loading >= debut && r.date_loading <= fin
        && (!sites || (siteV !== null && sites.includes(siteV))) && (filtres.site_id === null || siteV === filtres.site_id)
        && (filtres.vehicle_id === null || r.vehicle_id === filtres.vehicle_id) && (filtres.driver_id === null || r.driver_id === filtres.driver_id);
    }).length;
    const dansPeriode = selection.filter((v) => v.occurred_at.slice(0, 10) >= debut && v.occurred_at.slice(0, 10) <= fin).length;
    // Comptes par type sur la sélection filtrée, filtre de type compris ; rapport aux voyages de la période.
    const counts = {
      by_type: Object.fromEntries(CODES.map((c) => [c, selection.filter((v) => v.violation_type === c).length])),
      period: { date_from: debut, date_to: fin }, departures: voyages, violations_in_period: dansPeriode,
      per_100_trips: voyages ? Math.round((dansPeriode * 10000) / voyages) / 100 : null,
    };
    const liste = hsSort(selection, q.sort, { occurred_at: (v) => v.occurred_at, violation_type: (v) => v.violation_type }, "-occurred_at");
    return hsPage(ctx, liste, counts, (v) => violationRow(ctx, v));
  });

  /* ─── Données : trois mois et demi d'imports hebdomadaires ────────────── */

  try {
    semer();
  } catch (e) {
    // La maquette démarre même si les données de démonstration n'ont pas pu être semées.
    console.error("Télématique : données de démonstration non semées.", e);
  }

  /**
   * Exports hebdomadaires du fournisseur, importés le lundi par le Responsable HSSEQ : boîtiers IVMS des
   * citernes depuis le 1er juillet, ordinateurs de bord (OBC) des bennes de Boffa depuis le 1er septembre.
   * Violations en recul après l'accompagnement des conducteurs (≈ 15 pour 100 voyages en juillet, ≈ 9 en
   * septembre, ≈ 6 en octobre au cockpit), quelques doublons d'un export à l'autre, un fichier importé deux fois, des conducteurs
   * écrits autrement que dans Transport (avertissements) et deux violations hors rotation.
   */
  function semer() {
    const r = alea("hsseq-telematique");
    const fanta = 16;
    const mariama = 2;
    // Conducteurs les plus souvent en cause (accompagnement en cours).
    const poids = { "ER-05": 5, "ER-13": 4, "ER-09": 3, "ER-16": 2 };
    const rotationsCiterne = DB.rotations.filter((x) => x.company_id === 1 && PARTIES.includes(x.state));
    const typeAuHasard = (benne) => r.weighted(benne ? [["speeding", 55], ["harsh_braking", 45]] : [["speeding", 48], ["harsh_braking", 20], ["night_driving", 20], ["driving_time", 12]]);
    const heure = (type) => {
      if (type === "night_driving") return r.weighted([[r.int(19, 23), 3], [r.int(0, 4), 2]]);
      if (type === "driving_time") return r.int(15, 20);
      return r.int(6, 18);
    };
    /**
     * Violation tirée d'un ensemble au jour donné, rattachée à sa rotation (nulle : trajet à vide).
     * `fichier.abrege` : conducteur écrit autrement dans l'export ; `fichier.sansConducteur` : colonne vide.
     */
    function violation(vehicule, jourV, rotation, type, lieux, fichier) {
      const [lieu, permise] = r.pick(lieux);
      const moment = `${jourV}T${deux(heure(type))}:${deux(r.int(0, 59))}:${deux(r.int(0, 59))}`;
      const valeurs = { value: 0, limit_value: 0, duration_minutes: 0 };
      if (type === "speeding") Object.assign(valeurs, { value: permise + r.int(8, 27), limit_value: permise, duration_minutes: r.int(1, 6) });
      if (type === "harsh_braking") Object.assign(valeurs, { value: r.int(38, 64) / 100, limit_value: 0.35 });
      if (type === "night_driving") valeurs.duration_minutes = r.int(20, 150);
      if (type === "driving_time") {
        const heures = r.int(93, 114) / 10;
        Object.assign(valeurs, { value: heures, limit_value: 9, duration_minutes: Math.round((heures - 9) * 60) });
      }
      const chauffeur = rotation?.driver_id ?? (fichier.sansConducteur ? null : vehicule.driver_id);
      return { vehicule, moment, rotation, type, lieu, valeurs, chauffeur, abrege: fichier.abrege };
    }

    // Citernes : violations par mois, réparties sur les jours couverts par les exports.
    const plan = [
      ["2026-07-01", "2026-07-31", 16],
      ["2026-08-01", "2026-08-31", 12],
      ["2026-09-01", "2026-09-30", 6],
      ["2026-10-01", "2026-10-11", 1],
    ];
    const tirees = [];
    for (const [du, au, nombre] of plan) {
      for (let n = 0; n < nombre; n++) {
        for (let essai = 0; essai < 40; essai++) {
          const jourV = jourPlus(du, r.int(0, Math.round((Date.parse(au) - Date.parse(du)) / 86400000)));
          const enCours = rotationsCiterne.filter((x) => x.date_loading <= jourV && (x.date_delivery ?? x.date_loading) >= jourV);
          if (!enCours.length) continue;
          const rotation = r.weighted(enCours.map((x) => [x, poids[hsVehicle(x.vehicle_id)?.name] ?? 1]));
          const vehicule = hsVehicle(rotation.vehicle_id);
          tirees.push(violation(vehicule, jourV, rotation, typeAuHasard(false), LIEUX[rotation.route_id] ?? LIEUX_PARC, { abrege: r.next() < 0.12 }));
          break;
        }
      }
    }
    // Deux violations hors rotation, un jour de retour à vide : ER-12 la nuit (conducteur absent de
    // l'export), ER-02 en ville (conducteur écrit dans l'export, reconnu).
    const aVide = (vehicule, du, au) => {
      for (let d = du; d <= au; d = jourPlus(d, 1)) if (!rotationAu(vehicule.id, `${d}T12:00:00`)) return d;
      return null;
    };
    for (const [id, du, au, type, fichier] of [[12, "2026-08-18", "2026-08-30", "night_driving", { sansConducteur: true }], [2, "2026-09-20", "2026-09-30", "speeding", {}]]) {
      const vehicule = hsVehicle(id);
      const jourV = vehicule && aVide(vehicule, du, au);
      if (jourV) tirees.push(violation(vehicule, jourV, null, type, LIEUX_PARC, fichier));
    }
    // Bennes de Boffa : postes de la mine depuis le 1er septembre.
    for (const jourV of ["2026-09-09", "2026-09-24", "2026-10-07"]) {
      const benne = r.weighted(HS.tippers.map((v, i) => [v, i === 3 ? 3 : 1]));
      const poste = HS.rotations.find((x) => x.vehicle_id === benne.id && x.date_loading === jourV) ?? null;
      tirees.push(violation(benne, jourV, poste, typeAuHasard(true), LIEUX_MINE, { abrege: benne.name === "EB-04" }));
    }
    tirees.sort((a, b) => a.moment.localeCompare(b.moment));

    // Exports hebdomadaires : le lundi, la semaine écoulée (la première, du 1er au 5 juillet).
    const exports = [];
    for (let k = 0; k <= 14; k++) {
      const lundi = jourPlus("2026-07-06", 7 * k);
      exports.push({ source: "IVMS", lundi, du: k === 0 ? "2026-07-01" : jourPlus(lundi, -7), au: jourPlus(lundi, -1), benne: false, k });
      if (lundi >= "2026-09-07") exports.push({ source: "OBC", lundi, du: lundi === "2026-09-07" ? "2026-09-01" : jourPlus(lundi, -7), au: jourPlus(lundi, -1), benne: true, k });
    }
    const precedentes = [];
    for (const e of exports) {
      const lot = tirees.filter((t) => (hsVehicleSite(t.vehicule) === 2) === e.benne && t.moment.slice(0, 10) >= e.du && t.moment.slice(0, 10) <= e.au);
      // Lignes reprises de l'export précédent : le fournisseur exporte à cheval sur deux semaines.
      const reprises = e.benne || e.k % 4 !== 3 ? [] : precedentes.filter((t) => !t.benne).slice(-r.int(1, 2));
      const nom = e.benne ? `OBC_Boffa_${e.du}_${e.au}.xlsx` : `IVMS_export_${e.du}_${e.au}.csv`;
      const importe = `${e.lundi}T${e.benne ? "09" : "08"}:${deux(r.int(5, 55))}:00`;
      // Conducteur écrit autrement que dans Transport (« F. Sylla ») : non reconnu, celui de la rotation est retenu.
      const abrege = (id) => {
        const [prenom = "", ...reste] = String(hsDriver(id)?.name ?? "").split(" ");
        return reste.length ? `${prenom.charAt(0)}. ${reste.join(" ")}` : prenom || "Chauffeur";
      };
      const avertissements = lot.flatMap((t, i) => (t.abrege && t.rotation ? [{ line: reprises.length + i + 2, message: `Chauffeur non reconnu : « ${abrege(t.chauffeur)} » ; celui de la rotation est retenu s'il y en a une.` }] : []));
      const crees = lot;
      const lignes = reprises.length + lot.length;
      // Un export refusé une fois (heure à 25 h, ensemble mal écrit), tracé, puis corrigé et importé dans l'heure.
      if (e.k === 9 && !e.benne && lignes >= 2) {
        const erreurs = [{ line: 2, message: "Date ou heure : heure illisible : 25:10." }, { line: lignes + 1, message: "Véhicule inconnu : ER 5O." }];
        const refuse = {
          id: ++HS.seq.telematics_import, name: nom, company_id: 1, state: "rejected", source: e.source, imported_by: fanta, imported_at: `${e.lundi}T07:42:00Z`,
          row_count: lignes, created_count: 0, duplicate_count: 0, warnings: [], errors: erreurs, error_count: erreurs.length,
        };
        HS.telematicsImports.push(refuse);
        hsLog("telematics_import", refuse.id, fanta, "rejected", null, null, null, refuse.imported_at, `${erreurs.length} ligne(s) en erreur`);
      }
      const b = {
        id: ++HS.seq.telematics_import, name: nom, company_id: 1, state: "done", source: e.source, imported_by: e.k === 6 ? mariama : fanta, imported_at: zulu(importe),
        row_count: lignes, created_count: crees.length, duplicate_count: reprises.length, warnings: avertissements, errors: [], error_count: 0,
      };
      HS.telematicsImports.push(b);
      hsLog("telematics_import", b.id, b.imported_by, "import", null, null, null, b.imported_at, `${crees.length} violation(s), ${reprises.length} doublon(s)`);
      for (const t of crees) {
        const plaque = e.benne ? `OBC-${t.vehicule.name}-${deux(HS.seq.violation + 101)}` : `IV-${t.moment.slice(0, 10).replace(/-/g, "")}-${String(4100 + HS.seq.violation * 7).padStart(5, "0")}`;
        nouvelle({
          company_id: 1, occurred_at: zulu(t.moment), vehicle_id: t.vehicule.id, driver_id: t.chauffeur, rotation_id: t.rotation?.id ?? null, violation_type: t.type, source: e.source,
          ...t.valeurs, location: t.lieu, external_id: plaque, import_id: b.id,
        });
        precedentes.push({ ...t, benne: e.benne });
      }
      // Le même export importé une seconde fois l'après-midi : tout est reconnu comme doublon.
      if (e.k === 4 && !e.benne) {
        const encore = { ...b, id: ++HS.seq.telematics_import, imported_by: mariama, imported_at: `${e.lundi}T15:20:00Z`, created_count: 0, duplicate_count: b.row_count, warnings: [] };
        HS.telematicsImports.push(encore);
        hsLog("telematics_import", encore.id, mariama, "import", null, null, null, encore.imported_at, `0 violation(s), ${encore.duplicate_count} doublon(s)`);
      }
    }
  }
}
