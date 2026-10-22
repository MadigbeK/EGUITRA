"use client";

import { Badge, Card, DataTable, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api-client";

interface Policy {
  name: string;
  version: number;
  gates: Array<{ id: number; code: string; name: string }>;
  documents: Array<{ id: number; code: string; name: string; category: string | null; gate_id: number | null; required: boolean; guidance: string | null }>;
}

export default function PiecesPage() {
  const { data: p, error } = useApi<Policy | null>("/axispro/policy");
  return (
    <div>
      <PageHeader
        title="Pièces standard de la data room"
        subtitle={p ? `Liste attendue des porteurs selon « ${p.name} », version ${p.version}. Elle se modifie par une nouvelle version de la grille.` : "Pièces demandées aux porteurs, gate par gate."}
      />
      {error && <ErrorBox error={error} />}
      {p === undefined && !error && <Loading />}
      {p === null && <Card><p className="text-sm text-muted">Aucune grille en vigueur : importez puis mettez en vigueur la grille du cabinet.</p></Card>}
      {p && (
        <div className="space-y-4">
          {[...p.gates.map((g, i) => ({ id: g.id as number | null, rang: String(i + 1), title: `${g.code}, ${g.name}` })), { id: null, rang: "+", title: "Sans gate particulier" }].map((g) => {
            const rows = p.documents.filter((d) => d.gate_id === g.id);
            if (!rows.length) return null;
            return (
              <Card
                key={g.id ?? "none"}
                title={
                  <span className="flex items-center gap-3">
                    <span className="bg-accent grid h-8 w-8 flex-none place-items-center rounded-full text-[13px] font-bold text-white">{g.rang}</span>
                    {g.title}
                    <span className="rounded-full bg-accent-doux px-2 py-0.5 text-[12px] font-semibold text-accent">
                      {rows.length} pièce{rows.length > 1 ? "s" : ""}
                    </span>
                  </span>
                }
                padded={false}
              >
                <DataTable dense rows={rows} rowKey={(d) => d.id} columns={[
                  { key: "code", label: "Code", render: (d) => <span className="rounded-md bg-panel-3 px-1.5 py-0.5 text-[12px] font-semibold text-ink-2">{d.code}</span> },
                  { key: "name", label: "Pièce", render: (d) => <span className="font-medium text-ink">{d.name}</span> },
                  { key: "category", label: "Rubrique", render: (d) => d.category ?? "–" },
                  { key: "required", label: "", render: (d) => (d.required ? <Badge tone="accent">Obligatoire</Badge> : <Badge>Facultative</Badge>) },
                  { key: "guidance", label: "Consignes au porteur", render: (d) => <span className="text-xs text-muted">{d.guidance ?? "–"}</span> },
                ]} />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
