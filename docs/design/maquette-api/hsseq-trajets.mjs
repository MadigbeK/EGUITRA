/**
 * Maquette du lot 2 HSSEQ : plans de trajet (motif V08), itinéraires interdits de nuit, nouvelle pesée
 * après délestage (V07) et immobilisations des véhicules (V09), comme eguitra_hsseq/controllers/journeys.py,
 * models/journey.py et models/immobilization.py (branche hsseq du noyau). `H` porte les références de
 * serveur.mjs (HS_REFS) ; le module s'enregistre après seed(), sur les données du lot 1.
 *
 * Tables, sous DB.hsseq, aux noms de champs du noyau :
 * - journeys : plan de trajet d'une rotation { id, rotation_id, itinerary, planned_departure,
 *   planned_arrival, night_driving, stops: [{ id, kind (stop, break, rest), place, planned_at,
 *   duration_minutes }], status (draft, validated), validated_by, validated_at, create_date, write_date } ;
 * - routeRules : attributs HSSEQ d'un itinéraire de Transport, par route_id { route_id,
 *   night_driving_forbidden, updated_at, updated_by } (le noyau les porte sur la route ; DB.routes reste
 *   à Transport) ;
 * - weighings : tickets de pesée d'une rotation { id, rotation_id, weigh_ticket, weight_gross,
 *   weight_tare, at, by, comment } ; le plus récent fait foi (le noyau le porte sur la rotation, l'ancien
 *   reste au journal) ;
 * - immobilizations : { id, vehicle_id, site_id, event_id, since, reason, imposed_by, status (active,
 *   lifted), lifted_at, lifted_by, lift_reason }.
 *
 * Les fonctions exportées après enregistrerTrajets lisent ces tables pour serveur.mjs : évaluation du
 * verrou (V07, V08 ; V09 lit immobilizations directement), fiche d'un événement (immobilisation proposée,
 * en cours, transition « immobilize »), référentiels (`immobilized`).
 */

/** Profils des routes, comme le noyau (journeys.py). */
const LECTURE_PLAN = ["admin", "direction", "hsseq", "exploitation", "conducteur", "auditeur"];
const CHEF_DE_PARC = ["exploitation"];
const LECTURE = ["admin", "direction", "hsseq", "exploitation", "auditeur"];
const PARAMETRAGE = ["admin", "hsseq"];
const RESPONSABLE_HSSEQ = ["hsseq"];

const NATURES_ARRET = ["stop", "break", "rest"];
/** Règles du plan de trajet tant que les paramètres de la société ne les portent pas (défauts du noyau). */
const REGLES_DEFAUT = { night_start_hour: 19, night_end_hour: 6, max_driving_hours: 9 };
const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

/** Références de serveur.mjs, posées à l'enregistrement. */
let H = null;

const tables = () => H.DB.hsseq;
const prochainId = (liste) => liste.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const instant = (jour, heure) => `${jour}T${heure}:00Z`;
/** « 15/10/2026 » d'une date « AAAA-MM-JJ ». */
const jourFr = (jour) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;
/**
 * Nombre écrit à la française (fr_number du noyau) : espace fine insécable des milliers, virgule décimale ;
 * `sansZeros` : sans les zéros décimaux inutiles. Vide pour une valeur absente.
 */
function frNombre(valeur, decimales = 2, sansZeros = false) {
  if (valeur === null || valeur === undefined || valeur === false) return "";
  const n = Number(valeur);
  const [entier, fraction] = Math.abs(n).toFixed(decimales).split(".");
  let texte = `${n < 0 ? "-" : ""}${entier.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${fraction ? `,${fraction}` : ""}`;
  if (sansZeros && decimales) texte = texte.replace(/0+$/, "").replace(/,$/, "");
  return texte;
}
/** Valeur d'un champ du plan pour le journal (_journal_value) : « oui » ou « non », horodatage « AAAA-MM-JJ HH:MM:SS ». */
function valeurJournal(cle, v) {
  if (cle === "night_driving") return v ? "oui" : "non";
  if (v === null || v === undefined || v === "") return null;
  return cle === "planned_departure" || cle === "planned_arrival" ? String(v).replace("T", " ").replace("Z", "") : String(v);
}
/** Durée en heures écrite comme le noyau (hours_label) : « 9 h », « 13 h 45 ». */
function heures(valeur) {
  const entier = Math.trunc(valeur);
  const minutes = Math.round((valeur - entier) * 60);
  return minutes ? `${entier} h ${String(minutes).padStart(2, "0")}` : `${entier} h`;
}

/* ─── Portée ────────────────────────────────────────────────────────────── */

/** Objet d'un des sites du compte (chef de parc, auditeur) ; fermé par défaut, comme le noyau. */
function dansSesSites(ctx, siteId) {
  return siteId !== null && siteId !== undefined && H.hsSites(ctx).includes(siteId);
}
/** in_scope du noyau : lecture complète (admin, direction, hsseq), ou objet d'un site du compte. */
const dansPortee = (ctx, siteId) => H.hsFull(ctx) || dansSesSites(ctx, siteId);
const siteDuVehicule = (vehicleId) => {
  const v = H.hsVehicle(vehicleId);
  return v ? H.hsVehicleSite(v) : null;
};
/** Sociétés de travail : toutes celles du compte, ou celle du filtre company_id (403 hors du compte). */
function societes(ctx, q) {
  if (q.company_id === undefined || q.company_id === null || q.company_id === "" || q.company_id === "all") return ctx.user.companies;
  if (!/^\d+$/.test(String(q.company_id))) throw H.hsBad("Société invalide.");
  const id = Number(q.company_id);
  if (!ctx.user.companies.includes(id)) throw H.hsForbidden("Société non autorisée.");
  return [id];
}

