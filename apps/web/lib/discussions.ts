"use client";

import { appHeader } from "./api-client";
import { ApiError } from "./erreurs";
import type { Me, Profile } from "./types";

/**
 * Discussion interne : contrat de l'API /chat/... (addons/eguitra_chat/controllers/chat.py) et outils
 * communs au panneau de l'en-tête, à la page /discussions et au bouton « Discussion » des fiches.
 *
 * Temps réel sans websocket : la conversation ouverte est relue toutes les 5 secondes, le nombre de
 * non-lus toutes les 30 secondes, seulement quand l'onglet est visible. Ces relectures passent par
 * `lireDiscret` : aucun événement du document (la déconnexion après inactivité, VeilleInactivite, ne
 * compte que les gestes de l'utilisateur), aucune fenêtre de reconnexion sur une session expirée.
 */

export const RELECTURE_FIL_MS = 5_000;
export const RELECTURE_NON_LUS_MS = 30_000;
export const CLE_NON_LUS = "/chat/unread";
export const CLE_CONVERSATIONS = "/chat/conversations";

/** Profils internes : seuls ouverts à la discussion (jamais le porteur de projet). */
const INTERNES: readonly Profile[] = ["admin", "direction", "finance", "achats", "exploitation", "chantiers", "immobilier", "cabinet", "rh"];

/** La discussion est-elle ouverte à ce compte, dans cette session ? */
export function discussionOuverte(me: Me): boolean {
  return me.profiles.some((p) => INTERNES.includes(p)) && !me.password_change_required && me.session_app !== "mobile";
}

export type Sorte = "direct" | "group" | "object";

/** Fiches qui portent une discussion (pendant de OBJECT_MODELS du noyau) et l'écran où les retrouver. */
export const OBJETS: Record<string, { nature: string; lien: (id: number) => string }> = {
  "axispro.dossier": { nature: "Dossier", lien: (id) => `/axispro/dossiers/${id}` },
  "eguitra.chantier": { nature: "Chantier", lien: () => "/finance/chantiers" },
  "eguitra.transport.rotation": { nature: "Rotation", lien: () => "/transport/rotations" },
  "eguitra.property": { nature: "Bien", lien: () => "/finance/immobilier" },
};

export interface Personne {
  id: number;
  name: string;
}

export interface Collegue extends Personne {
  companies: string[];
}

export interface ObjetLie {
  model: string;
  id: number;
  type: string;
  label: string;
}

export interface DernierMessage {
  id: number;
  kind: "message" | "event";
  author: string | null;
  mine: boolean;
  date: string;
  excerpt: string | null;
  withdrawn: boolean;
}

export interface Conversation {
  id: number;
  kind: Sorte;
  title: string;
  object: ObjetLie | null;
  members_count: number;
  members: Personne[];
  owner: boolean;
  unread: number;
  last_message: DernierMessage | null;
  last_activity: string;
}

export interface Membre extends Personne {
  owner: boolean;
  me: boolean;
  archived: boolean;
}

export interface DetailConversation extends Omit<Conversation, "members"> {
  members: Membre[];
  can: { post: boolean; add: boolean; remove: boolean; rename: boolean; leave: boolean };
  post_blocked: string | null;
}

export interface PieceJointe {
  id: number;
  name: string;
  mimetype: string | null;
  size: number | null;
}

export interface Message {
  id: number;
  kind: "message" | "event";
  author: Personne | null;
  mine: boolean;
  date: string;
  body: string | null;
  withdrawn: boolean;
  withdrawn_date: string | null;
  reply_to: { id: number; author: string | null; excerpt: string | null; withdrawn: boolean } | null;
  attachments: PieceJointe[];
}

export interface PageMessages {
  messages: Message[];
  has_more: boolean;
  last_read_id: number;
  cursor: string;
}

export interface Relecture {
  messages: Message[];
  changed: Message[];
  cursor: string;
}

export interface NonLus {
  unread: number;
  conversations: number;
}

/** Ouverture demandée au panneau : une conversation, une fiche, ou une nouvelle conversation. */
export type Cible = { conversation: number } | { objet: { model: string; id: number } } | { nouvelle: true } | Record<string, never>;

const EVENEMENT_OUVRIR = "nimova:discussion";
const EVENEMENT_MAJ = "nimova:discussion-maj";

/** Ouvre le panneau de discussion de la coque (bouton « Discussion » des fiches). */
export function ouvrirDiscussion(cible: Cible = {}) {
  window.dispatchEvent(new CustomEvent<Cible>(EVENEMENT_OUVRIR, { detail: cible }));
}

export function surOuverture(rappel: (cible: Cible) => void): () => void {
  const ecouteur = (e: Event) => rappel((e as CustomEvent<Cible>).detail ?? {});
  window.addEventListener(EVENEMENT_OUVRIR, ecouteur);
  return () => window.removeEventListener(EVENEMENT_OUVRIR, ecouteur);
}

/** Lecture ou envoi : le nombre de non-lus de l'en-tête est à relire tout de suite. */
export function signalerMiseAJour() {
  window.dispatchEvent(new Event(EVENEMENT_MAJ));
}

export function surMiseAJour(rappel: () => void): () => void {
  window.addEventListener(EVENEMENT_MAJ, rappel);
  return () => window.removeEventListener(EVENEMENT_MAJ, rappel);
}

/**
 * Appel discret à la passerelle, pour les relectures automatiques et les accusés de lecture : pas de
 * fenêtre de reconnexion (une session expirée arrête les relectures ; le prochain geste de
 * l'utilisateur proposera de se reconnecter), pas de redirection.
 */
export async function lireDiscret<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const method = init?.method ?? "GET";
  const res = await fetch(`/api/odoo${path}`, {
    method,
    cache: "no-store",
    headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}), ...appHeader() },
    body: method === "POST" ? JSON.stringify(init?.body ?? {}) : undefined,
  });
  const texte = await res.text();
  let corps: unknown = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    corps = null;
  }
  if (!res.ok) {
    const c = corps && typeof corps === "object" ? (corps as { error?: string; message?: string }) : {};
    throw new ApiError(res.status, { error: typeof c.error === "string" ? c.error : "error", message: c.message });
  }
  return corps as T;
}

export function initiales(nom: string): string {
  const parties = nom.replace(/[.\-_]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parties.length) return "?";
  if (parties.length === 1) return parties[0]!.slice(0, 2).toUpperCase();
  return (parties[0]![0]! + parties[parties.length - 1]![0]!).toUpperCase();
}

export function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** « 14 h 05 » aujourd'hui, « hier », sinon « 3 nov. » (liste des conversations). */
export function moment(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  const maintenant = new Date();
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86_400_000);
  if (ecart === 0) return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
  if (ecart === 1) return "hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: ecart > 300 ? "numeric" : undefined });
}
