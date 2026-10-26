/**
 * Maquette du lot 2 HSSEQ : registre des risques (eguitra_hsseq/controllers/risks.py, models/risk.py).
 * Routes et données fictives ; `H` porte les références de serveur.mjs (HS_REFS).
 *
 * Tables, aux noms de champs du noyau : DB.hsseq.risks (eguitra.hsseq.risk : reference, company_id,
 * nature, vehicle_kind, activity, site_id, hazard, feared_event, raw_severity, raw_probability,
 * residual_severity, residual_probability, owner_id, review_date, last_review_at, last_reviewed_by,
 * review_comment, review_reminded_on, status, archive_reason) et DB.hsseq.riskMeasures
 * (eguitra.hsseq.risk.measure : risk_id, control_level, description, status, sequence, action_id).
 * Les actions qui s'y rattachent sont celles du plan (DB.hsseq.actions), d'origine « risk ».
 *
 * Droits du noyau : lecture complète pour l'administration, la direction et hsseq ; chef de parc et
 * auditeur bornés à leurs sites, fermés par défaut (un risque sans site ne leur est pas servi) ; tout
 * compte interne lit les risques dont il est propriétaire. Création, mise en vigueur, archivage et
 * remise en vigueur par hsseq ; mise à jour, mesures et revue aussi par le propriétaire.
 */

const NATURES = {
  safety_hazard: "Danger pour la sécurité",
  health_hazard: "Danger pour la santé",
  environmental_aspect: "Aspect environnemental",
  security_threat: "Menace de sûreté",
};
const STATUTS = { draft: "À évaluer", active: "En vigueur", archived: "Archivé" };
const ETATS_MESURE = ["planned", "in_place", "to_review"];
const MAITRISE = { elimination: "Élimination", substitution: "Substitution", engineering: "Ingénierie", administrative: "Mesure administrative", ppe: "Équipement de protection" };
const PROFILS = { tanker: "Citerne", tipper: "Benne" };
const NIVEAUX = ["low", "moderate", "significant", "high"];
const TRANSITIONS = ["activate", "review", "archive", "reactivate"];
/** Cotations d'un risque, de 1 à 5. */
const NOTES = ["raw_severity", "raw_probability", "residual_severity", "residual_probability"];
/** Champs journalisés à chaque modification (_journal_fields du modèle). */
const SUIVIS = ["nature", "vehicle_kind", "activity", "site_id", "hazard", "feared_event", ...NOTES, "owner_id", "review_date", "status"];
/** Profils de l'export (COCKPIT du noyau) : l'auditeur ne l'a pas. */
const COCKPIT = ["admin", "direction", "hsseq", "exploitation"];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ajouterJours = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Date décalée de `n` mois, ramenée au dernier jour du mois si besoin (relativedelta du noyau). */
function ajouterMois(date, n) {
  const [a, m, j] = date.split("-").map(Number);
  const cible = new Date(Date.UTC(a, m - 1 + n, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernier));
  return cible.toISOString().slice(0, 10);
}
const posee = (o, cle) => Object.hasOwn(o, cle);

