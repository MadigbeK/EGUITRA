/**
 * Maquette du lot 2 HSSEQ : habilitations et rapport mensuel HSSE au format d'un donneur d'ordre.
 *
 * Habilitations : controllers/qualifications.py et models/qualification.py du noyau, sur les données de
 * RH (eguitra_rh/models/hsseq.py) : types d'habilitation, habilitations des salariés liés à un chauffeur,
 * aptitude médicale en statut seul (jamais de détail médical), alertes J-30 et J-7 envoyées.
 * Rapport mensuel : controllers/reports.py et models/report.py : catalogue des valeurs calculées, modèles
 * des donneurs d'ordre et leurs indicateurs, mois du rapport (valeurs calculées figées le 5 du mois
 * suivant, valeurs saisies, commentaires, validation, réouverture avec motif), classeur Excel et PDF.
 *
 * Routes et données fictives, aux noms de champs du noyau ; `H` porte les références de serveur.mjs
 * (HS_REFS). Appelée juste après le semis du lot 1 : les tables s'ajoutent à H.DB.hsseq
 * (qualificationTypes, rhEmployees, qualifications, expiryAlerts, reportTemplates, reportIndicators,
 * reports, reportValues). Deux aides sont exportées pour le cockpit et le verrou de la maquette :
 * situationHabilitations (indicateur qualifications_valid) et statutConducteur (motif V04).
 */

/* ─── Profils des routes (noyau) ─────────────────────────────────────────── */

/** Matrice : administration, direction, hsseq, RH ; chef de parc borné à ses sites (QUAL_READ). */
const QUAL_READ = ["admin", "direction", "hsseq", "rh", "exploitation"];
/** Lecture complète de la matrice (READ_ALL | rh) ; tout autre compte : ses sites, fermé par défaut. */
const QUAL_FULL = ["admin", "direction", "hsseq", "rh"];
/** Alertes envoyées : jamais le chef de parc. */
const ALERTS_READ = ["admin", "direction", "hsseq", "rh"];
/** Rapport mensuel : rapport de société, sans bornage par site. */
const REPORT_READ = ["admin", "direction", "hsseq"];
const CONFIG = ["admin", "hsseq"];
const HSSEQ = ["hsseq"];

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/* ─── Habilitations : constantes du noyau et de RH ───────────────────────── */

/** Gravité d'un statut, pour le statut d'ensemble d'un conducteur (STATUS_RANK). */
const STATUS_RANK = { expired: 3, missing: 2, to_renew: 1, valid: 0 };
/** Statuts de RH rendus en anglais par l'API (QUALIFICATION_STATUSES, FITNESS_STATUSES). */
const QUALIFICATION_STATUSES = { valide: "valid", a_renouveler: "to_renew", expiree: "expired", absente: "missing" };
const FITNESS_STATUSES = { apte: "fit", apte_reserve: "review", inapte: "unfit", echue: "unfit", inconnu: "review" };
/** Réglages de RH : « à renouveler » à 30 jours ; alerte urgente à 7 jours. */
const ALERT_DAYS = 30;
const URGENT_DAYS = 7;
const DOCUMENT_REASON = { insurance: "V05", inspection: "V05", calibration: "V06", tightness: "V06" };
/** Premier jour des alertes de la maquette (tâche quotidienne _cron_alerts rejouée jusqu'au jour de référence). */
const DEBUT_ALERTES = "2026-08-01";

/** Types d'habilitation (eguitra.rh.qualification.type), dans leur ordre. */
const TYPES = [
  { id: 1, code: "permis_pl", name: "Permis de conduire poids lourd", validity_months: 0, mandatory_for_drivers: true, sequence: 10, active: true },
  { id: 2, code: "conduite_defensive", name: "Conduite défensive", validity_months: 36, mandatory_for_drivers: true, sequence: 20, active: true },
  { id: 3, code: "matieres_dangereuses", name: "Matières dangereuses (ADR)", validity_months: 60, mandatory_for_drivers: false, sequence: 30, active: true },
  { id: 4, code: "acces_site_minier", name: "Accès au site minier", validity_months: 12, mandatory_for_drivers: false, sequence: 40, active: true },
  { id: 5, code: "secourisme", name: "Sauveteur secouriste du travail", validity_months: 24, mandatory_for_drivers: false, sequence: 50, active: true },
];

/** Aptitudes de la démonstration (au 15/10/2026) : [aptitude, visite, valable jusqu'au]. */
const APTITUDES = {
  "Mamadou Aliou Bah": ["apte", "2025-11-03", "2026-11-02"],
  "Karim Sow": ["apte_reserve", "2026-05-12", "2027-05-11"],
  "Boubacar Bah": ["apte", "2025-10-09", "2026-10-08"],
  "Ismaël Sow": [null, null, null],
};
/** Échéances de la démonstration : [obtenue le, expire le] par conducteur et par type. */
const ECHEANCES = {
  "Lamine Barry": { conduite_defensive: ["2023-10-21", "2026-10-21"] },
  "Mohamed Soumah": { conduite_defensive: ["2023-10-02", "2026-10-02"] },
  "Thierno Bah": { conduite_defensive: ["2023-11-09", "2026-11-09"] },
  "Souleymane Diallo": { matieres_dangereuses: ["2021-11-12", "2026-11-12"] },
  "Ibrahima Camara": { matieres_dangereuses: ["2021-09-20", "2026-09-20"] },
  "Alpha Oumar Baldé": { acces_site_minier: ["2025-10-20", "2026-10-20"] },
  "Alseny Keïta": { secourisme: ["2024-08-15", "2026-08-15"] },
};
/** Embauché en septembre : ni permis saisi, ni conduite défensive, ni visite d'aptitude. */
const NOUVEAU = "Ismaël Sow";

/* ─── Rapport mensuel : constantes du noyau ─────────────────────────────── */

const NATURES = ["proactive", "reactive"];
const MODES = ["computed", "manual"];
const AGGREGATIONS = ["sum", "average", "last"];
const UNIT_LABELS = { rate: "taux", ratio: "ratio", pct: "%", count: "nbre", per_mille: "‰", l_100km: "L/100 km", kg_co2_km: "kg CO₂/km" };
/** Cibles par défaut des paramètres (DEFAULT_TARGETS de settings.py). */
const DEFAULT_TARGETS = { frequency_rate: 5, severity_rate: 0.2, road_accidents_per_mkm: 1.5, reporting_ratio: 10, check_completion: 100, check_compliance: 95, breath_test_completion: 100, breath_test_positives: 0, waivers: 2, actions_on_time: 90, actions_effectiveness: 80, qualifications_valid: 100, fuel_consumption: 44, co2_emissions: 1.18, tanker_shortage: 1.5, tipper_variance: 5, audits_completion: 100, immobilizations: 0 };
/** Indicateurs du cockpit (INDICATORS de cockpit.py) : code, libellé, unité, sens, source, glissant, famille. */
const INDICATORS = [
  ["frequency_rate", "Taux de fréquence", "rate", "down", "Événements, RH", true, "reactive"],
  ["severity_rate", "Taux de gravité", "rate", "down", "Événements, RH", true, "reactive"],
  ["road_accidents_per_mkm", "Accidents de la route par million de km", "rate", "down", "Événements, Transport", true, "reactive"],
  ["reporting_ratio", "Taux de déclaration", "ratio", "up", "Événements", true, "proactive"],
  ["check_completion", "Réalisation des contrôles avant départ", "pct", "up", "NIMOVA Terrain, Transport", false, "proactive"],
  ["check_compliance", "Conformité des contrôles", "pct", "up", "NIMOVA Terrain", false, "proactive"],
  ["breath_test_completion", "Alcootests réalisés", "pct", "up", "NIMOVA Terrain", false, "proactive"],
  ["breath_test_positives", "Alcootests positifs", "count", "down", "NIMOVA Terrain", false, "reactive"],
  ["waivers", "Dérogations au verrou", "count", "down", "Verrou de départ", false, "reactive"],
  ["actions_on_time", "Actions dans les délais", "pct", "up", "Actions", false, "proactive"],
  ["actions_effectiveness", "Efficacité des actions", "pct", "up", "Actions", false, "proactive"],
  ["qualifications_valid", "Habilitations à jour", "pct", "up", "Habilitations RH", false, "proactive"],
  ["fuel_consumption", "Consommation", "l_100km", "down", "Transport", false, "reactive"],
  ["co2_emissions", "Émissions de CO₂", "kg_co2_km", "down", "Transport", false, "reactive"],
  ["tanker_shortage", "Écarts de livraison des citernes", "per_mille", "down", "Transport", false, "reactive"],
  ["tipper_variance", "Écarts de tonnage des bennes", "per_mille", "down", "Transport", false, "reactive"],
  ["audits_completion", "Audits réalisés contre planifiés", "pct", "up", "Audits", false, "proactive"],
  ["immobilizations", "Immobilisations de véhicules (V09)", "count", "down", "Événements, verrou de départ", false, "reactive"],
];
const COCKPIT_CODES = new Set(INDICATORS.map((i) => i[0]));
const TYPES_EVENEMENT = [
  ["work_accident", "Accident du travail"], ["road_accident", "Accident de la route"], ["near_miss", "Presque-accident"],
  ["hazard", "Situation dangereuse"], ["spill", "Déversement"], ["fire", "Incendie"], ["security_breach", "Atteinte à la sûreté"],
  ["product_quality", "Incident de qualité du produit"], ["property_damage", "Dégât matériel"],
];

/** Catalogue des valeurs que NIMOVA calcule pour un mois (REPORT_KEYS de report.py), dans son ordre. */
const CLES = (() => {
  const cles = {};
  for (const [code, label, unit, direction, source, glissant, famille] of INDICATORS) {
    const aggregation = glissant || code === "qualifications_valid" ? "last" : unit === "count" ? "sum" : "average";
    cles[code] = { label: label + (glissant ? " (12 mois glissants)" : ""), unit: UNIT_LABELS[unit], aggregation, direction, source, family: famille, kind: "cockpit" };
  }
  const autres = {
    road_accidents: { label: "Accidents de la route" },
    work_accidents: { label: "Accidents du travail avec arrêt", source: "Événements, RH" },
    lost_days: { label: "Jours perdus (accidents du travail)", unit: "jours", source: "RH" },
    weak_signals: { label: "Presque-accidents et situations dangereuses déclarés", direction: "up", family: "proactive" },
    departures: { label: "Départs", direction: "up", source: "Transport", family: "proactive" },
    checks: { label: "Contrôles avant départ réalisés", direction: "up", source: "NIMOVA Terrain", family: "proactive" },
    km: { label: "Kilomètres parcourus", unit: "km", direction: "up", source: "Transport" },
    fuel_liters: { label: "Carburant consommé", unit: "litres", source: "Transport" },
    audits_planned: { label: "Audits planifiés", direction: "up", source: "Audits", family: "proactive" },
    audits_done: { label: "Audits réalisés", direction: "up", source: "Audits", family: "proactive" },
    risk_reviews_overdue: { label: "Revues de risques échues (fin de mois)", kind: "state", source: "Registre des risques", aggregation: "last" },
    risks_high_residual: { label: "Risques de niveau résiduel élevé (fin de mois)", kind: "state", source: "Registre des risques", aggregation: "last" },
    findings_open: { label: "Constats d'audit ouverts (fin de mois)", kind: "state", source: "Audits", aggregation: "last" },
    requirements_non_compliant: { label: "Exigences non conformes (fin de mois)", kind: "state", source: "Registre des exigences", aggregation: "last" },
  };
  for (const [code, label] of TYPES_EVENEMENT) autres[`events_${code}`] = { label: `Événements déclarés : ${label.toLowerCase()}` };
  for (const [cle, spec] of Object.entries(autres)) {
    cles[cle] = { unit: "nbre", aggregation: "sum", direction: "down", source: "Événements", family: "reactive", kind: "component", ...spec };
  }
  return cles;
})();

