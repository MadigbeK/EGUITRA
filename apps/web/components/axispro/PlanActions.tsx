"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ListChecks, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Field, Input, Kpi, Loading, Notice, Segmented, Select, Textarea, cx } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { ACTION_SOURCE, ACTION_STATE, type Action, type ActionState } from "@/lib/axispro-types";
import { fmtDate, pluriel } from "@/lib/format";
import { PuceCompartiment } from "@/components/axispro/dossier/commun";

type Filtre = "open" | "overdue" | "submitted" | "all";

/**
 * Plan d'actions : celui d'un dossier (dossierId) ou celui de tout le portefeuille. Les actions du
 * porteur visibles au portail y reçoivent son compte rendu ; le cabinet les valide ensuite.
 */
export function PlanActions({ dossierId }: { dossierId?: number }) {
  const [filtre, setFiltre] = useState<Filtre>(dossierId ? "all" : "open");
  const [assignee, setAssignee] = useState<"" | "porteur" | "cabinet">("");
  const params = new URLSearchParams();
  if (dossierId) params.set("dossier_id", String(dossierId));
  if (filtre === "open" || filtre === "overdue") params.set("state", "open");
  if (filtre === "submitted") params.set("state", "submitted");
  if (filtre === "overdue") params.set("overdue", "1");
  if (assignee) params.set("assignee", assignee);
  const { data, error, mutate } = useApi<Action[]>(`/axispro/actions?${params.toString()}`);
  const { data: toutes, mutate: recompter } = useApi<Action[]>(dossierId ? `/axispro/actions?dossier_id=${dossierId}` : "/axispro/actions?state=open");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function agir(fn: () => Promise<unknown>, ok?: string) {
    setMessage(null);
    try {
      const r = await fn();
      if (ok) setMessage({ tone: "ok", text: typeof r === "object" && r && "created" in r ? `${pluriel((r as { created: number }).created, "action créée", "actions créées")} depuis les écarts.` : ok });
      await Promise.all([mutate(), recompter()]);
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    }
  }

  if (error) return <ErrorBox error={error} />;
  const base = toutes ?? [];
  const ouvertes = base.filter((a) => ["todo", "in_progress", "submitted"].includes(a.state));
  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Actions ouvertes" value={String(ouvertes.length)} icon={ListChecks} teinte="azur" />
        <Kpi label="En retard" value={String(ouvertes.filter((a) => a.overdue).length)} icon={AlertTriangle} teinte="danger" tone={ouvertes.some((a) => a.overdue) ? "danger" : "ok"} />
        <Kpi label="Déclarées faites, à valider" value={String(ouvertes.filter((a) => a.state === "submitted").length)} icon={Clock} teinte="ambre" tone={ouvertes.some((a) => a.state === "submitted") ? "warn" : "neutral"} />
        <Kpi label={dossierId ? "Réalisées" : "Confiées au porteur"} value={String(dossierId ? base.filter((a) => a.state === "done").length : ouvertes.filter((a) => a.assignee === "porteur").length)} icon={CheckCircle2} teinte="jade" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Actions affichées" value={filtre} onChange={setFiltre} options={[{ key: "open", label: "Ouvertes" }, { key: "overdue", label: "En retard" }, { key: "submitted", label: "À valider" }, { key: "all", label: "Toutes" }]} />
          <Select aria-label="Confiées à" className="min-h-9 w-44" value={assignee} onChange={(e) => setAssignee(e.target.value as typeof assignee)} options={[{ value: "", label: "Porteur et cabinet" }, { value: "porteur", label: "Porteur" }, { value: "cabinet", label: "Cabinet" }]} />
        </div>
        {dossierId && (
          <Button onClick={() => agir(() => apiSend("POST", `/axispro/dossiers/${dossierId}/actions/from-gaps`, { limit: 5 }), "ok")}>
            <ListChecks className="h-4 w-4" /> Créer depuis les écarts prioritaires
          </Button>
        )}
      </div>

      <Card padded={false}>
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Aucune action dans cette sélection.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((a) => (
              <LigneAction key={a.id} a={a} global={!dossierId} agir={agir} />
            ))}
          </ul>
        )}
      </Card>

      {dossierId && <NouvelleAction onCreate={(v) => agir(() => apiSend("POST", `/axispro/dossiers/${dossierId}/actions`, v), "Action ajoutée.")} />}
    </div>
  );
}

