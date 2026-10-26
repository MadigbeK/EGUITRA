/**
 * Maquette du lot 3 HSSEQ : revue de direction (controllers/reviews.py et models/review.py du noyau,
 * branche hsseq). Routes et données fictives ; `H` porte les références de serveur.mjs (HS_REFS),
 * appelée après le semis et après les modules des lots 2 et 3, dont elle lit les tables.
 *
 * Tables sous H.DB.hsseq, aux noms de champs du noyau :
 * - reviews : reference, company_id, title, period_start, period_end, planned_date, held_on,
 *   participant_ids, external_participants, agenda, inputs, inputs_generated_at, minutes, conclusion,
 *   state (prepared, held, closed), closed_at, closed_by, reopen_reason ;
 * - reviewDecisions : review_id, sequence, topic, description, owner_id, due_date, action_id.
 * Les actions d'une revue sont celles du plan (DB.hsseq.actions) d'origine « review » dont origin_id est
 * la revue (review_id du noyau, recopié) ; les actions de la revue de janvier 2026 semées sans fiche
 * d'origine par hsseq-conformite.mjs y sont rattachées.
 *
 * Éléments d'entrée (inputs) au format de _compute_inputs, calculés sur les tables des lots 1 à 3 de la
 * maquette : indicateurs du cockpit (hsIndicators) ramenés aux mois de la période, événements, actions,
 * audits et constats, exigences, risques, maturité ISO, environnement et qualité, urgences, documents,
 * télématique, suite de la revue précédente. Générés à la préparation, régénérés par « refresh » tant que
 * la revue est préparée, une dernière fois à la tenue, puis figés. Les tables du lot 3 (déversements,
 * déchets, poussières, réclamations, plans et exercices, procédures, violations) s'écrivent en même temps
 * que ce module : elles sont lues avec prudence, sous les noms qu'emploie le cockpit de serveur.mjs.
 *
 * Droits du noyau : lecture pour l'administration, la direction, hsseq et l'auditeur ; préparation, tenue,
 * décisions et clôture pour la direction et hsseq ; réouverture d'une revue close par hsseq seul, avec un
 * motif.
 */

/**
 * Lecture (REVIEW_READ, hsseq@5119185) : l'auditeur lit les revues de ses sociétés, sans bornage par site
 * (revue de société), avec les noms du personnel interne (participants, responsables), jamais celui d'un
 * conducteur ni un indicateur d'alcootest ; dans l'historique et les pièces, la fonction de l'auteur à la
 * place de son nom. La garde commune de serveur.mjs (hsAuditorGuard) le tient en lecture seule et à sa
 * date de fin d'accès. Écriture (REVIEW_WRITE) : direction et hsseq.
 */
const LECTURE = ["admin", "direction", "hsseq", "auditeur"];
const ECRITURE = ["direction", "hsseq"];

const ETATS = { prepared: "Préparée", held: "Tenue", closed: "Close" };
/** Transitions permises depuis chaque état (_transitions du modèle). */
const TRANSITIONS = { prepared: ["refresh", "hold"], held: ["close"], closed: ["reopen"] };
const NATURES = { improvement: "Amélioration", system_change: "Changement du système de management", resources: "Ressources", objectives: "Objectifs et cibles", other: "Autre décision" };
const NIVEAUX_MAITRISE = ["elimination", "substitution", "engineering", "administrative", "ppe"];
const TRIS = { planned_date: (r) => r.planned_date, reference: (r) => r.reference, state: (r) => r.state };
/** Champs journalisés champ par champ (_journal_fields du modèle). */
const SUIVIS = ["title", "period_start", "period_end", "planned_date", "held_on", "participant_ids", "external_participants", "agenda", "minutes", "conclusion", "state"];
const MAX_MOIS = 24;
const LIMITE_LISTE = 20;
const CO2_PAR_LITRE = 2.68;
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const TYPES_EVENEMENT = ["work_accident", "road_accident", "near_miss", "hazard", "spill", "fire", "security_breach", "product_quality", "property_damage"];
const NIVEAUX = ["low", "moderate", "significant", "high"];
const ACTION_OUVERTE = ["todo", "in_progress", "to_verify"];
const CLASSEMENTS = ["major", "minor", "observation"];
const STATUTS_EXIGENCE = ["compliant", "partial", "non_compliant", "not_evaluated"];
const NORMES = [["iso_45001", "ISO 45001"], ["iso_14001", "ISO 14001"], ["iso_9001", "ISO 9001"], ["other", "Autre"]];
const VIOLATIONS = ["speeding", "harsh_braking", "night_driving", "driving_time"];
/** Fonction d'un compte, servie à l'auditeur à la place de son nom (FUNCTIONS du noyau, premier profil trouvé). */
const FONCTIONS = [["hsseq", "Responsable HSSEQ"], ["exploitation", "Chef de parc"], ["rh", "Ressources humaines"], ["conducteur", "Conducteur"], ["admin", "Administration"], ["direction", "Direction générale"], ["finance", "Finance"], ["auditeur", "Auditeur"]];

const pad = (n, w = 2) => String(n).padStart(w, "0");
const ajouterJours = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const joursEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/** Mois « AAAA-MM » décalé de `n` mois. */
function moisDecale(mois, n) {
  const d = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
/** Mois « AAAA-MM » couverts par une période (review_months du noyau). */
function moisDe(debut, fin) {
  const liste = [];
  for (let m = debut.slice(0, 7); m <= fin.slice(0, 7) && liste.length <= MAX_MOIS + 1; m = moisDecale(m, 1)) liste.push(m);
  return liste;
}
const libelleMois = (mois) => `${MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`;
/**
 * Période en toutes lettres (period_label du noyau) : « octobre 2026 » pour un seul mois, « d'octobre 2026
 * à décembre 2026 », « de mars 2026 à mai 2026 » sinon (élision devant une voyelle).
 */
function libellePeriode(debut, fin) {
  const premier = libelleMois(debut);
  if (debut.slice(0, 7) === fin.slice(0, 7)) return premier;
  return `${/^[aeiouy]/.test(premier) ? "d'" : "de "}${premier} à ${libelleMois(fin)}`;
}
const somme = (liste, f) => liste.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const compter = (liste, cles, f) => Object.fromEntries(cles.map((c) => [c, liste.filter((x) => f(x) === c).length]));
/** Première valeur renseignée parmi des noms de champ possibles (tables du lot 3 écrites en parallèle). */
const champ = (x, ...noms) => noms.map((n) => x?.[n]).find((v) => v !== undefined && v !== null && v !== "") ?? null;
/** Date ou horodatage dans [debut, fin] (« AAAA-MM-JJ »). */
const dans = (v, debut, fin) => Boolean(v) && String(v).slice(0, 10) >= debut && String(v).slice(0, 10) <= fin;
const pct = (a, b) => (b ? Math.round((a * 1000) / b) / 10 : null);

/**
 * État d'une valeur au regard de sa cible (indicator_status du noyau, marge de surveillance de 85 %) :
 * met, watch, missed ou no_data.
 */
function etatIndicateur(valeur, cible, sens) {
  if (valeur === null || valeur === undefined || cible === null || cible === undefined) return "no_data";
  if (sens === "up") return valeur >= cible ? "met" : valeur >= cible * 0.85 ? "watch" : "missed";
  if (valeur <= cible) return "met";
  return cible > 0 && valeur <= cible / 0.85 ? "watch" : "missed";
}

/** Texte en ASCII pour la police standard d'un PDF, coupé en lignes de `largeur` caractères. */
function lignesPdf(texte, largeur = 92) {
  const ascii = String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[«»]/g, '"').replace(/[’]/g, "'").replace(/[^\x20-\x7e\n]/g, " ");
  const sortie = [];
  for (const paragraphe of ascii.split("\n")) {
    let ligne = "";
    for (const mot of paragraphe.split(" ")) {
      if (ligne && `${ligne} ${mot}`.length > largeur) {
        sortie.push(ligne);
        ligne = mot;
      } else ligne = ligne ? `${ligne} ${mot}` : mot;
    }
    sortie.push(ligne);
  }
  return sortie;
}

