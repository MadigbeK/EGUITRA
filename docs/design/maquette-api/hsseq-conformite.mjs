/**
 * Maquette du lot 2 HSSEQ : audits, constats et registre des exigences (controllers/audits.py et
 * models/audit.py du noyau, branche hsseq). Routes et données fictives ; `H` porte les références de
 * serveur.mjs (HS_REFS), appelée après le semis du lot 1.
 *
 * Tables sous H.DB.hsseq, aux noms de champs du noyau (le cockpit de la maquette les lit) :
 * - audits : title, standard, partner_id, scope, site_id, auditor_kind, auditor_user_id, auditor_name,
 *   planned_date, actual_date, status, conclusion, closed_at, closed_by, cancel_reason, reopen_reason ;
 * - findings : audit_id, reference, sequence, classification, description, requirement_id ; site_id et
 *   company_id (champs liés du noyau) et status (champ calculé stocké) sont lus à la volée ;
 * - requirements : source, standard, partner_id, source_reference, title, summary, expected_evidence,
 *   status, last_review_at, last_reviewed_by, review_comment, next_review_date.
 * Les actions d'un constat sont celles du plan d'actions (lot 1) d'origine « audit » dont origin_id est
 * le constat ; celles de la revue de direction, d'origine « review », n'ont pas de fiche d'origine.
 */

/** Lecture des audits et des constats (AUDIT_READ du noyau), bornée aux sites hors lecture complète. */
const LECTURE_AUDITS = ["admin", "direction", "hsseq", "exploitation", "auditeur"];
/** Lecture du registre des exigences (REQUIREMENT_READ) : pas le chef de parc. */
const LECTURE_EXIGENCES = ["admin", "direction", "hsseq", "auditeur"];
/** Écriture : Responsable HSSEQ seul. */
const GESTION = ["hsseq"];

const REFERENTIELS = { iso_45001: "ISO 45001", iso_14001: "ISO 14001", iso_9001: "ISO 9001", client: "Audit client ou donneur d'ordre", internal: "Audit interne" };
const ETATS_AUDIT = { planned: "Planifié", done: "Réalisé", closed: "Clos", cancelled: "Annulé" };
const AUDITEURS = { internal: "Auditeur interne", external: "Auditeur externe" };
const CLASSEMENTS = { major: "Écart majeur", minor: "Écart mineur", observation: "Observation" };
const ETATS_CONSTAT = { open: "Ouvert", closed: "Soldé" };
const SOURCES = { law: "Loi ou règlement", standard: "Norme", client_contract: "Contrat client" };
const ETATS_EXIGENCE = { compliant: "Conforme", partial: "Partiellement conforme", non_compliant: "Non conforme", not_evaluated: "Non évalué" };
const NORMES = { iso_45001: "ISO 45001", iso_14001: "ISO 14001", iso_9001: "ISO 9001", other: "Autre" };
/** Transitions permises depuis chaque état (_transitions du modèle). */
const TRANSITIONS = { planned: ["perform", "cancel"], done: ["close"], closed: ["reopen"], cancelled: [] };
/** Statuts d'une action qui laissent son constat ouvert (OPEN_ACTION). */
const ACTION_OUVERTE = ["todo", "in_progress", "to_verify"];
const TRIS_AUDITS = { planned_date: (a) => a.planned_date, reference: (a) => a.reference, status: (a) => a.status };
const TRIS_CONSTATS = { id: (f) => f.id };
const TRIS_EXIGENCES = { reference: (r) => r.reference, source: (r) => r.source, status: (r) => r.status, next_review_date: (r) => r.next_review_date ?? "9999-12-31" };
/** Champs journalisés champ par champ (_journal_fields du noyau ; le statut calculé d'un constat n'en est pas). */
const SUIVIS = {
  audit: ["title", "standard", "scope", "site_id", "auditor_kind", "auditor_user_id", "auditor_name", "planned_date", "actual_date", "status", "conclusion"],
  finding: ["classification", "description", "requirement_id"],
  requirement: ["source", "standard", "partner_id", "source_reference", "title", "summary", "expected_evidence", "status", "next_review_date"],
};
/**
 * Donneurs d'ordre fictifs : les tiers clients de serveur.mjs (PARTNERS, absent de HS_REFS), mêmes
 * identifiants et mêmes noms.
 */
