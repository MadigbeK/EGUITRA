"use client";

/**
 * Briques communes de NIMOVA · HSSEQ : criticité et ses niveaux (§9.1), libellés français des
 * domaines, types, statuts et motifs du verrou (V01 à V09), écriture des indicateurs du cockpit (§10),
 * tampons d'état, tampon de criticité et matrice 5 × 5. Les données (clés et valeurs en anglais) sont
 * décrites dans lib/hsseq-types.ts ; les mots affichés sont ici.
 *
 * Tons : un mot garde le ton de ETAT_TON (lib/couleurs.ts) quand il y figure ; les mots propres à
 * HSSEQ sont dans TON_HSSEQ ci-dessous, en attendant d'être versés dans la table commune. Seule
 * exception, décidée pour HSSEQ (25/10) : les niveaux de criticité ont leur propre table,
 * TON_CRITICITE, où « Élevée » est en alerte, alors que la table commune la met à surveiller.
 */

import type { CSSProperties } from "react";
import { Badge } from "@/components/ui";
import { cx } from "@/lib/cx";
import { ETATS, ETAT_TON, tonEtat, type TonEtat } from "@/lib/couleurs";
import { INSECABLE, fmtDate, fmtFixe, fmtInt, fmtPct, fmtRatio } from "@/lib/format";
import type {
  ActionOrigin,
  ActionStatus,
  BreathTestStatusValue,
  CheckAnswerValue,
  CheckKind,
  CheckResult,
  ControlLevel,
  CostKind,
  CriticalityLevel,
  Domain,
  EventStatus,
  EventType,
  Factor5M,
  IndicatorCode,
  IndicatorUnit,
  InvestigationMethod,
  NonconformityStatus,
  PersonRole,
  ReasonCode,
  RotationRef,
  Score,
  VehicleDocumentKind,
  VehicleKind,
  VehicleRef,
  WaiverStatus,
} from "@/lib/hsseq-types";

/* ─── Criticité (§9.1) ────────────────────────────────────────────────── */

/** Notes de 1 à 5, dans l'ordre. */
export const NOTES: readonly Score[] = [1, 2, 3, 4, 5];

/**
 * Niveaux de criticité, du plus faible au plus fort : bornes, libellé, repère de couleur (gamme ETATS)
 * et effet automatique. Les bornes servies par le noyau (GET /hsseq/referentials,
 * criticality_thresholds) l'emportent : elles sont paramétrables (§11).
 */
export const NIVEAUX: Record<CriticalityLevel, { label: string; min: number; max: number; couleur: string; effet: string }> = {
  low: { label: "Faible", min: 1, max: 3, couleur: ETATS.bon, effet: "Enregistrement et suivi statistique" },
  moderate: { label: "Modérée", min: 4, max: 7, couleur: ETATS.attention, effet: "Analyse simple sous 15 jours" },
  significant: { label: "Significative", min: 8, max: 14, couleur: ETATS.risque, effet: "Enquête 5 Pourquoi sous 7 jours, Responsable HSSEQ et responsable métier notifiés" },
  high: { label: "Élevée", min: 15, max: 25, couleur: ETATS.critique, effet: "Arbre des causes sous 72 h, Directeur général notifié, donneur d'ordre informé sous 24 h" },
};

export const ORDRE_NIVEAUX: readonly CriticalityLevel[] = ["low", "moderate", "significant", "high"];

/** Criticité : gravité × probabilité, chacune de 1 à 5 ; nulle si une note manque. */
export function criticite(gravite: number | null | undefined, probabilite: number | null | undefined): number | null {
  if (!gravite || !probabilite) return null;
  return gravite * probabilite;
}

/** Niveau d'une criticité (1 à 25) ; nul hors bornes ou sans note. */
export function niveauCriticite(note: number | null | undefined): CriticalityLevel | null {
  if (note === null || note === undefined || !Number.isFinite(note) || note < 1 || note > 25) return null;
  return ORDRE_NIVEAUX.find((n) => note <= NIVEAUX[n].max) ?? null;
}

/** Vérification d'efficacité à J+90 exigée pour une action issue d'une criticité de 8 ou plus (§9.2). */
export function verificationRequise(note: number | null | undefined): boolean {
  return (note ?? 0) >= 8;
}

/* ─── Tons des tampons ────────────────────────────────────────────────── */

