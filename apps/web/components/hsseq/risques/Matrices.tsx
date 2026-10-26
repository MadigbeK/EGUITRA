"use client";

import { useState } from "react";
import { X } from "@/components/icons";
import { Button, Card, ErrorBox, Etat } from "@/components/ui";
import { MatriceCriticite, NIVEAUX, ORDRE_NIVEAUX } from "@/components/hsseq/commun";
import { Pages, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtInt, pluriel } from "@/lib/format";
import type { CriticalityLevel, CriticalityThreshold, Page, Score } from "@/lib/hsseq-types";
import { versApiCase, type CaseMatrice, type FiltresRegistre } from "./adresse";
import { NIVEAU_RISQUES } from "./libelles";
import { TableRisques } from "./TableRisques";
import type { RiskCounts, RiskLine, RiskMatrix, RiskMatrixCell } from "./types";

/** Risques d'une case par page. */
const PAR_PAGE = 50;


/** Risques par niveau, comptés sur les cases (niveaux du noyau, selon les seuils de la société). */
function parNiveau(cellules: RiskMatrixCell[]): Record<CriticalityLevel, number> {
  const n: Record<CriticalityLevel, number> = { low: 0, moderate: 0, significant: 0, high: 0 };
  for (const c of cellules) n[c.level] += c.count;
  return n;
}

/**
 * Vue « Matrices » : matrices 5 × 5 brute et résiduelle de la sélection filtrée, côte à côte (GET
 * /hsseq/risks/matrix, mêmes filtres que la liste). Un clic sur une case la choisit (adresse : case) et
 * liste ses risques dessous ; un nombre du tableau des niveaux ouvre la liste filtrée sur ce niveau.
 */
export function Matrices({ api, f, ecrire }: { api: Record<string, string | number | null>; f: FiltresRegistre; ecrire: (maj: Record<string, string | number | null>) => void }) {
  const { data, error, mutate } = useApi<RiskMatrix>(`/hsseq/risks/matrix?${requete(api)}`, { keepPreviousData: true });
  const { data: ref } = useReferentiels();
  if (!data) {
    return (
      <Card>
        <Etat error={error} onRetry={() => void mutate()} label="Comptage des risques…" />
      </Card>
    );
  }
  const brute = parNiveau(data.raw);
  const residuelle = parNiveau(data.residual);
  const choisie = f.case_;
  const cellule = choisie ? (choisie.cote === "brute" ? data.raw : data.residual).find((c) => c.severity === choisie.gravite && c.probability === choisie.probabilite) : undefined;
  const choisir = (cote: CaseMatrice["cote"]) => (g: Score, p: Score) => {
    const deja = choisie?.cote === cote && choisie.gravite === g && choisie.probabilite === p;
    ecrire({ case: deja ? null : `${cote}-${g}-${p}` });
  };
  return (
    <div className="space-y-5">
      {error && <ErrorBox error={error} onRetry={() => void mutate()} />}
      <Card title="Matrices de criticité" actions={<span className="text-[12.5px] text-muted">Une case choisie liste ses risques</span>}>
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          <span className="font-semibold tabular text-ink">{fmtInt(data.total)}</span> {data.total > 1 ? "risques dans la sélection" : "risque dans la sélection"}. Criticité élevée&nbsp;: {fmtInt(brute.high)} avant mesures, {fmtInt(residuelle.high)} après.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-12 gap-y-8">
          <Matrice titre="Avant mesures" sous="Criticité brute, sans mesure de maîtrise" cellules={data.raw} choisie={choisie?.cote === "brute" ? choisie : null} onChoisir={choisir("brute")} />
          <Matrice titre="Après mesures" sous="Criticité résiduelle, mesures en place" cellules={data.residual} choisie={choisie?.cote === "residuelle" ? choisie : null} onChoisir={choisir("residuelle")} />
        </div>
        <TableauNiveaux brute={brute} residuelle={residuelle} seuils={ref?.criticality_thresholds} onNiveau={(cle, n) => ecrire({ vue: null, case: null, [cle]: n })} />
      </Card>
      {choisie && cellule && <RisquesDeLaCase api={api} choisie={choisie} cellule={cellule} risque={f.risque} ecrire={ecrire} />}
    </div>
  );
}

/** Une matrice et son titre ; la case choisie est marquée. */
function Matrice({ titre, sous, cellules, choisie, onChoisir }: { titre: string; sous: string; cellules: RiskMatrixCell[]; choisie: CaseMatrice | null; onChoisir: (g: Score, p: Score) => void }) {
  return (
    <section className="min-w-0">
      <h3 className="text-[14px] font-semibold text-ink">{titre}</h3>
      <p className="mb-3 text-[12.5px] text-muted">{sous}</p>
      <MatriceCriticite
        label={`${titre}${INSECABLE}: risques par gravité et probabilité`}
        taille="normale"
        legende={false}
        cellules={cellules.map((c) => ({ gravite: c.severity, probabilite: c.probability, nombre: c.count }))}
        valeur={choisie ? { gravite: choisie.gravite, probabilite: choisie.probabilite } : null}
        onChoisir={onChoisir}
      />
    </section>
  );
}

