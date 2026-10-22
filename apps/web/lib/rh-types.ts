/**
 * NIMOVA · RH : contrat entre l'API du noyau (addons/eguitra_rh, routes /api/v1/rh/...) et les écrans.
 * Montants en GNF entiers, dates au format AAAA-MM-JJ, mois au format AAAA-MM-01.
 * Spécification des routes : docs/projet/rh/specification.md.
 *
 * Gestion commune aux deux sociétés (décision du gérant, 22 octobre 2026), comme la finance : un seul
 * service RH voit et gère le personnel des sociétés auxquelles son compte est ouvert, dans les mêmes
 * listes. Chaque société reste l'employeur légal (paie, CNSS, impôts et comptabilité séparés). Les
 * listes acceptent un filtre facultatif `company_id` ; sans lui, elles couvrent toutes ces sociétés.
 */

export type Ref = { id: number; name: string };

/** Société employeur (entity : groupe = EGUITRA GROUP, cabinet = MB AxisPro Consulting). */
export type CompanyRef = { id: number; name: string; entity: "groupe" | "cabinet" | null };

export type Gender = "homme" | "femme";
export type MaritalStatus = "celibataire" | "marie" | "divorce" | "veuf";
export type Category = "cadre" | "maitrise" | "employe" | "ouvrier";
export type ContractType = "cdi" | "cdd" | "stage" | "apprentissage";
export type PaymentMethod = "virement" | "especes" | "mobile";
export type ExitReason = "demission" | "licenciement" | "fin_contrat" | "rupture_conventionnelle" | "retraite" | "deces" | "autre";
/** a_venir : embauche future ; essai : période d'essai en cours ; actif ; sorti : date de sortie passée. */
export type EmployeeState = "a_venir" | "essai" | "actif" | "sorti";
export type DocumentKind = "cni" | "passeport" | "contrat" | "avenant" | "diplome" | "visite_medicale" | "permis" | "titre_sejour" | "autre";
export type LeaveState = "submitted" | "approved" | "refused" | "cancelled";
export type PayrollState = "draft" | "validated" | "accounted";
export type RubricKind = "gain" | "deduction";
/** amount : montant saisi ; hours : heures saisies, payées au taux horaire majoré de overtime_rate %. */
export type RubricInput = "amount" | "hours";
export type InputSource = "manual" | "fixed" | "leave" | "advance" | "rotation";
export type AdvanceKind = "avance" | "pret";
export type AdvanceState = "open" | "done" | "cancelled";
export type AlertSeverity = "danger" | "warn" | "info";

/** Libellés (fournis aussi par GET /rh/meta, pour l'affichage hors ligne des listes). */
export const CONTRACT_LABELS: Record<ContractType, string> = { cdi: "CDI", cdd: "CDD", stage: "Stage", apprentissage: "Apprentissage" };
export const STATE_LABELS: Record<EmployeeState, string> = { a_venir: "À venir", essai: "Période d'essai", actif: "Actif", sorti: "Sorti" };
export const LEAVE_STATE_LABELS: Record<LeaveState, string> = { submitted: "À valider", approved: "Approuvée", refused: "Refusée", cancelled: "Annulée" };
export const PAYROLL_STATE_LABELS: Record<PayrollState, string> = { draft: "En préparation", validated: "Validée", accounted: "Comptabilisée" };

/* ─── Référentiels : GET /rh/meta ─────────────────────────────────────── */

export interface Option<K extends string = string> { code: K; label: string }

export interface Rubric {
  id: number;
  code: string;
  name: string;
  kind: RubricKind;
  input: RubricInput;
  /** Majoration des heures (30 pour +30 %), rubriques en heures seulement. */
  overtime_rate: number;
  /** Soumise à la CNSS. */
  cnss: boolean;
  /** Soumise à la RTS. */
  taxable: boolean;
  /** Indemnité forfaitaire (logement, transport, panier, cherté de vie) exonérée de RTS dans la limite de 25 % du brut (CGI, art. 55). */
  exempt_allowance: boolean;
  /** Compte de charge (gain) ou de tiers (retenue), code ou racine du plan SYSCOHADA. */
  account_code: string;
  /** Rubrique produite par le moteur (salaire de base, absence, avance, rotation) : non saisissable. */
  system: boolean;
  active: boolean;
}

