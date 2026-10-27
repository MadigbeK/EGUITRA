"use client";

/**
 * Catalogue des articles et des prestations de la société de travail : unité, prix, comptes, TVA, activité.
 * Lecture par les ventes et les achats ; saisie et import (CSV ou XLSX, au modèle fourni) par
 * l'administration et la finance.
 */

import { useState } from "react";
import { Download, Pencil, Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Modal, Notice, PageHeader, Select } from "@/components/ui";
import { apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { CATALOGUE_ECRITURE, type Article, type CompteC, type Referentiels } from "@/lib/commerce-types";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, fmtDec, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";

export function CataloguePage() {
  const [search, setSearch] = useState("");
  const [inactifs, setInactifs] = useState(false);
  const { data, error, mutate } = useApi<Article[]>(`/commerce/catalogue?${new URLSearchParams({ search, ...(inactifs ? { inactive: "1" } : {}) }).toString()}`);
  const ecriture = useAutorise(CATALOGUE_ECRITURE);
  const envoi = useEnvoi();
  const [edition, setEdition] = useState<Article | "nouveau" | null>(null);
  const [bilan, setBilan] = useState<string | null>(null);
  return (
    <div>
      <PageHeader
        title="Catalogue des articles et prestations"
        subtitle="Propre à la société de travail : unité (m³, m², ml, ens., fft…), prix, compte de produit ou de charge, TVA, activité analytique. Les offres et les bons de commande le reprennent."
        actions={ecriture ? (
          <>
            <Button loading={envoi.busy === "modele"} disabled={!!envoi.busy} onClick={() => void envoi.telecharger("modele", "/commerce/catalogue/import-template", "modele-catalogue.xlsx")}><Download className="h-4 w-4" /> Modèle d&apos;import</Button>
            <FileButton label="Importer un fichier" accept=".csv,.xlsx" onFile={(file) => {
              const form = new FormData();
              form.append("file", file);
              setBilan(null);
              void envoi.run("import", async () => {
                const r = await apiUpload<{ created: number; updated: number }>("/commerce/catalogue/import", form);
                setBilan(`${r.created} article${r.created > 1 ? "s" : ""} créé${r.created > 1 ? "s" : ""}, ${r.updated} mis à jour.`);
              }).then((ok) => { if (ok) void mutate(); });
            }} />
            <Button variant="primary" onClick={() => setEdition("nouveau")}><Plus className="h-4 w-4" /> Nouvel article</Button>
          </>
        ) : undefined}
      />
      {envoi.message && <div className="mb-3"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
      {bilan && <div className="mb-3"><Notice tone="ok">Import terminé : {bilan}</Notice></div>}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Input aria-label="Rechercher un article" className="max-w-xs" placeholder="Nom ou référence…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={inactifs} onChange={(e) => setInactifs(e.target.checked)} /> Afficher les articles retirés</label>
        </div>
        <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement du catalogue…">
          {(rows) => (
            <DataTable rows={rows} rowKey={(a) => a.id} onRowClick={ecriture ? (a) => setEdition(a) : undefined} empty="Catalogue vide : créez un article ou importez le modèle rempli." columns={[
              { key: "name", label: "Article", render: (a) => <div className="min-w-[200px]">{a.name}{a.code && <div className="font-mono text-[11.5px] text-muted">{a.code}</div>}</div> },
              { key: "kind", label: "Type", render: (a) => (a.kind === "service" ? "Prestation" : "Article") },
              { key: "uom", label: "Unité", render: (a) => a.uom.name },
              { key: "list_price", label: "Prix de vente HT", align: "right", render: (a) => (a.sale_ok ? fmtInt(a.list_price) : "–") },
              { key: "standard_price", label: "Prix d'achat HT", align: "right", render: (a) => (a.purchase_ok ? fmtInt(a.standard_price) : "–") },
              { key: "taxes", label: "TVA", render: (a) => [...a.sale_taxes, ...a.purchase_taxes].map((t) => t.name).filter((v, i, s) => s.indexOf(v) === i).join(", ") || "Sans TVA" },
              { key: "activity", label: "Activité", render: (a) => a.activity?.name ?? "–" },
              { key: "usage", label: "Usage", render: (a) => <div className="flex gap-1">{a.sale_ok && <Badge tone="accent">Vente</Badge>}{a.purchase_ok && <Badge>Achat</Badge>}{!a.active && <Badge tone="warn">Retiré</Badge>}</div> },
            ]} />
          )}
        </Etat>
      </Card>
      {edition && <FormArticle article={edition === "nouveau" ? undefined : edition} onClose={() => setEdition(null)} onDone={() => { setEdition(null); void mutate(); }} />}
    </div>
  );
}

function FormArticle({ article, onClose, onDone }: { article?: Article; onClose: () => void; onDone: () => void }) {
  const { data: refs } = useApi<Referentiels>("/commerce/referentials");
  const { data: produits } = useApi<CompteC[]>("/finance/accounts?prefix=7&limit=2000");
  const { data: charges } = useApi<CompteC[]>("/finance/accounts?prefix=6&limit=2000");
  const envoi = useEnvoi();
  const [f, setF] = useState({
    name: article?.name ?? "", code: article?.code ?? "", kind: article?.kind ?? "service", uom_id: article ? String(article.uom.id) : "",
    list_price: article ? fmtDec(article.list_price) : "", standard_price: article ? fmtDec(article.standard_price) : "",
    sale_ok: article?.sale_ok ?? true, purchase_ok: article?.purchase_ok ?? false,
    sale_tax: article ? (article.sale_taxes[0] ? String(article.sale_taxes[0].id) : "none") : "",
    purchase_tax: article ? (article.purchase_taxes[0] ? String(article.purchase_taxes[0].id) : "none") : "",
    activity_id: article?.activity ? String(article.activity.id) : "",
    income_account_id: article?.income_account ? String(article.income_account.id) : "",
    expense_account_id: article?.expense_account ? String(article.expense_account.id) : "",
    active: article?.active ?? true,
  });
  const illisible = nombreIllisible(f.list_price) || nombreIllisible(f.standard_price);
  async function enregistrer() {
    const body: Record<string, unknown> = {
      name: f.name, code: f.code, kind: f.kind, list_price: lireNombre(f.list_price) ?? 0, standard_price: lireNombre(f.standard_price) ?? 0,
      sale_ok: f.sale_ok, purchase_ok: f.purchase_ok, activity_id: f.activity_id ? Number(f.activity_id) : null,
      income_account_id: f.income_account_id ? Number(f.income_account_id) : null,
      expense_account_id: f.expense_account_id ? Number(f.expense_account_id) : null,
    };
    if (f.uom_id) body.uom_id = Number(f.uom_id);
    if (f.sale_tax) body.sale_tax_ids = f.sale_tax === "none" ? [] : [Number(f.sale_tax)];
    if (f.purchase_tax) body.purchase_tax_ids = f.purchase_tax === "none" ? [] : [Number(f.purchase_tax)];
    if (article) body.active = f.active;
    if (await envoi.run("enregistrer", () => (article ? apiSend("PATCH", `/commerce/catalogue/${article.id}`, body) : apiSend("POST", "/commerce/catalogue", body)), undefined, "Enregistrement impossible.")) onDone();
  }
  return (
    <Modal open wide title={article ? `Modifier ${article.name}` : "Nouvel article du catalogue"} onClose={onClose} footer={
      <Button variant="primary" loading={!!envoi.busy} disabled={!f.name.trim() || illisible || !!envoi.busy} onClick={() => void enregistrer()}>Enregistrer</Button>
    }>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {envoi.message && <div className="md:col-span-3"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
        <Field label="Nom" className="md:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Location de camion-benne (jour), lot de terrassement…" /></Field>
        <Field label="Référence"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "service" | "article" })} options={[{ value: "service", label: "Prestation" }, { value: "article", label: "Article (fourniture)" }]} /></Field>
        <Field label="Unité"><Select value={f.uom_id} placeholder="Unité" onChange={(e) => setF({ ...f, uom_id: e.target.value })} options={(refs?.uoms ?? []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
        <Field label="Activité analytique"><Select value={f.activity_id} placeholder="Aucune" onChange={(e) => setF({ ...f, activity_id: e.target.value })} options={(refs?.activities ?? []).map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <div className="md:col-span-3 flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.sale_ok} onChange={(e) => setF({ ...f, sale_ok: e.target.checked })} /> Vendu</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.purchase_ok} onChange={(e) => setF({ ...f, purchase_ok: e.target.checked })} /> Acheté</label>
          {article && <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Proposé dans les saisies</label>}
        </div>
        {f.sale_ok && (
          <>
            <Field label="Prix de vente HT (GNF)" error={nombreIllisible(f.list_price) ? AIDE_NOMBRE : undefined}><Input inputMode="decimal" value={f.list_price} onChange={(e) => setF({ ...f, list_price: e.target.value })} /></Field>
            <Field label="TVA de vente"><Select value={f.sale_tax} placeholder="TVA par défaut de la société" onChange={(e) => setF({ ...f, sale_tax: e.target.value })} options={[{ value: "none", label: "Sans TVA" }, ...(refs?.sale_taxes ?? []).map((t) => ({ value: t.id, label: t.name }))]} /></Field>
            <Field label="Compte de produit"><Select value={f.income_account_id} placeholder="Compte de la catégorie d'article" onChange={(e) => setF({ ...f, income_account_id: e.target.value })} options={(produits ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>
          </>
        )}
        {f.purchase_ok && (
          <>
            <Field label="Prix d'achat HT (GNF)" error={nombreIllisible(f.standard_price) ? AIDE_NOMBRE : undefined}><Input inputMode="decimal" value={f.standard_price} onChange={(e) => setF({ ...f, standard_price: e.target.value })} /></Field>
            <Field label="TVA d'achat"><Select value={f.purchase_tax} placeholder="TVA par défaut de la société" onChange={(e) => setF({ ...f, purchase_tax: e.target.value })} options={[{ value: "none", label: "Sans TVA" }, ...(refs?.purchase_taxes ?? []).map((t) => ({ value: t.id, label: t.name }))]} /></Field>
            <Field label="Compte de charge"><Select value={f.expense_account_id} placeholder="Compte de la catégorie d'article" onChange={(e) => setF({ ...f, expense_account_id: e.target.value })} options={(charges ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}
