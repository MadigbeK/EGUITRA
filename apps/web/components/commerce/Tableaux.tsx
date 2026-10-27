"use client";

/**
 * Tableaux de bord des ventes et des achats de la société de travail, exportables en XLSX (tous les
 * tableaux) et en CSV (le tableau affiché).
 */

import { useState } from "react";
import { Download } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Kpi, Notice, PageHeader, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { fmtDate, fmtGNF, fmtInt, fmtPct } from "@/lib/format";

interface LigneCommande { id: number; name: string; partner: string; object: string; chantier: string; ordered: number; invoiced: number; advances: number; advances_deducted: number; to_deduct: number; to_invoice: number }
interface Ventes {
  period: { date_from: string; date_to: string };
  kpis: { open_count: number; open_amount: number; expiring_count: number; expired_pending: number; decided_count: number; accepted_count: number; conversion_rate: number | null; conversion_amount_rate: number | null; accepted_amount: number; to_invoice_count: number; to_invoice_amount: number; to_deduct_amount: number };
  reminder_days: number;
  offers: Array<{ id: number; name: string; partner: string; object: string; date: string; validity_date: string | null; status: string; expires_in: number | null; amount_untaxed: number }>;
  orders: LigneCommande[];
  advances: LigneCommande[];
}
interface AchatsTb {
  kpis: { to_receive_count: number; to_receive_amount: number; late_count: number; to_bill_count: number; to_bill_amount: number; gaps_count: number; commitments_count: number; commitments_remaining: number; in_approval: number };
  to_receive: Array<{ id: number; name: string; partner: string; object: string; date_planned: string | null; late: boolean; status: string; amount_untaxed: number; remaining_untaxed: number }>;
  to_bill: Array<{ id: number; name: string; partner: string; object: string; amount: number }>;
  gaps: Array<{ id: number; name: string; partner: string; order: string; amount_untaxed: number; issues: string; approval: string }>;
  commitments: Array<{ id: number; name: string; partner: string; object: string; date: string; amount: number; ordered: number; consumed: number; remaining: number }>;
}

function Exports({ path, feuille }: { path: string; feuille: number }) {
  const envoi = useEnvoi();
  const sep = path.includes("?") ? "&" : "?";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button loading={envoi.busy === "xlsx"} disabled={!!envoi.busy} onClick={() => void envoi.telecharger("xlsx", `${path}${sep}format=xlsx`, "tableau-de-bord.xlsx")}><Download className="h-4 w-4" /> Excel</Button>
        <Button loading={envoi.busy === "csv"} disabled={!!envoi.busy} onClick={() => void envoi.telecharger("csv", `${path}${sep}format=csv&sheet=${feuille}`, "tableau.csv")}><Download className="h-4 w-4" /> CSV du tableau</Button>
      </div>
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
    </div>
  );
}

