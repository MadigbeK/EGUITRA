/**
 * Calculs des simulateurs du portail, faits dans le navigateur : prêt à échéances constantes avec
 * différé, couverture du service de la dette (DSCR), seuil de rentabilité et besoin en fonds de
 * roulement. Fonctions pures, sûres aux valeurs nulles (taux nul, durée nulle, chiffre d'affaires nul).
 */

/** Année commerciale : les délais en jours se rapportent à 360 jours. */
export const ANNEE_JOURS = 360;

export type TypeDiffere = "partiel" | "total";

export interface ParamsPret {
  montant: number;
  /** Taux annuel en pourcentage (18 pour 18 %). */
  taux: number;
  /** Durée totale en mois, différé compris. */
  duree: number;
  differe: number;
  typeDiffere: TypeDiffere;
  /** Mois de la première échéance, AAAA-MM. */
  debut: string;
}

export interface LignePret {
  rang: number;
  date: Date;
  capitalDebut: number;
  interets: number;
  amortissement: number;
  echeance: number;
  capitalFin: number;
  differe: boolean;
}

export type ResultatPret =
  | { ok: false; raison: string }
  | {
      ok: true;
      tauxMensuel: number;
      /** Échéance constante après le différé. */
      echeance: number;
      /** Échéance pendant le différé (intérêts seuls, ou zéro si les intérêts sont capitalisés). */
      echeanceDiffere: number;
      /** Capital à amortir après le différé (augmenté des intérêts capitalisés en différé total). */
      capitalAmorti: number;
      moisAmortissement: number;
      lignes: LignePret[];
      totalRembourse: number;
      /** Coût total du crédit : tout ce qui est payé en plus du capital emprunté. */
      coutCredit: number;
    };

/** Échéance constante d'un capital sur n mois au taux mensuel r (r nul : capital divisé par n). */
export function annuite(capital: number, r: number, n: number): number {
  if (n <= 0 || capital <= 0) return 0;
  if (r <= 0) return capital / n;
  return (capital * r) / (1 - Math.pow(1 + r, -n));
}

/** Capital qu'une échéance constante rembourse sur n mois au taux mensuel r. */
export function capitalPourEcheance(echeance: number, r: number, n: number): number {
  if (n <= 0 || echeance <= 0) return 0;
  if (r <= 0) return echeance * n;
  return (echeance * (1 - Math.pow(1 + r, -n))) / r;
}

/** Premier jour du mois AAAA-MM décalé de i mois. */
export function moisDecale(debut: string, i: number): Date {
  const [a, m] = debut.split("-").map(Number);
  const maintenant = new Date();
  const annee = a && Number.isFinite(a) ? a : maintenant.getFullYear();
  const mois = m && Number.isFinite(m) ? m - 1 : maintenant.getMonth() + 1;
  return new Date(annee, mois + i, 1, 12);
}

export function simulerPret(p: ParamsPret): ResultatPret {
  const montant = Number.isFinite(p.montant) ? Math.max(0, p.montant) : 0;
  const duree = Number.isFinite(p.duree) ? Math.floor(p.duree) : 0;
  const differe = Number.isFinite(p.differe) ? Math.max(0, Math.floor(p.differe)) : 0;
  const taux = Number.isFinite(p.taux) ? p.taux : -1;
  if (montant <= 0) return { ok: false, raison: "Indiquez le montant à emprunter." };
  if (duree < 1) return { ok: false, raison: "Indiquez une durée d'au moins un mois." };
  if (duree > 360) return { ok: false, raison: "La durée ne peut dépasser 360 mois (30 ans)." };
  if (taux < 0 || taux > 100) return { ok: false, raison: "Le taux annuel doit être compris entre 0 et 100 %." };
  if (differe >= duree) return { ok: false, raison: "Le différé doit être plus court que la durée totale du prêt." };

  const r = taux / 100 / 12;
  const lignes: LignePret[] = [];
  let capital = montant;
  let rang = 0;
  for (let i = 0; i < differe; i++) {
    const interets = capital * r;
    const partiel = p.typeDiffere === "partiel";
    lignes.push({
      rang: ++rang,
      date: moisDecale(p.debut, rang - 1),
      capitalDebut: capital,
      interets,
      amortissement: 0,
      echeance: partiel ? interets : 0,
      capitalFin: partiel ? capital : capital + interets,
      differe: true,
    });
    if (!partiel) capital += interets;
  }

  const m = duree - differe;
  const capitalAmorti = capital;
  const echeance = annuite(capital, r, m);
  for (let j = 0; j < m; j++) {
    const interets = capital * r;
    const derniere = j === m - 1;
    // La dernière échéance solde le capital : les arrondis ne laissent aucun reliquat.
    const amortissement = derniere ? capital : Math.min(capital, echeance - interets);
    lignes.push({
      rang: ++rang,
      date: moisDecale(p.debut, rang - 1),
      capitalDebut: capital,
      interets,
      amortissement,
      echeance: interets + amortissement,
      capitalFin: derniere ? 0 : capital - amortissement,
      differe: false,
    });
    capital = derniere ? 0 : capital - amortissement;
  }

  const totalRembourse = lignes.reduce((s, l) => s + l.echeance, 0);
  return {
    ok: true,
    tauxMensuel: r,
    echeance,
    echeanceDiffere: differe ? (p.typeDiffere === "partiel" ? montant * r : 0) : 0,
    capitalAmorti,
    moisAmortissement: m,
    lignes,
    totalRembourse,
    coutCredit: totalRembourse - montant,
  };
}