/* ─── Plan de trajet (V08) ──────────────────────────────────────────────── */

/** Règles de la société : plage de nuit et conduite prévue au plus par jour. */
function regles(company = 1) {
  const s = H.hsSettings(company) ?? {};
  return Object.fromEntries(Object.entries(REGLES_DEFAUT).map(([cle, defaut]) => [cle, typeof s[cle] === "number" ? s[cle] : defaut]));
}

const planDe = (rotationId) => tables().journeys.find((j) => j.rotation_id === rotationId) ?? null;

/** Intervalles de conduite prévus (millisecondes) : du départ à l'arrivée, hors arrêts, pauses et repos. */
function segments(plan) {
  let liste = [[Date.parse(plan.planned_departure), Date.parse(plan.planned_arrival)]];
  for (const arret of [...plan.stops].sort((a, b) => a.planned_at.localeCompare(b.planned_at))) {
    if (!arret.planned_at || !arret.duration_minutes) continue;
    const debut = Date.parse(arret.planned_at);
    const fin = debut + arret.duration_minutes * 60_000;
    const suite = [];
    for (const [a, b] of liste) {
      if (fin <= a || debut >= b) {
        suite.push([a, b]);
        continue;
      }
      if (a < debut) suite.push([a, debut]);
      if (fin < b) suite.push([fin, b]);
    }
    liste = suite;
  }
  return liste;
}

/** Heures de conduite prévues par jour (heure de Conakry, UTC), dans l'ordre des jours. */
function conduiteParJour(plan) {
  const jours = new Map();
  for (const [a, b] of segments(plan)) {
    let curseur = a;
    while (curseur < b) {
      const d = new Date(curseur);
      const minuit = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      const arret = Math.min(b, minuit);
      const jour = d.toISOString().slice(0, 10);
      jours.set(jour, (jours.get(jour) ?? 0) + (arret - curseur) / HEURE);
      curseur = arret;
    }
  }
  return [...jours.entries()].sort(([x], [y]) => x.localeCompare(y));
}

/** La conduite prévue passe-t-elle par la plage de nuit des paramètres ? */
function chevaucheLaNuit(plan, r) {
  for (const [a, b] of segments(plan)) {
    const da = new Date(a);
    const db = new Date(b);
    let jour = Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate() - 1);
    const dernier = Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate());
    while (jour <= dernier) {
      const nuit = jour + r.night_start_hour * HEURE;
      const finNuit = jour + (r.night_end_hour <= r.night_start_hour ? JOUR : 0) + r.night_end_hour * HEURE;
      if (a < finNuit && b > nuit) return true;
      jour += JOUR;
    }
  }
  return false;
}
const rouleDeNuit = (plan, r) => Boolean(plan.night_driving) || chevaucheLaNuit(plan, r);

const routeDe = (rot) => (rot.route_id ? H.DB.routes.find((x) => x.id === rot.route_id) ?? null : null);
const regleRoute = (routeId) => tables().routeRules.find((x) => x.route_id === routeId) ?? null;

/** Écarts du plan aux règles de V08 : conduite de nuit sur une route interdite de nuit, conduite au-delà du maximum journalier. */
function ecarts(plan, rot) {
  const r = regles(rot.company_id ?? 1);
  const liste = [];
  const route = routeDe(rot);
  if (route && regleRoute(route.id)?.night_driving_forbidden && rouleDeNuit(plan, r)) {
    liste.push({ code: "night_forbidden", label: `Conduite de nuit prévue sur la route ${route.name}, interdite de nuit (${heures(r.night_start_hour)} à ${heures(r.night_end_hour)}).` });
  }
  if (r.max_driving_hours) {
    for (const [jour, h] of conduiteParJour(plan)) {
      if (h > r.max_driving_hours + 1e-6) liste.push({ code: "driving_time", label: `${heures(h)} de conduite prévues le ${jourFr(jour)}, au-delà de ${heures(r.max_driving_hours)}.` });
    }
  }
  return liste;
}

/** Conducteur de la rotation ; son nom n'est pas servi à l'auditeur. */
function refConducteur(ctx, id) {
  const d = H.hsDriverRef(id);
  return d && H.hsPersonalHidden(ctx) ? { id: d.id, name: null } : d;
}

