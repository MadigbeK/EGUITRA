/**
 * Kit de visualisation premium de NIMOVA · Analyse : SVG rendu par React, géométrie par d3-scale,
 * d3-shape, d3-array, d3-hierarchy et d3-sankey, couleurs sur les jetons (thème clair et mode
 * nuit), animations sobres qui s'arrêtent avec « réduire les animations », info-bulles, légendes
 * interactives, tables de repli pour les lecteurs d'écran.
 */
export { Cascade } from "./Cascade";
export { CarteChaleur, type CelluleChaleur } from "./CarteChaleur";
export { Lorenz, Pareto } from "./Lorenz";
export { Entonnoir, type EtapeEntonnoir } from "./Entonnoir";
export { Sankey } from "./Sankey";
export { Treemap, type FeuilleTreemap } from "./Treemap";
export { Bulles, type PointBulle, type Quadrants } from "./Bulles";
export { Eventail, type PointEventail } from "./Eventail";
export { Radar, type AxeRadar } from "./Radar";
export { Benford } from "./Benford";
export { Puces, type PuceItem } from "./Puces";
export { PetitsMultiples, type Multiple } from "./PetitsMultiples";
export { MatriceRisques } from "./MatriceRisques";
export { Legende, TableRepli, fmtValeur, fmtAxe, moisCourt, SERIES, COULEUR, divergente, sequentielle, teinte } from "./commun";
