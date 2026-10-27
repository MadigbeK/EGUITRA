/**
 * NIMOVA · Agenda : contrat de l'API /agenda/... (addons/eguitra_agenda/controllers/agenda.py) et outils
 * de dates des écrans. Les écrans placent tout à l'heure de Conakry (FUSEAU, lib/format.ts), comme le
 * reste de la plateforme, quel que soit le réglage du poste ; le noyau rend ses instants en UTC (« …Z »).
 */

import { FUSEAU, decalerJours } from "./format";

export const RELECTURE_AGENDA_MS = 30_000;
export const CLE_NON_LUS_AGENDA = "/agenda/notifications/unread";

/* ─── Contrat ──────────────────────────────────────────────────────────── */

export type Niveau = "owner" | "manage" | "write" | "read" | "freebusy" | "book" | "none";
export type Visibilite = "public" | "private" | "confidential";
export type Statut = "busy" | "free" | "tentative" | "oof";
export type Reponse = "needs_action" | "accepted" | "tentative" | "declined";
export type Portee = "this" | "following" | "all";
export type Vue = "jour" | "semaine" | "travail" | "mois" | "liste" | "planning";

export interface Personne {
  id: number;
  name: string;
}

export interface Calendrier {
  id: number;
  name: string;
  color: string;
  kind: "personal" | "team" | "resource";
  level: Niveau;
  level_label: string;
  owner: Personne | null;
  mine: boolean;
  can_write: boolean;
  resource_type?: "room" | "vehicle" | "equipment" | "other";
  resource_label?: string;
  capacity?: number;
  location?: string | null;
  description?: string | null;
  company?: string | null;
  open_hours?: Record<string, [string, string][]> | null;
  active?: boolean;
  delegation?: { see_private: boolean; receive_invitations: boolean };
  shares?: Array<{ id: number; user: Personne; level: "freebusy" | "read" | "write"; level_label: string }>;
}

export interface Rappel {
  minutes: number;
  channel: "app" | "email";
}

export interface Preferences {
  tz: string;
  work_hours: Record<string, [string, string][]>;
  default_alarms: Rappel[];
  buffer_minutes: number;
  digest: boolean;
  digest_hour: number;
  freebusy_visible: boolean;
  ooo: { active: boolean; start: string | null; stop: string | null; message: string | null; auto_decline: boolean; current: boolean };
  sources: string[] | null;
}

export interface Delegation {
  id: number;
  owner: Personne;
  delegate: Personne;
  receive_invitations: boolean;
  see_private: boolean;
  granted_by: Personne | null;
  reason: string | null;
  since: string;
}

export interface SourceDispo {
  code: string;
  label: string;
  color: string;
  default: boolean;
  shown: boolean;
}

export interface AgendaMe {
  user: Personne & { email: string | null };
  personal_calendar_id: number;
  preferences: Preferences;
  calendars: Calendrier[];
  categories: Array<{ id: number; name: string; color: string; mine: boolean }>;
  sources: SourceDispo[];
  delegations_given: Delegation[];
  delegations_received: Delegation[];
  subscription: Abonnement;
  booking: { open: boolean };
  mail_server: boolean;
  rights: { admin: boolean; pose_delegation: boolean };
  unread: number;
}

export interface Abonnement {
  active: boolean;
  hint?: string;
  created?: string;
  last_used?: string | null;
  mask_private?: boolean;
  path?: string;
}

export interface Occurrence {
  key: string;
  id: number;
  series_id: number | null;
  occurrence: string | null;
  calendar_id: number;
  event_calendar_id: number;
  start: string;
  stop: string;
  allday: boolean;
  start_date?: string;
  end_date?: string;
  title: string;
  view: "full" | "title" | "busy";
  masked: boolean;
  privacy: Visibilite | null;
  show_as: Statut;
  recurring: boolean;
  exception: boolean;
  organizer: Personne | null;
  categories: Array<{ id: number; name: string; color: string }>;
  location: string | null;
  video_url: string | null;
  attendees_count: number | null;
  my_response: Reponse | null;
  can_edit: boolean;
  has_link: boolean;
  resources: string[];
}

export interface Participant {
  id: number;
  kind: "user" | "partner" | "email";
  user_id: number | null;
  partner_id: number | null;
  name: string;
  email: string | null;
  required: boolean;
  state: Reponse;
  comment: string | null;
  responded_at: string | null;
  responded_by: string | null;
  auto_declined: boolean;
  me: boolean;
  proposal: { start: string; stop: string; comment: string | null } | null;
}

