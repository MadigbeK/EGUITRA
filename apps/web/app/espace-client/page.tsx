"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "@/components/icons";
import { BadgeEtat } from "@/components/service-client/commun";
import { Card, DataTable, Etat, PageHeader, Segmented, classesBouton } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import type { LigneClient } from "@/lib/service-client";

/** Mes demandes : celles de mon entreprise, en cours ou closes. */
export default function MesDemandesClientPage() {
  const router = useRouter();
  const [vue, setVue] = useState<"open" | "closed">("open");
  const { data, error, mutate } = useApi<LigneClient[]>(`/espace-client/tickets?state=${vue}`);
  return (
    <div>
      <PageHeader
        title="Mes demandes"
        subtitle="Suivez le traitement de vos demandes et réclamations, répondez au service client et donnez votre avis une fois la demande résolue."
        actions={
          <Link href="/espace-client/nouvelle" className={classesBouton("primary")}>
            <Plus className="h-4 w-4" /> Nouvelle demande
          </Link>
        }
      />
      <Card padded={false}>
        <div className="border-b border-line px-5 pb-4 pt-5">
          <Segmented label="Demandes" value={vue} onChange={setVue} options={[{ key: "open", label: "En cours" }, { key: "closed", label: "Closes" }]} />
        </div>
        <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement de vos demandes…">
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/espace-client/demandes/${r.id}`)}
              empty={vue === "open" ? "Aucune demande en cours." : "Aucune demande close."}
              columns={[
                { key: "name", label: "Numéro", className: "whitespace-nowrap font-semibold tabular" },
                { key: "subject", label: "Demande", render: (r) => <span className="block"><span className="block font-medium">{r.subject}</span><span className="block text-[12.5px] text-muted">{r.kind_label}{r.category ? ` · ${r.category}` : ""} · {r.company.name}</span></span> },
                { key: "state", label: "État", render: (r) => <BadgeEtat etat={r.state} libelle={r.state_label} /> },
                { key: "last_update", label: "Dernier échange", render: (r) => fmtDateTime(r.last_update) },
              ]}
            />
          )}
        </Etat>
      </Card>
    </div>
  );
}
