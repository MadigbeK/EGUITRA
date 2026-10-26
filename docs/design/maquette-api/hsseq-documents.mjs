/**
 * Maquette du lot 3 HSSEQ : documents et urgences (eguitra_hsseq/controllers/documents.py, models/documents.py).
 * Routes et données fictives ; `H` porte les références de serveur.mjs (HS_REFS).
 *
 * Tables, aux noms de champs du noyau :
 * - DB.hsseq.procedures (eguitra.hsseq.procedure : company_id, code, title, domain, description, site_ids,
 *   audience_profiles, owner_id, status, current_version_id, archive_reason) ; DB.hsseq.procedureVersions
 *   (eguitra.hsseq.procedure.version : procedure_id, company_id, version, effective_date, change_summary,
 *   status, published_at, published_by, superseded_at, reminded_on) ;
 * - DB.hsseq.acknowledgements (eguitra.hsseq.acknowledgment : version_id ou bulletin_id, user_id,
 *   company_id, read_at, received_at, source) ;
 * - DB.hsseq.bulletins (eguitra.hsseq.bulletin : reference, company_id, kind, title, body, key_messages,
 *   event_id, audience_profiles, site_ids, status, published_at, published_by, reminded_on, archive_reason) ;
 * - DB.hsseq.emergencyPlans (eguitra.hsseq.emergency.plan : reference, company_id, site_id, scenario, title,
 *   response, resources, contact_ids, review_date, active) ; DB.hsseq.drills (eguitra.hsseq.drill :
 *   reference, plan_id, company_id, site_id, scenario, planned_date, performed_date, status,
 *   participants_count, participant_ids, duration_minutes, debrief, cancel_reason, reopen_reason) ;
 * - DB.hsseq.crisisContacts (eguitra.hsseq.crisis.contact : company_id, site_id, function, name,
 *   organization, phone, phone2, email, call_order, note, active).
 * Chaque procédure porte aussi deux lectures calculées, non énumérables, pour le cockpit de serveur.mjs
 * (ack_targets, ack_count) : comptes visés et accusés de sa version en vigueur.
 *
 * Droits du noyau : procédures et alertes lues par l'administration, la direction, hsseq et l'auditeur
 * (documents de ses sites, sans noms de lecteurs ni brouillons) ; plans, exercices et annuaire aussi par
 * le chef de parc, bornés aux sites du compte (un contact sans site vaut pour tous les sites) ; écriture :
 * hsseq. Tout compte interne lit les documents qui le visent, en accuse lecture et lit l'annuaire de crise
 * de ses sites (/hsseq/my/…). Public visé : profils et sites du document ; un compte de lecture complète se
 * rapporte à tous les sites, un chef de parc à ses sites, un conducteur au site de son ensemble, un auditeur
 * à son périmètre.
 *
 * Écarts assumés de la maquette, faute de pouvoir toucher serveur.mjs : la route commune des pièces jointes
 * pose le rôle « photo » sur les pièces d'une version, d'un plan ou d'un exercice (corrigé à la lecture en
 * « document » ou « evidence ») et répond 404 au retrait d'une pièce d'une version publiée (422 au noyau) ;
 * l'origine « drill » est ajoutée à HS_ORIGINS pour les actions nées d'un exercice, dont le site est repris
 * de l'exercice à la lecture de sa fiche. Une référence ou un numéro de version en double répond 422
 * business_rule, là où le noyau, sur sa contrainte SQL, répondrait 500.
 */

const DOC_READ = ["admin", "direction", "hsseq", "auditeur"];
const PLAN_READ = ["admin", "direction", "hsseq", "exploitation", "auditeur"];
const HSSEQ = ["hsseq"];
const LECTURE_COMPLETE = ["admin", "direction", "hsseq"];
const PUBLICS = ["conducteur", "exploitation", "hsseq", "direction", "rh", "admin"];
const DOMAINES = { safety: "Sécurité", health: "Santé", security: "Sûreté", environment: "Environnement", quality: "Qualité" };
const STATUTS_PROCEDURE = { draft: "En rédaction", published: "En vigueur", archived: "Archivée" };
const NATURES = { flash_alert: "Alerte flash", lesson: "Retour d'expérience" };
const STATUTS_ALERTE = { draft: "Brouillon", published: "Diffusé", archived: "Archivé" };
const SCENARIOS = { spill: "Déversement", fire: "Incendie", road_accident: "Accident de la route", intrusion: "Intrusion", medical: "Urgence médicale", explosion: "Explosion", other: "Autre scénario" };
const STATUTS_EXERCICE = { planned: "Planifié", done: "Réalisé", cancelled: "Annulé" };
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Immatriculation écrite d'un bloc ou avec des tirets (PLATE_SHAPE du noyau). */
const PLAQUE = /\b[A-Z]{1,3}-?\d{3,4}-?[A-Z]{1,3}\b/g;
const TEXTES_ALERTE = ["title", "body", "key_messages"];
/** Champs journalisés à chaque modification (_journal_fields des modèles). */
const SUIVIS = {
  procedure: ["code", "title", "domain", "description", "audience_profiles", "site_ids", "owner_id", "status", "current_version_id"],
  procedure_version: ["version", "effective_date", "change_summary", "status"],
  bulletin: ["kind", "title", "body", "key_messages", "event_id", "audience_profiles", "site_ids", "status"],
  emergency_plan: ["site_id", "scenario", "title", "response", "resources", "contact_ids", "review_date", "active"],
  drill: ["planned_date", "performed_date", "status", "participants_count", "duration_minutes", "debrief", "cancel_reason"],
  crisis_contact: ["site_id", "function", "name", "organization", "phone", "phone2", "email", "call_order", "active"],
};

const posee = (o, cle) => Object.hasOwn(o, cle);
const oui = (v) => ["1", "true"].includes(String(v ?? ""));
const fr = (date) => (date ? String(date).slice(0, 10).split("-").reverse().join("/") : "");

