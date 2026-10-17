"use client";

import { useState } from "react";
import { Badge, Card, DataTable, Empty, ErrorBox, Loading, PageHeader, Segmented } from "@/components/ui";
import { AlerteLigne, GRAVITES, fmtValeur, gravite } from "@/components/finance/Pilotage";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Alert, AlertUnit, Severity } from "@/lib/finance-types";

interface Threshold { id: number; code: string; label: string; value: number; severity: Severity; active: boolean; domain: string | null; unit: AlertUnit | null; zero_disables: boolean; applicable: boolean }

export default function AlertsPage() {
  const [scope, setScope] = useState<"company" | "group">("company");
  const [vue, setVue] = useState<"actives" | "toutes">("actives");
  const { data, error } = useApi<Alert[]>(`/finance/alerts?scope=${scope}${vue === "toutes" ? "&all=1" : ""}`);
  const { data: thresholds } = useApi<Threshold[]>("/finance/thresholds");
  const actives = (data ?? []).filter((a) => a.status === "alert");
  const groupe = scope === "group";
  const compte = (s: Severity) => actives.filter((a) => a.severity === s).length;
  const domaines = [...new Set((data ?? []).map((a) => a.domain))];

  return (
    <div>
      <PageHeader
        title="Alertes de gestion"
        subtitle="Chaque règle compare une valeur constatée à un seuil paramétré. Une alerte bloquante interdit la clôture ; un seuil laissé à 0 éteint sa règle et se signale."
        actions={
          <>
            <Segmented label="Règles affichées" options={[{ key: "actives", label: "Alertes actives" }, { key: "toutes", label: "Toutes les règles" }]} value={vue} onChange={setVue} />
            <ScopeToggle value={scope} onChange={setScope} />
          </>
        }
      />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="mb-5 flex flex-wrap gap-2">
          {GRAVITES.map((g) => (
            <Badge key={g.value} tone={compte(g.value) ? gravite(g.value).tone : "neutral"}>
              {compte(g.value)} {g.label.toLowerCase()}{compte(g.value) > 1 ? "s" : ""}
            </Badge>
          ))}
          {vue === "toutes" && <Badge tone="ok">{data.filter((a) => a.status === "ok").length} conformes</Badge>}
          {vue === "toutes" && <Badge>{data.filter((a) => a.status === "na").length} sans objet</Badge>}
        </div>
      )}
      {data && data.length === 0 && (
        <Card>
          <Empty title="Aucune alerte active" hint="Tous les indicateurs sont dans les seuils fixés." />
        </Card>
      )}
      {data && data.length > 0 && (
        <div className="space-y-4">
          {(vue === "toutes" ? domaines : [null]).map((domaine) => {
            const lignes = domaine === null ? data : data.filter((a) => a.domain === domaine);
            return (
              <Card key={domaine ?? "toutes"} title={domaine ?? undefined} padded={false}>
                <ul className="space-y-1 px-3 py-3">
                  {lignes.map((a, i) => (
                    <li key={`${a.key}-${a.company}-${i}`}>
                      <AlerteLigne a={a} groupe={groupe} />
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      <Card title="Seuils en vigueur" className="mt-6" padded={false}>
        <DataTable
          rows={(thresholds ?? []).filter((t) => t.applicable)}
          rowKey={(t) => t.id}
          columns={[
            { key: "domain", label: "Domaine", render: (t) => t.domain ?? "–" },
            { key: "label", label: "Seuil" },
            {
              key: "value",
              label: "Valeur",
              align: "right",
              render: (t) => (t.unit === "none" ? "Règle sans valeur" : t.zero_disables && !t.value ? <span className="text-warn">À renseigner</span> : fmtValeur(t.value, t.unit ?? "gnf")),
            },
            { key: "severity", label: "Gravité", render: (t) => <Badge tone={gravite(t.severity).tone}>{gravite(t.severity).label}</Badge> },
            { key: "active", label: "Actif", render: (t) => (t.active ? "Oui" : "Non") },
          ]}
        />
      </Card>
    </div>
  );
}