/** Niveaux de criticité : « Élevée » en alerte, « Significative » à surveiller, les autres neutres. */
const TON_CRITICITE: Readonly<Record<string, TonEtat>> = {
  Élevée: "danger",
  Significative: "warn",
  Modérée: "neutral",
  Faible: "neutral",
};

/** Mots propres à HSSEQ absents de ETAT_TON. */
const TON_HSSEQ: Readonly<Record<string, TonEtat>> = {
  "Non classé": "neutral",
  // Cockpit et paramètres.
  "Sous surveillance": "warn",
  "Sous 7 jours": "warn",
  "Sans donnée": "neutral",
  "Inactif": "neutral",
  // Plan d'actions et contrôles.
  "Escaladée": "danger",
  "Photo manquante": "warn",
  "Photos manquantes": "warn",
  // Événements.
  Déclaré: "warn",
  Classé: "neutral",
  "En enquête": "neutral",
  "Actions en cours": "neutral",
  Clôturé: "neutral",
  "Enquête en retard": "danger",
  // Actions.
  "À faire": "neutral",
  "À vérifier": "warn",
  Close: "neutral",
  "En retard": "danger",
  Efficace: "ok",
  "Non efficace": "danger",
  // Contrôles, non-conformités, alcootests.
  "Avec réserves": "warn",
  "Non conforme": "danger",
  Ouverte: "warn",
  Levée: "ok",
  "Non réalisé": "warn",
  Fait: "ok",
  "Non fait": "warn",
  Négatif: "ok",
  Positif: "danger",
  // Verrou et dérogations.
  Autorisé: "ok",
  Bloqué: "danger",
  "À contrôler": "warn",
  "Sous dérogation": "warn",
  "Attente Responsable HSSEQ": "warn",
  Active: "warn",
  Expirée: "neutral",
};

/** Ton d'un mot d'état HSSEQ : niveaux de criticité, puis table commune, puis mots propres au module. */
export function tonHsseq(mot: string, defaut: TonEtat = "neutral"): TonEtat {
  return TON_CRITICITE[mot] ?? ETAT_TON[mot] ?? TON_HSSEQ[mot] ?? tonEtat(mot, defaut);
}

/** Mot d'un départ du jour : autorisé, à contrôler (seules des saisies de terrain manquent) ou bloqué. */
export function etatDepart(depart: { evaluation: { allowed: boolean }; pending_checks_only: boolean }): "Autorisé" | "À contrôler" | "Bloqué" {
  return depart.evaluation.allowed ? "Autorisé" : depart.pending_checks_only ? "À contrôler" : "Bloqué";
}

/** Tampon d'un état HSSEQ : le mot, et le ton qu'il porte partout. */
export function Tampon({ mot, vivant }: { mot: string; vivant?: boolean }) {
  return (
    <Badge tone={tonHsseq(mot)} vivant={vivant}>
      {mot}
    </Badge>
  );
}

/* ─── Libellés ────────────────────────────────────────────────────────── */

/** Type de véhicule (vehicle_kind de Transport). */
export const TYPE_VEHICULE: Record<VehicleKind, string> = { tanker: "Citerne", tipper: "Benne" };

/** Documents du véhicule suivis par le verrou (V05, V06) et les échéances. */
export const DOCUMENT_VEHICULE: Record<VehicleDocumentKind, string> = {
  insurance: "Assurance",
  inspection: "Visite technique",
  calibration: "Barémage",
  tightness: "Certificat d'étanchéité",
};

export const DOMAINE: Record<Domain, string> = {
  safety: "Sécurité",
  health: "Santé",
  security: "Sûreté",
  environment: "Environnement",
  quality: "Qualité",
};

/** Type d'événement et son domaine par défaut (déduit à la déclaration). */
export const TYPE_EVENEMENT: Record<EventType, { label: string; domaine: Domain }> = {
  work_accident: { label: "Accident du travail", domaine: "safety" },
  road_accident: { label: "Accident de la route", domaine: "safety" },
  near_miss: { label: "Presque-accident", domaine: "safety" },
  hazard: { label: "Situation dangereuse", domaine: "safety" },
  spill: { label: "Déversement", domaine: "environment" },
  fire: { label: "Incendie, départ de feu", domaine: "safety" },
  security_breach: { label: "Atteinte à la sûreté", domaine: "security" },
  product_quality: { label: "Manquant ou contamination", domaine: "quality" },
  property_damage: { label: "Dommage matériel", domaine: "safety" },
};

