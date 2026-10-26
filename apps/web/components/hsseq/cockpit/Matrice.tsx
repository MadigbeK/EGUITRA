"use client";

import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";
import { Card, Etat, RankBars } from "@/components/ui";
import { MOTIFS, MatriceCriticite, NIVEAUX, ORDRE_NIVEAUX, fmtCible, fmtIndicateur, type CelluleMatrice } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import { fmtInt, pluriel } from "@/lib/format";
import type { Cockpit, EventCounts, EventLine, Page, ReasonCode, Score, WaiverBreakdown } from "@/lib/hsseq-types";
import { LIEN } from "./ATraiter";
import { chaine, liens } from "./outils";

/** Plus grande page permise par le contrat (§1) : la matrice compte au plus ces événements. */
const PLAFOND = 500;

/**
 * Matrice de criticité 5 × 5 des événements survenus sur la période (gravité potentielle ×
 * probabilité, la criticité retenue au §9.1), au périmètre du cockpit. Le cockpit ne sert pas cette
 * matrice : elle est comptée sur la liste des événements de la période. Chaque niveau mène à sa liste.
 */
export function MatriceEvenements({ c }: { c: Cockpit }) {
  const f = c.filters;
  const dates = { date_from: c.period.date_from, date_to: c.period.date_to };
  const { data, error, mutate } = useApi<Page<EventLine, EventCounts>>(
    `/hsseq/events${chaine({ ...dates, company_id: f.company_id, site_id: f.site_id, vehicle_kind: f.vehicle_kind, sort: "-occurred_at", limit: PLAFOND })}`,
  );
  return (
    <Card
      title="Criticité des événements de la période"
      actions={
        <Link href={liens.evenements(f, dates)} className={LIEN}>
          Événements de la période <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <Etat data={data} error={error} onRetry={() => mutate()} label="Comptage des événements…">
        {(page) => {
          const cellules = compter(page.items);
          const classes = cellules.reduce((s, x) => s + x.nombre, 0);
          const parNiveau = page.counts.by_level;
          return (
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              <MatriceCriticite label={`Événements de ${c.period.label} par gravité potentielle et probabilité`} cellules={cellules} taille="normale" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] text-ink-2">
                  <span className="font-semibold tabular text-ink">{fmtInt(page.total_count)}</span> {page.total_count > 1 ? "événements déclarés" : "événement déclaré"} sur la période, dont {pluriel(classes, "classé")} dans la matrice.
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
                        <span className="font-semibold tabular text-ink">{fmtInt(parNiveau[n])}</span>
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link href={liens.evenements(f, { ...dates, status: "reported" })} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-panel-2">
                      <span className="text-ink-2">Non classés, hors matrice</span>
                      <span className="font-semibold tabular text-ink">{fmtInt(parNiveau.unclassified)}</span>
                    </Link>
                  </li>
                </ul>
                {page.total_count > page.items.length && (
                  <p className="mt-3 text-[12px] leading-snug text-muted">
                    Matrice établie sur les {fmtInt(page.items.length)} événements les plus récents ; les nombres par niveau portent sur les {fmtInt(page.total_count)}.
                  </p>
                )}
              </div>
            </div>
          );
        }}
      </Etat>
    </Card>
  );
}

/** Événements classés, comptés par case (gravité potentielle, probabilité). */
function compter(items: EventLine[]): CelluleMatrice[] {
  const cases = new Map<string, CelluleMatrice>();
  for (const e of items) {
    if (!e.potential_severity || !e.probability) continue;
    const cle = `${e.potential_severity}|${e.probability}`;
    const x = cases.get(cle) ?? { gravite: e.potential_severity as Score, probabilite: e.probability as Score, nombre: 0 };
    x.nombre += 1;
    cases.set(cle, x);
  }
  return [...cases.values()];
}

/**
 * Dérogations au verrou de la période, par site et par motif : le détail (`breakdown`) de
 * l'indicateur « waivers » du cockpit.
 */
export function Derogations({ c }: { c: Cockpit }) {
  const i = c.indicators.find((x) => x.code === "waivers");
  // Le noyau sert des couples site et motif : les deux classements en sont des sommes.
  const somme = (cle: (b: WaiverBreakdown) => string) => {
    const totaux = new Map<string, number>();
    for (const b of i?.breakdown ?? []) totaux.set(cle(b), (totaux.get(cle(b)) ?? 0) + b.count);
    return [...totaux].map(([key, value]) => ({ key, value }));
  };
  const sites = somme((b) => b.site);
  const motifs = somme((b) => b.reason_code);
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