export interface SpecRecurrence {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  days: string[];
  monthly: "date" | "rank";
  month_day: number | null;
  rank: number | null;
  rank_day: string | null;
  month: number | null;
  end: "never" | "count" | "until";
  count: number | null;
  until: string | null;
}

export interface DetailEvenement extends Occurrence {
  tz?: string;
  description: string | null;
  attendees: Participant[];
  resource_ids?: Array<{ id: number; name: string; type: string; capacity: number }>;
  attachments: Array<{ id: number; name: string; mimetype: string | null; size: number | null }>;
  alarms: Rappel[] | null;
  alarms_label?: string | null;
  recurrence: { rule: string; spec: SpecRecurrence; label: string } | null;
  link: { model: string; id: number; type: string; label: string | null; href: string | null; readable: boolean } | null;
  created_by?: string | null;
  created_on_behalf?: string | null;
  modified_by?: string | null;
  modified_on_behalf?: string | null;
  modified_at?: string;
  organizer_inactive?: boolean;
  can_respond?: boolean;
  respond_for?: Array<{ user_id: number; name: string; state: Reponse }>;
}

export interface Resultat {
  event: DetailEvenement | null;
  conflicts: Array<{ user_id: number; name: string; start: string; stop: string; reason: string; message: string }>;
  warnings: Array<{ user_id: number; message: string }>;
  mail: { sent: number; mail_server: boolean } | null;
}

export interface ElementSource {
  key: string;
  source: string;
  source_label: string;
  color: string;
  title: string;
  date: string;
  end_date: string;
  href: string;
  detail?: string;
  status?: string;
  tone?: "danger" | null;
}

export interface Occupation {
  start: string;
  stop: string;
  kind: "busy" | "tentative" | "oof" | "absence";
  title?: string;
  event_id?: number | null;
}

export interface Disponibilite {
  id: number;
  name: string;
  visible: boolean;
  tz: string;
  work_hours: Record<string, [string, string][]>;
  busy: Occupation[];
  ooo: { start: string; stop: string; message: string | null; auto_decline: boolean } | null;
}

export interface Creneau {
  start: string;
  stop: string;
  optional_free: number[];
  missing: string[];
  label: string;
}

export interface LignePlanning {
  id: number;
  kind: "person" | "resource";
  name: string;
  visible: boolean;
  busy: Occupation[];
  work_hours: Record<string, [string, string][]> | null;
  ooo: Disponibilite["ooo"];
  capacity?: number;
}

export interface NotificationAgenda {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  date: string;
  read: boolean;
  event_id: number | null;
  occurrence: string | null;
  actor: string | null;
  on_behalf: string | null;
}

export interface TypeRendezVous {
  id: number;
  name: string;
  description: string | null;
  duration: number;
  location: string | null;
  video_url: string | null;
  slots: Record<string, [string, string][]> | null;
  min_notice_hours: number;
  max_days: number;
  buffer_minutes: number;
  questions: string[];
  allowed_domains: string | null;
  active: boolean;
  link: string | null;
  key: string;
}

/* ─── Dates à l'heure de Conakry ───────────────────────────────────────── */

export const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
export const JOURS_COURTS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
export const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const CODES_JOURS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