/**
 * Clients de la maquette (PARTNERS de serveur.mjs, qui n'est pas dans HS_REFS), pour nommer la fiche
 * client d'un donneur d'ordre ; un autre identifiant de tiers est gardé sous un nom générique.
 */
const TIERS = {
  101: "Société Minière de Boffa (démo)",
  102: "Bauxite Atlantique Kamsar (démo)",
  103: "Mines d'Or du Haut Niger (démo)",
  104: "Distribution Pétrolière de Kankan (démo)",
  105: "Aéro Services Gbessia (démo)",
  106: "Énergie Fria Services (démo)",
  107: "Ciments du Rio Pongo (démo)",
  108: "Stations Fouta Carburants (démo)",
  109: "Société des Eaux de Mamou (démo)",
  110: "Agro Kindia Fruits (démo)",
  111: "Agence Routière Préfectorale de Boké (démo)",
  118: "Logistique Express Matoto (démo)",
  123: "Société de Négoce Atlantique (démo)",
};

/* ─── Outils ─────────────────────────────────────────────────────────────── */

const JOUR = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const temps = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const jourIso = (t) => new Date(t).toISOString().slice(0, 10);
const ajouterJours = (d, n) => jourIso(temps(d) + n * JOUR);
const ecartJours = (a, b) => Math.round((temps(b) - temps(a)) / JOUR);
const dernierJour = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const frDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const arrondi = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const somme = (liste, f = (x) => x) => liste.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const moisLabel = (m) => `${MOIS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
/** Date décalée de `n` mois, jour ramené à la fin du mois si besoin. */
function ajouterMois(d, n) {
  let a = +d.slice(0, 4);
  let m = +d.slice(5, 7) - 1 + n;
  a += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return `${a}-${pad(m + 1)}-${pad(Math.min(+d.slice(8, 10), dernierJour(a, m + 1)))}`;
}
/** Le 5 du mois suivant : les valeurs calculées du mois s'y figent (FREEZE_DAY). */
const dateGel = (m) => `${ajouterMois(`${m}-01`, 1).slice(0, 7)}-05`;

/** Hasard reproductible d'une graine (mêmes données à chaque lancement). */
function hasard(graine) {
  let h = 2166136261;
  for (const c of graine) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0 || 1;
  const suivant = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { suivant, entier: (min, max) => min + Math.floor(suivant() * (max - min + 1)), chance: (p) => suivant() < p };
}

/** Identifiant suivant d'une table. */
const suivantId = (table) => Math.max(0, ...table.map((x) => x.id)) + 1;

/** Contexte de calcul hors requête (semis) : hsIndicators n'en lit rien. */
const CTX_SYSTEME = { user: { id: 0, profiles: ["admin"], companies: [1, 2] }, query: {} };

/* ════════════════════════════════════════════════════════════════════════════
 * Habilitations
 * ══════════════════════════════════════════════════════════════════════════ */

/** Statut RH d'une échéance au jour donné : expirée le lendemain de sa date, à renouveler dans les 30 jours. */
function etatRh(expiry, day) {
  if (!expiry) return "valide";
  if (expiry < day) return "expiree";
  return ecartJours(day, expiry) <= ALERT_DAYS ? "a_renouveler" : "valide";
}
/** Aptitude en statut seul (_fitness_state) : apte, apte_reserve, inapte, echue, inconnu. */
function etatAptitude(e, day) {
  if (!e.medical_fitness) return "inconnu";
  if (e.medical_fitness === "inapte") return "inapte";
  if (e.medical_fitness_until && e.medical_fitness_until < day) return "echue";
  return e.medical_fitness;
}
const enPoste = (e, day) => e.hire_date <= day && (!e.exit_date || e.exit_date >= day);
const typesActifs = (H) => H.DB.hsseq.qualificationTypes.filter((t) => t.active).sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name, "fr"));

/** Site de chaque chauffeur : celui de l'ensemble dont il est le chauffeur habituel (driver_sites du noyau). */
function sitesDesChauffeurs(H) {
  const sites = new Map();
  for (const v of [...H.DB.vehicles, ...H.DB.hsseq.tippers]) if (v.driver_id && !sites.has(v.driver_id)) sites.set(v.driver_id, H.hsVehicleSite(v));
  return sites;
}

/** Habilitation retenue par type (la plus récente : échéance la plus lointaine), comme _qualification_rows de RH. */
function meilleures(H, employeeId) {
  const retenues = new Map();
  const liste = H.DB.hsseq.qualifications.filter((q) => q.employee_id === employeeId);
  liste.sort((a, b) => (a.expiry_date ?? "9999-12-31").localeCompare(b.expiry_date ?? "9999-12-31") || a.id - b.id);
  for (const q of liste) retenues.set(q.type_id, q);
  return retenues;
}

/**
 * Ligne de la matrice d'un salarié (_hsseq_matrix_row) : case de chaque type montré, statut d'ensemble
 * sur les types obligatoires (tous, montrés ou non), aptitude en statut seul et blocage du motif V04.
 */
function ligneMatrice(H, e, montres, day) {
  const retenues = meilleures(H, e.id);
  const cases = typesActifs(H).map((t) => {
    const q = retenues.get(t.id);
    const expiry = q?.expiry_date ?? null;
    return {
      code: t.code, name: t.name, mandatory: t.mandatory_for_drivers,
      status: q ? QUALIFICATION_STATUSES[etatRh(expiry, day)] : "missing",
      obtained_on: q?.obtained_date ?? null, expires_on: expiry, days_left: expiry ? ecartJours(day, expiry) : null,
    };
  });
  const obligatoires = cases.filter((c) => c.mandatory);
  const ensemble = obligatoires.reduce((pire, c) => (STATUS_RANK[c.status] > STATUS_RANK[pire] ? c.status : pire), "valid");
  const aptitude = etatAptitude(e, day);
  const requises = H.hsSettings(e.company_id).qualifications_required_from;
  const blocking = Boolean(e.driver_id) && (["inapte", "echue"].includes(aptitude)
    || obligatoires.some((c) => c.status === "expired")
    || (Boolean(requises) && day >= requises && obligatoires.some((c) => c.status === "missing")));
  const codes = new Set(montres.map((t) => t.code));
  return { employee: { id: e.id, name: e.name }, status: ensemble, fitness: FITNESS_STATUSES[aptitude] ?? "review", blocking, qualifications: cases.filter((c) => codes.has(c.code)) };
}

/** Sites du compte borné (chef de parc, auditeur) ; vide : aucun (portée fermée par défaut). */
function sitesDuCompte(H, ctx) {
  if (H.hsIs(ctx, "auditeur") && !H.hsIs(ctx, "exploitation")) return ctx.user.hsseq_audit_site_ids ?? [];
  return H.HS_USER_SITES[ctx.user.id] ?? [];
}

/**
 * Lignes de la matrice (matrix_rows) : conducteurs en poste des sociétés, par nom. Hors lecture complète,
 * les conducteurs des sites du compte seulement ; un conducteur sans site n'est lu que par les profils
 * de lecture complète.
 */
function lignesMatrice(H, ctx, societes, day, siteId, types) {
  const surSite = sitesDesChauffeurs(H);
  const portee = ctx && !H.hasProfile(ctx, QUAL_FULL) ? sitesDuCompte(H, ctx) : null;
  return H.DB.hsseq.rhEmployees
    .filter((e) => societes.includes(e.company_id) && e.driver_id && enPoste(e, day))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .flatMap((e) => {
      const site = surSite.get(e.driver_id) ?? null;
      if (siteId && site !== siteId) return [];
      if (portee && !(site && portee.includes(site))) return [];
      return [{ ...ligneMatrice(H, e, types, day), driver: H.hsDriverRef(e.driver_id), site: site ? H.hsSiteRef(site) : null, company: { id: e.company_id, name: H.COMPANIES[e.company_id].name } }];
    });
}

/**
 * Habilitations à jour pour l'indicateur qualifications_valid du cockpit (Cockpit._qualifications) :
 * conducteurs en poste et ceux sans motif V04, sur les sites donnés (tous sans filtre).
 */
export function situationHabilitations(H, { day = H.TODAY, companies = [1, 2], siteIds = null } = {}) {
  const lignes = lignesMatrice(H, null, companies, day, null, []).filter((l) => !siteIds?.length || (l.site && siteIds.includes(l.site.id)));
  return { drivers: lignes.length, valid: lignes.filter((l) => !l.blocking).length };
}

/**
 * Statut RH d'un chauffeur pour le motif V04 (_hsseq_driver_status de RH) : motifs (aptitude inapte ou
 * échue, habilitation obligatoire expirée ou absente) et avertissements ; nul sans salarié lié.
 */
export function statutConducteur(H, driverId, day = H.TODAY) {
  const e = H.DB.hsseq.rhEmployees.find((x) => x.driver_id === driverId && enPoste(x, day));
  if (!e) return null;
  const ligne = ligneMatrice(H, e, typesActifs(H), day);
  const aptitude = etatAptitude(e, day);
  const reasons = [];
  const warnings = [];
  if (aptitude === "inapte") reasons.push("Aptitude médicale : inapte.");
  else if (aptitude === "echue") reasons.push("Aptitude médicale échue.");
  else if (aptitude === "inconnu") warnings.push("Aptitude médicale non renseignée.");
  else if (aptitude === "apte_reserve") warnings.push("Aptitude médicale avec réserve.");
  for (const c of ligne.qualifications) {
    if (c.mandatory && (c.status === "expired" || c.status === "missing")) reasons.push(`${c.name} : ${c.status === "expired" ? "expirée" : "absente"}.`);
    if (c.status === "to_renew") warnings.push(`${c.name} à renouveler.`);
  }
  return { employee_id: e.id, blocking: ligne.blocking, reasons, warnings };
}

/** Salariés RH des chauffeurs, leurs habilitations et leur aptitude (données de la démonstration). */
function semerHabilitations(H) {
  const HS = H.DB.hsseq;
  HS.qualificationTypes = TYPES.map((t) => ({ ...t }));
  HS.rhEmployees = [];
  HS.qualifications = [];
  const chauffeurs = [...H.DB.drivers.filter((d) => d.company_id === 1 && d.active), ...HS.drivers];
  const surSite = sitesDesChauffeurs(H);
  let numero = Math.max(500, ...H.HS_EMPLOYEES.map((e) => e.id));
  for (const [i, d] of chauffeurs.entries()) {
    const r = hasard(`rh-${d.id}-${d.name}`);
    const lie = H.HS_EMPLOYEES.find((e) => e.driver_id === d.id);
    const id = lie ? lie.id : ++numero;
    const nouveau = d.name === NOUVEAU;
    const visite = APTITUDES[d.name] ?? (() => {
      const date = ajouterJours("2025-12-01", r.entier(0, 300));
      return ["apte", date, ajouterJours(ajouterMois(date, 12), -1)];
    })();
    HS.rhEmployees.push({
      id, name: d.name, company_id: d.company_id, driver_id: d.id, matricule: lie?.matricule ?? `EG-${pad(4 + Math.floor(i / 10))}${pad(i % 10)}${r.entier(1, 9)}`,
      hire_date: nouveau ? "2026-09-14" : `${r.entier(2012, 2024)}-${pad(r.entier(1, 12))}-${pad(r.entier(1, 28))}`, exit_date: null,
      medical_fitness: visite[0], medical_fitness_date: visite[1], medical_fitness_until: visite[2],
    });
    const site = surSite.get(d.id) ?? null;
    const propres = ECHEANCES[d.name] ?? {};
    const ajouter = (code, obtenue, expire, reference = null) => {
      const type = TYPES.find((t) => t.code === code);
      HS.qualifications.push({ id: HS.qualifications.length + 1, employee_id: id, company_id: d.company_id, type_id: type.id, obtained_date: obtenue, expiry_date: expire, reference });
    };
    const avecValidite = (code, debut, etendue, mois) => {
      if (propres[code]) return ajouter(code, ...propres[code]);
      const obtenue = ajouterJours(debut, r.entier(0, etendue));
      ajouter(code, obtenue, ajouterMois(obtenue, mois));
    };
    // Permis poids lourd : l'échéance de la fiche chauffeur de Transport (celle du motif V04 du lot 1).
    if (d.license_expiry) ajouter("permis_pl", `${/PL-(\d{4})/.exec(d.license_number ?? "")?.[1] ?? "2015"}-${pad(r.entier(1, 12))}-${pad(r.entier(1, 28))}`, d.license_expiry, d.license_number ?? null);
    if (!nouveau) avecValidite("conduite_defensive", "2023-12-01", 900, 36);
    if (site === 1) avecValidite("matieres_dangereuses", "2021-12-01", 1450, 60);
    if (site === 2) avecValidite("acces_site_minier", "2025-12-01", 270, 12);
    if (propres.secourisme || (!nouveau && r.chance(0.45))) avecValidite("secourisme", "2024-12-01", 540, 24);
  }
}

/** Seuil d'alerte d'une échéance (_stage) : J-30, J-7 ou aucun. */
function seuil(joursRestants, alerte, urgence) {
  if (joursRestants < 0 || joursRestants > alerte) return null;
  return joursRestants <= urgence ? "d7" : "d30";
}

/**
 * Alertes J-30 et J-7 déjà envoyées (eguitra.hsseq.expiry.alert) : la tâche quotidienne rejouée depuis
 * DEBUT_ALERTES, une alerte par échéance et par seuil, habilitations, aptitudes et documents des véhicules.
 */
function semerAlertes(H) {
  const HS = H.DB.hsseq;
  HS.expiryAlerts = [];
  const surSite = sitesDesChauffeurs(H);
  const hsseq = H.hsHsseqManagers();
  const envoyees = new Set();
  const envoyer = (jour, a) => {
    const cle = `${a.key}|${a.expiry_date}|${a.stage}`;
    if (envoyees.has(cle)) return;
    envoyees.add(cle);
    const site = a.site_id ? H.hsSite(a.site_id) : null;
    const destinataires = [...new Set([...hsseq, ...(site?.yard_manager_ids ?? [])])];
    HS.expiryAlerts.push({ id: HS.expiryAlerts.length + 1, company_id: 1, ...a, sent_at: `${jour}T06:00:00Z`, recipient_ids: destinataires });
  };
  const vehicules = [...H.DB.vehicles, ...HS.tippers];
  for (let jour = DEBUT_ALERTES; jour <= H.TODAY; jour = ajouterJours(jour, 1)) {
    for (const e of HS.rhEmployees.filter((x) => enPoste(x, jour))) {
      const site = e.driver_id ? (surSite.get(e.driver_id) ?? null) : null;
      for (const q of meilleures(H, e.id).values()) {
        if (!q.expiry_date) continue;
        const etape = seuil(ecartJours(jour, q.expiry_date), ALERT_DAYS, URGENT_DAYS);
        if (!etape) continue;
        const type = HS.qualificationTypes.find((t) => t.id === q.type_id);
        envoyer(jour, { kind: "qualification", key: `employee:${e.id}:${type.code}`, subject: e.name, label: type.name, expiry_date: q.expiry_date, stage: etape, reason_code: e.driver_id && type.mandatory_for_drivers ? "V04" : null, site_id: site });
      }
      if (["apte", "apte_reserve"].includes(e.medical_fitness) && e.medical_fitness_until) {
        const etape = seuil(ecartJours(jour, e.medical_fitness_until), ALERT_DAYS, URGENT_DAYS);
        if (etape) envoyer(jour, { kind: "fitness", key: `employee:${e.id}:APTITUDE`, subject: e.name, label: "Aptitude médicale", expiry_date: e.medical_fitness_until, stage: etape, reason_code: e.driver_id ? "V04" : null, site_id: site });
      }
    }
    for (const v of vehicules) {
      const requis = H.hsKind(v) === "tanker" ? ["insurance", "inspection", "calibration", "tightness"] : ["insurance", "inspection"];
      for (const doc of HS.docs.filter((x) => x.vehicle_id === v.id && requis.includes(x.kind))) {
        const etape = seuil(ecartJours(jour, doc.expiry_date), 30, 7);
        if (!etape) continue;
        const libelle = H.HS_DOC_LABELS[doc.kind] ?? doc.kind;
        envoyer(jour, { kind: "vehicle_document", key: `vehicle:${v.id}:${doc.kind}`, subject: v.name, label: libelle.charAt(0).toUpperCase() + libelle.slice(1), expiry_date: doc.expiry_date, stage: etape, reason_code: DOCUMENT_REASON[doc.kind] ?? null, site_id: H.hsVehicleSite(v) });
      }
    }
  }
}

/* ─── Paramètres de requête ─────────────────────────────────────────────── */

/** Sociétés de travail : toutes celles du compte, ou celle du filtre company_id (companies du noyau). */
function societes(H, ctx, src) {
  const v = src.company_id;
  if (v === undefined || v === null || v === "" || v === "all") return [...ctx.user.companies];
  if (!/^\d+$/.test(String(v))) throw H.hsBad("Société invalide.");
  if (!ctx.user.companies.includes(Number(v))) throw H.hsForbidden("Société non autorisée.");
  return [Number(v)];
}
/** Identifiant facultatif (int_or_none) : nul pour vide ou zéro, 400 s'il n'est pas entier. */
function entierOuNul(H, data, cle) {
  const v = data[cle];
  if (v === undefined || v === null || v === "" || v === 0 || v === "0" || v === false) return null;
  if (!/^\d+$/.test(String(v))) throw H.hsBad(`Identifiant invalide : ${cle}.`, [cle]);
  return Number(v);
}
function dateParametre(H, src, cle) {
  const v = src[cle];
  if (v === undefined || v === null || v === "") return null;
  const d = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || jourIso(temps(d)) !== d) throw H.hsBad(`Date invalide : ${cle}.`, [cle]);
  return d;
}
const introuvable = (H, message) => new H.ApiError(404, "not_found", message);

/* ════════════════════════════════════════════════════════════════════════════
 * Rapport mensuel
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * État d'un indicateur au regard de sa cible (indicator_status) : met, watch, missed, no_data. Sens « up » :
 * conforme à partir de cible × compliant_ratio, sous surveillance à partir de cible × watch_ratio ; sens
 * « down » : cible ÷ ratio ; un seuil d'alerte explicite remplace la marge.
 */
function statutIndicateur(value, target, direction, conforme = 1, surveillance = 0.85, seuilAlerte = null) {
  if (value === null || value === undefined || target === null || target === undefined) return "no_data";
  if (direction === "up") {
    if (seuilAlerte !== null) return value >= target ? "met" : value >= seuilAlerte ? "watch" : "missed";
    if (value >= target * conforme) return "met";
    return value >= target * surveillance ? "watch" : "missed";
  }
  if (seuilAlerte !== null) return value <= target ? "met" : value < seuilAlerte ? "watch" : "missed";
  if (value <= target / conforme) return "met";
  return target > 0 && value <= target / surveillance ? "watch" : "missed";
}

/** Composantes d'un mois (nombres, kilomètres, carburant, audits) pour une société. */
function composantes(H, societe, m, cockpit) {
  const HS = H.DB.hsseq;
  const valeurs = Object.fromEntries(Object.entries(CLES).filter(([, s]) => s.kind === "component").map(([cle]) => [cle, 0]));
  const audits = (HS.audits ?? []).filter((a) => (a.company_id ?? 1) === societe && a.status !== "cancelled" && String(a.planned_date ?? "").slice(0, 7) === m);
  valeurs.audits_planned = audits.length;
  valeurs.audits_done = audits.filter((a) => ["done", "closed"].includes(a.status)).length;
  if (societe !== 1) return valeurs;
  if (m < "2026-01") {
    const h = ["tanker", "tipper"].map((k) => HS.history.get(`${m}|${k}`) ?? { lt: 0, days: 0, work: 0, road: 0, nm: 0 });
    Object.assign(valeurs, { road_accidents: somme(h, (x) => x.road), work_accidents: somme(h, (x) => x.lt), lost_days: somme(h, (x) => x.days), weak_signals: somme(h, (x) => x.nm), events_work_accident: somme(h, (x) => x.work), events_road_accident: somme(h, (x) => x.road), events_near_miss: somme(h, (x) => x.nm) });
  } else {
    const ev = HS.events.filter((e) => String(e.occurred_at).slice(0, 7) === m);
    const parType = (t) => ev.filter((e) => e.type === t).length;
    for (const [code] of TYPES_EVENEMENT) valeurs[`events_${code}`] = parType(code);
    valeurs.road_accidents = parType("road_accident");
    valeurs.work_accidents = ev.filter((e) => e.type === "work_accident" && e.lost_time).length;
    valeurs.lost_days = somme(ev.filter((e) => e.type === "work_accident"), (e) => e.days_lost);
    valeurs.weak_signals = parType("near_miss") + parType("hazard");
  }
  const partis = ["en_route", "done", "invoiced"];
  const citernes = H.DB.rotations.filter((r) => r.company_id === 1 && partis.includes(r.state) && r.date_loading.slice(0, 7) === m).length;
  const bennes = HS.rotations.filter((r) => partis.includes(r.state) && r.date_loading.slice(0, 7) === m).length || (m < "2026-09" ? Math.round(HS.tippers.length * dernierJour(+m.slice(0, 4), +m.slice(5, 7)) * 0.9) : 0);
  valeurs.departures = citernes + bennes;
  const controles = HS.checks.filter((c) => c.kind === "pre_departure" && String(c.reported_at).slice(0, 7) === m).length;
  valeurs.checks = controles || Math.round((valeurs.departures * (cockpit.check_completion ?? 96)) / 100);
  valeurs.km = Math.round(H.hsKm(m, "tanker") + H.hsKm(m, "tipper"));
  valeurs.fuel_liters = Math.round(H.hsLiters(m, "tanker") + H.hsLiters(m, "tipper"));
  return valeurs;
}

/** Situations de fin de mois, connues pour le mois en cours ou le mois tout juste clos (_state_values). */
function situations(H, societe, m) {
  const HS = H.DB.hsseq;
  const courant = H.TODAY.slice(0, 7);
  const precedent = ajouterMois(`${courant}-01`, -1).slice(0, 7);
  if (m !== courant && m !== precedent) return { risk_reviews_overdue: null, risks_high_residual: null, findings_open: null, requirements_non_compliant: null };
  const fin = `${m}-${pad(dernierJour(+m.slice(0, 4), +m.slice(5, 7)))}` < H.TODAY ? `${m}-${pad(dernierJour(+m.slice(0, 4), +m.slice(5, 7)))}` : H.TODAY;
  const deLaSociete = (x) => (x.company_id ?? 1) === societe;
  const risques = (HS.risks ?? []).filter((x) => deLaSociete(x) && x.status === "active");
  const residuel = (x) => x.residual?.level ?? x.residual_level ?? H.hsLevel((x.residual?.severity ?? x.residual_severity ?? 0) * (x.residual?.probability ?? x.residual_probability ?? 0));
  return {
    risk_reviews_overdue: risques.filter((x) => x.review_date && x.review_date < fin).length,
    risks_high_residual: risques.filter((x) => residuel(x) === "high").length,
    findings_open: (HS.findings ?? []).filter((x) => deLaSociete(x) && x.status === "open").length,
    requirements_non_compliant: (HS.requirements ?? []).filter((x) => deLaSociete(x) && x.status === "non_compliant").length,
  };
}

/**
 * Valeurs du catalogue pour des mois d'une société (_computed_values) : indicateurs du cockpit de la
 * maquette (série de douze mois), situation des habilitations du jour pour le mois en cours, nombres du
 * mois, situations de fin de mois.
 */
function valeursCalculees(H, societe, mois) {
  const res = new Map(mois.map((m) => [m, {}]));
  for (const i of H.hsIndicators(CTX_SYSTEME, { company_id: societe }, mois[mois.length - 1], "month")) {
    for (const p of i.series) if (res.has(p.month)) res.get(p.month)[i.code] = p.value;
  }
  const courant = H.TODAY.slice(0, 7);
  if (res.has(courant)) {
    const s = situationHabilitations(H, { companies: [societe] });
    res.get(courant).qualifications_valid = s.drivers ? arrondi((s.valid * 100) / s.drivers, 1) : null;
  }
  for (const m of mois) Object.assign(res.get(m), composantes(H, societe, m, res.get(m)), situations(H, societe, m));
  return res;
}

const indicateursDu = (H, modeleId) => H.DB.hsseq.reportIndicators.filter((i) => i.template_id === modeleId);
/** Indicateurs en service d'un modèle, proactifs d'abord, dans leur ordre (_indicators). */
const indicateursActifs = (H, modeleId) =>
  indicateursDu(H, modeleId).filter((i) => i.active).sort((a, b) => Number(a.nature !== "proactive") - Number(b.nature !== "proactive") || a.sequence - b.sequence || a.id - b.id);
const moisDuRapport = (H, modeleId, societe, m) => H.DB.hsseq.reports.find((r) => r.template_id === modeleId && r.company_id === societe && r.month === `${m}-01`) ?? null;
const valeurDe = (H, rapport, indicateurId) => H.DB.hsseq.reportValues.find((v) => v.report_id === rapport.id && v.indicator_id === indicateurId) ?? null;

/** Cible d'un mois : celle du modèle, sinon, pour un indicateur du cockpit, la cible des paramètres (_target). */
function cibleDuMois(H, ind, m, societe) {
  const t = (ind.targets ?? [])[+m.slice(5, 7) - 1];
  if ((t === null || t === undefined) && ind.mode === "computed" && COCKPIT_CODES.has(ind.key)) {
    const reglees = H.hsSettings(societe).targets ?? {};
    return ind.key in reglees ? reglees[ind.key] : (DEFAULT_TARGETS[ind.key] ?? null);
  }
  return t ?? null;
}

/** Cumul de l'année et cible cumulée (_cumulate) : somme, moyenne ou dernier mois renseigné. */
function cumuler(ind, serie) {
  const valeurs = serie.filter((p) => p.value !== null).map((p) => p.value);
  const cibles = serie.filter((p) => p.target !== null).map((p) => p.target);
  if (ind.aggregation === "sum") return [valeurs.length ? arrondi(somme(valeurs)) : null, cibles.length ? arrondi(somme(cibles)) : null];
  if (ind.aggregation === "average") return [valeurs.length ? arrondi(somme(valeurs) / valeurs.length) : null, cibles.length ? arrondi(somme(cibles) / cibles.length) : null];
  const dernier = [...serie].reverse().find((p) => p.value !== null);
  return dernier ? [dernier.value, dernier.target] : [null, serie.length ? serie[serie.length - 1].target : null];
}

/** Rapport d'un mois (_report) : plan contre réalisé de janvier au mois, cumul, état, synthèse du comité. */
function rapportDuMois(H, modele, societe, m) {
  const annee = +m.slice(0, 4);
  const mois = Array.from({ length: +m.slice(5, 7) }, (_, k) => `${annee}-${pad(k + 1)}`);
  const fiches = new Map(mois.map((x) => [x, moisDuRapport(H, modele.id, societe, x)]));
  let vivantes = null;
  const seuilDe = (i) => (i.has_threshold ? i.alert_threshold : null);
  const lignes = indicateursActifs(H, modele.id).map((ind) => {
    const serie = mois.map((x) => {
      const fiche = fiches.get(x);
      const enregistree = fiche ? valeurDe(H, fiche, ind.id) : null;
      let value = null;
      let source = "none";
      if (ind.mode === "manual") {
        if (enregistree?.manual_known) [value, source] = [enregistree.manual_value, "manual"];
      } else if (fiche?.frozen_on) {
        if (enregistree?.computed_known) [value, source] = [enregistree.computed_value, "computed"];
      } else {
        if (!vivantes) vivantes = valeursCalculees(H, societe, mois);
        const v = vivantes.get(x)?.[ind.key];
        if (v !== null && v !== undefined) [value, source] = [v, "computed"];
      }
      const target = cibleDuMois(H, ind, x, societe);
      return { month: x, target, value, source, comment: enregistree?.comment || null, status: statutIndicateur(value, target, ind.direction, modele.compliant_ratio, modele.watch_ratio, seuilDe(ind)) };
    });
    const [ytd, ytdTarget] = cumuler(ind, serie);
    const annuelles = Array.from({ length: 12 }, (_, k) => cibleDuMois(H, ind, `${annee}-${pad(k + 1)}`, societe)).filter((t) => t !== null);
    const annualTarget = !annuelles.length ? null : ind.aggregation === "sum" ? arrondi(somme(annuelles)) : arrondi(somme(annuelles) / annuelles.length);
    const dernier = serie[serie.length - 1];
    return {
      id: ind.id, code: ind.code, label: ind.label, nature: ind.nature, family: ind.nature, mode: ind.mode, key: ind.key ?? null, unit: ind.unit ?? null,
      direction: ind.direction, aggregation: ind.aggregation, annual_target: annualTarget, value: dernier.value, target: dernier.target,
      ytd, ytd_target: ytdTarget, status: statutIndicateur(ytd, ytdTarget, ind.direction, modele.compliant_ratio, modele.watch_ratio, seuilDe(ind)), comment: dernier.comment, series: serie,
    };
  });
  return { months: mois, indicators: lignes, summary: synthese(lignes) };
}

/** Synthèse du comité (_summary) : santé globale, points d'attention, tendance mensuelle. */
function synthese(lignes) {
  const parStatut = { met: 0, watch: 0, missed: 0, no_data: 0 };
  for (const l of lignes) parStatut[l.status] += 1;
  const mesures = lignes.length - parStatut.no_data;
  const attention = lignes.filter((l) => l.status === "missed" || l.status === "watch").sort((a, b) => Number(a.status !== "missed") - Number(b.status !== "missed") || a.code.localeCompare(b.code));
  return {
    by_status: parStatut,
    health: mesures ? arrondi((parStatut.met * 100) / mesures, 1) : null,
    attention_points: attention.map((l) => ({ id: l.id, code: l.code, label: l.label, nature: l.nature, ytd: l.ytd, ytd_target: l.ytd_target, unit: l.unit, status: l.status, comment: l.comment })),
    trend: lignes.filter((l) => l.nature === "reactive" || attention.includes(l)).map((l) => ({ id: l.id, code: l.code, label: l.label, series: l.series.map((p) => ({ month: p.month, value: p.value, target: p.target })) })),
  };
}

const partenaire = (id) => (id ? { id, name: TIERS[id] ?? `Tiers n° ${id}` } : null);
const societeRef = (H, id) => (id ? { id, name: H.COMPANIES[id].name } : null);

/** Réponse d'un mois du rapport (month_payload) : état, transitions et droits du compte. */
function charge(H, ctx, modele, societe, m) {
  const fiche = moisDuRapport(H, modele.id, societe, m);
  const etat = fiche?.state ?? "draft";
  const hsseq = H.hsIs(ctx, "hsseq");
  const gel = dateGel(m);
  const fige = Boolean(fiche?.frozen_on);
  const transitions = [...(hsseq && etat === "draft" && (fige || H.TODAY >= gel) ? ["validate"] : []), ...(hsseq && etat === "validated" ? ["reopen"] : [])];
  return {
    template: { id: modele.id, name: modele.name, client_label: modele.client_label ?? null, partner: partenaire(modele.partner_id) },
    company: societeRef(H, societe), month: m, label: moisLabel(m),
    period_label: +m.slice(5, 7) > 1 ? `Janvier à ${MOIS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : `Janvier ${m.slice(0, 4)}`,
    state: etat, frozen: fige, frozen_on: fiche?.frozen_on ?? null, freeze_date: gel, validated_at: fiche?.validated_at ?? null,
    validated_by: fiche?.validated_by ? H.hsUser(fiche.validated_by) : null, comment: fiche?.comment ?? null,
    ...rapportDuMois(H, modele, societe, m),
    history: fiche ? H.hsHistory("report", fiche.id) : [],
    transitions,
    rights: { can_edit: hsseq && etat === "draft", can_close: false, can_approve: transitions.includes("validate") },
  };
}

