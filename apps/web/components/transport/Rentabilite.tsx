"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "@/components/icons";
import { Badge, Card, DataTable, Etat, Field, Input, Kpi, Select } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { tonEtat } from "@/lib/couleurs";
import { fmtGNF, fmtInt, fmtMonth, fmtPct, fmtShort, pluriel } from "@/lib/format";
import { INSECABLE, TauxMarge, fmtFixe, fmtVolume } from "./commun";
import type { ProfitRow } from "./types";

export interface Control { code: string; label: string; ok: boolean; count: number; items: string[]; hint: string }

interface ReportRow extends ProfitRow {
  declared_cost: number;
  taxes_rebilled: number;
  km: number;
  fuel_liters: number;
  revenue_per_km: number | null;
  cost_per_km: number | null;
  cost_per_liter: number | null;
  fuel_per_100km: number | null;
  booked_cost: number | null;
  cost_gap: number | null;
  structure: number;
  net_result: number;
  booked_result: number | null;
}

interface StructureDetail {
  company: { id: number; name: string };
  transport_revenue: number;
  income_total: number;
  revenue_share: number | null;
  activity_charges: number;
  corporate_charges: number;
  fleet_depreciation: number;
  depreciation_source: "assets" | "2845";
  direct_costs: number;
  booked_direct_costs: number;
  km: number;
  structure: number;
  structure_booked: number;
}

interface Report {
  rows: ReportRow[];
  indicators: {
    transport_revenue: number; income_total: number | null; revenue_share: number | null; margin: number; margin_rate: number | null;
    margin_threshold: number | null; below_threshold: boolean; km: number; revenue_per_km: number | null; cost_per_km: number | null;
    fuel_per_100km: number | null; structure: number; structure_per_km: number | null; structure_booked: number;
    structure_booked_per_km: number | null; net_result: number; vehicles: number; deficit_vehicles: number; deficit_loss: number;
    declared_cost: number; booked_cost: number | null; cost_gap: number | null;
  };
  structure: { companies: StructureDetail[] };
  controls: Control[];
  fleet?: Flotte;
}

/** Indicateur de flotte du modèle du client : valeur, objectif, seuil d'alerte (%). */
interface FleetKpi { value: number | null; target: number | null; alert: number | null; basis: number; below_alert: boolean }
interface Flotte {
  availability: FleetKpi; utilization: FleetKpi; fill_rate: FleetKpi; on_time: FleetKpi;
  cancelled: number; fleet_age_years: number | null; vehicles: number; in_service: number;
}

/** Indicateur de flotte jugé contre l'objectif et le seuil d'alerte du client. */
function KpiFlotte({ label, kpi, hint }: { label: string; kpi: FleetKpi; hint: string }) {
  const tone = kpi.value === null || kpi.target === null ? "neutral" : kpi.below_alert ? "danger" : kpi.value < kpi.target ? "warn" : "ok";
  return <Kpi label={label} value={fmtPct(kpi.value, 0)} tone={tone} hint={`${hint}${kpi.target !== null ? ` ; objectif ${fmtPct(kpi.target, 0)}, alerte sous ${fmtPct(kpi.alert, 0)}` : ""}`} />;
}

const GROUPS = [{ value: "vehicle", label: "Ensemble routier" }, { value: "route", label: "Route" }, { value: "driver", label: "Chauffeur" }, { value: "client", label: "Client" }, { value: "month", label: "Mois" }];
/** Résultat signé, montant entier (l'unité est dans l'en-tête) : perte en alerte, gain favorable. */
const signed = (v: number | null) => (v === null ? "–" : <span className={v < 0 ? "font-semibold text-danger" : "text-ok-texte"}>{fmtInt(v)}</span>);