export const STATUT_EVENEMENT: Record<EventStatus, string> = {
  reported: "Déclaré",
  classified: "Classé",
  investigation: "En enquête",
  actions: "Actions en cours",
  closed: "Clôturé",
};

/** Étapes du cycle, dans l'ordre (frise de la fiche). */
export const CYCLE_EVENEMENT: readonly EventStatus[] = ["reported", "classified", "investigation", "actions", "closed"];

export const ROLE_PERSONNE: Record<PersonRole, string> = {
  victim: "Victime",
  driver: "Conducteur",
  witness: "Témoin",
  perpetrator: "Auteur présumé",
  third_party: "Tiers",
};

export const METHODE_ENQUETE: Record<InvestigationMethod, string> = {
  simple_analysis: "Analyse simple",
  five_whys: "5 Pourquoi",
  cause_tree: "Arbre des causes",
};

export const FACTEUR_5M: Record<Factor5M, string> = {
  environment: "Milieu",
  equipment: "Matériel",
  method: "Méthode",
  manpower: "Main-d'œuvre",
  material: "Matière",
};

export const NATURE_COUT: Record<CostKind, string> = {
  claim: "Sinistre",
  deductible: "Franchise",
  downtime: "Immobilisation",
  product_loss: "Perte de produit",
  repair: "Réparation",
  other: "Autre coût",
};

export const ORIGINE_ACTION: Record<ActionOrigin, string> = {
  event: "Événement",
  audit: "Audit",
  check: "Contrôle",
  risk: "Risque",
  review: "Revue de direction",
};

/** Hiérarchie des mesures, de la plus forte (élimination) à la plus faible (EPI). */
export const NIVEAU_MAITRISE: Record<ControlLevel, string> = {
  elimination: "Élimination",
  substitution: "Substitution",
  engineering: "Ingénierie",
  administrative: "Mesure administrative",
  ppe: "Équipement de protection",
};

export const STATUT_ACTION: Record<ActionStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  to_verify: "À vérifier",
  closed: "Close",
  cancelled: "Annulée",
};

export const NATURE_CONTROLE: Record<CheckKind, string> = {
  pre_departure: "Contrôle avant départ",
  unloading: "Dépotage",
  mine_site: "Site minier",
};

export const RESULTAT_CONTROLE: Record<CheckResult, string> = {
  compliant: "Conforme",
  non_compliant: "Avec réserves",
  blocking: "Bloquant",
};

export const REPONSE_POINT: Record<CheckAnswerValue, string> = {
  ok: "Conforme",
  not_ok: "Non conforme",
  na: "Sans objet",
};

export const STATUT_NON_CONFORMITE: Record<NonconformityStatus, string> = { open: "Ouverte", lifted: "Levée" };

/** Statut d'un alcootest, lu par exploitation, direction et admin ; le conducteur ne lit que « Fait » ou « Non fait » (§9.4). */
export const STATUT_ALCOOTEST: Record<BreathTestStatusValue, string> = {
  compliant: "Conforme",
  non_compliant: "Non conforme",
  not_done: "Non réalisé",
};

/** Lecture du conducteur : test fait ou non, sans résultat. */
export const ALCOOTEST_FAIT = { true: "Fait", false: "Non fait" } as const;

export const STATUT_DEROGATION: Record<WaiverStatus, string> = {
  pending_hsseq: "Attente Responsable HSSEQ",
  active: "Active",
  expired: "Expirée",
  refused: "Refusée",
  cancelled: "Annulée",
};

/**
 * Motifs du verrou de départ (§4) : libellé court pour les tableaux, libellé complet, types
 * de véhicule concernés, source, qui lève le motif, dérogeable ou non (V01 et V03 jamais), lot de livraison.
 */
