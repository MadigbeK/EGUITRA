/**
 * Données du portail des porteurs de projets (module eguitra_portail) : API du porteur (/portail/...)
 * et outils de publication du cabinet (/axispro/portail/...). Dates : chaînes ISO (UTC, suffixe Z
 * pour les dates et heures ; AAAA-MM-JJ pour les dates seules).
 */

export type GateRef = { code: string; name: string };
export type Person = { id: number; name: string; email: string | null; phone: string | null };
export type Urgency = "high" | "normal" | "low";

export interface DossierRef {
  id: number;
  reference: string;
  name: string;
  state: "open" | "on_hold" | "closed";
  sector: string | null;
  current_gate: GateRef | null;
  consultant: Person | null;
  decision: "go" | "conditional" | "hold" | "no_go" | "postponed" | null;
  decision_label: string | null;
}

export interface GateStep extends GateRef {
  reached: boolean;
  current: boolean;
}

export interface Espace {
  user: { id: number; name: string; login: string; company: string | null };
  dossiers: Array<DossierRef & { unread_messages: number }>;
  counts: {
    notifications: number;
    messages: number;
    announcements_unread: number;
    announcements_to_ack: number;
    tasks_open: number;
    tasks_overdue: number;
    meetings_upcoming: number;
    meetings_requested: number;
    events_registered: number;
  };
}

export interface Preparation {
  score: number;
  pieces: { due: number; received: number; validated: number; rejected: number; missing: number };
  actions: { total: number; done: number; submitted: number; overdue: number };
  gates: { total: number; reached: number };
}

export interface NextStep {
  kind: "action" | "piece" | "message" | "announcement" | "feedback";
  title: string;
  detail: string | null;
  due: string | null;
  link: string;
  urgency: Urgency;
}

export interface Upcoming {
  kind: "meeting" | "event" | "action";
  title: string;
  date: string;
  link: string;
  registered?: boolean;
}

export interface TimelineItem {
  date: string;
  kind: "start" | "gate" | "decision" | "document" | "action" | "meeting" | "funding";
  title: string;
  detail: string | null;
}

export interface Tableau {
  dossier: DossierRef & { gates: GateStep[]; location: string | null };
  preparation: Preparation;
  next_steps: NextStep[];
  upcoming: Upcoming[];
  timeline: TimelineItem[];
  announcements: AnnouncementRow[];
  articles: ArticleRow[];
  fundings: ResumeFinancements;
}

/**
 * Résumé des financements, calculé par le noyau et identique à l'accueil et dans « Mon projet » : pistes
 * actives (ni refusées ni abandonnées), montants de ces seules pistes, dans la devise des financements.
 */
export interface ResumeFinancements {
  count: number;
  closed: number;
  requested: number;
  granted: number;
  currency: string;
}

export interface FundingRow {
  id: number;
  funder: string;
  instrument: string;
  instrument_label: string;
  amount_requested: number;
  amount_granted: number;
  /** Devise des montants du financement (qui peut différer de celle du dossier). */
  currency: string | null;
  state: "identified" | "submitted" | "review" | "agreed" | "signed" | "disbursed" | "rejected" | "withdrawn";
  state_label: string;
  state_date: string | null;
  next_step: string | null;
  next_date: string | null;
}

export interface Projet {
  dossier: DossierRef & {
    gates: GateStep[];
    location: string | null;
    capacity: string | null;
    investment: number;
    financing_need: number;
    currency: { name: string; symbol: string };
    date_start: string | null;
    description: string | null;
    promoter: string;
  };
  team: Array<Person & { role: string }>;
  fundings: FundingRow[];
  fundings_summary: ResumeFinancements;
  timeline: TimelineItem[];
}

export type PieceState = "missing" | "received" | "validated" | "rejected";

export interface PieceAttendue {
  document_type_id: number;
  code: string;
  name: string;
  category: string | null;
  required: boolean;
  due: boolean;
  gate: string | null;
  guidance: string | null;
  state: PieceState;
  version: number;
  last_file: { id: number; uploaded_at: string; comment: string | null } | null;
}

export interface Fichier {
  id: number;
  name: string;
  version: number;
  state: "received" | "validated" | "rejected";
  comment: string | null;
  document_type_id: number | null;
  uploaded_by: string;
  uploaded_at: string;
  mimetype: string | null;
  size: number | null;
  from_cabinet: boolean;
}