/** Risques par niveau avant et après mesures ; chaque nombre ouvre la liste filtrée sur ce niveau. */
function TableauNiveaux({ brute, residuelle, seuils, onNiveau }: { brute: Record<CriticalityLevel, number>; residuelle: Record<CriticalityLevel, number>; seuils?: CriticalityThreshold[]; onNiveau: (cle: "brut" | "niveau", n: CriticalityLevel) => void }) {
  const nombre = (valeur: number, cle: "brut" | "niveau", n: CriticalityLevel) => (
    <button
      type="button"
      disabled={valeur === 0}
      onClick={() => onNiveau(cle, n)}
      aria-label={`Lister ${valeur > 1 ? `les ${valeur} risques` : "le risque"} ${valeur > 1 ? NIVEAU_RISQUES[n][1] : NIVEAU_RISQUES[n][0]} ${cle === "brut" ? "avant" : "après"} mesures`}
      className="min-w-9 rounded-lg px-2 py-1 font-semibold tabular text-ink transition-colors hover:bg-panel-2 hover:text-accent disabled:cursor-default disabled:font-medium disabled:text-muted disabled:hover:bg-transparent"
    >
      {fmtInt(valeur)}
    </button>
  );
  return (
    <table className="mt-6 w-full max-w-lg text-[13px]">
      <caption className="sr-only">Risques par niveau de criticité, avant et après mesures</caption>
      <thead>
        <tr className="text-[12px] text-muted">
          <th scope="col" className="py-1.5 text-left font-medium">
            Niveau
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Avant mesures
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Après mesures
          </th>
        </tr>
      </thead>
      <tbody>
        {[...ORDRE_NIVEAUX].reverse().map((n) => {
          const s = seuils?.find((t) => t.level === n) ?? NIVEAUX[n];
          return (
            <tr key={n} className="border-t border-line/70">
              <th scope="row" className="py-1 pr-3 text-left font-normal">
                <span className="inline-flex items-center gap-2 text-ink-2">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: NIVEAUX[n].couleur }} />
                  {NIVEAUX[n].label}
                  <span className="text-muted tabular">{`${s.min}–${s.max}`}</span>
                </span>
              </th>
              <td className="py-1 text-right">{nombre(brute[n], "brut", n)}</td>
              <td className="py-1 text-right">{nombre(residuelle[n], "niveau", n)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Risques d'une case, filtrés par le noyau (raw_severity et raw_probability, ou residual_severity et
 * residual_probability) avec les filtres du registre, par pages : la criticité la plus forte de l'autre
 * cotation d'abord.
 */
function RisquesDeLaCase({ api, choisie, cellule, risque, ecrire }: { api: Record<string, string | number | null>; choisie: CaseMatrice; cellule: RiskMatrixCell; risque: number | null; ecrire: (maj: Record<string, string | number | null>) => void }) {
  const brute = choisie.cote === "brute";
  const filtre = { ...api, ...versApiCase(choisie), sort: brute ? "-residual_criticality" : "-raw_criticality" };
  const cle = requete(filtre);
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const { data, error, mutate } = useApi<Page<RiskLine, RiskCounts>>(`/hsseq/risks?${requete({ ...filtre, offset, limit: PAR_PAGE })}`, { keepPreviousData: true });
  return (
    <Card
      padded={false}
      title={`Gravité ${choisie.gravite} × probabilité ${choisie.probabilite}, ${brute ? "avant mesures" : "après mesures"}`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => ecrire({ case: null })}>
          <X className="h-3.5 w-3.5" /> Retirer la case
        </Button>
      }
    >
      <p className="px-6 pb-3 text-[13px] text-muted">
        Criticité {cellule.criticality}, {NIVEAUX[cellule.level].label.toLocaleLowerCase("fr")}
        {`${INSECABLE}: ${pluriel(data?.total_count ?? cellule.count, "risque")}.`}
      </p>
      {!data ? (
        <Etat error={error} onRetry={() => void mutate()} label="Chargement des risques de la case…" />
      ) : (
        <>
          {error && (
            <div className="px-4 pb-3">
              <ErrorBox error={error} onRetry={() => void mutate()} />
            </div>
          )}
          <TableRisques lignes={data.items} choisi={risque} compacte={risque !== null} onOuvrir={(id) => ecrire({ risque: id })} vide="Aucun risque dans cette case." />
          <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="risques de la case" onPage={(o) => setPosition({ cle, offset: o })} />
        </>
      )}
    </Card>
  );
}
