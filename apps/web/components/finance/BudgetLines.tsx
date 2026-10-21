"use client";

import { useState } from "react";
import { Download, FileUp, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, Segmented, Select, type Tone } from "@/components/ui";
import { useAxes } from "./AnalyticFields";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { MONTHS_FR, fmtGNF, fmtPct, fmtShort } from "@/lib/format";

type Nature = "income" | "expense" | "capex";
type View = "lignes" | "activite" | "centre_cout";

interface BudgetRef { id: number; name: string; date_from: string; budget_lines: number; underrun_pct: number }
interface Ref { id: number; name: string }
interface BudgetLine { id: number; nature: Nature; name: string; account_prefixes: string | null; residual: boolean; activity: Ref | null; cost_center: Ref | null; months: number[]; annual: number }
interface ExecLine extends BudgetLine { budget: number; actual: number; gap: number; gap_pct: number | null; status: string; status_label: string; alert: boolean; committed?: number; available?: number | null }
interface AxisRow { analytic_account_id: number | null; name: string; income_budget: number; income_actual: number; expense_budget: number; expense_actual: number; capex_budget: number; capex_actual: number; margin_budget: number; margin_actual: number }
interface Execution {
  budget: { id: number; name: string; year: number; underrun_pct: number };
  month: number;
  through: string;
  threshold_pct: number;
  underrun_pct: number;
  lines: ExecLine[];
  summary: { income_budget: number; income_actual: number; income_gap_pct: number | null; expense_budget: number; expense_actual: number; expense_gap_pct: number | null; capex_budget: number; capex_actual: number; overrun_lines: number; expense_lines: number };
  by_axis?: AxisRow[];
}

const NATURES: Record<Nature, string> = { income: "Produits", expense: "Charges", capex: "Investissements" };
const STATUS_TONE: Record<string, Tone> = { depassement: "danger", non_budgete: "danger", sous_realisation: "danger", au_dessus: "warn", en_retrait: "warn", conforme: "ok" };

/**
 * Budget par ligne budgétaire : nature, préfixes de comptes, douze mois, activité et centre de coût ;
 * cumul à fin de mois comparé au réalisé, statuts, synthèse, comparaison par axe, import et export.
 */
