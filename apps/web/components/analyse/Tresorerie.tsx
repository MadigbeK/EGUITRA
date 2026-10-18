"use client";

import { type CSSProperties } from "react";
import { Landmark } from "@/components/icons";
import { AreaChart, Badge, Card, Compteur, DataTable, ErrorBox, GAMME, IconTile, cx } from "@/components/ui";
import { CarteChaleur, Eventail } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtDate, fmtPct, fmtShort, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
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
  const seuil = d?.position.threshold ?? 0;
  const bas = d?.runway.low_point;
  const reponse = d && bas && (
    <>
      {fmtShort(d.position.total)} GNF en banques et caisses aujourd&apos;hui.{" "}
      {d.runway.weeks_p50 !== null ? (
        <>
          Dans un cas sur deux, la trésorerie passe <strong className="font-semibold text-danger">sous le seuil de {fmtShort(seuil)} GNF en semaine {d.runway.weeks_p50}</strong>
        </>
      ) : d.runway.weeks_p10 !== null ? (
        <>
          Elle reste au-dessus du seuil dans le scénario médian, mais le scénario défavorable passe dessous en semaine {d.runway.weeks_p10}
        </>
      ) : (
        <>Elle reste au-dessus du seuil de {fmtShort(seuil)} GNF sur les 13 semaines</>
      )}
      {" "}; point bas la semaine du {fmtDate(bas.week)} : {fmtShort(bas.balance_p50)} GNF (p10 : {fmtShort(bas.balance_p10)} GNF).
    </>
  );
  const cycle = d?.cycle.series.filter((s) => s.unit === "days") ?? [];
  const bfr = d?.cycle.series.find((s) => s.key === "bfr");
  const semaines = d?.forecast.weeks.map((w) => `S${d.forecast.weeks.indexOf(w) + 1}`) ?? [];

  return (
    <div>
      <EnTeteSection question="Où va la trésorerie dans les 13 prochaines semaines ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Position" className="xl:col-span-4" actions={<IconTile icon={Landmark} teinte={d.position.total < seuil ? "danger" : "jade"} />}>
              <Compteur value={d.position.total} className={cx("text-[28px] sm:text-[36px]", d.position.total < seuil ? "text-danger" : "text-ink")} />
              <p className="mt-1.5 text-[12.5px] text-muted">
                {d.position.accounts.length} comptes · seuil de sécurité {fmtShort(seuil)} GNF
              </p>
              <ul className="mt-5 space-y-3">
                {d.position.accounts.map((a, i) => (
                  <li key={a.key}>
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="min-w-0 truncate font-medium text-ink-2">
                        {a.name}
                        <span className="ml-2 text-[11.5px] font-normal text-muted">{a.type === "cash" ? "Caisse" : "Banque"}</span>
                      </span>
                      <span className={cx("whitespace-nowrap font-semibold tabular", a.balance < 0 ? "text-danger" : "text-ink")}>{a.currency !== "GNF" ? `${fmtDec(a.balance_currency)} ${a.currency}` : fmtGNF(a.balance)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
                      <div className="n-pousser-x h-full rounded-full" style={{ width: `${Math.max(2, (Math.abs(a.balance) / Math.max(1, d.position.total)) * 100)}%`, background: GAMME[i % GAMME.length], "--i": i } as CSSProperties} />
                    </div>
                    {a.currency !== "GNF" && <div className="mt-0.5 text-right text-[11px] text-muted">soit {fmtGNF(a.balance)}</div>}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Prévision à 13 semaines" className="xl:col-span-8" actions={<span className="text-[12.5px] text-muted">{fmtInt(d.forecast.simulations)} tirages Monte-Carlo sur les délais clients</span>}>
              <Eventail
                label="Trésorerie prévue par semaine, médiane et bande p10-p90"
                points={[{ label: "Auj.", actual: d.position.total, forecast: null, low: null, high: null }, ...d.forecast.weeks.map((w, i) => ({ label: `S${i + 1}`, actual: null, forecast: w.balance_p50, low: w.balance_p10, high: w.balance_p90 }))]}
                cible={seuil}
                cibleLabel="Seuil"
                serieLabel="Solde actuel"
                hauteur={300}
              />
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                <Chiffre label="Semaines avant le seuil (p50)" value={d.runway.weeks_p50 === null ? "Plus de 13" : `${d.runway.weeks_p50}`} tone={d.runway.weeks_p50 !== null && d.runway.weeks_p50 <= 8 ? "danger" : undefined} />
                <Chiffre label="Semaines avant le seuil (p10)" value={d.runway.weeks_p10 === null ? "Plus de 13" : `${d.runway.weeks_p10}`} tone={d.runway.weeks_p10 !== null && d.runway.weeks_p10 <= 8 ? "warn" : undefined} />
                <Chiffre label="Point bas" value={`${fmtShort(d.runway.low_point.balance_p50)}`} hint={`semaine du ${fmtDate(d.runway.low_point.week)} · p10 ${fmtShort(d.runway.low_point.balance_p10)}`} tone={d.runway.low_point.balance_p50 < seuil ? "danger" : undefined} />
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Cycle de conversion" className="xl:col-span-6" actions={<span className="text-[12.5px] text-muted">DSO + DIO − DPO, en jours</span>}>
              <AreaChart label="DSO, DPO, DIO et cycle de conversion sur 24 mois" labels={d.cycle.months.map((m) => moisCourt(m, true))} series={cycle.map((s, i) => ({ key: s.key, label: s.label, values: s.values, color: GAMME[i % GAMME.length]! }))} height={210} format={(v) => `${fmtDec(v)} j`} formatAxis={(v) => `${Math.round(v)} j`} />
              {bfr && (
                <div className="mt-4 border-t border-line pt-3">
                  <div className="mb-2 text-[12.5px] font-semibold text-ink-2">Besoin en fonds de roulement</div>
                  <AreaChart label="BFR mensuel" labels={d.cycle.months.map((m) => moisCourt(m, true))} series={[{ key: "bfr", label: "BFR", values: bfr.values, color: GAMME[4]! }]} height={120} format={(v) => fmtGNF(v)} />
                </div>
              )}
            </Card>
            <Card title="Encaissements attendus, par client et par semaine" className="xl:col-span-6">
              <CarteChaleur
                label="Encaissements attendus par client et par semaine"
                rows={d.collections.map((c) => ({ key: String(c.id), label: c.name.replace(" (démo)", "") }))}
                cols={semaines}
                cells={d.collections.flatMap((c) => c.expected_by_week.map((v, i) => ({ row: String(c.id), col: `S${i + 1}`, value: v > 0 ? v : null, detail: `${fmtGNF(c.open)} ouverts, ${fmtGNF(c.overdue)} échus, ${fmtInt(c.avg_days)} jours de délai réel` })))}
                echelle="sequentielle"
                format={(v) => fmtShort(v)}
                hauteurLigne={28}
                largeurLibelles={150}
              />
            </Card>
          </div>

          <Card title="Semaine par semaine" padded={false}>
            <DataTable
              dense
              rows={d.forecast.weeks}
              rowKey={(w) => w.start}
              columns={[
                { key: "start", label: "Semaine", render: (w) => <span className="font-medium text-ink">{semaineCourte(w.start)} au {semaineCourte(w.end)}</span> },
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
              Encaissements : créances ouvertes datées par le délai de paiement réel de chaque client. Décaissements : dettes fournisseurs à échéance, échéances d&apos;emprunt, charges récurrentes (moyenne des six derniers mois). Les bandes p10-p90 viennent de {fmtInt(d.forecast.simulations)} tirages sur les délais clients.
            </p>
          </Card>

          <Card title="Clients à encaisser" padded={false}>
            <DataTable
              dense
              rows={d.collections}
              rowKey={(c) => c.id}
              columns={[
                { key: "name", label: "Client", render: (c) => <span className="font-medium text-ink">{c.name}</span> },
                { key: "open", label: "Encours ouvert", align: "right", render: (c) => fmtInt(c.open) },
                { key: "overdue", label: "Échu", align: "right", render: (c) => <span className={c.overdue > 0 ? "font-semibold text-danger" : undefined}>{fmtInt(c.overdue)}</span> },
                { key: "part", label: "Part échue", align: "right", sortValue: (c) => (c.open ? c.overdue / c.open : 0), render: (c) => fmtPct(c.open ? (c.overdue / c.open) * 100 : 0, 0) },
                { key: "avg_days", label: "Délai réel", align: "right", render: (c) => <Badge tone={c.avg_days > 60 ? "danger" : c.avg_days > 40 ? "warn" : "ok"}>{fmtInt(c.avg_days)} j</Badge> },
              ]}
            />
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
