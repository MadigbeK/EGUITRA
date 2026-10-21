"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Pencil, Printer } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, cx } from "@/components/ui";
import { ApiError, apiDownload, apiSend, useApi } from "@/lib/api-client";
import type { CashAccount } from "@/lib/finance-types";
import { fmtDate, fmtGNF } from "@/lib/format";

interface BookLine { id: number; move_id: number; move: string; date: string; journal: string; label: string | null; partner: string | null; amount: number }
interface StatementLine { id: number; date: string; label: string; partner: string | null; amount: number; statement: string | null }
interface Reconciliation {
  journal: { id: number; name: string; code: string; type: string; account: string };
  company: string;
  currency: string;
  date: string;
  book_balance: number;
  bank_balance: number | null;
  statement: { id: number; name: string; date: string; balance_start: number; balance_end_real: number; is_complete: boolean } | null;
  book_only: BookLine[];
  book_only_total: number;
  unreconciled: StatementLine[];
  unreconciled_total: number;
  pending_payments: BookLine[];
  pending_payments_total: number;
  diagnostics: {
    opening_gap: number;
    breaks: Array<{ statement: string; previous: string; gap: number }>;
    incomplete: Array<{ statement: string; gap: number }>;
    first_statement?: string;
    book_before_first?: number;
  };
  residual_gap: number | null;
  balanced: boolean | null;
}
interface BankStatement { id: number; name: string; date: string | null; first_date: string | null; lines: number; balance_start: number; balance_end: number; balance_end_real: number; gap: number; is_complete: boolean; is_valid: boolean }

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * État de rapprochement bancaire, imprimable : solde du relevé, opérations comptabilisées absentes du
 * relevé, solde comptable et écart résiduel expliqué ; relevés importés et correction de leurs soldes.
 */
