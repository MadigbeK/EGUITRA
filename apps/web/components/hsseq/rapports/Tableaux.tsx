"use client";

import { Badge, Card, Input, Notice, Repartition, Segmented, cx } from "@/components/ui";
import { ETATS } from "@/lib/couleurs";
import { fmtDateTime, fmtPct, pluriel } from "@/lib/format";
import type { IndicatorStatus } from "@/lib/hsseq-types";
import { CUMUL, MODE, NATURES_PLURIEL, ORDRE_ETATS, deMois, ecrireNombre, fmtAvecUnite, fmtPlan, fmtValeur, libelleUnite, lireNombre, moisCourt, motEtat, tonEtat } from "./outils";
import type { MonthlyReport, ReportHistoryEntry, ReportIndicator, ReportNature, ReportTemplate } from "./types";

/** Saisies en cours d'un mois : textes tapés, comparés au rapport servi pour n'envoyer que les changements. */
export interface Brouillon {
  /** Valeur saisie du mois, par indicateur à saisie manuelle. */
  valeurs: Record<number, string>;
  /** Commentaire du mois, par indicateur. */
  commentaires: Record<number, string>;
  /** Commentaire général du mois ; nul : inchangé. */
  commentaire: string | null;
}

export const BROUILLON_VIDE: Brouillon = { valeurs: {}, commentaires: {}, commentaire: null };

const COULEUR_ETAT: Record<IndicatorStatus, string> = { met: ETATS.bon, watch: ETATS.attention, missed: ETATS.alerte, no_data: ETATS.neutre };

/* ─── Synthèse du comité ──────────────────────────────────────────────── */

/**
 * Synthèse du comité, servie par le noyau (summary) et lue comme le comité mensuel du cockpit : santé
 * globale des indicateurs sur le cumul de l'année, puis points d'attention (non conformes d'abord).
 */