export function BudgetLines() {
  const { data: budgets, mutate: refreshBudgets } = useApi<BudgetRef[]>("/finance/budgets");
  const [budgetId, setBudgetId] = useState<number | null>(null);
  const current = budgets?.find((b) => b.id === budgetId) ?? budgets?.[0];
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [view, setView] = useState<View>("lignes");
  const axisParam = view === "lignes" ? "" : `&axis=${view}`;
  const { data, error, mutate } = useApi<Execution>(current ? `/finance/budgets/${current.id}/execution?month=${month}${axisParam}` : null);
  const [modal, setModal] = useState<null | "budget" | "import" | "settings" | BudgetLine | "new">(null);
  const s = data?.summary;

  function refresh() {
    void mutate();
    void refreshBudgets();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Budget">
          <Select value={String(current?.id ?? "")} onChange={(e) => setBudgetId(Number(e.target.value))} placeholder={budgets?.length ? undefined : "Aucun budget"} options={(budgets ?? []).map((b) => ({ value: b.id, label: b.name }))} />
        </Field>
        <Field label="Cumul à fin de">
          <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={MONTHS_FR.map((m, i) => ({ value: i + 1, label: m }))} />
        </Field>
        <Segmented
          label="Lecture"
          value={view}
          onChange={setView}
          options={[
            { key: "lignes", label: "Par ligne" },
            { key: "activite", label: "Par activité" },
            { key: "centre_cout", label: "Par centre de coût" },
          ]}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => setModal("budget")}>
            <Plus className="h-4 w-4" /> Nouveau budget
          </Button>
          {current && (
            <>
              <Button onClick={() => setModal("import")}>
                <FileUp className="h-4 w-4" /> Importer
              </Button>
              <Button onClick={() => apiDownload(`/finance/budgets/${current.id}/export`, `budget_${current.id}.xlsx`)}>
                <Download className="h-4 w-4" /> Exporter
              </Button>
              <Button onClick={() => setModal("settings")}>Seuils</Button>
              <Button variant="primary" onClick={() => setModal("new")}>
                <Plus className="h-4 w-4" /> Nouvelle ligne
              </Button>
            </>
          )}
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {current && !data && !error && <Loading />}
      {data && s && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Produits budgétés" value={fmtShort(s.income_budget)} hint={`Cumul à fin ${MONTHS_FR[data.month - 1]}`} />
            <Kpi label="Produits réalisés" value={fmtShort(s.income_actual)} hint={`Écart ${fmtPct(s.income_gap_pct)}`} tone={(s.income_gap_pct ?? 0) < -data.underrun_pct ? "danger" : (s.income_gap_pct ?? 0) < 0 ? "warn" : "ok"} />
            <Kpi label="Charges réalisées" value={fmtShort(s.expense_actual)} hint={`Budget ${fmtShort(s.expense_budget)}, écart ${fmtPct(s.expense_gap_pct)}`} tone={(s.expense_gap_pct ?? 0) > data.threshold_pct ? "danger" : (s.expense_gap_pct ?? 0) > 0 ? "warn" : "ok"} />
            <Kpi label="Lignes en dépassement" value={`${s.overrun_lines}`} hint={`Sur ${s.expense_lines} poste(s) de charges, seuil ${fmtPct(data.threshold_pct, 0)}`} tone={s.overrun_lines ? "warn" : "ok"} />
          </div>
          {view === "lignes" ? (
            <Card title={`Détail par ligne budgétaire, cumul à fin ${MONTHS_FR[data.month - 1]}`} padded={false}>
              <DataTable
                rows={data.lines}
                rowKey={(l) => l.id}
                onRowClick={(l) => setModal(l)}
                empty="Aucune ligne budgétaire : créez-en ou importez le classeur du budget."
                columns={[
                  { key: "nature", label: "Nature", render: (l) => <Badge>{NATURES[l.nature]}</Badge> },
                  {
                    key: "name",
                    label: "Ligne budgétaire",
                    render: (l) => (
                      <div>
                        <div className="font-medium">{l.name}</div>
                        <div className="text-[12px] text-muted">
                          {[l.residual ? "Solde résiduel de la classe 6" : l.account_prefixes, l.activity?.name, l.cost_center?.name].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    ),
                  },
                  { key: "budget", label: "Budget cumulé", align: "right", render: (l) => fmtShort(l.budget) },
                  { key: "actual", label: "Réalisé", align: "right", render: (l) => fmtShort(l.actual) },
                  { key: "gap", label: "Écart", align: "right", render: (l) => <span className={l.gap < 0 === (l.nature === "income") && Math.abs(l.gap) > 0.5 ? "text-danger" : ""}>{fmtShort(l.gap)}</span> },
                  { key: "committed", label: "Engagé", align: "right", render: (l) => (l.nature === "income" ? "–" : fmtShort(l.committed ?? 0)) },
                  { key: "available", label: "Disponible (année)", align: "right", render: (l) => (l.available === null || l.available === undefined ? "–" : <span className={l.available < 0 ? "text-danger" : ""}>{fmtShort(l.available)}</span>) },
                  { key: "gap_pct", label: "Écart %", align: "right", render: (l) => fmtPct(l.gap_pct) },
                  { key: "status", label: "Statut", render: (l) => <Badge tone={STATUS_TONE[l.status] ?? "neutral"}>{l.status_label}</Badge> },
                ]}
              />
            </Card>
          ) : (
            <Card title={view === "activite" ? "Budget et réalisé par activité" : "Budget et réalisé par centre de coût"} padded={false}>
              <DataTable
                rows={data.by_axis ?? []}
                rowKey={(r) => r.analytic_account_id ?? 0}
                empty="Aucune ligne budgétaire."
                columns={[
                  { key: "name", label: view === "activite" ? "Activité" : "Centre de coût" },
                  { key: "income_budget", label: "Produits budgétés", align: "right", render: (r) => fmtShort(r.income_budget) },
                  { key: "income_actual", label: "Produits réalisés", align: "right", render: (r) => fmtShort(r.income_actual) },
                  { key: "expense_budget", label: "Charges budgétées", align: "right", render: (r) => fmtShort(r.expense_budget) },
                  { key: "expense_actual", label: "Charges réalisées", align: "right", render: (r) => fmtShort(r.expense_actual) },
                  { key: "margin_budget", label: "Marge budgétée", align: "right", render: (r) => fmtShort(r.margin_budget) },
                  { key: "margin_actual", label: "Marge réalisée", align: "right", render: (r) => <span className={r.margin_actual < r.margin_budget ? "text-danger" : "text-ok"}>{fmtShort(r.margin_actual)}</span> },
                ]}
              />
              <p className="px-5 py-3 text-xs text-muted">Une ligne budgétaire affectée à une activité ou à un centre de coût ne retient que les écritures imputées à ce compte analytique ; les autres lignes figurent sous « Non affecté ».</p>
            </Card>
          )}
        </>
      )}
      {modal === "budget" && <NewBudget onClose={() => setModal(null)} onDone={(id) => { setModal(null); void refreshBudgets(); setBudgetId(id); }} />}
      {modal === "import" && current && <ImportBudget budgetId={current.id} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "settings" && current && <BudgetSettings budget={current} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {current && (modal === "new" || (modal && typeof modal === "object")) && (
        <LineForm budgetId={current.id} line={modal === "new" ? null : (modal as BudgetLine)} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
    </div>
  );
}

function NewBudget({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const year = new Date().getFullYear();
  const [name, setName] = useState(`Budget ${year}`);
  const [y, setY] = useState(String(year));
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open title="Nouveau budget" onClose={onClose} footer={<Button variant="primary" onClick={() => apiSend<{ id: number }>("POST", "/finance/budgets", { name, year: Number(y) }).then((b) => onDone(b.id)).catch((e) => setError(e instanceof ApiError ? e.message : "Erreur"))}>Créer</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Nom">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Exercice">
          <Input value={y} onChange={(e) => setY(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function BudgetSettings({ budget, onClose, onDone }: { budget: BudgetRef; onClose: () => void; onDone: () => void }) {
  const [underrun, setUnderrun] = useState(String(budget.underrun_pct ?? 10));
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open title={`Seuils, ${budget.name}`} onClose={onClose} footer={<Button variant="primary" onClick={() => apiSend("PATCH", `/finance/budgets/${budget.id}`, { underrun_pct: Number(underrun.replace(",", ".")) }).then(onDone).catch((e) => setError(e instanceof ApiError ? e.message : "Erreur"))}>Enregistrer</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Sous-réalisation tolérée des produits (%)" hint="En deçà, une ligne de produits passe en « sous-réalisation ». Le dépassement des charges suit le seuil d'alerte de la société (Seuils et taux).">
          <Input inputMode="decimal" className="font-mono" value={underrun} onChange={(e) => setUnderrun(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function LineForm({ budgetId, line, onClose, onDone }: { budgetId: number; line: BudgetLine | null; onClose: () => void; onDone: () => void }) {
  const { data: axes } = useAxes();
  const activities = axes?.find((a) => a.key === "activite")?.accounts.filter((a) => a.active) ?? [];
  const centers = axes?.find((a) => a.key === "centre_cout")?.accounts.filter((a) => a.active) ?? [];
  const [form, setForm] = useState({
    nature: (line?.nature ?? "expense") as Nature,
    name: line?.name ?? "",
    account_prefixes: line?.account_prefixes ?? "",
    residual: line?.residual ?? false,
    activity_id: line?.activity ? String(line.activity.id) : "",
    cost_center_id: line?.cost_center ? String(line.cost_center.id) : "",
  });
  const [months, setMonths] = useState<string[]>((line?.months ?? Array(12).fill(0)).map((m) => (m ? String(Math.round(m)) : "")));
  const [annual, setAnnual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;
  const total = months.reduce((a, m) => a + num(m), 0);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  const body = {
    ...form,
    account_prefixes: form.residual ? "" : form.account_prefixes,
    residual: form.nature === "expense" && form.residual,
    activity_id: form.activity_id ? Number(form.activity_id) : null,
    cost_center_id: form.cost_center_id ? Number(form.cost_center_id) : null,
    months: months.map(num),
  };
  return (
    <Modal
      open
      wide
      title={line ? `Ligne budgétaire, ${line.name}` : "Nouvelle ligne budgétaire"}
      onClose={onClose}
      footer={
        <>
          {line && (
            <Button variant="danger" loading={busy} onClick={() => run(() => apiSend("DELETE", `/finance/budget-lines/${line.id}`))}>
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
          <Button variant="primary" loading={busy} disabled={!form.name.trim() || (!form.residual && !form.account_prefixes.trim())} onClick={() => run(() => (line ? apiSend("PATCH", `/finance/budget-lines/${line.id}`, body) : apiSend("POST", `/finance/budgets/${budgetId}/budget-lines`, body)))}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Nature">
            <Select value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value as Nature })} options={Object.entries(NATURES).map(([k, v]) => ({ value: k, label: v }))} />
          </Field>
          <Field label="Ligne budgétaire" className="md:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Carburant, salaires, loyers…" />
          </Field>
          <Field label="Comptes" hint={form.nature === "income" ? "Classe 7, par exemple « 706 »" : form.nature === "capex" ? "Classe 2, par exemple « 24, 21 »" : "Classe 6, par exemple « 6611, 664 »"}>
            <Input className="font-mono" value={form.residual ? "" : form.account_prefixes} disabled={form.residual} onChange={(e) => setForm({ ...form, account_prefixes: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Activité (facultatif)">
            <Select value={form.activity_id} onChange={(e) => setForm({ ...form, activity_id: e.target.value })} placeholder="Toutes" options={activities.map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
          <Field label="Centre de coût (facultatif)">
            <Select value={form.cost_center_id} onChange={(e) => setForm({ ...form, cost_center_id: e.target.value })} placeholder="Tous" options={centers.filter((c) => !form.activity_id || !c.activity_id || String(c.activity_id) === form.activity_id).map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          {form.nature === "expense" && (
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={form.residual} onChange={(e) => setForm({ ...form, residual: e.target.checked })} /> Solde résiduel (charges non couvertes par les autres lignes)
            </label>
          )}
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-end gap-3">
            <Field label="Répartir un montant annuel">
              <Input inputMode="numeric" className="w-44 font-mono" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="Total de l'année" />
            </Field>
            <Button
              disabled={!num(annual)}
              onClick={() => {
                const part = Math.floor(num(annual) / 12);
                setMonths(Array.from({ length: 12 }, (_, i) => String(i === 11 ? num(annual) - part * 11 : part)));
              }}
            >
              Répartir sur douze mois
            </Button>
            <span className="ml-auto text-sm text-muted">Total annuel : {fmtGNF(total)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {MONTHS_FR.map((m, i) => (
              <Field key={m} label={m}>
                <Input inputMode="numeric" className="text-right font-mono" value={months[i]} onChange={(e) => setMonths(months.map((x, j) => (j === i ? e.target.value : x)))} />
              </Field>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ImportBudget({ budgetId, onClose, onDone }: { budgetId: number; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; lines: number } | null>(null);
  const [error, setError] = useState<{ message: string; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (replace) form.append("replace", "1");
      setResult(await apiUpload(`/finance/budgets/${budgetId}/import`, form));
      onDone();
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "Import impossible.", errors: e instanceof ApiError ? ((e.body as { errors?: string[] }).errors ?? []) : [] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Importer le budget" onClose={onClose} footer={<Button variant="primary" loading={busy} disabled={!file} onClick={submit}>Importer</Button>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Classeur XLSX ou CSV, une ligne budgétaire par rangée : nature (produits, charges, investissements), ligne, comptes, residuel (oui), activite, centre_cout, puis un montant par mois (janv à dec). L&apos;export du budget donne le modèle. Une ligne déjà présente (même nature, libellé et affectation) est mise à jour.
        </p>
        {error && (
          <Notice tone="danger">
            <div>{error.message}</div>
            {error.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {error.errors.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        {result && <Notice tone="ok">{result.created} ligne(s) créée(s), {result.updated} mise(s) à jour ; {result.lines} ligne(s) au budget.</Notice>}
        <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong/70 file:bg-panel file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-panel-2" />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Remplacer toutes les lignes du budget
        </label>
      </div>
    </Modal>
  );
}