/** Modèle lisible par le compte (get_template) ; 404 sinon. */
function modeleDe(H, ctx, brut, cle = "template_id") {
  const id = typeof brut === "number" ? brut : entierOuNul(H, { [cle]: brut }, cle);
  const t = H.DB.hsseq.reportTemplates.find((x) => x.id === id);
  if (!t || (t.company_id && !ctx.user.companies.includes(t.company_id))) throw introuvable(H, "Modèle introuvable.");
  return t;
}
/** Société du rapport (report_company) : celle du modèle, sinon celle demandée, sinon la société de travail. */
function societeDu(H, ctx, modele, src) {
  if (modele.company_id) {
    if (!ctx.user.companies.includes(modele.company_id)) throw introuvable(H, "Modèle introuvable.");
    return modele.company_id;
  }
  return src.company_id ? societes(H, ctx, src)[0] : ctx.company;
}
/** Modèle, société et mois d'une route de rapport (_month) ; un mois à venir n'a pas de rapport. */
function moisDemande(H, ctx, id, m, src) {
  const modele = modeleDe(H, ctx, id);
  if (+m.slice(5, 7) < 1 || +m.slice(5, 7) > 12) throw H.hsBad("Mois attendu au format AAAA-MM.", ["month"]);
  if (`${m}-01` > H.TODAY) throw H.hsRule("invalid_parameter", "Mois à venir : pas encore de rapport.", { fields: ["month"] });
  return { modele, societe: societeDu(H, ctx, modele, src), m };
}

