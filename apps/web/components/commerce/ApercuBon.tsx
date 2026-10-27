"use client";

/** Bon de commande soumis, tel que l'approbateur le voit dans la corbeille « À valider ». */

import { Button, DataTable, Etat, Notice } from "@/components/ui";
import { Download } from "@/components/icons";
import { useApi } from "@/lib/api-client";
import type { BonCommande } from "@/lib/commerce-types";
import { useEnvoi } from "@/lib/envoi";
import { fmtDec, fmtGNF, fmtInt } from "@/lib/format";

export function ApercuBon({ id }: { id: number }) {
  const { data, error, mutate } = useApi<BonCommande>(`/commerce/purchase-orders/${id}`);
  const envoi = useEnvoi();
  return (
    <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement du bon de commande…">
      {(o) => (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <b className="font-mono text-xs">{o.name}</b> · {o.object ?? "Sans objet"} · {fmtGNF(o.amount_untaxed, o.currency)} HT
              {o.commitment && <span className="text-muted"> · engagement {o.commitment.name}</span>}
            </div>
            <Button size="sm" loading={envoi.busy === "pdf"} disabled={!!envoi.busy} onClick={() => void envoi.telecharger("pdf", `/commerce/purchase-orders/${o.id}/pdf`, `Bon de commande ${o.name}.pdf`)}><Download className="h-4 w-4" /> PDF</Button>
          </div>
          {o.created_by && <p className="text-[12.5px] text-muted">Saisi par {o.created_by.name} : ni lui, ni le demandeur de son engagement ne tranchent une étape.</p>}
          {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
          <DataTable dense rows={(o.lines ?? []).filter((l) => l.display_type === "product")} rowKey={(l) => l.id} columns={[
            { key: "name", label: "Désignation", render: (l) => <div>{l.name}{l.category && <div className="text-[11.5px] text-muted">{l.category.name}</div>}</div> },
            { key: "account", label: "Compte", render: (l) => l.account?.code ?? "Article" },
            { key: "quantity", label: "Qté", align: "right", render: (l) => `${fmtDec(l.quantity)} ${l.uom?.name ?? ""}` },
            { key: "price_unit", label: "PU HT", align: "right", render: (l) => fmtInt(l.price_unit) },
            { key: "price_subtotal", label: "HT", align: "right", render: (l) => fmtInt(l.price_subtotal) },
          ]} />
        </div>
      )}
    </Etat>
  );
}