const CLIENTS = { 101: "Société Minière de Boffa (démo)", 102: "Bauxite Atlantique Kamsar (démo)", 104: "Distribution Pétrolière de Kankan (démo)" };
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** PDF d'une page, texte en ASCII (police standard) : pièces jointes de la maquette. */
function pdf(titre, lignes) {
  const ascii = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, " ").replace(/[()\\]/g, (c) => `\\${c}`);
  const texte = [titre, "", ...lignes].map((l, i) => `BT /F1 ${i ? 11 : 14} Tf 56 ${780 - i * 18} Td (${ascii(l)}) Tj ET`).join("\n");
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${texte.length} >>\nstream\n${texte}\nendstream`,
  ];
  let sortie = "%PDF-1.4\n";
  const positions = objets.map((o, i) => {
    const position = sortie.length;
    sortie += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return position;
  });
  const xref = sortie.length;
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(sortie, "latin1");
}

/** Enregistre les tables et les routes du module ; appelé une fois par serveur.mjs, après seed(). */
export function enregistrerConformite(H) {
  const { route, ApiError, DB, TODAY } = H;
  const HS = DB.hsseq;
  if (!HS) {
    console.error("hsseq-conformite : DB.hsseq absent, module non chargé.");
    return;
  }
  HS.audits = [];
  HS.findings = [];
  HS.requirements = [];

  /* ─── Outils ─────────────────────────────────────────────────────────── */

  const introuvable = (message) => new ApiError(404, "not_found", message);
  const suivant = (liste) => liste.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const client = (id) => (id && CLIENTS[id] ? { id, name: CLIENTS[id] } : null);
  const estHsseq = (ctx) => H.hsIs(ctx, "hsseq");
  const lecteurExigences = (ctx) => H.hasProfile(ctx, LECTURE_EXIGENCES);
  /** Portée « fermée par défaut » (in_scope du noyau) : lecture complète, sinon les sites du compte ; un objet sans site n'est lu que des profils de lecture complète. */
  const dansPortee = (ctx, siteId) => H.hsFull(ctx) || (Boolean(siteId) && H.hsSites(ctx).includes(siteId));

  /** Date « AAAA-MM-JJ » d'un corps ou d'une requête, nulle si absente ; 400 invalid_parameter sinon. */
  function dateOuNul(data, cle) {
    const v = data[cle];
    if (v === undefined || v === null || v === "") return null;
    const s = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(`${s}T00:00:00Z`))) throw H.hsBad(`Date invalide : ${cle}.`, [cle]);
    return s;
  }
  function requis(data, ...cles) {
    const manque = cles.filter((k) => data[k] === undefined || data[k] === null || data[k] === "");
    if (manque.length) throw new ApiError(400, "missing_fields", "Champs obligatoires manquants.", { fields: manque });
  }
  /** Sociétés de travail : celles du compte, ou celle du filtre company_id (403 hors du compte). */
  function societes(ctx, q) {
    if (q.company_id === undefined || q.company_id === null || q.company_id === "" || q.company_id === "all") return ctx.user.companies;
    const c = Number(q.company_id);
    if (!Number.isInteger(c)) throw H.hsBad("Société invalide.");
    if (!ctx.user.companies.includes(c)) throw H.hsForbidden("Société non autorisée.");
    return [c];
  }

  const auditParId = (id) => HS.audits.find((a) => a.id === id) ?? null;
  const exigenceParId = (id) => HS.requirements.find((r) => r.id === id) ?? null;
  const actionsDe = (f) => HS.actions.filter((a) => a.origin === "audit" && a.origin_id === f.id);
  const constatsDe = (a) => HS.findings.filter((f) => f.audit_id === a.id).sort((x, y) => x.sequence - y.sequence || x.id - y.id);
  /** Écarts majeurs sans action (ni annulée) : ils empêchent la clôture de l'audit. */
  const majeursSansAction = (a) => constatsDe(a).filter((f) => f.classification === "major" && !actionsDe(f).some((x) => x.status !== "cancelled"));

  /** Statut d'un constat (_compute_status) : ouvert tant qu'une action l'est, ou sans action hors observation. */
  function statutConstat(f) {
    const vivantes = actionsDe(f).filter((a) => a.status !== "cancelled");
    if (vivantes.some((a) => ACTION_OUVERTE.includes(a.status))) return "open";
    if (!vivantes.length && f.classification !== "observation") return "open";
    return "closed";
  }

  /** Valeur journalisée d'un champ : nom d'une référence, code d'une sélection, date. */
  function valeurJournal(champ, v) {
    if (v === null || v === undefined || v === "") return "";
    if (champ === "site_id") return H.hsSite(v)?.name ?? "";
    if (champ === "auditor_user_id") return H.hsUser(v)?.name ?? "";
    if (champ === "partner_id") return CLIENTS[v] ?? "";
    if (champ === "requirement_id") return exigenceParId(v)?.reference ?? "";
    return String(v);
  }
  /** Écrit des valeurs et journalise chaque champ suivi qui change (write du mixin journalisé). */
  function ecrireSuivi(ctx, model, fiche, valeurs, at = H.hsNow()) {
    const avant = Object.fromEntries(SUIVIS[model].map((c) => [c, valeurJournal(c, fiche[c])]));
    Object.assign(fiche, valeurs);
    for (const c of SUIVIS[model]) {
      const apres = valeurJournal(c, fiche[c]);
      if (avant[c] !== apres) H.hsLog(model, fiche.id, ctx.user.id, "write", c, avant[c] || null, apres || null, at);
    }
  }

  /* ─── Lignes et fiches ───────────────────────────────────────────────── */

  function ligneAudit(a) {
    const constats = constatsDe(a);
    return {
      id: a.id, reference: a.reference, title: a.title, standard: a.standard, partner: client(a.partner_id),
      site: a.site_id ? H.hsSiteRef(a.site_id) : null, auditor_kind: a.auditor_kind,
      auditor: a.auditor_kind === "internal" ? H.hsUser(a.auditor_user_id) : a.auditor_name ? { id: null, name: a.auditor_name } : null,
      planned_date: a.planned_date, actual_date: a.actual_date ?? null, status: a.status,
      findings: Object.fromEntries(Object.keys(CLASSEMENTS).map((c) => [c, constats.filter((f) => f.classification === c).length])),
      open_findings: constats.filter((f) => f.status === "open").length,
    };
  }
  /** Transitions et droits du compte (audit_rights) : hsseq seul ; pas de clôture tant qu'un écart majeur n'a pas d'action. */
  function droitsAudit(ctx, a) {
    const hs = estHsseq(ctx);
    const transitions = hs ? TRANSITIONS[a.status].filter((t) => t !== "close" || !majeursSansAction(a).length) : [];
    return { transitions, rights: { can_edit: hs && ["planned", "done"].includes(a.status), can_close: transitions.includes("close"), can_approve: false } };
  }
  function ficheAudit(ctx, a) {
    const { transitions, rights } = droitsAudit(ctx, a);
    return {
      ...ligneAudit(a),
      company: { id: a.company_id, name: H.COMPANIES[a.company_id]?.name ?? "" }, scope: a.scope ?? null, conclusion: a.conclusion ?? null,
      closed_at: a.closed_at ?? null, closed_by: H.hsUser(a.closed_by), cancel_reason: a.cancel_reason ?? null, reopen_reason: a.reopen_reason ?? null,
      findings_list: constatsDe(a).map((f) => ligneConstat(ctx, f)),
      majors_without_action: majeursSansAction(a).map((f) => f.id),
      attachments: H.hsAttachments("audit", a.id), history: H.hsHistory("audit", a.id), transitions, rights,
    };
  }
  function ligneConstat(ctx, f) {
    const a = auditParId(f.audit_id);
    const r = f.requirement_id ? exigenceParId(f.requirement_id) : null;
    // origin_label au format du noyau (action_line) : référence du constat et début de sa description.
    const etiquette = `${f.reference} ${f.description.slice(0, 120)}`;
    return {
      id: f.id, reference: f.reference, audit: { id: a.id, reference: a.reference }, classification: f.classification, description: f.description,
      requirement: r ? { id: r.id, reference: r.reference, title: r.title } : null, status: f.status, site: f.site_id ? H.hsSiteRef(f.site_id) : null,
      actions: actionsDe(f).map((x) => ({ ...H.hsActionLine(x), origin_label: etiquette })),
      attachments: H.hsAttachments("finding", f.id),
      rights: { can_edit: estHsseq(ctx) && ["planned", "done"].includes(a.status), can_close: false, can_approve: false },
    };
  }
  function ligneExigence(ctx, r, detail = false) {
    const hs = estHsseq(ctx);
    const ligne = {
      id: r.id, reference: r.reference, source: r.source, standard: r.standard ?? null, partner: client(r.partner_id), source_reference: r.source_reference,
      title: r.title, summary: r.summary ?? null, expected_evidence: r.expected_evidence ?? null, status: r.status, last_review_at: r.last_review_at ?? null,
      last_reviewed_by: H.hsUser(r.last_reviewed_by), next_review_date: r.next_review_date ?? null, review_overdue: Boolean(r.next_review_date && r.next_review_date < TODAY),
      evidence: H.hsAttachments("requirement", r.id), rights: { can_edit: hs, can_close: false, can_approve: hs },
    };
    if (!detail) return ligne;
    return {
      ...ligne, review_comment: r.review_comment ?? null,
      findings: HS.findings.filter((f) => f.requirement_id === r.id && dansPortee(ctx, f.site_id)).map((f) => ({ id: f.id, reference: f.reference, classification: f.classification, status: f.status })),
      history: H.hsHistory("requirement", r.id), transitions: hs ? ["review"] : [],
    };
  }

  /* ─── Lecture bornée ─────────────────────────────────────────────────── */

  function auditDe(ctx, id) {
    const a = auditParId(id);
    if (!a || !ctx.user.companies.includes(a.company_id) || !dansPortee(ctx, a.site_id)) throw introuvable("Audit introuvable.");
    return a;
  }
  function constatDe(ctx, id) {
    const f = HS.findings.find((x) => x.id === id);
    if (!f || !ctx.user.companies.includes(f.company_id) || !dansPortee(ctx, f.site_id)) throw introuvable("Constat introuvable.");
    return f;
  }
  function exigenceDe(ctx, id) {
    const r = exigenceParId(id);
    if (!r || r.active === false || !ctx.user.companies.includes(r.company_id)) throw introuvable("Exigence introuvable.");
    return r;
  }
  /** Audits de la liste et de l'export (audit_list_domain) : portée, filtres, année (en cours par défaut) ou période. */
  function listeAudits(ctx, q) {
    const comps = societes(ctx, q);
    const statuts = H.hsList(q.status);
    const normes = H.hsList(q.standard);
    const site = H.hsId(q, "site_id");
    const annee = H.intArg(q, "year", null) || Number(TODAY.slice(0, 4));
    const debut = dateOuNul(q, "date_from") ?? `${annee}-01-01`;
    const fin = dateOuNul(q, "date_to") ?? `${annee}-12-31`;
    return HS.audits.filter((a) => comps.includes(a.company_id) && dansPortee(ctx, a.site_id) && (!statuts || statuts.includes(a.status))
      && (!normes || normes.includes(a.standard)) && (!site || a.site_id === site) && a.planned_date >= debut && a.planned_date <= fin);
  }
  /** Exigences de la liste et de l'export (_requirement_domain), avec les mêmes paramètres. */
  function listeExigences(ctx, q) {
    const comps = societes(ctx, q);
    const sources = H.hsList(q.source);
    const statuts = H.hsList(q.status);
    const normes = H.hsList(q.standard);
    const partenaire = H.hsId(q, "partner_id");
    const retard = ["1", "true"].includes(String(q.review_overdue ?? ""));
    const cherche = String(q.search ?? "").trim().toLowerCase();
    return HS.requirements.filter((r) => r.active !== false && comps.includes(r.company_id) && (!sources || sources.includes(r.source)) && (!statuts || statuts.includes(r.status))
      && (!normes || normes.includes(r.standard)) && (!partenaire || r.partner_id === partenaire) && (!retard || Boolean(r.next_review_date && r.next_review_date < TODAY))
      && (!cherche || [r.reference, r.title, r.source_reference].some((x) => String(x ?? "").toLowerCase().includes(cherche))));
  }

  /* ─── Valeurs reçues ─────────────────────────────────────────────────── */

  function valeursAudit(data) {
    const v = {};
    if ("title" in data) {
      v.title = H.hsText(data, "title", 300);
      if (!v.title) throw H.hsMissing("Intitulé de l'audit manquant.", ["title"]);
    }
    if ("standard" in data) {
      if (!Object.hasOwn(REFERENTIELS, String(data.standard))) throw H.hsBad("Programme : iso_45001, iso_14001, iso_9001, client ou internal.", ["standard"]);
      v.standard = data.standard;
    }
    if ("auditor_kind" in data) {
      if (!Object.hasOwn(AUDITEURS, String(data.auditor_kind))) throw H.hsBad("Auditeur : internal ou external.", ["auditor_kind"]);
      v.auditor_kind = data.auditor_kind;
    }
    for (const [cle, max] of [["scope", 4000], ["conclusion", 4000], ["auditor_name", 200]]) if (cle in data) v[cle] = H.hsText(data, cle, max);
    for (const cle of ["planned_date", "actual_date"]) if (cle in data) v[cle] = dateOuNul(data, cle);
    if ("planned_date" in v && !v.planned_date) throw H.hsMissing("Date prévue manquante.", ["planned_date"]);
    if ("site_id" in data) {
      const id = H.hsId(data, "site_id");
      if (id && !H.hsSite(id)) throw introuvable("Site introuvable.");
      v.site_id = id;
    }
    if ("partner_id" in data) {
      const id = H.hsId(data, "partner_id");
      v.partner_id = id && CLIENTS[id] ? id : null;
    }
    if ("auditor_id" in data) {
      const id = H.hsId(data, "auditor_id");
      const u = id ? H.USERS.find((x) => x.id === id) : null;
      if (u && u.profiles.every((p) => p === "porteur")) throw H.hsRule("business_rule", "Auditeur interne : un compte interne.", { fields: ["auditor_id"] });
      v.auditor_user_id = u ? u.id : null;
    }
    return v;
  }
  function valeursConstat(data, partiel = false) {
    const v = {};
    if (!partiel || "classification" in data) {
      if (!Object.hasOwn(CLASSEMENTS, String(data.classification ?? ""))) throw H.hsBad("Classement : major, minor ou observation.", ["classification"]);
      v.classification = data.classification;
    }
    if (!partiel || "description" in data) {
      v.description = H.hsText(data, "description", 4000);
      if (!v.description) throw H.hsMissing("Description du constat manquante.", ["description"]);
    }
    if ("requirement_id" in data) {
      const id = H.hsId(data, "requirement_id");
      if (id && !exigenceParId(id)) throw introuvable("Exigence introuvable.");
      v.requirement_id = id;
    }
    if ("sequence" in data) v.sequence = H.intArg(data, "sequence", 10) || 10;
    return v;
  }
  function valeursExigence(data, partiel = false) {
    const v = {};
    if (!partiel || "source" in data) {
      if (!Object.hasOwn(SOURCES, String(data.source ?? ""))) throw H.hsBad("Source : law, standard ou client_contract.", ["source"]);
      v.source = data.source;
    }
    if ("standard" in data) {
      if (data.standard && !Object.hasOwn(NORMES, String(data.standard))) throw H.hsBad("Référentiel inconnu.", ["standard"]);
      v.standard = data.standard || null;
    }
    for (const [cle, max, obligatoire] of [["source_reference", 300, true], ["title", 300, true], ["summary", 4000, false], ["expected_evidence", 4000, false]]) {
      if (partiel && !(cle in data)) continue;
      v[cle] = H.hsText(data, cle, max);
      if (obligatoire && !v[cle]) throw H.hsMissing("Référence et intitulé de l'exigence sont obligatoires.", [cle]);
    }
    if ("partner_id" in data) {
      const id = H.hsId(data, "partner_id");
      v.partner_id = id && CLIENTS[id] ? id : null;
    }
    if ("next_review_date" in data) v.next_review_date = dateOuNul(data, "next_review_date");
    return v;
  }

  /* ─── Création ───────────────────────────────────────────────────────── */

  /** Audit planifié ; référence AUD/année/nnn (séquence du noyau, année de création). */
  function creerAudit(valeurs, by, at) {
    const annee = (at ?? H.hsNow()).slice(0, 4);
    const rang = HS.audits.filter((x) => x.reference.startsWith(`AUD/${annee}/`)).length + 1;
    const a = {
      id: suivant(HS.audits), reference: `AUD/${annee}/${String(rang).padStart(3, "0")}`, company_id: 1, title: "", standard: "internal", partner_id: null, scope: null,
      site_id: null, auditor_kind: "internal", auditor_user_id: null, auditor_name: null, planned_date: TODAY, actual_date: null, status: "planned", conclusion: null,
      closed_at: null, closed_by: null, cancel_reason: null, reopen_reason: null, ...valeurs,
    };
    HS.audits.push(a);
    H.hsLog("audit", a.id, by, "create", null, null, null, at ?? H.hsNow());
    return a;
  }
  /** Constat d'un audit ; référence AUD/…-Cnn, rang dans l'audit. Site, société et statut suivent l'audit et les actions. */
  function creerConstat(audit, valeurs, by, at) {
    const f = {
      id: suivant(HS.findings), audit_id: audit.id, reference: "", sequence: 10, classification: "observation", description: "", requirement_id: null, ...valeurs,
      get company_id() {
        return auditParId(this.audit_id)?.company_id ?? null;
      },
      get site_id() {
        return auditParId(this.audit_id)?.site_id ?? null;
      },
      get status() {
        return statutConstat(this);
      },
    };
    HS.findings.push(f);
    const rang = HS.findings.filter((x) => x.audit_id === audit.id && x.id <= f.id).length;
    f.reference = `${audit.reference}-C${String(rang).padStart(2, "0")}`;
    H.hsLog("finding", f.id, by, "create", null, null, null, at ?? H.hsNow());
    return f;
  }
  /** Exigence du registre, non évaluée à la création ; référence EXI/nnnn. */
  function creerExigence(valeurs, by, at) {
    const r = {
      id: suivant(HS.requirements), reference: "", company_id: 1, source: "law", standard: null, partner_id: null, source_reference: "", title: "", summary: null,
      expected_evidence: null, status: "not_evaluated", last_review_at: null, last_reviewed_by: null, review_comment: null, next_review_date: null, active: true, ...valeurs,
    };
    r.reference = `EXI/${String(r.id).padStart(4, "0")}`;
    HS.requirements.push(r);
    H.hsLog("requirement", r.id, by, "create", null, null, null, at ?? H.hsNow());
    return r;
  }

  /* ─── Données fictives ───────────────────────────────────────────────── */

  try {
    semer();
  } catch (e) {
    // Un semis en échec ne doit pas empêcher la maquette de démarrer : les tables restent vides.
    console.error("hsseq-conformite : semis interrompu.", e);
  }

  function semer() {
    const at = (jour, heure = 9) => `${jour}T${String(heure).padStart(2, "0")}:00:00Z`;
    const piece = (model, id, by, nom, titre, lignes, jour) => H.hsAttach(model, id, by, nom, "application/pdf", pdf(titre, [...lignes, "", "Fichier de maquette : donnees fictives."]), { created_at: at(jour, 15), role: "evidence" });

    // Registre des exigences : lecture générale des textes, sans citer d'article qui n'aurait pas été vérifié.
    const exigences = [
      ["law", null, null, "ADR, partie 8 : équipement des unités de transport (lecture générale)", "Équipement de sécurité à bord des citernes : extincteurs vérifiés, cales, signalisation, kit antidéversement", "Chaque unité qui transporte des matières dangereuses porte les extincteurs prescrits, vérifiés et plombés, et l'équipement de sécurité de l'équipage.", "Registre de vérification mensuelle des extincteurs ; grille du contrôle avant départ signée.", "partial", "2026-05-06", "2026-11-06", "Registre des extincteurs repris en avril : tenue à vérifier sur six mois avant de passer conforme."],
      ["law", null, null, "ADR, partie 5 : signalisation et étiquetage (lecture générale)", "Plaques-étiquettes de danger et panneaux orange en place et lisibles sur chaque citerne", null, "Photos de contrôle avant départ ; point « plaques et étiquettes » de la grille citerne.", "compliant", "2026-04-20", "2027-04-20", null],
      ["law", null, null, "ADR, chapitre 8.2 : formation des conducteurs (lecture générale)", "Conducteurs de citernes titulaires d'un certificat de formation au transport de marchandises dangereuses en cours de validité", null, "Copie des certificats ; échéances suivies dans les habilitations.", "compliant", "2026-06-30", "2026-12-31", "Vingt-cinq certificats valides ; trois échéances au premier trimestre 2027."],
      ["law", null, null, "ADR, chapitre 8.1 : documents de bord (lecture générale)", "Consignes écrites et fiches de données de sécurité des produits transportés présentes dans chaque cabine", null, "Contrôle documentaire mensuel d'un échantillon de cabines.", "compliant", "2025-12-10", "2026-09-30", null],
      ["law", null, null, "Code du travail de la République de Guinée : santé et sécurité au travail (formulation générale)", "Évaluation des risques professionnels tenue à jour et visite médicale d'aptitude des conducteurs", "L'employeur évalue les risques des postes et fait suivre l'aptitude médicale du personnel exposé.", "Document d'évaluation des risques daté ; aptitudes médicales en cours de validité.", "partial", "2026-03-02", "2026-09-15", "Aptitudes à jour pour 23 conducteurs sur 25 ; deux visites programmées."],
      ["law", null, null, "Code du travail : équipements de protection individuelle (formulation générale)", "Équipements de protection fournis gratuitement, adaptés aux postes et renouvelés", null, "Bons de remise signés ; stock d'équipements au magasin.", "compliant", "2026-02-14", "2027-02-14", null],
      ["law", null, null, "Réglementation environnementale : déchets dangereux (formulation générale)", "Huiles usagées et boues du séparateur collectées par un prestataire agréé, bordereaux de suivi conservés", null, "Contrat du collecteur ; bordereaux de suivi des déchets.", "not_evaluated", null, null, null],
      ["standard", "iso_45001", null, "ISO 45001:2018, 8.2", "Préparation et réponse aux situations d'urgence", "Plans d'urgence par site, exercés au moins une fois par an, avec retour d'expérience.", "Plan d'urgence affiché à chaque site ; comptes rendus des exercices annuels.", "compliant", "2026-05-06", "2027-05-06", "Exercice d'épandage et d'évacuation réalisé à Matoto le 24 avril."],
      ["standard", "iso_45001", null, "ISO 45001:2018, 9.2", "Programme d'audit interne couvrant chaque site au moins une fois tous les trois ans", null, "Programme d'audits de l'année ; rapports d'audit.", "partial", "2026-01-20", "2027-01-20", "Base de Boffa jamais auditée en interne : audit ISO 14001 planifié en novembre."],
      ["standard", "iso_45001", null, "ISO 45001:2018, 9.3", "Revue de direction annuelle du système de management", null, "Compte rendu de la revue de direction et suivi de ses actions.", "not_evaluated", null, "2027-01-31", null],
      ["standard", "iso_14001", null, "ISO 14001:2015, 8.2", "Préparation aux situations d'urgence environnementales : épandage d'hydrocarbures sur la route et au parc", null, "Kits antidéversement contrôlés ; exercice annuel ; contrat d'intervention.", "partial", "2026-07-08", "2027-01-08", "Kits complets sur les citernes ; aucun exercice environnemental à Boffa."],
      ["standard", "iso_9001", null, "ISO 9001:2015, 9.1.2", "Satisfaction des donneurs d'ordre mesurée chaque semestre", null, "Questionnaire semestriel et synthèse présentée au comité.", "not_evaluated", null, null, null],
      ["client_contract", null, 101, "Contrat de transport de bauxite, annexe HSE, article 4", "Conducteurs formés à la conduite défensive, recyclage tous les deux ans", null, "Attestations de formation ; planning des recyclages.", "non_compliant", "2026-09-10", "2026-12-15", "Quatre conducteurs de Boffa sur six hors délai (audit AUD/2026/002)."],
      ["client_contract", null, 101, "Contrat de transport de bauxite, annexe HSE, article 7", "Alcootest avant la première rotation de chaque poste, résultats tenus à disposition du donneur d'ordre", null, "Registre des alcootests de NIMOVA Terrain.", "compliant", "2026-09-10", "2027-03-10", null],
      ["client_contract", null, 101, "Contrat de transport de bauxite, annexe HSE, article 9", "Accueil sécurité de chaque nouveau conducteur, avec remise du plan de circulation du site minier", null, "Fiche d'accueil signée par le conducteur.", "partial", "2026-09-10", "2026-12-15", null],
      ["client_contract", null, 104, "Contrat de transport de produits pétroliers, cahier HSE, clause 2.1", "Contrôle avant départ de chaque citerne, au parc, avant le chargement", null, "Contrôles avant départ de NIMOVA Terrain, horodatés.", "partial", "2026-10-08", "2026-11-30", "Deux contrôles saisis au retour des rotations (audit AUD/2026/004)."],
      ["client_contract", null, 104, "Contrat de transport de produits pétroliers, cahier HSE, clause 3.2", "Plan de trajet validé avant chaque rotation ; pas de circulation de nuit entre 20 h et 6 h", null, "Plans de trajet validés ; relevés de la géolocalisation.", "partial", "2026-06-02", "2026-12-02", null],
      ["client_contract", null, 104, "Contrat de transport de produits pétroliers, cahier HSE, clause 5.1", "Déclaration de tout incident au donneur d'ordre sous 24 heures", null, "Registre des événements et accusés de réception du donneur d'ordre.", "compliant", "2026-06-02", "2027-06-02", null],
    ].map(([source, standard, partner, ref, titre, resume, preuve, statut, revue, prochaine, commentaire]) => {
      const r = creerExigence({ source, standard, partner_id: partner, source_reference: ref, title: titre, summary: resume, expected_evidence: preuve }, 16, at("2026-01-12", 10));
      if (revue) {
        Object.assign(r, { status: statut, last_review_at: at(revue, 16), last_reviewed_by: 16, review_comment: commentaire, next_review_date: prochaine });
        H.hsLog("requirement", r.id, 16, "write", "status", "not_evaluated", statut, at(revue, 16));
        H.hsLog("requirement", r.id, 16, "review", null, null, null, at(revue, 16), commentaire);
      } else Object.assign(r, { status: statut, next_review_date: prochaine });
      return r;
    });
    const exi = (n) => exigences[n - 1].id;
    piece("requirement", exi(3), 16, "certificats-formation-adr.pdf", "Certificats de formation ADR des conducteurs", ["Vingt-cinq certificats en cours de validite au 30/06/2026."], "2026-06-30");
    piece("requirement", exi(8), 16, "plan-urgence-parc-matoto.pdf", "Plan d'urgence du parc de Matoto", ["Version affichee au poste de garde le 24/04/2026."], "2026-04-24");

    // Programme d'audits : un audit de 2025, le programme 2026 arrêté le 22 janvier.
    const programme = [
      { title: "Audit interne ISO 45001 du parc de Matoto", standard: "iso_45001", site_id: 1, auditor_user_id: 2, planned_date: "2025-11-18", actual_date: "2025-11-19", status: "closed", closed: "2025-12-10",
        scope: "Chargement au dépôt de Conakry, contrôles avant départ et atelier de maintenance du parc de Matoto.", conclusion: "Deux écarts mineurs, levés en décembre ; système appliqué au parc." },
      { title: "Audit interne ISO 45001 du parc de Matoto", standard: "iso_45001", site_id: 1, auditor_user_id: 2, planned_date: "2026-03-17", actual_date: "2026-03-18", status: "closed", closed: "2026-05-06",
        scope: "Préparation aux situations d'urgence, contrôles avant départ, aire de lavage, atelier de maintenance et stockage des produits dangereux du parc de Matoto.",
        conclusion: "Système appliqué au parc. Un écart majeur sur la préparation aux situations d'urgence et un écart mineur sur le registre des extincteurs, traités en avril." },
      { title: "Audit HSE du donneur d'ordre minier, base de Boffa", standard: "client", partner_id: 101, site_id: 2, auditor_kind: "external", auditor_name: "Équipe HSE de la Société Minière de Boffa (démo)", planned_date: "2026-09-08", actual_date: "2026-09-09", status: "done",
        scope: "Annexe HSE du contrat de transport de bauxite : formation des conducteurs, état des bennes, plan de circulation du site minier, équipements de protection, alcootests.",
        conclusion: "Prestataire conforme dans l'ensemble. L'écart majeur sur le recyclage de conduite défensive est à lever avant le renouvellement du contrat, en janvier 2027." },
      { title: "Audit HSE du donneur d'ordre pétrolier, dépôt de Kankan", standard: "client", partner_id: 104, site_id: 1, auditor_kind: "external", auditor_name: "Service HSE de Distribution Pétrolière de Kankan (démo)", planned_date: "2026-06-16", status: "cancelled",
        scope: "Cahier HSE du contrat de transport de produits pétroliers, de Conakry au dépôt de Kankan.", cancel_reason: "Reporté à la demande du donneur d'ordre : nouvel audit à planifier au premier trimestre 2027." },
      { title: "Audit de suivi ISO 45001 du parc de Matoto", standard: "iso_45001", site_id: 1, auditor_user_id: 2, planned_date: "2026-10-06", actual_date: "2026-10-07", status: "done",
        scope: "Efficacité des actions de l'audit AUD/2026/001 ; contrôles avant départ et dépotage." },
      { title: "Audit interne ISO 9001 : réception, chargement et livraison des produits", standard: "iso_9001", site_id: 1, auditor_user_id: 16, planned_date: "2026-10-01", status: "planned",
        scope: "Bons de chargement au dépôt, scellés, contrôle des quantités livrées et traitement des écarts de livraison." },
      { title: "Revue documentaire du système HSSEQ au siège", standard: "internal", site_id: null, auditor_user_id: 2, planned_date: "2026-11-04", status: "planned",
        scope: "Politique HSSEQ, objectifs, registre des exigences, maîtrise des documents et des enregistrements, compétences." },
      { title: "Audit interne ISO 14001 de la base de Boffa", standard: "iso_14001", site_id: 2, auditor_user_id: 2, planned_date: "2026-11-18", status: "planned",
        scope: "Poussières et eaux de ruissellement de l'aire de lavage, huiles usagées et pneus, plan d'urgence environnemental." },
      { title: "Audit de certification ISO 45001, étape 1", standard: "iso_45001", site_id: 1, auditor_kind: "external", auditor_name: "Moussa Kaba, Cabinet Kaloum Audit Conseil (démo)", planned_date: "2026-12-08", status: "planned",
        scope: "Revue de la documentation du système et visite du parc de Matoto, avant l'audit de certification de 2027." },
    ];
    const audits = programme.map((p) => {
      const cree = p.planned_date.startsWith("2025") ? at("2025-01-15") : at("2026-01-22");
      const { closed, status, actual_date: realise, ...valeurs } = p;
      const a = creerAudit({ auditor_kind: "internal", ...valeurs }, 16, cree);
      if (realise) {
        Object.assign(a, { status: "done", actual_date: realise });
        H.hsLog("audit", a.id, 16, "write", "status", "planned", "done", at(realise, 17));
        H.hsLog("audit", a.id, 16, "perform", null, null, null, at(realise, 17));
      }
      if (status === "closed") {
        Object.assign(a, { status: "closed", closed_at: at(closed, 16), closed_by: 16 });
        H.hsLog("audit", a.id, 16, "write", "status", "done", "closed", at(closed, 16));
        H.hsLog("audit", a.id, 16, "close", null, null, null, at(closed, 16));
      }
      if (status === "cancelled") {
        a.status = "cancelled";
        H.hsLog("audit", a.id, 16, "write", "status", "planned", "cancelled", at("2026-05-28", 11));
        H.hsLog("audit", a.id, 16, "cancel", null, null, null, at("2026-05-28", 11), a.cancel_reason);
      }
      return a;
    });
    const [a2025, aMatoto, aBoffa, , aSuivi] = audits;
    piece("audit", aMatoto.id, 2, "rapport-AUD-2026-001.pdf", `Rapport d'audit ${aMatoto.reference}`, ["Audit interne ISO 45001 du parc de Matoto, 18/03/2026.", "1 ecart majeur, 1 ecart mineur, 1 observation."], "2026-03-20");
    piece("audit", aBoffa.id, 16, "rapport-AUD-2026-002.pdf", `Rapport d'audit ${aBoffa.reference}`, ["Audit HSE du donneur d'ordre minier, base de Boffa, 09/09/2026.", "1 ecart majeur, 2 ecarts mineurs, 1 observation."], "2026-09-11");

    /** Action du plan (lot 1) qui répond à un constat : origine « audit », site du constat, preuve si elle est réalisée. */
    const action = (f, x) => {
      const a = H.hsNewAction({ description: x.desc, origin: "audit", origin_id: f.id, control_level: x.lvl, owner_id: x.owner, due_date: x.due, status: x.status, estimated_cost: x.cost ?? null, created_at: at(x.created, 10), created_by: 16, site_id: f.site_id });
      H.hsLog("action", a.id, 16, "create", null, null, null, a.created_at);
      if (x.status !== "todo") a.started_at = at(x.created, 11);
      if (x.done) {
        Object.assign(a, { done_at: at(x.done, 16), closed_at: at(x.done, 17) });
        H.hsAttach("action", a.id, x.owner, `preuve-${a.reference.replaceAll("/", "-")}.pdf`, "application/pdf", pdf(`Preuve de realisation ${a.reference}`, [x.desc, "", "Fichier de maquette : donnees fictives."]), { created_at: at(x.done, 15) });
        H.hsLog("action", a.id, x.owner, "close", "status", "in_progress", "closed", at(x.done, 17));
      }
      return a;
    };
    const constat = (audit, classification, description, requirement, jour) => creerConstat(audit, { classification, description, requirement_id: requirement ?? null }, 16, at(jour, 15));

    // 2025 : deux écarts mineurs, soldés.
    const c2025a = constat(a2025, "minor", "Fiches de données de sécurité des produits transportés absentes des cabines de trois citernes.", exi(4), "2025-11-19");
    action(c2025a, { desc: "Remettre dans chaque cabine les consignes écrites et les fiches de données de sécurité, et les ajouter à la grille du contrôle avant départ", lvl: "administrative", owner: 12, due: "2025-12-05", created: "2025-11-21", status: "closed", done: "2025-12-03" });
    const c2025b = constat(a2025, "minor", "Le permis de travail par point chaud n'est pas utilisé à l'atelier pour les soudures sur citerne dégazée.", null, "2025-11-19");
    action(c2025b, { desc: "Imposer le permis de feu signé par le chef d'atelier avant toute soudure sur citerne", lvl: "administrative", owner: 19, due: "2025-12-10", created: "2025-11-21", status: "closed", done: "2025-12-08" });

    // AUD/2026/001 : écart majeur et écart mineur traités, observation soldée d'emblée.
    const cUrgence = constat(aMatoto, "major", "Aucun exercice d'évacuation ni de lutte contre un épandage n'a été réalisé au parc depuis plus de douze mois ; le plan d'urgence n'est pas affiché au poste de garde.", exi(8), "2026-03-18");
    action(cUrgence, { desc: "Organiser au parc de Matoto un exercice d'épandage et d'évacuation avec les sapeurs-pompiers, et afficher le plan d'urgence au poste de garde", lvl: "administrative", owner: 12, due: "2026-04-30", created: "2026-03-20", status: "closed", done: "2026-04-24" });
    const cExtincteurs = constat(aMatoto, "minor", "Registre de vérification des extincteurs incomplet : trois extincteurs de l'atelier sans visa mensuel depuis janvier.", exi(1), "2026-03-18");
    action(cExtincteurs, { desc: "Viser le registre des extincteurs à chaque vérification mensuelle et former le magasinier à sa tenue", lvl: "administrative", owner: 19, due: "2026-04-15", created: "2026-03-20", status: "closed", done: "2026-04-10" });
    constat(aMatoto, "observation", "Les consignes de sécurité affichées à l'aire de chargement sont décolorées et peu lisibles.", null, "2026-03-18");

    // AUD/2026/002 (donneur d'ordre minier, réalisé) : un écart majeur en cours de traitement, un mineur en retard, un mineur sans action.
    const cConduite = constat(aBoffa, "major", "Quatre conducteurs de bennes sur six n'ont pas suivi de recyclage de conduite défensive depuis plus de deux ans, contrairement à l'article 4 de l'annexe HSE.", exi(13), "2026-09-09");
    action(cConduite, { desc: "Inscrire les quatre conducteurs de Boffa au recyclage de conduite défensive de novembre", lvl: "administrative", owner: 18, due: "2026-11-20", created: "2026-09-11", status: "in_progress", cost: 18_000_000 });
    const cBaches = constat(aBoffa, "minor", "Bâches de couverture déchirées sur les bennes EB-02 et EB-05 : envol de poussière de bauxite sur la piste du port de Dapilon.", null, "2026-09-09");
    action(cBaches, { desc: "Remplacer les bâches de couverture des bennes EB-02 et EB-05", lvl: "engineering", owner: 19, due: "2026-10-10", created: "2026-09-11", status: "todo" });
    H.hsAttach("finding", cBaches.id, 16, "photo-bache-EB-02.png", "image/png", H.HS_PNG, { created_at: at("2026-09-09", 14), caption: "Bâche déchirée de EB-02", role: "evidence" });
    constat(aBoffa, "minor", "Le plan de circulation du site minier n'est pas remis aux nouveaux conducteurs à leur arrivée.", exi(15), "2026-09-09");
    constat(aBoffa, "observation", "Bonne pratique relevée : alcootest avant la première rotation de chaque poste, registre tenu à jour et signé.", exi(14), "2026-09-09");

    // AUD/2026/004 (suivi, réalisé) : écart majeur encore sans action, la clôture est refusée.
    constat(aSuivi, "major", "Deux contrôles avant départ du 6 octobre (ER-04 et ER-09) ont été saisis au retour des rotations, et non au parc avant le départ.", exi(16), "2026-10-07");
    constat(aSuivi, "observation", "Exercice d'urgence d'avril réalisé avec les sapeurs-pompiers ; compte rendu disponible et diffusé aux équipes.", exi(8), "2026-10-07");

    // Revue de direction du 20 janvier 2026 : ses actions n'ont pas de fiche d'origine ni de site.
    for (const x of [
      { desc: "Inscrire au programme d'audits 2026 un audit interne de la base de Boffa", owner: 16, due: "2026-02-28", status: "closed", done: "2026-01-22" },
      { desc: "Présenter chaque mois au comité HSSE les indicateurs exigés par les donneurs d'ordre", owner: 16, due: "2026-03-31", status: "closed", done: "2026-03-27" },
      { desc: "Budgéter pour 2027 le recyclage de conduite défensive de tous les conducteurs de bennes", owner: 8, due: "2026-11-30", status: "in_progress", cost: 45_000_000 },
      { desc: "Désigner un suppléant du Responsable HSSEQ pour la tenue du registre des exigences", owner: 2, due: "2026-09-30", status: "todo" },
    ]) {
      const a = H.hsNewAction({ description: x.desc, origin: "review", origin_id: null, control_level: "administrative", owner_id: x.owner, due_date: x.due, status: x.status, estimated_cost: x.cost ?? null, created_at: at("2026-01-20", 17), created_by: 16 });
      a.site_id = null;
      H.hsLog("action", a.id, 16, "create", null, null, null, a.created_at);
      if (x.status !== "todo") a.started_at = at("2026-01-21", 9);
      if (x.done) {
        Object.assign(a, { done_at: at(x.done, 16), closed_at: at(x.done, 17) });
        H.hsAttach("action", a.id, x.owner, `preuve-${a.reference.replaceAll("/", "-")}.pdf`, "application/pdf", pdf(`Preuve de realisation ${a.reference}`, [x.desc]), { created_at: at(x.done, 15) });
      }
    }
  }

  /* ─── Pièces jointes des fiches du module ────────────────────────────── */

  // Les routes des pièces (serveur.mjs) retrouvent la fiche par HS_ATTACH_MODELS ; hsCanAttach réserve le dépôt au Responsable HSSEQ.
  if (H.HS_ATTACH_MODELS) {
    Object.assign(H.HS_ATTACH_MODELS, {
      audit: (ctx, id) => auditDe(ctx, id),
      finding: (ctx, id) => constatDe(ctx, id),
      requirement: (ctx, id) => {
        if (!lecteurExigences(ctx)) throw H.hsForbidden("Pièce jointe non autorisée sur cette fiche.");
        return exigenceDe(ctx, id);
      },
    });
  }

  /* ─── Audits ─────────────────────────────────────────────────────────── */

  route("GET", "/hsseq/audits", LECTURE_AUDITS, (ctx) => {
    const liste = listeAudits(ctx, ctx.query);
    const prevus = liste.filter((a) => a.status !== "cancelled");
    const realises = prevus.filter((a) => ["done", "closed"].includes(a.status));
    const counts = {
      by_status: Object.fromEntries(Object.keys(ETATS_AUDIT).map((s) => [s, liste.filter((a) => a.status === s).length])),
      planned: prevus.length, done: realises.length, completion_rate: prevus.length ? Math.round((realises.length * 1000) / prevus.length) / 10 : null,
    };
    return H.hsPage(ctx, H.hsSort([...liste], ctx.query.sort, TRIS_AUDITS, "planned_date"), counts, ligneAudit);
  });

  // Registre des audits et des constats ; la feuille des exigences pour leurs seuls lecteurs (mêmes paramètres que les listes).
  route("GET", "/hsseq/audits/export.xlsx", LECTURE_AUDITS, (ctx) => {
    const audits = listeAudits(ctx, ctx.query).sort((a, b) => a.planned_date.localeCompare(b.planned_date) || a.id - b.id);
    const nom = (a) => (a.auditor_kind === "internal" ? (H.hsUser(a.auditor_user_id)?.name ?? "") : (a.auditor_name ?? ""));
    const feuilles = [
      {
        name: "Programme d'audits",
        rows: [
          ["Référence", "Audit", "Programme", "Site", "Auditeur", "Prévu le", "Réalisé le", "État", "Écarts majeurs", "Écarts mineurs", "Observations"],
          ...audits.map((a) => [a.reference, a.title, REFERENTIELS[a.standard], H.hsSite(a.site_id)?.name ?? "", nom(a), a.planned_date, a.actual_date ?? "", ETATS_AUDIT[a.status],
            ...Object.keys(CLASSEMENTS).map((c) => constatsDe(a).filter((f) => f.classification === c).length)]),
        ],
      },
      {
        name: "Constats",
        rows: [
          ["Référence", "Audit", "Classement", "Constat", "Exigence", "Statut", "Actions"],
          ...audits.flatMap((a) => constatsDe(a).map((f) => [f.reference, a.reference, CLASSEMENTS[f.classification], f.description, exigenceParId(f.requirement_id)?.reference ?? "", ETATS_CONSTAT[f.status], actionsDe(f).map((x) => x.reference).join(", ")])),
        ],
      },
    ];
    if (lecteurExigences(ctx)) {
      const exigences = listeExigences(ctx, ctx.query).sort((a, b) => a.source.localeCompare(b.source) || a.source_reference.localeCompare(b.source_reference) || a.id - b.id);
      feuilles.push({
        name: "Registre des exigences",
        rows: [
          ["Référence", "Source", "Référence du texte", "Exigence", "Preuve attendue", "Statut", "Dernière revue", "Prochaine revue"],
          ...exigences.map((r) => [r.reference, SOURCES[r.source], r.source_reference, r.title, r.expected_evidence ?? "", ETATS_EXIGENCE[r.status], r.last_review_at ? r.last_review_at.slice(0, 10) : "", r.next_review_date ?? ""]),
        ],
      });
    }
    return H.fileReply(H.xlsxBuffer(feuilles), XLSX, `audits_conformite_hsseq_${TODAY.replaceAll("-", "")}.xlsx`);
  });

  route("GET", "/hsseq/audits/:id", LECTURE_AUDITS, (ctx) => ficheAudit(ctx, auditDe(ctx, ctx.params[0])));

  route("POST", "/hsseq/audits", GESTION, (ctx) => {
    const b = ctx.body;
    requis(b, "title", "standard", "planned_date");
    const valeurs = valeursAudit(b);
    const company = b.company_id ? societes(ctx, { company_id: b.company_id })[0] : (ctx.company ?? 1);
    const a = creerAudit({ ...valeurs, company_id: company }, ctx.user.id);
    return ficheAudit(ctx, a);
  });

  route("PATCH", "/hsseq/audits/:id", GESTION, (ctx) => {
    const a = auditDe(ctx, ctx.params[0]);
    if (!["planned", "done"].includes(a.status)) throw H.hsRule("invalid_transition", "Audit clos ou annulé : rouvrez-le avant de le modifier.");
    ecrireSuivi(ctx, "audit", a, valeursAudit(ctx.body));
    return ficheAudit(ctx, a);
  });

  // Avant la route des transitions : « findings » répondrait aussi au segment :action.
  route("POST", "/hsseq/audits/:id/findings", GESTION, (ctx) => {
    const a = auditDe(ctx, ctx.params[0]);
    if (!["planned", "done"].includes(a.status)) throw H.hsRule("invalid_transition", "Audit clos ou annulé : plus de constat.");
    creerConstat(a, valeursConstat(ctx.body), ctx.user.id);
    return ficheAudit(ctx, a);
  });

  route("POST", "/hsseq/audits/:id/:action", GESTION, (ctx) => {
    const t = ctx.params[1];
    if (!["perform", "close", "reopen", "cancel"].includes(t)) throw introuvable("Transition inconnue.");
    const a = auditDe(ctx, ctx.params[0]);
    const b = ctx.body;
    if (!TRANSITIONS[a.status].includes(t)) throw H.hsRule("invalid_transition", `Transition « ${t} » impossible depuis l'état « ${ETATS_AUDIT[a.status]} ».`);
    const at = H.hsNow();
    let motif = null;
    if (t === "perform") {
      const jour = dateOuNul(b, "actual_date") ?? TODAY;
      if (jour > TODAY) throw H.hsRule("invalid_parameter", "Un audit se déclare réalisé à une date passée ou du jour.", { fields: ["actual_date"] });
      ecrireSuivi(ctx, "audit", a, { status: "done", actual_date: jour }, at);
    } else if (t === "close") {
      const majeurs = majeursSansAction(a);
      if (majeurs.length) throw H.hsRule("major_finding_without_action", `Écart majeur sans action : ${majeurs.map((f) => f.reference).join(", ")}.`, { fields: majeurs.map((f) => f.id) });
      ecrireSuivi(ctx, "audit", a, { status: "closed" }, at);
      Object.assign(a, { closed_at: at, closed_by: ctx.user.id });
    } else {
      motif = String(b.reason ?? "").trim();
      if (!motif) throw H.hsRule("reason_required", t === "reopen" ? "Le motif de la réouverture est obligatoire." : "Le motif de l'annulation est obligatoire.", { fields: ["reason"] });
      if (t === "reopen") {
        ecrireSuivi(ctx, "audit", a, { status: "done" }, at);
        Object.assign(a, { closed_at: null, closed_by: null, reopen_reason: motif });
      } else {
        ecrireSuivi(ctx, "audit", a, { status: "cancelled" }, at);
        a.cancel_reason = motif;
      }
    }
    H.hsLog("audit", a.id, ctx.user.id, t, null, null, null, at, motif);
    return ficheAudit(ctx, a);
  });

  /* ─── Constats ───────────────────────────────────────────────────────── */

  route("GET", "/hsseq/findings", LECTURE_AUDITS, (ctx) => {
    const q = ctx.query;
    const comps = societes(ctx, q);
    const classes = H.hsList(q.classification);
    const statuts = H.hsList(q.status);
    const audit = H.hsId(q, "audit_id");
    const exigence = H.hsId(q, "requirement_id");
    const site = H.hsId(q, "site_id");
    const liste = HS.findings.filter((f) => comps.includes(f.company_id) && dansPortee(ctx, f.site_id) && (!classes || classes.includes(f.classification))
      && (!statuts || statuts.includes(f.status)) && (!audit || f.audit_id === audit) && (!exigence || f.requirement_id === exigence) && (!site || f.site_id === site));
    // Comptes sur toute la sélection filtrée, statut compris (comme le noyau).
    const counts = {
      by_status: Object.fromEntries(Object.keys(ETATS_CONSTAT).map((s) => [s, liste.filter((f) => f.status === s).length])),
      open_by_class: Object.fromEntries(Object.keys(CLASSEMENTS).map((c) => [c, liste.filter((f) => f.status === "open" && f.classification === c).length])),
    };
    return H.hsPage(ctx, H.hsSort([...liste], q.sort, TRIS_CONSTATS, "-id"), counts, (f) => ligneConstat(ctx, f));
  });

  route("GET", "/hsseq/findings/:id", LECTURE_AUDITS, (ctx) => ligneConstat(ctx, constatDe(ctx, ctx.params[0])));

  route("PATCH", "/hsseq/findings/:id", GESTION, (ctx) => {
    const f = constatDe(ctx, ctx.params[0]);
    if (!["planned", "done"].includes(auditParId(f.audit_id).status)) throw H.hsRule("invalid_transition", "Audit clos ou annulé : le constat ne se modifie plus.");
    ecrireSuivi(ctx, "finding", f, valeursConstat(ctx.body, true));
    return ligneConstat(ctx, f);
  });

  /* ─── Exigences ──────────────────────────────────────────────────────── */

  route("GET", "/hsseq/requirements", LECTURE_EXIGENCES, (ctx) => {
    const liste = listeExigences(ctx, ctx.query);
    const counts = { by_status: Object.fromEntries(Object.keys(ETATS_EXIGENCE).map((s) => [s, liste.filter((r) => r.status === s).length])) };
    return H.hsPage(ctx, H.hsSort([...liste], ctx.query.sort, TRIS_EXIGENCES, "reference"), counts, (r) => ligneExigence(ctx, r));
  });

  route("GET", "/hsseq/requirements/:id", LECTURE_EXIGENCES, (ctx) => ligneExigence(ctx, exigenceDe(ctx, ctx.params[0]), true));

  route("POST", "/hsseq/requirements", GESTION, (ctx) => {
    const b = ctx.body;
    requis(b, "source", "source_reference", "title");
    const valeurs = valeursExigence(b);
    const company = b.company_id ? societes(ctx, { company_id: b.company_id })[0] : (ctx.company ?? 1);
    return ligneExigence(ctx, creerExigence({ ...valeurs, company_id: company }, ctx.user.id), true);
  });

  route("PATCH", "/hsseq/requirements/:id", GESTION, (ctx) => {
    const r = exigenceDe(ctx, ctx.params[0]);
    ecrireSuivi(ctx, "requirement", r, valeursExigence(ctx.body, true));
    return ligneExigence(ctx, r, true);
  });

  // Revue de conformité : statut, commentaire, prochaine revue (effacée si elle n'est pas donnée, comme au noyau).
  route("POST", "/hsseq/requirements/:id/review", GESTION, (ctx) => {
    const r = exigenceDe(ctx, ctx.params[0]);
    const b = ctx.body;
    requis(b, "status");
    if (!Object.hasOwn(ETATS_EXIGENCE, String(b.status))) throw H.hsRule("invalid_parameter", "Statut : compliant, partial, non_compliant ou not_evaluated.", { fields: ["status"] }, 400);
    const prochaine = dateOuNul(b, "next_review_date");
    if (prochaine && prochaine <= TODAY) throw H.hsRule("invalid_parameter", "La prochaine revue est postérieure à aujourd'hui.", { fields: ["next_review_date"] });
    const commentaire = H.hsText(b, "comment", 2000);
    const at = H.hsNow();
    ecrireSuivi(ctx, "requirement", r, { status: b.status, next_review_date: prochaine }, at);
    Object.assign(r, { last_review_at: at, last_reviewed_by: ctx.user.id, review_comment: commentaire });
    H.hsLog("requirement", r.id, ctx.user.id, "review", null, null, null, at, commentaire);
    return ligneExigence(ctx, r, true);
  });

}
