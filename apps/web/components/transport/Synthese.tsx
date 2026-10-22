"use client";

import { CheckCircle2, Droplet, Percent, Receipt, Smartphone, TrendingUp, TriangleAlert } from "@/components/icons";
import { Card, Compteur, IconTile, Kpi, Loading, Repartition } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDec, fmtGNF, fmtPct, fmtShort, pluriel } from "@/lib/format";

/** Chiffres du mois : volume livré au compteur, état de la flotte, chiffre d'affaires, marge, à facturer, saisies. */
export function Synthese() {
  // margin_min : marge minimale de la règle d'alerte (30 % par défaut) ; null : seuil à 0, la marge n'est pas jugée.
  const { data: summary } = useApi<{ rotations: number; volume: number; revenue: number; margin: number; margin_rate: number | null; margin_min: number | null; to_invoice: { count: number; amount: number }; shortage_excess: { count: number; volume: number; value: number }; drafts: number; fleet: Record<string, number> }>("/transport/summary");
  const sousMinimum = Boolean(summary && summary.margin_rate !== null && summary.margin_min !== null && summary.margin_rate < summary.margin_min);
  return (
    <>
      {!summary ? <Loading /> : (
        <div className="mb-7 grid grid-cols-1 gap-5 xl:grid-cols-12">
          {/* Le chiffre de l'écran : le volume livré, au compteur, comme sur la citerne ; l'état de la flotte dessous. */}
          <section className="min-w-0 rounded-2xl border border-line bg-panel p-6 shadow-[var(--ombre-carte)] xl:col-span-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[16.5px] font-semibold text-ink">Volume livré ce mois</h2>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {summary.rotations} rotation{summary.rotations > 1 ? "s" : ""}, {fmtDec(summary.volume)} m³ au total
                </p>
              </div>
              <IconTile icon={Droplet} teinte="corail" />
            </div>
            <Compteur value={summary.volume} unit="m³" className="mt-5 text-[42px] text-ink sm:text-[50px]" />
            {summary.shortage_excess.count > 0 && (
              <p className="mt-2 text-[13px] font-medium text-danger">
                {fmtDec(summary.shortage_excess.volume)} m³ manquants au-delà de la tolérance sur {pluriel(summary.shortage_excess.count, "rotation")}
                {summary.shortage_excess.value ? `, ${fmtGNF(summary.shortage_excess.value)}` : ""}
              </p>
            )}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-[13px]">
                <span className="font-semibold text-ink-2">Flotte</span>
                <span className="text-muted">{(summary.fleet.service ?? 0) + (summary.fleet.maintenance ?? 0) + (summary.fleet.off ?? 0)} ensembles</span>
              </div>
              <Repartition
                parts={[
                  { key: "service", label: "En service", value: summary.fleet.service ?? 0, color: "#12956a" },
                  { key: "maintenance", label: "En maintenance", value: summary.fleet.maintenance ?? 0, color: "#df8f17" },
                  { key: "off", label: "Hors service", value: summary.fleet.off ?? 0, color: "#ec4f49" },
                ]}
                format={(v) => `${v}`}
              />
            </div>
          </section>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-7">
            <Kpi label="Chiffre d'affaires du mois" value={fmtShort(summary.revenue)} icon={TrendingUp} teinte="jade" hint="Rotations validées et facturées" />
            <Kpi
              label="Marge du mois"
              value={fmtShort(summary.margin)}
              icon={Percent}
              teinte={sousMinimum ? "ambre" : "jade"}
              tone={summary.margin_rate === null || summary.margin_min === null ? "neutral" : sousMinimum ? "warn" : "ok"}
              hint={`Taux de marge ${fmtPct(summary.margin_rate)}, ${summary.margin_min !== null ? `minimum ${fmtPct(summary.margin_min, 0)}` : "seuil non fixé"}`}
            />
            <Kpi label="À facturer" value={fmtShort(summary.to_invoice.amount)} icon={Receipt} teinte="or" tone="accent" hint={pluriel(summary.to_invoice.count, "rotation validée", "rotations validées")} />
            <Kpi label="Saisies à valider" value={String(summary.drafts)} icon={Smartphone} teinte="corail" tone={summary.drafts > 0 ? "warn" : "neutral"} hint="Rotations saisies au bureau ou au parc" />
          </div>
        </div>
      )}
    </>
  );
}

interface Controle { code: string; label: string; ok: boolean; count: number; items: string[]; hint: string }

/** Contrôles permanents de la flotte et des rotations (vigilance, non bloquants). */
export function Controles() {
  const { data } = useApi<Controle[]>("/transport/controls");
  return (
    <Card title="Contrôles de la flotte et des rotations">
      {!data ? <Loading /> : (
        <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          {data.map((c) => (
            <li key={c.code} className="flex items-start gap-3 border-b border-line py-2.5">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-ok" /> : <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-warn" />}
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-ink">{c.label}{!c.ok && <span className="ml-2 font-mono text-[12.5px] text-warn">{c.count}</span>}</p>
                {!c.ok && (
                  <>
                    <p className="mt-0.5 text-[12.5px] text-muted">{c.items.slice(0, 4).join(" ; ")}{c.count > 4 ? "…" : ""}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-2">{c.hint}</p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
