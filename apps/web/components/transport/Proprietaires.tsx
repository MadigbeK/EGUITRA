"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, HandCoins, Plus, RefreshCw, Scale, Trash2, TrendingUp, Undo2, Users } from "@/components/icons";
import { Badge, Button, Card, DataTable, Field, Input, Kpi, Loading, Modal, Notice, Select } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiDownload, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDateTime, fmtDec, fmtGNF, fmtShort } from "@/lib/format";
import { OWNERSHIPS, parseNumber, type Message, type Ownership, type Ref, type TransportSettings } from "./types";

interface MoveRef { id: number; name: string | null; state: string }

interface Statement {
  id: number;
  name: string;
  vehicle: Ref;
  ownership: Ownership;
  owner: Ref | null;
  date_from: string;
  date_to: string;
  state: "draft" | "posted";
  basis: "declared" | "booked";
  basis_label: string | null;
  computed_at: string | null;
  rotation_count: number;
  volume: number;
  revenue: number;
  taxes_rebilled: number;
  rotation_costs: number;
  shortage_cost: number;
  vehicle_charges: number;
  declared_costs: number;
  booked_costs: number;
  costs: number;
  margin: number;
  commissions: number;
  owner_amount: number;
  operator_amount: number;
  moves: MoveRef[];
  lines?: Array<{ id: number; kind: "charge" | "commission" | "owner"; name: string; partner: Ref | null; rate: number | null; base: number | null; monthly: number | null; months: number | null; amount: number; move: MoveRef | null }>;
  rotations?: Array<{ id: number; name: string; date_loading: string; route: Ref; client: Ref; volume: number; revenue: number; total_cost: number; state: string }>;
}

interface Rule { id: number; vehicle: Ref | null; ownership: Ownership | null; partner: Ref; rate: number; date_from: string | null; date_to: string | null; note: string | null; active: boolean; is_company: boolean }

const STATE = { draft: ["Établi", "warn"], posted: ["Pièces préparées", "ok"] } as const;
const CATEGORY: Record<Ownership, string> = { own: "Ensembles propres", managed: "Ensembles gérés pour un propriétaire" };

function monthBounds(month: string): { from: string; to: string } {
  const [y = 1970, m = 1] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Ensembles gérés pour des propriétaires : relevés mensuels et règles de répartition du chiffre d'affaires. */
export function Proprietaires() {
  const { data: settings } = useApi<TransportSettings>("/transport/settings");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { from, to } = monthBounds(month);
  const { data, error, mutate } = useApi<{ items: Statement[]; vehicles: Array<{ id: number; name: string; ownership: Ownership; owner: Ref | null }>; totals: Record<string, number> }>(`/transport/owner-statements?date_from=${from}&date_to=${to}`);
  const [opened, setOpened] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = Boolean(settings?.can_edit);

  async function establish() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiSend<{ items: Statement[] }>("POST", "/transport/owner-statements", { date_from: from, date_to: to });
      setMessage({ tone: "ok", text: `${res.items.length} relevé(s) établi(s) ou actualisé(s) pour ${month.split("-").reverse().join("/")}.` });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Établissement impossible." });
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items ?? [];
  const owners = items.filter((s) => s.ownership === "managed").reduce((sum, s) => sum + s.owner_amount, 0);
  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="danger">{error.message}</Notice>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Mois"><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
          <p className="max-w-xl pb-2 text-[13px] text-muted">
            Un relevé par ensemble géré pour un propriétaire ou visé par une règle de répartition : chiffre d&apos;affaires des rotations
            validées, charges, commissions et part du propriétaire.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" loading={busy} onClick={establish} disabled={!data?.vehicles.length}>
            <RefreshCw className="h-4 w-4" /> Établir les relevés du mois
          </Button>
        )}
      </div>
      {data && data.vehicles.length === 0 && (
        <Notice tone="accent">Aucun ensemble géré ni aucune règle de répartition : déclarez la propriété des ensembles (Flotte et chauffeurs) ou une règle ci-dessous.</Notice>
      )}
      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Chiffre d'affaires des ensembles" value={fmtShort(data?.totals.revenue)} icon={TrendingUp} teinte="jade" hint={`${items.length} relevé(s)`} />
          <Kpi label="Commissions" value={fmtShort(data?.totals.commissions)} icon={HandCoins} teinte="or" hint="Pourcentages du chiffre d'affaires brut" />
          <Kpi label="Part des propriétaires" value={fmtShort(owners)} icon={Users} teinte={owners < 0 ? "corail" : "jade"} tone={owners < 0 ? "danger" : "neutral"} hint={owners < 0 ? "Négative : charges non couvertes" : "À reverser"} />
          <Kpi label="Part de la société" value={fmtShort(data?.totals.operator_amount)} icon={Scale} teinte="jade" hint="Commissions perçues et résultat des ensembles propres" />
        </div>
      )}
      <Card title="Relevés du mois" padded={false}>
        {!data ? <Loading /> : (
          <DataTable rows={items} rowKey={(s) => s.id} onRowClick={(s) => setOpened(s.id)} empty="Aucun relevé établi pour ce mois." columns={[
            { key: "vehicle", label: "Ensemble", render: (s) => s.vehicle.name, sortValue: (s) => s.vehicle.name },
            { key: "owner", label: "Propriétaire", render: (s) => (s.ownership === "managed" ? s.owner?.name ?? "–" : <span className="text-muted">Propre</span>) },
            { key: "rotation_count", label: "Rotations", align: "right" },
            { key: "revenue", label: "Chiffre d'affaires", align: "right", render: (s) => fmtGNF(s.revenue) },
            { key: "costs", label: "Charges", align: "right", render: (s) => fmtGNF(s.costs) },
            { key: "margin", label: "Marge", align: "right", render: (s) => <span className={s.margin < 0 ? "text-danger" : ""}>{fmtGNF(s.margin)}</span> },
            { key: "commissions", label: "Commissions", align: "right", render: (s) => fmtGNF(s.commissions) },
            { key: "owner_amount", label: "Part du propriétaire", align: "right", render: (s) => <span className={s.owner_amount < 0 ? "font-semibold text-danger" : "font-semibold"}>{fmtGNF(s.owner_amount)}</span> },
            { key: "state", label: "État", render: (s) => <Badge tone={STATE[s.state][1]}>{STATE[s.state][0]}</Badge> },
          ]} />
        )}
      </Card>
      <Regles canEdit={canEdit} />
      {opened !== null && <Releve id={opened} canEdit={canEdit} onClose={() => setOpened(null)} onChanged={() => void mutate()} />}
    </div>
  );
}