export function Synthese({ r, modele }: { r: MonthlyReport; modele: ReportTemplate | null }) {
  const s = r.summary;
  const sens = new Map(r.indicators.map((i) => [i.id, i.direction]));
  return (
    <Card title="Synthèse du comité">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section aria-labelledby="rapport-sante" className="xl:col-span-5">
          <h3 id="rapport-sante" className="text-[15px] font-semibold text-ink">
            1. Santé globale des indicateurs
          </h3>
          <p className="mb-4 mt-1 text-[13px] text-muted">
            {s.health === null ? "Aucun indicateur renseigné sur la période." : `${fmtPct(s.health, 1)} des indicateurs renseignés tiennent leur cible cumulée, ${r.period_label.toLocaleLowerCase("fr")}.`}
          </p>
          <Repartition parts={ORDRE_ETATS.map((e) => ({ key: e, label: motEtat(e), value: s.by_status[e], color: COULEUR_ETAT[e] }))} format={(v) => pluriel(v, "indicateur")} />
          <p className="mt-3 text-[12px] leading-snug text-muted">
            État du cumul de l&apos;année au regard de la cible cumulée.
            {modele ? ` Conforme à partir de ${fmtPct(modele.compliant_ratio * 100, 0)} de la cible, sous surveillance à partir de ${fmtPct(modele.watch_ratio * 100, 0)} (seuils du modèle) ; une cible nulle n'a pas de marge.` : ""} Un seuil d&apos;alerte propre à un indicateur remplace la marge.
          </p>
        </section>
        <section aria-labelledby="rapport-attention" className="xl:col-span-7">
          <h3 id="rapport-attention" className="text-[15px] font-semibold text-ink">
            2. Points d&apos;attention à discuter
          </h3>
          {s.attention_points.length === 0 ? (
            <div className="mt-3">
              <Notice tone="ok">Tous les indicateurs renseignés tiennent leur cible cumulée.</Notice>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-line/80">
              {s.attention_points.map((a) => (
                <li key={a.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-[13.5px] font-medium text-ink">
                      <span className="mr-1.5 font-mono text-[12px] text-muted">{a.code}</span>
                      {a.label}
                    </p>
                    <Badge tone={tonEtat(a.status)}>{motEtat(a.status)}</Badge>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted">
                    Cumul {fmtAvecUnite(a.ytd, a.unit)} pour une cible cumulée {fmtPlan(a.ytd_target, a.unit, sens.get(a.id) ?? "up")}.
                  </p>
                  {a.comment && <p className="mt-1 text-[12.5px] leading-snug text-ink-2">« {a.comment} »</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

/* ─── Indicateurs ─────────────────────────────────────────────────────── */

export type Lecture = "cumul" | "mois";

/**
 * Indicateurs du mois, proactifs puis réactifs. « Mois et cumul » : plan et réalisé du mois, cumul de
 * l'année, état, commentaire ; les valeurs à saisie manuelle et les commentaires s'y saisissent quand
 * le compte le peut (rights.can_edit). « Mois par mois » : le réalisé de chaque mois depuis janvier,
 * marqué comme au comité (losange : cible manquée ; orange : à moins de la marge).
 */
export function Indicateurs({ r, lecture, onLecture, saisie, brouillon, onValeur, onCommentaire }: {
  r: MonthlyReport;
  lecture: Lecture;
  onLecture: (l: Lecture) => void;
  saisie: boolean;
  brouillon: Brouillon;
  onValeur: (id: number, texte: string) => void;
  onCommentaire: (id: number, texte: string) => void;
}) {
  const parNature = (n: ReportNature) => r.indicators.filter((i) => i.nature === n);
  return (
    <Card
      title={`Indicateurs ${deMois(r.month)}`}
      actions={
        <Segmented
          label="Lecture des indicateurs"
          value={lecture}
          onChange={onLecture}
          options={[
            { key: "cumul", label: "Mois et cumul" },
            { key: "mois", label: "Mois par mois" },
          ]}
        />
      }
    >
      {saisie && lecture === "mois" && <p className="mb-2 text-[12.5px] text-muted">Les valeurs et les commentaires se saisissent dans la lecture « Mois et cumul ».</p>}
      {r.indicators.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Ce modèle n&apos;a aucun indicateur en service.</p>
      ) : (
        (["proactive", "reactive"] as const).map((n, k) => {
          const lignes = parNature(n);
          if (!lignes.length) return null;
          const titre = `${k + 1}. ${NATURES_PLURIEL[n]}`;
          return lecture === "cumul" ? (
            <TableCumul key={n} titre={titre} r={r} lignes={lignes} saisie={saisie} brouillon={brouillon} onValeur={onValeur} onCommentaire={onCommentaire} />
          ) : (
            <TableMois key={n} titre={titre} r={r} lignes={lignes} />
          );
        })
      )}
    </Card>
  );
}

/** Repère d'écart dans une case : un losange, la forme de l'alerte (comme au comité). */
function Ecart() {
  return (
    <>
      <svg viewBox="0 0 8 8" aria-hidden focusable="false" className="mr-1 inline-block h-[7px] w-[7px] align-[1px]">
        <path d="M4 0 8 4 4 8 0 4Z" fill="currentColor" />
      </svg>
      <span className="sr-only">cible manquée : </span>
    </>
  );
}

/** Valeur d'une case, colorée selon l'état de son mois ou de son cumul. */
function Valeur({ v, unite, etat, gras }: { v: number | null; unite: string | null; etat: IndicatorStatus; gras?: boolean }) {
  return (
    <span className={cx("whitespace-nowrap", etat === "missed" ? "font-semibold text-danger" : etat === "watch" ? "font-medium text-warn" : "text-ink", gras && "font-semibold")}>
      {etat === "missed" && <Ecart />}
      {etat === "watch" && <span className="sr-only">à surveiller : </span>}
      {fmtValeur(v, unite)}
    </span>
  );
}

/** Libellé d'un indicateur et sa ligne d'unité, de mode et de cumul. */
function Libelle({ i }: { i: ReportIndicator }) {
  return (
    <>
      {i.label}
      <span className="block text-[11.5px] font-normal text-muted">
        {libelleUnite(i.unit)} · {MODE[i.mode].toLocaleLowerCase("fr")} · cumul : {CUMUL[i.aggregation].toLocaleLowerCase("fr")}
      </span>
    </>
  );
}

const CADRE = "mt-3 overflow-x-auto rounded-xl border border-line outline-offset-2";
const ENTETE = "border-b border-line bg-panel-2 text-[12px] font-semibold text-muted";

function TableCumul({ titre, r, lignes, saisie, brouillon, onValeur, onCommentaire }: {
  titre: string;
  r: MonthlyReport;
  lignes: ReportIndicator[];
  saisie: boolean;
  brouillon: Brouillon;
  onValeur: (id: number, texte: string) => void;
  onCommentaire: (id: number, texte: string) => void;
}) {
  const mois = moisCourt(r.month);
  return (
    <section aria-label={titre.replace(/^\d+\.\s*/, "")} className="mt-5 first:mt-1">
      <h3 className="text-[15px] font-semibold text-ink">{titre}</h3>
      <div role="region" aria-label={`Tableau : ${titre.replace(/^\d+\.\s*/, "")}`} tabIndex={0} className={CADRE}>
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <caption className="sr-only">
            {titre} : plan et réalisé du mois, cumul de l&apos;année et cible cumulée, état du cumul, commentaire du mois.
          </caption>
          <thead>
            <tr className={ENTETE}>
              <th scope="col" className="px-3 py-2 pl-4 text-left">
                N°
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Indicateur
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right max-sm:hidden">
                Plan {mois}
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">
                Réalisé {mois}
              </th>
              <th scope="col" className="whitespace-nowrap border-l border-line px-3 py-2 text-right">
                Cumul
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right max-sm:hidden">
                Cible cumulée
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                État
              </th>
              <th scope="col" className="px-3 py-2 pr-4 text-left">
                Commentaire du mois
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {lignes.map((i) => {
              const point = i.series[i.series.length - 1];
              const texte = brouillon.valeurs[i.id];
              const illisible = texte !== undefined && texte.trim() !== "" && lireNombre(texte) === null;
              const aSaisir = saisie && i.mode === "manual";
              return (
                <tr key={i.id} className="border-b border-line/70 align-top last:border-0">
                  <td className="px-3 py-2.5 pl-4 font-mono text-[12px] text-muted">{i.code}</td>
                  <th scope="row" className="min-w-[14rem] max-w-[22rem] px-3 py-2.5 text-left font-medium text-ink">
                    <Libelle i={i} />
                  </th>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-ink-2 max-sm:hidden">{fmtPlan(i.target, i.unit, i.direction)}</td>
                  <td className="px-3 py-2 text-right">
                    {aSaisir ? (
                      <Input
                        inputMode="decimal"
                        aria-label={`Réalisé ${mois}, ${i.code} ${i.label}`}
                        aria-invalid={illisible || undefined}
                        value={texte ?? ecrireNombre(i.value)}
                        placeholder="À saisir"
                        onChange={(e) => onValeur(i.id, e.target.value)}
                        className={cx("w-24 text-right tabular", illisible && "border-danger")}
                      />
                    ) : (
                      <Valeur v={point?.value ?? null} unite={i.unit} etat={point?.status ?? "no_data"} />
                    )}
                    {i.mode === "manual" && !aSaisir && point?.value === null && <span className="block text-[11.5px] text-muted">non saisi</span>}
                  </td>
                  <td className="whitespace-nowrap border-l border-line px-3 py-2.5 text-right">
                    <Valeur v={i.ytd} unite={i.unit} etat={i.status} gras />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-ink-2 max-sm:hidden">{fmtPlan(i.ytd_target, i.unit, i.direction)}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={tonEtat(i.status)}>{motEtat(i.status)}</Badge>
                  </td>
                  <td className="min-w-[13rem] px-3 py-2 pr-4">
                    {saisie ? (
                      <Input aria-label={`Commentaire ${mois}, ${i.code}`} value={brouillon.commentaires[i.id] ?? i.comment ?? ""} placeholder="Commentaire" onChange={(e) => onCommentaire(i.id, e.target.value)} />
                    ) : i.comment ? (
                      <span className="block max-w-[40ch] text-[12.5px] leading-snug text-ink-2">{i.comment}</span>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TableMois({ titre, r, lignes }: { titre: string; r: MonthlyReport; lignes: ReportIndicator[] }) {
  return (
    <section aria-label={titre.replace(/^\d+\.\s*/, "")} className="mt-5 first:mt-1">
      <h3 className="text-[15px] font-semibold text-ink">{titre}</h3>
      <div role="region" aria-label={`Tableau : ${titre.replace(/^\d+\.\s*/, "")}`} tabIndex={0} className={CADRE}>
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <caption className="sr-only">
            {titre} : plan annuel, réalisé de chaque mois depuis janvier, cumul et état. Une case marquée d&apos;un losange manque la cible du mois ; une case en orange en est à moins de la marge.
          </caption>
          <thead>
            <tr className={ENTETE}>
              <th scope="col" className="px-3 py-2 pl-4 text-left">
                N°
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Indicateur
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">
                Plan annuel
              </th>
              {r.months.map((m) => (
                <th key={m} scope="col" className={cx("whitespace-nowrap px-2 py-2 text-right", m === r.month && "bg-accent-doux/60 text-ink")}>
                  {moisCourt(m)}
                </th>
              ))}
              <th scope="col" className="whitespace-nowrap border-l border-line px-3 py-2 text-right">
                Cumul
              </th>
              <th scope="col" className="px-3 py-2 pr-4 text-left">
                État
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {lignes.map((i) => (
              <tr key={i.id} className="border-b border-line/70 last:border-0">
                <td className="px-3 py-2.5 pl-4 font-mono text-[12px] text-muted">{i.code}</td>
                <th scope="row" className="min-w-[14rem] px-3 py-2.5 text-left font-medium text-ink">
                  <Libelle i={i} />
                </th>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-ink-2">{fmtPlan(i.annual_target, i.unit, i.direction)}</td>
                {r.months.map((m) => {
                  const p = i.series.find((x) => x.month === m);
                  return (
                    <td key={m} title={p?.comment ?? undefined} className={cx("px-2 py-2.5 text-right", m === r.month && "bg-accent-doux/30")}>
                      <Valeur v={p?.value ?? null} unite={i.unit} etat={p?.status ?? "no_data"} />
                    </td>
                  );
                })}
                <td className="whitespace-nowrap border-l border-line px-3 py-2.5 text-right">
                  <Valeur v={i.ytd} unite={i.unit} etat={i.status} gras />
                </td>
                <td className="px-3 py-2.5 pr-4">
                  <Badge tone={tonEtat(i.status)}>{motEtat(i.status)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ─── Journal du mois ─────────────────────────────────────────────────── */

/** Opération du journal en clair ; le passage d'état est dit par la validation ou la réouverture. */
function operation(h: ReportHistoryEntry): string {
  switch (h.action) {
    case "create":
      return "mois du rapport ouvert";
    case "freeze":
      return "valeurs calculées figées";
    case "validate":
      return "mois validé";
    case "reopen":
      return h.note ? `mois rouvert : « ${h.note} »` : "mois rouvert";
    case "write":
      return h.field === "comment" ? "commentaire du mois modifié" : `saisie de ${h.field ?? "une valeur"}`;
    default:
      return h.action;
  }
}

/** Journal du mois, du plus récent au plus ancien. */
export function Historique({ entrees }: { entrees: ReportHistoryEntry[] }) {
  const lignes = entrees.filter((h) => !(h.action === "write" && h.field === "state")).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  if (!lignes.length) return null;
  return (
    <details className="group">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Historique du mois ({lignes.length})</summary>
      <ol className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-ink-2">
        {lignes.map((h) => (
          <li key={h.id}>
            <span className="text-muted">{fmtDateTime(h.at)}</span>, {h.by?.name ?? "Système"} : {operation(h)}
          </li>
        ))}
      </ol>
    </details>
  );
}
