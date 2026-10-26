"use client";

import { Badge, Card, DataTable, ErrorBox, Etat, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { pluriel } from "@/lib/format";

interface Policy {
  name: string;
  version: number;
  gates: Array<{ id: number; code: string; name: string }>;
  documents: Array<{ id: number; code: string; name: string; category: string | null; gate_id: number | null; required: boolean; guidance: string | null }>;
}

/**
 * Pièces standard de la data room de la grille en vigueur, gate par gate. Une erreur de lecture
 * s'affiche avec « Réessayer », au-dessus de la liste quand elle est déjà là. Les pièces se modifient
 * sur une version en brouillon de la grille (Grille d'évaluation, onglet « Pièces de la data room »).
 */
export default function PiecesPage() {
  const { data: p, error, mutate } = useApi<Policy | null>("/axispro/policy");
  return (
    <div>
      <PageHeader
        title="Pièces standard de la data room"
        subtitle={p ? `Liste attendue des porteurs selon « ${p.name} », version ${p.version}. Elle se modifie sur une nouvelle version de la grille, en brouillon.` : "Pièces demandées aux porteurs, gate par gate."}
      />
      {p === undefined ? (
        <Etat error={error} onRetry={() => void mutate()} label="Chargement des pièces standard…" />
      ) : (
        <>
          {error && (
            <div className="mb-4">
              <ErrorBox titre="Rechargement impossible : la liste affichée peut dater." error={error} onRetry={() => void mutate()} />
            </div>
          )}
          {p === null ? (
            <Card><p className="text-sm text-muted">Aucune grille en vigueur : importez puis mettez en vigueur la grille du cabinet.</p></Card>
          ) : (
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
                        <span className="rounded-full bg-accent-doux px-2 py-0.5 text-[12px] font-semibold text-accent">{pluriel(rows.length, "pièce")}</span>
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
        </>
      )}
    </div>
  );
}
