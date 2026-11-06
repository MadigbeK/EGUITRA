/**
 * Parcours d'évaluation de MB AxisPro Consulting : textes, listes de référence et règles d'affichage des
 * écrans EC-01 à EC-12 (cahier des charges MBAP/PROJECT-DEVELOPMENT/SC-01-APP V2.0, décision du gérant du
 * 4 novembre 2026 : le prototype du cabinet devient la référence de /axispro, les outils existants le
 * complètent). Les valeurs (scores, knock-out, conditions) viennent du noyau ; ce module n'établit lui-même
 * que les résultats et le comité d'un dossier de l'ancienne méthode, que les routes SC-01 V2 refusent, en
 * suivant les sections 7.3 et 7.6 du cahier.
 */

import type { ConditionPassage, CouleurDomaine, CriterionEval, DecisionComite, DecisionsDossier, DossierDetail, DossierSummary, DomainScore, EtatCondition, Followup, Gate, GateDecision, GateIndice, KoActif, LignePilotage, PassageGate, Recommendation, Resultats, Review, Status, TonSuivi, VerificationPiece } from "./axispro-types";
import { fmtDate, fmtFixe } from "./format";

export type Ton = "ok" | "warn" | "danger" | "neutral" | "accent";

/* ─── Textes fixes et listes de référence ───────────────────────────────── */

export const METHODE = "Évaluation de la maturité et de la bancabilité selon la méthode SC-01 V2 : 111 critères, 9 knock-out, 8 gates du Project Intake au Financial Close.";
export const MANDAT = "Portefeuille · Mandat KUC / CCT-Fund Strategic";
export function noteRelance(jours = 14): string {
  return `Un promoteur est « à relancer » quand des pièces manquent et qu'aucune relance n'a été enregistrée depuis ${jours} jours, ou dès qu'une échéance est dépassée.`;
}

/** Gates de la méthode (annexe C) : noms du noyau en priorité. */
export const GATES_REFERENCE = ["Intake", "Préqualification", "Préfaisabilité", "APD Readiness", "Bankability Review", "Due Diligence", "SPV & Financement", "Financial Close"];
export const DERNIER_GATE = GATES_REFERENCE.length - 1;

/** Secteurs (annexe C), le temps que la référence du noyau arrive. */
export const SECTEURS = ["Mines et infrastructures minières", "Énergie", "Industrie et transformation", "Agro-industrie", "Infrastructures et logistique", "Économie numérique", "Tourisme et loisirs", "Immobilier", "Autre"];

/** Vérification d'une pièce (annexe C). */
export const VERIFICATIONS: Array<{ value: VerificationPiece; label: string }> = [
  { value: "to_check", label: "À vérifier" },
  { value: "conforming", label: "Conforme" },
  { value: "unsigned", label: "Non signé" },
  { value: "expired", label: "Périmé" },
  { value: "incomplete", label: "Incomplet" },
];

/** Les 7 étapes du dossier : route, nom et phrase de l'accueil (annexe E). */
export type CleEtape = "fiche" | "pieces" | "scoring" | "resultats" | "relances" | "comite" | "dossier";
export const ETAPES: Array<{ n: number; cle: CleEtape; nom: string; texte: string }> = [
  { n: 1, cle: "fiche", nom: "Fiche projet", texte: "Identité, contact du promoteur, recevabilité. Le numéro MBAP est attribué automatiquement." },
  { n: 2, cle: "pieces", nom: "Pièces", texte: "Dépôt des documents par catégorie de data room (A à J) et rattachement au critère qu'ils justifient." },
  { n: 3, cle: "scoring", nom: "Scoring", texte: "Notation des 111 critères en 15 domaines : disponible, incomplet, non disponible ou non applicable." },
  { n: 4, cle: "resultats", nom: "Résultats", texte: "Readiness, APD et Bankability sur 100, knock-out, score par domaine, conditions du gate suivant." },
  { n: 5, cle: "relances", nom: "Relances", texte: "Pièces manquantes classées par priorité, message prêt à envoyer, historique des relances." },
  { n: 6, cle: "comite", nom: "Comité", texte: "Décision GO, CONDITIONAL GO, HOLD ou NO-GO. Un GO fait passer le projet au gate suivant." },
  { n: 7, cle: "dossier", nom: "Dossier complet", texte: "Un seul fichier .zip : synthèse, scoring Excel, relance et toutes les pièces classées." },
];