export interface Pieces {
  closed: boolean;
  progress: { due: number; received: number; validated: number; rejected: number };
  attendues: PieceAttendue[];
  fichiers: Fichier[];
}

export interface ActionRow {
  id: number;
  name: string;
  description: string | null;
  due_date: string | null;
  state: "todo" | "in_progress" | "submitted" | "done";
  porteur_comment: string | null;
  overdue: boolean;
  done_date: string | null;
  /** Origine dans les mots du porteur : jamais la clé interne (écart de la grille, saisie libre…). */
  origin: "consultant" | "committee" | "risk";
  origin_label: string;
  create_date: string;
}

export interface Attachment {
  id: number;
  name: string;
  mimetype: string | null;
  size: number | null;
}

export interface MessageRow {
  id: number;
  author: string;
  from_promoter: boolean;
  from_me: boolean;
  date: string;
  body: string;
  internal: boolean;
  attachments: Attachment[];
}

export interface Fil {
  consultant: Person | null;
  closed: boolean;
  messages: MessageRow[];
  /** Des messages plus anciens restent à charger (?before=). */
  more: boolean;
}

export type MeetingMode = "office" | "video" | "phone" | "site";
export type MeetingState = "requested" | "confirmed" | "declined" | "cancelled" | "done";

export interface MeetingRow {
  id: number;
  dossier: { id: number; reference: string; name: string };
  subject: string;
  agenda: string | null;
  mode: MeetingMode;
  mode_label: string;
  slots: string[];
  start: string | null;
  end: string | null;
  duration: number;
  location: string | null;
  online_url: string | null;
  state: MeetingState;
  state_label: string;
  consultant: Person | null;
  requested_by: string;
  requested_by_me: boolean;
  cabinet_note: string | null;
  minutes: string | null;
  create_date: string;
  /** Rendez-vous annulé : par le porteur (motif dans cabinet_note) ou par le cabinet. */
  cancelled_by: "porteur" | "cabinet" | null;
}

export type AnnouncementKind = "info" | "important" | "opportunity" | "event" | "alert";

export interface AnnouncementRow {
  id: number;
  title: string;
  kind: AnnouncementKind;
  kind_label: string;
  pinned: boolean;
  require_ack: boolean;
  published_at: string | null;
  expire_date: string | null;
  cta_url: string | null;
  cta_label: string | null;
  author: string;
  excerpt: string;
  read: boolean;
  acknowledged: boolean;
  body?: string;
}

export type ArticleKind = "article" | "guide" | "fiche" | "faq" | "video" | "modele";
export type CategoryColor = "azur" | "lagon" | "or" | "jade" | "corail" | "violet";

export interface CategoryRow {
  id: number;
  name: string;
  description: string | null;
  icon: string;
  color: CategoryColor;
  sequence: number;
  count: number | null;
}

export interface ArticleRow {
  id: number;
  title: string;
  summary: string;
  kind: ArticleKind;
  kind_label: string;
  category_id: number | null;
  tags: string[];
  reading_minutes: number;
  published_at: string | null;
  featured: boolean;
  recommended: boolean;
  bookmarked: boolean;
  viewed: boolean;
  helpful: "yes" | "no" | null;
  has_files: boolean;
  video_url: string | null;
}

export interface ArticleDetail extends ArticleRow {
  body: string;
  author: string;
  files: Attachment[];
  category: CategoryRow | null;
  helpful_count: number;
  related: ArticleRow[];
}

export interface Ressources {
  categories: CategoryRow[];
  articles: ArticleRow[];
}

export type EventKind = "atelier" | "formation" | "webinaire" | "permanence" | "rencontre" | "pitch";
export type RegistrationState = "registered" | "waitlist" | "cancelled" | "attended" | "absent";

export interface EventRow {
  id: number;
  name: string;
  kind: EventKind;
  kind_label: string;
  description: string;
  speaker: string | null;
  start: string;
  end: string;
  location: string | null;
  online: boolean;
  online_url: string | null;
  capacity: number | null;
  seats_left: number | null;
  registration_open: boolean;
  registration_deadline: string | null;
  state: "draft" | "published" | "cancelled";
  my_registration: { state: RegistrationState; state_label: string; note: string | null } | null;
}

