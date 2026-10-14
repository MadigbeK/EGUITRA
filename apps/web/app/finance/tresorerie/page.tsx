"use client";

import { useState } from "react";
import { ArrowLeftRight, Check, FileUp, Link2, Plus, Undo2 } from "lucide-react";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Select, Tabs, cx } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, apiUpload, useApi } from "@/lib/api-client";
import type { Account, CashAccount } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF, fmtShort } from "@/lib/format";

interface StLine {
  id: number;
  date: string;
  label: string;
  partner: { id: number; name: string } | null;
  amount: number;
  reconciled: boolean;
  statement: string | null;
}
interface Candidate {
  id: number;
  move: string;
  move_id: number;
  partner: string | null;
  date: string;
  due: string | null;
  residual: number;
  score: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function TreasuryPage() {
  const { data: position, error, mutate: refreshPosition } = useApi<{ accounts: CashAccount[]; total: number; as_of: string }>("/finance/treasury");
  const [journalId, setJournalId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"unreconciled" | "all">("unreconciled");
  const current = position?.accounts.find((a) => a.journal_id === journalId) ?? position?.accounts[0] ?? null;
  const { data: lines, mutate } = useApi<{ items: StLine[]; total_count: number }>(current ? `/finance/treasury/${current.journal_id}/lines?state=${filter}&limit=300` : null);
  const [modal, setModal] = useState<null | "operation" | "import" | "transfer">(null);
  const [matching, setMatching] = useState<StLine | null>(null);

  function refresh() {
    void mutate();
    void refreshPosition();
  }

  return (
    <div>
      <PageHeader
        title="Trésorerie"
        subtitle="Position par compte et par devise, opérations de banque et de caisse, import des relevés, rapprochement."
        actions={
          <>
            <Button onClick={() => setModal("transfer")}>
              <ArrowLeftRight className="h-4 w-4" /> Virement interne
            </Button>
            <Button onClick={() => setModal("import")} disabled={!current || current.type !== "bank"}>
              <FileUp className="h-4 w-4" /> Importer un relevé
            </Button>
            <Button variant="primary" onClick={() => setModal("operation")} disabled={!current}>
              <Plus className="h-4 w-4" /> Nouvelle opération
            </Button>
          </>
        }
      />
      {error && <ErrorBox error={error} />}
      {!position && !error && <Loading />}
      {position && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Trésorerie totale" value={fmtShort(position.total)} hint={`Au ${fmtDate(position.as_of)}`} tone="accent" />
            {position.accounts.map((a) => (
              <button key={a.journal_id} type="button" onClick={() => setJournalId(a.journal_id)} className="text-left">
                <div className={cx("rounded-xl border bg-panel p-5 transition", current?.journal_id === a.journal_id ? "border-accent" : "border-line hover:border-accent/50")}>
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    <span>{a.type === "cash" ? "Caisse" : "Banque"}</span>
                    {a.unreconciled ? <Badge tone="warn">{a.unreconciled} à rapprocher</Badge> : <Badge tone="ok">À jour</Badge>}
                  </div>
                  <div className="mt-1 truncate text-sm text-ink-2">{a.name}</div>
                  <div className="tabular mt-1 font-mono text-xl font-bold">
                    {a.currency !== "GNF" ? `${fmtDec(a.balance_currency)} ${a.currency}` : fmtGNF(a.balance)}
                  </div>
                  {a.currency !== "GNF" && <div className="text-xs text-muted">Contre-valeur {fmtGNF(a.balance)}</div>}
                </div>
              </button>
            ))}
          </div>
          {current && (
            <Card title={`Opérations · ${current.name}`} padded={false}>
              <div className="px-4 pt-3">
                <Tabs
                  tabs={[
                    { key: "unreconciled", label: "À rapprocher" },
                    { key: "all", label: "Toutes" },
                  ]}
                  value={filter}
                  onChange={setFilter}
                />
              </div>
              {!lines ? (
                <Loading />
              ) : (
                <DataTable
                  rows={lines.items}
                  rowKey={(l) => l.id}
                  empty={filter === "unreconciled" ? "Toutes les opérations sont rapprochées." : "Aucune opération."}
                  columns={[
                    { key: "date", label: "Date", render: (l) => fmtDate(l.date) },
                    { key: "label", label: "Libellé" },
                    { key: "partner", label: "Tiers", render: (l) => l.partner?.name ?? "—" },
                    { key: "amount", label: "Montant", align: "right", render: (l) => <span className={l.amount < 0 ? "text-danger" : "text-ok"}>{fmtGNF(l.amount)}</span> },
                    {
                      key: "reconciled",
                      label: "",
                      align: "right",
                      render: (l) =>
                        l.reconciled ? (
                          <button type="button" className="inline-flex items-center gap-1 text-xs text-muted hover:text-warn" onClick={() => apiSend("POST", `/finance/treasury/lines/${l.id}/unreconcile`).then(refresh)}>
                            <Check className="h-3.5 w-3.5 text-ok" /> Rapprochée <Undo2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setMatching(l)}>
                            <Link2 className="h-3.5 w-3.5" /> Rapprocher
                          </Button>
                        ),
                    },
                  ]}
                />
              )}
            </Card>
          )}
        </>
      )}
      {current && modal === "operation" && <OperationModal journal={current} onClose={() => setModal(null)} onDone={refresh} />}
      {current && modal === "import" && <ImportModal journal={current} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "transfer" && position && <TransferModal accounts={position.accounts} onClose={() => setModal(null)} onDone={refresh} />}
      {matching && <MatchModal line={matching} onClose={() => setMatching(null)} onDone={refresh} />}
    </div>
  );
}