/** Outils du cabinet : les anciens écrans du dossier, joignables par la route `outils?onglet=`. */
export type CleOutil = "synthese" | "evaluation" | "gates" | "modele" | "risques" | "actions" | "financements" | "dataroom" | "relances" | "comites" | "journal" | "echanges" | "rapport" | "temps";
export const OUTILS: Array<{ cle: CleOutil; nom: string }> = [
  { cle: "modele", nom: "Modèle financier" },
  { cle: "risques", nom: "Risques" },
  { cle: "actions", nom: "Plan d'actions" },
  { cle: "financements", nom: "Financements" },
  { cle: "journal", nom: "Journal" },
  { cle: "echanges", nom: "Messages" },
  { cle: "temps", nom: "Temps passés" },
  { cle: "synthese", nom: "Compartiments et équipe" },
  { cle: "evaluation", nom: "Grille complète" },
  { cle: "gates", nom: "Stage gates" },
  { cle: "dataroom", nom: "Pièces standard" },
  { cle: "relances", nom: "Suivi des relances" },
  { cle: "comites", nom: "Revues scellées" },
  { cle: "rapport", nom: "Rapports" },
];
export const CLES_OUTILS: readonly string[] = OUTILS.map((o) => o.cle);

/** Statuts de notation (section 7.1) ; un critère jamais noté compte comme « Non disponible » (RG-07-01). */
export const STATUTS: Array<{ value: Exclude<Status, "not_assessed">; label: string }> = [
  { value: "not_met", label: "Non disponible" },
  { value: "partial", label: "Incomplet / à actualiser" },
  { value: "met", label: "Disponible et exploitable" },
  { value: "na", label: "Non applicable" },
];

/** Type d'exigence d'un critère (annexe A). */
export const TYPE_EXIGENCE: Record<string, string> = { blocking: "Bloquant", apd: "PendantAPD", closing: "DD-SPV-Closing" };

/** Décisions du comité (annexe C), libellées pour le gate examiné. */
export function optionsDecision(gate: number): Array<{ value: GateDecision; label: string }> {
  return [
    { value: "go", label: `GO : passage au Gate ${gate + 1}` },
    { value: "conditional", label: `CONDITIONAL GO : passage au Gate ${gate + 1} sous conditions` },
    { value: "hold", label: `HOLD : maintien au Gate ${gate}` },
    { value: "no_go", label: "NO-GO : clôture du projet" },
  ];
}

export const LIBELLE_DECISION: Record<GateDecision, string> = { go: "GO", conditional: "CONDITIONAL GO", hold: "HOLD", no_go: "NO-GO" };
export const TON_DECISION: Record<GateDecision, Ton> = { go: "ok", conditional: "warn", hold: "warn", no_go: "danger" };

/* ─── Gates ─────────────────────────────────────────────────────────────── */

/** Numéro d'un gate : les chiffres de son code (« G3 » → 3), à défaut son rang dans la grille. */
export function numeroGate(gate: Pick<Gate, "code"> | null | undefined, gates?: Gate[]): number {
  if (!gate) return 0;
  const lu = /\d+/.exec(gate.code)?.[0];
  if (lu !== undefined) return Number(lu);
  const rang = (gates ?? []).findIndex((g) => g.code === gate.code);
  return rang < 0 ? 0 : rang;
}

/** Nom d'un gate par son numéro : celui de la grille du dossier, à défaut celui du cahier. */
export function nomGate(n: number, gates?: Gate[]): string {
  return (gates ?? []).find((g) => numeroGate(g) === n)?.name ?? GATES_REFERENCE[n] ?? `Gate ${n}`;
}

export function gateDe(d: Pick<DossierSummary, "current_gate" | "gates">): number {
  return numeroGate(d.current_gate, d.gates);
}

/* ─── Situation d'un projet ─────────────────────────────────────────────── */

/** Le dossier suit-il la méthode de référence ? Les routes des résultats et du comité le demandent. */
export function estV2(d: Pick<DossierSummary, "method">): boolean {
  return d.method === "sc01_v2";
}

/** Nom du promoteur d'une ligne de pilotage. */
export function nomPromoteur(d: Pick<LignePilotage, "promoter">): string | null {
  return (typeof d.promoter === "string" ? d.promoter : d.promoter?.name) || null;
}

/** Recevabilité : celle du noyau ; à défaut, un projet sorti du Gate 0 a été déclaré recevable (RG-05-03). */
export function estRecevable(d: Pick<DossierDetail, "admissibility" | "current_gate" | "gates">): boolean {
  return d.admissibility?.admissible ?? gateDe(d) >= 1;
}

