"use client";

import { useState } from "react";
import { Droplet } from "@/components/icons";
import { Badge, Card, DataTable, Field, Input, Kpi, Loading, Select } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtDec, fmtGNF, fmtPct, fmtShort } from "@/lib/format";
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
  const { data } = useApi<{ rows: ProfitRow[] }>(`/transport/profitability?group=${group}&date_from=${from}&date_to=${to}`);
  const { data: list } = useApi<{ items: ShortageRotation[]; total_count: number }>(`/transport/rotations?shortage=excess&state=done,invoiced&date_from=${from}&date_to=${to}&limit=200`);
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
          <Kpi label="Manquant total" value={`${fmtDec(sum("shortage"))} m³`} icon={Droplet} teinte="corail" hint={`${fmtPct(loaded ? (sum("shortage") / loaded) * 100 : null, 2)} du volume chargé`} />
          <Kpi label="Hors tolérance" value={`${fmtDec(sum("shortage_excess"))} m³`} tone={sum("shortage_excess") > 0 ? "warn" : "ok"} hint={`${sum("excess_rotations")} rotation(s)`} />
          <Kpi label="Valeur hors tolérance" value={fmtShort(sum("shortage_value"))} tone={sum("shortage_value") > 0 ? "warn" : "neutral"} hint="Au prix du m³ du produit ou du tarif" />
          <Kpi label="Coût net pour la marge" value={fmtShort(sum("shortage_net_cost"))} hint={`Déduit ${fmtShort(sum("shortage_deduction"))}, réclamé aux chauffeurs ${fmtShort(sum("shortage_claim"))}`} />
        </div>
      )}
      <Card padded={false}>
        {!data ? <Loading /> : (
          <DataTable rows={rows} rowKey={(r, i) => `${r.key}-${i}`} empty="Aucune rotation validée sur la période." columns={[
            { key: "label", label: GROUPS.find((g) => g.value === group)?.label ?? "Libellé" },
            { key: "rotations", label: "Rotations", align: "right", render: (r) => String(r.rotations) },
            { key: "volume_loaded", label: "Chargé (m³)", align: "right", render: (r) => fmtDec(r.volume_loaded) },
            { key: "shortage", label: "Manquant (m³)", align: "right", render: (r) => fmtDec(r.shortage) },
            { key: "shortage_rate", label: "Taux", align: "right", render: (r) => fmtPct(r.shortage_rate, 2) },
            { key: "shortage_tolerated", label: "Toléré (m³)", align: "right", render: (r) => fmtDec(r.shortage_tolerated) },
            { key: "shortage_excess", label: "Hors tolérance (m³)", align: "right", render: (r) => <span className={r.shortage_excess > 0 ? "font-semibold text-danger" : ""}>{fmtDec(r.shortage_excess)}</span> },
            { key: "excess_rotations", label: "Rotations hors tol.", align: "right", render: (r) => String(r.excess_rotations) },
            { key: "shortage_value", label: "Valeur", align: "right", render: (r) => fmtGNF(r.shortage_value) },
            { key: "shortage_deduction", label: "Déduit", align: "right", render: (r) => fmtShort(r.shortage_deduction) },
            { key: "shortage_claim", label: "Réclamé", align: "right", render: (r) => fmtShort(r.shortage_claim) },
          ]} />
        )}
      </Card>
      <Card title="Rotations hors tolérance" padded={false}>
        {!list ? <Loading /> : (
          <DataTable dense rows={list.items} rowKey={(r) => r.id} empty="Aucune rotation au-delà de la tolérance sur la période." columns={[
            { key: "name", label: "N°", render: (r) => <span className="font-mono text-xs">{r.name ?? "–"}</span> },
            { key: "date_loading", label: "Chargement", render: (r) => fmtDate(r.date_loading) },
            { key: "vehicle", label: "Ensemble", render: (r) => r.vehicle.name },
            { key: "driver", label: "Chauffeur", render: (r) => r.driver?.name ?? "–" },
            { key: "client", label: "Client", render: (r) => r.client.name },
            { key: "shortage", label: "Manquant", align: "right", render: (r) => `${fmtDec(r.shortage)} m³${r.volume_correction ? " à 15 °C" : ""}` },
            { key: "shortage_excess", label: "Hors tolérance", align: "right", render: (r) => `${fmtDec(r.shortage_excess)} m³ (tol. ${fmtDec(r.shortage_tolerance)} %)` },
            { key: "shortage_value", label: "Valeur", align: "right", render: (r) => fmtGNF(r.shortage_value) },
            { key: "shortage_rule", label: "Traitement", render: (r) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {SHORTAGE_RULES.find((x) => x.value === r.shortage_rule)?.label ?? "–"}
                {r.shortage_claim > 0 && r.state === "invoiced" && (r.shortage_claim_move ? <Badge tone="ok">Créance {r.shortage_claim_move.name ?? "en brouillon"}</Badge> : <Badge tone="danger">Créance non passée</Badge>)}
              </span>
            ) },
          ]} />
        )}
      </Card>
    </div>
  );
}