function useAccounts(prefix: string) {
  return useApi<Account[]>(`/finance/accounts?prefix=${prefix}&limit=2000`);
}

function OperationModal({ journal, onClose, onDone }: { journal: CashAccount; onClose: () => void; onDone: () => void }) {
  const { data: accounts } = useApi<Account[]>("/finance/accounts?limit=2000");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [form, setForm] = useState({ date: today(), label: "", amount: "", account: "" });
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const amount = Number(form.amount.replace(/\s/g, ""));
      await apiSend("POST", `/finance/treasury/${journal.journal_id}/lines`, {
        date: form.date,
        label: form.label,
        amount: direction === "out" ? -amount : amount,
        partner_id: partner?.id,
        counterpart_account_id: form.account ? Number(form.account) : undefined,
      });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Opération · ${journal.name}`} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={submit} disabled={!form.label || !form.amount}>Enregistrer</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Tabs tabs={[{ key: "out", label: "Sortie" }, { key: "in", label: "Entrée" }]} value={direction} onChange={setDirection} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Montant (GNF)">
            <Input inputMode="numeric" className="text-right font-mono" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
        </div>
        <Field label="Libellé">
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Frais de mission, achat carburant…" />
        </Field>
        <Field label="Tiers (facultatif)">
          <PartnerPicker value={partner} onChange={setPartner} kind={direction === "out" ? "supplier" : "customer"} />
        </Field>
        <Field label="Compte d'imputation" hint="Renseigné : l'opération est imputée aussitôt. Vide : elle reste à rapprocher avec une facture.">
          <Select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="À rapprocher plus tard" options={(accounts ?? []).filter((a) => /^[2-8]/.test(a.code) && !a.code.startsWith("5")).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
        </Field>
      </div>
    </Modal>
  );
}

function ImportModal({ journal, onClose, onDone }: { journal: CashAccount; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ created: number; skipped_duplicates: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      setResult(await apiUpload(`/finance/treasury/${journal.journal_id}/import`, form));
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Importer un relevé · ${journal.name}`} onClose={onClose} footer={<Button variant="primary" onClick={submit} loading={busy} disabled={!file}>Importer</Button>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">Fichier CSV ou XLSX exporté de la banque, avec une date, un libellé et un montant (ou un débit et un crédit). Les opérations déjà importées sont ignorées.</p>
        {error && <Notice tone="danger">{error}</Notice>}
        {result && (
          <Notice tone="ok">
            {result.created} opération(s) importée(s), {result.skipped_duplicates} doublon(s) ignoré(s).
          </Notice>
        )}
        <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      </div>
    </Modal>
  );
}

