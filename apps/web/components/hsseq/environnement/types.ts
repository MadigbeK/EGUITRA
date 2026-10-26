/**
 * Types de l'environnement et de la qualité de NIMOVA · HSSEQ (lot 3), alignés sur le code du noyau
 * (addons/eguitra_hsseq, controllers/environment.py et models/environment.py, branche hsseq). Clés et
 * valeurs en anglais snake_case, listes, droits et erreurs aux conventions du lot 1 (§1 et §2 de
 * docs/design/hsseq-contrat.md) ; les mots affichés sont dans ./commun.tsx.
 */

import type { ActionLine, Attachment, Ref, Referentials, Rights, RotationRef, VehicleKind, VehicleRef } from "@/lib/hsseq-types";

/* ─── Valeurs ─────────────────────────────────────────────────────────── */

/** Déversement en cours de traitement, ou clos par hsseq une fois la récupération décrite. */
export type SpillStatus = "open" | "closed";
export type SpillTransition = "close" | "reopen";

/** Huiles usagées, pneus, filtres, autres déchets (précision obligatoire). */
export type WasteKind = "used_oil" | "tyres" | "filters" | "other";
/** Litres, kilogrammes, tonnes, pièces ; proposée selon la nature (WASTE_DEFAULT_UNIT). */
export type WasteUnit = "l" | "kg" | "t" | "unit";
/** Entreposé sur le site, ou enlevé par un prestataire avec son bordereau. */
export type WasteStatus = "stored" | "collected";
export type WasteTransition = "collect" | "reopen";

export type DustUnit = "mg_m3" | "ug_m3";

export type ContaminationNature = "water" | "mixing" | "impurities" | "off_spec" | "other";
export type ContaminationStatus = "open" | "closed";
export type ContaminationTransition = "close" | "reopen";

export type ComplaintNature = "shortage" | "quality" | "delay" | "damage" | "behaviour" | "documents" | "other";
export type ComplaintSeverity = "minor" | "major" | "critical";
/** Reçue, répondue au client (la réponse se complète), close quand ses actions le sont. */
export type ComplaintStatus = "received" | "answered" | "closed";
export type ComplaintTransition = "answer" | "close" | "reopen";

/** Regroupement des analyses calculées depuis Transport (ANALYSIS_GROUPS). */
export type AnalysisGroup = "vehicle" | "site" | "month" | "rotation";

/* ─── Communs ─────────────────────────────────────────────────────────── */

/**
 * Auteur d'une écriture (ligne de journal, pièce déposée) : le compte et son nom ; pour l'auditeur, sa
 * seule fonction (« Responsable HSSEQ », « Chef de parc »…, à défaut « Utilisateur interne »), id et nom
 * nuls (actor_ref du noyau).
 */
export interface Auteur {
  id: number | null;
  name: string | null;
  function?: string;
}

/**
 * Pièce d'une fiche de l'écran, à la forme commune des pièces, son déposant servi comme un auteur. Son
 * `model` vaut spill, waste, contamination ou complaint (AttachmentModel de lib/hsseq-types.ts ne les
 * nomme pas encore) ; le noyau pose le rôle « document » sur un déchet (bordereau) et une réclamation,
 * « photo » ailleurs.
 */
export type Piece = Omit<Attachment, "created_by"> & { created_by: Auteur | null };

/** Fiche d'une pièce de cet écran (champ `model` de POST /hsseq/attachments). */
export type ObjetPiece = "spill" | "waste" | "contamination" | "complaint";