export interface LeaveType {
  id: number;
  code: string;
  name: string;
  /** Absence rémunérée ; sinon retenue sur salaire au prorata des jours ouvrables. */
  paid: boolean;
  /** Décomptée du solde de congés payés. */
  deducts_balance: boolean;
  needs_document: boolean;
  /** Durée maximale par demande, en jours ouvrables (0 : sans limite). */
  max_days: number;
  active: boolean;
}

/** company null : département commun aux deux sociétés. */
export interface Department { id: number; name: string; company: CompanyRef | null; manager: Ref | null; headcount: number; active: boolean }

export interface Meta {
  /** Sociétés gérées par le compte (employeurs possibles). */
  companies: CompanyRef[];
  /** Société de travail du compte (employeur proposé par défaut à l'embauche). */
  work_company_id: number;
  departments: Department[];
  rubrics: Rubric[];
  leave_types: LeaveType[];
  categories: Option<Category>[];
  contract_types: Option<ContractType>[];
  marital_statuses: Option<MaritalStatus>[];
  payment_methods: Option<PaymentMethod>[];
  exit_reasons: Option<ExitReason>[];
  document_kinds: Option<DocumentKind>[];
  /** Salariés actifs des deux sociétés (choix du responsable hiérarchique, qui peut être de l'autre société). */
  employees: Array<Ref & { matricule: string; company_id: number }>;
  /** Comptes NIMOVA internes ; company_ids : sociétés auxquelles chacun est ouvert (un compte se lie à un salarié d'une de ces sociétés). */
  users: Array<Ref & { login: string; company_ids: number[] }>;
  /** Chauffeurs du transport, avec leur société (seulement pour un salarié de cette société). */
  drivers: Array<Ref & { company_id: number }>;
  /** Comptes analytiques de l'axe « Activité » ; company_id null : commun aux deux sociétés. */
  activities: Array<Ref & { company_id: number | null }>;
  /** Le compte peut-il écrire (profil administration ou RH) ? La direction lit et approuve. */
  can_write: boolean;
}

/* ─── Salariés : GET /rh/employees, GET /rh/employees/<id> ────────────── */

export interface EmployeeRow {
  id: number;
  matricule: string;
  name: string;
  /** Employeur. */
  company: CompanyRef;
  job_title: string | null;
  department: Ref | null;
  manager: Ref | null;
  category: Category | null;
  contract_type: ContractType;
  hire_date: string;
  contract_end: string | null;
  trial_end: string | null;
  exit_date: string | null;
  state: EmployeeState;
  base_salary: number;
  /** Salaire de base et éléments fixes, par mois. */
  monthly_gross: number;
  seniority_years: number;
  leave_balance: number;
  phone: string | null;
  email: string | null;
  /** Absent aujourd'hui (absence approuvée en cours). */
  absent_today: boolean;
  /** Points à compléter : numéro CNSS, compte bancaire, axe d'activité, etc. */
  issues: string[];
}

export interface FixedLine { id: number; rubric: Ref & { code: string; input: RubricInput }; amount: number; quantity: number }

export interface EmployeeDocument { id: number; kind: DocumentKind; name: string; expiry_date: string | null; has_file: boolean; expired: boolean; expires_soon: boolean }

export interface SalaryChange { id: number; date: string; old_salary: number; new_salary: number; reason: string | null; user: string }

export interface LeaveBalance {
  /** Solde de reprise et sa date. */
  initial: number;
  initial_date: string | null;
  /** Jours acquis depuis la date de reprise (ou l'embauche), au rythme de settings.leave_days_per_month. */
  acquired: number;
  /** Jours de congé annuel approuvés depuis cette date. */
  taken: number;
  /** Jours demandés en attente de validation. */
  pending: number;
  balance: number;
}