function identiteComplete(d: Pick<DossierSummary, "name" | "promoter">): boolean {
  return Boolean(d.name?.trim() && d.promoter?.name?.trim());
}

/** Classification affichée : « NO-GO » dès qu'un knock-out est actif (RG-02-02). */
export function classificationDe(d: Pick<DossierSummary, "classification" | "knockouts">): { label: string; ton: Ton } {
  if (d.knockouts > 0) return { label: "NO-GO", ton: "danger" };
  const c = d.classification || "–";
  if (/NO-GO/.test(c)) return { label: c, ton: "danger" };
  if (/HOLD|CONDITIONAL/.test(c)) return { label: c, ton: "warn" };
  return { label: c, ton: /READY|BANKABLE|ADVANCED/.test(c) ? "ok" : "neutral" };
}

const TON_SUIVI: Record<TonSuivi, Ton> = { rouge: "danger", orange: "warn", vert: "ok", neutre: "neutral" };

/** Suivi du promoteur (RG-02-03) : libellé et couleur du noyau (orange ou rouge : à relancer). */
export function suiviDe(f: Pick<Followup, "state" | "label" | "tone" | "overdue" | "last_date"> | undefined, etat?: DossierSummary["state"]): { label: string; ton: Ton; aRelancer: boolean } {
  if (!f) return { label: "–", ton: "neutral", aRelancer: false };
  if (f.label && f.tone) return { label: f.label, ton: TON_SUIVI[f.tone], aRelancer: f.state === "overdue" || f.state === "never" || f.state === "due" };
  switch (f.state) {
    case "overdue":
      return { label: `${f.overdue} échéance(s) dépassée(s)`, ton: "danger", aRelancer: true };
    case "never":
      return { label: "Jamais relancé", ton: "warn", aRelancer: true };
    case "due":
      return { label: "À relancer", ton: "warn", aRelancer: true };
    case "recent":
      return { label: `Relancé le ${fmtDate(f.last_date)}`, ton: "neutral", aRelancer: false };
    case "complete":
      return { label: "Dossier complet", ton: "ok", aRelancer: false };
    default:
      return { label: etat === "closed" ? "Clos" : "Suspendu", ton: "neutral", aRelancer: false };
  }
}

/** Recommandation de la méthode ramenée aux quatre décisions du cahier (section 7.3). */
export function decisionRecommandee(r: Recommendation | undefined): GateDecision | null {
  switch (r) {
    case "bankable":
    case "apd_ready":
    case "go":
      return "go";
    case "conditional":
      return "conditional";
    case "hold":
      return "hold";
    case "no_go":
      return "no_go";
    default:
      return null;
  }
}

/* ─── Barre des 7 étapes (section 6.12) ─────────────────────────────────── */

export interface EtatEtape { n: number; cle: CleEtape; nom: string; etat: string; termine: boolean }

/** Note sur 100 à une décimale : « 39,8 / 100 ». */
export function sur100(v: number | null | undefined): string {
  return `${fmtFixe(v ?? 0, 1)} / 100`;
}

/**
 * États des étapes : ceux du noyau (grille SC-01 V2), à défaut établis sur le dossier. Notation et résultats
 * restent lus sur les indicateurs : ils changent à chaque critère noté, sans relire le dossier.
 */
export function etatsEtapes(d: DossierDetail, nbPieces: number | null): EtatEtape[] {
  const s = d.scoring;
  const identite = identiteComplete(d);
  const recevable = estRecevable(d);
  const f = d.followup;
  const derniere = decisionsDeRevues(d)[0];
  const etats: Record<CleEtape, { etat: string; termine: boolean }> = {
    fiche: { etat: !identite ? "À compléter" : recevable ? "Recevable" : "À statuer", termine: identite && recevable },
    pieces: { etat: nbPieces === null ? "–" : `${nbPieces} pièce(s)`, termine: (nbPieces ?? 0) >= 1 },
    scoring: { etat: `${s.assessed} / ${s.criteria} notés`, termine: s.criteria > 0 && s.assessed >= s.criteria },
    resultats: { etat: sur100(s.readiness), termine: s.assessed >= 1 },
    relances: {
      etat: f && f.count > 0 ? `${f.count} relance(s)` : f && f.missing > 0 ? `${f.missing} gaps` : "Rien à relancer",
      termine: !f || f.count > 0 || f.missing === 0,
    },
    comite: { etat: derniere ? LIBELLE_DECISION[derniere.decision] : "Aucune décision", termine: Boolean(derniere) },
    dossier: { etat: ".zip", termine: false },
  };
  return ETAPES.map((e) => {
    const lue = e.cle === "scoring" || e.cle === "resultats" ? undefined : d.steps?.find((x) => x.step === e.n);
    return { n: e.n, cle: e.cle, nom: e.nom, ...(lue ? { etat: lue.state, termine: lue.done } : etats[e.cle]) };
  });
}

