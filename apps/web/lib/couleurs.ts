/**
 * Couleurs des graphiques et des repères d'état, toutes posées sur les jetons du thème
 * (app/globals.css). Un écran ne copie pas de code hexadécimal : il prend sa couleur ici, et elle
 * suit le thème clair ou le mode nuit.
 */

/** Gamme des séries, dans son ordre fixe (contrôlée pour les daltoniens). */
export const SERIES = ["var(--g-jade)", "var(--g-azur)", "var(--g-ambre)", "var(--g-rose)", "var(--g-lagon)", "var(--g-corail)", "var(--g-anis)"] as const;

/** Couleur d'un repère d'état (segment, point, jauge), du meilleur au pire. */
export const ETATS = {
  excellent: "var(--g-jade-fonce)",
  bon: "var(--g-jade)",
  correct: "var(--g-jade-clair)",
  passable: "var(--g-anis)",
  attention: "var(--g-ambre)",
  risque: "var(--g-corail)",
  alerte: "var(--danger-vif)",
  critique: "var(--g-rouge)",
  grave: "var(--g-bordeaux)",
  neutre: "var(--g-gris)",
  information: "var(--g-azur)",
  examen: "var(--g-lagon)",
  retire: "var(--line-strong)",
} as const;

/** Échelle ordonnée du meilleur au pire : ancienneté des créances, retards de paiement, notes. */
export const ECHELLE = [ETATS.bon, ETATS.passable, ETATS.attention, ETATS.risque, ETATS.critique, ETATS.grave] as const;

/** Verdict du scoring AxisPro (cartes du pipeline, synthèse du portefeuille). */
export const COULEUR_VERDICT: Record<string, string> = {
  bankable: ETATS.excellent,
  apd_ready: ETATS.bon,
  go: ETATS.correct,
  conditional: ETATS.attention,
  hold: ETATS.risque,
  no_go: ETATS.alerte,
  pending: ETATS.neutre,
  postponed: ETATS.information,
};

/** Décision d'un comité d'investissement. */
export const COULEUR_DECISION: Record<string, string> = {
  go: ETATS.bon,
  conditional: ETATS.attention,
  hold: ETATS.risque,
  no_go: ETATS.alerte,
  postponed: ETATS.information,
};

/** Étape d'une démarche de financement, de l'identification au décaissement. */
export const COULEUR_FINANCEMENT: Record<string, string> = {
  identified: ETATS.neutre,
  submitted: ETATS.information,
  review: ETATS.examen,
  agreed: ETATS.attention,
  signed: ETATS.bon,
  disbursed: ETATS.excellent,
  rejected: ETATS.alerte,
  withdrawn: ETATS.retire,
};

/* ─── Tons d'état des tampons (Badge) ──────────────────────────────────── */

/**
 * Ton d'un état écrit : alerte (danger), à surveiller (warn), favorable (ok), neutre. Quatre tons
 * seulement, les mêmes dans toutes les applications. La couleur d'une application (ton « accent »
 * de l'interface) sert à la marque, aux actions, à la sélection et aux graphiques, jamais à un état.
 */
export type TonEtat = "danger" | "warn" | "ok" | "neutral";

/**
 * Le tampon est plein (fond doux) pour ce qui demande une action, au trait pour le reste : un écran
 * se lit d'abord par ce qu'il reste à faire.
 */
export function tamponPlein(ton: string): boolean {
  return ton === "warn" || ton === "danger";
}

/**
 * Table unique des états courants, par le mot affiché. Un même mot garde le même ton partout :
 * « Élevée » n'est pas ambre en Finance et rouge dans l'Analyse. Un écran qui a besoin d'un mot
 * absent de la table l'y ajoute, au lieu de choisir sa couleur sur place.
 */
export const ETAT_TON: Readonly<Record<string, TonEtat>> = {
  // Gravité d'une alerte ou d'un constat.
  Critique: "danger",
  Bloquante: "danger",
  Bloquant: "danger",
  Élevée: "warn",
  Moyenne: "neutral",
  Information: "neutral",
  "À noter": "neutral",
  "Point fort": "ok",

  // Cycle de vie d'une pièce, d'une rotation, d'une demande.
  Brouillon: "neutral",
  "En préparation": "neutral",
  Saisie: "warn",
  "À valider": "warn",
  "À approuver": "warn",
  "À corriger": "warn",
  "À reprendre": "warn",
  "En attente": "warn",
  // Transport : rotation validée qui attend sa facture. Distincte de « Facturée » dans la vue
  // « Toutes » ; c'est un état de travail pour la facturation, sans urgence.
  "À facturer": "neutral",
  Validée: "ok",
  Approuvée: "ok",
  Comptabilisée: "ok",
  Facturée: "ok",
  Réalisée: "ok",
  "Reçue au bureau": "neutral",
  "En cours": "neutral",
  Annulée: "neutral",
  Annulé: "neutral",
  Extournée: "neutral",
  Archivée: "neutral",
  Abandonnée: "neutral",
  Clos: "neutral",
  "Sans objet": "neutral",
  Refusée: "danger",
  Refusé: "danger",
  Rejetée: "danger",
  Bloquée: "danger",

  // Suivi des demandes au support (Mes demandes) : état, gravité et délai engagé.
  Déposée: "warn",
  "Prise en charge": "neutral",
  Résolue: "ok",
  Close: "neutral",
  Majeure: "warn",
  Mineure: "neutral",
  "Hors délai": "danger",

  // Règlement.
  "Non payée": "warn",
  Partielle: "warn",
  Échue: "danger",
  Contentieux: "danger",
  "En paiement": "neutral",
  "Payée, à rapprocher": "neutral",
  Payée: "ok",
  Soldée: "ok",
  Soldé: "ok",

  // Immobilisations, contrats, contrôles.
  "En service": "ok",
  "En vigueur": "ok",
  Amortie: "neutral",
  Sortie: "neutral",
  Conforme: "ok",
  "À jour": "ok",
  Manquante: "danger",
  "Sous le seuil": "danger",
};

const ETAT_TON_MINUSCULES = new Map(Object.entries(ETAT_TON).map(([mot, ton]) => [mot.toLocaleLowerCase("fr"), ton]));

/** Ton d'un état d'après son mot (« Saisie », « échue »…) ; `defaut` pour un mot absent de la table. */
export function tonEtat(mot: string, defaut: TonEtat = "neutral"): TonEtat {
  return ETAT_TON[mot] ?? ETAT_TON_MINUSCULES.get(mot.trim().toLocaleLowerCase("fr")) ?? defaut;
}
