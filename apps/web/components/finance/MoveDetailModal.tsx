"use client";

import { useState } from "react";
import { Download, FileUp, Paperclip, RotateCcw, Send, Wallet, XCircle } from "lucide-react";
import { Badge, Button, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, Select } from "@/components/ui";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { MOVE_STATES, PAYMENT_STATES, type Journal, type MoveDetail } from "@/lib/finance-types";
import { fmtDate, fmtGNF } from "@/lib/format";

/** Fiche d'une pièce : lignes, statut, règlement, impression, pièces jointes, avoir. */
export function MoveDetailModal({ moveId, onClose, onChanged }: { moveId: number | null; onClose: () => void; onChanged: () => void }) {
  const { data: move, error, mutate } = useApi<MoveDetail>(moveId ? `/finance/moves/${moveId}` : null);
  const { data: journals } = useApi<Journal[]>(moveId ? "/finance/journals?type=bank,cash" : null);
  const [paying, setPaying] = useState(false);
  const [journalId, setJournalId] = useState("");
  const [amount, setAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "ok"; text: string } | null>(null);

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
      await mutate();
      onChanged();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
    } finally {
      setBusy(null);
    }
  }

  const title = move ? `${move.name ?? "Brouillon"} · ${move.partner?.name ?? ""}` : "Pièce";
  return (
    <Modal open={moveId !== null} onClose={onClose} title={title} wide>
      {error && <ErrorBox error={error} />}
      {!move && !error && <Loading />}
      {move && (
        <div className="space-y-5">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={MOVE_STATES[move.state]?.tone}>{MOVE_STATES[move.state]?.label ?? move.state}</Badge>
            {move.state === "posted" && <Badge tone={PAYMENT_STATES[move.payment_state]?.tone}>{PAYMENT_STATES[move.payment_state]?.label ?? move.payment_state}</Badge>}
            {move.approval && move.approval.state !== "approved" && (
              <Badge tone={move.approval.state === "rejected" ? "danger" : "warn"}>
                {move.approval.state === "rejected" ? "Refusée" : `En validation${move.approval.pending_with ? ` : ${move.approval.pending_with}` : ""}`}
              </Badge>
            )}
            <span className="text-xs text-muted">
              Pièce du {fmtDate(move.invoice_date ?? move.date)} · échéance {fmtDate(move.invoice_date_due)}
              {move.ref ? ` · réf. ${move.ref}` : ""}
            </span>
          </div>

          <DataTable
            dense
            rows={move.lines.filter((l) => !l.display_type || l.display_type === "product")}
            rowKey={(l) => l.id}
            columns={[
              { key: "name", label: "Libellé" },
              { key: "account", label: "Compte", render: (l) => (l.account ? `${l.account.code}` : "—") },
              { key: "quantity", label: "Qté", align: "right", render: (l) => String(l.quantity) },
              { key: "price_unit", label: "PU HT", align: "right", render: (l) => fmtGNF(l.price_unit) },
              { key: "taxes", label: "TVA", render: (l) => l.taxes.map((t) => `${t.amount} %`).join(", ") || "—" },
              { key: "price_subtotal", label: "Total HT", align: "right", render: (l) => fmtGNF(l.price_subtotal) },
            ]}
          />

          <div className="flex flex-wrap justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <Paperclip className="h-3.5 w-3.5" /> Pièces jointes
              </div>
              {move.attachments.length === 0 && <p className="text-xs text-muted">Aucune pièce jointe.</p>}
              <ul className="space-y-1">
                {move.attachments.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="text-sm text-accent underline-offset-2 hover:underline" onClick={() => apiDownload(`/finance/attachments/${a.id}`, a.name)}>
                      {a.name}
                    </button>
                  </li>
                ))}
              </ul>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-2 hover:text-accent">
                <FileUp className="h-4 w-4" /> Joindre un justificatif
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.append("file", file);
                    void act("upload", () => apiUpload(`/finance/moves/${move.id}/attachments`, form));
                  }}
                />
              </label>
            </div>
            <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Total HT</dt>
              <dd className="text-right font-mono">{fmtGNF(move.amount_untaxed)}</dd>
              <dt className="text-muted">TVA</dt>
              <dd className="text-right font-mono">{fmtGNF(move.amount_tax)}</dd>
              <dt className="font-semibold">Total TTC</dt>
              <dd className="text-right font-mono font-semibold">{fmtGNF(move.amount_total)}</dd>
              {move.state === "posted" && (
                <>
                  <dt className="text-muted">Reste dû</dt>
                  <dd className="text-right font-mono text-warn">{fmtGNF(move.amount_residual)}</dd>
                </>
              )}
            </dl>
          </div>

          {paying && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-panel-2 p-4 md:grid-cols-4">
              <Field label="Compte de trésorerie">
                <Select value={journalId} onChange={(e) => setJournalId(e.target.value)} placeholder="Choisir…" options={(journals ?? []).map((j) => ({ value: j.id, label: j.name }))} />
              </Field>
              <Field label="Montant" hint={`Reste : ${fmtGNF(move.amount_residual)}`}>
                <Input inputMode="numeric" className="text-right font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(Math.round(move.amount_residual))} />
              </Field>
              <Field label="Date">
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!journalId}
                  loading={busy === "pay"}
                  onClick={() =>
                    act("pay", () =>
                      apiSend("POST", `/finance/moves/${move.id}/payments`, {
                        journal_id: Number(journalId),
                        amount: amount ? Number(amount.replace(/\s/g, "")) : undefined,
                        date: payDate,
                      }),
                    ).then(() => setPaying(false))
                  }
                >
                  Enregistrer le règlement
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {move.can_post && (
              <Button variant="primary" loading={busy === "post"} onClick={() => act("post", () => apiSend("POST", `/finance/moves/${move.id}/post`))}>
                <Send className="h-4 w-4" /> {move.move_type.startsWith("in_") ? "Soumettre / valider" : "Valider"}
              </Button>
            )}
            {move.can_pay && !paying && (
              <Button onClick={() => setPaying(true)}>
                <Wallet className="h-4 w-4" /> {move.move_type.startsWith("out_") ? "Encaisser" : "Régler"}
              </Button>
            )}
            {move.move_type !== "entry" && (
              <Button onClick={() => apiDownload(`/finance/moves/${move.id}/pdf`, `${move.name ?? "piece"}.pdf`)}>
                <Download className="h-4 w-4" /> PDF
              </Button>
            )}
            {move.state === "posted" && (
              <Button loading={busy === "reverse"} onClick={() => act("reverse", () => apiSend("POST", `/finance/moves/${move.id}/reverse`, { reason: `Avoir sur ${move.name}` }))}>
                <RotateCcw className="h-4 w-4" /> Avoir / extourne
              </Button>
            )}
            {move.state !== "cancel" && (
              <Button variant="danger" loading={busy === "cancel"} onClick={() => act("cancel", () => apiSend("POST", `/finance/moves/${move.id}/cancel`))}>
                <XCircle className="h-4 w-4" /> Annuler
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