/* ─── Knock-out et conditions de passage (sections 7.3 et 7.6) ──────────── */

/** Gate à partir duquel un « Incomplet » bloque un knock-out (section 7.7). */
const GATE_INCOMPLET_BLOQUANT = 3;

/** koActifs(g) : knock-out du gate g ou d'avant, non disponibles, ou incomplets à partir du Gate 3. */
export function koActifs(criteres: CriterionEval[], g: number): CriterionEval[] {
  return criteres.filter((c) => {
    if (!c.knockout || numeroGate({ code: c.gate }) > g) return false;
    const s = c.retained ?? c.status;
    return s === "not_met" || s === "not_assessed" || (s === "partial" && g >= GATE_INCOMPLET_BLOQUANT);
  });
}

export const ETAT_CONDITION: Record<EtatCondition, { label: string; ton: Ton }> = {
  met: { label: "Remplie", ton: "ok" },
  unmet: { label: "Non remplie", ton: "danger" },
  assess: { label: "À apprécier", ton: "warn" },
};

function gateIndice(n: number, gates: Gate[] | undefined): GateIndice {
  return { index: n, code: `G${n}`, name: nomGate(n, gates) };
}

function koAffiche(c: CriterionEval): KoActif {
  return { code: c.code, name: c.name, domain: c.domain, gate_index: numeroGate({ code: c.gate }) };
}

/** Ancienne méthode : passage au gate suivant, établi sur les scores et les critères du dossier. */
function passageAncien(d: DossierDetail, criteres: CriterionEval[] | undefined): PassageGate | null {
  const g = gateDe(d);
  if (g >= DERNIER_GATE) return null;
  const n = g + 1;
  const s = d.scoring;
  const seuil = (label: string, ok: boolean): ConditionPassage => ({ key: label, label, state: ok ? "met" : "unmet" });
  const sansKo = !criteres || koActifs(criteres, n).length === 0;
  const dscr = d.decision_inputs?.dscr_manual ?? d.financial?.dscr_min ?? null;
  const seuilDscr = s.thresholds?.dscr ?? 1.3;
  const conditions: ConditionPassage[] =
    g === 0
      ? [seuil("Projet déclaré recevable", estRecevable(d)), seuil("Readiness ≥ 30", s.readiness >= 30), seuil("Aucun knock-out de Gate 1 actif", sansKo)]
      : g === 1
        ? [seuil("Readiness ≥ 50", s.readiness >= 50), seuil("Aucun knock-out de Gate 2 actif", sansKo)]
        : g === 2
          ? [seuil("APD Readiness ≥ 50", s.apd >= 50), seuil("Aucun knock-out actif", sansKo)]
          : g === 3
            ? [seuil("Bankability ≥ 65", s.bankability >= 65), seuil(`DSCR saisi ≥ ${fmtFixe(seuilDscr, 2)} x`, dscr !== null && dscr >= seuilDscr), seuil("Aucun knock-out actif", sansKo)]
            : [seuil("Aucun knock-out actif", sansKo), { key: "qualitatif", label: "Conditions qualitatives à apprécier par le comité", state: "assess" }];
  return { from: g, to: n, to_name: nomGate(n, d.gates), conditions, favorable: !conditions.some((c) => c.state === "unmet") };
}

