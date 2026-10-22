"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Input, Kpi, Loading, PageHeader, Tabs, tonEtat } from "@/components/ui";
import { MoveDetailModal } from "./MoveDetailModal";
import { MoveForm } from "./MoveForm";
import { useAchatsSeul, useApi } from "@/lib/api-client";
import { MOVE_STATES, PAYMENT_STATES, type MoveSummary, type Paged } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF, fmtInt, fmtShort, pluriel } from "@/lib/format";

type View = "all" | "draft" | "posted" | "open" | "overdue" | "dispute" | "paid";

const VIEWS: Array<{ key: View; label: string }> = [
  { key: "all", label: "Toutes" },
  { key: "draft", label: "Brouillons" },
  { key: "open", label: "À régler" },
  { key: "overdue", label: "Échues" },
  { key: "dispute", label: "Litiges" },
  { key: "paid", label: "Soldées" },
];

/** Profil Achats : ses pièces se suivent par état (brouillon, soumise, comptabilisée), sans encours ni litiges. */
const VIEWS_ACHATS: Array<{ key: View; label: string }> = [
  { key: "all", label: "Toutes" },
  { key: "draft", label: "Brouillons et soumises" },
  { key: "posted", label: "Comptabilisées" },
];

function query(kind: "sales" | "purchases", view: View, search: string) {
  const types = kind === "sales" ? "out_invoice,out_refund" : "in_invoice,in_refund";
  const params = new URLSearchParams({ type: types, limit: "200" });
  if (view === "draft") params.set("state", "draft");
  if (view === "posted") params.set("state", "posted");
  if (view === "open") {
    params.set("state", "posted");
    params.set("payment_state", "not_paid,partial");
  }
  if (view === "overdue") params.set("overdue", "1");
  if (view === "dispute") params.set("dispute", "1");
  if (view === "paid") params.set("payment_state", "paid,in_payment");
  if (search) params.set("search", search);
  return `/finance/moves?${params.toString()}`;
}

/** Date du jour au format du noyau (« 2026-10-15 ») : Conakry vit à l'heure UTC. */
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Jours de retard d'une pièce, calculés ligne par ligne avec la règle du filtre « Échues » du noyau :
 * comptabilisée, non payée ou partielle, échéance passée. Seulement quand le profil lit le reste dû
 * (le profil Achats seul ne le lit pas) et qu'il en reste un. null sinon.
 */
function joursDeRetard(m: MoveSummary, jour: string): number | null {
  if (m.state !== "posted" || !m.invoice_date_due || m.invoice_date_due >= jour) return null;
  if (m.payment_state !== "not_paid" && m.payment_state !== "partial") return null;
  if (m.amount_residual === null || !(m.amount_residual > 0)) return null;
  return Math.round((Date.parse(`${jour}T00:00:00Z`) - Date.parse(`${m.invoice_date_due}T00:00:00Z`)) / 86_400_000);
}

/** Ton d'un état par son mot (table commune des états) ; à défaut, celui de la table de la pièce, hors couleur d'application. */
function tonPiece(label: string, ton: string | undefined) {
  return tonEtat(label, ton === "ok" || ton === "warn" || ton === "danger" ? ton : "neutral");
}

/**
 * État d'une pièce : litige, retard (« Échue » à la place de « Non payée »), règlement d'une pièce
 * comptabilisée, circuit d'approbation, ou état de saisie. Le ton vient de la table commune des états.
 */