export const MOTIFS: Record<ReasonCode, { court: string; libelle: string; types: VehicleKind[]; source: string; levee: string; derogeable: boolean; lot: 1 | 2 }> = {
  V01: { court: "Contrôle absent", libelle: "Contrôle avant départ non réalisé pour la rotation", types: ["tanker", "tipper"], source: "NIMOVA Terrain", levee: "Réaliser le contrôle", derogeable: false, lot: 1 },
  V02: { court: "Point critique", libelle: "Point critique du contrôle avant départ non conforme", types: ["tanker", "tipper"], source: "NIMOVA Terrain", levee: "Chef de parc après correction, photo obligatoire", derogeable: true, lot: 1 },
  V03: { court: "Alcootest", libelle: "Alcootest non réalisé ou positif", types: ["tanker", "tipper"], source: "NIMOVA Terrain", levee: "Responsable HSSEQ ; positif : conducteur retiré de la rotation", derogeable: false, lot: 1 },
  V04: { court: "Habilitation", libelle: "Habilitation obligatoire expirée ou aptitude médicale « inapte »", types: ["tanker", "tipper"], source: "Habilitations (RH)", levee: "Changer de conducteur", derogeable: true, lot: 1 },
  V05: { court: "Document véhicule", libelle: "Document du véhicule expiré (assurance, visite technique)", types: ["tanker", "tipper"], source: "Transport, fiche véhicule", levee: "Responsable maintenance", derogeable: true, lot: 1 },
  V06: { court: "Barémage, étanchéité", libelle: "Barémage ou certificat d'étanchéité de la citerne expiré", types: ["tanker"], source: "Transport, fiche véhicule", levee: "Responsable maintenance", derogeable: true, lot: 2 },
  V07: { court: "Surcharge", libelle: "Charge déclarée supérieure à la charge utile autorisée", types: ["tipper"], source: "Transport, ticket de pesée", levee: "Chef de parc après délestage", derogeable: true, lot: 2 },
  V08: { court: "Trajet", libelle: "Plan de trajet absent, circulation de nuit interdite ou temps de conduite dépassé", types: ["tanker", "tipper"], source: "Transport, rotation", levee: "Responsable exploitation", derogeable: true, lot: 2 },
  V09: { court: "Immobilisation", libelle: "Véhicule immobilisé par un événement en cours d'enquête", types: ["tanker", "tipper"], source: "Événements", levee: "Responsable HSSEQ", derogeable: true, lot: 2 },
};

/** Code d'un motif dans un tampon : alerte, ou à surveiller quand une dérogation active le couvre. */
export function MotifCode({ code, couvert }: { code: ReasonCode; couvert?: boolean }) {
  return (
    <span title={`${MOTIFS[code].libelle}${couvert ? " (sous dérogation)" : ""}`}>
      <Badge tone={couvert ? "warn" : "danger"}>{code}</Badge>
      <span className="sr-only">{` : ${MOTIFS[code].libelle}${couvert ? ", sous dérogation" : ""}`}</span>
    </span>
  );
}

/* ─── Références ──────────────────────────────────────────────────────── */

/** Rotation lisible : son numéro, ou sa date de chargement tant qu'elle n'est pas validée. */
export function nomRotation(r: RotationRef | null | undefined): string {
  if (!r) return "–";
  return r.name ?? `Rotation du ${fmtDate(r.date_loading)}`;
}

/** Véhicule et son profil : « ER-06 · Citerne ». */
export function nomVehicule(v: VehicleRef | null | undefined): string {
  return v ? `${v.name} · ${TYPE_VEHICULE[v.vehicle_kind]}` : "–";
}

/* ─── Indicateurs du cockpit (§10) ────────────────────────────────────── */

/** Libellés courts des indicateurs, quand le libellé du noyau n'est pas encore chargé. */
export const INDICATEUR: Record<IndicatorCode, string> = {
  frequency_rate: "Taux de fréquence",
  severity_rate: "Taux de gravité",
  road_accidents_per_mkm: "Accidents de la route par million de km",
  reporting_ratio: "Taux de déclaration",
  check_completion: "Contrôles avant départ réalisés",
  check_compliance: "Conformité des contrôles",
  breath_test_completion: "Alcootests réalisés",
  breath_test_positives: "Alcootests positifs",
  waivers: "Dérogations au verrou",
  actions_on_time: "Actions dans les délais",
  actions_effectiveness: "Efficacité des actions",
  qualifications_valid: "Habilitations à jour",
  fuel_consumption: "Consommation",
  co2_emissions: "Émissions de CO₂",
  tanker_shortage: "Écarts de livraison, citernes",
  tipper_variance: "Écarts de tonnage, bennes",
};