/** Enregistre les routes du module et sème ses tables ; appelé une fois par serveur.mjs, après seed(). */
export function enregistrerRisques(H) {
  const {
    route, fileReply, xlsxBuffer, ApiError, DB, USERS, TODAY, COMPANIES, HS_PNG, HS_ATTACH_MODELS, HS_LEVEL_LABELS,
    hsIs, hsFull, hsSites, hsSite, hsSiteRef, hsUser, hsInternal, hsForbidden, hsRule, hsMissing, hsBad, hsId, hsText,
    hsList, hsSort, hsPage, hsLog, hsHistory, hsAttach, hsAttachments, hsSettings, hsLevel, hsActionLine, hsNewAction,
    hsPhoto, hsNow, hsNotify, hsHsseqManagers,
  } = H;
  const HS = DB.hsseq;
  HS.risks = [];
  HS.riskMeasures = [];
  Object.assign(HS.seq, { risk: 0, risk_measure: 0 });

  /* ─── Lecture ─────────────────────────────────────────────────────────── */

  const critique = (r, cote) => r[`${cote}_severity`] * r[`${cote}_probability`];
  const niveau = (r, cote) => hsLevel(critique(r, cote));
  const mois = (r) => hsSettings(r?.company_id ?? 1).risk_review_months ?? 12;
  const echue = (r) => r.status === "active" && Boolean(r.review_date) && r.review_date < TODAY;
  const proprietaire = (ctx, r) => r.owner_id === ctx.user.id;
  /** Lecture complète, propriétaire, ou risque d'un site du compte (sans site : lectures complètes et propriétaire seuls). */
  const lisible = (ctx, r) => hsFull(ctx) || proprietaire(ctx, r) || (r.site_id !== null && hsSites(ctx).includes(r.site_id));
  const mesures = (r) => HS.riskMeasures.filter((m) => m.risk_id === r.id).sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  const actions = (r) => HS.actions.filter((a) => a.origin === "risk" && (a.risk_id ?? a.origin_id) === r.id).sort((a, b) => a.id - b.id);
  const ouverte = (a) => !["closed", "cancelled"].includes(a.status);

  /** Sociétés de travail : toutes celles du compte, ou celle du filtre company_id (403 hors du compte). */
  function societes(ctx, q) {
    const v = q.company_id;
    if (v === undefined || v === null || v === "" || v === "all") return ctx.user.companies;
    if (!/^\d+$/.test(String(v))) throw hsBad("Société invalide.");
    if (!ctx.user.companies.includes(Number(v))) throw hsForbidden("Société non autorisée.");
    return [Number(v)];
  }
  /** Risques que le compte lit dans ses sociétés (read_domain du noyau). */
  function registre(ctx, q) {
    const ids = societes(ctx, q);
    return HS.risks.filter((r) => ids.includes(r.company_id) && lisible(ctx, r));
  }
  const oui = (v) => ["1", "true"].includes(String(v ?? ""));
  /** Sélection filtrée (list_domain du noyau) ; sans filtre de statut, les risques archivés sont écartés. */
  function selection(ctx, q, base = registre(ctx, q)) {
    const statuts = hsList(q.status);
    const natures = hsList(q.nature);
    const profils = hsList(q.vehicle_kind);
    const niveaux = hsList(q.level);
    const bruts = hsList(q.raw_level);
    const site = hsId(q, "site_id");
    const owner = hsId(q, "owner_id");
    const texte = String(q.search ?? "").trim().toLowerCase();
    return base.filter(
      (r) =>
        (statuts ? statuts.includes(r.status) : r.status !== "archived") &&
        (!natures || natures.includes(r.nature)) &&
        (!profils || profils.includes(r.vehicle_kind)) &&
        (!site || r.site_id === site) &&
        (!owner || r.owner_id === owner) &&
        (!oui(q.mine) || r.owner_id === ctx.user.id) &&
        (!niveaux || niveaux.includes(niveau(r, "residual"))) &&
        (!bruts || bruts.includes(niveau(r, "raw"))) &&
        (!oui(q.review_overdue) || echue(r)) &&
        (!texte || [r.reference, r.hazard, r.feared_event, r.activity ?? ""].some((x) => x.toLowerCase().includes(texte))),
    );
  }
  const TRIS = {
    residual_criticality: (r) => critique(r, "residual"),
    raw_criticality: (r) => critique(r, "raw"),
    review_date: (r) => r.review_date,
    reference: (r) => r.reference,
    status: (r) => r.status,
  };

  const cotation = (r, cote) => ({ severity: r[`${cote}_severity`], probability: r[`${cote}_probability`], criticality: critique(r, cote), level: niveau(r, cote) });
  function ligne(r) {
    return {
      id: r.id, reference: r.reference, nature: r.nature, vehicle_kind: r.vehicle_kind, activity: r.activity, site: hsSiteRef(r.site_id),
      hazard: r.hazard, feared_event: r.feared_event, raw: cotation(r, "raw"), residual: cotation(r, "residual"), owner: hsUser(r.owner_id),
      review_date: r.review_date, review_overdue: echue(r), status: r.status, measures_count: mesures(r).length, open_actions: actions(r).filter(ouverte).length,
    };
  }
  /** Transitions permises depuis l'état (_transitions du modèle), puis bornées au compte (user_transitions). */
  const permises = (r) => ({ draft: ["activate", "archive"], active: ["review", "archive"], archived: ["reactivate"] })[r.status];
  const transitions = (ctx, r) => permises(r).filter((t) => hsIs(ctx, "hsseq") || (t === "review" && proprietaire(ctx, r)));
  function droits(ctx, r) {
    const t = transitions(ctx, r);
    return { can_edit: (hsIs(ctx, "hsseq") || proprietaire(ctx, r)) && r.status !== "archived", can_close: t.includes("archive"), can_approve: t.includes("review") };
  }
  const mesureRow = (m) => {
    const a = m.action_id ? HS.actions.find((x) => x.id === m.action_id) : null;
    return { id: m.id, control_level: m.control_level, description: m.description, status: m.status, sequence: m.sequence, action: a ? { id: a.id, reference: a.reference } : null };
  };
  function fiche(ctx, r) {
    return {
      ...ligne(r),
      company: { id: r.company_id, name: COMPANIES[r.company_id]?.name ?? "" },
      measures: mesures(r).map(mesureRow),
      actions: actions(r).map(hsActionLine),
      last_review_at: r.last_review_at, last_reviewed_by: hsUser(r.last_reviewed_by), review_comment: r.review_comment, archive_reason: r.archive_reason,
      created_at: r.created_at, created_by: hsUser(r.created_by),
      attachments: hsAttachments("risk", r.id),
      // Comme le noyau : l'entrée la plus récente d'abord.
      history: [...hsHistory("risk", r.id)].reverse(),
      transitions: transitions(ctx, r),
      rights: droits(ctx, r),
    };
  }
  /** Fiche lue par le compte ; 404 hors de son périmètre, sans révéler son existence. */
  function risque(ctx, id) {
    const r = HS.risks.find((x) => x.id === Number(id));
    if (!r || !ctx.user.companies.includes(r.company_id) || !lisible(ctx, r)) throw new ApiError(404, "not_found", "Risque introuvable.");
    return r;
  }
  // Pièces jointes d'un risque : dépôt, téléchargement et retrait par les routes communes /hsseq/attachments.
  HS_ATTACH_MODELS.risk = (ctx, id) => risque(ctx, id);

  /* ─── Saisie ──────────────────────────────────────────────────────────── */

  function note(data, cle) {
    const v = data[cle];
    const n = typeof v === "number" ? v : /^\s*\d+\s*$/.test(String(v ?? "")) ? Number(v) : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > 5) throw hsBad("Gravités et probabilités se notent de 1 à 5.", [cle]);
    return n;
  }
  function jour(data, cle) {
    const v = data[cle];
    if (v === undefined || v === null || v === "") return null;
    const d = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw hsBad(`Date invalide : ${cle}.`, [cle]);
    return d;
  }
  /** Champs d'un risque (création ou mise à jour), avec les refus du noyau (risk_values). */
  function valeurs(ctx, data, r = null) {
    const v = {};
    if ("nature" in data) {
      if (!posee(NATURES, data.nature)) throw hsBad("Nature de risque inconnue.", ["nature"]);
      v.nature = data.nature;
    }
    if ("vehicle_kind" in data) {
      if (data.vehicle_kind && !posee(PROFILS, data.vehicle_kind)) throw hsBad("Profil de véhicule : tanker ou tipper.", ["vehicle_kind"]);
      v.vehicle_kind = data.vehicle_kind || null;
    }
    for (const [cle, max] of [["activity", 200], ["hazard", 4000], ["feared_event", 4000]]) {
      if (!(cle in data)) continue;
      v[cle] = hsText(data, cle, max);
      if (cle !== "activity" && !v[cle]) throw hsMissing("Danger et événement redouté sont à décrire.", [cle]);
    }
    for (const cle of NOTES) if (cle in data) v[cle] = note(data, cle);
    if ("site_id" in data) {
      const id = hsId(data, "site_id");
      const site = id ? hsSite(id) : null;
      if (id && (!site || !ctx.user.companies.includes(site.company_id))) throw new ApiError(404, "not_found", "Site introuvable.");
      v.site_id = id;
    }
    if ("review_date" in data) {
      v.review_date = jour(data, "review_date");
      if (!v.review_date) throw hsMissing("Date de revue manquante.", ["review_date"]);
    }
    if ("owner_id" in data) {
      const u = USERS.find((x) => x.id === hsId(data, "owner_id"));
      const societe = r?.company_id ?? ctx.company ?? 1;
      if (!u || !u.active || u.profiles.every((p) => p === "porteur") || !u.companies.includes(societe)) {
        throw hsRule("business_rule", "Propriétaire : un compte interne de la société.", { fields: ["owner_id"] });
      }
      v.owner_id = u.id;
    }
    return v;
  }
  /** Les mesures réduisent le risque : gravité et probabilité résiduelles jamais au-dessus des brutes. */
  function verifierResiduel(r) {
    if (r.residual_severity > r.raw_severity || r.residual_probability > r.raw_probability) {
      throw hsRule("residual_above_raw", "Gravité et probabilité résiduelles ne dépassent pas les brutes.", { fields: ["residual_severity", "residual_probability"] });
    }
  }
  /** Valeur écrite au journal : nom du site ou du propriétaire, sinon la valeur brute. */
  const lue = (cle, v) => (v === null || v === undefined || v === "" ? null : cle === "site_id" ? (hsSite(v)?.name ?? null) : cle === "owner_id" ? (hsUser(v)?.name ?? null) : String(v));
  /** Écrit des champs, une ligne de journal par champ suivi qui change (valeurs avant et après). */
  function ecrire(by, r, v, at = hsNow()) {
    for (const [cle, valeur] of Object.entries(v)) {
      const avant = lue(cle, r[cle]);
      const apres = lue(cle, valeur);
      r[cle] = valeur;
      if (SUIVIS.includes(cle) && avant !== apres) hsLog("risk", r.id, by, "write", cle, avant, apres, at);
    }
  }
  /** Champs d'une mesure de maîtrise (measure_values du noyau) ; `partiel` pour une modification. */
  function valeursMesure(data, partiel = false) {
    const v = {};
    if (!partiel || "control_level" in data) {
      if (!posee(MAITRISE, data.control_level)) throw hsBad("Niveau de maîtrise : elimination, substitution, engineering, administrative ou ppe.", ["control_level"]);
      v.control_level = data.control_level;
    }
    if (!partiel || "description" in data) {
      v.description = hsText(data, "description", 2000);
      if (!v.description) throw hsMissing("Description de la mesure manquante.", ["description"]);
    }
    if ("status" in data) {
      if (!ETATS_MESURE.includes(data.status)) throw hsBad("État : planned, in_place ou to_review.", ["status"]);
      v.status = data.status;
    }
    if ("sequence" in data) v.sequence = hsId(data, "sequence") ?? 10;
    if ("action_id" in data) {
      const id = hsId(data, "action_id");
      if (id && !HS.actions.some((a) => a.id === id)) throw new ApiError(404, "not_found", "Action introuvable.");
      v.action_id = id;
    }
    return v;
  }
  function nouvelleMesure(r, v) {
    const m = { id: ++HS.seq.risk_measure, risk_id: r.id, control_level: v.control_level, description: v.description, status: v.status ?? "planned", sequence: v.sequence ?? 10, action_id: v.action_id ?? null };
    HS.riskMeasures.push(m);
    return m;
  }
  const noteMesure = (m) => `${MAITRISE[m.control_level]} : ${m.description.slice(0, 200)}`;
  function nouveauRisque(v, by, at) {
    const r = {
      id: ++HS.seq.risk, reference: "", company_id: v.company_id ?? 1, nature: v.nature ?? "safety_hazard", vehicle_kind: v.vehicle_kind ?? null, activity: v.activity ?? null,
      site_id: v.site_id ?? null, hazard: v.hazard, feared_event: v.feared_event, raw_severity: v.raw_severity, raw_probability: v.raw_probability,
      residual_severity: v.residual_severity ?? v.raw_severity, residual_probability: v.residual_probability ?? v.raw_probability, owner_id: v.owner_id,
      review_date: v.review_date ?? ajouterMois(at.slice(0, 10), mois(v)), last_review_at: null, last_reviewed_by: null, review_comment: null, review_reminded_on: null,
      status: "draft", archive_reason: null, created_at: at, created_by: by,
    };
    r.reference = `RSK/${String(r.id).padStart(4, "0")}`;
    verifierResiduel(r);
    HS.risks.push(r);
    hsLog("risk", r.id, by, "create", null, null, null, at);
    return r;
  }

  /* ─── Routes ──────────────────────────────────────────────────────────── */

  route("GET", "/hsseq/risks", null, (ctx) => {
    hsInternal(ctx);
    const q = ctx.query;
    const base = registre(ctx, q);
    const choisis = hsSort(selection(ctx, q, base), q.sort, TRIS, "-residual_criticality");
    const parNiveau = (cote) => Object.fromEntries(NIVEAUX.map((n) => [n, choisis.filter((r) => niveau(r, cote) === n).length]));
    // Comme le noyau : comptes par statut sur tout le registre lisible (société comprise), les autres sur la sélection filtrée.
    const counts = {
      by_status: Object.fromEntries(Object.keys(STATUTS).map((s) => [s, base.filter((r) => r.status === s).length])),
      by_raw_level: parNiveau("raw"),
      by_residual_level: parNiveau("residual"),
      review_overdue: choisis.filter(echue).length,
    };
    return hsPage(ctx, choisis, counts, ligne);
  });

  route("GET", "/hsseq/risks/matrix", null, (ctx) => {
    hsInternal(ctx);
    const choisis = selection(ctx, ctx.query);
    const cases = (cote) => {
      const cellules = [];
      for (let p = 5; p >= 1; p -= 1) {
        for (let s = 1; s <= 5; s += 1) {
          cellules.push({ severity: s, probability: p, criticality: s * p, level: hsLevel(s * p), count: choisis.filter((r) => r[`${cote}_severity`] === s && r[`${cote}_probability`] === p).length });
        }
      }
      return cellules;
    };
    return { raw: cases("raw"), residual: cases("residual"), total: choisis.length };
  });

  route("GET", "/hsseq/risks/export.xlsx", COCKPIT, (ctx) => {
    const choisis = selection(ctx, ctx.query).sort((a, b) => critique(b, "residual") - critique(a, "residual") || critique(b, "raw") - critique(a, "raw") || a.id - b.id);
    const libelle = (n) => HS_LEVEL_LABELS[n] ?? "";
    const rows = choisis.map((r) => [
      r.reference, NATURES[r.nature], r.vehicle_kind ? PROFILS[r.vehicle_kind] : "Tous", r.activity ?? "", hsSite(r.site_id)?.name ?? "Tous", r.hazard, r.feared_event,
      r.raw_severity, r.raw_probability, critique(r, "raw"), libelle(niveau(r, "raw")), r.residual_severity, r.residual_probability, critique(r, "residual"), libelle(niveau(r, "residual")),
      mesures(r).map((m) => noteMesure(m)).join(" ; "), hsUser(r.owner_id)?.name ?? "", r.review_date, STATUTS[r.status],
    ]);
    const entete = ["Référence", "Nature", "Profil", "Activité", "Site", "Danger", "Événement redouté", "G brute", "P brute", "Criticité brute", "Niveau brut", "G résiduelle", "P résiduelle", "Criticité résiduelle", "Niveau résiduel", "Mesures", "Propriétaire", "Prochaine revue", "État"];
    return fileReply(xlsxBuffer([{ name: "Registre des risques HSSEQ", rows: [entete, ...rows] }]), XLSX, `registre_risques_hsseq_${TODAY.replaceAll("-", "")}.xlsx`);
  });

  route("GET", "/hsseq/risks/:id", null, (ctx) => {
    hsInternal(ctx);
    return fiche(ctx, risque(ctx, ctx.params[0]));
  });

  route("POST", "/hsseq/risks", ["hsseq"], (ctx) => {
    const data = ctx.body;
    const manquants = ["nature", "hazard", "feared_event", "owner_id", "raw_severity", "raw_probability"].filter((k) => data[k] === undefined || data[k] === null || data[k] === "");
    if (manquants.length) throw hsMissing("Champs obligatoires manquants.", manquants);
    const societe = data.company_id ? societes(ctx, { company_id: data.company_id })[0] : (ctx.company ?? 1);
    const mesuresDemandees = data.measures ?? [];
    if (!Array.isArray(mesuresDemandees) || mesuresDemandees.some((m) => !m || typeof m !== "object" || Array.isArray(m))) throw hsBad("Mesure invalide.", ["measures"]);
    const v = valeurs(ctx, data);
    // Toutes les mesures sont lues avant la création : un refus n'en laisse aucune trace.
    const lues = mesuresDemandees.map((m) => valeursMesure(m));
    const r = nouveauRisque({ ...v, company_id: societe }, ctx.user.id, hsNow());
    for (const m of lues) nouvelleMesure(r, m);
    return fiche(ctx, r);
  });

  route("PATCH", "/hsseq/risks/:id", null, (ctx) => {
    hsInternal(ctx);
    const r = risque(ctx, ctx.params[0]);
    if (!droits(ctx, r).can_edit) throw hsForbidden("Seuls le propriétaire du risque et le Responsable HSSEQ le mettent à jour, tant qu'il n'est pas archivé.");
    if ("owner_id" in ctx.body && !hsIs(ctx, "hsseq")) throw hsForbidden("Le propriétaire d'un risque est désigné par le Responsable HSSEQ.");
    const v = valeurs(ctx, ctx.body, r);
    verifierResiduel({ ...r, ...v });
    ecrire(ctx.user.id, r, v);
    return fiche(ctx, r);
  });

  // Mesures de maîtrise, avant la route des transitions (le segment « measures » lui ressemble).
  function modifiable(ctx, id) {
    const r = risque(ctx, id);
    if (!droits(ctx, r).can_edit) throw hsForbidden("Mesures d'un risque : son propriétaire ou le Responsable HSSEQ, tant qu'il n'est pas archivé.");
    return r;
  }
  function mesureDe(r, id) {
    const m = HS.riskMeasures.find((x) => x.id === Number(id) && x.risk_id === r.id);
    if (!m) throw new ApiError(404, "not_found", "Mesure introuvable sur ce risque.");
    return m;
  }
  route("POST", "/hsseq/risks/:id/measures", null, (ctx) => {
    hsInternal(ctx);
    const r = modifiable(ctx, ctx.params[0]);
    const m = nouvelleMesure(r, valeursMesure(ctx.body));
    hsLog("risk", r.id, ctx.user.id, "measure_added", null, null, null, hsNow(), noteMesure(m));
    return fiche(ctx, r);
  });
  route("PATCH", "/hsseq/risks/:id/measures/:mid", null, (ctx) => {
    hsInternal(ctx);
    const r = modifiable(ctx, ctx.params[0]);
    const m = mesureDe(r, ctx.params[1]);
    Object.assign(m, valeursMesure(ctx.body, true));
    hsLog("risk", r.id, ctx.user.id, "measure_updated", null, null, null, hsNow(), noteMesure(m));
    return fiche(ctx, r);
  });
  route("DELETE", "/hsseq/risks/:id/measures/:mid", null, (ctx) => {
    hsInternal(ctx);
    const r = modifiable(ctx, ctx.params[0]);
    const m = mesureDe(r, ctx.params[1]);
    hsLog("risk", r.id, ctx.user.id, "measure_removed", null, null, null, hsNow(), noteMesure(m));
    HS.riskMeasures = HS.riskMeasures.filter((x) => x.id !== m.id);
    return fiche(ctx, r);
  });

  route("POST", "/hsseq/risks/:id/:action", null, (ctx) => {
    hsInternal(ctx);
    const t = ctx.params[1];
    if (!TRANSITIONS.includes(t)) throw new ApiError(404, "not_found", "Transition inconnue.");
    const r = risque(ctx, ctx.params[0]);
    const data = ctx.body;
    if (!transitions(ctx, r).includes(t)) {
      if (permises(r).includes(t)) throw hsForbidden("Transition réservée au Responsable HSSEQ (la revue : aussi au propriétaire).");
      throw hsRule("invalid_transition", `Transition « ${t} » impossible depuis l'état « ${STATUTS[r.status]} ».`);
    }
    const by = ctx.user.id;
    const at = hsNow();
    if (t === "activate") {
      ecrire(by, r, { status: "active" }, at);
      hsLog("risk", r.id, by, "activate", null, null, null, at);
    } else if (t === "review") {
      const commentaire = hsText(data, "comment", 2000);
      const prochaine = jour(data, "next_review_date") ?? ajouterMois(TODAY, mois(r));
      if (prochaine <= TODAY) throw hsRule("invalid_parameter", "La prochaine revue est postérieure à aujourd'hui.", { fields: ["next_review_date"] });
      ecrire(by, r, { review_date: prochaine }, at);
      Object.assign(r, { last_review_at: at, last_reviewed_by: by, review_comment: commentaire, review_reminded_on: null });
      hsLog("risk", r.id, by, "review", null, null, null, at, commentaire);
    } else {
      const motif = String(data.reason ?? "").trim();
      if (!motif) throw hsRule("reason_required", t === "archive" ? "Le motif de l'archivage est obligatoire." : "Le motif de la réactivation est obligatoire.", { fields: ["reason"] });
      ecrire(by, r, { status: t === "archive" ? "archived" : "active" }, at);
      r.archive_reason = t === "archive" ? motif : null;
      hsLog("risk", r.id, by, t, null, null, null, at, motif);
    }
    return fiche(ctx, r);
  });

  /* ─── Données fictives ────────────────────────────────────────────────── */

  // Comptes : 16 Fanta Kourouma (Responsable HSSEQ), 12 Mamadou Bah (chef de parc de Matoto), 18 Sékou
  // Condé (chef de parc de Boffa), 19 Alhassane Diakité (maintenance, sans site rattaché : il ne lit que
  // les risques dont il est propriétaire). Sites : 1 parc de Matoto (citernes), 2 base minière de Boffa (bennes).
  const RISQUES = [
    {
      nature: "safety_hazard", vehicle_kind: "tanker", activity: "Livraison de carburant sur la RN3, de Conakry à Boffa", site_id: 1, owner_id: 16,
      hazard: "Citerne de 36 000 litres en charge sur une chaussée dégradée : virages serrés, accotements effondrés entre Dubréka et Boffa.",
      feared_event: "Renversement de la citerne sur la RN3, avec épandage du produit et départ de feu",
      raw: [5, 4], residual: [5, 2], status: "active", cree: "2026-01-12T09:15:00Z", activee: "2026-01-14T08:00:00Z",
      revue: { at: "2026-06-29T10:30:00Z", by: 16, comment: "Limiteurs de vitesse vérifiés sur les quatorze citernes ; la formation à la conduite défensive reste à programmer." }, review_date: "2026-12-29",
      mesures: [["engineering", "Limiteur de vitesse réglé à 60 km/h, suivi par géolocalisation", "in_place"], ["administrative", "Plan de trajet avec points d'arrêt ; pas de circulation de nuit sur la RN3", "in_place"], ["administrative", "Formation à la conduite défensive des conducteurs citerne, recyclage annuel", "planned", "formation"]],
      actions: [{ cle: "formation", description: "Former les quatorze conducteurs citerne à la conduite défensive (sessions de novembre)", control_level: "administrative", owner_id: 16, due_date: "2026-11-20", status: "in_progress", cree: "2026-07-02T09:00:00Z" }],
      piece: "Virage de Kolaboui relevé comme point noir en juin",
    },
    {
      nature: "environmental_aspect", vehicle_kind: "tanker", activity: "Dépotage chez le client", site_id: 1, owner_id: 12,
      hazard: "Flexible de dépotage usé ou raccord mal serré, aire de dépotage non étanche chez plusieurs clients.",
      feared_event: "Épandage d'hydrocarbure au dépotage et pollution du sol",
      raw: [4, 4], residual: [4, 2], status: "active", cree: "2026-01-12T09:40:00Z", activee: "2026-01-14T08:05:00Z", review_date: "2026-10-03",
      mesures: [["engineering", "Bac de rétention mobile sous le raccord à chaque dépotage", "in_place"], ["substitution", "Flexibles de plus de trois ans remplacés par des flexibles à raccord à sec", "planned", "flexibles"], ["administrative", "Mode opératoire de dépotage signé par le client et le conducteur", "in_place"], ["ppe", "Gants nitrile et lunettes pour le conducteur au dépotage", "in_place"]],
      actions: [{ cle: "flexibles", description: "Remplacer les flexibles de dépotage de plus de trois ans par des flexibles à raccord à sec (huit citernes)", control_level: "substitution", owner_id: 19, due_date: "2026-10-10", status: "todo", cree: "2026-04-21T11:00:00Z" }],
    },
    {
      nature: "safety_hazard", vehicle_kind: "tanker", activity: "Chargement au dépôt pétrolier de Conakry", site_id: 1, owner_id: 16,
      hazard: "Vapeurs d'hydrocarbures au dôme et électricité statique pendant le chargement.",
      feared_event: "Incendie au chargement de la citerne",
      raw: [5, 3], residual: [5, 1], status: "active", cree: "2026-01-12T10:05:00Z", activee: "2026-01-14T08:10:00Z",
      revue: { at: "2026-09-12T09:00:00Z", by: 16, comment: "Chargement en source généralisé au dépôt : risque résiduel ramené à modéré." }, review_date: "2027-03-12",
      mesures: [["engineering", "Chargement en source par le bas, bras étanche et récupération des vapeurs", "in_place"], ["engineering", "Pince de mise à la terre avec contrôle de continuité avant l'ouverture des vannes", "in_place"], ["administrative", "Permis de chargement ; téléphone interdit sur la piste", "in_place"], ["ppe", "Vêtements antistatiques et chaussures de sécurité", "in_place"]],
    },
    {
      nature: "health_hazard", vehicle_kind: null, activity: "Longs trajets et départs avant l'aube", site_id: null, owner_id: 16,
      hazard: "Fatigue des conducteurs : départs avant l'aube, journées de plus de dix heures, chaleur en cabine.",
      feared_event: "Somnolence au volant et sortie de route en conduite de nuit",
      raw: [5, 4], residual: [5, 3], status: "active", cree: "2026-01-19T08:30:00Z", activee: "2026-01-20T07:45:00Z",
      revue: { at: "2026-05-30T15:20:00Z", by: 16, comment: "Deux sorties de route de nuit au premier trimestre : l'interdiction de circuler de nuit est confirmée." }, review_date: "2026-11-30",
      mesures: [["administrative", "Pas de circulation entre 20 h et 5 h, sauf dérogation", "in_place"], ["administrative", "Conduite limitée à 9 h par jour, pause de 45 minutes toutes les 4 h 30", "in_place"], ["engineering", "Détecteur de somnolence en cabine, essai sur quatre ensembles", "planned", "detecteur"], ["administrative", "Sensibilisation des conducteurs à l'hygiène du sommeil", "to_review"]],
      actions: [{ cle: "detecteur", description: "Équiper quatre ensembles d'un détecteur de somnolence et en mesurer l'effet sur trois mois", control_level: "engineering", owner_id: 19, due_date: "2026-12-15", status: "todo", cree: "2026-06-02T10:00:00Z" }],
    },
    {
      nature: "security_threat", vehicle_kind: "tanker", activity: "Livraisons vers l'intérieur du pays", site_id: 1, owner_id: 12,
      hazard: "Citerne chargée arrêtée ou ralentie sur un tronçon isolé, convoi sans escorte.",
      feared_event: "Braquage du conducteur et vol de la cargaison sur un axe isolé",
      raw: [4, 3], residual: [4, 2], status: "active", cree: "2026-02-03T11:00:00Z", activee: "2026-02-04T08:30:00Z", review_date: "2026-09-25",
      mesures: [["administrative", "Horaires et itinéraires connus du seul chef de parc, variés d'un convoi à l'autre", "in_place"], ["engineering", "Géolocalisation avec alerte d'arrêt prolongé hors des points prévus", "in_place"], ["administrative", "Consigne de non-résistance et numéro d'alerte de la gendarmerie en cabine", "in_place"]],
    },
    {
      nature: "safety_hazard", vehicle_kind: "tanker", activity: "Manœuvres dans le parc de Matoto", site_id: 1, owner_id: 12,
      hazard: "Marches arrière des ensembles dans un parc encombré ; piétons et motos-taxis à l'entrée.",
      feared_event: "Écrasement d'un piéton par un ensemble en marche arrière",
      raw: [5, 3], residual: [5, 3], status: "draft", cree: "2026-10-13T14:20:00Z",
      mesures: [["engineering", "Alarme de recul et caméra arrière sur les tracteurs", "planned"], ["administrative", "Plan de circulation du parc et guide au sol pour toute marche arrière", "planned"]],
    },
    {
      nature: "environmental_aspect", vehicle_kind: "tanker", activity: "Lavage et dégazage des citernes", site_id: 1, owner_id: 19,
      hazard: "Eaux de lavage chargées d'hydrocarbures ; aire de lavage sans séparateur jusqu'en mars.",
      feared_event: "Rejet d'eaux huileuses vers le sol et le caniveau du quartier",
      raw: [3, 4], residual: [3, 2], status: "active", cree: "2026-02-16T09:00:00Z", activee: "2026-02-17T08:00:00Z",
      revue: { at: "2026-07-20T11:00:00Z", by: 19, comment: "Séparateur vidangé chaque mois depuis mars ; bordereaux de reprise classés." }, review_date: "2027-01-20",
      mesures: [["engineering", "Séparateur d'hydrocarbures sur l'aire de lavage, vidangé chaque mois", "in_place", "separateur"], ["administrative", "Registre de vidange et bordereau de reprise des boues", "in_place"]],
      actions: [{ cle: "separateur", description: "Installer un séparateur d'hydrocarbures sur l'aire de lavage du parc", control_level: "engineering", owner_id: 19, due_date: "2026-03-31", status: "closed", cree: "2026-02-18T09:00:00Z", fait: "2026-03-27" }],
    },
    {
      nature: "health_hazard", vehicle_kind: "tanker", activity: "Jaugeage et prélèvement d'échantillons", site_id: 1, owner_id: 12,
      hazard: "Vapeurs d'essence riches en benzène à l'ouverture du trou d'homme.",
      feared_event: "Intoxication chronique du personnel de jaugeage",
      raw: [3, 3], residual: [3, 2], status: "active", cree: "2026-03-02T10:00:00Z", activee: "2026-03-03T08:00:00Z",
      revue: { at: "2026-08-08T09:30:00Z", by: 12, comment: "Masques à cartouches portés à chaque prélèvement observé." }, review_date: "2027-02-08",
      mesures: [["substitution", "Jaugeage électronique sans ouverture du trou d'homme, sur les ensembles neufs", "planned"], ["ppe", "Demi-masque à cartouches A2 pour tout prélèvement", "in_place"]],
    },
    {
      nature: "health_hazard", vehicle_kind: "tipper", activity: "Chargement à la fosse 3 et roulage sur piste", site_id: 2, owner_id: 18,
      hazard: "Poussière de bauxite soulevée au chargement et sur les pistes en saison sèche.",
      feared_event: "Atteinte respiratoire des conducteurs exposés à la poussière de bauxite",
      raw: [3, 5], residual: [3, 3], status: "active", cree: "2026-03-09T07:45:00Z", activee: "2026-03-10T07:30:00Z",
      revue: { at: "2026-05-05T08:15:00Z", by: 18, comment: "Arrosage porté à trois passages par poste pendant la saison sèche." }, review_date: "2026-11-05",
      mesures: [["engineering", "Arrosage des pistes par camion à eau, trois passages par poste", "in_place"], ["engineering", "Cabines fermées et climatisées, filtres changés chaque mois", "to_review", "filtres"], ["ppe", "Masques FFP2 fournis au chargement", "in_place"]],
      actions: [{ cle: "filtres", description: "Remplacer les filtres de cabine des six bennes et tenir le registre des changements", control_level: "engineering", owner_id: 18, due_date: "2026-10-30", status: "in_progress", cree: "2026-09-21T08:00:00Z" }],
    },
    {
      nature: "safety_hazard", vehicle_kind: "tipper", activity: "Déchargement au port de Dapilon", site_id: 2, owner_id: 18,
      hazard: "Benne levée sur un sol meuble ou en dévers au quai de déchargement.",
      feared_event: "Renversement latéral de la benne au déchargement",
      raw: [4, 3], residual: [4, 1], status: "active", cree: "2026-03-09T08:10:00Z", activee: "2026-03-10T07:35:00Z",
      revue: { at: "2026-10-02T14:00:00Z", by: 18, comment: "Aire de basculement nivelée chaque semaine ; aucun incident depuis mars." }, review_date: "2027-04-02",
      mesures: [["engineering", "Aire de basculement stabilisée et nivelée, entretenue chaque semaine", "in_place"], ["administrative", "Benne jamais levée en dévers ni par vent fort ; guide au sol", "in_place"]],
    },
    {
      nature: "safety_hazard", vehicle_kind: "tipper", activity: "Circulation sur la piste minière", site_id: 2, owner_id: 18,
      hazard: "Croisement des bennes de 30 tonnes avec les engins de la mine sur une piste étroite.",
      feared_event: "Collision entre une benne et un engin minier sur la piste",
      raw: [5, 3], residual: [5, 2], status: "active", cree: "2026-03-09T08:30:00Z", activee: "2026-03-10T07:40:00Z", review_date: "2026-10-10",
      mesures: [["administrative", "Plan de circulation de la mine, priorité aux engins, radio dans chaque benne", "in_place"], ["engineering", "Feux à éclats et fanion de mât sur les bennes", "in_place"]],
    },
    {
      nature: "environmental_aspect", vehicle_kind: "tipper", activity: "Entretien des bennes à la base", site_id: 2, owner_id: 19,
      hazard: "Vidanges et réparations hydrauliques sur sol nu à la base de Boffa.",
      feared_event: "Fuite d'huile hydraulique vers le sol et la nappe",
      raw: [3, 3], residual: [3, 1], status: "active", cree: "2026-04-14T09:00:00Z", activee: "2026-04-15T08:00:00Z", review_date: "2027-04-14",
      mesures: [["engineering", "Dalle étanche avec rétention sous l'atelier", "in_place"], ["administrative", "Huiles usagées en fûts fermés, reprises par un collecteur agréé", "in_place"]],
    },
    {
      nature: "security_threat", vehicle_kind: "tipper", activity: "Stationnement de nuit à la base de Boffa", site_id: 2, owner_id: 18,
      hazard: "Base peu éclairée, clôture endommagée côté marigot.",
      feared_event: "Vol de gasoil dans les réservoirs des bennes stationnées",
      raw: [2, 4], residual: [2, 4], status: "draft", cree: "2026-10-14T16:05:00Z",
      mesures: [["engineering", "Bouchons de réservoir antisiphon", "planned"]],
    },
    {
      nature: "safety_hazard", vehicle_kind: null, activity: "Atelier pneumatique du parc", site_id: 1, owner_id: 19,
      hazard: "Gonflage de pneus 315/80 R22,5 sans cage de protection.",
      feared_event: "Éclatement d'un pneu au gonflage",
      raw: [4, 2], residual: [4, 1], status: "active", cree: "2026-05-04T10:00:00Z", activee: "2026-05-05T08:00:00Z", review_date: "2027-05-04",
      mesures: [["engineering", "Cage de gonflage et gonfleur à distance", "in_place"]],
    },
    {
      nature: "safety_hazard", vehicle_kind: "tanker", activity: "Transbordement après une panne", site_id: 1, owner_id: 12,
      hazard: "Transbordement de produit entre deux citernes en bord de route après une panne.",
      feared_event: "Inflammation du produit pendant un transbordement improvisé",
      raw: [5, 2], residual: [5, 1], status: "archived", cree: "2026-01-12T10:30:00Z", activee: "2026-01-14T08:15:00Z", review_date: "2027-01-12",
      archive: { at: "2026-08-14T10:00:00Z", by: 16, reason: "Transbordement en bord de route interdit par la note de service du 12/08/2026 : la citerne en panne est remorquée jusqu'au parc." },
      mesures: [["administrative", "Transbordement réservé au parc, sous permis de travail", "in_place"]],
    },
  ];

  for (const s of RISQUES) {
    const by = 16;
    const r = nouveauRisque(
      {
        nature: s.nature, vehicle_kind: s.vehicle_kind, activity: s.activity, site_id: s.site_id, hazard: s.hazard, feared_event: s.feared_event, owner_id: s.owner_id,
        raw_severity: s.raw[0], raw_probability: s.raw[1], residual_severity: s.residual[0], residual_probability: s.residual[1], review_date: s.review_date ?? null,
      },
      by,
      s.cree,
    );
    const actionsDe = {};
    for (const a of s.actions ?? []) {
      const action = hsNewAction({ description: a.description, origin: "risk", origin_id: r.id, control_level: a.control_level, owner_id: a.owner_id, due_date: a.due_date, status: a.status, created_at: a.cree, created_by: by, site_id: s.site_id ?? 1 });
      action.risk_id = r.id;
      if (a.status !== "todo") action.started_at = `${ajouterJours(a.cree.slice(0, 10), 7)}T08:00:00Z`;
      if (a.status === "closed") {
        Object.assign(action, { done_at: `${a.fait}T16:00:00Z`, closed_at: `${a.fait}T16:00:00Z` });
        hsPhoto("action", action.id, a.owner_id, `${a.fait}T15:40:00Z`, "Séparateur posé et raccordé");
      }
      hsLog("action", action.id, by, "create", null, null, null, a.cree);
      actionsDe[a.cle] = action.id;
    }
    s.mesures.forEach(([control_level, description, status, cle], i) => {
      nouvelleMesure(r, { control_level, description, status, sequence: (i + 1) * 10, action_id: cle ? actionsDe[cle] : null });
    });
    if (s.activee) {
      ecrire(by, r, { status: "active" }, s.activee);
      hsLog("risk", r.id, by, "activate", null, null, null, s.activee);
    }
    if (s.revue) {
      Object.assign(r, { last_review_at: s.revue.at, last_reviewed_by: s.revue.by, review_comment: s.revue.comment });
      hsLog("risk", r.id, s.revue.by, "review", null, null, null, s.revue.at, s.revue.comment);
    }
    if (s.archive) {
      ecrire(s.archive.by, r, { status: "archived" }, s.archive.at);
      r.archive_reason = s.archive.reason;
      hsLog("risk", r.id, s.archive.by, "archive", null, null, null, s.archive.at, s.archive.reason);
    }
    if (s.piece) hsAttach("risk", r.id, by, `releve-${r.reference.replace("/", "-").toLowerCase()}.png`, "image/png", HS_PNG, { created_at: s.cree, caption: s.piece, role: "evidence" });
  }

  // Relance des revues échues (_cron_review_reminders) : propriétaire et Responsable HSSEQ, chaque semaine.
  for (const r of HS.risks.filter(echue)) {
    let relance = ajouterJours(r.review_date, 1);
    while (ajouterJours(relance, 7) <= TODAY) relance = ajouterJours(relance, 7);
    r.review_reminded_on = relance;
    const [a, m, j] = r.review_date.split("-");
    hsNotify([r.owner_id, ...hsHsseqManagers()], "risk_review_overdue", `Revue de risque échue : ${r.reference}`, `${r.reference} : ${r.feared_event}\nRevue prévue le ${j}/${m}/${a}, propriétaire ${hsUser(r.owner_id)?.name ?? ""}.`, "risk", r.id, `${relance}T06:00:00Z`);
  }
}
