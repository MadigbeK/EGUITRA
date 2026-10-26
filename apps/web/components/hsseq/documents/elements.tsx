"use client";

/**
 * Briques d'affichage de l'écran « Documents et urgences » : lecture d'un document (taux, comptes qui
 * n'ont pas lu, lectures datées), journal d'une fiche, texte où les noms relevés par le contrôle
 * d'anonymat sont surlignés, numéros d'appel en un geste, liste des contacts de crise.
 */

import { Children, Fragment, type ReactNode } from "react";
import { Mail, Smartphone } from "@/components/icons";
import { ProgressBar, Tag, classesBouton, cx } from "@/components/ui";
import { INSECABLE, fmtDate, fmtDateTime, fmtInt, fmtPct, pluriel } from "@/lib/format";
import type { Ref } from "@/lib/hsseq-types";
import { CHAMP_JOURNAL, OPERATION, VALEURS_MONTREES, TamponDocument, lienTel, numeroLisible } from "./libelles";
import type { CrisisContact, LigneJournal, ReadStats, Reader } from "./types";

/** Commandes d'une fiche, en ligne ; rien quand le compte n'en a aucune. */
export function Commandes({ children }: { children: ReactNode }) {
  if (!Children.toArray(children).length) return null;
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/* ─── Lecture d'un document ───────────────────────────────────────────── */

/**
 * Lecture de la version en vigueur d'une procédure ou d'une alerte diffusée : taux, jauge et comptes
 * visés ; puis, pour qui lit les noms, les comptes qui n'ont pas lu et les lectures datées (web ou
 * NIMOVA Terrain). L'auditeur n'a que le taux : le noyau ne lui sert pas les noms.
 */
export function Lecture({ stats, readers, unread }: { stats: ReadStats; readers: Reader[] | null; unread: Ref[] | null }) {
  const complet = stats.targets > 0 && stats.read === stats.targets;
  const lectures = [...(readers ?? [])].sort((a, b) => b.read_at.localeCompare(a.read_at));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="m-0 font-display text-[26px] font-[650] leading-none tracking-[-0.02em] text-ink tabular">{stats.rate === null ? "–" : fmtPct(stats.rate, 1)}</p>
        <p className="m-0 text-[13px] text-ink-2 tabular">{stats.targets ? `${fmtInt(stats.read)} sur ${pluriel(stats.targets, "compte visé", "comptes visés")}` : "Aucun compte visé"}</p>
      </div>
      <ProgressBar value={stats.rate ?? 0} tone={complet ? "ok" : "accent"} />
      {stats.targets === 0 && <p className="m-0 text-[12.5px] leading-snug text-muted">Aucun compte ne porte les profils visés sur ces sites&nbsp;: vérifiez le public visé.</p>}
      {readers === null || unread === null ? (
        stats.targets > 0 && <p className="m-0 text-[12.5px] leading-snug text-muted">Taux seul&nbsp;: les noms des lecteurs ne sont pas communiqués à votre profil.</p>
      ) : (
        <>
          {unread.length > 0 && (
            <div>
              <p className="m-0 mb-1.5 text-[12px] text-muted">Pas encore lu ({fmtInt(unread.length)})</p>
              <ul className="flex flex-wrap gap-1.5">
                {unread.map((u) => (
                  <li key={u.id}>
                    <Tag>{u.name}</Tag>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lectures.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Lectures accusées ({fmtInt(lectures.length)})</summary>
              <ul className="mt-2 divide-y divide-line/80 text-[13px]">
                {lectures.map((r) => (
                  <li key={r.user.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                    <span className="text-ink">{r.user.name}</span>
                    <span className="whitespace-nowrap text-[12px] text-muted">
                      {fmtDateTime(r.read_at)}, {r.source === "terrain" ? "NIMOVA Terrain" : "web"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/** Taux de lecture d'une ligne de liste : le pourcentage et « 4 sur 6 », ou « – » sans version en vigueur. */
export function TauxLecture({ stats }: { stats: ReadStats | null }) {
  if (!stats) return <span className="text-muted">–</span>;
  if (!stats.targets) return <span className="whitespace-nowrap text-[12.5px] text-muted">Aucun compte visé</span>;
  return (
    <span className="inline-flex min-w-[7.5rem] flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-ink tabular">{stats.rate === null ? "–" : fmtPct(stats.rate, 0)}</span>
        <span className="whitespace-nowrap text-[12px] text-muted tabular">
          {fmtInt(stats.read)} sur {fmtInt(stats.targets)}
        </span>
      </span>
      <ProgressBar value={stats.rate ?? 0} tone={stats.read === stats.targets ? "ok" : "accent"} epaisseur={5} />
    </span>
  );
}

/* ─── Journal ─────────────────────────────────────────────────────────── */

/**
 * Historique d'une fiche, du plus récent au plus ancien : opération, champ modifié et, pour les champs
 * courts, valeurs avant et après ; `valeur` met une valeur codée en clair (statut, scénario…).
 */
export function Historique({ lignes, valeur }: { lignes: LigneJournal[]; valeur?: (champ: string, v: string) => string }) {
  if (!lignes.length) return null;
  const tries = [...lignes].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  const clair = (champ: string, v: string) => (champ.endsWith("_date") ? fmtDate(v) : (valeur?.(champ, v) ?? v));
  /** « (état, de « En rédaction » à « En vigueur ») », ou le seul nom du champ pour un texte long. */
  const detail = (h: LigneJournal): string => {
    if (!h.field) return "";
    const nom = CHAMP_JOURNAL[h.field] ?? h.field;
    if (!VALEURS_MONTREES.has(h.field)) return ` (${nom})`;
    const g = `«${INSECABLE}`;
    const d = `${INSECABLE}»`;
    if (h.old_value && h.new_value) return ` (${nom}, de ${g}${clair(h.field, h.old_value)}${d} à ${g}${clair(h.field, h.new_value)}${d})`;
    if (h.new_value) return ` (${nom}, ${g}${clair(h.field, h.new_value)}${d})`;
    if (h.old_value) return ` (${nom}, ${g}${clair(h.field, h.old_value)}${d} retiré)`;
    return ` (${nom})`;
  };
  return (
    <details className="group">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Historique ({fmtInt(lignes.length)})</summary>
      <ol className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-ink-2">
        {tries.map((h) => (
          <li key={h.id}>
            <span className="text-muted">{fmtDateTime(h.at)}</span>, {h.by?.name ?? "Système"}
            {`${INSECABLE}: ${OPERATION[h.action] ?? h.action}`}
            {detail(h)}
            {h.note && <span className="text-muted">{` (${h.note.length > 140 ? `${h.note.slice(0, 140).trimEnd()}…` : h.note})`}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ─── Texte surligné ──────────────────────────────────────────────────── */

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Texte où les valeurs relevées (noms de personnes, immatriculations) sont surlignées, sans tenir
 * compte de la casse. Une forme que le noyau a reconnue autrement (nom inversé, plaque écrite avec des
 * espaces) reste nommée dans la liste des constats, sans surlignage.
 */
export function Surligne({ texte, valeurs }: { texte: string; valeurs: string[] }) {
  const motifs = [...new Set(valeurs.map((v) => v.trim()).filter((v) => v.length >= 2))].sort((a, b) => b.length - a.length).map(echapper);
  if (!motifs.length) return <>{texte}</>;
  const morceaux = texte.split(new RegExp(`(${motifs.join("|")})`, "gi"));
  return (
    <>
      {morceaux.map((m, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-danger-doux px-0.5 font-semibold text-danger">
            {m}
          </mark>
        ) : (
          <Fragment key={i}>{m}</Fragment>
        ),
      )}
    </>
  );
}

/* ─── Annuaire de crise ───────────────────────────────────────────────── */

/**
 * Numéro d'appel en un geste (lien tel:) : un vrai bouton de 44 px au téléphone, le numéro groupé
 * comme on le dicte. Le premier numéro d'un contact est le bouton principal.
 */
export function Appeler({ numero, principal, nom }: { numero: string; principal?: boolean; nom: string }) {
  const lisible = numeroLisible(numero);
  return (
    <a href={lienTel(numero)} className={classesBouton(principal ? "primary" : "secondary", "md", "max-sm:min-h-11 tabular")} aria-label={`Appeler ${nom} au ${lisible}`}>
      <Smartphone className="h-4 w-4" aria-hidden />
      {lisible}
    </a>
  );
}

/**
 * Contacts de crise dans l'ordre d'appel : rang, fonction, nom et organisme, précisions ; numéros en
 * boutons d'appel, courriel en lien. `actions` ajoute les commandes du Responsable HSSEQ à chaque contact.
 */
export function ListeContacts({ contacts, actions, sansSite }: { contacts: CrisisContact[]; actions?: (c: CrisisContact) => ReactNode; sansSite?: boolean }) {
  return (
    <ol className="divide-y divide-line/80">
      {contacts.map((c) => (
        <li key={c.id} className={cx("flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between", !c.active && "opacity-70")}>
          <div className="flex min-w-0 gap-3">
            <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent-doux text-[13px] font-bold text-accent tabular">
              {c.call_order}
            </span>
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-semibold leading-snug text-ink">
                <span className="sr-only">{`Appelé en position ${c.call_order}${INSECABLE}: `}</span>
                {c.function}
                {!c.active && <TamponDocument mot="Retiré" />}
              </p>
              <p className="m-0 mt-0.5 text-[13px] leading-snug text-ink-2">
                {c.name}
                {c.organization ? `, ${c.organization}` : ""}
                {!sansSite && !c.site ? <span className="text-muted">, tous les sites</span> : null}
              </p>
              {c.note && <p className="m-0 mt-1 text-[12.5px] leading-snug text-muted">{c.note}</p>}
              {c.email && (
                <a href={`mailto:${c.email}`} className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline">
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  {c.email}
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-none flex-wrap items-center gap-2 pl-11 sm:pl-0">
            <Appeler numero={c.phone} principal nom={c.name} />
            {c.phone2 && <Appeler numero={c.phone2} nom={c.name} />}
            {actions?.(c)}
          </div>
        </li>
      ))}
    </ol>
  );
}
