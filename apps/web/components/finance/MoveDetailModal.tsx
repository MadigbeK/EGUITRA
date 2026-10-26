"use client";

import { useState } from "react";
import { Download, Paperclip, Pencil, RotateCcw, Send, Trash2, Undo2, Wallet, XCircle } from "@/components/icons";
import { Badge, Button, DataTable, ErrorBox, Field, FileButton, Input, Loading, Modal, Notice, Select, cx, demanderConfirmation } from "@/components/ui";
import { AnalyticTags } from "./AnalyticFields";
import { CHAMP_INVALIDE, montantDevise, nombreDevise } from "./communPieces";
import { MoveForm } from "./MoveForm";
import { ApiError, apiDownload, apiSend, apiUpload, useAchatsSeul, useApi } from "@/lib/api-client";
import { MOVE_STATES, PAYMENT_STATES, type Journal, type MoveDetail } from "@/lib/finance-types";
import { AIDE_NOMBRE, fmtDate, fmtGNF, lireNombre, nombreIllisible } from "@/lib/format";

/** Message de la fiche ; ouvrir : pièce créée par l'action (avoir, extourne), à ouvrir d'un clic. */
type Message = { tone: "danger" | "ok" | "accent"; text: string; ouvrir?: { id: number; libelle: string } };

/** Règlement retenu par le circuit d'approbation : comptabilisé et lettré à la dernière approbation. */
interface ReglementEnAttente {
  id: number;
  amount: number;
  currency: string;
  date: string | null;
  journal: { id: number; name: string } | null;
  request_id: number;
  level: number | null;
  pending_with: string | null;
}

/** Fiche de la pièce : règlements en attente d'approbation (null pour le profil Achats seul), état du dernier règlement. */
type Fiche = MoveDetail & { payments_awaiting_approval?: ReglementEnAttente[] | null; payment_status?: "posted" | "submitted" };

/**
 * Fiche d'une pièce : lignes, statut, règlement, impression, pièces jointes, avoir ; un brouillon d'achat se
 * modifie ou se supprime. Le profil Achats seul y joint ses justificatifs, imprime, modifie, supprime ou
 * soumet ses brouillons ; règlement, avoir, litige et annulation relèvent de la finance. onOpen : ouvre une
 * autre pièce dans la fiche (l'avoir ou l'extourne qui vient d'être créé).
 */