/** Texte comparable : sans accents, en minuscules, mots séparés par une espace (plain du noyau). */
function plain(valeur) {
  return String(valeur ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
/** Formes d'un nom à rechercher : complet, inversé, premier et dernier mots dans les deux ordres ; aucune pour un seul mot. */
function formes(nom) {
  const mots = plain(String(nom ?? "").replace(/\(.*?\)/g, " ")).split(" ").filter(Boolean);
  if (mots.length < 2) return [];
  return [mots.join(" "), [...mots].reverse().join(" "), `${mots[0]} ${mots.at(-1)}`, `${mots.at(-1)} ${mots[0]}`];
}
/** Suites d'un à quatre mots consécutifs, accolées (« rc 1234 a » donne « rc1234a »). */
function fenetres(mots) {
  const s = new Set();
  for (let i = 0; i < mots.length; i += 1) for (let n = 1; n <= 4 && i + n <= mots.length; n += 1) s.add(mots.slice(i, i + n).join(""));
  return s;
}
/** Lignes d'au plus `largeur` caractères, coupées entre les mots. */
function couper(texte, largeur = 88) {
  const lignes = [];
  for (const paragraphe of String(texte).split("\n")) {
    let ligne = "";
    for (const mot of paragraphe.split(" ")) {
      if (ligne && `${ligne} ${mot}`.length > largeur) {
        lignes.push(ligne);
        ligne = mot;
      } else ligne = ligne ? `${ligne} ${mot}` : mot;
    }
    lignes.push(ligne);
  }
  return lignes;
}
/** PDF d'une page, lisible par tout lecteur : titre et lignes en Helvetica (WinAnsi), pour les documents fictifs. */
function pdfFictif(titre, lignes) {
  const latin = (s) =>
    String(s)
      .replace(/[’‘]/g, "'")
      .replace(/œ/g, "oe")
      .replace(/[–—]/g, "-")
      .replace(/…/g, "...")
      .replace(/[^\x20-\xff]/g, "?")
      .replace(/[\\()]/g, (c) => `\\${c}`);
  const corps = [`BT /F1 15 Tf 56 782 Td (${latin(titre)}) Tj ET`, ...lignes.slice(0, 40).map((l, i) => `BT /F1 10.5 Tf 56 ${750 - i * 17} Td (${latin(l)}) Tj ET`)].join("\n");
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(corps, "latin1")} >>\nstream\n${corps}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** Enregistre les routes du module et sème ses tables ; appelé une fois par serveur.mjs, après seed(). */
export function enregistrerDocuments(H) {
  const {
    route, fileReply, xlsxBuffer, ApiError, DB, USERS, TODAY, COMPANIES, HS_PNG, HS_ATTACH_MODELS, HS_ORIGINS, HS_USER_SITES, HS_EMPLOYEES,
    hasProfile, hsIs, hsFull, hsSites, hsSite, hsSiteRef, hsUser, hsInternal, hsForbidden, hsRule, hsMissing, hsBad, hsId, hsIds, hsText,
    hsList, hsPage, hsLog, hsHistory, hsAttach, hsAttachments, hsNow, hsNotify, hsPersonalHidden, hsDateTime, hsActionLine, hsNewAction,
    hsVehicleSite,
  } = H;
  const HS = DB.hsseq;
  HS.procedures = [];
  HS.procedureVersions = [];
  HS.acknowledgements = [];
  HS.bulletins = [];
  HS.emergencyPlans = [];
  HS.drills = [];
  HS.crisisContacts = [];
  Object.assign(HS.seq, { procedure: 0, procedure_version: 0, acknowledgement: 0, bulletin: 0, bulletin_flash_alert: 0, bulletin_lesson: 0, emergency_plan: 0, drill: 0, crisis_contact: 0 });
  // Actions nées d'un exercice (origine « drill » du noyau) : acceptées par la route commune des actions.
  if (!HS_ORIGINS.includes("drill")) HS_ORIGINS.push("drill");

  /* ─── Comptes, sociétés, journal ──────────────────────────────────────── */

  const interne = (u) => Boolean(u) && u.active !== false && (u.profiles ?? []).some((p) => p !== "porteur");
  const societeRef = (id) => ({ id, name: COMPANIES[id]?.name ?? "" });
  /** Sociétés de travail : toutes celles du compte, ou celle du filtre company_id (403 hors du compte). */
  function societes(ctx, q) {
    const v = q.company_id;
    if (v === undefined || v === null || v === "" || v === "all") return ctx.user.companies;
    if (!/^\d+$/.test(String(v))) throw hsBad("Société invalide.");
    if (!ctx.user.companies.includes(Number(v))) throw hsForbidden("Société non autorisée.");
    return [Number(v)];
  }
  const ensembles = () => [...DB.vehicles, ...HS.tippers];
  /** Sites auxquels se rapporte le compte (_hsseq_audience_sites) : null pour une lecture complète. */
  function sitesDuCompte(u) {
    if ((u.profiles ?? []).some((p) => LECTURE_COMPLETE.includes(p))) return null;
    const sites = new Set(HS_USER_SITES[u.id] ?? []);
    const salarie = HS_EMPLOYEES.find((e) => e.user_id === u.id);
    if (salarie?.driver_id) for (const v of ensembles()) if (v.driver_id === salarie.driver_id && v.company_id === 1) sites.add(hsVehicleSite(v));
    if ((u.profiles ?? []).includes("auditeur")) for (const s of u.hsseq_audit_site_ids ?? []) sites.add(s);
    return [...sites];
  }
  /** Le document se rapporte-t-il à ces sites (null : tous) ? Sans site visé : tous les sites. */
  const surSites = (doc, sites) => sites === null || !doc.site_ids.length || doc.site_ids.some((s) => sites.includes(s));
  /** Le compte est-il visé par le document (_applies_to) ? */
  const vise = (doc, u) => interne(u) && u.companies.includes(doc.company_id) && doc.audience_profiles.some((p) => u.profiles.includes(p)) && surSites(doc, sitesDuCompte(u));
  /** Comptes visés, par ordre alphabétique (res.users du noyau). */
  const cibles = (doc) => USERS.filter((u) => vise(doc, u)).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  /** Portée fermée par défaut des plans, exercices et contacts : lecture complète, ou site du compte. */
  const dansPortee = (ctx, siteId) => hsFull(ctx) || (Boolean(siteId) && hsSites(ctx).includes(siteId));
  const historique = (modele, id) => [...hsHistory(modele, id)].reverse();

  /** Valeur écrite au journal (_journal_value) : noms pour les liens, « oui » ou « non », sinon la valeur. */
  function valeurJournal(cle, v) {
    if (typeof v === "boolean") return v ? "oui" : "non";
    // Un entier nul s'écrit vide au journal du noyau (0 vaut False en Python).
    if (v === null || v === undefined || v === "" || v === 0 || (Array.isArray(v) && !v.length)) return null;
    if (cle === "site_id") return hsSite(v)?.name ?? null;
    if (cle === "owner_id") return hsUser(v)?.name ?? null;
    if (cle === "site_ids") return v.map((id) => hsSite(id)?.name).filter(Boolean).join(", ") || null;
    if (cle === "contact_ids") return v.map((id) => HS.crisisContacts.find((c) => c.id === id)?.name).filter(Boolean).join(", ") || null;
    if (cle === "audience_profiles") return v.join(", ");
    if (cle === "event_id") return HS.events.find((e) => e.id === v)?.reference ?? null;
    // Version sans _rec_name : le noyau écrit son nom technique.
    if (cle === "current_version_id") return `eguitra.hsseq.procedure.version,${v}`;
    return String(v);
  }
  /** Écrit des champs, une ligne de journal par champ suivi qui change (valeurs avant et après). */
  function ecrire(modele, rec, valeurs, by, at = hsNow()) {
    for (const [cle, valeur] of Object.entries(valeurs)) {
      const avant = valeurJournal(cle, rec[cle]);
      const apres = valeurJournal(cle, valeur);
      rec[cle] = valeur;
      if (SUIVIS[modele].includes(cle) && avant !== apres) hsLog(modele, rec.id, by, "write", cle, avant, apres, at);
    }
  }
  /** Pièces d'une fiche ; la route commune leur pose « photo », le noyau « document » ou « evidence ». */
  function pieces(objet, id, role) {
    for (const a of HS.attachments) if (a.model === objet && a.object_id === id && a.role === "photo") a.role = role;
    return hsAttachments(objet, id);
  }

  /* ─── Saisie ──────────────────────────────────────────────────────────── */

  function exiger(data, ...cles) {
    const manquants = cles.filter((k) => data[k] === undefined || data[k] === null || data[k] === "");
    if (manquants.length) throw hsMissing("Champs obligatoires manquants.", manquants);
  }
  function jour(data, cle) {
    const v = data[cle];
    if (v === undefined || v === null || v === "") return null;
    const d = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw hsBad(`Date invalide : ${cle}.`, [cle]);
    return d;
  }
  /** Entier positif ou nul d'un corps (int_or_none puis max(…, 0) du noyau) ; 0 ou vide : 0. */
  function entier(data, cle) {
    const v = data[cle];
    if (v === undefined || v === null || v === "" || v === false) return 0;
    if (!/^-?\d+$/.test(String(v).trim())) throw hsBad(`Identifiant invalide : ${cle}.`, [cle]);
    return Math.max(Number(v), 0);
  }
  function trier(liste, sort, cles, defaut) {
    const s = sort || defaut;
    const desc = s.startsWith("-");
    const valeur = cles[desc ? s.slice(1) : s];
    if (!valeur) throw hsBad("Tri inconnu.", ["sort"]);
    return liste.sort((a, b) => {
      const va = valeur(a);
      const vb = valeur(b);
      if (va === vb) return b.id - a.id;
      return (va > vb ? 1 : -1) * (desc ? -1 : 1);
    });
  }
  /** Public visé (audience_values du noyau) : profils connus, au moins un ; sites des sociétés du compte. */
  function publicVise(ctx, data, v) {
    if ("audience_profiles" in data) {
      const codes = data.audience_profiles;
      if (!Array.isArray(codes) || !codes.length || codes.some((c) => !PUBLICS.includes(c))) throw hsBad(`Public visé : au moins un profil parmi ${PUBLICS.join(", ")}.`, ["audience_profiles"]);
      v.audience_profiles = [...new Set(codes)];
    }
    if ("site_ids" in data) {
      const sites = hsIds(data, "site_ids").map(hsSite).filter(Boolean);
      if (sites.some((s) => !ctx.user.companies.includes(s.company_id))) throw hsForbidden("Site non autorisé.");
      v.site_ids = [...new Set(sites.map((s) => s.id))];
    }
    return v;
  }
  const audienceRow = (doc) => ({ profiles: [...doc.audience_profiles], sites: doc.site_ids.map(hsSiteRef).filter(Boolean) });

  /* ─── Lecture des documents ───────────────────────────────────────────── */

  const accuseDe = (cle, id, userId) => HS.acknowledgements.find((a) => a[cle] === id && a.user_id === userId) ?? null;
  function stats(cle, id, vises) {
    const lus = vises.filter((u) => accuseDe(cle, id, u.id)).length;
    return { targets: vises.length, read: lus, rate: vises.length ? Math.round((lus * 1000) / vises.length) / 10 : null };
  }
  /** Lecteurs et comptes en retard de lecture ; noms retirés pour l'auditeur. */
  function lecteurs(ctx, cle, id, vises) {
    if (hsPersonalHidden(ctx)) return [null, null];
    const lus = [];
    const nonLus = [];
    for (const u of vises) {
      const a = accuseDe(cle, id, u.id);
      if (a) lus.push({ user: hsUser(u.id), read_at: a.read_at, source: a.source });
      else nonLus.push(hsUser(u.id));
    }
    return [lus, nonLus];
  }
  /** Accusé de lecture idempotent ; journalisé sur la version ou l'alerte, avec le nom du lecteur. */
  function accuser(cle, cible, modele, u, readAt, source, recu = hsNow()) {
    const existant = accuseDe(cle, cible.id, u.id);
    if (existant) return existant;
    const a = { id: ++HS.seq.acknowledgement, version_id: cle === "version_id" ? cible.id : null, bulletin_id: cle === "bulletin_id" ? cible.id : null, user_id: u.id, company_id: cible.company_id, read_at: readAt, received_at: recu, source };
    HS.acknowledgements.push(a);
    hsLog(modele, cible.id, u.id, "acknowledge", null, null, null, recu, u.name);
    return a;
  }
  /** Heure de lecture sur l'appareil : jamais dans le futur (cinq minutes de décalage d'horloge tolérées). */
  function heureLecture(data) {
    const v = hsDateTime(data, "read_at") ?? hsNow();
    if (Date.parse(v) - Date.parse(hsNow()) > 300000) throw hsBad("Heure de lecture dans le futur.", ["read_at"]);
    return v;
  }
  const sourceDe = (ctx) => (ctx.app === "terrain" ? "terrain" : "web");

  /* ─── Procédures ──────────────────────────────────────────────────────── */

  const versionsDe = (p) => HS.procedureVersions.filter((v) => v.procedure_id === p.id).sort((a, b) => b.id - a.id);
  const brouillonDe = (p) => versionsDe(p).find((v) => v.status === "draft") ?? null;
  const enVigueur = (p) => (p.current_version_id ? (HS.procedureVersions.find((v) => v.id === p.current_version_id) ?? null) : null);
  const transitionsProcedure = (p) => ({ draft: ["archive"], published: ["remind", "archive"], archived: ["reactivate"] })[p.status];
  /** Lecture de gestion : profils de lecture complète ; auditeur pour une procédure de ses sites. */
  const gestionProcedure = (ctx, p) => hsFull(ctx) || (hsIs(ctx, "auditeur") && surSites(p, hsSites(ctx)));
  const versionRow = (v) =>
    v
      ? {
          id: v.id, version: v.version, effective_date: v.effective_date, change_summary: v.change_summary ?? null, status: v.status,
          published_at: v.published_at ?? null, published_by: hsUser(v.published_by), document: pieces("procedure_version", v.id, "document"),
        }
      : null;
  function procedureRow(ctx, p, detail = false) {
    const hsseq = hsIs(ctx, "hsseq");
    const t = hsseq ? transitionsProcedure(p) : [];
    const courante = enVigueur(p);
    const brouillon = brouillonDe(p);
    const vises = courante && p.status === "published" ? cibles(p) : null;
    const row = {
      id: p.id, code: p.code, title: p.title, domain: p.domain ?? null, audience: audienceRow(p), status: p.status, owner: hsUser(p.owner_id),
      current_version: versionRow(courante), draft_version: versionRow(brouillon), read: vises ? stats("version_id", courante.id, vises) : null,
      rights: { can_edit: hsseq && p.status !== "archived", can_close: t.includes("archive"), can_approve: hsseq && Boolean(brouillon) && p.status !== "archived" },
    };
    if (detail) {
      const [lus, nonLus] = vises ? lecteurs(ctx, "version_id", courante.id, vises) : [null, null];
      Object.assign(row, {
        company: societeRef(p.company_id), description: p.description ?? null, versions: versionsDe(p).map(versionRow), readers: lus, unread: nonLus,
        archive_reason: p.archive_reason ?? null, history: historique("procedure", p.id), transitions: t,
      });
    }
    return row;
  }
  /** Procédure lue en gestion ; 404 hors du périmètre, sans révéler son existence. */
  function procedureDe(ctx, id) {
    const p = HS.procedures.find((x) => x.id === Number(id));
    if (!p || !ctx.user.companies.includes(p.company_id) || !gestionProcedure(ctx, p)) throw new ApiError(404, "not_found", "Procédure introuvable.");
    return p;
  }
  function versionDe(p, id) {
    const v = HS.procedureVersions.find((x) => x.id === Number(id) && x.procedure_id === p.id);
    if (!v) throw new ApiError(404, "not_found", "Version introuvable pour cette procédure.");
    return v;
  }
  function selectionProcedures(ctx, q) {
    const ids = societes(ctx, q);
    const statuts = hsList(q.status);
    const texte = String(q.search ?? "").trim().toLowerCase();
    return HS.procedures
      .filter((p) => ids.includes(p.company_id) && (!statuts || statuts.includes(p.status)) && (!q.domain || p.domain === q.domain) && (!texte || p.code.toLowerCase().includes(texte) || p.title.toLowerCase().includes(texte)) && gestionProcedure(ctx, p))
      .sort((a, b) => a.code.localeCompare(b.code) || a.id - b.id);
  }
  function valeursProcedure(ctx, data, partiel = false) {
    const v = {};
    for (const [cle, max, requis] of [["code", 64, true], ["title", 300, true], ["description", 4000, false]]) {
      if (partiel && !(cle in data)) continue;
      v[cle] = hsText(data, cle, max);
      if (requis && !v[cle]) throw hsMissing("Référence et titre de la procédure sont obligatoires.", [cle]);
    }
    if ("domain" in data) {
      if (data.domain && !posee(DOMAINES, data.domain)) throw hsBad("Domaine inconnu.", ["domain"]);
      v.domain = data.domain || null;
    }
    if ("owner_id" in data) {
      const u = USERS.find((x) => x.id === hsId(data, "owner_id")) ?? null;
      if (u && !interne(u)) throw hsRule("business_rule", "Responsable du document : un compte interne.", { fields: ["owner_id"] });
      v.owner_id = u?.id ?? null;
    }
    return publicVise(ctx, data, v);
  }
  function valeursVersion(data, partiel = false) {
    const v = {};
    if (!partiel || "version" in data) {
      v.version = hsText(data, "version", 32);
      if (!v.version) throw hsMissing("Numéro de version manquant.", ["version"]);
    }
    if (!partiel || "effective_date" in data) {
      v.effective_date = jour(data, "effective_date");
      if (!v.effective_date) throw hsMissing("Date d'effet manquante.", ["effective_date"]);
    }
    if ("change_summary" in data) v.change_summary = hsText(data, "change_summary", 4000);
    return v;
  }
  function verifierCode(p, code, societe) {
    if (HS.procedures.some((x) => x.id !== p?.id && x.company_id === societe && x.code === code)) throw hsRule("business_rule", "Cette référence de procédure existe déjà dans la société.", { fields: ["code"] });
  }
  function verifierVersion(p, version, v = null) {
    if (HS.procedureVersions.some((x) => x.procedure_id === p.id && x.id !== v?.id && x.version === version)) throw hsRule("business_rule", "Cette version de la procédure existe déjà.", { fields: ["version"] });
  }
  function nouvelleProcedure(v, by, at) {
    const p = {
      id: ++HS.seq.procedure, company_id: v.company_id ?? 1, code: v.code, title: v.title, domain: v.domain ?? null, description: v.description ?? null,
      site_ids: v.site_ids ?? [], audience_profiles: v.audience_profiles ?? ["conducteur"], owner_id: v.owner_id === undefined ? by : v.owner_id,
      status: "draft", current_version_id: null, archive_reason: null, created_at: at, created_by: by,
    };
    // Lectures du cockpit (serveur.mjs) : comptes visés et accusés de la version en vigueur.
    Object.defineProperties(p, {
      ack_targets: { get: () => (p.status === "published" && enVigueur(p) ? cibles(p).length : 0) },
      ack_count: { get: () => (p.status === "published" && enVigueur(p) ? stats("version_id", enVigueur(p).id, cibles(p)).read : 0) },
    });
    HS.procedures.push(p);
    hsLog("procedure", p.id, by, "create", null, null, null, at);
    return p;
  }
  function nouvelleVersion(p, v, by, at) {
    const version = {
      id: ++HS.seq.procedure_version, procedure_id: p.id, company_id: p.company_id, version: v.version, effective_date: v.effective_date,
      change_summary: v.change_summary ?? null, status: "draft", published_at: null, published_by: null, superseded_at: null, reminded_on: null, created_at: at,
    };
    HS.procedureVersions.push(version);
    hsLog("procedure_version", version.id, by, "create", null, null, null, at);
    return version;
  }
  /** Mise en vigueur d'une version (action_publish) : document joint, précédente remplacée, comptes visés prévenus. */
  function publierVersion(p, v, by, at, prevenir = true) {
    if (v.status !== "draft") throw hsRule("invalid_transition", "Seule une version en brouillon se publie.");
    if (p.status === "archived") throw hsRule("invalid_transition", "Procédure archivée : réactivez-la avant de publier une version.");
    if (!HS.attachments.some((a) => a.model === "procedure_version" && a.object_id === v.id)) throw hsRule("document_missing", "Joignez le document de la version avant de la publier.", { fields: ["attachment_ids"] });
    for (const x of versionsDe(p).filter((x) => x.status === "published")) {
      ecrire("procedure_version", x, { status: "superseded" }, by, at);
      x.superseded_at = at;
    }
    ecrire("procedure_version", v, { status: "published" }, by, at);
    Object.assign(v, { published_at: at, published_by: by });
    ecrire("procedure", p, { status: "published", current_version_id: v.id }, by, at);
    hsLog("procedure_version", v.id, by, "publish", null, null, null, at);
    if (prevenir) {
      hsNotify(cibles(p).map((u) => u.id), "procedure_published", `Procédure à lire : ${p.code}`, `${p.code} : ${p.title}\nVersion ${v.version}, en vigueur le ${fr(v.effective_date)}.\nLisez-la et accusez lecture.`, "procedure", p.id, at);
    }
  }
  function relancerVersion(p, v, at) {
    const nonLus = cibles(p).filter((u) => !accuseDe("version_id", v.id, u.id));
    if (nonLus.length) {
      hsNotify(nonLus.map((u) => u.id), "read_reminder", `Rappel : procédure à lire, ${p.code}`, `${p.code} : ${p.title}\nVersion ${v.version}, publiée le ${fr(v.published_at)}. Lisez-la et accusez lecture.`, "procedure", p.id, at);
    }
    v.reminded_on = TODAY;
    return nonLus.length;
  }
  const maProcedure = (p, a) => {
    const v = enVigueur(p);
    return {
      id: p.id, code: p.code, title: p.title, domain: p.domain ?? null,
      version: { id: v.id, version: v.version, effective_date: v.effective_date, published_at: v.published_at ?? null, change_summary: v.change_summary ?? null },
      document: pieces("procedure_version", v.id, "document"), read: Boolean(a), read_at: a?.read_at ?? null,
    };
  };

  /* ─── Alertes flash et retours d'expérience ───────────────────────────── */

  const transitionsAlerte = (b) => ({ draft: ["publish"], published: ["remind", "archive"], archived: [] })[b.status];
  /** Gestion (lecture complète), auditeur pour une alerte diffusée de ses sites, ou compte visé par une alerte diffusée. */
  function lisibleAlerte(ctx, b) {
    if (hsFull(ctx)) return true;
    if (b.status === "draft") return false;
    if (hsIs(ctx, "auditeur") && surSites(b, hsSites(ctx))) return true;
    return b.status === "published" && vise(b, ctx.user);
  }
  /** Noms à ne jamais diffuser : conducteurs, comptes internes ; à part, les personnes de l'événement d'origine. */
  function nomsDePersonnes(b) {
    const tous = new Set([...DB.drivers, ...HS.drivers].map((d) => d.name).filter(Boolean));
    for (const u of USERS) if ((u.profiles ?? []).some((p) => p !== "porteur")) tous.add(u.name);
    const lies = new Set();
    const e = b.event_id ? HS.events.find((x) => x.id === b.event_id) : null;
    if (e) {
      for (const personne of e.people ?? []) if (personne.name) lies.add(personne.name);
      const declarant = hsUser(e.reported_by)?.name;
      if (declarant) lies.add(declarant);
      const rotation = [...DB.rotations, ...HS.rotations].find((r) => r.id === e.rotation_id);
      const conducteur = rotation ? [...DB.drivers, ...HS.drivers].find((d) => d.id === rotation.driver_id)?.name : null;
      if (conducteur) lies.add(conducteur);
    }
    return [tous, lies];
  }
  /** Noms de personnes et immatriculations (codes d'ensemble compris) relevés dans le titre, le texte et les messages clés. */
  function constatsAnonymat(b, valeurs = b) {
    const plaques = new Map();
    for (const v of ensembles()) {
      for (const valeur of [v.tractor_plate, v.trailer_plate, v.name]) {
        const cle = plain(valeur).replaceAll(" ", "");
        if (cle.length >= 4 && !plaques.has(cle)) plaques.set(cle, valeur);
      }
    }
    const [tous, lies] = nomsDePersonnes(b);
    const constats = [];
    const relever = (kind, value, field) => {
      if (!constats.some((f) => f.kind === kind && f.value === value && f.field === field)) constats.push({ kind, value, field });
    };
    for (const champ of TEXTES_ALERTE) {
      const brut = valeurs[champ] ?? "";
      if (!brut) continue;
      const texte = ` ${plain(brut)} `;
      const suites = fenetres(texte.trim().split(" ").filter(Boolean));
      for (const [cle, valeur] of plaques) if (suites.has(cle)) relever("plate", valeur, champ);
      for (const m of String(brut).matchAll(PLAQUE)) relever("plate", m[0], champ);
      for (const nom of new Set([...tous, ...lies])) {
        if (formes(nom).some((f) => texte.includes(` ${f} `))) relever("person", nom, champ);
        else if (lies.has(nom) && plain(String(nom).replace(/\(.*?\)/g, " ")).split(" ").some((mot) => mot.length >= 4 && texte.includes(` ${mot} `))) relever("person", nom, champ);
      }
    }
    return constats;
  }
  function alerteRow(ctx, b, detail = false) {
    const hsseq = hsIs(ctx, "hsseq");
    const t = hsseq ? transitionsAlerte(b) : [];
    const vises = b.status !== "draft" && (hsFull(ctx) || hsIs(ctx, "auditeur")) ? cibles(b) : null;
    const row = {
      id: b.id, reference: b.reference, kind: b.kind, title: b.title, status: b.status, audience: audienceRow(b), published_at: b.published_at ?? null,
      read: vises ? stats("bulletin_id", b.id, vises) : null,
      rights: { can_edit: hsseq && b.status === "draft", can_close: t.includes("archive"), can_approve: t.includes("publish") },
    };
    if (detail) {
      const [lus, nonLus] = vises ? lecteurs(ctx, "bulletin_id", b.id, vises) : [null, null];
      const e = b.event_id && hsFull(ctx) ? HS.events.find((x) => x.id === b.event_id) : null;
      Object.assign(row, {
        company: societeRef(b.company_id), body: b.body, key_messages: b.key_messages ?? null,
        // Événement d'origine : jamais servi hors des profils de lecture complète.
        event: e ? { id: e.id, reference: e.reference } : null,
        published_by: hsPersonalHidden(ctx) ? null : hsUser(b.published_by),
        anonymity_findings: b.status === "draft" && hsseq ? constatsAnonymat(b) : null,
        readers: lus, unread: nonLus, archive_reason: b.archive_reason ?? null, history: hsFull(ctx) ? historique("bulletin", b.id) : [], transitions: t,
      });
    }
    return row;
  }
  function alerteDe(ctx, id) {
    const b = HS.bulletins.find((x) => x.id === Number(id));
    if (!b || !ctx.user.companies.includes(b.company_id) || !(hsFull(ctx) || (hsIs(ctx, "auditeur") && lisibleAlerte(ctx, b)))) throw new ApiError(404, "not_found", "Alerte introuvable.");
    return b;
  }
  function valeursAlerte(ctx, data, partiel = false) {
    const v = {};
    if ("kind" in data || !partiel) {
      const kind = data.kind || "flash_alert";
      if (!posee(NATURES, kind)) throw hsBad("Nature : flash_alert ou lesson.", ["kind"]);
      v.kind = kind;
    }
    for (const [cle, max, requis] of [["title", 300, true], ["body", 8000, true], ["key_messages", 4000, false]]) {
      if (partiel && !(cle in data)) continue;
      v[cle] = hsText(data, cle, max);
      if (requis && !v[cle]) throw hsMissing("Titre et texte de l'alerte sont obligatoires.", [cle]);
    }
    if ("event_id" in data) {
      const id = hsId(data, "event_id");
      const e = id ? HS.events.find((x) => x.id === id) : null;
      if (id && !e) throw new ApiError(404, "not_found", "Événement introuvable.");
      v.event_id = e?.id ?? null;
    }
    return publicVise(ctx, data, v);
  }
  /** Ordre du noyau : published_at desc (brouillons, sans date, en tête), puis id desc. */
  const parDiffusion = (a, b) => (a.published_at === b.published_at ? b.id - a.id : !a.published_at ? -1 : !b.published_at ? 1 : b.published_at.localeCompare(a.published_at));
  function nouvelleAlerte(v, by, at) {
    const b = {
      id: ++HS.seq.bulletin, reference: "/", company_id: v.company_id ?? 1, kind: v.kind ?? "flash_alert", title: v.title, body: v.body, key_messages: v.key_messages ?? null,
      event_id: v.event_id ?? null, audience_profiles: v.audience_profiles ?? ["conducteur", "exploitation"], site_ids: v.site_ids ?? [], status: "draft",
      published_at: null, published_by: null, reminded_on: null, archive_reason: null, created_at: at, created_by: by,
    };
    const rang = ++HS.seq[`bulletin_${b.kind}`];
    b.reference = `${b.kind === "lesson" ? "REX" : "ALF"}/${at.slice(0, 4)}/${String(rang).padStart(3, "0")}`;
    HS.bulletins.push(b);
    hsLog("bulletin", b.id, by, "create", null, null, null, at);
    return b;
  }
  function diffuserAlerte(b, by, at, prevenir = true) {
    const constats = constatsAnonymat(b);
    if (constats.length) {
      const personnes = [...new Set(constats.filter((f) => f.kind === "person").map((f) => f.value))].sort();
      const plaques = [...new Set(constats.filter((f) => f.kind === "plate").map((f) => f.value))].sort();
      const parts = [...(personnes.length ? [`nom de personne : ${personnes.join(", ")}`] : []), ...(plaques.length ? [`immatriculation ou code d'ensemble : ${plaques.join(", ")}`] : [])];
      throw hsRule("not_anonymized", `Diffusion refusée : une alerte ou un retour d'expérience est anonymisé (${parts.join(" ; ")}).`, { fields: [...new Set(constats.map((f) => f.field))].sort() });
    }
    ecrire("bulletin", b, { status: "published" }, by, at);
    Object.assign(b, { published_at: at, published_by: by });
    hsLog("bulletin", b.id, by, "publish", null, null, null, at);
    if (prevenir) hsNotify(cibles(b).map((u) => u.id), "bulletin_published", `${NATURES[b.kind]} : ${b.title}`, `${b.reference} : ${b.title}\nLisez-la et accusez lecture.`, "bulletin", b.id, at);
  }
  function relancerAlerte(b, at) {
    const nonLus = cibles(b).filter((u) => !accuseDe("bulletin_id", b.id, u.id));
    if (nonLus.length) hsNotify(nonLus.map((u) => u.id), "read_reminder", `Rappel : ${NATURES[b.kind].toLowerCase()} à lire`, `${b.reference} : ${b.title}\nLisez-la et accusez lecture.`, "bulletin", b.id, at);
    b.reminded_on = TODAY;
    return nonLus.length;
  }
  /** Alerte telle que la lit le compte visé : texte anonymisé, jamais l'événement d'origine. */
  const monAlerte = (b, a) => ({ id: b.id, reference: b.reference, kind: b.kind, title: b.title, body: b.body, key_messages: b.key_messages ?? null, published_at: b.published_at, read: Boolean(a), read_at: a?.read_at ?? null });

  /* ─── Plans, exercices, annuaire ──────────────────────────────────────── */

  const ordreAppel = (a, b) => a.call_order - b.call_order || a.id - b.id;
  const contactRow = (ctx, c) => ({
    id: c.id, site: hsSiteRef(c.site_id), function: c.function, name: c.name, organization: c.organization ?? null, phone: c.phone, phone2: c.phone2 ?? null,
    email: c.email ?? null, call_order: c.call_order, note: c.note ?? null, active: c.active, rights: { can_edit: hsIs(ctx, "hsseq"), can_close: false, can_approve: false },
  });
  const monContact = (c) => ({ id: c.id, site: hsSiteRef(c.site_id), function: c.function, name: c.name, organization: c.organization ?? null, phone: c.phone, phone2: c.phone2 ?? null, call_order: c.call_order });
  const planDe = (id) => HS.emergencyPlans.find((x) => x.id === id) ?? null;
  const exercicesDe = (pl) => HS.drills.filter((d) => d.plan_id === pl.id).sort((a, b) => b.planned_date.localeCompare(a.planned_date) || b.id - a.id);
  /** Actions nées de l'exercice ; leur site et leur exercice sont repris de l'exercice (la route commune des actions pose le site 1). */
  function actionsDe(d) {
    const liste = HS.actions.filter((a) => a.origin === "drill" && (a.drill_id ?? a.origin_id) === d.id);
    for (const a of liste) Object.assign(a, { drill_id: d.id, site_id: d.site_id });
    return liste.sort((a, b) => a.id - b.id);
  }
  function exerciceRow(ctx, d, detail = false) {
    const pl = planDe(d.plan_id);
    const hsseq = hsIs(ctx, "hsseq");
    const t = hsseq ? ({ planned: ["perform", "cancel"], done: ["reopen"], cancelled: [] })[d.status] : [];
    const row = {
      id: d.id, reference: d.reference, plan: { id: pl.id, reference: pl.reference, title: pl.title }, site: hsSiteRef(d.site_id), scenario: d.scenario,
      planned_date: d.planned_date, performed_date: d.performed_date ?? null, status: d.status, overdue: d.status === "planned" && d.planned_date < TODAY,
      participants_count: d.participants_count || null, rights: { can_edit: hsseq && d.status !== "cancelled", can_close: t.includes("perform"), can_approve: false },
    };
    if (detail) {
      Object.assign(row, {
        company: societeRef(d.company_id), duration_minutes: d.duration_minutes || null,
        participants: hsPersonalHidden(ctx) ? [] : d.participant_ids.map(hsUser).filter(Boolean), debrief: d.debrief ?? null,
        cancel_reason: d.cancel_reason ?? null, reopen_reason: d.reopen_reason ?? null, actions: actionsDe(d).map(hsActionLine),
        attachments: pieces("drill", d.id, "evidence"), history: historique("drill", d.id), transitions: t,
      });
    }
    return row;
  }
  function planRow(ctx, pl, detail = false) {
    const exercices = exercicesDe(pl);
    const faits = exercices.filter((d) => d.status === "done").sort((a, b) => b.performed_date.localeCompare(a.performed_date));
    const prevus = exercices.filter((d) => d.status === "planned").sort((a, b) => a.planned_date.localeCompare(b.planned_date));
    const row = {
      id: pl.id, reference: pl.reference, site: hsSiteRef(pl.site_id), scenario: pl.scenario, title: pl.title, review_date: pl.review_date ?? null, active: pl.active,
      last_drill: faits[0]?.performed_date ?? null, next_drill: prevus[0]?.planned_date ?? null, rights: { can_edit: hsIs(ctx, "hsseq"), can_close: false, can_approve: false },
    };
    if (detail) {
      Object.assign(row, {
        company: societeRef(pl.company_id), response: pl.response, resources: pl.resources ?? null,
        contacts: pl.contact_ids.map((id) => HS.crisisContacts.find((c) => c.id === id && c.active)).filter(Boolean).sort(ordreAppel).map((c) => contactRow(ctx, c)),
        drills: exercices.map((d) => exerciceRow(ctx, d)), attachments: pieces("emergency_plan", pl.id, "document"), history: historique("emergency_plan", pl.id),
      });
    }
    return row;
  }
  /** Plan lu par le compte (archivé compris) ; 404 hors de son périmètre. */
  function planLu(ctx, id) {
    const pl = HS.emergencyPlans.find((x) => x.id === Number(id));
    if (!pl || !ctx.user.companies.includes(pl.company_id) || !dansPortee(ctx, pl.site_id)) throw new ApiError(404, "not_found", "Plan d'intervention introuvable.");
    return pl;
  }
  function exerciceLu(ctx, id) {
    const d = HS.drills.find((x) => x.id === Number(id));
    if (!d || !ctx.user.companies.includes(d.company_id) || !dansPortee(ctx, d.site_id)) throw new ApiError(404, "not_found", "Exercice introuvable.");
    return d;
  }
  function siteDe(ctx, data) {
    const id = hsId(data, "site_id");
    const site = id ? hsSite(id) : null;
    if (!site || !ctx.user.companies.includes(site.company_id)) throw new ApiError(404, "not_found", "Site introuvable.");
    return site;
  }
  function valeursPlan(ctx, data, partiel = false) {
    const v = {};
    if (!partiel || "scenario" in data) {
      if (!posee(SCENARIOS, data.scenario ?? "")) throw hsBad("Scénario inconnu.", ["scenario"]);
      v.scenario = data.scenario;
    }
    for (const [cle, max, requis] of [["title", 300, true], ["response", 8000, true], ["resources", 4000, false]]) {
      if (partiel && !(cle in data)) continue;
      v[cle] = hsText(data, cle, max);
      if (requis && !v[cle]) throw hsMissing("Intitulé et conduite à tenir sont obligatoires.", [cle]);
    }
    if ("review_date" in data) v.review_date = jour(data, "review_date");
    if ("active" in data) v.active = Boolean(data.active);
    if ("contact_ids" in data) {
      const contacts = hsIds(data, "contact_ids").map((id) => HS.crisisContacts.find((c) => c.id === id)).filter(Boolean);
      if (contacts.some((c) => !ctx.user.companies.includes(c.company_id))) throw hsForbidden("Contact non autorisé.");
      v.contact_ids = [...new Set(contacts.map((c) => c.id))];
    }
    return v;
  }
  /** Un plan en vigueur par site et par scénario (contrainte _check_unique du modèle). */
  function verifierPlanUnique(pl) {
    if (pl.active && HS.emergencyPlans.some((x) => x.id !== pl.id && x.active && x.site_id === pl.site_id && x.scenario === pl.scenario)) {
      throw hsRule("business_rule", "Un plan d'intervention en vigueur existe déjà pour ce site et ce scénario.");
    }
  }
  function nouveauPlan(v, by, at) {
    const pl = {
      id: null, reference: "", company_id: hsSite(v.site_id)?.company_id ?? 1, site_id: v.site_id, scenario: v.scenario, title: v.title, response: v.response,
      resources: v.resources ?? null, contact_ids: v.contact_ids ?? [], review_date: v.review_date ?? null, active: v.active ?? true, created_at: at,
    };
    // Contrôlé avant de prendre un numéro : un refus ne laisse pas de trou dans les références.
    verifierPlanUnique(pl);
    pl.id = ++HS.seq.emergency_plan;
    pl.reference = `PIU/${String(pl.id).padStart(3, "0")}`;
    HS.emergencyPlans.push(pl);
    hsLog("emergency_plan", pl.id, by, "create", null, null, null, at);
    return pl;
  }
  function valeursExercice(data, partiel = false) {
    const v = {};
    if (!partiel || "planned_date" in data) {
      v.planned_date = jour(data, "planned_date");
      if (!v.planned_date) throw hsMissing("Date prévue de l'exercice manquante.", ["planned_date"]);
    }
    for (const cle of ["participants_count", "duration_minutes"]) if (cle in data) v[cle] = entier(data, cle);
    if ("debrief" in data) v.debrief = hsText(data, "debrief", 8000);
    if ("participant_ids" in data) v.participant_ids = [...new Set(hsIds(data, "participant_ids"))].filter((id) => interne(USERS.find((u) => u.id === id)));
    return v;
  }
  function nouvelExercice(pl, v, by, at) {
    const d = {
      id: ++HS.seq.drill, reference: "", plan_id: pl.id, company_id: pl.company_id, site_id: pl.site_id, scenario: pl.scenario, planned_date: v.planned_date,
      performed_date: null, status: "planned", participants_count: v.participants_count ?? 0, participant_ids: v.participant_ids ?? [], duration_minutes: v.duration_minutes ?? 0,
      debrief: v.debrief ?? null, cancel_reason: null, reopen_reason: null, created_at: at,
    };
    d.reference = `EXE/${at.slice(0, 4)}/${String(d.id).padStart(3, "0")}`;
    HS.drills.push(d);
    hsLog("drill", d.id, by, "create", null, null, null, at);
    return d;
  }
  function exigerMotif(data, quoi) {
    const motif = String(data.reason ?? "").trim();
    if (!motif) throw hsRule("reason_required", `Le motif ${quoi} est obligatoire.`, { fields: ["reason"] });
    return motif;
  }
  function selectionPlans(ctx, q) {
    const ids = societes(ctx, q);
    const scenarios = hsList(q.scenario);
    const site = hsId(q, "site_id");
    const tous = ["all", ""].includes(String(q.active ?? "1"));
    return HS.emergencyPlans.filter((pl) => ids.includes(pl.company_id) && dansPortee(ctx, pl.site_id) && (tous || pl.active) && (!site || pl.site_id === site) && (!scenarios || scenarios.includes(pl.scenario)));
  }
  function selectionExercices(ctx, q) {
    const ids = societes(ctx, q);
    const statuts = hsList(q.status);
    const scenarios = hsList(q.scenario);
    const site = hsId(q, "site_id");
    const plan = hsId(q, "plan_id");
    const annee = hsId(q, "year");
    return HS.drills.filter(
      (d) =>
        ids.includes(d.company_id) && dansPortee(ctx, d.site_id) && (!statuts || statuts.includes(d.status)) && (!scenarios || scenarios.includes(d.scenario)) &&
        (!site || d.site_id === site) && (!plan || d.plan_id === plan) && (!annee || d.planned_date.slice(0, 4) === String(annee)),
    );
  }
  function selectionContacts(ctx, q) {
    const ids = societes(ctx, q);
    const bornes = hsFull(ctx) ? null : hsSites(ctx);
    const site = hsId(q, "site_id");
    const tous = ["all", ""].includes(String(q.active ?? "1"));
    return HS.crisisContacts
      .filter((c) => ids.includes(c.company_id) && (bornes === null || !c.site_id || bornes.includes(c.site_id)) && (!site || !c.site_id || c.site_id === site) && (tous || c.active))
      .sort(ordreAppel);
  }
  function valeursContact(ctx, data, partiel = false) {
    const v = {};
    for (const [cle, max, requis] of [["function", 200, true], ["name", 200, true], ["phone", 64, true], ["organization", 200, false], ["phone2", 64, false], ["email", 200, false], ["note", 2000, false]]) {
      if (partiel && !(cle in data)) continue;
      v[cle] = hsText(data, cle, max);
      if (requis && !v[cle]) throw hsMissing("Fonction, nom et téléphone du contact sont obligatoires.", [cle]);
    }
    if ("call_order" in data) v.call_order = entier(data, "call_order") || 10;
    if ("site_id" in data) v.site_id = hsId(data, "site_id") ? siteDe(ctx, data).id : null;
    if ("active" in data) v.active = Boolean(data.active);
    return v;
  }
  function nouveauContact(v, by, at) {
    const c = {
      id: ++HS.seq.crisis_contact, company_id: v.company_id ?? 1, site_id: v.site_id ?? null, function: v.function, name: v.name, organization: v.organization ?? null,
      phone: v.phone, phone2: v.phone2 ?? null, email: v.email ?? null, call_order: v.call_order ?? 10, note: v.note ?? null, active: v.active ?? true,
    };
    HS.crisisContacts.push(c);
    hsLog("crisis_contact", c.id, by, "create", null, null, null, at);
    return c;
  }

  /* ─── Pièces jointes des fiches du module ─────────────────────────────── */

  // Lues par les routes communes /hsseq/attachments (dépôt, téléchargement, retrait) avec les droits du noyau.
  HS_ATTACH_MODELS.procedure_version = (ctx, id) => {
    const v = HS.procedureVersions.find((x) => x.id === id);
    const p = v ? HS.procedures.find((x) => x.id === v.procedure_id) : null;
    const lisible = p && ctx.user.companies.includes(p.company_id) && (gestionProcedure(ctx, p) || (v.status === "published" && p.status === "published" && vise(p, ctx.user)));
    if (!lisible) throw new ApiError(404, "not_found", "Fiche introuvable.");
    // Version publiée ou remplacée : son document ne change plus (can_attach du noyau).
    if (ctx.method !== "GET" && v.status !== "draft") throw hsForbidden("Pièce jointe non autorisée sur cette fiche.");
    return v;
  };
  HS_ATTACH_MODELS.emergency_plan = (ctx, id) => {
    if (!hasProfile(ctx, PLAN_READ)) throw new ApiError(404, "not_found", "Fiche introuvable.");
    return planLu(ctx, id);
  };
  HS_ATTACH_MODELS.drill = (ctx, id) => {
    if (!hasProfile(ctx, PLAN_READ)) throw new ApiError(404, "not_found", "Fiche introuvable.");
    const d = exerciceLu(ctx, id);
    if (ctx.method !== "GET" && d.status === "cancelled") throw hsForbidden("Pièce jointe non autorisée sur cette fiche.");
    return d;
  };

  /* ─── Routes : mes documents ──────────────────────────────────────────── */

  route("GET", "/hsseq/my/documents", null, (ctx) => {
    hsInternal(ctx);
    const u = ctx.user;
    const procedures = HS.procedures.filter((p) => u.companies.includes(p.company_id) && p.status === "published" && enVigueur(p) && vise(p, u)).sort((a, b) => a.code.localeCompare(b.code) || a.id - b.id);
    const alertes = HS.bulletins.filter((b) => u.companies.includes(b.company_id) && b.status === "published" && vise(b, u)).sort(parDiffusion).slice(0, 200);
    let lignesP = procedures.map((p) => maProcedure(p, accuseDe("version_id", p.current_version_id, u.id)));
    let lignesB = alertes.map((b) => monAlerte(b, accuseDe("bulletin_id", b.id, u.id)));
    if (oui(ctx.query.unread)) {
      lignesP = lignesP.filter((r) => !r.read);
      lignesB = lignesB.filter((r) => !r.read);
    }
    // Les non lus d'abord, l'ordre gardé dans chaque groupe.
    lignesP.sort((a, b) => Number(a.read) - Number(b.read));
    lignesB.sort((a, b) => Number(a.read) - Number(b.read));
    return { procedures: lignesP, bulletins: lignesB, unread_count: [...lignesP, ...lignesB].filter((r) => !r.read).length };
  });

  route("GET", "/hsseq/my/crisis-contacts", null, (ctx) => {
    hsInternal(ctx);
    const sites = sitesDuCompte(ctx.user);
    const items = HS.crisisContacts.filter((c) => c.active && ctx.user.companies.includes(c.company_id) && (sites === null || !c.site_id || sites.includes(c.site_id))).sort(ordreAppel).map(monContact);
    return { sites: sites === null ? null : sites.map(hsSiteRef).filter(Boolean), items };
  });

  /* ─── Routes : registres ──────────────────────────────────────────────── */

  route("GET", "/hsseq/documents/export.xlsx", PLAN_READ, (ctx) => {
    const q = ctx.query;
    const feuilles = [];
    if (hasProfile(ctx, DOC_READ)) {
      const lignesP = selectionProcedures(ctx, q).map((p) => {
        const v = enVigueur(p);
        const s = v && p.status === "published" ? stats("version_id", v.id, cibles(p)) : null;
        return [p.code, p.title, STATUTS_PROCEDURE[p.status], v?.version ?? "", v?.effective_date ?? "", p.audience_profiles.join(", "), p.site_ids.map((id) => hsSite(id)?.name).filter(Boolean).join(", ") || "Tous", s?.targets ?? "", s?.read ?? "", s?.rate ?? ""];
      });
      feuilles.push({ name: "Procédures", rows: [["Référence", "Titre", "État", "Version", "Date d'effet", "Profils visés", "Sites visés", "Comptes visés", "Lectures", "Taux de lecture (%)"], ...lignesP] });
      const alertes = HS.bulletins
        .filter((b) => societes(ctx, q).includes(b.company_id) && (hsFull(ctx) || b.status !== "draft") && lisibleAlerte(ctx, b))
        .sort((a, b) => (a.published_at ?? "9999").localeCompare(b.published_at ?? "9999") || a.id - b.id);
      const lignesB = alertes.map((b) => {
        const s = b.status !== "draft" ? stats("bulletin_id", b.id, cibles(b)) : null;
        return [b.reference, NATURES[b.kind], b.title, STATUTS_ALERTE[b.status], b.published_at ? b.published_at.slice(0, 10) : "", s?.read ?? "", s?.targets ?? ""];
      });
      feuilles.push({ name: "Alertes et retours d'expérience", rows: [["Référence", "Nature", "Titre", "État", "Diffusé le", "Lectures", "Comptes visés"], ...lignesB] });
    }
    const plans = selectionPlans(ctx, q).sort((a, b) => a.site_id - b.site_id || a.scenario.localeCompare(b.scenario) || a.id - b.id);
    feuilles.push({
      name: "Plans d'intervention",
      rows: [["Référence", "Site", "Scénario", "Plan", "Conduite à tenir", "Prochaine revue"], ...plans.map((pl) => [pl.reference, hsSite(pl.site_id)?.name ?? "", SCENARIOS[pl.scenario], pl.title, pl.response, pl.review_date ?? ""])],
    });
    const exercices = selectionExercices(ctx, q).sort((a, b) => a.planned_date.localeCompare(b.planned_date) || a.id - b.id);
    feuilles.push({
      name: "Exercices",
      rows: [
        ["Référence", "Plan", "Site", "Scénario", "Prévu le", "Réalisé le", "État", "Participants", "Bilan"],
        ...exercices.map((d) => [d.reference, planDe(d.plan_id)?.reference ?? "", hsSite(d.site_id)?.name ?? "", SCENARIOS[d.scenario], d.planned_date, d.performed_date ?? "", STATUTS_EXERCICE[d.status], d.participants_count || "", d.debrief ?? ""]),
      ],
    });
    // Annuaire du compte : sans le filtre de site de la liste (contact_domain du noyau).
    const contacts = selectionContacts(ctx, { company_id: q.company_id });
    feuilles.push({
      name: "Annuaire de crise",
      rows: [["Ordre d'appel", "Site", "Fonction", "Nom", "Organisme", "Téléphone", "Second téléphone"], ...contacts.map((c) => [c.call_order, hsSite(c.site_id)?.name ?? "Tous les sites", c.function, c.name, c.organization ?? "", c.phone, c.phone2 ?? ""])],
    });
    return fileReply(xlsxBuffer(feuilles), XLSX, `documents_urgences_hsseq_${TODAY.replaceAll("-", "")}.xlsx`);
  });

  /* ─── Routes : procédures ─────────────────────────────────────────────── */

  route("GET", "/hsseq/procedures", DOC_READ, (ctx) => {
    const q = ctx.query;
    if (q.sort && !["code", "-code"].includes(q.sort)) throw hsBad("Tri inconnu.", ["sort"]);
    const lignes = selectionProcedures(ctx, q);
    // Comme le noyau : comptes par statut sur la sélection filtrée, statut compris.
    const counts = { by_status: Object.fromEntries(Object.keys(STATUTS_PROCEDURE).map((s) => [s, lignes.filter((p) => p.status === s).length])) };
    return hsPage(ctx, lignes, counts, (p) => procedureRow(ctx, p));
  });

  route("POST", "/hsseq/procedures", HSSEQ, (ctx) => {
    const data = ctx.body;
    exiger(data, "code", "title", "version", "effective_date");
    const societe = data.company_id ? societes(ctx, { company_id: data.company_id })[0] : (ctx.company ?? 1);
    // Tout est lu avant la création : un refus n'en laisse aucune trace.
    const v = valeursProcedure(ctx, data);
    const vv = valeursVersion(data);
    verifierCode(null, v.code, societe);
    const at = hsNow();
    const p = nouvelleProcedure({ ...v, company_id: societe }, ctx.user.id, at);
    nouvelleVersion(p, vv, ctx.user.id, at);
    return procedureRow(ctx, p, true);
  });

  route("GET", "/hsseq/procedures/:id", DOC_READ, (ctx) => procedureRow(ctx, procedureDe(ctx, ctx.params[0]), true));

  route("PATCH", "/hsseq/procedures/:id", HSSEQ, (ctx) => {
    const p = procedureDe(ctx, ctx.params[0]);
    if (p.status === "archived") throw hsRule("invalid_transition", "Procédure archivée : réactivez-la avant de la modifier.");
    const v = valeursProcedure(ctx, ctx.body, true);
    if (v.code) verifierCode(p, v.code, p.company_id);
    ecrire("procedure", p, v, ctx.user.id);
    return procedureRow(ctx, p, true);
  });

  // Routes à segment fixe avant la route des transitions (« acknowledge », « versions » lui ressemblent).
  route("POST", "/hsseq/procedures/:id/acknowledge", null, (ctx) => {
    hsInternal(ctx);
    const p = HS.procedures.find((x) => x.id === ctx.params[0]);
    if (!p || p.status !== "published" || !enVigueur(p) || !vise(p, ctx.user)) throw new ApiError(404, "not_found", "Procédure introuvable.");
    const data = ctx.body;
    const v = enVigueur(p);
    if (data.version_id && hsId(data, "version_id") !== v.id) throw new ApiError(409, "conflict", "Une nouvelle version est en vigueur : lisez-la avant d'en accuser lecture.", { fields: ["version_id"] });
    const a = accuser("version_id", v, "procedure_version", ctx.user, heureLecture(data), sourceDe(ctx));
    return maProcedure(p, a);
  });

  route("POST", "/hsseq/procedures/:id/versions", HSSEQ, (ctx) => {
    const p = procedureDe(ctx, ctx.params[0]);
    if (p.status === "archived") throw hsRule("invalid_transition", "Procédure archivée : réactivez-la avant une nouvelle version.");
    if (brouillonDe(p)) throw hsRule("invalid_transition", "Une version en brouillon existe déjà : publiez-la ou modifiez-la.");
    exiger(ctx.body, "version", "effective_date");
    const v = valeursVersion(ctx.body);
    verifierVersion(p, v.version);
    nouvelleVersion(p, v, ctx.user.id, hsNow());
    return procedureRow(ctx, p, true);
  });

  route("PATCH", "/hsseq/procedures/:id/versions/:vid", HSSEQ, (ctx) => {
    const p = procedureDe(ctx, ctx.params[0]);
    const v = versionDe(p, ctx.params[1]);
    if (v.status !== "draft") throw hsRule("invalid_transition", "Version publiée : elle ne se modifie plus (nouvelle version).");
    const valeurs = valeursVersion(ctx.body, true);
    if (valeurs.version) verifierVersion(p, valeurs.version, v);
    ecrire("procedure_version", v, valeurs, ctx.user.id);
    return procedureRow(ctx, p, true);
  });

  route("POST", "/hsseq/procedures/:id/versions/:vid/publish", HSSEQ, (ctx) => {
    const p = procedureDe(ctx, ctx.params[0]);
    publierVersion(p, versionDe(p, ctx.params[1]), ctx.user.id, hsNow());
    return procedureRow(ctx, p, true);
  });

  route("POST", "/hsseq/procedures/:id/:action", HSSEQ, (ctx) => {
    const t = ctx.params[1];
    if (!["remind", "archive", "reactivate"].includes(t)) throw new ApiError(404, "not_found", "Transition inconnue.");
    const p = procedureDe(ctx, ctx.params[0]);
    if (!transitionsProcedure(p).includes(t)) throw hsRule("invalid_transition", `Transition « ${t} » impossible depuis l'état « ${STATUTS_PROCEDURE[p.status]} ».`);
    const by = ctx.user.id;
    const at = hsNow();
    if (t === "remind") return { ...procedureRow(ctx, p, true), reminded: relancerVersion(p, enVigueur(p), at) };
    const motif = exigerMotif(ctx.body, t === "archive" ? "de l'archivage" : "de la réactivation");
    if (t === "archive") {
      ecrire("procedure", p, { status: "archived" }, by, at);
      p.archive_reason = motif;
    } else {
      ecrire("procedure", p, { status: p.current_version_id ? "published" : "draft" }, by, at);
      p.archive_reason = null;
    }
    hsLog("procedure", p.id, by, t, null, null, null, at, motif);
    return procedureRow(ctx, p, true);
  });

  /* ─── Routes : alertes et retours d'expérience ────────────────────────── */

  route("GET", "/hsseq/bulletins", DOC_READ, (ctx) => {
    const q = ctx.query;
    if (q.sort && !["published_at", "-published_at"].includes(q.sort)) throw hsBad("Tri inconnu.", ["sort"]);
    const ids = societes(ctx, q);
    const statuts = hsList(q.status);
    const natures = hsList(q.kind);
    const lignes = HS.bulletins
      .filter((b) => ids.includes(b.company_id) && (hsFull(ctx) || b.status !== "draft") && (!statuts || statuts.includes(b.status)) && (!natures || natures.includes(b.kind)) && lisibleAlerte(ctx, b))
      .sort(parDiffusion);
    const counts = { by_status: Object.fromEntries(Object.keys(STATUTS_ALERTE).map((s) => [s, lignes.filter((b) => b.status === s).length])) };
    return hsPage(ctx, lignes, counts, (b) => alerteRow(ctx, b));
  });

  route("POST", "/hsseq/bulletins", HSSEQ, (ctx) => {
    const data = ctx.body;
    exiger(data, "title", "body");
    const societe = data.company_id ? societes(ctx, { company_id: data.company_id })[0] : (ctx.company ?? 1);
    const b = nouvelleAlerte({ ...valeursAlerte(ctx, data), company_id: societe }, ctx.user.id, hsNow());
    return alerteRow(ctx, b, true);
  });

  route("GET", "/hsseq/bulletins/:id", DOC_READ, (ctx) => alerteRow(ctx, alerteDe(ctx, ctx.params[0]), true));

  route("PATCH", "/hsseq/bulletins/:id", HSSEQ, (ctx) => {
    const b = alerteDe(ctx, ctx.params[0]);
    if (b.status !== "draft") throw hsRule("invalid_transition", "Alerte diffusée : elle ne se modifie plus.");
    ecrire("bulletin", b, valeursAlerte(ctx, ctx.body, true), ctx.user.id);
    return alerteRow(ctx, b, true);
  });

  route("POST", "/hsseq/bulletins/:id/acknowledge", null, (ctx) => {
    hsInternal(ctx);
    const b = HS.bulletins.find((x) => x.id === ctx.params[0]);
    if (!b || b.status !== "published" || !vise(b, ctx.user)) throw new ApiError(404, "not_found", "Alerte introuvable.");
    const a = accuser("bulletin_id", b, "bulletin", ctx.user, heureLecture(ctx.body), sourceDe(ctx));
    return monAlerte(b, a);
  });

  route("POST", "/hsseq/bulletins/:id/:action", HSSEQ, (ctx) => {
    const t = ctx.params[1];
    if (!["publish", "remind", "archive"].includes(t)) throw new ApiError(404, "not_found", "Transition inconnue.");
    const b = alerteDe(ctx, ctx.params[0]);
    if (!transitionsAlerte(b).includes(t)) throw hsRule("invalid_transition", `Transition « ${t} » impossible depuis l'état « ${STATUTS_ALERTE[b.status]} ».`);
    const by = ctx.user.id;
    const at = hsNow();
    if (t === "publish") diffuserAlerte(b, by, at);
    else if (t === "remind") return { ...alerteRow(ctx, b, true), reminded: relancerAlerte(b, at) };
    else {
      const motif = exigerMotif(ctx.body, "de l'archivage");
      ecrire("bulletin", b, { status: "archived" }, by, at);
      b.archive_reason = motif;
      hsLog("bulletin", b.id, by, "archive", null, null, null, at, motif);
    }
    return alerteRow(ctx, b, true);
  });

  /* ─── Routes : plans d'intervention ───────────────────────────────────── */

  route("GET", "/hsseq/emergency-plans", PLAN_READ, (ctx) => {
    const q = ctx.query;
    const lignes = trier(selectionPlans(ctx, q), q.sort, { site: (pl) => pl.site_id, scenario: (pl) => pl.scenario }, "site");
    return hsPage(ctx, lignes, {}, (pl) => planRow(ctx, pl));
  });

  route("GET", "/hsseq/emergency-plans/:id", PLAN_READ, (ctx) => planRow(ctx, planLu(ctx, ctx.params[0]), true));

  route("POST", "/hsseq/emergency-plans", HSSEQ, (ctx) => {
    const data = ctx.body;
    exiger(data, "site_id", "scenario", "title", "response");
    const site = siteDe(ctx, data);
    const pl = nouveauPlan({ ...valeursPlan(ctx, data), site_id: site.id }, ctx.user.id, hsNow());
    return planRow(ctx, pl, true);
  });

  route("PATCH", "/hsseq/emergency-plans/:id", HSSEQ, (ctx) => {
    const pl = planLu(ctx, ctx.params[0]);
    const data = ctx.body;
    const v = valeursPlan(ctx, data, true);
    if (data.site_id) v.site_id = siteDe(ctx, data).id;
    verifierPlanUnique({ ...pl, ...v });
    ecrire("emergency_plan", pl, v, ctx.user.id);
    // Site et scénario des exercices : champs reliés au plan, stockés (related store du noyau).
    for (const d of HS.drills.filter((x) => x.plan_id === pl.id)) Object.assign(d, { site_id: pl.site_id, scenario: pl.scenario, company_id: pl.company_id });
    return planRow(ctx, pl, true);
  });

  route("POST", "/hsseq/emergency-plans/:id/drills", HSSEQ, (ctx) => {
    const pl = planLu(ctx, ctx.params[0]);
    if (!pl.active) throw hsRule("invalid_transition", "Plan archivé : pas de nouvel exercice.");
    const d = nouvelExercice(pl, valeursExercice(ctx.body), ctx.user.id, hsNow());
    return exerciceRow(ctx, d, true);
  });

  /* ─── Routes : exercices ──────────────────────────────────────────────── */

  route("GET", "/hsseq/drills", PLAN_READ, (ctx) => {
    const q = ctx.query;
    const selection = selectionExercices(ctx, q);
    const counts = {
      by_status: Object.fromEntries(Object.keys(STATUTS_EXERCICE).map((s) => [s, selection.filter((d) => d.status === s).length])),
      overdue: selection.filter((d) => d.status === "planned" && d.planned_date < TODAY).length,
    };
    return hsPage(ctx, trier(selection, q.sort, { planned_date: (d) => d.planned_date }, "-planned_date"), counts, (d) => exerciceRow(ctx, d));
  });

  route("GET", "/hsseq/drills/:id", PLAN_READ, (ctx) => exerciceRow(ctx, exerciceLu(ctx, ctx.params[0]), true));

  route("PATCH", "/hsseq/drills/:id", HSSEQ, (ctx) => {
    const d = exerciceLu(ctx, ctx.params[0]);
    if (d.status === "cancelled") throw hsRule("invalid_transition", "Exercice annulé : il ne se modifie plus.");
    ecrire("drill", d, valeursExercice(ctx.body, true), ctx.user.id);
    return exerciceRow(ctx, d, true);
  });

  route("POST", "/hsseq/drills/:id/:action", HSSEQ, (ctx) => {
    const t = ctx.params[1];
    if (!["perform", "cancel", "reopen"].includes(t)) throw new ApiError(404, "not_found", "Transition inconnue.");
    const d = exerciceLu(ctx, ctx.params[0]);
    const permises = { planned: ["perform", "cancel"], done: ["reopen"], cancelled: [] }[d.status];
    if (!permises.includes(t)) throw hsRule("invalid_transition", `Transition « ${t} » impossible depuis l'état « ${STATUTS_EXERCICE[d.status]} ».`);
    const data = ctx.body;
    const by = ctx.user.id;
    const at = hsNow();
    if (t === "perform") {
      const le = jour(data, "performed_date") ?? TODAY;
      if (le > TODAY) throw hsRule("invalid_parameter", "Un exercice se déclare réalisé à une date passée ou du jour.", { fields: ["performed_date"] }, 400);
      const bilan = (hsText(data, "debrief", 8000) ?? d.debrief ?? "").trim();
      if (!bilan) throw hsRule("debrief_required", "Le bilan de l'exercice est obligatoire.", { fields: ["debrief"] });
      const valeurs = { status: "done", performed_date: le, debrief: bilan };
      const participants = hsId(data, "participants_count");
      if (participants !== null) valeurs.participants_count = Math.max(participants, 0);
      ecrire("drill", d, valeurs, by, at);
      hsLog("drill", d.id, by, "perform", null, null, null, at);
    } else {
      const motif = exigerMotif(data, t === "cancel" ? "de l'annulation" : "de la réouverture");
      if (t === "cancel") ecrire("drill", d, { status: "cancelled", cancel_reason: motif }, by, at);
      else {
        ecrire("drill", d, { status: "planned" }, by, at);
        d.reopen_reason = motif;
      }
      hsLog("drill", d.id, by, t, null, null, null, at, motif);
    }
    return exerciceRow(ctx, d, true);
  });

  /* ─── Routes : annuaire de crise ──────────────────────────────────────── */

  route("GET", "/hsseq/crisis-contacts", PLAN_READ, (ctx) => selectionContacts(ctx, ctx.query).map((c) => contactRow(ctx, c)));

  route("POST", "/hsseq/crisis-contacts", HSSEQ, (ctx) => {
    const data = ctx.body;
    exiger(data, "function", "name", "phone");
    const v = valeursContact(ctx, data);
    const societe = v.site_id ? hsSite(v.site_id).company_id : data.company_id ? societes(ctx, { company_id: data.company_id })[0] : (ctx.company ?? 1);
    return contactRow(ctx, nouveauContact({ ...v, company_id: societe }, ctx.user.id, hsNow()));
  });

  route("PATCH", "/hsseq/crisis-contacts/:id", HSSEQ, (ctx) => {
    const c = HS.crisisContacts.find((x) => x.id === ctx.params[0]);
    if (!c || !ctx.user.companies.includes(c.company_id)) throw new ApiError(404, "not_found", "Contact introuvable.");
    ecrire("crisis_contact", c, valeursContact(ctx, ctx.body, true), ctx.user.id);
    return contactRow(ctx, c);
  });

  /* ─── Données fictives ────────────────────────────────────────────────── */

  try {
    semer();
  } catch (e) {
    console.error("Maquette HSSEQ, documents et urgences : données fictives incomplètes.", e);
  }

  function semer() {
    const hsseq = 16;
    const compteDe = (id) => USERS.find((u) => u.id === id);
    const pdf = (objet, id, nom, titre, lignes, at, by = hsseq) => hsAttach(objet, id, by, nom, "application/pdf", pdfFictif(titre, lignes), { created_at: at, role: objet === "drill" ? "evidence" : "document" });
    const lire = (cle, cible, modele, userId, at, source = "web") => {
      const u = compteDe(userId);
      if (u && vise(modele === "procedure_version" ? HS.procedures.find((p) => p.id === cible.procedure_id) : cible, u)) accuser(cle, cible, modele, u, at, source, at);
    };

    /* Annuaire de crise : contacts communs, puis ceux de chaque site. */
    const contacts = {};
    const CONTACTS = [
      ["dg", null, 1, "Directeur général", "Saïdou Barry", "EGUITRA GROUP", "+224 622 40 10 01", "+224 664 40 10 01", "s.barry@eguitra.example", "Prévenu de tout événement de criticité élevée, de jour comme de nuit."],
      ["hsseq", null, 2, "Responsable HSSEQ", "Fanta Kourouma", "EGUITRA GROUP", "+224 622 40 10 16", null, "f.kourouma@eguitra.example", "Astreinte HSSEQ joignable 24 heures sur 24."],
      ["assureur", null, 8, "Assureur, déclaration de sinistre", "Cellule sinistres transport", "Assurances du Golfe de Guinée", "+224 620 55 71 00", null, "sinistres@agg-assurances.example", "Déclaration sous 48 heures ; police flotte FL-2026-0117."],
      ["pompiers1", 1, 1, "Sapeurs-pompiers", "Permanence de la caserne de Matoto", "Protection civile", "+224 620 18 18 01", null, null, "Annoncer « dépôt d'hydrocarbures » : un engin mousse est engagé."],
      ["parc1", 1, 2, "Chef de parc", "Mamadou Bah", "EGUITRA GROUP", "+224 622 40 10 12", "+224 655 40 10 12", "parc.matoto@eguitra.example", null],
      ["gendarmerie1", 1, 3, "Gendarmerie", "Brigade de gendarmerie de Matoto", "Gendarmerie nationale", "+224 620 12 20 01", null, null, null],
      ["urgences1", 1, 4, "Urgences médicales", "Service des urgences", "Clinique de Matoto", "+224 621 30 45 60", null, null, "Ouvert 24 heures sur 24 ; brûlés orientés vers le centre hospitalier de Conakry."],
      ["base2", 2, 1, "Chef de base", "Sékou Condé", "EGUITRA GROUP", "+224 622 40 10 18", null, "parc.boffa@eguitra.example", null],
      ["mine2", 2, 2, "Sécurité de la concession", "PC sécurité de la mine", "Compagnie minière de Boffa", "+224 628 77 00 15", null, null, "Canal radio 3 sur la piste ; ce numéro hors de la piste."],
      ["sante2", 2, 3, "Centre de santé", "Service des urgences", "Centre de santé de Boké", "+224 620 26 31 10", null, null, "Prévenir avant toute évacuation : 1 h 30 de route depuis la base."],
      ["gendarmerie2", 2, 4, "Gendarmerie", "Brigade de gendarmerie de Boffa", "Gendarmerie nationale", "+224 620 12 20 07", null, null, null],
      ["pompiers2", 2, 5, "Sapeurs-pompiers", "Poste de secours de Boké", "Protection civile", "+224 620 18 18 07", null, null, null],
      ["adjoint2", 2, 6, "Chef de base adjoint", "Lansana Soumaoro", "EGUITRA GROUP", "+224 622 40 10 27", null, null, "A quitté la base en septembre 2026."],
    ];
    for (const [cle, site, ordre, fonction, nom, organisme, tel, tel2, courriel, note] of CONTACTS) {
      contacts[cle] = nouveauContact({ site_id: site, call_order: ordre, function: fonction, name: nom, organization: organisme, phone: tel, phone2: tel2, email: courriel, note }, hsseq, "2026-01-08T09:00:00Z");
    }
    ecrire("crisis_contact", contacts.adjoint2, { active: false }, hsseq, "2026-09-18T10:00:00Z");

    /* Procédures : versions, documents, publications, lectures. */
    const PROCEDURES = [
      {
        code: "PR-HSE-001", title: "Dépotage d'une citerne chez le client", domain: "environment", sites: [1], publics: ["conducteur", "exploitation"],
        description: "Opérations du conducteur et du client, de l'arrivée sur le site de livraison à la fermeture des vannes : balisage, mise à la terre, contrôle du flexible, bac de rétention, surveillance continue, jaugeage de fin.",
        versions: [
          ["1", "2025-11-03", "Première édition.", "2025-10-28T09:00:00Z"],
          ["2", "2026-03-02", "Mise à la terre avant tout raccordement ; moteur arrêté pendant tout le dépotage.", "2026-02-26T10:15:00Z"],
          ["3", "2026-09-15", "Bac de rétention mobile obligatoire sous le raccord ; contrôle visuel du flexible avant chaque dépotage ; conduite à tenir en cas de fuite renvoyée à PR-HSE-004.", "2026-09-11T08:30:00Z"],
        ],
        lectures: [[17, "2026-09-12T19:42:00Z", "terrain"], [12, "2026-09-12T07:10:00Z"]],
      },
      {
        code: "PR-HSE-002", title: "Chargement d'une citerne au dépôt pétrolier", domain: "safety", sites: [1], publics: ["conducteur", "exploitation", "hsseq"],
        description: "Du contrôle d'accès au dépôt à la sortie de la citerne plombée : stationnement, mise à la terre, chargement en source, surveillance du remplissage, plombage et documents de transport.",
        versions: [["1", "2026-02-02", "Première édition.", "2026-01-28T11:00:00Z"]],
        brouillon: ["2", "2026-11-02", "Remplissage arrêté à 95 % de la capacité du compartiment ; jaugeage contrôlé par le chef de quai avant le plombage, à la suite du débordement d'août.", true],
        lectures: [[17, "2026-01-30T18:05:00Z", "terrain"], [12, "2026-01-29T08:20:00Z"], [2, "2026-02-03T09:40:00Z"], [16, "2026-01-28T11:30:00Z"]],
      },
      {
        code: "PR-HSE-003", title: "Conduite de nuit, temps de conduite et repos", domain: "safety", sites: [], publics: ["conducteur", "exploitation"],
        description: "Pas de circulation entre 20 h et 5 h hors dérogation, conduite limitée à 9 h par jour, pause de 45 minutes toutes les 4 h 30, repos quotidien de 11 h ; plan de trajet et points d'arrêt autorisés.",
        versions: [
          ["1", "2025-12-01", "Première édition.", "2025-11-25T14:00:00Z"],
          ["2", "2026-06-01", "Plage de nuit portée de 21 h-5 h à 20 h-5 h après deux sorties de route ; points d'arrêt de la RN3 mis à jour.", "2026-05-27T15:00:00Z"],
        ],
        lectures: [[17, "2026-05-28T06:15:00Z", "terrain"], [12, "2026-05-27T16:02:00Z"], [18, "2026-05-28T07:30:00Z"], [11, "2026-05-29T08:45:00Z"]],
      },
      {
        code: "PR-HSE-004", title: "Intervention sur un épandage d'hydrocarbures", domain: "environment", sites: [], publics: ["conducteur", "exploitation", "hsseq", "direction"],
        description: "Conduite à tenir en cas de fuite ou d'épandage, sur la route, au dépôt ou chez le client : arrêt, alerte, balisage, confinement avec le kit antidéversement, récupération et évacuation des terres souillées, déclaration de l'événement.",
        versions: [["1", "2026-10-12", "Première édition, issue du retour d'expérience de mai et de l'exercice de mars.", "2026-10-08T14:20:00Z", true]],
        lectures: [[12, "2026-10-09T07:55:00Z"], [18, "2026-10-10T06:40:00Z"]],
      },
      {
        code: "PR-HSE-005", title: "Circulation et basculement sur la piste minière", domain: "safety", sites: [2], publics: ["conducteur", "exploitation"],
        description: "Règles de la concession : priorité aux engins, radio en permanence, 30 km/h au plus, croisement aux aires prévues, basculement sur aire nivelée, jamais en dévers ni par vent fort.",
        versions: [["1", "2026-04-01", "Première édition, validée avec la sécurité de la concession.", "2026-03-27T09:00:00Z"]],
        lectures: [[18, "2026-03-27T10:30:00Z"]],
        owner: 18,
      },
      {
        code: "PR-HSE-006", title: "Port des équipements de protection individuelle", domain: "health", sites: [], publics: ["conducteur", "exploitation", "rh"],
        description: "Équipements exigés par poste : chaussures de sécurité, gilet haute visibilité, gants, lunettes, masque à cartouches au jaugeage, vêtements antistatiques au dépôt.",
        versions: [],
        brouillon: ["1", "2026-11-15", "Première édition.", false],
      },
      {
        code: "PR-QUA-001", title: "Prélèvement et conservation des échantillons de produit", domain: "quality", sites: [1], publics: ["conducteur", "exploitation"],
        description: "Prélèvement contradictoire au chargement, scellé, étiquetage et conservation trois mois des échantillons témoins.",
        versions: [["1", "2025-09-01", "Première édition.", "2025-08-27T10:00:00Z"]],
        lectures: [[17, "2025-08-28T18:00:00Z", "terrain"], [12, "2025-08-27T15:00:00Z"]],
        archive: ["2026-09-03T09:00:00Z", "Remplacée par la procédure d'échantillonnage du dépôt pétrolier, appliquée par le dépôt depuis le 1er septembre 2026."],
      },
    ];
    for (const s of PROCEDURES) {
      const cree = s.versions[0]?.[3] ?? "2026-10-13T10:00:00Z";
      const p = nouvelleProcedure({ code: s.code, title: s.title, domain: s.domain, description: s.description, site_ids: s.sites, audience_profiles: s.publics, owner_id: s.owner ?? hsseq }, hsseq, cree);
      const document = (v, at) => {
        const nom = `${s.code}_v${v.version}.pdf`;
        const lignes = ["EGUITRA GROUP · NIMOVA HSSEQ", "", `Procédure ${s.code}, version ${v.version}`, `En vigueur le ${fr(v.effective_date)}`, "", ...couper(s.description), "", ...couper(`Changements : ${v.change_summary ?? ""}`), "", "Document fictif de la maquette."];
        pdf("procedure_version", v.id, nom, s.title, lignes, at);
      };
      for (const [numero, effet, changements, publiee, prevenir] of s.versions) {
        const v = nouvelleVersion(p, { version: numero, effective_date: effet, change_summary: changements }, hsseq, publiee);
        document(v, publiee);
        publierVersion(p, v, hsseq, publiee, Boolean(prevenir));
      }
      if (s.brouillon) {
        const [numero, effet, changements, avecDocument] = s.brouillon;
        const v = nouvelleVersion(p, { version: numero, effective_date: effet, change_summary: changements }, hsseq, "2026-10-13T10:00:00Z");
        if (avecDocument) document(v, "2026-10-13T10:05:00Z");
      }
      const courante = enVigueur(p);
      if (courante) for (const [userId, at, source] of s.lectures ?? []) lire("version_id", courante, "procedure_version", userId, at, source);
      if (s.archive) {
        ecrire("procedure", p, { status: "archived" }, hsseq, s.archive[0]);
        p.archive_reason = s.archive[1];
        hsLog("procedure", p.id, hsseq, "archive", null, null, null, s.archive[0], s.archive[1]);
      }
    }
    // Relance hebdomadaire des lecteurs en retard (_cron_reminders) : la dernière date pour chaque version en vigueur.
    for (const p of HS.procedures.filter((x) => x.status === "published")) {
      const v = enVigueur(p);
      if (v && v.published_at.slice(0, 10) <= "2026-10-08" && cibles(p).some((u) => !accuseDe("version_id", v.id, u.id))) v.reminded_on = "2026-10-12";
    }

    /* Alertes flash et retours d'expérience, par ordre de création. */
    const renversement = HS.events.find((e) => e.title.startsWith("Renversement de la citerne"));
    const debordement = HS.events.find((e) => e.title.startsWith("Débordement au chargement"));
    const ALERTES = [
      {
        kind: "flash_alert", cree: "2026-02-10T08:00:00Z", publiee: "2026-02-10T09:30:00Z", publics: ["conducteur", "exploitation"], sites: [],
        title: "Pneus rechapés interdits sur l'essieu directeur",
        body: "Un pneu rechapé monté sur l'essieu directeur d'un tracteur a perdu sa bande de roulement sur la RN1, à pleine charge ; le conducteur a gardé le contrôle et s'est arrêté sans dommage. Le contrôle du lot a montré trois autres pneus rechapés montés à l'avant.",
        key_messages: "Aucun pneu rechapé sur l'essieu directeur, quel que soit son état.\nVérifiez le marquage des pneus avant au contrôle avant départ.",
        lectures: [[17, "2026-02-10T18:20:00Z", "terrain"], [12, "2026-02-10T10:05:00Z"], [18, "2026-02-11T07:15:00Z"], [11, "2026-02-12T08:00:00Z"], [19, "2026-02-10T14:30:00Z"]],
        archive: ["2026-07-01T10:00:00Z", "Consigne reprise dans la procédure d'entretien des pneumatiques : l'alerte n'a plus lieu d'être diffusée."],
      },
      {
        kind: "flash_alert", cree: "2026-05-19T08:00:00Z", publiee: "2026-05-19T10:30:00Z", publics: ["conducteur", "exploitation"], sites: [], event: renversement,
        title: "Citerne couchée dans un virage de la RN3 : la vitesse se règle avant le virage",
        body: "Le 17 mai, sur la route de Boké, une citerne chargée de gasoil s'est couchée à l'entrée d'un virage, après un freinage appuyé sur une chaussée dégradée. Le conducteur, blessé à l'épaule, a été pris en charge au centre de santé ; environ 6 000 litres se sont répandus sur l'accotement et ont été confinés avec la gendarmerie.",
        key_messages: "Réduisez la vitesse avant l'entrée du virage, jamais pendant : 40 km/h au plus dans les virages signalés de la RN3.\nUne citerne pleine a un centre de gravité haut : un freinage appuyé en courbe suffit à la coucher.\nSignalez au chef de parc tout nid-de-poule ou accotement effondré relevé sur l'itinéraire.",
        lectures: [[17, "2026-05-19T18:05:00Z", "terrain"], [12, "2026-05-19T11:02:00Z"], [18, "2026-05-20T07:40:00Z"], [11, "2026-05-21T08:15:00Z"]],
      },
      {
        kind: "lesson", cree: "2026-08-29T15:00:00Z", publiee: "2026-09-02T09:00:00Z", publics: ["conducteur", "exploitation", "hsseq"], sites: [1], event: debordement,
        title: "Débordement au chargement : le jaugeage se surveille jusqu'à la dernière minute",
        body: "Le 22 août, au dépôt de Conakry, un compartiment a débordé par le dôme en fin de chargement : environ 300 litres d'essence sur la dalle, absorbés avec le kit antidéversement, sans blessé ni départ de feu. Le conducteur s'était éloigné du poste pour présenter ses documents pendant le remplissage du dernier compartiment.",
        key_messages: "Restez au poste de chargement pendant tout le remplissage ; présentez vos documents avant ou après.\nArrêtez le remplissage à 95 % de la capacité du compartiment et contrôlez le jaugeage.\nUn kit antidéversement complet se trouve à chaque quai : vérifiez-le avant de charger.",
        lectures: [[16, "2026-09-02T09:20:00Z"], [12, "2026-09-03T07:45:00Z"], [17, "2026-09-04T19:30:00Z", "terrain"]],
      },
      {
        kind: "flash_alert", cree: "2026-10-10T07:00:00Z", publiee: "2026-10-10T07:45:00Z", publics: ["conducteur", "exploitation"], sites: [2], prevenir: true,
        title: "Piste minière détrempée : croisement des engins aux seules aires prévues",
        body: "Avec les fortes pluies de la semaine, l'accotement de la piste entre la fosse 3 et la bascule s'est affaissé sur une centaine de mètres. Mardi, une benne qui s'était rangée au bord pour laisser passer un tombereau de la mine a glissé vers le fossé ; elle a été dégagée sans dommage ni blessé.",
        key_messages: "Ne vous rangez jamais sur l'accotement : croisez aux aires prévues, signalées par les panneaux jaunes.\nAnnoncez-vous à la radio avant chaque aire de croisement.\nVitesse limitée à 20 km/h sur la piste jusqu'à nouvel ordre.",
        lectures: [[18, "2026-10-10T08:20:00Z"]],
      },
      {
        kind: "lesson", cree: "2026-10-14T16:30:00Z", publics: ["conducteur", "exploitation"], sites: [],
        title: "Départ de feu au compartiment moteur au retour de Kindia",
        body: "Le 3 octobre, au retour de Kindia, Alseny Keïta a remarqué une fumée sous la cabine de l'ensemble ER-07 et s'est arrêté sur l'accotement. Il a coupé le moteur, ouvert le capot et éteint un départ de feu sur le collecteur d'échappement avec l'extincteur de bord. La gaine d'un faisceau électrique, mal fixée, frottait sur le collecteur.",
        key_messages: "Coupez le moteur et éloignez la citerne de toute habitation avant d'ouvrir le capot.\nVérifiez la charge de l'extincteur de cabine au contrôle avant départ.\nSignalez tout faisceau électrique qui pend ou frotte.",
      },
    ];
    for (const s of ALERTES) {
      const b = nouvelleAlerte({ kind: s.kind, title: s.title, body: s.body, key_messages: s.key_messages, event_id: s.event?.id ?? null, audience_profiles: s.publics, site_ids: s.sites }, hsseq, s.cree);
      if (!s.publiee) continue;
      diffuserAlerte(b, hsseq, s.publiee, Boolean(s.prevenir));
      for (const [userId, at, source] of s.lectures ?? []) lire("bulletin_id", b, "bulletin", userId, at, source);
      if (s.archive) {
        ecrire("bulletin", b, { status: "archived" }, hsseq, s.archive[0]);
        b.archive_reason = s.archive[1];
        hsLog("bulletin", b.id, hsseq, "archive", null, null, null, s.archive[0], s.archive[1]);
      }
    }

    /* Plans d'intervention : un plan par site et par scénario, documents et exercices. */
    const PLANS = [
      {
        site: 1, scenario: "spill", title: "Déversement d'hydrocarbures au parc et au dépotage", review: "2027-03-31", cree: "2026-01-15T09:00:00Z",
        contacts: ["pompiers1", "parc1", "gendarmerie1", "dg", "hsseq"],
        response: "1. Arrêter le pompage ou le moteur, couper le coupe-batterie, éloigner toute source d'inflammation.\n2. Donner l'alerte : chef de parc, puis Responsable HSSEQ ; sapeurs-pompiers si le produit atteint un caniveau ou une habitation.\n3. Baliser une zone de 50 mètres et faire évacuer les personnes non nécessaires.\n4. Contenir avec le kit antidéversement : boudins autour de la flaque, obturateur sur le regard le plus proche.\n5. Absorber, récupérer le produit en fûts, mettre les terres souillées en big-bag.\n6. Déclarer l'événement dans NIMOVA et photographier la zone avant et après.",
        resources: "Deux kits antidéversement de 240 litres (aire de lavage et quai de chargement), 20 sacs d'absorbant minéral, obturateurs de regard, barrage flottant de 10 mètres, pelles antiétincelles, fûts de récupération et big-bags.",
      },
      {
        site: 1, scenario: "fire", title: "Incendie d'une citerne ou d'un bâtiment au parc de Matoto", review: "2026-09-30", cree: "2026-01-15T09:30:00Z",
        contacts: ["pompiers1", "parc1", "gendarmerie1", "urgences1", "dg", "hsseq"],
        response: "1. Donner l'alerte à la voix et à la sirène, appeler les sapeurs-pompiers.\n2. Couper l'alimentation électrique générale du parc et les coupe-batteries des ensembles proches.\n3. Attaquer un départ de feu avec les extincteurs à poudre de 50 kg, jamais seul, toujours dos au vent.\n4. Évacuer vers le point de rassemblement de l'entrée et faire l'appel des présents.\n5. Écarter les citernes voisines si cela peut se faire sans risque.\n6. Accueillir les sapeurs-pompiers et leur remettre le plan du parc et la liste des produits présents.",
        resources: "Quatre extincteurs à poudre de 50 kg sur roues, douze extincteurs de 9 kg, poteau incendie à l'entrée, réserve d'eau de 30 m³, sirène et point de rassemblement balisé.",
      },
      {
        site: 2, scenario: "road_accident", title: "Accident d'une benne sur la piste minière ou la RN3", review: "2027-06-30", cree: "2026-03-05T08:00:00Z",
        contacts: ["mine2", "base2", "gendarmerie2", "sante2", "hsseq"],
        response: "1. Sécuriser : feux de détresse, triangles à 100 mètres, moteur coupé.\n2. Porter secours sans déplacer un blessé, sauf danger immédiat.\n3. Alerter le PC sécurité de la mine par radio sur la piste, la gendarmerie sur la route, puis le chef de base.\n4. Faire évacuer un blessé vers le centre de santé de Boké.\n5. Baliser la benne ; aucun relevage avant l'accord du chef de base et de la gendarmerie.\n6. Déclarer l'événement dans NIMOVA.",
        resources: "Trousse de secours et triangles dans chaque benne, radio de la mine, brancard et trousse d'urgence au poste de la base, véhicule de liaison.",
      },
      {
        site: 2, scenario: "medical", title: "Urgence médicale à la base de Boffa", review: "2027-01-31", cree: "2026-03-05T08:30:00Z",
        contacts: ["base2", "sante2", "hsseq"],
        response: "1. Protéger la victime et soi-même, alerter le chef de base.\n2. Appliquer les gestes de premiers secours ; le secouriste de la base prend la direction des soins.\n3. Appeler le centre de santé de Boké pour annoncer l'arrivée de la victime.\n4. Évacuer avec le véhicule de liaison, accompagné d'un secouriste.\n5. Prévenir le Responsable HSSEQ ; le chef de base prévient la famille.",
        resources: "Deux secouristes formés par poste, trousse d'urgence et défibrillateur au poste de la base, véhicule de liaison équipé d'un brancard.",
      },
      {
        site: 1, scenario: "intrusion", title: "Intrusion de nuit au parc de Matoto", review: null, cree: "2026-01-20T09:00:00Z", archive: "2026-08-01T10:00:00Z",
        contacts: ["gendarmerie1", "parc1"],
        response: "1. Ne pas intervenir seul : le gardien se met à l'abri et appelle la gendarmerie.\n2. Allumer l'éclairage du parc, prévenir le chef de parc.\n3. Relever les ensembles touchés et les niveaux de carburant au matin.",
        resources: "Éclairage du parc, poste de garde, registre des rondes.",
      },
    ];
    const plans = PLANS.map((s) => {
      const pl = nouveauPlan({ site_id: s.site, scenario: s.scenario, title: s.title, response: s.response, resources: s.resources, review_date: s.review, contact_ids: s.contacts.map((c) => contacts[c].id) }, hsseq, s.cree);
      pdf("emergency_plan", pl.id, `${pl.reference.replace("/", "-")}_plan.pdf`, s.title, ["EGUITRA GROUP · NIMOVA HSSEQ", "", `Plan d'intervention ${pl.reference}, ${hsSite(s.site)?.name ?? ""}`, `Scénario : ${SCENARIOS[s.scenario]}`, "", ...couper(s.response), "", "Document fictif de la maquette."], s.cree);
      if (s.archive) ecrire("emergency_plan", pl, { active: false }, hsseq, s.archive);
      return pl;
    });

    /* Exercices, par ordre de création. */
    const EXERCICES = [
      {
        plan: 0, prevu: "2026-03-12", fait: "2026-03-12", participants: 14, duree: 45, comptes: [12, 16, 19], cree: "2026-02-16T09:00:00Z",
        bilan: "Alerte donnée en 2 minutes, zone balisée en 6 minutes. Le kit du quai 2 était incomplet : boudins et obturateur manquants, remplacés par le kit de l'aire de lavage. Deux conducteurs ne savaient pas où se trouve l'obturateur de regard.",
        actions: [
          { description: "Compléter le kit antidéversement du quai 2 et poser un inventaire plastifié sur chaque kit", owner: 12, due: "2026-03-31", status: "closed", fait: "2026-03-27" },
          { description: "Former les conducteurs à la pose de l'obturateur de regard, par groupes de six", owner: 16, due: "2026-11-30", status: "in_progress" },
        ],
      },
      {
        plan: 1, prevu: "2026-04-23", fait: "2026-04-23", participants: 11, duree: 60, comptes: [12, 16], cree: "2026-03-30T09:00:00Z",
        bilan: "Évacuation complète en 4 minutes, appel des présents fait. La sirène n'est pas audible depuis l'atelier pneumatique ; un extincteur de 50 kg avait son manomètre dans la zone rouge.",
        actions: [{ description: "Installer un relais de sirène dans l'atelier pneumatique", owner: 19, due: "2026-07-31", status: "closed", fait: "2026-07-20" }],
      },
      {
        plan: 2, prevu: "2026-06-18", fait: "2026-06-18", participants: 9, duree: 50, comptes: [18, 16], cree: "2026-05-25T09:00:00Z",
        bilan: "Message radio passé en 1 minute, PC sécurité sur place en 12 minutes. Le brancard du poste n'avait pas de sangles ; la liste des numéros affichée dans les bennes datait de 2025.",
        actions: [{ description: "Mettre à jour la fiche des numéros d'urgence affichée dans les six bennes", owner: 18, due: "2026-07-15", status: "closed", fait: "2026-07-10" }],
      },
      { plan: 2, prevu: "2026-09-24", cree: "2026-08-20T09:00:00Z", annule: ["2026-09-22T08:00:00Z", "Piste fermée par la mine pour des travaux de rechargement : exercice reporté au 12 novembre."] },
      { plan: 3, prevu: "2026-10-02", cree: "2026-09-01T09:00:00Z" },
      { plan: 0, prevu: "2026-11-20", cree: "2026-09-15T09:00:00Z" },
      { plan: 1, prevu: "2026-10-08", cree: "2026-09-15T09:10:00Z" },
      { plan: 2, prevu: "2026-11-12", cree: "2026-09-22T08:10:00Z" },
    ];
    for (const s of EXERCICES) {
      const pl = plans[s.plan];
      const d = nouvelExercice(pl, { planned_date: s.prevu }, hsseq, s.cree);
      if (s.fait) {
        const at = `${s.fait}T16:00:00Z`;
        ecrire("drill", d, { participant_ids: s.comptes, duration_minutes: s.duree }, hsseq, at);
        ecrire("drill", d, { status: "done", performed_date: s.fait, debrief: s.bilan, participants_count: s.participants }, hsseq, at);
        hsLog("drill", d.id, hsseq, "perform", null, null, null, at);
        pdf("drill", d.id, `${d.reference.replaceAll("/", "-")}_compte-rendu.pdf`, `Compte rendu de l'exercice ${d.reference}`, ["EGUITRA GROUP · NIMOVA HSSEQ", "", `${pl.title}`, `Réalisé le ${fr(s.fait)}, ${s.participants} participants, ${s.duree} minutes`, "", ...couper(s.bilan), "", "Document fictif de la maquette."], at);
        if (s.plan === 0) hsAttach("drill", d.id, hsseq, `${d.reference.replaceAll("/", "-")}_photo.png`, "image/png", HS_PNG, { created_at: at, caption: "Kit du quai 2 au début de l'exercice", role: "evidence" });
        for (const a of s.actions ?? []) {
          const action = hsNewAction({ description: a.description, origin: "drill", origin_id: d.id, owner_id: a.owner, due_date: a.due, status: a.status, created_at: `${s.fait}T17:00:00Z`, created_by: hsseq, site_id: d.site_id });
          action.drill_id = d.id;
          if (a.status !== "todo") action.started_at = `${s.fait}T17:30:00Z`;
          if (a.status === "closed") Object.assign(action, { done_at: `${a.fait}T15:00:00Z`, closed_at: `${a.fait}T15:00:00Z` });
          hsLog("action", action.id, hsseq, "create", null, null, null, `${s.fait}T17:00:00Z`);
        }
      }
      if (s.annule) {
        ecrire("drill", d, { status: "cancelled", cancel_reason: s.annule[1] }, hsseq, s.annule[0]);
        hsLog("drill", d.id, hsseq, "cancel", null, null, null, s.annule[0], s.annule[1]);
      }
    }
  }
}