const SUFFIXE: Record<IndicatorUnit, string> = {
  rate: "",
  ratio: "",
  pct: "",
  count: "",
  per_mille: `${INSECABLE}‰`,
  l_100km: `${INSECABLE}L/100${INSECABLE}km`,
  kg_co2_km: `${INSECABLE}kg${INSECABLE}CO₂/km`,
};

/**
 * Valeur d'un indicateur dans son unité : TF et TG à deux décimales, ratio à deux décimales (règle
 * commune), pourcentages à une décimale, ‰ à deux décimales, consommation à une décimale.
 */
export function fmtIndicateur(valeur: number | null | undefined, unite: IndicatorUnit): string {
  if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) return "–";
  switch (unite) {
    case "rate":
      return fmtFixe(valeur, 2);
    case "ratio":
      return fmtRatio(valeur);
    case "pct":
      return fmtPct(valeur, 1);
    case "count":
      return fmtInt(valeur);
    case "per_mille":
      return `${fmtFixe(valeur, 2)}${SUFFIXE.per_mille}`;
    case "l_100km":
      return `${fmtFixe(valeur, 1)}${SUFFIXE.l_100km}`;
    case "kg_co2_km":
      return `${fmtFixe(valeur, 2)}${SUFFIXE.kg_co2_km}`;
  }
}

/** Cible écrite avec son sens : « ≤ 2,00 », « ≥ 95,0 % » ; « 0 » et « 100,0 % » sans signe. */
export function fmtCible(cible: number | null | undefined, unite: IndicatorUnit, sens: "up" | "down"): string {
  if (cible === null || cible === undefined) return "Sans cible";
  const v = fmtIndicateur(cible, unite);
  if ((unite === "count" && cible === 0) || (unite === "pct" && cible === 100)) return v;
  return `${sens === "down" ? "≤" : "≥"}${INSECABLE}${v}`;
}

/** Ton d'un indicateur au regard de sa cible : favorable, en écart, ou neutre sans cible. */
export function tonIndicateur(atteint: boolean | null | undefined): TonEtat {
  return atteint === true ? "ok" : atteint === false ? "danger" : "neutral";
}

/* ─── Tampon de criticité ─────────────────────────────────────────────── */

/**
 * Criticité dans un tampon : repère de couleur du niveau, libellé et note (« Significative · 12 »),
 * ou la note seule en `compact`. Sans note (événement non classé) : « Non classé ». Avec les deux
 * notes, le calcul (gravité × probabilité) passe en infobulle et au lecteur d'écran.
 */
export function Criticite({ gravite, probabilite, note, compact }: { gravite?: number | null; probabilite?: number | null; note?: number | null; compact?: boolean }) {
  const valeur = note ?? criticite(gravite, probabilite);
  const niveau = niveauCriticite(valeur);
  if (!niveau || valeur === null) return <Tampon mot="Non classé" />;
  const n = NIVEAUX[niveau];
  const calcul = gravite && probabilite ? `gravité ${gravite} × probabilité ${probabilite}` : null;
  return (
    <span title={calcul ? `Criticité ${valeur} : ${calcul}` : `Criticité ${valeur}`} className="inline-flex">
      <Badge tone={tonHsseq(n.label)}>
        <span aria-hidden className="mr-1.5 inline-block h-2 w-2 flex-none rounded-[2px]" style={{ background: n.couleur }} />
        {compact ? null : n.label}
        <span className={cx("tabular", !compact && "ml-1 opacity-80")}>{compact ? valeur : `·${INSECABLE}${valeur}`}</span>
        <span className="sr-only">{`${compact ? `, ${n.label}` : ""}${calcul ? `, ${calcul}` : ""}`}</span>
      </Badge>
    </span>
  );
}

/* ─── Matrice 5 × 5 ───────────────────────────────────────────────────── */

export interface CelluleMatrice {
  gravite: Score;
  probabilite: Score;
  nombre: number;
}

/**
 * Matrice de criticité 5 × 5 compacte : probabilité en ordonnée (5 en haut), gravité en abscisse.
 * Chaque case prend la couleur de son niveau ; `cellules` y écrit un nombre (événements, risques),
 * `valeur` marque une case (fiche d'un événement) et `onChoisir` rend les cases cliquables (classement).
 */
