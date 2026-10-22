/**
 * NIMOVA · Analyse, MB AxisPro (chapitre 6 de la spécification) : un portefeuille de
 * quatorze projets sur les huit gates de la méthode, leurs évaluations, comités, financements,
 * temps et risques, puis les sept routes /analyse/cabinet/* dans les formes exactes du noyau.
 * Données fictives et déterministes.
 */

import { addDays, classer, constat, daysBetween, kpi, lundi, mds, median, moisCourt, moisEntre, moisJusqua, nFr, pctFr, poidsMois, quantile, r1, r2, r3, round, sigmoide, sum, taux, variation } from "./analyse-commun.mjs";

const PROFILS = ["admin", "direction", "cabinet"];
const PROFILS_ACTIVITE = ["admin", "direction", "finance", "cabinet"];

export function routesCabinet({ route, makeRng, TODAY, periode, enveloppe, exigerEntite }) {
  /* ═══ Référentiels ════════════════════════════════════════════════════ */

  const GATES = [
    ["G0", "Project Intake", "intake"], ["G1", "Prequalification", "prequalification"], ["G2", "Pre-feasibility", "feasibility"], ["G3", "APD Readiness", "apd"],
    ["G4", "Investment / Bankability Review", "bankability"], ["G5", "Due Diligence", "due_diligence"], ["G6", "SPV & Financing Structuring", "structuring"], ["G7", "Financial Close", "closing"],
  ].map(([gate, label, rule], i) => ({ gate, label, rule, sequence: i + 1 }));
  const SEUILS = { readiness: 65, bankability: 80 };
  const DOMAINES = [
    ["DOM01", "Définition du projet", "Note de présentation / fiche projet actualisée"], ["DOM02", "Promoteur / KYC", "Dossier KYC complet (statuts, RCCM, dirigeants)"], ["DOM03", "Technique", "Étude technique et devis fournisseurs fermes"], ["DOM04", "Foncier et localisation", "Titre, plan ou attestation du service foncier"],
    ["DOM05", "Marché", "Étude de marché datée de moins de deux ans"], ["DOM06", "Modèle financier", "Modèle financier bancable sur 10 ans"], ["DOM07", "Juridique", "Statuts, contrats clés et autorisations"], ["DOM08", "ESG / Environnement / Social / HSSE", "Étude d'impact et plan de gestion"],
  ].map(([code, label, deliverable]) => ({ code, label, deliverable }));
  const CONSULTANTS = ["Aïssatou Barry", "Thierno Diallo", "Aminata Keïta", "Mamadou Saliou Sow", "Fatou Bangoura"].map((name, i) => ({ id: 11 + i, name }));
  const SERVICES = [["projets", "Gestion de projets"], ["formation", "Formation et coaching"], ["conseil", "Conseil"], ["audit_transporteurs", "Audit d'évaluation des transporteurs"], ["certification", "Certification"]].map(([key, label]) => ({ key, label }));
  const DOSSIERS = [
    ["AX/2025/0004", "Rizerie moderne de Kankan", "Agro-industrie", "Kankan", "Coopérative Rizicole du Milo (démo)", 5, 71, 68, 8.4e9, 12.1e9, "2025-03-12"],
    ["AX/2025/0007", "Laiterie du Fouta", "Agro-industrie", "Labé", "Laiterie du Fouta SARL (démo)", 4, 66, 54, 3.2e9, 4.6e9, "2025-05-20"],
    ["AX/2025/0009", "Pêcheries de Kamsar", "Pêche", "Boké", "Pêcheries de Kamsar SA (démo)", 2, 58, 41, 5.6e9, 7.9e9, "2025-06-30"],
    ["AX/2025/0011", "Centrale solaire de Kindia", "Énergie", "Kindia", "Solaire de Kindia SA (démo)", 6, 82, 79, 21e9, 28e9, "2025-02-05"],
    ["AX/2025/0013", "Clinique Sainte-Marie", "Santé", "Conakry", "Clinique Sainte-Marie SARL (démo)", 1, 44, 28, 2.1e9, 3.0e9, "2025-09-15"],
    ["AX/2026/0001", "Carrière de granit de Mamou", "Mines et carrières", "Mamou", "Granits de Mamou SA (démo)", 2, 52, 39, 6.8e9, 9.4e9, "2026-01-12"],
    ["AX/2026/0002", "Plateforme logistique de Matoto", "Transport et logistique", "Conakry", "Logistique Matoto SA (démo)", 4, 69, 61, 9.1e9, 13.5e9, "2026-01-26"],
    ["AX/2026/0003", "Résidence étudiante de Sonfonia", "Immobilier", "Conakry", "Habitat Sonfonia SARL (démo)", 1, 38, 22, 4.4e9, 6.2e9, "2026-02-18"],
    ["AX/2026/0005", "Huilerie de palme de N'Zérékoré", "Agro-industrie", "N'Zérékoré", "Palmeraies du Sud SA (démo)", 2, 61, 47, 3.9e9, 5.3e9, "2026-03-09"],
    ["AX/2026/0006", "Lycée technique privé de Labé", "Éducation", "Labé", "Fondation Éducation Fouta (démo)", 0, 31, 15, 1.8e9, 2.4e9, "2026-07-21"],
    ["AX/2026/0008", "Mini-réseau hydroélectrique de Dalaba", "Énergie", "Mamou", "Hydro Dalaba SA (démo)", 3, 64, 57, 12.6e9, 16.8e9, "2026-03-30"],
    ["AX/2026/0010", "Chaîne du froid de Kindia", "Agro-industrie", "Kindia", "Froid de Kindia SARL (démo)", 1, 47, 33, 2.7e9, 3.6e9, "2026-05-04"],
    ["AX/2026/0012", "Transport fluvial du Milo", "Transport et logistique", "Kankan", "Navigation du Milo SARL (démo)", 0, 27, 12, 3.3e9, 4.1e9, "2026-08-25"],
    ["AX/2026/0014", "Unité de transformation de cajou", "Agro-industrie", "Boké", "Cajou de Boké SA (démo)", 3, 55, 44, 4.8e9, 6.9e9, "2026-04-14"],
  ].map(([reference, name, sector, location, promoter, gate, readiness, bankability, need, investment, opened], i) => ({ id: 1 + i, reference, name, sector, location, promoter, gate, readiness, bankability, need, investment, opened, knockout: i === 4 || i === 12, link: `/axispro/dossiers/${1 + i}` }));
  const ref = (d) => ({ id: d.id, reference: d.reference, name: d.name, link: d.link });
  const dossier = (id) => DOSSIERS.find((d) => d.id === id);
  const K = Math.log(4) / 15;
  const probabilite = (d) => (d.knockout ? 0 : r3(sigmoide(K * (d.bankability - 65))));
  const recommandation = (d) => (d.knockout ? "no_go" : d.bankability >= SEUILS.bankability ? "bankable" : d.readiness >= SEUILS.readiness ? "apd_ready" : d.readiness >= 50 ? "conditional" : d.readiness >= 30 ? "hold" : "pending");
  const RECO_LABEL = { bankable: "BANKABLE CANDIDATE", apd_ready: "APD READY", go: "GO", conditional: "CONDITIONAL GO", hold: "HOLD", no_go: "NO-GO", pending: "À compléter" };
  const DECISIONS = [["go", "GO"], ["conditional", "CONDITIONAL GO"], ["hold", "HOLD"], ["no_go", "NO-GO"], ["postponed", "Ajourné"]];
  const MOIS_12 = moisJusqua(TODAY, 12);
  const MOIS_24 = moisJusqua(TODAY, 24);
  // Séjours en gate : médianes historiques par gate (jours) et âge des dossiers présents.
  const MEDIANES_GATE = [9, 24, 94, 57, 48, 36, 41, 30];
  const AGES_EN_GATE = { 0: [21, 54], 1: [63, 38, 17], 2: [112, 96, 71], 3: [44, 29], 4: [52, 33], 5: [27], 6: [19], 7: [] };

  /* ═══ Honoraires et temps ═════════════════════════════════════════════ */

  function honorairesMois(k) {
    const r = makeRng(`honoraires-${k}`);
    const i = MOIS_24.indexOf(k);
    const m = +k.slice(5, 7);
    return round(0.205e9 * (1 + 0.09 * ((i - 23) / 12)) * (m === 8 ? 0.7 : m === 12 ? 1.25 : 1) * r.noise(0.12));
  }
  const sommeHonoraires = (p) => {
    const mois = moisEntre(p.date_from, p.date_to);
    const poids = poidsMois(mois, p);
    return sum(mois, (k, i) => honorairesMois(k) * poids[i]);
  };
  const TAUX = 180000;
  const PARTS_SERVICES = [0.46, 0.12, 0.3, 0.08, 0.04];

  /* ═══ Qualité et constats ═════════════════════════════════════════════ */

  const NOTES = {
    portefeuille: ["2 dossiers en Project Intake sans aucun critère évalué : exclus des moyennes de score."],
    diagnostic: ["6 critères des gates atteints restent à évaluer sur 3 dossiers : écarts sous-estimés d'autant."],
    comites: ["1 revue de comité de la période non verrouillée : hors analyse des décisions."],
    financements: [],
    activite: ["Temps non saisi : 3 semaines pour Fatou Bangoura.", "12 M GNF de chiffre d'affaires sans activité analytique sur la période."],
    risques: ["3 risques ouverts sans mesure d'atténuation décrite."],
  };
  const QUALITE = { portefeuille: 90, diagnostic: 88, comites: 95, financements: 100, activite: 82, risques: 94 };
  const qualite = (section) => ({ score: QUALITE[section], notes: NOTES[section] });
  const qualiteSynthese = () => ({ score: round(sum(Object.values(QUALITE)) / Object.keys(QUALITE).length), notes: Object.values(NOTES).flat() });

  /* ═══ Synthèse ════════════════════════════════════════════════════════ */

  function kpisCabinet(p) {
    const actifs = DOSSIERS.length;
    const besoin = sum(DOSSIERS, (d) => d.need);
    const pondere = sum(DOSSIERS, (d) => d.need * probabilite(d));
    const evalues = DOSSIERS.filter((d) => d.gate > 0);
    const readiness = sum(evalues, (d) => d.readiness) / evalues.length;
    const honoraires = sommeHonoraires(p);
    const honorairesPrev = sommeHonoraires(p.previous);
    const trendHonoraires = MOIS_12.map((k) => honorairesMois(k));
    return [
      kpi({ key: "active_dossiers", label: "Dossiers actifs", value: actifs, unit: "count", previous: 11, status: "good", definition: "Dossiers en cours à la date d'arrêté ; 1 dossier suspendu en plus, hors dossiers clos.", trend: [9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14] }),
      kpi({ key: "financing_need", label: "Besoin de financement", value: besoin, unit: "gnf", previous: 71e9, status: "neutral", definition: "Besoin de financement cumulé des dossiers en cours et suspendus (dossiers en devise convertis au cours de la date d'arrêté).", trend: [58, 61, 63, 66, 68, 71, 74, 78, 81, 84, 88, 90].map((v) => v * 1e9) }),
      kpi({ key: "weighted_pipeline", label: "Pipeline pondéré", value: pondere, unit: "gnf", previous: 24.8e9, status: pondere >= 24.8e9 ? "good" : "warn", definition: "Besoin de financement × probabilité de bancabilité de chaque dossier (fonction logistique du score Bankability : 50 → 20 %, 65 → 50 %, 80 → 80 % ; nulle si un knock-out est confirmé).", trend: [16, 17, 19, 20, 22, 23, 24, 25, 27, 28, 30, 31].map((v) => v * 1e9) }),
      kpi({ key: "readiness_avg", label: "Score moyen Readiness", value: readiness, unit: "score", previous: 52.3, target: SEUILS.readiness, status: readiness >= SEUILS.readiness ? "good" : "warn", definition: `Moyenne du Project Readiness des dossiers du portefeuille dont au moins un critère est évalué (${evalues.length} sur ${actifs}) ; cible : seuil APD READY de la politique.`, trend: [48, 49, 50, 51, 52, 52, 53, 54, 55, 55, 56, 57] }),
      kpi({ key: "gate_pass_rate", label: "Taux de passage de gate", value: 71, unit: "pct", previous: 64, status: "warn", definition: "Part des revues de comité verrouillées de la période concluant à GO ou CONDITIONAL GO (hors ajournements).", trend: [60, 62, 61, 65, 66, 64, 68, 69, 70, 69, 71, 71] }),
      kpi({ key: "gate_median_days", label: "Durée médiane d'un gate", value: 62, unit: "days", previous: 71, target: 60, status: "warn", definition: "Médiane des séjours achevés dans un gate sur la période (journal des passages), hors recevabilité ; cible : 60 jours.", trend: [78, 76, 74, 72, 71, 70, 68, 66, 65, 64, 63, 62], inverse: true }),
      kpi({ key: "fees", label: "Honoraires de la période", value: honoraires, unit: "gnf", previous: honorairesPrev, status: honoraires >= honorairesPrev ? "good" : "warn", definition: "Chiffre d'affaires hors taxes du cabinet (comptes 70, pièces validées) sur la période, comparé à la même période un an plus tôt.", trend: trendHonoraires }),
      kpi({ key: "realization_rate", label: "Taux de réalisation", value: 78.4, unit: "pct", previous: 82.1, target: 85, status: "warn", definition: "Honoraires facturés rapportés à la valeur du temps passé (heures × taux horaire standard).", trend: [84, 83, 82, 82, 81, 80, 80, 79, 79, 78, 78, 78.4] }),
    ];
  }

  function entonnoir(complet) {
    return GATES.map((g, i) => {
      const dans = DOSSIERS.filter((d) => d.gate === i);
      const atteint = DOSSIERS.filter((d) => d.gate >= i).length + (i <= 2 ? 2 : i <= 4 ? 1 : 0);
      const atteintSuivant = i === GATES.length - 1 ? null : DOSSIERS.filter((d) => d.gate >= i + 1).length + (i + 1 <= 2 ? 2 : i + 1 <= 4 ? 1 : 0);
      const base = { gate: g.gate, label: g.label, count: dans.length, need: sum(dans, (d) => d.need), investment: sum(dans, (d) => d.investment), conversion_pct: atteintSuivant === null || !atteint ? null : r1((atteintSuivant / atteint) * 100) };
      if (!complet) return base;
      return { ...base, sequence: g.sequence, rule: g.rule, on_hold: i === 1 ? 1 : 0, weighted_need: round(sum(dans, (d) => d.need * probabilite(d))), reached: atteint, dropped: i <= 2 ? 1 : 0, pass_rate_pct: [100, 83.3, 71.4, 80, 75, 100, 100, null][i] };
    });
  }

  function maturite() {
    return DOSSIERS.filter((d) => d.gate > 0).map((d) => ({ id: d.id, reference: d.reference, name: d.name, readiness: d.readiness, bankability: d.bankability, need: d.need, recommendation: recommandation(d), sector: d.sector, gate: GATES[d.gate].gate, probability: probabilite(d), link: d.link }));
  }
  function seuilsMaturite() {
    const pts = maturite();
    const dans = (r, b) => pts.filter((m) => (r[0] <= m.readiness && m.readiness < r[1] + (r[1] === 100 ? 1 : 0)) && (b[0] <= m.bankability && m.bankability < b[1] + (b[1] === 100 ? 1 : 0))).length;
    const q = (key, label, readiness, bankability) => ({ key, label, readiness, bankability, count: dans(readiness, bankability) });
    return { readiness: SEUILS.readiness, bankability: SEUILS.bankability, quadrants: [q("presentable", "Présentables aux financeurs", [65, 100], [80, 100]), q("structure", "Prêts techniquement, à structurer financièrement", [65, 100], [0, 80]), q("confirm", "Bancabilité à confirmer sur le fond", [0, 65], [80, 100]), q("upstream", "À accompagner en amont", [0, 65], [0, 80])] };
  }

  /* ═══ Portefeuille ════════════════════════════════════════════════════ */

  function portefeuille(p) {
    const r = makeRng("analyse-portefeuille");
    const time_in_gate = GATES.map((g, i) => {
      const ages = AGES_EN_GATE[i];
      const n = [12, 11, 9, 7, 5, 3, 2, 1][i];
      return { gate: g.gate, label: g.label, median_days: MEDIANES_GATE[i], p75_days: round(MEDIANES_GATE[i] * 1.45), n, km_median_days: round(MEDIANES_GATE[i] * 1.12), period_median_days: round(MEDIANES_GATE[i] * 0.95), period_n: Math.max(0, n - 4), in_gate: ages.length, median_age_days: ages.length ? round(median(ages)) : null, max_age_days: ages.length ? Math.max(...ages) : null, forced: i === 2 || i === 3 ? 1 : 0 };
    });
    const charge = time_in_gate.map((t) => (t.median_age_days ?? 0) * t.in_gate);
    const iGoulot = charge.indexOf(Math.max(...charge));
    const goulot = time_in_gate[iGoulot];
    const dansGoulot = DOSSIERS.filter((d) => d.gate === iGoulot);
    const bottleneck = { gate: goulot.gate, label: goulot.label, in_gate: goulot.in_gate, median_days: goulot.median_days, median_age_days: goulot.median_age_days, km_median_days: goulot.km_median_days, days_per_dossier: goulot.median_age_days, load_days: charge[iGoulot], need: sum(dansGoulot, (d) => d.need), comment: `${goulot.in_gate} dossiers en attente depuis ${goulot.median_age_days} jours en médiane ; durée médiane des passages achevés : ${goulot.median_days} jours. L'étude de marché et le modèle financier manquent dans la plupart des cas.`, dossiers: dansGoulot.map((d, k) => ({ ...ref(d), age_days: AGES_EN_GATE[iGoulot][k] })) };
    const besoinTotal = sum(DOSSIERS, (d) => d.need);
    const grouper = (cle) => [...new Set(DOSSIERS.map((d) => d[cle]))].map((v) => {
      const ds = DOSSIERS.filter((d) => d[cle] === v);
      const evalues = ds.filter((d) => d.gate > 0);
      return { key: v, label: v, count: ds.length, need: sum(ds, (d) => d.need), investment: sum(ds, (d) => d.investment), weighted_need: round(sum(ds, (d) => d.need * probabilite(d))), avg_score: evalues.length ? r1(sum(evalues, (d) => d.readiness) / evalues.length) : null, bankability_avg: evalues.length ? r1(sum(evalues, (d) => d.bankability) / evalues.length) : null, share_pct: r1((sum(ds, (d) => d.need) / besoinTotal) * 100) };
    }).sort((a, b) => b.need - a.need);
    const by_sector = grouper("sector");
    const hhi = r3(sum(by_sector, (s) => (s.need / besoinTotal) ** 2));
    const dossiers = DOSSIERS.map((d) => ({ ...ref(d), gate: GATES[d.gate].gate, need: d.need, bankability: d.gate > 0 ? d.bankability : null, probability: probabilite(d), weighted: round(d.need * probabilite(d)), knockout: d.knockout, knockouts: d.knockout ? [d.id === 5 ? "C041" : "C034"] : [], recommendation: recommandation(d) })).sort((a, b) => b.weighted - a.weighted);
    const weighted = sum(dossiers, (d) => d.weighted);
    const velocite = [1.4, 0.9, 0.5, 0.6, 0.5, 0.4, 0.3, 0.2];
    const cible = (i, rule, historique, attendu3, attendu6) => {
      const candidats = DOSSIERS.filter((d) => d.gate < i && d.gate >= i - 3).map((d) => {
        const restants = GATES.slice(d.gate, i).reduce((s, _, k) => s + MEDIANES_GATE[d.gate + k], 0) - (AGES_EN_GATE[d.gate]?.[0] ?? 0);
        const eta = Math.max(15, round(restants * r.noise(0.2)));
        return { ...ref(d), gate: GATES[d.gate].gate, eta_days: eta, eta_date: addDays(p.date_to, eta), pass_probability: d.knockout ? null : r2(Math.min(0.95, 0.35 + d.readiness / 150)), knockout: d.knockout };
      });
      return { gate: GATES[i].gate, label: GATES[i].label, rule, expected_3m: attendu3, expected_6m: attendu6, interval_3m: [Math.max(0, attendu3 - 1), attendu3 + 1], interval_6m: [Math.max(0, attendu6 - 2), attendu6 + 2], method: "holt", mape: 22.5, history: { months: MOIS_12, values: historique }, candidates: candidats };
    };
    return {
      funnel: entonnoir(true), time_in_gate, bottleneck, by_sector, by_location: grouper("location"),
      concentration: { hhi, top: by_sector[0].key, top_share_pct: by_sector[0].share_pct },
      pipeline_value: { raw: besoinTotal, weighted, ratio_pct: r1((weighted / besoinTotal) * 100), method: "Probabilité = 1 / (1 + e^(-k (Bankability - 65))), k = ln 4 / 15 (50 → 0,2 ; 65 → 0,5 ; 80 → 0,8), nulle si un knock-out est confirmé sur un critère évalué.", dossiers },
      forecast: { apd_3m: 2, apd_6m: 4, bankability_3m: 1, bankability_6m: 3, velocity: GATES.map((g, i) => ({ gate: g.gate, label: g.label, dossiers_per_month: velocite[i] })), targets: [cible(3, "apd", [0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1], 2, 4), cible(4, "bankability", [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 1, 3)] },
    };
  }

  /* ═══ Diagnostic ══════════════════════════════════════════════════════ */

  function diagnostic(p) {
    const r = makeRng("analyse-diagnostic");
    const moyennes = [72, 68, 62, 49, 54, 41, 57, 45];
    const cells = [];
    for (const d of DOSSIERS) for (const [k, dom] of DOMAINES.entries()) {
      const score = d.gate === 0 ? null : d.gate === 1 && r.chance(0.3) ? null : Math.max(5, Math.min(98, r1(moyennes[k] + (d.readiness - 55) * 0.8 + (r.next() * 2 - 1) * 12)));
      const priority = score === null ? null : score < 40 ? "high" : score < 60 ? "medium" : "low";
      cells.push({ dossier: d.reference, dossier_id: d.id, domain: dom.code, score, priority, priority_label: priority === null ? null : { high: "HAUTE", medium: "MOYENNE", low: "FAIBLE" }[priority] });
    }
    const averages = DOMAINES.map((dom) => {
      const notes = cells.filter((c) => c.domain === dom.code && c.score !== null);
      const faibles = notes.filter((c) => c.score < 50).length;
      return { code: dom.code, label: dom.label, mean: notes.length ? r1(sum(notes, (c) => c.score) / notes.length) : null, method_mean: notes.length ? r1(sum(notes, (c) => c.score) / notes.length - 1.5) : null, n: notes.length, weak: faibles, weak_share_pct: notes.length ? r1((faibles / notes.length) * 100) : null, deliverable: dom.deliverable };
    });
    const faibles = DOSSIERS.filter((d) => d.gate > 0 && d.readiness < 70);
    const ecart = (code, label, k, gate, frequency, partial, knockout, critical, theme, criterion_id) => {
      const concernes = faibles.slice(0, frequency);
      return { code, label, domain: DOMAINES[k].label, domain_code: DOMAINES[k].code, gate, due: concernes.length + 2, frequency, not_met: frequency - partial, partial, requalified: knockout ? 1 : 0, knockout, critical, need: sum(concernes, (d) => d.need), criterion_id, theme, frequency_pct: r1((frequency / DOSSIERS.filter((d) => d.gate > 0).length) * 100), avg_priority: r1(2 + frequency / 5), dossiers: concernes.map((d) => d.reference), details: concernes.map((d, i) => ({ ...ref(d), status: i < partial ? "partial" : "not_met" })) };
    };
    const top_gaps = [
      ecart("C063", "Plan de trésorerie à 36 mois", 5, "G2", 8, 2, false, true, "Modèle financier bancable", 63), ecart("C061", "Hypothèses de prix et de volume documentées", 5, "G2", 7, 3, false, false, "Modèle financier bancable", 61), ecart("C052", "Étude de marché datée de moins de deux ans", 4, "G2", 7, 2, false, true, "Étude de marché express", 52),
      ecart("C024", "États financiers certifiés (3 exercices)", 1, "G1", 6, 1, false, false, "Mise à niveau comptable", 24), ecart("C034", "Terrain identifié et superficie", 3, "G1", 6, 2, true, true, "Titre, plan ou attestation à obtenir auprès du service foncier", 34), ecart("C081", "Étude d'impact environnemental", 7, "G3", 5, 1, false, false, "Conformité ESG", 81),
      ecart("C071", "Organes de gouvernance formalisés", 6, "G2", 5, 2, false, false, "Gouvernance d'entreprise", 71), ecart("C032", "Devis fournisseurs fermes", 2, "G2", 4, 2, false, false, "Ingénierie des coûts", 32), ecart("C021", "Équipe dirigeante au complet", 1, "G1", 4, 1, false, false, "Recrutement et coaching", 21),
    ];
    const themes = DOMAINES.map((dom) => {
      const ecarts = top_gaps.filter((g) => g.domain_code === dom.code);
      return { domain: dom.code, label: dom.label, gaps: sum(ecarts, (g) => g.frequency), dossiers: new Set(ecarts.flatMap((g) => g.dossiers)).size, criteria: ecarts.map((g) => g.code), deliverable: dom.deliverable };
    }).filter((t) => t.gaps > 0).sort((a, b) => b.gaps - a.gaps);
    const knockouts = [
      { code: "C041", label: "Autorisation d'exercice ou licence sectorielle", domain: "Juridique", ids: [5] }, { code: "C034", label: "Titre de propriété ou droit d'usage du site", domain: "Foncier et localisation", ids: [13] }, { code: "C022", label: "Promoteur sans interdiction bancaire", domain: "Promoteur / KYC", ids: [] }, { code: "C050", label: "Contrats d'achat / Offtake signés ou en négociation avancée", domain: "Marché", ids: [] },
    ].map((k) => ({ code: k.code, label: k.label, domain: k.domain, count: k.ids.length, need: sum(k.ids, (id) => dossier(id).need), dossiers: k.ids.map((id) => dossier(id).reference), details: k.ids.map((id) => ref(dossier(id))) }));
    const manquantes = [[3, "C081", "Étude d'impact environnemental", "G3", 72], [8, "C052", "Étude de marché", "G2", 41], [8, "C063", "Plan de trésorerie à 36 mois", "G2", 41], [6, "C024", "États financiers certifiés", "G1", 19], [12, "C034", "Titre foncier", "G1", 88], [14, "C032", "Devis fournisseurs fermes", "G2", 12], [2, "C071", "Procès-verbaux des organes", "G2", 7], [11, "C061", "Hypothèses de prix", "G2", 33], [9, "C052", "Étude de marché", "G2", 64]];
    const rows = manquantes.map(([id, code, label, gate, age_days]) => ({ ...ref(dossier(id)), code, label, gate, age_days }));
    const tranches = [["0_30", "0 à 30 jours", (a) => a <= 30], ["31_60", "31 à 60 jours", (a) => a > 30 && a <= 60], ["61_90", "61 à 90 jours", (a) => a > 60 && a <= 90], ["plus_90", "Plus de 90 jours", (a) => a > 90]];
    const dates = ["2026-01-15", "2026-03-15", "2026-05-15", "2026-07-15", "2026-09-15", p.date_to].filter((d, i, arr) => d <= p.date_to && (i === arr.length - 1 || d < p.date_to));
    const progressionRows = DOSSIERS.filter((d) => d.gate > 0).map((d, i) => {
      const rr = makeRng(`progression-${i}`);
      const depuis = dates.findIndex((dt) => dt >= d.opened);
      const scores = dates.map((_, j) => (j < Math.max(0, depuis) ? null : Math.max(5, round(d.readiness - (dates.length - 1 - j) * (3 + rr.next() * 4)))));
      const premiers = scores.findIndex((s) => s !== null);
      const first_readiness = premiers >= 0 ? scores[premiers] : null;
      const first_date = premiers >= 0 ? dates[premiers] : null;
      const days = first_date ? daysBetween(first_date, p.date_to) : 0;
      const delta = first_readiness === null ? null : d.readiness - first_readiness;
      return { id: d.id, reference: d.reference, name: d.name, first_date, first_readiness, readiness: d.readiness, delta, days, velocity_per_month: delta === null || !days ? null : r1((delta / days) * 30), points: dates.map((date, j) => ({ date, readiness: scores[j], apd: scores[j] === null ? null : round(scores[j] * 0.9), bankability: scores[j] === null ? null : round(scores[j] * (d.bankability / Math.max(1, d.readiness))), decision: j === dates.length - 1 ? null : rr.chance(0.3) ? "conditional" : null, source: j === dates.length - 1 ? "evaluation" : "review" })), link: d.link, _scores: scores };
    });
    const vitesses = progressionRows.map((x) => x.velocity_per_month).filter((v) => v !== null);
    const progression = { dates, dossiers: progressionRows.map((x) => ({ id: x.id, reference: x.reference, scores: x._scores })), rows: progressionRows.map(({ _scores, ...x }) => x), median_velocity_per_month: vitesses.length ? r1(median(vitesses)) : null, improving: progressionRows.filter((x) => (x.delta ?? 0) > 0).length, stagnating: progressionRows.filter((x) => (x.velocity_per_month ?? 1) <= 0.5 && x.days > 60).map((x) => x.id) };
    // Suivi par compartiment (outil de scoring du cabinet, version 3).
    const evalues = DOSSIERS.filter((d) => d.gate > 0);
    const compartments = [
      ["C0", "Coordination et cadrage projet", ["Présentation et cadrage stratégique du projet"], 66, 9, 5, 0, [["Awa Camara", 6]]],
      ["C1", "Foncier et autorisations", ["Maîtrise foncière et implantation du site", "Autorisations et conformité réglementaire"], 38, 41, 12, 2, [["Moussa Diallo", 5], ["Awa Camara", 2]]],
      ["C2", "Technique et ingénierie", ["Conception technique et ingénierie du projet"], 55, 30, 8, 0, [["Ibrahima Sow", 7]]],
      ["C3", "Marché et commercial", ["Analyse de marché et perspectives de demande", "Débouchés commerciaux et contractualisation"], 47, 27, 9, 1, [["Awa Camara", 4]]],
      ["C4", "Coûts et modélisation financière", ["Structure des coûts d'investissement et d'exploitation (CAPEX / OPEX)", "Modélisation financière et rentabilité"], 44, 35, 14, 0, [["Ibrahima Sow", 6]]],
      ["C5", "Juridique et corporate", ["Conformité et identité du promoteur", "Cadre juridique et contractuel"], 61, 22, 6, 1, [["Moussa Diallo", 7]]],
      ["C6", "Environnement, social et HSSE", ["Performance environnementale, sociale et HSSE"], 35, 24, 3, 0, []],
      ["C7", "Financement, partenaires et garanties", ["Écosystème de partenaires et parties prenantes", "Structuration du financement", "Sûretés, garanties et couverture des risques"], 42, 38, 7, 0, [["Awa Camara", 3]]],
    ].map(([code, label, domains, mean, gaps, studies, knockouts, owners]) => {
      const affectes = sum(owners, ([, n]) => n);
      const sans = evalues.slice(0, Math.max(0, evalues.length - affectes));
      return { code, label, domains, dossiers: evalues.length, mean, gaps, gaps_per_dossier: r1(gaps / Math.max(1, evalues.length)), studies, knockouts, unassigned: sans.length, consultants: owners.map(([name, dossiers]) => ({ name, dossiers })), unassigned_dossiers: sans.map(ref) };
    });
    return {
      compartments,
      domain_heatmap: { dossiers: DOSSIERS.map((d) => ({ ...ref(d), gate: GATES[d.gate].gate, readiness: d.gate > 0 ? d.readiness : null })), domains: DOMAINES.map(({ code, label }) => ({ code, label })), cells, averages },
      top_gaps, themes, knockouts, knockouts_pending: 2, evaluation_backlog: { criteria: 6, dossiers: 3 },
      evidence: { coverage_pct: 71.4, required: 126, proven: 90, no_proof: 36, expired: 9, missing: rows.length, missing_median_age_days: round(median(rows.map((x) => x.age_days))), missing_over_60: rows.filter((x) => x.age_days > 60).length, missing_by_age: tranches.map(([bucket, label, test]) => ({ bucket, label, count: rows.filter((x) => test(x.age_days)).length })), rows },
      progression,
    };
  }

  /* ═══ Comités ═════════════════════════════════════════════════════════ */

  function comites(p) {
    const r = makeRng("analyse-comites");
    const months = MOIS_12;
    const series = DECISIONS.map(([key, label]) => ({ key, label, unit: "count", values: months.map(() => (key === "go" ? r.int(1, 3) : key === "conditional" ? r.int(0, 2) : key === "hold" ? r.int(0, 2) : r.chance(0.25) ? 1 : 0)) }));
    const totals = Object.fromEntries(series.map((s) => [s.key, sum(s.values)]));
    const recommendations = ["bankable", "apd_ready", "go", "conditional", "hold", "no_go", "pending"];
    const decisions = DECISIONS.map(([k]) => k);
    // Lignes : recommandation de la méthode ; colonnes : décision du comité.
    const matrix = [
      [3, 0, 0, 0, 0],
      [5, 1, 0, 0, 1],
      [4, 1, 0, 0, 0],
      [1, 7, 1, 0, 1],
      [0, 4, 5, 0, 1],
      [0, 0, 1, 2, 0],
      [0, 1, 1, 0, 2],
    ];
    const favorable = { bankable: 0, apd_ready: 0, go: 0, conditional: 1, hold: 2, no_go: 3 };
    let agreed = 0;
    let lenient = 0;
    let strict = 0;
    let excluded = 0;
    for (const [i, rec] of recommendations.entries()) for (const [j, dec] of decisions.entries()) {
      const n = matrix[i][j];
      if (!n) continue;
      if (dec === "postponed" || rec === "pending") excluded += n;
      else if (favorable[rec] === favorable[dec]) agreed += n;
      else if (favorable[dec] < favorable[rec]) lenient += n;
      else strict += n;
    }
    const n = agreed + lenient + strict;
    const po = agreed / n;
    const pe = 0.31;
    const forced_gates = [
      { ...ref(dossier(3)), gate: "G2", to: "G3", date: "2026-06-18", reason: "Financeur en attente du dossier de faisabilité", score: 48 },
      { ...ref(dossier(7)), gate: "G3", to: "G4", date: "2026-09-02", reason: "Échéance d'appel à projets", score: 61 },
    ].map((f) => ({ dossier: f.reference, dossier_id: f.id, name: f.name, gate: f.gate, to: f.to, date: f.date, reason: f.reason, score: f.score, link: f.link })).filter((f) => f.date >= p.date_from && f.date <= p.date_to);
    const rows = [[1, -12, 31, "go"], [4, -20, 24, "go"], [7, -46, 52, "conditional"], [2, -58, 38, "conditional"], [11, -71, 44, "hold"], [3, -90, 67, "conditional"], [6, -104, 29, "go"], [14, -131, 48, "hold"], [9, -150, 36, "conditional"], [5, -162, 41, "no_go"], [12, -40, 19, "postponed"]].map(([id, delta, days, decision]) => ({ ...ref(dossier(id)), date: addDays(p.date_to, delta), days, decision })).filter((x) => x.date >= p.date_from);
    const delais = rows.map((x) => x.days);
    const by_month = months.map((k) => {
      const ceux = rows.filter((x) => x.date.startsWith(k));
      return { month: k, days: ceux.length ? round(median(ceux.map((x) => x.days))) : null };
    });
    const scoresDe = (decision, label, scores) => ({ decision, label, n: scores.length, scores, median: median(scores), q1: scores.length ? r1(quantile(scores, 0.25)) : null, q3: scores.length ? r1(quantile(scores, 0.75)) : null, min: scores.length ? Math.min(...scores) : null, max: scores.length ? Math.max(...scores) : null, bankability_median: scores.length ? round(median(scores) * 0.85) : null });
    return {
      decisions: { months, series, totals },
      agreement: { recommendations, decisions, recommendation_labels: recommendations.map((k) => RECO_LABEL[k]), decision_labels: DECISIONS.map(([, l]) => l), matrix, agreement_pct: n ? r1(po * 100) : null, kappa: n ? r2((po - pe) / (1 - pe)) : null, n, agreed, lenient, strict, excluded },
      forced_gates, forced_summary: { count: forced_gates.length, passages: 31, share_pct: r1((forced_gates.length / 31) * 100) },
      time_to_decision: { median_days: delais.length ? round(median(delais)) : null, p75_days: delais.length ? round(quantile(delais, 0.75)) : null, n: delais.length, history_median_days: 36, history_n: 34, by_month, rows },
      score_at_decision: [scoresDe("go", "GO", [72, 78, 81, 69, 74, 88, 77, 70, 83, 76, 79, 71]), scoresDe("conditional", "CONDITIONAL GO", [54, 58, 61, 52, 57, 63, 55, 59, 49, 56, 60, 53, 51]), scoresDe("hold", "HOLD", [38, 44, 41, 35, 47, 39, 42]), scoresDe("no_go", "NO-GO", [18, 24, 29]), scoresDe("postponed", "Ajourné", [46, 51])],
      conditions: { count: 23, done: 14, open: 9, overdue: 4, done_rate_pct: r1((14 / 23) * 100) },
      favorable_with_knockout: [{ ...ref(dossier(13)), review_id: 87, date: addDays(p.date_to, -40), decision: "conditional" }].filter((x) => x.date >= p.date_from),
    };
  }

  /* ═══ Financements ════════════════════════════════════════════════════ */

  const TYPES_FINANCEUR = { bank: "Banques et crédit-bail", dfi: "Institutions de développement", fund: "Fonds d'investissement", mfi: "Microfinance", donor: "Bailleurs de fonds et subventions", guarantor: "Garants" };
  const FINANCEURS = [
    [21, "Banque Commerciale de Conakry (démo)", "bank"], [22, "Crédit Rural de Guinée (démo)", "mfi"], [23, "Fonds Africain pour l'Agriculture (démo)", "dfi"], [24, "Agence de développement industriel (démo)", "donor"],
    [25, "Société Financière Panafricaine (démo)", "fund"], [26, "Fonds de garantie des PME (démo)", "guarantor"], [27, "Banque Ouest-Africaine d'Investissement (démo)", "dfi"], [28, "Ecobank Guinée (démo)", "bank"],
  ].map(([id, name, type]) => ({ id, name, type }));
  const ETATS = [["identified", "Identifié"], ["submitted", "Dossier déposé"], ["review", "En instruction"], ["agreed", "Accord de principe"], ["signed", "Convention signée"], ["disbursed", "Décaissé"], ["rejected", "Refusé"], ["withdrawn", "Abandonné"]];
  const GROUPE_ETAT = { identified: "prospect", submitted: "prospect", review: "review", agreed: "review", signed: "won", disbursed: "won", rejected: "lost", withdrawn: "lost" };
  const LABEL_GROUPE = { prospect: "Identifié", review: "En instruction", won: "Obtenu", lost: "Refusé ou abandonné" };
  const DEMARCHES = [
    [1, 23, 6.4e9, "signed", 5.8e9, 210, -120], [1, 21, 2.0e9, "review", 0, null, -45], [2, 22, 0.9e9, "disbursed", 0.9e9, 61, -200], [2, 28, 2.3e9, "rejected", 0, 142, -90], [3, 21, 2.2e9, "review", 0, null, -60], [3, 24, 1.4e9, "agreed", 0, null, -30],
    [4, 27, 14.2e9, "agreed", 0, null, -20], [4, 25, 7.8e9, "review", 0, null, -75], [4, 26, 4.0e9, "submitted", 0, null, -15], [6, 21, 4.1e9, "submitted", 0, null, -25], [6, 25, 2.7e9, "identified", 0, null, -10], [7, 21, 5.2e9, "review", 0, null, -50],
    [7, 23, 3.9e9, "signed", 3.9e9, 168, -140], [8, 28, 2.8e9, "withdrawn", 0, 95, -110], [8, 25, 1.6e9, "identified", 0, null, -5], [9, 22, 1.1e9, "disbursed", 1.1e9, 58, -170], [11, 27, 9.5e9, "review", 0, null, -35], [11, 26, 3.1e9, "submitted", 0, null, -12],
    [14, 23, 3.2e9, "review", 0, null, -48], [14, 24, 1.1e9, "rejected", 0, 240, -150],
  ].map(([dossier_id, funder_id, requested, state, granted, days, delta], i) => ({ id: 301 + i, dossier_id, funder_id, requested, state, granted, days, date: delta }));
  const financeur = (id) => FINANCEURS.find((f) => f.id === id);

  function financements(p) {
    const demarches = DEMARCHES.map((d) => ({ ...d, date: addDays(p.date_to, d.date) })).filter((d) => d.date >= p.date_from || !["rejected", "withdrawn", "disbursed", "signed"].includes(d.state));
    const secteurs = [...new Set(demarches.map((d) => dossier(d.dossier_id).sector))];
    const types = [...new Set(demarches.map((d) => financeur(d.funder_id).type))];
    const groupes = [...new Set(demarches.map((d) => GROUPE_ETAT[d.state]))];
    const nodes = [...secteurs.map((s) => ({ id: `sector:${s}`, label: s, group: "sector" })), ...types.map((t) => ({ id: `funder:${t}`, label: TYPES_FINANCEUR[t], group: "funder" })), ...groupes.map((g) => ({ id: `state:${g}`, label: LABEL_GROUPE[g], group: "state" }))];
    const agreger = (cle) => Object.values(demarches.reduce((acc, d) => {
      const [source, target] = cle(d);
      acc[`${source}|${target}`] ??= { source, target, value: 0 };
      acc[`${source}|${target}`].value += d.requested;
      return acc;
    }, {}));
    const links = [...agreger((d) => [`sector:${dossier(d.dossier_id).sector}`, `funder:${financeur(d.funder_id).type}`]), ...agreger((d) => [`funder:${financeur(d.funder_id).type}`, `state:${GROUPE_ETAT[d.state]}`])];
    const by_funder = FINANCEURS.map((f) => {
      const ceux = demarches.filter((d) => d.funder_id === f.id);
      if (!ceux.length) return null;
      const won = ceux.filter((d) => ["signed", "disbursed"].includes(d.state));
      const decided = ceux.filter((d) => ["signed", "disbursed", "rejected", "withdrawn"].includes(d.state));
      const delais = decided.map((d) => d.days).filter((x) => x !== null);
      const requested = sum(ceux, (d) => d.requested);
      const granted = sum(ceux, (d) => d.granted);
      return { key: String(f.id), id: f.id, label: f.name, type: TYPES_FINANCEUR[f.type], count: ceux.length, requested, granted, won: won.length, decided: decided.length, open: ceux.length - decided.length, success_pct: decided.length ? r1((won.length / decided.length) * 100) : null, avg_ticket: round(requested / ceux.length), avg_days: delais.length ? round(sum(delais) / delais.length) : null, median_days: delais.length ? round(median(delais)) : null, granted_vs_requested_pct: taux(granted, requested) };
    }).filter(Boolean).sort((a, b) => b.requested - a.requested);
    const pipeline = ETATS.map(([state, label]) => {
      const ceux = demarches.filter((d) => d.state === state);
      return { state, label, count: ceux.length, amount: sum(ceux, (d) => d.requested), granted: sum(ceux, (d) => d.granted) };
    });
    const ouvertes = (d) => !["signed", "disbursed", "rejected", "withdrawn"].includes(d.state);
    const rows = DOSSIERS.map((d) => {
      const ceux = demarches.filter((x) => x.dossier_id === d.id);
      const granted = sum(ceux, (x) => x.granted);
      const open_requested = sum(ceux.filter(ouvertes), (x) => x.requested);
      return { ...ref(d), need: d.need, granted, open_requested, coverage_pct: r1(taux(granted, d.need) ?? 0), gap: Math.max(0, d.need - granted), probability: probabilite(d), funders: new Set(ceux.map((x) => x.funder_id)).size, recommendation: recommandation(d) };
    }).sort((a, b) => b.need - a.need);
    const need = sum(rows, (x) => x.need);
    const granted = sum(rows, (x) => x.granted);
    const open_requested = sum(rows, (x) => x.open_requested);
    const decidees = demarches.filter((d) => !ouvertes(d));
    const success = decidees.length ? taux(decidees.filter((d) => d.granted > 0).length, decidees.length) : null;
    const follow_ups = demarches.filter((d) => ["submitted", "review", "agreed"].includes(d.state) && daysBetween(d.date, p.date_to) > 30).map((d) => ({ ...ref(dossier(d.dossier_id)), funding_id: d.id, funder: financeur(d.funder_id).name, state: d.state, next_date: addDays(d.date, 30), amount_requested: d.requested, days_late: daysBetween(addDays(d.date, 30), p.date_to) }));
    return { flows: { nodes, links }, by_funder, pipeline, coverage: { need, granted, open_requested, coverage_pct: r1(taux(granted, need) ?? 0), uncovered: need - granted, expected_gnf: round(open_requested * ((success ?? 50) / 100)), success_pct: success === null ? null : r1(success), rows }, follow_ups };
  }

  /* ═══ Activité ════════════════════════════════════════════════════════ */

  function activite(p) {
    const r = makeRng("analyse-activite");
    const weeks = [];
    for (let w = lundi(p.date_from); w <= p.date_to; w = addDays(w, 7)) weeks.push(w);
    const cells = CONSULTANTS.flatMap((c, i) => weeks.map((w, j) => ({ consultant: c.name, week: w, hours: i === 4 && j >= weeks.length - 5 && j <= weeks.length - 3 ? 0 : r1(Math.max(0, 28 + [8, 6, 4, 2, -3][i] + Math.sin(j / 2 + i) * 6 + (r.next() * 2 - 1) * 5)) })));
    const heuresTotal = sum(cells, (c) => c.hours);
    const by_dossier = DOSSIERS.map((d, i) => {
      const hours = r1((heuresTotal / DOSSIERS.length) * (0.5 + d.gate * 0.14 + (i === 2 ? 0.9 : 0)) * r.noise(0.15));
      return { ...ref(d), hours, billable_hours: r1(hours * (i === 2 ? 0.55 : 0.82 + r.next() * 0.12)) };
    });
    const parts = [0.44, 0.12, 0.3, 0.1, 0.04];
    const by_service = SERVICES.map((s, i) => ({ key: s.key, label: s.label, hours: r1(heuresTotal * parts[i]) }));
    const honoraires = sommeHonoraires(p);
    const realisationDossier = by_dossier.map((d, i) => {
      const value = round(d.hours * TAUX);
      const billed = round(d.billable_hours * TAUX * (0.85 + r.next() * 0.12) * (i === 2 ? 0.7 : 1));
      return { ...ref(d), hours: d.hours, billable_hours: d.billable_hours, value, billed, realization_pct: r1((billed / value) * 100), wip_hours: r1(d.billable_hours * (i === 2 ? 0.45 : 0.18)) };
    });
    const by_consultant = CONSULTANTS.map((c, i) => {
      const hours = r1(sum(cells.filter((x) => x.consultant === c.name), (x) => x.hours));
      const billable_hours = r1(hours * [0.9, 0.86, 0.8, 0.84, 0.74][i]);
      const value = round(hours * TAUX);
      const billed = round(value * [0.86, 0.81, 0.74, 0.79, 0.68][i]);
      return { id: c.id, name: c.name, hours, billable_hours, value, billed, realization_pct: r1((billed / value) * 100), effective_rate: round(billed / hours) };
    });
    const value = sum(realisationDossier, (d) => d.value);
    const billed = sum(realisationDossier, (d) => d.billed);
    const wip_hours = r1(sum(realisationDossier, (d) => d.wip_hours));
    const non_billable_hours = r1(sum(by_dossier, (d) => d.hours - d.billable_hours));
    const coutHoraire = round(TAUX * 0.4);
    const rows = realisationDossier.map((d, i) => {
      const cost = round(d.hours * coutHoraire);
      const fees_ltd = round(d.billed * (1.6 + i * 0.05));
      const hours_ltd = r1(d.hours * (1.7 + i * 0.04));
      const cost_ltd = round(hours_ltd * coutHoraire);
      return { ...ref(dossier(d.id)), consultant: CONSULTANTS[i % CONSULTANTS.length].name, fees: d.billed, hours: d.hours, cost, margin: d.billed - cost, margin_pct: taux(d.billed - cost, d.billed), fees_ltd, hours_ltd, cost_ltd, margin_ltd: fees_ltd - cost_ltd, margin_ltd_pct: taux(fees_ltd - cost_ltd, fees_ltd) };
    });
    const serviceRevenu = SERVICES.map((s, i) => {
      const revenue = round(honoraires * PARTS_SERVICES[i]);
      const hours = by_service[i].hours;
      const cost = round(hours * coutHoraire);
      return { key: s.key, label: s.label, revenue, hours, cost, margin: revenue - cost, margin_pct: taux(revenue - cost, revenue), share_pct: taux(revenue, honoraires) };
    });
    const months = MOIS_12;
    const revenueSeries = [...SERVICES.map((s, i) => ({ key: s.key, label: s.label, unit: "gnf", values: months.map((k) => round(honorairesMois(k) * PARTS_SERVICES[i] * 0.94 * r.noise(0.15))) })), { key: "non_impute", label: "Sans activité", unit: "gnf", values: months.map((k) => round(honorairesMois(k) * 0.06)) }];
    const receivables = { open: 0.62e9, overdue: 0.19e9, aging: { non_echu: 0.43e9, "1_30": 0.09e9, "31_60": 0.06e9, "61_90": 0.03e9, plus_90: 0.01e9 }, dso_days: 38.4, by_client: [[1, 0.18e9, 0.07e9, 34], [4, 0.21e9, 0, null], [7, 0.11e9, 0.06e9, 52], [3, 0.08e9, 0.04e9, 71], [11, 0.04e9, 0.02e9, 18]].map(([id, open, overdue, days]) => ({ partner_id: 500 + id, name: dossier(id).promoter, open, overdue, days_overdue: days })) };
    const base = sum(months.slice(-3), (k) => honorairesMois(k)) / 3;
    const futurs = moisJusqua(addDays(`${p.date_to.slice(0, 7)}-28`, 95), 3);
    const backlog = realisationDossier.filter((d) => d.wip_hours > 0).map((d, i) => ({ ...ref(dossier(d.id)), hours: d.wip_hours, value: round(d.wip_hours * TAUX), oldest: addDays(p.date_to, -[12, 34, 71, 9, 25, 48, 15, 93, 20, 6, 40, 11, 63, 18][i]), age_days: [12, 34, 71, 9, 25, 48, 15, 93, 20, 6, 40, 11, 63, 18][i] }));
    return {
      time: { consultants: CONSULTANTS.map((c) => c.name), weeks, cells, by_dossier, by_service, hours_per_week: r1(heuresTotal / weeks.length / CONSULTANTS.length) },
      realization: { overall_pct: r1((billed / value) * 100), standard_rate: TAUX, rate_source: "parametre", effective_rate: round(billed / sum(by_dossier, (d) => d.hours)), billed_rate: round(billed / sum(by_dossier, (d) => d.billable_hours)), hours: r1(sum(by_dossier, (d) => d.hours)), value, billed, wip_hours, wip_value: round(wip_hours * TAUX), non_billable_hours, non_billable_value: round(non_billable_hours * TAUX), by_dossier: realisationDossier, by_consultant },
      profitability: { cost_rate_pct: 40, cost_hourly: coutHoraire, rows, by_service: serviceRevenu },
      revenue: { monthly: { months, series: revenueSeries }, total: round(honoraires), previous: round(sommeHonoraires(p.previous)), unassigned: round(honoraires * 0.06), receivables },
      forecast: { months: futurs, fees: futurs.map((_, i) => round(base * (1.02 + i * 0.015))), low: futurs.map((_, i) => round(base * (0.9 - i * 0.03))), high: futurs.map((_, i) => round(base * (1.14 + i * 0.05))), method: "holt", mape: 9.8, history: { months: MOIS_24, values: MOIS_24.map((k) => honorairesMois(k)) }, backlog_hours: wip_hours, backlog_value: round(wip_hours * TAUX), backlog_old_hours: r1(sum(backlog.filter((b) => b.age_days > 60), (b) => b.hours)), backlog },
      summary: { hours: r1(sum(by_dossier, (d) => d.hours)), fees: round(honoraires), fees_previous: round(sommeHonoraires(p.previous)), fees_trend: months.map((k) => honorairesMois(k)), realization_pct: r1((billed / value) * 100), realization_trend: [84, 83, 82, 82, 81, 80, 80, 79, 79, 78, 78, r1((billed / value) * 100)], wip_value: round(wip_hours * TAUX), receivables: receivables.open, overdue: receivables.overdue },
    };
  }

  /* ═══ Risques ═════════════════════════════════════════════════════════ */

  const CATEGORIES_RISQUE = { technical: "Technique et exploitation", market: "Marché et commercial", legal: "Juridique et réglementaire", country: "Pays et change", financial: "Financier" };
  const RISQUES = [
    [5, 4, 5, "Retard d'obtention de la licence", "legal", false, false], [4, 3, 4, "Hausse du coût des panneaux", "technical", true, true], [1, 3, 4, "Dépendance à un acheteur unique", "market", true, false], [13, 2, 5, "Contestation foncière des quais", "legal", false, false],
    [11, 4, 3, "Taux de change USD/GNF sur les turbines", "country", true, false], [9, 2, 3, "Départ du directeur technique", "technical", true, true], [2, 3, 2, "Saisonnalité des approvisionnements en lait", "market", true, false], [3, 1, 4, "Inondation du site de Kamsar", "technical", false, false],
    [12, 2, 2, "Retard de raccordement électrique", "technical", true, true], [6, 3, 3, "Concurrence informelle des carrières", "market", true, false], [10, 1, 2, "Rotation du personnel enseignant", "technical", false, false], [8, 4, 2, "Retard des pièces du porteur", "legal", true, false], [7, 2, 4, "Refus de garantie bancaire", "financial", true, false],
  ].map(([dossier_id, probability, impact, risk, category, mitigation, treated], i) => ({ risk_id: 61 + i, dossier_id, probability, impact, risk, category, mitigation, treated }));
  const niveau = (s) => (s >= 16 ? "critical" : s >= 10 ? "high" : s >= 5 ? "medium" : "low");

  function risques(p) {
    const r = makeRng("analyse-risques");
    const cells = [];
    for (let pr = 1; pr <= 5; pr++) for (let im = 1; im <= 5; im++) {
      const liste = RISQUES.filter((x) => x.probability === pr && x.impact === im);
      cells.push({ probability: pr, impact: im, count: liste.length, score: pr * im, criticality: niveau(pr * im), risks: liste.map((x) => `${dossier(x.dossier_id).reference} · ${x.risk}`) });
    }
    const by_level = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const x of RISQUES) by_level[niveau(x.probability * x.impact)]++;
    const by_category = Object.entries(CATEGORIES_RISQUE).map(([category, label]) => {
      const ceux = RISQUES.filter((x) => x.category === category);
      const scores = ceux.map((x) => x.probability * x.impact);
      return { category, label, count: ceux.length, avg_score: scores.length ? r1(sum(scores) / scores.length) : null, max_score: scores.length ? Math.max(...scores) : null };
    }).filter((c) => c.count > 0);
    const top = [...RISQUES].sort((a, b) => b.probability * b.impact - a.probability * a.impact).slice(0, 8).map((x) => ({ ...ref(dossier(x.dossier_id)), risk_id: x.risk_id, risk: x.risk, category: x.category, score: x.probability * x.impact, level: niveau(x.probability * x.impact), treated: x.treated, mitigation: x.mitigation }));
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(lundi(p.date_to), -7 * (11 - i)));
    const velocity = weeks.map((week) => ({ week, created: r.int(2, 8), done: r.int(1, 7) }));
    const overdue_rows = [[8, 71, "Transmettre le bail du site", "porteur", "manual", -44], [10, 72, "Fournir les états financiers certifiés", "porteur", "review", -31], [3, 73, "Compléter l'étude de marché", "porteur", "review", -27], [12, 74, "Lettre d'engagement de l'acheteur", "porteur", "manual", -19], [5, 75, "Déposer la demande de licence", "porteur", "manual", -62], [13, 76, "Produire le titre foncier des quais", "porteur", "review", -88], [6, 77, "Relancer la banque sur la garantie", "cabinet", "manual", -9], [2, 78, "Mettre à jour le modèle financier", "cabinet", "review", -14], [9, 79, "Recruter le directeur technique", "porteur", "manual", -36], [14, 80, "Signer les devis fournisseurs", "porteur", "review", -22], [7, 81, "Obtenir l'accord de principe écrit", "cabinet", "manual", -6], [11, 82, "Couverture de change : devis bancaire", "porteur", "manual", -12], [1, 83, "Contrat d'achat signé", "porteur", "review", -17], [4, 84, "Rapport de due diligence technique", "cabinet", "manual", -3], [8, 85, "Plan de gestion environnementale", "porteur", "review", -51], [3, 86, "Procès-verbal d'assemblée", "porteur", "manual", -41], [6, 87, "Attestation fiscale", "porteur", "review", -29]].map(([id, action_id, action, assignee, source, delta]) => ({ ...ref(dossier(id)), action_id, action, assignee, source, due_date: addDays(p.date_to, delta), days_late: -delta }));
    const porteurs = overdue_rows.filter((x) => x.assignee === "porteur").length;
    const by_assignee = [{ assignee: "porteur", label: "Porteur", open: 31, overdue: porteurs, done: 38, median_days: 26 }, { assignee: "cabinet", label: "Cabinet", open: 17, overdue: overdue_rows.length - porteurs, done: 44, median_days: 12 }];
    const reactivite = DOSSIERS.map((d, i) => ({ ...ref(d), promoter: d.promoter, median_days: [12, 9, 27, 6, 31, 14, 11, 44, 16, null, 19, 23, 41, 15][i], responded: [8, 11, 6, 14, 3, 7, 9, 4, 6, 0, 8, 5, 2, 7][i], pending: [1, 0, 3, 0, 2, 1, 1, 4, 2, 3, 1, 2, 3, 1][i], oldest_pending_days: [18, null, 52, null, 37, 9, 21, 66, 30, 44, 12, 25, 58, 7][i] }));
    const delais = reactivite.map((x) => x.median_days).filter((x) => x !== null);
    const created = sum(velocity, (v) => v.created);
    const done = sum(velocity, (v) => v.done);
    return {
      risk_matrix: { cells, open: RISQUES.length, critical: by_level.critical, levels: ["low", "medium", "high", "critical"], by_level, by_category, mitigated_pct: r1((RISQUES.filter((x) => x.mitigation).length / RISQUES.length) * 100), treated_pct: r1((RISQUES.filter((x) => x.treated).length / RISQUES.length) * 100), residual_reduction: 22, top },
      actions: { open: 48, overdue: overdue_rows.length, submitted: 5, created, done, median_days: 23, p75_days: 41, velocity, throughput_per_week: r1(done / 12), weeks_to_clear: r1(48 / Math.max(0.1, done / 12)), by_assignee, overdue_rows },
      responsiveness: { median_days: round(median(delais)), p75_days: round(quantile(delais, 0.75)), n: sum(reactivite, (x) => x.responded), pending: sum(reactivite, (x) => x.pending), pending_median_age_days: round(median(reactivite.map((x) => x.oldest_pending_days).filter((x) => x !== null))), actions_median_days: 26, by_dossier: reactivite },
    };
  }

  /* ═══ Constats ════════════════════════════════════════════════════════ */

  function constatsCabinet(p) {
    const pf = portefeuille(p);
    const g = pf.bottleneck;
    const dg = diagnostic(p);
    const faible = [...dg.domain_heatmap.averages].filter((a) => a.mean !== null).sort((a, b) => a.mean - b.mean)[0];
    const cm = comites(p);
    const fi = financements(p);
    const meilleur = [...fi.by_funder].filter((f) => f.granted > 0).sort((a, b) => b.granted - a.granted)[0];
    const ac = activite(p);
    const ri = risques(p);
    const actifs = DOSSIERS.filter((d) => d.gate > 0).length;
    const prevision = sum(ac.forecast.fees);
    return [
      constat({ id: `cabinet.goulot.${g.gate}`, domain: "portefeuille", severity: "high", title: `Le gate ${g.gate} (${g.label}) est le goulot du portefeuille`, narrative: `${g.in_gate} dossiers y attendent depuis ${g.median_age_days} jours en médiane, contre 45 visés : l'étude de marché et le modèle financier manquent dans la plupart des cas. C'est le gate le plus lourd rapporté au nombre de dossiers.`, metric: { label: `Âge médian en ${g.gate}`, value: g.median_age_days, unit: "days", reference: 45, reference_label: "Cible" }, impact_gnf: g.need * 0.02, confidence: 0.84, method: "Journal des passages de gate : jours entre l'entrée et la sortie de chaque gate, médiane et p75 ; goulot = âge médian × dossiers présents.", evidence: { type: "bars", data: { labels: pf.time_in_gate.map((t) => t.gate), values: pf.time_in_gate.map((t) => t.median_days), unit: "days", highlight: GATES.findIndex((x) => x.gate === g.gate) } }, action: "Créer une offre « étude de marché express » (15 jours) et un atelier modèle financier mensuel pour les porteurs.", link: "/analyse/portefeuille" }),
      constat({ id: "cabinet.pipeline_pondere", domain: "portefeuille", severity: "positive", title: `Le pipeline pondéré atteint ${mds(pf.pipeline_value.weighted)}, porté par deux projets d'énergie`, narrative: `La centrale solaire de Kindia (probabilité ${nFr(probabilite(dossier(4)), 2)}) et le mini-réseau de Dalaba (${nFr(probabilite(dossier(11)), 2)}) représentent ${pctFr(taux(pf.pipeline_value.dossiers.filter((d) => [4, 11].includes(d.id)).reduce((s, d) => s + d.weighted, 0), pf.pipeline_value.weighted) ?? 0)} du pipeline pondéré. ${pf.forecast.bankability_6m} dossiers devraient atteindre la bancabilité dans six mois.`, metric: { label: "Pipeline pondéré", value: pf.pipeline_value.weighted, unit: "gnf", reference: 24.8e9, reference_label: "N-1" }, impact_gnf: pf.pipeline_value.weighted, confidence: 0.78, method: pf.pipeline_value.method, evidence: { type: "bars", data: { labels: pf.pipeline_value.dossiers.slice(0, 5).map((d) => d.name), values: pf.pipeline_value.dossiers.slice(0, 5).map((d) => d.weighted), unit: "gnf" } }, action: "Préparer dès maintenant le dossier bancaire de Kindia : term sheet et data room complète.", link: "/analyse/portefeuille" }),
      constat({ id: "cabinet.concentration_sectorielle", domain: "portefeuille", severity: pf.concentration.top_share_pct > 50 ? "medium" : "info", title: `Le besoin de financement est concentré sur le secteur ${pf.concentration.top}`, narrative: `${pf.concentration.top} représente ${pctFr(pf.concentration.top_share_pct)} du besoin de financement du portefeuille (HHI ${nFr(pf.concentration.hhi, 2)}).`, metric: { label: "Part du premier secteur", value: pf.concentration.top_share_pct, unit: "pct", reference: 50, reference_label: "Seuil" }, impact_gnf: null, confidence: 0.95, method: "Besoin de financement par secteur ; indice de Herfindahl-Hirschman sur les parts.", evidence: { type: "bars", data: { labels: pf.by_sector.map((s) => s.label), values: pf.by_sector.map((s) => s.need), unit: "gnf" } }, action: "Prospecter deux dossiers hors énergie et agro-industrie au prochain appel à projets.", link: "/analyse/portefeuille" }),
      constat({ id: `cabinet.faiblesse_domaine.${faible.code}`, domain: "diagnostic", severity: "high", title: `Le domaine ${faible.label} est le maillon faible de ${faible.weak} dossiers sur ${faible.n}`, narrative: `Score moyen de ${nFr(faible.mean)}/100 : plan de trésorerie absent dans 8 dossiers, hypothèses de prix non documentées dans 7. Un thème de formation évident.`, metric: { label: `Score ${faible.label} moyen`, value: faible.mean, unit: "score", reference: 60, reference_label: "Seuil GO" }, impact_gnf: null, confidence: 0.9, method: "Score par domaine (moyenne pondérée des critères évalués) sur l'évaluation la plus récente de chaque dossier ; fréquence des critères « non disponible » ou « incomplet ».", evidence: { type: "bars", data: { labels: dg.domain_heatmap.averages.map((a) => a.label), values: dg.domain_heatmap.averages.map((a) => a.mean ?? 0), unit: "score", highlight: dg.domain_heatmap.averages.findIndex((a) => a.code === faible.code) } }, action: `Lancer une formation « ${faible.deliverable} » (ligne Formation et coaching) : ${faible.weak} porteurs concernés.`, link: "/analyse/diagnostic" }),
      ...dg.knockouts.filter((k) => k.count > 0).map((k) => constat({ id: `cabinet.knockout.${k.code}`, domain: "diagnostic", severity: "critical", title: `Knock-out « ${k.label} » actif sur ${k.count} dossier${k.count > 1 ? "s" : ""}`, narrative: `${k.details.map((d) => d.name).join(", ")} : la probabilité de bancabilité est nulle tant que le critère éliminatoire tient (${mds(k.need)} de besoin).`, metric: { label: "Besoin bloqué", value: k.need, unit: "gnf", reference: null, reference_label: null }, impact_gnf: k.need, confidence: 0.98, method: "Critères marqués éliminatoires dans la politique d'évaluation et non satisfaits sur la dernière évaluation.", evidence: null, action: "Fixer un délai de 60 jours au porteur pour lever le knock-out, sinon suspendre le dossier.", link: "/analyse/diagnostic" })),
      constat({ id: "cabinet.evaluations_en_retard", domain: "diagnostic", severity: "medium", title: `${dg.evaluation_backlog.criteria} critères des gates atteints restent à évaluer`, narrative: `${dg.evaluation_backlog.dossiers} dossiers ont des critères de leur gate non évalués : les écarts sont sous-estimés d'autant.`, metric: { label: "Critères à évaluer", value: dg.evaluation_backlog.criteria, unit: "count", reference: 0, reference_label: "Cible" }, impact_gnf: null, confidence: 0.95, method: "Critères des gates atteints sans statut sur la dernière évaluation.", evidence: null, action: "Planifier une session d'évaluation par dossier concerné avant le prochain comité.", link: "/analyse/diagnostic" }),
      constat({ id: "cabinet.preuves", domain: "diagnostic", severity: "medium", title: `${dg.evidence.no_proof} critères déclarés disponibles sans preuve valable`, narrative: `${pctFr(dg.evidence.coverage_pct)} des critères exigeant une preuve en ont une ; ${dg.evidence.expired} preuves sont expirées et ${dg.evidence.missing_over_60} pièces manquent depuis plus de 60 jours.`, metric: { label: "Couverture des preuves", value: dg.evidence.coverage_pct, unit: "pct", reference: 100, reference_label: "Cible" }, impact_gnf: null, confidence: 0.92, method: "Critères exigeant une preuve : document joint, non expiré, rattaché au critère.", evidence: { type: "bars", data: { labels: dg.evidence.missing_by_age.map((b) => b.label), values: dg.evidence.missing_by_age.map((b) => b.count), unit: "count" } }, action: "Demander les pièces manquantes de plus de 60 jours par courrier formel au porteur.", link: "/analyse/diagnostic" }),
      constat({ id: "cabinet.progression", domain: "diagnostic", severity: "positive", title: `Les dossiers gagnent ${nFr(dg.progression.median_velocity_per_month ?? 0, 1)} points de Readiness par mois`, narrative: `${dg.progression.improving} dossiers progressent ; ${dg.progression.stagnating.length} stagnent depuis plus de deux mois.`, metric: { label: "Vitesse médiane", value: dg.progression.median_velocity_per_month, unit: "score", reference: null, reference_label: null }, impact_gnf: null, confidence: 0.85, method: "Variation du Project Readiness entre la première et la dernière évaluation, rapportée au temps écoulé.", evidence: null, action: null, link: "/analyse/diagnostic" }),
      constat({ id: "cabinet.accord_comite", domain: "comites", severity: (cm.agreement.agreement_pct ?? 100) < 85 ? "medium" : "positive", title: `Le comité s'écarte de la méthode une fois sur ${Math.max(2, round(100 / (100 - (cm.agreement.agreement_pct ?? 99))))}`, narrative: `Taux d'accord recommandation × décision de ${pctFr(cm.agreement.agreement_pct ?? 0)} (kappa ${nFr(cm.agreement.kappa ?? 0, 2)}) ; ${cm.agreement.lenient} écarts sont plus favorables que la méthode, ${cm.agreement.strict} plus sévères.`, metric: { label: "Taux d'accord", value: cm.agreement.agreement_pct, unit: "pct", reference: 85, reference_label: "Cible" }, impact_gnf: null, confidence: 0.88, method: "Matrice recommandation de la méthode (score) × décision du comité, sur les revues verrouillées de la période ; kappa de Cohen.", evidence: null, action: "Motiver par écrit tout écart à la recommandation et revoir les seuils si les écarts se répètent.", link: "/analyse/comites" }),
      constat({ id: "cabinet.passages_forces", domain: "comites", severity: cm.forced_summary.count > 0 ? "medium" : "info", title: `${cm.forced_summary.count} passages de gate forcés sur ${cm.forced_summary.passages}`, narrative: cm.forced_gates.length ? cm.forced_gates.map((f) => `${f.dossier} (${f.gate} → ${f.to}, ${f.reason.toLowerCase()})`).join(" ; ") : "Aucun passage forcé sur la période.", metric: { label: "Passages forcés", value: cm.forced_summary.share_pct, unit: "pct", reference: 0, reference_label: "Cible" }, impact_gnf: null, confidence: 0.98, method: "Passages de gate enregistrés sans revue GO ou CONDITIONAL GO.", evidence: null, action: "Exiger une revue de rattrapage dans les 30 jours après tout passage forcé.", link: "/analyse/comites" }),
      constat({ id: meilleur ? `cabinet.financeur_cle.${meilleur.id}` : "cabinet.financeur_cle", domain: "financements", severity: "positive", title: meilleur ? `${meilleur.label.replace(" (démo)", "")} est le premier financeur du portefeuille` : "Aucun financement obtenu", narrative: meilleur ? `${mds(meilleur.granted)} obtenus sur ${mds(meilleur.requested)} demandés (${pctFr(meilleur.success_pct ?? 0)} de succès, ${meilleur.avg_days ?? "–"} jours en moyenne). Les institutions de développement répondent mieux que les banques commerciales.` : "", metric: { label: "Montant obtenu", value: meilleur?.granted ?? 0, unit: "gnf", reference: null, reference_label: null }, impact_gnf: meilleur?.granted ?? null, confidence: 0.85, method: "Montants obtenus / montants demandés par financeur, démarches closes.", evidence: { type: "bars", data: { labels: fi.by_funder.slice(0, 6).map((f) => f.label.replace(" (démo)", "")), values: fi.by_funder.slice(0, 6).map((f) => f.granted), unit: "gnf" } }, action: "Orienter d'abord les dossiers d'énergie et d'agro-industrie vers les institutions de développement.", link: "/analyse/financements" }),
      constat({ id: "cabinet.couverture", domain: "financements", severity: "info", title: `${pctFr(fi.coverage.coverage_pct, 1)} du besoin de financement est couvert`, narrative: `${mds(fi.coverage.granted)} obtenus sur ${mds(fi.coverage.need)} de besoin ; ${mds(fi.coverage.open_requested)} sont en cours d'instruction (${mds(fi.coverage.expected_gnf)} attendus au taux de succès observé).`, metric: { label: "Couverture du besoin", value: fi.coverage.coverage_pct, unit: "pct", reference: null, reference_label: null }, impact_gnf: fi.coverage.uncovered * 0.01, confidence: 0.9, method: "Montants obtenus rapportés au besoin de financement des dossiers en cours.", evidence: null, action: null, link: "/analyse/financements" }),
      constat({ id: "cabinet.realisation", domain: "activite", severity: "medium", title: `Le taux de réalisation glisse à ${pctFr(ac.realization.overall_pct)} : ${mds(ac.realization.value - ac.realization.billed)} de temps non facturé`, narrative: `Les heures passées valent ${mds(ac.realization.value)} au taux standard, ${mds(ac.realization.billed)} ont été facturés. Le dossier Pêcheries de Kamsar absorbe ${nFr(ac.time.by_dossier[2].hours - ac.time.by_dossier[2].billable_hours)} heures non facturables.`, metric: { label: "Taux de réalisation", value: ac.realization.overall_pct, unit: "pct", reference: 85, reference_label: "Cible" }, impact_gnf: ac.realization.value - ac.realization.billed, confidence: 0.86, method: "Honoraires facturés / (heures saisies × taux standard), par dossier et par consultant.", evidence: { type: "bars", data: { labels: ac.realization.by_consultant.map((c) => c.name.split(" ")[0]), values: ac.realization.by_consultant.map((c) => c.realization_pct), unit: "pct" } }, action: "Facturer les heures de Kamsar au forfait convenu et plafonner le temps des dossiers en G0-G1.", link: "/analyse/activite" }),
      constat({ id: "cabinet.creances_echues", domain: "activite", severity: "high", title: `${mds(ac.revenue.receivables.overdue)} de créances clients échues`, narrative: `${ac.revenue.receivables.by_client.filter((c) => c.overdue > 0).length} porteurs ont des honoraires échus ; le plus ancien retard est de ${Math.max(...ac.revenue.receivables.by_client.map((c) => c.days_overdue ?? 0))} jours.`, metric: { label: "Créances échues", value: ac.revenue.receivables.overdue, unit: "gnf", reference: null, reference_label: null }, impact_gnf: ac.revenue.receivables.overdue, confidence: 0.95, method: "Factures d'honoraires validées non réglées dont l'échéance est dépassée.", evidence: { type: "bars", data: { clients: ac.revenue.receivables.by_client.filter((c) => c.overdue > 0).map((c) => ({ name: c.name, revenue: c.overdue })) } }, action: "Conditionner la poursuite de l'accompagnement au règlement des honoraires échus.", link: "/analyse/activite" }),
      constat({ id: "cabinet.prevision_honoraires", domain: "activite", severity: "info", title: `Honoraires attendus sur les trois prochains mois : ${mds(prevision)}`, narrative: `Lissage de Holt sur 24 mois (MAPE ${pctFr(ac.forecast.mape, 1)}) ; le carnet d'heures non facturées vaut ${mds(ac.forecast.backlog_value)}.`, metric: { label: "Honoraires attendus", value: prevision, unit: "gnf", reference: null, reference_label: null }, impact_gnf: null, confidence: 0.7, method: "Lissage de Holt (niveau et tendance) sur les honoraires mensuels, intervalles à 80 %.", evidence: { type: "series", data: { labels: ac.forecast.months.map(moisCourt), values: ac.forecast.fees, unit: "gnf" } }, action: null, link: "/analyse/activite" }),
      constat({ id: "cabinet.actions_en_retard", domain: "risques", severity: "high", title: `${ri.actions.overdue} actions en retard sur ${ri.actions.open} ouvertes`, narrative: `${ri.actions.by_assignee[0].overdue} confiées aux porteurs, ${ri.actions.by_assignee[1].overdue} au cabinet ; la plus ancienne : « ${[...ri.actions.overdue_rows].sort((a, b) => b.days_late - a.days_late)[0].action} », échue depuis ${Math.max(...ri.actions.overdue_rows.map((x) => x.days_late))} jours.`, metric: { label: "Part des actions en retard", value: r1((ri.actions.overdue / ri.actions.open) * 100), unit: "pct", reference: 10, reference_label: "Seuil de vigilance" }, impact_gnf: null, confidence: 0.92, method: "Plans d'actions : actions ouvertes dont l'échéance est dépassée à la date d'arrêté.", evidence: null, action: "Relance automatique à J+7 et point hebdomadaire avec les deux porteurs les plus lents.", link: "/analyse/risques" }),
      constat({ id: "cabinet.reactivite_porteurs", domain: "risques", severity: (ri.responsiveness.median_days ?? 0) > 15 ? "medium" : "positive", title: `Les porteurs fournissent leurs pièces en ${ri.responsiveness.median_days} jours en médiane`, narrative: `Mesuré sur ${ri.responsiveness.n} pièces déposées ; ${ri.responsiveness.pending} pièces sont en attente. Résidence de Sonfonia et Transport fluvial du Milo dépassent 40 jours.`, metric: { label: "Délai médian de dépôt", value: ri.responsiveness.median_days, unit: "days", reference: 15, reference_label: "Cible" }, impact_gnf: null, confidence: 0.9, method: "Délai entre la demande d'une pièce au porteur et son dépôt, médiane par dossier.", evidence: { type: "bars", data: { labels: ri.responsiveness.by_dossier.filter((d) => d.median_days !== null).map((d) => d.reference), values: ri.responsiveness.by_dossier.filter((d) => d.median_days !== null).map((d) => d.median_days), unit: "days" } }, action: "Remettre la liste des pièces dès l'entrée dans chaque gate.", link: "/analyse/risques" }),
      constat({ id: "cabinet.risques_critiques", domain: "risques", severity: ri.risk_matrix.critical > 0 ? "high" : "info", title: `${ri.risk_matrix.critical} risques critiques ouverts`, narrative: `${ri.risk_matrix.top.filter((t) => t.level === "critical").map((t) => `${t.risk} (${t.reference})`).join(" ; ")} ; ${pctFr(ri.risk_matrix.mitigated_pct)} des risques ouverts ont une mesure d'atténuation.`, metric: { label: "Risques critiques", value: ri.risk_matrix.critical, unit: "count", reference: 0, reference_label: "Cible" }, impact_gnf: null, confidence: 0.9, method: "Probabilité × impact sur une échelle de 1 à 5 ; critique à partir de 16.", evidence: null, action: "Revoir les mesures d'atténuation des risques critiques au prochain comité.", link: "/analyse/risques" }),
    ];
  }
  const constatsDomaine = (p, domaines) => constatsCabinet(p).filter((c) => domaines.includes(c.domain));

  /* ═══ Routes ══════════════════════════════════════════════════════════ */

  const cabinet = (chemin, profils, construire) =>
    route("GET", `/analyse/cabinet/${chemin}`, profils, (ctx) => {
      exigerEntite(ctx, "cabinet");
      const p = periode(ctx.query);
      const { insights, ...corps } = construire(p);
      return enveloppe(ctx, "cabinet", p, chemin === "synthese" ? qualiteSynthese() : qualite(chemin), insights, corps);
    });

  cabinet("synthese", PROFILS, (p) => {
    const tous = constatsCabinet(p);
    return { insights: classer(tous, 10), kpis: kpisCabinet(p), funnel: entonnoir(false), maturity: maturite(), maturity_thresholds: seuilsMaturite(), sections: Object.fromEntries(Object.keys(QUALITE).map((s) => [s, { insights: tous.filter((c) => c.domain === s).length, quality: QUALITE[s] }])) };
  });
  cabinet("portefeuille", PROFILS, (p) => ({ insights: classer(constatsDomaine(p, ["portefeuille"])), ...portefeuille(p) }));
  cabinet("diagnostic", PROFILS, (p) => ({ insights: classer(constatsDomaine(p, ["diagnostic"])), ...diagnostic(p) }));
  cabinet("comites", PROFILS, (p) => ({ insights: classer(constatsDomaine(p, ["comites"])), ...comites(p) }));
  cabinet("financements", PROFILS, (p) => ({ insights: classer(constatsDomaine(p, ["financements"])), ...financements(p) }));
  cabinet("activite", PROFILS_ACTIVITE, (p) => ({ insights: classer(constatsDomaine(p, ["activite"])), ...activite(p) }));
  cabinet("risques", PROFILS, (p) => ({ insights: classer(constatsDomaine(p, ["risques"])), ...risques(p) }));
}
