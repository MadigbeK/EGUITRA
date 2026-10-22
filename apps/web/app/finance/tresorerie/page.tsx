"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, FileUp, Landmark, Link2, Paperclip, Plus, Scale, Undo2, Wallet } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, FileButton, Input, Kpi, Loading, Modal, Notice, PageHeader, Select, Tabs, cx } from "@/components/ui";
import { AnalyticFields, AnalyticTags, toDistribution, useAxes, type AxisChoice } from "@/components/finance/AnalyticFields";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, apiUpload, useApi, useSaisieLibre } from "@/lib/api-client";
import type { Account, AnalyticShare, CashAccount, Ref } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF, fmtShort, pluriel } from "@/lib/format";

interface StLine {
  id: number;
  date: string;
  label: string;
  partner: { id: number; name: string } | null;
  amount: number;
  reconciled: boolean;
  /** Faux : décaissement en attente du circuit d'approbation (comptabilisé à la dernière approbation). */
  posted?: boolean;
  approval?: { request_id: number; state: string; pending_with: string | null } | null;
  statement: string | null;
  reference: string | null;
  payment_mode: Ref | null;
  attachments: number;
  counterpart: Array<{ code: string; name: string; analytic: AnalyticShare[] }> | null;
}
interface Candidate {
  /** Nature du candidat : « move_line » (facture, règlement) ou « loan_line » (échéance d'emprunt réglée
   * par la sortie de banque, capital et intérêts en contrepartie). */
  kind: string;
  id: number;
  move: string;
  move_id: number;
  partner: string | null;
  label: string | null;
  date: string;
  due: string | null;
  residual: number;
  score: number;
  already_paid?: boolean;
  hint?: string;
  principal?: number;
  interest?: number;
}
interface PaymentMode { id: number; name: string; active: boolean }

const JUSTIFICATIFS = ".pdf,.jpg,.jpeg,.png,.docx,.xlsx";

function usePaymentModes() {
  return useApi<PaymentMode[]>("/finance/payment-modes");
}

const cle = (c: Candidate) => `${c.kind ?? "move_line"}-${c.id}`;

const today = () => new Date().toISOString().slice(0, 10);

