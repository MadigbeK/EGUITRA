"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Search } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Input, Loading, PageHeader, Segmented, Select } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF } from "@/lib/format";
import { CONTRACT_LABELS, type EmployeeRow } from "@/lib/rh-types";
import { EtatSalarie, jours, useMeta } from "./commun";
import { FormulaireSalarie } from "./FormulaireSalarie";

type Filtre = "active" | "sorti" | "all";

/** Liste du personnel de la société de travail : recherche, département, état, points à compléter. */
export function ListeSalaries() {
  const router = useRouter();
  const [filtre, setFiltre] = useState<Filtre>("active");
  const [departement, setDepartement] = useState("");
  const [q, setQ] = useState("");
  const [creation, setCreation] = useState(false);
  const { data: meta } = useMeta();
  const { data, error, mutate } = useApi<EmployeeRow[]>(`/rh/employees?state=${filtre}${departement ? `&department_id=${departement}` : ""}`);

  const lignes = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!data || !t) return data ?? [];
    return data.filter((e) => [e.name, e.matricule, e.job_title ?? "", e.department?.name ?? "", e.phone ?? ""].some((v) => v.toLowerCase().includes(t)));
  }, [data, q]);
  const incomplets = (data ?? []).filter((e) => e.issues.length > 0).length;

  return (
    <div>
      <PageHeader
        title="Salariés"
        subtitle="Dossiers du personnel de la société de travail : poste, contrat, rémunération, congés, documents."
        actions={
          meta?.can_write && (
            <Button variant="primary" onClick={() => setCreation(true)}>
              <Plus className="h-4 w-4" /> Nouveau salarié
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="État"
          value={filtre}
          onChange={setFiltre}
          options={[
            { key: "active", label: "En poste" },
            { key: "sorti", label: "Sortis" },
            { key: "all", label: "Tous" },
          ]}
        />
        <div className="w-56">
          <Select value={departement} onChange={(e) => setDepartement(e.target.value)} placeholder="Tous les départements" options={(meta?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" placeholder="Nom, matricule, fonction…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {incomplets > 0 && (
          <span className="flex items-center gap-1.5 text-[13px] text-warn">
            <AlertTriangle className="h-4 w-4" /> {incomplets} dossier(s) à compléter
          </span>
        )}
      </div>
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      <Card padded={false}>
        {!data ? (
          <Loading />
        ) : (
          <DataTable
            rows={lignes}
            rowKey={(e) => e.id}
            onRowClick={(e) => router.push(`/rh/salaries/${e.id}`)}
            empty={q ? "Aucun salarié ne correspond à la recherche." : "Aucun salarié."}
            columns={[
              { key: "matricule", label: "Matricule", render: (e) => <span className="font-mono text-xs">{e.matricule}</span>, sortValue: (e) => e.matricule },
              {
                key: "name",
                label: "Salarié",
                sortValue: (e) => e.name,
                render: (e) => (
                  <Link href={`/rh/salaries/${e.id}`} className="block min-w-0" onClick={(ev) => ev.stopPropagation()}>
                    <span className="block font-medium text-ink hover:underline">{e.name}</span>
                    <span className="block text-[12.5px] text-muted">{[e.job_title, e.department?.name].filter(Boolean).join(", ") || "–"}</span>
                  </Link>
                ),
              },
              { key: "contract_type", label: "Contrat", render: (e) => CONTRACT_LABELS[e.contract_type], sortValue: (e) => e.contract_type },
              { key: "hire_date", label: "Embauche", render: (e) => fmtDate(e.hire_date), sortValue: (e) => e.hire_date },
              { key: "monthly_gross", label: "Brut mensuel", align: "right", render: (e) => fmtGNF(e.monthly_gross), sortValue: (e) => e.monthly_gross },
              { key: "leave_balance", label: "Congés", align: "right", render: (e) => <span className={e.leave_balance < 0 ? "text-danger" : ""}>{jours(e.leave_balance)}</span>, sortValue: (e) => e.leave_balance },
              {
                key: "state",
                label: "État",
                sortValue: (e) => e.state,
                render: (e) => (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <EtatSalarie state={e.state} />
                    {e.absent_today && <Badge tone="accent">Absent</Badge>}
                    {e.issues.length > 0 && (
                      <span title={e.issues.join("\n")}>
                        <Badge tone="warn">{e.issues.length} à compléter</Badge>
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>
      {creation && meta && (
        <FormulaireSalarie
          meta={meta}
          onClose={() => setCreation(false)}
          onDone={(e) => {
            setCreation(false);
            void mutate();
            router.push(`/rh/salaries/${e.id}`);
          }}
        />
      )}
    </div>
  );
}
