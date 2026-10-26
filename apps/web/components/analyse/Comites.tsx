"use client";

import { type CSSProperties } from "react";
import { AreaChart, Badge, Card, cx } from "@/components/ui";
import { COULEUR_DECISION, ETATS } from "@/lib/couleurs";
import { CarteChaleur, Legende, TableRepli } from "@/components/analyse/charts";
import { AttenteSection, ErreurLecture, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, LienFiche, Vide, combler, fmtDate, fmtPct, joursOu, moisCourt, pctOu, pluriel, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetComites, Decision } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

const LIBELLE_DECISION: Record<string, string> = { go: "GO", conditional: "GO sous conditions", hold: "HOLD", no_go: "NO-GO", postponed: "Ajourné" };

/** Qualité des décisions : accord méthode × comité, décisions par mois, délai de décision, scores à la décision, passages forcés. */
export function Comites() {
  return (
    <FournisseurTheme>
      <GardeSociete attendu="cabinet">
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetComites>(`/analyse/cabinet/comites${query}`);
  const ag = d?.agreement;
  const total = d ? Object.values(d.decisions?.totals ?? {}).reduce((s, v) => s + v, 0) : 0;
  const ttd = d?.time_to_decision;
  const reponse = d && (
    <>
      {ag && ag.agreement_pct !== null ? (
        <>
          Le comité suit la recommandation de la méthode dans <strong className="font-semibold text-ink">{fmtPct(ag.agreement_pct, 0)} des cas</strong> ({ag.agreed} sur {ag.n} revues ; {ag.lenient} plus indulgente{ag.lenient > 1 ? "s" : ""}, {ag.strict} plus sévère{ag.strict > 1 ? "s" : ""}).
        </>
      ) : (
        <>Pas encore de revue verrouillée avec recommandation : le taux d&apos;accord n&apos;est pas calculable{ag?.excluded ? ` (${pluriel(ag.excluded, "revue exclue", "revues exclues")})` : ""}.</>
      )}{" "}
      {total > 0 ? `${pluriel(total, "décision")} sur 12 mois` : "Aucune décision sur 12 mois"}
      {ttd && ttd.median_days !== null && ttd.n > 0 && `, prises ${joursOu(ttd.median_days)} après l'ouverture en médiane`}
      {d.forced_summary && d.forced_summary.count > 0 ? ` ; ${pluriel(d.forced_summary.count, "passage de gate forcé", "passages de gate forcés")} sur ${d.forced_summary.passages}` : d.forced_summary?.passages ? " ; aucun passage de gate forcé" : ""}.
      {d.favorable_with_knockout?.length > 0 && <> {pluriel(d.favorable_with_knockout.length, "décision favorable", "décisions favorables")} malgré un critère éliminatoire actif.</>}
    </>
  );
  const serieDecisions = d?.decisions?.series ?? [];
  const mois = d?.decisions?.months ?? [];

  return (
    <div>
      <EnTeteSection exporter={`/analyse/cabinet/comites.xlsx${query}`} question="Le comité décide-t-il comme la méthode le recommande ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErreurLecture error={error} onRetry={() => void mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Recommandation de la méthode × décision du comité" className="xl:col-span-6" actions={ag && ag.agreement_pct !== null ? <Badge tone={ag.agreement_pct >= 85 ? "ok" : ag.agreement_pct >= 70 ? "warn" : "danger"}>Accord {fmtPct(ag.agreement_pct, 0)}{ag.kappa !== null ? ` · kappa ${ag.kappa.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}` : ""}</Badge> : <Badge tone="neutral">Pas encore de revue</Badge>}>
              {ag && ag.matrix.length && ag.n > 0 ? (
                <>
                  <CarteChaleur
                    label="Matrice recommandation × décision, nombre de revues"
                    rows={ag.recommendations.map((r, i) => ({ key: r, label: `Méthode : ${ag.recommendation_labels[i] ?? r}` }))}
                    cols={ag.decisions}
                    formatCol={(c) => ag.decision_labels[ag.decisions.indexOf(c)] ?? c}
                    cells={ag.recommendations.flatMap((r, i) => ag.decisions.map((c, j) => ({ row: r, col: c, value: ag.matrix[i]?.[j] ?? 0, detail: i === j ? "Accord" : j > i ? "Comité plus indulgent que la méthode" : "Comité plus sévère que la méthode" })))}
                    echelle="sequentielle"
                    format={(v) => String(v)}
                    largeurLibelles={210}
                    hauteurLigne={36}
                  />
                  <p className="mt-2 text-[12.5px] leading-snug text-muted">La diagonale est l&apos;accord. À droite, le comité accorde plus que la méthode ne recommande ; à gauche, il est plus sévère.</p>
                </>
              ) : (
                <Vide titre="Aucune revue verrouillée" hint="Le taux d'accord se calcule sur les revues de comité verrouillées qui portent une recommandation de la méthode." />
              )}
            </Card>
            <div className="space-y-5 xl:col-span-6">
              <Card title="Délai d'ouverture à première décision" actions={ttd ? <span className="text-[12.5px] text-muted">Médiane {joursOu(ttd.median_days)} · p75 {joursOu(ttd.p75_days)} · {ttd.n} dossier{ttd.n > 1 ? "s" : ""}</span> : undefined}>
                {ttd && ttd.by_month.length > 1 ? (
                  <AreaChart label="Délai médian de décision par mois" labels={ttd.by_month.map((m) => moisCourt(m.month))} series={[{ key: "days", label: "Jours", values: combler(ttd.by_month.map((m) => m.days)), color: "var(--accent-vif)" }]} height={150} format={(v) => `${fmtInt(v)} j`} formatAxis={(v) => `${Math.round(v)} j`} />
                ) : ttd && ttd.rows.length ? (
                  <ul className="space-y-1.5 text-[12.5px]">
                    {ttd.rows.map((r) => (
                      <li key={`${r.id}-${r.date}`} className="flex items-center justify-between gap-3">
                        <span className="truncate"><LienFiche href={r.link}>{r.reference}</LienFiche> · {r.name}</span>
                        <span className="whitespace-nowrap text-muted">{fmtDate(r.date)} · {joursOu(r.days)} · {LIBELLE_DECISION[r.decision] ?? r.decision}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Vide compact titre="Aucune décision sur la période" />
                )}
              </Card>
              <Card title="Passages de gate forcés" actions={<Badge tone={(d.forced_gates ?? []).length ? "warn" : "ok"}>{(d.forced_gates ?? []).length}{d.forced_summary?.share_pct !== null && d.forced_summary?.share_pct !== undefined ? ` · ${fmtPct(d.forced_summary.share_pct, 0)} des passages` : ""}</Badge>}>
                {(d.forced_gates ?? []).length === 0 ? (
                  <p className="text-[13px] text-muted">Aucun passage forcé sur la période.</p>
                ) : (
                  <ul className="space-y-2">
                    {d.forced_gates.map((f) => (
                      <li key={`${f.dossier_id}-${f.gate}-${f.date}`} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-[12.5px]">
                        <span className="min-w-0">
                          <span className="block font-medium text-ink"><LienFiche href={f.link}>{f.dossier}</LienFiche> · {f.gate} → {f.to} · {fmtDate(f.date)}</span>
                          <span className="block text-[11.5px] text-muted">{f.reason ?? "Sans motif saisi"}</span>
                        </span>
                        {f.score !== null && <Badge tone={f.score < 50 ? "danger" : "warn"}>score {fmtInt(f.score)}</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Décisions par mois" className="xl:col-span-7">
              {serieDecisions.length && mois.length && total > 0 ? (
                <>
                  <Legende className="mb-3" items={serieDecisions.map((s) => ({ key: s.key, label: s.label, couleur: COULEUR_DECISION[s.key] ?? ETATS.neutre, forme: "carre" as const }))} />
                  <BarresEmpilees months={mois} series={serieDecisions} />
                </>
              ) : (
                <Vide compact titre="Aucune décision verrouillée sur 12 mois" />
              )}
            </Card>
            <Card title="Score global au moment de la décision" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Un point par revue · trait : médiane</span>}>
              {(d.score_at_decision ?? []).some((s) => s.scores.length > 0) ? <Bandes series={d.score_at_decision} /> : <Vide compact titre="Aucune revue avec score" />}
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <Chiffre label="Conditions posées" value={String(d.conditions?.count ?? 0)} hint={d.conditions ? `${d.conditions.done} levées · ${d.conditions.open} ouvertes${d.conditions.overdue ? ` · ${d.conditions.overdue} en retard` : ""}` : undefined} tone={d.conditions?.overdue ? "warn" : undefined} />
                <Chiffre label="Conditions levées" value={pctOu(d.conditions?.done_rate_pct ?? null, 0)} hint="part des conditions des GO sous conditions" />
              </div>
            </Card>
          </div>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}

/** Colonnes empilées des décisions par mois. */
function BarresEmpilees({ months, series }: { months: string[]; series: CabinetComites["decisions"]["series"] }) {
  const totaux = months.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(1, ...totaux);
  return (
    <div>
      <div className="flex h-[190px] items-end gap-[6px]" role="img" aria-label="Décisions par mois et par type">
        {months.map((m, i) => (
          <div key={m} className="flex h-full min-w-0 flex-1 flex-col-reverse items-stretch gap-[2px]" title={`${moisCourt(m, true)} : ${totaux[i]} décision${(totaux[i] ?? 0) > 1 ? "s" : ""}`}>
            {series.map((s) => {
              const v = s.values[i] ?? 0;
              if (!v) return null;
              return <span key={s.key} className="n-pousser-y block w-full flex-none rounded-[3px]" style={{ height: `${(v / max) * 100}%`, background: COULEUR_DECISION[s.key] ?? ETATS.neutre, "--i": i } as CSSProperties} />;
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[6px]">
        {months.map((m, i) => (
          <span key={m} className={cx("min-w-0 flex-1 truncate text-center text-[11px] text-muted", months.length > 8 && i % 2 === 1 && "max-sm:hidden")}>
            {moisCourt(m)}
          </span>
        ))}
      </div>
      <TableRepli caption="Décisions par mois" colonnes={["Mois", ...series.map((s) => s.label)]} lignes={months.map((m, i) => [moisCourt(m, true), ...series.map((s) => String(s.values[i] ?? 0))])} />
    </div>
  );
}

/** Bandes de points : les scores globaux au moment de chaque décision, par type de décision. */
function Bandes({ series }: { series: CabinetComites["score_at_decision"] }) {
  return (
    <div>
      <ul className="space-y-3">
        {series.map((s) => {
          const mediane = s.median ?? (s.scores.length ? [...s.scores].sort((a, b) => a - b)[Math.floor(s.scores.length / 2)] ?? null : null);
          const couleur = COULEUR_DECISION[s.decision as Decision] ?? ETATS.neutre;
          return (
            <li key={s.decision} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 text-[12.5px]">
              <span className="flex items-center gap-2 font-medium text-ink-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: couleur }} />
                {s.label} <span className="text-muted">({s.n})</span>
              </span>
              <svg viewBox="0 0 100 18" preserveAspectRatio="none" className="h-5 w-full" aria-hidden focusable="false">
                <line x1={0} x2={100} y1={9} y2={9} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
                <line x1={50} x2={50} y1={2} y2={16} stroke="var(--line-strong)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                <line x1={65} x2={65} y1={2} y2={16} stroke="var(--line-strong)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                {s.scores.map((v, i) => (
                  <circle key={i} cx={Math.max(0, Math.min(100, v))} cy={9} r={3} fill={couleur} fillOpacity={0.7} className="an-eclore" style={{ "--i": i } as CSSProperties} />
                ))}
                {mediane !== null && <line x1={mediane} x2={mediane} y1={1} y2={17} stroke="var(--ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
              </svg>
            </li>
          );
        })}
      </ul>
      <div className="ml-[8.25rem] mt-1 flex justify-between text-[10.5px] text-muted">
        <span>0</span>
        <span>50</span>
        <span>65</span>
        <span>100</span>
      </div>
      <TableRepli caption="Scores au moment de la décision" colonnes={["Décision", "Scores"]} lignes={series.map((s) => [s.label, s.scores.join(", ") || "–"])} />
    </div>
  );
}
