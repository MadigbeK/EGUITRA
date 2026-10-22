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

/* ─── Dates ────────────────────────────────────────────────────────────── */

const JOUR = 86_400_000;

function debutDuJour(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** « aujourd'hui », « demain », « dans 5 jours », « il y a 3 jours », sinon la date. */
export function quand(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  const ecart = Math.round((debutDuJour(d) - debutDuJour(new Date())) / JOUR);
  if (ecart === 0) return "aujourd'hui";
  if (ecart === 1) return "demain";
  if (ecart === -1) return "hier";
  if (ecart > 1 && ecart < 30) return `dans ${ecart} jours`;
  if (ecart < -1 && ecart > -30) return `il y a ${-ecart} jours`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: ecart > 300 || ecart < -300 ? "numeric" : undefined });
}

/** « mardi 4 novembre, 10 h 30 » */
export function dateLongue(value: string | null | undefined, avecHeure = true): string {
  if (!value) return "";
  const d = new Date(value);
  const jour = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  if (!avecHeure) return jour;
  return `${jour}, ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

export function heure(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Valeur d'un champ datetime-local (heure locale) vers l'ISO UTC attendu par l'API, et retour. */
export function versIso(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

export function versLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
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
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
}

/** Télécharge un fichier .ics : le rendez-vous ou l'événement s'ajoute à l'agenda du téléphone. */
export function ajouterAuCalendrier({ titre, debut, fin, lieu, description, uid }: { titre: string; debut: string; fin?: string | null; lieu?: string | null; description?: string | null; uid: string }) {
  const start = new Date(debut);
  const end = fin ? new Date(fin) : new Date(start.getTime() + 3_600_000);
  const lignes = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MB AxisPro//Portail//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${uid}@portail.mbaxispro`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsTexte(titre)}`, lieu ? `LOCATION:${icsTexte(lieu)}` : "", description ? `DESCRIPTION:${icsTexte(description)}` : "",
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${icsTexte(titre)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  const url = URL.createObjectURL(new Blob([lignes.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
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