export function TableauVentes() {
  const debut = `${new Date().getFullYear()}-01-01`;
  const [du, setDu] = useState(debut);
  const [au, setAu] = useState("");
  const [onglet, setOnglet] = useState<"offers" | "orders" | "advances">("offers");
  const params = new URLSearchParams({ date_from: du });
  if (au) params.set("date_to", au);
  const path = `/commerce/sales/dashboard?${params.toString()}`;
  const { data, error, mutate } = useApi<Ventes>(path);
  const feuille = { offers: 1, orders: 2, advances: 3 }[onglet];
  return (
    <div>
      <PageHeader title="Tableau de bord des ventes" subtitle="Offres en cours, transformation des offres décidées sur la période, commandes à facturer, acomptes à déduire." actions={<Exports path={path} feuille={feuille} />} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="Offres datées du"><Input type="date" value={du} onChange={(e) => setDu(e.target.value)} /></Field>
        <Field label="au"><Input type="date" value={au} onChange={(e) => setAu(e.target.value)} /></Field>
      </div>
      <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul du tableau de bord…">
        {(d) => (
          <>
            <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Offres en cours" value={fmtInt(d.kpis.open_count)} hint={`${fmtGNF(d.kpis.open_amount)} HT · ${d.kpis.expiring_count} expirent sous ${d.reminder_days} j`} tone={d.kpis.expiring_count ? "warn" : "neutral"} />
              <Kpi label="Taux de transformation" value={d.kpis.conversion_rate === null ? "–" : fmtPct(d.kpis.conversion_rate)} hint={`${d.kpis.accepted_count} acceptées sur ${d.kpis.decided_count} décidées ; ${d.kpis.conversion_amount_rate === null ? "–" : fmtPct(d.kpis.conversion_amount_rate)} en montant`} />
              <Kpi label="Reste à facturer" value={fmtGNF(d.kpis.to_invoice_amount)} hint={`${d.kpis.to_invoice_count} commande${d.kpis.to_invoice_count > 1 ? "s" : ""}, HT`} />
              <Kpi label="Acomptes à déduire" value={fmtGNF(d.kpis.to_deduct_amount)} hint="Acomptes et avances facturés, pas encore déduits (HT)" />
            </div>
            <Card padded={false}>
              <div className="px-4 pt-3"><Tabs tabs={[{ key: "offers", label: "Offres en cours", count: d.offers.length }, { key: "orders", label: "Commandes à facturer", count: d.orders.length }, { key: "advances", label: "Acomptes à déduire", count: d.advances.length }]} value={onglet} onChange={setOnglet} /></div>
              {onglet === "offers" && <DataTable rows={d.offers} rowKey={(o) => o.id} empty="Aucune offre en cours." columns={[
                { key: "name", label: "Offre", render: (o) => <span className="font-mono text-xs">{o.name}</span> },
                { key: "partner", label: "Client" }, { key: "object", label: "Objet" },
                { key: "validity_date", label: "Validité", render: (o) => <span>{fmtDate(o.validity_date)}{o.expires_in !== null && o.expires_in <= d.reminder_days && <span className="block text-[12px] font-semibold text-warn">{o.expires_in < 0 ? "expirée, à clore" : `${o.expires_in} j`}</span>}</span> },
                { key: "status", label: "État", render: (o) => <Badge>{o.status}</Badge> },
                { key: "amount_untaxed", label: "HT (GNF)", align: "right", render: (o) => fmtInt(o.amount_untaxed) },
              ]} />}
              {onglet === "orders" && <DataTable rows={d.orders} rowKey={(o) => o.id} empty="Aucune commande à facturer." columns={[
                { key: "name", label: "Commande", render: (o) => <span className="font-mono text-xs">{o.name}</span> },
                { key: "partner", label: "Client" }, { key: "chantier", label: "Chantier", render: (o) => o.chantier || "–" },
                { key: "ordered", label: "Commandé HT", align: "right", render: (o) => fmtInt(o.ordered) },
                { key: "invoiced", label: "Facturé HT", align: "right", render: (o) => fmtInt(o.invoiced) },
                { key: "to_invoice", label: "Reste HT", align: "right", render: (o) => fmtInt(o.to_invoice) },
              ]} />}
              {onglet === "advances" && <DataTable rows={d.advances} rowKey={(o) => o.id} empty="Aucun acompte à déduire." columns={[
                { key: "name", label: "Commande", render: (o) => <span className="font-mono text-xs">{o.name}</span> },
                { key: "partner", label: "Client" },
                { key: "advances", label: "Facturés HT", align: "right", render: (o) => fmtInt(o.advances) },
                { key: "advances_deducted", label: "Déduits HT", align: "right", render: (o) => fmtInt(o.advances_deducted) },
                { key: "to_deduct", label: "À déduire HT", align: "right", render: (o) => fmtInt(o.to_deduct) },
              ]} />}
            </Card>
          </>
        )}
      </Etat>
    </div>
  );
}

