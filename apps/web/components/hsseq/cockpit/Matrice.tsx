"use client";

import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";
import { Card, RankBars } from "@/components/ui";
import { MOTIFS, MatriceCriticite, NIVEAUX, ORDRE_NIVEAUX, fmtCible, fmtIndicateur, type CelluleMatrice } from "@/components/hsseq/commun";
import { fmtInt, pluriel } from "@/lib/format";
import type { CriticalityLevel, Cockpit, ReasonCode, WaiverBreakdown } from "@/lib/hsseq-types";
import { LIEN } from "./ATraiter";
import { decalerMois, liens } from "./outils";

/**
 * Matrice de criticité 5 × 5 des événements survenus sur la période (gravité potentielle ×
 * probabilité, la criticité retenue au §9.1), au périmètre du cockpit, servie par le noyau
 * (`events.matrix`) : le mois, ou les douze mois qui s'y terminent. Chaque niveau mène à sa liste.
 */
export function MatriceEvenements({ c }: { c: Cockpit }) {
  const f = c.filters;
  // Sur 12 mois glissants, la matrice couvre les douze mois : la liste aussi.
  const dates = { date_from: c.period.type === "12m" ? `${decalerMois(c.period.month, -11)}-01` : c.period.date_from, date_to: c.period.date_to };
  const cellules: CelluleMatrice[] = c.events.matrix.filter((x) => x.count > 0).map((x) => ({ gravite: x.potential_severity, probabilite: x.probability, nombre: x.count }));
  const parNiveau = (n: CriticalityLevel) => c.events.matrix.filter((x) => x.level === n).reduce((s, x) => s + x.count, 0);
  const classes = cellules.reduce((s, x) => s + x.nombre, 0);
  const total = classes + c.events.matrix_unclassified;
  return (
    <Card
      title="Criticité des événements de la période"
      actions={
        <Link href={liens.evenements(f, dates)} className={LIEN}>
          Événements de la période <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <MatriceCriticite label={`Événements de ${c.period.type === "12m" ? "12 mois glissants, " : ""}${c.period.label} par gravité potentielle et probabilité`} cellules={cellules} taille="normale" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] text-ink-2">
            <span className="font-semibold tabular text-ink">{fmtInt(total)}</span> {total > 1 ? "événements survenus" : "événement survenu"} sur la période, dont {pluriel(classes, "classé")} dans la matrice.
          </p>
          <ul className="mt-3 space-y-1.5">
            {[...ORDRE_NIVEAUX].reverse().map((n) => (
              <li key={n}>
                <Link href={liens.evenements(f, { ...dates, level: n })} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-panel-2">
                  <span className="inline-flex items-center gap-2 text-ink-2">
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: NIVEAUX[n].couleur }} />
                    {NIVEAUX[n].label}
                    <span className="text-muted tabular">
                      {NIVEAUX[n].min} à {NIVEAUX[n].max}
                    </span>
                  </span>
                  <span className="font-semibold tabular text-ink">{fmtInt(parNiveau(n))}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href={liens.evenements(f, { ...dates, status: "reported" })} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-panel-2">
                <span className="text-ink-2">Non classés, hors matrice</span>
                <span className="font-semibold tabular text-ink">{fmtInt(c.events.matrix_unclassified)}</span>
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

/**
 * Dérogations au verrou de la période : par site, le détail (`breakdown`) de l'indicateur « waivers » ;
 * par motif, les comptes servis par le noyau (`waivers_by_reason`, V02 et V04 à V09).
 */
export function Derogations({ c }: { c: Cockpit }) {
  const i = c.indicators.find((x) => x.code === "waivers");
  // Le noyau sert des couples site et motif : le classement par site en est la somme.
  const totaux = new Map<string, number>();
  for (const b of i?.breakdown ?? ([] as WaiverBreakdown[])) totaux.set(b.site, (totaux.get(b.site) ?? 0) + b.count);
  const sites = [...totaux].map(([key, value]) => ({ key, value }));
  const motifs = Object.entries(c.waivers_by_reason ?? {}).flatMap(([key, value]) => (value ? [{ key, value }] : []));
  const format = (v: number) => fmtInt(v);
  return (
    <Card
      title="Dérogations au verrou"
      actions={
        <Link href={liens.derogations()} className={LIEN}>
          File des dérogations <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {!i ? (
        <p className="text-sm text-muted">Indicateur non servi par le noyau.</p>
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">
            <span className="font-semibold tabular text-ink">{fmtIndicateur(i.value, i.unit)}</span> sur la période (cible {fmtCible(i.target, i.unit, i.direction)}). Chacune est demandée par le chef de parc, validée par le Responsable HSSEQ et notifiée au Directeur général.
          </p>
          {sites.length === 0 && motifs.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Aucune dérogation sur la période.</p>
          ) : (
            <div className="mt-5 grid gap-6 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div>
                <h3 className="mb-3 text-[13px] font-semibold text-ink-2">Par site</h3>
                <RankBars items={[...sites].sort((a, b) => b.value - a.value).map((b) => ({ key: b.key, label: b.key, value: b.value }))} format={format} />
              </div>
              <div>
                <h3 className="mb-3 text-[13px] font-semibold text-ink-2">Par motif</h3>
                <RankBars
                  items={[...motifs].sort((a, b) => b.value - a.value).map((b) => ({ key: b.key, label: b.key in MOTIFS ? `${b.key} · ${MOTIFS[b.key as ReasonCode].court}` : b.key, value: b.value, detail: b.key in MOTIFS ? MOTIFS[b.key as ReasonCode].libelle : undefined }))}
                  format={format}
                />
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
