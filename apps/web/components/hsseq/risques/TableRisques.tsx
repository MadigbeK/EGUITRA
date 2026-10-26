"use client";

import { DataTable, Tag, cx, type Column, type Tri } from "@/components/ui";
import { Criticite } from "@/components/hsseq/commun";
import { fmtDate, pluriel } from "@/lib/format";
import { NATURE_RISQUE, Revue, STATUT_RISQUE, TamponRisque, nomProfil, nomSite } from "./libelles";
import type { RiskLine } from "./types";

/**
 * Au téléphone, seule la première colonne reste (en-tête et cellules) : elle porte alors la cotation
 * résiduelle, le statut et la revue du risque.
 */
const TELEPHONE = "max-md:[&_th:not(:first-child)]:hidden max-md:[&_td:not(:first-child)]:hidden";

/** Suivi d'un risque : nombre de mesures et d'actions ouvertes. */
function suivi(r: RiskLine): string {
  const mesures = r.measures_count ? pluriel(r.measures_count, "mesure") : "Aucune mesure";
  return r.open_actions ? `${mesures}, ${pluriel(r.open_actions, "action ouverte", "actions ouvertes")}` : mesures;
}

/**
 * Tableau des risques : référence, nature, événement redouté et danger ; site et profil ; criticité
 * brute puis résiduelle ; propriétaire ; prochaine revue (échue signalée) ; statut, mesures et actions
 * ouvertes. `compacte` (fiche ouverte à côté) ne garde que la cotation résiduelle, la revue et le
 * statut. Avec `onTri`, le tri est tenu par le noyau ; sans lui, le tableau trie ses lignes.
 */
export function TableRisques({ lignes, choisi, compacte, tri, onTri, onOuvrir, vide }: { lignes: RiskLine[]; choisi: number | null; compacte?: boolean; tri?: Tri; onTri?: (t: Tri) => void; onOuvrir: (id: number) => void; vide: string }) {
  const colonnes: Array<Column<RiskLine> & { secondaire?: boolean }> = [
    {
      key: "reference",
      label: "Risque",
      render: (r) => (
        <div className="min-w-[15rem] max-w-[50ch]">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-muted">{r.reference}</span>
            <Tag>{NATURE_RISQUE[r.nature].court}</Tag>
            {choisi === r.id && <span className="sr-only">fiche ouverte</span>}
          </span>
          <span className={cx("mt-1 line-clamp-2 block leading-snug text-ink", choisi === r.id && "font-semibold")}>{r.feared_event}</span>
          <span className="mt-1 line-clamp-1 block text-[12px] leading-snug text-muted" title={r.hazard}>
            Danger&nbsp;: {r.hazard}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">
            <Criticite note={r.residual.criticality} gravite={r.residual.severity} probabilite={r.residual.probability} />
            <TamponRisque mot={STATUT_RISQUE[r.status]} />
            {r.review_overdue ? <TamponRisque mot="Revue échue" /> : r.status !== "archived" && <span className="text-[12px] text-muted">Revue le {fmtDate(r.review_date)}</span>}
          </span>
        </div>
      ),
    },
    {
      key: "site",
      label: "Site",
      secondaire: true,
      sortValue: (r) => r.site?.name ?? "",
      render: (r) => (
        <span className="inline-flex flex-col">
          <span className="whitespace-nowrap text-ink">{nomSite(r.site)}</span>
          <span className="whitespace-nowrap text-[12px] text-muted">{nomProfil(r.vehicle_kind)}</span>
        </span>
      ),
    },
    {
      key: "raw_criticality",
      label: "Brute",
      secondaire: true,
      sortValue: (r) => r.raw.criticality,
      render: (r) => <Criticite compact note={r.raw.criticality} gravite={r.raw.severity} probabilite={r.raw.probability} />,
    },
    {
      key: "residual_criticality",
      label: "Résiduelle",
      sortValue: (r) => r.residual.criticality,
      render: (r) => <Criticite note={r.residual.criticality} gravite={r.residual.severity} probabilite={r.residual.probability} />,
    },
    { key: "owner", label: "Propriétaire", secondaire: true, sortValue: (r) => r.owner.name, render: (r) => <span className="whitespace-nowrap">{r.owner.name}</span> },
    { key: "review_date", label: "Prochaine revue", render: (r) => <Revue date={r.review_date} echue={r.review_overdue} statut={r.status} /> },
    {
      key: "status",
      label: "Statut",
      render: (r) => (
        <span className="inline-flex flex-col items-start gap-1">
          <TamponRisque mot={STATUT_RISQUE[r.status]} />
          <span className="whitespace-nowrap text-[12px] text-muted">{suivi(r)}</span>
        </span>
      ),
    },
  ];
  return (
    <div className={TELEPHONE}>
      <DataTable
        rows={lignes}
        rowKey={(r) => r.id}
        sort={tri}
        onSort={onTri}
        onRowClick={(r) => onOuvrir(r.id)}
        empty={vide}
        columns={colonnes.filter((c) => !(compacte && c.secondaire))}
      />
    </div>
  );
}
