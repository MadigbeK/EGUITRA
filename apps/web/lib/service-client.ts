/**
 * Service client : types des réponses de l'API (/service-client/…, /espace-client/…) et libellés partagés.
 * Pendant du noyau : addons/eguitra_service_client (models/common.py, controllers/).
 */
import type { Tone } from "@/components/ui";

export type EtatDossier = "new" | "assigned" | "in_progress" | "waiting" | "resolved" | "closed" | "reopened";
export type Canal = "phone" | "visit" | "letter" | "email" | "portal" | "whatsapp";
export type Priorite = "low" | "normal" | "high" | "urgent";
export type TypeDossier = "request" | "complaint" | "information";

export const ETATS: Array<{ value: EtatDossier; label: string; tone: Tone }> = [
  { value: "new", label: "Nouveau", tone: "accent" },
  { value: "assigned", label: "Assigné", tone: "accent" },
  { value: "in_progress", label: "En cours", tone: "accent" },
  { value: "waiting", label: "En attente du client", tone: "warn" },
  { value: "resolved", label: "Résolu", tone: "ok" },
  { value: "closed", label: "Clos", tone: "neutral" },
  { value: "reopened", label: "Rouvert", tone: "danger" },
];
export const CANAUX: Array<{ value: Canal; label: string }> = [
  { value: "phone", label: "Téléphone" },
  { value: "visit", label: "Visite" },
  { value: "letter", label: "Courrier" },
  { value: "email", label: "Courriel" },
  { value: "portal", label: "Espace client" },
  { value: "whatsapp", label: "WhatsApp" },
];
export const PRIORITES: Array<{ value: Priorite; label: string; tone: Tone }> = [
  { value: "low", label: "Basse", tone: "neutral" },
  { value: "normal", label: "Normale", tone: "neutral" },
  { value: "high", label: "Haute", tone: "warn" },
  { value: "urgent", label: "Urgente", tone: "danger" },
];
export const TYPES: Array<{ value: TypeDossier; label: string }> = [
  { value: "request", label: "Demande" },
  { value: "complaint", label: "Réclamation" },
  { value: "information", label: "Information" },
];
export const ACTIVITES: Array<{ value: string; label: string }> = [
  { value: "transport", label: "Transport" },
  { value: "btp", label: "BTP" },
  { value: "immobilier", label: "Immobilier" },
  { value: "location", label: "Location" },
  { value: "cabinet", label: "Cabinet" },
  { value: "facturation", label: "Facturation" },
  { value: "autre", label: "Autre" },
];

export const libelle = <T extends string>(liste: Array<{ value: T; label: string }>, v: T | string | null | undefined) =>
  liste.find((x) => x.value === v)?.label ?? (v || "–");

export interface Ref {
  id: number;
  name: string;
}

export interface Delais {
  first_response_due: string | null;
  resolution_due: string | null;
  first_response: string | null;
  resolved: string | null;
  late: "first" | "resolution" | null;
  escalation: number;
}

export interface LigneDossier extends Delais {
  id: number;
  name: string;
  subject: string;
  state: EtatDossier;
  state_label: string;
  kind: TypeDossier;
  kind_label: string;
  priority: Priorite;
  priority_label: string;
  channel: Canal;
  channel_label: string;
  category: Ref | null;
  partner: Ref | null;
  contact: { name: string | null; email: string | null; phone: string | null };
  user: Ref | null;
  team: Ref | null;
  date_open: string;
  sender_unverified: boolean;
  merged_into: Ref | null;
  satisfaction: number | null;
  company: Ref;
}

export interface Message {
  id: number;
  date: string;
  direction: "in" | "out" | "none";
  author: string;
  body: string;
  attachments: Array<{ id: number; name: string; size: number; mimetype: string }>;
  mine: boolean;
  kind?: "public" | "note" | "event";
  channel?: Canal | "internal";
  auto?: boolean;
  unverified?: boolean;
  delivery_state?: string;
  delivery_label?: string;
  delivery_error?: string | null;
}

export interface FicheDossier extends Omit<LigneDossier, "satisfaction"> {
  description: string;
  link: { model: string; id: number; type: string; label: string | null; href: string | null; exists: boolean } | null;
  previous: Ref | null;
  satisfaction: { score: number | null; comment: string | null; date: string | null; channel: string | null; requested: boolean };
  hsseq: { id: number; reference: string; status: string | null; href: string } | null;
  hsseq_available: boolean;
  hsseq_suggested: boolean;
  client_accounts: Array<{ id: number; name: string; login: string }>;
  wa_window_open: boolean;
  messages: Message[];
  can: { manage: boolean; reply: boolean; note: boolean; transitions: Array<{ state: EtatDossier; label: string }> };
}

