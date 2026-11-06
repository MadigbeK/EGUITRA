"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Notice, classesBouton, cx } from "@/components/ui";
import { useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { enregistrerFiche, figerEvaluation, useCriteres, useResultats } from "@/lib/axispro-api";
import { ETAT_CONDITION, TON_DECISION, apparenceDomaine, estV2, resultatsAnciens } from "@/lib/axispro-parcours";
import type { PassageGate, Resultats, VersionEvaluation } from "@/lib/axispro-types";
import { AIDE_NOMBRE, fmtDate, fmtFixe, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";
import { GRILLE_TUILES, TuileChiffre } from "./commun";
import { LienGarde, useDossier } from "./DossierParcours";

/** Gate dont le passage demande le DSCR saisi (section 7.6). */
const GATE_DSCR = 3;

function Score({ v }: { v: number }) {
  return (
    <>
      {fmtFixe(v, 1)}
      <span className="ml-1 text-[14px] font-semibold text-muted">/ 100</span>
    </>
  );
}

/**
 * Étape 4, résultats (EC-08) : tout se lit dans le dossier, recalculé par le noyau à chaque ouverture ; seules
 * les versions figées sont conservées. Un dossier de l'ancienne méthode, que la route refuse, voit les mêmes
 * tuiles établies sur son scoring, sans versions. Saisie du DSCR : profil cabinet, décision non scellée.
 */
export function EtapeResultats() {
  const { d } = useDossier();
  return estV2(d) ? <ResultatsDuNoyau /> : <ResultatsAnciens />;
}

function ResultatsDuNoyau() {
  const { d, relire } = useDossier();
  const { data, error, mutate } = useResultats(d.id);
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Calcul des résultats…">
      {(r: Resultats) => (
        <Vue
          r={r}
          apres={() => {
            void mutate();
            relire();
          }}
        />
      )}
    </Etat>
  );
}

function ResultatsAnciens() {
  const { d, relire } = useDossier();
  const { data: criteres } = useCriteres(d.id);
  return <Vue r={resultatsAnciens(d, criteres)} apres={relire} />;
}

function Vue({ r, apres }: { r: Resultats; apres: () => void }) {
  const t = r.tiles;
  const g = r.gate.index;
  return (
    <div className="space-y-4">
      <div className={GRILLE_TUILES}>
        <TuileChiffre label="Project Readiness Score" valeur={<Score v={t.readiness} />} />
        <TuileChiffre label="APD Readiness Score" valeur={<Score v={t.apd} />} />
        <TuileChiffre label="Bankability Score" valeur={<Score v={t.bankability} />} />
        <TuileChiffre label="Complétude documentaire" valeur={`${fmtFixe(t.completeness, 0)} %`} />
        <TuileChiffre label="Critères critiques manquants" valeur={t.critical_total === null ? fmtInt(t.critical_missing) : `${fmtInt(t.critical_missing)} / ${fmtInt(t.critical_total)}`} ton={t.critical_missing > 0 ? "warn" : "ok"} />
        <TuileChiffre label={`Knock-out actifs au Gate ${g}`} valeur={fmtInt(t.knockouts)} ton={t.knockouts > 0 ? "danger" : "ok"} />
        {r.target_gate && <TuileChiffre label={`Knock-out à lever pour le Gate ${r.target_gate.index}`} valeur={fmtInt(t.knockouts_next)} ton={t.knockouts_next > 0 ? "danger" : "ok"} />}
        <TuileChiffre label="Décision recommandée" valeur={t.decision_label ?? "–"} ton={t.decision ? (t.decision === "hold" ? "danger" : TON_DECISION[t.decision]) : "neutral"} />
      </div>
      {r.blocked.length > 0 && (
        <Notice tone="danger">
          <b>Bloqué :</b> {r.blocked.map((k) => k.name).join(" ; ")}.
        </Notice>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ScoreParDomaine domaines={r.domains} />
        <div className="min-w-0 space-y-4">
          {r.passage && r.passage.to !== null && <Passage passage={r.passage} gate={g} dscr={r.dscr} apres={apres} />}
          {r.versions && <Historique versions={r.versions} suivante={r.next_version} apres={apres} />}
        </div>
      </div>
    </div>
  );
}

function ScoreParDomaine({ domaines }: { domaines: Resultats["domains"] }) {
  return (
    <Card title="Score par domaine">
      <ul className="space-y-2">
        {domaines.map((x) => {
          const { priorite, classes } = apparenceDomaine(x);
          return (
            <li key={x.domain_id} className="grid grid-cols-[minmax(0,1fr)_2.25rem_4.75rem] items-center gap-x-2 gap-y-1 text-[13.5px] sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_2.25rem_4.75rem]">
              <span className="col-span-3 min-w-0 text-ink-2 sm:col-span-1">{x.name}</span>
              <span className="block h-2.5 overflow-hidden rounded bg-panel-3" aria-hidden>
                <span className={cx("block h-full rounded", classes.barre)} style={{ width: `${Math.max(0, Math.min(100, x.score ?? 0))}%` }} />
              </span>
              <span className="text-right font-semibold tabular text-ink">{x.score === null ? "-" : fmtFixe(x.score, 0)}</span>
              <span className={cx("text-[12px] font-bold", classes.texte)}>{priorite ?? "-"}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Passage({ passage, gate, dscr, apres }: { passage: PassageGate; gate: number; dscr: number | null; apres: () => void }) {
  const { d, peutEcrire } = useDossier();
  return (
    <Card title={`Passage au Gate ${passage.to} · ${passage.to_name}`}>
      {gate === GATE_DSCR && peutEcrire && <SaisieDscr dossierId={d.id} initial={dscr} apres={apres} />}
      <ul className="space-y-1">
        {passage.conditions.map((c) => (
          <li key={c.key} className="flex min-h-[36px] items-center justify-between gap-3 text-[14px] text-ink-2">
            <span className="min-w-0">{c.label}</span>
            <Badge tone={ETAT_CONDITION[c.state].ton}>{c.state_label ?? ETAT_CONDITION[c.state].label}</Badge>
          </li>
        ))}
      </ul>
      <LienGarde href={`/axispro/dossiers/${d.id}/comite`} className={classesBouton("secondary", "md", "mt-3 w-full justify-start")}>Présenter au comité</LienGarde>
    </Card>
  );
}

/** DSCR saisi au Gate 3, virgule décimale acceptée (RG-08-02) ; enregistré à la sortie du champ. */
function SaisieDscr({ dossierId, initial, apres }: { dossierId: number; initial: number | null; apres: () => void }) {
  const [v, setV] = useState(initial ? String(initial).replace(".", ",") : "");
  const { agir, bandeau } = useRetour();
  async function quitter() {
    const n = v.trim() ? lireNombre(v) : 0;
    if (n === null || n === (initial ?? 0)) return;
    const r = await agir(() => enregistrerFiche(dossierId, { dscr_manual: n }));
    if (r !== undefined) apres();
  }
  return (
    <div className="mb-3">
      <Field label="DSCR saisi" error={nombreIllisible(v) ? AIDE_NOMBRE : undefined}>
        <Input inputMode="decimal" className="max-w-[160px] font-mono" placeholder="1,30" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => void quitter()} />
      </Field>
      {bandeau && <div className="mt-2">{bandeau}</div>}
    </div>
  );
}

/** Nom de la prochaine version : « v3 », que le noyau serve son rang ou son libellé. */
function nomVersion(suivante: number | string | null, versions: VersionEvaluation[]): string {
  if (typeof suivante === "string") return suivante;
  return `v${suivante ?? versions.reduce((m, v) => Math.max(m, v.rank), 0) + 1}`;
}

/** Versions figées : enregistrées par le noyau, jamais modifiées. Figer : profil cabinet, projet non clos. */
function Historique({ versions, suivante, apres }: { versions: VersionEvaluation[]; suivante: number | string | null; apres: () => void }) {
  const { d } = useDossier();
  const { cabinet } = useCabinet();
  const { envoyer, enCours, bandeau } = useRetour();
  const prochaine = nomVersion(suivante, versions);
  async function figer() {
    const r = await envoyer(() => figerEvaluation(d.id), `Évaluation figée en ${prochaine}.`, "figer");
    if (r !== undefined) apres();
  }
  return (
    <Card title="Historique des évaluations">
      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          dense
          rows={versions}
          rowKey={(v) => v.id}
          empty="Aucune version figée."
          columns={[
            { key: "rank", label: "Version", render: (v) => v.label },
            { key: "date", label: "Date", render: (v) => fmtDate(v.date) },
            { key: "readiness", label: "Readiness", align: "right", render: (v) => fmtFixe(v.readiness, 1) },
            { key: "knockouts", label: "KO", align: "right", render: (v) => fmtInt(v.knockouts) },
          ]}
        />
      </div>
      {bandeau && <div className="mt-3">{bandeau}</div>}
      {cabinet && d.state !== "closed" && (
        <Button variant="primary" className="mt-3 w-full justify-start" loading={enCours === "figer"} onClick={() => void figer()}>Figer l&apos;évaluation en {prochaine}</Button>
      )}
    </Card>
  );
}
