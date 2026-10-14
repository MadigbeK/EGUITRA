"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Card, DataTable, Empty, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Alert } from "@/lib/finance-types";
import { fmtGNF } from "@/lib/format";

interface Threshold { id: number; code: string; label: string; value: number; severity: string; active: boolean }
const SEVERITY = { blocking: ["Bloquante", "danger"], warning: ["Attention", "warn"], info: ["Information", "accent"] } as const;

export default function AlertsPage() {
  const [scope, setScope] = useState<"company" | "group">("company");
  const { data, error } = useApi<Alert[]>(`/finance/alerts?scope=${scope}`);
  const { data: thresholds } = useApi<Threshold[]>("/finance/thresholds");
  return (
    <div>
      <PageHeader title="Alertes" subtitle="Alertes calculées à chaque saisie à partir des seuils paramétrés. Une alerte bloquante interdit la clôture." actions={<ScopeToggle value={scope} onChange={setScope} />} />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && data.length === 0 && (
        <Card>
          <Empty title="Aucune alerte active" hint="Tous les indicateurs sont dans les seuils fixés." />
        </Card>
      )}
      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((a, i) => (
            <Card key={i}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-ink">{a.title}</div>
                  <div className="text-sm text-muted">
                    {a.message} {a.value !== null && `(${fmtGNF(a.value)})`} · {a.company}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={SEVERITY[a.severity][1]}>{SEVERITY[a.severity][0]}</Badge>
                  {a.link && (
                    <Link href={a.link} className="text-sm text-accent underline-offset-2 hover:underline">
                      Voir
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Card title="Seuils en vigueur" className="mt-6" padded={false}>
        <DataTable
          rows={thresholds ?? []}
          rowKey={(t) => t.id}
          columns={[
            { key: "label", label: "Seuil" },
            { key: "value", label: "Valeur", align: "right", render: (t) => (t.value ? t.value.toLocaleString("fr-FR") : "—") },
            { key: "severity", label: "Gravité", render: (t) => <Badge tone={SEVERITY[t.severity as keyof typeof SEVERITY][1]}>{SEVERITY[t.severity as keyof typeof SEVERITY][0]}</Badge> },
            { key: "active", label: "Actif", render: (t) => (t.active ? "Oui" : "Non") },
          ]}
        />
      </Card>
    </div>
  );
}