function LigneAction({ a, global, agir }: { a: Action; global: boolean; agir: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const patch = (v: Record<string, unknown>, ok?: string) => agir(() => apiSend("PATCH", `/axispro/actions/${a.id}`, v), ok);
  return (
    <li className={cx("px-5 py-3.5", (a.state === "done" || a.state === "cancelled") && "opacity-60")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{a.name}</span>
            <Badge tone={ACTION_STATE[a.state].tone}>{ACTION_STATE[a.state].label}</Badge>
            {a.overdue && <Badge tone="danger">En retard</Badge>}
            {!a.portal_visible && a.assignee === "porteur" && <Badge>Masquée au porteur</Badge>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {global && a.dossier && (
              <>
                <Link className="font-semibold text-accent hover:underline" href={`/axispro/dossiers/${a.dossier.id}`}>
                  {a.dossier.reference}
                </Link>{" "}
                {a.dossier.name},{" "}
              </>
            )}
            {a.compartment && <PuceCompartiment code={a.compartment} nom={a.compartment_name} className="mr-1.5 align-[1px]" />}
            {ACTION_SOURCE[a.source]}
            {a.criterion ? ` ${a.criterion}` : ""}, confiée au {a.assignee === "porteur" ? "porteur" : "cabinet"}
            {a.user ? `, suivie par ${a.user}` : ""}
            {a.done_date ? `, validée le ${fmtDate(a.done_date)}${a.done_by ? ` par ${a.done_by}` : ""}` : ""}
          </div>
          {a.description && a.description !== a.name && <p className="mt-1 text-[13px] leading-snug text-ink-2">{a.description}</p>}
          {a.porteur_comment && (
            <p className="mt-1.5 rounded-lg border-l-2 border-warn bg-warn-doux/50 px-2.5 py-1.5 text-[13px] text-ink-2">
              <b>Compte rendu du porteur :</b> {a.porteur_comment}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label={`Échéance de ${a.name}`} type="date" className="min-h-8 w-40 py-1 text-[13px]" defaultValue={a.due_date ?? ""} onBlur={(e) => e.target.value !== (a.due_date ?? "") && patch({ due_date: e.target.value || null })} />
          <Select aria-label={`État de ${a.name}`} className="min-h-8 w-44 py-1 text-[13px]" value={a.state} onChange={(e) => patch({ state: e.target.value as ActionState })} options={(Object.keys(ACTION_STATE) as ActionState[]).map((k) => ({ value: k, label: ACTION_STATE[k].label }))} />
          {a.state === "submitted" && (
            <Button variant="primary" size="sm" onClick={() => patch({ state: "done" }, "Action validée.")}>
              Valider
            </Button>
          )}
          {!global && (
            <button type="button" aria-label={`Supprimer ${a.name}`} title="Supprimer" className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger" onClick={() => window.confirm(`Supprimer l'action « ${a.name} » ?`) && agir(() => apiSend("DELETE", `/axispro/actions/${a.id}`), "Action supprimée.")}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function NouvelleAction({ onCreate }: { onCreate: (v: Record<string, unknown>) => Promise<void> }) {
  const dans30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const vierge = { name: "", description: "", assignee: "porteur", due_date: dans30, portal_visible: true };
  const [f, setF] = useState(vierge);
  return (
    <Card title="Nouvelle action">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <Field label="Action" className="md:col-span-3">
          <Input value={f.name} placeholder="Exemple : fournir les devis des presses" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Confiée à">
          <Select value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value, portal_visible: e.target.value === "porteur" })} options={[{ value: "porteur", label: "Porteur" }, { value: "cabinet", label: "Cabinet" }]} />
        </Field>
        <Field label="Échéance" className="md:col-span-2">
          <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </Field>
        <Field label="Détail attendu" className="md:col-span-6">
          <Textarea className="min-h-[56px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={f.portal_visible} disabled={f.assignee !== "porteur"} onChange={(e) => setF({ ...f, portal_visible: e.target.checked })} />
          Visible du porteur au portail
        </label>
        <Button variant="primary" disabled={!f.name.trim()} onClick={() => onCreate(f).then(() => setF(vierge))}>
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </div>
    </Card>
  );
}
