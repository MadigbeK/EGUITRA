"use client";

/**
 * Lignes d'une offre ou d'un bon de commande : rubriques (I, II… sur le document, avec leur sous-total),
 * notes, lignes d'un article du catalogue ou libres. Une ligne libre d'un bon de commande se saisit par
 * catégorie de dépense, qui en fixe le compte et la TVA (jamais le choix du compte hors de la finance).
 */

import { Plus, Trash2 } from "@/components/icons";
import { Button, Input, Select } from "@/components/ui";
import type { Article, LigneDoc, Referentiels } from "@/lib/commerce-types";
import { AIDE_NOMBRE, fmtDec, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";

export interface LigneSaisie {
  cle: string;
  display_type: "product" | "line_section" | "line_note";
  name: string;
  product_id: string;
  quantity: string;
  uom_id: string;
  price_unit: string;
  discount: string;
  /** "" : taxe de l'article, de la catégorie ou de la société ; "none" : aucune ; sinon l'identifiant. */
  tax: string;
  category_id: string;
}

let compteur = 0;
export function nouvelleLigne(display_type: LigneSaisie["display_type"] = "product"): LigneSaisie {
  compteur += 1;
  return { cle: `l${compteur}`, display_type, name: "", product_id: "", quantity: "1", uom_id: "", price_unit: "", discount: "", tax: "", category_id: "" };
}

/** Lignes d'un document existant, pour sa modification. */
export function lignesDe(lignes: LigneDoc[] | undefined, kind: "sale" | "purchase"): LigneSaisie[] {
  return (lignes ?? [])
    .filter((l) => !l.is_downpayment)
    .map((l) => ({
      ...nouvelleLigne(l.display_type === "line_section" || l.display_type === "line_note" ? l.display_type : "product"),
      name: l.name,
      product_id: l.product?.catalogue ? String(l.product.id) : "",
      quantity: fmtDec(l.quantity),
      uom_id: l.uom ? String(l.uom.id) : "",
      price_unit: fmtDec(l.price_unit),
      discount: l.discount ? fmtDec(l.discount) : "",
      tax: l.display_type === "product" ? (l.taxes[0] ? String(l.taxes[0].id) : "none") : "",
      category_id: kind === "purchase" && l.category ? String(l.category.id) : "",
    }));
}

/** Corps des lignes envoyé au noyau ; null si une valeur est illisible. */
export function corpsLignes(lignes: LigneSaisie[], kind: "sale" | "purchase"): Array<Record<string, unknown>> | null {
  const corps: Array<Record<string, unknown>> = [];
  for (const l of lignes) {
    if (!l.name.trim()) continue;
    if (l.display_type !== "product") {
      corps.push({ display_type: l.display_type, name: l.name.trim() });
      continue;
    }
    if ([l.quantity, l.price_unit, l.discount].some((v) => v && nombreIllisible(v))) return null;
    const ligne: Record<string, unknown> = { name: l.name.trim(), quantity: lireNombre(l.quantity) ?? 1 };
    if (l.price_unit.trim()) ligne.price_unit = lireNombre(l.price_unit);
    if (l.discount.trim()) ligne.discount = lireNombre(l.discount);
    if (l.product_id) ligne.product_id = Number(l.product_id);
    if (l.uom_id) ligne.uom_id = Number(l.uom_id);
    if (l.tax === "none") ligne.tax_ids = [];
    else if (l.tax) ligne.tax_ids = [Number(l.tax)];
    if (kind === "purchase" && l.category_id) ligne.category_id = Number(l.category_id);
    corps.push(ligne);
  }
  return corps;
}

/** Total hors taxes indicatif : la remise de la ligne, à défaut la remise générale de l'offre. */
export function totalHt(lignes: LigneSaisie[], remiseGenerale = ""): number {
  const generale = lireNombre(remiseGenerale) ?? 0;
  return lignes
    .filter((l) => l.display_type === "product")
    .reduce((s, l) => s + (lireNombre(l.quantity) ?? 0) * (lireNombre(l.price_unit) ?? 0) * (1 - (lireNombre(l.discount) ?? generale) / 100), 0);
}

export function LignesSaisie({ kind, lignes, onChange, refs, catalogue, remiseGenerale }: {
  kind: "sale" | "purchase";
  lignes: LigneSaisie[];
  onChange: (l: LigneSaisie[]) => void;
  refs?: Referentiels;
  catalogue?: Article[];
  remiseGenerale?: string;
}) {
  const taxes = kind === "sale" ? refs?.sale_taxes ?? [] : refs?.purchase_taxes ?? [];
  const articles = (catalogue ?? []).filter((a) => a.active && (kind === "sale" ? a.sale_ok : a.purchase_ok));
  const maj = (cle: string, patch: Partial<LigneSaisie>) => onChange(lignes.map((l) => (l.cle === cle ? { ...l, ...patch } : l)));
  const choisirArticle = (l: LigneSaisie, id: string) => {
    const a = articles.find((x) => String(x.id) === id);
    if (!a) return maj(l.cle, { product_id: "" });
    maj(l.cle, {
      product_id: id, name: l.name.trim() ? l.name : a.name, uom_id: String(a.uom.id), category_id: "",
      price_unit: fmtDec(kind === "sale" ? a.list_price : a.standard_price),
    });
  };
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="py-1 pr-2">Article</th>
              <th className="py-1 pr-2">Désignation</th>
              <th className="py-1 pr-2 text-right">Quantité</th>
              <th className="py-1 pr-2">Unité</th>
              <th className="py-1 pr-2 text-right">PU HT</th>
              {kind === "sale" && <th className="py-1 pr-2 text-right">Remise %</th>}
              {kind === "purchase" && <th className="py-1 pr-2">Catégorie de dépense</th>}
              <th className="py-1 pr-2">TVA</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) =>
              l.display_type !== "product" ? (
                <tr key={l.cle}>
                  <td className="py-1 pr-2 text-[12px] font-semibold text-muted">{l.display_type === "line_section" ? "Rubrique" : "Note"}</td>
                  <td colSpan={6} className="py-1 pr-2">
                    <Input aria-label={l.display_type === "line_section" ? "Titre de la rubrique" : "Texte de la note"} value={l.name} onChange={(e) => maj(l.cle, { name: e.target.value })} placeholder={l.display_type === "line_section" ? "Gros œuvre, terrassements…" : "Précision imprimée sur le document"} />
                  </td>
                  <td className="py-1 text-right"><Button size="sm" variant="ghost" aria-label="Retirer" onClick={() => onChange(lignes.filter((x) => x.cle !== l.cle))}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ) : (
                <tr key={l.cle} className="align-top">
                  <td className="py-1 pr-2 min-w-[160px]">
                    <Select aria-label="Article du catalogue" value={l.product_id} placeholder="Ligne libre" onChange={(e) => choisirArticle(l, e.target.value)} options={articles.map((a) => ({ value: a.id, label: a.code ? `${a.code} · ${a.name}` : a.name }))} />
                  </td>
                  <td className="py-1 pr-2 min-w-[200px]"><Input aria-label="Désignation" value={l.name} onChange={(e) => maj(l.cle, { name: e.target.value })} /></td>
                  <td className="py-1 pr-2 w-24"><Input aria-label="Quantité" inputMode="decimal" className="text-right font-mono" value={l.quantity} aria-invalid={nombreIllisible(l.quantity)} title={nombreIllisible(l.quantity) ? AIDE_NOMBRE : undefined} onChange={(e) => maj(l.cle, { quantity: e.target.value })} /></td>
                  <td className="py-1 pr-2 w-28"><Select aria-label="Unité" value={l.uom_id} placeholder="Unité" onChange={(e) => maj(l.cle, { uom_id: e.target.value })} options={(refs?.uoms ?? []).map((u) => ({ value: u.id, label: u.name }))} /></td>
                  <td className="py-1 pr-2 w-32"><Input aria-label="Prix unitaire hors taxes" inputMode="decimal" className="text-right font-mono" value={l.price_unit} aria-invalid={nombreIllisible(l.price_unit)} onChange={(e) => maj(l.cle, { price_unit: e.target.value })} /></td>
                  {kind === "sale" && <td className="py-1 pr-2 w-20"><Input aria-label="Remise en pourcentage" inputMode="decimal" className="text-right font-mono" value={l.discount} placeholder={remiseGenerale || "0"} onChange={(e) => maj(l.cle, { discount: e.target.value })} /></td>}
                  {kind === "purchase" && (
                    <td className="py-1 pr-2 min-w-[170px]">
                      {l.product_id ? <span className="text-[12px] text-muted">Compte de l&apos;article</span> : (
                        <Select aria-label="Catégorie de dépense" value={l.category_id} placeholder="Choisir…" onChange={(e) => maj(l.cle, { category_id: e.target.value })} options={(refs?.categories ?? []).filter((c) => !c.entry).map((c) => ({ value: c.id, label: c.name }))} />
                      )}
                    </td>
                  )}
                  <td className="py-1 pr-2 w-32"><Select aria-label="TVA" value={l.tax} placeholder="Par défaut" onChange={(e) => maj(l.cle, { tax: e.target.value })} options={[{ value: "none", label: "Sans TVA" }, ...taxes.map((t) => ({ value: t.id, label: t.name }))]} /></td>
                  <td className="py-1 text-right"><Button size="sm" variant="ghost" aria-label="Retirer la ligne" onClick={() => onChange(lignes.filter((x) => x.cle !== l.cle))}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onChange([...lignes, nouvelleLigne()])}><Plus className="h-4 w-4" /> Ligne</Button>
          <Button size="sm" onClick={() => onChange([...lignes, nouvelleLigne("line_section")])}><Plus className="h-4 w-4" /> Rubrique</Button>
          <Button size="sm" onClick={() => onChange([...lignes, nouvelleLigne("line_note")])}><Plus className="h-4 w-4" /> Note</Button>
        </div>
        <span className="text-sm text-muted">Total HT indicatif : <b className="font-mono text-ink">{fmtInt(totalHt(lignes, remiseGenerale))} GNF</b></span>
      </div>
    </div>
  );
}
