"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Etat, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Select } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Account, DebtSummary, Journal } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtShort, pluriel } from "@/lib/format";

interface Loan {
  id: number;
  name: string;
  purpose: string | null;
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
  journal: string | null;
  schedule?: Array<{ id: number; sequence: number; due_date: string; principal: number; interest: number; total: number; remaining: number; paid: boolean; statement_line_id: number | null }>;
}

const STATE = { draft: { label: "Brouillon", tone: "neutral" as const }, active: { label: "En cours", tone: "accent" as const }, closed: { label: "Soldé", tone: "ok" as const } };
const ratio = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function DebtPage() {
  const { data, error, mutate } = useApi<{ items: Loan[]; summary: DebtSummary }>("/finance/loans");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: seuils } = useApi<Array<{ code: string; value: number; active: boolean }>>("/finance/thresholds");
  // Minimum de la règle d'alerte ; null : seuil à 0 ou désactivé (règle éteinte), le DSCR n'est pas jugé.
  const dscrMin = seuils?.find((t) => t.code === "dscr_min" && t.active && t.value)?.value ?? null;
  const s = data?.summary;
  const ecart = Math.abs(s?.schedule_gap ?? 0) >= 1;
  return (
    <div>
      <PageHeader
        title="Dette et financement"
        subtitle="Emprunts et crédits-bails : échéanciers, règlements comptabilisés, encours comptable, service de la dette et ratios."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nouveau financement
          </Button>
        }
      />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && s && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Encours comptable" value={fmtShort(s.accounting_outstanding)} hint={`Comptes 16 et 17 · ${pluriel(s.loans, "financement")}`} tone="accent" />
            <Kpi label="Capital restant dû des échéanciers" value={fmtShort(s.outstanding)} hint={ecart ? `Écart avec la comptabilité : ${fmtShort(s.schedule_gap)}` : "Conforme à la comptabilité"} tone={ecart ? "warn" : "ok"} />
            <Kpi label="Dette nette" value={fmtShort(s.net_debt)} hint="Encours comptable moins la trésorerie" />
            <Kpi label="Gearing" value={ratio(s.gearing)} hint={s.equity !== undefined && s.equity <= 0 ? "Capitaux propres négatifs ou nuls" : "Dette / capitaux propres"} tone={(s.gearing ?? 0) > 1 ? "warn" : "neutral"} />
            <Kpi label="Dette / EBE 12 mois" value={ratio(s.debt_to_ebe)} hint={(s.ebe_12m ?? 0) <= 0 ? "EBE des 12 derniers mois négatif ou nul" : `EBE 12 mois : ${fmtShort(s.ebe_12m)}`} />
            <Kpi label="DSCR" value={ratio(s.dscr)} hint={`EBE 12 mois / service de la dette, ${dscrMin ? `minimum ${ratio(dscrMin)}` : "minimum : seuil non fixé"}`} tone={s.dscr === null || s.dscr === undefined || dscrMin === null ? "neutral" : s.dscr < dscrMin ? "danger" : "ok"} />
            <Kpi label="Service de la dette de l'exercice" value={fmtShort(s.service_fy)} hint={`Réglé : ${fmtShort(s.service_fy_paid)} · intérêts ${fmtShort(s.service_fy_interest)}`} />
            <Kpi label="Prochaine échéance" value={fmtShort(s.next_due_amount)} hint={s.next_due_date ? `Le ${fmtDate(s.next_due_date)}${s.overdue > 0 ? ` · impayé ${fmtShort(s.overdue)}` : ""}` : "Aucune"} tone={s.overdue > 0 ? "danger" : "neutral"} />
          </div>
          {ecart && (
            <Notice tone="warn">
              L&apos;encours comptable (comptes 16 et 17) diffère de {fmtGNF(s.schedule_gap)} du capital restant dû des échéanciers : déblocage ou échéance non comptabilisé, ou financement non saisi. La clôture le signale.
            </Notice>
          )}
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
                { key: "purpose", label: "Objet", render: (l) => l.purpose ?? "–" },
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
  const { data: loan, error: erreurChargement, mutate } = useApi<Loan>(`/finance/loans/${id}`);
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
  const [objet, setObjet] = useState<string | null>(null);
  return (
    <Modal open wide title={loan ? `${loan.name}, ${loan.lender.name}` : "Financement"} onClose={onClose} footer={loan?.state === "draft" && <Button variant="primary" onClick={() => act(() => apiSend("POST", `/finance/loans/${id}/activate`))}>Mettre en service</Button>}>
      {!loan ? (
        <Etat error={erreurChargement} onRetry={() => mutate()} />
      ) : (
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Objet du financement" className="min-w-0 flex-1">
              <Input value={objet ?? loan.purpose ?? ""} onChange={(e) => setObjet(e.target.value)} placeholder="Acquisition de camions, fonds de roulement…" />
            </Field>
            <Button disabled={objet === null || objet === (loan.purpose ?? "")} onClick={() => act(() => apiSend("PATCH", `/finance/loans/${id}`, { purpose: objet }).then(() => setObjet(null)))}>
              Enregistrer l&apos;objet
            </Button>
          </div>
          {loan.state === "active" && (
            <p className="text-[12.5px] leading-snug text-muted">
              Échéance prélevée sur un compte bancaire dont vous importez les relevés : réglez-la depuis la ligne du relevé (Trésorerie, Rapprocher), qui propose l&apos;échéance. « Régler » ci-dessous comptabilise la sortie directement sur {loan.journal ?? "le journal de règlement"} : à réserver à la caisse et aux comptes sans relevé, sinon la sortie serait comptée deux fois.
            </p>
          )}
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
                  l.paid ? <Badge tone="ok">{l.statement_line_id ? "Rapprochée du relevé" : "Réglée"}</Badge> : loan.state === "active" ? <Button className="px-2 py-1 text-xs" onClick={() => act(() => apiSend("POST", `/finance/loans/lines/${l.id}/pay`, {}))}>Régler</Button> : null,
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
  const [f, setF] = useState({ name: "", purpose: "", kind: "loan", principal: "", annual_rate: "", start_date: new Date().toISOString().slice(0, 10), duration_months: "36", grace_months: "0", periodicity: "monthly", method: "annuity", principal_account_id: "", interest_account_id: "", journal_id: "" });
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
        <Field label="Objet" className="md:col-span-3">
          <Input value={f.purpose} onChange={set("purpose")} placeholder="Acquisition de camions, fonds de roulement…" />
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
