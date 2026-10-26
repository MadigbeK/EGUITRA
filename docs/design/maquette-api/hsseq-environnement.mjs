/**
 * Maquette du lot 3 HSSEQ : environnement et qualité (eguitra_hsseq/controllers/environment.py,
 * models/environment.py, branche hsseq). Routes et données fictives ; `H` porte les références de
 * serveur.mjs (HS_REFS).
 *
 * Tables, aux noms de champs du noyau :
 * - DB.hsseq.spills (eguitra.hsseq.spill : reference, company_id, occurred_at, site_id, location, event_id,
 *   rotation_id, vehicle_id, product_id, product_label, volume_liters, recovered_liters, recovery, cost,
 *   status, reported_by, closed_at, closed_by, reopen_reason) ;
 * - DB.hsseq.wastes (eguitra.hsseq.waste : reference, company_id, site_id, waste_kind, description, quantity,
 *   unit, produced_on, status, pickup_date, provider_id, provider_name, manifest_reference, collected_by,
 *   note, reopen_reason) ;
 * - DB.hsseq.dustMeasurements (eguitra.hsseq.dust : company_id, site_id, measured_on, point, value, unit,
 *   threshold, exceeded, method, note, measured_by) ;
 * - DB.hsseq.contaminations (eguitra.hsseq.contamination : reference, company_id, detected_on, nature,
 *   rotation_id, vehicle_id, site_id, product_id, volume_m3, description, measures, cost, event_id, status,
 *   closed_at, closed_by, reopen_reason) ;
 * - DB.hsseq.complaints (eguitra.hsseq.complaint : reference, company_id, partner_id, rotation_id,
 *   vehicle_id, site_id, received_on, nature, severity, description, response_due, response, responded_on,
 *   responded_by, status, closed_at, closed_by, reopen_reason). Ses actions sont celles du plan
 *   (DB.hsseq.actions), d'origine « complaint ».
 * Consommation, émissions et écarts de livraison sont calculés sur les rotations de Transport de la
 * maquette (citernes : DB.rotations, distance de la route aller et retour, carburant d'après son coût ;
 * bennes : postes de la mine de DB.hsseq.rotations), jamais ressaisis. Citernes : volumes ramenés à 15 °C
 * d'après une température de chargement et de livraison tirée de la rotation (la maquette de Transport
 * n'en a pas) ; manquant à 15 °C (chargé moins livré, corrigés) ÷ livré à 15 °C, `delivered` restant le
 * livré non corrigé (tanker_shortage_15 du noyau).
 *
 * Droits du noyau : lecture ENV_READ (administration, direction, hsseq, chef de parc, auditeur) ;
 * contaminations et réclamations QUALITY_READ, sans le chef de parc. Portée fermée par défaut : chef de
 * parc et auditeur lisent les fiches de leurs sites, jamais une fiche sans site. Saisie de terrain
 * (déversements, déchets, poussières) par hsseq et par le chef de parc pour ses sites ; le reste par hsseq.
 * L'auditeur ne reçoit pas les noms des personnes (déclarant, auteur d'une mesure, d'un enlèvement…) ;
 * l'auteur d'une ligne d'historique ou d'une pièce lui est servi par sa seule fonction (actor_ref du
 * noyau : { id: null, name: null, function }).
 *
 * Écarts de la maquette, faute de pouvoir toucher aux routes communes de serveur.mjs : une pièce déposée
 * sur ces fiches prend le rôle « photo » (le noyau pose « document » sur un déchet et une réclamation) ;
 * seul hsseq en dépose (le noyau ouvre aussi les déversements et les déchets au chef de parc du site) ;
 * une action d'origine « complaint » créée par l'écran prend le site 1.
 */

const ENV_READ = ["admin", "direction", "hsseq", "exploitation", "auditeur"];
const ENV_FIELD = ["hsseq", "exploitation"];
const QUALITY_READ = ["admin", "direction", "hsseq", "auditeur"];

