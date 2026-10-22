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