/** Plan de trajet d'une rotation au format de GET /hsseq/rotations/{id}/journey (journey_row du noyau). */
function ligneTrajet(ctx, rot) {
  const site = siteDuVehicule(rot.vehicle_id);
  const r = regles(rot.company_id ?? 1);
  const route = routeDe(rot);
  const editable = H.hsIs(ctx, "exploitation") && dansSesSites(ctx, site) && rot.state === "draft";
  const ligne = {
    rotation: H.hsRotationRef(rot), vehicle: H.hsVehicleRef(rot.vehicle_id), driver: refConducteur(ctx, rot.driver_id), site: H.hsSiteRef(site),
    // Route complète : origine, destination, distance (aller simple) et durée standard d'une rotation.
    route: route
      ? {
        id: route.id, name: route.name, origin: route.origin || null, destination: route.destination || null, distance_km: route.distance_km || null,
        duration_days: route.duration_days || null, night_driving_forbidden: Boolean(regleRoute(route.id)?.night_driving_forbidden),
      }
      : null,
    rules: r, journey: null, transitions: [], rights: { can_edit: editable, can_close: false, can_approve: false },
  };
  const plan = planDe(rot.id);
  if (plan) {
    const liste = ecarts(plan, rot);
    ligne.journey = {
      id: plan.id, itinerary: plan.itinerary || null, planned_departure: plan.planned_departure, planned_arrival: plan.planned_arrival,
      night_driving: plan.night_driving, drives_at_night: rouleDeNuit(plan, r),
      driving_hours_by_day: conduiteParJour(plan).map(([date, h]) => ({ date, hours: Math.round(h * 100) / 100 })),
      stops: [...plan.stops].sort((a, b) => a.planned_at.localeCompare(b.planned_at) || a.id - b.id).map((s) => ({ id: s.id, kind: s.kind, place: s.place || null, planned_at: s.planned_at, duration_minutes: s.duration_minutes })),
      status: plan.status, validated_by: H.hsUser(plan.validated_by), validated_at: plan.validated_at || null, issues: liste, history: H.hsHistory("journey", plan.id),
    };
    const valider = editable && plan.status !== "validated" && !liste.length;
    ligne.transitions = valider ? ["validate"] : [];
    ligne.rights.can_approve = valider;
  }
  return ligne;
}

/** Rotation lue : lecture complète, rotation d'un site du compte (fermé par défaut), ou rotation du conducteur. */
function rotationLue(ctx, id) {
  const rot = H.hsRotation(id);
  const moi = H.hsMyDriver(ctx);
  if (!rot || !(dansPortee(ctx, siteDuVehicule(rot.vehicle_id)) || (moi !== null && rot.driver_id === moi))) throw new H.ApiError(404, "not_found", "Rotation introuvable.");
  return rot;
}

/** Rotation qu'un chef de parc modifie : de ses sites (fermé par défaut), pas encore partie. */
function rotationDuParc(ctx, id) {
  const rot = H.hsRotation(id);
  if (!rot) throw new H.ApiError(404, "not_found", "Rotation introuvable.");
  if (!dansSesSites(ctx, siteDuVehicule(rot.vehicle_id))) throw H.hsForbidden("Rotation d'un ensemble hors de vos sites.");
  if (rot.state !== "draft") throw H.hsRule("invalid_transition", "Rotation déjà partie : le plan et la pesée ne se modifient plus.");
  return rot;
}

/**
 * Valeurs d'un plan envoyé par PUT (journey_values du noyau) ; les arrêts remplacent les précédents. Un arrêt
 * qui commence avant le départ prévu ou finit après l'arrivée prévue est refusé (400, fields ["stops"]).
 */
function valeursPlan(b) {
  const manquants = ["planned_departure", "planned_arrival"].filter((k) => b[k] === undefined || b[k] === null || b[k] === "");
  if (manquants.length) throw H.hsMissing("Champs obligatoires manquants.", manquants);
  const depart = H.hsDateTime(b, "planned_departure");
  const arrivee = H.hsDateTime(b, "planned_arrival");
  if (arrivee <= depart) throw H.hsBad("L'arrivée prévue suit le départ prévu.", ["planned_arrival"]);
  if (b.stops !== undefined && b.stops !== null && !Array.isArray(b.stops)) throw H.hsBad("Arrêt : kind stop, break ou rest.", ["stops"]);
  const arrets = [];
  for (const s of b.stops ?? []) {
    if (!s || typeof s !== "object" || Array.isArray(s) || !NATURES_ARRET.includes("kind" in s ? s.kind : "break")) throw H.hsBad("Arrêt : kind stop, break ou rest.", ["stops"]);
    const prevu = H.hsDateTime(s, "planned_at");
    const minutes = Math.trunc(Number(s.duration_minutes ?? 0));
    if (!prevu || !(minutes > 0)) throw H.hsBad("Arrêt : heure prévue et durée positive.", ["stops"]);
    if (Date.parse(prevu) < Date.parse(depart) || Date.parse(prevu) + minutes * 60_000 > Date.parse(arrivee)) {
      throw H.hsBad("Un arrêt se tient entre le départ et l'arrivée prévus.", ["stops"]);
    }
    arrets.push({ kind: s.kind || "break", place: H.hsText(s, "place", 200), planned_at: prevu, duration_minutes: minutes });
  }
  return { itinerary: H.hsText(b, "itinerary", 4000), night_driving: Boolean(b.night_driving), planned_departure: depart, planned_arrival: arrivee, stops: arrets };
}

/** Plan comparable (_plan_key) : valeurs des champs et arrêts triés, sans leurs identifiants. */
function clePlan(p) {
  const arrets = p.stops.map((s) => JSON.stringify([s.kind || "break", s.place || "", s.planned_at, s.duration_minutes])).sort();
  return JSON.stringify([p.itinerary || null, Boolean(p.night_driving), p.planned_departure, p.planned_arrival, arrets]);
}

/** Arrêts numérotés à la suite de ceux de tous les plans. */
function numeroter(arrets) {
  let n = tables().journeys.reduce((m, j) => Math.max(m, ...j.stops.map((s) => s.id)), 0);
  return arrets.map((s) => ({ id: ++n, ...s }));
}

/* ─── Pesée (V07) ───────────────────────────────────────────────────────── */