const STATUTS_DEVERSEMENT = { open: "En cours de traitement", closed: "Clos" };
const NATURES_DECHET = { used_oil: "Huiles usagées", tyres: "Pneus", filters: "Filtres", other: "Autres déchets" };
const UNITES_DECHET = { l: "Litres", kg: "Kilogrammes", t: "Tonnes", unit: "Pièces" };
/** Unité proposée pour chaque nature de déchet (WASTE_DEFAULT_UNIT). */
const UNITE_PAR_DEFAUT = { used_oil: "l", tyres: "unit", filters: "unit", other: "kg" };
const STATUTS_DECHET = { stored: "Entreposé", collected: "Enlevé" };
const UNITES_POUSSIERE = { mg_m3: "mg/m³", ug_m3: "µg/m³" };
const NATURES_CONTAMINATION = {
  water: "Présence d'eau", mixing: "Mélange de produits", impurities: "Impuretés ou sédiments", off_spec: "Produit hors spécification", other: "Autre contamination",
};
const STATUTS_CONTAMINATION = { open: "Ouverte", closed: "Close" };
const NATURES_RECLAMATION = {
  shortage: "Manquant à la livraison", quality: "Qualité du produit", delay: "Retard de livraison", damage: "Dommage",
  behaviour: "Comportement du conducteur", documents: "Documents de livraison", other: "Autre motif",
};
const GRAVITES = { minor: "Mineure", major: "Majeure", critical: "Critique" };
const STATUTS_RECLAMATION = { received: "Reçue", answered: "Répondue", closed: "Close" };
const REGROUPEMENTS = ["vehicle", "site", "month", "rotation"];
/** Actions encore ouvertes (OPEN_ACTION du noyau) : elles retiennent la clôture d'une réclamation. */
const ACTION_OUVERTE = ["todo", "in_progress", "to_verify"];
/** Facteur d'émission proposé (CO2_PER_LITER) et délai de réponse à un client, quand les paramètres n'en ont pas. */
const CO2_PAR_LITRE = 2.68;
const DELAI_REPONSE = 15;
/** Rotations parties de Transport : en route, validées, facturées (departed_states). */
const PARTIES = ["en_route", "done", "invoiced"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Clients fictifs : les tiers clients de serveur.mjs (PARTNERS, absent de HS_REFS), mêmes identifiants et
 * mêmes noms, et produits de Transport (PRODUCTS) avec un identifiant pour la référence { id, name }.
 */
const CLIENTS = {
  101: "Société Minière de Boffa (démo)", 102: "Bauxite Atlantique Kamsar (démo)", 103: "Mines d'Or du Haut Niger (démo)",
  104: "Distribution Pétrolière de Kankan (démo)", 105: "Aéro Services Gbessia (démo)", 106: "Énergie Fria Services (démo)",
  107: "Ciments du Rio Pongo (démo)", 108: "Stations Fouta Carburants (démo)", 109: "Société des Eaux de Mamou (démo)", 110: "Agro Kindia Fruits (démo)",
};
const PRODUITS = { gasoil: [1, "Gasoil"], essence: [2, "Essence"], jet: [3, "Jet A1"], petrole: [4, "Pétrole lampant"], fuel: [5, "Fuel"], autre: [6, "Autre produit"] };

const posee = (o, cle) => Object.hasOwn(o, cle);
const rempli = (v) => v !== undefined && v !== null && v !== "";
const oui = (v) => ["1", "true"].includes(String(v ?? ""));
/** Arrondi à `d` décimales, sans le bruit des flottants (1,005 donne 1,01). */
const arrondi = (n, d = 0) => {
  const p = 10 ** d;
  return Math.round((n + Number.EPSILON) * p) / p;
};
const ajouterJours = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const quatre = (n) => String(n).padStart(4, "0");
const moisLong = (cle) => `${MOIS[Number(cle.slice(5, 7)) - 1]} ${cle.slice(0, 4)}`;
/** Part pseudo-aléatoire et stable d'un identifiant (bruit des kilomètres et du carburant des bennes). */
const part = (id, k) => (((id * 9301 + k * 49297) % 233280) + 233280) % 233280 / 233280;
const produitRef = (id) => {
  const p = Object.values(PRODUITS).find(([pid]) => pid === id);
  return p ? { id: p[0], name: p[1] } : null;
};
const clientRef = (id) => (id && CLIENTS[id] ? { id, name: CLIENTS[id] } : null);

/** Enregistre les routes du module et sème ses tables ; appelé une fois par serveur.mjs, après seed(). */
export function enregistrerEnvironnement(H) {
  try {
    installer(H);
  } catch (e) {
    // Le serveur démarre quoi qu'il arrive : l'erreur reste au journal de la console.
    console.error("Maquette environnement et qualité : enregistrement incomplet.", e);
  }
}

function installer(H) {
  const {
    route, fileReply, xlsxBuffer, ApiError, DB, USERS, TODAY, COMPANIES, HS_ATTACH_MODELS, HS_ORIGINS, HS_PNG,
    hsIs, hsFull, hsSites, hsSite, hsSiteRef, hsUser, hsVehicle, hsVehicleRef, hsVehicleByName, hsKind, hsVehicleSite,
    hsRotation, hsRotationRef, hsRotationAt, hsForbidden, hsRule, hsMissing, hsBad, hsId, hsText, hsList, hsSort, hsPage,
    hsLog, hsHistory, hsAttach, hsPhoto, hsAttachments, hsSettings, hsNow, hsAddMinutes, hsPersonalHidden, hsNewAction,
    hsActionLine, hsDateTime, hsInternal,
  } = H;
  const HS = DB.hsseq;
  HS.spills = [];
  HS.wastes = [];
  HS.dustMeasurements = [];
  HS.contaminations = [];
  HS.complaints = [];
  Object.assign(HS.seq, { spill: 0, waste: 0, dust: 0, contamination: 0, complaint: 0 });
  // Le plan d'actions accepte l'origine « complaint » (ACTION_ORIGINS du noyau, lot 3).
  if (Array.isArray(HS_ORIGINS) && !HS_ORIGINS.includes("complaint")) HS_ORIGINS.push("complaint");

  /* ─── Compte, portée, valeurs ─────────────────────────────────────────── */

  const introuvable = (libelle) => new ApiError(404, "not_found", `${libelle} introuvable.`);
  /** Portée fermée par défaut (scope_domain du noyau) : tout en lecture complète, sinon les sites du compte. */
  const dansPortee = (ctx, siteId) => hsFull(ctx) || (siteId !== null && siteId !== undefined && hsSites(ctx).includes(siteId));
  /** Écriture d'une fiche de terrain (can_write) : hsseq, ou chef de parc d'un site qui est le sien (jamais sans site). */
  const ecrivain = (ctx, siteId) => hsIs(ctx, "hsseq") || (hsIs(ctx, "exploitation") && siteId !== null && siteId !== undefined && hsSites(ctx).includes(siteId));
  /** Nom d'un compte, retiré pour l'auditeur (person du noyau). */
  const personne = (ctx, id) => (hsPersonalHidden(ctx) ? null : hsUser(id));
  /** Fonction d'un compte, servie à l'auditeur à la place de son nom (FUNCTIONS du noyau, premier profil trouvé). */
  const FONCTIONS = [["hsseq", "Responsable HSSEQ"], ["exploitation", "Chef de parc"], ["rh", "Ressources humaines"], ["conducteur", "Conducteur"], ["admin", "Administration"],
    ["direction", "Direction générale"], ["finance", "Finance"], ["auditeur", "Auditeur"]];
  /** Auteur d'une écriture (actor_ref du noyau) : son nom, sauf pour l'auditeur, qui ne lit que sa fonction. */
  function auteur(ctx, ref) {
    if (!ref || !hsPersonalHidden(ctx)) return ref;
    const profils = USERS.find((u) => u.id === ref.id)?.profiles ?? [];
    return { id: null, name: null, function: FONCTIONS.find(([code]) => profils.includes(code))?.[1] ?? "Utilisateur interne" };
  }
  /** Historique d'une fiche, le plus récent d'abord, auteurs servis comme le noyau. */
  const journal = (ctx, modele, id) => [...hsHistory(modele, id)].reverse().map((h) => ({ ...h, by: auteur(ctx, h.by) }));
  /** Pièces d'une fiche, déposant servi comme le noyau. */
  const pieces = (ctx, modele, id) => hsAttachments(modele, id).map((a) => ({ ...a, created_by: auteur(ctx, a.created_by) }));
  const lectureQualite = (ctx) => ctx.user.profiles.some((p) => QUALITY_READ.includes(p));
  const societeRef = (id) => ({ id, name: COMPANIES[id]?.name ?? "" });
  const annee = () => TODAY.slice(0, 4);
  const evenementRef = (id) => {
    const e = id ? HS.events.find((x) => x.id === id) : null;
    return e ? { id: e.id, reference: e.reference } : null;
  };
  const rotationRef = (id) => hsRotationRef(hsRotation(id));

  /** Sociétés de travail : toutes celles du compte, ou celle du filtre company_id (403 hors du compte). */
  function societes(ctx, q) {
    const v = q.company_id;
    if (!rempli(v) || v === "all") return ctx.user.companies;
    if (!/^\d+$/.test(String(v))) throw hsBad("Société invalide.");
    if (!ctx.user.companies.includes(Number(v))) throw hsForbidden("Société non autorisée.");
    return [Number(v)];
  }
  function exiger(data, ...cles) {
    const manquants = cles.filter((k) => !rempli(data[k]));
    if (manquants.length) throw hsMissing("Champs obligatoires manquants.", manquants);
  }
  /** Date « AAAA-MM-JJ » d'un corps ou d'une requête ; nulle si absente, 400 si illisible. */
  function jour(data, cle) {
    const v = data[cle];
    if (!rempli(v)) return null;
    const d = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw hsBad(`Date invalide : ${cle}.`, [cle]);
    return d;
  }
  function nombre(data, cle) {
    const v = data[cle];
    if (!rempli(v)) return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n)) throw hsBad(`Nombre invalide : ${cle}.`, [cle]);
    return n;
  }
  /** Nombre positif (ou nul si `zero`), comme positive() du noyau. */
  function positif(data, cle, zero = false) {
    const n = nombre(data, cle);
    if (n === null || n < 0 || (n === 0 && !zero)) throw hsBad(`Nombre ${zero ? "positif ou nul" : "positif"} attendu : ${cle}.`, [cle]);
    return n;
  }
  function choix(data, cle, table, message) {
    if (!posee(table, String(data[cle] ?? ""))) throw hsBad(message, [cle]);
    return data[cle];
  }
  function siteDe(data) {
    const id = hsId(data, "site_id");
    if (!id) return null;
    const s = hsSite(id);
    if (!s) throw introuvable("Site");
    return s;
  }
  /** Site d'une saisie de terrain (field_site) : obligatoire et de ses sites pour le chef de parc, facultatif pour hsseq. */
  function siteDeSaisie(ctx, data, fiche = null) {
    let site = null;
    if (rempli(data.site_id)) site = siteDe(data);
    else if (fiche && !("site_id" in data)) site = fiche.site_id ? hsSite(fiche.site_id) : null;
    if (!hsIs(ctx, "hsseq") && !ecrivain(ctx, site?.id ?? null)) throw hsForbidden("Saisie réservée aux sites auxquels vous êtes rattaché.");
    return site;
  }
  /** Rotation, ensemble et événement cités par une saisie (links du noyau). */
  function liens(data, v) {
    if ("rotation_id" in data) {
      const id = hsId(data, "rotation_id");
      if (id && !hsRotation(id)) throw introuvable("Rotation");
      v.rotation_id = id;
    }
    if ("vehicle_id" in data) {
      const id = hsId(data, "vehicle_id");
      if (id && !hsVehicle(id)) throw introuvable("Ensemble");
      v.vehicle_id = id;
    }
    if ("product_id" in data) {
      const id = hsId(data, "product_id");
      v.product_id = id && produitRef(id) ? id : null;
    }
    if ("event_id" in data) {
      const id = hsId(data, "event_id");
      if (id && !HS.events.some((e) => e.id === id)) throw introuvable("Événement");
      v.event_id = id;
    }
    return v;
  }
  /** Rattachements par défaut (link_defaults) : l'ensemble de la rotation, puis le site de l'ensemble. */
  function rattacher(f) {
    if (f.rotation_id && !f.vehicle_id) f.vehicle_id = hsRotation(f.rotation_id)?.vehicle_id ?? null;
    if (f.vehicle_id && !f.site_id) {
      const v = hsVehicle(f.vehicle_id);
      f.site_id = v ? hsVehicleSite(v) : null;
    }
  }
  /** Un événement lié est du domaine attendu (check_event_domain). */
  function domaineEvenement(f, domaine) {
    const e = f.event_id ? HS.events.find((x) => x.id === f.event_id) : null;
    if (e && e.domain !== domaine) {
      throw hsRule("event_domain_mismatch", `L'événement ${e.reference} n'est pas du domaine ${domaine === "environment" ? "environnement" : "qualité"} : il ne se rattache pas à cette fiche.`, { fields: ["event_id"] });
    }
  }
  function motif(data) {
    const r = String(data.reason ?? "").trim();
    if (!r) throw hsRule("reason_required", "Le motif de la réouverture est obligatoire.", { fields: ["reason"] });
    return r;
  }
  function exigerTransition(f, t, permises, statuts) {
    if (!permises.includes(t)) throw hsRule("invalid_transition", `Transition « ${t} » impossible depuis le statut « ${statuts[f.status]} ».`);
  }
  /** Valeur écrite au journal : nom d'un site, d'un ensemble, d'un client, sinon la valeur brute. */
  function lue(cle, v) {
    if (!rempli(v)) return null;
    if (cle === "site_id") return hsSite(v)?.name ?? null;
    if (cle === "vehicle_id") return hsVehicle(v)?.name ?? null;
    if (cle === "rotation_id") return hsRotation(v)?.name ?? `Rotation ${v}`;
    if (cle === "event_id") return evenementRef(v)?.reference ?? null;
    if (cle === "partner_id") return CLIENTS[v] ?? String(v);
    if (cle === "product_id") return produitRef(v)?.name ?? null;
    return String(v);
  }
  /** Écrit des champs, une ligne de journal par champ suivi qui change (valeurs avant et après). */
  function ecrire(modele, by, f, v, suivis) {
    for (const [cle, valeur] of Object.entries(v)) {
      const avant = lue(cle, f[cle]);
      const apres = lue(cle, valeur);
      f[cle] = valeur;
      if (suivis.includes(cle) && avant !== apres) hsLog(modele, f.id, by, "write", cle, avant, apres);
    }
  }
  /** Fiche lue par le compte, dans sa portée par site ; 404 sinon, sans révéler son existence. */
  function fiche(ctx, liste, id, libelle, lecteurs) {
    if (!ctx.user.profiles.some((p) => lecteurs.includes(p))) throw introuvable(libelle);
    const f = liste.find((x) => x.id === Number(id));
    if (!f || !ctx.user.companies.includes(f.company_id) || !dansPortee(ctx, f.site_id)) throw introuvable(libelle);
    return f;
  }
  const page = (ctx, liste, counts, ligne) => hsPage(ctx, liste, counts, (x) => ligne(ctx, x));
  /** Filtres communs des listes : société, portée, site et période sur la date de la fiche. */
  function communs(ctx, q, liste, date) {
    const ids = societes(ctx, q);
    const site = hsId(q, "site_id");
    const du = jour(q, "date_from");
    const au = jour(q, "date_to");
    return liste.filter((f) => ids.includes(f.company_id) && dansPortee(ctx, f.site_id) && (!site || f.site_id === site) && (!du || String(date(f)).slice(0, 10) >= du) && (!au || String(date(f)).slice(0, 10) <= au));
  }

  // Pièces jointes des fiches du module : dépôt, téléchargement et retrait par les routes communes /hsseq/attachments.
  if (HS_ATTACH_MODELS) {
    Object.assign(HS_ATTACH_MODELS, {
      spill: (ctx, id) => fiche(ctx, HS.spills, id, "Déversement", ENV_READ),
      waste: (ctx, id) => fiche(ctx, HS.wastes, id, "Déchet", ENV_READ),
      contamination: (ctx, id) => fiche(ctx, HS.contaminations, id, "Contamination", QUALITY_READ),
      complaint: (ctx, id) => fiche(ctx, HS.complaints, id, "Réclamation", QUALITY_READ),
    });
  }

  /* ─── Déversements ────────────────────────────────────────────────────── */

  const SUIVIS_DEVERSEMENT = ["occurred_at", "site_id", "location", "event_id", "rotation_id", "vehicle_id", "product_id", "product_label", "volume_liters", "recovered_liters", "recovery", "cost", "status"];
  const TRIS_DEVERSEMENT = { occurred_at: (s) => s.occurred_at, reference: (s) => s.reference, volume_liters: (s) => s.volume_liters, status: (s) => s.status };
  const tauxRecupere = (s) => (s.volume_liters ? arrondi((s.recovered_liters * 100) / s.volume_liters, 1) : 0);
  const transitionsDeversement = (ctx, s) => (hsIs(ctx, "hsseq") ? (s.status === "open" ? ["close"] : ["reopen"]) : []);
  function ligneDeversement(ctx, s) {
    const t = transitionsDeversement(ctx, s);
    return {
      id: s.id, reference: s.reference, occurred_at: s.occurred_at, site: hsSiteRef(s.site_id), location: s.location, event: evenementRef(s.event_id),
      rotation: rotationRef(s.rotation_id), vehicle: hsVehicleRef(s.vehicle_id), product: produitRef(s.product_id), product_label: s.product_label,
      volume_liters: s.volume_liters, recovered_liters: s.recovered_liters, recovery_rate: tauxRecupere(s), cost: s.cost ?? 0, status: s.status,
      rights: { can_edit: s.status === "open" && ecrivain(ctx, s.site_id), can_close: t.includes("close"), can_approve: false },
    };
  }
  function ficheDeversement(ctx, s) {
    return {
      ...ligneDeversement(ctx, s), company: societeRef(s.company_id), recovery: s.recovery, reported_by: personne(ctx, s.reported_by),
      closed_at: s.closed_at, closed_by: personne(ctx, s.closed_by), reopen_reason: s.reopen_reason,
      attachments: pieces(ctx, "spill", s.id),
      // Comme le noyau : l'entrée la plus récente d'abord.
      history: journal(ctx, "spill", s.id),
      transitions: transitionsDeversement(ctx, s),
    };
  }
  /** Champs d'un déversement (spill_values), avec les refus du noyau. */
  function valeursDeversement(data, s = null) {
    const v = liens(data, {});
    if ("occurred_at" in data) {
      v.occurred_at = hsDateTime(data, "occurred_at");
      if (!v.occurred_at || Date.parse(v.occurred_at) > Date.parse(hsNow()) + 300000) throw hsBad("Date du déversement passée attendue.", ["occurred_at"]);
    }
    if ("volume_liters" in data) v.volume_liters = positif(data, "volume_liters");
    if ("recovered_liters" in data) v.recovered_liters = positif(data, "recovered_liters", true);
    const volume = v.volume_liters ?? s?.volume_liters ?? 0;
    if ((v.recovered_liters ?? s?.recovered_liters ?? 0) > volume) throw hsBad("Le volume récupéré ne dépasse pas le volume déversé.", ["recovered_liters"]);
    for (const [cle, max] of [["location", 300], ["product_label", 200], ["recovery", 4000]]) if (cle in data) v[cle] = hsText(data, cle, max);
    if ("cost" in data) v.cost = positif(data, "cost", true);
    return v;
  }
  function deversements(ctx, q) {
    const statuts = hsList(q.status);
    const vehicule = hsId(q, "vehicle_id");
    const evenement = hsId(q, "event_id");
    return communs(ctx, q, HS.spills, (s) => s.occurred_at).filter((s) => (!statuts || statuts.includes(s.status)) && (!vehicule || s.vehicle_id === vehicule) && (!evenement || s.event_id === evenement));
  }
  function nouveauDeversement(v, by, at = hsNow()) {
    const s = {
      id: ++HS.seq.spill, reference: "", company_id: 1, occurred_at: at, site_id: null, location: null, event_id: null, rotation_id: null, vehicle_id: null,
      product_id: null, product_label: null, volume_liters: 0, recovered_liters: 0, recovery: null, cost: 0, status: "open", reported_by: by,
      closed_at: null, closed_by: null, reopen_reason: null, ...v,
    };
    // L'événement lié donne sa rotation, son ensemble, son site et sa date, s'ils ne sont pas saisis.
    const e = s.event_id ? HS.events.find((x) => x.id === s.event_id) : null;
    if (e) {
      if (!("rotation_id" in v)) s.rotation_id = e.rotation_id ?? null;
      if (!("vehicle_id" in v)) s.vehicle_id = e.vehicle_id ?? null;
      if (!("site_id" in v)) s.site_id = e.site_id ?? null;
    }
    rattacher(s);
    domaineEvenement(s, "environment");
    s.reference = `DEV/${annee()}/${quatre(s.id)}`;
    HS.spills.push(s);
    hsLog("spill", s.id, by, "create", null, null, null, at);
    return s;
  }

  route("GET", "/hsseq/spills", ENV_READ, (ctx) => {
    const choisis = hsSort(deversements(ctx, ctx.query), ctx.query.sort, TRIS_DEVERSEMENT, "-occurred_at");
    const counts = {
      by_status: Object.fromEntries(Object.keys(STATUTS_DEVERSEMENT).map((k) => [k, choisis.filter((s) => s.status === k).length])),
      volume_liters: arrondi(choisis.reduce((t, s) => t + s.volume_liters, 0), 1),
      recovered_liters: arrondi(choisis.reduce((t, s) => t + s.recovered_liters, 0), 1),
    };
    return page(ctx, choisis, counts, ligneDeversement);
  });
  route("GET", "/hsseq/spills/:id", ENV_READ, (ctx) => ficheDeversement(ctx, fiche(ctx, HS.spills, ctx.params[0], "Déversement", ENV_READ)));
  route("POST", "/hsseq/spills", ENV_FIELD, (ctx) => {
    const data = ctx.body;
    exiger(data, "occurred_at", "volume_liters");
    const site = siteDeSaisie(ctx, data);
    const v = valeursDeversement(data);
    const s = nouveauDeversement({ ...v, site_id: site?.id ?? null, company_id: site?.company_id ?? 1 }, ctx.user.id);
    return ficheDeversement(ctx, s);
  });
  route("PATCH", "/hsseq/spills/:id", ENV_FIELD, (ctx) => {
    const s = fiche(ctx, HS.spills, ctx.params[0], "Déversement", ENV_READ);
    if (!ligneDeversement(ctx, s).rights.can_edit) throw hsForbidden("Déversement clos, ou hors de vos sites.");
    const data = ctx.body;
    const v = valeursDeversement(data, s);
    if ("site_id" in data) v.site_id = siteDeSaisie(ctx, data, s)?.id ?? null;
    const avant = s.event_id;
    ecrire("spill", ctx.user.id, s, v, SUIVIS_DEVERSEMENT);
    try {
      domaineEvenement(s, "environment");
    } catch (e) {
      s.event_id = avant;
      throw e;
    }
    return ficheDeversement(ctx, s);
  });
  route("POST", "/hsseq/spills/:id/:action", ["hsseq"], (ctx) => {
    const t = ctx.params[1];
    if (!["close", "reopen"].includes(t)) throw introuvable("Transition");
    const s = fiche(ctx, HS.spills, ctx.params[0], "Déversement", ENV_READ);
    const data = ctx.body;
    exigerTransition(s, t, transitionsDeversement(ctx, s), STATUTS_DEVERSEMENT);
    if ("recovery" in data) ecrire("spill", ctx.user.id, s, { recovery: hsText(data, "recovery", 4000) }, SUIVIS_DEVERSEMENT);
    if (t === "close") {
      if (!String(s.recovery ?? "").trim()) throw hsRule("recovery_required", "Décrivez la récupération et le confinement avant de clore le déversement.", { fields: ["recovery"] });
      Object.assign(s, { status: "closed", closed_at: hsNow(), closed_by: ctx.user.id });
      hsLog("spill", s.id, ctx.user.id, "close");
    } else {
      const raison = motif(data);
      Object.assign(s, { status: "open", closed_at: null, closed_by: null, reopen_reason: raison });
      hsLog("spill", s.id, ctx.user.id, "reopen", null, null, null, hsNow(), raison);
    }
    return ficheDeversement(ctx, s);
  });

  /* ─── Déchets ─────────────────────────────────────────────────────────── */

  const SUIVIS_DECHET = ["site_id", "waste_kind", "description", "quantity", "unit", "produced_on", "status", "pickup_date", "provider_id", "provider_name", "manifest_reference"];
  const TRIS_DECHET = { produced_on: (w) => w.produced_on, reference: (w) => w.reference, pickup_date: (w) => w.pickup_date ?? "", status: (w) => w.status };
  const bordereauJoint = (w) => HS.attachments.some((a) => a.model === "waste" && a.object_id === w.id);
  function transitionsDechet(ctx, w) {
    if (w.status === "stored") return ecrivain(ctx, w.site_id) ? ["collect"] : [];
    return hsIs(ctx, "hsseq") ? ["reopen"] : [];
  }
  function ligneDechet(ctx, w) {
    const t = transitionsDechet(ctx, w);
    return {
      id: w.id, reference: w.reference, site: hsSiteRef(w.site_id), waste_kind: w.waste_kind, description: w.description, quantity: w.quantity, unit: w.unit,
      produced_on: w.produced_on, status: w.status, pickup_date: w.pickup_date, provider: w.provider_name ? { id: null, name: w.provider_name } : null,
      manifest_reference: w.manifest_reference, manifest_attached: bordereauJoint(w),
      rights: { can_edit: w.status === "stored" && ecrivain(ctx, w.site_id), can_close: t.includes("collect"), can_approve: false },
    };
  }
  function ficheDechet(ctx, w) {
    return {
      ...ligneDechet(ctx, w), company: societeRef(w.company_id), note: w.note, collected_by: personne(ctx, w.collected_by), reopen_reason: w.reopen_reason,
      attachments: pieces(ctx, "waste", w.id), history: journal(ctx, "waste", w.id), transitions: transitionsDechet(ctx, w),
    };
  }
  /** Champs d'un déchet (waste_values) ; `partiel` pour une modification. */
  function valeursDechet(data, partiel = false) {
    const v = {};
    if (!partiel || "waste_kind" in data) v.waste_kind = choix(data, "waste_kind", NATURES_DECHET, "Nature : used_oil, tyres, filters ou other.");
    if (rempli(data.unit)) v.unit = choix(data, "unit", UNITES_DECHET, "Unité : l, kg, t ou unit.");
    if (!partiel || "quantity" in data) v.quantity = positif(data, "quantity");
    if ("produced_on" in data) {
      v.produced_on = jour(data, "produced_on") ?? TODAY;
      if (v.produced_on > TODAY) throw hsBad("Date d'entreposage passée ou du jour.", ["produced_on"]);
    }
    for (const [cle, max] of [["description", 200], ["note", 2000], ["provider_name", 200], ["manifest_reference", 64]]) if (cle in data) v[cle] = hsText(data, cle, max);
    if (v.waste_kind === "other" && !v.description && !partiel) throw hsMissing("Précisez la nature d'un autre déchet.", ["description"]);
    return v;
  }
  function dechets(ctx, q) {
    const statuts = hsList(q.status);
    const natures = hsList(q.waste_kind);
    return communs(ctx, q, HS.wastes, (w) => w.produced_on).filter((w) => (!statuts || statuts.includes(w.status)) && (!natures || natures.includes(w.waste_kind)));
  }
  function nouveauDechet(v, at = hsNow(), by = 16) {
    const w = {
      id: ++HS.seq.waste, reference: "", company_id: 1, site_id: null, waste_kind: "other", description: null, quantity: 0, unit: null, produced_on: TODAY,
      status: "stored", pickup_date: null, provider_id: null, provider_name: null, manifest_reference: null, collected_by: null, note: null, reopen_reason: null, ...v,
    };
    w.unit = w.unit ?? UNITE_PAR_DEFAUT[w.waste_kind];
    w.reference = `DEC/${annee()}/${quatre(w.id)}`;
    HS.wastes.push(w);
    hsLog("waste", w.id, by, "create", null, null, null, at);
    return w;
  }

  route("GET", "/hsseq/wastes", ENV_READ, (ctx) => {
    const choisis = hsSort(dechets(ctx, ctx.query), ctx.query.sort, TRIS_DECHET, "-produced_on");
    const quantites = new Map();
    for (const w of choisis.filter((x) => x.status === "stored")) {
      const cle = `${w.waste_kind}:${w.unit}`;
      quantites.set(cle, arrondi((quantites.get(cle) ?? 0) + w.quantity, 2));
    }
    const counts = {
      by_status: Object.fromEntries(Object.keys(STATUTS_DECHET).map((k) => [k, choisis.filter((w) => w.status === k).length])),
      stored_quantities: [...quantites.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cle, quantity]) => ({ waste_kind: cle.split(":")[0], unit: cle.split(":")[1], quantity })),
    };
    return page(ctx, choisis, counts, ligneDechet);
  });
  route("GET", "/hsseq/wastes/:id", ENV_READ, (ctx) => ficheDechet(ctx, fiche(ctx, HS.wastes, ctx.params[0], "Déchet", ENV_READ)));
  route("POST", "/hsseq/wastes", ENV_FIELD, (ctx) => {
    const data = ctx.body;
    exiger(data, "waste_kind", "quantity");
    const site = siteDeSaisie(ctx, data);
    const v = valeursDechet(data);
    return ficheDechet(ctx, nouveauDechet({ ...v, site_id: site?.id ?? null, company_id: site?.company_id ?? 1 }, hsNow(), ctx.user.id));
  });
  route("PATCH", "/hsseq/wastes/:id", ENV_FIELD, (ctx) => {
    const w = fiche(ctx, HS.wastes, ctx.params[0], "Déchet", ENV_READ);
    if (!ligneDechet(ctx, w).rights.can_edit) throw hsForbidden("Déchet enlevé, ou hors de vos sites.");
    const data = ctx.body;
    const v = valeursDechet(data, true);
    if ("site_id" in data) v.site_id = siteDeSaisie(ctx, data, w)?.id ?? null;
    if ((v.waste_kind ?? w.waste_kind) === "other" && !("description" in v ? v.description : w.description)) throw hsMissing("Précisez la nature d'un autre déchet.", ["description"]);
    ecrire("waste", ctx.user.id, w, v, SUIVIS_DECHET);
    return ficheDechet(ctx, w);
  });
  route("POST", "/hsseq/wastes/:id/:action", ENV_FIELD, (ctx) => {
    const t = ctx.params[1];
    if (!["collect", "reopen"].includes(t)) throw introuvable("Transition");
    const w = fiche(ctx, HS.wastes, ctx.params[0], "Déchet", ENV_READ);
    const data = ctx.body;
    if (t === "reopen") {
      if (!hsIs(ctx, "hsseq")) throw hsForbidden("Réouverture réservée au Responsable HSSEQ.");
      exigerTransition(w, t, ["collected"].includes(w.status) ? ["reopen"] : [], STATUTS_DECHET);
      const raison = motif(data);
      Object.assign(w, { status: "stored", pickup_date: null, collected_by: null, reopen_reason: raison });
      hsLog("waste", w.id, ctx.user.id, "reopen", null, null, null, hsNow(), raison);
      return ficheDechet(ctx, w);
    }
    if (!ecrivain(ctx, w.site_id)) throw hsForbidden("Enlèvement des déchets de vos sites seulement.");
    exigerTransition(w, t, w.status === "stored" ? ["collect"] : [], STATUTS_DECHET);
    // Enlèvement (action_collect) : date entre l'entreposage et aujourd'hui, prestataire, numéro et pièce du bordereau.
    const jourEnleve = jour(data, "pickup_date") ?? TODAY;
    if (jourEnleve > TODAY || jourEnleve < w.produced_on) throw hsBad("Date d'enlèvement entre l'entreposage et aujourd'hui.", ["pickup_date"]);
    const bordereau = hsText(data, "manifest_reference", 64) ?? w.manifest_reference;
    const prestataire = hsText(data, "provider_name", 200) ?? w.provider_name;
    const manquants = [...(bordereau ? [] : ["manifest_reference"]), ...(prestataire || rempli(data.provider_id) ? [] : ["provider_id"])];
    if (manquants.length) throw hsMissing("Prestataire et numéro du bordereau sont obligatoires pour l'enlèvement.", manquants);
    if (!bordereauJoint(w)) throw hsRule("document_missing", "Joignez le bordereau d'enlèvement avant de l'enregistrer.", { fields: ["attachment_ids"] });
    ecrire("waste", ctx.user.id, w, { status: "collected", pickup_date: jourEnleve, manifest_reference: bordereau, provider_name: prestataire }, SUIVIS_DECHET);
    w.collected_by = ctx.user.id;
    hsLog("waste", w.id, ctx.user.id, "collect");
    return ficheDechet(ctx, w);
  });

  /* ─── Poussières ──────────────────────────────────────────────────────── */

  const SUIVIS_POUSSIERE = ["site_id", "measured_on", "point", "value", "unit", "threshold", "method"];
  const TRIS_POUSSIERE = { measured_on: (m) => m.measured_on, value: (m) => m.value };
  const ligneMesure = (ctx, m) => ({
    id: m.id, site: hsSiteRef(m.site_id), measured_on: m.measured_on, point: m.point, value: m.value, unit: m.unit, threshold: m.threshold,
    exceeded: m.exceeded, method: m.method, note: m.note, measured_by: personne(ctx, m.measured_by),
    rights: { can_edit: ecrivain(ctx, m.site_id), can_close: false, can_approve: false },
  });
  /** Champs d'une mesure (dust_values) ; `partiel` pour une modification. */
  function valeursMesure(data, partiel = false) {
    const v = {};
    if (!partiel || "measured_on" in data) {
      v.measured_on = jour(data, "measured_on") ?? TODAY;
      if (v.measured_on > TODAY) throw hsBad("Date de mesure passée ou du jour.", ["measured_on"]);
    }
    if (!partiel || "value" in data) v.value = positif(data, "value", true);
    if (!partiel || "threshold" in data) v.threshold = positif(data, "threshold");
    if (!partiel || "unit" in data) v.unit = rempli(data.unit) ? choix(data, "unit", UNITES_POUSSIERE, "Unité : mg_m3 ou ug_m3.") : "mg_m3";
    for (const [cle, max] of [["point", 200], ["method", 200], ["note", 2000]]) if (cle in data) v[cle] = hsText(data, cle, max);
    return v;
  }
  function nouvelleMesure(v, by) {
    const m = { id: ++HS.seq.dust, company_id: 1, site_id: null, measured_on: TODAY, point: null, value: 0, unit: "mg_m3", threshold: 1, method: null, note: null, measured_by: by, ...v };
    m.exceeded = m.value > m.threshold;
    HS.dustMeasurements.push(m);
    hsLog("dust", m.id, by, "create", null, null, null, `${m.measured_on}T10:00:00Z`);
    return m;
  }

  route("GET", "/hsseq/dust-measurements", ENV_READ, (ctx) => {
    const q = ctx.query;
    const choisis = hsSort(communs(ctx, q, HS.dustMeasurements, (m) => m.measured_on).filter((m) => !oui(q.exceeded) || m.exceeded), q.sort, TRIS_POUSSIERE, "-measured_on");
    return page(ctx, choisis, { exceeded: choisis.filter((m) => m.exceeded).length }, ligneMesure);
  });
  // Fiche d'une mesure (dust_row avec detail du noyau) : sa société et son historique.
  route("GET", "/hsseq/dust-measurements/:id", ENV_READ, (ctx) => {
    const m = fiche(ctx, HS.dustMeasurements, ctx.params[0], "Mesure", ENV_READ);
    return { ...ligneMesure(ctx, m), company: societeRef(m.company_id), history: journal(ctx, "dust", m.id) };
  });
  route("POST", "/hsseq/dust-measurements", ENV_FIELD, (ctx) => {
    const data = ctx.body;
    exiger(data, "site_id", "value", "threshold");
    const site = siteDeSaisie(ctx, data);
    const v = valeursMesure(data);
    return ligneMesure(ctx, nouvelleMesure({ ...v, site_id: site.id, company_id: site.company_id }, ctx.user.id));
  });
  route("PATCH", "/hsseq/dust-measurements/:id", ENV_FIELD, (ctx) => {
    const m = fiche(ctx, HS.dustMeasurements, ctx.params[0], "Mesure", ENV_READ);
    if (!ecrivain(ctx, m.site_id)) throw hsForbidden("Mesure d'un site hors de vos sites.");
    const data = ctx.body;
    const v = valeursMesure(data, true);
    if ("site_id" in data) {
      const site = siteDeSaisie(ctx, data, m);
      if (!site) throw hsMissing("Site de la mesure manquant.", ["site_id"]);
      v.site_id = site.id;
    }
    ecrire("dust", ctx.user.id, m, v, SUIVIS_POUSSIERE);
    m.exceeded = m.value > m.threshold;
    return ligneMesure(ctx, m);
  });

  /* ─── Contaminations ──────────────────────────────────────────────────── */

  const SUIVIS_CONTAMINATION = ["detected_on", "nature", "rotation_id", "vehicle_id", "site_id", "product_id", "volume_m3", "description", "measures", "cost", "event_id", "status"];
  const TRIS_CONTAMINATION = { detected_on: (c) => c.detected_on, reference: (c) => c.reference, status: (c) => c.status };
  const transitionsContamination = (ctx, c) => (hsIs(ctx, "hsseq") ? (c.status === "open" ? ["close"] : ["reopen"]) : []);
  function ligneContamination(ctx, c) {
    const t = transitionsContamination(ctx, c);
    return {
      id: c.id, reference: c.reference, detected_on: c.detected_on, nature: c.nature, rotation: rotationRef(c.rotation_id), vehicle: hsVehicleRef(c.vehicle_id),
      site: hsSiteRef(c.site_id), product: produitRef(c.product_id), volume_m3: c.volume_m3 || null, description: c.description, status: c.status,
      rights: { can_edit: hsIs(ctx, "hsseq") && c.status === "open", can_close: t.includes("close"), can_approve: false },
    };
  }
  function ficheContamination(ctx, c) {
    return {
      ...ligneContamination(ctx, c), company: societeRef(c.company_id), measures: c.measures, cost: c.cost ?? 0, event: evenementRef(c.event_id),
      closed_at: c.closed_at, reopen_reason: c.reopen_reason, attachments: pieces(ctx, "contamination", c.id),
      history: journal(ctx, "contamination", c.id), transitions: transitionsContamination(ctx, c),
    };
  }
  /** Champs d'une contamination (contamination_values) ; `partiel` pour une modification. */
  function valeursContamination(data, partiel = false) {
    const v = liens(data, {});
    if (!partiel || "nature" in data) v.nature = choix(data, "nature", NATURES_CONTAMINATION, "Nature de contamination inconnue.");
    if (!partiel || "description" in data) {
      v.description = hsText(data, "description", 4000);
      if (!v.description) throw hsMissing("Décrivez la contamination.", ["description"]);
    }
    if ("detected_on" in data) {
      v.detected_on = jour(data, "detected_on") ?? TODAY;
      if (v.detected_on > TODAY) throw hsBad("Une contamination se constate à une date passée ou du jour.", ["detected_on"]);
    }
    if ("site_id" in data) v.site_id = siteDe(data)?.id ?? null;
    if ("volume_m3" in data) v.volume_m3 = positif(data, "volume_m3", true);
    if ("cost" in data) v.cost = positif(data, "cost", true);
    if ("measures" in data) v.measures = hsText(data, "measures", 4000);
    return v;
  }
  function nouvelleContamination(v, by, at = hsNow()) {
    const c = {
      id: ++HS.seq.contamination, reference: "", company_id: 1, detected_on: TODAY, nature: "other", rotation_id: null, vehicle_id: null, site_id: null, product_id: null,
      volume_m3: 0, description: "", measures: null, cost: 0, event_id: null, status: "open", closed_at: null, closed_by: null, reopen_reason: null, ...v,
    };
    rattacher(c);
    // Le produit de la rotation, s'il n'est pas saisi.
    if (c.rotation_id && !c.product_id) c.product_id = PRODUITS[hsRotation(c.rotation_id)?.product]?.[0] ?? null;
    domaineEvenement(c, "quality");
    c.reference = `CTM/${annee()}/${quatre(c.id)}`;
    HS.contaminations.push(c);
    hsLog("contamination", c.id, by, "create", null, null, null, at);
    return c;
  }

  route("GET", "/hsseq/contaminations", QUALITY_READ, (ctx) => {
    const q = ctx.query;
    const statuts = hsList(q.status);
    const natures = hsList(q.nature);
    const rotation = hsId(q, "rotation_id");
    const vehicule = hsId(q, "vehicle_id");
    const choisis = hsSort(
      communs(ctx, q, HS.contaminations, (c) => c.detected_on).filter((c) => (!statuts || statuts.includes(c.status)) && (!natures || natures.includes(c.nature)) && (!rotation || c.rotation_id === rotation) && (!vehicule || c.vehicle_id === vehicule)),
      q.sort, TRIS_CONTAMINATION, "-detected_on",
    );
    return page(ctx, choisis, { by_status: Object.fromEntries(Object.keys(STATUTS_CONTAMINATION).map((k) => [k, choisis.filter((c) => c.status === k).length])) }, ligneContamination);
  });
  route("GET", "/hsseq/contaminations/:id", QUALITY_READ, (ctx) => ficheContamination(ctx, fiche(ctx, HS.contaminations, ctx.params[0], "Contamination", QUALITY_READ)));
  route("POST", "/hsseq/contaminations", ["hsseq"], (ctx) => {
    const data = ctx.body;
    exiger(data, "nature", "description");
    return ficheContamination(ctx, nouvelleContamination({ ...valeursContamination(data), company_id: 1 }, ctx.user.id));
  });
  route("PATCH", "/hsseq/contaminations/:id", ["hsseq"], (ctx) => {
    const c = fiche(ctx, HS.contaminations, ctx.params[0], "Contamination", QUALITY_READ);
    if (c.status !== "open") throw hsRule("invalid_transition", "Contamination close : rouvrez-la avant de la modifier.");
    const v = valeursContamination(ctx.body, true);
    const avant = c.event_id;
    ecrire("contamination", ctx.user.id, c, v, SUIVIS_CONTAMINATION);
    try {
      domaineEvenement(c, "quality");
    } catch (e) {
      c.event_id = avant;
      throw e;
    }
    return ficheContamination(ctx, c);
  });
  route("POST", "/hsseq/contaminations/:id/:action", ["hsseq"], (ctx) => {
    const t = ctx.params[1];
    if (!["close", "reopen"].includes(t)) throw introuvable("Transition");
    const c = fiche(ctx, HS.contaminations, ctx.params[0], "Contamination", QUALITY_READ);
    const data = ctx.body;
    exigerTransition(c, t, transitionsContamination(ctx, c), STATUTS_CONTAMINATION);
    if ("measures" in data) ecrire("contamination", ctx.user.id, c, { measures: hsText(data, "measures", 4000) }, SUIVIS_CONTAMINATION);
    if (t === "close") {
      if (!String(c.measures ?? "").trim()) throw hsRule("measures_required", "Décrivez les mesures prises avant de clore la contamination.", { fields: ["measures"] });
      Object.assign(c, { status: "closed", closed_at: hsNow(), closed_by: ctx.user.id });
      hsLog("contamination", c.id, ctx.user.id, "close");
    } else {
      const raison = motif(data);
      Object.assign(c, { status: "open", closed_at: null, closed_by: null, reopen_reason: raison });
      hsLog("contamination", c.id, ctx.user.id, "reopen", null, null, null, hsNow(), raison);
    }
    return ficheContamination(ctx, c);
  });

  /* ─── Réclamations clients ────────────────────────────────────────────── */

  const SUIVIS_RECLAMATION = ["partner_id", "rotation_id", "site_id", "received_on", "nature", "severity", "description", "response", "responded_on", "response_due", "status"];
  const TRIS_RECLAMATION = { received_on: (c) => c.received_on, reference: (c) => c.reference, response_due: (c) => c.response_due ?? "", status: (c) => c.status };
  const delaiReponse = (c) => hsSettings(c.company_id ?? 1).complaint_response_days ?? DELAI_REPONSE;
  const actionsReclamation = (c) => HS.actions.filter((a) => a.origin === "complaint" && (a.complaint_id ?? a.origin_id) === c.id).sort((a, b) => a.id - b.id);
  const actionsOuvertes = (c) => actionsReclamation(c).filter((a) => ACTION_OUVERTE.includes(a.status));
  const enRetard = (c) => c.status === "received" && Boolean(c.response_due) && c.response_due < TODAY;
  const joursReponse = (c) => (c.responded_on ? Math.round((Date.parse(`${c.responded_on}T00:00:00Z`) - Date.parse(`${c.received_on}T00:00:00Z`)) / 86400000) : null);
  function transitionsReclamation(ctx, c) {
    if (!hsIs(ctx, "hsseq")) return [];
    const t = { received: ["answer"], answered: ["answer", "close"], closed: ["reopen"] }[c.status];
    return actionsOuvertes(c).length ? t.filter((x) => x !== "close") : t;
  }
  function ligneReclamation(ctx, c) {
    const t = transitionsReclamation(ctx, c);
    return {
      id: c.id, reference: c.reference, partner: clientRef(c.partner_id), rotation: rotationRef(c.rotation_id), site: hsSiteRef(c.site_id), received_on: c.received_on,
      nature: c.nature, severity: c.severity, description: c.description, response_due: c.response_due, responded_on: c.responded_on, response_days: joursReponse(c),
      on_time: c.responded_on ? Boolean(c.response_due && c.responded_on <= c.response_due) : null, overdue: enRetard(c), status: c.status,
      open_actions: actionsOuvertes(c).length,
      rights: { can_edit: hsIs(ctx, "hsseq") && c.status !== "closed", can_close: t.includes("close"), can_approve: false },
    };
  }
  function ficheReclamation(ctx, c) {
    return {
      ...ligneReclamation(ctx, c), company: societeRef(c.company_id), response: c.response, responded_by: personne(ctx, c.responded_by),
      vehicle: hsVehicleRef(c.vehicle_id), actions: actionsReclamation(c).map(hsActionLine), closed_at: c.closed_at, reopen_reason: c.reopen_reason,
      attachments: pieces(ctx, "complaint", c.id), history: journal(ctx, "complaint", c.id), transitions: transitionsReclamation(ctx, c),
    };
  }
  /** Champs d'une réclamation (complaint_values) ; `partiel` pour une modification. */
  function valeursReclamation(data, partiel = false) {
    const v = liens(data, {});
    delete v.product_id;
    delete v.event_id;
    if (!partiel || "nature" in data) v.nature = choix(data, "nature", NATURES_RECLAMATION, "Nature de réclamation inconnue.");
    if (!partiel || "severity" in data) v.severity = rempli(data.severity) ? choix(data, "severity", GRAVITES, "Gravité : minor, major ou critical.") : "minor";
    if (!partiel || "description" in data) {
      v.description = hsText(data, "description", 4000);
      if (!v.description) throw hsMissing("Décrivez la réclamation.", ["description"]);
    }
    if ("received_on" in data) {
      v.received_on = jour(data, "received_on") ?? TODAY;
      if (v.received_on > TODAY) throw hsBad("Date de réception passée ou du jour.", ["received_on"]);
    }
    if ("response_due" in data && partiel) v.response_due = jour(data, "response_due");
    if ("partner_id" in data) {
      const id = hsId(data, "partner_id");
      if (!id || !CLIENTS[id]) throw hsMissing("Client de la réclamation manquant.", ["partner_id"]);
      v.partner_id = id;
    }
    if ("site_id" in data) v.site_id = siteDe(data)?.id ?? null;
    return v;
  }
  /** Une rotation citée est celle du client de la réclamation (_check_rotation_partner). */
  function clientDeLaRotation(c) {
    const r = c.rotation_id ? hsRotation(c.rotation_id) : null;
    if (r && r.partner_id && r.partner_id !== c.partner_id) throw hsRule("rotation_partner_mismatch", `La rotation ${r.name ?? r.id} est celle d'un autre client.`, { fields: ["rotation_id"] });
  }
  function nouvelleReclamation(v, by, at = hsNow()) {
    const c = {
      id: ++HS.seq.complaint, reference: "", company_id: 1, partner_id: null, rotation_id: null, vehicle_id: null, site_id: null, received_on: TODAY, nature: "other",
      severity: "minor", description: "", response_due: null, response: null, responded_on: null, responded_by: null, status: "received", closed_at: null, closed_by: null,
      reopen_reason: null, ...v,
    };
    if (c.rotation_id && !c.partner_id) c.partner_id = hsRotation(c.rotation_id)?.partner_id ?? null;
    rattacher(c);
    clientDeLaRotation(c);
    c.response_due = c.response_due ?? ajouterJours(c.received_on, delaiReponse(c));
    c.reference = `REC/${annee()}/${quatre(c.id)}`;
    HS.complaints.push(c);
    hsLog("complaint", c.id, by, "create", null, null, null, at);
    return c;
  }
  /** Réponse au client (action_answer) : texte obligatoire, datée entre la réception et aujourd'hui. */
  function repondre(c, by, reponse, jourReponse, at = hsNow()) {
    Object.assign(c, { status: "answered", response: reponse, responded_on: jourReponse, responded_by: by });
    hsLog("complaint", c.id, by, "answer", null, null, null, at);
  }

  route("GET", "/hsseq/complaints", QUALITY_READ, (ctx) => {
    const q = ctx.query;
    const statuts = hsList(q.status);
    const natures = hsList(q.nature);
    const gravites = hsList(q.severity);
    const client = hsId(q, "partner_id");
    const rotation = hsId(q, "rotation_id");
    const base = communs(ctx, q, HS.complaints, (c) => c.received_on).filter(
      (c) => (!statuts || statuts.includes(c.status)) && (!natures || natures.includes(c.nature)) && (!gravites || gravites.includes(c.severity)) && (!client || c.partner_id === client) && (!rotation || c.rotation_id === rotation) && (!oui(q.overdue) || enRetard(c)),
    );
    const choisis = hsSort(base, q.sort, TRIS_RECLAMATION, "-received_on");
    const counts = { by_status: Object.fromEntries(Object.keys(STATUTS_RECLAMATION).map((k) => [k, choisis.filter((c) => c.status === k).length])), overdue: choisis.filter(enRetard).length };
    return page(ctx, choisis, counts, ligneReclamation);
  });
  route("GET", "/hsseq/complaints/:id", QUALITY_READ, (ctx) => ficheReclamation(ctx, fiche(ctx, HS.complaints, ctx.params[0], "Réclamation", QUALITY_READ)));
  route("POST", "/hsseq/complaints", ["hsseq"], (ctx) => {
    const data = ctx.body;
    exiger(data, "nature", "description");
    if (!rempli(data.partner_id) && !rempli(data.rotation_id)) throw hsMissing("Client ou rotation de la réclamation manquant.", ["partner_id"]);
    return ficheReclamation(ctx, nouvelleReclamation({ ...valeursReclamation(data), company_id: 1 }, ctx.user.id));
  });
  route("PATCH", "/hsseq/complaints/:id", ["hsseq"], (ctx) => {
    const c = fiche(ctx, HS.complaints, ctx.params[0], "Réclamation", QUALITY_READ);
    if (c.status === "closed") throw hsRule("invalid_transition", "Réclamation close : rouvrez-la avant de la modifier.");
    const v = valeursReclamation(ctx.body, true);
    const avant = { partner_id: c.partner_id, rotation_id: c.rotation_id };
    // Une nouvelle date de réception recalcule l'échéance de réponse (champ calculé du noyau), sauf échéance saisie.
    if (v.received_on && !("response_due" in v)) v.response_due = ajouterJours(v.received_on, delaiReponse(c));
    ecrire("complaint", ctx.user.id, c, v, SUIVIS_RECLAMATION);
    try {
      clientDeLaRotation(c);
    } catch (e) {
      Object.assign(c, avant);
      throw e;
    }
    return ficheReclamation(ctx, c);
  });
  route("POST", "/hsseq/complaints/:id/:action", ["hsseq"], (ctx) => {
    const t = ctx.params[1];
    if (!["answer", "close", "reopen"].includes(t)) throw introuvable("Transition");
    const c = fiche(ctx, HS.complaints, ctx.params[0], "Réclamation", QUALITY_READ);
    const data = ctx.body;
    const permises = { received: ["answer"], answered: ["answer", "close"], closed: ["reopen"] }[c.status];
    exigerTransition(c, t, permises, STATUTS_RECLAMATION);
    if (t === "answer") {
      const reponse = hsText(data, "response", 4000);
      if (!reponse) throw hsMissing("La réponse au client est à rédiger.", ["response"]);
      const le = jour(data, "responded_on") ?? TODAY;
      if (le > TODAY || le < c.received_on) throw hsBad("Date de réponse entre la réception et aujourd'hui.", ["responded_on"]);
      repondre(c, ctx.user.id, reponse, le);
    } else if (t === "close") {
      const ouvertes = actionsOuvertes(c);
      if (ouvertes.length) throw hsRule("actions_open", `${ouvertes.length} action(s) ni close(s) ni annulée(s) : ${ouvertes.map((a) => a.reference).join(", ")}.`);
      Object.assign(c, { status: "closed", closed_at: hsNow(), closed_by: ctx.user.id });
      hsLog("complaint", c.id, ctx.user.id, "close");
    } else {
      const raison = motif(data);
      Object.assign(c, { status: "answered", closed_at: null, closed_by: null, reopen_reason: raison });
      hsLog("complaint", c.id, ctx.user.id, "reopen", null, null, null, hsNow(), raison);
    }
    return ficheReclamation(ctx, c);
  });

  /* ─── Analyses depuis Transport ───────────────────────────────────────── */

  /** Période, regroupement, sites et profil d'une analyse (analysis_args) ; le mois en cours par défaut. */
  function argumentsAnalyse(ctx, q) {
    const du = jour(q, "date_from") ?? `${TODAY.slice(0, 7)}-01`;
    const au = jour(q, "date_to") ?? TODAY;
    if (au < du) throw hsBad("La période se termine après son début.", ["date_to"]);
    const regroupement = q.group_by || "vehicle";
    if (!REGROUPEMENTS.includes(regroupement)) throw hsBad("Regroupement : vehicle, site, month ou rotation.", ["group_by"]);
    const profil = q.vehicle_kind || null;
    if (profil && !["tanker", "tipper"].includes(profil)) throw hsBad("Type de véhicule : tanker ou tipper.", ["vehicle_kind"]);
    let sites = hsFull(ctx) ? null : hsSites(ctx);
    const site = hsId(q, "site_id");
    if (site) {
      if (!hsSite(site)) throw introuvable("Site");
      if (sites && !sites.includes(site)) throw hsForbidden("Site non autorisé.");
      sites = [site];
    }
    return { du, au, regroupement, profil, sites, ids: societes(ctx, q) };
  }
  /**
   * Rotations parties chargées dans la période, au format commun : citernes de Transport (aller et retour
   * de la route, carburant d'après son coût, saisi pour la plupart) et postes des bennes de la mine.
   */
  function rotationsParties(a) {
    const liste = [];
    if (a.ids.includes(1)) {
      for (const r of DB.rotations) {
        if (r.company_id !== 1 || !PARTIES.includes(r.state) || r.date_loading < a.du || r.date_loading > a.au) continue;
        const v = hsVehicle(r.vehicle_id);
        if (!v) continue;
        const km = 2 * (DB.routes.find((x) => x.id === r.route_id)?.distance_km ?? 0);
        // Carburant d'après le coût saisi (prix du litre de la période) ; une rotation sur seize sans carburant saisi.
        const carburant = r.id % 16 === 3 ? 0 : arrondi((r.fuel_cost ?? 0) / (r.date_loading >= "2026-06-01" ? 12500 : 12000), 1);
        // Volumes ramenés à 15 °C : chargés au dépôt entre 27 et 31 °C, livrés entre 2 °C de moins et 2 °C de
        // plus (dilatation du gazole, 0,00084 par degré) ; manquant à 15 °C nul tant que rien n'est livré.
        const tCharge = 27 + part(r.id, 3) * 4;
        const tLivre = tCharge - 2 + part(r.id, 4) * 4;
        const charge15 = arrondi((r.volume_loaded ?? 0) * (1 - 0.00084 * (tCharge - 15)), 3);
        const livre15 = arrondi((r.volume_delivered ?? 0) * (1 - 0.00084 * (tLivre - 15)), 3);
        const manquant15 = r.volume_delivered ? Math.max(0, charge15 - livre15) : 0;
        liste.push({ r, v, kind: hsKind(v), site: hsVehicleSite(v), km, carburant, charge: r.volume_loaded ?? 0, livre: r.volume_delivered ?? 0, charge15, livre15, manquant: manquant15 });
      }
      for (const r of HS.rotations) {
        if (!PARTIES.includes(r.state) || r.date_loading < a.du || r.date_loading > a.au) continue;
        const v = hsVehicle(r.vehicle_id);
        if (!v) continue;
        // Trois tours de la fosse 3 au port de Dapilon, 24 km l'aller, et une consommation de 52 à 62 L aux 100 km.
        const km = arrondi(144 + part(r.id, 1) * 18, 1);
        liste.push({ r, v, kind: hsKind(v), site: hsVehicleSite(v), km, carburant: arrondi((km * (52 + part(r.id, 2) * 10)) / 100, 1), charge: r.tonnage_loaded ?? 0, livre: r.tonnage_delivered ?? 0, manquant: 0 });
      }
    }
    return liste
      .filter((x) => (!a.sites || a.sites.includes(x.site)) && (!a.profil || x.kind === a.profil))
      .sort((x, y) => x.r.date_loading.localeCompare(y.r.date_loading) || x.r.id - y.r.id);
  }
  /** Clé et libellé d'un regroupement (_key du noyau). */
  function cleDe(x, regroupement) {
    if (regroupement === "site") return [x.site ?? 0, hsSite(x.site)?.name ?? "Sans site"];
    if (regroupement === "month") return [x.r.date_loading.slice(0, 7), moisLong(x.r.date_loading)];
    if (regroupement === "rotation") return [x.r.id, x.r.name ?? `Rotation ${x.r.id}`];
    return [x.v.id, x.v.name];
  }
  const facteur = (societe) => hsSettings(societe).co2_factor ?? CO2_PAR_LITRE;
  const ligneConso = () => ({ rotations: 0, km: 0, fuel_liters: 0, fuel_km: 0, co2_kg: 0 });
  const finConso = (l) => ({
    rotations: l.rotations, km: arrondi(l.km, 1), fuel_liters: arrondi(l.fuel_liters, 1), fuel_km: arrondi(l.fuel_km, 1), co2_kg: arrondi(l.co2_kg, 1),
    l_100km: l.fuel_km ? arrondi((l.fuel_liters * 100) / l.fuel_km, 1) : null, co2_kg_per_km: l.fuel_km ? arrondi(l.co2_kg / l.fuel_km, 2) : null,
  });
  function consommation(ctx, a) {
    const groupes = new Map();
    const total = ligneConso();
    for (const x of rotationsParties(a)) {
      const [cle, libelle] = cleDe(x, a.regroupement);
      if (!groupes.has(cle)) groupes.set(cle, { libelle, l: ligneConso() });
      for (const l of [groupes.get(cle).l, total]) {
        l.rotations += 1;
        l.km += x.km;
        if (x.carburant) {
          l.fuel_liters += x.carburant;
          l.fuel_km += x.km;
          l.co2_kg += x.carburant * facteur(x.r.company_id ?? 1);
        }
      }
    }
    return {
      group_by: a.regroupement, items: [...groupes.entries()].map(([key, g]) => ({ ...finConso(g.l), key, label: g.libelle })), totals: finConso(total),
      factors: a.ids.map((id) => ({ company_id: id, company: COMPANIES[id]?.name ?? "", co2_factor: facteur(id) })),
    };
  }
  const lignesLivraison = () => [{ rotations: 0, loaded_15: 0, delivered_15: 0, delivered: 0, shortage: 0 }, { rotations: 0, loaded_t: 0, delivered_t: 0, variance_t: 0 }];
  const arrondis = (l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, Number.isInteger(v) ? v : arrondi(v, 3)]));
  /** Citerne : manquant à 15 °C ÷ livré à 15 °C (_finish_tanker du noyau). */
  const finCiterne = (l) => ({ ...arrondis(l), per_mille: l.delivered_15 ? arrondi((l.shortage * 1000) / l.delivered_15, 2) : null });
  const finBenne = (l) => ({ ...arrondis(l), per_mille: l.loaded_t ? arrondi((l.variance_t * 1000) / l.loaded_t, 2) : null });
  function livraisons(ctx, a) {
    const citernes = new Map();
    const bennes = new Map();
    const [totalCiterne, totalBenne] = lignesLivraison();
    for (const x of rotationsParties(a)) {
      if (!x.livre) continue;
      const [cle, libelle] = cleDe(x, a.regroupement);
      if (x.kind === "tipper") {
        if (!bennes.has(cle)) bennes.set(cle, { libelle, l: lignesLivraison()[1] });
        for (const l of [bennes.get(cle).l, totalBenne]) {
          l.rotations += 1;
          l.loaded_t += x.charge;
          l.delivered_t += x.livre;
          l.variance_t += Math.abs(x.charge - x.livre);
        }
      } else {
        if (!citernes.has(cle)) citernes.set(cle, { libelle, l: lignesLivraison()[0] });
        for (const l of [citernes.get(cle).l, totalCiterne]) {
          l.rotations += 1;
          l.loaded_15 += x.charge15;
          l.delivered_15 += x.livre15;
          l.delivered += x.livre;
          l.shortage += x.manquant;
        }
      }
    }
    return {
      group_by: a.regroupement,
      tanker: { items: [...citernes.entries()].map(([key, g]) => ({ ...finCiterne(g.l), key, label: g.libelle })), totals: finCiterne(totalCiterne) },
      tipper: { items: [...bennes.entries()].map(([key, g]) => ({ ...finBenne(g.l), key, label: g.libelle })), totals: finBenne(totalBenne) },
    };
  }

  route("GET", "/hsseq/environment/consumption", ENV_READ, (ctx) => {
    const a = argumentsAnalyse(ctx, ctx.query);
    return { ...consommation(ctx, a), date_from: a.du, date_to: a.au, vehicle_kind: a.profil, source: "Transport : rotations parties (en route, validées, facturées), carburant saisi" };
  });
  route("GET", "/hsseq/environment/deliveries", ENV_READ, (ctx) => {
    const a = argumentsAnalyse(ctx, ctx.query);
    return { ...livraisons(ctx, a), date_from: a.du, date_to: a.au, vehicle_kind: a.profil, source: "Transport : rotations livrées ; benne : poids net du ticket de pesée et quantité livrée" };
  });

  /* ─── Registres en Excel ──────────────────────────────────────────────── */

  // Mêmes filtres que les listes du compte ; contaminations et réclamations pour leurs seuls lecteurs ;
  // consommation et écarts de livraison de la période, par ensemble.
  route("GET", "/hsseq/environment/export.xlsx", ENV_READ, (ctx) => {
    const q = ctx.query;
    const nom = (id) => hsSite(id)?.name ?? "";
    const date = (iso) => String(iso ?? "").slice(0, 10);
    const feuilles = [
      {
        name: "Déversements",
        rows: [
          ["Référence", "Survenu le", "Site", "Lieu", "Produit", "Volume (L)", "Récupéré (L)", "Récupération", "Coût", "Événement", "Statut"],
          ...deversements(ctx, q).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id - b.id).map((s) => [
            s.reference, date(s.occurred_at), nom(s.site_id), s.location ?? "", produitRef(s.product_id)?.name ?? s.product_label ?? "", s.volume_liters, s.recovered_liters,
            s.recovery ?? "", s.cost ?? 0, evenementRef(s.event_id)?.reference ?? "", STATUTS_DEVERSEMENT[s.status],
          ]),
        ],
      },
      {
        name: "Registre des déchets",
        rows: [
          ["Référence", "Site", "Nature", "Précision", "Quantité", "Unité", "Entreposé le", "Statut", "Enlevé le", "Prestataire", "Bordereau"],
          ...dechets(ctx, q).sort((a, b) => a.produced_on.localeCompare(b.produced_on) || a.id - b.id).map((w) => [
            w.reference, nom(w.site_id), NATURES_DECHET[w.waste_kind], w.description ?? "", w.quantity, UNITES_DECHET[w.unit], w.produced_on, STATUTS_DECHET[w.status],
            w.pickup_date ?? "", w.provider_name ?? "", w.manifest_reference ?? "",
          ]),
        ],
      },
      {
        name: "Poussières",
        rows: [
          ["Site", "Mesuré le", "Point", "Valeur", "Unité", "Seuil", "Dépassement", "Méthode"],
          ...communs(ctx, q, HS.dustMeasurements, (m) => m.measured_on).filter((m) => !oui(q.exceeded) || m.exceeded).sort((a, b) => a.measured_on.localeCompare(b.measured_on) || a.id - b.id)
            .map((m) => [nom(m.site_id), m.measured_on, m.point ?? "", m.value, UNITES_POUSSIERE[m.unit], m.threshold, m.exceeded ? "Oui" : "Non", m.method ?? ""]),
        ],
      },
    ];
    if (lectureQualite(ctx)) {
      feuilles.push(
        {
          name: "Contaminations",
          rows: [
            ["Référence", "Constatée le", "Nature", "Rotation", "Ensemble", "Produit", "Volume (m³)", "Constat", "Mesures", "Statut"],
            ...communs(ctx, q, HS.contaminations, (c) => c.detected_on).sort((a, b) => a.detected_on.localeCompare(b.detected_on) || a.id - b.id).map((c) => [
              c.reference, c.detected_on, NATURES_CONTAMINATION[c.nature], hsRotation(c.rotation_id)?.name ?? "", hsVehicle(c.vehicle_id)?.name ?? "", produitRef(c.product_id)?.name ?? "",
              c.volume_m3 ?? 0, c.description, c.measures ?? "", STATUTS_CONTAMINATION[c.status],
            ]),
          ],
        },
        {
          name: "Réclamations clients",
          rows: [
            ["Référence", "Reçue le", "Client", "Rotation", "Nature", "Gravité", "Réclamation", "Réponse attendue", "Répondue le", "Délai (jours)", "Dans le délai", "Statut"],
            ...communs(ctx, q, HS.complaints, (c) => c.received_on).sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id - b.id).map((c) => [
              c.reference, c.received_on, CLIENTS[c.partner_id] ?? "", hsRotation(c.rotation_id)?.name ?? "", NATURES_RECLAMATION[c.nature], GRAVITES[c.severity], c.description,
              c.response_due ?? "", c.responded_on ?? "", joursReponse(c) ?? "", c.responded_on ? (c.response_due && c.responded_on <= c.response_due ? "Oui" : "Non") : "", STATUTS_RECLAMATION[c.status],
            ]),
          ],
        },
      );
    }
    const a = argumentsAnalyse(ctx, { ...q, group_by: "vehicle" });
    const conso = consommation(ctx, a);
    const livr = livraisons(ctx, a);
    const periode = `Période du ${a.du.split("-").reverse().join("/")} au ${a.au.split("-").reverse().join("/")}`;
    feuilles.push(
      {
        name: "Consommation et émissions",
        rows: [[periode], ["Ensemble", "Rotations", "Km", "Carburant (L)", "L/100 km", "CO₂ (kg)", "kg CO₂/km"], ...conso.items.map((r) => [r.label, r.rotations, r.km, r.fuel_liters, r.l_100km ?? "", r.co2_kg, r.co2_kg_per_km ?? ""])],
      },
      {
        name: "Écarts de livraison",
        rows: [
          [periode],
          ["Profil", "Ensemble", "Rotations", "Chargé", "Livré", "Écart", "Écart (‰)"],
          ...livr.tanker.items.map((r) => ["Citerne (m³ à 15 °C)", r.label, r.rotations, r.loaded_15, r.delivered_15, r.shortage, r.per_mille ?? ""]),
          ...livr.tipper.items.map((r) => ["Benne (t)", r.label, r.rotations, r.loaded_t, r.delivered_t, r.variance_t, r.per_mille ?? ""]),
        ],
      },
    );
    return fileReply(xlsxBuffer(feuilles), XLSX, `environnement_qualite_hsseq_${TODAY.replaceAll("-", "")}.xlsx`);
  });

  /* ─── Données fictives ────────────────────────────────────────────────── */

  try {
    semer();
  } catch (e) {
    console.error("Maquette environnement et qualité : données fictives incomplètes.", e);
  }

  function semer() {
    const pdf = (titre) => Buffer.from(`%PDF-1.4\n% ${titre}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, "latin1");
    const vehicule = (nom) => hsVehicleByName(nom) ?? null;
    const evenement = (type, jourDe) => HS.events.find((e) => e.type === type && String(e.occurred_at).startsWith(jourDe)) ?? null;
    /** Dernière rotation de Transport d'un client chargée au plus tard ce jour-là (rotation d'une réclamation). */
    const rotationDuClient = (client, avant) =>
      DB.rotations.filter((r) => r.company_id === 1 && r.partner_id === client && r.state !== "cancelled" && r.date_loading <= avant).sort((a, b) => b.date_loading.localeCompare(a.date_loading) || b.id - a.id)[0] ?? null;
    const heure = (j, h, m = 0) => `${j}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;

    // Déversements : deux reliés aux événements « déversement » du lot 1, un sans site (siège).
    const er07 = vehicule("ER-07");
    const huile = evenement("spill", "2026-05-26");
    const d1 = nouveauDeversement({ occurred_at: heure("2026-05-26", 8), event_id: huile?.id ?? null, site_id: 1, vehicle_id: er07?.id ?? null, rotation_id: null, location: "Aire de lavage du parc de Matoto", product_label: "Huile moteur", volume_liters: 20, recovered_liters: 15, cost: 1_200_000,
      recovery: "Absorbants posés dans le caniveau et le séparateur ; terres et absorbants souillés ensachés et entreposés avec les déchets (DEC/2026/0003). Séparateur vidangé le 28/05." }, 12, heure("2026-05-26", 8, 40));
    Object.assign(d1, { status: "closed", closed_at: heure("2026-06-22", 11), closed_by: 16 });
    hsLog("spill", d1.id, 16, "close", null, null, null, d1.closed_at);
    hsPhoto("spill", d1.id, 12, heure("2026-05-26", 8, 45), "Caniveau de l'aire de lavage");

    const eb02 = vehicule("EB-02");
    const d2 = nouveauDeversement({ occurred_at: heure("2026-09-03", 14, 20), site_id: 2, vehicle_id: eb02?.id ?? null, location: "Atelier de la base de Boffa, fosse de vidange", product_label: "Huile hydraulique", volume_liters: 45, recovered_liters: 40, cost: 650_000,
      recovery: "Flexible du vérin de benne rompu : huile recueillie dans le bac de rétention, absorbant sur la dalle, flexible remplacé." }, 18, heure("2026-09-03", 14, 50));
    Object.assign(d2, { status: "closed", closed_at: heure("2026-09-05", 9), closed_by: 16 });
    hsLog("spill", d2.id, 16, "close", null, null, null, d2.closed_at);

    const essence = evenement("spill", "2026-08-22");
    const er10 = vehicule("ER-10");
    const rot10 = er10 ? hsRotationAt(er10.id, "2026-08-22") : null;
    nouveauDeversement({ occurred_at: heure("2026-08-22", 7, 15), event_id: essence?.id ?? null, site_id: 1, vehicle_id: er10?.id ?? null, rotation_id: rot10?.id ?? null, product_id: PRODUITS.essence[0], location: "Dépôt de Conakry, poste de chargement n° 2",
      volume_liters: 300, recovered_liters: 260, cost: 3_750_000, recovery: "Kit antidéversement déployé, 260 L repompés dans la fosse de rétention du dépôt ; dalle lavée à l'émulseur." }, 12, heure("2026-08-22", 8));

    const eb05 = vehicule("EB-05");
    const d4 = nouveauDeversement({ occurred_at: heure("2026-09-16", 10, 40), site_id: 2, vehicle_id: eb05?.id ?? null, location: "Piste de la fosse 3, virage n° 4", product_label: "Gazole (réservoir percé par une pierre)", volume_liters: 80, recovered_liters: 30 }, 18, heure("2026-09-16", 11, 20));
    hsPhoto("spill", d4.id, 18, heure("2026-09-16", 11, 25), "Réservoir percé de EB-05");

    const er04 = vehicule("ER-04");
    nouveauDeversement({ occurred_at: heure("2026-10-07", 6, 50), site_id: 1, vehicle_id: er04?.id ?? null, location: "Parc de Matoto, aire de stationnement", product_label: "Gazole", volume_liters: 12, recovered_liters: 12,
      recovery: "Fuite au raccord du filtre à gazole : absorbant, raccord resserré avant le départ." }, 12, heure("2026-10-07", 7, 10));
    nouveauDeversement({ occurred_at: heure("2026-10-13", 16, 30), location: "Siège de Kaloum, groupe électrogène", product_label: "Gazole", volume_liters: 25, recovered_liters: 20, cost: 300_000 }, 16, heure("2026-10-13", 17));
    const er02 = vehicule("ER-02");
    const rot02 = er02 ? hsRotationAt(er02.id, "2026-10-14") : null;
    const destination = String(hsRotationRef(rot02)?.route_name ?? "").split(" - ").pop() || "Kindia";
    nouveauDeversement({ occurred_at: heure("2026-10-14", 9, 15), site_id: 1, vehicle_id: er02?.id ?? null, rotation_id: rot02?.id ?? null, product_id: PRODUITS[rot02?.product]?.[0] ?? null, location: `Station du client à ${destination}, dépotage`, volume_liters: 150, recovered_liters: 0 }, 12, heure("2026-10-14", 9, 50));

    // Registre des déchets : trois enlevés avec leur bordereau, cinq entreposés (dont un prêt à enlever).
    const enlever = (w, le, prestataire, bordereau, by) => {
      hsAttach("waste", w.id, by, `bordereau-${bordereau}.pdf`, "application/pdf", pdf(`Bordereau ${bordereau}`), { created_at: heure(le, 10), role: "document" });
      Object.assign(w, { status: "collected", pickup_date: le, provider_name: prestataire, manifest_reference: bordereau, collected_by: by });
      hsLog("waste", w.id, by, "collect", null, null, null, heure(le, 10, 5));
    };
    const huiles = "Recyclage des Huiles de Guinée (fictif)";
    const services = "Environnement Services Conakry (fictif)";
    enlever(nouveauDechet({ site_id: 1, waste_kind: "other", description: "Terres et absorbants souillés", quantity: 180, unit: "kg", produced_on: "2026-05-27" }, heure("2026-05-27", 9), 12), "2026-06-10", services, "BSD-2026-0107", 12);
    enlever(nouveauDechet({ site_id: 1, waste_kind: "used_oil", quantity: 1200, produced_on: "2026-06-30", note: "Vidanges de juin des seize citernes." }, heure("2026-06-30", 16), 12), "2026-07-15", huiles, "BSD-2026-0142", 12);
    enlever(nouveauDechet({ site_id: 1, waste_kind: "filters", quantity: 64, produced_on: "2026-07-31" }, heure("2026-07-31", 16), 12), "2026-08-12", services, "BSD-2026-0198", 12);
    nouveauDechet({ site_id: 2, waste_kind: "tyres", quantity: 18, produced_on: "2026-08-20", note: "Pneus de bennes déchapés, entreposés derrière l'atelier." }, heure("2026-08-20", 15), 18);
    nouveauDechet({ site_id: 2, waste_kind: "used_oil", quantity: 650, produced_on: "2026-09-30", provider_name: huiles }, heure("2026-09-30", 17), 18);
    const pret = nouveauDechet({ site_id: 1, waste_kind: "used_oil", quantity: 820, produced_on: "2026-10-05", provider_name: huiles, manifest_reference: "BSD-2026-0251", note: "Enlèvement prévu le 16/10." }, heure("2026-10-05", 15), 12);
    hsAttach("waste", pret.id, 12, "bordereau-BSD-2026-0251.pdf", "application/pdf", pdf("Bordereau BSD-2026-0251"), { created_at: heure("2026-10-14", 16), role: "document" });
    nouveauDechet({ site_id: 1, waste_kind: "filters", quantity: 38, produced_on: "2026-10-09" }, heure("2026-10-09", 16), 12);
    nouveauDechet({ site_id: 2, waste_kind: "other", description: "Batteries usagées", quantity: 0.6, unit: "t", produced_on: "2026-10-12" }, heure("2026-10-12", 11), 18);

    // Poussières : prélèvements hebdomadaires à la mine (poussières inhalables, mg/m³) ; mesures mensuelles à Matoto (PM10, µg/m³).
    const points = [
      ["Piste d'accès de la fosse 3", 1.15],
      ["Plateforme de chargement de la fosse 3", 1],
      ["Port de Dapilon, point de déversement n° 1", 0.8],
    ];
    const saison = { "08": 3.6, "09": 4.4, "10": 7.6 };
    for (let j = "2026-08-03"; j <= TODAY; j = ajouterJours(j, 7)) {
      points.forEach(([point, poids], k) => {
        const id = HS.seq.dust + 1;
        const valeur = arrondi((saison[j.slice(5, 7)] ?? 5) * poids * (0.85 + part(id, k + 3) * 0.4), 2);
        nouvelleMesure({ site_id: 2, measured_on: j, point, value: valeur, unit: "mg_m3", threshold: 10, method: "Prélèvement individuel sur 8 h, pompe et cassette IOM (poussières inhalables)" }, 18);
      });
    }
    for (const [j, valeur] of [["2026-08-12", 96], ["2026-09-09", 121], ["2026-10-08", 168]]) {
      nouvelleMesure({ site_id: 1, measured_on: j, point: "Limite de propriété, côté riverains", value: valeur, unit: "ug_m3", threshold: 150, method: "Capteur optique de particules (PM10), moyenne sur 24 h",
        note: valeur > 150 ? "Saison sèche qui commence : arrosage de la cour demandé avant 7 h." : null }, 12);
    }

    // Contaminations de produit : deux closes, deux ouvertes.
    // Le constat peut dépendre du produit de la rotation (description donnée comme fonction du code produit).
    const contamination = (nom, j, v, statut, fin) => {
      const ve = vehicule(nom);
      const rot = ve ? hsRotationAt(ve.id, j) : null;
      const description = typeof v.description === "function" ? v.description(rot?.product ?? "gasoil") : v.description;
      const c = nouvelleContamination({ detected_on: j, vehicle_id: ve?.id ?? null, rotation_id: rot?.id ?? null, ...v, description }, 16, heure(j, 15));
      if (statut === "closed") {
        Object.assign(c, { status: "closed", closed_at: heure(fin, 10), closed_by: 16 });
        hsLog("contamination", c.id, 16, "close", null, null, null, c.closed_at);
      }
      return c;
    };
    contamination("ER-09", "2026-06-18", { nature: "water", volume_m3: 0.8, cost: 9_600_000, description: "Eau décelée au fond du compartiment n° 3 au jaugeage du client : pâte à eau virée au rouge sur 4 cm.",
      measures: "Compartiment purgé, 800 L repris par le dépôt ; joint du dôme n° 3 remplacé, étanchéité contrôlée." }, "closed", "2026-06-25");
    contamination("ER-12", "2026-09-09", { nature: "mixing", volume_m3: 2.5, cost: 31_000_000, description: "Traces d'essence dans un chargement de gasoil : vanne de collecteur mal purgée après une livraison d'essence.",
      measures: "Collecteur purgé à chaque changement de produit, consigne affichée au poste de chargement ; lot déclassé et repris par le dépôt." }, "closed", "2026-09-18");
    contamination("ER-05", "2026-10-06", { nature: "impurities", volume_m3: 0, description: "Sédiments retenus par le filtre du client à la livraison ; le client accepte le produit sous réserve d'analyse." }, "open");
    contamination("ER-16", "2026-10-13", {
      nature: "off_spec", volume_m3: 36,
      description: (produit) => (produit === "essence"
        ? "Indice d'octane relevé par le laboratoire du client sous la valeur du contrat (89 pour 91 au moins) ; chargement mis en attente."
        : "Densité relevée par le laboratoire du client hors de la plage du contrat (0,862 à 15 °C pour 0,820 à 0,860) ; chargement mis en attente."),
      measures: "Échantillon contradictoire envoyé au laboratoire du dépôt de Conakry.",
    }, "open");

    // Réclamations clients, avec leurs actions (origine « complaint »).
    const action = (c, desc, owner, due, statut, extra = {}) => {
      const a = hsNewAction({ description: desc, origin: "complaint", origin_id: c.id, control_level: "administrative", owner_id: owner, due_date: due, status: statut, created_at: heure(c.received_on, 16), created_by: 16, site_id: c.site_id });
      a.complaint_id = c.id;
      Object.assign(a, extra);
      hsLog("action", a.id, 16, "create", null, null, null, a.created_at);
      return a;
    };
    const reclamation = (client, recue, v, reponse = null) => {
      const rot = rotationDuClient(client, ajouterJours(recue, -1));
      const c = nouvelleReclamation({ partner_id: client, rotation_id: rot?.id ?? null, received_on: recue, ...v }, 16, heure(recue, 11));
      if (reponse) repondre(c, 16, reponse[1], reponse[0], heure(reponse[0], 15));
      return c;
    };
    const r1 = reclamation(102, "2026-08-04", { nature: "shortage", severity: "major", description: "Manquant de 600 L constaté au jaugeage du client à Kamsar, plombs intacts." },
      ["2026-08-11", "Avoir de 600 L émis sur la facture du mois ; jauges du dépôt et du client comparées en présence des deux parties."]);
    action(r1, "Comparer chaque trimestre les jauges du dépôt de Conakry et du client de Kamsar", 11, "2026-08-31", "closed", { done_at: "2026-08-28", closed_at: heure("2026-08-28", 17) });
    Object.assign(r1, { status: "closed", closed_at: heure("2026-08-29", 10), closed_by: 16 });
    hsLog("complaint", r1.id, 16, "close", null, null, null, r1.closed_at);
    const r2 = reclamation(104, "2026-09-02", { nature: "delay", severity: "minor", description: "Livraison arrivée avec 26 heures de retard, sans que le dépôt du client soit prévenu." },
      ["2026-09-20", "Retard dû à la fermeture du bac de Kouroussa ; le conducteur prévient désormais le client dès qu'un retard dépasse deux heures."]);
    Object.assign(r2, { status: "closed", closed_at: heure("2026-09-22", 9), closed_by: 16 });
    hsLog("complaint", r2.id, 16, "close", null, null, null, r2.closed_at);
    const r3 = nouvelleReclamation({ partner_id: 101, site_id: 2, received_on: "2026-09-28", nature: "behaviour", severity: "major", description: "Conducteur d'une benne sans gilet ni casque sur la plateforme de chargement de la fosse 3." }, 16, heure("2026-09-28", 11));
    repondre(r3, 16, "Le conducteur a été rappelé à l'ordre ; un contrôle des EPI est ajouté au contrôle avant départ des bennes.", "2026-10-03", heure("2026-10-03", 15));
    action(r3, "Ajouter le port du gilet et du casque au contrôle avant départ des bennes", 18, "2026-10-31", "in_progress", { started_at: heure("2026-10-04", 8) });
    reclamation(102, "2026-10-02", { nature: "shortage", severity: "critical", description: "Manquant de 410 L à la livraison de Kamsar ; le client demande un avoir et un plan d'actions écrit." });
    reclamation(108, "2026-09-25", { nature: "documents", severity: "minor", description: "Bon de livraison remis sans le tampon du dépôt : le client ne peut pas le rapprocher de sa commande." });
    reclamation(106, "2026-10-12", { nature: "quality", severity: "major", description: "Le client signale de l'eau dans l'essence livrée à Fria et demande une analyse contradictoire." });
  }
}
