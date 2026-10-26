"use client";

/**
 * Briques communes du portail des porteurs : icônes par nature d'événement, texte mis en forme
 * (sous-ensemble sûr de Markdown, sans HTML), dates relatives, tailles de fichier, fichiers de
 * calendrier (.ics) et usages des couleurs de rubrique.
 */

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
  BadgeCheck, BookOpen, Building2, Calendar, CheckCircle2, Clock, FileCheck2, FileText, Flag, Gavel, HandCoins,
  Info, Landmark, ListChecks, Mail, Scale, Sparkles, TrendingUp, Users, type Icon, ICONES,
} from "@/components/icons";
import type { Teinte } from "@/components/ui";
import type { CategoryColor, NotificationKind, TimelineItem } from "@/lib/portail-types";

export const FORMATS = ".pdf,.jpg,.jpeg,.png,.docx,.xlsx";
export const FORMATS_TEXTE = "PDF, JPEG, PNG, Word (.docx) ou Excel (.xlsx), 20 Mo au plus.";

export const KIND_ICON: Record<NotificationKind | TimelineItem["kind"] | "piece" | "feedback", Icon> = {
  message: Mail,
  document: FileText,
  piece: FileCheck2,
  action: ListChecks,
  gate: Flag,
  decision: Gavel,
  meeting: Clock,
  announcement: Sparkles,
  event: Users,
  funding: HandCoins,
  resource: BookOpen,
  start: Flag,
  feedback: BadgeCheck,
};

/** Rubriques : teinte des sceaux d'icône (Teinte du jeu de couleurs) et couleur vive des bandeaux. */
export const COULEUR: Record<CategoryColor, { teinte: Teinte; vif: string; doux: string }> = {
  azur: { teinte: "azur", vif: "#2d82dc", doux: "#e6f0fc" },
  lagon: { teinte: "lagon", vif: "#0f9fa0", doux: "#dcf5f4" },
  or: { teinte: "or", vif: "#c39a3f", doux: "#f8efdc" },
  jade: { teinte: "jade", vif: "#12956a", doux: "#e2f5ea" },
  corail: { teinte: "corail", vif: "#e25f35", doux: "#fdebe4" },
  // Clé « violet » gardée (valeur enregistrée par le noyau) ; la teinte affichée est le rose.
  violet: { teinte: "rose", vif: "#c4417a", doux: "#fbe7f0" },
};

const ICONES_RUBRIQUE: Record<string, Icon> = { Landmark, TrendingUp, Scale, Building2, Info, FileCheck2, BookOpen, Calendar };

/** Icône d'une rubrique par son nom (jeu NIMOVA), un livre ouvert à défaut. */
export function iconeRubrique(nom: string | null | undefined): Icon {
  if (!nom) return BookOpen;
  return ICONES_RUBRIQUE[nom] ?? (ICONES as Record<string, Icon>)[nom] ?? BookOpen;
}

/**
 * Lien d'une notification : une notification qui concerne un dossier ouvre la page sur ce dossier
 * (?dossier=), même si son lien n'en dit rien ; sinon, un porteur à plusieurs dossiers arriverait sur
 * celui qu'il avait choisi en dernier.
 */
export function lienNotification(n: { link: string | null; dossier: { id: number } | null }): string | null {
  if (!n.link) return null;
  if (!n.dossier || !n.link.startsWith("/portail") || /[?&]dossier=/.test(n.link)) return n.link;
  const [avant, ancre] = n.link.split("#", 2);
  const lien = `${avant}${avant!.includes("?") ? "&" : "?"}dossier=${n.dossier.id}`;
  return ancre !== undefined ? `${lien}#${ancre}` : lien;
}

/* ─── Dates, à l'heure de Conakry ──────────────────────────────────────── */

/**
 * Fuseau de toutes les dates du portail : l'heure de Conakry, celle du cabinet et des rendez-vous, quel que
 * soit le réglage de l'appareil (un porteur en déplacement, un poste réglé sur un autre pays). Le noyau
 * envoie des instants UTC (suffixe Z) et des dates seules (AAAA-MM-JJ).
 */
export const FUSEAU = "Africa/Conakry";