const peseeDe = (rotationId) => tables().weighings.filter((w) => w.rotation_id === rotationId).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)[0] ?? null;
const net = (w) => (w && w.weight_gross && w.weight_tare ? w.weight_gross - w.weight_tare : 0);
const chargeUtile = (rot) => H.hsVehicle(rot.vehicle_id)?.payload_tonnes ?? null;
/** Tonnes au-delà de la charge utile (poids net du dernier ticket), 0 sinon (_overload de Transport). */
function surcharge(rot) {
  const n = net(peseeDe(rot.id));
  const utile = chargeUtile(rot);
  return utile && n ? Math.max(0, Math.round((n - utile) * 1000) / 1000) : 0;
}
/** Ticket de pesée pour le journal, nombres à la française : « TP-7 : 48,500 t brut, 13,000 t à vide ». */
const decrireTicket = (w) => `${w?.weigh_ticket || "-"} : ${frNombre(w?.weight_gross ?? 0, 3)} t brut, ${frNombre(w?.weight_tare ?? 0, 3)} t à vide`;

/* ─── Immobilisations (V09) ─────────────────────────────────────────────── */

const evenementDe = (id) => tables().events.find((e) => e.id === id) ?? null;
/** Immobilisation en cours du véhicule : la plus ancienne encore active (hsseq_immobilization_id du noyau). */
const enCours = (vehicleId) => tables().immobilizations.filter((i) => i.vehicle_id === vehicleId && i.status === "active").sort((a, b) => a.since.localeCompare(b.since))[0] ?? null;

/** Immobilisation au format de l'API (immobilization_row du noyau). */
function ligneImmobilisation(ctx, i) {
  const e = evenementDe(i.event_id);
  // Le site suit celui de l'ensemble (champ lié, stocké, du noyau).
  i.site_id = siteDuVehicule(i.vehicle_id) ?? i.site_id;
  const ouverte = i.status === "active" && H.hsIs(ctx, "hsseq");
  return {
    id: i.id, vehicle: H.hsVehicleRef(i.vehicle_id), site: H.hsSiteRef(i.site_id),
    event: { id: i.event_id, reference: e?.reference ?? null, title: e?.title ?? null, level: e ? H.hsLevel(H.hsCriticality(e)) : null },
    since: i.since, reason: i.reason ?? null, imposed_by: H.hsUser(i.imposed_by), status: i.status, lifted_at: i.lifted_at ?? null,
    lifted_by: H.hsUser(i.lifted_by), lift_reason: i.lift_reason ?? null, transitions: ouverte ? ["release"] : [],
    rights: { can_edit: false, can_close: ouverte, can_approve: false },
  };
}

/* ─── Enregistrement ────────────────────────────────────────────────────── */

/** Enregistre les tables et les routes du module ; appelé une fois par serveur.mjs, après seed(). */
export function enregistrerTrajets(refs) {
  H = refs;
  try {
    semer();
  } catch (e) {
    // L'enregistrement ne lève jamais : les routes répondent alors sur des tables vides.
    console.error("hsseq-trajets : données de démonstration non semées.", e);
    if (H.DB.hsseq) Object.assign(H.DB.hsseq, { journeys: [], routeRules: [], weighings: [], immobilizations: [] });
  }
  try {
    routes();
  } catch (e) {
    console.error("hsseq-trajets : routes non enregistrées.", e);
  }
}

/**
 * Données fictives : règles des itinéraires de l'intérieur (interdits de nuit), plans de trajet des
 * départs du jour (validé, à valider, non conforme, absent), tickets de pesée des bennes du jour (dont une
 * surcharge), une immobilisation en cours (EB-03) et une levée (ER-03), sur les deux événements de
 * criticité élevée du lot 1.
 */
