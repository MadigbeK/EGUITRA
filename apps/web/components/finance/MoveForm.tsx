"use client";

import { Fragment, useMemo, useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Button, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { PartnerPicker } from "./PartnerPicker";
import { AnalyticFields, toDistribution, useAxes, type AxisChoice } from "./AnalyticFields";
import { apiSend, useApi, useSaisieLibre, ApiError } from "@/lib/api-client";
import type { Account, ExpenseCategory, MoveDetail, Partner, Tax } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF } from "@/lib/format";

interface LineDraft {
  name: string;
  quantity: string;
  price_unit: string;
  account_id: string;
  /** Taxe choisie : identifiant, « none » (sans TVA) ou vide (celle de la catégorie ou par défaut). */
  tax_id: string;
  category_id: string;
  axes: AxisChoice;
  /** "" : retenues par défaut du tiers ; "none" : aucune ; sinon identifiant de la retenue. */
  withholding: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): LineDraft => ({ name: "", quantity: "1", price_unit: "", account_id: "", tax_id: "", category_id: "", axes: {}, withholding: "" });

/**
 * Saisie d'une facture de vente ou d'une pièce d'achat ; contreparties, TVA et échéance sont déduites.
 * Une pièce d'achat se saisit par catégorie de dépense (compte, TVA et compte de tiers en découlent).
 * Le choix du compte d'une ligne n'apparaît qu'avec le droit « Saisie libre des comptes ».
 * Chaque ligne s'impute sur les axes de la société de travail (activité, centre de coût et axes des
 * métiers) ; les axes laissés vides suivent les imputations automatiques.
 */
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
  // Sans le droit « Saisie libre des comptes », le compte n'est pas choisi : il découle de la catégorie
  // (achats), de l'activité ou du compte par défaut (ventes).
  const libre = useSaisieLibre(open);
  const { data: accounts } = useApi<Account[]>(open ? `/finance/accounts?prefix=${sale ? "7" : "6"}&limit=2000` : null);
  const { data: categories } = useApi<ExpenseCategory[]>(open && !sale ? "/finance/expense-categories" : null);
  const { data: axes } = useAxes(open);
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const { data: allTaxes } = useApi<Tax[]>(open ? `/finance/taxes?use=${sale ? "sale" : "purchase"}${partner ? `&partner_id=${partner.id}` : ""}` : null);
  // TVA d'un côté, retenues à la source de l'autre (taxes à taux négatif, hors TVA).
  const taxes = useMemo(() => (allTaxes ?? []).filter((t) => t.kind !== "withholding"), [allTaxes]);
  const withholdings = useMemo(() => (allTaxes ?? []).filter((t) => t.kind === "withholding"), [allTaxes]);
  const partnerDefaults = withholdings.filter((t) => t.partner_default);
  const lineWithholdings = (l: LineDraft) =>
    l.withholding === "none" ? [] : l.withholding ? withholdings.filter((t) => String(t.id) === l.withholding) : partnerDefaults;
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [narration, setNarration] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [contractRef, setContractRef] = useState("");
  const [commitmentId, setCommitmentId] = useState("");
  const { data: commitments } = useApi<Array<{ id: number; name: string; object: string; remaining: number }>>(
    open && moveType === "in_invoice" && partner ? `/finance/commitments/for-bill?partner_id=${partner.id}` : null);
  const [dispute, setDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const { data: currencies } = useApi<Array<{ id: number; name: string; inverse_rate: number; date: string | null }>>(open ? "/finance/currencies" : null);
  const currency = currencies?.find((c) => String(c.id) === currencyId);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultTax = taxes?.find((t) => t.amount === 18) ?? taxes?.[0];
  const activities = axes?.find((a) => a.key === "activite")?.accounts ?? [];
  const categoryOf = (l: LineDraft) => categories?.find((c) => String(c.id) === l.category_id);
  const { data: partnerInfo } = useApi<Partner>(open && sale && partner ? `/finance/partners/${partner.id}` : null);
  const exempt = sale && Boolean(partnerInfo?.vat_exempt);

  /** Taxe appliquée : exonération du client non assujetti, sinon celle choisie, celle de la catégorie ou la taxe par défaut. */
  function effectiveTax(l: LineDraft): string {
    if (exempt) return "none";
    if (l.tax_id) return l.tax_id;
    const category = categoryOf(l);
    if (category) return category.tax_mode === "none" ? "none" : String(category.tax?.id ?? defaultTax?.id ?? "none");
    return defaultTax ? String(defaultTax.id) : "none";
  }

  const totals = { ht: 0, tva: 0, retenues: 0, ttc: 0 };
  for (const l of lines) {
    const amount = (Number(l.quantity) || 0) * (Number(l.price_unit.replace(/\s/g, "")) || 0);
    const tax = taxes?.find((t) => String(t.id) === effectiveTax(l));
    totals.ht += amount;
    totals.tva += tax ? (amount * tax.amount) / 100 : 0;
  }
  for (const l of lines) {
    const amount = (Number(l.quantity) || 0) * (Number(l.price_unit.replace(/\s/g, "")) || 0);
    totals.retenues += lineWithholdings(l).reduce((sum, t) => sum + (amount * t.amount) / 100, 0);
  }
  totals.ttc = totals.ht + totals.tva + totals.retenues;

  /** Catégories qui font de la dépense une opération diverse (salaires, cotisations, impôts). */
  const entryCategories = lines.map(categoryOf).filter((c): c is ExpenseCategory => Boolean(c?.entry));
  const mixed = entryCategories.length > 0 && (entryCategories.length !== lines.length || new Set(entryCategories.map((c) => c.partner_account?.id)).size > 1);

  function update(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  /** Invite du compte : le compte de la catégorie, ou sur une vente celui de l'activité choisie. */
  function accountPlaceholder(l: LineDraft) {
    const category = categoryOf(l);
    if (category?.account) return `Compte de la catégorie (${category.account.code})`;
    if (!sale && !libre) return "Selon la catégorie";
    if (sale && l.axes.activite) {
      const income = activities.find((a) => String(a.id) === l.axes.activite)?.income_account_id;
      const account = accounts?.find((a) => a.id === income);
      if (account) return `Compte de l'activité (${account.code})`;
    }
    return "Compte par défaut";
  }

  async function submit(post: boolean) {
    setError(null);
    if (!partner) return setError(sale ? "Choisissez le client." : "Choisissez le fournisseur.");
    if (lines.some((l) => !l.name.trim() || !Number(l.price_unit.replace(/\s/g, "")))) {
      return setError("Chaque ligne doit avoir un libellé et un montant.");
    }
    if (mixed) return setError("Séparez la pièce : une dépense passée en opération diverse ne se mêle pas aux achats.");
    if (!sale && !libre && lines.some((l) => !l.category_id)) return setError("Choisissez la catégorie de dépense de chaque ligne : le compte en découle.");
    if (dispute && !disputeReason.trim()) return setError("Indiquez le motif du litige.");
    setBusy(true);
    try {
      const move = await apiSend<MoveDetail>("POST", "/finance/moves", {
        move_type: moveType,
        partner_id: partner.id,
        invoice_date: invoiceDate,
        invoice_date_due: dueDate || undefined,
        ref: reference || undefined,
        narration: narration || undefined,
        currency_id: currencyId ? Number(currencyId) : undefined,
        contract_ref: contractRef.trim() || undefined,
        commitment_id: commitmentId ? Number(commitmentId) : undefined,
        dispute: dispute || undefined,
        dispute_reason: dispute ? disputeReason.trim() : undefined,
        post,
        lines: lines.map((l) => {
          const tax = effectiveTax(l);
          return {
            name: l.name,
            quantity: Number(l.quantity) || 1,
            price_unit: Number(l.price_unit.replace(/\s/g, "")),
            account_id: libre && l.account_id ? Number(l.account_id) : undefined,
            category_id: l.category_id ? Number(l.category_id) : undefined,
            tax_ids: tax === "none" ? [] : [Number(tax)],
            withholding_tax_ids: l.withholding === "" ? undefined : l.withholding === "none" ? [] : [Number(l.withholding)],
            analytic_distribution: toDistribution(l.axes),
          };
        }),
      });
      onCreated(move);
      setPartner(null);
      setLines([emptyLine()]);
      setReference("");
      setNarration("");
      setContractRef("");
      setDispute(false);
      setDisputeReason("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const title = { out_invoice: "Nouvelle facture de vente", out_refund: "Nouvel avoir client", in_invoice: "Nouvelle pièce d'achat", in_refund: "Nouvel avoir fournisseur" }[moveType];
  const taxOptions = [{ value: "none", label: "Sans TVA" }, ...(taxes ?? []).map((t) => ({ value: t.id, label: t.name || `${t.amount} %` }))];
  const columns = (sale ? 6 : 7) + (withholdings.length > 0 ? 1 : 0);

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
            <Field label="Référence du fournisseur">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de facture du fournisseur" />
            </Field>
          )}
          <Field label="Contrat ou bon de commande" className={sale ? "md:col-span-2" : undefined}>
            <Input value={contractRef} onChange={(e) => setContractRef(e.target.value)} />
          </Field>
          {moveType === "in_invoice" && (commitments?.length ?? 0) > 0 && (
            <Field label="Engagement de dépense" hint="Dans la limite du reste à engager, la pièce ne repasse pas par le circuit d'approbation.">
              <Select value={commitmentId} onChange={(e) => setCommitmentId(e.target.value)} placeholder="Aucun" options={(commitments ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.object} (reste ${fmtDec(c.remaining)})` }))} />
            </Field>
          )}
          <Field label="Devise" hint={currency && currency.name !== "GNF" ? `1 ${currency.name} = ${fmtDec(currency.inverse_rate)} GNF${currency.date ? ` au ${fmtDate(currency.date)}` : ""}` : undefined}>
            <Select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} placeholder="Devise de la société" options={(currencies ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <div className="space-y-1.5 md:col-span-2">
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={dispute} onChange={(e) => setDispute(e.target.checked)} /> Pièce en litige (exclue des relances)
            </label>
            {dispute && <Input value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="Motif du litige" aria-label="Motif du litige" />}
          </div>
        </div>
        {exempt && <Notice tone="accent">Client non assujetti à la TVA : la facture est émise en exonération.</Notice>}
        {entryCategories.length > 0 && !mixed && (
          <Notice tone="accent">
            Catégorie « {entryCategories[0]!.name} » : la dépense est passée en opération diverse, au crédit du compte {entryCategories[0]!.partner_account?.code} (sans TVA).
          </Notice>
        )}

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel-2 text-[12.5px] font-medium text-muted">
              <tr>
                <th scope="col" className="px-2 py-2 text-left">Libellé</th>
                {!sale && <th scope="col" className="w-48 px-2 py-2 text-left">Catégorie</th>}
                <th scope="col" className="w-20 px-2 py-2 text-right">Qté</th>
                <th scope="col" className="w-36 px-2 py-2 text-right">Prix unitaire HT</th>
                <th scope="col" className="w-56 px-2 py-2 text-left">Compte</th>
                <th scope="col" className="w-28 px-2 py-2 text-left">TVA</th>
                {withholdings.length > 0 && <th scope="col" className="w-40 px-2 py-2 text-left">Retenue</th>}
                <th scope="col" className="w-8">
                  <span className="sr-only">Supprimer</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <Fragment key={i}>
                  <tr className="border-t border-line">
                    <td className="px-2 pt-1.5">
                      <Input value={l.name} onChange={(e) => update(i, { name: e.target.value })} placeholder={sale ? "Transport Conakry - Siguiri, 40 000 L" : "Désignation"} aria-label={`Libellé, ligne ${i + 1}`} />
                    </td>
                    {!sale && (
                      <td className="px-2 pt-1.5">
                        <Select value={l.category_id} onChange={(e) => update(i, { category_id: e.target.value, tax_id: "" })} placeholder="Choisir…" options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} aria-label={`Catégorie, ligne ${i + 1}`} />
                      </td>
                    )}
                    <td className="px-2 pt-1.5">
                      <Input className="text-right" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} aria-label={`Quantité, ligne ${i + 1}`} />
                    </td>
                    <td className="px-2 pt-1.5">
                      <Input className="text-right font-mono" inputMode="numeric" value={l.price_unit} onChange={(e) => update(i, { price_unit: e.target.value })} placeholder="0" aria-label={`Prix unitaire HT, ligne ${i + 1}`} />
                    </td>
                    <td className="px-2 pt-1.5">
                      {libre ? (
                        <Select value={l.account_id} onChange={(e) => update(i, { account_id: e.target.value })} placeholder={accountPlaceholder(l)} options={(accounts ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} aria-label={`Compte, ligne ${i + 1}`} />
                      ) : (
                        <span className="block truncate px-1 py-2 text-[12.5px] text-muted" title="Choix du compte : droit « Saisie libre des comptes »">
                          {accountPlaceholder(l)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 pt-1.5">
                      <Select value={effectiveTax(l)} disabled={exempt} onChange={(e) => update(i, { tax_id: e.target.value })} options={taxOptions} aria-label={`TVA, ligne ${i + 1}`} />
                    </td>
                    {withholdings.length > 0 && (
                      <td className="px-2 pt-1.5">
                        <Select
                          value={l.withholding}
                          onChange={(e) => update(i, { withholding: e.target.value })}
                          aria-label={`Retenue, ligne ${i + 1}`}
                          options={[
                            { value: "", label: partnerDefaults.length ? `Du tiers (${partnerDefaults.map((t) => `${Math.abs(t.amount)} %`).join(", ")})` : "Aucune (tiers)" },
                            { value: "none", label: "Aucune" },
                            ...withholdings.map((t) => ({ value: t.id, label: `${t.name} (${Math.abs(t.amount)} %)` })),
                          ]}
                        />
                      </td>
                    )}
                    <td className="px-1 pt-1.5">
                      {lines.length > 1 && (
                        <button type="button" className="text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Supprimer la ligne ${i + 1}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={columns} className="px-2 pb-2 pt-1.5">
                      <AnalyticFields compact axes={axes} value={l.axes} onChange={(next) => update(i, { axes: next })} />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { ...emptyLine(), axes: { ...(ls[ls.length - 1]?.axes ?? {}) } }])}>
            <Plus className="h-4 w-4" /> Ajouter une ligne
          </Button>
          <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Total HT</dt>
            <dd className="text-right font-mono">{fmtGNF(totals.ht, currency?.name ?? "GNF")}</dd>
            <dt className="text-muted">TVA</dt>
            <dd className="text-right font-mono">{fmtGNF(totals.tva, currency?.name ?? "GNF")}</dd>
            {totals.retenues !== 0 && (
              <>
                <dt className="text-muted">Retenues à la source</dt>
                <dd className="text-right font-mono">{fmtGNF(totals.retenues, currency?.name ?? "GNF")}</dd>
              </>
            )}
            <dt className="font-semibold">{totals.retenues !== 0 ? "Net à payer" : "Total TTC"}</dt>
            <dd className="text-right font-mono font-semibold">{fmtGNF(totals.ttc, currency?.name ?? "GNF")}</dd>
          </dl>
        </div>
        <p className="text-xs text-muted">Les axes laissés vides suivent les imputations automatiques de la société (préfixe de compte, tiers).</p>
        <Field label="Note interne">
          <Textarea value={narration} onChange={(e) => setNarration(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