const PARTIES = new Intl.DateTimeFormat("en-CA", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function parties(d: Date): { jour: string; minutes: number } {
  const p: Record<string, string> = {};
  for (const x of PARTIES.formatToParts(d)) p[x.type] = x.value;
  return { jour: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Instant d'une date-heure de l'API (« …Z », ou sans fuseau : UTC). */
export function lireInstant(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

/** « AAAA-MM-JJTHH:MM:SSZ » pour l'API. */
export function versApi(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Jour (« AAAA-MM-JJ ») d'un instant, à Conakry. */
export function jourDe(d: Date): string {
  return parties(d).jour;
}

/** Minutes écoulées depuis minuit, à Conakry. */
export function minutesDe(d: Date): number {
  return parties(d).minutes;
}

/** Instant du jour à Conakry, à `minutes` après minuit (le décalage est lu, rien n'est supposé). */
export function instantDe(jour: string, minutes = 0): Date {
  const [a, m, j] = jour.split("-").map(Number);
  const mur = Date.UTC(a!, m! - 1, j!, 0, minutes);
  const p = parties(new Date(mur));
  const [pa, pm, pj] = p.jour.split("-").map(Number);
  const decalage = Date.UTC(pa!, pm! - 1, pj!, 0, p.minutes) - mur;
  return new Date(mur - decalage);
}

/** Rang du jour dans la semaine (0 = lundi) d'une date du calendrier. */
export function rangJour(jour: string): number {
  return (new Date(`${jour}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function lundiDe(jour: string): string {
  return decalerJours(jour, -rangJour(jour));
}

export function jours(debut: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => decalerJours(debut, i));
}

export function premierDuMois(jour: string): string {
  return `${jour.slice(0, 8)}01`;
}

export function moisSuivant(jour: string, n: number): string {
  const d = new Date(`${premierDuMois(jour)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** « lundi 3 novembre », « lundi 3 novembre 2026 » avec l'année. */
export function jourLong(jour: string, annee = false): string {
  const [a, m, j] = jour.split("-").map(Number);
  return `${JOURS[rangJour(jour)]} ${j === 1 ? "1er" : j} ${MOIS[m! - 1]}${annee ? ` ${a}` : ""}`;
}

export function moisLong(jour: string): string {
  const [a, m] = jour.split("-").map(Number);
  const nom = MOIS[m! - 1]!;
  return `${nom.charAt(0).toUpperCase()}${nom.slice(1)} ${a}`;
}

/** « 09:30 », à Conakry. */
export function heure(d: Date | string): string {
  const m = minutesDe(typeof d === "string" ? lireInstant(d) : d);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function minutesEnTexte(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** « de 09:00 à 10:30 », « journée entière », « du 3 au 5 novembre ». */
export function plage(o: { start: string; stop: string; allday: boolean; start_date?: string; end_date?: string }): string {
  if (o.allday) {
    const a = o.start_date ?? jourDe(lireInstant(o.start));
    const b = o.end_date ?? a;
    return a === b ? "Journée entière" : `Du ${jourLong(a)} au ${jourLong(b)}`;
  }
  const s = lireInstant(o.start);
  const e = lireInstant(o.stop);
  if (jourDe(s) === jourDe(e)) return `${heure(s)} - ${heure(e)}`;
  return `${jourLong(jourDe(s))} ${heure(s)} - ${jourLong(jourDe(e))} ${heure(e)}`;
}

/** Délai de rappel en français. */
export function libelleRappel(minutes: number): string {
  if (minutes === 0) return "Au début";
  if (minutes % 1440 === 0) return `${minutes / 1440} jour${minutes > 1440 ? "s" : ""} avant`;
  if (minutes % 60 === 0) return `${minutes / 60} heure${minutes > 60 ? "s" : ""} avant`;
  return `${minutes} minutes avant`;
}

export const DELAIS_RAPPEL = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

export const LIBELLES_REPONSE: Record<Reponse, string> = { needs_action: "Sans réponse", accepted: "Accepté", tentative: "Provisoire", declined: "Refusé" };
export const LIBELLES_STATUT: Record<Statut, string> = { busy: "Occupé", free: "Libre", tentative: "Provisoire", oof: "Absent du bureau" };
export const LIBELLES_VISIBILITE: Record<Visibilite, string> = { public: "Publique", private: "Privée", confidential: "Confidentielle" };
export const AIDE_VISIBILITE: Record<Visibilite, string> = {
  public: "Les détails sont lus par qui lit l'agenda.",
  private: "« Occupé » pour tous, sauf les participants et le délégué autorisé.",
  confidential: "Le titre seul pour qui lit l'agenda ; les détails aux participants et aux délégués.",
};

/** Fiches de la plateforme qu'un événement peut citer (pendant de OBJECT_MODELS du noyau). */
export const FICHES: Record<string, string> = {
  "axispro.dossier": "Dossier",
  "eguitra.chantier": "Chantier",
  "eguitra.transport.rotation": "Rotation",
  "eguitra.property": "Bien",
  "eguitra.rh.employee": "Salarié",
  "eguitra.hsseq.event": "Événement HSSEQ",
  "eguitra.hsseq.action": "Action HSSEQ",
};

/** Couleur d'une occurrence : sa première catégorie, sinon son agenda. */
export function couleurDe(o: Occurrence, calendriers: Map<number, Calendrier>): string {
  return o.categories[0]?.color ?? calendriers.get(o.calendar_id)?.color ?? calendriers.get(o.event_calendar_id)?.color ?? "#4340b8";
}

/** Saisie par défaut d'une récurrence, à partir du jour de début. */
export function recurrenceParDefaut(jour: string): SpecRecurrence {
  const j = Number(jour.slice(8, 10));
  return {
    freq: "weekly", interval: 1, days: [CODES_JOURS[rangJour(jour)]!], monthly: "date", month_day: j,
    rank: Math.min(4, Math.floor((j - 1) / 7) + 1), rank_day: CODES_JOURS[rangJour(jour)]!, month: Number(jour.slice(5, 7)),
    end: "never", count: 10, until: null,
  };
}