/** Résultats d'un dossier de l'ancienne méthode, sous la forme de la route SC-01 V2 ; il n'a pas de versions. */
export function resultatsAnciens(d: DossierDetail, criteres: CriterionEval[] | undefined): Resultats {
  const s = d.scoring;
  const g = gateDe(d);
  const critiques = criteres?.filter((c) => c.critical) ?? null;
  const manquants = critiques ? critiques.filter((c) => (c.retained ?? c.status) === "not_met" || (c.retained ?? c.status) === "not_assessed").length : s.critical_open.length;
  const aLever = g < DERNIER_GATE && criteres ? koActifs(criteres, g + 1) : [];
  const reco = decisionRecommandee(s.method_recommendation ?? s.recommendation);
  return {
    gate: gateIndice(g, d.gates),
    target_gate: g < DERNIER_GATE ? gateIndice(g + 1, d.gates) : null,
    tiles: {
      readiness: s.readiness,
      apd: s.apd,
      bankability: s.bankability,
      completeness: s.completeness,
      critical_missing: manquants,
      critical_total: critiques?.length ?? null,
      knockouts: s.knockouts.length,
      knockouts_next: aLever.length,
      decision: reco,
      decision_label: reco ? LIBELLE_DECISION[reco] : null,
      classification: s.classification,
    },
    blocked: s.knockouts.map((k) => ({ code: k.code, name: k.name })),
    to_lift: aLever.map(koAffiche),
    domains: s.domains,
    passage: passageAncien(d, criteres),
    dscr: d.decision_inputs?.dscr_manual ?? null,
    versions: null,
    next_version: null,
  };
}

/** Décisions d'un dossier de l'ancienne méthode : ses revues du comité, de la plus récente à la plus ancienne. */
function decisionsDeRevues(d: Pick<DossierDetail, "reviews">): DecisionComite[] {
  return (d.reviews ?? [])
    .filter((r): r is Review & { decision: GateDecision } => r.decision !== "postponed")
    .map((r) => {
      const n = numeroGate(r.gate ? { code: r.gate } : null);
      return { id: r.id, date: r.date, gate: `${n} → ${n + 1}`, decision: r.decision, readiness: r.readiness, members: r.members, motive: r.motive, conditions: r.conditions };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

/** Comité d'un dossier de l'ancienne méthode, sous la forme de la route SC-01 V2. */
export function decisionsAnciennes(d: DossierDetail, criteres: CriterionEval[] | undefined, peutDecider: boolean): DecisionsDossier {
  const g = gateDe(d);
  const passage = passageAncien(d, criteres);
  return {
    gate: gateIndice(g, d.gates),
    gates: GATES_REFERENCE.map((_, n) => ({ ...gateIndice(n, d.gates), reached: n <= g })),
    passage,
    to_lift: g < DERNIER_GATE && criteres ? koActifs(criteres, g + 1).map(koAffiche) : [],
    preselected: passage?.favorable ? "go" : "hold",
    can_decide: peutDecider && d.state !== "closed" && !d.locked && g < DERNIER_GATE,
    refusal: null,
    decisions: decisionsDeRevues(d),
  };
}

/* ─── Score par domaine (section 7.5) ───────────────────────────────────── */

export type Priorite = NonNullable<DomainScore["priority"]>;

export function prioriteDe(score: number | null | undefined): Priorite | null {
  if (score === null || score === undefined) return null;
  return score < 30 ? "URGENTE" : score < 50 ? "ÉLEVÉE" : score < 65 ? "MOYENNE" : "FAIBLE";
}

const COULEUR_DE_PRIORITE: Record<Priorite, CouleurDomaine> = { URGENTE: "rouge", ÉLEVÉE: "orange", MOYENNE: "ocre", FAIBLE: "vert" };

const CLASSES_COULEUR: Record<CouleurDomaine, { barre: string; texte: string }> = {
  rouge: { barre: "bg-danger", texte: "text-danger" },
  orange: { barre: "bg-orange-600", texte: "text-orange-700" },
  ocre: { barre: "bg-warn", texte: "text-warn" },
  vert: { barre: "bg-ok", texte: "text-ok-texte" },
  gris: { barre: "bg-line-strong", texte: "text-muted" },
};

/** Priorité et couleur d'un domaine (section 7.5) : celles du noyau, à défaut déduites du score. */
export function apparenceDomaine(x: Pick<DomainScore, "score" | "priority" | "color">): { priorite: Priorite | null; classes: { barre: string; texte: string } } {
  const priorite = x.priority ?? prioriteDe(x.score);
  return { priorite, classes: CLASSES_COULEUR[x.color ?? (priorite ? COULEUR_DE_PRIORITE[priorite] : "gris")] };
}

/* ─── Divers ────────────────────────────────────────────────────────────── */

/** Salutation de l'accueil : « Bonsoir » après 18 h, heure de Conakry. */
export function salutation(maintenant: Date = new Date()): "Bonjour" | "Bonsoir" {
  const heure = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Conakry" }).format(maintenant));
  return heure >= 18 ? "Bonsoir" : "Bonjour";
}

/** Date du jour de l'en-tête de l'accueil : « mercredi 4 novembre 2026 ». */
export function dateLongue(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Conakry" }).format(maintenant);
}