function semer() {
  const T = tables();
  const jour = H.TODAY;
  T.journeys = [];
  T.weighings = [];
  T.immobilizations = [];

  // Itinéraires de l'intérieur : cols, descentes et aires non gardées, circulation de nuit interdite.
  const interdites = ["Conakry - Mamou", "Conakry - Labé", "Conakry - Kankan", "Conakry - Siguiri"];
  T.routeRules = H.DB.routes.filter((r) => r.company_id === 1).map((r) => ({ route_id: r.id, night_driving_forbidden: interdites.includes(r.name), updated_at: "2026-10-01T09:00:00Z", updated_by: 16 }));

  // Plans de trajet des départs du jour.
  const duJour = (nom) => H.hsDepartureRotations(jour).find((r) => r.state === "draft" && H.hsVehicle(r.vehicle_id)?.name === nom) ?? null;
  const ajouterPlan = (nom, p) => {
    const rot = duJour(nom);
    if (!rot) return;
    const plan = {
      id: prochainId(T.journeys), rotation_id: rot.id, itinerary: p.itinerary, night_driving: false,
      planned_departure: instant(p.depart[0], p.depart[1]), planned_arrival: instant(p.arrivee[0], p.arrivee[1]),
      stops: [], status: p.valide ? "validated" : "draft", validated_by: p.valide ? p.par : null, validated_at: p.valide ? instant(jour, p.valide) : null,
      create_date: instant(jour, p.cree), write_date: instant(jour, p.valide ?? p.cree),
    };
    plan.stops = numeroter(p.arrets.map(([kind, j, h, minutes, place]) => ({ kind, place, planned_at: instant(j, h), duration_minutes: minutes })));
    T.journeys.push(plan);
    H.hsLog("journey", plan.id, p.par, "create", null, null, null, plan.create_date);
    if (p.valide) {
      H.hsLog("journey", plan.id, p.par, "write", "status", "draft", "validated", plan.validated_at);
      H.hsLog("journey", plan.id, p.par, "validate", null, null, null, plan.validated_at);
    }
  };
  const kamsar = "RN3 par Dubréka, Boffa et Boké ; contournement du virage de Tanènè par Kolaboui.";
  ajouterPlan("ER-04", {
    itinerary: kamsar, depart: [jour, "06:30"], arrivee: [jour, "14:45"], par: 12, cree: "05:50", valide: "06:05",
    arrets: [["break", jour, "09:45", 30, "Boffa, aire du carrefour de la RN3"], ["stop", jour, "12:10", 20, "Boké, poste de contrôle"]],
  });
  ajouterPlan("ER-09", {
    itinerary: kamsar, depart: [jour, "07:00"], arrivee: [jour, "15:00"], par: 12, cree: "06:35",
    arrets: [["break", jour, "10:15", 30, "Boffa, aire du carrefour de la RN3"], ["stop", jour, "12:45", 20, "Boké, poste de contrôle"]],
  });
  // Premier jet du chef de parc : 13 h 45 de conduite le premier jour, dont la fin de journée de nuit sur une route interdite.
  const lendemain = new Date(Date.parse(`${jour}T00:00:00Z`) + JOUR).toISOString().slice(0, 10);
  ajouterPlan("ER-06", {
    itinerary: "RN1 par Kindia, Mamou, Dabola et Kouroussa ; nuit à Kankan, puis RN6 jusqu'à Siguiri.", depart: [jour, "05:30"], arrivee: [lendemain, "10:30"], par: 12, cree: "06:20",
    arrets: [["break", jour, "08:30", 30, "Kindia, sortie nord"], ["break", jour, "12:45", 45, "Mamou, gare routière"], ["rest", jour, "20:30", 600, "Kankan, parc gardé du dépôt"]],
  });
  for (const nom of ["EB-01", "EB-04", "EB-05", "EB-06"]) {
    ajouterPlan(nom, {
      itinerary: "Fosse 3, piste minière puis port de Dapilon, trois tours ; déversement au point n° 1 (le n° 2 est fermé depuis le 08/10).",
      depart: [jour, "06:30"], arrivee: [jour, "16:30"], par: 18, cree: "05:10", valide: "05:20",
      arrets: [["break", jour, "09:30", 15, "Port de Dapilon, point de déversement n° 1"], ["break", jour, "12:00", 60, "Base vie de la fosse 3"], ["break", jour, "14:30", 15, "Fosse 3, plateforme de chargement"]],
    });
  }

  // Tickets de pesée des bennes du jour (pont-bascule de la fosse 3) ; EB-04 dépasse la charge utile de 30 t.
  for (const [nom, ticket, brut, vide, heure] of [["EB-01", "F3-26-10452", 44.1, 14.5, "06:05"], ["EB-02", "F3-26-10453", 43.7, 14.4, "06:08"], ["EB-04", "F3-26-10455", 48.1, 14.7, "06:14"], ["EB-05", "F3-26-10456", 44.25, 14.65, "06:17"], ["EB-06", "F3-26-10457", 43.4, 14.55, "06:20"]]) {
    const rot = duJour(nom);
    if (rot) T.weighings.push({ id: prochainId(T.weighings), rotation_id: rot.id, weigh_ticket: ticket, weight_gross: brut, weight_tare: vide, at: instant(jour, heure), by: 18, comment: null });
  }

  // Immobilisations sur les deux événements de criticité élevée : ER-03 (levée), EB-03 (en cours).
  const evenementGrave = (nom) => {
    const v = H.hsVehicleByName(nom);
    return v ? T.events.find((e) => e.vehicle_id === v.id && H.hsLevel(H.hsCriticality(e)) === "high") ?? null : null;
  };
  const immobiliserAuSemis = (nom, since, reason, levee) => {
    const e = evenementGrave(nom);
    if (!e) return;
    const v = H.hsVehicle(e.vehicle_id);
    const i = { id: prochainId(T.immobilizations), vehicle_id: v.id, site_id: H.hsVehicleSite(v), event_id: e.id, since, reason, imposed_by: 16, status: "active", lifted_at: null, lifted_by: null, lift_reason: null };
    T.immobilizations.push(i);
    H.hsLog("immobilization", i.id, 16, "create", null, null, null, since);
    H.hsLog("event", e.id, 16, "immobilize", null, null, null, since, `${v.name} immobilisé`);
    if (levee) {
      Object.assign(i, { status: "lifted", lifted_at: levee.at, lifted_by: 16, lift_reason: levee.reason });
      H.hsLog("immobilization", i.id, 16, "write", "status", "active", "lifted", levee.at);
      H.hsLog("immobilization", i.id, 16, "lift", null, null, null, levee.at, levee.reason);
    }
    e.vehicle_immobilized = !levee;
  };
  immobiliserAuSemis(
    "ER-03",
    "2026-05-17T17:50:00Z",
    "Citerne couchée dans le virage de Tanènè : châssis, citerne et freins à expertiser. Aucune remise en service avant l'avis de l'expert de l'assureur et la conclusion de l'enquête.",
    { at: "2026-09-30T15:10:00Z", reason: "Remise en état terminée : châssis redressé, citerne éprouvée et certificat d'étanchéité renouvelé, limiteur de vitesse posé le 20/07. Expertise de l'assureur close le 29/09." },
  );
  immobiliserAuSemis(
    "EB-03",
    "2026-10-08T18:20:00Z",
    "Benne levée sous une ligne électrique basse au port de Dapilon : vérin de levée et alarme de proximité à contrôler, consigne de levée à l'arrêt complet à rédiger. Immobilisée jusqu'à la conclusion de l'arbre des causes.",
    null,
  );
}

