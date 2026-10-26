"use client";

import { useState } from "react";
import { Badge, Card, DataTable, Empty, Etat, PageHeader, Segmented } from "@/components/ui";
import { AlerteLigne, GRAVITES, fmtValeur, gravite } from "@/components/finance/Pilotage";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Alert, AlertUnit, Severity } from "@/lib/finance-types";
import { pluriel } from "@/lib/format";

interface Threshold { id: number; code: string; label: string; value: number; severity: Severity; active: boolean; domain: string | null; unit: AlertUnit | null; zero_disables: boolean; applicable: boolean }

/**
 * Alertes de gestion et seuils en vigueur : lecture seule (GET /finance/alerts et /finance/thresholds,
 * profils de la finance) ; les seuils se modifient dans Administration > Seuils et taux.
 */
export default function AlertsPage() {
  const [scope, setScope] = useState<"company" | "group">("company");
  const [vue, setVue] = useState<"actives" | "toutes">("actives");
  const { data, error, mutate } = useApi<Alert[]>(`/finance/alerts?scope=${scope}${vue === "toutes" ? "&all=1" : ""}`);
  const { data: thresholds, error: erreurSeuils, mutate: relireSeuils } = useApi<Threshold[]>("/finance/thresholds");
  const groupe = scope === "group";

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
      <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul des alertes…">
        {(rows) => {
          const actives = rows.filter((a) => a.status === "alert");
          const compte = (s: Severity) => actives.filter((a) => a.severity === s).length;
          const domaines = [...new Set(rows.map((a) => a.domain))];
          return (
            <>
              <div className="mb-5 flex flex-wrap gap-2">
                {GRAVITES.map((g) => (
                  <Badge key={g.value} tone={compte(g.value) ? gravite(g.value).tone : "neutral"}>
                    {pluriel(compte(g.value), g.label.toLowerCase())}
                  </Badge>
                ))}
                {vue === "toutes" && <Badge tone="ok">{pluriel(rows.filter((a) => a.status === "ok").length, "conforme")}</Badge>}
                {vue === "toutes" && <Badge>{pluriel(rows.filter((a) => a.status === "na").length, "sans objet", "sans objet")}</Badge>}
              </div>
              {rows.length === 0 ? (
                <Card>
                  {vue === "toutes" ? (
                    <Empty title="Aucune règle d'alerte" hint="Les règles se paramètrent dans Administration > Seuils et taux." />
                  ) : (
                    <Empty title="Aucune alerte active" hint="Tous les indicateurs sont dans les seuils fixés." />
                  )}
                </Card>
              ) : (
                <div className="space-y-4">
                  {(vue === "toutes" ? domaines : [null]).map((domaine) => {
                    const lignes = domaine === null ? rows : rows.filter((a) => a.domain === domaine);
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
            </>
          );
        }}
      </Etat>
      <Card title="Seuils en vigueur" className="mt-6" padded={false}>
        <Etat data={thresholds} error={erreurSeuils} onRetry={() => relireSeuils()} label="Chargement des seuils…">
          {(seuils) => (
            <DataTable
              rows={seuils.filter((t) => t.applicable)}
              rowKey={(t) => t.id}
              empty="Aucun seuil applicable."
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
          )}
        </Etat>
      </Card>
    </div>
  );
}