/** Rentabilité par trajet et par véhicule : coûts déclarés et comptabilisés, km, structure, résultat net. */
export function Rentabilite() {
  const [group, setGroup] = useState("vehicle");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data, error, mutate } = useApi<Report>(`/transport/profitability?group=${group}&date_from=${from}&date_to=${to}`);
  const ind = data?.indicators;
  // Colonnes comptables : axes analytiques disponibles, et profil qui lit la comptabilité.
  const booked = (group === "vehicle" || group === "route" || group === "month") && ind?.booked_cost !== null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Par"><Select value={group} onChange={(e) => setGroup(e.target.value)} options={GROUPS} /></Field>
        <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {ind && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Chiffre d'affaires transport" value={fmtShort(ind.transport_revenue)} hint={ind.income_total === null ? "Rotations validées et facturées" : ind.revenue_share === null ? "Part du CA : produits non comptabilisés" : `${fmtPct(ind.revenue_share)} des produits de la période`} />
          <Kpi label="Marge directe" value={fmtPct(ind.margin_rate)} tone={!ind.margin_threshold || ind.margin_rate === null ? "neutral" : ind.below_threshold ? "warn" : "ok"} hint={`${fmtShort(ind.margin)}${ind.margin_threshold ? `, seuil ${fmtPct(ind.margin_threshold, 0)}` : ", seuil non fixé"}`} />
          <Kpi label="Structure au km" value={ind.structure_per_km === null ? "–" : fmtGNF(ind.structure_per_km)} hint={`${fmtShort(ind.structure)} sur ${fmtInt(ind.km)}${INSECABLE}km ; ${ind.cost_per_km === null ? "–" : fmtInt(ind.cost_per_km)}${INSECABLE}GNF/km de coûts directs`} />
          <Kpi label="Ensembles déficitaires" value={`${fmtInt(ind.deficit_vehicles)}${INSECABLE}/${INSECABLE}${fmtInt(ind.vehicles)}`} tone={ind.deficit_vehicles ? "danger" : "ok"} hint={ind.deficit_vehicles ? `Perte cumulée ${fmtShort(ind.deficit_loss)} après structure` : `Résultat net ${fmtShort(ind.net_result)}`} />
        </div>
      )}
      {data?.fleet && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiFlotte label="Disponibilité de la flotte" kpi={data.fleet.availability} hint={`${fmtInt(data.fleet.in_service)} en service sur ${pluriel(data.fleet.vehicles, "ensemble")}, à ce jour`} />
          <KpiFlotte label="Utilisation de la flotte" kpi={data.fleet.utilization} hint="Jours en rotation sur les jours de la période" />
          <KpiFlotte label="Remplissage des citernes" kpi={data.fleet.fill_rate} hint={`Volume chargé sur capacité, ${pluriel(data.fleet.fill_rate.basis, "rotation")}`} />
          <KpiFlotte label="Respect des délais" kpi={data.fleet.on_time} hint={data.fleet.on_time.basis ? `Retour dans la durée standard de la route, ${pluriel(data.fleet.on_time.basis, "rotation datée", "rotations datées")}` : "Dates de retour ou durées standard des routes à saisir"} />
        </div>
      )}
      {data?.fleet && (
        <p className="text-[13px] text-muted">
          {pluriel(data.fleet.cancelled, "rotation annulée", "rotations annulées")} sur la période
          {data.fleet.fleet_age_years !== null ? `, âge moyen de la flotte ${fmtFixe(data.fleet.fleet_age_years, 1)}${INSECABLE}ans` : ""}.
          Objectifs et seuils repris du modèle d&apos;indicateurs du client.
        </p>
      )}
      {ind && (
        <p className="text-[13px] text-muted">
          Coûts déclarés {fmtShort(ind.declared_cost)}
          {ind.booked_cost !== null ? `, comptabilisés sur l'axe Ensemble routier ${fmtShort(ind.booked_cost)} (écart ${fmtShort(ind.cost_gap)})` : ""}
          {ind.fuel_per_100km !== null ? `, consommation ${fmtFixe(ind.fuel_per_100km, 1)}${INSECABLE}L/100${INSECABLE}km` : ""}{ind.revenue_per_km !== null ? `, ${fmtInt(ind.revenue_per_km)}${INSECABLE}GNF de CA par km` : ""}.
        </p>
      )}
      <Card padded={false}>
        {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
          <DataTable rows={data.rows} rowKey={(r, i) => `${r.key}-${i}`} empty="Aucune rotation validée sur la période." columns={[
            // Mois servis « 2026-01 » par le noyau : écrits « janv. 2026 », triés sur la clé.
            { key: "label", label: GROUPS.find((g) => g.value === group)?.label ?? "Libellé", render: (r) => (group === "month" ? fmtMonth(r.label) : r.label), sortValue: (r) => r.label },
            { key: "rotations", label: "Rot.", align: "right", render: (r) => fmtInt(r.rotations) },
            { key: "km", label: "km", align: "right", render: (r) => fmtInt(r.km) },
            { key: "volume", label: "Volume (m³)", align: "right", render: (r) => fmtVolume(r.volume) },
            { key: "revenue", label: "CA (GNF)", align: "right", render: (r) => fmtInt(r.revenue) },
            { key: "revenue_per_km", label: "CA/km (GNF)", align: "right", render: (r) => fmtInt(r.revenue_per_km) },
            { key: "standard_cost", label: "Coûts standard (GNF)", align: "right", render: (r) => <span title="Forfaits des routes au prix du carburant de la date de chargement">{fmtInt(r.standard_cost)}</span> },
            { key: "declared_cost", label: "Coûts déclarés (GNF)", align: "right", render: (r) => fmtInt(r.declared_cost) },
            ...(booked ? [
              { key: "booked_cost", label: "Coûts comptabilisés (GNF)", align: "right" as const, render: (r: ReportRow) => fmtInt(r.booked_cost) },
              { key: "cost_gap", label: "Écart (GNF)", align: "right" as const, render: (r: ReportRow) => <span className={(r.cost_gap ?? 0) > 0 ? "text-danger" : ""}>{fmtInt(r.cost_gap)}</span> },
            ] : []),
            { key: "cost_per_km", label: "Coût/km (GNF)", align: "right", render: (r) => fmtInt(r.cost_per_km) },
            { key: "cost_per_liter", label: "Coût/L (GNF)", align: "right", render: (r) => fmtInt(r.cost_per_liter) },
            { key: "fuel_per_100km", label: "L/100 km", align: "right", render: (r) => fmtFixe(r.fuel_per_100km, 1) },
            { key: "margin", label: "Marge (GNF)", align: "right", render: (r) => <span className={r.margin < 0 ? "font-semibold text-danger" : ""}>{fmtInt(r.margin)}</span> },
            { key: "margin_rate", label: "Taux", align: "right", render: (r) => <TauxMarge taux={r.margin_rate} minimum={ind?.margin_threshold ?? null} negative={r.margin < 0} /> },
            { key: "structure", label: "Structure (GNF)", align: "right", render: (r) => fmtInt(r.structure) },
            { key: "net_result", label: "Résultat net (GNF)", align: "right", render: (r) => signed(r.net_result) },
            ...(booked ? [{ key: "booked_result", label: "Résultat des pièces (GNF)", align: "right" as const, render: (r: ReportRow) => signed(r.booked_result) }] : []),
          ]} />
        )}
      </Card>
      {data && <Structure details={data.structure.companies} />}
      {data && <Controles controls={data.controls} />}
    </div>
  );
}