export function TableauAchats() {
  const path = "/commerce/purchases/dashboard";
  const { data, error, mutate } = useApi<AchatsTb>(path);
  const [onglet, setOnglet] = useState<"to_receive" | "to_bill" | "gaps" | "commitments">("to_receive");
  const feuille = { to_receive: 1, to_bill: 2, gaps: 3, commitments: 4 }[onglet];
  return (
    <div>
      <PageHeader title="Tableau de bord des achats" subtitle="Commandes à recevoir, réceptions à facturer, écarts de rapprochement, engagements non soldés." actions={<Exports path={path} feuille={feuille} />} />
      <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul du tableau de bord…">
        {(d) => (
          <>
            <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="À recevoir" value={fmtGNF(d.kpis.to_receive_amount)} hint={`${d.kpis.to_receive_count} bon${d.kpis.to_receive_count > 1 ? "s" : ""}, dont ${d.kpis.late_count} en retard`} tone={d.kpis.late_count ? "warn" : "neutral"} />
              <Kpi label="Reçu non facturé" value={fmtGNF(d.kpis.to_bill_amount)} hint={`${d.kpis.to_bill_count} bon${d.kpis.to_bill_count > 1 ? "s" : ""}, HT`} />
              <Kpi label="Écarts de rapprochement" value={fmtInt(d.kpis.gaps_count)} hint="Pièces d'achat en brouillon qui s'écartent de leur commande" tone={d.kpis.gaps_count ? "danger" : "neutral"} />
              <Kpi label="Engagements non soldés" value={fmtGNF(d.kpis.commitments_remaining)} hint={`${d.kpis.commitments_count} engagement${d.kpis.commitments_count > 1 ? "s" : ""} ; ${d.kpis.in_approval} bon${d.kpis.in_approval > 1 ? "s" : ""} en approbation`} />
            </div>
            <Card padded={false}>
              <div className="px-4 pt-3"><Tabs tabs={[{ key: "to_receive", label: "À recevoir", count: d.to_receive.length }, { key: "to_bill", label: "À facturer", count: d.to_bill.length }, { key: "gaps", label: "Écarts", count: d.gaps.length }, { key: "commitments", label: "Engagements non soldés", count: d.commitments.length }]} value={onglet} onChange={setOnglet} /></div>
              {onglet === "to_receive" && <DataTable rows={d.to_receive} rowKey={(r) => r.id} empty="Aucune commande en attente de réception." columns={[
                { key: "name", label: "Bon de commande", render: (r) => <span className="font-mono text-xs">{r.name}</span> },
                { key: "partner", label: "Fournisseur" }, { key: "object", label: "Objet" },
                { key: "date_planned", label: "Livraison prévue", render: (r) => <span>{fmtDate(r.date_planned)}{r.late && <span className="block text-[12px] font-semibold text-danger">en retard</span>}</span> },
                { key: "remaining_untaxed", label: "Reste à recevoir HT", align: "right", render: (r) => fmtInt(r.remaining_untaxed) },
              ]} />}
              {onglet === "to_bill" && <DataTable rows={d.to_bill} rowKey={(r) => r.id} empty="Aucune réception à facturer." columns={[
                { key: "name", label: "Bon de commande", render: (r) => <span className="font-mono text-xs">{r.name}</span> },
                { key: "partner", label: "Fournisseur" }, { key: "object", label: "Objet" },
                { key: "amount", label: "Reçu non facturé HT", align: "right", render: (r) => fmtInt(r.amount) },
              ]} />}
              {onglet === "gaps" && <DataTable rows={d.gaps} rowKey={(r) => r.id} empty="Aucun écart." columns={[
                { key: "name", label: "Pièce", render: (r) => r.name || "Brouillon" }, { key: "partner", label: "Fournisseur" },
                { key: "order", label: "Bon de commande" }, { key: "issues", label: "Écarts", render: (r) => <span className="text-[12.5px]">{r.issues}</span> },
                { key: "approval", label: "En validation", render: (r) => r.approval || "–" },
              ]} />}
              {onglet === "commitments" && <DataTable rows={d.commitments} rowKey={(r) => r.id} empty="Aucun engagement non soldé." columns={[
                { key: "name", label: "Engagement", render: (r) => <span className="font-mono text-xs">{r.name}</span> },
                { key: "partner", label: "Fournisseur" }, { key: "object", label: "Objet" },
                { key: "amount", label: "Engagé HT", align: "right", render: (r) => fmtInt(r.amount) },
                { key: "ordered", label: "Commandé HT", align: "right", render: (r) => fmtInt(r.ordered) },
                { key: "remaining", label: "Reste HT", align: "right", render: (r) => fmtInt(r.remaining) },
              ]} />}
            </Card>
          </>
        )}
      </Etat>
    </div>
  );
}