function routes() {
  const { route } = H;

  // ─── Plan de trajet (V08) ───────────────────────────────────────────────

  route("GET", "/hsseq/rotations/:id/journey", LECTURE_PLAN, (ctx) => ligneTrajet(ctx, rotationLue(ctx, ctx.params[0])));

  /**
   * Plan créé ou remplacé ; un envoi identique au plan enregistré (valeurs et arrêts) n'écrit rien, un plan
   * validé qui change réellement revient « à valider ».
   */
  route("PUT", "/hsseq/rotations/:id/journey", CHEF_DE_PARC, (ctx) => {
    const rot = rotationDuParc(ctx, ctx.params[0]);
    const v = valeursPlan(ctx.body);
    const maintenant = H.hsNow();
    const plan = planDe(rot.id);
    if (!plan) {
      const nouveau = { id: prochainId(tables().journeys), rotation_id: rot.id, ...v, stops: numeroter(v.stops), status: "draft", validated_by: null, validated_at: null, create_date: maintenant, write_date: maintenant };
      tables().journeys.push(nouveau);
      H.hsLog("journey", nouveau.id, ctx.user.id, "create", null, null, null, maintenant);
      return ligneTrajet(ctx, rot);
    }
    if (clePlan(plan) === clePlan(v)) return ligneTrajet(ctx, rot);
    for (const cle of ["itinerary", "planned_departure", "planned_arrival", "night_driving"]) {
      const [avant, apres] = [valeurJournal(cle, plan[cle]), valeurJournal(cle, v[cle])];
      if (avant !== apres) H.hsLog("journey", plan.id, ctx.user.id, "write", cle, avant, apres, maintenant);
    }
    const valide = plan.status === "validated";
    Object.assign(plan, v, { stops: numeroter(v.stops), write_date: maintenant });
    if (valide) {
      Object.assign(plan, { status: "draft", validated_by: null, validated_at: null });
      H.hsLog("journey", plan.id, ctx.user.id, "write", "status", "validated", "draft", maintenant);
      H.hsLog("journey", plan.id, ctx.user.id, "invalidated", null, null, null, maintenant, "Plan modifié après sa validation : à valider de nouveau.");
    }
    return ligneTrajet(ctx, rot);
  });

  /** Validation par le chef de parc (levée de V08), refusée tant que le plan n'est pas conforme. */
  route("POST", "/hsseq/rotations/:id/journey/validate", CHEF_DE_PARC, (ctx) => {
    const rot = rotationDuParc(ctx, ctx.params[0]);
    const plan = planDe(rot.id);
    if (!plan) throw H.hsRule("invalid_transition", "Aucun plan de trajet à valider pour cette rotation.");
    const liste = ecarts(plan, rot);
    if (liste.length) throw H.hsRule("journey_not_compliant", liste.map((x) => x.label).join(" "), { fields: liste.map((x) => x.code) });
    if (plan.status !== "validated") {
      const maintenant = H.hsNow();
      Object.assign(plan, { status: "validated", validated_by: ctx.user.id, validated_at: maintenant, write_date: maintenant });
      H.hsLog("journey", plan.id, ctx.user.id, "write", "status", "draft", "validated", maintenant);
      H.hsLog("journey", plan.id, ctx.user.id, "validate", null, null, null, maintenant);
    }
    return ligneTrajet(ctx, rot);
  });

  // ─── Itinéraires interdits de nuit ──────────────────────────────────────

  route("GET", "/hsseq/routes", LECTURE, (ctx) => {
    const liste = societes(ctx, ctx.query);
    return H.DB.routes
      .filter((r) => r.active !== false && liste.includes(r.company_id))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((r) => ({ id: r.id, name: r.name, origin: r.origin ?? null, destination: r.destination ?? null, distance_km: r.distance_km || null, night_driving_forbidden: Boolean(regleRoute(r.id)?.night_driving_forbidden) }));
  });

  route("PATCH", "/hsseq/routes/:id", PARAMETRAGE, (ctx) => {
    const r = H.DB.routes.find((x) => x.id === ctx.params[0] && ctx.user.companies.includes(x.company_id));
    if (!r) throw new H.ApiError(404, "not_found", "Route introuvable.");
    const b = ctx.body;
    // Booléen strict, comme le noyau : « false » en texte, 0 ou une absence sont refusés.
    if (typeof b.night_driving_forbidden !== "boolean") throw H.hsBad("night_driving_forbidden : true ou false.", ["night_driving_forbidden"]);
    const avant = Boolean(regleRoute(r.id)?.night_driving_forbidden);
    const apres = b.night_driving_forbidden;
    const regle = regleRoute(r.id) ?? { route_id: r.id };
    if (!tables().routeRules.includes(regle)) tables().routeRules.push(regle);
    Object.assign(regle, { night_driving_forbidden: apres, updated_at: H.hsNow(), updated_by: ctx.user.id });
    H.hsLog("route", r.id, ctx.user.id, "write", "hsseq_night_forbidden", avant ? "oui" : "non", apres ? "oui" : "non");
    return { id: r.id, name: r.name, night_driving_forbidden: apres };
  });

  // ─── Nouvelle pesée (V07) ───────────────────────────────────────────────

  /** Nouveau ticket de pesée après délestage ; l'ancien reste au journal, V07 tombe sous la charge utile. */
  route("POST", "/hsseq/rotations/:id/reweigh", CHEF_DE_PARC, (ctx) => {
    const rot = rotationDuParc(ctx, ctx.params[0]);
    const b = ctx.body;
    const manquants = ["weight_gross", "weight_tare"].filter((k) => b[k] === undefined || b[k] === null || b[k] === "");
    if (manquants.length) throw H.hsMissing("Champs obligatoires manquants.", manquants);
    const [brut, vide] = ["weight_gross", "weight_tare"].map((k) => {
      const n = Number(b[k]);
      if (!Number.isFinite(n)) throw H.hsBad(`Nombre invalide : ${k}.`, [k]);
      return n;
    });
    if (brut <= 0 || vide <= 0 || vide > brut) throw H.hsBad("Poids brut et poids à vide positifs, le second au plus égal au premier.", ["weight_gross", "weight_tare"]);
    const avant = peseeDe(rot.id);
    const ticket = { id: prochainId(tables().weighings), rotation_id: rot.id, weigh_ticket: H.hsText(b, "weigh_ticket", 64) ?? avant?.weigh_ticket ?? null, weight_gross: brut, weight_tare: vide, at: H.hsNow(), by: ctx.user.id, comment: H.hsText(b, "comment", 1000) };
    tables().weighings.push(ticket);
    H.hsLog("rotation", rot.id, ctx.user.id, "reweigh", "weigh_ticket", decrireTicket(avant), decrireTicket(ticket), ticket.at, ticket.comment);
    return {
      rotation: H.hsRotationRef(rot), weigh_ticket: ticket.weigh_ticket, weight_gross: brut, weight_tare: vide, weight_net: Math.round((brut - vide) * 1000) / 1000,
      payload_tonnes: chargeUtile(rot), overload_tonnes: surcharge(rot), lock: H.hsEvaluate(ctx, rot),
    };
  });

  // ─── Immobilisations (V09) ──────────────────────────────────────────────

  route("GET", "/hsseq/immobilizations", LECTURE, (ctx) => {
    const q = ctx.query;
    const liste = societes(ctx, q);
    if (q.sort && !["since", "-since"].includes(q.sort)) throw H.hsBad("Tri inconnu.", ["sort"]);
    const statuts = q.status ? String(q.status).split(",").filter(Boolean) : null;
    const vehicule = H.hsId(q, "vehicle_id");
    const evenement = H.hsId(q, "event_id");
    const lignes = tables().immobilizations
      .filter((i) => liste.includes(H.hsVehicle(i.vehicle_id)?.company_id ?? 1))
      .filter((i) => dansPortee(ctx, siteDuVehicule(i.vehicle_id) ?? i.site_id))
      .filter((i) => (!statuts || statuts.includes(i.status)) && (!vehicule || i.vehicle_id === vehicule) && (!evenement || i.event_id === evenement))
      .sort((a, b) => (q.sort === "since" ? a.since.localeCompare(b.since) : b.since.localeCompare(a.since)) || b.id - a.id);
    return H.hsPage(ctx, lignes, { active: lignes.filter((i) => i.status === "active").length }, (i) => ligneImmobilisation(ctx, i));
  });

  // Masquée par POST /hsseq/events/:id/:action de serveur.mjs, déclarée avant : celle-ci doit y renvoyer à immobiliser().
  route("POST", "/hsseq/events/:id/immobilize", RESPONSABLE_HSSEQ, (ctx) => immobiliser(ctx, ctx.params[0]));

  /** Levée de l'immobilisation d'un véhicule (Responsable HSSEQ), motif écrit obligatoire. */
  route("POST", "/hsseq/vehicles/:id/release", RESPONSABLE_HSSEQ, (ctx) => {
    const v = H.hsVehicle(ctx.params[0]);
    if (!v || !ctx.user.companies.includes(v.company_id)) throw new H.ApiError(404, "not_found", "Ensemble introuvable.");
    const i = enCours(v.id);
    if (!i) throw H.hsRule("invalid_transition", `${v.name} n'est pas immobilisé.`);
    const motif = H.hsText(ctx.body, "reason", 4000);
    if (!motif) throw H.hsRule("reason_required", "Le motif de la levée est obligatoire.", { fields: ["reason"] });
    const maintenant = H.hsNow();
    Object.assign(i, { status: "lifted", lifted_at: maintenant, lifted_by: ctx.user.id, lift_reason: motif });
    H.hsLog("immobilization", i.id, ctx.user.id, "write", "status", "active", "lifted", maintenant);
    H.hsLog("immobilization", i.id, ctx.user.id, "lift", null, null, null, maintenant, motif);
    const e = evenementDe(i.event_id);
    if (e && !tables().immobilizations.some((x) => x.event_id === e.id && x.status === "active")) e.vehicle_immobilized = false;
    return ligneImmobilisation(ctx, i);
  });
}

