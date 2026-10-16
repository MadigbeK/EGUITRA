"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Select } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Account, Journal } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtShort } from "@/lib/format";

interface Loan {
  id: number;
  name: string;
  kind: "loan" | "lease";
  lender: { id: number; name: string };
  principal: number;
  annual_rate: number;
  start_date: string;
  duration_months: number;
  periodicity: string;
  method: string;
  state: "draft" | "active" | "closed";
  outstanding: number;
  schedule?: Array<{ id: number; sequence: number; due_date: string; principal: number; interest: number; total: number; remaining: number; paid: boolean }>;
}
interface Summary { loans: number; outstanding: number; overdue: number; next_due_date: string | null; next_due_amount: number; service_last_12m: number; service_next_12m: number }

const STATE = { draft: { label: "Brouillon", tone: "neutral" as const }, active: { label: "En cours", tone: "accent" as const }, closed: { label: "Soldé", tone: "ok" as const } };

export default function DebtPage() {
  const { data, error, mutate } = useApi<{ items: Loan[]; summary: Summary }>("/finance/loans");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader
        title="Dette et financement"
        subtitle="Emprunts et crédits-bails : échéanciers, règlements comptabilisés, service de la dette."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nouveau financement
          </Button>
        }
      />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Capital restant dû" value={fmtShort(data.summary.outstanding)} hint={`${data.summary.loans} financement(s)`} tone="accent" />
            <Kpi label="Échéances impayées" value={fmtShort(data.summary.overdue)} tone={data.summary.overdue > 0 ? "danger" : "ok"} />
            <Kpi label="Prochaine échéance" value={fmtShort(data.summary.next_due_amount)} hint={data.summary.next_due_date ? `Le ${fmtDate(data.summary.next_due_date)}` : "Aucune"} />
            <Kpi label="Service de la dette, 12 prochains mois" value={fmtShort(data.summary.service_next_12m)} hint={`12 derniers mois : ${fmtShort(data.summary.service_last_12m)}`} />
          </div>
          <Card padded={false}>
            <DataTable
              rows={data.items}
              rowKey={(l) => l.id}
              onRowClick={(l) => setSelected(l.id)}
              empty="Aucun financement enregistré."
              columns={[
                { key: "name", label: "Référence" },
                { key: "kind", label: "Nature", render: (l) => (l.kind === "lease" ? "Crédit-bail" : "Emprunt") },
                { key: "lender", label: "Prêteur", render: (l) => l.lender.name },
                { key: "principal", label: "Montant", align: "right", render: (l) => fmtGNF(l.principal) },
                { key: "annual_rate", label: "Taux", align: "right", render: (l) => `${l.annual_rate} %` },
                { key: "outstanding", label: "Restant dû", align: "right", render: (l) => fmtGNF(l.outstanding) },
                { key: "state", label: "Statut", render: (l) => <Badge tone={STATE[l.state].tone}>{STATE[l.state].label}</Badge> },
              ]}
            />
          </Card>
        </div>
      )}
      {selected !== null && <LoanModal id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
      {creating && <LoanForm onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void mutate(); setSelected(id); }} />}
    </div>
  );
}

function LoanModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: loan, mutate } = useApi<Loan>(`/finance/loans/${id}`);
  const [error, setError] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await mutate();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action impossible.");
    }
  }
  return (
    <Modal open wide title={loan ? `${loan.name}, ${loan.lender.name}` : "Financement"} onClose={onClose} footer={loan?.state === "draft" && <Button variant="primary" onClick={() => act(() => apiSend("POST", `/finance/loans/${id}/activate`))}>Mettre en service</Button>}>
      {!loan ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <DataTable
            dense
            rows={loan.schedule ?? []}
            rowKey={(l) => l.id}
            columns={[
              { key: "sequence", label: "N°", align: "right", render: (l) => String(l.sequence) },
              { key: "due_date", label: "Échéance", render: (l) => fmtDate(l.due_date) },
              { key: "principal", label: "Capital", align: "right", render: (l) => fmtGNF(l.principal) },
              { key: "interest", label: "Intérêts", align: "right", render: (l) => fmtGNF(l.interest) },
              { key: "total", label: "Total", align: "right", render: (l) => fmtGNF(l.total) },
              { key: "remaining", label: "Restant dû", align: "right", render: (l) => fmtGNF(l.remaining) },
              {
                key: "paid",
                label: "",
                align: "right",
                render: (l) =>
                  l.paid ? <Badge tone="ok">Réglée</Badge> : loan.state === "active" ? <Button className="px-2 py-1 text-xs" onClick={() => act(() => apiSend("POST", `/finance/loans/lines/${l.id}/pay`, {}))}>Régler</Button> : null,
              },
            ]}
          />
        </div>
      )}
    </Modal>
  );
}

function LoanForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { data: debtAccounts } = useApi<Account[]>("/finance/accounts?prefix=1&limit=500");
  const { data: interestAccounts } = useApi<Account[]>("/finance/accounts?prefix=67&limit=200");
  const { data: journals } = useApi<Journal[]>("/finance/journals?type=bank,cash");
  const [lender, setLender] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ name: "", kind: "loan", principal: "", annual_rate: "", start_date: new Date().toISOString().slice(0, 10), duration_months: "36", grace_months: "0", periodicity: "monthly", method: "annuity", principal_account_id: "", interest_account_id: "", journal_id: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const loan = await apiSend<Loan>("POST", "/finance/loans", {
        ...f,
        partner_id: lender?.id,
        principal: Number(f.principal.replace(/\s/g, "")),
        annual_rate: Number(f.annual_rate.replace(",", ".")),
        duration_months: Number(f.duration_months),
        grace_months: Number(f.grace_months),
        principal_account_id: f.principal_account_id ? Number(f.principal_account_id) : undefined,
        interest_account_id: f.interest_account_id ? Number(f.interest_account_id) : undefined,
        journal_id: f.journal_id ? Number(f.journal_id) : undefined,
      });
      onCreated(loan.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open wide title="Nouveau financement" onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={submit} disabled={!f.name || !lender || !f.principal}>Calculer l&apos;échéancier</Button>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {error && (
          <div className="md:col-span-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <Field label="Référence">
          <Input value={f.name} onChange={set("name")} placeholder="Emprunt BICIGUI 2026-01" />
        </Field>
        <Field label="Prêteur" className="md:col-span-2">
          <PartnerPicker value={lender} onChange={setLender} kind="supplier" />
        </Field>
        <Field label="Nature">
          <Select value={f.kind} onChange={set("kind")} options={[{ value: "loan", label: "Emprunt" }, { value: "lease", label: "Crédit-bail" }]} />
        </Field>
        <Field label="Montant (GNF)">
          <Input inputMode="numeric" className="font-mono" value={f.principal} onChange={set("principal")} />
        </Field>
        <Field label="Taux annuel (%)">
          <Input inputMode="decimal" value={f.annual_rate} onChange={set("annual_rate")} />
        </Field>
        <Field label="Déblocage">
          <Input type="date" value={f.start_date} onChange={set("start_date")} />
        </Field>
        <Field label="Durée (mois)">
          <Input inputMode="numeric" value={f.duration_months} onChange={set("duration_months")} />
        </Field>
        <Field label="Différé (mois)">
          <Input inputMode="numeric" value={f.grace_months} onChange={set("grace_months")} />
        </Field>
        <Field label="Périodicité">
          <Select value={f.periodicity} onChange={set("periodicity")} options={[{ value: "monthly", label: "Mensuelle" }, { value: "quarterly", label: "Trimestrielle" }, { value: "semiannual", label: "Semestrielle" }, { value: "annual", label: "Annuelle" }]} />
        </Field>
        <Field label="Méthode">
          <Select value={f.method} onChange={set("method")} options={[{ value: "annuity", label: "Échéances constantes" }, { value: "linear", label: "Capital constant" }]} />
        </Field>
        <Field label="Journal de règlement">
          <Select value={f.journal_id} onChange={set("journal_id")} placeholder="Choisir…" options={(journals ?? []).map((j) => ({ value: j.id, label: j.name }))} />
        </Field>
        <Field label="Compte de dette">
          <Select value={f.principal_account_id} onChange={set("principal_account_id")} placeholder="16x ou 17x" options={(debtAccounts ?? []).filter((a) => /^1[67]/.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
        </Field>
        <Field label="Compte d'intérêts">
          <Select value={f.interest_account_id} onChange={set("interest_account_id")} placeholder="67x" options={(interestAccounts ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
        </Field>
      </div>
    </Modal>
  );
}
