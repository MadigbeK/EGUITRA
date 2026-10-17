"use client";

import { useEffect, useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Select, Tabs } from "@/components/ui";
import { CarteBfr, CourbeTresorerie, FluxMensuels } from "@/components/finance/Pilotage";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Account, MonthlyCash, Thresholds, WorkingCapital } from "@/lib/finance-types";
import { MONTHS_FR, fmtDate, fmtGNF, fmtPct, fmtShort } from "@/lib/format";

// Axes analytiques ; ceux d'un métier ne se proposent que dans la société qui l'exerce.
const PLANS: Array<{ value: string; label: string; entity?: "groupe" | "cabinet" }> = [
  { value: "activite", label: "Activité" },
  { value: "centre_cout", label: "Centre de coût" },
  { value: "chantier", label: "Chantier", entity: "groupe" },
  { value: "vehicule", label: "Ensemble routier", entity: "groupe" },
  { value: "route", label: "Route", entity: "groupe" },
  { value: "bien", label: "Bien immobilier", entity: "groupe" },
  { value: "dossier", label: "Dossier AxisPro", entity: "cabinet" },
];

type Onglet = "axes" | "budget" | "tresorerie" | "bfr";
const ONGLETS: Onglet[] = ["axes", "budget", "tresorerie", "bfr"];
const SANS_SEUILS: Thresholds = { cash_min: null, dscr_min: null, dso_target_days: null, receivable_overdue_share_pct: null, client_concentration_pct: null, transport_margin_min: null, budget_overrun_pct: 10 };

export default function PilotagePage() {
  const [tab, setTab] = useState<Onglet>("axes");
  // Onglet demandé par un lien (?onglet=tresorerie depuis le tableau de bord).
  useEffect(() => {
    const demande = new URLSearchParams(window.location.search).get("onglet") as Onglet | null;
    if (demande && ONGLETS.includes(demande)) setTab(demande);
  }, []);
  return (
    <div>
      <PageHeader title="Activités et budget" subtitle="Produits, charges et marge par axe analytique ; budget mensuel comparé au réalisé ; flux mensuels de trésorerie et prévision ; besoin en fonds de roulement." />
      <Tabs
        tabs={[
          { key: "axes", label: "Pilotage par axe" },
          { key: "budget", label: "Budget et écarts" },
          { key: "tresorerie", label: "Trésorerie mensuelle" },
          { key: "bfr", label: "BFR et délais" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "axes" && <Axes />}
      {tab === "budget" && <Budget />}
      {tab === "tresorerie" && <TresorerieMensuelle />}
      {tab === "bfr" && <Bfr />}
    </div>
  );
}

/** Flux mensuels de trésorerie de l'exercice, courbe de fin de mois et prévision à trois mois. */
function TresorerieMensuelle() {
  const courante = new Date().getFullYear();
  const [year, setYear] = useState(courante);
  const [scope, setScope] = useState<"company" | "group">("company");
  const { data, error } = useApi<MonthlyCash>(`/finance/cash/monthly?year=${year}&scope=${scope}`);
  const s = data?.summary;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Exercice">
          <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[courante - 2, courante - 1, courante].map((y) => ({ value: y, label: String(y) }))} />
        </Field>
        <ScopeToggle value={scope} onChange={setScope} />
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && s && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi label="Trésorerie d'ouverture" value={fmtShort(data.opening)} hint={`Au ${fmtDate(data.fiscal_year.start)}, à-nouveaux compris`} />
            <Kpi label="Cash net de l'exercice" value={fmtShort(s.net)} tone={s.net < 0 ? "danger" : "ok"} hint={`${s.negative_months} mois sur ${s.active_months} en cash net négatif`} />
            <Kpi label="Point bas" value={s.low_point ? fmtShort(s.low_point.end) : "–"} hint={s.low_point ? `Fin ${s.low_point.label}` : "Aucun mouvement"} tone={s.low_point && data.threshold && s.low_point.end < data.threshold ? "danger" : "neutral"} />
            <Kpi label="Seuil de sécurité" value={data.threshold ? fmtShort(data.threshold) : "Non fixé"} hint={data.threshold ? `${s.below_threshold_months} mois sous le seuil` : "À fixer dans Seuils et taux"} tone={data.threshold ? "neutral" : "warn"} />
          </div>
          <Card title="Trésorerie en fin de mois">
            <CourbeTresorerie data={data} forecast={data.forecast} />
          </Card>
          <Card title="Flux mensuels de trésorerie" padded={false}>
            <p className="px-5 pb-2 text-[12.5px] leading-snug text-muted">Comptes des journaux de banque et de caisse ; les virements internes (compte de passage 585) et les à-nouveaux sont exclus des flux.</p>
            <FluxMensuels data={data} forecast={data.forecast} />
          </Card>
        </>
      )}
    </div>
  );
}

/** BFR, DSO, DPO, DIO, cycle, part échue et concentration sur une période. */
function Bfr() {
  const [scope, setScope] = useState<"company" | "group">("company");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useApi<WorkingCapital>(`/finance/working-capital?date_from=${from}&date_to=${to}&scope=${scope}`);
  const { data: seuils } = useApi<Array<{ code: string; value: number; active: boolean }>>("/finance/thresholds");
  const valeur = (code: string) => seuils?.find((t) => t.code === code && t.active && t.value)?.value ?? null;
  const thresholds: Thresholds = { ...SANS_SEUILS, dso_target_days: valeur("dso_target_days"), receivable_overdue_share_pct: valeur("receivable_overdue_share_pct"), client_concentration_pct: valeur("client_concentration_pct") };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
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
        <Card title={`Besoin en fonds de roulement sur ${data.days} jours`}>
          <CarteBfr wc={data} thresholds={thresholds} />
          <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
            DSO = créances clients / ventes TTC × jours ; DPO = dettes fournisseurs / achats TTC × jours ; DIO = stocks / achats TTC × jours ; cycle = DSO + DIO - DPO ; BFR = créances + stocks - dettes fournisseurs. Le BFR SYSCOHADA (actif circulant moins passif circulant) comprend aussi les créances et dettes fiscales et sociales. Ventes TTC de la période : {fmtGNF(data.sales_ttc)} ; achats TTC : {fmtGNF(data.purchases_ttc)}.
          </p>
        </Card>
      )}
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
  const { data: me } = useApi<{ company_id: number; companies: Array<{ id: number; entity: "groupe" | "cabinet" | null }> }>("/auth/me");
  const entite = me?.companies.find((c) => c.id === me.company_id)?.entity;
  const axes = PLANS.filter((p) => !p.entity || scope === "group" || !entite || p.entity === entite);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Axe">
          <Select value={plan} onChange={(e) => setPlan(e.target.value)} options={axes} />
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
