"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Button, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { PartnerPicker } from "./PartnerPicker";
import { apiSend, useApi, ApiError } from "@/lib/api-client";
import type { Account, MoveDetail, Tax } from "@/lib/finance-types";
import { fmtGNF } from "@/lib/format";

interface LineDraft {
  name: string;
  quantity: string;
  price_unit: string;
  account_id: string;
  tax_id: string;
  activity_id: string;
  /** "" : retenues par défaut du tiers ; "none" : aucune ; sinon identifiant de la retenue. */
  withholding: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): LineDraft => ({ name: "", quantity: "1", price_unit: "", account_id: "", tax_id: "", activity_id: "", withholding: "" });

/** Saisie d'une facture de vente ou d'une pièce d'achat ; contreparties, TVA et échéance sont déduites. */
export function MoveForm({
  open,
  onClose,
  onCreated,
  moveType,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (move: MoveDetail) => void;
  moveType: "out_invoice" | "out_refund" | "in_invoice" | "in_refund";
}) {
  const sale = moveType.startsWith("out_");
  const { data: accounts } = useApi<Account[]>(open ? `/finance/accounts?prefix=${sale ? "7" : "6"}&limit=2000` : null);
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const { data: allTaxes } = useApi<Tax[]>(open ? `/finance/taxes?use=${sale ? "sale" : "purchase"}${partner ? `&partner_id=${partner.id}` : ""}` : null);
  const { data: activities } = useApi<Array<{ id: number; name: string }>>(open ? "/finance/analytic-accounts?plan=activite" : null);
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // TVA d'un côté, retenues à la source de l'autre (taxes à taux négatif, hors TVA).
  const taxes = useMemo(() => (allTaxes ?? []).filter((t) => t.kind !== "withholding"), [allTaxes]);
  const withholdings = useMemo(() => (allTaxes ?? []).filter((t) => t.kind === "withholding"), [allTaxes]);
  const partnerDefaults = withholdings.filter((t) => t.partner_default);
  const defaultTax = taxes.find((t) => t.amount === 18) ?? taxes[0];
  const lineWithholdings = (l: LineDraft) =>
    l.withholding === "none" ? [] : l.withholding ? withholdings.filter((t) => String(t.id) === l.withholding) : partnerDefaults;
  const totals = (() => {
    let ht = 0;
    let tva = 0;
    let retenues = 0;
    for (const l of lines) {
      const amount = (Number(l.quantity) || 0) * (Number(l.price_unit.replace(/\s/g, "")) || 0);
      ht += amount;
      const tax = taxes.find((t) => String(t.id) === (l.tax_id || String(defaultTax?.id ?? "")));
      tva += tax ? (amount * tax.amount) / 100 : 0;
      retenues += lineWithholdings(l).reduce((sum, t) => sum + (amount * t.amount) / 100, 0);
    }
    return { ht, tva, retenues, ttc: ht + tva + retenues };
  })();

  function update(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit(post: boolean) {
    setError(null);
    if (!partner) return setError(sale ? "Choisissez le client." : "Choisissez le fournisseur.");
    if (lines.some((l) => !l.name.trim() || !Number(l.price_unit.replace(/\s/g, "")))) {
      return setError("Chaque ligne doit avoir un libellé et un montant.");
    }
    setBusy(true);
    try {
      const move = await apiSend<MoveDetail>("POST", "/finance/moves", {
        move_type: moveType,
        partner_id: partner.id,
        invoice_date: invoiceDate,
        invoice_date_due: dueDate || undefined,
        ref: reference || undefined,
        narration: narration || undefined,
        post,
        lines: lines.map((l) => ({
          name: l.name,
          quantity: Number(l.quantity) || 1,
          price_unit: Number(l.price_unit.replace(/\s/g, "")),
          account_id: l.account_id ? Number(l.account_id) : undefined,
          tax_ids: [Number(l.tax_id || defaultTax?.id)].filter(Boolean),
          withholding_tax_ids: l.withholding === "" ? undefined : l.withholding === "none" ? [] : [Number(l.withholding)],
          analytic_distribution: l.activity_id ? { [l.activity_id]: 100 } : undefined,
        })),
      });
      onCreated(move);
      setPartner(null);
      setLines([emptyLine()]);
      setReference("");
      setNarration("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const title = { out_invoice: "Nouvelle facture de vente", out_refund: "Nouvel avoir client", in_invoice: "Nouvelle pièce d'achat", in_refund: "Nouvel avoir fournisseur" }[moveType];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => submit(false)} loading={busy}>
            Enregistrer en brouillon
          </Button>
          <Button variant="primary" onClick={() => submit(true)} loading={busy}>
            {sale ? "Enregistrer et valider" : "Enregistrer et soumettre"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label={sale ? "Client" : "Fournisseur"} className="md:col-span-2">
            <PartnerPicker value={partner} onChange={setPartner} kind={sale ? "customer" : "supplier"} />
          </Field>
          <Field label="Date de la pièce">
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
          <Field label="Échéance" hint="Vide : selon les conditions du tiers">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          {!sale && (
            <Field label="Référence du fournisseur" className="md:col-span-2">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de facture du fournisseur" />
            </Field>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel-2 text-[12.5px] font-medium text-muted">
              <tr>
                <th className="px-2 py-2 text-left">Libellé</th>
                <th className="w-20 px-2 py-2 text-right">Qté</th>
                <th className="w-36 px-2 py-2 text-right">Prix unitaire HT</th>
                <th className="w-48 px-2 py-2 text-left">Compte</th>
                <th className="w-28 px-2 py-2 text-left">TVA</th>
                <th className="w-40 px-2 py-2 text-left">Activité</th>
                {withholdings.length > 0 && <th className="w-40 px-2 py-2 text-left">Retenue</th>}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    <Input value={l.name} onChange={(e) => update(i, { name: e.target.value })} placeholder={sale ? "Transport Conakry - Siguiri, 40 000 L" : "Désignation"} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="text-right" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="text-right font-mono" inputMode="numeric" value={l.price_unit} onChange={(e) => update(i, { price_unit: e.target.value })} placeholder="0" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Select value={l.account_id} onChange={(e) => update(i, { account_id: e.target.value })} placeholder="Compte par défaut" options={(accounts ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Select value={l.tax_id || String(defaultTax?.id ?? "")} onChange={(e) => update(i, { tax_id: e.target.value })} options={taxes.map((t) => ({ value: t.id, label: t.name || `${t.amount} %` }))} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Select value={l.activity_id} onChange={(e) => update(i, { activity_id: e.target.value })} placeholder="–" options={(activities ?? []).map((a) => ({ value: a.id, label: a.name }))} />
                  </td>
                  {withholdings.length > 0 && (
                    <td className="px-2 py-1.5">
                      <Select
                        value={l.withholding}
                        onChange={(e) => update(i, { withholding: e.target.value })}
                        options={[
                          { value: "", label: partnerDefaults.length ? `Du tiers (${partnerDefaults.map((t) => `${Math.abs(t.amount)} %`).join(", ")})` : "Aucune (tiers)" },
                          { value: "none", label: "Aucune" },
                          ...withholdings.map((t) => ({ value: t.id, label: `${t.name} (${Math.abs(t.amount)} %)` })),
                        ]}
                      />
                    </td>
                  )}
                  <td className="px-1">
                    {lines.length > 1 && (
                      <button type="button" className="text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Supprimer la ligne">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Button variant="ghost" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            <Plus className="h-4 w-4" /> Ajouter une ligne
          </Button>
          <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Total HT</dt>
            <dd className="text-right font-mono">{fmtGNF(totals.ht)}</dd>
            <dt className="text-muted">TVA</dt>
            <dd className="text-right font-mono">{fmtGNF(totals.tva)}</dd>
            {totals.retenues !== 0 && (
              <>
                <dt className="text-muted">Retenues à la source</dt>
                <dd className="text-right font-mono">{fmtGNF(totals.retenues)}</dd>
              </>
            )}
            <dt className="font-semibold">{totals.retenues !== 0 ? "Net à payer" : "Total TTC"}</dt>
            <dd className="text-right font-mono font-semibold">{fmtGNF(totals.ttc)}</dd>
          </dl>
        </div>
        <Field label="Note interne">
          <Textarea value={narration} onChange={(e) => setNarration(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
