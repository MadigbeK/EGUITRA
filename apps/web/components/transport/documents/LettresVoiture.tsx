"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "@/components/icons";
import { Badge, Card, DataTable, Etat, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtDateTime, fmtGNF, fmtInt } from "@/lib/format";
import type { LettreVoiture } from "./types";

type Vue = "to_receive" | "received" | "demurrage" | "all";

const ONGLETS: Array<{ key: Vue; label: string }> = [
  { key: "to_receive", label: "À recevoir" },
  { key: "received", label: "Reçues" },
  { key: "demurrage", label: "Immobilisations" },
  { key: "all", label: "Toutes" },
];

/**
 * Lettres de voiture et réceptions : opérations parties à recevoir, réceptions saisies (volume reçu, manquant,
 * avarie), immobilisations au-delà de la franchise. La saisie se fait dans la fiche de l'opération.
 */
export function LettresVoiture() {
  const [vue, setVue] = useState<Vue>("to_receive");
  const { data, error, mutate } = useApi<{ view: Vue; items: LettreVoiture[] }>(`/transport/waybills?view=${vue}`, { keepPreviousData: true });
  return (
    <div>
      <Tabs tabs={ONGLETS} value={vue} onChange={setVue} />
      <Card padded={false}>
        {!data || data.view !== vue ? <Etat error={error} onRetry={() => mutate()} /> : (
          <DataTable
            rows={data.items}
            rowKey={(w) => w.rotation.id}
            empty={vue === "to_receive" ? "Aucune opération en attente de réception." : "Aucune lettre de voiture."}
            columns={[
              { key: "op", label: "Opération", render: (w) => <Link className="inline-flex items-center gap-1 font-mono text-xs text-accent underline" href={`/transport/operations?id=${w.rotation.id}`}>{w.rotation.name}<ArrowUpRight className="h-3 w-3" /></Link> },
              { key: "lv", label: "Lettre", render: (w) => w.name ?? <span className="text-muted">non imprimée</span> },
              { key: "vehicle", label: "Ensemble", render: (w) => w.operation?.vehicle.name ?? "–" },
              { key: "eta", label: "Arrivée prévue", render: (w) => fmtDate(w.operation?.date_planned_arrival) },
              { key: "dest", label: "Destination", render: (w) => w.effective.destination ?? "–" },
              { key: "loaded", label: "Chargé (L)", align: "right", render: (w) => fmtInt(w.rotation.volume_loaded * 1000) },
              { key: "received", label: "Reçu conforme (L)", align: "right", render: (w) => (w.reception?.received_qty ? fmtInt(w.reception.received_qty) : "–") },
              { key: "shortage", label: "Manquant (L)", align: "right", render: (w) => (w.reception?.received_qty ? <span className={w.reception.shortage_qty ? "text-danger" : ""}>{fmtInt(w.reception.shortage_qty)}</span> : "–") },
              { key: "immo", label: "Immobilisation", render: (w) => w.reception?.immobilized_days ? (
                <span>{w.reception.immobilized_days} j, dont {w.reception.billable_days} au-delà{w.reception.demurrage_amount ? ` · ${fmtGNF(w.reception.demurrage_amount)}` : ""}</span>
              ) : "–" },
              { key: "visa", label: "Réception", render: (w) => w.reception?.received_at ? <Badge tone="ok">{w.reception.receiver_visa ? "Visée" : "Saisie"} le {fmtDateTime(w.reception.received_at)}</Badge> : <Badge tone="warn">À recevoir</Badge> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