const JOUR = 86_400_000;
const p2 = (n: number) => String(n).padStart(2, "0");
const PARTIES = new Intl.DateTimeFormat("en-GB", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Année, mois (1 à 12), jour, heure et minute d'un instant, à Conakry. */
function parties(d: Date): { annee: number; mois: number; jour: number; heure: number; minute: number } {
  const p: Record<string, string> = {};
  for (const x of PARTIES.formatToParts(d)) p[x.type] = x.value;
  return { annee: Number(p.year), mois: Number(p.month), jour: Number(p.day), heure: Number(p.hour) % 24, minute: Number(p.minute) };
}

/** Instant d'une date et heure lue à Conakry (sans hypothèse sur le décalage du fuseau). */
function instantConakry(annee: number, mois: number, jour: number, h = 0, mi = 0): Date {
  const essai = Date.UTC(annee, mois - 1, jour, h, mi);
  const p = parties(new Date(essai));
  return new Date(essai - (Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute) - essai));
}

/** Instant d'une valeur de l'API ; une date seule (AAAA-MM-JJ) vaut midi, heure de Conakry. */
export function instant(value: string): Date {
  if (value.length === 10) {
    const [a, m, j] = value.split("-").map(Number);
    return instantConakry(a ?? 1970, m ?? 1, j ?? 1, 12);
  }
  return new Date(value);
}

/** Jour (AAAA-MM-JJ) à Conakry d'une valeur de l'API ou d'un instant ; une date seule reste telle quelle. */
export function jourConakry(value: string | Date): string {
  if (typeof value === "string" && value.length === 10) return value;
  const p = parties(typeof value === "string" ? new Date(value) : value);
  return `${p.annee}-${p2(p.mois)}-${p2(p.jour)}`;
}

/** Jour courant à Conakry (AAAA-MM-JJ). */
export function aujourdhui(): string {
  return jourConakry(new Date());
}

/**
 * Date du calendrier (midi UTC) d'un jour AAAA-MM-JJ, pour l'arithmétique des grilles : on y lit le jour, le
 * mois et le jour de la semaine en UTC (getUTCDate…), sans glissement d'un fuseau à l'autre.
 */
export function depuisCle(cle: string): Date {
  const [a, m, j] = cle.split("-").map(Number);
  return new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, j ?? 1, 12));
}

/** Jour AAAA-MM-JJ d'une date du calendrier (voir depuisCle). */
export function cleDate(d: Date): string {
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** Jour AAAA-MM-JJ décalé de n jours. */
export function decalerJour(cle: string, n: number): string {
  const d = depuisCle(cle);
  d.setUTCDate(d.getUTCDate() + n);
  return cleDate(d);
}

/** Écart en jours civils de a à b (deux jours AAAA-MM-JJ). */
export function ecartJours(a: string, b: string): number {
  return Math.round((depuisCle(b).getTime() - depuisCle(a).getTime()) / JOUR);
}

/** Date écrite à la française, à l'heure de Conakry (valeur de l'API, instant ou date du calendrier). */
export function formatConakry(value: string | Date, options: Intl.DateTimeFormatOptions): string {
  const d = typeof value === "string" ? instant(value) : value;
  return d.toLocaleDateString("fr-FR", { ...options, timeZone: FUSEAU });
}

/** L'année n'est écrite que si elle n'est pas l'année en cours à Conakry. */
function anneeSiAutre(value: string | Date): "numeric" | undefined {
  return jourConakry(typeof value === "string" ? instant(value) : value).slice(0, 4) !== aujourdhui().slice(0, 4) ? "numeric" : undefined;
}

/**
 * « aujourd'hui », « demain », « dans 5 jours », « il y a 3 jours », sinon la date (« 4 novembre »).
 * avecLe : « le 4 novembre » pour une date, afin d'écrire « Dernier envoi le 4 novembre » comme
 * « Dernier envoi hier ».
 */
export function quand(value: string | null | undefined, avecLe = false): string {
  if (!value) return "";
  const ecart = ecartJours(aujourdhui(), jourConakry(value));
  if (ecart === 0) return "aujourd'hui";
  if (ecart === 1) return "demain";
  if (ecart === -1) return "hier";
  if (ecart > 1 && ecart < 30) return `dans ${ecart} jours`;
  if (ecart < -1 && ecart > -30) return `il y a ${-ecart} jours`;
  const date = formatConakry(value, { day: "numeric", month: "long", year: ecart > 300 || ecart < -300 ? "numeric" : undefined });
  return avecLe ? `le ${date}` : date;
}

/** « mardi 4 novembre, 10 h 30 » (l'année si ce n'est pas la courante), heure de Conakry. */
export function dateLongue(value: string | null | undefined, avecHeure = true): string {
  if (!value) return "";
  const jour = formatConakry(value, { weekday: "long", day: "numeric", month: "long", year: anneeSiAutre(value) });
  return avecHeure ? `${jour}, ${heure(value)}` : jour;
}

/** « 10 h 30 », heure de Conakry. */
export function heure(value: string | null | undefined): string {
  if (!value) return "";
  const p = parties(new Date(value));
  return `${p.heure} h ${p2(p.minute)}`;
}

/** « 25/10/2026, 14 h 05 », heure de Conakry. */
export function dateHeure(value: string | null | undefined): string {
  if (!value) return "–";
  return `${formatConakry(value, { day: "2-digit", month: "2-digit", year: "numeric" })}, ${heure(value)}`;
}

/**
 * Valeur d'un champ datetime-local, lue comme une heure de Conakry (et non celle de l'appareil), vers l'ISO
 * UTC attendu par l'API ; null si le champ est vide ou illisible. Et l'inverse pour remplir le champ.
 */
export function versIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  return instantConakry(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])).toISOString();
}