export interface Employee extends EmployeeRow {
  gender: Gender | null;
  birth_date: string | null;
  birth_place: string | null;
  nationality: string | null;
  id_number: string | null;
  cnss_number: string | null;
  marital_status: MaritalStatus | null;
  children: number;
  address: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  activity: Ref | null;
  payment_method: PaymentMethod;
  bank_name: string | null;
  bank_account: string | null;
  mobile_money: string | null;
  user: (Ref & { login: string }) | null;
  driver: Ref | null;
  leave_initial: number;
  leave_initial_date: string | null;
  exit_reason: ExitReason | null;
  note: string | null;
  age: number | null;
  fixed_lines: FixedLine[];
  documents: EmployeeDocument[];
  salary_history: SalaryChange[];
  balance: LeaveBalance;
  leaves: Leave[];
  payslips: PayslipRow[];
  advances: Advance[];
}

/** Corps de POST /rh/employees et PATCH /rh/employees/<id> (champs partiels en PATCH). */
export interface EmployeeInput {
  name: string;
  /** Employeur, à la création seulement (défaut : société de travail). */
  company_id?: number;
  job_title?: string | null;
  department_id?: number | null;
  manager_id?: number | null;
  category?: Category | null;
  contract_type?: ContractType;
  hire_date: string;
  contract_end?: string | null;
  trial_end?: string | null;
  base_salary?: number;
  /** Remplace les éléments fixes : rubrique et montant (ou heures). */
  fixed_lines?: Array<{ rubric_id: number; amount?: number; quantity?: number }>;
  gender?: Gender | null;
  birth_date?: string | null;
  birth_place?: string | null;
  nationality?: string | null;
  id_number?: string | null;
  cnss_number?: string | null;
  marital_status?: MaritalStatus | null;
  children?: number;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  activity_id?: number | null;
  payment_method?: PaymentMethod;
  bank_name?: string | null;
  bank_account?: string | null;
  mobile_money?: string | null;
  user_id?: number | null;
  driver_id?: number | null;
  leave_initial?: number;
  leave_initial_date?: string | null;
  note?: string | null;
  /** Motif d'un changement du salaire de base (historique). */
  salary_reason?: string | null;
}

/* ─── Absences : GET /rh/leaves, GET /rh/leaves/balances ──────────────── */

export interface Leave {
  id: number;
  name: string;
  employee: Ref & { matricule: string };
  type: Ref & { code: string; paid: boolean; deducts_balance: boolean };
  date_from: string;
  date_to: string;
  half_day: boolean;
  /** Jours ouvrables (lundi au samedi, jours fériés exclus). */
  days: number;
  state: LeaveState;
  note: string | null;
  refusal_reason: string | null;
  requested_by: string | null;
  approver: string | null;
  decided_at: string | null;
  has_document: boolean;
  /** Le compte connecté peut-il trancher (RH, direction, ou responsable hiérarchique) ? */
  can_decide: boolean;
}

export interface BalanceRow { employee: Ref & { matricule: string }; department: Ref | null; balance: LeaveBalance }

/* ─── Avances et prêts : GET /rh/advances ─────────────────────────────── */

export interface Advance {
  id: number;
  employee: Ref & { matricule: string };
  kind: AdvanceKind;
  date: string;
  amount: number;
  installment: number;
  first_month: string;
  reimbursed: number;
  remaining: number;
  state: AdvanceState;
  note: string | null;
}

/* ─── Paie : GET /rh/payrolls, GET /rh/payrolls/<id> ──────────────────── */

export interface PayrollTotals {
  headcount: number;
  gross: number;
  cnss_employee: number;
  cnss_employer: number;
  rts: number;
  vf: number;
  training_tax: number;
  deductions: number;
  net: number;
  employer_cost: number;
}

