"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tabs } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Account } from "@/lib/finance-types";
import { MONTHS_FR, fmtGNF, fmtPct, fmtShort } from "@/lib/format";

const PLANS = [
  { value: "activite", label: "Activité" },
  { value: "centre_cout", label: "Centre de coût" },
  { value: "chantier", label: "Chantier" },
  { value: "vehicule", label: "Ensemble routier" },
  { value: "route", label: "Route" },
  { value: "bien", label: "Bien immobilier" },
];

export default function PilotagePage() {
  const [tab, setTab] = useState<"axes" | "budget">("axes");
  return (
    <div>
      <PageHeader title="Activités et budget" subtitle="Produits, charges et marge par axe analytique ; budget mensuel comparé au réalisé." />
      <Tabs tabs={[{ key: "axes", label: "Pilotage par axe" }, { key: "budget", label: "Budget et écarts" }]} value={tab} onChange={setTab} />
      {tab === "axes" ? <Axes /> : <Budget />}
    </div>
  );
}

function Axes() {
  const [plan, setPlan] = useState("activite");
  const [scope, setScope] = useState<"company" | "group">("company");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useApi<{ plan: string; rows: Array<{ analytic_account_id: number; name: string; income: number; expense: number; margin: number; margin_rate: number | null }> }>(
    `/finance/analytics?plan=${plan}&date_from=${from}&date_to=${to}&scope=${scope}`,
  );
  const total = (data?.rows ?? []).reduce((a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense }), { income: 0, expense: 0 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Axe">
          <Select value={plan} onChange={(e) => setPlan(e.target.value)} options={PLANS} />
        </Field>
        <Field label="Du">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Au">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <ScopeToggle value={scope} onChange={setScope} />
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <Card padded={false}>
          <DataTable
            rows={data.rows}
            rowKey={(r) => r.analytic_account_id}
            empty="Aucune imputation sur cet axe pour la période."
            columns={[
              { key: "name", label: data.plan },
              { key: "income", label: "Produits", align: "right", render: (r) => fmtGNF(r.income) },
              { key: "expense", label: "Charges", align: "right", render: (r) => fmtGNF(r.expense) },
              { key: "margin", label: "Marge", align: "right", render: (r) => <span className={r.margin < 0 ? "text-danger" : "text-ok"}>{fmtGNF(r.margin)}</span> },
              { key: "margin_rate", label: "Taux de marge", align: "right", render: (r) => fmtPct(r.margin_rate) },
            ]}
            footer={
              data.rows.length > 0 ? (
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtGNF(total.income)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtGNF(total.expense)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtGNF(total.income - total.expense)}</td>
                  <td className="px-3 py-2 text-right font-mono">{total.income ? fmtPct(((total.income - total.expense) / total.income) * 100) : "–"}</td>
                </tr>
              ) : undefined
            }
          />
        </Card>
      )}
    </div>
  );
}

interface BudgetRef { id: number; name: string; date_from: string; lines: number }
interface CompareLine { account_id: number; code: string; name: string; kind: string; budget: number; actual: number; gap: number; gap_pct: number | null; alert: boolean }

function Budget() {
  const { data: budgets, mutate } = useApi<BudgetRef[]>("/finance/budgets");
  const [budgetId, setBudgetId] = useState<number | null>(null);
  const current = budgets?.find((b) => b.id === budgetId) ?? budgets?.[0];
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const { data: compare, mutate: refresh } = useApi<{ through: string; threshold_pct: number; lines: CompareLine[] }>(current ? `/finance/budgets/${current.id}/compare?month=${month}` : null);
  const [modal, setModal] = useState<null | "budget" | "line">(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Budget">
          <Select value={String(current?.id ?? "")} onChange={(e) => setBudgetId(Number(e.target.value))} placeholder={budgets?.length ? undefined : "Aucun budget"} options={(budgets ?? []).map((b) => ({ value: b.id, label: b.name }))} />
        </Field>
        <Field label="Cumul à fin de">
          <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={MONTHS_FR.map((m, i) => ({ value: i + 1, label: m }))} />
        </Field>
        <Button onClick={() => setModal("budget")}>
          <Plus className="h-4 w-4" /> Nouveau budget
        </Button>
        {current && (
          <Button variant="primary" onClick={() => setModal("line")}>
            Saisir une ligne
          </Button>
        )}
      </div>
      {compare && (
        <Card title={`Budget et réalisé, seuil d'alerte ${compare.threshold_pct} %`} padded={false}>
          <DataTable
            rows={compare.lines}
            rowKey={(l) => l.account_id}
            empty="Aucune ligne budgétaire."
            columns={[
              { key: "code", label: "Compte" },
              { key: "name", label: "Libellé" },
              { key: "budget", label: "Budget", align: "right", render: (l) => fmtShort(l.budget) },
              { key: "actual", label: "Réalisé", align: "right", render: (l) => fmtShort(l.actual) },
              { key: "gap", label: "Écart", align: "right", render: (l) => fmtShort(l.gap) },
              { key: "gap_pct", label: "Écart %", align: "right", render: (l) => fmtPct(l.gap_pct) },
              { key: "alert", label: "", render: (l) => (l.alert ? <Badge tone="danger">Dépassement</Badge> : null) },
            ]}
          />
        </Card>
      )}
      {modal === "budget" && <NewBudget onClose={() => setModal(null)} onDone={(id) => { setModal(null); void mutate(); setBudgetId(id); }} />}
      {modal === "line" && current && <BudgetLine budgetId={current.id} onClose={() => setModal(null)} onDone={() => refresh()} />}
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

function BudgetLine({ budgetId, onClose, onDone }: { budgetId: number; onClose: () => void; onDone: () => void }) {
  const { data: accounts } = useApi<Account[]>("/finance/accounts?limit=2000");
  const [f, setF] = useState({ account_id: "", month: String(new Date().getMonth() + 1), amount: "" });
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function submit() {
    try {
      await apiSend("POST", `/finance/budgets/${budgetId}/lines`, { account_id: Number(f.account_id), month: Number(f.month), amount: Number(f.amount.replace(/\s/g, "")) });
      setMessage({ tone: "ok", text: "Ligne enregistrée." });
      setF({ ...f, amount: "" });
      onDone();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Erreur" });
    }
  }
  return (
    <Modal open title="Ligne budgétaire" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!f.account_id || !f.amount}>Enregistrer</Button>}>
      <div className="space-y-3">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <Field label="Compte">
          <Select value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })} placeholder="Choisir…" options={(accounts ?? []).filter((a) => /^[67]/.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mois">
            <Select value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} options={MONTHS_FR.map((m, i) => ({ value: i + 1, label: m }))} />
          </Field>
          <Field label="Montant (GNF)">
            <Input inputMode="numeric" className="font-mono" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