/* ─── Lectures pour serveur.mjs ──────────────────────────────────────────── */

/**
 * POST /hsseq/events/{id}/immobilize (Responsable HSSEQ) : immobilisation du véhicule d'un événement de
 * criticité élevée, pas clôturé, pas déjà immobilisé ; notifie les chefs de parc du site et le Responsable
 * HSSEQ. À appeler depuis POST /hsseq/events/:id/:action de serveur.mjs, qui précède la route de ce module.
 */
export function immobiliser(ctx, eventId) {
  if (!H.hsIs(ctx, "hsseq")) throw H.hsForbidden("L'immobilisation d'un véhicule revient au Responsable HSSEQ.");
  const e = evenementDe(Number(eventId));
  if (!e) throw new H.ApiError(404, "not_found", "Événement introuvable.");
  if (H.hsLevel(H.hsCriticality(e)) !== "high") throw H.hsRule("invalid_transition", "L'immobilisation du véhicule (V09) vaut pour un événement de criticité élevée.");
  if (e.status === "closed") throw H.hsRule("invalid_transition", "Événement clôturé : il n'immobilise plus de véhicule.");
  const v = e.vehicle_id ? H.hsVehicle(e.vehicle_id) : null;
  if (!v) throw H.hsMissing("L'événement ne met en cause aucun ensemble.", ["vehicle_id"]);
  if (enCours(v.id)) throw H.hsRule("invalid_transition", `${v.name} est déjà immobilisé.`);
  const maintenant = H.hsNow();
  const i = {
    id: prochainId(tables().immobilizations), vehicle_id: v.id, site_id: H.hsVehicleSite(v), event_id: e.id, since: maintenant,
    reason: H.hsText(ctx.body ?? {}, "reason", 2000), imposed_by: ctx.user.id, status: "active", lifted_at: null, lifted_by: null, lift_reason: null,
  };
  tables().immobilizations.push(i);
  e.vehicle_immobilized = true;
  H.hsLog("immobilization", i.id, ctx.user.id, "create", null, null, null, maintenant);
  H.hsLog("event", e.id, ctx.user.id, "immobilize", null, null, null, maintenant, `${v.name} immobilisé`);
  const chefs = H.hsSite(i.site_id)?.yard_manager_ids ?? [];
  H.hsNotify([...chefs, ...H.hsHsseqManagers()], "immobilized", `Véhicule immobilisé : ${v.name}`, `${e.reference} ${e.title}\nAucun départ jusqu'à la levée par le Responsable HSSEQ (motif V09).`, "event", e.id, maintenant);
  return ligneImmobilisation(ctx, i);
}