export interface PayrollRow {
  id: number;
  name: string;
  /** Une paie par société et par mois : chaque société déclare et comptabilise la sienne. */
  company: CompanyRef;
  month: string;
  state: PayrollState;
  totals: PayrollTotals;
  anomalies: number;
  move: { id: number; name: string; state: string } | null;
}

export interface Anomaly { code: string; severity: AlertSeverity; message: string }

export interface PayslipRow {
  id: number;
  month: string;
  employee: Ref & { matricule: string };
  department: Ref | null;
  worked_days: number;
  month_days: number;
  unpaid_days: number;
  gross: number;
  cnss_employee: number;
  rts: number;
  deductions: number;
  net: number;
  employer_cost: number;
  state: PayrollState;
  anomalies: Anomaly[];
  /** Écart du net avec le mois précédent, en % (null : pas de bulletin le mois précédent). */
  net_variation: number | null;
}

export interface Payroll extends PayrollRow {
  /** POST /rh/payrolls sans company_id prépare le mois pour chaque société : identifiants créés. */
  created?: number[];
  payslips: PayslipRow[];
  /** Répartition de la masse salariale par activité et par département. */
  by_activity: Array<{ name: string; gross: number; employer_cost: number }>;
  by_department: Array<{ name: string; headcount: number; gross: number; employer_cost: number }>;
  validated_by: string | null;
  validated_at: string | null;
  can_write: boolean;
}

export interface PayslipLine {
  code: string;
  name: string;
  kind: "gain" | "deduction" | "employer" | "info";
  base: number | null;
  rate: number | null;
  quantity: number | null;
  amount: number;
}

export interface PayslipInput {
  id: number;
  rubric: Ref & { code: string; input: RubricInput; kind: RubricKind };
  amount: number;
  quantity: number;
  note: string | null;
  source: InputSource;
}

/** Bulletin de paie : GET /rh/payslips/<id> (aussi GET /rh/me/payslips/<id>). */
export interface Payslip extends PayslipRow {
  company: { name: string; address: string | null; nif: string | null; rccm: string | null; cnss_employer: string | null };
  employee_detail: {
    name: string;
    matricule: string;
    job_title: string | null;
    category: string | null;
    contract: string;
    hire_date: string;
    seniority_years: number;
    cnss_number: string | null;
    payment_method: PaymentMethod;
    bank_account: string | null;
  };
  period: { date_from: string; date_to: string; label: string };
  base_salary: number;
  cnss_base: number;
  taxable_base: number;
  rts_base: number;
  cnss_employer: number;
  vf: number;
  training_tax: number;
  lines: PayslipLine[];
  inputs: PayslipInput[];
  leave_balance: number;
  /** Cumuls de l'année civile jusqu'à ce mois (bulletins validés et celui-ci). */
  ytd: { gross: number; cnss_employee: number; rts: number; net: number };
  net_in_words: string;
}

/* ─── Simulateur : POST /rh/simulate ──────────────────────────────────── */

export interface SimulationInput {
  contract_type?: ContractType;
  /** Soit le salaire de base, soit le net cible (le moteur cherche alors le salaire de base). */
  base_salary?: number;
  net_target?: number;
  fixed_lines?: Array<{ rubric_id: number; amount?: number; quantity?: number }>;
}

export interface Simulation {
  base_salary: number;
  gross: number;
  cnss_base: number;
  cnss_employee: number;
  cnss_employer: number;
  taxable_base: number;
  rts_base: number;
  rts: number;
  vf: number;
  training_tax: number;
  net: number;
  employer_cost: number;
  lines: PayslipLine[];
  /** Taux marginal de RTS de la dernière tranche atteinte, en %. */
  marginal_rate: number;
}

/* ─── Paramètres : GET/PATCH /rh/settings ─────────────────────────────── */

export interface TaxBracket { from: number; rate: number }

