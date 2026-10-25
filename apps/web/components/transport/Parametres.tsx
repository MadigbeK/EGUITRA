"use client";

import { useState } from "react";
import { Button, Card, DataTable, Etat, Field, Input, Modal, Notice, Select, Tag } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDec, fmtInt } from "@/lib/format";
import { INSECABLE } from "./commun";
import { SHORTAGE_RULES, parseNumber, type AccountRef, type ClientTerms, type Message, type Product, type Ref, type ShortageRule, type TransportSettings } from "./types";

/** Envoi d'une modification avec message de retour ; renvoie vrai si elle a réussi. */
function useSend(onDone: () => void) {
  const [message, setMessage] = useState<Message>(null);
  async function send(method: "POST" | "PATCH", path: string, body: Record<string, unknown>, ok: string) {
    setMessage(null);
    try {
      await apiSend(method, path, body);
      setMessage({ tone: "ok", text: ok });
      onDone();
      return true;
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
      return false;
    }
  }
  return { message, send };
}

/** Paramétrage du transport : manquants, conditions des clients, produits transportés. */
export function Parametres() {
  const { data: settings, error, mutate } = useApi<TransportSettings>("/transport/settings");
  if (!settings) return <Etat error={error} onRetry={() => mutate()} />;
  return (
    <div className="space-y-6">
      {!settings.can_edit && <Notice tone="neutral">Paramètres tenus par la finance : consultation seulement.</Notice>}
      <Manquants settings={settings} onSaved={() => void mutate()} />
      <RelevesProprietaires settings={settings} onSaved={() => void mutate()} />
      <ConditionsClients canEdit={settings.can_edit} />
      <BaremeTaxes canEdit={settings.can_edit} />
      <Produits canEdit={settings.can_edit} />
    </div>
  );
}

interface TaxRule {
  id: number;
  name: string;
  nature: string;
  base: "delivered" | "loaded" | "revenue" | "fixed";
  rate: number;
  products: Ref[];
  routes: Ref[];
  account: AccountRef | null;
  income_account: AccountRef | null;
  rebillable: boolean;
  rebill_vat: boolean;
  date_from: string | null;
  date_to: string | null;
  active: boolean;
}
interface Choice { code: string; label: string }

const RATE_UNIT: Record<TaxRule["base"], string> = { delivered: "GNF par m³", loaded: "GNF par m³", revenue: "% du montant", fixed: "GNF par rotation" };

/** Barème des taxes spécifiques : chaque taxe applicable devient une ligne des rotations. */
function BaremeTaxes({ canEdit }: { canEdit: boolean }) {
  const { data, error, mutate } = useApi<{ taxes: TaxRule[]; natures: Choice[]; bases: Choice[] }>("/transport/taxes");
  const [editing, setEditing] = useState<TaxRule | "new" | null>(null);
  const { message, send } = useSend(() => void mutate());
  const label = (list: Choice[] | undefined, code: string) => list?.find((c) => c.code === code)?.label ?? code;
  return (
    <Card title="Barème des taxes spécifiques" padded={false} actions={canEdit ? <Button variant="primary" onClick={() => setEditing("new")}>Nouvelle taxe</Button> : undefined}>
      {message && <div className="p-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      <p className="px-5 pt-4 text-[13px] text-muted">
        Calculées sur chaque rotation saisie ou validée (une rotation facturée garde les siennes). Une taxe refacturée s&apos;ajoute à la facture du
        client. Les taxes payées hors barème se saisissent sur la rotation (« Autres taxes payées »).
      </p>
      {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
        <DataTable rows={data.taxes} rowKey={(t) => t.id} empty="Aucune taxe au barème." onRowClick={canEdit ? (t) => setEditing(t) : undefined} columns={[
          { key: "name", label: "Taxe", render: (t) => <span className={t.active ? "" : "text-muted line-through"}>{t.name}</span> },
          { key: "nature", label: "Nature", render: (t) => label(data.natures, t.nature) },
          { key: "rate", label: "Taux", align: "right", render: (t) => `${t.base === "revenue" ? fmtDec(t.rate) : fmtInt(t.rate)}${INSECABLE}${RATE_UNIT[t.base]}` },
          { key: "scope", label: "Portée", render: (t) => [t.products.map((p) => p.name).join(", ") || "Tous produits", t.routes.map((r) => r.name).join(", ") || "toutes routes"].join(" ; ") },
          { key: "period", label: "Période", render: (t) => (t.date_from || t.date_to ? `${t.date_from ? fmtDate(t.date_from) : "…"} – ${t.date_to ? fmtDate(t.date_to) : "…"}` : "Permanente") },
          { key: "account", label: "Compte", render: (t) => t.account?.code ?? "–" },
          { key: "rebillable", label: "Refacturée", render: (t) => (t.rebillable ? <Tag>{t.rebill_vat ? "Oui, avec TVA" : "Oui"}</Tag> : "Non") },
        ]} />
      )}
      {editing && data && (
        <TaxForm tax={editing === "new" ? null : editing} natures={data.natures} bases={data.bases} onClose={() => setEditing(null)}
          onSave={async (body) => {
            const ok = editing === "new" ? await send("POST", "/transport/taxes", body, "Taxe ajoutée au barème.") : await send("PATCH", `/transport/taxes/${editing.id}`, body, "Taxe modifiée.");
            if (ok) setEditing(null);
          }} />
      )}
    </Card>
  );
}