/* ─── Capacité de remboursement ────────────────────────────────────────── */

export interface ParamsDscr {
  ebe: number;
  impots: number;
  renouvellement: number;
  service: number;
  source: "pret" | "saisie";
}

export const DSCR_CIBLE = 1.3;

export function calculerDscr(ebe: number, impots: number, renouvellement: number, service: number) {
  const flux = ebe - impots - renouvellement;
  const ratio = service > 0 ? flux / service : null;
  const serviceMax = Math.max(0, flux / DSCR_CIBLE);
  return { flux, ratio, serviceMax, echeanceMax: serviceMax / 12, ecart: service > 0 ? flux - service : 0 };
}

/* ─── Seuil de rentabilité ─────────────────────────────────────────────── */

export interface ParamsSeuil {
  ca: number;
  mode: "pct" | "montant";
  cvPct: number;
  cvMontant: number;
  cf: number;
}

export function calculerSeuil(p: ParamsSeuil) {
  const ca = Math.max(0, p.ca);
  const cv = p.mode === "pct" ? (ca * Math.max(0, p.cvPct)) / 100 : Math.max(0, p.cvMontant);
  const tauxCv = ca > 0 ? cv / ca : p.mode === "pct" ? Math.max(0, p.cvPct) / 100 : 0;
  const mcv = ca - cv;
  const tauxMcv = 1 - tauxCv;
  const cf = Math.max(0, p.cf);
  const seuil = tauxMcv > 0 ? cf / tauxMcv : null;
  const resultat = mcv - cf;
  const moisPointMort = seuil !== null && ca > 0 ? (seuil / ca) * 12 : null;
  const margeSecurite = seuil !== null ? ca - seuil : null;
  return {
    ca,
    cv,
    tauxCv,
    mcv,
    tauxMcv,
    cf,
    seuil,
    resultat,
    moisPointMort,
    joursPointMort: moisPointMort !== null ? (moisPointMort / 12) * ANNEE_JOURS : null,
    margeSecurite,
    indiceSecurite: margeSecurite !== null && ca > 0 ? margeSecurite / ca : null,
  };
}

/* ─── Besoin en fonds de roulement ─────────────────────────────────────── */

export interface ParamsBfr {
  ca: number;
  achats: number;
  delaiClients: number;
  delaiFournisseurs: number;
  stock: number;
}

export function calculerBfr(p: ParamsBfr) {
  const ca = Math.max(0, p.ca);
  const achats = Math.max(0, p.achats);
  const creances = (ca * Math.max(0, p.delaiClients)) / ANNEE_JOURS;
  const stocks = (achats * Math.max(0, p.stock)) / ANNEE_JOURS;
  const fournisseurs = (achats * Math.max(0, p.delaiFournisseurs)) / ANNEE_JOURS;
  const bfr = creances + stocks - fournisseurs;
  return { creances, stocks, fournisseurs, bfr, joursCa: ca > 0 ? (bfr / ca) * ANNEE_JOURS : null };
}

// Les nombres s'écrivent à l'écran avec les fonctions de lib/format.ts (milliers groupés, espace insécable
// avant l'unité) ; l'export CSV du tableau d'amortissement a son écriture propre (SimulateurPret).