/** Mois du rapport d'une société, créé au besoin (_get) et journalisé. */
function ficheDuMois(H, modele, societe, m, par, quand = H.hsNow()) {
  const existante = moisDuRapport(H, modele.id, societe, m);
  if (existante) return existante;
  const HS = H.DB.hsseq;
  const fiche = { id: suivantId(HS.reports), template_id: modele.id, company_id: societe, month: `${m}-01`, state: "draft", frozen_on: null, validated_at: null, validated_by: null, reopen_reason: null, comment: null };
  HS.reports.push(fiche);
  H.hsLog("report", fiche.id, par, "create", null, null, null, quand);
  return fiche;
}
/** Valeur d'un indicateur pour un mois, créée au besoin. */
function ligneValeur(H, fiche, indicateurId) {
  const existante = valeurDe(H, fiche, indicateurId);
  if (existante) return existante;
  const HS = H.DB.hsseq;
  const v = { id: suivantId(HS.reportValues), report_id: fiche.id, indicator_id: indicateurId, computed_value: 0, computed_known: false, manual_value: 0, manual_known: false, comment: null };
  HS.reportValues.push(v);
  return v;
}
/** Valeurs calculées du mois enregistrées (_freeze) : le 5 du mois suivant, ou à la validation si plus tard. */
function figer(H, fiche, valeurs, le, par = null) {
  if (fiche.frozen_on) return;
  for (const ind of indicateursActifs(H, fiche.template_id).filter((i) => i.mode === "computed")) {
    const v = valeurs[ind.key];
    Object.assign(ligneValeur(H, fiche, ind.id), { computed_value: v ?? 0, computed_known: v !== null && v !== undefined });
  }
  fiche.frozen_on = le;
  H.hsLog("report", fiche.id, par, "freeze", null, null, null, `${le}T06:00:00Z`);
}