function TransferModal({ accounts, onClose, onDone }: { accounts: CashAccount[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ from: "", to: "", amount: "", date: today(), ref: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = accounts.map((a) => ({ value: a.journal_id, label: a.name }));
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/finance/transfers", {
        from_journal_id: Number(form.from),
        to_journal_id: Number(form.to),
        amount: Number(form.amount.replace(/\s/g, "")),
        date: form.date,
        ref: form.ref || undefined,
      });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Virement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Virement interne" onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={submit} disabled={!form.from || !form.to || !form.amount}>Enregistrer le virement</Button>}>
      <div className="space-y-3">
        <p className="text-xs text-muted">Le virement passe par le compte de passage 585, soldé dès que les deux écritures sont passées.</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Depuis">
            <Select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="Choisir…" options={options} />
          </Field>
          <Field label="Vers">
            <Select value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="Choisir…" options={options} />
          </Field>
          <Field label="Montant (GNF)">
            <Input inputMode="numeric" className="text-right font-mono" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
        </div>
        <Field label="Libellé (facultatif)">
          <Input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function MatchModal({ line, onClose, onDone }: { line: StLine; onClose: () => void; onDone: () => void }) {
  const { data: candidates } = useApi<Candidate[]>(`/finance/treasury/lines/${line.id}/candidates`);
  const { data: accounts } = useAccounts("");
  const [selected, setSelected] = useState<number[]>([]);
  const [account, setAccount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = (candidates ?? []).filter((c) => selected.includes(c.id)).reduce((a, c) => a + c.residual, 0);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/finance/treasury/lines/${line.id}/reconcile`, selected.length ? { move_line_ids: selected } : { account_id: Number(account) });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Rapprochement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      wide
      title={`Rapprocher · ${line.label} · ${fmtGNF(line.amount)}`}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!selected.length && !account} onClick={submit}>
          Rapprocher
        </Button>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="text-xs text-muted">Pièces en attente classées par pertinence (référence citée, montant, tiers). Sélection : {fmtGNF(total)}.</div>
        {!candidates ? (
          <Loading />
        ) : (
          <DataTable
            dense
            rows={candidates}
            rowKey={(c) => c.id}
            onRowClick={(c) => setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}
            empty="Aucune pièce en attente."
            columns={[
              { key: "sel", label: "", render: (c) => <input type="checkbox" readOnly checked={selected.includes(c.id)} /> },
              { key: "move", label: "Pièce" },
              { key: "partner", label: "Tiers", render: (c) => c.partner ?? "—" },
              { key: "due", label: "Échéance", render: (c) => fmtDate(c.due) },
              { key: "residual", label: "Reste", align: "right", render: (c) => fmtGNF(c.residual) },
              { key: "score", label: "Pertinence", align: "right", render: (c) => (c.score >= 5 ? <Badge tone="ok">Forte</Badge> : c.score >= 2 ? <Badge tone="accent">Moyenne</Badge> : "—") },
            ]}
          />
        )}
        <Field label="Ou imputer directement à un compte" hint="Frais bancaires, agios, produit divers…">
          <Select value={account} onChange={(e) => setAccount(e.target.value)} placeholder="—" options={(accounts ?? []).filter((a) => /^[2-8]/.test(a.code) && !a.code.startsWith("5")).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
        </Field>
      </div>
    </Modal>
  );
}