/** Immobilisation en cours du véhicule (ligne de la table), ou null : motif V09, `immobilized` des référentiels. */
export function immobilisationEnCours(vehicleId) {
  return H?.DB.hsseq?.immobilizations ? enCours(vehicleId) : null;
}

/** `immobilization` de la fiche d'un événement : son immobilisation en cours { id, since, reason, imposed_by }, ou null. */
export function immobilisationDeLEvenement(eventId) {
  const i = H?.DB.hsseq?.immobilizations?.find((x) => x.event_id === eventId && x.status === "active");
  return i ? { id: i.id, since: i.since, reason: i.reason ?? null, imposed_by: H.hsUser(i.imposed_by) } : null;
}

/**
 * `immobilization_proposed` de la fiche d'un événement, et transition « immobilize » pour le Responsable
 * HSSEQ : criticité élevée, pas clôturé, un ensemble en cause, pas déjà immobilisé, et que l'événement n'a
 * jamais immobilisé (après une levée, elle n'est plus proposée ; le Responsable HSSEQ peut toujours
 * immobiliser de nouveau par POST /hsseq/events/{id}/immobilize).
 */
export function immobilisationProposee(e) {
  if (!H?.DB.hsseq?.immobilizations || !e) return false;
  const dejaImmobilise = tables().immobilizations.some((i) => i.event_id === e.id && i.vehicle_id === e.vehicle_id);
  return H.hsLevel(H.hsCriticality(e)) === "high" && e.status !== "closed" && Boolean(e.vehicle_id) && !enCours(e.vehicle_id) && !dejaImmobilise;
}

/**
 * Motif V08 de la rotation, comme _hsseq_v08 du noyau : { since, detail } (plan absent, à valider, ou
 * écarts aux règles), ou null quand le plan est validé et conforme.
 */
export function motifTrajet(rot) {
  if (!H?.DB.hsseq?.journeys || !rot) return null;
  const plan = planDe(rot.id);
  const problemes = [];
  if (!plan) problemes.push("Aucun plan de trajet pour la rotation.");
  else if (plan.status !== "validated") problemes.push("Plan de trajet à valider par l'exploitation.");
  if (plan) problemes.push(...ecarts(plan, rot).map((x) => x.label));
  // Sans plan, le noyau date le motif de la création de la rotation : 5 h le jour du chargement, comme V01 dans la maquette.
  return problemes.length ? { since: plan ? plan.write_date : `${rot.date_loading}T05:00:00Z`, detail: problemes.join(" ") } : null;
}

/** Motif V07 d'une benne, comme _hsseq_v07 du noyau : { since: null, detail }, ou null sous la charge utile. */
export function motifSurcharge(rot) {
  if (!H?.DB.hsseq?.weighings || !rot) return null;
  const v = H.hsVehicle(rot.vehicle_id);
  if (!v || H.hsKind(v) !== "tipper") return null;
  const exces = surcharge(rot);
  if (!(exces > 0)) return null;
  // Nombres à la française (fr_number, deux décimales), comme le motif du noyau.
  return { since: null, detail: `Poids net ${frNombre(net(peseeDe(rot.id)))} t pour une charge utile de ${frNombre(chargeUtile(rot))} t : délester de ${frNombre(exces)} t, puis nouvelle pesée.` };
}