/** Détail d'un relevé : compte de l'ensemble, répartition, rotations ; pièces, PDF et Excel. */
function Releve({ id, canEdit, onClose, onChanged }: { id: number; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { data: st, mutate } = useApi<Statement>(`/transport/owner-statements/${id}`);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  async function run(action: "refresh" | "prepare" | "reset", ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await apiSend("POST", `/transport/owner-statements/${id}/${action}`, {});
      setMessage({ tone: "ok", text: ok });
      void mutate();
      onChanged();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
    } finally {
      setBusy(false);
    }
  }
  const file = st ? `releve_${st.vehicle.name}_${st.date_from}_${st.date_to}` : "releve";
  return (
    <Modal open wide title={st ? `Relevé ${st.name}` : "Relevé"} onClose={onClose} footer={st && (
      <>
        <Button onClick={() => apiDownload(`/transport/owner-statements/${id}/releve.pdf`, `${file}.pdf`)}><FileText className="h-4 w-4" /> PDF</Button>
        <Button onClick={() => apiDownload(`/transport/owner-statements/${id}/releve.xlsx`, `${file}.xlsx`)}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
        {canEdit && st.state === "draft" && <Button loading={busy} onClick={() => run("refresh", "Relevé actualisé.")}><RefreshCw className="h-4 w-4" /> Actualiser</Button>}
        {canEdit && st.state === "draft" && <Button variant="primary" loading={busy} onClick={() => run("prepare", "Pièces préparées en brouillon, à valider dans Achats et Ventes.")}><Download className="h-4 w-4" /> Préparer les pièces</Button>}
        {canEdit && st.state === "posted" && <Button loading={busy} onClick={() => run("reset", "Pièces en brouillon supprimées, relevé rouvert.")}><Undo2 className="h-4 w-4" /> Rouvrir</Button>}
      </>
    )}>
      {!st ? <Loading /> : (
        <div className="space-y-5">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Badge tone={STATE[st.state][1]}>{STATE[st.state][0]}</Badge>
            <span>{st.ownership === "managed" ? `Géré pour ${st.owner?.name ?? "–"}` : "Ensemble propre"}</span>
            <span>· du {fmtDate(st.date_from)} au {fmtDate(st.date_to)}</span>
            {st.computed_at && <span>· établi le {fmtDateTime(st.computed_at)}</span>}
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section>
              <h3 className="mb-2 text-[14px] font-semibold text-ink">Compte de l&apos;ensemble</h3>
              <table className="w-full text-[13px]">
                <tbody>
                  {[
                    ["Chiffre d'affaires du transport", st.revenue],
                    ...(st.taxes_rebilled ? [["Taxes refacturées", st.taxes_rebilled]] : []),
                    ...(st.basis === "booked"
                      ? [["Charges comptabilisées sur l'ensemble", -st.booked_costs]]
                      : [["Frais des rotations", -st.rotation_costs], ["Manquants à charge", -st.shortage_cost], ["Charges mensuelles de l'ensemble", -st.vehicle_charges]]),
                  ].map(([label, value]) => (
                    <tr key={String(label)} className="border-b border-line"><td className="py-1.5 text-ink-2">{label}</td><td className="py-1.5 text-right font-mono">{fmtGNF(value)}</td></tr>
                  ))}
                  <tr><td className="py-2 font-semibold text-ink">Marge de l&apos;ensemble</td><td className={`py-2 text-right font-mono font-semibold ${st.margin < 0 ? "text-danger" : ""}`}>{fmtGNF(st.margin)}</td></tr>
                </tbody>
              </table>
              <p className="mt-2 text-[12px] text-muted">
                Base : {st.basis_label?.toLowerCase()}. Charges déclarées {fmtGNF(st.declared_costs)}, charges comptabilisées {fmtGNF(st.booked_costs)}.
              </p>
            </section>
            <section>
              <h3 className="mb-2 text-[14px] font-semibold text-ink">Répartition</h3>
              <table className="w-full text-[13px]">
                <tbody>
                  {(st.lines ?? []).filter((l) => l.kind !== "charge").map((l) => (
                    <tr key={l.id} className="border-b border-line">
                      <td className="py-1.5 text-ink-2">{l.name}{l.move && <span className="ml-2"><Badge tone="accent">{l.move.name ?? "Brouillon"}</Badge></span>}</td>
                      <td className={`py-1.5 text-right font-mono ${l.kind === "owner" ? "font-semibold" : ""} ${l.amount < 0 ? "text-danger" : ""}`}>{fmtGNF(l.amount)}</td>
                    </tr>
                  ))}
                  <tr><td className="py-2 text-ink-2">Part de la société</td><td className="py-2 text-right font-mono">{fmtGNF(st.operator_amount)}</td></tr>
                </tbody>
              </table>
              {st.ownership === "managed" && st.owner_amount < 0 && (
                <p className="mt-2 text-[12px] text-danger">Part négative : les charges de la période dépassent ce que l&apos;ensemble a rapporté ; la pièce préparée est une facture au propriétaire.</p>
              )}
            </section>
          </div>
          {(st.lines ?? []).some((l) => l.kind === "charge") && (
            <section>
              <h3 className="mb-2 text-[14px] font-semibold text-ink">Charges mensuelles</h3>
              <DataTable dense rows={(st.lines ?? []).filter((l) => l.kind === "charge")} rowKey={(l) => l.id} columns={[
                { key: "name", label: "Charge" },
                { key: "monthly", label: "Mensuel", align: "right", render: (l) => fmtGNF(l.monthly) },
                { key: "months", label: "Mois", align: "right", render: (l) => fmtDec(l.months) },
                { key: "amount", label: "Montant", align: "right", render: (l) => fmtGNF(l.amount) },
              ]} />
            </section>
          )}
          <section>
            <h3 className="mb-2 text-[14px] font-semibold text-ink">Rotations validées ({st.rotation_count})</h3>
            <DataTable dense rows={st.rotations ?? []} rowKey={(r) => r.id} empty="Aucune rotation validée sur la période." columns={[
              { key: "name", label: "N°", render: (r) => <span className="font-mono text-xs">{r.name}</span> },
              { key: "date_loading", label: "Chargement", render: (r) => fmtDate(r.date_loading) },
              { key: "route", label: "Route", render: (r) => r.route.name },
              { key: "client", label: "Client", render: (r) => r.client.name },
              { key: "volume", label: "Livré (m³)", align: "right", render: (r) => fmtDec(r.volume) },
              { key: "revenue", label: "Montant", align: "right", render: (r) => fmtGNF(r.revenue) },
              { key: "total_cost", label: "Frais déclarés", align: "right", render: (r) => fmtGNF(r.total_cost) },
            ]} />
          </section>
        </div>
      )}
    </Modal>
  );
}