export function MoveDetailModal({ moveId, onClose, onChanged, onOpen }: { moveId: number | null; onClose: () => void; onChanged: () => void; onOpen?: (id: number) => void }) {
  const { data: move, error, mutate } = useApi<Fiche>(moveId ? `/finance/moves/${moveId}` : null);
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
  const [message, setMessage] = useState<Message | null>(null);

  /**
   * Action sur la pièce, puis relecture de la fiche. Rend vrai si le noyau l'a acceptée : un panneau
   * (règlement, litige) ne se referme qu'après un succès, sans quoi l'erreur perdrait son contexte.
   */
  async function act<T>(name: string, fn: () => Promise<T>, succes?: (resultat: T) => Message | null): Promise<boolean> {
    setBusy(name);
    setMessage(null);
    try {
      let resultat: T;
      try {
        resultat = await fn();
      } catch (e) {
        setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible : vérifiez la connexion, puis réessayez." });
        return false;
      }
      if (succes) setMessage(succes(resultat));
      onChanged();
      await mutate().catch(() => undefined);
      return true;
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

  // Montant d'un règlement partiel, lu à la française ; vide : tout le reste dû. Une saisie illisible
  // (« 750.000,00 ») ou nulle bloque l'envoi au lieu de partir vide et de régler toute la pièce.
  const montantSaisi = lireNombre(amount);
  const erreurMontant = nombreIllisible(amount) ? AIDE_NOMBRE : montantSaisi !== null && montantSaisi <= 0 ? "Le montant réglé doit être positif." : undefined;

  async function regler(m: MoveDetail) {
    const ok = await act(
      "pay",
      () =>
        apiSend<Fiche>("POST", `/finance/moves/${m.id}/payments`, {
          journal_id: Number(journalId),
          // partial : le noyau refuse un règlement partiel dont le montant manquerait, au lieu de tout régler.
          ...(montantSaisi !== null ? { amount: montantSaisi, partial: true } : {}),
          date: payDate,
          payment_mode_id: modeId ? Number(modeId) : undefined,
        }),
      (r) =>
        r.payment_status === "submitted"
          ? { tone: "accent", text: "Règlement soumis au circuit d'approbation : il n'est ni comptabilisé ni lettré avant la dernière approbation." }
          : { tone: "ok", text: "Règlement enregistré." },
    );
    if (ok) {
      setPaying(false);
      setAmount("");
    }
  }

  /**
   * Annulation : une pièce validée repasse en brouillon (ses règlements sont délettrés) puis est annulée.
   * Le bouton rouge en pied de fiche se lisait comme « fermer » : il demande désormais confirmation.
   */
  async function annuler(m: MoveDetail) {
    const nom = m.name ?? "en brouillon";
    const oui = await demanderConfirmation(
      m.state === "posted"
        ? `Annuler la pièce ${nom} ? Elle repasse en brouillon puis est annulée : ses règlements sont délettrés et elle sort de la comptabilité. Pour corriger une pièce validée, préférez l'avoir.`
        : `Annuler la pièce ${nom} ? Elle ne pourra plus être validée sans être remise en brouillon.`,
      { action: "Annuler la pièce", danger: true },
    );
    if (oui) await act("cancel", () => apiSend("POST", `/finance/moves/${m.id}/cancel`), () => ({ tone: "ok", text: "Pièce annulée." }));
  }

  /** Remise en brouillon d'une pièce annulée : elle redevient modifiable et se valide à nouveau. */
  async function remettreEnBrouillon(m: MoveDetail) {
    const oui = await demanderConfirmation(`Remettre la pièce ${m.name ?? ""} en brouillon ? Elle redevient modifiable et devra être validée à nouveau ; ses anciens lettrages ne reviennent pas.`, {
      action: "Remettre en brouillon",
    });
    if (oui) await act("reset", () => apiSend("POST", `/finance/moves/${m.id}/reset`), () => ({ tone: "ok", text: "Pièce remise en brouillon." }));
  }

  /** Avoir (facture) ou extourne (opération diverse), créé en brouillon : confirmé, puis annoncé avec un lien. */
  async function avoir(m: MoveDetail) {
    const facture = m.move_type !== "entry";
    const oui = await demanderConfirmation(
      facture
        ? `Établir un avoir sur ${m.name} ? L'avoir, créé en brouillon, reprend toutes les lignes de la pièce ; il ne compte qu'une fois validé.`
        : `Extourner l'opération ${m.name} ? L'extourne, créée en brouillon, inverse toutes les lignes ; elle ne compte qu'une fois validée.`,
      { action: facture ? "Établir l'avoir" : "Extourner" },
    );
    if (!oui) return;
    await act(
      "reverse",
      () => apiSend<MoveDetail>("POST", `/finance/moves/${m.id}/reverse`, { reason: `${facture ? "Avoir" : "Extourne"} sur ${m.name}` }),
      (r) => ({
        tone: "ok",
        text: facture ? "Avoir créé en brouillon : vérifiez-le, puis validez-le." : "Extourne créée en brouillon : vérifiez-la, puis validez-la.",
        ouvrir: { id: r.id, libelle: facture ? "Ouvrir l'avoir" : "Ouvrir l'extourne" },
      }),
    );
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
          {message && (
            <Notice tone={message.tone}>
              {message.text}
              {message.ouvrir && onOpen && (
                <button type="button" className="ml-2 font-semibold text-accent underline underline-offset-2" onClick={() => onOpen(message.ouvrir!.id)}>
                  {message.ouvrir.libelle}
                </button>
              )}
            </Notice>
          )}
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
          {(move.payments_awaiting_approval ?? []).map((p) => (
            <Notice key={p.id} tone="warn">
              Règlement de {montantDevise(p.amount, p.currency)} du {fmtDate(p.date)}
              {p.journal ? ` (${p.journal.name})` : ""} en attente d&apos;approbation{p.pending_with ? ` : ${p.pending_with}` : ""}. Il sera comptabilisé et lettré à la
              dernière approbation ; tant que la demande est ouverte, la pièce ne se règle pas une seconde fois.
            </Notice>
          ))}

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
              <Field
                label="Montant"
                hint={montantSaisi === null ? `Vide : tout le reste dû, ${montantDevise(move.amount_residual, move.currency)}` : `Reste dû : ${montantDevise(move.amount_residual, move.currency)}`}
                error={erreurMontant}
              >
                <Input inputMode="decimal" aria-invalid={Boolean(erreurMontant)} className={cx("text-right font-mono", CHAMP_INVALIDE)} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={nombreDevise(move.amount_residual, move.currency)} />
              </Field>
              <Field label="Date" error={payDate ? undefined : "Indiquez la date du règlement."}>
                <Input type="date" required value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button variant="primary" className="w-full" disabled={!journalId || !payDate || Boolean(erreurMontant)} loading={busy === "pay"} onClick={() => void regler(move)}>
                  {montantSaisi !== null ? "Enregistrer le règlement" : move.move_type.startsWith("out_") ? "Encaisser tout le reste dû" : "Régler tout le reste dû"}
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
                  void demanderConfirmation("Supprimer ce brouillon ?", { action: "Supprimer", danger: true }).then((oui) => {
                    if (oui) void remove(move.id);
                  });
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
              <Button loading={busy === "reverse"} onClick={() => void avoir(move)}>
                <RotateCcw className="h-4 w-4" /> {move.move_type === "entry" ? "Extourner" : "Établir un avoir"}
              </Button>
            )}
            {!achats && move.move_type !== "entry" && move.state !== "cancel" && (
              move.dispute ? (
                <Button loading={busy === "dispute"} onClick={() => act("dispute", () => apiSend("POST", `/finance/moves/${move.id}/dispute`, { dispute: false }))}>
                  Lever le litige
                </Button>
              ) : disputing ? (
                <span className="inline-flex items-center gap-2">
                  <Input className="w-64" placeholder="Motif du litige" aria-label="Motif du litige" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} />
                  <Button
                    loading={busy === "dispute"}
                    disabled={!disputeReason.trim()}
                    onClick={() =>
                      void act("dispute", () => apiSend("POST", `/finance/moves/${move.id}/dispute`, { dispute: true, reason: disputeReason })).then((ok) => {
                        if (!ok) return;
                        setDisputing(false);
                        setDisputeReason("");
                      })
                    }
                  >
                    Déclarer
                  </Button>
                </span>
              ) : (
                <Button onClick={() => setDisputing(true)}>Déclarer un litige</Button>
              )
            )}
            {!achats && move.state === "cancel" && (
              <Button loading={busy === "reset"} onClick={() => void remettreEnBrouillon(move)}>
                <Undo2 className="h-4 w-4" /> Remettre en brouillon
              </Button>
            )}
            {!achats && move.state !== "cancel" && (
              <Button variant="danger" loading={busy === "cancel"} onClick={() => void annuler(move)}>
                <XCircle className="h-4 w-4" /> Annuler la pièce
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