function Structure({ details }: { details: StructureDetail[] }) {
  if (!details.length) return null;
  return (
    <Card title="Charges de structure de la période">
      <div className="space-y-4 text-[13.5px]">
        {details.map((d) => (
          <div key={d.company.id} className="grid grid-cols-1 gap-x-8 gap-y-1.5 md:grid-cols-2">
            {details.length > 1 && <div className="font-semibold text-ink md:col-span-2">{d.company.name}</div>}
            <Ligne label="Charges de l'activité Transport pétrolier" value={d.activity_charges} />
            <Ligne label={`Charges non affectées × part du transport (${d.revenue_share === null ? "indéterminée" : fmtPct(d.revenue_share)})`} value={d.corporate_charges * (d.revenue_share ?? 0) / 100} />
            <Ligne label={d.depreciation_source === "assets" ? "Dotations des immobilisations des ensembles" : "Dotations du compte 2845 (aucun ensemble rattaché)"} value={d.fleet_depreciation} />
            <Ligne label="moins coûts directs déclarés" value={-d.direct_costs} />
            <Ligne label="Structure (coûts déclarés)" value={d.structure} strong />
            <Ligne label="Structure (coûts comptabilisés sur les ensembles)" value={d.structure_booked} strong />
          </div>
        ))}
        <p className="max-w-4xl text-[12.5px] leading-relaxed text-muted">
          La structure se répartit au km parcouru. Les charges de l&apos;activité contiennent les achats réels (carburant, péages) que les
          rotations déclarent aussi : la formule retranche les coûts déclarés, ce qui suppose que déclarations et pièces se recouvrent. Des
          pièces manquantes la sous-estiment, des frais déclarés sans pièce la gonflent. La colonne « Résultat (pièces) » retranche à la place
          les coûts comptabilisés sur l&apos;axe Ensemble routier : imputez les achats de la flotte à la fois sur l&apos;activité et sur l&apos;ensemble.
        </p>
      </div>
    </Card>
  );
}

function Ligne({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-line/70 py-1 ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>
      <span>{label}</span>
      <span className="whitespace-nowrap font-mono">{fmtGNF(value)}</span>
    </div>
  );
}

export function Controles({ controls }: { controls: Control[] }) {
  const failing = controls.filter((c) => !c.ok);
  return (
    <Card title="Contrôles de la flotte et des rotations" actions={failing.length ? <Badge tone="warn">{fmtInt(failing.length)} à traiter</Badge> : <Badge tone={tonEtat("Conforme")}>Conforme</Badge>}>
      <ul className="space-y-3 text-[13.5px]">
        {controls.map((c) => (
          <li key={c.code} className="flex items-start gap-3">
            {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-ok" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warn" />}
            <div className="min-w-0">
              <div className={c.ok ? "text-ink-2" : "font-semibold text-ink"}>{c.label}{c.ok ? "" : ` : ${fmtInt(c.count)}`}</div>
              {!c.ok && (
                <>
                  <div className="mt-0.5 text-muted">{c.items.join(" ; ")}{c.count > c.items.length ? ` (et ${pluriel(c.count - c.items.length, "autre")})` : ""}</div>
                  <div className="mt-0.5 text-[12.5px] text-muted">{c.hint}</div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
