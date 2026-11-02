"use client";

/** Bon de commande soumis, tel que l'approbateur le voit dans la corbeille « À valider ». */

import { Button, DataTable, Etat, Notice } from "@/components/ui";
import { Download } from "@/components/icons";
import { useApi } from "@/lib/api-client";
import type { BonCommande } from "@/lib/commerce-types";
import { useEnvoi } from "@/lib/envoi";
import { fmtDate, fmtDec, fmtGNF, fmtInt } from "@/lib/format";

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
          {o.created_by && <p className="text-[12.5px] text-muted">Saisi par {o.created_by.name} : ni lui, ni le demandeur de son engagement ne tranchent une étape ; une même personne ne tranche qu&apos;une étape.</p>}
          {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
          <div className="grid grid-cols-1 gap-1 text-[12.5px] md:grid-cols-2">
            <div><span className="text-muted">{o.quote_kind_label} du fournisseur : </span>{o.partner_ref ? `${o.partner_ref}${o.quote_date ? ` du ${fmtDate(o.quote_date)}` : ""}` : "non renseigné"}</div>
            <div><span className="text-muted">Paiement : </span>{[o.payment_term?.name, o.payment_note].filter(Boolean).join(" – ") || "–"}</div>
            <div><span className="text-muted">Livraison : </span>{[o.date_planned ? `le ${fmtDate(o.date_planned)}` : "", o.delivery_days ? `délai ${fmtInt(o.delivery_days)} jours` : "", o.delivery_place ?? ""].filter(Boolean).join(" · ") || "–"}</div>
            <div><span className="text-muted">Montant : </span>{fmtGNF(o.amount_untaxed, o.currency)} HT · {o.amount_tax ? `${fmtGNF(o.amount_total, o.currency)} TTC` : "sans TVA"}</div>
          </div>
          {(o.documents ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {(o.documents ?? []).map((p) => (
                <Button key={p.id} size="sm" variant="ghost" loading={envoi.busy === `pj${p.id}`} disabled={!!envoi.busy} onClick={() => void envoi.telecharger(`pj${p.id}`, `/commerce/purchase-documents/${p.id}`, p.name)}>
                  <Download className="h-4 w-4" /> {p.category_label} : {p.name}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">Aucune pièce jointe (devis, proforma) : à vérifier au contrôle.</p>
          )}
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