export function MatriceCriticite({
  label,
  cellules,
  valeur,
  onChoisir,
  taille = "compacte",
  legende = true,
}: {
  label: string;
  cellules?: CelluleMatrice[];
  valeur?: { gravite: number; probabilite: number } | null;
  onChoisir?: (gravite: Score, probabilite: Score) => void;
  taille?: "compacte" | "normale";
  legende?: boolean;
}) {
  const nombres = new Map((cellules ?? []).map((c) => [`${c.gravite}|${c.probabilite}`, c.nombre]));
  const max = Math.max(1, ...nombres.values());
  const cote = taille === "compacte" ? "1.75rem" : "2.5rem";
  const grille: CSSProperties = { gridTemplateColumns: `auto repeat(5, ${cote})`, gridAutoRows: cote };
  return (
    <figure className="m-0 inline-flex flex-col gap-2">
      <div className="flex items-stretch gap-1.5">
        <span aria-hidden className="flex rotate-180 items-center text-[10.5px] font-semibold text-muted [writing-mode:vertical-rl]">
          Probabilité
        </span>
        <div>
          <div role="group" aria-label={label} className="grid gap-[3px]" style={grille}>
            {[...NOTES].reverse().map((p) => (
              <Ligne key={p} probabilite={p} nombres={nombres} max={max} valeur={valeur} onChoisir={onChoisir} compacte={taille === "compacte"} />
            ))}
            <span aria-hidden />
            {NOTES.map((g) => (
              <span key={g} aria-hidden className="grid place-items-center text-[10.5px] font-medium text-muted tabular">
                {g}
              </span>
            ))}
          </div>
          <p aria-hidden className="m-0 mt-0.5 pl-4 text-center text-[10.5px] font-semibold text-muted">
            Gravité
          </p>
        </div>
      </div>
      {legende && (
        <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-2">
          {ORDRE_NIVEAUX.map((n) => (
            <span key={n} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ background: NIVEAUX[n].couleur }} />
              {NIVEAUX[n].label}
              <span className="text-muted tabular">{`${NIVEAUX[n].min}–${NIVEAUX[n].max}`}</span>
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

function Ligne({
  probabilite,
  nombres,
  max,
  valeur,
  onChoisir,
  compacte,
}: {
  probabilite: Score;
  nombres: Map<string, number>;
  max: number;
  valeur?: { gravite: number; probabilite: number } | null;
  onChoisir?: (gravite: Score, probabilite: Score) => void;
  compacte: boolean;
}) {
  return (
    <>
      <span aria-hidden className="grid place-items-center pr-1 text-[10.5px] font-medium text-muted tabular">
        {probabilite}
      </span>
      {NOTES.map((g) => {
        const note = g * probabilite;
        const n = NIVEAUX[niveauCriticite(note) ?? "low"];
        const nombre = nombres.get(`${g}|${probabilite}`) ?? 0;
        const choisie = valeur?.gravite === g && valeur?.probabilite === probabilite;
        // Case vide : teinte légère ; case comptée : teinte d'autant plus soutenue qu'elle compte.
        const part = nombre > 0 ? 38 + Math.round((nombre / max) * 42) : 16;
        const style: CSSProperties = {
          background: choisie ? n.couleur : `color-mix(in oklab, ${n.couleur} ${part}%, var(--panel))`,
          color: choisie ? "#ffffff" : "var(--ink)",
          boxShadow: choisie ? "0 0 0 2px var(--panel), 0 0 0 3.5px var(--ink)" : undefined,
        };
        const texte = nombre > 0 ? String(nombre) : compacte ? "" : String(note);
        const nom = `Gravité ${g}, probabilité ${probabilite} : criticité ${note}, ${n.label.toLocaleLowerCase("fr")}${nombre > 0 ? `, ${nombre}` : ""}${choisie ? ", retenue" : ""}`;
        const classes = cx("grid place-items-center rounded-[5px] text-[11px] tabular", nombre > 0 ? "font-bold" : "font-medium opacity-90");
        return onChoisir ? (
          <button key={g} type="button" aria-label={nom} aria-pressed={choisie} title={nom} onClick={() => onChoisir(g, probabilite)} className={cx(classes, "cursor-pointer outline-offset-2 transition-transform hover:scale-[1.06] focus-visible:outline-2")} style={style}>
            {texte}
          </button>
        ) : (
          <span key={g} role="img" aria-label={nom} title={nom} className={classes} style={style}>
            {texte}
          </span>
        );
      })}
    </>
  );
}