/** Écriture d'une saisie au journal, comme le noyau : (valeur, commentaire) avant et après. */
const tuple = (v) => `(${v.manual_known ? v.manual_value : "None"}, ${v.comment ? `'${v.comment}'` : "None"})`;

/* ─── Modèles : lecture et écriture ─────────────────────────────────────── */

function ligneIndicateur(i) {
  return {
    id: i.id, code: i.code, label: i.label, nature: i.nature, mode: i.mode, key: i.key ?? null, unit: i.unit ?? null, direction: i.direction,
    aggregation: i.aggregation, targets: [...(i.targets ?? []), ...Array(12).fill(null)].slice(0, 12), alert_threshold: i.has_threshold ? i.alert_threshold : null,
    sequence: i.sequence, active: i.active,
  };
}
/** Ligne d'un modèle (template_row) ; `detail` : ses indicateurs, retirés compris, et son journal. */
function ligneModele(H, ctx, t, detail = false) {
  const row = {
    id: t.id, name: t.name, code: t.code ?? null, company: societeRef(H, t.company_id), partner: partenaire(t.partner_id), client_label: t.client_label ?? null,
    compliant_ratio: t.compliant_ratio, watch_ratio: t.watch_ratio, active: t.active, indicators_count: indicateursActifs(H, t.id).length,
    rights: { can_edit: H.hasProfile(ctx, CONFIG), can_close: false, can_approve: false },
  };
  if (detail) {
    row.indicators = [...indicateursDu(H, t.id)]
      .sort((a, b) => Number(!a.active) - Number(!b.active) || Number(a.nature !== "proactive") - Number(b.nature !== "proactive") || a.sequence - b.sequence || a.id - b.id)
      .map(ligneIndicateur);
    row.history = H.hsHistory("report_template", t.id);
  }
  return row;
}

/** Valeurs d'un modèle lues dans le corps (template_values). */
function valeursModele(H, ctx, data) {
  const v = {};
  if ("name" in data) {
    v.name = H.hsText(data, "name", 200);
    if (!v.name) throw H.hsMissing("Nom du modèle manquant.", ["name"]);
  }
  if ("client_label" in data) v.client_label = H.hsText(data, "client_label", 200);
  if ("partner_id" in data) v.partner_id = entierOuNul(H, data, "partner_id");
  if ("company_id" in data) v.company_id = data.company_id ? societes(H, ctx, data)[0] : null;
  for (const cle of ["compliant_ratio", "watch_ratio"]) {
    if (!(cle in data)) continue;
    const n = data[cle] === null || data[cle] === "" ? Number.NaN : Number(data[cle]);
    if (!Number.isFinite(n)) throw H.hsBad(`Valeur invalide : ${cle}.`, [cle]);
    v[cle] = n;
  }
  if ("active" in data) v.active = Boolean(data.active);
  return v;
}

/** Valeurs d'un indicateur lues dans le corps (indicator_values). */
function valeursIndicateur(H, data) {
  const v = {};
  for (const [cle, max] of [["code", 32], ["label", 300], ["unit", 32]]) if (cle in data) v[cle] = H.hsText(data, cle, max);
  if (!v.code || !v.label) throw H.hsMissing("Chaque indicateur a un numéro et un libellé.", ["indicators"]);
  for (const [cle, choix] of [["nature", NATURES], ["mode", MODES], ["aggregation", AGGREGATIONS], ["direction", ["up", "down"]]]) {
    if (!(cle in data)) continue;
    if (!choix.includes(data[cle])) throw H.hsBad(`Valeur inconnue : ${cle}.`, ["indicators"]);
    v[cle] = data[cle];
  }
  if ("key" in data) {
    if (data.key && !(data.key in CLES)) throw H.hsBad("Valeur calculée inconnue du catalogue.", ["indicators"]);
    v.key = data.key || null;
    const spec = data.key ? CLES[data.key] : null;
    if (spec) for (const cle of ["unit", "aggregation", "direction"]) if (!(cle in v)) v[cle] = spec[cle];
  }
  if ("targets" in data) {
    const cibles = data.targets ?? [];
    if (!Array.isArray(cibles) || cibles.length > 12) throw H.hsBad("Cibles : douze valeurs au plus, de janvier à décembre.", ["indicators"]);
    v.targets = cibles.map((x) => {
      if (x === null || x === undefined || x === "") return null;
      const n = Number(x);
      if (!Number.isFinite(n)) throw H.hsBad("Cible invalide.", ["indicators"]);
      return n;
    });
    while (v.targets.length < 12) v.targets.push(null);
  }
  if ("alert_threshold" in data) {
    const x = data.alert_threshold;
    if (x === null || x === undefined || x === "") Object.assign(v, { alert_threshold: 0, has_threshold: false });
    else {
      const n = Number(x);
      if (!Number.isFinite(n)) throw H.hsBad("Seuil d'alerte invalide.", ["indicators"]);
      Object.assign(v, { alert_threshold: n, has_threshold: true });
    }
  }
  if ("sequence" in data) v.sequence = entierOuNul(H, data, "sequence") ?? 10;
  if ("active" in data) v.active = Boolean(data.active);
  return v;
}

const INDICATEUR_DEFAUT = { nature: "proactive", mode: "manual", key: null, unit: "nbre", direction: "up", aggregation: "sum", targets: Array(12).fill(null), alert_threshold: 0, has_threshold: false, sequence: 10, active: true };

/**
 * Indicateurs d'un modèle (save_indicators) : cités par id mis à jour, nouveaux créés, absents retirés
 * (archivés s'ils ont des valeurs, supprimés sinon). Tout est vérifié avant d'écrire, comme une
 * transaction du noyau : indicateur calculé avec sa valeur, numéro unique dans le modèle.
 */
function enregistrerIndicateurs(H, modele, lignes) {
  const HS = H.DB.hsseq;
  if (lignes !== null && lignes !== undefined && !Array.isArray(lignes)) throw H.hsBad("Indicateur invalide.", ["indicators"]);
  const existants = new Map(indicateursDu(H, modele.id).map((i) => [i.id, i]));
  const prevus = (lignes ?? []).map((ligne) => {
    if (!ligne || typeof ligne !== "object" || Array.isArray(ligne)) throw H.hsBad("Indicateur invalide.", ["indicators"]);
    const valeurs = valeursIndicateur(H, ligne);
    const id = entierOuNul(H, ligne, "id");
    if (id && !existants.has(id)) throw H.hsRule("business_rule", "Indicateur d'un autre modèle.", { fields: ["indicators"] });
    return { avant: id ? existants.get(id) : null, valeurs };
  });
  const finaux = prevus.map((p) => ({ ...(p.avant ?? INDICATEUR_DEFAUT), ...p.valeurs }));
  for (const f of finaux) if (f.mode === "computed" && !f.key) throw H.hsBad(`${f.code} : un indicateur calculé désigne sa valeur.`, ["key"]);
  const cites = new Set(prevus.filter((p) => p.avant).map((p) => p.avant.id));
  const absents = [...existants.values()].filter((i) => !cites.has(i.id));
  const aDesValeurs = (i) => HS.reportValues.some((v) => v.indicator_id === i.id);
  const codes = [...finaux.map((f) => f.code), ...absents.filter(aDesValeurs).map((i) => i.code)];
  if (new Set(codes).size !== codes.length) throw new H.ApiError(409, "conflict", "Ce numéro d'indicateur existe déjà dans le modèle.", { fields: ["indicators"] });
  for (const [k, p] of prevus.entries()) {
    if (p.avant) Object.assign(p.avant, p.valeurs);
    else HS.reportIndicators.push({ ...finaux[k], id: suivantId(HS.reportIndicators), template_id: modele.id });
  }
  for (const i of absents) {
    if (aDesValeurs(i)) i.active = false;
    else HS.reportIndicators.splice(HS.reportIndicators.indexOf(i), 1);
  }
}

/** Seuils du statut d'un modèle (_check_ratios) : 0 < sous surveillance ≤ conforme ≤ 1,5. */
function verifierSeuils(H, modele) {
  if (!(modele.watch_ratio > 0 && modele.watch_ratio <= modele.compliant_ratio && modele.compliant_ratio <= 1.5)) {
    throw H.hsBad("Seuils du statut : 0 < sous surveillance ≤ conforme.", ["compliant_ratio", "watch_ratio"]);
  }
}