export function MoveStatus({ m, jour = aujourdhui() }: { m: MoveSummary; jour?: string }) {
  if (m.dispute && m.state !== "cancel")
    return (
      <span title={m.dispute_reason ?? undefined}>
        <Badge tone="danger">Litige</Badge>
      </span>
    );
  if (m.state === "posted") {
    if (joursDeRetard(m, jour) !== null) return <Badge tone={tonEtat("Échue")}>Échue</Badge>;
    const reglement = PAYMENT_STATES[m.payment_state];
    const label = reglement?.label ?? m.payment_state;
    return <Badge tone={tonPiece(label, reglement?.tone)}>{label}</Badge>;
  }
  if (m.state === "draft" && m.approval?.state === "pending") return <Badge tone="warn">{m.approval.pending_with ? `En validation : ${m.approval.pending_with}` : "En validation"}</Badge>;
  if (m.state === "draft" && m.approval?.state === "rejected") return <Badge tone="danger">Refusée</Badge>;
  const etat = MOVE_STATES[m.state];
  const label = etat?.label ?? m.state;
  return <Badge tone={tonPiece(label, etat?.tone)}>{label}</Badge>;
}

/** Échéance, avec « 9 j de retard » dessous quand la pièce est échue. */
function Echeance({ m, jour }: { m: MoveSummary; jour: string }) {
  const retard = joursDeRetard(m, jour);
  return (
    <span className="block whitespace-nowrap">
      {fmtDate(m.invoice_date_due)}
      {retard !== null && <span className="block text-[12px] font-semibold text-danger">{`${fmtInt(retard)} j de retard`}</span>}
    </span>
  );
}

/**
 * Nom du tiers sur une seule ligne : la ligne du tableau garde sa hauteur, le nom complet reste lu
 * par le lecteur d'écran et s'affiche au survol. Au moins 10rem : au téléphone, le tableau défile
 * plutôt que de réduire le nom à son premier mot.
 */
function NomTiers({ nom }: { nom: string }) {
  return (
    <span className="block min-w-[10rem] max-w-[20rem]">
      <span aria-hidden className="line-clamp-1" title={nom}>
        {nom}
      </span>
      <span className="sr-only">{nom}</span>
    </span>
  );
}

/** Montant d'une cellule : entier, la devise est dans l'en-tête ; une pièce dans une autre devise la rappelle. */
function montant(m: MoveSummary, v: number | null) {
  if (m.currency && m.currency !== "GNF")
    return (
      <>
        {fmtDec(v)}
        <span className="ml-1 text-[11.5px] text-muted">{m.currency}</span>
      </>
    );
  return fmtInt(v);
}

/**
 * Liste des factures de vente ou des pièces d'achat, avec saisie et fiche détaillée. Le profil Achats seul
 * n'y voit que ses pièces d'achat et avoirs fournisseurs, sans encours ni litiges : il les saisit par
 * catégorie, les soumet au circuit et suit leur état.
 */
