"use client";

import { type CSSProperties } from "react";
import { AreaChart, Badge, Card, ErrorBox, cx } from "@/components/ui";
import { CarteChaleur, Legende, TableRepli } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtDate, fmtPct, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetComites, Decision } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

const COULEUR_DECISION: Record<Decision, string> = { go: "#12956a", conditional: "#df8f17", hold: "#e25f35", no_go: "#ec4f49", postponed: "#2d82dc" };

/** Qualité des décisions : accord méthode × comité, décisions par mois, délai de décision, scores à la décision, passages forcés. */
export function Comites() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="cabinet" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetComites>(`/analyse/cabinet/comites${query}`);
  const total = d ? d.decisions.series.reduce((s, x) => s + x.values.reduce((a, b) => a + b, 0), 0) : 0;
  const reponse = d && (
    <>
      Le comité suit la recommandation de la méthode dans <strong className="font-semibold text-ink">{fmtPct(d.agreement.agreement_pct, 0)} des cas</strong> ; les écarts vont presque tous dans le sens de l&apos;indulgence. {total} décisions sur 12 mois, prises {fmtInt(d.time_to_decision.median_days)} jours après l&apos;ouverture en médiane ; {d.forced_gates.length} passage{d.forced_gates.length > 1 ? "s" : ""} de gate forcé{d.forced_gates.length > 1 ? "s" : ""}.
    </>
  );
  return (
    <div>
      <EnTeteSection question="Le comité décide-t-il comme la méthode le recommande ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Recommandation de la méthode × décision du comité" className="xl:col-span-6" actions={<Badge tone={d.agreement.agreement_pct >= 85 ? "ok" : d.agreement.agreement_pct >= 70 ? "warn" : "danger"}>Accord {fmtPct(d.agreement.agreement_pct, 0)}</Badge>}>
              <CarteChaleur
                label="Matrice recommandation × décision, nombre de revues"
                rows={d.agreement.recommendations.map((r) => ({ key: r, label: `Méthode : ${r}` }))}
                cols={d.agreement.decisions}
                cells={d.agreement.recommendations.flatMap((r, i) => d.agreement.decisions.map((c, j) => ({ row: r, col: c, value: d.agreement.matrix[i]?.[j] ?? 0, detail: i === j ? "Accord" : j > i ? "Comité plus indulgent que la méthode" : "Comité plus sévère que la méthode" })))}
                echelle="sequentielle"
                format={(v) => String(v)}
                largeurLibelles={190}
                hauteurLigne={44}
              />
              <p className="mt-2 text-[12.5px] leading-snug text-muted">La diagonale est l&apos;accord. Au-dessus, le comité accorde plus que la méthode ne recommande ; en dessous, il est plus sévère.</p>
            </Card>
            <div className="space-y-5 xl:col-span-6">
              <Card title="Délai d'ouverture à première décision" actions={<span className="text-[12.5px] text-muted">Médiane {fmtInt(d.time_to_decision.median_days)} j · p75 {fmtInt(d.time_to_decision.p75_days)} j · {d.time_to_decision.n} dossiers</span>}>
                <AreaChart label="Délai médian de décision par mois" labels={d.time_to_decision.by_month.map((m) => moisCourt(m.month))} series={[{ key: "days", label: "Jours", values: d.time_to_decision.by_month.map((m) => m.days), color: "var(--accent-vif)" }]} height={150} format={(v) => `${fmtInt(v)} j`} formatAxis={(v) => `${Math.round(v)} j`} />
              </Card>
              <Card title="Passages de gate forcés" actions={<Badge tone={d.forced_gates.length ? "warn" : "ok"}>{d.forced_gates.length}</Badge>}>
                {d.forced_gates.length === 0 ? (
                  <p className="text-[13px] text-muted">Aucun passage forcé sur la période.</p>
                ) : (
                  <ul className="space-y-2">
                    {d.forced_gates.map((f) => (
                      <li key={`${f.dossier}-${f.gate}`} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-[12.5px]">
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">{f.dossier} · {f.gate} · {fmtDate(f.date)}</span>
                          <span className="block text-[11.5px] text-muted">{f.reason}</span>
                        </span>
                        <Badge tone={f.score < 50 ? "danger" : "warn"}>score {f.score}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Décisions par mois" className="xl:col-span-7">
              <Legende className="mb-3" items={d.decisions.series.map((s) => ({ key: s.key, label: s.label, couleur: COULEUR_DECISION[s.key], forme: "carre" as const }))} />
              <BarresEmpilees months={d.decisions.months} series={d.decisions.series} />
            </Card>
            <Card title="Score global au moment de la décision" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Un point par revue · trait : médiane</span>}>
              <Bandes series={d.score_at_decision} />
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <Chiffre label="Seuil GO" value="65" hint="score global de la méthode" />
                <Chiffre label="Seuil GO sous conditions" value="50" hint="en dessous : HOLD ou NO-GO" />
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
          <div key={m} className="flex min-w-0 flex-1 flex-col-reverse items-stretch gap-[2px]" title={`${moisCourt(m, true)} : ${totaux[i]} décision${(totaux[i] ?? 0) > 1 ? "s" : ""}`}>
            {series.map((s) => {
              const v = s.values[i] ?? 0;
              if (!v) return null;
              return <span key={s.key} className="an-barre-x block w-full rounded-[3px]" style={{ height: `${(v / max) * 100}%`, background: COULEUR_DECISION[s.key], "--i": i } as CSSProperties} />;
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
          const tri = [...s.scores].sort((a, b) => a - b);
          const mediane = tri.length ? tri[Math.floor(tri.length / 2)] ?? 0 : 0;
          return (
            <li key={s.decision} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 text-[12.5px]">
              <span className="flex items-center gap-2 font-medium text-ink-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: COULEUR_DECISION[s.decision] }} />
                {s.label} <span className="text-muted">({s.scores.length})</span>
              </span>
              <svg viewBox="0 0 100 18" preserveAspectRatio="none" className="h-5 w-full" aria-hidden focusable="false">
                <line x1={0} x2={100} y1={9} y2={9} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
                <line x1={50} x2={50} y1={2} y2={16} stroke="var(--line-strong)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                <line x1={65} x2={65} y1={2} y2={16} stroke="var(--line-strong)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                {s.scores.map((v, i) => (
                  <circle key={i} cx={v} cy={9} r={3} fill={COULEUR_DECISION[s.decision]} fillOpacity={0.7} className="an-eclore" style={{ "--i": i } as CSSProperties} />
                ))}
                {s.scores.length > 0 && <line x1={mediane} x2={mediane} y1={1} y2={17} stroke="var(--ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
              </svg>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 ml-[8.25rem] flex justify-between text-[10.5px] text-muted">
        <span>0</span>
        <span>50</span>
        <span>65</span>
        <span>100</span>
      </div>
      <TableRepli caption="Scores au moment de la décision" colonnes={["Décision", "Scores"]} lignes={series.map((s) => [s.label, s.scores.join(", ")])} />
    </div>
  );
}