/** Écrit les valeurs d'un modèle et journalise les champs suivis (_journal_fields). */
function ecrireModele(H, modele, valeurs, par) {
  for (const champ of ["name", "client_label", "partner_id", "compliant_ratio", "watch_ratio", "active"]) {
    if (!(champ in valeurs) || valeurs[champ] === modele[champ]) continue;
    const lisible = (x) => (champ === "partner_id" ? (x ? TIERS[x] ?? String(x) : null) : x === null || x === undefined ? null : String(x));
    H.hsLog("report_template", modele.id, par, "write", champ, lisible(modele[champ]), lisible(valeurs[champ]));
  }
  Object.assign(modele, valeurs);
}

/* ─── Sorties ───────────────────────────────────────────────────────────── */

const ETATS_FR = { met: "Conforme", watch: "Sous surveillance", missed: "Non conforme", no_data: "Pas de donnée" };
const nombreFr = (v) => (v === null || v === undefined ? "" : String(arrondi(v, 2)).replace(".", ","));
const nomFichier = (modele, m) => `rapport_hsse_${modele.code || modele.id}_${m.replace("-", "_")}`.replace(/\//g, "-").replace(/ /g, "_");

/** Classeur au format d'un donneur d'ordre (workbook) : synthèse du comité, puis plan contre réalisé. */
function classeur(p) {
  const client = p.template.client_label || p.template.name;
  const s = p.summary;
  const synthese = [
    [`Comité mensuel HSSE : ${p.company.name}, rapport pour ${client}`],
    [`Période analysée : ${p.period_label}. État : ${p.state === "validated" ? "validé" : "brouillon"}.`],
    [],
    ["1. Santé globale des indicateurs"],
    ...["met", "watch", "missed", "no_data"].map((c) => [ETATS_FR[c], s.by_status[c]]),
    ["Part conforme (indicateurs renseignés)", s.health === null ? "-" : `${nombreFr(s.health)} %`],
    [],
    ["2. Points d'attention prioritaires"],
    ["N°", "Indicateur", "Cumul", "Cible cumulée", "État", "Commentaire"],
    ...(s.attention_points.length ? s.attention_points.map((a) => [a.code, a.label, a.ytd, a.ytd_target, ETATS_FR[a.status], a.comment ?? ""]) : [["Aucun indicateur non conforme ni sous surveillance."]]),
    [],
    ["3. Tendance mensuelle"],
    ["N°", "Indicateur", ...p.months.map((m) => MOIS[+m.slice(5, 7) - 1])],
    ...s.trend.map((t) => [t.code, t.label, ...t.series.map((x) => x.value)]),
  ];
  const entete = ["N°", "Indicateur", "Unité", "Plan annuel"];
  for (const nom of MOIS) entete.push(`${nom} plan`, `${nom} réalisé`);
  entete.push("Cumul", "Cible cumulée", "État", "Commentaire du mois");
  const indicateurs = [entete];
  for (const nature of NATURES) {
    const lignes = p.indicators.filter((i) => i.nature === nature);
    if (!lignes.length) continue;
    indicateurs.push([`Indicateurs ${nature === "proactive" ? "proactifs" : "réactifs"}`]);
    for (const i of lignes) {
      const cases = [];
      for (let k = 0; k < 12; k += 1) cases.push(i.series[k]?.target ?? null, i.series[k]?.value ?? null);
      indicateurs.push([i.code, i.label, i.unit ?? "", i.annual_target, ...cases, i.ytd, i.ytd_target, ETATS_FR[i.status], i.comment ?? ""]);
    }
  }
  if (p.comment) indicateurs.push([], [`Commentaire du mois : ${p.comment}`]);
  return [{ name: "Synthèse comité", rows: synthese }, { name: "Indicateurs", rows: indicateurs }];
}

/** PDF d'une page (Helvetica), comme pdfBuffer de serveur.mjs : le rapport du mois en lignes. */
function pdf(titre, lignes) {
  const latin = (s) => String(s).replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/œ/g, "oe").replace(/[–—]/g, "-").replace(/[  ]/g, " ").replace(/[₂]/g, "2").replace(/[^\x00-\xff]/g, "?");
  const echapper = (s) => latin(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let contenu = `BT\n/F2 14 Tf\n40 800 Td\n(${echapper(titre)}) Tj\n/F1 9 Tf\n0 -14 Td\n12 TL\n`;
  for (const l of lignes.slice(0, 62)) contenu += `(${echapper(l)}) '\n`;
  contenu += "ET\n";
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(contenu, "latin1")} >>\nstream\n${contenu}endstream`,
  ];
  let sortie = "%PDF-1.4\n%âãÏÓ\n";
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(Buffer.byteLength(sortie, "latin1"));
    sortie += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(sortie, "latin1");
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(sortie, "latin1");
}

function lignesPdf(p) {
  const client = p.template.client_label || p.template.name;
  const s = p.summary;
  const lignes = [
    `${p.company.name}, rapport pour ${client}. Période analysée : ${p.period_label}.`,
    `État : ${p.state === "validated" ? "validé" : "brouillon"}. Maquette : document de démonstration.`,
    "",
    `Santé globale : ${s.by_status.met} conformes, ${s.by_status.watch} sous surveillance, ${s.by_status.missed} non conformes, ${s.by_status.no_data} sans donnée.`,
    `Part conforme des indicateurs renseignés : ${s.health === null ? "-" : `${nombreFr(s.health)} %`}.`,
    "",
    "Points d'attention :",
    ...(s.attention_points.length ? s.attention_points.map((a) => `  ${a.code} ${a.label} : cumul ${nombreFr(a.ytd)}, cible ${nombreFr(a.ytd_target)} (${ETATS_FR[a.status]})`) : ["  Aucun."]),
    "",
  ];
  for (const nature of NATURES) {
    const liste = p.indicators.filter((i) => i.nature === nature);
    if (!liste.length) continue;
    lignes.push(`Indicateurs ${nature === "proactive" ? "proactifs" : "réactifs"} :`);
    for (const i of liste) lignes.push(`  ${i.code} ${i.label} : mois ${nombreFr(i.value)} (plan ${nombreFr(i.target)}), cumul ${nombreFr(i.ytd)} (cible ${nombreFr(i.ytd_target)}), ${ETATS_FR[i.status]}`);
  }
  if (p.comment) lignes.push("", `Commentaire du mois : ${p.comment}`);
  return lignes;
}

/* ─── Semis du rapport mensuel ──────────────────────────────────────────── */

const tous = (v) => Array(12).fill(v);
/** Modèles des donneurs d'ordre : [n°, libellé, nature, mode, valeur calculée, unité, sens, cumul, cibles, seuil, en service]. */
const MODELES = [
  {
    id: 2, name: "Rapport HSSE mensuel, Distribution Pétrolière de Kankan", partner_id: 104, client_label: "Distribution Pétrolière de Kankan", company_id: 1, compliant_ratio: 0.95, watch_ratio: 0.85, cree: "2026-01-05T09:12:00Z",
    indicateurs: [
      ["A1-1", "Contrôles avant départ des citernes réalisés", "proactive", "computed", "check_completion", "%", "up", "average", tous(100)],
      ["A1-2", "Alcootests réalisés au départ", "proactive", "computed", "breath_test_completion", "%", "up", "average", tous(100)],
      ["A1-3", "Causeries sécurité tenues avec les conducteurs", "proactive", "manual", null, "nbre", "up", "sum", tous(4)],
      ["A1-4", "Heures de formation HSE dispensées", "proactive", "manual", null, "heures", "up", "sum", tous(40)],
      ["A1-5", "Presque-accidents et situations dangereuses déclarés", "proactive", "computed", "weak_signals", "nbre", "up", "sum", tous(2)],
      ["A1-6", "Visites HSE de terrain par la direction", "proactive", "manual", null, "nbre", "up", "sum", tous(2)],
      ["A1-7", "Actions correctives réalisées dans les délais", "proactive", "computed", "actions_on_time", "%", "up", "average", tous(90)],
      ["A1-8", "Exercices d'urgence (déversement, incendie)", "proactive", "manual", null, "nbre", "up", "sum", [null, null, 1, null, null, 1, null, null, 1, null, null, 1]],
      ["B1-1", "Accidents du travail avec arrêt", "reactive", "computed", "work_accidents", "nbre", "down", "sum", tous(0)],
      ["B1-2", "Accidents de la route", "reactive", "computed", "road_accidents", "nbre", "down", "sum", tous(0)],
      ["B1-3", "Taux de fréquence (12 mois glissants)", "reactive", "computed", "frequency_rate", "taux", "down", "last", tous(5)],
      ["B1-4", "Déversements de produit", "reactive", "computed", "events_spill", "nbre", "down", "sum", tous(0)],
      ["B1-5", "Écarts de livraison des citernes", "reactive", "computed", "tanker_shortage", "‰", "down", "average", tous(1.5)],
      ["B1-6", "Excès de vitesse relevés par la géolocalisation", "reactive", "manual", null, "nbre", "down", "sum", tous(0), 3],
      ["B1-7", "Plaintes de clients ou de riverains (HSE)", "reactive", "manual", null, "nbre", "down", "sum", tous(0)],
      ["B1-8", "Kilomètres parcourus", "reactive", "computed", "km", "km", "up", "sum", null],
    ],
  },
  {
    id: 3, name: "Rapport HSE mensuel, Société Minière de Boffa", partner_id: 101, client_label: "Société Minière de Boffa", company_id: 1, compliant_ratio: 1, watch_ratio: 0.9, cree: "2026-01-06T15:40:00Z",
    indicateurs: [
      ["P1", "Conducteurs aux habilitations à jour", "proactive", "computed", "qualifications_valid", "%", "up", "last", tous(100)],
      ["P2", "Inductions sécurité du site minier réalisées", "proactive", "manual", null, "nbre", "up", "sum", tous(2)],
      ["P3", "Contrôles avant départ des bennes réalisés", "proactive", "computed", "check_completion", "%", "up", "average", tous(100)],
      ["P4", "Observations sécurité comportementales (VCS)", "proactive", "manual", null, "nbre", "up", "sum", tous(20)],
      ["P5", "Audits réalisés contre planifiés", "proactive", "computed", "audits_completion", "%", "up", "average", tous(100)],
      ["P6", "Réunions HSE avec le donneur d'ordre", "proactive", "manual", null, "nbre", "up", "sum", tous(1), null, false],
      ["R1", "Incidents de chargement ou de basculement en fosse", "reactive", "manual", null, "nbre", "down", "sum", tous(0), 2],
      ["R2", "Accidents de la route", "reactive", "computed", "road_accidents", "nbre", "down", "sum", tous(0)],
      ["R3", "Alcootests positifs", "reactive", "computed", "breath_test_positives", "nbre", "down", "sum", tous(0)],
      ["R4", "Immobilisations de véhicules (V09)", "reactive", "computed", "immobilizations", "nbre", "down", "sum", tous(0)],
      ["R5", "Taux de gravité (12 mois glissants)", "reactive", "computed", "severity_rate", "taux", "down", "last", tous(0.2)],
    ],
  },
];

/** Valeur saisie de la démonstration, reproductible, par modèle, indicateur et mois. */
function saisieDemo(code, m, modeleId) {
  const r = hasard(`saisie-${modeleId}-${code}-${m}`);
  switch (code) {
    case "A1-3": return r.entier(3, 6);
    case "A1-4": return r.entier(30, 52);
    case "A1-6": return r.entier(1, 3);
    case "A1-8": return ["03", "06", "09"].includes(m.slice(5)) ? 1 : null;
    case "B1-6": return [0, 0, 0, 1, 0, 2, 0, 1][r.entier(0, 7)];
    case "B1-7": return m === "2026-05" ? 1 : 0;
    case "P2": return r.entier(1, 4);
    case "P4": return r.entier(15, 28);
    case "P6": return m <= "2026-06" ? 1 : null;
    case "R1": return ["2026-06", "2026-09"].includes(m) ? 1 : 0;
    default: return null;
  }
}

/** Commentaires de la démonstration : [modèle, mois, n° d'indicateur, texte]. */
const COMMENTAIRES = [
  [2, "2026-08", "B1-6", "Deux excès de vitesse sur la RN1 entre Kindia et Mamou : conducteurs reçus, rappel des limitations à la causerie du 3 septembre."],
  [2, "2026-05", "B1-4", "Renversement de la citerne ER-03 au virage de Tanènè : environ 6 000 L confinés avec la gendarmerie, enquête en arbre des causes."],
  [2, "2026-09", "A1-4", "Session ADR du 22 septembre reportée en octobre : formateur indisponible."],
  [3, "2026-09", "R1", "Basculement partiel d'une benne au quai de Dapilon, sans blessé : talus de déchargement repris par l'exploitant."],
  [3, "2026-06", "R1", "Benne EB-04 en appui sur le merlon de la fosse 3 lors d'une manœuvre de recul ; guidage au sol renforcé."],
];

/**
 * Modèles, indicateurs et mois des rapports : le modèle NIMOVA (_ensure_nimova) et deux donneurs d'ordre
 * fictifs. Pétrolier : janvier à août validés (août rouvert puis revalidé), septembre figé à compléter et
 * valider, octobre en cours. Minier : janvier à septembre validés. NIMOVA : janvier à août validés,
 * septembre figé à valider.
 */
function semerRapports(H) {
  const HS = H.DB.hsseq;
  HS.reportTemplates = [];
  HS.reportIndicators = [];
  HS.reports = [];
  HS.reportValues = [];
  const indicateur = (modeleId, rang, [code, label, nature, mode, key, unit, direction, aggregation, targets, alerte = null, active = true]) => {
    HS.reportIndicators.push({
      id: HS.reportIndicators.length + 1, template_id: modeleId, code, label, nature, mode, key, unit, direction, aggregation,
      targets: targets ? [...targets] : Array(12).fill(null), alert_threshold: alerte ?? 0, has_threshold: alerte !== null, sequence: rang * 10, active,
    });
  };
  // Modèle NIMOVA : un indicateur calculé par indicateur du cockpit, cibles des paramètres.
  HS.reportTemplates.push({ id: 1, name: "Rapport mensuel HSSEQ NIMOVA", code: "NIMOVA", company_id: null, partner_id: null, client_label: "Direction générale", compliant_ratio: 0.95, watch_ratio: 0.85, active: true });
  H.hsLog("report_template", 1, null, "create", null, null, null, "2026-01-02T05:00:00Z");
  INDICATORS.forEach(([code], k) => {
    const spec = CLES[code];
    indicateur(1, k + 1, [`${spec.family === "proactive" ? "P" : "R"}-${pad(k + 1)}`, spec.label, spec.family, "computed", code, spec.unit, spec.direction, spec.aggregation, null]);
  });
  for (const m of MODELES) {
    HS.reportTemplates.push({ id: m.id, name: m.name, code: null, company_id: m.company_id, partner_id: m.partner_id, client_label: m.client_label, compliant_ratio: m.compliant_ratio, watch_ratio: m.watch_ratio, active: true });
    H.hsLog("report_template", m.id, 16, "create", null, null, null, m.cree);
    m.indicateurs.forEach((ligne, k) => indicateur(m.id, k + 1, ligne));
  }

  // Valeurs calculées de janvier à septembre, figées le 5 du mois suivant.
  const courant = H.TODAY.slice(0, 7);
  const precedent = ajouterMois(`${courant}-01`, -1).slice(0, 7);
  const mois = Array.from({ length: +precedent.slice(5, 7) }, (_, k) => `${precedent.slice(0, 4)}-${pad(k + 1)}`);
  const calculees = valeursCalculees(H, 1, mois);
  const valider = (fiche, quand) => {
    fiche.state = "validated";
    fiche.validated_at = quand;
    fiche.validated_by = 16;
    H.hsLog("report", fiche.id, 16, "write", "state", "draft", "validated", quand);
    H.hsLog("report", fiche.id, 16, "validate", null, null, null, quand);
  };
  /** Saisies d'un mois : toutes, ou celles de `forcees` seulement (n° : valeur). */
  const saisir = (fiche, modeleId, m, quand, forcees = null) => {
    for (const ind of indicateursDu(H, modeleId).filter((i) => i.mode === "manual" && (!forcees || i.code in forcees))) {
      const v = forcees ? forcees[ind.code] : saisieDemo(ind.code, m, modeleId);
      if (v === null) continue;
      const ligne = ligneValeur(H, fiche, ind.id);
      const avant = tuple(ligne);
      Object.assign(ligne, { manual_value: v, manual_known: true });
      H.hsLog("report", fiche.id, 16, "write", ind.code, avant, tuple(ligne), quand);
    }
  };
  for (const modele of HS.reportTemplates) {
    for (const m of mois) {
      const gel = dateGel(m);
      const fiche = ficheDuMois(H, modele, 1, m, null, `${gel}T06:00:00Z`);
      figer(H, fiche, calculees.get(m), gel);
      const suivant = gel.slice(0, 7);
      if (modele.id === 1) {
        if (m !== precedent) valider(fiche, `${suivant}-06T08:15:00Z`);
        continue;
      }
      if (modele.id === 2 && m === precedent) {
        // Septembre : figé, des valeurs saisies manquent encore (visites, exercice, excès, plaintes).
        saisir(fiche, 2, m, `${suivant}-12T16:20:00Z`, { "A1-3": 5, "A1-4": 36 });
        continue;
      }
      saisir(fiche, modele.id, m, `${suivant}-0${modele.id === 2 ? 7 : 6}T11:00:00Z`);
      if (modele.id === 2 && m === "2026-08") fiche.comment = "Campagne de vérification des extincteurs sur toute la flotte ; deux extincteurs remplacés.";
      valider(fiche, `${suivant}-0${modele.id === 2 ? 8 : 7}T10:30:00Z`);
      if (modele.id === 2 && m === "2026-08") {
        // Août rouvert pour corriger les heures de formation, puis validé de nouveau.
        fiche.state = "draft";
        fiche.validated_at = null;
        fiche.validated_by = null;
        fiche.reopen_reason = "Heures de formation d'août corrigées après le rapprochement avec les feuilles d'émargement.";
        H.hsLog("report", fiche.id, 16, "write", "state", "validated", "draft", "2026-09-10T08:05:00Z");
        H.hsLog("report", fiche.id, 16, "reopen", null, null, null, "2026-09-10T08:05:00Z", fiche.reopen_reason);
        const ligne = ligneValeur(H, fiche, indicateursDu(H, 2).find((i) => i.code === "A1-4").id);
        const avant = tuple(ligne);
        ligne.manual_value = 44;
        H.hsLog("report", fiche.id, 16, "write", "A1-4", avant, tuple(ligne), "2026-09-10T08:12:00Z");
        valider(fiche, "2026-09-10T08:20:00Z");
      }
    }
  }
  // Octobre, mois en cours du modèle pétrolier : une première saisie.
  const octobre = ficheDuMois(H, HS.reportTemplates.find((t) => t.id === 2), 1, courant, 16, `${H.TODAY}T07:40:00Z`);
  const causeries = indicateursDu(H, 2).find((i) => i.code === "A1-3");
  const ligne = ligneValeur(H, octobre, causeries.id);
  const avant = tuple(ligne);
  Object.assign(ligne, { manual_value: 2, manual_known: true, comment: "Causeries du 6 et du 13 octobre ; deux autres prévues." });
  H.hsLog("report", octobre.id, 16, "write", "A1-3", avant, tuple(ligne), `${H.TODAY}T07:42:00Z`);
  for (const [modeleId, m, code, texte] of COMMENTAIRES) {
    const fiche = moisDuRapport(H, modeleId, 1, m);
    const ind = indicateursDu(H, modeleId).find((i) => i.code === code);
    if (fiche && ind) ligneValeur(H, fiche, ind.id).comment = texte;
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * Routes
 * ══════════════════════════════════════════════════════════════════════════ */

/** Enregistre les tables et les routes du module ; appelée une fois par serveur.mjs, après le semis. */
export function enregistrerHabilitationsRapports(H) {
  const { route } = H;
  semerHabilitations(H);
  semerAlertes(H);
  semerRapports(H);

  /* Habilitations */

  route("GET", "/hsseq/qualifications", QUAL_READ, (ctx) => {
    const q = ctx.query;
    const day = dateParametre(H, q, "date") ?? H.TODAY;
    const comps = societes(H, ctx, q);
    let site = null;
    if (q.site_id !== undefined && q.site_id !== "") {
      const id = entierOuNul(H, q, "site_id");
      site = id ? H.hsSite(id) : null;
      if (!site || !comps.includes(site.company_id)) throw introuvable(H, "Site introuvable.");
      if (!H.hasProfile(ctx, QUAL_FULL) && !sitesDuCompte(H, ctx).includes(site.id)) throw H.hsForbidden("Site non autorisé.");
    }
    const codes = String(q.type ?? "").split(",").filter(Boolean);
    const types = typesActifs(H).filter((t) => !codes.length || codes.includes(t.code));
    const lignes = lignesMatrice(H, ctx, comps, day, site?.id ?? null, types);
    const parStatut = { valid: 0, to_renew: 0, expired: 0, missing: 0 };
    for (const l of lignes) parStatut[l.status] += 1;
    const counts = { by_status: parStatut, drivers: lignes.length, blocking: lignes.filter((l) => l.blocking).length, up_to_date: lignes.filter((l) => !l.blocking).length };
    let liste = lignes;
    if (q.status) {
      const voulus = String(q.status).split(",");
      if (voulus.some((s) => !(s in STATUS_RANK))) throw H.hsBad("Statut : valid, to_renew, expired ou missing.", ["status"]);
      // Statut d'ensemble du conducteur, ou de la case du type filtré (comme le noyau).
      liste = liste.filter((l) => voulus.includes(l.status) || (codes.length && l.qualifications.some((c) => voulus.includes(c.status))));
    }
    if (["1", "true"].includes(String(q.blocking ?? ""))) liste = liste.filter((l) => l.blocking);
    if (q.search) {
      const s = String(q.search).toLowerCase();
      liste = liste.filter((l) => l.employee.name.toLowerCase().includes(s));
    }
    const offset = q.offset === undefined || q.offset === "" ? 0 : Number(q.offset);
    const limit = q.limit === undefined || q.limit === "" ? 200 : Number(q.limit);
    if (!Number.isInteger(offset) || !Number.isInteger(limit)) throw H.hsBad("Pagination invalide.");
    const debut = Math.max(offset, 0);
    const taille = Math.min(Math.max(limit, 1), 500);
    return {
      items: liste.slice(debut, debut + taille), total_count: liste.length, offset: debut, limit: taille, counts,
      types: types.map((t) => ({ code: t.code, name: t.name, mandatory: t.mandatory_for_drivers })), date: day,
    };
  });

  route("GET", "/hsseq/qualifications/alerts", ALERTS_READ, (ctx) => {
    const q = ctx.query;
    const comps = societes(H, ctx, q);
    const natures = q.kind ? String(q.kind).split(",") : null;
    // Profil RH sans profil de lecture complète : les personnes seulement.
    const rhSeul = H.hsIs(ctx, "rh") && !H.hasProfile(ctx, ["admin", "direction", "hsseq"]);
    return H.DB.hsseq.expiryAlerts
      .filter((a) => comps.includes(a.company_id) && (!natures || natures.includes(a.kind)) && !(rhSeul && a.kind === "vehicle_document"))
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at) || b.id - a.id)
      .slice(0, 500)
      .map((a) => ({ id: a.id, kind: a.kind, subject: a.subject, label: a.label, expires_on: a.expiry_date, stage: a.stage, reason_code: a.reason_code ?? null, site: a.site_id ? H.hsSiteRef(a.site_id) : null, sent_at: a.sent_at, recipients: a.recipient_ids.length }));
  });

  /* Rapport mensuel : catalogue et modèles */

  route("GET", "/hsseq/reports/keys", REPORT_READ, () =>
    Object.entries(CLES).map(([key, s]) => ({ key, label: s.label, unit: s.unit, aggregation: s.aggregation, direction: s.direction, source: s.source, family: s.family })));

  route("GET", "/hsseq/reports/templates", REPORT_READ, (ctx) => {
    const tout = ["all", ""].includes(String(ctx.query.active ?? "1"));
    return H.DB.hsseq.reportTemplates
      .filter((t) => (tout || t.active) && (!t.company_id || ctx.user.companies.includes(t.company_id)))
      .sort((a, b) => a.name.localeCompare(b.name, "fr") || a.id - b.id)
      .map((t) => ligneModele(H, ctx, t));
  });

  route("GET", "/hsseq/reports/templates/:id", REPORT_READ, (ctx) => ligneModele(H, ctx, modeleDe(H, ctx, ctx.params[0]), true));

  route("POST", "/hsseq/reports/templates", CONFIG, (ctx) => {
    const data = ctx.body;
    if (data.name === undefined || data.name === null || data.name === "") throw H.hsMissing("Champs obligatoires manquants.", ["name"]);
    const HS = H.DB.hsseq;
    const modele = { id: suivantId(HS.reportTemplates), code: null, company_id: null, partner_id: null, client_label: null, compliant_ratio: 0.95, watch_ratio: 0.85, active: true, ...valeursModele(H, ctx, data) };
    verifierSeuils(H, modele);
    // Les indicateurs sont tous vérifiés avant d'être écrits : un refus ne laisse rien derrière lui.
    enregistrerIndicateurs(H, modele, data.indicators);
    HS.reportTemplates.push(modele);
    H.hsLog("report_template", modele.id, ctx.user.id, "create");
    return ligneModele(H, ctx, modele, true);
  });

  route("PATCH", "/hsseq/reports/templates/:id", CONFIG, (ctx) => {
    const modele = modeleDe(H, ctx, ctx.params[0]);
    const data = ctx.body;
    const valeurs = valeursModele(H, ctx, data);
    verifierSeuils(H, { ...modele, ...valeurs });
    if ("indicators" in data) enregistrerIndicateurs(H, modele, data.indicators);
    ecrireModele(H, modele, valeurs, ctx.user.id);
    return ligneModele(H, ctx, modele, true);
  });

  /* Rapport mensuel : mois */

  route("GET", "/hsseq/reports", REPORT_READ, (ctx) => {
    const q = ctx.query;
    if (q.template_id === undefined || q.template_id === null || q.template_id === "") throw H.hsMissing("Champs obligatoires manquants.", ["template_id"]);
    const modele = modeleDe(H, ctx, q.template_id);
    const societe = societeDu(H, ctx, modele, q);
    const annee = entierOuNul(H, q, "year") ?? +H.TODAY.slice(0, 4);
    const dernier = annee < +H.TODAY.slice(0, 4) ? 12 : +H.TODAY.slice(5, 7);
    const items = Array.from({ length: dernier }, (_, k) => {
      const m = `${annee}-${pad(k + 1)}`;
      const fiche = moisDuRapport(H, modele.id, societe, m);
      return { month: m, label: moisLabel(m), state: fiche?.state ?? "draft", frozen: Boolean(fiche?.frozen_on), freeze_date: dateGel(m) };
    });
    return { template: ligneModele(H, ctx, modele), company: societeRef(H, societe), year: annee, items };
  });

  route("GET", "/hsseq/reports/:id/:month", REPORT_READ, (ctx) => {
    const { modele, societe, m } = moisDemande(H, ctx, ctx.params[0], ctx.params[1], ctx.query);
    return charge(H, ctx, modele, societe, m);
  });

  route("PATCH", "/hsseq/reports/:id/:month", HSSEQ, (ctx) => {
    const data = ctx.body;
    const { modele, societe, m } = moisDemande(H, ctx, ctx.params[0], ctx.params[1], { ...ctx.query, company_id: data.company_id });
    const existante = moisDuRapport(H, modele.id, societe, m);
    if (existante?.state === "validated") throw H.hsRule("invalid_transition", "Mois validé : rouvrez-le avant de le modifier.");
    if (data.values !== undefined && data.values !== null && !Array.isArray(data.values)) throw H.hsBad("Indicateur absent du modèle.", ["values"]);
    // Toutes les saisies vérifiées avant d'écrire (transaction du noyau).
    const actifs = new Map(indicateursActifs(H, modele.id).map((i) => [i.id, i]));
    const saisies = (data.values ?? []).map((item) => {
      const ind = item && typeof item === "object" ? actifs.get(entierOuNul(H, item, "indicator_id")) : null;
      if (!ind) throw H.hsBad("Indicateur absent du modèle.", ["values"]);
      const maj = {};
      if ("value" in item) {
        if (ind.mode !== "manual") throw H.hsRule("business_rule", `${ind.code} est calculé par NIMOVA : il ne se saisit pas.`, { fields: ["values"] });
        if (item.value === null || item.value === "") Object.assign(maj, { manual_value: 0, manual_known: false });
        else {
          const n = typeof item.value === "number" || typeof item.value === "string" ? Number(item.value) : Number.NaN;
          if (!Number.isFinite(n)) throw H.hsBad(`Valeur invalide pour ${ind.code}.`, ["values"]);
          Object.assign(maj, { manual_value: n, manual_known: true });
        }
      }
      if ("comment" in item) maj.comment = H.hsText(item, "comment", 2000);
      return { ind, maj };
    });
    const fiche = ficheDuMois(H, modele, societe, m, ctx.user.id);
    for (const { ind, maj } of saisies) {
      const ligne = ligneValeur(H, fiche, ind.id);
      const avant = tuple(ligne);
      Object.assign(ligne, maj);
      H.hsLog("report", fiche.id, ctx.user.id, "write", ind.code, avant, tuple(ligne));
    }
    if ("comment" in data) {
      const texte = H.hsText(data, "comment", 4000);
      if (texte !== fiche.comment) H.hsLog("report", fiche.id, ctx.user.id, "write", "comment", fiche.comment, texte);
      fiche.comment = texte;
    }
    return charge(H, ctx, modele, societe, m);
  });

  route("GET", "/hsseq/reports/:id/:month/report.xlsx", REPORT_READ, (ctx) => {
    const { modele, societe, m } = moisDemande(H, ctx, ctx.params[0], ctx.params[1], ctx.query);
    return H.fileReply(H.xlsxBuffer(classeur(charge(H, ctx, modele, societe, m))), XLSX_MIME, `${nomFichier(modele, m)}.xlsx`);
  });

  route("GET", "/hsseq/reports/:id/:month/report.pdf", REPORT_READ, (ctx) => {
    const { modele, societe, m } = moisDemande(H, ctx, ctx.params[0], ctx.params[1], ctx.query);
    const p = charge(H, ctx, modele, societe, m);
    // Comme le noyau, le rendu du PDF crée le mois du rapport s'il n'existe pas encore.
    ficheDuMois(H, modele, societe, m, ctx.user.id);
    return H.fileReply(pdf(`Rapport mensuel HSSE : ${p.label}`, lignesPdf(p)), "application/pdf", `${nomFichier(modele, m)}.pdf`);
  });

  route("POST", "/hsseq/reports/:id/:month/:action", HSSEQ, (ctx) => {
    const data = ctx.body;
    const { modele, societe, m } = moisDemande(H, ctx, ctx.params[0], ctx.params[1], { ...ctx.query, company_id: data.company_id });
    const transition = ctx.params[2];
    const existante = moisDuRapport(H, modele.id, societe, m);
    if (transition === "validate") {
      if (existante?.state === "validated") throw H.hsRule("invalid_transition", "Ce mois du rapport est déjà validé.");
      const gel = dateGel(m);
      if (!existante?.frozen_on && H.TODAY < gel) {
        throw H.hsRule("month_not_frozen", `Les valeurs de ${MOIS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)} se figent le ${frDate(gel)} : validation à partir de cette date.`);
      }
      const fiche = ficheDuMois(H, modele, societe, m, ctx.user.id);
      if (!fiche.frozen_on) figer(H, fiche, valeursCalculees(H, societe, [m]).get(m), H.TODAY, ctx.user.id);
      const quand = H.hsNow();
      Object.assign(fiche, { state: "validated", validated_at: quand, validated_by: ctx.user.id });
      H.hsLog("report", fiche.id, ctx.user.id, "write", "state", "draft", "validated", quand);
      H.hsLog("report", fiche.id, ctx.user.id, "validate", null, null, null, quand);
    } else if (transition === "reopen") {
      if (existante?.state !== "validated") throw H.hsRule("invalid_transition", "Seul un mois validé se rouvre.");
      const motif = String(data.reason ?? "").trim();
      if (!motif) throw H.hsRule("reason_required", "Le motif de la réouverture est obligatoire.", { fields: ["reason"] });
      Object.assign(existante, { state: "draft", validated_at: null, validated_by: null, reopen_reason: motif });
      H.hsLog("report", existante.id, ctx.user.id, "write", "state", "validated", "draft");
      H.hsLog("report", existante.id, ctx.user.id, "reopen", null, null, null, H.hsNow(), motif);
    } else {
      throw introuvable(H, "Transition inconnue.");
    }
    return charge(H, ctx, modele, societe, m);
  });
}
