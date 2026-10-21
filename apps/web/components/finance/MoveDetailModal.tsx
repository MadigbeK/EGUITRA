"use client";

import { useState } from "react";
import { Download, Paperclip, Pencil, RotateCcw, Send, Trash2, Wallet, XCircle } from "@/components/icons";
import { Badge, Button, DataTable, ErrorBox, Field, FileButton, Input, Loading, Modal, Notice, Select } from "@/components/ui";
import { AnalyticTags } from "./AnalyticFields";
import { MoveForm } from "./MoveForm";
import { ApiError, apiDownload, apiSend, apiUpload, useAchatsSeul, useApi } from "@/lib/api-client";
import { MOVE_STATES, PAYMENT_STATES, type Journal, type MoveDetail } from "@/lib/finance-types";
import { fmtDate, fmtGNF } from "@/lib/format";

/**
 * Fiche d'une pièce : lignes, statut, règlement, impression, pièces jointes, avoir ; un brouillon d'achat se
 * modifie ou se supprime. Le profil Achats seul y joint ses justificatifs, imprime, modifie, supprime ou
 * soumet ses brouillons ; règlement, avoir, litige et annulation relèvent de la finance.
 */
export function MoveDetailModal({ moveId, onClose, onChanged }: { moveId: number | null; onClose: () => void; onChanged: () => void }) {
  const { data: move, error, mutate } = useApi<MoveDetail>(moveId ? `/finance/moves/${moveId}` : null);
  const { achats } = useAchatsSeul(moveId !== null);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const { data: journals } = useApi<Journal[]>(paying ? "/finance/journals?type=bank,cash" : null);
  const [journalId, setJournalId] = useState("");
  const [amount, setAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [modeId, setModeId] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const { data: modes } = useApi<Array<{ id: number; name: string }>>(paying ? "/finance/payment-modes" : null);
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

  /** Suppression d'un brouillon jamais validé (sinon le noyau refuse : l'annuler). */
  async function remove(id: number) {
    setBusy("delete");
    setMessage(null);
    try {
      await apiSend("DELETE", `/finance/moves/${id}`);
      onChanged();
      onClose();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Suppression impossible." });
    } finally {
      setBusy(null);
    }
  }

  const title = move ? `${move.name ?? "Brouillon"}, ${move.partner?.name ?? ""}` : "Pièce";
  const achat = move ? move.move_type === "in_invoice" || move.move_type === "in_refund" : false;

  if (move && editing && (move.move_type === "in_invoice" || move.move_type === "in_refund")) {
    return (
      <MoveForm
        open
        move={move}
        moveType={move.move_type}
        onClose={() => setEditing(false)}
        onCreated={() => {
          setEditing(false);
          void mutate();
          onChanged();
        }}
      />
    );
  }
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
            {move.dispute && <Badge tone="danger">Litige</Badge>}
            <span className="text-xs text-muted">
              Pièce du {fmtDate(move.invoice_date ?? move.date)}, échéance {fmtDate(move.invoice_date_due)}
              {move.ref ? `, réf. ${move.ref}` : ""}
              {move.contract_ref ? `, contrat ${move.contract_ref}` : ""}
              {move.currency !== "GNF" ? `, en ${move.currency}` : ""}
            </span>
          </div>
          {move.dispute && (
            <Notice tone="danger">
              En litige depuis le {fmtDate(move.dispute_date)} : {move.dispute_reason}. La facture n&apos;est pas relancée tant que le litige dure.
            </Notice>
          )}

          <DataTable
            dense
            rows={move.lines.filter((l) => !l.display_type || l.display_type === "product")}
            rowKey={(l) => l.id}
            columns={[
              { key: "name", label: "Libellé", render: (l) => <div>{l.name}{l.category && <div className="text-[12px] text-muted">{l.category.name}</div>}</div> },
              { key: "account", label: "Compte", render: (l) => (l.account ? `${l.account.code}` : "–") },
              { key: "analytic", label: "Analytique", render: (l) => <AnalyticTags shares={l.analytic} /> },
              { key: "quantity", label: "Qté", align: "right", render: (l) => String(l.quantity) },
              { key: "price_unit", label: "PU HT", align: "right", render: (l) => fmtGNF(l.price_unit) },
              { key: "taxes", label: "TVA", render: (l) => l.taxes.map((t) => `${t.amount} %`).join(", ") || "–" },
              { key: "price_subtotal", label: "Total HT", align: "right", render: (l) => fmtGNF(l.price_subtotal) },
            ]}
          />

          <div className="flex flex-wrap justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
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
              <FileButton
                small
                label="Joindre un justificatif"
                accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
                onFile={(file) => {
                  const form = new FormData();
                  form.append("file", file);
                  void act("upload", () => apiUpload(`/finance/moves/${move.id}/attachments`, form));
                }}
              />
            </div>
            <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Total HT</dt>
              <dd className="text-right font-mono">{fmtGNF(move.amount_untaxed)}</dd>
              <dt className="text-muted">TVA</dt>
              <dd className="text-right font-mono">{fmtGNF(move.amount_tax)}</dd>
              <dt className="font-semibold">Total TTC</dt>
              <dd className="text-right font-mono font-semibold">{fmtGNF(move.amount_total)}</dd>
              {move.state === "posted" && move.amount_residual !== null && (
                <>
                  <dt className="text-muted">Reste dû</dt>
                  <dd className="text-right font-mono text-warn">{fmtGNF(move.amount_residual)}</dd>
                </>
              )}
            </dl>
          </div>

          {paying && (
            <div className="grid grid-cols-1 gap-3 rounded-lg bg-panel-2 p-4 md:grid-cols-5">
              <Field label="Compte de trésorerie">
                <Select value={journalId} onChange={(e) => setJournalId(e.target.value)} placeholder="Choisir…" options={(journals ?? []).map((j) => ({ value: j.id, label: j.name }))} />
              </Field>
              <Field label="Mode de paiement">
                <Select value={modeId} onChange={(e) => setModeId(e.target.value)} placeholder="–" options={(modes ?? []).map((m) => ({ value: m.id, label: m.name }))} />
              </Field>
              <Field label="Montant" hint={`Reste : ${fmtGNF(move.amount_residual)}`}>
                <Input inputMode="numeric" className="text-right font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(Math.round(move.amount_residual ?? 0))} />
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
                        payment_mode_id: modeId ? Number(modeId) : undefined,
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
                <Send className="h-4 w-4" /> {achats ? "Soumettre au circuit" : move.move_type.startsWith("in_") ? "Soumettre / valider" : "Valider"}
              </Button>
            )}
            {achat && move.state === "draft" && (
              <Button onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Modifier
              </Button>
            )}
            {achat && move.state === "draft" && (
              <Button
                variant="danger"
                loading={busy === "delete"}
                onClick={() => {
                  if (window.confirm("Supprimer ce brouillon ?")) void remove(move.id);
                }}
              >
                <Trash2 className="h-4 w-4" /> Supprimer le brouillon
              </Button>
            )}
            {!achats && move.can_pay && !paying && (
              <Button onClick={() => setPaying(true)}>
                <Wallet className="h-4 w-4" /> {move.move_type.startsWith("out_") ? "Encaisser" : "Régler"}
              </Button>
            )}
            {move.move_type !== "entry" && (
              <Button onClick={() => apiDownload(`/finance/moves/${move.id}/pdf`, `${move.name ?? "piece"}.pdf`)}>
                <Download className="h-4 w-4" /> PDF
              </Button>
            )}
            {!achats && move.state === "posted" && (
              <Button loading={busy === "reverse"} onClick={() => act("reverse", () => apiSend("POST", `/finance/moves/${move.id}/reverse`, { reason: `Avoir sur ${move.name}` }))}>
                <RotateCcw className="h-4 w-4" /> Avoir / extourne
              </Button>
            )}
            {!achats && move.move_type !== "entry" && move.state !== "cancel" && (
              move.dispute ? (
                <Button loading={busy === "dispute"} onClick={() => act("dispute", () => apiSend("POST", `/finance/moves/${move.id}/dispute`, { dispute: false }))}>
                  Lever le litige
                </Button>
              ) : disputing ? (
                <span className="inline-flex items-center gap-2">
                  <Input className="w-64" placeholder="Motif du litige" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} />
                  <Button loading={busy === "dispute"} disabled={!disputeReason.trim()} onClick={() => act("dispute", () => apiSend("POST", `/finance/moves/${move.id}/dispute`, { dispute: true, reason: disputeReason })).then(() => setDisputing(false))}>
                    Déclarer
                  </Button>
                </span>
              ) : (
                <Button onClick={() => setDisputing(true)}>Déclarer un litige</Button>
              )
            )}
            {!achats && move.state !== "cancel" && (
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