export function MovesPage({ kind }: { kind: "sales" | "purchases" }) {
  const sale = kind === "sales";
  const { achats, pret } = useAchatsSeul(!sale);
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<null | "out_invoice" | "out_refund" | "in_invoice" | "in_refund">(null);
  const [selected, setSelected] = useState<number | null>(null);
  const { data, error, isLoading, mutate } = useApi<Paged<MoveSummary>>(query(kind, view, search));
  // Encours et retards : finance et direction ; brouillons et pièces comptabilisées : profil Achats.
  const finance = sale || (pret && !achats);
  const { data: openData } = useApi<Paged<MoveSummary>>(finance ? query(kind, "open", "") : null);
  const { data: overdueData } = useApi<Paged<MoveSummary>>(finance ? query(kind, "overdue", "") : null);
  const { data: draftData } = useApi<Paged<MoveSummary>>(achats ? query(kind, "draft", "") : null);
  const { data: postedData } = useApi<Paged<MoveSummary>>(achats ? query(kind, "posted", "") : null);
  const jour = aujourdhui();

  return (
    <div>
      <PageHeader
        title={sale ? "Ventes" : "Achats et dépenses"}
        subtitle={
          sale
            ? "Factures et avoirs clients. La TVA et le compte client sont déduits à la saisie."
            : achats
              ? "Pièces d'achat et avoirs fournisseurs : chaque ligne se saisit par catégorie de dépense (elle fixe le compte et la TVA), le justificatif joint, puis la pièce se soumet au circuit d'approbation."
              : "Pièces d'achat et avoirs fournisseurs, soumis au circuit d'approbation selon les seuils."
        }
        actions={
          <>
            <Button onClick={() => setCreating(sale ? "out_refund" : "in_refund")}>Avoir</Button>
            <Button variant="primary" onClick={() => setCreating(sale ? "out_invoice" : "in_invoice")}>
              <Plus className="h-4 w-4" /> {sale ? "Nouvelle facture" : "Nouvelle pièce d'achat"}
            </Button>
          </>
        }
      />
      {achats ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Brouillons et soumises" value={String(draftData?.total_count ?? "–")} hint="À compléter, à soumettre ou en validation" />
          <Kpi label="Comptabilisées" value={String(postedData?.total_count ?? "–")} hint="Approuvées et passées en comptabilité" />
          <Kpi label="Pièces affichées" value={String(data?.total_count ?? "–")} hint={<>Total TTC <span className="whitespace-nowrap">{fmtGNF(data?.totals?.amount_total)}</span></>} />
        </div>
      ) : (
        finance && (
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi label={sale ? "Reste à encaisser" : "Reste à payer"} value={fmtShort(openData?.totals?.amount_residual)} hint={pluriel(openData?.total_count ?? 0, "pièce")} />
            <Kpi label="Dont échu" value={fmtShort(overdueData?.totals?.amount_residual)} hint={`${pluriel(overdueData?.total_count ?? 0, "pièce")} en retard`} tone={overdueData?.total_count ? "warn" : "neutral"} />
            <Kpi label="Pièces affichées" value={String(data?.total_count ?? "–")} hint={<>Total TTC <span className="whitespace-nowrap">{fmtGNF(data?.totals?.amount_total)}</span></>} />
          </div>
        )
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <Tabs tabs={achats ? VIEWS_ACHATS : VIEWS} value={view} onChange={setView} />
          <Input aria-label="Rechercher une pièce" className="max-w-xs" placeholder="Numéro, référence ou tiers…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {error && (
          <div className="p-4">
            <ErrorBox error={error} onRetry={() => mutate()} />
          </div>
        )}
        {isLoading && !data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data?.items ?? []}
            rowKey={(m) => m.id}
            onRowClick={(m) => setSelected(m.id)}
            empty={sale ? "Aucune facture pour ce filtre." : "Aucune pièce d'achat pour ce filtre."}
            columns={[
              { key: "name", label: "Numéro", render: (m) => <span className="whitespace-nowrap font-mono text-xs">{m.name ?? "Brouillon"}</span> },
              { key: "invoice_date", label: "Date", render: (m) => fmtDate(m.invoice_date ?? m.date) },
              { key: "partner", label: sale ? "Client" : "Fournisseur", render: (m) => <NomTiers nom={m.partner?.name ?? "–"} />, sortValue: (m) => m.partner?.name ?? "" },
              achats
                ? { key: "ref", label: "Référence", render: (m) => m.ref ?? "–" }
                : { key: "invoice_date_due", label: "Échéance", render: (m) => <Echeance m={m} jour={jour} /> },
              // Montants entiers, la devise dans l'en-tête : une seule échelle par colonne.
              { key: "amount_untaxed", label: "HT (GNF)", align: "right", render: (m) => montant(m, m.amount_untaxed) },
              { key: "amount_total", label: "TTC (GNF)", align: "right", render: (m) => montant(m, m.amount_total) },
              ...(achats ? [] : [{ key: "amount_residual", label: "Reste dû (GNF)", align: "right" as const, render: (m: MoveSummary) => (m.state === "posted" ? montant(m, m.amount_residual) : "–") }]),
              { key: "state", label: "Statut", render: (m) => <MoveStatus m={m} jour={jour} /> },
            ]}
          />
        )}
      </Card>
      {creating && (
        <MoveForm
          open
          moveType={creating}
          onClose={() => setCreating(null)}
          onCreated={(m) => {
            setCreating(null);
            void mutate();
            setSelected(m.id);
          }}
        />
      )}
      <MoveDetailModal moveId={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />
    </div>
  );
}