export interface AgendaItem {
  key: string;
  kind: "meeting" | "event" | "action" | "funding";
  title: string;
  start: string;
  end: string | null;
  all_day: boolean;
  link: string;
  state: string;
  detail: string | null;
  dossier: string | null;
}

export type NotificationKind =
  | "message" | "document" | "action" | "gate" | "decision" | "meeting" | "announcement" | "event" | "funding" | "resource";

export interface NotificationRow {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  date: string;
  read: boolean;
  dossier: { id: number; reference: string } | null;
}

export interface Notifications {
  unread: number;
  items: NotificationRow[];
}

export interface Profil {
  user: { name: string; login: string; phone: string | null; email: string | null };
  entreprise: { name: string; phone: string | null; email: string | null; street: string | null; city: string | null; website: string | null } | null;
  /** Réponse à une modification : la fiche de l'entreprise ne change pas d'ici, la demande part au consultant. */
  request_sent?: boolean;
}

export type FeedbackTopic = "global" | "consultant" | "portail" | "event";

export interface FeedbackRow {
  id: number;
  dossier: { id: number; reference: string; name: string };
  author: string;
  topic: FeedbackTopic;
  topic_label: string;
  event: string | null;
  event_id: number | null;
  score: number;
  recommend: number | null;
  comment: string | null;
  date: string;
}

/* ─── Cabinet ─────────────────────────────────────────────────────────── */

export type Audience = "all" | "dossiers" | "gates" | "sectors";
export type PublicationState = "draft" | "published" | "archived";

export interface AudienceFields {
  audience: Audience;
  audience_label?: string;
  dossier_ids: number[];
  gate_codes: string;
  sector_keywords: string;
}

export interface Synthese {
  porteurs: { total: number; active_30d: number; never: number };
  messages: { unread: number; waiting: number };
  meetings: { requested: number; upcoming: number };
  actions_submitted: number;
  events: { upcoming: number; registrations: number };
  feedback: { count: number; average: number | null; nps: number | null };
  articles: { published: number; drafts: number; views: number };
  announcements: { published: number; ack_pending: number };
  to_do: Array<{ kind: "meeting" | "message" | "action"; title: string; detail: string; link: string; date: string | null }>;
}

export interface PorteurRow {
  id: number;
  name: string;
  login: string;
  active: boolean;
  phone: string | null;
  last_login: string | null;
  last_message: string | null;
  dossiers: Array<{ id: number; reference: string; name: string; current_gate: GateRef | null }>;
  feedback: Array<{ score: number; topic: FeedbackTopic; date: string }>;
}

export interface Cibles {
  dossiers: Array<{ id: number; reference: string; name: string; sector: string | null; current_gate: GateRef | null; portal_users: number }>;
  gates: GateRef[];
  sectors: string[];
  audiences: Array<{ key: Audience; label: string }>;
  announcement_kinds: Array<{ key: AnnouncementKind; label: string }>;
  article_kinds: Array<{ key: ArticleKind; label: string }>;
  event_kinds: Array<{ key: EventKind; label: string }>;
  meeting_modes: Array<{ key: MeetingMode; label: string }>;
  colors: CategoryColor[];
}

export interface ConversationRow {
  dossier: { id: number; reference: string; name: string; promoter: string; consultant: string | null; state: DossierRef["state"] };
  portal_users: string[];
  last_message: { author: string; body: string; date: string; from_promoter: boolean } | null;
  unread: number;
  waiting: boolean;
  count: number;
}

export interface Conversation {
  dossier: DossierRef & { promoter: string };
  portal_users: Person[];
  messages: MessageRow[];
}

export interface AnnouncementAdmin extends AnnouncementRow, AudienceFields {
  body: string;
  state: PublicationState;
  stats: { audience: number; read: number; acknowledged: number };
}

export interface ArticleAdmin extends ArticleRow {
  body: string;
  create_date: string;
  write_date: string;
  author: string;
  files: Attachment[];
  state: PublicationState;
  gate_codes: string;
  tags_text: string;
  stats: { views: number; readers: number; helpful: number; not_helpful: number; bookmarks: number };
}

export interface EventAdmin extends EventRow, AudienceFields {
  registered: number;
  waitlist: number;
  attended: number;
}

export interface RegistrationRow {
  id: number;
  user: string;
  login: string;
  phone: string | null;
  dossier: { id: number; reference: string } | null;
  state: RegistrationState;
  state_label: string;
  note: string | null;
  date: string;
}