export default function TreasuryPage() {
  const { data: position, error, mutate: refreshPosition } = useApi<{ accounts: CashAccount[]; total: number; as_of: string }>("/finance/treasury");
  const [journalId, setJournalId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"unreconciled" | "all">("unreconciled");
  const current = position?.accounts.find((a) => a.journal_id === journalId) ?? position?.accounts[0] ?? null;
  const { data: lines, mutate } = useApi<{ items: StLine[]; total_count: number }>(current ? `/finance/treasury/${current.journal_id}/lines?state=${filter}&limit=300` : null);
  const [modal, setModal] = useState<null | "operation" | "import" | "transfer">(null);
  const [matching, setMatching] = useState<StLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

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
            <Button onClick={() => current && router.push(`/finance/tresorerie/rapprochement?journal=${current.journal_id}`)} disabled={!current}>
              <Scale className="h-4 w-4" /> État de rapprochement
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
            <Kpi label="Trésorerie totale" value={fmtShort(position.total)} hint={`Au ${fmtDate(position.as_of)}`} icon={Landmark} teinte="jade" tone="ok" />
            {position.accounts.map((a) => {
              const choisi = current?.journal_id === a.journal_id;
              const I = a.type === "cash" ? Wallet : Landmark;
              return (
                <button
                  key={a.journal_id}
                  type="button"
                  onClick={() => setJournalId(a.journal_id)}
                  aria-pressed={choisi}
                  className={cx(
                    "n-kpi n-levable relative min-w-0 overflow-hidden rounded-2xl border p-4 text-left",
                    choisi ? "n-degrade border-transparent text-white shadow-[0_16px_30px_-16px_var(--accent-lueur)]" : "border-line bg-panel shadow-[var(--ombre-carte)]",
                  )}
                >
                  <div className="relative flex items-center justify-between gap-2">
                    <span className={cx("grid h-9 w-9 place-items-center rounded-[10px]", choisi ? "bg-white/15 text-white" : "bg-accent-doux text-accent")}>
                      <I className="h-[18px] w-[18px]" />
                    </span>
                    {a.unreconciled ? (
                      <span className={cx("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", choisi ? "bg-white/20 text-white" : "bg-warn-doux text-warn")}>{a.unreconciled} à rapprocher</span>
                    ) : (
                      <span className={cx("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", choisi ? "bg-white/20 text-white" : "bg-ok-doux text-ok-texte")}>À jour</span>
                    )}
                  </div>
                  <div className={cx("relative mt-3 truncate text-[13px] font-medium", choisi ? "text-white/85" : "text-ink-2")}>
                    {a.name}
                    <span className={cx("ml-1.5 text-[12px]", choisi ? "text-white/70" : "text-muted")}>{a.type === "cash" ? "Caisse" : "Banque"}</span>
                  </div>
                  <div className={cx("relative mt-1 font-display text-[22px] font-bold tabular", choisi ? "text-white" : a.balance < 0 ? "text-danger" : "text-ink")}>
                    {a.currency !== "GNF" ? `${fmtDec(a.balance_currency)} ${a.currency}` : fmtGNF(a.balance)}
                  </div>
                  {a.currency !== "GNF" && <div className={cx("relative mt-0.5 text-[12px]", choisi ? "text-white/75" : "text-muted")}>Contre-valeur {fmtGNF(a.balance)}</div>}
                </button>
              );
            })}
          </div>
          {current && (
            <Card title={`Opérations, ${current.name}`} padded={false}>
              {notice && (
                <div className="px-4 pt-3">
                  <Notice tone="danger">{notice}</Notice>
                </div>
              )}
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
                    {
                      key: "label",
                      label: "Libellé",
                      render: (l) => (
                        <div>
                          <div>{l.label}</div>
                          {(l.reference || l.payment_mode) && <div className="text-[12px] text-muted">{[l.payment_mode?.name, l.reference].filter(Boolean).join(" · ")}</div>}
                        </div>
                      ),
                    },
                    { key: "partner", label: "Tiers", render: (l) => l.partner?.name ?? "–" },
                    {
                      key: "counterpart",
                      label: "Imputation",
                      render: (l) =>
                        l.counterpart?.length ? (
                          <div className="space-y-1">
                            <div className="font-mono text-xs">{l.counterpart.map((c) => c.code).join(", ")}</div>
                            <AnalyticTags shares={l.counterpart.flatMap((c) => c.analytic)} />
                          </div>
                        ) : (
                          "–"
                        ),
                    },
                    { key: "amount", label: "Montant", align: "right", render: (l) => <span className={cx("font-semibold", l.amount < 0 ? "text-danger" : "text-ok")}>{l.amount > 0 ? "+" : ""}{fmtGNF(l.amount)}</span> },
                    {
                      key: "attachments",
                      label: "",
                      render: (l) => (
                        <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {l.attachments > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-muted" title="Justificatifs">
                              <Paperclip className="h-3.5 w-3.5" />
                              {l.attachments}
                            </span>
                          )}
                          <FileButton
                            small
                            label="Justificatif"
                            accept={JUSTIFICATIFS}
                            onFile={(file) => {
                              const form = new FormData();
                              form.append("file", file);
                              setNotice(null);
                              apiUpload(`/finance/treasury/lines/${l.id}/attachments`, form)
                                .then(refresh)
                                .catch((e) => setNotice(e instanceof ApiError ? e.message : "Envoi du justificatif impossible."));
                            }}
                          />
                        </span>
                      ),
                    },
                    {
                      key: "reconciled",
                      label: "",
                      align: "right",
                      render: (l) =>
                        l.posted === false ? (
                          <Badge tone={l.approval?.state === "rejected" ? "danger" : "warn"}>
                            {l.approval?.state === "rejected" ? "Décaissement refusé" : `En approbation${l.approval?.pending_with ? ` : ${l.approval.pending_with}` : ""}`}
                          </Badge>
                        ) : l.reconciled ? (
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
      {current && modal === "operation" && <OperationModal journal={current} onClose={() => setModal(null)} onDone={refresh} onTransfer={() => setModal("transfer")} />}
      {current && modal === "import" && <ImportModal journal={current} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "transfer" && position && <TransferModal accounts={position.accounts} onClose={() => setModal(null)} onDone={refresh} />}
      {matching && <MatchModal line={matching} onClose={() => setMatching(null)} onDone={refresh} />}
    </div>
  );
}

function useAccounts(prefix: string) {
  return useApi<Account[]>(`/finance/accounts?prefix=${prefix}&limit=2000`);
}

type LoanPart = "none" | "disbursement" | "principal" | "interest";
interface OperationType { id: number; name: string; direction: "in" | "out"; account: { id: number; code: string; name: string } | null; reference_required: boolean; is_transfer: boolean; loan_part: LoanPart; to_match: boolean }
interface LoanRef { id: number; name: string; state: "draft" | "active" | "closed"; lender: { id: number; name: string }; principal: number; outstanding: number; principal_account: string | null; interest_account: string | null }

/** Types à part d'emprunt : la contrepartie est le compte du financement désigné. */
const PART_HINT: Record<Exclude<LoanPart, "none">, string> = {
  disbursement: "Déblocage reçu : crédit du compte de dette du financement. C'est ainsi que le déblocage se comptabilise.",
  principal: "Remboursement anticipé hors échéancier : débit du compte de dette. Une échéance de l'échéancier se règle depuis la ligne du relevé (Rapprocher) ou par « Régler ».",
  interest: "Intérêts hors échéancier (intercalaires, de retard) : débit du compte de charges financières du financement.",
};

/** Financements en cours de la société, pour les types d'opération à part d'emprunt. */
function useActiveLoans(enabled: boolean) {
  const { data } = useApi<{ items: LoanRef[] }>(enabled ? "/finance/loans" : null);
  return (data?.items ?? []).filter((l) => l.state === "active");
}

function OperationModal({ journal, onClose, onDone, onTransfer }: { journal: CashAccount; onClose: () => void; onDone: () => void; onTransfer: () => void }) {
  const { data: accounts } = useApi<Account[]>("/finance/accounts?limit=2000");
  const { data: modes } = usePaymentModes();
  const { data: kinds } = useApi<OperationType[]>("/finance/treasury/operation-types");
  const { data: axes } = useAxes();
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [form, setForm] = useState({ date: today(), label: "", amount: "", account: "", reference: "", mode: "", kind: "", loan: "" });
  const kind = kinds?.find((k) => String(k.id) === form.kind);
  const financement = kind && kind.loan_part !== "none" ? kind.loan_part : null;
  const loans = useActiveLoans(Boolean(financement));
  const loan = loans.find((l) => String(l.id) === form.loan);
  // Sans le droit « Saisie libre des comptes », seul le compte du type d'opération s'applique.
  const libre = useSaisieLibre();
  // Analytique sur un compte d'imputation, et sur les intérêts (charges financières) d'un financement.
  const analytique = Boolean(form.account) || financement === "interest";

  /** Le type d'opération fixe le sens et la contrepartie (sauf client ou fournisseur : à rapprocher). */
  function chooseKind(id: string) {
    const next = kinds?.find((k) => String(k.id) === id);
    if (next?.is_transfer) {
      onTransfer();
      return;
    }
    if (next) setDirection(next.direction);
    const account = next && next.loan_part === "none" && !next.to_match && next.account ? String(next.account.id) : next ? "" : form.account;
    setForm({ ...form, kind: id, account, loan: "" });
  }
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [choice, setChoice] = useState<AxisChoice>({});
  const [receipt, setReceipt] = useState<File | null>(null);
  /** Opération déjà enregistrée : un nouvel essai n'envoie plus que le justificatif. */
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let id = createdId;
      if (!id) {
        const amount = Number(form.amount.replace(/\s/g, ""));
        const line = await apiSend<StLine>("POST", `/finance/treasury/${journal.journal_id}/lines`, {
          date: form.date,
          label: form.label,
          amount: direction === "out" ? -amount : amount,
          partner_id: partner?.id,
          counterpart_account_id: form.account && !financement ? Number(form.account) : undefined,
          analytic_distribution: analytique ? toDistribution(choice) : undefined,
          payment_mode_id: form.mode ? Number(form.mode) : undefined,
          reference: form.reference || undefined,
          operation_type_id: form.kind ? Number(form.kind) : undefined,
          loan_id: financement && form.loan ? Number(form.loan) : undefined,
        });
        id = line.id;
        setCreatedId(id);
        onDone();
      }
      if (receipt) {
        const data = new FormData();
        data.append("file", receipt);
        try {
          await apiUpload(`/finance/treasury/lines/${id}/attachments`, data);
        } catch (e) {
          setError(`Opération enregistrée ; justificatif refusé : ${e instanceof ApiError ? e.message : "envoi impossible"}`);
          return;
        }
        onDone();
      }
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open wide title={`Opération, ${journal.name}`} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={submit} disabled={!form.label || !form.amount || (createdId === null && Boolean(financement) && !form.loan) || (createdId !== null && !receipt)}>{createdId ? "Joindre le justificatif" : "Enregistrer"}</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {kinds && kinds.length > 0 && (
          <Field label="Type d'opération" hint={kind?.to_match ? "Opération client ou fournisseur : elle reste à rapprocher de la facture." : kind ? "Le type fixe le sens et le compte de contrepartie." : undefined}>
            <Select value={form.kind} onChange={(e) => chooseKind(e.target.value)} placeholder="Saisie libre" options={kinds.map((k) => ({ value: k.id, label: `${k.name} (${k.is_transfer ? "virement" : k.direction === "in" ? "entrée" : "sortie"})` }))} />
          </Field>
        )}
        {!kind && <Tabs tabs={[{ key: "out", label: "Sortie" }, { key: "in", label: "Entrée" }]} value={direction} onChange={setDirection} />}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Montant (GNF)">
            <Input inputMode="numeric" className="text-right font-mono" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Mode de paiement">
            <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} placeholder="–" options={(modes ?? []).map((m) => ({ value: m.id, label: m.name }))} />
          </Field>
          <Field label={kind?.reference_required ? "Référence (obligatoire)" : "Référence"} hint="Facture, contrat, chèque…">
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
        </div>
        <Field label="Libellé">
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Frais de mission, achat carburant…" />
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Tiers (facultatif)">
            <PartnerPicker value={partner} onChange={setPartner} kind={direction === "out" ? "supplier" : "customer"} />
          </Field>
          {financement ? (
            <Field label="Financement" hint={loan ? `${loan.lender.name} · capital restant dû ${fmtGNF(loan.outstanding)} · compte ${financement === "interest" ? loan.interest_account : loan.principal_account}` : "Financements en cours (Dette et financement)."}>
              <Select value={form.loan} onChange={(e) => setForm({ ...form, loan: e.target.value })} placeholder="Choisir…" options={loans.map((l) => ({ value: l.id, label: `${l.name}, ${l.lender.name}` }))} />
            </Field>
          ) : libre ? (
            <Field label="Compte d'imputation" hint="Renseigné : l'opération est imputée aussitôt. Vide : elle reste à rapprocher avec une facture.">
              <Select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="À rapprocher plus tard" options={(accounts ?? []).filter((a) => /^[2-8]/.test(a.code) && !a.code.startsWith("5")).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
            </Field>
          ) : (
            <Field label="Compte d'imputation" hint="Le compte vient du type d'opération ; le choisir librement demande le droit « Saisie libre des comptes ».">
              <div className="py-2 text-sm text-ink-2">{kind?.account && !kind.to_match ? `${kind.account.code} ${kind.account.name}` : "À rapprocher plus tard"}</div>
            </Field>
          )}
        </div>
        {financement && <Notice tone="accent">{PART_HINT[financement]}</Notice>}
        {analytique && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-ink-2">Imputation analytique</div>
            <AnalyticFields axes={axes} value={choice} onChange={setChoice} />
          </div>
        )}
        <Field label="Justificatif (facultatif)" hint="PDF, JPEG, PNG, Word ou Excel, 15 Mo au plus.">
          <input type="file" accept={JUSTIFICATIFS} onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong/70 file:bg-panel file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-panel-2" />
        </Field>
      </div>
    </Modal>
  );
}

interface ImportBalances { start: number | null; end: number | null; total: number; gap: number | null; controlled: boolean; source_start: string | null; source_end: string | null }
interface ImportResult {
  created: number;
  attached: number;
  skipped_duplicates: number;
  statement: { id: number; name: string; balance_start: number; balance_end_real: number; is_complete: boolean } | null;
  balances: ImportBalances;
  warnings: string[];
}

/**
 * Import d'un relevé : soldes initial et final lus dans le fichier (lignes de solde, colonne de solde
 * progressif) ou saisis d'après le relevé papier ; le noyau contrôle « solde initial + opérations =
 * solde final » et refuse un écart, sauf confirmation.
 */
function ImportModal({ journal, onClose, onDone }: { journal: CashAccount; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [gap, setGap] = useState<ImportBalances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(force = false) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setGap(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (start.trim()) form.append("balance_start", start.trim());
      if (end.trim()) form.append("balance_end", end.trim());
      if (force) form.append("force", "1");
      setResult(await apiUpload<ImportResult>(`/finance/treasury/${journal.journal_id}/import`, form));
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "statement_gap") setGap((e.body as { balances?: ImportBalances }).balances ?? null);
      setError(e instanceof ApiError ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }
  const money = (v: number | null) => (v === null ? "non renseigné" : fmtGNF(v, journal.currency));
  return (
    <Modal
      open
      title={`Importer un relevé, ${journal.name}`}
      onClose={onClose}
      footer={
        <>
          {gap && (
            <Button variant="danger" onClick={() => submit(true)} loading={busy}>
              Importer malgré l&apos;écart
            </Button>
          )}
          <Button variant="primary" onClick={() => submit(false)} loading={busy} disabled={!file || Boolean(result)}>
            Importer
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Fichier CSV ou XLSX exporté de la banque, avec une date, un libellé et un montant (ou un débit et un crédit), ou relevé normalisé ISO 20022 camt.053 (XML). Les soldes du relevé sont lus dans le fichier s&apos;il les porte ; sinon saisissez-les. Les opérations déjà importées sont ignorées, celles déjà saisies à la main sont rattachées au relevé.
        </p>
        {error && <Notice tone="danger">{error}</Notice>}
        {result && (
          <Notice tone={result.statement && !result.statement.is_complete ? "warn" : "ok"}>
            <div>
              {pluriel(result.created, "opération importée", "opérations importées")}, {pluriel(result.attached, "opération saisie rattachée", "opérations saisies rattachées")}, {pluriel(result.skipped_duplicates, "doublon ignoré", "doublons ignorés")}.
            </div>
            <div>
              Solde initial {money(result.balances.start)}
              {result.balances.source_start ? ` (${result.balances.source_start})` : ""}, opérations {fmtGNF(result.balances.total, journal.currency)}, solde final {money(result.balances.end)}
              {result.balances.source_end ? ` (${result.balances.source_end})` : ""}.
            </div>
            <div>{result.balances.controlled ? (result.balances.gap ? `Écart de ${fmtGNF(result.balances.gap, journal.currency)} accepté : le relevé reste incomplet.` : "Relevé équilibré.") : "Soldes non contrôlés : le fichier ne les porte pas tous deux."}</div>
            {result.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </Notice>
        )}
        <input type="file" accept=".csv,.xlsx,.xml" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setGap(null); }} className="text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong/70 file:bg-panel file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-panel-2" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Solde initial du relevé" hint="Vide : lu dans le fichier">
            <Input inputMode="decimal" className="text-right font-mono" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Solde final du relevé" hint="Vide : lu dans le fichier">
            <Input inputMode="decimal" className="text-right font-mono" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
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
  const { data: axes } = useAxes();
  const { data: allKinds } = useApi<OperationType[]>("/finance/treasury/operation-types");
  // Types qui s'imputent (ni virement, ni client ou fournisseur), dans le sens de l'opération.
  const kinds = (allKinds ?? []).filter((k) => !k.is_transfer && !k.to_match && k.direction === (line.amount > 0 ? "in" : "out"));
  const [kindId, setKindId] = useState("");
  const [loanId, setLoanId] = useState("");
  const kind = kinds.find((k) => String(k.id) === kindId);
  const financement = kind && kind.loan_part !== "none" ? kind.loan_part : null;
  const loans = useActiveLoans(Boolean(financement));
  // L'imputation directe à un compte choisi relève du droit « Saisie libre des comptes ».
  const libre = useSaisieLibre();
  const [selected, setSelected] = useState<string[]>([]);
  const [account, setAccount] = useState("");
  const [choice, setChoice] = useState<AxisChoice>({});
  const imputation = Boolean(account) || (Boolean(kind) && (!financement || Boolean(loanId)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choisis = (candidates ?? []).filter((c) => selected.includes(cle(c)));
  const total = choisis.reduce((a, c) => a + c.residual, 0);
  const echeance = choisis.find((c) => c.kind === "loan_line");
  // Une échéance d'emprunt se règle seule ; les pièces de tiers se cumulent.
  function basculer(c: Candidate) {
    const k = cle(c);
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : c.kind === "loan_line" ? [k] : [...s.filter((x) => !x.startsWith("loan_line-")), k]));
  }
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const corps = echeance
        ? { loan_line_id: echeance.id }
        : choisis.length
          ? { move_line_ids: choisis.map((c) => c.id) }
          : kind
            ? { operation_type_id: kind.id, loan_id: financement ? Number(loanId) : undefined, analytic_distribution: toDistribution(choice) }
            : { account_id: Number(account), analytic_distribution: toDistribution(choice) };
      await apiSend("POST", `/finance/treasury/lines/${line.id}/reconcile`, corps);
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
      title={`Rapprocher, ${line.label}, ${fmtGNF(line.amount)}`}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!selected.length && !imputation} onClick={submit}>
          Rapprocher
        </Button>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="text-xs text-muted">Pièces en attente et échéances d&apos;emprunt classées par pertinence (référence citée, montant, tiers). Sélection : {fmtGNF(total)}.</div>
        {echeance && (
          <Notice tone={echeance.already_paid ? "warn" : "accent"}>
            {echeance.hint} Capital {fmtGNF(echeance.principal)}, intérêts {fmtGNF(echeance.interest)}.
          </Notice>
        )}
        {!candidates ? (
          <Loading />
        ) : (
          <DataTable
            dense
            rows={candidates}
            rowKey={(c) => cle(c)}
            onRowClick={basculer}
            empty="Aucune pièce en attente."
            columns={[
              { key: "sel", label: "", render: (c) => <input type="checkbox" readOnly checked={selected.includes(cle(c))} /> },
              {
                key: "move",
                label: "Pièce",
                render: (c) =>
                  c.kind === "loan_line" ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {c.move}
                      <Badge tone={c.already_paid ? "warn" : "accent"}>{c.already_paid ? "Échéance déjà réglée en banque" : "Échéance d'emprunt"}</Badge>
                    </span>
                  ) : (
                    c.move
                  ),
              },
              { key: "partner", label: "Tiers", render: (c) => c.partner ?? "–" },
              { key: "due", label: "Échéance", render: (c) => fmtDate(c.due) },
              { key: "residual", label: "Reste", align: "right", render: (c) => fmtGNF(c.residual) },
              { key: "score", label: "Pertinence", align: "right", render: (c) => (c.score >= 5 ? <Badge tone="ok">Forte</Badge> : c.score >= 2 ? <Badge tone="accent">Moyenne</Badge> : "–") },
            ]}
          />
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Ou imputer selon un type d'opération" hint="Le type fixe le compte : frais bancaires, déblocage d'emprunt…">
            <Select value={kindId} onChange={(e) => { setKindId(e.target.value); setLoanId(""); setAccount(""); }} placeholder="–" options={kinds.map((k) => ({ value: k.id, label: k.name }))} />
          </Field>
          {financement ? (
            <Field label="Financement">
              <Select value={loanId} onChange={(e) => setLoanId(e.target.value)} placeholder="Choisir…" options={loans.map((l) => ({ value: l.id, label: `${l.name}, ${l.lender.name}` }))} />
            </Field>
          ) : libre ? (
            <Field label="Ou imputer directement à un compte" hint="Frais bancaires, agios, produit divers…">
              <Select value={account} onChange={(e) => { setAccount(e.target.value); setKindId(""); }} placeholder="–" options={(accounts ?? []).filter((a) => /^[2-8]/.test(a.code) && !a.code.startsWith("5")).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
            </Field>
          ) : null}
        </div>
        {financement && <Notice tone="accent">{PART_HINT[financement]}</Notice>}
        {imputation && !selected.length && financement !== "disbursement" && financement !== "principal" && <AnalyticFields axes={axes} value={choice} onChange={setChoice} />}
      </div>
    </Modal>
  );
}