/** PDF d'une page, police standard : compte rendu de maquette et pièces jointes semées. */
function pdf(titre, lignes) {
  const corps = [...lignesPdf(titre, 70), "", ...lignes.flatMap((l) => lignesPdf(l))];
  const page = corps.length > 44 ? [...corps.slice(0, 43), "(suite dans NIMOVA)"] : corps;
  const echappe = (s) => s.replace(/[()\\]/g, (c) => `\\${c}`);
  const texte = page.map((l, i) => `BT /F1 ${i ? 10 : 14} Tf 50 ${790 - i * 17} Td (${echappe(l)}) Tj ET`).join("\n");
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

/** Enregistre les tables et les routes du module ; appelé une fois par serveur.mjs, après seed() et les autres modules HSSEQ. */
export function enregistrerRevues(H) {
  const { route, ApiError, DB, TODAY } = H;
  const HS = DB.hsseq;
  if (!HS) {
    console.error("hsseq-revues : DB.hsseq absent, module non chargé.");
    return;
  }
  HS.reviews = [];
  HS.reviewDecisions = [];

  /* ─── Outils ─────────────────────────────────────────────────────────── */

  const introuvable = (message) => new ApiError(404, "not_found", message);
  const suivant = (liste) => liste.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const estHsseq = (ctx) => H.hsIs(ctx, "hsseq");
  const redacteur = (ctx) => H.hasProfile(ctx, ECRITURE);
  const compte = (id) => H.USERS.find((u) => u.id === id) ?? null;
  const nom = (id) => (id ? (H.hsUser(id)?.name ?? "") : "");
  /** Table d'un module HSSEQ sous l'un de ses noms possibles, vide sinon. */
  const table = (...noms) => noms.map((n) => HS[n]).find(Array.isArray) ?? [];
  const deLaSociete = (x, societe) => (x.company_id ?? 1) === societe;
  const ouverte = (a) => ACTION_OUVERTE.includes(a.status);

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

  const revueParId = (id) => HS.reviews.find((r) => r.id === id) ?? null;
  const decisionsDe = (r) => HS.reviewDecisions.filter((d) => d.review_id === r.id).sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  const actionsDe = (r) => HS.actions.filter((a) => a.origin === "review" && a.origin_id === r.id).sort((a, b) => a.id - b.id);

  /** Valeur journalisée d'un champ : noms des participants, sinon la valeur telle quelle. */
  function valeurJournal(cle, v) {
    if (v === null || v === undefined || v === "") return "";
    if (cle === "participant_ids") return v.map(nom).filter(Boolean).join(", ");
    return String(v);
  }
  /** Écrit des valeurs et journalise chaque champ suivi qui change (write du mixin journalisé). */
  function ecrireSuivi(by, r, valeurs, at = H.hsNow()) {
    const avant = Object.fromEntries(SUIVIS.map((c) => [c, valeurJournal(c, r[c])]));
    Object.assign(r, valeurs);
    for (const c of SUIVIS) {
      const apres = valeurJournal(c, r[c]);
      if (avant[c] !== apres) H.hsLog("review", r.id, by, "write", c, avant[c] || null, apres || null, at);
    }
  }

  /* ─── Éléments d'entrée (_compute_inputs) ────────────────────────────── */

  /**
   * Indicateurs du cockpit ramenés aux mois de la période (mois à venir exclus) : somme des mois pour un
   * nombre, valeur glissante du dernier mois pour un taux ou un ratio sur 12 mois, moyenne des mois sinon.
   */
  function indicateurs(r) {
    const courant = TODAY.slice(0, 7);
    const periode = moisDe(r.period_start, r.period_end).filter((m) => m <= courant);
    const points = new Map();
    let definitions = [];
    try {
      const dernier = periode[periode.length - 1] ?? courant;
      for (let fin = dernier; ; fin = moisDecale(fin, -12)) {
        const liste = H.hsIndicators(null, { company_id: String(r.company_id) }, fin, "12m");
        if (!definitions.length) definitions = liste;
        for (const i of liste) {
          if (!points.has(i.code)) points.set(i.code, new Map());
          for (const p of i.series) if (periode.includes(p.month) && !points.get(i.code).has(p.month)) points.get(i.code).set(p.month, p.value);
        }
        if (!periode.length || moisDecale(fin, -11) <= periode[0]) break;
      }
    } catch (e) {
      console.error("hsseq-revues : indicateurs non calculés.", e);
      return { liste: [], valeurs: {} };
    }
    const valeurs = {};
    const liste = definitions.map((i) => {
      const serie = [...(points.get(i.code) ?? new Map())].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
      let valeur = null;
      if (serie.length) {
        if (i.unit === "count") valeur = somme(serie, (v) => v);
        else if (i.unit === "rate" || i.unit === "ratio") valeur = serie[serie.length - 1];
        else valeur = Math.round((somme(serie, (v) => v) / serie.length) * 100) / 100;
      }
      valeurs[i.code] = valeur;
      return { code: i.code, label: i.label, unit: i.unit, direction: i.direction, value: valeur, target: i.target ?? null, family: i.family, source: i.source, formula: i.formula, status: etatIndicateur(valeur, i.target, i.direction) };
    });
    return { liste, valeurs };
  }

  function evenements(r) {
    const debut = `${r.period_start}T00:00:00Z`;
    const fin = `${r.period_end}T23:59:59Z`;
    const niveau = (e) => H.hsLevel(H.hsCriticality(e));
    const liste = (HS.events ?? []).filter((e) => deLaSociete(e, r.company_id) && e.occurred_at >= debut && e.occurred_at <= fin);
    const parType = compter(liste, TYPES_EVENEMENT, (e) => e.type);
    const parNiveau = compter(liste, NIVEAUX, niveau);
    let total = liste.length;
    // Mois d'avant les déclarations de la maquette : comptes de l'historique du cockpit (sans fiche).
    const premier = (HS.events ?? []).reduce((m, e) => (e.occurred_at < m ? e.occurred_at : m), "9999").slice(0, 7);
    if (r.company_id === 1 && HS.history instanceof Map) {
      for (const m of moisDe(r.period_start, r.period_end).filter((x) => x < premier)) {
        for (const kind of ["tanker", "tipper"]) {
          const h = HS.history.get(`${m}|${kind}`);
          if (!h) continue;
          parType.work_accident += h.work;
          parType.road_accident += h.road;
          parType.near_miss += h.nm;
          parNiveau.moderate += h.work + h.road;
          parNiveau.low += h.nm;
          total += h.work + h.road + h.nm;
        }
      }
    }
    const marquants = liste
      .filter((e) => ["significant", "high"].includes(niveau(e)))
      .sort((a, b) => (H.hsCriticality(b) ?? 0) - (H.hsCriticality(a) ?? 0) || a.occurred_at.localeCompare(b.occurred_at));
    return {
      total, open: liste.filter((e) => e.status !== "closed").length, unclassified: liste.filter((e) => !niveau(e)).length, by_type: parType, by_level: parNiveau,
      notable: marquants.slice(0, LIMITE_LISTE).map((e) => ({ id: e.id, reference: e.reference, title: e.title, event_type: e.type, level: niveau(e), criticality: H.hsCriticality(e), occurred_at: e.occurred_at, status: e.status, site: H.hsSite(e.site_id)?.name ?? null })),
      notable_count: marquants.length,
    };
  }

  /** État des actions au jour de la génération : une action close depuis était encore ouverte ce jour-là. */
  function actions(r, jour, valeurs) {
    const finJour = `${jour}T23:59:59Z`;
    const statut = (a) => {
      if (a.status === "closed" && a.closed_at && a.closed_at > finJour) return a.done_at && a.done_at <= finJour ? "to_verify" : a.started_at && a.started_at <= finJour ? "in_progress" : "todo";
      if (a.status === "to_verify" && a.done_at && a.done_at > finJour) return a.started_at && a.started_at <= finJour ? "in_progress" : "todo";
      return a.status;
    };
    const retard = (a) => (["todo", "in_progress"].includes(statut(a)) && a.due_date < jour ? joursEntre(a.due_date, jour) : 0);
    const registre = HS.actions.filter((a) => deLaSociete(a, r.company_id) && String(a.created_at ?? "") <= finJour);
    const ouvertes = registre.filter((a) => ACTION_OUVERTE.includes(statut(a)));
    const enRetard = ouvertes.filter((a) => retard(a) > 0).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
    return {
      open_by_status: compter(ouvertes, ACTION_OUVERTE, statut),
      overdue: enRetard.length,
      created: registre.filter((a) => dans(a.created_at, r.period_start, r.period_end)).length,
      closed: registre.filter((a) => a.status === "closed" && dans(a.closed_at, r.period_start, r.period_end)).length,
      on_time_rate: valeurs.actions_on_time ?? null, effectiveness_rate: valeurs.actions_effectiveness ?? null,
      overdue_items: enRetard.slice(0, LIMITE_LISTE).map((a) => ({ id: a.id, reference: a.reference, description: String(a.description).slice(0, 300), origin: a.origin, owner: nom(a.owner_id), owner_id: a.owner_id ?? null, due_date: a.due_date, days_overdue: retard(a) })),
    };
  }

  /** Audits de la période ; constats ouverts des audits réalisés au jour de la génération (registre de ce jour-là). */
  function audits(r, jour) {
    const liste = (HS.audits ?? []).filter((a) => a.company_id === r.company_id && a.status !== "cancelled" && dans(a.planned_date, r.period_start, r.period_end))
      .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || a.id - b.id);
    const faits = liste.filter((a) => ["done", "closed"].includes(a.status));
    const auditDu = (f) => (HS.audits ?? []).find((a) => a.id === f.audit_id);
    const constats = (HS.findings ?? []).filter((f) => f.company_id === r.company_id && f.status === "open" && String(auditDu(f)?.actual_date ?? auditDu(f)?.planned_date ?? "") <= jour);
    const importants = constats.filter((f) => ["major", "minor"].includes(f.classification)).sort((a, b) => (a.classification !== "major") - (b.classification !== "major") || a.id - b.id);
    return {
      planned: liste.length, done: faits.length, rate: liste.length ? Math.round((faits.length * 1000) / liste.length) / 10 : null,
      items: liste.slice(0, LIMITE_LISTE).map((a) => ({
        id: a.id, reference: a.reference, title: a.title, standard: a.standard, status: a.status, planned_date: a.planned_date, actual_date: a.actual_date ?? null,
        findings: compter((HS.findings ?? []).filter((f) => f.audit_id === a.id), CLASSEMENTS, (f) => f.classification),
      })),
      open_findings_by_class: compter(constats, CLASSEMENTS, (f) => f.classification),
      open_findings: importants.slice(0, LIMITE_LISTE).map((f) => ({ id: f.id, reference: f.reference, classification: f.classification, description: String(f.description).slice(0, 300), audit: (HS.audits ?? []).find((a) => a.id === f.audit_id)?.reference ?? "" })),
    };
  }

  const exigencesDe = (r) => (HS.requirements ?? []).filter((x) => x.company_id === r.company_id && x.active !== false);

  function exigences(r) {
    const liste = exigencesDe(r);
    const ecarts = liste.filter((x) => ["non_compliant", "partial"].includes(x.status)).sort((a, b) => (a.status !== "non_compliant") - (b.status !== "non_compliant") || a.reference.localeCompare(b.reference));
    return {
      by_status: compter(liste, STATUTS_EXIGENCE, (x) => x.status),
      non_compliant: ecarts.slice(0, LIMITE_LISTE).map((x) => ({ id: x.id, reference: x.reference, title: x.title, source: x.source, source_reference: x.source_reference, status: x.status })),
    };
  }

  function maturite(r) {
    const resultat = [];
    for (const [code, label] of NORMES) {
      const liste = exigencesDe(r).filter((x) => x.standard === code);
      if (!liste.length) continue;
      const evaluees = liste.filter((x) => x.status !== "not_evaluated");
      const note = somme(evaluees, (x) => (x.status === "compliant" ? 1 : x.status === "partial" ? 0.5 : 0));
      resultat.push({ standard: code, label, requirements: liste.length, evaluated: evaluees.length, score: evaluees.length ? Math.round((note * 1000) / evaluees.length) / 10 : null });
    }
    return resultat.length ? resultat : null;
  }

  function risques(r, jour) {
    const criticite = (x) => (x.residual_severity ?? 0) * (x.residual_probability ?? 0);
    const liste = (HS.risks ?? []).filter((x) => x.company_id === r.company_id && x.status === "active" && String(x.created_at ?? "") <= `${jour}T23:59:59Z`);
    const eleves = liste.filter((x) => ["high", "significant"].includes(H.hsLevel(criticite(x)))).sort((a, b) => criticite(b) - criticite(a) || a.id - b.id);
    return {
      active: liste.length,
      by_residual_level: compter(liste, NIVEAUX, (x) => H.hsLevel(criticite(x))),
      reviews_overdue: liste.filter((x) => x.review_date && x.review_date < jour).length,
      high_residual: eleves.slice(0, LIMITE_LISTE).map((x) => ({ id: x.id, reference: x.reference, feared_event: String(x.feared_event).slice(0, 300), residual_criticality: criticite(x), residual_level: H.hsLevel(criticite(x)), owner: nom(x.owner_id), owner_id: x.owner_id ?? null })),
    };
  }

  function environnement(r, valeurs) {
    const { company_id: societe, period_start: debut, period_end: fin } = r;
    const surPeriode = (liste, ...noms) => liste.filter((x) => deLaSociete(x, societe) && dans(champ(x, ...noms), debut, fin));
    const deversements = surPeriode(table("spills"), "occurred_at", "spilled_at", "date");
    const poussieres = surPeriode(table("dustMeasurements", "dust", "dusts"), "measured_on", "measured_at", "date");
    const dechets = table("wastes").filter((x) => deLaSociete(x, societe));
    const reclamations = table("complaints").filter((x) => deLaSociete(x, societe));
    let co2 = 0;
    try {
      if (societe === 1) for (const m of moisDe(debut, fin).filter((x) => x <= TODAY.slice(0, 7))) for (const kind of ["tanker", "tipper"]) co2 += (H.hsLiters(m, kind) || 0) * CO2_PAR_LITRE;
    } catch {
      co2 = 0;
    }
    return {
      spills: deversements.length, spill_liters: Math.round(somme(deversements, (x) => champ(x, "volume_liters", "volume", "liters")) * 10) / 10,
      spill_recovered_liters: Math.round(somme(deversements, (x) => champ(x, "recovered_liters", "recovered")) * 10) / 10,
      contaminations: surPeriode(table("contaminations"), "detected_on", "detected_at", "date").length,
      dust_measurements: poussieres.length,
      dust_exceedances: poussieres.filter((x) => x.exceeded ?? (Number(x.value) > Number(x.threshold))).length,
      wastes_collected: dechets.filter((x) => x.status === "collected" && dans(champ(x, "pickup_date", "collected_on"), debut, fin)).length,
      wastes_stored_now: dechets.filter((x) => x.status === "stored").length,
      fuel_consumption: valeurs.fuel_consumption ?? null, co2_emissions: valeurs.co2_emissions ?? null, co2_kg: Math.round(co2 * 10) / 10,
      tanker_shortage: valeurs.tanker_shortage ?? null, tipper_variance: valeurs.tipper_variance ?? null,
      complaints: {
        received: reclamations.filter((x) => dans(champ(x, "received_on", "received_at", "date"), debut, fin)).length,
        on_time_rate: valeurs.complaints_on_time ?? null,
        open_now: reclamations.filter((x) => x.status !== "closed").length,
      },
    };
  }

  function urgences(r) {
    const { company_id: societe, period_start: debut, period_end: fin } = r;
    const fait = (x) => ["done", "performed"].includes(x.status);
    const plans = table("emergencyPlans", "emergency_plans", "plans").filter((x) => deLaSociete(x, societe) && x.active !== false);
    const exercices = table("drills").filter((x) => deLaSociete(x, societe));
    const periode = exercices.filter((x) => x.status !== "cancelled" && dans(x.planned_date, debut, fin));
    const depuis = ajouterJours(fin, -365);
    const sansExercice = plans.filter((p) => !exercices.some((d) => d.plan_id === p.id && fait(d) && dans(champ(d, "performed_date", "performed_on"), depuis, fin)));
    return {
      plans_active: plans.length, drills_planned: periode.length, drills_done: periode.filter(fait).length,
      plans_without_recent_drill: sansExercice.slice(0, LIMITE_LISTE).map((p) => ({ id: p.id, reference: p.reference ?? "", title: p.title ?? "", site: H.hsSite(p.site_id)?.name ?? null, scenario: p.scenario ?? "other" })),
    };
  }

  function documents(r) {
    const procedures = table("procedures").filter((x) => deLaSociete(x, r.company_id) && ["published", "active", "in_force"].includes(x.status));
    const accuses = table("acknowledgements", "acknowledgments");
    const attendus = somme(procedures, (p) => champ(p, "ack_targets", "targets") ?? 0);
    const lus = somme(procedures, (p) => champ(p, "ack_count", "read") ?? accuses.filter((a) => a.procedure_id === p.id).length);
    return {
      procedures_published: procedures.length,
      read_rate: attendus ? Math.round((lus * 1000) / attendus) / 10 : null,
      bulletins_published: table("bulletins").filter((x) => deLaSociete(x, r.company_id) && x.status !== "draft" && dans(x.published_at, r.period_start, r.period_end)).length,
    };
  }

  function telematique(r, valeurs) {
    const liste = table("violations", "telematicsViolations").filter((x) => deLaSociete(x, r.company_id) && dans(champ(x, "occurred_at", "date"), r.period_start, r.period_end));
    return { violations: liste.length, per_100_trips: valeurs.telematics_violations ?? null, by_type: compter(liste, VIOLATIONS, (x) => champ(x, "violation_type", "type")) };
  }

  /** Revue précédente : tenue ou close, même société, prévue au plus tard le même jour (_previous du modèle). */
  function precedente(r) {
    const p = HS.reviews.filter((x) => x.company_id === r.company_id && x.id !== r.id && ["held", "closed"].includes(x.state) && x.planned_date <= r.planned_date)
      .sort((a, b) => b.planned_date.localeCompare(a.planned_date) || b.id - a.id)[0];
    if (!p) return null;
    return {
      id: p.id, reference: p.reference, held_on: p.held_on,
      decisions: decisionsDe(p).map((d) => {
        const a = d.action_id ? HS.actions.find((x) => x.id === d.action_id) : null;
        return { id: d.id, topic: d.topic, description: d.description.slice(0, 300), action: a ? { id: a.id, reference: a.reference, status: a.status, due_date: a.due_date } : null };
      }),
    };
  }

  /** Éléments d'entrée d'une revue, au jour `jour` (registres) et sur sa période (indicateurs, événements, audits). */
  function elementsEntree(r, jour) {
    const mois = moisDe(r.period_start, r.period_end);
    const { liste, valeurs } = indicateurs(r);
    return {
      period: { from: r.period_start, to: r.period_end, months: mois, label: libellePeriode(r.period_start, r.period_end) },
      generated_on: jour,
      indicators: liste,
      events: evenements(r),
      actions: actions(r, jour, valeurs),
      audits: audits(r, jour),
      requirements: exigences(r),
      risks: risques(r, jour),
      iso_maturity: maturite(r),
      environment: environnement(r, valeurs),
      emergency: urgences(r),
      documents: documents(r),
      telematics: telematique(r, valeurs),
      previous_review: precedente(r),
    };
  }

  /** (Re)génère les éléments d'entrée ; un calcul en échec laisse les précédents (la maquette ne tombe pas). */
  function generer(r, jour = TODAY, at = H.hsNow()) {
    try {
      r.inputs = elementsEntree(r, jour);
      r.inputs_generated_at = at;
    } catch (e) {
      console.error(`hsseq-revues : éléments d'entrée de ${r.reference} non générés.`, e);
    }
  }

  /* ─── Lignes et fiches ───────────────────────────────────────────────── */

  /* Lecture de l'auditeur (personal_data_hidden du noyau) : noms du personnel interne, jamais celui d'un
     conducteur ; auteur d'une écriture (journal, pièce) par sa seule fonction ; éléments d'entrée sans
     indicateur d'alcootest. */

  const masque = (ctx) => H.hsPersonalHidden(ctx);
  const conducteur = (id) => Boolean(id && compte(id)?.profiles.includes("conducteur"));
  /** Compte cité par la revue (person du contrôleur) : nom nul pour un conducteur lu par l'auditeur. */
  const personne = (ctx, id) => (!id ? null : masque(ctx) && conducteur(id) ? { id, name: null } : H.hsUser(id));
  /** Auteur d'une écriture (actor_ref du noyau) : pour l'auditeur, sa fonction à la place de son nom. */
  function auteur(ctx, ref) {
    if (!ref || !masque(ctx)) return ref;
    const profils = compte(ref.id)?.profiles ?? [];
    return { id: null, name: null, function: FONCTIONS.find(([code]) => profils.includes(code))?.[1] ?? "Utilisateur interne" };
  }
  /** Éléments d'entrée lus par l'auditeur (auditor_inputs) : sans alcootest, sans nom de conducteur. */
  function entreesLues(ctx, inputs) {
    if (!inputs || !masque(ctx)) return inputs;
    const copie = structuredClone(inputs);
    copie.indicators = (copie.indicators ?? []).filter((i) => !String(i.code).startsWith("breath_test"));
    for (const item of [...(copie.actions?.overdue_items ?? []), ...(copie.risks?.high_residual ?? [])]) if (conducteur(item.owner_id)) item.owner = null;
    return copie;
  }

  /** Ligne d'action du plan, avec l'origine que sert le noyau (référence et intitulé de la revue). */
  function ligneAction(ctx, r, a) {
    const l = { ...H.hsActionLine(a), origin_label: `${r.reference} ${r.title}` };
    // action_line du noyau (owner_ref) : jamais le nom d'un responsable conducteur pour l'auditeur.
    if (masque(ctx) && conducteur(a.owner_id)) l.owner = { id: a.owner_id, name: null };
    return l;
  }
  function ligne(r) {
    const liste = actionsDe(r);
    return {
      id: r.id, reference: r.reference, title: r.title, company: { id: r.company_id, name: H.COMPANIES[r.company_id]?.name ?? "" },
      period: { from: r.period_start, to: r.period_end }, planned_date: r.planned_date, held_on: r.held_on ?? null, state: r.state,
      decisions_count: decisionsDe(r).length, actions_count: liste.length, open_actions: liste.filter(ouverte).length, participants_count: r.participant_ids.length,
    };
  }
  /** Transitions et droits du compte (review_rights) : rédacteurs seulement ; la réouverture au seul Responsable HSSEQ. */
  function droits(ctx, r) {
    const transitions = redacteur(ctx) ? TRANSITIONS[r.state].filter((t) => t !== "reopen" || estHsseq(ctx)) : [];
    return { transitions, rights: { can_edit: redacteur(ctx) && r.state !== "closed", can_close: transitions.includes("close"), can_approve: transitions.includes("hold") } };
  }
  function fiche(ctx, r) {
    const { transitions, rights } = droits(ctx, r);
    return {
      ...ligne(r),
      participants: r.participant_ids.map((id) => personne(ctx, id)), external_participants: r.external_participants ?? null, agenda: r.agenda ?? null,
      inputs: entreesLues(ctx, r.inputs) ?? null, inputs_generated_at: r.inputs_generated_at ?? null, minutes: r.minutes ?? null, conclusion: r.conclusion ?? null,
      decisions: decisionsDe(r).map((d) => {
        const a = d.action_id ? HS.actions.find((x) => x.id === d.action_id) : null;
        return { id: d.id, sequence: d.sequence, topic: d.topic, description: d.description, owner: personne(ctx, d.owner_id), due_date: d.due_date ?? null, action: a ? ligneAction(ctx, r, a) : null };
      }),
      actions: actionsDe(r).map((a) => ligneAction(ctx, r, a)),
      closed_at: r.closed_at ?? null, closed_by: H.hsUser(r.closed_by), reopen_reason: r.reopen_reason ?? null,
      attachments: H.hsAttachments("review", r.id).map((x) => ({ ...x, created_by: auteur(ctx, x.created_by) })),
      // Le journal du noyau est servi du plus récent au plus ancien.
      history: H.hsHistory("review", r.id).reverse().map((h) => ({ ...h, by: auteur(ctx, h.by) })), transitions, rights,
    };
  }

  function revueDe(ctx, id) {
    const r = revueParId(id);
    if (!r || !ctx.user.companies.includes(r.company_id)) throw introuvable("Revue de direction introuvable.");
    return r;
  }

  /* ─── Valeurs reçues ─────────────────────────────────────────────────── */

  function valeursRevue(data, r = null) {
    const v = {};
    for (const cle of ["period_start", "period_end", "planned_date"]) {
      if (!(cle in data)) continue;
      v[cle] = dateOuNul(data, cle);
      if (!v[cle]) throw H.hsMissing("Période et date de la revue sont obligatoires.", [cle]);
    }
    const debut = v.period_start ?? r?.period_start;
    const fin = v.period_end ?? r?.period_end;
    if (debut && fin) {
      if (fin < debut) throw H.hsBad("La fin de la période précède son début.", ["period_end"]);
      if (moisDe(debut, fin).length > MAX_MOIS) throw H.hsBad("Période d'une revue : 24 mois au plus.", ["period_end"]);
    }
    for (const [cle, max] of [["title", 300], ["external_participants", 2000], ["agenda", 4000], ["minutes", 20000], ["conclusion", 8000]]) if (cle in data) v[cle] = H.hsText(data, cle, max);
    if ("title" in v && !v.title) throw H.hsMissing("Intitulé de la revue manquant.", ["title"]);
    if ("participant_ids" in data) {
      const comptes = [...new Set(H.hsIds(data, "participant_ids"))].map(compte).filter(Boolean);
      if (comptes.some((u) => u.profiles.every((p) => p === "porteur"))) throw H.hsRule("business_rule", "Participants : des comptes internes.", { fields: ["participant_ids"] });
      v.participant_ids = comptes.map((u) => u.id);
    }
    return v;
  }

  function valeursDecision(data, partiel = false, r = null) {
    const v = {};
    if (!partiel || "topic" in data) {
      const t = data.topic || "improvement";
      if (!Object.hasOwn(NATURES, String(t))) throw H.hsBad("Nature de décision inconnue.", ["topic"]);
      v.topic = t;
    }
    if (!partiel || "description" in data) {
      v.description = H.hsText(data, "description", 4000);
      if (!v.description) throw H.hsMissing("Décision à rédiger.", ["description"]);
    }
    if ("owner_id" in data) {
      const id = H.hsId(data, "owner_id");
      const u = id ? compte(id) : null;
      if (u && (u.profiles.every((p) => p === "porteur") || (r && !u.companies.includes(r.company_id)))) throw H.hsRule("business_rule", "Responsable : un compte interne de la société.", { fields: ["owner_id"] });
      v.owner_id = u ? u.id : null;
    }
    if ("due_date" in data) v.due_date = dateOuNul(data, "due_date");
    if ("sequence" in data) v.sequence = H.intArg(data, "sequence", 10) || 10;
    return v;
  }

  /** Action d'origine « revue » (action_values) : responsable interne de la société, échéance ; ceux de la décision à défaut. */
  function valeursAction(data, r, decision) {
    const id = H.hsId(data, "owner_id") ?? decision?.owner_id ?? null;
    const u = id ? compte(id) : null;
    if (!u || !u.active || u.profiles.every((p) => p === "porteur") || !u.companies.includes(r.company_id)) throw H.hsRule("business_rule", "Responsable de l'action : un compte interne de la société.", { fields: ["owner_id"] });
    const echeance = dateOuNul(data, "due_date") ?? decision?.due_date ?? null;
    if (!echeance) throw H.hsMissing("Échéance de l'action manquante.", ["due_date"]);
    const v = { owner_id: u.id, due_date: echeance };
    if (data.description) v.description = H.hsText(data, "description", 4000);
    if ("expected_evidence" in data) v.expected_evidence = H.hsText(data, "expected_evidence", 2000);
    if (data.control_level) {
      if (!NIVEAUX_MAITRISE.includes(data.control_level)) throw H.hsBad("Niveau de maîtrise inconnu.", ["control_level"]);
      v.control_level = data.control_level;
    }
    if ("estimated_cost" in data) {
      const brut = data.estimated_cost;
      const n = brut === null || brut === "" ? 0 : Number(String(brut).replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(n)) throw H.hsBad("Nombre invalide : estimated_cost.", ["estimated_cost"]);
      v.estimated_cost = Math.max(n, 0);
    }
    return v;
  }

  /* ─── Création et cycle ──────────────────────────────────────────────── */

  /** Revue préparée ; référence RDD/année/nn (séquence du noyau, année de création) ; éléments d'entrée générés aussitôt. */
  function creerRevue(valeurs, by, at = H.hsNow(), jour = TODAY) {
    const annee = at.slice(0, 4);
    const rang = HS.reviews.filter((x) => x.reference.startsWith(`RDD/${annee}/`)).length + 1;
    const r = {
      id: suivant(HS.reviews), reference: `RDD/${annee}/${pad(rang)}`, company_id: 1, title: "", period_start: TODAY, period_end: TODAY, planned_date: TODAY, held_on: null,
      participant_ids: [], external_participants: null, agenda: null, inputs: null, inputs_generated_at: null, minutes: null, conclusion: null, state: "prepared",
      closed_at: null, closed_by: null, reopen_reason: null, ...valeurs,
    };
    if (!r.title) r.title = `Revue de direction HSSEQ, ${libellePeriode(r.period_start, r.period_end)}`;
    HS.reviews.push(r);
    H.hsLog("review", r.id, by, "create", null, null, null, at);
    generer(r, jour, at);
    return r;
  }

  function exiger(r, transition) {
    if (!TRANSITIONS[r.state].includes(transition)) throw H.hsRule("invalid_transition", `Transition « ${transition} » impossible depuis l'état « ${ETATS[r.state]} ».`);
  }

  /**
   * Tenue : éléments d'entrée générés une dernière fois (au jour du calcul, le jour même pour une tenue
   * déclarée dans l'écran), puis figés ; date de la séance.
   */
  function tenir(r, by, jour, at = H.hsNow(), calcul = jour) {
    generer(r, calcul, at);
    ecrireSuivi(by, r, { state: "held", held_on: jour }, at);
    H.hsLog("review", r.id, by, "hold", null, null, null, at);
  }

  function clore(r, by, at = H.hsNow()) {
    ecrireSuivi(by, r, { state: "closed" }, at);
    Object.assign(r, { closed_at: at, closed_by: by });
    H.hsLog("review", r.id, by, "close", null, null, null, at);
  }

  /** Décision de la revue ; la séquence suit l'ordre d'inscription. */
  function creerDecision(r, valeurs, by, at = H.hsNow()) {
    const d = { id: suivant(HS.reviewDecisions), review_id: r.id, sequence: 10, topic: "improvement", description: "", owner_id: null, due_date: null, action_id: null, ...valeurs };
    HS.reviewDecisions.push(d);
    H.hsLog("review", r.id, by, "decision_added", null, null, null, at, d.description.slice(0, 300));
    return d;
  }

  /** Action du plan qui met en œuvre la décision (_create_action) : origine « revue », sans site. */
  function creerAction(r, d, valeurs, by, at = H.hsNow()) {
    const a = H.hsNewAction({
      description: valeurs.description || d.description, origin: "review", origin_id: r.id, control_level: valeurs.control_level ?? null, owner_id: valeurs.owner_id,
      due_date: valeurs.due_date, expected_evidence: valeurs.expected_evidence ?? null, estimated_cost: valeurs.estimated_cost ?? 0, created_at: at, created_by: by, site_id: null,
    });
    a.review_id = r.id;
    H.hsLog("action", a.id, by, "create", null, null, null, at);
    Object.assign(d, { action_id: a.id, owner_id: d.owner_id ?? a.owner_id, due_date: d.due_date ?? a.due_date });
    H.hsLog("review", r.id, by, "decision_action", null, null, null, at, `${a.reference} : ${d.description.slice(0, 200)}`);
    return a;
  }

  /* ─── Données fictives ───────────────────────────────────────────────── */

  try {
    semer();
  } catch (e) {
    // Un semis en échec ne doit pas empêcher la maquette de démarrer : les tables restent en l'état.
    console.error("hsseq-revues : semis interrompu.", e);
  }

  function semer() {
    const at = (jour, heure = 9, minute = 0) => `${jour}T${pad(heure)}:${pad(minute)}:00Z`;
    const piece = (model, id, by, nomFichier, titre, lignes, jour, role) =>
      H.hsAttach(model, id, by, nomFichier, "application/pdf", pdf(titre, [...lignes, "", "Fichier de maquette : donnees fictives."]), { created_at: at(jour, 17), role });
    const ordreDuJour = [
      "1. Suite des décisions de la revue précédente",
      "2. Changements du contexte : clients, réglementation, activité",
      "3. Indicateurs et objectifs de la période",
      "4. Événements, enquêtes et état des actions",
      "5. Audits, constats et conformité aux exigences",
      "6. Risques et opportunités",
      "7. Environnement, qualité et réclamations des clients",
      "8. Urgences, documents et conduite des véhicules (télématique)",
      "9. Consultation et participation du personnel",
      "10. Ressources, décisions et conclusions de la direction",
    ].join("\n");

    /** Action d'une décision semée : statut, dates et preuve d'une action réalisée. */
    const actionSemee = (r, d, x, cree) => {
      const a = creerAction(r, d, { owner_id: x.owner, due_date: x.due, control_level: x.lvl, estimated_cost: x.cost ?? 0, expected_evidence: x.preuve ?? null }, 16, at(cree, 17, 30));
      a.status = x.status;
      if (x.status !== "todo") a.started_at = at(x.debut ?? cree, 9);
      if (x.approuvee) Object.assign(a, { approved_at: at(x.approuvee, 10), approved_by: 8, approved_cost: x.cost });
      if (x.fait) {
        Object.assign(a, { done_at: at(x.fait, 16), closed_at: at(x.fait, 17) });
        H.hsAttach("action", a.id, x.owner, `preuve-${a.reference.replaceAll("/", "-")}.pdf`, "application/pdf", pdf(`Preuve de realisation ${a.reference}`, [a.description, "", "Fichier de maquette : donnees fictives."]), { created_at: at(x.fait, 15), role: "evidence" });
        H.hsLog("action", a.id, x.owner, "close", "status", "in_progress", "closed", at(x.fait, 17));
      }
      return a;
    };

    // Revue du second semestre 2025, tenue le 20 janvier 2026 : ses actions ont été semées par
    // hsseq-conformite.mjs sans fiche d'origine (origin_id nul), elles lui sont rattachées.
    const r1 = creerRevue({
      title: "Revue de direction HSSEQ, de juillet 2025 à décembre 2025", period_start: "2025-07-01", period_end: "2025-12-31", planned_date: "2026-01-20",
      participant_ids: [8, 16, 11, 12, 19, 6], external_participants: "Ibrahima Camara, délégué du personnel des conducteurs", agenda: ordreDuJour,
    }, 16, at("2026-01-06", 10), "2026-01-06");
    tenir(r1, 16, "2026-01-20", at("2026-01-20", 8));
    ecrireSuivi(16, r1, {
      minutes: [
        "Suite de la revue précédente : première revue tenue dans NIMOVA ; le plan d'actions de 2025 a été repris au registre.",
        "Indicateurs du semestre : taux de fréquence au-dessus de la cible au troisième trimestre ; les contrôles avant départ sont encore saisis sur papier, sans suivi possible de leur réalisation.",
        "Audits : un audit interne ISO 45001 au parc de Matoto en novembre, deux écarts mineurs levés en décembre ; la base de Boffa n'a jamais été auditée en interne.",
        "Consultation du personnel : le délégué demande un recyclage de conduite défensive pour les conducteurs de bennes, formés en 2022.",
        "Ressources : le Responsable HSSEQ tient seul le registre des exigences ; un suppléant est nécessaire.",
      ].join("\n\n"),
      conclusion: "Le système de management HSSEQ est adapté à l'activité citerne mais incomplet pour l'activité minière de Boffa. La direction maintient la politique HSSEQ et fixe les objectifs de 2026 : taux de fréquence sous 5, aucun alcootest positif, tous les contrôles avant départ saisis dans NIMOVA Terrain.",
    }, at("2026-01-20", 17));
    const adopter = (description) => HS.actions.find((a) => a.origin === "review" && !a.origin_id && a.description === description) ?? null;
    for (const x of [
      { topic: "improvement", desc: "Inscrire au programme d'audits 2026 un audit interne de la base de Boffa", owner: 16, due: "2026-02-28", status: "closed", fait: "2026-01-22" },
      { topic: "system_change", desc: "Présenter chaque mois au comité HSSE les indicateurs exigés par les donneurs d'ordre", owner: 16, due: "2026-03-31", status: "closed", fait: "2026-03-27" },
      { topic: "resources", desc: "Budgéter pour 2027 le recyclage de conduite défensive de tous les conducteurs de bennes", owner: 8, due: "2026-11-30", status: "in_progress", cost: 45_000_000 },
      { topic: "resources", desc: "Désigner un suppléant du Responsable HSSEQ pour la tenue du registre des exigences", owner: 2, due: "2026-09-30", status: "todo" },
    ]) {
      const d = creerDecision(r1, { topic: x.topic, description: x.desc, owner_id: x.owner, due_date: x.due, sequence: 10 * (decisionsDe(r1).length + 1) }, 16, at("2026-01-20", 17));
      const a = adopter(x.desc);
      if (a) {
        Object.assign(a, { origin_id: r1.id, review_id: r1.id });
        d.action_id = a.id;
        H.hsLog("review", r1.id, 16, "decision_action", null, null, null, at("2026-01-20", 17, 30), `${a.reference} : ${x.desc.slice(0, 200)}`);
      } else actionSemee(r1, d, { ...x, lvl: "administrative" }, "2026-01-20");
    }
    creerDecision(r1, {
      topic: "objectives", sequence: 50, owner_id: 8, due_date: "2026-12-31",
      description: "Objectifs HSSEQ de 2026 : taux de fréquence inférieur à 5, aucun alcootest positif, tous les contrôles avant départ réalisés dans NIMOVA Terrain, suivis chaque mois au cockpit.",
    }, 8, at("2026-01-20", 17, 10));
    piece("review", r1.id, 16, "feuille-emargement-RDD-2026-01.pdf", `Feuille d'emargement de la revue ${r1.reference}`, ["Seance du 20/01/2026 au siege, de 9 h a 12 h 30.", "Sept participants, signatures recueillies."], "2026-01-20", "document");
    clore(r1, 16, at("2026-01-27", 16));

    // Revue du premier semestre 2026, tenue le 16 juillet et close le 23 : décisions et actions suivies au plan.
    const r2 = creerRevue({
      title: "Revue de direction HSSEQ, de janvier 2026 à juin 2026", period_start: "2026-01-01", period_end: "2026-06-30", planned_date: "2026-07-16",
      participant_ids: [8, 16, 11, 12, 18, 19, 6], external_participants: "Ibrahima Camara, délégué du personnel des conducteurs\nAïcha Diallo, animatrice sécurité du parc de Matoto", agenda: ordreDuJour,
    }, 16, at("2026-07-01", 10), "2026-07-01");
    tenir(r2, 16, "2026-07-16", at("2026-07-16", 8));
    ecrireSuivi(16, r2, {
      minutes: [
        "Suite de la revue de janvier : audit interne de Boffa inscrit au programme 2026 ; indicateurs des donneurs d'ordre présentés chaque mois au comité HSSE depuis mars ; recyclage de conduite défensive des conducteurs de bennes à budgéter pour 2027 ; suppléant du registre des exigences pas encore désigné.",
        "Événements du semestre : le renversement de la citerne ER-03 dans le virage de Tanènè, le 17 mai, domine le semestre (conducteur blessé, gasoil répandu sur l'accotement) ; tentative de siphonnage de nuit à Mamou le 3 juin ; fuite d'huile sur l'aire de lavage de Matoto le 26 mai. Les limiteurs de vitesse de la ligne de Boké et la formation à la conduite défensive des conducteurs citerne sont engagés.",
        "Audits et conformité : audit interne ISO 45001 de Matoto en mars, écart majeur sur la préparation aux situations d'urgence traité par l'exercice d'avril ; aucun exercice environnemental à Boffa.",
        "Consultation du personnel : le délégué relaie la demande des conducteurs de supprimer les fiches papier du contrôle avant départ, saisies en double, et signale la vitesse des bennes sur la piste du port de Dapilon.",
        "Ressources : la base de Boffa n'a pas d'animateur HSSE ; l'équipement télématique des six bennes est chiffré à 120 M GNF.",
      ].join("\n\n"),
      conclusion: "Le système de management HSSEQ est adapté et efficace pour l'activité citerne : les causes du renversement de Tanènè ont été traitées en deux mois. Il reste insuffisant à Boffa, où la vitesse des bennes, la préparation aux urgences environnementales et l'animation HSSE ne sont pas tenues. La direction maintient les objectifs de 2026 et accorde les moyens décidés en séance.",
    }, at("2026-07-16", 17));
    for (const [i, x] of [
      { topic: "resources", desc: "Équiper les six bennes de Boffa de boîtiers télématiques avec limiteur de vitesse avant la fin de l'année", action: { owner: 19, due: "2026-12-15", lvl: "engineering", status: "in_progress", cost: 120_000_000, approuvee: "2026-07-28", debut: "2026-08-03", preuve: "Procès-verbal de pose des boîtiers et relevé des vitesses du premier mois" } },
      { topic: "objectives", desc: "Porter à 100 % la réalisation des contrôles avant départ sur les deux sites, suivie chaque mois au comité HSSE", action: { owner: 16, due: "2026-09-30", lvl: "administrative", status: "closed", fait: "2026-09-28" } },
      { topic: "improvement", desc: "Organiser à la base de Boffa un exercice d'urgence environnemental : épandage d'hydrocarbures sur la piste", action: { owner: 18, due: "2026-10-10", lvl: "administrative", status: "in_progress", debut: "2026-09-01", preuve: "Compte rendu de l'exercice et feuille de présence" } },
      { topic: "system_change", desc: "Supprimer les fiches papier du contrôle avant départ : saisie dans NIMOVA Terrain seule, avant chaque départ", action: { owner: 11, due: "2026-08-31", lvl: "administrative", status: "closed", fait: "2026-08-27" } },
      { topic: "resources", desc: "Recruter un animateur HSSE pour la base minière de Boffa", owner: 8, due: "2026-12-31" },
    ].entries()) {
      const d = creerDecision(r2, { topic: x.topic, description: x.desc, owner_id: x.owner ?? x.action?.owner ?? null, due_date: x.due ?? x.action?.due ?? null, sequence: 10 * (i + 1) }, 16, at("2026-07-16", 17, 5 + i));
      if (x.action) actionSemee(r2, d, x.action, "2026-07-16");
    }
    piece("review", r2.id, 16, "feuille-emargement-RDD-2026-02.pdf", `Feuille d'emargement de la revue ${r2.reference}`, ["Seance du 16/07/2026 au siege, de 9 h a 13 h.", "Neuf participants, signatures recueillies."], "2026-07-16", "document");
    piece("review", r2.id, 16, "presentation-revue-S1-2026.pdf", "Presentation projetee en seance", ["Indicateurs du premier semestre 2026, evenements marquants, audits, risques."], "2026-07-16", "document");
    clore(r2, 16, at("2026-07-23", 16));

    // Revue du troisième trimestre, préparée le 8 octobre pour la fin du mois, avant l'audit de certification ISO 45001.
    const r3 = creerRevue({
      title: "Revue de direction HSSEQ, de juillet 2026 à septembre 2026", period_start: "2026-07-01", period_end: "2026-09-30", planned_date: "2026-10-29",
      participant_ids: [8, 16, 11, 12, 18, 19], external_participants: "Ibrahima Camara, délégué du personnel des conducteurs",
      agenda: `${ordreDuJour}\n11. Préparation de l'audit de certification ISO 45001, étape 1, du 8 décembre`,
    }, 16, at("2026-10-08", 9, 15), "2026-10-08");
    piece("review", r3.id, 16, "convocation-RDD-2026-03.pdf", `Convocation a la revue ${r3.reference}`, ["Seance du jeudi 29/10/2026 au siege, de 9 h a 12 h 30.", "Ordre du jour joint ; elements d'entree consultables dans NIMOVA."], "2026-10-08", "document");
  }

  /* ─── Pièces jointes de la revue ─────────────────────────────────────── */

  // Les routes des pièces (serveur.mjs) retrouvent la fiche par HS_ATTACH_MODELS.
  if (H.HS_ATTACH_MODELS) H.HS_ATTACH_MODELS.review = (ctx, id) => revueDe(ctx, id);

  /* ─── Routes ─────────────────────────────────────────────────────────── */

  route("GET", "/hsseq/reviews", LECTURE, (ctx) => {
    const q = ctx.query;
    const comps = societes(ctx, q);
    const etats = H.hsList(q.state);
    const annee = H.intArg(q, "year", null);
    const liste = HS.reviews.filter((r) => comps.includes(r.company_id) && (!etats || etats.includes(r.state)) && (!annee || r.planned_date.slice(0, 4) === String(annee)));
    const counts = { by_state: Object.fromEntries(Object.keys(ETATS).map((s) => [s, liste.filter((r) => r.state === s).length])) };
    return H.hsPage(ctx, H.hsSort([...liste], q.sort, TRIS, "-planned_date"), counts, ligne);
  });

  route("GET", "/hsseq/reviews/:id", LECTURE, (ctx) => fiche(ctx, revueDe(ctx, ctx.params[0])));

  route("POST", "/hsseq/reviews", ECRITURE, (ctx) => {
    const b = ctx.body;
    requis(b, "period_start", "period_end", "planned_date");
    const company = b.company_id ? societes(ctx, { company_id: b.company_id })[0] : (ctx.company ?? 1);
    const valeurs = valeursRevue(b);
    return fiche(ctx, creerRevue({ ...valeurs, company_id: company }, ctx.user.id));
  });

  route("PATCH", "/hsseq/reviews/:id", ECRITURE, (ctx) => {
    const r = revueDe(ctx, ctx.params[0]);
    if (r.state === "closed") throw H.hsRule("invalid_transition", "Revue close : le Responsable HSSEQ la rouvre avant toute modification.");
    const valeurs = valeursRevue(ctx.body, r);
    if (("period_start" in valeurs || "period_end" in valeurs) && r.state !== "prepared") throw H.hsRule("invalid_transition", "Revue tenue : sa période ne change plus.");
    const at = H.hsNow();
    ecrireSuivi(ctx.user.id, r, valeurs, at);
    if (["period_start", "period_end", "planned_date"].some((k) => k in valeurs) && r.state === "prepared") generer(r, TODAY, at);
    return fiche(ctx, r);
  });

  /* Décisions : avant la route des transitions, dont le segment :action répondrait à « decisions ». */

  /** Revue qui accepte encore des décisions (_editable). */
  function modifiable(ctx) {
    const r = revueDe(ctx, ctx.params[0]);
    if (r.state === "closed") throw H.hsRule("invalid_transition", "Revue close : plus de décision.");
    return r;
  }
  function decisionDe(r, id) {
    const d = HS.reviewDecisions.find((x) => x.id === id && x.review_id === r.id);
    if (!d) throw introuvable("Décision introuvable dans cette revue.");
    return d;
  }

  route("POST", "/hsseq/reviews/:id/decisions", ECRITURE, (ctx) => {
    const r = modifiable(ctx);
    const b = ctx.body;
    if (b.action !== undefined && (b.action === null || typeof b.action !== "object" || Array.isArray(b.action))) throw H.hsBad("Action invalide.", ["action"]);
    const valeurs = valeursDecision(b, false, r);
    // L'action est contrôlée avant toute écriture : le noyau annule la décision avec elle sur un refus.
    const action = b.action ? valeursAction(b.action, r, { owner_id: valeurs.owner_id ?? null, due_date: valeurs.due_date ?? null }) : null;
    const at = H.hsNow();
    const d = creerDecision(r, { ...valeurs, sequence: valeurs.sequence ?? 10 * (decisionsDe(r).length + 1) }, ctx.user.id, at);
    if (action) creerAction(r, d, action, ctx.user.id, at);
    return fiche(ctx, r);
  });

  route("PATCH", "/hsseq/reviews/:id/decisions/:id", ECRITURE, (ctx) => {
    const r = modifiable(ctx);
    const d = decisionDe(r, ctx.params[1]);
    Object.assign(d, valeursDecision(ctx.body, true, r));
    H.hsLog("review", r.id, ctx.user.id, "decision_updated", null, null, null, H.hsNow(), d.description.slice(0, 300));
    return fiche(ctx, r);
  });

  route("DELETE", "/hsseq/reviews/:id/decisions/:id", ECRITURE, (ctx) => {
    const r = modifiable(ctx);
    const d = decisionDe(r, ctx.params[1]);
    if (d.action_id) throw H.hsRule("invalid_transition", "Décision mise en œuvre par une action : elle se conserve.");
    H.hsLog("review", r.id, ctx.user.id, "decision_removed", null, null, null, H.hsNow(), d.description.slice(0, 300));
    HS.reviewDecisions = HS.reviewDecisions.filter((x) => x.id !== d.id);
    return fiche(ctx, r);
  });

  route("POST", "/hsseq/reviews/:id/decisions/:id/action", ECRITURE, (ctx) => {
    const r = modifiable(ctx);
    const d = decisionDe(r, ctx.params[1]);
    if (d.action_id) throw H.hsRule("invalid_transition", "Cette décision a déjà son action.");
    creerAction(r, d, valeursAction(ctx.body, r, d), ctx.user.id);
    return fiche(ctx, r);
  });

  /*
   * Compte rendu en PDF : une page de maquette, le noyau rend le compte rendu complet (douze rubriques).
   * Revue préparée : ses éléments d'entrée du jour, calculés à l'impression sans écriture (review_inputs) ;
   * figés ensuite. Pour l'auditeur, sans alcootest ni nom de conducteur (« conducteur »).
   */

  route("GET", "/hsseq/reviews/:id/report.pdf", LECTURE, (ctx) => {
    const r = revueDe(ctx, ctx.params[0]);
    let jour = null;
    if (r.state === "prepared" || !r.inputs) {
      try {
        jour = elementsEntree(r, TODAY);
      } catch (e) {
        console.error(`hsseq-revues : éléments d'entrée du jour de ${r.reference} non calculés.`, e);
      }
    }
    const e = entreesLues(ctx, jour ?? r.inputs) ?? {};
    const nomLu = (id) => (masque(ctx) && conducteur(id) ? "conducteur" : nom(id));
    const horsCible = (e.indicators ?? []).filter((i) => i.status === "missed").length;
    const lignes = [
      `${H.COMPANIES[r.company_id]?.name ?? ""} ; ${ETATS[r.state]}.`,
      `Periode : ${e.period?.label ?? libellePeriode(r.period_start, r.period_end)}. Prevue le ${r.planned_date}${r.held_on ? `, tenue le ${r.held_on}` : ""}.`,
      `Elements d'entree : ${r.state === "prepared" ? `du ${TODAY} (revue preparee)` : `rassembles le ${String(r.inputs_generated_at ?? "").slice(0, 10) || "-"}`}.`,
      `Participants : ${r.participant_ids.map(nomLu).join(", ") || "-"}${r.external_participants ? ` ; ${r.external_participants.replaceAll("\n", " ; ")}` : ""}.`,
      "",
      `Indicateurs non conformes : ${horsCible} sur ${(e.indicators ?? []).length}. Evenements : ${e.events?.total ?? 0}, dont ${e.events?.notable_count ?? 0} marquants. Actions en retard : ${e.actions?.overdue ?? 0}.`,
      "",
      "Compte rendu des echanges :",
      r.minutes || "-",
      "",
      "Decisions et actions :",
      ...decisionsDe(r).map((d, i) => {
        const a = d.action_id ? HS.actions.find((x) => x.id === d.action_id) : null;
        return `${i + 1}. [${NATURES[d.topic]}] ${d.description}${d.owner_id ? `, ${nomLu(d.owner_id)}` : ""}${a ? ` (${a.reference})` : " (sans action)"}`;
      }),
      "",
      "Conclusions de la direction :",
      r.conclusion || "-",
      "",
      `Imprime le ${TODAY}. Fichier de maquette : donnees fictives.`,
    ];
    return H.fileReply(pdf(`Revue de direction HSSEQ ${r.reference}`, lignes), "application/pdf", `revue_direction_${r.reference.replaceAll("/", "-")}.pdf`);
  });

  /* Transitions : rafraîchir, tenir, clore, rouvrir. */

  route("POST", "/hsseq/reviews/:id/:action", ECRITURE, (ctx) => {
    const t = ctx.params[1];
    if (!Object.values(TRANSITIONS).flat().includes(t)) throw introuvable("Transition inconnue.");
    const r = revueDe(ctx, ctx.params[0]);
    const b = ctx.body;
    if (t === "reopen" && !estHsseq(ctx)) throw H.hsForbidden("Une revue close n'est rouverte que par le Responsable HSSEQ.");
    exiger(r, t);
    const at = H.hsNow();
    if (t === "refresh") {
      generer(r, TODAY, at);
      H.hsLog("review", r.id, ctx.user.id, "refresh", null, null, null, at);
    } else if (t === "hold") {
      // Participants et date contrôlés avant toute écriture (le noyau annule la transaction entière sur un refus).
      const valeurs = valeursRevue(Object.fromEntries(["participant_ids", "external_participants"].filter((k) => k in b).map((k) => [k, b[k]])), r);
      const jour = dateOuNul(b, "held_on") ?? TODAY;
      if (jour > TODAY) throw H.hsRule("invalid_parameter", "Une revue se déclare tenue à une date passée ou du jour.", { fields: ["held_on"] }, 400);
      const presents = valeurs.participant_ids ?? r.participant_ids;
      const autres = "external_participants" in valeurs ? valeurs.external_participants : r.external_participants;
      if (!presents.length && !String(autres ?? "").trim()) throw H.hsRule("participants_required", "Désignez les participants de la revue avant de la tenir.", { fields: ["participant_ids"] });
      ecrireSuivi(ctx.user.id, r, valeurs, at);
      tenir(r, ctx.user.id, jour, at, TODAY);
    } else if (t === "close") {
      const manque = ["minutes", "conclusion"].filter((k) => !String(r[k] ?? "").trim());
      if (manque.length) throw H.hsRule("minutes_required", "Rédigez le compte rendu et les conclusions avant de clore la revue.", { fields: manque });
      if (!decisionsDe(r).length) throw H.hsRule("decisions_missing", "Une revue de direction se clôt avec au moins une décision.", { fields: ["decisions"] });
      clore(r, ctx.user.id, at);
    } else {
      const motif = String(b.reason ?? "").trim();
      if (!motif) throw H.hsRule("reason_required", "Le motif de la réouverture est obligatoire.", { fields: ["reason"] });
      ecrireSuivi(ctx.user.id, r, { state: "held" }, at);
      Object.assign(r, { closed_at: null, closed_by: null, reopen_reason: motif });
      H.hsLog("review", r.id, ctx.user.id, "reopen", null, null, null, at, motif);
    }
    return fiche(ctx, r);
  });
}