export interface Categorie {
  id: number;
  name: string;
  code: string | null;
  activity: string;
  kind: TypeDossier | null;
  first_hours: number | null;
  resolution_hours: number | null;
  team: Ref | null;
  hsseq_nature: string | null;
  portal: boolean;
  active: boolean;
  sequence: number;
}

export interface Equipe {
  id: number;
  name: string;
  active: boolean;
  leader: Ref | null;
  members: Ref[];
}

export interface ReponseType {
  id: number;
  name: string;
  body: string;
  active: boolean;
  category: Ref | null;
}

export interface EtatCanal {
  active: boolean;
  message: string;
  template?: boolean;
}

export interface ContexteSC {
  company: { id: number; name: string; entity: string | null };
  profiles: string[];
  can: { manage: boolean; settings: boolean; dashboard: boolean };
  categories: Categorie[];
  teams: Equipe[];
  templates: ReponseType[];
  assignees: Ref[];
  channels: { email: EtatCanal; whatsapp: EtatCanal; mail_server: boolean; public_url: string | null };
  links: Array<{ model: string; type: string }>;
  hsseq: boolean;
}

export interface Reglages {
  company_id: number;
  work_start: number;
  work_end: number;
  delays: Record<Priorite, { first: number; resolution: number }>;
  escalation_hours: number;
  auto_close_days: number;
  ack_enabled: boolean;
  satisfaction_enabled: boolean;
  mail_address: string | null;
  mail_authserv_id: string | null;
  wa_template: string | null;
  wa_template_lang: string;
  public_url: string | null;
  channels: { email: EtatCanal; whatsapp: EtatCanal; mail_server: boolean };
  webhook_path: string;
}

export interface CompteClient {
  id: number;
  name: string;
  login: string;
  active: boolean;
  partners: Ref[];
  last_login: string | null;
  mfa_enabled: boolean;
  invitation: { expires_at: string; used: boolean; sent: boolean; kind: "invite" | "reset" } | null;
  created?: boolean;
  invitation_sent?: boolean;
  invitation_link?: string | null;
  reset?: boolean;
}

export interface Repartition {
  key: string;
  label: string;
  count: number;
}

export interface TableauSC {
  period: { date_from: string; date_to: string };
  kpis: {
    open: number;
    late: number;
    new_in_period: number;
    resolved_in_period: number;
    first_response_hours: number | null;
    resolution_hours: number | null;
    satisfaction: number | null;
    satisfaction_count: number;
    complaints: number;
    unverified: number;
  };
  by_state: Repartition[];
  by_priority: Repartition[];
  by_category: Repartition[];
  by_channel: Repartition[];
  by_user: Repartition[];
  satisfaction_scores: Array<{ score: number; count: number }>;
  complaints_by_client: Array<{ label: string; count: number }>;
  complaints_by_activity: Repartition[];
  late: LigneDossier[];
}

// ─── Espace client ──────────────────────────────────────────────────────

export interface LigneClient {
  id: number;
  name: string;
  subject: string;
  state: EtatDossier;
  state_label: string;
  kind_label: string;
  category: string | null;
  company: Ref;
  date_open: string;
  last_update: string;
  merged_into: string | null;
}

export interface FicheClient extends LigneClient {
  description: string;
  handled_by: string;
  link: { type: string; label: string | null } | null;
  messages: Message[];
  satisfaction: { score: number | null; comment: string | null; can_rate: boolean };
  can: { reply: boolean; confirm: boolean };
}

export interface MoiClient {
  name: string;
  login: string;
  companies: Array<{ id: number; name: string; partners: Ref[]; categories: Ref[] }>;
  kinds: Array<{ code: TypeDossier; label: string }>;
}

/** Formats acceptés pour les pièces jointes (contrôlés au contenu par le noyau). */
export const PIECES_ACCEPTEES = ".pdf,.jpg,.jpeg,.png,.docx,.xlsx";

/** Heures ouvrées lisibles : « 3,5 h », « 2 j 4 h » (journées de 9 heures par défaut). */
export function heuresOuvrees(h: number | null | undefined): string {
  if (h === null || h === undefined) return "–";
  if (h < 10) return `${h.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;
  return `${Math.round(h).toLocaleString("fr-FR")} h`;
}