/**
 * Paramètres : taux, barème, congés, heures, alertes et comptes sont communs aux deux sociétés (une
 * modification s'applique aux deux) ; numéro d'employeur CNSS, taxe de formation et journal sont
 * propres à chaque société (GET/PATCH /rh/settings?company_id=, défaut : société de travail).
 */
export interface Settings {
  company: CompanyRef;
  cnss_employee_rate: number;
  cnss_employer_rate: number;
  cnss_ceiling: number;
  smig: number;
  allowance_exempt_cap: number;
  rts_brackets: TaxBracket[];
  vf_rate: number;
  training_tax_rate: number;
  training_tax_label: string;
  leave_days_per_month: number;
  monthly_hours: number;
  rotation_bonus: number;
  trial_alert_days: number;
  contract_alert_days: number;
  document_alert_days: number;
  cnss_employer_number: string | null;
  accounts: {
    salary: string;
    social_charges: string;
    payroll_taxes: string;
    training_tax: string;
    cnss: string;
    rts: string;
    payroll_taxes_payable: string;
    net_payable: string;
    advances: string;
  };
  journal: Ref | null;
}

export interface Holiday { id: number; date: string; name: string }

/* ─── Tableau de bord : GET /rh/summary ───────────────────────────────── */

export interface RhAlert {
  kind: "trial_end" | "contract_end" | "document" | "leave_balance" | "payroll" | "missing_data" | "birthday" | "anniversary";
  severity: AlertSeverity;
  date: string | null;
  employee: Ref | null;
  message: string;
  /** Lien de l'écran où traiter le point. */
  href: string;
}

export interface Summary {
  /** Sociétés couvertes (toutes celles du compte, ou celle du filtre company_id). */
  companies: CompanyRef[];
  /** Effectif et masse salariale par société. */
  by_company: Array<{ company: CompanyRef; headcount: number; monthly_payroll_estimate: number }>;
  headcount: number;
  headcount_trial: number;
  hires_year: number;
  exits_year: number;
  /** Rotation du personnel sur 12 mois glissants, en %. */
  turnover_rate: number | null;
  average_seniority: number | null;
  average_age: number | null;
  women_share: number | null;
  /** Masse salariale mensuelle théorique (salaires de base et éléments fixes des actifs). */
  monthly_payroll_estimate: number;
  absent_today: Array<{ employee: Ref; type: string; date_to: string }>;
  pending_leaves: number;
  /** Taux d'absence (hors congés payés) sur 30 jours, en %. */
  absenteeism_rate: number | null;
  by_department: Array<{ name: string; headcount: number }>;
  by_contract: Array<{ code: ContractType; label: string; headcount: number }>;
  by_category: Array<{ code: Category | "none"; label: string; headcount: number }>;
  /** 12 derniers mois de paie validée. */
  payroll_trend: Array<{ month: string; gross: number; net: number; employer_cost: number; headcount: number }>;
  upcoming_leaves: Leave[];
  alerts: RhAlert[];
  /** Dernière paie de chaque société. */
  current_payrolls: PayrollRow[];
}

/* ─── Libre-service : GET /rh/me ──────────────────────────────────────── */

export interface MySpace {
  /** null : aucun dossier salarié lié à ce compte. */
  employee: null | {
    id: number;
    name: string;
    matricule: string;
    job_title: string | null;
    department: Ref | null;
    manager: Ref | null;
    company: string;
    hire_date: string;
    seniority_years: number;
    contract_type: ContractType;
    phone: string | null;
    email: string | null;
  };
  balance: LeaveBalance | null;
  leaves: Leave[];
  payslips: Array<{ id: number; month: string; net: number }>;
  leave_types: LeaveType[];
  /** Demandes des collaborateurs directs à trancher. */
  team_pending: Leave[];
  /** Collaborateurs directs absents aujourd'hui ou dans les 14 jours. */
  team_upcoming: Leave[];
  /** Le compte gère-t-il aussi l'espace RH (profil RH, direction, administration) ? */
  manages_rh: boolean;
}
