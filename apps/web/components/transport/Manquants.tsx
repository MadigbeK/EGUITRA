"use client";

import { useState } from "react";
import { Badge, Card, DataTable, Etat, Field, Input, Kpi, Select } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { tonEtat } from "@/lib/couleurs";
import { fmtDate, fmtDec, fmtInt, fmtPct, fmtShort, pluriel } from "@/lib/format";
import { INSECABLE, fmtM3, fmtVolume } from "./commun";
import { SHORTAGE_RULES, type ProfitRow, type Ref, type ShortageRule } from "./types";

interface ShortageRotation {
  id: number;
  name: string | null;
  date_loading: string;
  vehicle: Ref;
  driver: Ref | null;
  client: Ref;
  volume_loaded: number;
  volume_delivered: number;
  volume_correction: boolean;
  shortage: number;
  shortage_tolerance: number;
  shortage_excess: number;
  shortage_value: number;
  shortage_rule: ShortageRule;
  shortage_deduction: number;
  shortage_claim: number;
  shortage_claim_move: { id: number; name: string | null; state: string } | null;
  state: string;
}

const GROUPS = [{ value: "driver", label: "Chauffeur" }, { value: "vehicle", label: "Ensemble routier" }, { value: "client", label: "Client" }, { value: "route", label: "Route" }];

/** Manquants par chauffeur, ensemble, client ou route : toléré, excédentaire, valorisé, déduit, réclamé. */
export function Manquants() {
  const [group, setGroup] = useState("driver");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data, error: erreurMarges, mutate: majMarges } = useApi<{ rows: ProfitRow[] }>(`/transport/profitability?group=${group}&date_from=${from}&date_to=${to}`);
  const { data: list, error: erreurRotations, mutate: majRotations } = useApi<{ items: ShortageRotation[]; total_count: number }>(`/transport/rotations?shortage=excess&state=done,invoiced&date_from=${from}&date_to=${to}&limit=200`);
  const rows = data?.rows ?? [];
  const sum = (k: keyof ProfitRow) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const loaded = sum("volume_loaded");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Par"><Select value={group} onChange={(e) => setGroup(e.target.value)} options={GROUPS} /></Field>
        <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Manquant total" value={fmtM3(sum("shortage"))} hint={`${fmtPct(loaded ? (sum("shortage") / loaded) * 100 : null, 2)} du volume chargé`} />
          <Kpi label="Hors tolérance" value={fmtM3(sum("shortage_excess"))} tone={sum("shortage_excess") > 0 ? "warn" : "ok"} hint={pluriel(sum("excess_rotations"), "rotation")} />
          <Kpi label="Valeur hors tolérance" value={fmtShort(sum("shortage_value"))} tone={sum("shortage_value") > 0 ? "warn" : "neutral"} hint="Au prix du m³ du produit ou du tarif" />
          <Kpi label="Coût net pour la marge" value={fmtShort(sum("shortage_net_cost"))} hint={`Déduit ${fmtShort(sum("shortage_deduction"))}, réclamé aux chauffeurs ${fmtShort(sum("shortage_claim"))}`} />
        </div>
      )}
      <Card padded={false}>
        {!data ? <Etat error={erreurMarges} onRetry={() => majMarges()} /> : (
          <DataTable rows={rows} rowKey={(r, i) => `${r.key}-${i}`} empty="Aucune rotation validée sur la période." columns={[
            { key: "label", label: GROUPS.find((g) => g.value === group)?.label ?? "Libellé" },
            { key: "rotations", label: "Rotations", align: "right", render: (r) => fmtInt(r.rotations) },
            { key: "volume_loaded", label: "Chargé (m³)", align: "right", render: (r) => fmtVolume(r.volume_loaded) },
            { key: "shortage", label: "Manquant (m³)", align: "right", render: (r) => fmtVolume(r.shortage) },
            { key: "shortage_rate", label: "Taux", align: "right", render: (r) => fmtPct(r.shortage_rate, 2) },
            { key: "shortage_tolerated", label: "Toléré (m³)", align: "right", render: (r) => fmtVolume(r.shortage_tolerated) },
            { key: "shortage_excess", label: "Hors tolérance (m³)", align: "right", render: (r) => <span className={r.shortage_excess > 0 ? "font-semibold text-danger" : ""}>{fmtVolume(r.shortage_excess)}</span> },
            { key: "excess_rotations", label: "Rotations hors tol.", align: "right", render: (r) => fmtInt(r.excess_rotations) },
            { key: "shortage_value", label: "Valeur (GNF)", align: "right", render: (r) => fmtInt(r.shortage_value) },
            { key: "shortage_deduction", label: "Déduit (GNF)", align: "right", render: (r) => fmtInt(r.shortage_deduction) },
            { key: "shortage_claim", label: "Réclamé (GNF)", align: "right", render: (r) => fmtInt(r.shortage_claim) },
          ]} />
        )}
      </Card>
      <Card title="Rotations hors tolérance" padded={false}>
        {!list ? <Etat error={erreurRotations} onRetry={() => majRotations()} /> : (
          <DataTable dense rows={list.items} rowKey={(r) => r.id} empty="Aucune rotation au-delà de la tolérance sur la période." columns={[
            { key: "name", label: "N°", render: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.name ?? "–"}</span> },
            { key: "date_loading", label: "Chargement", render: (r) => <span className="whitespace-nowrap">{fmtDate(r.date_loading)}</span> },
            { key: "vehicle", label: "Ensemble", render: (r) => r.vehicle.name },
            { key: "driver", label: "Chauffeur", render: (r) => r.driver?.name ?? "–" },
            { key: "client", label: "Client", render: (r) => r.client.name },
            { key: "shortage", label: "Manquant (m³)", align: "right", render: (r) => <>{r.volume_correction && <span className="mr-1.5 font-sans text-[11.5px] text-muted">à 15{INSECABLE}°C</span>}{fmtVolume(r.shortage)}</> },
            { key: "shortage_excess", label: "Hors tolérance (m³)", align: "right", render: (r) => <><span className="mr-1.5 font-sans text-[11.5px] text-muted">tol. {fmtDec(r.shortage_tolerance)}{INSECABLE}%</span>{fmtVolume(r.shortage_excess)}</> },
            { key: "shortage_value", label: "Valeur (GNF)", align: "right", render: (r) => fmtInt(r.shortage_value) },
            { key: "shortage_rule", label: "Traitement", render: (r) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {SHORTAGE_RULES.find((x) => x.value === r.shortage_rule)?.label ?? "–"}
                {r.shortage_claim > 0 && r.state === "invoiced" && (r.shortage_claim_move ? <Badge tone={r.shortage_claim_move.state === "posted" ? "ok" : tonEtat("Brouillon")}>Créance {r.shortage_claim_move.name ?? "en brouillon"}</Badge> : <Badge tone="danger">Créance non passée</Badge>)}
              </span>
            ) },
          ]} />
        )}
      </Card>
    </div>
  );
}