/** Ligne du journal d'une fiche, du plus récent au plus ancien (ordre du journal du noyau). */
export interface LigneJournal {
  id: number;
  model: string;
  res_id: number;
  at: string;
  /** Auteur de l'écriture ; pour l'auditeur, sa seule fonction. Nul : écriture du système. */
  by: Auteur | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

/** Événement lié : du domaine environnement pour un déversement, qualité pour une contamination. */
export interface EventRef {
  id: number;
  reference: string;
}

/**
 * Référentiels HSSEQ tels que l'écran les lit : la liste des clients (lot 2) peut manquer, la maquette
 * d'API ne la sert pas encore.
 */
export type ReferentielsEnvironnement = Referentials & {
  /** Clients des sociétés (administration, direction, hsseq) ; vide pour les autres profils. */
  clients?: Ref[];
};

/* ─── Déversements ────────────────────────────────────────────────────── */

/** Ligne de GET /hsseq/spills. */
export interface SpillLine {
  id: number;
  /** « DEV/2026/0007 ». */
  reference: string;
  /** Horodatage ISO 8601, UTC. */
  occurred_at: string;
  /** Nul : siège ou lieu hors site, lu des seuls profils de lecture complète. */
  site: Ref | null;
  location: string | null;
  event: EventRef | null;
  rotation: RotationRef | null;
  vehicle: VehicleRef | null;
  /** Produit de Transport, sinon `product_label` (huile, liquide de refroidissement, eaux souillées…). */
  product: Ref | null;
  product_label: string | null;
  volume_liters: number;
  recovered_liters: number;
  /** Part récupérée, en pourcentage à une décimale. */
  recovery_rate: number;
  cost: number;
  status: SpillStatus;
  /** can_edit : déversement en cours, hsseq ou chef de parc du site ; can_close : clôture permise (hsseq). */
  rights: Rights;
}

/** Fiche d'un déversement (GET /hsseq/spills/{id}) ; chaque écriture renvoie la même. */
export interface Spill extends SpillLine {
  company: Ref;
  /** Récupération et confinement : obligatoire pour clore (recovery_required). */
  recovery: string | null;
  /** Nul pour l'auditeur. */
  reported_by: Ref | null;
  closed_at: string | null;
  closed_by: Ref | null;
  reopen_reason: string | null;
  attachments: Piece[];
  history: LigneJournal[];
  transitions: SpillTransition[];
}

/** Comptes de la sélection filtrée (statut compris). */
export interface SpillCounts {
  by_status: Record<SpillStatus, number>;
  volume_liters: number;
  recovered_liters: number;
}

/** Corps de POST /hsseq/spills (occurred_at et volume_liters obligatoires) et de PATCH /hsseq/spills/{id}. */
export interface SpillInput {
  occurred_at?: string;
  site_id?: number | null;
  location?: string | null;
  product_label?: string | null;
  volume_liters?: number;
  recovered_liters?: number;
  recovery?: string | null;
  cost?: number;
  rotation_id?: number | null;
  vehicle_id?: number | null;
  event_id?: number | null;
}

/* ─── Déchets ─────────────────────────────────────────────────────────── */

/** Ligne de GET /hsseq/wastes. */
export interface WasteLine {
  id: number;
  /** « DEC/2026/0005 ». */
  reference: string;
  site: Ref | null;
  waste_kind: WasteKind;
  /** Précision : obligatoire pour un autre déchet. */
  description: string | null;
  quantity: number;
  unit: WasteUnit;
  produced_on: string;
  status: WasteStatus;
  pickup_date: string | null;
  /** Fiche tiers du prestataire, ou son seul nom (id nul). */
  provider: { id: number | null; name: string } | null;
  manifest_reference: string | null;
  /** Bordereau joint (pièce de rôle « document ») : l'enlèvement ne s'enregistre pas sans lui. */
  manifest_attached: boolean;
  /** can_edit : déchet entreposé, hsseq ou chef de parc du site ; can_close : enlèvement permis. */
  rights: Rights;
}

export interface Waste extends WasteLine {
  company: Ref;
  note: string | null;
  collected_by: Ref | null;
  reopen_reason: string | null;
  attachments: Piece[];
  history: LigneJournal[];
  transitions: WasteTransition[];
}

export interface WasteCounts {
  by_status: Record<WasteStatus, number>;
  /** Quantités entreposées de la sélection, par nature et par unité. */
  stored_quantities: Array<{ waste_kind: WasteKind; unit: WasteUnit; quantity: number }>;
}

/** Corps de POST /hsseq/wastes (waste_kind et quantity obligatoires) et de PATCH /hsseq/wastes/{id}. */
export interface WasteInput {
  site_id?: number | null;
  waste_kind?: WasteKind;
  description?: string | null;
  quantity?: number;
  unit?: WasteUnit;
  produced_on?: string;
  provider_name?: string | null;
  manifest_reference?: string | null;
  note?: string | null;
}

/** Corps de POST /hsseq/wastes/{id}/collect : prestataire et numéro obligatoires, bordereau joint avant. */
export interface CollectInput {
  pickup_date: string;
  manifest_reference: string;
  provider_name?: string | null;
  provider_id?: number | null;
}

/* ─── Poussières ──────────────────────────────────────────────────────── */

/** Mesure de poussières (ligne de GET /hsseq/dust-measurements, réponse de la saisie et de la modification). */
export interface DustMeasure {
  id: number;
  site: Ref;
  measured_on: string;
  point: string | null;
  value: number;
  unit: DustUnit;
  /** Seuil, dans l'unité de la mesure. */
  threshold: number;
  /** Valeur au-dessus du seuil, calculé par le noyau. */
  exceeded: boolean;
  method: string | null;
  note: string | null;
  /** Nul pour l'auditeur. */
  measured_by: Ref | null;
  /** can_edit : hsseq, ou chef de parc du site. */
  rights: Rights;
}

/** Fiche d'une mesure (GET /hsseq/dust-measurements/{id}) : la ligne, sa société et son historique. */
export interface DustMeasureDetail extends DustMeasure {
  company: Ref;
  history: LigneJournal[];
}

export interface DustCounts {
  exceeded: number;
}

/** Corps de POST /hsseq/dust-measurements (site_id, value, threshold obligatoires) et de PATCH. */
export interface DustInput {
  site_id?: number;
  measured_on?: string;
  point?: string | null;
  value?: number;
  unit?: DustUnit;
  threshold?: number;
  method?: string | null;
  note?: string | null;
}

/* ─── Contaminations ──────────────────────────────────────────────────── */

/** Ligne de GET /hsseq/contaminations. */
export interface ContaminationLine {
  id: number;
  /** « CTM/2026/0003 ». */
  reference: string;
  detected_on: string;
  nature: ContaminationNature;
  rotation: RotationRef | null;
  vehicle: VehicleRef | null;
  site: Ref | null;
  /** Produit de la rotation, repris à la saisie. */
  product: Ref | null;
  volume_m3: number | null;
  /** Constat. */
  description: string;
  status: ContaminationStatus;
  /** can_edit : hsseq, contamination ouverte ; can_close : clôture permise. */
  rights: Rights;
}

export interface Contamination extends ContaminationLine {
  company: Ref;
  /** Mesures prises : obligatoires pour clore (measures_required). */
  measures: string | null;
  cost: number;
  event: EventRef | null;
  closed_at: string | null;
  reopen_reason: string | null;
  attachments: Piece[];
  history: LigneJournal[];
  transitions: ContaminationTransition[];
}

export interface ContaminationCounts {
  by_status: Record<ContaminationStatus, number>;
}

/** Corps de POST /hsseq/contaminations (nature et description obligatoires) et de PATCH. */
export interface ContaminationInput {
  nature?: ContaminationNature;
  description?: string;
  detected_on?: string;
  rotation_id?: number | null;
  vehicle_id?: number | null;
  site_id?: number | null;
  volume_m3?: number;
  cost?: number;
  measures?: string | null;
  event_id?: number | null;
}

/* ─── Réclamations ────────────────────────────────────────────────────── */

/** Ligne de GET /hsseq/complaints. */
export interface ComplaintLine {
  id: number;
  /** « REC/2026/0004 ». */
  reference: string;
  partner: Ref;
  rotation: RotationRef | null;
  site: Ref | null;
  received_on: string;
  nature: ComplaintNature;
  severity: ComplaintSeverity;
  /** La réclamation du client. */
  description: string;
  /** Réception plus le délai des paramètres de la société (15 jours par défaut), modifiable. */
  response_due: string | null;
  responded_on: string | null;
  /** Délai de réponse en jours, nul tant que la réclamation n'est pas répondue. */
  response_days: number | null;
  on_time: boolean | null;
  /** Reçue, et réponse attendue avant aujourd'hui. */
  overdue: boolean;
  status: ComplaintStatus;
  /** Actions ni closes ni annulées : elles retiennent la clôture. */
  open_actions: number;
  /** can_edit : hsseq, réclamation non close ; can_close : clôture permise (répondue, sans action ouverte). */
  rights: Rights;
}

export interface Complaint extends ComplaintLine {
  company: Ref;
  response: string | null;
  responded_by: Ref | null;
  vehicle: VehicleRef | null;
  /** Actions d'origine « complaint », au format du plan d'actions. */
  actions: ActionLine[];
  closed_at: string | null;
  reopen_reason: string | null;
  attachments: Piece[];
  history: LigneJournal[];
  transitions: ComplaintTransition[];
}

export interface ComplaintCounts {
  by_status: Record<ComplaintStatus, number>;
  overdue: number;
}

/**
 * Corps de POST /hsseq/complaints (nature, description, et client ou rotation obligatoires ; le client
 * de la rotation à défaut) et de PATCH /hsseq/complaints/{id} (response_due en modification seulement).
 */
export interface ComplaintInput {
  partner_id?: number | null;
  rotation_id?: number | null;
  vehicle_id?: number | null;
  site_id?: number | null;
  nature?: ComplaintNature;
  severity?: ComplaintSeverity;
  description?: string;
  received_on?: string;
  response_due?: string | null;
}

/** Corps de POST /hsseq/complaints/{id}/answer : la réponse est obligatoire, datée au plus d'aujourd'hui. */
export interface AnswerInput {
  response: string;
  responded_on?: string;
}

/* ─── Analyses depuis Transport ───────────────────────────────────────── */

/** Consommation d'un regroupement : litres aux 100 km et kg de CO₂ par km sur les km au carburant saisi. */
export interface ConsumptionRow {
  rotations: number;
  /** Kilomètres de toutes les rotations parties. */
  km: number;
  fuel_liters: number;
  /** Kilomètres des seules rotations dont le carburant est saisi : la base des ratios. */
  fuel_km: number;
  co2_kg: number;
  l_100km: number | null;
  co2_kg_per_km: number | null;
}

/** Clé : identifiant de l'ensemble, du site (0 sans site) ou de la rotation, ou mois « AAAA-MM ». */
export interface ConsumptionItem extends ConsumptionRow {
  key: number | string;
  label: string;
}

/** Réponse de GET /hsseq/environment/consumption. */
export interface Consumption {
  group_by: AnalysisGroup;
  items: ConsumptionItem[];
  totals: ConsumptionRow;
  /** Facteur d'émission de chaque société (kg de CO₂ par litre, paramètres). */
  factors: Array<{ company_id: number; company: string; co2_factor: number }>;
  date_from: string;
  date_to: string;
  vehicle_kind: VehicleKind | null;
  source: string;
}

/** Citernes : volumes en m³ ; manquant ÷ livré, les deux à 15 °C, en ‰. */
export interface TankerRow {
  rotations: number;
  loaded_15: number;
  delivered_15: number;
  /** Livré non corrigé (à la température de livraison). */
  delivered: number;
  /** Manquant à 15 °C : chargé moins livré, corrigés, jamais négatif par rotation. */
  shortage: number;
  /** Manquant à 15 °C ÷ livré à 15 °C. */
  per_mille: number | null;
}

/** Bennes : tonnages ; écart ÷ chargé, en ‰. */
export interface TipperRow {
  rotations: number;
  loaded_t: number;
  delivered_t: number;
  variance_t: number;
  per_mille: number | null;
}

/** Réponse de GET /hsseq/environment/deliveries. */
export interface Deliveries {
  group_by: AnalysisGroup;
  tanker: { items: Array<TankerRow & { key: number | string; label: string }>; totals: TankerRow };
  tipper: { items: Array<TipperRow & { key: number | string; label: string }>; totals: TipperRow };
  date_from: string;
  date_to: string;
  vehicle_kind: VehicleKind | null;
  source: string;
}