function TaxForm({ tax, natures, bases, onClose, onSave }: { tax: TaxRule | null; natures: Choice[]; bases: Choice[]; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const { data: products } = useApi<Product[]>("/transport/products");
  const { data: routes } = useApi<Ref[]>("/transport/routes");
  const { data: charges } = useApi<AccountRef[]>("/finance/accounts?prefix=6&limit=2000");
  const { data: incomes } = useApi<AccountRef[]>("/finance/accounts?prefix=7&limit=2000");
  const [f, setF] = useState({
    name: tax?.name ?? "", nature: tax?.nature ?? "road", base: tax?.base ?? "delivered", rate: tax ? String(tax.rate).replace(".", ",") : "",
    product_ids: tax?.products.map((p) => p.id) ?? [], route_ids: tax?.routes.map((r) => r.id) ?? [],
    account_id: tax?.account?.id ? String(tax.account.id) : "", income_account_id: tax?.income_account?.id ? String(tax.income_account.id) : "",
    rebillable: tax?.rebillable ?? false, rebill_vat: tax?.rebill_vat ?? false, date_from: tax?.date_from ?? "", date_to: tax?.date_to ?? "", active: tax?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const toggle = (key: "product_ids" | "route_ids", id: number) => setF({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] });
  async function save() {
    setBusy(true);
    await onSave({
      ...f, rate: parseNumber(f.rate) ?? 0, account_id: f.account_id ? Number(f.account_id) : null,
      income_account_id: f.income_account_id ? Number(f.income_account_id) : null, date_from: f.date_from || null, date_to: f.date_to || null,
    });
    setBusy(false);
  }
  return (
    <Modal open wide title={tax ? `Taxe : ${tax.name}` : "Nouvelle taxe spécifique"} onClose={onClose} footer={<Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.rate} onClick={() => void save()}>Enregistrer</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Libellé" className="md:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Nature"><Select value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })} options={natures.map((n) => ({ value: n.code, label: n.label }))} /></Field>
          <Field label="Base"><Select value={f.base} onChange={(e) => setF({ ...f, base: e.target.value as TaxRule["base"] })} options={bases.map((b) => ({ value: b.code, label: b.label }))} /></Field>
          <Field label={`Taux (${RATE_UNIT[f.base]})`}><Input inputMode="decimal" className="font-mono" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
          <Field label="Applicable du"><Input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} /></Field>
          <Field label="au" hint="Un changement de taux : clore la taxe et en créer une nouvelle."><Input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></Field>
          <Field label="Compte de charge"><Select value={f.account_id} placeholder="–" onChange={(e) => setF({ ...f, account_id: e.target.value })} options={(charges ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Produits (aucun coché : tous)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {(products ?? []).filter((p) => p.active).map((p) => <label key={p.id} className="flex items-center gap-1.5"><input type="checkbox" checked={f.product_ids.includes(p.id)} onChange={() => toggle("product_ids", p.id)} />{p.name}</label>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Routes (aucune cochée : toutes)</legend>
            <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto text-sm">
              {(routes ?? []).map((r) => <label key={r.id} className="flex items-center gap-1.5"><input type="checkbox" checked={f.route_ids.includes(r.id)} onChange={() => toggle("route_ids", r.id)} />{r.name}</label>)}
            </div>
          </fieldset>
        </div>
        <div className="flex flex-wrap items-end gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.rebillable} onChange={(e) => setF({ ...f, rebillable: e.target.checked })} /> Refacturée au client</label>
          {f.rebillable && <label className="flex items-center gap-2"><input type="checkbox" checked={f.rebill_vat} onChange={(e) => setF({ ...f, rebill_vat: e.target.checked })} /> Avec TVA</label>}
          {f.rebillable && <Field label="Compte de la refacturation"><Select value={f.income_account_id} placeholder="Compte du transport (7061)" onChange={(e) => setF({ ...f, income_account_id: e.target.value })} options={(incomes ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
        </div>
      </div>
    </Modal>
  );
}

/** Relevés des ensembles gérés : base des charges et comptes des pièces préparées. */
function RelevesProprietaires({ settings, onSaved }: { settings: TransportSettings; onSaved: () => void }) {
  const { message, send } = useSend(onSaved);
  const { data: charges } = useApi<AccountRef[]>(settings.can_edit ? "/finance/accounts?prefix=6&limit=2000" : null);
  const { data: produits } = useApi<AccountRef[]>(settings.can_edit ? "/finance/accounts?prefix=7&limit=2000" : null);
  const ro = !settings.can_edit;
  const options = (current: AccountRef | null, list: AccountRef[] | undefined) =>
    current && !list ? [{ value: current.id, label: `${current.code} ${current.name}` }] : (list ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const account = (label: string, hint: string, key: string, current: AccountRef | null, list: AccountRef[] | undefined) => (
    <Field label={label} hint={hint}>
      <Select disabled={ro} value={current?.id ?? ""} placeholder="Compte par défaut"
        onChange={(e) => void send("PATCH", "/transport/settings", { [key]: e.target.value ? Number(e.target.value) : null }, "Compte enregistré.")}
        options={options(current, list)} />
    </Field>
  );
  return (
    <Card title="Ensembles gérés pour des propriétaires">
      {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-muted">
        Le relevé d&apos;un ensemble géré retient, selon la base choisie, les frais déclarés des rotations et les charges mensuelles de
        l&apos;ensemble, ou les pièces comptabilisées sur l&apos;ensemble ; il montre toujours les deux. Ses pièces se préparent en brouillon :
        facture d&apos;achat du propriétaire, refacturation d&apos;une part négative, factures des commissions. Comptes à valider avec
        l&apos;expert-comptable.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Charges des relevés">
          <Select disabled={ro} value={settings.owner_cost_basis} onChange={(e) => void send("PATCH", "/transport/settings", { owner_cost_basis: e.target.value }, "Base des relevés enregistrée.")}
            options={settings.owner_cost_bases.map((b) => ({ value: b.code, label: b.label }))} />
        </Field>
        {account("Part des propriétaires", "Vide : 6223, sinon 622 ou 62.", "owner_account_id", settings.owner_account, charges)}
        {account("Charges refacturées aux propriétaires", "Vide : 7078, sinon 707 ou 706.", "owner_income_account_id", settings.owner_income_account, produits)}
        {account("Commissions versées", "Vide : 6322, sinon 632 ou 63.", "commission_account_id", settings.commission_account, charges)}
      </div>
    </Card>
  );
}

function Manquants({ settings, onSaved }: { settings: TransportSettings; onSaved: () => void }) {
  const { message, send } = useSend(onSaved);
  const { data: charges } = useApi<AccountRef[]>(settings.can_edit ? "/finance/accounts?prefix=6&limit=2000" : null);
  const { data: personnel } = useApi<AccountRef[]>(settings.can_edit ? "/finance/accounts?prefix=4&limit=2000" : null);
  const ro = !settings.can_edit;
  const accountOptions = (list: AccountRef[] | undefined) => (list ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  return (
    <Card title="Volumes et manquants">
      {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-muted">
        Le manquant (chargé moins livré) est toléré jusqu&apos;à un pourcentage du volume chargé ; au-delà, il est
        excédentaire et valorisé au prix du m³ du produit (ou du tarif du client). La tolérance d&apos;un tarif prime sur celle
        du client, qui prime sur celle de la société.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Tolérance par défaut (% du chargé)">
          <Input disabled={ro} inputMode="decimal" className="font-mono" defaultValue={String(settings.shortage_tolerance).replace(".", ",")}
            onBlur={(e) => { const v = parseNumber(e.target.value); if (v !== null && v !== settings.shortage_tolerance) void send("PATCH", "/transport/settings", { shortage_tolerance: v }, "Tolérance enregistrée."); }} />
        </Field>
        <Field label="Manquant excédentaire" hint="Règle par défaut ; un client peut avoir la sienne.">
          <Select disabled={ro} value={settings.shortage_rule} onChange={(e) => void send("PATCH", "/transport/settings", { shortage_rule: e.target.value }, "Traitement enregistré.")} options={SHORTAGE_RULES} />
        </Field>
        <Field label="Compte des manquants" hint="Vide : 6588, sinon 658.">
          <Select disabled={ro} value={settings.shortage_account?.id ?? ""} placeholder="Compte par défaut"
            onChange={(e) => void send("PATCH", "/transport/settings", { shortage_account_id: e.target.value ? Number(e.target.value) : null }, "Compte enregistré.")}
            options={settings.shortage_account && !charges ? [{ value: settings.shortage_account.id, label: `${settings.shortage_account.code} ${settings.shortage_account.name}` }] : accountOptions(charges)} />
        </Field>
        <Field label="Activité du transport" hint="Factures des rotations et rentabilité. Vide : Transport pétrolier.">
          <Select disabled={ro} value={settings.activity?.id ?? ""} placeholder="Transport pétrolier"
            onChange={(e) => void send("PATCH", "/transport/settings", { activity_id: e.target.value ? Number(e.target.value) : null }, "Activité enregistrée.")}
            options={(settings.activities.length ? settings.activities : settings.activity ? [settings.activity] : []).map((a) => ({ value: a.id, label: a.code ? `${a.code} ${a.name}` : a.name }))} />
        </Field>
        <Field label="Écart toléré au barème officiel (%)" hint="Au-delà, un tarif de route, de client ou de rotation éloigné du barème est signalé.">
          <Input disabled={ro} inputMode="decimal" className="font-mono" defaultValue={String(settings.official_rate_tolerance ?? 1).replace(".", ",")}
            onBlur={(e) => { const v = parseNumber(e.target.value); if (v !== null && v !== settings.official_rate_tolerance) void send("PATCH", "/transport/settings", { official_rate_tolerance: v }, "Écart toléré enregistré."); }} />
        </Field>
        <Field label="Compte des créances sur les chauffeurs" hint="Vide : 4211, sinon 421.">
          <Select disabled={ro} value={settings.claim_account?.id ?? ""} placeholder="Compte par défaut"
            onChange={(e) => void send("PATCH", "/transport/settings", { claim_account_id: e.target.value ? Number(e.target.value) : null }, "Compte enregistré.")}
            options={settings.claim_account && !personnel ? [{ value: settings.claim_account.id, label: `${settings.claim_account.code} ${settings.claim_account.name}` }] : accountOptions(personnel?.filter((a) => a.code.startsWith("42") || a.code.startsWith("47")))} />
        </Field>
      </div>
      <label className="mt-5 flex max-w-3xl items-start gap-3 text-sm text-ink-2">
        <input type="checkbox" className="mt-1" disabled={ro} checked={settings.volume_correction}
          onChange={(e) => void send("PATCH", "/transport/settings", { volume_correction: e.target.checked }, e.target.checked ? "Manquants calculés à 15 °C." : "Manquants calculés sur les volumes ambiants.")} />
        <span>
          <span className="font-semibold text-ink">Manquants sur volumes corrigés à 15 °C.</span> Températures au chargement et à la
          livraison et masse volumique du bon de chargement, saisies aussi au parc (Rotations) ; coefficient calculé selon la
          table 54B ou repris du bon du dépôt. La facturation reste sur le volume livré.
        </span>
      </label>
    </Card>
  );
}

const ruleLabel = (rule: ShortageRule | null) => SHORTAGE_RULES.find((r) => r.value === rule)?.label;

function ConditionsClients({ canEdit }: { canEdit: boolean }) {
  const { data, error, mutate } = useApi<ClientTerms[]>("/transport/clients");
  const { message, send } = useSend(() => void mutate());
  return (
    <Card title="Conditions de manquant des clients" padded={false}>
      {message && <div className="p-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
        <DataTable rows={data} rowKey={(c) => c.id} empty="Aucun client du transport (tarif ou rotation)." columns={[
          { key: "name", label: "Client" },
          { key: "shortage_tolerance", label: "Tolérance (%)", render: (c) => (
            <Input disabled={!canEdit} className="w-28 text-right font-mono" placeholder="Société" defaultValue={c.shortage_tolerance === null ? "" : String(c.shortage_tolerance).replace(".", ",")}
              onBlur={(e) => { const v = parseNumber(e.target.value); if (v !== c.shortage_tolerance) void send("PATCH", `/transport/clients/${c.id}`, { shortage_tolerance: v }, `Tolérance de ${c.name} enregistrée.`); }} />
          ) },
          { key: "shortage_rule", label: "Manquant excédentaire", render: (c) => (
            canEdit ? <Select value={c.shortage_rule ?? ""} placeholder="Règle de la société" onChange={(e) => void send("PATCH", `/transport/clients/${c.id}`, { shortage_rule: e.target.value || null }, `Traitement des manquants de ${c.name} enregistré.`)} options={SHORTAGE_RULES} />
              : <span>{ruleLabel(c.shortage_rule) ?? "Règle de la société"}</span>
          ) },
        ]} />
      )}
    </Card>
  );
}

/** Produits transportés : le code est la clé des saisies de Rotations, il ne change plus une fois créé. */
function Produits({ canEdit }: { canEdit: boolean }) {
  const { data, error, mutate } = useApi<Product[]>("/transport/products");
  const [f, setF] = useState({ name: "", code: "" });
  const { message, send } = useSend(() => void mutate());
  const patch = (p: Product, body: Record<string, unknown>, ok: string) => void send("PATCH", `/transport/products/${p.id}`, body, ok);
  return (
    <Card title="Produits transportés" padded={false}>
      {message && <div className="p-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
        <DataTable rows={data} rowKey={(p) => p.id} empty="Aucun produit." columns={[
          { key: "name", label: "Produit", render: (p) => <Input disabled={!canEdit} className="w-48" defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && patch(p, { name: e.target.value.trim() }, "Produit renommé.")} /> },
          { key: "code", label: "Code", render: (p) => <span className="font-mono text-xs">{p.code}</span> },
          { key: "density_15", label: "Masse vol. à 15 °C (kg/m³)", align: "right", render: (p) => <Input disabled={!canEdit} className="w-28 text-right font-mono" defaultValue={p.density_15 ? String(p.density_15).replace(".", ",") : ""} onBlur={(e) => { const v = parseNumber(e.target.value) ?? 0; if (v !== (p.density_15 ?? 0)) patch(p, { density_15: v }, "Masse volumique enregistrée."); }} /> },
          { key: "shortage_price", label: "Prix du m³ manquant (GNF)", align: "right", render: (p) => <Input disabled={!canEdit} className="w-40 text-right font-mono" defaultValue={p.shortage_price ? fmtInt(p.shortage_price) : ""} placeholder="À saisir" onBlur={(e) => { const v = parseNumber(e.target.value) ?? 0; if (v !== p.shortage_price) patch(p, { shortage_price: v }, "Prix de valorisation enregistré."); }} /> },
          { key: "shared", label: "Portée", render: (p) => <Tag>{p.shared ? "Commun" : "Société"}</Tag> },
          { key: "active", label: "Actif", render: (p) => <input type="checkbox" disabled={!canEdit} checked={p.active} onChange={(e) => patch(p, { active: e.target.checked }, e.target.checked ? "Produit réactivé." : "Produit retiré des listes de saisie.")} /> },
        ]} />
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          <Field label="Produit"><Input value={f.name} placeholder="Gasoil basse teneur en soufre" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Code" hint="Minuscules, sans espace ; il ne change plus ensuite."><Input className="w-40 font-mono" value={f.code} placeholder="gasoil-bts" onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/\s/g, "") })} /></Field>
          <Button variant="primary" disabled={!f.name.trim() || !f.code} onClick={() => void send("POST", "/transport/products", { name: f.name.trim(), code: f.code }, "Produit ajouté.").then((ok) => ok && setF({ name: "", code: "" }))}>Ajouter le produit</Button>
        </div>
      )}
    </Card>
  );
}
