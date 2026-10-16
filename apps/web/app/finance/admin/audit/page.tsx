"use client";

import { useState } from "react";
import { Badge, Card, DataTable, Field, Loading, PageHeader, Select, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";

interface AuditEntry {
  id: number;
  date: string;
  user: string | null;
  model: string;
  model_code: string;
  res_id: number;
  record: string | null;
  method: string;
  lines: Array<{ field: string; old: string | null; new: string | null }>;
}
interface AccessEntry { date: string; user: string | null; method: string; path: string; status: number; duration_ms: number; ip: string; app: string | null }

const METHOD = { create: ["Création", "ok"], write: ["Modification", "accent"], unlink: ["Suppression", "danger"] } as const;
const MODELS = [
  { value: "", label: "Tous les objets" },
  { value: "account.move", label: "Pièces comptables" },
  { value: "account.move.line", label: "Lignes d'écriture" },
  { value: "account.payment", label: "Règlements" },
  { value: "res.partner", label: "Tiers" },
  { value: "account.account", label: "Comptes" },
  { value: "res.users", label: "Utilisateurs" },
];

export default function AuditPage() {
  const [tab, setTab] = useState<"audit" | "access">("audit");
  const [model, setModel] = useState("");
  const { data: audit } = useApi<AuditEntry[]>(tab === "audit" ? `/admin/audit?limit=200${model ? `&model=${model}` : ""}` : null);
  const { data: access } = useApi<AccessEntry[]>(tab === "access" ? "/admin/access-log?limit=300" : null);
  return (
    <div>
      <PageHeader title="Journal d'audit" subtitle="Chaque création, modification et suppression avec l'utilisateur, la date et les valeurs avant et après. Accès conservés 12 mois." />
      <Tabs tabs={[{ key: "audit", label: "Piste d'audit" }, { key: "access", label: "Journal des accès" }]} value={tab} onChange={setTab} />
      {tab === "audit" && (
        <>
          <Field label="Objet" className="mb-4 max-w-xs">
            <Select value={model} onChange={(e) => setModel(e.target.value)} options={MODELS} />
          </Field>
          {!audit ? (
            <Loading />
          ) : (
            <div className="space-y-2">
              {audit.map((a) => (
                <Card key={a.id}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={METHOD[a.method as keyof typeof METHOD]?.[1] ?? "neutral"}>{METHOD[a.method as keyof typeof METHOD]?.[0] ?? a.method}</Badge>
                    <span className="font-medium">{a.model}</span>
                    <span className="text-muted">{a.record ?? `n° ${a.res_id}`}</span>
                    <span className="ml-auto text-xs text-muted">
                      {a.user ?? "système"}, {fmtDateTime(a.date)}
                    </span>
                  </div>
                  {a.lines.length > 0 && (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {a.lines.slice(0, 12).map((l, i) => (
                          <tr key={i} className="border-t border-line/50">
                            <td className="w-1/4 py-1 pr-2 text-muted">{l.field}</td>
                            <td className="w-3/8 py-1 pr-2 text-danger/90 line-through decoration-danger/40">{l.old || "–"}</td>
                            <td className="w-3/8 py-1 text-ok">{l.new || "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
      {tab === "access" && (
        <Card padded={false}>
          {!access ? (
            <Loading />
          ) : (
            <DataTable
              dense
              rows={access}
              rowKey={(_r, i) => i}
              columns={[
                { key: "date", label: "Date", render: (r) => fmtDateTime(r.date) },
                { key: "user", label: "Utilisateur", render: (r) => r.user ?? "–" },
                { key: "method", label: "Action" },
                { key: "path", label: "Adresse" },
                { key: "status", label: "Statut", render: (r) => <Badge tone={r.status < 300 ? "ok" : r.status < 500 ? "warn" : "danger"}>{r.status}</Badge> },
                { key: "ip", label: "IP" },
                { key: "duration_ms", label: "Durée", align: "right", render: (r) => `${r.duration_ms} ms` },
              ]}
            />
          )}
        </Card>
      )}
    </div>
  );
}
