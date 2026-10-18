/**
 * Maquette des routes de NIMOVA · Analyse (/analyse/contexte, /analyse/groupe/*, /analyse/cabinet/*),
 * au contrat de docs/projet/analyse/specification.md. Données fictives et déterministes (graines
 * fixes) : un modèle mensuel cohérent pour EGUITRA GROUP (transport pétrolier, BTP, immobilier) et un
 * portefeuille de projets pour MB AxisPro Consulting. Rien ici n'est une donnée réelle.
 *
 * `enregistrerAnalyse` reçoit les outils du serveur (route, erreurs, générateur, date de référence,
 * sociétés) et inscrit les routes.
 */

const PROFILS_GROUPE = ["admin", "direction", "finance"];
const PROFILS_CABINET = ["admin", "direction", "cabinet"];
const PROFILS_ACTIVITE = ["admin", "direction", "finance", "cabinet"];
const PROFILS_TOUS = ["admin", "direction", "finance", "cabinet"];

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const pad = (n) => String(n).padStart(2, "0");
const frDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const round = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (arr, fn = (x) => x) => arr.reduce((s, x, i) => s + fn(x, i), 0);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const log10Benford = (d) => Math.log10(1 + 1 / d) * 100;
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};
const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (pos - lo);
};
/** Clés AAAA-MM des `n` mois qui finissent au mois de `d`. */
function moisJusqua(d, n) {
  const y = +d.slice(0, 4);
  const m = +d.slice(5, 7);
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const t = m - 1 - k;
    const yy = y + Math.floor(t / 12);
    const mm = ((t % 12) + 12) % 12;
    out.push(`${yy}-${pad(mm + 1)}`);
  }
  return out;
}
const moisLabel = (key) => `${MOIS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
const moisCourt = (key) => MOIS[+key.slice(5, 7) - 1].slice(0, 4).replace(/\.$/, "");

export function enregistrerAnalyse({ route, ApiError, makeRng, TODAY, COMPANIES }) {
  const badParam = (m) => new ApiError(400, "invalid_parameter", m);
  const wrongCompany = (entity) =>
    new ApiError(403, "wrong_company", `Ce module ne concerne que ${entity === "groupe" ? "EGUITRA GROUP SARLU" : "MB AxisPro Consulting"} : choisissez cette société dans la colonne de gauche, ou ouvrez l'application qui la sert.`);

  /* ─── Période ───────────────────────────────────────────────────────── */

  function periode(query) {
    const dateTo = query.date_to ? (isDate(query.date_to) ? query.date_to : null) : TODAY;
    if (!dateTo) throw badParam("date_to : date AAAA-MM-JJ attendue.");
    const code = ["ytd", "12m", "q", "m", "custom"].includes(query.period) ? query.period : "ytd";
    const y = +dateTo.slice(0, 4);
    const m = +dateTo.slice(5, 7);
    let from;
    let label;
    if (code === "ytd") {
      from = `${y}-01-01`;
      label = `Exercice ${y} au ${frDate(dateTo)}`;
    } else if (code === "12m") {
      from = addDays(`${y - 1}-${pad(m)}-${pad(Math.min(+dateTo.slice(8, 10), lastDay(y - 1, m)))}`, 1);
      label = `12 mois glissants au ${frDate(dateTo)}`;
    } else if (code === "q") {
      const q = Math.floor((m - 1) / 3);
      from = `${y}-${pad(q * 3 + 1)}-01`;
      label = `${q + 1}${q === 0 ? "er" : "e"} trimestre ${y} au ${frDate(dateTo)}`;
    } else if (code === "m") {
      from = `${y}-${pad(m)}-01`;
      label = `${MOIS[m - 1][0].toUpperCase()}${MOIS[m - 1].slice(1)} ${y} au ${frDate(dateTo)}`;
    } else {
      if (!isDate(query.date_from)) throw badParam("date_from : date AAAA-MM-JJ attendue avec period=custom.");
      from = query.date_from;
      label = `Du ${frDate(from)} au ${frDate(dateTo)}`;
    }
    if (from > dateTo) throw badParam("La date de début dépasse la date d'arrêté.");
    const decale = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`.replace(/-02-29$/, "-02-28");
    return { code, date_from: from, date_to: dateTo, label, previous: { date_from: decale(from), date_to: decale(dateTo) } };
  }

  /** Part de chaque mois de la série comprise dans la période (le mois d'arrêté au prorata). */
  function poidsMois(months, p) {
    return months.map((k) => {
      const debut = `${k}-01`;
      const fin = `${k}-${pad(lastDay(+k.slice(0, 4), +k.slice(5, 7)))}`;
      const a = debut > p.date_from ? debut : p.date_from;
      const b = fin < p.date_to ? fin : p.date_to;
      if (a > b) return 0;
      return (daysBetween(a, b) + 1) / (daysBetween(debut, fin) + 1);
    });
  }

  function enveloppe(ctx, entity, p, quality, insights, corps) {
    const c = COMPANIES[ctx.company];
    return { entity, company: { id: c.id, name: c.name, currency: "GNF" }, period: p, generated_at: `${new Date().toISOString().slice(0, 19)}Z`, quality, insights, ...corps };
  }

  function exigerEntite(ctx, entity) {
    if (COMPANIES[ctx.company].entity !== entity) throw wrongCompany(entity);
  }

  /* ─── Constats ──────────────────────────────────────────────────────── */

  const POIDS = { critical: 5, high: 3.5, medium: 2, info: 1, positive: 1.5 };
  function constat(c) {
    const impact = Math.abs(c.impact_gnf || 0);
    const score = POIDS[c.severity] * (1 + Math.log10(1 + impact / 1e6)) * (0.5 + c.confidence / 2);
    return { metric: null, impact_gnf: null, evidence: null, action: null, link: null, ...c, impact_gnf: c.impact_gnf ? round(c.impact_gnf) : null, confidence: r2(c.confidence), score: Math.round(score * 1000) / 1000 };
  }
  function classer(items, limit = 6) {
    const ordered = [...items].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    let selected = ordered.slice(0, limit);
    if (limit >= 3 && !selected.some((i) => i.severity === "positive")) {
      const positive = ordered.find((i) => i.severity === "positive");
      if (positive) selected = [...selected.slice(0, limit - 1), positive];
    }
    return selected;
  }

  /* ════════════════════════════════════════════════════════════════════
   * EGUITRA GROUP : modèle mensuel sur 36 mois
   * ════════════════════════════════════════════════════════════════════ */

  const ACTIVITES = [
    { key: "transport", label: "Transport pétrolier", base: 2.62e9, var: 0.66, saison: (m) => (m >= 11 || m <= 5 ? 1.08 : m === 8 ? 0.86 : 0.95), croissance: 0.075 },
    { key: "btp", label: "BTP et génie civil", base: 0.96e9, var: 0.74, saison: (m) => (m >= 7 && m <= 9 ? 0.72 : m >= 11 || m <= 3 ? 1.14 : 1.0), croissance: 0.04 },
    { key: "immobilier", label: "Immobilier locatif", base: 0.46e9, var: 0.28, saison: () => 1, croissance: 0.03 },
  ];
  const FIXES_MENSUELS = 0.82e9;
  const MOIS_MODELE = moisJusqua(TODAY, 36);
  const modele = (() => {
    const r = makeRng("analyse-groupe-modele");
    const lignes = MOIS_MODELE.map((k, i) => {
      const m = +k.slice(5, 7);
      const ans = (i - (MOIS_MODELE.length - 1)) / 12;
      const activites = {};
      let ca = 0;
      let variables = 0;
      for (const a of ACTIVITES) {
        const rev = a.base * (1 + a.croissance) ** ans * a.saison(m) * r.noise(0.055) * (i >= MOIS_MODELE.length - 4 && a.key === "btp" ? 0.9 : 1);
        const cost = rev * a.var * r.noise(0.035) * (a.key === "transport" && i >= MOIS_MODELE.length - 7 ? 1.045 : 1);
        activites[a.key] = { revenue: round(rev), costs: round(cost), margin: round(rev - cost) };
        ca += rev;
        variables += cost;
      }
      const fixes = FIXES_MENSUELS * (1 + 0.03 * ans) * r.noise(0.03);
      const ebe = ca - variables - fixes;
      const dotations = 0.31e9 * (1 + 0.05 * ans);
      const financier = -0.062e9;
      const resultat = (ebe - dotations + financier) * (1 - 0.3);
      return { key: k, revenue: round(ca), variables: round(variables), fixes: round(fixes), ebe: round(ebe), dotations: round(dotations), financier: round(financier), impots: round((ebe - dotations + financier) * 0.3), net: round(resultat), activites, fuel: round(activites.transport.costs * 0.46), payroll: round(fixes * 0.52 + variables * 0.11) };
    });
    // Trésorerie : solde initial, puis EBE encaissé partiellement, investissements et dividendes.
    let solde = 3.75e9;
    const evenements = { "-33": -1.2e9, "-27": -0.8e9, "-21": -1.6e9, "-15": -1.4e9, "-9": -0.9e9, "-3": -2.2e9 };
    lignes.forEach((l, i) => {
      const ev = evenements[String(i - (lignes.length - 1))] ?? 0;
      solde += l.ebe * 0.58 - l.impots * 0.9 + ev + (r.next() * 2 - 1) * 0.25e9;
      l.cash = round(solde);
    });
    return lignes;
  })();
  const parCle = new Map(modele.map((l) => [l.key, l]));
  const sommeSur = (p, fn) => {
    const mois = moisEntre(p.date_from, p.date_to);
    const poids = poidsMois(mois, p);
    return sum(mois, (k, i) => (parCle.get(k) ? fn(parCle.get(k)) * poids[i] : 0));
  };
  function moisEntre(a, b) {
    const out = [];
    let y = +a.slice(0, 4);
    let m = +a.slice(5, 7);
    while (`${y}-${pad(m)}` <= b.slice(0, 7)) {
      out.push(`${y}-${pad(m)}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }
  const variation = (a, b) => (b ? r1(((a - b) / Math.abs(b)) * 100) : null);
  const tendance = (fn, n = 12) => MOIS_MODELE.slice(-n).map((k) => round(fn(parCle.get(k))));

  /* ─── Référentiels du groupe ─────────────────────────────────────────── */

  const ROUTES = [
    { key: "RT-01", label: "Conakry - Kamsar", km: 290, tarif: 1180, marge: 0.31 },
    { key: "RT-02", label: "Conakry - Kindia", km: 135, tarif: 760, marge: 0.27 },
    { key: "RT-03", label: "Conakry - Mamou", km: 270, tarif: 1120, marge: 0.24 },
    { key: "RT-04", label: "Conakry - Labé", km: 430, tarif: 1640, marge: 0.19 },
    { key: "RT-05", label: "Conakry - Boké", km: 300, tarif: 940, marge: -0.042 },
    { key: "RT-06", label: "Conakry - Kankan", km: 650, tarif: 2380, marge: 0.17 },
    { key: "RT-07", label: "Conakry - N'Zérékoré", km: 980, tarif: 3420, marge: 0.12 },
    { key: "RT-08", label: "Conakry - Siguiri", km: 790, tarif: 2860, marge: 0.21 },
  ];
  const CAMIONS = Array.from({ length: 12 }, (_, i) => ({ id: 31 + i, name: `ER-${pad(i + 1)}`, plaque: `RC-${4120 + i * 37}-${["AB", "AK", "BM", "CK"][i % 4]}` }));
  const CHAUFFEURS = ["Mamadou Camara", "Sékou Condé", "Alpha Oumar Bah", "Ibrahima Sory Touré", "Lansana Kouyaté", "Moussa Soumah", "Abdoulaye Diallo", "Ousmane Sylla", "Fodé Keïta", "Mohamed Cissé"];
  const CLIENTS = [
    ["Pétro-Guinée Distribution (démo)", 0.19, 0.3, 12], ["Mines de Boké SA (démo)", 0.14, 0.26, 28], ["Compagnie minière de Sangarédi (démo)", 0.11, 0.33, 9], ["Station Horizon (démo)", 0.08, 0.29, 41],
    ["Énergies du Fouta (démo)", 0.07, 0.24, 6], ["Alumine de Fria (démo)", 0.06, 0.22, 63], ["Bauxite Ouest (démo)", 0.055, 0.31, 18], ["Ciments de Guinée (démo)", 0.05, 0.19, 22],
    ["Dépôt Kaloum (démo)", 0.04, 0.27, 3], ["Transit Kamsar (démo)", 0.035, 0.21, 35], ["Hôpital régional de Kindia (démo)", 0.03, 0.14, 71], ["Promo-Habitat Ratoma (démo)", 0.028, 0.35, 15],
    ["Agro-Kankan SARL (démo)", 0.024, 0.2, 48], ["Groupe scolaire Lambanyi (démo)", 0.02, 0.33, 8], ["Télécom Nimba (démo)", 0.018, 0.25, 5], ["Carrières de Dubréka (démo)", 0.016, 0.18, 54],
    ["Pêcheries de Kamsar (démo)", 0.012, 0.23, 27], ["Boulangerie du Port (démo)", 0.009, 0.3, 2],
  ].map(([name, part, marge, retard], i) => ({ id: 101 + i, name, part, marge, retard }));
  const FOURNISSEURS = [
    ["Guinée Carburants SA (démo)", "Carburant", 0.36], ["Pneus et Pièces Matoto (démo)", "Pièces et pneus", 0.08], ["Atelier Mécanique Sonfonia (démo)", "Entretien", 0.06], ["Béton Ouest Africain (démo)", "Matériaux", 0.1],
    ["Fer et Aciers de Guinée (démo)", "Matériaux", 0.07], ["Génie Civil Associés (démo)", "Sous-traitance BTP", 0.09], ["Assur-Guinée (démo)", "Assurances", 0.05], ["Immo-Bail Conakry (démo)", "Loyers", 0.04],
    ["Orange Guinée Pro (démo)", "Télécoms", 0.015], ["Cabinet Juridique Kaloum (démo)", "Honoraires", 0.02], ["Papeterie Centrale (démo)", "Fournitures", 0.008], ["Électricité du Littoral (démo)", "Énergie", 0.025],
    ["Transit Maritime Conakry (démo)", "Sous-traitance BTP", 0.03], ["Peintures Niger (démo)", "Matériaux", 0.012],
  ].map(([name, category, part], i) => ({ id: 201 + i, name, category, part }));
  const CATEGORIES = [...new Set(FOURNISSEURS.map((f) => f.category))];

  /* ─── Synthèse du groupe ─────────────────────────────────────────────── */

  function kpisGroupe(p) {
    const ca = sommeSur(p, (l) => l.revenue);
    const caPrev = sommeSur(p.previous, (l) => l.revenue);
    const ebe = sommeSur(p, (l) => l.ebe);
    const ebePrev = sommeSur(p.previous, (l) => l.ebe);
    const net = sommeSur(p, (l) => l.net);
    const netPrev = sommeSur(p.previous, (l) => l.net);
    const dernier = parCle.get(p.date_to.slice(0, 7)) ?? modele[modele.length - 1];
    const cash = dernier.cash;
    const cashPrev = (parCle.get(p.previous.date_to.slice(0, 7)) ?? dernier).cash;
    const dso = 47.3;
    const bfrJours = 38.6;
    const margeTransport = (sommeSur(p, (l) => l.activites.transport.margin) / Math.max(1, sommeSur(p, (l) => l.activites.transport.revenue))) * 100;
    const margeTransportPrev = (sommeSur(p.previous, (l) => l.activites.transport.margin) / Math.max(1, sommeSur(p.previous, (l) => l.activites.transport.revenue))) * 100;
    const dscr = 1.62;
    const k = (key, label, value, unit, previous, target, status, definition, trend, inverse = false) => ({ key, label, value: unit === "gnf" ? round(value) : r2(value), unit, previous: previous === null ? null : unit === "gnf" ? round(previous) : r2(previous), target, delta_pct: previous === null ? null : variation(value, previous), trend, status, definition, inverse });
    return [
      k("revenue", "Chiffre d'affaires", ca, "gnf", caPrev, round(caPrev * 1.08), ca >= caPrev ? "good" : "warn", "Produits des ventes hors taxes de la période, factures validées.", tendance((l) => l.revenue)),
      k("ebe", "Excédent brut d'exploitation", ebe, "gnf", ebePrev, round(caPrev * 1.08 * 0.165), ebe >= ebePrev ? "good" : "bad", "Chiffre d'affaires moins achats consommés, services extérieurs, impôts et taxes, personnel.", tendance((l) => l.ebe)),
      k("ebe_pct", "Taux d'EBE", (ebe / Math.max(1, ca)) * 100, "pct", (ebePrev / Math.max(1, caPrev)) * 100, 17, ebe / ca >= 0.15 ? "good" : "warn", "EBE rapporté au chiffre d'affaires.", tendance((l) => (l.ebe / l.revenue) * 100)),
      k("net", "Résultat net", net, "gnf", netPrev, null, net >= 0 ? (net >= netPrev ? "good" : "warn") : "bad", "Résultat après dotations, résultat financier et impôt sur les sociétés (30 %).", tendance((l) => l.net)),
      k("cash", "Trésorerie nette", cash, "gnf", cashPrev, 2.5e9, cash >= 2.5e9 ? "good" : "bad", "Banques et caisses moins découverts, à la date d'arrêté ; cible : seuil de sécurité.", tendance((l) => l.cash)),
      k("bfr_days", "BFR en jours de CA", bfrJours, "days", 33.1, 30, bfrJours > 30 ? "warn" : "good", "Besoin en fonds de roulement rapporté au chiffre d'affaires journalier TTC.", [31, 32, 34, 33, 35, 36, 35, 37, 38, 37, 38.2, 38.6], true),
      k("dso", "Délai de recouvrement (DSO)", dso, "days", 42.8, 40, dso > 40 ? "warn" : "good", "Créances clients rapportées aux ventes TTC journalières, 12 mois glissants.", [41, 42, 43, 42.5, 44, 45, 44.2, 46, 47, 46.5, 47.1, 47.3], true),
      k("transport_margin", "Marge transport", margeTransport, "pct", margeTransportPrev, 32, margeTransport >= 30 ? "good" : "warn", "Marge directe des rotations validées (tarif moins carburant, péages, frais, entretien).", tendance((l) => (l.activites.transport.margin / l.activites.transport.revenue) * 100)),
      k("dscr", "Couverture de la dette (DSCR)", dscr, "ratio", 1.78, 1.3, dscr >= 1.3 ? "good" : "bad", "EBE sur 12 mois divisé par le service de la dette (intérêts et principal).", [1.9, 1.88, 1.85, 1.81, 1.78, 1.75, 1.72, 1.7, 1.68, 1.66, 1.64, 1.62]),
    ];
  }

  function santeGroupe(p) {
    const dernier = parCle.get(p.date_to.slice(0, 7)) ?? modele[modele.length - 1];
    const decaissements = (dernier.variables + dernier.fixes) * 0.92;
    const moisCouverts = dernier.cash / decaissements;
    const ebePct = (sommeSur(p, (l) => l.ebe) / Math.max(1, sommeSur(p, (l) => l.revenue))) * 100;
    const borne = (v, lo, hi) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const axes = {
      liquidite: { score: borne(moisCouverts, 0, 3), label: "Liquidité", value: r2(moisCouverts), unit: "ratio", comment: `${r1(moisCouverts)} mois de décaissements couverts par la trésorerie (0 mois = 0, 3 mois et plus = 100).` },
      rentabilite: { score: borne(ebePct, 0, 25), label: "Rentabilité", value: r1(ebePct), unit: "pct", comment: `Taux d'EBE de ${r1(ebePct)} % (0 % = 0, 25 % et plus = 100).` },
      solvabilite: { score: borne(1.62, 0.8, 2.2), label: "Solvabilité", value: 1.62, unit: "ratio", comment: "DSCR de 1,62 (0,8 = 0, 2,2 et plus = 100) ; gearing 0,41." },
      recouvrement: { score: borne(90 - 47.3, 0, 60), label: "Recouvrement", value: 47.3, unit: "days", comment: "DSO de 47 jours (90 jours = 0, 30 jours et moins = 100) ; 23 % des créances échues." },
      exploitation: { score: borne(71.4, 40, 90), label: "Exploitation", value: 71.4, unit: "pct", comment: "Taux d'utilisation de la flotte de 71 % (40 % = 0, 90 % = 100) ; 1 route sur 8 déficitaire." },
    };
    for (const a of Object.values(axes)) a.score = round(a.score);
    const score = round(sum(Object.values(axes), (a) => a.score) / 5);
    return { score, axes };
  }

  function cascadeGroupe(p) {
    const ca = sommeSur(p, (l) => l.revenue);
    const variables = sommeSur(p, (l) => l.variables);
    const fixes = sommeSur(p, (l) => l.fixes);
    const ebe = ca - variables - fixes;
    const dot = sommeSur(p, (l) => l.dotations);
    const fin = sommeSur(p, (l) => l.financier);
    const impots = sommeSur(p, (l) => l.impots);
    return [
      { key: "ca", label: "Chiffre d'affaires", value: round(ca), kind: "total" },
      { key: "achats", label: "Achats consommés", value: round(variables * 0.63), kind: "minus" },
      { key: "services", label: "Services extérieurs", value: round(variables * 0.37), kind: "minus" },
      { key: "taxes", label: "Impôts et taxes", value: round(fixes * 0.09), kind: "minus" },
      { key: "personnel", label: "Personnel", value: round(fixes * 0.61), kind: "minus" },
      { key: "autres", label: "Autres charges", value: round(fixes * 0.3), kind: "minus" },
      { key: "ebe", label: "EBE", value: round(ebe), kind: "total" },
      { key: "dotations", label: "Dotations", value: round(dot), kind: "minus" },
      { key: "financier", label: "Résultat financier", value: round(Math.abs(fin)), kind: fin < 0 ? "minus" : "plus" },
      { key: "impot", label: "Impôt sur les sociétés", value: round(impots), kind: "minus" },
      { key: "net", label: "Résultat net", value: round(ebe - dot + fin - impots), kind: "total" },
    ];
  }

  function activitesGroupe(p) {
    const ca = sommeSur(p, (l) => l.revenue);
    return ACTIVITES.map((a) => {
      const rev = sommeSur(p, (l) => l.activites[a.key].revenue);
      const prev = sommeSur(p.previous, (l) => l.activites[a.key].revenue);
      const marge = sommeSur(p, (l) => l.activites[a.key].margin);
      return { key: a.key, label: a.label, revenue: round(rev), margin: round(marge), margin_pct: r1((marge / Math.max(1, rev)) * 100), share_pct: r1((rev / Math.max(1, ca)) * 100), growth_pct: variation(rev, prev) };
    });
  }

  const serieMensuelle = (n, defs) => {
    const months = MOIS_MODELE.slice(-n);
    return { months, series: defs.map(([key, label, unit, fn]) => ({ key, label, unit, values: months.map((k) => round(fn(parCle.get(k)))) })) };
  };

  /* ─── Structure de coûts (régression des charges sur le chiffre d'affaires, 24 mois) ── */

  function structureCouts(p) {
    const points = modele.slice(-24).map((l) => ({ month: l.key, revenue: l.revenue, costs: l.variables + l.fixes }));
    const n = points.length;
    const mx = sum(points, (q) => q.revenue) / n;
    const my = sum(points, (q) => q.costs) / n;
    const pente = sum(points, (q) => (q.revenue - mx) * (q.costs - my)) / sum(points, (q) => (q.revenue - mx) ** 2);
    const ordonnee = my - pente * mx;
    const ssTot = sum(points, (q) => (q.costs - my) ** 2);
    const ssRes = sum(points, (q) => (q.costs - (ordonnee + pente * q.revenue)) ** 2);
    const breakeven = ordonnee / (1 - pente);
    const caMensuel = sommeSur(p, (l) => l.revenue) / Math.max(1, moisEntre(p.date_from, p.date_to).length);
    return { fixed_monthly: round(ordonnee), variable_rate: r2(pente), r2: r2(1 - ssRes / ssTot), breakeven_monthly: round(breakeven), safety_margin_pct: r1(((caMensuel - breakeven) / caMensuel) * 100), operating_leverage: r2((caMensuel * (1 - pente)) / (caMensuel * (1 - pente) - ordonnee)), points };
  }

  /* ─── Constats du groupe (par section) ───────────────────────────────── */

  function constatsRentabilite(p) {
    const btp = sommeSur(p, (l) => l.activites.btp.margin);
    const btpRev = sommeSur(p, (l) => l.activites.btp.revenue);
    const sc = structureCouts(p);
    return [
      constat({ id: "rentabilite.btp_marge_erosion", domain: "rentabilite", severity: "high", title: "La marge du BTP s'érode depuis quatre mois", narrative: `Le BTP dégage ${r1((btp / btpRev) * 100)} % de marge sur la période contre 29,8 % un an plus tôt : le chantier Hôpital de Kindia pèse (indice de performance des coûts 0,86) et la saison des pluies a réduit la facturation de 10 %.`, metric: { label: "Marge BTP", value: r1((btp / btpRev) * 100), unit: "pct", reference: 29.8, reference_label: "N-1" }, impact_gnf: round(btpRev * 0.04), confidence: 0.82, method: "Marge par activité analytique, pièces validées ; comparaison à la même période N-1 ; CPI = valeur acquise / coûts engagés.", evidence: { type: "series", data: { labels: MOIS_MODELE.slice(-8).map(moisCourt), values: MOIS_MODELE.slice(-8).map((k) => r1((parCle.get(k).activites.btp.margin / parCle.get(k).activites.btp.revenue) * 100)), unit: "pct", reference: 29.8 } }, action: "Revoir les avenants du chantier Hôpital de Kindia et bloquer les achats hors devis ; viser 27 % à terminaison.", link: "/analyse/rentabilite?onglet=metiers" }),
      constat({ id: "rentabilite.point_mort", domain: "rentabilite", severity: sc.safety_margin_pct < 25 ? "high" : "medium", title: `Le point mort mensuel est de ${mds(sc.breakeven_monthly)}`, narrative: `Avec ${(sc.fixed_monthly / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} M GNF de charges fixes et ${pctFr((1 - sc.variable_rate) * 100)} de marge sur coûts variables, il faut ${mds(sc.breakeven_monthly)} de chiffre d'affaires par mois pour couvrir la structure ; la marge de sécurité est de ${pctFr(sc.safety_margin_pct)} et un point de chiffre d'affaires perdu coûte ${pctFr(sc.operating_leverage * 1, 1)} d'EBE.`, metric: { label: "Marge de sécurité", value: sc.safety_margin_pct, unit: "pct", reference: 30, reference_label: "Confort" }, impact_gnf: round(sc.fixed_monthly * 0.3), confidence: 0.74, method: `Régression linéaire des charges mensuelles sur le chiffre d'affaires (24 mois, R² ${sc.r2.toLocaleString("fr-FR")}) : ordonnée = charges fixes, pente = taux de charges variables ; point mort = fixes / (1 − pente).`, evidence: { type: "scatter", data: { points: sc.points.slice(-12).map((q) => ({ x: q.revenue, y: q.costs, label: moisCourt(q.month) })), x_label: "CA mensuel", y_label: "Charges" } }, action: `Toute embauche ou location longue durée s'évalue à l'aune de ces ${mds(sc.breakeven_monthly)} : ne pas laisser la structure gonfler avant la reprise du BTP.`, link: "/analyse/rentabilite?onglet=structure" }),
      constat({ id: "rentabilite.budget_carburant", domain: "rentabilite", severity: "high", title: "La ligne carburant dépassera le budget avec 88 % de probabilité", narrative: "Le carburant atteint 9,7 Mds GNF à date pour 10,2 Mds budgétés sur l'année : au rythme observé (+4,5 % depuis juillet), l'atterrissage se situe entre 11,4 et 12,1 Mds GNF.", metric: { label: "Probabilité de dépassement", value: 88, unit: "pct", reference: 50, reference_label: "Seuil d'alerte" }, impact_gnf: 1.5e9, confidence: 0.86, method: "Projection linéaire du réalisé mensuel jusqu'à fin d'exercice, dispersion des mois passés ; probabilité que la somme projetée dépasse le budget.", evidence: { type: "bars", data: { labels: ["Réalisé", "Budget", "Atterrissage"], values: [9.7e9, 10.2e9, 11.75e9], unit: "gnf", highlight: 2 } }, action: "Renégocier la remise volume avec Guinée Carburants et activer la clause d'indexation gasoil des contrats clients.", link: "/analyse/rentabilite?onglet=budget" }),
      constat({ id: "rentabilite.immobilier_solide", domain: "rentabilite", severity: "positive", title: "L'immobilier rapporte 9,1 % brut avec 94 % d'occupation", narrative: "Les 14 biens loués dégagent une marge de 68 % ; un seul impayé dépasse 60 jours. C'est l'activité la plus régulière du groupe et elle finance 40 % des charges fixes.", metric: { label: "Rendement brut", value: 9.1, unit: "pct", reference: 8, reference_label: "Cible" }, impact_gnf: 0.33e9, confidence: 0.9, method: "Loyers annuels encaissés rapportés à la valeur des biens ; occupation = jours loués / jours disponibles.", evidence: null, action: "Arbitrer la villa Kipé (occupation 58 %) : relouer ou céder.", link: "/analyse/rentabilite?onglet=metiers" }),
      constat({ id: "rentabilite.levier", domain: "rentabilite", severity: "info", title: `Le levier opérationnel est de ${sc.operating_leverage.toLocaleString("fr-FR")}`, narrative: `Une hausse de 1 % du chiffre d'affaires fait monter l'EBE de ${pctFr(sc.operating_leverage, 1)} : la structure fixe amplifie tout, à la hausse comme à la baisse.`, metric: { label: "Levier opérationnel", value: sc.operating_leverage, unit: "ratio", reference: null, reference_label: null }, impact_gnf: null, confidence: 0.74, method: "Marge sur coûts variables divisée par l'EBE, sur la régression des 24 derniers mois.", evidence: null, action: null, link: "/analyse/rentabilite?onglet=structure" }),
    ];
  }

  function constatsTresorerie(p) {
    const t = tresorerieGroupe(p);
    const bas = t.runway.low_point;
    const semaine = t.forecast.weeks.findIndex((w) => w.start === bas.week) + 1;
    const sousSeuil = bas.balance_p50 < t.position.threshold;
    return [
      constat({ id: "tresorerie.point_bas", domain: "tresorerie", severity: sousSeuil ? (bas.balance_p10 < 0 ? "critical" : "high") : bas.balance_p10 < t.position.threshold ? "medium" : "positive", title: sousSeuil ? `La trésorerie passe sous le seuil en semaine ${semaine} dans un cas sur deux` : bas.balance_p10 < t.position.threshold ? `La trésorerie frôle le seuil en semaine ${semaine} dans le scénario défavorable` : "La trésorerie reste au-dessus du seuil sur 13 semaines", narrative: `Entre la paie de fin de mois, l'échéance d'emprunt de début décembre (640 M GNF) et les encaissements miniers attendus seulement mi-décembre, la médiane des simulations touche ${mds(bas.balance_p50)} la semaine du ${frDate(bas.week)} ; le scénario p10 descend à ${mds(bas.balance_p10)}, pour un seuil de ${mds(t.position.threshold)}.`, metric: { label: "Point bas p50", value: bas.balance_p50, unit: "gnf", reference: t.position.threshold, reference_label: "Seuil" }, impact_gnf: Math.max(0, t.position.threshold - bas.balance_p10), confidence: 0.78, method: "Prévision à 13 semaines : créances datées par le délai réel de chaque client (moyenne et dispersion de son historique), dettes à échéance, échéances d'emprunt, charges récurrentes ; 1 000 tirages Monte-Carlo sur les délais clients, graine fixe.", evidence: { type: "series", data: { labels: t.forecast.weeks.map((_, i) => `S${i + 1}`), values: t.forecast.weeks.map((w) => w.balance_p50), unit: "gnf", reference: t.position.threshold } }, action: "Relancer Mines de Boké SA (1,34 Mds échus) avant le 20 novembre et décaler l'achat des pneus (310 M GNF) à janvier.", link: "/analyse/tresorerie" }),
      constat({ id: "tresorerie.dso_derive", domain: "tresorerie", severity: "high", title: "Le délai client s'allonge de 4,5 jours en un an", narrative: "Le DSO atteint 47 jours contre 43 l'an dernier : les clients miniers paient à 62 jours en moyenne, et trois stations-service dépassent 70 jours.", metric: { label: "DSO", value: 47.3, unit: "days", reference: 40, reference_label: "Cible" }, impact_gnf: 0.62e9, confidence: 0.88, method: "Créances clients rapportées aux ventes TTC journalières (12 mois glissants) ; régression du DSO mensuel sur 24 mois (pente +0,37 j/mois).", evidence: { type: "series", data: { labels: MOIS_MODELE.slice(-12).map(moisCourt), values: [42.8, 43.1, 43.9, 44.2, 44.8, 45.3, 45.1, 46, 46.4, 46.9, 47.1, 47.3], unit: "days", reference: 40 } }, action: "Passer les stations-service en prépaiement partiel (30 %) et activer la pénalité de retard contractuelle.", link: "/analyse/clients" }),
      constat({ id: "tresorerie.cycle", domain: "tresorerie", severity: "medium", title: "Le cycle de conversion est de 39 jours : 1 jour vaut 130 M GNF", narrative: "DSO 47 jours, DIO 11 jours, DPO 19 jours : chaque jour de cycle immobilise environ 130 M GNF. Payer les fournisseurs à 30 jours au lieu de 19 libérerait 1,4 Mds GNF.", metric: { label: "Cycle de conversion", value: 39, unit: "days", reference: 30, reference_label: "Cible" }, impact_gnf: 1.4e9, confidence: 0.8, method: "DSO + DIO − DPO sur 12 mois glissants ; valeur d'un jour = chiffre d'affaires TTC annuel / 365.", evidence: { type: "bars", data: { labels: ["DSO", "DIO", "DPO"], values: [47.3, 11.2, 19.4], unit: "days" } }, action: "Négocier 30 jours avec Guinée Carburants (36 % des achats) contre un volume garanti.", link: "/analyse/tresorerie" }),
      constat({ id: "tresorerie.devises", domain: "tresorerie", severity: "positive", title: "La position en USD couvre les échéances en devises de six mois", narrative: "Le compte USD (182 000 USD, soit 1,56 Mds GNF) couvre les trois échéances de leasing en devises jusqu'en avril : aucune exposition au change à court terme.", metric: { label: "Couverture devises", value: 6, unit: "count", reference: 3, reference_label: "Minimum" }, impact_gnf: null, confidence: 0.92, method: "Solde du compte en devises rapporté aux décaissements en devises des six prochains mois.", evidence: null, action: null, link: "/analyse/tresorerie" }),
    ];
  }

  function constatsClients() {
    return [
      constat({ id: "clients.concentration", domain: "clients", severity: "high", title: "Quatre clients font 52 % du chiffre d'affaires", narrative: "Pétro-Guinée Distribution pèse 19 % à elle seule ; l'indice HHI atteint 912 et le Gini 0,63. La perte du premier client coûterait 8,4 Mds GNF de chiffre d'affaires et 2,5 Mds de marge.", metric: { label: "Part des 5 premiers", value: 59, unit: "pct", reference: 50, reference_label: "Seuil" }, impact_gnf: 2.5e9, confidence: 0.92, method: "Courbe de Lorenz et Gini sur le chiffre d'affaires par client ; HHI = somme des parts au carré × 10 000 ; Pareto : clients cumulant 80 % du CA.", evidence: { type: "bars", data: { labels: CLIENTS.slice(0, 6).map((c) => c.name.replace(" (démo)", "")), values: CLIENTS.slice(0, 6).map((c) => r1(c.part * 100)), unit: "pct" } }, action: "Signer deux contrats-cadres hors mines (ciment, agro-industrie) pour ramener les cinq premiers sous 50 %.", link: "/analyse/clients" }),
      constat({ id: "clients.station_horizon", domain: "clients", severity: "critical", title: "Station Horizon se dégrade : 41 jours de retard moyen, 890 M GNF échus", narrative: "Son retard progresse de 3,2 jours par mois depuis janvier ; 890 M GNF sont échus dont 410 M depuis plus de 60 jours. La perte attendue (IFRS 9) monte à 96 M GNF.", metric: { label: "Retard moyen", value: 41, unit: "days", reference: 15, reference_label: "Tolérance" }, impact_gnf: 0.89e9, confidence: 0.9, method: "Régression du retard de paiement par facture dans le temps ; perte attendue = encours × probabilité de défaut par tranche d'ancienneté.", evidence: { type: "series", data: { labels: ["janv.", "mars", "mai", "juil.", "sept.", "oct."], values: [12, 18, 24, 31, 37, 41], unit: "days", reference: 15 } }, action: "Suspendre les livraisons au-delà de 1 Md GNF d'encours et exiger un échéancier signé sous 15 jours.", link: "/analyse/clients?client=104" }),
      constat({ id: "clients.strategiques", domain: "clients", severity: "positive", title: "Six clients stratégiques paient à 9 jours et portent 46 % de la marge", narrative: "Compagnie minière de Sangarédi, Énergies du Fouta, Dépôt Kaloum, Télécom Nimba, Groupe scolaire Lambanyi et Boulangerie du Port sont à la fois rentables et ponctuels.", metric: { label: "Part de la marge", value: 46, unit: "pct", reference: null, reference_label: null }, impact_gnf: null, confidence: 0.9, method: "Segmentation valeur (marge) × comportement de paiement (score 0-100) ; quadrant « Stratégiques » : marge au-dessus de la médiane et score ≥ 70.", evidence: null, action: "Leur proposer un contrat annuel indexé gasoil avec remise de fidélité.", link: "/analyse/clients" }),
      constat({ id: "clients.croissance", domain: "clients", severity: "info", title: "Agro-Kankan SARL double son volume en un an", narrative: "Un client « À développer » : +104 % de chiffre d'affaires, marge 20 %, mais 48 jours de retard moyen.", metric: { label: "Croissance", value: 104, unit: "pct", reference: null, reference_label: null }, impact_gnf: 0.21e9, confidence: 0.8, method: "Variation du chiffre d'affaires sur 12 mois glissants.", evidence: null, action: "Accompagner la croissance d'un plafond d'encours et d'un acompte.", link: "/analyse/clients?client=113" }),
    ];
  }

  function constatsTransport() {
    return [
      constat({ id: "transport.route_marge_negative.RT-05", domain: "transport", severity: "critical", title: "La route Conakry - Boké perd de l'argent", narrative: "Sur les 12 derniers mois, 118 rotations ont dégagé une marge de −4,2 % : le tarif de 940 GNF/m³ est sous le coût complet de 1 040 GNF/m³, et le retour se fait à vide.", metric: { label: "Marge", value: -4.2, unit: "pct", reference: 30, reference_label: "Seuil" }, impact_gnf: 0.182e9, confidence: 0.86, method: "Marge par route, rotations validées ; coût complet au m³ à pleine charge (carburant, péages, frais, entretien, structure imputée au km) ; seuil de marge paramétré.", evidence: { type: "bars", data: { labels: ROUTES.map((r) => r.label.replace("Conakry - ", "")), values: ROUTES.map((r) => r1(r.marge * 100)), unit: "pct", highlight: 4 } }, action: "Renégocier le tarif à 1 040 GNF/m³ (point mort) ou 1 350 pour la marge cible ; sinon réaffecter les ensembles sur Kamsar.", link: "/analyse/transport?route=RT-05" }),
      constat({ id: "transport.carburant_er07", domain: "transport", severity: "high", title: "L'ensemble ER-07 consomme 18 % de plus que la flotte", narrative: "46,2 L/100 km contre 39,1 pour la flotte : 11 rotations sur 14 dépassent le score robuste de 3,5 depuis août. Même chauffeur, mêmes routes : la cause est mécanique ou le carburant s'évapore.", metric: { label: "Consommation", value: 46.2, unit: "liters", reference: 39.1, reference_label: "Flotte" }, impact_gnf: 0.094e9, confidence: 0.84, method: "Score robuste = 0,6745 × (x − médiane) / MAD de la consommation par rotation, flotte et historique de l'ensemble ; anomalie au-delà de 3,5.", evidence: { type: "scatter", data: { points: [38.2, 39.4, 40.1, 38.8, 39.9, 44.8, 46.9, 47.3, 45.2, 46.6, 48.1, 45.9].map((v, i) => ({ x: i + 1, y: v, label: `Rotation ${i + 1}`, highlight: v > 43 })), x_label: "Rotation", y_label: "L/100 km" } }, action: "Immobiliser ER-07 pour contrôle injection et jauges ; comparer les pleins aux tickets de la station.", link: "/analyse/transport?truck=ER-07" }),
      constat({ id: "transport.utilisation", domain: "transport", severity: "medium", title: "Trois ensembles roulent moins d'un jour sur deux", narrative: "ER-10, ER-11 et ER-12 affichent 44 à 48 % d'utilisation : 1,1 Md GNF d'actifs qui attendent au parc, soit 31 M GNF de structure non couverte par mois.", metric: { label: "Utilisation", value: 46, unit: "pct", reference: 70, reference_label: "Cible" }, impact_gnf: 0.37e9, confidence: 0.8, method: "Jours en rotation / jours de la période par ensemble ; structure imputée au prorata des km.", evidence: { type: "bars", data: { labels: CAMIONS.map((c) => c.name), values: [86, 84, 81, 79, 77, 74, 72, 69, 63, 48, 46, 44], unit: "pct", highlight: 11 } }, action: "Proposer les trois ensembles en sous-traitance à Transit Kamsar ou céder le plus ancien.", link: "/analyse/transport" }),
      constat({ id: "transport.manquants", domain: "transport", severity: "high", title: "Les manquants dépassent la tolérance sur 14 % des rotations de gasoil", narrative: "126 000 litres manquants sur 12 mois (0,41 % du volume) ; deux chauffeurs concentrent 38 % des écarts hors tolérance.", metric: { label: "Part hors tolérance", value: 14, unit: "pct", reference: 5, reference_label: "Seuil" }, impact_gnf: 0.21e9, confidence: 0.83, method: "Écart entre volume chargé et volume livré par rotation ; tolérance paramétrée à 0,3 % ; agrégation par chauffeur, route et produit.", evidence: { type: "bars", data: { labels: CHAUFFEURS.slice(0, 6).map((c) => c.split(" ").slice(-1)[0]), values: [38, 29, 12, 9, 7, 5], unit: "pct" } }, action: "Double jaugeage au départ et à l'arrivée pour les deux chauffeurs concernés pendant un mois.", link: "/analyse/transport?onglet=manquants" }),
      constat({ id: "transport.kamsar", domain: "transport", severity: "positive", title: "Conakry - Kamsar reste la route la plus rentable : 31 % sur 12 mois", narrative: "La route la plus fréquentée (412 rotations) tient sa marge grâce au retour chargé en alumine ; elle porte 38 % de la marge transport.", metric: { label: "Marge", value: 31, unit: "pct", reference: 30, reference_label: "Seuil" }, impact_gnf: null, confidence: 0.9, method: "Marge par route, rotations validées.", evidence: null, action: null, link: "/analyse/transport?route=RT-01" }),
    ];
  }

  function constatsDepenses() {
    return [
      constat({ id: "depenses.benford_5", domain: "depenses", severity: "high", title: "Le chiffre 5 apparaît trop souvent en tête des factures fournisseurs", narrative: "11,3 % des 1 240 factures commencent par 5 contre 7,9 % attendus (Benford) ; l'excès vient des factures d'entretien entre 500 000 et 599 999 GNF, juste sous le seuil d'approbation de 600 000.", metric: { label: "Écart MAD de Nigrini", value: 0.014, unit: "ratio", reference: 0.012, reference_label: "Conformité marginale" }, impact_gnf: 0.12e9, confidence: 0.76, method: "Distribution du premier chiffre des montants hors taxes, khi-deux à 8 degrés de liberté et MAD de Nigrini ; niveaux : proche (< 0,006), acceptable (< 0,012), marginale (< 0,015), non-conformité.", evidence: { type: "bars", data: { labels: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], values: [29.4, 17.2, 12.1, 9.1, 11.3, 6.4, 5.6, 4.9, 4.0], unit: "pct", highlight: 4 } }, action: "Revoir le seuil d'approbation (le passer à 450 000 GNF) et contrôler 20 factures d'entretien de l'Atelier Sonfonia.", link: "/analyse/depenses?onglet=benford" }),
      constat({ id: "depenses.doublons", domain: "depenses", severity: "high", title: "Quatre factures semblent payées deux fois : 86 M GNF", narrative: "Même fournisseur, même montant à 1 % près, moins de 30 jours d'écart ; deux portent la même référence externe.", metric: { label: "Doublons probables", value: 4, unit: "count", reference: 0, reference_label: "Attendu" }, impact_gnf: 0.086e9, confidence: 0.72, method: "Appariement des factures fournisseurs : même tiers, montant à 1 % près et moins de 30 jours, ou même référence ; score combiné.", evidence: null, action: "Demander un avoir à Pneus et Pièces Matoto et à Béton Ouest Africain avant tout nouveau règlement.", link: "/analyse/depenses?onglet=doublons" }),
      constat({ id: "depenses.derive_pneus", domain: "depenses", severity: "medium", title: "Le prix moyen des pneus a grimpé de 23 % en six mois", narrative: "Le montant moyen mensuel des factures « Pièces et pneus » passe de 62 à 76 M GNF sans hausse du kilométrage : la dérive tient au prix, pas au volume.", metric: { label: "Dérive de prix", value: 23, unit: "pct", reference: 8, reference_label: "Inflation" }, impact_gnf: 0.16e9, confidence: 0.7, method: "Montant moyen mensuel par catégorie contre les six mois précédents, rapporté au kilométrage.", evidence: { type: "series", data: { labels: MOIS_MODELE.slice(-8).map(moisCourt), values: [62, 61, 64, 68, 71, 73, 75, 76].map((v) => v * 1e6), unit: "gnf" } }, action: "Mettre en concurrence deux fournisseurs de pneus et acheter par lot semestriel.", link: "/analyse/depenses?onglet=fournisseurs" }),
      constat({ id: "depenses.concentration", domain: "depenses", severity: "info", title: "Guinée Carburants représente 36 % des achats", narrative: "Une dépendance normale pour un transporteur pétrolier, mais le contrat ne prévoit ni remise volume ni indexation.", metric: { label: "Part du premier fournisseur", value: 36, unit: "pct", reference: null, reference_label: null }, impact_gnf: 0.29e9, confidence: 0.88, method: "Pareto des achats par fournisseur sur la période.", evidence: null, action: "Négocier 1,5 % de remise au-delà de 8 Mds GNF annuels.", link: "/analyse/depenses?onglet=fournisseurs" }),
      constat({ id: "depenses.outlier_honoraires", domain: "depenses", severity: "medium", title: "Une facture d'honoraires de 142 M GNF sort de l'ordinaire", narrative: "La médiane des honoraires est de 9 M GNF : cette facture du Cabinet Juridique Kaloum a un score robuste de 7,8.", metric: { label: "Score robuste", value: 7.8, unit: "ratio", reference: 3.5, reference_label: "Seuil" }, impact_gnf: 0.142e9, confidence: 0.7, method: "Score robuste par catégorie (médiane et MAD des montants) ; anomalie au-delà de 3,5.", evidence: null, action: "Vérifier la convention d'honoraires et le détail des diligences.", link: "/analyse/depenses?onglet=outliers" }),
      constat({ id: "depenses.carburant_maitrise", domain: "depenses", severity: "positive", title: "Le coût carburant au km baisse de 2 % sur le trimestre", narrative: "Malgré la hausse du gasoil, le coût au kilomètre recule grâce au retour chargé sur Kamsar et à la retraite d'ER-03.", metric: { label: "Coût carburant au km", value: 1670, unit: "gnf", reference: 1705, reference_label: "Trimestre précédent" }, impact_gnf: null, confidence: 0.82, method: "Carburant facturé / kilomètres validés par trimestre.", evidence: null, action: null, link: "/analyse/transport" }),
    ];
  }

  const mds = (v) => `${(v / 1e9).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mds GNF`;
  const pctFr = (v, d = 0) => `${v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d })} %`;

  function constatsPrevisions(p) {
    const pv = previsionsGroupe(p);
    const ca = pv.landing.revenue;
    const ebe = pv.landing.ebe;
    const ecartCa = ((ca.estimate - ca.budget) / ca.budget) * 100;
    const ecartEbe = ((ebe.estimate - ebe.budget) / ebe.budget) * 100;
    const tarif3 = pv.sensitivities.tariff * 3;
    return [
      constat({ id: "previsions.budget_ca", domain: "previsions", severity: ecartCa >= 0 ? "positive" : ecartCa > -3 ? "medium" : "high", title: ecartCa >= 0 ? `Le chiffre d'affaires atterrira ${pctFr(ecartCa, 1)} au-dessus du budget` : `Le chiffre d'affaires atterrira ${pctFr(-ecartCa, 1)} sous le budget`, narrative: `Holt-Winters projette ${mds(ca.estimate)} pour l'exercice (fourchette ${mds(ca.low)} à ${mds(ca.high)}) contre ${mds(ca.budget)} budgétés ; probabilité d'atteindre le budget : ${pctFr(ca.probability * 100)}. La saison sèche soutient le transport, le BTP ne rattrape pas son retard.`, metric: { label: "Atterrissage CA", value: ca.estimate, unit: "gnf", reference: ca.budget, reference_label: "Budget" }, impact_gnf: Math.abs(ca.estimate - ca.budget), confidence: 0.75, method: `Lissage de Holt-Winters additif (saisonnalité 12 sur 24 mois), intervalles par résidus, validation croisée glissante (MAPE ${pctFr(pv.revenue.mape, 1)}) ; probabilité d'atteindre le budget par 1 000 tirages.`, evidence: { type: "bars", data: { labels: ["Bas (p10)", "Estimation", "Haut (p90)", "Budget"], values: [ca.low, ca.estimate, ca.high, ca.budget], unit: "gnf", highlight: 3 } }, action: ecartCa >= 0 ? "Sécuriser l'avance : facturer les rotations de décembre avant la clôture." : "Avancer deux rotations hebdomadaires sur Kamsar en novembre et décembre.", link: "/analyse/previsions" }),
      constat({ id: "previsions.ebe_budget", domain: "previsions", severity: ecartEbe >= 0 ? "positive" : ecartEbe > -5 ? "medium" : "high", title: ecartEbe >= 0 ? `L'EBE dépassera le budget de ${pctFr(ecartEbe, 1)}` : `L'EBE manquera le budget de ${pctFr(-ecartEbe, 1)}`, narrative: `${mds(ebe.estimate)} attendus contre ${mds(ebe.budget)} budgétés (probabilité d'atteindre le budget : ${pctFr(ebe.probability * 100)}) : le carburant et la marge du BTP expliquent les deux tiers de l'écart.`, metric: { label: "Atterrissage EBE", value: ebe.estimate, unit: "gnf", reference: ebe.budget, reference_label: "Budget" }, impact_gnf: Math.abs(ebe.estimate - ebe.budget), confidence: 0.72, method: `Même méthode que le chiffre d'affaires, appliquée à l'EBE mensuel ; MAPE ${pctFr(pv.ebe.mape, 1)}.`, evidence: { type: "bars", data: { labels: ["Bas (p10)", "Estimation", "Haut (p90)", "Budget"], values: [ebe.low, ebe.estimate, ebe.high, ebe.budget], unit: "gnf", highlight: 3 } }, action: `Simuler : +3 % de tarif transport rend ${mds(tarif3)} d'EBE annuel ; voir le simulateur.`, link: "/analyse/previsions#simulateur" }),
      constat({ id: "previsions.saison", domain: "previsions", severity: "positive", title: "La saison sèche apporte 11 % de volume transport en plus", narrative: "Les trois dernières années montrent le même ressaut de novembre à mai : le quatrième trimestre est le meilleur moment pour négocier les tarifs.", metric: { label: "Effet saisonnier", value: 11, unit: "pct", reference: null, reference_label: null }, impact_gnf: null, confidence: 0.85, method: "Composante saisonnière du lissage de Holt-Winters.", evidence: { type: "series", data: { labels: MOIS_MODELE.slice(-12).map(moisCourt), values: MOIS_MODELE.slice(-12).map((k) => r1((ACTIVITES[0].saison(+k.slice(5, 7)) - 1) * 100)), unit: "pct", reference: 0 } }, action: null, link: "/analyse/previsions" }),
    ];
  }

  function previsionsGroupe(p) {
    const annee = p.date_to.slice(0, 4);
    const historiques = modele.filter((l) => l.key >= `${+annee - 1}-01` && l.key <= p.date_to.slice(0, 7));
    const futurs = [];
    let m = +p.date_to.slice(5, 7) + 1;
    while (m <= 12) {
      futurs.push(`${annee}-${pad(m)}`);
      m++;
    }
    const projette = (fn, bruit) => {
      const base = historiques.slice(-12).map(fn);
      const tendance = (base[base.length - 1] - base[0]) / 12;
      const saison = (k) => ACTIVITES[0].saison(+k.slice(5, 7)) * 0.72 + 0.28;
      const pts = historiques.map((l) => ({ month: l.key, actual: round(fn(l)), forecast: null, low: null, high: null }));
      const dernierActuel = fn(historiques[historiques.length - 1]);
      const moyenne = sum(base) / base.length;
      futurs.forEach((k, i) => {
        const f = (moyenne + tendance * (i + 1)) * saison(k) * (1 - 0.02 * i) + dernierActuel * 0.1;
        const disp = f * bruit * Math.sqrt(i + 1);
        pts.push({ month: k, actual: null, forecast: round(f), low: round(f - disp), high: round(f + disp) });
      });
      return pts;
    };
    const revenue = { points: projette((l) => l.revenue, 0.045), method: "Holt-Winters additif (saisonnalité 12, 24 mois)", mape: 5.8 };
    const ebe = { points: projette((l) => l.ebe, 0.11), method: "Holt-Winters additif (saisonnalité 12, 24 mois)", mape: 8.9 };
    const estimation = (block, champ) => sum(block.points.filter((q) => q.month.startsWith(annee)), (q) => q.actual ?? q[champ] ?? 0);
    const budgetCa = 47.5e9;
    const budgetEbe = 7.6e9;
    const proba = (est, lo, hi, budget) => {
      const sigma = Math.max(1, (hi - lo) / 2.56);
      const z = (est - budget) / sigma;
      return r2(1 / (1 + Math.exp(-1.7 * z)));
    };
    const caEst = estimation(revenue, "forecast");
    const ebeEst = estimation(ebe, "forecast");
    const structure = { revenue_transport: round(sum(modele.slice(-12), (l) => l.activites.transport.revenue)), fuel_costs: round(sum(modele.slice(-12), (l) => l.fuel)), payroll: round(sum(modele.slice(-12), (l) => l.payroll)), ebe_annual: round(sum(modele.slice(-12), (l) => l.ebe)) };
    return {
      revenue, ebe,
      landing: {
        revenue: { estimate: round(caEst), budget: budgetCa, probability: proba(caEst, estimation(revenue, "low"), estimation(revenue, "high"), budgetCa), low: round(estimation(revenue, "low")), high: round(estimation(revenue, "high")) },
        ebe: { estimate: round(ebeEst), budget: budgetEbe, probability: proba(ebeEst, estimation(ebe, "low"), estimation(ebe, "high"), budgetEbe), low: round(estimation(ebe, "low")), high: round(estimation(ebe, "high")) },
        net_result: { estimate: round((ebeEst - 3.9e9 - 0.74e9) * 0.7) },
        months_left: futurs.length,
      },
      sensitivities: { tariff: round(structure.revenue_transport * 0.01), volume: round(structure.revenue_transport * 0.01 * 0.34), fuel: -round(structure.fuel_costs * 0.01), payroll: -round(structure.payroll * 0.01) },
      structure,
    };
  }

  function constatsFiabilite() {
    return [
      constat({ id: "fiabilite.analytique", domain: "fiabilite", severity: "medium", title: "7 % des écritures de charge n'ont pas d'axe Activité", narrative: "312 écritures (1,9 Mds GNF) sont sans imputation analytique : les marges par activité sont sous-estimées d'autant.", metric: { label: "Sans imputation", value: 7.1, unit: "pct", reference: 2, reference_label: "Cible" }, impact_gnf: 1.9e9, confidence: 0.95, method: "Écritures de classe 6 sans compte analytique sur l'axe Activité, période en cours.", evidence: null, action: "Rendre l'axe obligatoire sur les journaux d'achat et imputer les 312 lignes.", link: "/finance/admin/imputations" }),
      constat({ id: "fiabilite.rapprochement", domain: "fiabilite", severity: "high", title: "Le compte BICIGUI n'est pas rapproché depuis 23 jours", narrative: "214 lignes de relevé attendent : la trésorerie affichée peut différer du solde bancaire de plusieurs centaines de millions.", metric: { label: "Retard de rapprochement", value: 23, unit: "days", reference: 7, reference_label: "Cible" }, impact_gnf: null, confidence: 0.98, method: "Date du dernier relevé rapproché par compte de banque.", evidence: null, action: "Rapprocher avant la clôture d'octobre.", link: "/finance/tresorerie/rapprochement" }),
      constat({ id: "fiabilite.delai_saisie", domain: "fiabilite", severity: "info", title: "Les pièces sont saisies 9 jours après leur date en moyenne", narrative: "Un délai correct (cible 10 jours), mais 41 factures d'achat ont attendu plus de 30 jours.", metric: { label: "Délai de saisie", value: 9.2, unit: "days", reference: 10, reference_label: "Cible" }, impact_gnf: null, confidence: 0.95, method: "Écart entre la date de la pièce et sa date de validation.", evidence: null, action: null, link: "/finance/achats" }),
      constat({ id: "fiabilite.bon_etat", domain: "fiabilite", severity: "positive", title: "Aucun compte d'attente ouvert, 99 % des tiers ont un NIF", narrative: "Les comptes 47 sont soldés et les fiches tiers sont complètes : les déclarations fiscales se préparent sans retraitement.", metric: { label: "Tiers avec NIF", value: 99, unit: "pct", reference: 95, reference_label: "Cible" }, impact_gnf: null, confidence: 0.98, method: "Contrôles de clôture, période en cours.", evidence: null, action: null, link: "/finance/clotures" }),
    ];
  }

  const qualiteGroupe = { score: 91, notes: ["312 écritures sans imputation analytique", "Compte BICIGUI non rapproché depuis 23 jours"] };

  /* ─── Routes du groupe ───────────────────────────────────────────────── */

  route("GET", "/analyse/groupe/synthese", PROFILS_GROUPE, (ctx) => {
    exigerEntite(ctx, "groupe");
    const p = periode(ctx.query);
    const tous = [...constatsRentabilite(p), ...constatsTresorerie(p), ...constatsClients(), ...constatsTransport(), ...constatsDepenses(), ...constatsPrevisions(p), ...constatsFiabilite()];
    return enveloppe(ctx, "groupe", p, qualiteGroupe, classer(tous, 10), {
      kpis: kpisGroupe(p),
      health: santeGroupe(p),
      waterfall: cascadeGroupe(p),
      monthly: serieMensuelle(24, [["revenue", "Chiffre d'affaires", "gnf", (l) => l.revenue], ["ebe", "EBE", "gnf", (l) => l.ebe], ["cash", "Trésorerie fin de mois", "gnf", (l) => l.cash]]),
      activities: activitesGroupe(p),
    });
  });

  route("GET", "/analyse/groupe/rentabilite", PROFILS_GROUPE, (ctx) => {
    exigerEntite(ctx, "groupe");
    const p = periode(ctx.query);
    const r = makeRng("analyse-rentabilite");
    const months = MOIS_MODELE.slice(-24);
    const by_activity = { months, series: ACTIVITES.flatMap((a) => [{ key: `${a.key}_revenue`, label: `${a.label} : CA`, unit: "gnf", values: months.map((k) => parCle.get(k).activites[a.key].revenue) }, { key: `${a.key}_margin`, label: `${a.label} : marge`, unit: "gnf", values: months.map((k) => parCle.get(k).activites[a.key].margin) }]) };
    const ebeN = sommeSur(p, (l) => l.ebe);
    const ebeN1 = sommeSur(p.previous, (l) => l.ebe);
    const m3N = sommeSur(p, (l) => l.activites.transport.revenue) / 1180;
    const m3N1 = sommeSur(p.previous, (l) => l.activites.transport.revenue) / 1125;
    const volume = (m3N - m3N1) * 1125 * 0.34;
    const prix = (1180 - 1125) * m3N * 0.34;
    const dTransport = sommeSur(p, (l) => l.activites.transport.margin) - sommeSur(p.previous, (l) => l.activites.transport.margin);
    const mix = dTransport - volume - prix;
    const dBtp = sommeSur(p, (l) => l.activites.btp.margin) - sommeSur(p.previous, (l) => l.activites.btp.margin);
    const dImmo = sommeSur(p, (l) => l.activites.immobilier.margin) - sommeSur(p.previous, (l) => l.activites.immobilier.margin);
    const dFixes = -(sommeSur(p, (l) => l.fixes) - sommeSur(p.previous, (l) => l.fixes));
    const bridge = [
      { key: "ebe_n1", label: `EBE ${p.previous.date_to.slice(0, 4)}`, value: round(ebeN1), kind: "total" },
      { key: "volume", label: "Transport : volume", value: round(Math.abs(volume)), kind: volume >= 0 ? "plus" : "minus" },
      { key: "prix", label: "Transport : prix", value: round(Math.abs(prix)), kind: prix >= 0 ? "plus" : "minus" },
      { key: "mix", label: "Transport : mix et coûts", value: round(Math.abs(mix)), kind: mix >= 0 ? "plus" : "minus" },
      { key: "btp", label: "BTP", value: round(Math.abs(dBtp)), kind: dBtp >= 0 ? "plus" : "minus" },
      { key: "immobilier", label: "Immobilier", value: round(Math.abs(dImmo)), kind: dImmo >= 0 ? "plus" : "minus" },
      { key: "fixes", label: "Charges fixes", value: round(Math.abs(dFixes)), kind: dFixes >= 0 ? "plus" : "minus" },
      { key: "ebe_n", label: `EBE ${p.date_to.slice(0, 4)}`, value: round(ebeN), kind: "total" },
    ];
    const cost_structure = structureCouts(p);
    const lignesBudget = [
      ["ca_transport", "CA transport", "revenue", 31.2e9, 30.4e9], ["ca_btp", "CA BTP", "revenue", 11.6e9, 10.1e9], ["ca_immobilier", "CA immobilier", "revenue", 5.4e9, 5.6e9],
      ["carburant", "Carburant", "expense", 10.2e9, 9.7e9], ["entretien", "Entretien et pièces", "expense", 2.9e9, 2.75e9], ["sous_traitance", "Sous-traitance BTP", "expense", 3.4e9, 3.3e9], ["materiaux", "Matériaux", "expense", 4.1e9, 3.6e9],
      ["personnel", "Personnel", "expense", 6.1e9, 6.2e9], ["loyers", "Loyers et assurances", "expense", 1.3e9, 1.28e9], ["honoraires", "Honoraires et services", "expense", 0.9e9, 1.05e9], ["autres", "Autres charges", "expense", 1.6e9, 1.42e9],
    ];
    const avancement = Math.min(1, (daysBetween(`${p.date_to.slice(0, 4)}-01-01`, p.date_to) + 1) / 365);
    const budget_variance = lignesBudget.map(([key, label, kind, budgetAnnuel, realiseAnnualise]) => {
      const budget = round(budgetAnnuel * avancement);
      const actual = round(realiseAnnualise * avancement * r.noise(0.02));
      const gap = actual - budget;
      const proj = realiseAnnualise * r.noise(0.01);
      const sigma = budgetAnnuel * 0.05;
      const z = (proj - budgetAnnuel) / sigma;
      const prob = 1 / (1 + Math.exp(-1.7 * z));
      return { key, label, kind, actual, budget, gap, gap_pct: r1((gap / budget) * 100), overrun_probability: r2(kind === "expense" ? prob : 1 - prob) };
    });
    const chantiers = [
      { id: 1, name: "Hôpital régional de Kindia", progress_pct: 62, budget: 6.4e9, revenue: 3.9e9, costs: 3.58e9, cpi: 0.86 },
      { id: 2, name: "Entrepôt pétrolier de Kamsar", progress_pct: 88, budget: 4.1e9, revenue: 3.6e9, costs: 2.74e9, cpi: 1.12 },
      { id: 3, name: "Lotissement Sonfonia (voiries)", progress_pct: 35, budget: 2.9e9, revenue: 1.0e9, costs: 0.82e9, cpi: 1.02 },
      { id: 4, name: "Station-service Horizon Matoto", progress_pct: 100, budget: 1.2e9, revenue: 1.2e9, costs: 0.93e9, cpi: 1.08 },
      { id: 5, name: "Réfection route d'accès Boké", progress_pct: 18, budget: 1.8e9, revenue: 0.32e9, costs: 0.3e9, cpi: 0.94 },
    ].map((c) => ({ ...c, margin: c.revenue - c.costs, margin_pct: r1(((c.revenue - c.costs) / c.revenue) * 100), margin_at_completion: round(c.budget - c.budget * (c.costs / c.revenue) * (1 / c.cpi) * 0.98) }));
    const biens = ["Immeuble Kaloum Centre", "Villa Kipé", "Bureaux Almamya", "Magasins Madina", "Résidence Lambanyi", "Entrepôt Matoto", "Villa Nongo", "Appartements Ratoma", "Terrain Dubréka", "Bureaux Camayenne", "Studios Kobaya", "Boutiques Taouyah", "Immeuble Dixinn", "Villa Coléah"].map((name, i) => {
      const rr = makeRng(`bien-${i}`);
      const occ = i === 1 ? 58 : i === 8 ? 0 : rr.int(86, 100);
      const value = [6.2, 1.1, 2.4, 1.6, 2.9, 1.8, 0.9, 2.2, 0.7, 1.9, 0.8, 1.2, 3.4, 1.0][i] * 1e9;
      const rent = i === 8 ? 0 : value * (0.085 + rr.next() * 0.02);
      return { id: 1 + i, name, occupancy_pct: occ, gross_yield_pct: r1((rent / value) * 100), rent_annual: round(rent), value: round(value), unpaid: i === 3 ? 48e6 : i === 7 ? 12e6 : 0, status: occ < 70 ? "bad" : occ < 90 ? "warn" : "good" };
    });
    const valeurTot = sum(biens, (b) => b.value);
    return enveloppe(ctx, "groupe", p, qualiteGroupe, classer(constatsRentabilite(p)), {
      by_activity, bridge, cost_structure, budget_variance,
      metiers: { chantiers, immobilier: { occupancy_pct: r1(sum(biens, (b) => b.occupancy_pct) / biens.length), gross_yield_pct: r1((sum(biens, (b) => b.rent_annual) / valeurTot) * 100), unpaid: sum(biens, (b) => b.unpaid), biens } },
    });
  });

  route("GET", "/analyse/groupe/tresorerie", PROFILS_GROUPE, (ctx) => {
    exigerEntite(ctx, "groupe");
    const p = periode(ctx.query);
    return enveloppe(ctx, "groupe", p, qualiteGroupe, classer(constatsTresorerie(p)), tresorerieGroupe(p));
  });

  function tresorerieGroupe(p) {
    const r = makeRng("analyse-tresorerie");
    const dernier = parCle.get(p.date_to.slice(0, 7)) ?? modele[modele.length - 1];
    const total = dernier.cash;
    const accounts = [
      { key: "bicigui", name: "BICIGUI compte courant", type: "bank", currency: "GNF", part: 0.41 },
      { key: "sgbg", name: "Société Générale Guinée", type: "bank", currency: "GNF", part: 0.22 },
      { key: "ecobank_usd", name: "Ecobank compte USD", type: "bank", currency: "USD", part: 0.3 },
      { key: "caisse_kaloum", name: "Caisse du siège", type: "cash", currency: "GNF", part: 0.04 },
      { key: "caisse_parc", name: "Caisse du parc Matoto", type: "cash", currency: "GNF", part: 0.03 },
    ].map((a) => ({ key: a.key, name: a.name, type: a.type, currency: a.currency, balance: round(total * a.part), balance_currency: a.currency === "USD" ? round((total * a.part) / 8600) : round(total * a.part) }));
    const seuil = 2.5e9;
    const weeks = [];
    let p50 = total;
    // Encaissements creux en semaines 5 à 7 (clients miniers payés mi-décembre), paie en semaines 5, 9
    // et 13, échéance d'emprunt en semaine 6 : le point bas tombe en semaine 7.
    const encaissementsBase = [0.95, 0.88, 0.82, 1.05, 0.62, 0.55, 0.5, 1.38, 1.22, 0.95, 0.86, 1.1, 1.02].map((v) => v * 1e9);
    const decaissementsBase = [0.92, 0.98, 0.9, 0.95, 1.0, 0.95, 0.9, 0.82, 0.74, 0.7, 0.9, 0.72, 0.76].map((v) => v * 1e9);
    for (let i = 0; i < 13; i++) {
      const start = addDays(p.date_to, 1 + i * 7);
      const end = addDays(start, 6);
      const inflows = round(encaissementsBase[i] * r.noise(0.03));
      const outflows = round(decaissementsBase[i] * r.noise(0.02) + (i === 5 ? 0.64e9 : 0) + (i === 4 || i === 8 || i === 12 ? 0.36e9 : 0));
      p50 += inflows - outflows;
      const disp = 0.12e9 * Math.sqrt(i + 1) * 2.1;
      weeks.push({ start, end, inflows, outflows, net: inflows - outflows, balance_p50: round(p50), balance_p10: round(p50 - disp), balance_p90: round(p50 + disp * 0.8) });
    }
    const sousSeuil50 = weeks.findIndex((w) => w.balance_p50 < seuil);
    const sousSeuil10 = weeks.findIndex((w) => w.balance_p10 < seuil);
    const bas = weeks.reduce((m, w) => (w.balance_p50 < m.balance_p50 ? w : m), weeks[0]);
    const months = MOIS_MODELE.slice(-24);
    const cycle = { months, series: [
      { key: "dso", label: "DSO", unit: "days", values: months.map((_, i) => r1(40.2 + i * 0.3 + Math.sin(i / 2) * 0.9)) },
      { key: "dpo", label: "DPO", unit: "days", values: months.map((_, i) => r1(22.5 - i * 0.13 + Math.cos(i / 3) * 0.8)) },
      { key: "dio", label: "DIO", unit: "days", values: months.map((_, i) => r1(10.1 + Math.sin(i / 4) * 1.2)) },
      { key: "ccc", label: "Cycle de conversion", unit: "days", values: [] },
      { key: "bfr", label: "BFR", unit: "gnf", values: months.map((k, i) => round(parCle.get(k).revenue * 1.18 * (28 + i * 0.44) / 30)) },
    ] };
    cycle.series[3].values = months.map((_, i) => r1(cycle.series[0].values[i] + cycle.series[2].values[i] - cycle.series[1].values[i]));
    const caAnnuel = sum(modele.slice(-12), (l) => l.revenue);
    const collections = CLIENTS.slice(0, 12).map((c) => {
      const open = round(caAnnuel * c.part * 1.18 * ((c.retard + 30) / 365));
      const overdue = round(open * Math.min(0.9, c.retard / 60));
      const semaine = Math.min(12, Math.max(0, Math.round((c.retard + 10) / 7)));
      const expected = Array.from({ length: 13 }, (_, i) => (i === semaine ? round(open * 0.55) : i === semaine + 1 ? round(open * 0.25) : i === semaine + 2 ? round(open * 0.12) : 0));
      return { id: c.id, name: c.name, open, overdue, avg_days: round(30 + c.retard), expected_by_week: expected };
    });
    return {
      position: { accounts, total, threshold: seuil },
      forecast: { weeks, simulations: 1000, seed: 20261017 },
      runway: { weeks_p50: sousSeuil50 < 0 ? null : sousSeuil50 + 1, weeks_p10: sousSeuil10 < 0 ? null : sousSeuil10 + 1, low_point: { week: bas.start, balance_p50: bas.balance_p50, balance_p10: bas.balance_p10 } },
      cycle, collections,
    };
  }

  route("GET", "/analyse/groupe/clients", PROFILS_GROUPE, (ctx) => {
    exigerEntite(ctx, "groupe");
    const p = periode(ctx.query);
    const ca = sommeSur(p, (l) => l.revenue);
    const parts = CLIENTS.map((c) => c.part);
    const totalPart = sum(parts);
    let cumul = 0;
    const lorenz = CLIENTS.map((c, i) => {
      cumul += c.part / totalPart;
      return { x: r1(((i + 1) / CLIENTS.length) * 100), y: r1(cumul * 100) };
    });
    const gini = r2(1 - 2 * sum(lorenz.map((pt, i) => ((i ? lorenz[i - 1].y : 0) + pt.y) / 2 / 100 / CLIENTS.length)));
    const hhi = round(sum(CLIENTS, (c) => (c.part / totalPart) ** 2 * 10000));
    const pareto_count = lorenz.findIndex((pt) => pt.y >= 80) + 1;
    const medianeMarge = median(CLIENTS.map((c) => c.part * c.marge));
    const segments = CLIENTS.map((c, i) => {
      const r = makeRng(`client-${i}`);
      const revenue = round(ca * c.part);
      const margin = round(revenue * c.marge);
      const score = Math.max(5, Math.min(100, round(100 - c.retard * 1.4 - (c.retard > 40 ? 10 : 0))));
      const valeur = c.part * c.marge >= medianeMarge;
      const segment = valeur && score >= 70 ? "strategiques" : valeur ? "a_securiser" : score >= 70 ? "a_developper" : "a_surveiller";
      const open = round(revenue * 1.18 * ((c.retard + 30) / 365));
      const overdue = round(open * Math.min(0.9, c.retard / 60));
      return { id: c.id, name: c.name, revenue, margin, growth_pct: i === 12 ? 104 : r1(-12 + r.next() * 30), avg_days_late: c.retard, payment_score: score, open, overdue, ecl: round(overdue * (c.retard > 60 ? 0.25 : c.retard > 30 ? 0.08 : 0.02)), segment };
    });
    const behaviour = CLIENTS.slice(0, 10).map((c, i) => {
      const r = makeRng(`comportement-${i}`);
      const buckets = ["À l'heure", "1-15 j", "16-30 j", "31-60 j", "> 60 j"];
      const centre = Math.min(4, Math.floor(c.retard / 15));
      const histogram = buckets.map((b, k) => ({ bucket: b, count: Math.max(0, round(14 * Math.exp(-((k - centre) ** 2) / 1.6) * r.noise(0.3))) }));
      const slope = i === 3 ? 3.2 : i === 12 ? 1.1 : r1(-1.2 + r.next() * 2.4);
      return { id: c.id, name: c.name, histogram, trend: slope > 0.8 ? "se_degrade" : slope < -0.8 ? "s_ameliore" : "stable", slope_days_per_month: slope };
    });
    const months = MOIS_MODELE.slice(-12);
    const trends = { months, clients: CLIENTS.slice(0, 10).map((c, i) => {
      const r = makeRng(`tendance-${i}`);
      return { id: c.id, name: c.name, values: months.map((k, j) => round(parCle.get(k).revenue * c.part * r.noise(0.14) * (i === 12 ? 0.6 + j * 0.07 : 1))) };
    }) };
    return enveloppe(ctx, "groupe", p, qualiteGroupe, classer(constatsClients()), {
      concentration: { lorenz, gini, hhi, top_share: { top1: r1((CLIENTS[0].part / totalPart) * 100), top5: r1((sum(CLIENTS.slice(0, 5), (c) => c.part) / totalPart) * 100) }, pareto_count, clients_count: CLIENTS.length },
      segments, behaviour, trends,
    });
  });

  route("GET", "/analyse/groupe/transport", PROFILS_GROUPE, (ctx) => {
    exigerEntite(ctx, "groupe");
    const p = periode(ctx.query);
    const r = makeRng("analyse-transport");
    const months = MOIS_MODELE.slice(-12);
    const cells = [];
    for (const rt of ROUTES) {
      for (const k of months) {
        const m = +k.slice(5, 7);
        const saison = m >= 11 || m <= 5 ? 1.06 : 0.92;
        const rotations = round((rt.key === "RT-01" ? 34 : rt.key === "RT-07" ? 6 : 12) * saison * r.noise(0.25));
        const marge = rotations === 0 ? null : r1(rt.marge * 100 + (r.next() * 2 - 1) * 4.5 + (rt.key === "RT-05" && m >= 6 ? -3 : 0));
        cells.push({ route: rt.key, month: k, margin_pct: marge, rotations });
      }
    }
    const caTransport = sommeSur(p, (l) => l.activites.transport.revenue);
    const utilisation = [86, 84, 81, 79, 77, 74, 72, 69, 63, 48, 46, 44];
    const trucks = CAMIONS.map((c, i) => {
      const util = utilisation[i];
      const rotations = round(util * 1.9 * r.noise(0.08));
      const km = round(rotations * 560 * r.noise(0.15));
      const m3 = round(rotations * 38 * r.noise(0.05));
      const revenue = round((caTransport / 12) * (util / sum(utilisation)) * 12 * r.noise(0.04));
      const lkm = i === 6 ? 46.2 : r1(37.5 + r.next() * 3.5);
      const direct = round(revenue * (0.58 + (lkm - 39) * 0.012) * r.noise(0.03));
      const structure = round((km / 100) * 1800 * 12);
      return { id: c.id, name: `${c.name} · ${c.plaque}`, rotations, km, m3, revenue, direct_costs: direct, margin: revenue - direct, margin_pct: r1(((revenue - direct) / revenue) * 100), revenue_per_km: round(revenue / km), cost_per_km: round(direct / km), l_per_100km: lkm, active_days: round(365 * (util / 100)), utilization_pct: util, structure, net_result: revenue - direct - structure, rank: 0 };
    });
    trucks.sort((a, b) => b.net_result - a.net_result).forEach((t, i) => (t.rank = i + 1));
    const fuel_anomalies = [44.8, 46.9, 47.3, 45.2, 46.6, 48.1, 45.9].map((v, i) => ({ rotation: `ROT-2026-${1480 + i * 9}`, date: addDays(p.date_to, -70 + i * 9), truck: "ER-07 · RC-4342-BM", route: ["Conakry - Kamsar", "Conakry - Kindia", "Conakry - Kamsar", "Conakry - Mamou", "Conakry - Kamsar", "Conakry - Boké", "Conakry - Kamsar"][i], value: v, expected: 39.1, score: r1((v - 39.1) / 1.6) }));
    fuel_anomalies.push({ rotation: "ROT-2026-1512", date: addDays(p.date_to, -22), truck: "ER-03 · RC-4194-BM", route: "Conakry - Labé", value: 51.4, expected: 38.6, score: 8.0 });
    const pricing = ROUTES.map((rt) => {
      const full = round(rt.tarif / (1 + rt.marge) * 1.0);
      const target = round(full / (1 - 0.3));
      const gap = r1(((rt.tarif - full) / full) * 100);
      return { route: rt.key, label: rt.label, avg_rate: rt.tarif, full_cost_m3: full, breakeven_rate: full, target_rate: target, gap_pct: gap, m3: round(cells.filter((c) => c.route === rt.key).reduce((s, c) => s + c.rotations, 0) * 38), recommendation: gap < 0 ? `Tarif sous le point mort : porter à ${new Intl.NumberFormat("fr-FR").format(target)} GNF/m³ ou arrêter.` : gap < 25 ? `Marge sous la cible : viser ${new Intl.NumberFormat("fr-FR").format(target)} GNF/m³ à la prochaine révision.` : "Tarif conforme à la cible : maintenir." };
    });
    const shortages = {
      tolerance_pct: 0.3,
      by_driver: CHAUFFEURS.map((c, i) => ({ key: `CH-${pad(i + 1)}`, label: c, volume: round(126000 * [0.26, 0.12, 0.11, 0.09, 0.08, 0.08, 0.07, 0.07, 0.06, 0.06][i]), value: 0, out_of_tolerance_pct: [38, 29, 12, 9, 7, 5, 4, 3, 2, 1][i] })).map((s) => ({ ...s, value: round(s.volume * 9200) })),
      by_route: ROUTES.map((rt, i) => ({ key: rt.key, label: rt.label, volume: round(126000 * [0.3, 0.08, 0.1, 0.12, 0.14, 0.11, 0.09, 0.06][i]), value: 0, out_of_tolerance_pct: [11, 6, 9, 15, 19, 16, 21, 12][i] })).map((s) => ({ ...s, value: round(s.volume * 9200) })),
      by_product: [["gasoil", "Gasoil", 0.68, 14], ["essence", "Essence", 0.21, 9], ["jet", "Jet A1", 0.07, 4], ["petrole", "Pétrole lampant", 0.04, 6]].map(([key, label, part, pct]) => ({ key, label, volume: round(126000 * part), value: round(126000 * part * 9200), out_of_tolerance_pct: pct })),
    };
    const scatter = [];
    for (let i = 0; i < 140; i++) {
      const rt = ROUTES[r.weighted(ROUTES.map((x, k) => [k, k === 0 ? 5 : 1.6]))];
      const truck = CAMIONS[r.int(0, 11)];
      scatter.push({ rotation: `ROT-2026-${1300 + i * 2}`, km: round(rt.km * 2 * r.noise(0.06)), margin_pct: r1(rt.marge * 100 + (r.next() * 2 - 1) * 9), m3: round(36 + r.next() * 8), route: rt.label, truck: truck.name });
    }
    return enveloppe(ctx, "groupe", p, qualiteGroupe, classer(constatsTransport()), {
      heatmap: { routes: ROUTES.map((rt) => ({ key: rt.key, label: rt.label })), months, cells },
      trucks, fuel_anomalies, pricing, shortages, scatter,
    });
  });

  route("GET", "/analyse/groupe/depenses", PROFILS_GROUPE, (ctx) => {
    exigerEntite(ctx, "groupe");
    const p = periode(ctx.query);
    const r = makeRng("analyse-depenses");
    const months = MOIS_MODELE.slice(-12);
    const achats = sommeSur(p, (l) => l.variables + l.fixes * 0.4);
    const cells = [];
    const repartition = { transport: 0.68, btp: 0.24, immobilier: 0.08 };
    const parCategorie = Object.fromEntries(CATEGORIES.map((c) => [c, sum(FOURNISSEURS.filter((f) => f.category === c), (f) => f.part)]));
    for (const cat of CATEGORIES) for (const act of ACTIVITES) for (const k of months) {
      const affinite = (cat === "Carburant" || cat === "Pièces et pneus" || cat === "Entretien") && act.key !== "transport" ? 0.08 : (cat === "Matériaux" || cat === "Sous-traitance BTP") && act.key !== "btp" ? 0.04 : cat === "Loyers" && act.key === "immobilier" ? 2.5 : 1;
      cells.push({ category: cat, activity: act.label, month: k, amount: round((achats / 12) * parCategorie[cat] * repartition[act.key] * affinite * r.noise(0.18)) });
    }
    let cumul = 0;
    const totalParts = sum(FOURNISSEURS, (f) => f.part);
    const pareto = [...FOURNISSEURS].sort((a, b) => b.part - a.part).map((f) => {
      cumul += f.part / totalParts;
      return { id: f.id, name: f.name, category: f.category, amount: round(achats * (f.part / totalParts)), share_pct: r1((f.part / totalParts) * 100), cumulative_pct: r1(cumul * 100), invoices: round(12 + f.part * 900), price_drift_pct: f.category === "Pièces et pneus" ? 23 : f.category === "Carburant" ? 6.5 : r1(-3 + r.next() * 9) };
    });
    const price_drift = ["Carburant", "Pièces et pneus", "Matériaux", "Entretien"].map((cat) => ({ category: cat, months, values: months.map((_, i) => round((cat === "Pièces et pneus" ? 58e6 + i * 1.7e6 + (i > 5 ? (i - 5) * 1.8e6 : 0) : cat === "Carburant" ? 760e6 * (1 + i * 0.006) : cat === "Matériaux" ? 290e6 : 120e6) * r.noise(0.04))) }));
    const observed = [29.4, 17.2, 12.1, 9.1, 11.3, 6.4, 5.6, 4.9, 4.0];
    const n = 1240;
    const digits = observed.map((o, i) => ({ d: i + 1, observed: o, expected: r1(log10Benford(i + 1)) }));
    const chi2 = r2(sum(digits, (d) => ((d.observed - d.expected) ** 2 / d.expected) * (n / 100)));
    const mad = r2(sum(digits, (d) => Math.abs(d.observed - d.expected)) / 9 / 100 * 100) / 100;
    const duplicates = [
      { a: "FAC-2026-0872", b: "FAC-2026-0891", supplier: "Pneus et Pièces Matoto (démo)", amount_a: 31.4e6, amount_b: 31.4e6, days_apart: 11, score: 0.94, reason: "Même montant, 11 jours d'écart, même référence externe BL-2271" },
      { a: "FAC-2026-0744", b: "FAC-2026-0801", supplier: "Béton Ouest Africain (démo)", amount_a: 28.9e6, amount_b: 28.7e6, days_apart: 24, score: 0.78, reason: "Montant à 0,7 % près, 24 jours d'écart" },
      { a: "FAC-2026-0913", b: "FAC-2026-0915", supplier: "Atelier Mécanique Sonfonia (démo)", amount_a: 14.6e6, amount_b: 14.6e6, days_apart: 2, score: 0.9, reason: "Même montant, 2 jours d'écart" },
      { a: "FAC-2026-0658", b: "FAC-2026-0699", supplier: "Orange Guinée Pro (démo)", amount_a: 5.8e6, amount_b: 5.8e6, days_apart: 29, score: 0.52, reason: "Même montant, 29 jours : abonnement mensuel probable" },
    ];
    const outliers = [
      { ref: "FAC-2026-0802", supplier: "Cabinet Juridique Kaloum (démo)", category: "Honoraires", amount: 142e6, median: 9e6, score: 7.8, date: addDays(p.date_to, -34) },
      { ref: "FAC-2026-0931", supplier: "Atelier Mécanique Sonfonia (démo)", category: "Entretien", amount: 68e6, median: 11e6, score: 5.1, date: addDays(p.date_to, -9) },
      { ref: "FAC-2026-0611", supplier: "Papeterie Centrale (démo)", category: "Fournitures", amount: 9.4e6, median: 1.2e6, score: 4.6, date: addDays(p.date_to, -88) },
      { ref: "FAC-2026-0877", supplier: "Électricité du Littoral (démo)", category: "Énergie", amount: 41e6, median: 17e6, score: 3.9, date: addDays(p.date_to, -18) },
      { ref: "FAC-2026-0702", supplier: "Fer et Aciers de Guinée (démo)", category: "Matériaux", amount: 212e6, median: 48e6, score: 3.7, date: addDays(p.date_to, -61) },
    ];
    return enveloppe(ctx, "groupe", p, qualiteGroupe, classer(constatsDepenses()), {
      cube: { categories: CATEGORIES, activities: ACTIVITES.map((a) => a.label), months, cells },
      suppliers: { pareto, price_drift },
      benford: { digits, n, chi2, mad, conformity: mad < 0.006 ? "conformité proche" : mad < 0.012 ? "conformité acceptable" : mad < 0.015 ? "conformité marginale" : "non-conformité", suspicious: [5] },
      duplicates, outliers,
    });
  });

  route("GET", "/analyse/groupe/previsions", PROFILS_GROUPE, (ctx) => {
    exigerEntite(ctx, "groupe");
    const p = periode(ctx.query);
    return enveloppe(ctx, "groupe", p, qualiteGroupe, classer(constatsPrevisions(p)), previsionsGroupe(p));
  });

  route("GET", "/analyse/groupe/fiabilite", PROFILS_GROUPE, (ctx) => {
    exigerEntite(ctx, "groupe");
    const p = periode(ctx.query);
    const checks = [
      { key: "analytique", label: "Écritures de charge avec axe Activité", value: 92.9, target: 98, unit: "pct", status: "warn", detail: "312 écritures (1,9 Mds GNF) sans imputation analytique.", link: "/finance/admin/imputations", weight: 3 },
      { key: "rapprochement", label: "Comptes bancaires rapprochés à 7 jours", value: 2, target: 3, unit: "count", status: "bad", detail: "BICIGUI non rapproché depuis 23 jours (214 lignes).", link: "/finance/tresorerie/rapprochement", weight: 3 },
      { key: "justificatifs", label: "Pièces avec justificatif joint", value: 96.4, target: 100, unit: "pct", status: "warn", detail: "87 pièces d'achat sans facture scannée.", link: "/finance/achats", weight: 2 },
      { key: "delai_saisie", label: "Délai moyen de saisie", value: 9.2, target: 10, unit: "days", status: "good", detail: "41 pièces saisies plus de 30 jours après leur date.", link: "/finance/achats", weight: 1 },
      { key: "brouillons", label: "Brouillons de plus de 30 jours", value: 6, target: 0, unit: "count", status: "warn", detail: "Six factures d'achat en brouillon depuis septembre.", link: "/finance/achats?state=draft", weight: 1 },
      { key: "attente", label: "Comptes d'attente non soldés", value: 0, target: 0, unit: "count", status: "good", detail: "Comptes 47 soldés.", link: "/finance/clotures", weight: 2 },
      { key: "nif", label: "Tiers actifs avec NIF", value: 99.1, target: 95, unit: "pct", status: "good", detail: "3 tiers sans NIF, tous inactifs depuis 2024.", link: "/finance/tiers", weight: 1 },
      { key: "rotations", label: "Rotations validées non facturées à 15 jours", value: 9, target: 0, unit: "count", status: "warn", detail: "Neuf rotations de septembre attendent leur facture (118 M GNF).", link: "/finance/transport", weight: 2 },
    ];
    const notes = { good: 100, warn: 60, bad: 20 };
    const score = round(sum(checks, (c) => notes[c.status] * c.weight) / sum(checks, (c) => c.weight));
    const history = MOIS_MODELE.slice(-12).map((k, i) => ({ month: k, score: round(84 + Math.sin(i / 2) * 4 + i * 0.5) }));
    history[history.length - 1].score = score;
    return enveloppe(ctx, "groupe", p, { score, notes: qualiteGroupe.notes }, classer(constatsFiabilite()), { score, checks, history });
  });

  /* ════════════════════════════════════════════════════════════════════
   * MB AxisPro Consulting : portefeuille de projets
   * ════════════════════════════════════════════════════════════════════ */

  const GATES = [["G1", "Screening"], ["G2", "Pré-faisabilité"], ["G3", "Faisabilité"], ["G4", "APD Ready"], ["G5", "Due diligence"], ["G6", "Bankability"]];
  const SECTEURS = ["Agro-industrie", "Énergie", "Pêche", "Mines et carrières", "Santé", "Transport et logistique", "Immobilier", "Éducation"];
  const LIEUX = ["Conakry", "Kankan", "Kindia", "Labé", "Boké", "N'Zérékoré", "Mamou"];
  const DOMAINES = [["GOV", "Gouvernance"], ["MAR", "Marché"], ["TEC", "Technique"], ["FIN", "Financier"], ["JUR", "Juridique"], ["ESG", "Environnement et social"], ["EQU", "Équipe"], ["DOC", "Documentation"]];
  const CONSULTANTS = ["Aïssatou Barry", "Thierno Diallo", "Aminata Keïta", "Mamadou Saliou Sow", "Fatou Bangoura"];
  const SERVICES = [["gestion", "Gestion de projets"], ["formation", "Formation et coaching"], ["conseil", "Conseil"], ["audit", "Audit d'évaluation des transporteurs"], ["certification", "Certification"]];
  const DOSSIERS = [
    ["AXP-2025-004", "Rizerie moderne de Kankan", "Agro-industrie", "Kankan", 5, 71, 68, 8.4e9, 12.1e9],
    ["AXP-2025-007", "Laiterie du Fouta", "Agro-industrie", "Labé", 4, 66, 54, 3.2e9, 4.6e9],
    ["AXP-2025-009", "Pêcheries de Kamsar", "Pêche", "Boké", 3, 58, 41, 5.6e9, 7.9e9],
    ["AXP-2025-011", "Centrale solaire de Kindia", "Énergie", "Kindia", 6, 82, 79, 21e9, 28e9],
    ["AXP-2025-013", "Clinique Sainte-Marie", "Santé", "Conakry", 2, 44, 28, 2.1e9, 3.0e9],
    ["AXP-2026-001", "Carrière de granit de Mamou", "Mines et carrières", "Mamou", 3, 52, 39, 6.8e9, 9.4e9],
    ["AXP-2026-002", "Plateforme logistique de Matoto", "Transport et logistique", "Conakry", 4, 69, 61, 9.1e9, 13.5e9],
    ["AXP-2026-003", "Résidence étudiante de Sonfonia", "Immobilier", "Conakry", 2, 38, 22, 4.4e9, 6.2e9],
    ["AXP-2026-005", "Huilerie de palme de N'Zérékoré", "Agro-industrie", "N'Zérékoré", 3, 61, 47, 3.9e9, 5.3e9],
    ["AXP-2026-006", "Lycée technique privé de Labé", "Éducation", "Labé", 1, 31, 15, 1.8e9, 2.4e9],
    ["AXP-2026-008", "Mini-réseau hydroélectrique de Dalaba", "Énergie", "Mamou", 4, 64, 57, 12.6e9, 16.8e9],
    ["AXP-2026-010", "Chaîne du froid de Kindia", "Agro-industrie", "Kindia", 2, 47, 33, 2.7e9, 3.6e9],
    ["AXP-2026-012", "Transport fluvial du Milo", "Transport et logistique", "Kankan", 1, 27, 12, 3.3e9, 4.1e9],
    ["AXP-2026-014", "Unité de transformation de cajou", "Agro-industrie", "Boké", 3, 55, 44, 4.8e9, 6.9e9],
  ].map(([reference, name, sector, location, gate, readiness, bankability, need, investment], i) => ({ id: 1 + i, reference, name, sector, location, gate, readiness, bankability, need, investment, knockout: i === 4 || i === 12 }));
  const probaBancabilite = (d) => (d.knockout ? 0 : r2(1 / (1 + Math.exp(-(d.bankability - 65) / 7.5))));
  const recommandation = (d) => (d.knockout ? "no_go" : d.bankability >= 75 ? "bankable" : d.readiness >= 65 ? "apd_ready" : d.readiness >= 50 ? "conditional" : d.readiness >= 30 ? "hold" : "pending");

  function entonnoirCabinet() {
    return GATES.map(([gate, label], i) => {
      const dans = DOSSIERS.filter((d) => d.gate >= i + 1);
      const avant = i === 0 ? null : DOSSIERS.filter((d) => d.gate >= i).length;
      return { gate, label, count: dans.length, need: sum(dans, (d) => d.need), investment: sum(dans, (d) => d.investment), conversion_pct: avant === null ? null : r1((dans.length / avant) * 100) };
    });
  }

  function kpisCabinet(p) {
    const actifs = DOSSIERS.length;
    const besoin = sum(DOSSIERS, (d) => d.need);
    const pondere = sum(DOSSIERS, (d) => d.need * probaBancabilite(d));
    const readiness = sum(DOSSIERS, (d) => d.readiness) / actifs;
    const honoraires = sommeHonoraires(p);
    const honorairesPrev = sommeHonoraires(p.previous);
    const k = (key, label, value, unit, previous, target, status, definition, trend, inverse = false) => ({ key, label, value: unit === "gnf" ? round(value) : r2(value), unit, previous: previous === null ? null : unit === "gnf" ? round(previous) : r2(previous), target, delta_pct: previous === null ? null : variation(value, previous), trend, status, definition, inverse });
    return [
      k("dossiers", "Dossiers actifs", actifs, "count", 11, 15, "good", "Dossiers ouverts ou en attente, hors clos.", [9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14]),
      k("need", "Besoin de financement total", besoin, "gnf", 71e9, null, "neutral", "Somme des besoins de financement des dossiers actifs.", [58, 61, 63, 66, 68, 71, 74, 78, 81, 84, 88, 90].map((v) => v * 1e9)),
      k("pipeline", "Pipeline pondéré", pondere, "gnf", 24.8e9, 35e9, pondere >= 24.8e9 ? "good" : "warn", "Besoin × probabilité de bancabilité (logistique sur le score Bankability : 50 → 0,2 ; 65 → 0,5 ; 80 → 0,8), nulle si knock-out actif.", [16, 17, 19, 20, 22, 23, 24, 25, 27, 28, 30, 31].map((v) => v * 1e9)),
      k("readiness", "Score Readiness moyen", readiness, "score", 52.3, 60, readiness >= 55 ? "good" : "warn", "Moyenne des scores Project Readiness des dossiers actifs.", [48, 49, 50, 51, 52, 52, 53, 54, 55, 55, 56, 57]),
      k("gate_pass", "Taux de passage de gate", 71, "pct", 64, 75, "warn", "Décisions GO ou GO sous conditions rapportées aux comités tenus sur 12 mois.", [60, 62, 61, 65, 66, 64, 68, 69, 70, 69, 71, 71]),
      k("gate_days", "Durée médiane d'un gate", 62, "days", 71, 45, "warn", "Jours entre deux passages de gate (journal des gates), médiane 12 mois.", [78, 76, 74, 72, 71, 70, 68, 66, 65, 64, 63, 62], true),
      k("fees", "Honoraires de la période", honoraires, "gnf", honorairesPrev, round(honorairesPrev * 1.15), honoraires >= honorairesPrev ? "good" : "warn", "Factures d'honoraires validées, hors taxes.", MOIS_MODELE.slice(-12).map((k2) => honorairesMois(k2))),
      k("realization", "Taux de réalisation", 78.4, "pct", 82.1, 85, "warn", "Honoraires facturés rapportés à la valeur du temps passé (heures × taux standard).", [84, 83, 82, 82, 81, 80, 80, 79, 79, 78, 78, 78.4]),
    ];
  }
  function honorairesMois(k) {
    const r = makeRng(`honoraires-${k}`);
    const i = MOIS_MODELE.indexOf(k);
    const m = +k.slice(5, 7);
    return round(0.205e9 * (1 + 0.09 * ((i - 35) / 12)) * (m === 8 ? 0.7 : m === 12 ? 1.25 : 1) * r.noise(0.12));
  }
  function sommeHonoraires(p) {
    const mois = moisEntre(p.date_from, p.date_to);
    const poids = poidsMois(mois, p);
    return sum(mois, (k, i) => honorairesMois(k) * poids[i]);
  }
  const qualiteCabinet = { score: 88, notes: ["2 dossiers sans évaluation à jour depuis 60 jours", "Temps non saisi : 3 semaines pour un consultant"] };

  function constatsCabinet() {
    return [
      constat({ id: "cabinet.goulot_g3", domain: "portefeuille", severity: "high", title: "La faisabilité (G3) retient les dossiers 94 jours", narrative: "Cinq dossiers attendent en G3 depuis 94 jours en médiane, contre 45 visés : l'étude de marché et le modèle financier manquent dans quatre cas sur cinq. C'est le gate le plus lent rapporté au nombre de dossiers.", metric: { label: "Médiane en G3", value: 94, unit: "days", reference: 45, reference_label: "Cible" }, impact_gnf: 0.46e9, confidence: 0.84, method: "Journal des passages de gate : jours entre l'entrée et la sortie de chaque gate, médiane et p75 ; goulot = médiane × dossiers présents.", evidence: { type: "bars", data: { labels: GATES.map((g) => g[0]), values: [21, 38, 94, 57, 48, 36], unit: "days", highlight: 2 } }, action: "Créer une offre « étude de marché express » (15 jours) et un atelier modèle financier mensuel pour les porteurs.", link: "/analyse/portefeuille" }),
      constat({ id: "cabinet.pipeline_pondere", domain: "portefeuille", severity: "positive", title: "Le pipeline pondéré atteint 31 Mds GNF, porté par deux projets d'énergie", narrative: "La centrale solaire de Kindia (probabilité 0,86) et le mini-réseau de Dalaba (0,33) représentent 60 % du pipeline pondéré. Trois dossiers devraient atteindre Bankability dans six mois.", metric: { label: "Pipeline pondéré", value: 31e9, unit: "gnf", reference: 24.8e9, reference_label: "N-1" }, impact_gnf: 31e9, confidence: 0.78, method: "Besoin × probabilité de bancabilité (fonction logistique du score Bankability), nulle si knock-out.", evidence: null, action: "Préparer dès maintenant le dossier bancaire de Kindia : term sheet et data room complète.", link: "/analyse/portefeuille" }),
      constat({ id: "cabinet.faiblesse_financier", domain: "diagnostic", severity: "high", title: "Le domaine Financier est le maillon faible de 9 dossiers sur 14", narrative: "Score moyen de 41/100 : plan de trésorerie absent dans 8 dossiers, hypothèses de prix non documentées dans 7. Un thème de formation évident.", metric: { label: "Score Financier moyen", value: 41, unit: "score", reference: 60, reference_label: "Seuil GO" }, impact_gnf: null, confidence: 0.9, method: "Score par domaine (moyenne pondérée des critères évalués) sur l'évaluation la plus récente de chaque dossier ; fréquence des critères « non disponible » ou « incomplet ».", evidence: { type: "bars", data: { labels: DOMAINES.map((d) => d[1]), values: [58, 54, 62, 41, 49, 57, 66, 45], unit: "score", highlight: 3 } }, action: "Lancer une formation « Modèle financier bancable » (ligne Formation et coaching) : 9 porteurs concernés, 180 M GNF de chiffre d'affaires potentiel.", link: "/analyse/diagnostic" }),
      constat({ id: "cabinet.knockout_clinique", domain: "diagnostic", severity: "critical", title: "Deux dossiers portent un critère éliminatoire actif", narrative: "La Clinique Sainte-Marie n'a pas d'autorisation d'exercice ; le Transport fluvial du Milo n'a pas de titre sur ses quais. Leur probabilité de bancabilité est nulle tant que le knock-out tient.", metric: { label: "Knock-outs actifs", value: 2, unit: "count", reference: 0, reference_label: "Attendu" }, impact_gnf: 5.4e9, confidence: 0.98, method: "Critères marqués éliminatoires dans la politique d'évaluation et non satisfaits sur la dernière évaluation.", evidence: null, action: "Fixer un délai de 60 jours au porteur pour lever le knock-out, sinon suspendre le dossier.", link: "/analyse/diagnostic" }),
      constat({ id: "cabinet.accord_comite", domain: "comites", severity: "medium", title: "Le comité s'écarte de la méthode une fois sur quatre", narrative: "Taux d'accord recommandation × décision de 76 % ; les écarts sont presque tous des GO sous conditions accordés à des HOLD recommandés, et deux passages de gate ont été forcés.", metric: { label: "Taux d'accord", value: 76, unit: "pct", reference: 85, reference_label: "Cible" }, impact_gnf: null, confidence: 0.88, method: "Matrice recommandation de la méthode (score) × décision du comité, sur les revues verrouillées des 12 derniers mois.", evidence: null, action: "Motiver par écrit tout écart à la recommandation et revoir les seuils si les écarts se répètent.", link: "/analyse/comites" }),
      constat({ id: "cabinet.realisation", domain: "activite", severity: "medium", title: "Le taux de réalisation glisse à 78 % : 290 M GNF de temps non facturé", narrative: "Les heures passées valent 1,32 Md GNF au taux standard, 1,03 Md ont été facturés. Le dossier Pêcheries de Kamsar absorbe 210 heures non facturées.", metric: { label: "Taux de réalisation", value: 78.4, unit: "pct", reference: 85, reference_label: "Cible" }, impact_gnf: 0.29e9, confidence: 0.86, method: "Honoraires facturés / (heures saisies × taux standard), par dossier et par consultant.", evidence: null, action: "Facturer les heures de Kamsar au forfait convenu et plafonner le temps des dossiers en G1-G2.", link: "/analyse/activite" }),
      constat({ id: "cabinet.financements_dfi", domain: "financements", severity: "positive", title: "Les institutions de développement financent 64 % des montants obtenus", narrative: "21 Mds GNF obtenus sur 12 mois, dont 13,4 auprès des DFI avec un taux de succès de 58 % ; les banques commerciales n'accordent que 23 % des demandes.", metric: { label: "Taux de succès DFI", value: 58, unit: "pct", reference: 23, reference_label: "Banques" }, impact_gnf: 13.4e9, confidence: 0.85, method: "Montants obtenus / montants demandés par type de financeur, démarches closes.", evidence: null, action: "Orienter d'abord les dossiers d'énergie et d'agro-industrie vers les DFI.", link: "/analyse/financements" }),
      constat({ id: "cabinet.actions_retard", domain: "risques", severity: "high", title: "17 actions en retard, dont 9 chez les porteurs", narrative: "Le délai médian de réponse des porteurs à une pièce demandée est de 19 jours ; Résidence de Sonfonia et Lycée de Labé dépassent 40 jours.", metric: { label: "Actions en retard", value: 17, unit: "count", reference: 5, reference_label: "Seuil" }, impact_gnf: null, confidence: 0.92, method: "Plans d'actions : actions ouvertes dont l'échéance est dépassée ; délai pièce demandée → déposée.", evidence: null, action: "Relance automatique à J+7 et point hebdomadaire avec les deux porteurs les plus lents.", link: "/analyse/risques" }),
      constat({ id: "cabinet.honoraires_tendance", domain: "activite", severity: "info", title: "Les honoraires progressent de 9 % sur un an", narrative: "Le conseil et la gestion de projets portent la croissance ; la certification stagne.", metric: { label: "Croissance des honoraires", value: 9, unit: "pct", reference: null, reference_label: null }, impact_gnf: 0.2e9, confidence: 0.85, method: "Factures d'honoraires validées, 12 mois glissants contre les 12 précédents.", evidence: null, action: null, link: "/analyse/activite" }),
    ];
  }
  const constatsDomaine = (domain) => constatsCabinet().filter((c) => c.domain === domain);

  route("GET", "/analyse/cabinet/synthese", PROFILS_CABINET, (ctx) => {
    exigerEntite(ctx, "cabinet");
    const p = periode(ctx.query);
    return enveloppe(ctx, "cabinet", p, qualiteCabinet, classer(constatsCabinet(), 10), {
      kpis: kpisCabinet(p),
      funnel: entonnoirCabinet(),
      maturity: DOSSIERS.map((d) => ({ id: d.id, reference: d.reference, name: d.name, readiness: d.readiness, bankability: d.bankability, need: d.need, recommendation: recommandation(d), sector: d.sector, gate: GATES[d.gate - 1][0] })),
    });
  });

  route("GET", "/analyse/cabinet/portefeuille", PROFILS_CABINET, (ctx) => {
    exigerEntite(ctx, "cabinet");
    const p = periode(ctx.query);
    const medianes = [21, 38, 94, 57, 48, 36];
    const time_in_gate = GATES.map(([gate, label], i) => ({ gate, label, median_days: medianes[i], p75_days: round(medianes[i] * 1.45), n: DOSSIERS.filter((d) => d.gate >= i + 1).length }));
    const grouper = (cle, liste) => liste.map((l) => {
      const ds = DOSSIERS.filter((d) => d[cle] === l);
      return { key: l, label: l, count: ds.length, need: sum(ds, (d) => d.need), avg_score: ds.length ? r1(sum(ds, (d) => d.readiness) / ds.length) : 0 };
    }).filter((g) => g.count > 0);
    const dossiers = DOSSIERS.map((d) => ({ id: d.id, reference: d.reference, name: d.name, need: d.need, probability: probaBancabilite(d), weighted: round(d.need * probaBancabilite(d)), knockout: d.knockout })).sort((a, b) => b.weighted - a.weighted);
    return enveloppe(ctx, "cabinet", p, qualiteCabinet, classer(constatsDomaine("portefeuille").concat(constatsDomaine("diagnostic").slice(0, 1))), {
      funnel: entonnoirCabinet(),
      time_in_gate,
      bottleneck: { gate: "G3", label: "Faisabilité", days_per_dossier: 94, comment: "Cinq dossiers y attendent l'étude de marché et le modèle financier." },
      by_sector: grouper("sector", SECTEURS),
      by_location: grouper("location", LIEUX),
      pipeline_value: { weighted: sum(dossiers, (d) => d.weighted), raw: sum(dossiers, (d) => d.need), dossiers },
      forecast: { apd_3m: 2, apd_6m: 4, bankability_3m: 1, bankability_6m: 3, velocity: GATES.map(([gate], i) => ({ gate, dossiers_per_month: r2([1.4, 0.9, 0.5, 0.6, 0.5, 0.4][i]) })) },
    });
  });

  route("GET", "/analyse/cabinet/diagnostic", PROFILS_CABINET, (ctx) => {
    exigerEntite(ctx, "cabinet");
    const p = periode(ctx.query);
    const r = makeRng("analyse-diagnostic");
    const moyennes = [58, 54, 62, 41, 49, 57, 66, 45];
    const cells = [];
    for (const d of DOSSIERS) for (const [code] of DOMAINES) {
      const base = moyennes[DOMAINES.findIndex((x) => x[0] === code)];
      const score = d.gate === 1 && r.chance(0.3) ? null : Math.max(5, Math.min(98, round(base + (d.readiness - 55) * 0.8 + (r.next() * 2 - 1) * 12)));
      cells.push({ dossier: d.reference, domain: code, score, priority: score === null ? null : score < 40 ? "high" : score < 60 ? "medium" : "low" });
    }
    const top_gaps = [
      ["FIN-03", "Plan de trésorerie à 36 mois", "Financier", 8, 2.7, "Modèle financier bancable"], ["FIN-01", "Hypothèses de prix et de volume documentées", "Financier", 7, 2.5, "Modèle financier bancable"], ["MAR-02", "Étude de marché datée de moins de 2 ans", "Marché", 7, 2.4, "Étude de marché express"],
      ["DOC-04", "États financiers certifiés (3 exercices)", "Documentation", 6, 2.6, "Mise à niveau comptable"], ["JUR-02", "Titres fonciers ou baux enregistrés", "Juridique", 6, 2.8, "Sécurisation foncière"], ["ESG-01", "Étude d'impact environnemental", "Environnement et social", 5, 2.2, "Conformité ESG"],
      ["GOV-03", "Organes de gouvernance formalisés", "Gouvernance", 5, 1.9, "Gouvernance d'entreprise"], ["TEC-02", "Devis fournisseurs fermes", "Technique", 4, 2.0, "Ingénierie des coûts"], ["EQU-01", "Équipe dirigeante au complet", "Équipe", 4, 2.1, "Recrutement et coaching"],
    ].map(([code, label, domain, frequency, avg_priority, theme]) => ({ code, label, domain, frequency, frequency_pct: r1((frequency / DOSSIERS.length) * 100), avg_priority, dossiers: DOSSIERS.filter((d) => d.readiness < 70).slice(0, frequency).map((d) => d.reference), theme }));
    const knockouts = [
      { code: "JUR-KO1", label: "Autorisation d'exercice ou licence sectorielle", count: 1, dossiers: ["AXP-2025-013"] },
      { code: "JUR-KO2", label: "Titre de propriété ou droit d'usage du site", count: 1, dossiers: ["AXP-2026-012"] },
      { code: "GOV-KO1", label: "Promoteur sans interdiction bancaire", count: 0, dossiers: [] },
    ];
    const dates = ["2026-01-15", "2026-03-15", "2026-05-15", "2026-07-15", "2026-09-15", p.date_to];
    const progression = { dates, dossiers: DOSSIERS.slice(0, 8).map((d, i) => {
      const rr = makeRng(`progression-${i}`);
      return { id: d.id, reference: d.reference, scores: dates.map((_, j) => (j < 6 - Math.min(5, d.gate + 1) ? null : Math.max(5, round(d.readiness - (5 - j) * (3 + rr.next() * 4))))) };
    }) };
    return enveloppe(ctx, "cabinet", p, qualiteCabinet, classer(constatsDomaine("diagnostic")), {
      domain_heatmap: { dossiers: DOSSIERS.map((d) => ({ id: d.id, reference: d.reference, name: d.name })), domains: DOMAINES.map(([code, label]) => ({ code, label })), cells },
      top_gaps, knockouts,
      evidence: { coverage_pct: 71, expired: 9, missing: 34, missing_by_age: [["< 15 j", 11], ["15-30 j", 9], ["31-60 j", 8], ["> 60 j", 6]].map(([bucket, count]) => ({ bucket, count })) },
      progression,
    });
  });

  route("GET", "/analyse/cabinet/comites", PROFILS_CABINET, (ctx) => {
    exigerEntite(ctx, "cabinet");
    const p = periode(ctx.query);
    const months = MOIS_MODELE.slice(-12);
    const r = makeRng("analyse-comites");
    const series = [["go", "GO"], ["conditional", "GO sous conditions"], ["hold", "HOLD"], ["no_go", "NO-GO"], ["postponed", "Ajourné"]].map(([key, label]) => ({ key, label, values: months.map(() => (key === "go" ? r.int(1, 3) : key === "conditional" ? r.int(0, 2) : key === "hold" ? r.int(0, 2) : r.chance(0.25) ? 1 : 0)) }));
    const recommendations = ["GO", "GO sous conditions", "HOLD", "NO-GO"];
    const matrix = [
      [11, 2, 0, 0],
      [1, 7, 1, 0],
      [0, 4, 5, 0],
      [0, 0, 1, 2],
    ];
    const total = sum(matrix.flat());
    const accord = sum(matrix.map((l, i) => l[i]));
    return enveloppe(ctx, "cabinet", p, qualiteCabinet, classer(constatsDomaine("comites").concat(constatsDomaine("portefeuille").slice(0, 2))), {
      decisions: { months, series },
      agreement: { recommendations, decisions: recommendations, matrix, agreement_pct: r1((accord / total) * 100) },
      forced_gates: [
        { dossier: "AXP-2025-009", gate: "G3", date: "2026-06-18", reason: "Financeur en attente du dossier de faisabilité", score: 48 },
        { dossier: "AXP-2026-002", gate: "G4", date: "2026-09-02", reason: "Échéance d'appel à projets", score: 61 },
      ],
      time_to_decision: { median_days: 34, p75_days: 52, n: 34, by_month: months.map((k, i) => ({ month: k, days: round(42 - i * 0.7 + Math.sin(i) * 4) })) },
      score_at_decision: [["go", "GO", [72, 78, 81, 69, 74, 88, 77, 70, 83, 76, 79, 71]], ["conditional", "GO sous conditions", [54, 58, 61, 52, 57, 63, 55, 59, 49, 56, 60, 53, 51]], ["hold", "HOLD", [38, 44, 41, 35, 47, 39, 42]], ["no_go", "NO-GO", [18, 24, 29]], ["postponed", "Ajourné", [46, 51]]].map(([decision, label, scores]) => ({ decision, label, scores })),
    });
  });

  route("GET", "/analyse/cabinet/financements", PROFILS_CABINET, (ctx) => {
    exigerEntite(ctx, "cabinet");
    const p = periode(ctx.query);
    const FINANCEURS = [["banque", "Banques commerciales"], ["dfi", "Institutions de développement"], ["fonds", "Fonds d'investissement"], ["microfinance", "Microfinance"], ["public", "Bailleurs publics"]];
    const ETATS = [["instruction", "En instruction"], ["accord", "Accord de principe"], ["signe", "Signé ou décaissé"], ["refuse", "Refusé"]];
    const nodes = [...["Agro-industrie", "Énergie", "Pêche", "Mines et carrières", "Transport et logistique", "Immobilier"].map((s) => ({ id: `s:${s}`, label: s, group: "sector" })), ...FINANCEURS.map(([k, l]) => ({ id: `f:${k}`, label: l, group: "funder" })), ...ETATS.map(([k, l]) => ({ id: `e:${k}`, label: l, group: "state" }))];
    const flux = [
      ["Agro-industrie", "banque", 3.1], ["Agro-industrie", "dfi", 6.4], ["Agro-industrie", "microfinance", 0.9], ["Énergie", "dfi", 14.2], ["Énergie", "fonds", 7.8], ["Énergie", "banque", 2.6], ["Pêche", "banque", 2.2], ["Pêche", "public", 1.4],
      ["Mines et carrières", "banque", 4.1], ["Mines et carrières", "fonds", 2.7], ["Transport et logistique", "banque", 5.2], ["Transport et logistique", "dfi", 3.9], ["Immobilier", "banque", 2.8], ["Immobilier", "fonds", 1.6],
    ].map(([s, f, v]) => ({ source: `s:${s}`, target: `f:${f}`, value: v * 1e9 }));
    const repartition = { banque: [0.38, 0.14, 0.23, 0.25], dfi: [0.22, 0.2, 0.58, 0.0], fonds: [0.44, 0.18, 0.3, 0.08], microfinance: [0.1, 0.1, 0.8, 0.0], public: [0.5, 0.2, 0.3, 0.0] };
    const parFinanceur = Object.fromEntries(FINANCEURS.map(([k]) => [k, sum(flux.filter((l) => l.target === `f:${k}`), (l) => l.value)]));
    const links = [...flux, ...FINANCEURS.flatMap(([k]) => ETATS.map(([e], i) => ({ source: `f:${k}`, target: `e:${e}`, value: round(parFinanceur[k] * repartition[k][i]) })).filter((l) => l.value > 0))];
    const by_funder = FINANCEURS.map(([key, label], i) => {
      const requested = parFinanceur[key];
      const granted = round(requested * repartition[key][2]);
      const clos = repartition[key][2] + repartition[key][3];
      return { key, label, type: label, requested: round(requested), granted, success_pct: clos ? r1((repartition[key][2] / clos) * 100) : null, avg_ticket: round(requested / [7, 5, 4, 1, 1][i]), avg_days: [142, 210, 168, 61, 240][i], count: [7, 5, 4, 1, 1][i] };
    });
    const pipeline = ETATS.map(([state, label], i) => ({ state, label, count: [9, 4, 6, 3][i], amount: round(sum(FINANCEURS, ([k]) => parFinanceur[k] * repartition[k][i])) }));
    return enveloppe(ctx, "cabinet", p, qualiteCabinet, classer(constatsDomaine("financements").concat(constatsDomaine("portefeuille"))), { flows: { nodes, links }, by_funder, pipeline });
  });

  route("GET", "/analyse/cabinet/activite", PROFILS_ACTIVITE, (ctx) => {
    exigerEntite(ctx, "cabinet");
    const p = periode(ctx.query);
    const r = makeRng("analyse-activite");
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(p.date_to, -7 * (11 - i) - ((new Date(p.date_to).getUTCDay() + 6) % 7)));
    const cells = CONSULTANTS.flatMap((c, i) => weeks.map((w, j) => ({ consultant: c, week: w, hours: i === 4 && j >= 6 && j <= 8 ? 0 : r1(Math.max(0, 28 + [8, 6, 4, 2, -3][i] + Math.sin(j / 2 + i) * 6 + (r.next() * 2 - 1) * 5)) })));
    const taux = 180000;
    const by_dossier = DOSSIERS.map((d, i) => {
      const hours = r1(60 + d.gate * 38 + (i === 2 ? 210 : 0) + r.next() * 40);
      return { id: d.id, reference: d.reference, name: d.name, hours, billable_hours: r1(hours * (i === 2 ? 0.55 : 0.82 + r.next() * 0.12)) };
    });
    const by_service = SERVICES.map(([key, label], i) => ({ key, label, hours: round([1420, 380, 960, 310, 150][i] * r.noise(0.05)) }));
    const realisationDossier = by_dossier.map((d) => {
      const value = round(d.hours * taux);
      const billed = round(d.billable_hours * taux * (0.9 + r.next() * 0.1));
      return { id: d.id, reference: d.reference, value, billed, realization_pct: r1((billed / value) * 100) };
    });
    const by_consultant = CONSULTANTS.map((name, i) => {
      const hours = round(sum(cells.filter((c) => c.consultant === name), (c) => c.hours));
      const value = hours * taux;
      const billed = round(value * [0.86, 0.81, 0.74, 0.79, 0.68][i]);
      return { name, value, billed, realization_pct: r1((billed / value) * 100), hours };
    });
    const valeur = sum(realisationDossier, (d) => d.value);
    const facture = sum(realisationDossier, (d) => d.billed);
    const months = MOIS_MODELE.slice(-12);
    const parts = [0.46, 0.12, 0.3, 0.08, 0.04];
    const revenue = { monthly: { months, series: SERVICES.map(([key, label], i) => ({ key, label, unit: "gnf", values: months.map((k) => round(honorairesMois(k) * parts[i] * r.noise(0.15))) })) }, receivables: { open: 0.62e9, overdue: 0.19e9 } };
    const base = sum(months.slice(-3), (k) => honorairesMois(k)) / 3;
    const futurs = moisJusqua(addDays(`${p.date_to.slice(0, 7)}-28`, 95), 3);
    return enveloppe(ctx, "cabinet", p, qualiteCabinet, classer(constatsDomaine("activite")), {
      time: { consultants: CONSULTANTS, weeks, cells, by_dossier, by_service },
      realization: { overall_pct: r1((facture / valeur) * 100), effective_rate: round(facture / sum(by_dossier, (d) => d.hours)), standard_rate: taux, by_dossier: realisationDossier, by_consultant },
      profitability: { cost_rate_pct: 40, rows: realisationDossier.map((d) => { const dossier = by_dossier.find((x) => x.id === d.id); const cost = round(dossier.hours * taux * 0.4); return { id: d.id, reference: d.reference, name: dossier.name, fees: d.billed, cost, margin: d.billed - cost, margin_pct: r1(((d.billed - cost) / Math.max(1, d.billed)) * 100) }; }) },
      revenue,
      forecast: { months: futurs, fees: futurs.map((_, i) => round(base * (1.02 + i * 0.015))), low: futurs.map((_, i) => round(base * (0.9 - i * 0.03))), high: futurs.map((_, i) => round(base * (1.14 + i * 0.05))), backlog_hours: round(sum(by_dossier, (d) => d.billable_hours) * 0.22), backlog_value: round(sum(by_dossier, (d) => d.billable_hours) * 0.22 * taux), method: "Lissage de Holt (niveau et tendance) sur 24 mois" },
    });
  });

  route("GET", "/analyse/cabinet/risques", PROFILS_CABINET, (ctx) => {
    exigerEntite(ctx, "cabinet");
    const p = periode(ctx.query);
    const risques = [
      [4, 5, "Retard d'obtention de la licence (Clinique Sainte-Marie)"], [3, 4, "Hausse du coût des panneaux (Centrale de Kindia)"], [3, 4, "Dépendance à un acheteur unique (Rizerie de Kankan)"], [2, 5, "Contestation foncière (Transport fluvial du Milo)"],
      [4, 3, "Taux de change USD/GNF (Mini-réseau de Dalaba)"], [2, 3, "Départ du directeur technique (Huilerie de N'Zérékoré)"], [3, 2, "Saisonnalité des approvisionnements (Laiterie du Fouta)"], [1, 4, "Inondation du site (Pêcheries de Kamsar)"],
      [2, 2, "Retard de raccordement électrique (Chaîne du froid)"], [3, 3, "Concurrence informelle (Carrière de Mamou)"], [1, 2, "Rotation du personnel (Lycée de Labé)"], [4, 2, "Retard des pièces du porteur (Résidence de Sonfonia)"], [2, 4, "Refus de garantie bancaire (Plateforme de Matoto)"],
    ];
    const cells = [];
    for (let pr = 1; pr <= 5; pr++) for (let im = 1; im <= 5; im++) {
      const liste = risques.filter(([a, b]) => a === pr && b === im).map(([, , n]) => n);
      const s = pr * im;
      cells.push({ probability: pr, impact: im, count: liste.length, criticality: s >= 16 ? "critical" : s >= 10 ? "high" : s >= 5 ? "medium" : "low", risks: liste });
    }
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(p.date_to, -7 * (11 - i)));
    const r = makeRng("analyse-risques");
    return enveloppe(ctx, "cabinet", p, qualiteCabinet, classer(constatsDomaine("risques").concat(constatsDomaine("diagnostic").slice(1))), {
      risk_matrix: { cells, open: risques.length, critical: cells.filter((c) => c.criticality === "critical").reduce((s, c) => s + c.count, 0), levels: ["Très faible", "Faible", "Moyen", "Fort", "Très fort"] },
      actions: { open: 48, overdue: 17, median_days: 23, velocity: weeks.map((w) => ({ week: w, created: r.int(2, 8), done: r.int(1, 7) })) },
      responsiveness: { median_days: 19, p75_days: 33, by_dossier: DOSSIERS.slice(0, 10).map((d, i) => ({ reference: d.reference, name: d.name, median_days: [12, 9, 27, 6, 31, 14, 11, 44, 16, 41][i], pending: [1, 0, 3, 0, 2, 1, 1, 4, 2, 3][i] })) },
    });
  });

  /* ─── Contexte ───────────────────────────────────────────────────────── */

  route("GET", "/analyse/contexte", PROFILS_TOUS, (ctx) => {
    const c = COMPANIES[ctx.company];
    const groupe = c.entity === "groupe";
    const sections = groupe
      ? [["synthese", "Cockpit", "Radar", "/analyse"], ["rentabilite", "Rentabilité", "TrendingUp", "/analyse/rentabilite"], ["tresorerie", "Trésorerie et prévision", "Landmark", "/analyse/tresorerie"], ["clients", "Portefeuille clients", "Users", "/analyse/clients"], ["transport", "Flotte et routes", "Truck", "/analyse/transport"], ["depenses", "Dépenses et contrôles", "ShoppingCart", "/analyse/depenses"], ["previsions", "Atterrissage et simulateur", "Target", "/analyse/previsions"], ["fiabilite", "Fiabilité des données", "ShieldCheck", "/analyse/fiabilite"]]
      : [["synthese", "Cockpit", "Radar", "/analyse"], ["portefeuille", "Projets et pipeline", "FolderKanban", "/analyse/portefeuille"], ["diagnostic", "Diagnostic des projets", "Layers", "/analyse/diagnostic"], ["comites", "Qualité des décisions", "Gavel", "/analyse/comites"], ["financements", "Financements", "HandCoins", "/analyse/financements"], ["activite", "Activité et honoraires", "Clock", "/analyse/activite"], ["risques", "Risques et exécution", "ShieldAlert", "/analyse/risques"]];
    return {
      entity: c.entity,
      company: { id: c.id, name: c.name, currency: "GNF" },
      sections: sections.map(([key, label, icon, path]) => ({ key, label, icon, path })),
      fiscal_year: { date_from: `${TODAY.slice(0, 4)}-01-01`, date_to: `${TODAY.slice(0, 4)}-12-31` },
      last_entry_date: TODAY,
      can_switch: ctx.user.companies.length > 1,
    };
  });
}
