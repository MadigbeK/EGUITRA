"use client";

import { useMemo, useState } from "react";
import { Badge, Card, DataTable, Etat, Field, Input, Select } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtInt, fmtPct, pluriel } from "@/lib/format";
import { INSECABLE, fmtFixe } from "./commun";
import type { OfficialRate, RateGap } from "./types";

export interface OfficialScale {
  scale: { id: number; name: string; authority: string | null; date_signed: string | null; date_from: string; note: string | null; rate_count: number } | null;
  depots: Array<{ code: string; label: string; count: number }>;
  items: OfficialRate[];
  tolerance: number;
}

/** Écart d'un tarif au barème officiel : signé, en alerte au-delà de la tolérance de la société. */
export function EcartBareme({ gap }: { gap: RateGap | null | undefined }) {
  if (!gap) return null;
  const texte = `${gap.pct > 0 ? "+" : ""}${fmtPct(gap.pct)}`;
  return gap.flagged
    ? <span title="Écart au barème officiel au-delà de la tolérance (Paramètres)"><Badge tone="warn">{texte}</Badge></span>
    : <span className="text-[11.5px] text-muted" title="Écart au barème officiel, dans la tolérance">{texte}</span>;
}

/** Libellé d'une destination du barème : « Siguiri, depuis Conakry, 1 142,35 GNF/L ». */
export const libelleBareme = (r: OfficialRate) => `${r.destination}, depuis ${r.depot_label.split(" (")[0]}, ${fmtFixe(r.rate, 2)}${INSECABLE}GNF/L`;

/** Barème officiel du transport des hydrocarbures : destinations par dépôt, tarif par litre et par m³. */
export function Bareme() {
  const { data, error, mutate } = useApi<OfficialScale>("/transport/official-rates");
  const [depot, setDepot] = useState("");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const wanted = q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return (data?.items ?? []).filter((r) => (!depot || r.depot === depot) && (!wanted || `${r.destination} ${r.prefecture ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(wanted)));
  }, [data, depot, q]);
  if (!data) return <Etat error={error} onRetry={() => mutate()} />;
  const s = data.scale;
  return (
    <div className="space-y-4">
      <Card title={s ? s.name : "Aucun barème en vigueur"}>
        {s ? (
          <div className="space-y-1.5 text-[13.5px] text-ink-2">
            <p>
              {s.authority ?? "Autorité non renseignée"}{s.date_signed ? `, signé le ${fmtDate(s.date_signed)}` : ""}, en vigueur depuis le {fmtDate(s.date_from)} : {pluriel(s.rate_count, "destination")}, tarifs en GNF par litre transporté.
            </p>
            {s.note && <p className="text-muted">{s.note}</p>}
            <p className="text-muted">
              Chiffres de l&apos;annexe signée, qui fait foi. Une route rattachée à une destination (Routes et tarifs) prend ce tarif pour référence ;
              un tarif de route, de client ou de rotation qui s&apos;en écarte de plus de {fmtPct(data.tolerance)} est signalé, sans rien bloquer.
            </p>
          </div>
        ) : <p className="text-[13.5px] text-muted">Le barème se charge avec le module Transport.</p>}
      </Card>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Dépôt">
          <Select value={depot} onChange={(e) => setDepot(e.target.value)} options={[{ value: "", label: "Tous les dépôts" }, ...data.depots.map((d) => ({ value: d.code, label: `${d.label} (${fmtInt(d.count)})` }))]} />
        </Field>
        <Field label="Destination ou préfecture"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Siguiri, Boké…" /></Field>
      </div>
      <Card padded={false}>
        <DataTable rows={rows} rowKey={(r) => r.id} dense empty="Aucune destination pour ce filtre." columns={[
          { key: "sequence", label: "N°", align: "right", render: (r) => fmtInt(r.sequence) },
          { key: "destination", label: "Destination" },
          { key: "prefecture", label: "Préfecture", render: (r) => r.prefecture ?? <span className="text-muted">–</span> },
          { key: "depot", label: "Dépôt", render: (r) => r.depot_label, sortValue: (r) => r.depot_label },
          { key: "rate", label: "Tarif (GNF/L)", align: "right", render: (r) => fmtFixe(r.rate, 2) },
          { key: "rate_per_m3", label: "Par m³ (GNF)", align: "right", render: (r) => fmtInt(r.rate_per_m3) },
          { key: "distance_km", label: "Distance estimée (km)", align: "right", render: (r) => (r.distance_km ? <span title="Estimation dérivée du tarif (tableur de la SONAP), à vérifier sur le terrain">{fmtFixe(r.distance_km, 1)}</span> : <span className="text-muted">–</span>) },
        ]} />
      </Card>
    </div>
  );
}
