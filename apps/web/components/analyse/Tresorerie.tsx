"use client";

import { type CSSProperties } from "react";
import { Landmark } from "@/components/icons";
import { AreaChart, Badge, Card, Compteur, DataTable, ErrorBox, GAMME, IconTile, cx } from "@/components/ui";
import { CarteChaleur, Eventail } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, Vide, combler, fmtDate, fmtPct, fmtShort, joursOu, useContexte, usePeriode } from "@/components/analyse/commun";
import { moisCourt } from "@/components/analyse/charts/commun";
import { useApi } from "@/lib/api-client";
import type { GroupeTresorerie } from "@/lib/analyse-types";
import { fmtDec, fmtGNF, fmtInt } from "@/lib/format";

/** Liquidité et prévision à 13 semaines : position, éventail, cycle de conversion, encaissements attendus. */
export function Tresorerie() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="groupe" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

const semaineCourte = (start: string) => `${start.slice(8, 10)}/${start.slice(5, 7)}`;

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeTresorerie>(`/analyse/groupe/tresorerie${query}`);
  const seuil = d?.runway?.threshold ?? 0;
  const seuilFixe = (d?.runway?.threshold_source ?? "zero") !== "zero";
  const bas = d?.runway?.low_point ?? null;
  const weeks = d?.forecast?.weeks ?? [];
  const total = d?.position?.total ?? 0;
  const reponse = d && (
    <>
      {fmtShort(total)} GNF en banques et caisses aujourd&apos;hui{d.position.net_cash !== total ? ` (${fmtShort(d.position.net_cash)} GNF nets des découverts)` : ""}.{" "}
      {weeks.length === 0 ? (
        <>Pas de prévision : aucune échéance connue.</>
      ) : d.runway.weeks_p50 !== null ? (
        <>
          Dans un cas sur deux, la trésorerie passe <strong className="font-semibold text-danger">sous {seuilFixe ? `le seuil de ${fmtShort(seuil)} GNF` : "zéro"} en semaine {d.runway.weeks_p50}</strong>
        </>
      ) : d.runway.weeks_p10 !== null ? (
        <>Elle reste au-dessus {seuilFixe ? `du seuil de ${fmtShort(seuil)} GNF` : "de zéro"} dans le scénario médian, mais le scénario défavorable passe dessous en semaine {d.runway.weeks_p10}</>
      ) : (
        <>Elle reste au-dessus {seuilFixe ? `du seuil de ${fmtShort(seuil)} GNF` : "de zéro"} sur les 13 semaines</>
      )}
      {bas && (
        <>
          {" "}; point bas la semaine du {fmtDate(bas.start)} : {fmtShort(bas.balance_p50)} GNF (p10 : {fmtShort(bas.balance_p10)} GNF).
        </>
      )}
      {!bas && weeks.length > 0 && "."}
    </>
  );
  const cycle = (d?.cycle?.series ?? []).filter((s) => s.unit === "days");
  const bfr = d?.cycle?.series?.find((s) => s.key === "bfr");
  const semaines = weeks.map((w) => `S${w.week}`);
  const collections = d?.collections ?? [];
  const detail = d?.forecast?.outflows_detail;

  return (
    <div>
      <EnTeteSection exporter={`/analyse/groupe/tresorerie.xlsx${query}`} question="Où va la trésorerie dans les 13 prochaines semaines ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Position" className="xl:col-span-4" actions={<IconTile icon={Landmark} teinte={total < seuil ? "danger" : "jade"} />}>
              <Compteur value={total} className={cx("text-[28px] sm:text-[36px]", total < seuil ? "text-danger" : "text-ink")} />
              <p className="mt-1.5 text-[12.5px] text-muted">
                {d.position.accounts.length} compte{d.position.accounts.length > 1 ? "s" : ""}
                {seuilFixe ? ` · seuil de sécurité ${fmtShort(seuil)} GNF` : " · aucun seuil de sécurité paramétré (zéro)"}
              </p>
              {d.position.accounts.length === 0 ? (
                <div className="mt-4">
                  <Vide compact titre="Aucun compte de trésorerie" />
                </div>
              ) : (
                <ul className="mt-5 space-y-3">
                  {d.position.accounts.map((a, i) => (
                    <li key={a.journal_id}>
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="min-w-0 truncate font-medium text-ink-2">
                          {a.name}
                          <span className="ml-2 text-[11.5px] font-normal text-muted">{a.type === "cash" ? "Caisse" : "Banque"}</span>
                        </span>
                        <span className={cx("whitespace-nowrap font-semibold tabular", a.balance < 0 ? "text-danger" : "text-ink")}>{a.currency !== "GNF" ? `${fmtDec(a.balance_currency)} ${a.currency}` : fmtGNF(a.balance)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
                        <div className="n-pousser-x h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, Math.abs(a.share_pct)))}%`, background: GAMME[i % GAMME.length], "--i": i } as CSSProperties} />
                      </div>
                      {a.currency !== "GNF" && <div className="mt-0.5 text-right text-[11px] text-muted">soit {fmtGNF(a.balance)}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Prévision à 13 semaines" className="xl:col-span-8" actions={<span className="text-[12.5px] text-muted">{fmtInt(d.forecast.draws)} tirages Monte-Carlo sur les délais clients</span>}>
              {weeks.length === 0 ? (
                <Vide titre="Aucune prévision" hint="Il faut des créances, des dettes ou des charges récurrentes pour projeter la trésorerie." />
              ) : (
                <>
                  <Eventail
                    label="Trésorerie prévue par semaine, médiane et bande p10-p90"
                    points={[{ label: "Auj.", actual: d.forecast.start_balance, forecast: null, low: null, high: null }, ...weeks.map((w) => ({ label: `S${w.week}`, actual: null, forecast: w.balance_p50, low: w.balance_p10, high: w.balance_p90 }))]}
                    cible={seuilFixe ? seuil : null}
                    cibleLabel="Seuil"
                    serieLabel="Solde actuel"
                    hauteur={300}
                  />
                  <div className="mt-3 grid grid-cols-3 gap-2.5">
                    <Chiffre label={`Semaines avant ${seuilFixe ? "le seuil" : "zéro"} (p50)`} value={d.runway.weeks_p50 === null ? "Plus de 13" : `${d.runway.weeks_p50}`} tone={d.runway.weeks_p50 !== null && d.runway.weeks_p50 <= 8 ? "danger" : "ok"} />
                    <Chiffre label={`Semaines avant ${seuilFixe ? "le seuil" : "zéro"} (p10)`} value={d.runway.weeks_p10 === null ? "Plus de 13" : `${d.runway.weeks_p10}`} tone={d.runway.weeks_p10 !== null && d.runway.weeks_p10 <= 8 ? "warn" : "ok"} />
                    <Chiffre label="Point bas" value={bas ? fmtShort(bas.balance_p50) : "–"} hint={bas ? `semaine du ${fmtDate(bas.start)} · p10 ${fmtShort(bas.balance_p10)}` : undefined} tone={bas && bas.balance_p50 < seuil ? "danger" : undefined} />
                  </div>
                  {(d.forecast.doubtful_excluded > 0 || d.forecast.payables_overdue > 0 || d.forecast.beyond_horizon > 0) && (
                    <p className="mt-3 text-[12px] leading-snug text-muted">
                      {d.forecast.payables_overdue > 0 && `${fmtShort(d.forecast.payables_overdue)} GNF de dettes fournisseurs déjà échues sont décaissées en semaine 1. `}
                      {d.forecast.doubtful_excluded > 0 && `${fmtShort(d.forecast.doubtful_excluded)} GNF de créances douteuses sont exclues. `}
                      {d.forecast.beyond_horizon > 0 && `${fmtShort(d.forecast.beyond_horizon)} GNF d'encaissements tombent au-delà des 13 semaines.`}
                    </p>
                  )}
                </>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Cycle de conversion" className="xl:col-span-6" actions={<span className="text-[12.5px] text-muted">DSO + DIO − DPO, en jours</span>}>
              {cycle.length && d.cycle.months.length ? (
                <>
                  <AreaChart label="DSO, DPO, DIO et cycle de conversion" labels={d.cycle.months.map((m) => moisCourt(m, true))} series={cycle.map((s, i) => ({ key: s.key, label: s.label, values: combler(s.values), color: GAMME[i % GAMME.length]! }))} height={210} format={(v) => `${fmtDec(Math.round(v * 10) / 10)} j`} formatAxis={(v) => `${Math.round(v)} j`} />
                  {bfr && (
                    <div className="mt-4 border-t border-line pt-3">
                      <div className="mb-2 text-[12.5px] font-semibold text-ink-2">Besoin en fonds de roulement</div>
                      <AreaChart label="BFR mensuel" labels={d.cycle.months.map((m) => moisCourt(m, true))} series={[{ key: "bfr", label: bfr.label, values: combler(bfr.values), color: GAMME[4]! }]} height={120} format={(v) => fmtGNF(v)} />
                    </div>
                  )}
                  {d.cycle.definition && <p className="mt-2 text-[11.5px] leading-snug text-muted">{d.cycle.definition} Les mois sans donnée reprennent la valeur précédente.</p>}
                </>
              ) : (
                <Vide titre="Cycle non calculable" hint="Il faut des soldes clients et fournisseurs de fin de mois." />
              )}
            </Card>
            <Card title="Encaissements attendus, par client et par semaine" className="xl:col-span-6">
              {collections.length === 0 || semaines.length === 0 ? (
                <Vide titre="Aucune créance ouverte" />
              ) : (
                <CarteChaleur
                  label="Encaissements attendus par client et par semaine"
                  rows={collections.map((c) => ({ key: String(c.id), label: c.name }))}
                  cols={semaines}
                  cells={collections.flatMap((c) => c.expected_by_week.map((v, i) => ({ row: String(c.id), col: `S${i + 1}`, value: v > 0 ? v : null, detail: `${fmtGNF(c.open)} ouverts, ${fmtGNF(c.overdue)} échus · délai réel ${c.avg_days_late === null ? "inconnu" : `${c.avg_days_late >= 0 ? "+" : ""}${fmtInt(c.avg_days_late)} j`} (${c.history_source === "client" ? `${c.history_n} factures du client` : "délai moyen global"})` })))}
                  echelle="sequentielle"
                  format={(v) => fmtShort(v)}
                  hauteurLigne={28}
                  largeurLibelles={150}
                />
              )}
            </Card>
          </div>

          {weeks.length > 0 && (
            <Card title="Semaine par semaine" padded={false}>
              <DataTable
                dense
                rows={weeks}
                rowKey={(w) => w.week}
                columns={[
                  { key: "start", label: "Semaine", render: (w) => <span className="whitespace-nowrap font-medium text-ink">S{w.week} · {semaineCourte(w.start)} au {semaineCourte(w.end)}</span> },
                  { key: "inflows", label: "Encaissements", align: "right", render: (w) => fmtInt(w.inflows) },
                  { key: "outflows", label: "Décaissements", align: "right", render: (w) => fmtInt(w.outflows) },
                  { key: "net", label: "Flux net", align: "right", render: (w) => <span className={w.net < 0 ? "text-danger" : "text-ok-texte"}>{fmtInt(w.net)}</span> },
                  { key: "balance_p10", label: "Solde p10", align: "right", render: (w) => <span className={w.balance_p10 < seuil ? "text-danger" : undefined}>{fmtInt(w.balance_p10)}</span> },
                  { key: "balance_p50", label: "Solde médian", align: "right", render: (w) => <span className={cx("font-semibold", w.balance_p50 < seuil && "text-danger")}>{fmtInt(w.balance_p50)}</span> },
                  { key: "balance_p90", label: "Solde p90", align: "right", render: (w) => fmtInt(w.balance_p90) },
                  { key: "etat", label: "", render: (w) => (w.balance_p50 < seuil ? <Badge tone="danger">Sous le seuil</Badge> : w.balance_p10 < seuil ? <Badge tone="warn">Fragile</Badge> : null) },
                ]}
              />
              <p className="px-5 py-3 text-[12.5px] leading-snug text-muted">
                {d.forecast.method || "Encaissements : créances ouvertes datées par le délai de paiement réel de chaque client. Décaissements : dettes fournisseurs à échéance, échéances d'emprunt, charges récurrentes."}
                {detail && ` Décaissements sur 13 semaines : fournisseurs ${fmtShort(detail.payables.reduce((s, v) => s + v, 0))}, emprunts ${fmtShort(detail.loans.reduce((s, v) => s + v, 0))}, charges récurrentes ${fmtShort(detail.recurring.reduce((s, v) => s + v, 0))} (${fmtShort(d.forecast.recurring_monthly)} par mois), impôts et taxes ${fmtShort(detail.taxes.reduce((s, v) => s + v, 0))} GNF.`}
              </p>
            </Card>
          )}

          {collections.length > 0 && (
            <Card title="Clients à encaisser" padded={false}>
              <DataTable
                dense
                rows={collections}
                rowKey={(c) => c.id}
                columns={[
                  { key: "name", label: "Client", render: (c) => <span className="font-medium text-ink">{c.name}</span> },
                  { key: "open", label: "Encours ouvert", align: "right", render: (c) => fmtInt(c.open) },
                  { key: "overdue", label: "Échu", align: "right", render: (c) => <span className={c.overdue > 0 ? "font-semibold text-danger" : undefined}>{fmtInt(c.overdue)}</span> },
                  { key: "doubtful", label: "Douteux", align: "right", render: (c) => (c.doubtful > 0 ? <span className="text-danger">{fmtInt(c.doubtful)}</span> : <span className="text-muted">0</span>) },
                  { key: "part", label: "Part échue", align: "right", sortValue: (c) => (c.open ? c.overdue / c.open : 0), render: (c) => fmtPct(c.open ? (c.overdue / c.open) * 100 : 0, 0) },
                  { key: "avg_days_late", label: "Retard réel", align: "right", render: (c) => (c.avg_days_late === null ? <span className="text-muted">–</span> : <Badge tone={c.avg_days_late > 30 ? "danger" : c.avg_days_late > 0 ? "warn" : "ok"}>{c.avg_days_late > 0 ? "+" : ""}{joursOu(c.avg_days_late)}</Badge>) },
                  { key: "expected_total", label: "Attendu sur 13 sem.", align: "right", render: (c) => fmtInt(c.expected_total) },
                ]}
              />
              <p className="px-5 py-3 text-[12.5px] leading-snug text-muted">Retard réel : écart moyen entre l&apos;échéance et le règlement sur 24 mois (négatif : le client paie avant l&apos;échéance).</p>
            </Card>
          )}

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