/** Règles de répartition : pourcentage du chiffre d'affaires brut d'un ensemble ou d'une catégorie, par bénéficiaire. */
function Regles({ canEdit }: { canEdit: boolean }) {
  const { data: rules, mutate } = useApi<Rule[]>("/transport/share-rules");
  const { data: vehicles } = useApi<Array<{ id: number; name: string; ownership: Ownership; owner: Ref | null }>>("/transport/vehicles");
  const [form, setForm] = useState<{ target: string; partner: Ref | null; rate: string; date_from: string; date_to: string; note: string }>({ target: "", partner: null, rate: "", date_from: "", date_to: "", note: "" });
  const [message, setMessage] = useState<Message>(null);
  const targets = [
    ...OWNERSHIPS.map((o) => ({ value: `cat:${o.value}`, label: `Tous les ${CATEGORY[o.value].toLowerCase()}` })),
    ...(vehicles ?? []).map((v) => ({ value: `veh:${v.id}`, label: `${v.name}${v.ownership === "managed" ? ` (géré, ${v.owner?.name ?? "–"})` : ""}` })),
  ];
  async function save() {
    setMessage(null);
    const [kind, value] = form.target.split(":");
    try {
      await apiSend("POST", "/transport/share-rules", {
        partner_id: form.partner?.id, rate: parseNumber(form.rate) ?? 0,
        vehicle_id: kind === "veh" ? Number(value) : null, ownership: kind === "cat" ? value : null,
        date_from: form.date_from || null, date_to: form.date_to || null, note: form.note || null,
      });
      setForm({ target: "", partner: null, rate: "", date_from: "", date_to: "", note: "" });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    }
  }
  async function remove(rule: Rule) {
    setMessage(null);
    try {
      await apiSend("DELETE", `/transport/share-rules/${rule.id}`);
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Suppression impossible." });
    }
  }
  return (
    <Card title="Règles de répartition" padded={false}>
      <p className="px-5 pt-4 text-[13px] text-muted">
        Chaque bénéficiaire reçoit un pourcentage du chiffre d&apos;affaires brut, rotation par rotation, même quand la marge est négative ;
        le propriétaire reçoit le reste. La règle d&apos;un ensemble remplace la règle générale du même bénéficiaire. La part que la société retient
        sur un ensemble géré est une règle à son nom.
      </p>
      {message && <div className="px-5 pt-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {!rules ? <Loading /> : (
        <DataTable rows={rules} rowKey={(r) => r.id} empty="Aucune règle." columns={[
          { key: "target", label: "Porte sur", render: (r) => r.vehicle?.name ?? (r.ownership ? CATEGORY[r.ownership] : "–") },
          { key: "partner", label: "Bénéficiaire", render: (r) => <span>{r.partner.name}{r.is_company && <span className="ml-2"><Badge tone="accent">Société</Badge></span>}</span> },
          { key: "rate", label: "Taux", align: "right", render: (r) => `${String(r.rate).replace(".", ",")} %` },
          { key: "period", label: "Période", render: (r) => (r.date_from || r.date_to ? `${r.date_from ? fmtDate(r.date_from) : "…"} au ${r.date_to ? fmtDate(r.date_to) : "…"}` : "Permanente") },
          { key: "note", label: "Fondement", render: (r) => r.note ?? "–" },
          { key: "actions", label: "", render: (r) => (canEdit ? <button type="button" title="Supprimer la règle" className="text-muted hover:text-danger" onClick={() => void remove(r)}><Trash2 className="h-4 w-4" /></button> : null) },
        ]} />
      )}
      {canEdit && (
        <div className="grid grid-cols-1 gap-2 border-t border-line p-3 md:grid-cols-7">
          <Select className="md:col-span-2" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="Ensemble ou catégorie…" options={targets} />
          <div className="md:col-span-2"><PartnerPicker kind="supplier" value={form.partner} placeholder="Bénéficiaire…" onChange={(p) => setForm({ ...form, partner: p })} /></div>
          <Input placeholder="Taux (%)" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          <Input placeholder="Fondement (contrat…)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Button variant="primary" disabled={!form.target || !form.partner || !parseNumber(form.rate)} onClick={() => void save()}><Plus className="h-4 w-4" /> Ajouter</Button>
        </div>
      )}
    </Card>
  );
}