export function EtatRapprochement() {
  const params = useSearchParams();
  const { data: position } = useApi<{ accounts: CashAccount[] }>("/finance/treasury");
  const [journalId, setJournalId] = useState<string>(params.get("journal") ?? "");
  const [day, setDay] = useState(params.get("date") ?? todayIso());
  const current = journalId || String(position?.accounts.find((a) => a.type === "bank")?.journal_id ?? "");
  const { data, error, mutate } = useApi<Reconciliation>(current ? `/finance/treasury/${current}/reconciliation-statement?date=${day}` : null);
  const { data: statements, mutate: refreshStatements } = useApi<BankStatement[]>(current ? `/finance/treasury/${current}/statements` : null);
  const [editing, setEditing] = useState<BankStatement | null>(null);
  const money = (v: number | null | undefined) => (v === null || v === undefined ? "–" : fmtGNF(v, data?.currency ?? "GNF"));

  return (
    <div>
      <PageHeader
        title="État de rapprochement bancaire"
        subtitle="Solde du relevé, opérations comptabilisées absentes du relevé, solde comptable et écart résiduel."
        actions={
          <>
            <Button onClick={() => window.print()} disabled={!data}>
              <Printer className="h-4 w-4" /> Imprimer
            </Button>
            <Button onClick={() => apiDownload(`/finance/treasury/${current}/reconciliation-statement?date=${day}&format=xlsx`, `rapprochement_${day}.xlsx`)} disabled={!data}>
              <Download className="h-4 w-4" /> Excel
            </Button>
          </>
        }
      />
      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <Field label="Compte">
          <Select value={current} onChange={(e) => setJournalId(e.target.value)} placeholder={position ? undefined : "Chargement…"} options={(position?.accounts ?? []).map((a) => ({ value: a.journal_id, label: `${a.name} (${a.type === "cash" ? "caisse" : "banque"})` }))} />
        </Field>
        <Field label="Arrêté au">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && current && <Loading />}
      {data && (
        <div className="space-y-5">
          <div className="hidden print:block">
            <div className="text-lg font-semibold">{data.company}</div>
            <div className="text-sm">
              {data.journal.name}, compte {data.journal.account}, état de rapprochement au {fmtDate(data.date)} (édité le {fmtDate(todayIso())})
            </div>
          </div>
          <Card title="Rapprochement">
            {data.bank_balance === null ? (
              <Notice tone="warn">Aucun relevé importé à cette date : importez le relevé de la banque depuis l&apos;écran Trésorerie pour établir l&apos;état.</Notice>
            ) : (
              <table className="tabular w-full max-w-2xl text-sm">
                <tbody>
                  <Row label={`Solde du relevé bancaire${data.statement ? ` (${data.statement.name})` : ""}`} value={money(data.bank_balance)} />
                  <Row label="+ Opérations comptabilisées absentes du relevé" value={money(data.book_only_total)} />
                  <Row label="= Solde bancaire ajusté" value={money(data.bank_balance + data.book_only_total)} strong />
                  <Row label={`Solde comptable du compte ${data.journal.account}`} value={money(data.book_balance)} strong />
                  <tr className="border-t border-line">
                    <td className="py-2 font-semibold">Écart résiduel</td>
                    <td className="py-2 text-right font-mono font-semibold">
                      <span className={cx(data.balanced ? "text-ok" : "text-danger")}>{money(data.residual_gap)}</span>{" "}
                      {data.balanced ? <Badge tone="ok">Rapprochement équilibré</Badge> : <Badge tone="danger">Écart à expliquer</Badge>}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
            {data.bank_balance !== null && !data.balanced && (
              <div className="mt-4 space-y-1 text-sm">
                <div className="font-semibold text-ink-2">Explication de l&apos;écart</div>
                {Math.abs(data.diagnostics.opening_gap) >= 0.5 && (
                  <div>
                    Écart d&apos;ouverture : solde comptable avant le premier relevé ({data.diagnostics.first_statement}) {money(data.diagnostics.book_before_first)}, différent de son solde initial ({money(data.diagnostics.opening_gap)}).
                  </div>
                )}
                {data.diagnostics.breaks.map((b) => (
                  <div key={b.statement}>
                    Rupture : le solde initial de {b.statement} ne prolonge pas le solde final de {b.previous} ({money(b.gap)}).
                  </div>
                ))}
                {data.diagnostics.incomplete.map((i) => (
                  <div key={i.statement}>
                    Relevé incomplet : {i.statement}, opérations manquantes pour {money(i.gap)}.
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={`Opérations comptabilisées absentes du relevé (${money(data.book_only_total)})`} padded={false}>
            <DataTable
              dense
              rows={data.book_only}
              rowKey={(l) => l.id}
              empty="Aucune : toutes les écritures du compte figurent sur les relevés."
              columns={[
                { key: "date", label: "Date", render: (l) => fmtDate(l.date) },
                { key: "move", label: "Pièce", render: (l) => <span className="font-mono text-xs">{l.move}</span> },
                { key: "journal", label: "Journal" },
                { key: "label", label: "Libellé", render: (l) => l.label ?? "–" },
                { key: "partner", label: "Tiers", render: (l) => l.partner ?? "–" },
                { key: "amount", label: "Montant", align: "right", render: (l) => money(l.amount) },
              ]}
            />
          </Card>

          <Card title={`Opérations du relevé non rapprochées (${money(data.unreconciled_total)})`} padded={false}>
            <p className="px-5 pb-2 text-xs text-muted">Déjà au solde comptable, leur contrepartie attend sur le compte d&apos;attente : à rapprocher avant la clôture.</p>
            <DataTable
              dense
              rows={data.unreconciled}
              rowKey={(l) => l.id}
              empty="Toutes les opérations du relevé sont rapprochées."
              columns={[
                { key: "date", label: "Date", render: (l) => fmtDate(l.date) },
                { key: "statement", label: "Relevé", render: (l) => l.statement ?? "Saisie" },
                { key: "label", label: "Libellé" },
                { key: "partner", label: "Tiers", render: (l) => l.partner ?? "–" },
                { key: "amount", label: "Montant", align: "right", render: (l) => money(l.amount) },
              ]}
            />
          </Card>

          {data.pending_payments.length > 0 && (
            <Card title={`Règlements en attente de passage en banque (${money(data.pending_payments_total)})`} padded={false}>
              <DataTable
                dense
                rows={data.pending_payments}
                rowKey={(l) => l.id}
                columns={[
                  { key: "date", label: "Date", render: (l) => fmtDate(l.date) },
                  { key: "move", label: "Pièce", render: (l) => <span className="font-mono text-xs">{l.move}</span> },
                  { key: "label", label: "Libellé", render: (l) => l.label ?? "–" },
                  { key: "partner", label: "Tiers", render: (l) => l.partner ?? "–" },
                  { key: "amount", label: "Montant", align: "right", render: (l) => money(l.amount) },
                ]}
              />
            </Card>
          )}

          <Card title="Relevés importés" padded={false}>
            {!statements ? (
              <Loading />
            ) : (
              <DataTable
                dense
                rows={statements}
                rowKey={(s) => s.id}
                empty="Aucun relevé importé."
                columns={[
                  { key: "name", label: "Relevé" },
                  { key: "first_date", label: "Du", render: (s) => fmtDate(s.first_date) },
                  { key: "date", label: "Au", render: (s) => fmtDate(s.date) },
                  { key: "balance_start", label: "Solde initial", align: "right", render: (s) => money(s.balance_start) },
                  { key: "balance_end_real", label: "Solde final (banque)", align: "right", render: (s) => money(s.balance_end_real) },
                  { key: "balance_end", label: "Solde calculé", align: "right", render: (s) => money(s.balance_end) },
                  {
                    key: "status",
                    label: "Statut",
                    render: (s) => (
                      <div className="flex flex-wrap gap-1">
                        {s.is_complete ? <Badge tone="ok">Complet</Badge> : <Badge tone="danger">Écart {money(s.gap)}</Badge>}
                        {!s.is_valid && <Badge tone="warn">Rupture</Badge>}
                      </div>
                    ),
                  },
                  {
                    key: "edit",
                    label: "",
                    align: "right",
                    render: (s) => (
                      <button type="button" className="no-print text-muted hover:text-ink" aria-label="Corriger les soldes" onClick={() => setEditing(s)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}
      {editing && (
        <StatementBalances
          statement={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void mutate();
            void refreshStatements();
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td className={cx("py-1.5", strong && "font-semibold")}>{label}</td>
      <td className={cx("py-1.5 text-right font-mono", strong && "font-semibold")}>{value}</td>
    </tr>
  );
}

function StatementBalances({ statement, onClose, onSaved }: { statement: BankStatement; onClose: () => void; onSaved: () => void }) {
  const [start, setStart] = useState(String(statement.balance_start));
  const [end, setEnd] = useState(String(statement.balance_end_real));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("PATCH", `/finance/treasury/statements/${statement.id}`, { balance_start: num(start), balance_end_real: num(end) });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Soldes du relevé ${statement.name}`} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={save} disabled={Number.isNaN(num(start)) || Number.isNaN(num(end))}>Enregistrer</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="text-sm text-muted">Reportez les soldes imprimés sur le relevé de la banque. Opérations du relevé : {statement.lines}.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Solde initial">
            <Input inputMode="decimal" className="text-right font-mono" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Solde final">
            <Input inputMode="decimal" className="text-right font-mono" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