export function versLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = parties(new Date(iso));
  return `${p.annee}-${p2(p.mois)}-${p2(p.jour)}T${p2(p.heure)}:${p2(p.minute)}`;
}

export function taille(octets: number | null | undefined): string {
  if (!octets) return "";
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/* ─── Calendrier (.ics) ────────────────────────────────────────────────── */

function icsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsTexte(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\r\n?|\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
}

const OCTETS = new TextEncoder();

/**
 * Ligne d'un fichier .ics repliée à 75 octets (RFC 5545, § 3.1) : la suite passe à la ligne et commence par
 * une espace, sans jamais couper un caractère accentué. Un titre ou un ordre du jour long ne rend plus le
 * fichier illisible pour certains agendas.
 */
function plier(ligne: string): string {
  const morceaux: string[] = [];
  let courant = "";
  let octets = 0;
  for (const c of ligne) {
    const n = OCTETS.encode(c).length;
    // La première ligne a 75 octets ; les suivantes 74, après l'espace de continuation.
    if (octets + n > (morceaux.length ? 74 : 75)) {
      morceaux.push(courant);
      courant = "";
      octets = 0;
    }
    courant += c;
    octets += n;
  }
  morceaux.push(courant);
  return morceaux.join("\r\n ");
}

/** Télécharge un fichier .ics : le rendez-vous ou l'événement s'ajoute à l'agenda du téléphone. */
export function ajouterAuCalendrier({ titre, debut, fin, lieu, description, uid }: { titre: string; debut: string; fin?: string | null; lieu?: string | null; description?: string | null; uid: string }) {
  const start = new Date(debut);
  const end = fin ? new Date(fin) : new Date(start.getTime() + 3_600_000);
  const lignes = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MB AxisPro Consulting//Portail//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${uid}@portail.mbaxispro`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsTexte(titre)}`, lieu ? `LOCATION:${icsTexte(lieu)}` : "", description ? `DESCRIPTION:${icsTexte(description)}` : "",
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${icsTexte(titre)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  const url = URL.createObjectURL(new Blob([`${lignes.map(plier).join("\r\n")}\r\n`], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${titre.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "rendez-vous"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ─── Texte mis en forme ───────────────────────────────────────────────── */

/** Liens acceptés : adresses https et pages du portail ; le reste reste du texte. */
function lienSur(href: string) {
  return /^https:\/\/[^\s]+$/.test(href) || /^\/portail(\/|$)/.test(href);
}

function enLigne(texte: string, cle: string): ReactNode[] {
  const out: ReactNode[] = [];
  const motif = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let dernier = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = motif.exec(texte))) {
    if (m.index > dernier) out.push(texte.slice(dernier, m.index));
    const k = `${cle}-${i++}`;
    if (m[2] !== undefined) out.push(<strong key={k} className="font-semibold text-ink">{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{m[3]}</em>);
    else if (m[4] !== undefined) out.push(<code key={k} className="rounded bg-panel-2 px-1 py-0.5 text-[0.92em]">{m[4]}</code>);
    else if (m[5] !== undefined && m[6] !== undefined) {
      const href = m[6];
      out.push(
        lienSur(href) ? (
          href.startsWith("/") ? (
            <Link key={k} href={href} className="font-semibold text-accent underline underline-offset-2">{m[5]}</Link>
          ) : (
            <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline underline-offset-2">{m[5]}</a>
          )
        ) : (
          <Fragment key={k}>{m[5]}</Fragment>
        ),
      );
    }
    dernier = m.index + m[0].length;
  }
  if (dernier < texte.length) out.push(texte.slice(dernier));
  return out;
}

type Bloc =
  | { t: "h"; niveau: number; texte: string }
  | { t: "p"; texte: string }
  | { t: "q"; texte: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] };

function blocs(source: string): Bloc[] {
  const out: Bloc[] = [];
  let para: string[] = [];
  const fin = () => {
    if (para.length) out.push({ t: "p", texte: para.join(" ") });
    para = [];
  };
  for (const brut of source.replace(/\r/g, "").split("\n")) {
    const ligne = brut.trim();
    if (!ligne) {
      fin();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(ligne);
    const ul = /^[-*]\s+(.*)$/.exec(ligne);
    const ol = /^\d+[.)]\s+(.*)$/.exec(ligne);
    const q = /^>\s?(.*)$/.exec(ligne);
    const dernier = out[out.length - 1];
    if (h) {
      fin();
      out.push({ t: "h", niveau: h[1]!.length, texte: h[2]! });
    } else if (ul) {
      fin();
      if (dernier?.t === "ul") dernier.items.push(ul[1]!);
      else out.push({ t: "ul", items: [ul[1]!] });
    } else if (ol) {
      fin();
      if (dernier?.t === "ol") dernier.items.push(ol[1]!);
      else out.push({ t: "ol", items: [ol[1]!] });
    } else if (q) {
      fin();
      if (dernier?.t === "q") dernier.texte += ` ${q[1]}`;
      else out.push({ t: "q", texte: q[1]! });
    } else {
      para.push(ligne);
    }
  }
  fin();
  return out;
}

/**
 * Texte du cabinet mis en forme : # titres, **gras**, *italique*, listes, > encadrés, [liens](https://…).
 * Aucun HTML n'est interprété : le texte ne peut rien injecter dans la page.
 */
export function TexteRiche({ source, compact }: { source: string; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-2 text-[14px] leading-relaxed text-ink-2" : "space-y-4 text-[15.5px] leading-[1.75] text-ink-2"}>
      {blocs(source).map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case "h":
            return b.niveau === 1 ? (
              <h2 key={k} className="pt-2 font-display text-[21px] font-bold leading-snug text-ink">{enLigne(b.texte, k)}</h2>
            ) : (
              <h3 key={k} className="pt-1 text-[17px] font-semibold leading-snug text-ink">{enLigne(b.texte, k)}</h3>
            );
          case "ul":
            return (
              <ul key={k} className="space-y-1.5 pl-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span aria-hidden className="mt-[0.7em] h-1.5 w-1.5 flex-none rounded-full bg-accent-vif" />
                    <span>{enLigne(it, `${k}-${j}`)}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} className="space-y-2">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-3">
                    <span aria-hidden className="grid h-6 w-6 flex-none place-items-center rounded-full bg-accent-doux text-[12px] font-bold text-accent">{j + 1}</span>
                    <span>{enLigne(it, `${k}-${j}`)}</span>
                  </li>
                ))}
              </ol>
            );
          case "q":
            return (
              <div key={k} className="flex gap-3 rounded-xl border border-accent-vif/20 bg-accent-doux/60 px-4 py-3 text-ink">
                <CheckCircle2 className="mt-1 h-4 w-4 flex-none text-accent" />
                <p>{enLigne(b.texte, k)}</p>
              </div>
            );
          default:
            return <p key={k}>{enLigne(b.texte, k)}</p>;
        }
      })}
    </div>
  );
}

/** Titre de section du portail : un mot d'accroche au-dessus, un titre, une phrase dessous. */
export function EnTete({ surtitre, titre, texte, actions }: { surtitre?: string; titre: string; texte?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {surtitre && <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-accent">{surtitre}</div>}
        <h1 className="mt-1 font-display text-[28px] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[32px]">{titre}</h1>
        {texte && <p className="mt-2 text-[15px] leading-relaxed text-muted">{texte}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

