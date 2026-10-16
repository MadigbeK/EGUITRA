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
          {[...p.gates.map((g) => ({ id: g.id as number | null, title: `${g.code}, ${g.name}` })), { id: null, title: "Sans gate particulier" }].map((g) => {
            const rows = p.documents.filter((d) => d.gate_id === g.id);
            if (!rows.length) return null;
            return (
              <Card key={g.id ?? "none"} title={`${g.title}, ${rows.length} pièces`} padded={false}>
                <DataTable dense rows={rows} rowKey={(d) => d.id} columns={[
                  { key: "code", label: "Code", render: (d) => <span className="font-mono text-xs">{d.code}</span> },
                  { key: "name", label: "Pièce" },
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
