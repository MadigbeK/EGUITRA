/**
 * NIMOVA · Analyse, EGUITRA GROUP (chapitre 5 de la spécification) : un modèle mensuel cohérent sur
 * 36 mois (transport pétrolier, BTP, immobilier), puis les huit routes /analyse/groupe/* dans les
 * formes exactes du noyau (addons/eguitra_analytics). Données fictives et déterministes.
 */

import { addDays, classer, constat, daysBetween, kpi, lundi, mds, median, moisCourt, moisEntre, moisJusqua, nFr, pctFr, poidsMois, r1, r2, r3, round, sigmoide, sum, taux, variation } from "./analyse-commun.mjs";

const PROFILS = ["admin", "direction", "finance"];

export function routesGroupe({ route, makeRng, TODAY, periode, enveloppe, exigerEntite }) {
  /* ═══ Modèle mensuel ══════════════════════════════════════════════════ */

  const ACTIVITES = [
    { id: 1, key: "transport", name: "Transport pétrolier", base: 2.62e9, variable: 0.66, saison: (m) => (m >= 11 || m <= 5 ? 1.08 : m === 8 ? 0.86 : 0.95), croissance: 0.075 },
    { id: 2, key: "btp", name: "BTP et génie civil", base: 0.96e9, variable: 0.74, saison: (m) => (m >= 7 && m <= 9 ? 0.72 : m >= 11 || m <= 3 ? 1.14 : 1.0), croissance: 0.04 },
    { id: 3, key: "immobilier", name: "Immobilier locatif", base: 0.46e9, variable: 0.28, saison: () => 1, croissance: 0.03 },
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
        const cost = rev * a.variable * r.noise(0.035) * (a.key === "transport" && i >= MOIS_MODELE.length - 7 ? 1.045 : 1);
        activites[a.key] = { revenue: round(rev), costs: round(cost), margin: round(rev - cost) };
        ca += rev;
        variables += cost;
      }
      const fixes = FIXES_MENSUELS * (1 + 0.03 * ans) * r.noise(0.03) * (i === MOIS_MODELE.length - 14 ? 1.42 : 1);
      const ebe = ca - variables - fixes;
      const dotations = 0.31e9 * (1 + 0.05 * ans);
      const financier = -0.062e9;
      const impots = Math.max(0, (ebe - dotations + financier) * 0.3);
      const tarif = 420000 * (1 + 0.045) ** ans;
      const m3 = (activites.transport.revenue / tarif) * r.noise(0.03);
      return {
        key: k, revenue: round(ca), variables: round(variables), fixes: round(fixes), ebe: round(ebe), dotations: round(dotations), financier: round(financier), impots: round(impots),
        net: round(ebe - dotations + financier - impots), activites, fuel: round(activites.transport.costs * 0.46), payroll: round(fixes * 0.52 + variables * 0.11), m3: round(m3), km: round(m3 * 17.5),
        taxes: round(fixes * 0.09), dso: r1(42.8 + i * 0.13 + Math.sin(i / 2) * 0.9), dpo: r1(22.5 - i * 0.1 + Math.cos(i / 3) * 0.8), dio: r1(10.1 + Math.sin(i / 4) * 1.2),
      };
    });
    let solde = 3.75e9;
    const evenements = { "-33": -1.2e9, "-27": -0.8e9, "-21": -1.6e9, "-15": -1.4e9, "-9": -0.9e9, "-3": -2.2e9 };
    lignes.forEach((l, i) => {
      solde += l.ebe * 0.58 - l.impots * 0.9 + (evenements[String(i - (lignes.length - 1))] ?? 0) + (r.next() * 2 - 1) * 0.25e9;
      l.cash = round(solde);
    });
    return lignes;
  })();
  const parCle = new Map(modele.map((l) => [l.key, l]));
  const ligne = (k) => parCle.get(k) ?? modele[modele.length - 1];
  const sommeSur = (p, fn) => {
    const mois = moisEntre(p.date_from, p.date_to);
    const poids = poidsMois(mois, p);
    return sum(mois, (k, i) => (parCle.get(k) ? fn(parCle.get(k)) * poids[i] : 0));
  };
  const tendance = (fn, n = 12) => MOIS_MODELE.slice(-n).map((k) => fn(ligne(k)));
  const douzeMois = (fn) => sum(modele.slice(-12), fn);

  /* ═══ Référentiels ════════════════════════════════════════════════════ */

  const ROUTES = [
    { id: 1, name: "Conakry - Kamsar", km: 290, tarif: 395000, marge: 0.31 },
    { id: 2, name: "Conakry - Kindia", km: 135, tarif: 255000, marge: 0.27 },
    { id: 3, name: "Conakry - Mamou", km: 270, tarif: 372000, marge: 0.24 },
    { id: 4, name: "Conakry - Labé", km: 430, tarif: 548000, marge: 0.19 },
    { id: 5, name: "Conakry - Boké", km: 300, tarif: 314000, marge: -0.042 },
    { id: 6, name: "Conakry - Kankan", km: 650, tarif: 795000, marge: 0.17 },
    { id: 7, name: "Conakry - N'Zérékoré", km: 980, tarif: 1142000, marge: 0.12 },
    { id: 8, name: "Conakry - Siguiri", km: 790, tarif: 955000, marge: 0.21 },
  ];
  const CAMIONS = Array.from({ length: 12 }, (_, i) => ({ id: 31 + i, name: `ER-${String(i + 1).padStart(2, "0")}` }));
  const CHAUFFEURS = ["Mamadou Camara", "Sékou Condé", "Alpha Oumar Bah", "Ibrahima Sory Touré", "Lansana Kouyaté", "Moussa Soumah", "Abdoulaye Diallo", "Ousmane Sylla", "Fodé Keïta", "Mohamed Cissé"].map((name, i) => ({ id: 41 + i, name }));
  const CLIENTS = [
    ["Pétro-Guinée Distribution (démo)", 0.19, 0.3, 12], ["Mines de Boké SA (démo)", 0.14, 0.26, 28], ["Compagnie minière de Sangarédi (démo)", 0.11, 0.33, 9], ["Station Horizon (démo)", 0.08, 0.29, 41],
    ["Énergies du Fouta (démo)", 0.07, 0.24, 6], ["Alumine de Fria (démo)", 0.06, 0.22, 63], ["Bauxite Ouest (démo)", 0.055, 0.31, 18], ["Ciments de Guinée (démo)", 0.05, 0.19, 22],
    ["Dépôt Kaloum (démo)", 0.04, 0.27, 3], ["Transit Kamsar (démo)", 0.035, 0.21, 35], ["Hôpital régional de Kindia (démo)", 0.03, 0.14, 71], ["Promo-Habitat Ratoma (démo)", 0.028, 0.35, 15],
    ["Agro-Kankan SARL (démo)", 0.024, 0.2, 48], ["Groupe scolaire Lambanyi (démo)", 0.02, 0.33, 8], ["Télécom Nimba (démo)", 0.018, 0.25, 5], ["Carrières de Dubréka (démo)", 0.016, 0.18, 54],
    ["Pêcheries de Kamsar (démo)", 0.012, 0.23, 27], ["Boulangerie du Port (démo)", 0.009, 0.3, 2],
  ].map(([name, part, marge, retard], i) => ({ id: 101 + i, name, part, marge, retard }));
  const TOTAL_PARTS = sum(CLIENTS, (c) => c.part);
  const CATEGORIES = [
    { key: "acc.60", label: "Achats et fournitures", part: 0.47, activites: { transport: 0.78, btp: 0.17, immobilier: 0.02, null: 0.03 } },
    { key: "acc.61", label: "Transports", part: 0.05, activites: { transport: 0.6, btp: 0.3, immobilier: 0.05, null: 0.05 } },
    { key: "acc.62", label: "Services extérieurs", part: 0.17, activites: { transport: 0.45, btp: 0.35, immobilier: 0.12, null: 0.08 } },
    { key: "acc.63", label: "Autres services", part: 0.05, activites: { transport: 0.3, btp: 0.3, immobilier: 0.2, null: 0.2 } },
    { key: "acc.64", label: "Impôts et taxes", part: 0.04, activites: { transport: 0.3, btp: 0.2, immobilier: 0.3, null: 0.2 } },
    { key: "acc.66", label: "Charges de personnel", part: 0.22, activites: { transport: 0.5, btp: 0.35, immobilier: 0.05, null: 0.1 } },
  ];
  const FOURNISSEURS = [
    ["Guinée Carburants SA (démo)", "acc.60", 0.36], ["Pneus et Pièces Matoto (démo)", "acc.60", 0.08], ["Atelier Mécanique Sonfonia (démo)", "acc.62", 0.06], ["Béton Ouest Africain (démo)", "acc.60", 0.1],
    ["Fer et Aciers de Guinée (démo)", "acc.60", 0.07], ["Génie Civil Associés (démo)", "acc.62", 0.09], ["Assur-Guinée (démo)", "acc.62", 0.05], ["Immo-Bail Conakry (démo)", "acc.62", 0.04],
    ["Orange Guinée Pro (démo)", "acc.62", 0.015], ["Cabinet Juridique Kaloum (démo)", "acc.62", 0.02], ["Papeterie Centrale (démo)", "acc.60", 0.008], ["Électricité du Littoral (démo)", "acc.60", 0.025],
    ["Transit Maritime Conakry (démo)", "acc.61", 0.03], ["Peintures Niger (démo)", "acc.60", 0.012],
  ].map(([name, category, part], i) => ({ id: 201 + i, name, category, part }));

  /* ═══ Fiabilité et qualité ════════════════════════════════════════════ */

  function controles() {
    const borne = (v) => Math.max(0, Math.min(100, round(v)));
    const defs = [
      ["analytic", "Imputation analytique", 92.9, "pct", 95, "Part (en montant) des lignes de charges et de produits de la période imputées à une activité.", "312 lignes (1,9 Md GNF) sans activité : les marges par activité sont sous-estimées d'autant.", "/finance/ecritures", "Compléter l'imputation des pièces (activité) : sans elle, la rentabilité par métier est fausse.", 312, 1.9e9],
      ["bank_reconciled", "Relevés rapprochés", 66.7, "pct", 100, "Part des comptes de banque dont le dernier relevé rapproché a moins de 7 jours.", "BICIGUI non rapproché depuis 23 jours (214 lignes de relevé en attente).", "/finance/tresorerie/rapprochement", "Rapprocher le compte BICIGUI avant la clôture du mois.", 1, null],
      ["attachments", "Pièces justificatives", 96.4, "pct", 100, "Part des factures fournisseurs de la période avec un justificatif joint.", "87 factures d'achat sans facture scannée.", "/finance/achats", "Joindre les justificatifs manquants ; bloquer la validation sans pièce.", 87, 0.41e9],
      ["late_entries", "Saisie dans les délais", 3.3, "pct", 5, "Part des pièces validées plus de 30 jours après leur date.", "41 pièces saisies plus de 30 jours après leur date.", "/finance/achats", null, 41, null],
      ["old_drafts", "Pièces en brouillon anciennes", 6, "count", 0, "Pièces en brouillon depuis plus de 30 jours.", "Six factures d'achat en brouillon depuis septembre.", "/finance/achats?state=draft", "Valider ou supprimer les brouillons de septembre.", 6, 0.12e9],
      ["suspense", "Comptes d'attente soldés", 0, "gnf", 0, "Solde des comptes d'attente (classe 47) à la date d'arrêté.", "Comptes 47 soldés.", "/finance/clotures", null, 0, 0],
      ["partners_vat", "Tiers identifiés (NIF)", 99.1, "pct", 100, "Part des tiers facturés sur la période qui portent un NIF.", "3 tiers sans NIF, tous inactifs depuis 2024.", "/finance/tiers", "Renseigner le NIF des trois tiers.", 3, null],
      ["unbilled_rotations", "Rotations facturées", 9, "count", 0, "Rotations validées depuis plus de 15 jours sans facture.", "Neuf rotations de septembre attendent leur facture (118 M GNF).", "/transport/rotations", "Facturer les rotations de septembre.", 9, 0.118e9],
      ["tiers_without_partner", "Lignes de tiers rattachées", 0, "count", 0, "Lignes sur comptes de tiers sans partenaire.", "Toutes les lignes de tiers portent un partenaire.", "/finance/ecritures", null, 0, 0],
      ["unmapped_accounts", "Comptes classés dans les états", 0, "count", 0, "Comptes mouvementés absents du plan de regroupement des états financiers.", "Tous les comptes mouvementés sont classés.", "/finance/etats", null, 0, 0],
      ["rotations_fuel", "Litres de carburant saisis", 94.2, "pct", 90, "Part des rotations validées de la période avec les litres de carburant saisis.", "23 rotations sans litres : consommation non contrôlable sur ces rotations.", "/transport/rotations", "Rendre les litres obligatoires à la validation.", 23, null],
    ];
    return defs.map(([key, label, value, unit, target, definition, detail, link, action, count, amount]) => {
      let score;
      if (unit === "count" || (unit === "gnf" && target === 0)) score = value === 0 ? 100 : borne(100 - value * 12);
      else if (key === "late_entries") score = borne(100 - Math.max(0, value - target) * 20);
      else score = borne(100 - Math.max(0, target - value) * 12);
      const status = score >= 90 ? "good" : score >= 50 ? "warn" : "bad";
      return { key, label, value, unit, target, status, score, detail, link, definition, action, count, amount };
    });
  }
  const CONTROLES = controles();
  const SCORE_FIABILITE = round(sum(CONTROLES, (c) => c.score) / CONTROLES.length);
  const notesDe = (cles) => CONTROLES.filter((c) => cles.includes(c.key) && c.status !== "good").map((c) => c.detail);
  const qualite = (cles) => {
    const retenus = CONTROLES.filter((c) => cles.includes(c.key));
    return { score: retenus.length ? round(sum(retenus, (c) => c.score) / retenus.length) : 100, notes: notesDe(cles) };
  };
  const QUALITE_SYNTHESE = { score: SCORE_FIABILITE, notes: CONTROLES.filter((c) => c.status !== "good").map((c) => c.detail) };

  /* ═══ Synthèse ════════════════════════════════════════════════════════ */

  function kpisGroupe(p) {
    const ca = sommeSur(p, (l) => l.revenue);
    const caPrev = sommeSur(p.previous, (l) => l.revenue);
    const ebe = sommeSur(p, (l) => l.ebe);
    const ebePrev = sommeSur(p.previous, (l) => l.ebe);
    const net = sommeSur(p, (l) => l.net);
    const netPrev = sommeSur(p.previous, (l) => l.net);
    const cash = ligne(p.date_to.slice(0, 7)).cash;
    const cashPrev = ligne(p.previous.date_to.slice(0, 7)).cash;
    const dso = ligne(p.date_to.slice(0, 7)).dso;
    const dsoPrev = ligne(p.previous.date_to.slice(0, 7)).dso;
    const bfr = ligne(p.date_to.slice(0, 7));
    const bfrJours = r1(bfr.dso + bfr.dio - bfr.dpo);
    const bfrPrev = ligne(p.previous.date_to.slice(0, 7));
    const margeT = taux(sommeSur(p, (l) => l.activites.transport.margin), sommeSur(p, (l) => l.activites.transport.revenue));
    const margeTPrev = taux(sommeSur(p.previous, (l) => l.activites.transport.margin), sommeSur(p.previous, (l) => l.activites.transport.revenue));
    const dscr = r2(douzeMois((l) => l.ebe) / (0.64e9 * 12 * 0.56));
    return [
      kpi({ key: "revenue", label: "Chiffre d'affaires", value: ca, unit: "gnf", previous: caPrev, status: ca >= caPrev ? "good" : "warn", definition: "Ventes de marchandises, de produits et de services hors taxes (rubriques 70), pièces validées, période choisie contre la même période un an plus tôt.", trend: tendance((l) => l.revenue) }),
      kpi({ key: "ebe", label: "Excédent brut d'exploitation", value: ebe, unit: "gnf", previous: ebePrev, status: ebe >= ebePrev ? "good" : "bad", definition: "Chiffre d'affaires moins achats consommés, services extérieurs, impôts et taxes et charges de personnel.", trend: tendance((l) => l.ebe) }),
      kpi({ key: "ebe_margin", label: "Taux d'EBE", value: taux(ebe, ca), unit: "pct", previous: taux(ebePrev, caPrev), status: ebe / ca >= 0.15 ? "good" : "warn", definition: "EBE rapporté au chiffre d'affaires.", trend: tendance((l) => taux(l.ebe, l.revenue)) }),
      kpi({ key: "net_result", label: "Résultat net", value: net, unit: "gnf", previous: netPrev, status: net >= 0 ? (net >= netPrev ? "good" : "warn") : "bad", definition: "Résultat après dotations, résultat financier et impôt sur le résultat.", trend: tendance((l) => l.net) }),
      kpi({ key: "cash", label: "Trésorerie nette", value: cash, unit: "gnf", previous: cashPrev, status: cash >= 2.5e9 ? "good" : cash > 0 ? "warn" : "bad", definition: "Banques et caisses moins découverts et concours bancaires courants, à la date d'arrêté.", trend: tendance((l) => l.cash) }),
      kpi({ key: "bfr_days", label: "BFR en jours de chiffre d'affaires", value: bfrJours, unit: "days", previous: r1(bfrPrev.dso + bfrPrev.dio - bfrPrev.dpo), status: bfrJours > 35 ? "warn" : "good", definition: "Besoin en fonds de roulement (créances + stocks − dettes fournisseurs) rapporté au chiffre d'affaires TTC journalier.", trend: tendance((l) => r1(l.dso + l.dio - l.dpo)), inverse: true }),
      kpi({ key: "dso", label: "Délai moyen de recouvrement (DSO)", value: dso, unit: "days", previous: dsoPrev, target: 60, status: dso > 60 ? "bad" : dso > 45 ? "warn" : "good", definition: "Créances clients TTC rapportées aux ventes TTC journalières des trois derniers mois ; cible paramétrée à 60 jours.", trend: tendance((l) => l.dso), inverse: true }),
      kpi({ key: "transport_margin", label: "Marge transport", value: margeT, unit: "pct", previous: margeTPrev, target: 30, status: margeT >= 30 ? "good" : "warn", definition: "Marge directe des rotations validées (tarif moins carburant, péages, frais de route, entretien) rapportée au chiffre d'affaires transport ; seuil paramétré à 30 %.", trend: tendance((l) => taux(l.activites.transport.margin, l.activites.transport.revenue)) }),
      kpi({ key: "dscr", label: "Couverture du service de la dette (DSCR)", value: dscr, unit: "ratio", previous: r2(dscr * 1.08), target: 1.2, status: dscr >= 1.2 ? "good" : "bad", definition: "EBE des douze derniers mois divisé par le service de la dette (intérêts et principal) des douze derniers mois.", trend: tendance((l, i) => r2(1.9 - 0.02 * (MOIS_MODELE.indexOf(l.key) - 24))) }),
    ];
  }

  function santeGroupe(p) {
    const dernier = ligne(p.date_to.slice(0, 7));
    const decaissements = (dernier.variables + dernier.fixes) * 0.92;
    const moisCouverts = dernier.cash / decaissements;
    const ebePct = taux(sommeSur(p, (l) => l.ebe), sommeSur(p, (l) => l.revenue)) ?? 0;
    const dso = dernier.dso;
    const margeT = taux(sommeSur(p, (l) => l.activites.transport.margin), sommeSur(p, (l) => l.activites.transport.revenue)) ?? 0;
    const detteNette = 3.9e9 - dernier.cash;
    const ratioDette = detteNette > 0 ? detteNette / Math.max(1, douzeMois((l) => l.ebe)) : 0;
    const borne = (v, lo, hi) => round(Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)));
    const axes = {
      liquidite: { score: borne(moisCouverts, 0, 3), label: "Liquidité", value: r2(moisCouverts), unit: "ratio", comment: `La trésorerie couvre ${nFr(moisCouverts, 1)} mois de décaissements moyens (${mds(decaissements)} par mois) ; 0 mois = 0, 3 mois et plus = 100.`, weight: 25 },
      rentabilite: { score: borne(ebePct, 0, 25), label: "Rentabilité", value: r1(ebePct), unit: "pct", comment: `Taux d'EBE de ${pctFr(ebePct, 1)} (0 % = 0, 25 % et plus = 100).`, weight: 25 },
      solvabilite: { score: borne(3 - ratioDette, 0, 3), label: "Solvabilité", value: r2(ratioDette), unit: "ratio", comment: ratioDette > 0 ? `Dette financière nette de ${nFr(ratioDette, 1)} fois l'EBE (3 fois = 0, 0 = 100).` : "Pas de dette financière nette.", weight: 20 },
      recouvrement: { score: borne(120 - dso, 0, 60), label: "Recouvrement", value: r1(dso), unit: "days", comment: `DSO de ${round(dso)} jours pour une cible de 60 jours (cible et moins = 100, double de la cible = 0).`, weight: 15 },
      exploitation: { score: borne(margeT, 0, 30), label: "Exploitation", value: r1(margeT), unit: "pct", comment: `Marge directe du transport de ${pctFr(margeT, 1)} (0 % = 0, 30 % et plus = 100).`, weight: 15 },
    };
    const score = round(sum(Object.values(axes), (a) => (a.score * a.weight) / 100));
    return { score, axes, method: "Moyenne pondérée : liquidité 25 %, rentabilité 25 %, solvabilité 20 %, recouvrement 15 %, exploitation 15 % ; chaque ratio noté entre deux bornes documentées." };
  }

  /** Cascade du résultat : valeurs signées, le genre dit le sens. */
  function cascadeGroupe(p) {
    const ca = sommeSur(p, (l) => l.revenue);
    const variables = sommeSur(p, (l) => l.variables);
    const fixes = sommeSur(p, (l) => l.fixes);
    const taxes = sommeSur(p, (l) => l.taxes);
    const ebe = ca - variables - fixes;
    const dot = sommeSur(p, (l) => l.dotations);
    const fin = sommeSur(p, (l) => l.financier);
    const impots = sommeSur(p, (l) => l.impots);
    const hao = 0.018e9 * moisEntre(p.date_from, p.date_to).length / 12;
    const marche = (key, label, value, total = false) => ({ key, label, value: round(value), kind: total ? "total" : value >= 0 ? "plus" : "minus" });
    return [
      marche("revenue", "Chiffre d'affaires", ca, true),
      marche("purchases", "Achats consommés", -variables * 0.63),
      marche("external", "Transports et services extérieurs", -variables * 0.37),
      marche("taxes", "Impôts et taxes", -taxes),
      marche("personnel", "Charges de personnel", -fixes * 0.61),
      marche("other", "Autres produits et charges d'exploitation", -fixes * 0.3),
      marche("ebe", "Excédent brut d'exploitation", ebe, true),
      marche("depreciation", "Dotations nettes des reprises", -dot),
      marche("financial", "Résultat financier", fin),
      marche("exceptional", "Hors activités ordinaires et participation", hao),
      marche("tax", "Impôt sur le résultat", -impots),
      marche("net_result", "Résultat net", ebe - dot + fin + hao - impots, true),
    ];
  }

  function activitesGroupe(p) {
    const ca = sommeSur(p, (l) => l.revenue);
    return ACTIVITES.map((a) => {
      const revenue = sommeSur(p, (l) => l.activites[a.key].revenue);
      const expense = sommeSur(p, (l) => l.activites[a.key].costs);
      const prev = sommeSur(p.previous, (l) => l.activites[a.key].revenue);
      return { id: a.id, name: a.name, revenue: round(revenue), expense: round(expense), margin: round(revenue - expense), margin_rate: taux(revenue - expense, revenue), share_pct: taux(revenue, ca) ?? 0, revenue_previous: round(prev), growth_pct: variation(revenue, prev) };
    });
  }

  const serieMensuelle = (n, defs) => {
    const months = MOIS_MODELE.slice(-n);
    return { months, series: defs.map(([key, label, unit, fn]) => ({ key, label, unit, values: months.map((k) => round(fn(ligne(k)))) })) };
  };

  /* ═══ Rentabilité ═════════════════════════════════════════════════════ */

  function effetsTransport(p) {
    const revN = sommeSur(p, (l) => l.activites.transport.revenue);
    const revN1 = sommeSur(p.previous, (l) => l.activites.transport.revenue);
    const m3N = sommeSur(p, (l) => l.m3);
    const m3N1 = sommeSur(p.previous, (l) => l.m3);
    const rate = m3N ? revN / m3N : null;
    const ratePrev = m3N1 ? revN1 / m3N1 : null;
    // Volume aux tarifs moyens N-1 ; prix = variation de la grille tarifaire par route (4,5 % par an)
    // aux volumes N, répartis selon le mix des routes de N ; le mix des routes absorbe le reste.
    const partsN = ROUTES.map((rt) => (rt.id === 1 ? 5 : rt.id === 7 ? 0.9 : 1.6));
    const totalParts = sum(partsN);
    const ans = (daysBetween(p.previous.date_to, p.date_to) || 365) / 365;
    const volume = ratePrev === null ? 0 : (m3N - m3N1) * ratePrev;
    const price = rate === null || ratePrev === null ? 0 : sum(ROUTES, (rt, i) => m3N * (partsN[i] / totalParts) * (rt.tarif - rt.tarif / 1.045 ** ans));
    const revenue_delta = revN - revN1;
    const margin_delta = sommeSur(p, (l) => l.activites.transport.margin) - sommeSur(p.previous, (l) => l.activites.transport.margin);
    return { volume: round(volume), price: round(price), mix: round(revenue_delta - volume - price), revenue_delta: round(revenue_delta), volume_m3: r2(m3N), volume_m3_previous: r2(m3N1), rate: rate === null ? null : round(rate), rate_previous: ratePrev === null ? null : round(ratePrev), margin_delta: round(margin_delta) };
  }

  function pontEbe(p) {
    const te = effetsTransport(p);
    const ebeN = sommeSur(p, (l) => l.ebe);
    const ebeN1 = sommeSur(p.previous, (l) => l.ebe);
    const dBtp = sommeSur(p, (l) => l.activites.btp.margin) - sommeSur(p.previous, (l) => l.activites.btp.margin);
    const dImmo = sommeSur(p, (l) => l.activites.immobilier.margin) - sommeSur(p.previous, (l) => l.activites.immobilier.margin);
    const couts = te.margin_delta - te.revenue_delta;
    const autres = ebeN - ebeN1 - te.margin_delta - dBtp - dImmo;
    const marche = (key, label, value, total = false) => ({ key, label, value: round(value), kind: total ? "total" : value >= 0 ? "plus" : "minus" });
    return [
      marche("ebe_previous", "EBE N-1", ebeN1, true),
      marche("transport.volume", "Transport : effet volume", te.volume),
      marche("transport.price", "Transport : effet prix", te.price),
      marche("transport.mix", "Transport : effet mix des routes", te.mix),
      marche("transport.costs", "Transport : coûts et autres écarts", couts),
      marche("activity.2", "BTP et génie civil", dBtp),
      marche("activity.3", "Immobilier locatif", dImmo),
      marche("other", "Hors activités et éléments hors EBE", autres),
      marche("ebe", "EBE N", ebeN, true),
    ];
  }

  /** Régression des charges mensuelles sur le chiffre d'affaires, 24 mois, un mois aberrant écarté. */
  function structureCouts(p) {
    const points = modele.slice(-24).map((l) => ({ month: l.key, revenue: l.revenue, charges: l.variables + l.fixes, excluded: false }));
    const ajuste = (pts) => {
      const n = pts.length;
      const mx = sum(pts, (q) => q.revenue) / n;
      const my = sum(pts, (q) => q.charges) / n;
      const pente = sum(pts, (q) => (q.revenue - mx) * (q.charges - my)) / sum(pts, (q) => (q.revenue - mx) ** 2);
      const ordonnee = my - pente * mx;
      return { pente, ordonnee, mx };
    };
    const premier = ajuste(points);
    const residus = points.map((q) => q.charges - (premier.ordonnee + premier.pente * q.revenue));
    const med = median(residus) ?? 0;
    const mad = median(residus.map((e) => Math.abs(e - med))) || 1;
    for (const [i, q] of points.entries()) if (Math.abs((0.6745 * (residus[i] - med)) / mad) > 3.5) q.excluded = true;
    const retenus = points.filter((q) => !q.excluded);
    const { pente, ordonnee, mx } = ajuste(retenus);
    const my = sum(retenus, (q) => q.charges) / retenus.length;
    const ssTot = sum(retenus, (q) => (q.charges - my) ** 2);
    const ssRes = sum(retenus, (q) => (q.charges - (ordonnee + pente * q.revenue)) ** 2);
    const r2v = 1 - ssRes / ssTot;
    const breakeven = ordonnee / (1 - pente);
    const caMensuel = sommeSur(p, (l) => l.revenue) / Math.max(1, sum(poidsMois(moisEntre(p.date_from, p.date_to), p)));
    const xs = retenus.map((q) => q.revenue);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    return {
      fixed_monthly: round(ordonnee), variable_rate: r2(pente * 100), r2: r3(r2v), n: retenus.length, breakeven_monthly: round(breakeven), safety_margin_pct: r2(((caMensuel - breakeven) / caMensuel) * 100),
      operating_leverage: r2((caMensuel * (1 - pente)) / (caMensuel * (1 - pente) - ordonnee)), average_revenue: round(mx), points, line: [{ x: x0, y: round(ordonnee + pente * x0) }, { x: x1, y: round(ordonnee + pente * x1) }],
      reliable: r2v >= 0.5 && retenus.length >= 12, method: "Régression des charges d'exploitation mensuelles sur le chiffre d'affaires mensuel. Moindres carrés, mois aberrants écartés (score robuste des résidus > 3,5).",
    };
  }
  function ecartsBudget(p) {
    const r = makeRng("analyse-budget");
    const annee = p.date_to.slice(0, 4);
    const moisEcoules = +p.date_to.slice(5, 7);
    const avancement = Math.min(1, (daysBetween(`${annee}-01-01`, p.date_to) + 1) / 365);
    const defs = [
      [1, "Chiffre d'affaires transport", "income", "701", 31.2e9, 30.4e9], [2, "Chiffre d'affaires BTP", "income", "702", 11.6e9, 10.1e9], [3, "Loyers", "income", "706", 5.4e9, 5.6e9],
      [4, "Carburant", "expense", "6011", 10.2e9, 11.1e9], [5, "Entretien et pièces", "expense", "6012,624", 2.9e9, 2.75e9], [6, "Sous-traitance BTP", "expense", "621", 3.4e9, 3.3e9], [7, "Matériaux", "expense", "602", 4.1e9, 3.6e9],
      [8, "Charges de personnel", "expense", "66", 6.1e9, 6.2e9], [9, "Loyers et assurances", "expense", "622,625", 1.3e9, 1.28e9], [10, "Honoraires et services", "expense", "632", 0.9e9, 1.05e9], [11, "Autres charges", "expense", "63,64", 1.6e9, 1.42e9],
    ];
    const lines = defs.map(([id, name, nature, prefixes, annuel, rythme]) => {
      const budget_to_date = round(annuel * avancement);
      const monthly_actuals = Array.from({ length: moisEcoules }, (_, i) => round((rythme / 12) * r.noise(0.08) * (i === moisEcoules - 1 ? avancement * 12 - (moisEcoules - 1) : 1)));
      const actual_to_date = sum(monthly_actuals);
      const gap = actual_to_date - budget_to_date;
      const projection = round(actual_to_date / avancement);
      const sigma = annuel * 0.05;
      const proba = sigmoide((1.7 * (projection - annuel)) / sigma);
      const risque = nature === "expense" ? proba : 1 - proba;
      return { id, name, nature, prefixes, budget_to_date, actual_to_date, gap, gap_pct: taux(gap, budget_to_date), annual_budget: annuel, projection, projected_gap: projection - annuel, monthly_actuals, risk: nature === "expense" ? "dépassement" : "manque à gagner", risk_probability_pct: r1(risque * 100), status: (nature === "expense" ? gap > 0 : gap < 0) ? "depassement" : "conforme" };
    });
    return { available: true, budget: { id: 1, name: `Budget ${annee}` }, by_account: true, months_elapsed: moisEcoules, lines };
  }

  function chantiers(p) {
    const avancement = Math.min(1, (daysBetween(`${p.date_to.slice(0, 4)}-01-01`, p.date_to) + 1) / 365);
    return [
      [1, "Hôpital régional de Kindia", "CH-2025-04", "Ministère de la Santé (démo)", "progress", 6.4e9, 62, 3.9e9, 3.58e9, 0.19e9],
      [2, "Entrepôt pétrolier de Kamsar", "CH-2025-07", "Pétro-Guinée Distribution (démo)", "progress", 4.1e9, 88, 3.6e9, 2.74e9, 0.18e9],
      [3, "Lotissement Sonfonia (voiries)", "CH-2026-01", "Promo-Habitat Ratoma (démo)", "progress", 2.9e9, 35, 1.0e9, 0.82e9, 0.05e9],
      [4, "Station-service Horizon Matoto", "CH-2025-11", "Station Horizon (démo)", "done", 1.2e9, 100, 1.2e9, 0.93e9, 0.06e9],
      [5, "Réfection route d'accès Boké", "CH-2026-03", "Mines de Boké SA (démo)", "progress", 1.8e9, 18, 0.32e9, 0.3e9, 0],
    ].map(([id, name, code, client, state, contract_amount, progress_pct, invoiced, costs, retention]) => {
      const earned_value = round(contract_amount * (progress_pct / 100) * 0.87);
      const cpi = costs ? r3(earned_value / costs) : null;
      const eac = cpi ? round((contract_amount * 0.87) / cpi) : null;
      return { id, name, code, client, state, contract_amount, progress_pct, invoiced: round(invoiced * Math.min(1, avancement + 0.3)), costs, margin: invoiced - costs, margin_pct: taux(invoiced - costs, invoiced), earned_value, cpi, eac, margin_at_completion: eac === null ? null : contract_amount - eac, margin_at_completion_pct: eac === null ? null : taux(contract_amount - eac, contract_amount), retention_outstanding: retention };
    });
  }

  function immobilier(p) {
    const moisPeriode = Math.max(1, sum(poidsMois(moisEntre(p.date_from, p.date_to), p)));
    const biens = [
      ["Immeuble Kaloum Centre", "immeuble", 6.2, 100, 0, 0, "2028-06-30"], ["Villa Kipé", "villa", 1.1, 58, 0, 0, "2026-12-31"], ["Bureaux Almamya", "bureau", 2.4, 100, 0, 0, "2027-03-31"], ["Magasins Madina", "commerce", 1.6, 92, 48e6, 2, "2027-09-30"],
      ["Résidence Lambanyi", "immeuble", 2.9, 95, 0, 0, "2027-01-31"], ["Entrepôt Matoto", "entrepot", 1.8, 100, 0, 0, "2029-05-31"], ["Villa Nongo", "villa", 0.9, 100, 0, 0, "2026-11-30"], ["Appartements Ratoma", "immeuble", 2.2, 88, 12e6, 1, "2027-06-30"],
      ["Terrain Dubréka", "terrain", 0.7, 0, 0, 0, null], ["Bureaux Camayenne", "bureau", 1.9, 100, 0, 0, "2028-02-28"], ["Studios Kobaya", "immeuble", 0.8, 96, 0, 0, "2027-04-30"], ["Boutiques Taouyah", "commerce", 1.2, 90, 0, 0, "2026-12-15"],
      ["Immeuble Dixinn", "immeuble", 3.4, 97, 0, 0, "2028-10-31"], ["Villa Coléah", "villa", 1.0, 100, 0, 0, "2027-08-31"],
    ].map(([name, kind, valeur, occupancy_pct, unpaid_amount, unpaid_count, lease_end], i) => {
      const rr = makeRng(`bien-${i}`);
      const value = valeur * 1e9;
      const annual_rent = occupancy_pct ? round(value * (0.085 + rr.next() * 0.02)) : 0;
      const revenue = round((annual_rent / 12) * moisPeriode * (occupancy_pct / 100));
      const costs = round(revenue * (0.12 + rr.next() * 0.1));
      return { id: 1 + i, name, kind, occupied: occupancy_pct > 0, occupancy_pct, annual_rent, value, gross_yield_pct: taux(annual_rent, value), unpaid_amount, unpaid_count, revenue, costs, net: revenue - costs, lease_end: lease_end ?? false };
    });
    const portfolio_value = sum(biens, (b) => b.value);
    const annual_rent = sum(biens, (b) => b.annual_rent);
    return { properties: biens, summary: { properties: biens.length, occupied: biens.filter((b) => b.occupied).length, occupancy_pct: r1(sum(biens, (b) => b.occupancy_pct) / biens.length), annual_rent, portfolio_value, gross_yield_pct: taux(annual_rent, portfolio_value), unpaid_amount: sum(biens, (b) => b.unpaid_amount), unpaid_count: sum(biens, (b) => b.unpaid_count), revenue: sum(biens, (b) => b.revenue), costs: sum(biens, (b) => b.costs) } };
  }

  /* ═══ Trésorerie ══════════════════════════════════════════════════════ */

  function tresorerieGroupe(p) {
    const r = makeRng("analyse-tresorerie");
    const dernier = ligne(p.date_to.slice(0, 7));
    const total = dernier.cash;
    const decouvert = 0.18e9;
    const comptes = [
      [11, "BICIGUI compte courant", "bank", "GNF", 0.41], [12, "Société Générale Guinée", "bank", "GNF", 0.22], [13, "Ecobank compte USD", "bank", "USD", 0.3], [14, "Caisse du siège", "cash", "GNF", 0.04], [15, "Caisse du parc Matoto", "cash", "GNF", 0.03],
    ].map(([journal_id, name, type, currency, part]) => ({ journal_id, name, type, company: "EGUITRA GROUP SARLU", currency, balance_currency: currency === "USD" ? round((total * part) / 8600) : round(total * part), balance: round(total * part), share_pct: r1(part * 100) }));
    const by_currency = ["GNF", "USD"].map((currency) => {
      const ceux = comptes.filter((c) => c.currency === currency);
      return { currency, balance_currency: sum(ceux, (c) => c.balance_currency), balance: sum(ceux, (c) => c.balance), share_pct: r1(taux(sum(ceux, (c) => c.balance), total) ?? 0) };
    });
    const seuil = 2.5e9;
    const caAnnuel = douzeMois((l) => l.revenue);
    // Créances : délai réel de chaque client (moyenne et dispersion), encaissements répartis sur les 13 semaines.
    const collections = CLIENTS.slice(0, 12).map((c) => {
      const open = round(caAnnuel * (c.part / TOTAL_PARTS) * 1.18 * ((c.retard + 30) / 365));
      const overdue = round(open * Math.min(0.9, c.retard / 60));
      const doubtful = c.retard > 60 ? round(overdue * 0.3) : 0;
      const semaine = Math.min(12, Math.max(0, Math.round((c.retard + 10) / 7)));
      const expected_by_week = Array.from({ length: 13 }, (_, i) => (i === semaine ? round((open - doubtful) * 0.55) : i === semaine + 1 ? round((open - doubtful) * 0.25) : i === semaine + 2 ? round((open - doubtful) * 0.12) : 0));
      const expected_total = sum(expected_by_week);
      return { id: c.id, name: c.name, open, overdue, doubtful, avg_days_late: c.retard, sd_days_late: r1(4 + c.retard * 0.35), history_n: Math.max(3, round(40 * c.part / TOTAL_PARTS * 6)), history_source: c.part > 0.03 ? "client" : "global", expected_by_week, expected_total, beyond_horizon: open - doubtful - expected_total };
    });
    const encaissementsClients = Array.from({ length: 13 }, (_, i) => sum(collections, (c) => c.expected_by_week[i]));
    // Flux hebdomadaires calés sur le modèle : chiffre d'affaires et charges des douze derniers mois / 52.
    const R = douzeMois((l) => l.revenue) / 52;
    const C = douzeMois((l) => l.variables + l.fixes) / 52;
    const autresEncaissements = [0.3, 0.28, 0.25, 0.35, 0.15, 0.12, 0.1, 0.5, 0.45, 0.3, 0.28, 0.4, 0.36].map((v) => v * R);
    const payables = [0.62, 0.58, 0.6, 0.65, 0.6, 0.55, 0.5, 0.52, 0.54, 0.5, 0.6, 0.52, 0.56].map((v) => round(v * C * r.noise(0.05)));
    const loans = Array.from({ length: 13 }, (_, i) => (i === 5 ? 0.64e9 : i === 11 ? 0.21e9 : 0));
    const recurring = Array.from({ length: 13 }, (_, i) => (i === 4 || i === 8 || i === 12 ? round(C * 0.25 + 0.36e9) : round(C * 0.2 * r.noise(0.1))));
    const taxes = Array.from({ length: 13 }, (_, i) => (i === 3 ? 0.31e9 : i === 7 ? 0.09e9 : i === 12 ? 0.3e9 : 0));
    const weeks = [];
    let p50 = total;
    for (let i = 0; i < 13; i++) {
      const start = addDays(lundi(p.date_to), 7 * (i + 1));
      const inflows = round(encaissementsClients[i] + autresEncaissements[i] * r.noise(0.03));
      const outflows = payables[i] + loans[i] + recurring[i] + taxes[i];
      p50 += inflows - outflows;
      const disp = 0.12e9 * Math.sqrt(i + 1) * 2.1;
      weeks.push({ week: i + 1, start, end: addDays(start, 6), inflows, outflows, net: inflows - outflows, balance_p10: round(p50 - disp), balance_p50: round(p50), balance_p90: round(p50 + disp * 0.8) });
    }
    const sous50 = weeks.find((w) => w.balance_p50 < seuil);
    const sous10 = weeks.find((w) => w.balance_p10 < seuil);
    const bas = weeks.reduce((m, w) => (w.balance_p50 < m.balance_p50 ? w : m), weeks[0]);
    const bas10 = weeks.reduce((m, w) => (w.balance_p10 < m.balance_p10 ? w : m), weeks[0]);
    const months = MOIS_MODELE.slice(-24);
    const cycle = {
      months,
      series: [
        { key: "dso", label: "Délai clients (DSO)", unit: "days", values: months.map((k) => ligne(k).dso) },
        { key: "dpo", label: "Délai fournisseurs (DPO)", unit: "days", values: months.map((k) => ligne(k).dpo) },
        { key: "dio", label: "Rotation des stocks (DIO)", unit: "days", values: months.map((k) => ligne(k).dio) },
        { key: "cycle", label: "Cycle de conversion", unit: "days", values: months.map((k) => r1(ligne(k).dso + ligne(k).dio - ligne(k).dpo)) },
        { key: "bfr", label: "Besoin en fonds de roulement", unit: "gnf", values: months.map((k) => round((ligne(k).revenue * 1.18 * (ligne(k).dso + ligne(k).dio - ligne(k).dpo)) / 30)) },
      ],
      definition: "Soldes comptables de fin de mois rapportés aux ventes et achats TTC des trois mois glissants.",
    };
    return {
      position: { accounts: comptes, by_currency, total, net_cash: total - decouvert },
      forecast: {
        start_balance: total, weeks, draws: 1000, seed: 20261017, doubtful_excluded: sum(collections, (c) => c.doubtful), beyond_horizon: sum(collections, (c) => c.beyond_horizon), receivables_simulated: sum(collections, (c) => c.open), unapplied_receipts: 0.046e9,
        outflows_detail: { payables, loans, recurring, taxes }, recurring_monthly: 0.84e9, payables_overdue: 0.27e9,
        method: "Monte-Carlo sur les retards de paiement observés par client (24 mois), décaissements à échéance ; bandes p10-p90 des soldes simulés.",
      },
      runway: { threshold: seuil, threshold_source: "parametre", weeks_p50: sous50 ? sous50.week : null, weeks_p10: sous10 ? sous10.week : null, covered: !sous10, start_balance: total, horizon_end: weeks[12].end, low_point: { week: bas.week, start: bas.start, balance_p50: bas.balance_p50, balance_p10: bas10.balance_p10, week_p10: bas10.week } },
      cycle,
      collections,
    };
  }

  /* ═══ Clients ═════════════════════════════════════════════════════════ */

  function concentrationClients(p) {
    const ca = sommeSur(p, (l) => l.revenue);
    let cumul = 0;
    const lorenz = [{ x: 0, y: 0 }, ...CLIENTS.map((c, i) => {
      cumul += c.part / TOTAL_PARTS;
      return { x: r2((i + 1) / CLIENTS.length), y: r2(cumul) };
    })];
    // Courbe au-dessus de la diagonale (du plus grand au plus petit) : Gini = 2 × aire − 1.
    const aire = sum(lorenz.slice(1), (pt, i) => ((lorenz[i].y + pt.y) / 2) * (pt.x - lorenz[i].x));
    const premier = CLIENTS[0];
    return {
      lorenz, gini: r3(2 * aire - 1), hhi: round(sum(CLIENTS, (c) => (c.part / TOTAL_PARTS) ** 2 * 10000)),
      top_share: { first: r1((premier.part / TOTAL_PARTS) * 100), first_id: premier.id, first_name: premier.name, top5: r1((sum(CLIENTS.slice(0, 5), (c) => c.part) / TOTAL_PARTS) * 100) },
      pareto_count: lorenz.findIndex((pt) => pt.y >= 0.8), clients: CLIENTS.length, revenue: round(ca), unassigned_revenue: round(ca * 0.012),
      method: "Chiffre d'affaires (comptes 70) par client de la période : courbe de Lorenz et Gini, indice de Herfindahl-Hirschman (parts en %), nombre de clients qui font 80 % du chiffre d'affaires.",
    };
  }

  const SEGMENTS = { strategiques: "Stratégiques", a_securiser: "À sécuriser", a_developper: "À développer", a_surveiller: "À surveiller" };
  function clientsGroupe(p) {
    const ca = sommeSur(p, (l) => l.revenue);
    const caPrev = sommeSur(p.previous, (l) => l.revenue);
    const c80 = concentrationClients(p).pareto_count;
    const clients = CLIENTS.map((c, i) => {
      const r = makeRng(`client-${i}`);
      const revenue = round(ca * (c.part / TOTAL_PARTS));
      const revenue_previous = round(caPrev * (c.part / TOTAL_PARTS) * (i === 12 ? 0.49 : r.noise(0.2)));
      const margin = round(revenue * c.marge);
      const payment_score = Math.max(5, Math.min(100, round(100 - c.retard * 1.4 - (c.retard > 40 ? 10 : 0))));
      const valeur = i < c80;
      const segment = valeur && payment_score >= 70 ? "strategiques" : valeur ? "a_securiser" : payment_score >= 70 ? "a_developper" : "a_surveiller";
      const open = round(revenue * 1.18 * ((c.retard + 30) / 365));
      const overdue = round(open * Math.min(0.9, c.retard / 60));
      const pente = i === 3 ? 3.2 : i === 12 ? 1.1 : r1(-1.2 + r.next() * 2.4);
      return { id: c.id, name: c.name, revenue, share_pct: r2((c.part / TOTAL_PARTS) * 100), revenue_previous, growth_pct: variation(revenue, revenue_previous), margin, margin_rate: taux(margin, revenue), avg_days_late: c.retard, avg_days_to_pay: 30 + c.retard, payment_score, open, overdue, ecl: round(overdue * (c.retard > 60 ? 0.25 : c.retard > 30 ? 0.08 : 0.02)), segment, segment_label: SEGMENTS[segment], history_n: Math.max(3, round(24 * c.part / TOTAL_PARTS * 6)), trend: pente > 0.8 ? "Se dégrade" : pente < -0.8 ? "S'améliore" : "Stable", _pente: pente };
    });
    const quadrants = Object.entries(SEGMENTS).map(([key, label]) => {
      const ceux = clients.filter((c) => c.segment === key);
      return { key, label, count: ceux.length, revenue: sum(ceux, (c) => c.revenue), open: sum(ceux, (c) => c.open) };
    });
    const BUCKETS = ["À l'échéance ou avant", "1 à 15 jours", "16 à 30 jours", "31 à 60 jours", "61 à 90 jours", "Plus de 90 jours"];
    const behaviour = clients.slice(0, 10).map((c, i) => {
      const r = makeRng(`comportement-${i}`);
      const centre = Math.min(5, Math.floor(CLIENTS[i].retard / 15));
      const histogram = BUCKETS.map((label, k) => {
        const count = Math.max(0, round(14 * Math.exp(-((k - centre) ** 2) / 1.6) * r.noise(0.3)));
        return { label, count, amount: round(count * (c.revenue / Math.max(1, c.history_n)) * r.noise(0.2)) };
      });
      const n = sum(histogram, (h) => h.count);
      return { id: c.id, name: c.name, n, mean: r1(CLIENTS[i].retard), median: r1(CLIENTS[i].retard * 0.9), p90: r1(CLIENTS[i].retard * 1.8 + 6), histogram, trend: n >= 4 ? { slope_days_per_month: c._pente, r2: r2(0.3 + Math.abs(c._pente) * 0.15), t: r2(c._pente * 1.8), n, label: c.trend } : null };
    });
    const months = MOIS_MODELE.slice(-12);
    const trends = { months, series: clients.slice(0, 10).map((c, i) => {
      const r = makeRng(`tendance-${i}`);
      return { key: `client.${c.id}`, label: c.name, unit: "gnf", client_id: c.id, values: months.map((k, j) => round(ligne(k).revenue * (CLIENTS[i].part / TOTAL_PARTS) * r.noise(0.14) * (i === 12 ? 0.6 + j * 0.07 : 1))) };
    }) };
    for (const c of clients) delete c._pente;
    return { concentration: concentrationClients(p), segments: { clients, quadrants, good_payer_score: 70, method: "Valeur : clients qui font 80 % du chiffre d'affaires ; comportement : note de paiement (retard moyen pondéré par les montants, part échue, tendance)." }, behaviour, trends };
  }

  /* ═══ Transport ═══════════════════════════════════════════════════════ */

  function transportGroupe(p) {
    const r = makeRng("analyse-transport");
    const months = MOIS_MODELE.slice(-12);
    const caTransport = sommeSur(p, (l) => l.activites.transport.revenue);
    const margeTransport = sommeSur(p, (l) => l.activites.transport.margin);
    const caTotal = sommeSur(p, (l) => l.revenue);
    const km = sommeSur(p, (l) => l.km);
    const m3 = sommeSur(p, (l) => l.m3);
    const partsRoutes = ROUTES.map((rt) => (rt.id === 1 ? 5 : rt.id === 7 ? 0.9 : 1.6));
    const totalParts = sum(partsRoutes);
    const cells = [];
    for (const [i, rt] of ROUTES.entries()) {
      for (const k of months) {
        const m = +k.slice(5, 7);
        const saison = m >= 11 || m <= 5 ? 1.06 : 0.92;
        const rotations = round((rt.id === 1 ? 34 : rt.id === 7 ? 6 : 12) * saison * r.noise(0.25));
        const revenue = round((ligne(k).activites.transport.revenue * partsRoutes[i]) / totalParts);
        const margin_pct = rotations === 0 ? null : r1(rt.marge * 100 + (r.next() * 2 - 1) * 4.5 + (rt.id === 5 && m >= 6 ? -3 : 0));
        cells.push({ route_id: rt.id, month: k, margin_pct, rotations, revenue: rotations ? revenue : 0, margin: rotations && margin_pct !== null ? round((revenue * margin_pct) / 100) : 0 });
      }
    }
    const utilisation = [86, 84, 81, 79, 77, 74, 72, 69, 63, 48, 46, 44];
    const jours = daysBetween(p.date_from, p.date_to) + 1;
    const trucks = CAMIONS.map((c, i) => {
      const util = utilisation[i];
      const rotations = Math.max(1, round(((util / 100) * jours) / 2.6 * r.noise(0.08)));
      const kmCamion = round(rotations * 560 * r.noise(0.15));
      const volume = r2(rotations * 36 * r.noise(0.05));
      const revenue = round(caTransport * (util / sum(utilisation)) * r.noise(0.04));
      const lkm = i === 6 ? 46.2 : r1(37.5 + r.next() * 3.5);
      const direct = round(revenue * (0.42 + (lkm - 39) * 0.012 + (util < 50 ? 0.17 : 0)) * r.noise(0.03));
      // Structure imputée : part fixe par ensemble (assurance, amortissement) et part au kilomètre.
      const structure = round(0.28e9 * (jours / 365) + kmCamion * 2000);
      return { id: c.id, name: c.name, rotations, km: kmCamion, volume, revenue, direct_costs: direct, margin: revenue - direct, margin_rate: taux(revenue - direct, revenue), revenue_per_km: kmCamion ? r1(revenue / kmCamion) : null, cost_per_km: kmCamion ? r1(direct / kmCamion) : null, fuel_per_100km: lkm, days_active: round(jours * (util / 100)), utilization_pct: util, structure, net_result: revenue - direct - structure, booked_cost: round(direct * 0.97), rank: 0 };
    });
    trucks.sort((a, b) => b.net_result - a.net_result).forEach((t, i) => (t.rank = i + 1));
    const deficitaires = trucks.filter((t) => t.net_result < 0);
    const structure = sum(trucks, (t) => t.structure);
    const directs = sum(trucks, (t) => t.direct_costs);
    const indicators = {
      transport_revenue: round(caTransport), income_total: round(caTotal), revenue_share: taux(caTransport, caTotal), margin: round(margeTransport), margin_rate: taux(margeTransport, caTransport), margin_threshold: 30, below_threshold: (taux(margeTransport, caTransport) ?? 0) < 30,
      km: round(km), revenue_per_km: km ? r1(caTransport / km) : null, cost_per_km: km ? r1((caTransport - margeTransport) / km) : null, fuel_per_100km: r1(sum(trucks, (t) => t.fuel_per_100km * t.km) / Math.max(1, sum(trucks, (t) => t.km))), structure, structure_per_km: km ? r1(structure / km) : null,
      net_result: round(margeTransport - structure), vehicles: trucks.length, deficit_vehicles: deficitaires.length, deficit_loss: sum(deficitaires, (t) => t.net_result), declared_cost: directs, booked_cost: round(directs * 0.97), cost_gap: round(directs * 0.03), shortage_excess: 126000 * 0.14, shortage_value: round(126000 * 0.14 * 9200),
    };
    const anomalies = [44.8, 46.9, 47.3, 45.2, 46.6, 48.1, 45.9].map((v, i) => {
      const rt = ROUTES[[0, 1, 0, 2, 0, 4, 0][i]];
      const kmRot = rt.km * 2;
      return { rotation: `ROT/2026/0${1480 + i * 9}`, rotation_id: 1480 + i * 9, date: addDays(p.date_to, -70 + i * 9), truck: "ER-07", route: rt.name, value: v, expected: 39.1, score: r1((v - 39.1) / 1.6), basis: "historique de l'ensemble", excess_liters: round(((v - 39.1) / 100) * kmRot), excess_cost: round(((v - 39.1) / 100) * kmRot * 9200) };
    });
    anomalies.push({ rotation: "ROT/2026/01512", rotation_id: 1512, date: addDays(p.date_to, -22), truck: "ER-03", route: "Conakry - Labé", value: 51.4, expected: 38.6, score: 8.0, basis: "flotte", excess_liters: round(((51.4 - 38.6) / 100) * 860), excess_cost: round(((51.4 - 38.6) / 100) * 860 * 9200) });
    const pricing = ROUTES.map((rt, i) => {
      const cellules = cells.filter((c) => c.route_id === rt.id);
      const rotations = sum(cellules, (c) => c.rotations);
      const revenue = sum(cellules, (c) => c.revenue);
      const margin = sum(cellules, (c) => c.margin);
      const volume = r2(rotations * 36);
      const avg_load = rotations ? r2(volume / rotations) : null;
      const full_cost_per_m3 = round(rt.tarif / (1 + rt.marge));
      const target_rate = round(full_cost_per_m3 / (1 - 0.3));
      const gap = rt.tarif - full_cost_per_m3;
      const structureRoute = round(structure * (partsRoutes[i] / totalParts));
      return { id: rt.id, name: rt.name, rotations, volume, revenue, avg_rate: rt.tarif, full_cost_per_rotation: round(full_cost_per_m3 * 36), avg_load, load_factor_pct: avg_load === null ? null : r1((avg_load / 36.5) * 100), full_cost_per_m3_full_load: full_cost_per_m3, breakeven_rate: full_cost_per_m3, target_margin_pct: 30, target_rate, gap, gap_pct: r1((gap / full_cost_per_m3) * 100), margin, margin_rate: taux(margin, revenue), structure: structureRoute, net_result: margin - structureRoute, recommendation: gap < 0 ? `Sous le point mort : relever le tarif d'au moins ${nFr(-gap)} GNF/m³ (cible ${nFr(target_rate)} GNF/m³ pour 30 % de marge) ou réaffecter les ensembles.` : rt.marge < 0.3 ? `Sous la marge cible : viser ${nFr(target_rate)} GNF/m³ à la prochaine révision tarifaire.` : "Tarif conforme à la cible : maintenir." };
    });
    const manquant = (id, name, rotations, loaded, shortage, pctHors) => {
      const excess = r2(Math.max(0, shortage - loaded * 0.003));
      return { id, name, rotations, loaded, shortage: r2(shortage), excess, value: round(excess * 1000 * 9200), net_cost: round(excess * 1000 * 9200 * 0.85), excess_rotations: round((rotations * pctHors) / 100), rate_pct: r3((shortage / loaded) * 100), out_of_tolerance_pct: pctHors };
    };
    const shortages = {
      drivers: CHAUFFEURS.map((c, i) => manquant(c.id, c.name, [96, 88, 84, 80, 76, 72, 70, 64, 60, 52][i], [3450, 3160, 3020, 2880, 2730, 2590, 2520, 2300, 2160, 1870][i], 126 * [0.26, 0.12, 0.11, 0.09, 0.08, 0.08, 0.07, 0.07, 0.06, 0.06][i], [38, 29, 12, 9, 7, 5, 4, 3, 2, 1][i])),
      routes: ROUTES.map((rt, i) => manquant(rt.id, rt.name, sum(cells.filter((c) => c.route_id === rt.id), (c) => c.rotations), round(sum(cells.filter((c) => c.route_id === rt.id), (c) => c.rotations) * 36), 126 * [0.3, 0.08, 0.1, 0.12, 0.14, 0.11, 0.09, 0.06][i], [11, 6, 9, 15, 19, 16, 21, 12][i])),
      products: [[1, "Gasoil", 0.68, 14], [2, "Essence", 0.21, 9], [3, "Jet A1", 0.07, 4], [4, "Pétrole lampant", 0.04, 6]].map(([id, name, part, pct]) => manquant(id, name, round(742 * part), round(742 * part * 36), 126 * part, pct)),
    };
    const scatter = [];
    for (let i = 0; i < 140; i++) {
      const rt = ROUTES[r.weighted(ROUTES.map((x, k) => [k, partsRoutes[k]]))];
      const truck = CAMIONS[r.int(0, 11)];
      const volume = r2(32 + r.next() * 5);
      const revenue = round(rt.tarif * volume);
      const margin_rate = r1(rt.marge * 100 + (r.next() * 2 - 1) * 9);
      scatter.push({ id: 1300 + i * 2, name: `ROT/2026/0${1300 + i * 2}`, date: addDays(p.date_to, -r.int(0, Math.min(jours - 1, 300))), km: round(rt.km * 2 * r.noise(0.06)), margin: round((revenue * margin_rate) / 100), margin_rate, volume, revenue, route: rt.name, truck: truck.name });
    }
    return { available: true, indicators, heatmap: { routes: ROUTES.map((rt) => ({ id: rt.id, name: rt.name })), months, cells }, trucks, fuel_anomalies: anomalies, pricing, shortages, scatter };
  }

  /* ═══ Dépenses ════════════════════════════════════════════════════════ */

  function depensesGroupe(p) {
    const r = makeRng("analyse-depenses");
    const months = moisEntre(p.date_from, p.date_to).filter((k) => parCle.has(k));
    const poids = poidsMois(months, p);
    const cells = [];
    for (const cat of CATEGORIES) for (const [i, k] of months.entries()) {
      const base = (ligne(k).variables + ligne(k).fixes) * cat.part * poids[i];
      for (const [actKey, part] of Object.entries(cat.activites)) {
        const act = ACTIVITES.find((a) => a.key === actKey);
        cells.push({ category: cat.key, activity: act ? act.id : null, month: k, amount: round(base * part * r.noise(0.12)) });
      }
    }
    const total = sum(cells, (c) => c.amount);
    const categories = CATEGORIES.map((c) => ({ key: c.key, label: c.label, total: sum(cells.filter((x) => x.category === c.key), (x) => x.amount) })).sort((a, b) => b.total - a.total);
    const activities = [...ACTIVITES.map((a) => ({ id: a.id, name: a.name, total: sum(cells.filter((x) => x.activity === a.id), (x) => x.amount) })), { id: null, name: "Non affecté", total: sum(cells.filter((x) => x.activity === null), (x) => x.amount) }];
    const achats = total * 0.72;
    const totalParts = sum(FOURNISSEURS, (f) => f.part);
    let cumul = 0;
    const pareto = [...FOURNISSEURS].sort((a, b) => b.part - a.part).map((f) => {
      cumul += f.part / totalParts;
      return { id: f.id, name: f.name, amount: round(achats * (f.part / totalParts)), share_pct: r2((f.part / totalParts) * 100), cumulative_pct: r2(cumul * 100) };
    });
    const mois12 = MOIS_MODELE.slice(-12);
    const drift = CATEGORIES.map((cat, ci) => {
      const monthly = mois12.map((k, i) => round((ligne(k).variables + ligne(k).fixes) * cat.part * r.noise(0.06) * (cat.key === "acc.60" ? 1 + i * 0.006 : 1)));
      const avant = modele.slice(-24, -12).map((l) => (l.variables + l.fixes) * cat.part);
      const monthly_avg = sum(monthly) / 12;
      const monthly_avg_previous = sum(avant) / 12;
      const xs = monthly.map((_, i) => i);
      const mx = 5.5;
      const my = monthly_avg;
      const pente = sum(xs, (x, i) => (x - mx) * (monthly[i] - my)) / sum(xs, (x) => (x - mx) ** 2);
      const ssRes = sum(monthly, (v, i) => (v - (my + pente * (i - mx))) ** 2);
      const ssTot = sum(monthly, (v) => (v - my) ** 2);
      return { category: cat.key, label: cat.label, monthly_avg: round(monthly_avg), monthly_avg_previous: round(monthly_avg_previous), drift_pct: variation(monthly_avg, monthly_avg_previous), slope_pct_per_month: r2((pente / my) * 100), r2: r3(1 - ssRes / ssTot), monthly };
    });
    const n = 1240;
    const observes = [29.4, 17.2, 12.1, 9.1, 11.3, 6.4, 5.6, 4.9, 4.0];
    const digits = observes.map((o, i) => {
      const expected = r3(Math.log10(1 + 1 / (i + 1)) * 100);
      const z = r3(Math.abs(o - expected) / Math.sqrt((expected * (100 - expected)) / n));
      return { d: i + 1, count: round((o / 100) * n), observed: o, expected, z, excess: o > expected && z > 1.96 };
    });
    const chi2 = r2(sum(digits, (d) => ((d.observed - d.expected) ** 2 / d.expected) * (n / 100)));
    const mad = r3(sum(digits, (d) => Math.abs(d.observed - d.expected)) / 9 / 100 * 1000) / 1000;
    const conformite = mad < 0.006 ? ["close", "Conformité proche"] : mad < 0.012 ? ["acceptable", "Conformité acceptable"] : mad < 0.015 ? ["marginal", "Conformité marginale"] : ["nonconformity", "Non-conformité"];
    const benford = { n, digits, chi2, chi2_critical: 15.507, p_value: r3(Math.exp(-chi2 / 6)), mad, conformity: conformite[0], conformity_label: conformite[1], suspicious: digits.filter((d) => d.excess).map((d) => d.d), warning: null, min_amount: 1000, first_two: null, population: "Factures fournisseurs (montant hors taxes) et charges des opérations diverses, de banque et de caisse de la période, d'au moins 1 000 GNF." };
    const facture = (id, ref, date, amount) => ({ id, name: `FAC/2026/${String(id).padStart(5, "0")}`, ref, date, amount });
    const duplicates = [
      { partner: "Pneus et Pièces Matoto (démo)", partner_id: 202, a: facture(872, "BL-2271", addDays(p.date_to, -41), 31.4e6), b: facture(891, "BL-2271", addDays(p.date_to, -30), 31.4e6), score: 94, reasons: ["même montant", "11 jours d'écart", "même référence externe"], amount_at_risk: 31.4e6 },
      { partner: "Béton Ouest Africain (démo)", partner_id: 204, a: facture(744, "BOA-1187", addDays(p.date_to, -75), 28.9e6), b: facture(801, "BOA-1203", addDays(p.date_to, -51), 28.7e6), score: 78, reasons: ["montant à 0,7 % près", "24 jours d'écart"], amount_at_risk: 28.7e6 },
      { partner: "Atelier Mécanique Sonfonia (démo)", partner_id: 203, a: facture(913, null, addDays(p.date_to, -12), 14.6e6), b: facture(915, null, addDays(p.date_to, -10), 14.6e6), score: 90, reasons: ["même montant", "2 jours d'écart"], amount_at_risk: 14.6e6 },
      { partner: "Orange Guinée Pro (démo)", partner_id: 209, a: facture(658, "ABO-09", addDays(p.date_to, -62), 5.8e6), b: facture(699, "ABO-10", addDays(p.date_to, -33), 5.8e6), score: 52, reasons: ["même montant", "29 jours d'écart : abonnement mensuel probable"], amount_at_risk: 5.8e6 },
    ];
    const outliers = [
      [802, "Cabinet Juridique Kaloum (démo)", "acc.62", "Services extérieurs", "Honoraires contentieux Boké", 142e6, 9e6, 7.8, -34],
      [931, "Atelier Mécanique Sonfonia (démo)", "acc.62", "Services extérieurs", "Réfection moteur ER-03", 68e6, 11e6, 5.1, -9],
      [611, "Papeterie Centrale (démo)", "acc.60", "Achats et fournitures", "Fournitures de bureau trimestre", 9.4e6, 1.2e6, 4.6, -88],
      [877, "Électricité du Littoral (démo)", "acc.60", "Achats et fournitures", "Électricité parc Matoto", 41e6, 17e6, 3.9, -18],
      [702, "Fer et Aciers de Guinée (démo)", "acc.60", "Achats et fournitures", "Fers à béton chantier Kindia", 212e6, 48e6, 3.7, -61],
    ].map(([id, partner, category, category_label, label, amount, med, score, delta]) => ({ line_id: id * 3, move_id: id, move: `FAC/2026/${String(id).padStart(5, "0")}`, date: addDays(p.date_to, delta), partner, category, category_label, label, amount, median: med, score }));
    return {
      cube: { months, categories, activities, cells, total },
      suppliers: { pareto, pareto_count: pareto.findIndex((f) => f.cumulative_pct >= 80) + 1, hhi: round(sum(FOURNISSEURS, (f) => (f.part / totalParts) ** 2 * 10000)), suppliers: FOURNISSEURS.length, total: round(achats), top_share: pareto[0].share_pct, drift, months: mois12 },
      benford, duplicates, outliers,
    };
  }

  /* ═══ Prévisions ══════════════════════════════════════════════════════ */

  function previsionsGroupe(p) {
    const annee = p.date_to.slice(0, 4);
    // Le mois d'arrêté, incomplet, est projeté comme les suivants.
    const historiques = modele.filter((l) => l.key < p.date_to.slice(0, 7)).slice(-24);
    const futurs = [];
    for (let m = +p.date_to.slice(5, 7); m <= 12; m++) futurs.push(`${annee}-${String(m).padStart(2, "0")}`);
    const saison = (k) => ACTIVITES[0].saison(+k.slice(5, 7)) * 0.72 + 0.28;
    const projette = (fn, bruit) => {
      const base = historiques.slice(-12).map(fn);
      const tendanceLin = (base[base.length - 1] - base[0]) / 12;
      const moyenne = sum(base) / base.length;
      const dernier = fn(historiques[historiques.length - 1]);
      const series = historiques.map((l) => ({ month: l.key, actual: round(fn(l)), forecast: null, low: null, high: null }));
      futurs.forEach((k, i) => {
        const f = (moyenne + tendanceLin * (i + 1)) * saison(k) * (1 - 0.02 * i) + dernier * 0.1;
        const disp = f * bruit * Math.sqrt(i + 1) * 1.28;
        series.push({ month: k, actual: null, forecast: round(f), low: round(f - disp), high: round(f + disp) });
      });
      return series;
    };
    const bloc = (label, fn, bruit, mape, params, cusum) => ({ label, series: projette(fn, bruit), method: "holt_winters", mape, params, history_months: historiques.length, cusum });
    const revenue = bloc("Chiffre d'affaires", (l) => l.revenue, 0.045, 5.8, { alpha: 0.3, beta: 0.05, gamma: 0.2 }, null);
    const ebe = bloc("Excédent brut d'exploitation", (l) => l.ebe, 0.11, 8.9, { alpha: 0.2, beta: 0.02, gamma: 0.15 }, { change: true, index: 17, alarm_index: 20, direction: "down", statistic: 5.4, mean_before: round(sum(historiques.slice(0, 17), (l) => l.ebe) / 17), mean_after: round(sum(historiques.slice(17), (l) => l.ebe) / (historiques.length - 17)) });
    const annuel = (serie, champ) => sum(serie.filter((q) => q.month.startsWith(annee)), (q) => q.actual ?? q[champ] ?? 0);
    const budgets = { revenue: 47.5e9, ebe: 7.6e9 };
    const atterrissage = (serie, budget, fnPrev) => {
      const actual_to_date = annuel(serie.filter((q) => q.actual !== null), "actual");
      const estimate = annuel(serie, "forecast");
      const low = annuel(serie, "low");
      const high = annuel(serie, "high");
      const sigma = Math.max(1, (high - low) / 2.56);
      const previous_year = round(sum(modele.filter((l) => l.key.startsWith(String(+annee - 1))), fnPrev));
      return { actual_to_date: round(actual_to_date), forecast_remaining: round(estimate - actual_to_date), estimate: round(estimate), low: round(low), high: round(high), budget, probability_pct: r1(sigmoide((1.7 * (estimate - budget)) / sigma) * 100), previous_year, vs_previous_pct: variation(estimate, previous_year) };
    };
    const base = { revenue_12m: douzeMois((l) => l.revenue), ebe_12m: douzeMois((l) => l.ebe), fuel_12m: douzeMois((l) => l.fuel), payroll_12m: douzeMois((l) => l.payroll) };
    const transport12 = douzeMois((l) => l.activites.transport.revenue);
    const tauxVariable = (douzeMois((l) => l.activites.transport.costs) / transport12) * 100;
    return {
      revenue, ebe,
      landing: { fiscal_year: { date_from: `${annee}-01-01`, date_to: `${annee}-12-31` }, months_remaining: futurs.length, revenue: atterrissage(revenue.series, budgets.revenue, (l) => l.revenue), ebe: atterrissage(ebe.series, budgets.ebe, (l) => l.ebe) },
      sensitivities: { tariff: round(transport12 * 0.01), volume: round(transport12 * 0.01 * (1 - tauxVariable / 100)), fuel: -round(base.fuel_12m * 0.01), payroll: -round(base.payroll_12m * 0.01) },
      sensitivity_base: { ...base, variable_rate_pct: r2(tauxVariable), variable_source: "coûts déclarés du transport", unit: "GNF d'EBE annuel pour une hausse de 1 %" },
      method: "Holt-Winters additif (24 mois et plus), sinon Holt amorti, sinon naïf ; paramètres par grille sur les erreurs à un pas ; intervalles à 80 % ; probabilité d'atteindre le budget par Monte-Carlo (1 000 tirages des erreurs observées).",
    };
  }

  /* ═══ Constats ════════════════════════════════════════════════════════ */

  const serieEvidence = (labels, values, unit, reference = null) => ({ type: "series", data: { labels, values, unit, reference } });
  const barresEvidence = (labels, values, unit, highlight = null) => ({ type: "bars", data: { labels, values, unit, ...(highlight === null ? {} : { highlight }) } });

  function constatsRentabilite(p) {
    const btp = sommeSur(p, (l) => l.activites.btp.margin);
    const btpRev = sommeSur(p, (l) => l.activites.btp.revenue);
    const btpPrev = taux(sommeSur(p.previous, (l) => l.activites.btp.margin), sommeSur(p.previous, (l) => l.activites.btp.revenue));
    const sc = structureCouts(p);
    const budget = ecartsBudget(p);
    const carburant = budget.lines.find((l) => l.name === "Carburant");
    const immo = immobilier(p).summary;
    const huitMois = MOIS_MODELE.slice(-8);
    return [
      constat({ id: "rentabilite.marge_activite.2", domain: "rentabilite", severity: "high", title: "La marge du BTP s'érode depuis quatre mois", narrative: `Le BTP dégage ${pctFr(taux(btp, btpRev), 1)} de marge sur la période contre ${pctFr(btpPrev, 1)} un an plus tôt : le chantier Hôpital de Kindia pèse (indice de performance des coûts 0,86) et la saison des pluies a réduit la facturation de 10 %.`, metric: { label: "Marge BTP", value: taux(btp, btpRev), unit: "pct", reference: btpPrev, reference_label: "N-1" }, impact_gnf: btpRev * 0.04, confidence: 0.82, method: "Marge par activité analytique, pièces validées ; comparaison à la même période un an plus tôt ; CPI = valeur acquise / coûts engagés.", evidence: serieEvidence(huitMois.map(moisCourt), huitMois.map((k) => taux(ligne(k).activites.btp.margin, ligne(k).activites.btp.revenue)), "pct", btpPrev), action: "Revoir les avenants du chantier Hôpital de Kindia et bloquer les achats hors devis ; viser 27 % à terminaison.", link: "/analyse/rentabilite?onglet=metiers" }),
      constat({ id: "rentabilite.point_mort", domain: "rentabilite", severity: sc.safety_margin_pct < 25 ? "high" : "medium", title: `Le point mort mensuel est de ${mds(sc.breakeven_monthly)}`, narrative: `Avec ${mds(sc.fixed_monthly)} de charges fixes et ${pctFr(100 - sc.variable_rate)} de marge sur coûts variables, il faut ${mds(sc.breakeven_monthly)} de chiffre d'affaires par mois pour couvrir la structure ; la marge de sécurité est de ${pctFr(sc.safety_margin_pct)} et un point de chiffre d'affaires perdu coûte ${pctFr(sc.operating_leverage, 1)} d'EBE.`, metric: { label: "Marge de sécurité", value: sc.safety_margin_pct, unit: "pct", reference: 30, reference_label: "Confort" }, impact_gnf: sc.fixed_monthly * 0.3, confidence: sc.reliable ? 0.78 : 0.55, method: `Régression linéaire des charges mensuelles sur le chiffre d'affaires (${sc.n} mois, R² ${nFr(sc.r2, 2)}) : ordonnée = charges fixes, pente = taux de charges variables ; point mort = fixes / (1 − pente).`, evidence: { type: "scatter", data: { points: sc.points.slice(-12).map((q) => ({ x: q.revenue, y: q.charges, label: moisCourt(q.month), highlight: q.excluded })), x_label: "CA mensuel", y_label: "Charges" } }, action: `Toute embauche ou location longue durée s'évalue à l'aune de ces ${mds(sc.breakeven_monthly)} : ne pas laisser la structure gonfler avant la reprise du BTP.`, link: "/analyse/rentabilite?onglet=structure" }),
      constat({ id: "rentabilite.budget.4", domain: "rentabilite", severity: carburant.risk_probability_pct >= 70 ? "high" : "medium", title: `La ligne carburant dépassera le budget avec ${pctFr(carburant.risk_probability_pct)} de probabilité`, narrative: `Le carburant atteint ${mds(carburant.actual_to_date)} à date pour ${mds(carburant.budget_to_date)} budgétés : au rythme observé, l'atterrissage se situe vers ${mds(carburant.projection)} pour ${mds(carburant.annual_budget)} sur l'année.`, metric: { label: "Probabilité de dépassement", value: carburant.risk_probability_pct, unit: "pct", reference: 50, reference_label: "Seuil d'alerte" }, impact_gnf: Math.abs(carburant.projected_gap), confidence: 0.86, method: "Projection linéaire du réalisé mensuel jusqu'à fin d'exercice, dispersion des mois passés ; probabilité que la somme projetée dépasse le budget.", evidence: barresEvidence(["Réalisé à date", "Budget à date", "Projection", "Budget annuel"], [carburant.actual_to_date, carburant.budget_to_date, carburant.projection, carburant.annual_budget], "gnf", 2), action: "Renégocier la remise volume avec Guinée Carburants et activer la clause d'indexation gasoil des contrats clients.", link: "/analyse/rentabilite?onglet=budget" }),
      constat({ id: "rentabilite.loyers_impayes", domain: "rentabilite", severity: "medium", title: "Des loyers échus restent impayés", narrative: `${immo.unpaid_count} loyers échus (${mds(immo.unpaid_amount)}) restent impayés sur Magasins Madina et Appartements Ratoma.`, metric: { label: "Loyers impayés", value: immo.unpaid_amount, unit: "gnf", reference: null, reference_label: null }, impact_gnf: immo.unpaid_amount, confidence: 0.95, method: "Factures de loyer échues non réglées à la date d'arrêté.", evidence: null, action: "Mettre en demeure les deux locataires et compenser sur les dépôts de garantie.", link: "/analyse/rentabilite?onglet=metiers" }),
      constat({ id: "rentabilite.immobilier_rendement", domain: "rentabilite", severity: "positive", title: `L'immobilier rapporte ${pctFr(immo.gross_yield_pct, 1)} brut avec ${pctFr(immo.occupancy_pct)} d'occupation`, narrative: `Les ${immo.properties} biens dégagent ${mds(immo.revenue - immo.costs)} de résultat net sur la période ; un seul bien est vacant (Terrain Dubréka) et la villa Kipé n'est occupée qu'à 58 %.`, metric: { label: "Rendement brut", value: immo.gross_yield_pct, unit: "pct", reference: 8, reference_label: "Cible" }, impact_gnf: immo.revenue - immo.costs, confidence: 0.9, method: "Loyers annuels rapportés à la valeur des biens ; occupation = jours loués / jours disponibles.", evidence: null, action: "Arbitrer la villa Kipé : relouer au prix du marché ou céder.", link: "/analyse/rentabilite?onglet=metiers" }),
      constat({ id: "rentabilite.levier", domain: "rentabilite", severity: "info", title: `Le levier opérationnel est de ${nFr(sc.operating_leverage, 2)}`, narrative: `Une hausse de 1 % du chiffre d'affaires fait monter l'EBE de ${pctFr(sc.operating_leverage, 1)} : la structure fixe amplifie tout, à la hausse comme à la baisse.`, metric: { label: "Levier opérationnel", value: sc.operating_leverage, unit: "ratio", reference: null, reference_label: null }, impact_gnf: null, confidence: 0.74, method: "Marge sur coûts variables divisée par l'EBE, sur la régression des 24 derniers mois.", evidence: null, action: null, link: "/analyse/rentabilite?onglet=structure" }),
    ];
  }

  function constatsTresorerie(p) {
    const t = tresorerieGroupe(p);
    const bas = t.runway.low_point;
    const seuil = t.runway.threshold;
    const sousSeuil = bas.balance_p50 < seuil;
    const dso = ligne(p.date_to.slice(0, 7)).dso;
    const dsoPrev = ligne(p.previous.date_to.slice(0, 7)).dso;
    const cycle = t.cycle.series.find((s) => s.key === "cycle").values.at(-1);
    const jourDeCa = (douzeMois((l) => l.revenue) * 1.18) / 365;
    const echus = sum(t.collections, (c) => c.overdue);
    return [
      constat({ id: sousSeuil ? "tresorerie.sous_seuil" : "tresorerie.couverte", domain: "tresorerie", severity: sousSeuil ? (bas.balance_p10 < 0 ? "critical" : "high") : bas.balance_p10 < seuil ? "medium" : "positive", title: sousSeuil ? `La trésorerie passe sous le seuil en semaine ${bas.week} dans un cas sur deux` : bas.balance_p10 < seuil ? `La trésorerie frôle le seuil en semaine ${bas.week} dans le scénario défavorable` : "La trésorerie est couverte sur 13 semaines", narrative: `Entre la paie de fin de mois, l'échéance d'emprunt de la semaine 6 (${mds(0.64e9)}) et les encaissements miniers attendus tard, la médiane des simulations touche ${mds(bas.balance_p50)} la semaine du ${bas.start.slice(8, 10)}/${bas.start.slice(5, 7)} ; le scénario p10 descend à ${mds(bas.balance_p10)}, pour un seuil de ${mds(seuil)}.`, metric: { label: "Point bas p50", value: bas.balance_p50, unit: "gnf", reference: seuil, reference_label: "Seuil" }, impact_gnf: Math.max(0, seuil - bas.balance_p10), confidence: 0.78, method: t.forecast.method, evidence: { type: "series", data: { weeks: t.forecast.weeks.map((w) => ({ week: w.week, p10: w.balance_p10, p50: w.balance_p50, p90: w.balance_p90 })) } }, action: "Relancer Mines de Boké SA avant le 20 novembre et décaler l'achat des pneus (310 M GNF) à janvier.", link: "/analyse/tresorerie" }),
      constat({ id: "tresorerie.dso_derive", domain: "tresorerie", severity: dso - dsoPrev > 3 ? "high" : "medium", title: `Le délai client s'allonge de ${nFr(dso - dsoPrev, 1)} jours en un an`, narrative: `Le DSO atteint ${round(dso)} jours contre ${round(dsoPrev)} un an plus tôt : les clients miniers paient à 62 jours en moyenne, et trois stations-service dépassent 70 jours.`, metric: { label: "DSO", value: dso, unit: "days", reference: 60, reference_label: "Cible" }, impact_gnf: (dso - dsoPrev) * jourDeCa, confidence: 0.88, method: "Créances clients rapportées aux ventes TTC journalières (trois mois glissants) ; régression du DSO mensuel sur 24 mois.", evidence: serieEvidence(MOIS_MODELE.slice(-12).map(moisCourt), tendance((l) => l.dso), "days", 60), action: "Passer les stations-service en prépaiement partiel (30 %) et activer la pénalité de retard contractuelle.", link: "/analyse/clients" }),
      constat({ id: "tresorerie.cycle", domain: "tresorerie", severity: "medium", title: `Le cycle de conversion est de ${round(cycle)} jours : 1 jour vaut ${mds(jourDeCa)}`, narrative: `DSO ${round(dso)} jours, DIO ${round(ligne(p.date_to.slice(0, 7)).dio)} jours, DPO ${round(ligne(p.date_to.slice(0, 7)).dpo)} jours : chaque jour de cycle immobilise environ ${mds(jourDeCa)}. Payer les fournisseurs à 30 jours libérerait ${mds((30 - ligne(p.date_to.slice(0, 7)).dpo) * jourDeCa * 0.6)}.`, metric: { label: "Cycle de conversion", value: cycle, unit: "days", reference: 30, reference_label: "Cible" }, impact_gnf: (30 - ligne(p.date_to.slice(0, 7)).dpo) * jourDeCa * 0.6, confidence: 0.8, method: "DSO + DIO − DPO sur trois mois glissants ; valeur d'un jour = chiffre d'affaires TTC annuel / 365.", evidence: barresEvidence(["DSO", "DIO", "DPO"], [dso, ligne(p.date_to.slice(0, 7)).dio, ligne(p.date_to.slice(0, 7)).dpo], "days"), action: "Négocier 30 jours avec Guinée Carburants (36 % des achats) contre un volume garanti.", link: "/analyse/tresorerie" }),
      constat({ id: "tresorerie.creances_echues", domain: "tresorerie", severity: "medium", title: `${mds(echus)} de créances clients échues`, narrative: `${t.collections.filter((c) => c.overdue > 0).length} clients ont des factures échues ; Mines de Boké SA et Station Horizon en portent plus de la moitié.`, metric: { label: "Créances échues", value: echus, unit: "gnf", reference: null, reference_label: null }, impact_gnf: echus * 0.1, confidence: 0.95, method: "Factures clients validées non réglées dont l'échéance est dépassée à la date d'arrêté.", evidence: { type: "bars", data: { clients: [...t.collections].sort((a, b) => b.overdue - a.overdue).slice(0, 5).map((c) => ({ name: c.name, revenue: c.overdue })) } }, action: "Relance hebdomadaire des cinq premiers débiteurs par la direction financière.", link: "/analyse/clients" }),
      constat({ id: "tresorerie.devises", domain: "tresorerie", severity: "positive", title: "La position en USD couvre les échéances en devises de six mois", narrative: `Le compte USD (${nFr(t.position.by_currency[1].balance_currency)} USD, soit ${mds(t.position.by_currency[1].balance)}) couvre les trois échéances de leasing en devises jusqu'en avril : aucune exposition au change à court terme.`, metric: { label: "Couverture devises", value: 6, unit: "count", reference: 3, reference_label: "Minimum" }, impact_gnf: null, confidence: 0.92, method: "Solde du compte en devises rapporté aux décaissements en devises des six prochains mois.", evidence: null, action: null, link: "/analyse/tresorerie" }),
    ];
  }

  function constatsClients(p) {
    const d = clientsGroupe(p);
    const c = d.concentration;
    const premier = d.segments.clients[0];
    const horizon = d.segments.clients[3];
    const strategiques = d.segments.quadrants.find((q) => q.key === "strategiques");
    return [
      constat({ id: "clients.concentration", domain: "clients", severity: c.top_share.top5 > 50 ? "high" : "medium", title: `Le chiffre d'affaires dépend de ${c.pareto_count} clients`, narrative: `${c.pareto_count} clients sur ${c.clients} font 80 % du chiffre d'affaires ; ${premier.name.replace(" (démo)", "")} pèse ${pctFr(c.top_share.first)} à elle seule (HHI ${nFr(c.hhi)}, Gini ${nFr(c.gini, 2)}). La perte du premier client coûterait ${mds(premier.revenue)} de chiffre d'affaires et ${mds(premier.margin)} de marge.`, metric: { label: "Part des 5 premiers", value: c.top_share.top5, unit: "pct", reference: 50, reference_label: "Seuil" }, impact_gnf: premier.margin, confidence: 0.92, method: c.method, evidence: { type: "bars", data: { clients: d.segments.clients.slice(0, 6).map((x) => ({ name: x.name, revenue: x.revenue })) } }, action: "Signer deux contrats-cadres hors mines (ciment, agro-industrie) pour ramener les cinq premiers sous 50 %.", link: "/analyse/clients" }),
      constat({ id: `clients.retard_degradation.${horizon.id}`, domain: "clients", severity: "critical", title: `${horizon.name.replace(" (démo)", "")} paie de plus en plus tard`, narrative: `Son retard progresse de 3,2 jours par mois depuis janvier ; ${mds(horizon.overdue)} sont échus. La perte attendue monte à ${mds(horizon.ecl)}.`, metric: { label: "Retard moyen", value: horizon.avg_days_late, unit: "days", reference: 15, reference_label: "Tolérance" }, impact_gnf: horizon.overdue, confidence: 0.9, method: "Régression du retard de paiement par facture dans le temps ; perte attendue = encours × probabilité de défaut par tranche d'ancienneté.", evidence: serieEvidence(["janv.", "mars", "mai", "juil.", "sept.", "oct."], [12, 18, 24, 31, 37, 41], "days", 15), action: "Suspendre les livraisons au-delà de 1 Md GNF d'encours et exiger un échéancier signé sous 15 jours.", link: `/analyse/clients?client=${horizon.id}` }),
      constat({ id: "clients.strategiques", domain: "clients", severity: "positive", title: `${strategiques.count} clients stratégiques portent ${pctFr(taux(strategiques.revenue, c.revenue) ?? 0)} du chiffre d'affaires`, narrative: `${d.segments.clients.filter((x) => x.segment === "strategiques").map((x) => x.name.replace(" (démo)", "")).join(", ")} sont à la fois décisifs pour le chiffre d'affaires et ponctuels.`, metric: { label: "Part du chiffre d'affaires", value: taux(strategiques.revenue, c.revenue), unit: "pct", reference: null, reference_label: null }, impact_gnf: null, confidence: 0.9, method: d.segments.method, evidence: null, action: "Leur proposer un contrat annuel indexé gasoil avec remise de fidélité.", link: "/analyse/clients" }),
      constat({ id: "clients.croissance.113", domain: "clients", severity: "info", title: "Agro-Kankan SARL double son volume en un an", narrative: `Un client « À développer » : ${pctFr(d.segments.clients[12].growth_pct ?? 0)} de croissance, marge 20 %, mais 48 jours de retard moyen.`, metric: { label: "Croissance", value: d.segments.clients[12].growth_pct, unit: "pct", reference: null, reference_label: null }, impact_gnf: d.segments.clients[12].revenue - d.segments.clients[12].revenue_previous, confidence: 0.8, method: "Variation du chiffre d'affaires par rapport à la même période un an plus tôt.", evidence: null, action: "Accompagner la croissance d'un plafond d'encours et d'un acompte.", link: "/analyse/clients?client=113" }),
    ];
  }

  function constatsTransport(p) {
    const t = transportGroupe(p);
    const boke = t.pricing.find((x) => x.id === 5);
    const kamsar = t.pricing.find((x) => x.id === 1);
    const lents = t.trucks.filter((x) => x.utilization_pct < 50).concat(t.trucks.filter((x) => x.utilization_pct >= 50)).slice(0, Math.max(1, t.trucks.filter((x) => x.utilization_pct < 50).length));
    const er07 = t.trucks.find((x) => x.name === "ER-07") ?? t.trucks[0];
    return [
      constat({ id: "transport.route_marge_negative.5", domain: "transport", severity: "critical", title: `La route ${boke.name} perd de l'argent`, narrative: `${boke.rotations} rotations ont dégagé une marge de ${pctFr(boke.margin_rate ?? 0, 1)} : le tarif de ${nFr(boke.avg_rate)} GNF/m³ est sous le coût complet de ${nFr(boke.full_cost_per_m3_full_load)} GNF/m³, et le retour se fait à vide.`, metric: { label: "Marge", value: boke.margin_rate, unit: "pct", reference: 30, reference_label: "Seuil" }, impact_gnf: Math.abs(boke.net_result), confidence: 0.86, method: "Marge par route, rotations validées ; coût complet au m³ à pleine charge (carburant, péages, frais, entretien, structure imputée au km) ; seuil de marge paramétré.", evidence: { type: "table", data: { route: boke } }, action: boke.recommendation, link: "/analyse/transport?route=5" }),
      constat({ id: "transport.carburant_anormal.37", domain: "transport", severity: "high", title: "L'ensemble ER-07 consomme 18 % de plus que la flotte", narrative: `${nFr(er07.fuel_per_100km, 1)} L/100 km contre 39,1 pour la flotte : ${t.fuel_anomalies.length - 1} rotations dépassent le score robuste de 3,5 depuis août. Même chauffeur, mêmes routes : la cause est mécanique ou le carburant s'évapore.`, metric: { label: "Consommation", value: er07.fuel_per_100km, unit: "liters", reference: 39.1, reference_label: "Flotte" }, impact_gnf: sum(t.fuel_anomalies, (a) => a.excess_cost), confidence: 0.84, method: "Score robuste = 0,6745 × (x − médiane) / MAD de la consommation par rotation, flotte et historique de l'ensemble ; anomalie au-delà de 3,5.", evidence: { type: "scatter", data: { points: t.fuel_anomalies.map((a, i) => ({ x: i + 1, y: a.value, label: a.rotation, highlight: a.score > 3.5 })), x_label: "Rotation", y_label: "L/100 km" } }, action: "Immobiliser ER-07 pour contrôle injection et jauges ; comparer les pleins aux tickets de la station.", link: "/analyse/transport?truck=37" }),
      constat({ id: "transport.sous_utilisation.40", domain: "transport", severity: "medium", title: `${lents.length} ensembles roulent moins d'un jour sur deux`, narrative: `${lents.map((x) => x.name).join(", ")} affichent ${lents.map((x) => x.utilization_pct).join(", ")} % d'utilisation : des actifs qui attendent au parc, soit ${mds(sum(lents, (x) => x.structure) / 12)} de structure non couverte par mois.`, metric: { label: "Utilisation", value: r1(sum(lents, (x) => x.utilization_pct) / lents.length), unit: "pct", reference: 70, reference_label: "Cible" }, impact_gnf: sum(lents, (x) => x.structure) * 0.4, confidence: 0.8, method: "Jours en rotation / jours de la période par ensemble ; structure imputée au prorata des km.", evidence: barresEvidence(t.trucks.map((x) => x.name), t.trucks.map((x) => x.utilization_pct), "pct", t.trucks.length - 1), action: "Proposer les trois ensembles en sous-traitance à Transit Kamsar ou céder le plus ancien.", link: "/analyse/transport" }),
      constat({ id: "transport.manquants", domain: "transport", severity: "high", title: `Les manquants dépassent la tolérance sur ${pctFr(t.shortages.products[0].out_of_tolerance_pct)} des rotations de gasoil`, narrative: `${nFr(sum(t.shortages.products, (x) => x.shortage * 1000))} litres manquants sur 12 mois ; deux chauffeurs concentrent 38 % des écarts hors tolérance.`, metric: { label: "Part hors tolérance", value: t.shortages.products[0].out_of_tolerance_pct, unit: "pct", reference: 5, reference_label: "Seuil" }, impact_gnf: t.indicators.shortage_value, confidence: 0.83, method: "Écart entre volume chargé et volume livré par rotation ; tolérance paramétrée à 0,3 % ; agrégation par chauffeur, route et produit.", evidence: barresEvidence(t.shortages.drivers.slice(0, 6).map((x) => x.name.split(" ").at(-1)), t.shortages.drivers.slice(0, 6).map((x) => x.out_of_tolerance_pct), "pct"), action: "Double jaugeage au départ et à l'arrivée pour les deux chauffeurs concernés pendant un mois.", link: "/analyse/transport?onglet=manquants" }),
      constat({ id: "transport.meilleure_route.1", domain: "transport", severity: "positive", title: `La route ${kamsar.name} est la plus rentable`, narrative: `La route la plus fréquentée (${kamsar.rotations} rotations) tient ${pctFr(kamsar.margin_rate ?? 0)} de marge grâce au retour chargé en alumine ; elle porte ${pctFr(taux(kamsar.margin, t.indicators.margin) ?? 0)} de la marge transport.`, metric: { label: "Marge", value: kamsar.margin_rate, unit: "pct", reference: 30, reference_label: "Seuil" }, impact_gnf: null, confidence: 0.9, method: "Marge par route, rotations validées.", evidence: null, action: null, link: "/analyse/transport?route=1" }),
    ];
  }

  function constatsDepenses(p) {
    const d = depensesGroupe(p);
    const b = d.benford;
    const chiffre = b.suspicious[0] ?? 5;
    const pneus = d.suppliers.drift.find((x) => x.category === "acc.60");
    return [
      constat({ id: "depenses.benford", domain: "depenses", severity: b.conformity === "nonconformity" ? "high" : "medium", title: `Le chiffre ${chiffre} apparaît trop souvent en tête des factures`, narrative: `${pctFr(b.digits[chiffre - 1].observed, 1)} des ${nFr(b.n)} montants commencent par ${chiffre} contre ${pctFr(b.digits[chiffre - 1].expected, 1)} attendus (Benford) ; l'excès vient des factures d'entretien entre 500 000 et 599 999 GNF, juste sous le seuil d'approbation de 600 000.`, metric: { label: "Écart MAD de Nigrini", value: b.mad, unit: "ratio", reference: 0.012, reference_label: "Conformité acceptable" }, impact_gnf: 0.12e9, confidence: 0.76, method: "Distribution du premier chiffre des montants hors taxes, khi-deux à 8 degrés de liberté et MAD de Nigrini ; niveaux : proche (< 0,006), acceptable (< 0,012), marginale (< 0,015), non-conformité.", evidence: { type: "bars", data: { digits: b.digits } }, action: "Revoir le seuil d'approbation (le passer à 450 000 GNF) et contrôler 20 factures d'entretien de l'Atelier Sonfonia.", link: "/analyse/depenses?onglet=benford" }),
      constat({ id: "depenses.doublons", domain: "depenses", severity: "high", title: `${d.duplicates.length} factures semblent payées deux fois : ${mds(sum(d.duplicates, (x) => x.amount_at_risk))}`, narrative: "Même fournisseur, même montant à 1 % près, moins de 30 jours d'écart ; deux portent la même référence externe.", metric: { label: "Doublons probables", value: d.duplicates.length, unit: "count", reference: 0, reference_label: "Attendu" }, impact_gnf: sum(d.duplicates, (x) => x.amount_at_risk), confidence: 0.72, method: "Appariement des factures fournisseurs : même tiers, montant à 1 % près et moins de 30 jours, ou même référence ; score combiné.", evidence: { type: "table", data: { pairs: d.duplicates } }, action: "Demander un avoir à Pneus et Pièces Matoto et à Béton Ouest Africain avant tout nouveau règlement.", link: "/analyse/depenses?onglet=doublons" }),
      constat({ id: "depenses.derive.acc.60", domain: "depenses", severity: "medium", title: `Les achats dérivent de ${pctFr(pneus.slope_pct_per_month, 1)} par mois`, narrative: `Le montant moyen mensuel des achats passe de ${mds(pneus.monthly_avg_previous)} à ${mds(pneus.monthly_avg)} ; les pneus et pièces expliquent l'essentiel de la hausse, sans hausse du kilométrage : la dérive tient au prix, pas au volume.`, metric: { label: "Dérive mensuelle", value: pneus.slope_pct_per_month, unit: "pct", reference: 0.7, reference_label: "Inflation" }, impact_gnf: (pneus.monthly_avg - pneus.monthly_avg_previous) * 12, confidence: 0.7, method: "Régression du montant mensuel par catégorie sur 12 mois ; comparaison à la moyenne des 12 mois précédents.", evidence: serieEvidence(d.suppliers.months.map(moisCourt), pneus.monthly, "gnf"), action: "Mettre en concurrence deux fournisseurs de pneus et acheter par lot semestriel.", link: "/analyse/depenses?onglet=fournisseurs" }),
      constat({ id: "depenses.dependance_fournisseur", domain: "depenses", severity: "info", title: `${d.suppliers.pareto[0].name.replace(" (démo)", "")} concentre ${pctFr(d.suppliers.top_share)} des dépenses`, narrative: "Une dépendance normale pour un transporteur pétrolier, mais le contrat ne prévoit ni remise volume ni indexation.", metric: { label: "Part du premier fournisseur", value: d.suppliers.top_share, unit: "pct", reference: 40, reference_label: "Seuil" }, impact_gnf: d.suppliers.pareto[0].amount * 0.015, confidence: 0.88, method: "Pareto des achats par fournisseur sur la période.", evidence: null, action: "Négocier 1,5 % de remise au-delà de 8 Md GNF annuels.", link: "/analyse/depenses?onglet=fournisseurs" }),
      constat({ id: "depenses.montant_inhabituel.802", domain: "depenses", severity: "medium", title: `Une facture d'honoraires de ${mds(d.outliers[0].amount)} sort de l'ordinaire`, narrative: `La médiane des services extérieurs est de ${mds(d.outliers[0].median)} : cette facture du Cabinet Juridique Kaloum a un score robuste de ${nFr(d.outliers[0].score, 1)}.`, metric: { label: "Score robuste", value: d.outliers[0].score, unit: "ratio", reference: 3.5, reference_label: "Seuil" }, impact_gnf: d.outliers[0].amount, confidence: 0.7, method: "Score robuste par catégorie (médiane et MAD des montants) ; anomalie au-delà de 3,5.", evidence: null, action: "Vérifier la convention d'honoraires et le détail des diligences.", link: "/analyse/depenses?onglet=outliers" }),
      constat({ id: "depenses.carburant_maitrise", domain: "depenses", severity: "positive", title: "Le coût carburant au km baisse de 2 % sur le trimestre", narrative: "Malgré la hausse du gasoil, le coût au kilomètre recule grâce au retour chargé sur Kamsar et à la retraite d'ER-03.", metric: { label: "Coût carburant au km", value: 1670, unit: "gnf", reference: 1705, reference_label: "Trimestre précédent" }, impact_gnf: null, confidence: 0.82, method: "Carburant facturé / kilomètres validés par trimestre.", evidence: null, action: null, link: "/analyse/transport" }),
    ];
  }

  function constatsPrevisions(p) {
    const pv = previsionsGroupe(p);
    const ca = pv.landing.revenue;
    const ebe = pv.landing.ebe;
    const ecartCa = ((ca.estimate - ca.budget) / ca.budget) * 100;
    const ecartEbe = ((ebe.estimate - ebe.budget) / ebe.budget) * 100;
    return [
      constat({ id: "previsions.atterrissage_ca", domain: "previsions", severity: ecartCa >= 0 ? "positive" : ecartCa > -3 ? "medium" : "high", title: ecartCa >= 0 ? `Le chiffre d'affaires atterrirait ${pctFr(ecartCa, 1)} au-dessus du budget` : `Le chiffre d'affaires atterrirait ${pctFr(-ecartCa, 1)} sous le budget`, narrative: `Holt-Winters projette ${mds(ca.estimate)} pour l'exercice (fourchette ${mds(ca.low)} à ${mds(ca.high)}) contre ${mds(ca.budget)} budgétés ; probabilité d'atteindre le budget : ${pctFr(ca.probability_pct ?? 0)}. La saison sèche soutient le transport, le BTP ne rattrape pas son retard.`, metric: { label: "Atterrissage CA", value: ca.estimate, unit: "gnf", reference: ca.budget, reference_label: "Budget" }, impact_gnf: Math.abs(ca.estimate - ca.budget), confidence: 0.75, method: pv.method, evidence: { type: "series", data: { series: pv.revenue.series.slice(-12) } }, action: ecartCa >= 0 ? "Sécuriser l'avance : facturer les rotations de décembre avant la clôture." : "Avancer deux rotations hebdomadaires sur Kamsar en novembre et décembre.", link: "/analyse/previsions" }),
      constat({ id: "previsions.atterrissage_ebe", domain: "previsions", severity: ecartEbe >= 0 ? "positive" : ecartEbe > -5 ? "medium" : "high", title: ecartEbe >= 0 ? `L'EBE dépasserait le budget de ${pctFr(ecartEbe, 1)}` : `L'EBE manquerait le budget de ${pctFr(-ecartEbe, 1)}`, narrative: `${mds(ebe.estimate)} attendus contre ${mds(ebe.budget)} budgétés (probabilité d'atteindre le budget : ${pctFr(ebe.probability_pct ?? 0)}) : le carburant et la marge du BTP expliquent les deux tiers de l'écart.`, metric: { label: "Atterrissage EBE", value: ebe.estimate, unit: "gnf", reference: ebe.budget, reference_label: "Budget" }, impact_gnf: Math.abs(ebe.estimate - ebe.budget), confidence: 0.72, method: `Même méthode que le chiffre d'affaires, appliquée à l'EBE mensuel ; MAPE ${pctFr(pv.ebe.mape, 1)}.`, evidence: barresEvidence(["Bas (p10)", "Estimation", "Haut (p90)", "Budget"], [ebe.low, ebe.estimate, ebe.high, ebe.budget], "gnf", 3), action: `Simuler : +3 % de tarif transport rend ${mds(pv.sensitivities.tariff * 3)} d'EBE annuel ; voir le simulateur.`, link: "/analyse/previsions#simulateur" }),
      constat({ id: "previsions.rupture", domain: "previsions", severity: "medium", title: `Rupture de niveau de l'EBE depuis ${moisCourt(pv.ebe.series[pv.ebe.cusum.index].month)} ${pv.ebe.series[pv.ebe.cusum.index].month.slice(0, 4)}`, narrative: `Le test CUSUM détecte une baisse de niveau : ${mds(pv.ebe.cusum.mean_before)} par mois avant, ${mds(pv.ebe.cusum.mean_after)} après. La prévision tient compte du nouveau niveau.`, metric: { label: "Niveau après rupture", value: pv.ebe.cusum.mean_after, unit: "gnf", reference: pv.ebe.cusum.mean_before, reference_label: "Avant" }, impact_gnf: (pv.ebe.cusum.mean_before - pv.ebe.cusum.mean_after) * 12, confidence: 0.7, method: "CUSUM sur les résidus standardisés de la série mensuelle ; alarme au-delà de 4 écarts-types cumulés.", evidence: { type: "series", data: { series: pv.ebe.series.slice(-12) } }, action: "Lire le pont d'EBE : la rupture coïncide avec la hausse des coûts du transport.", link: "/analyse/rentabilite" }),
      constat({ id: "previsions.saison", domain: "previsions", severity: "positive", title: "La saison sèche apporte 11 % de volume transport en plus", narrative: "Les trois dernières années montrent le même ressaut de novembre à mai : le quatrième trimestre est le meilleur moment pour négocier les tarifs.", metric: { label: "Effet saisonnier", value: 11, unit: "pct", reference: null, reference_label: null }, impact_gnf: null, confidence: 0.85, method: "Composante saisonnière du lissage de Holt-Winters.", evidence: serieEvidence(MOIS_MODELE.slice(-12).map(moisCourt), MOIS_MODELE.slice(-12).map((k) => r1((ACTIVITES[0].saison(+k.slice(5, 7)) - 1) * 100)), "pct", 0), action: null, link: "/analyse/previsions" }),
    ];
  }

  function constatsFiabilite() {
    const mauvais = CONTROLES.filter((c) => c.status !== "good");
    const bons = CONTROLES.filter((c) => c.status === "good");
    return [
      ...mauvais.map((c) => constat({ id: `fiabilite.${c.key}`, domain: "fiabilite", severity: c.status === "bad" ? "high" : "medium", title: `${c.label} : à corriger`, narrative: c.detail, metric: { label: c.label, value: c.value, unit: c.unit, reference: c.target, reference_label: "Cible" }, impact_gnf: c.amount, confidence: 0.95, method: c.definition, evidence: null, action: c.action, link: c.link })),
      constat({ id: "fiabilite.controles_conformes", domain: "fiabilite", severity: "positive", title: `${bons.length} contrôles sur ${CONTROLES.length} sont conformes`, narrative: `Comptes d'attente soldés, tiers rattachés, comptes classés dans les états, saisie dans les délais : les déclarations fiscales se préparent sans retraitement.`, metric: { label: "Contrôles conformes", value: bons.length, unit: "count", reference: CONTROLES.length, reference_label: "Total" }, impact_gnf: null, confidence: 0.98, method: "Contrôles de clôture, période en cours.", evidence: null, action: null, link: "/analyse/fiabilite" }),
    ];
  }

  /* ═══ Routes ══════════════════════════════════════════════════════════ */

  const Q = {
    synthese: () => QUALITE_SYNTHESE, rentabilite: () => qualite(["analytic"]), tresorerie: () => qualite(["bank_reconciled", "suspense"]), clients: () => qualite(["partners_vat"]), transport: () => qualite(["rotations_fuel", "unbilled_rotations", "analytic"]), depenses: () => qualite(["attachments", "analytic", "old_drafts"]), previsions: () => ({ score: 100, notes: [] }), fiabilite: () => QUALITE_SYNTHESE,
  };
  const groupe = (chemin, construire) =>
    route("GET", `/analyse/groupe/${chemin}`, PROFILS, (ctx) => {
      exigerEntite(ctx, "groupe");
      const p = periode(ctx.query);
      const { insights, ...corps } = construire(p);
      return enveloppe(ctx, "groupe", p, Q[chemin](), insights, corps);
    });

  groupe("synthese", (p) => ({
    insights: classer([...constatsRentabilite(p), ...constatsTresorerie(p), ...constatsClients(p), ...constatsTransport(p), ...constatsDepenses(p), ...constatsPrevisions(p), ...constatsFiabilite()], 10),
    kpis: kpisGroupe(p), health: santeGroupe(p), waterfall: cascadeGroupe(p),
    monthly: serieMensuelle(24, [["revenue", "Chiffre d'affaires", "gnf", (l) => l.revenue], ["ebe", "Excédent brut d'exploitation", "gnf", (l) => l.ebe], ["cash", "Trésorerie fin de mois", "gnf", (l) => l.cash]]),
    activities: activitesGroupe(p),
  }));

  groupe("rentabilite", (p) => {
    const months = MOIS_MODELE.slice(-12);
    const by_activity = {
      months,
      series: ACTIVITES.flatMap((a) => [
        { key: `revenue.${a.id}`, label: `${a.name} : produits`, unit: "gnf", activity_id: a.id, measure: "revenue", values: months.map((k) => ligne(k).activites[a.key].revenue) },
        { key: `margin.${a.id}`, label: `${a.name} : marge`, unit: "gnf", activity_id: a.id, measure: "margin", values: months.map((k) => ligne(k).activites[a.key].margin) },
      ]),
      totals: activitesGroupe(p).map((a) => ({ activity_id: a.id, name: a.name, revenue: a.revenue, margin: a.margin, margin_rate: a.margin_rate })),
    };
    return { insights: classer(constatsRentabilite(p)), by_activity, bridge: pontEbe(p), transport_effects: effetsTransport(p), cost_structure: structureCouts(p), budget_variance: ecartsBudget(p), metiers: { chantiers: chantiers(p), immobilier: immobilier(p) } };
  });

  groupe("tresorerie", (p) => ({ insights: classer(constatsTresorerie(p)), ...tresorerieGroupe(p) }));
  groupe("clients", (p) => ({ insights: classer(constatsClients(p)), ...clientsGroupe(p) }));
  groupe("transport", (p) => ({ insights: classer(constatsTransport(p)), ...transportGroupe(p) }));
  groupe("depenses", (p) => ({ insights: classer(constatsDepenses(p)), ...depensesGroupe(p) }));
  groupe("previsions", (p) => ({ insights: classer(constatsPrevisions(p)), ...previsionsGroupe(p) }));
  groupe("fiabilite", () => ({ insights: classer(constatsFiabilite()), score: SCORE_FIABILITE, checks: CONTROLES }));
}
