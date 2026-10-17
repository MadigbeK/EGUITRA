"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Notice, Select } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtInt } from "@/lib/format";
import { SHORTAGE_RULES, parseNumber, type AccountRef, type ClientTerms, type Message, type Product, type ShortageRule, type TransportSettings } from "./types";

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
  const { data: settings, mutate } = useApi<TransportSettings>("/transport/settings");
  if (!settings) return <Loading />;
  return (
    <div className="space-y-6">
      {!settings.can_edit && <Notice tone="accent">Paramètres tenus par la finance : consultation seulement.</Notice>}
      <Manquants settings={settings} onSaved={() => void mutate()} />
      <ConditionsClients canEdit={settings.can_edit} />
      <Produits canEdit={settings.can_edit} />
    </div>
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
  const { data, mutate } = useApi<ClientTerms[]>("/transport/clients");
  const { message, send } = useSend(() => void mutate());
  return (
    <Card title="Conditions de manquant des clients" padded={false}>
      {message && <div className="p-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {!data ? <Loading /> : (
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
  const { data, mutate } = useApi<Product[]>("/transport/products");
  const [f, setF] = useState({ name: "", code: "" });
  const { message, send } = useSend(() => void mutate());
  const patch = (p: Product, body: Record<string, unknown>, ok: string) => void send("PATCH", `/transport/products/${p.id}`, body, ok);
  return (
    <Card title="Produits transportés" padded={false}>
      {message && <div className="p-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {!data ? <Loading /> : (
        <DataTable rows={data} rowKey={(p) => p.id} empty="Aucun produit." columns={[
          { key: "name", label: "Produit", render: (p) => <Input disabled={!canEdit} className="w-48" defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && patch(p, { name: e.target.value.trim() }, "Produit renommé.")} /> },
          { key: "code", label: "Code", render: (p) => <span className="font-mono text-xs">{p.code}</span> },
          { key: "density_15", label: "Masse vol. à 15 °C (kg/m³)", align: "right", render: (p) => <Input disabled={!canEdit} className="w-28 text-right font-mono" defaultValue={p.density_15 ? String(p.density_15).replace(".", ",") : ""} onBlur={(e) => { const v = parseNumber(e.target.value) ?? 0; if (v !== (p.density_15 ?? 0)) patch(p, { density_15: v }, "Masse volumique enregistrée."); }} /> },
          { key: "shortage_price", label: "Prix du m³ manquant (GNF)", align: "right", render: (p) => <Input disabled={!canEdit} className="w-40 text-right font-mono" defaultValue={p.shortage_price ? fmtInt(p.shortage_price) : ""} placeholder="À saisir" onBlur={(e) => { const v = parseNumber(e.target.value) ?? 0; if (v !== p.shortage_price) patch(p, { shortage_price: v }, "Prix de valorisation enregistré."); }} /> },
          { key: "shared", label: "Portée", render: (p) => (p.shared ? <Badge>Commun</Badge> : <Badge tone="accent">Société</Badge>) },
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
