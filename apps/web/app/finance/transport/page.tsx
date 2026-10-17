"use client";

import { useState } from "react";
import { CheckCheck, Droplet, FileText, Percent, Plus, Receipt, Smartphone, TrendingUp } from "@/components/icons";
import { Badge, Button, Card, Compteur, DataTable, ErrorBox, Field, IconTile, Input, Kpi, Loading, Modal, Notice, PageHeader, Repartition, Select, Tabs } from "@/components/ui";
import { Manquants } from "@/components/transport/Manquants";
import { Parametres } from "@/components/transport/Parametres";
import { Taxes } from "@/components/transport/Taxes";
import { parseNumber, type Ref, type Referentials, type TransportSettings } from "@/components/transport/types";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDec, fmtGNF, fmtPct, fmtShort } from "@/lib/format";

interface Rotation {
  id: number;
  name: string | null;
  state: "draft" | "done" | "invoiced" | "cancelled";
  source: "office" | "mobile";
  date_loading: string;
  vehicle: Ref;
  driver: Ref | null;
  client: Ref;
  route: Ref;
  product: string;
  product_label: string;
  delivery_note: string | null;
  volume_loaded: number;
  volume_delivered: number;
  over_capacity: boolean;
  capacity_liters: number;
  shortage: number;
  shortage_excess: number;
  shortage_value: number;
  rate: number;
  revenue: number;
  total_cost: number;
  margin: number;
  margin_rate: number;
  invoice: { id: number; name: string } | null;
}

const STATE = { draft: ["Saisie", "warn"], done: ["Validée", "accent"], invoiced: ["Facturée", "ok"], cancelled: ["Annulée", "neutral"] } as const;
type Tab = "rotations" | "rentabilite" | "manquants" | "taxes" | "flotte" | "routes" | "parametres";

export default function TransportPage() {
  const [tab, setTab] = useState<Tab>("rotations");
  const { data: summary } = useApi<{ rotations: number; volume: number; revenue: number; margin: number; margin_rate: number | null; to_invoice: { count: number; amount: number }; shortage_excess: { count: number; volume: number; value: number }; drafts: number; fleet: Record<string, number> }>("/transport/summary");
  return (
    <div>
      <PageHeader title="Transport pétrolier" subtitle="La rotation est la source unique : facturation, coûts par ensemble et par route, marge." />
      {summary && (
        <div className="mb-7 grid grid-cols-1 gap-5 xl:grid-cols-12">
          {/* Le chiffre de l'écran : le volume livré, au compteur, comme sur la citerne ; l'état de la flotte dessous. */}
          <section className="min-w-0 rounded-2xl border border-line bg-panel p-6 shadow-[var(--ombre-carte)] xl:col-span-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[16.5px] font-semibold text-ink">Volume livré ce mois</h2>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {summary.rotations} rotation{summary.rotations > 1 ? "s" : ""}, {fmtDec(summary.volume)} m³ au total
                </p>
              </div>
              <IconTile icon={Droplet} teinte="corail" />
            </div>
            <Compteur value={summary.volume} unit="m³" className="mt-5 text-[42px] text-ink sm:text-[50px]" />
            {summary.shortage_excess.count > 0 && (
              <p className="mt-2 text-[13px] font-medium text-danger">
                {fmtDec(summary.shortage_excess.volume)} m³ manquants au-delà de la tolérance sur {summary.shortage_excess.count} rotation(s)
                {summary.shortage_excess.value ? `, ${fmtGNF(summary.shortage_excess.value)}` : ""}
              </p>
            )}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-[13px]">
                <span className="font-semibold text-ink-2">Flotte</span>
                <span className="text-muted">{(summary.fleet.service ?? 0) + (summary.fleet.maintenance ?? 0) + (summary.fleet.off ?? 0)} ensembles</span>
              </div>
              <Repartition
                parts={[
                  { key: "service", label: "En service", value: summary.fleet.service ?? 0, color: "#12956a" },
                  { key: "maintenance", label: "En maintenance", value: summary.fleet.maintenance ?? 0, color: "#df8f17" },
                  { key: "off", label: "Hors service", value: summary.fleet.off ?? 0, color: "#ec4f49" },
                ]}
                format={(v) => `${v}`}
              />
            </div>
          </section>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-7">
            <Kpi label="Chiffre d'affaires du mois" value={fmtShort(summary.revenue)} icon={TrendingUp} teinte="jade" hint="Rotations validées et facturées" />
            <Kpi label="Marge du mois" value={fmtShort(summary.margin)} icon={Percent} teinte={(summary.margin_rate ?? 0) < 15 ? "ambre" : "jade"} tone={(summary.margin_rate ?? 0) < 15 ? "warn" : "ok"} hint={`Taux de marge ${fmtPct(summary.margin_rate)}`} />
            <Kpi label="À facturer" value={fmtShort(summary.to_invoice.amount)} icon={Receipt} teinte="or" tone="accent" hint={`${summary.to_invoice.count} rotation(s) validée(s)`} />
            <Kpi label="Saisies à valider" value={String(summary.drafts)} icon={Smartphone} teinte="corail" tone={summary.drafts > 0 ? "warn" : "neutral"} hint="Rotations saisies au bureau ou au parc" />
          </div>
        </div>
      )}
      <Tabs tabs={[{ key: "rotations", label: "Rotations" }, { key: "rentabilite", label: "Rentabilité" }, { key: "manquants", label: "Manquants" }, { key: "taxes", label: "Taxes spécifiques" }, { key: "flotte", label: "Flotte et chauffeurs" }, { key: "routes", label: "Routes et tarifs" }, { key: "parametres", label: "Paramètres" }]} value={tab} onChange={setTab} />
      {tab === "rotations" && <Rotations />}
      {tab === "rentabilite" && <Profitability />}
      {tab === "manquants" && <Manquants />}
      {tab === "taxes" && <Taxes />}
      {tab === "flotte" && <Fleet />}
      {tab === "routes" && <Routes />}
      {tab === "parametres" && <Parametres />}
    </div>
  );
}

function Rotations() {
  const [state, setState] = useState("draft,done");
  const { data, error, mutate } = useApi<{ items: Rotation[]; total_count: number; totals: { revenue: number; margin: number; volume: number } }>(`/transport/rotations?state=${state}&limit=300`);
  const [selected, setSelected] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const rows = data?.items ?? [];
  const chosen = rows.filter((r) => selected.includes(r.id));

  async function run(action: "validate" | "invoice") {
    setMessage(null);
    try {
      if (action === "validate") {
        await apiSend("POST", "/transport/rotations/validate", { ids: chosen.filter((r) => r.state === "draft").map((r) => r.id) });
        setMessage({ tone: "ok", text: "Rotations validées." });
      } else {
        const res = await apiSend<{ invoices: Array<{ name: string | null; partner: Ref | null; amount_total: number }>; claims: unknown[]; unclaimed: Array<{ rotation: string; driver: Ref | null; amount: number }> }>("POST", "/transport/invoice", { rotation_ids: chosen.filter((r) => r.state === "done").map((r) => r.id) });
        const claims = res.claims.length ? ` ${res.claims.length} créance(s) sur chauffeur en opérations diverses, à valider dans Écritures.` : "";
        const unclaimed = res.unclaimed.length ? ` Sans fiche tiers, créance à passer à la main : ${res.unclaimed.map((u) => `${u.driver?.name ?? "chauffeur non renseigné"} (${u.rotation}, ${fmtGNF(u.amount)})`).join(", ")}.` : "";
        setMessage({ tone: res.unclaimed.length ? "danger" : "ok", text: `${res.invoices.length} facture(s) créée(s) en brouillon, à valider dans Ventes.${claims}${unclaimed}` });
      }
      setSelected([]);
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
    }
  }

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Statut">
          <Select value={state} onChange={(e) => setState(e.target.value)} options={[{ value: "draft,done", label: "À traiter (saisies et validées)" }, { value: "draft", label: "Saisies à valider" }, { value: "done", label: "Validées, à facturer" }, { value: "invoiced", label: "Facturées" }, { value: "draft,done,invoiced,cancelled", label: "Toutes" }]} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!chosen.some((r) => r.state === "draft")} onClick={() => run("validate")}>
            <CheckCheck className="h-4 w-4" /> Valider la sélection
          </Button>
          <Button disabled={!chosen.some((r) => r.state === "done")} onClick={() => run("invoice")}>
            <FileText className="h-4 w-4" /> Facturer la sélection
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nouvelle rotation
          </Button>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      <Card padded={false}>
        {!data ? (
          <Loading />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}
            empty="Aucune rotation pour ce filtre."
            columns={[
              { key: "sel", label: "", render: (r) => <input type="checkbox" readOnly checked={selected.includes(r.id)} /> },
              { key: "name", label: "N°", render: (r) => <span className="font-mono text-xs">{r.name ?? "–"}{r.source === "mobile" && <Smartphone className="ml-1 inline h-3 w-3 text-accent" />}</span> },
              { key: "date_loading", label: "Chargement", render: (r) => fmtDate(r.date_loading) },
              { key: "vehicle", label: "Ensemble", render: (r) => r.vehicle.name, sortValue: (r) => r.vehicle.name },
              { key: "client", label: "Client", render: (r) => r.client.name, sortValue: (r) => r.client.name },
              { key: "route", label: "Route", render: (r) => r.route.name },
              { key: "volume", label: "Livré (m³)", align: "right", render: (r) => <span title={r.over_capacity ? `Chargé au-delà de la capacité (${fmtDec(r.capacity_liters / 1000)} m³)` : undefined} className={r.over_capacity ? "text-danger" : ""}>{fmtDec(r.volume_delivered || r.volume_loaded)}</span> },
              { key: "shortage", label: "Manquant", align: "right", render: (r) => (r.shortage ? <span className={r.shortage_excess > 0 ? "font-semibold text-danger" : "text-muted"} title={r.shortage_excess > 0 ? `${fmtDec(r.shortage_excess)} m³ hors tolérance, ${fmtGNF(r.shortage_value)}` : "Dans la tolérance"}>{fmtDec(r.shortage)}</span> : "–") },
              { key: "revenue", label: "Montant", align: "right", render: (r) => fmtGNF(r.revenue) },
              { key: "margin", label: "Marge", align: "right", render: (r) => <span className={r.margin < 0 ? "text-danger" : ""}>{fmtShort(r.margin)} <span className="text-muted">({fmtPct(r.margin_rate, 0)})</span></span> },
              { key: "state", label: "Statut", render: (r) => <Badge tone={STATE[r.state][1]} vivant={r.state === "draft"}>{STATE[r.state][0]}</Badge> },
            ]}
            footer={
              data.items.length > 0 ? (
                <tr>
                  <td className="px-3 py-2" colSpan={6}>Total ({data.total_count})</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtDec(data.totals.volume)}</td>
                  <td />
                  <td className="px-3 py-2 text-right font-mono">{fmtGNF(data.totals.revenue)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtShort(data.totals.margin)}</td>
                  <td />
                </tr>
              ) : undefined
            }
          />
        )}
      </Card>
      {creating && <RotationForm onClose={() => setCreating(false)} onDone={() => { setCreating(false); void mutate(); }} />}
    </div>
  );
}

function RotationForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: ref } = useApi<Referentials>("/transport/referentials");
  const [f, setF] = useState<Record<string, string>>({ date_loading: new Date().toISOString().slice(0, 10), product: "gasoil" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(validate: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...f, validate };
      for (const k of ["vehicle_id", "partner_id", "route_id", "driver_id"]) if (f[k]) body[k] = Number(f[k]);
      for (const k of ["volume_loaded", "volume_delivered", "rate", ...(ref?.measures ?? []).map((m) => m.code), ...(ref?.costs.map((c) => c.code) ?? [])]) {
        if (f[k]) body[k] = parseNumber(f[k]) ?? 0;
        else delete body[k];
      }
      await apiSend("POST", "/transport/rotations", body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open wide title="Nouvelle rotation" onClose={onClose} footer={<><Button loading={busy} onClick={() => submit(false)} disabled={!f.vehicle_id || !f.partner_id || !f.route_id}>Enregistrer</Button><Button variant="primary" loading={busy} onClick={() => submit(true)} disabled={!f.vehicle_id || !f.partner_id || !f.route_id}>Enregistrer et valider</Button></>}>
      {!ref ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Chargement"><Input type="date" value={f.date_loading} onChange={set("date_loading")} /></Field>
            <Field label="Ensemble routier"><Select value={f.vehicle_id ?? ""} onChange={set("vehicle_id")} placeholder="Choisir…" options={ref.vehicles.map((v) => ({ value: v.id, label: `${v.name} ${v.tractor_plate ?? ""}` }))} /></Field>
            <Field label="Chauffeur" hint="Vide : chauffeur habituel"><Select value={f.driver_id ?? ""} onChange={set("driver_id")} placeholder="–" options={ref.drivers.map((d) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Produit"><Select value={f.product} onChange={set("product")} options={ref.products.map((p) => ({ value: p.code, label: p.label }))} /></Field>
            <Field label="Client" className="md:col-span-2"><Select value={f.partner_id ?? ""} onChange={set("partner_id")} placeholder="Choisir…" options={ref.clients.map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Route" className="md:col-span-2"><Select value={f.route_id ?? ""} onChange={set("route_id")} placeholder="Choisir…" options={ref.routes.map((r) => ({ value: r.id, label: r.name }))} /></Field>
            <Field label="Volume chargé (m³)"><Input inputMode="decimal" value={f.volume_loaded ?? ""} onChange={set("volume_loaded")} /></Field>
            <Field label="Volume livré (m³)"><Input inputMode="decimal" value={f.volume_delivered ?? ""} onChange={set("volume_delivered")} /></Field>
            <Field label="Bon de livraison"><Input value={f.delivery_note ?? ""} onChange={set("delivery_note")} /></Field>
            <Field label="Tarif (m³)" hint="Vide : tarif du client ou de la route"><Input inputMode="numeric" value={f.rate ?? ""} onChange={set("rate")} /></Field>
            {(ref.measures ?? []).map((m) => (
              <Field key={m.code} label={m.label}><Input inputMode="decimal" className="font-mono" value={f[m.code] ?? ""} onChange={set(m.code)} /></Field>
            ))}
          </div>
          {(() => {
            const vehicle = ref.vehicles.find((v) => String(v.id) === f.vehicle_id);
            const loaded = parseNumber(f.volume_loaded ?? "") ?? 0;
            return vehicle?.capacity_liters && loaded * 1000 > vehicle.capacity_liters ? (
              <Notice tone="danger">Le volume chargé dépasse la capacité de {vehicle.name} ({fmtDec(vehicle.capacity_liters / 1000)} m³) : la rotation ne pourra pas être validée.</Notice>
            ) : null;
          })()}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {ref.costs.map((c) => (
              <Field key={c.code} label={c.label}><Input inputMode="numeric" className="font-mono" value={f[c.code] ?? ""} onChange={set(c.code)} /></Field>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Profitability() {
  const [group, setGroup] = useState("vehicle");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data } = useApi<{ rows: Array<{ key: string | number | null; label: string; rotations: number; volume: number; revenue: number; cost: number; margin: number; margin_rate: number | null; shortage: number; shortage_excess: number; shortage_net_cost: number }> }>(`/transport/profitability?group=${group}&date_from=${from}&date_to=${to}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Par"><Select value={group} onChange={(e) => setGroup(e.target.value)} options={[{ value: "vehicle", label: "Ensemble routier" }, { value: "route", label: "Route" }, { value: "driver", label: "Chauffeur" }, { value: "client", label: "Client" }, { value: "month", label: "Mois" }]} /></Field>
        <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Card padded={false}>
        {!data ? <Loading /> : (
          <DataTable rows={data.rows} rowKey={(r, i) => `${r.key}-${i}`} empty="Aucune rotation validée sur la période." columns={[
            { key: "label", label: "Libellé" },
            { key: "rotations", label: "Rotations", align: "right", render: (r) => String(r.rotations) },
            { key: "volume", label: "Volume (m³)", align: "right", render: (r) => fmtDec(r.volume) },
            { key: "shortage", label: "Manquants (m³)", align: "right", render: (r) => fmtDec(r.shortage) },
            { key: "shortage_excess", label: "Hors tolérance (m³)", align: "right", render: (r) => <span className={r.shortage_excess > 0 ? "text-danger" : ""}>{fmtDec(r.shortage_excess)}</span> },
            { key: "revenue", label: "Chiffre d'affaires", align: "right", render: (r) => fmtGNF(r.revenue) },
            { key: "cost", label: "Coûts", align: "right", render: (r) => fmtGNF(r.cost + r.shortage_net_cost) },
            { key: "margin", label: "Marge", align: "right", render: (r) => <span className={r.margin < 0 ? "text-danger" : "text-ok"}>{fmtGNF(r.margin)}</span> },
            { key: "margin_rate", label: "Taux", align: "right", render: (r) => fmtPct(r.margin_rate) },
          ]} />
        )}
      </Card>
    </div>
  );
}

function Fleet() {
  const { data: vehicles, mutate } = useApi<Array<{ id: number; name: string; tractor_plate: string | null; trailer_plate: string | null; brand: string | null; capacity_liters: number; driver: Ref | null; state: string }>>("/transport/vehicles");
  const { data: drivers, mutate: refreshDrivers } = useApi<Array<{ id: number; name: string; phone: string | null; license_number: string | null; license_expiry: string | null }>>("/transport/drivers");
  const [v, setV] = useState({ name: "", tractor_plate: "", trailer_plate: "", capacity_liters: "", driver_id: "" });
  const [d, setD] = useState({ name: "", phone: "", license_number: "", license_expiry: "" });
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card title="Ensembles routiers" padded={false}>
        {message && <div className="p-3"><Notice>{message}</Notice></div>}
        <DataTable rows={vehicles ?? []} rowKey={(x) => x.id} columns={[
          { key: "name", label: "Code" },
          { key: "tractor_plate", label: "Tracteur", render: (x) => x.tractor_plate ?? "–" },
          { key: "capacity_liters", label: "Capacité (L)", align: "right", render: (x) => x.capacity_liters.toLocaleString("fr-FR") },
          { key: "driver", label: "Chauffeur", render: (x) => x.driver?.name ?? "–" },
          { key: "state", label: "État", render: (x) => <Select value={x.state} onChange={(e) => apiSend("PATCH", `/transport/vehicles/${x.id}`, { state: e.target.value }).then(() => mutate())} options={[{ value: "service", label: "En service" }, { value: "maintenance", label: "Maintenance" }, { value: "off", label: "Hors service" }]} /> },
        ]} />
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-5">
          <Input placeholder="Code (ER-01)" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <Input placeholder="Plaque tracteur" value={v.tractor_plate} onChange={(e) => setV({ ...v, tractor_plate: e.target.value })} />
          <Input placeholder="Capacité (L)" inputMode="numeric" value={v.capacity_liters} onChange={(e) => setV({ ...v, capacity_liters: e.target.value })} />
          <Select value={v.driver_id} onChange={(e) => setV({ ...v, driver_id: e.target.value })} placeholder="Chauffeur" options={(drivers ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <Button variant="primary" disabled={!v.name} onClick={() => apiSend("POST", "/transport/vehicles", { ...v, capacity_liters: Number(v.capacity_liters) || 0, driver_id: v.driver_id ? Number(v.driver_id) : undefined }).then(() => { setV({ name: "", tractor_plate: "", trailer_plate: "", capacity_liters: "", driver_id: "" }); void mutate(); }).catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"))}>Ajouter</Button>
        </div>
      </Card>
      <Card title="Chauffeurs" padded={false}>
        <DataTable rows={drivers ?? []} rowKey={(x) => x.id} columns={[
          { key: "name", label: "Nom" },
          { key: "phone", label: "Téléphone", render: (x) => x.phone ?? "–" },
          { key: "license_number", label: "Permis", render: (x) => x.license_number ?? "–" },
          { key: "license_expiry", label: "Validité", render: (x) => (x.license_expiry && x.license_expiry < new Date().toISOString().slice(0, 10) ? <Badge tone="danger">Expiré {fmtDate(x.license_expiry)}</Badge> : fmtDate(x.license_expiry)) },
        ]} />
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-5">
          <Input placeholder="Nom" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          <Input placeholder="Téléphone" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
          <Input placeholder="N° de permis" value={d.license_number} onChange={(e) => setD({ ...d, license_number: e.target.value })} />
          <Input type="date" value={d.license_expiry} onChange={(e) => setD({ ...d, license_expiry: e.target.value })} />
          <Button variant="primary" disabled={!d.name} onClick={() => apiSend("POST", "/transport/drivers", d).then(() => { setD({ name: "", phone: "", license_number: "", license_expiry: "" }); void refreshDrivers(); })}>Ajouter</Button>
        </div>
      </Card>
    </div>
  );
}

interface Tariff { id: number; partner: Ref; product: string | null; rate: number; shortage_tolerance: number | null; shortage_price: number | null }

function Routes() {
  const { data: routes, mutate } = useApi<Array<{ id: number; name: string; distance_km: number; default_rate: number; tariffs: Tariff[] }>>("/transport/routes");
  const { data: ref } = useApi<Referentials>("/transport/referentials");
  const { data: settings } = useApi<TransportSettings>("/transport/settings");
  const [message, setMessage] = useState<string | null>(null);
  const productLabel = (code: string | null) => (code ? ref?.products.find((p) => p.code === code)?.label ?? code : "Tous produits");
  const tariffs = (routes ?? []).flatMap((route) => route.tariffs.map((t) => ({ ...t, route: route.name })));
  function saveTerms(t: Tariff, body: Record<string, unknown>) {
    setMessage(null);
    apiSend("PATCH", `/transport/tariffs/${t.id}`, body).then(() => { setMessage(`Conditions de manquant de ${t.partner.name} enregistrées.`); void mutate(); }).catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"));
  }
  const [r, setR] = useState({ name: "", distance_km: "", default_rate: "" });
  const [tariff, setTariff] = useState({ route_id: "", partner_id: "", product: "", rate: "" });
  return (
    <div className="space-y-6">
      <Card title="Routes tarifées" padded={false}>
        <DataTable rows={routes ?? []} rowKey={(x) => x.id} columns={[
          { key: "name", label: "Route" },
          { key: "distance_km", label: "Distance (km)", align: "right", render: (x) => String(x.distance_km) },
          { key: "default_rate", label: "Tarif par m³", align: "right", render: (x) => fmtGNF(x.default_rate) },
          { key: "tariffs", label: "Tarifs clients", render: (x) => x.tariffs.map((t) => `${t.partner.name}${t.product ? ` (${productLabel(t.product)})` : ""} : ${fmtShort(t.rate)}`).join(", ") || "–" },
        ]} />
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-4">
          <Input placeholder="Conakry - Siguiri" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
          <Input placeholder="Distance (km)" inputMode="numeric" value={r.distance_km} onChange={(e) => setR({ ...r, distance_km: e.target.value })} />
          <Input placeholder="Tarif par m³ (GNF)" inputMode="numeric" value={r.default_rate} onChange={(e) => setR({ ...r, default_rate: e.target.value })} />
          <Button variant="primary" disabled={!r.name} onClick={() => apiSend("POST", "/transport/routes", { name: r.name, distance_km: Number(r.distance_km) || 0, default_rate: Number(r.default_rate.replace(/\s/g, "")) || 0 }).then(() => { setR({ name: "", distance_km: "", default_rate: "" }); void mutate(); })}>Ajouter la route</Button>
        </div>
      </Card>
      <Card title="Tarif négocié par client">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <Select value={tariff.route_id} onChange={(e) => setTariff({ ...tariff, route_id: e.target.value })} placeholder="Route…" options={(routes ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <Select value={tariff.partner_id} onChange={(e) => setTariff({ ...tariff, partner_id: e.target.value })} placeholder="Client…" options={(ref?.clients ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <Select value={tariff.product} onChange={(e) => setTariff({ ...tariff, product: e.target.value })} placeholder="Tous produits" options={(ref?.products ?? []).map((p) => ({ value: p.code, label: p.label }))} />
          <Input placeholder="Tarif par m³" inputMode="numeric" value={tariff.rate} onChange={(e) => setTariff({ ...tariff, rate: e.target.value })} />
          <Button
            variant="primary"
            disabled={!tariff.route_id || !tariff.partner_id || !tariff.rate}
            onClick={() => {
              const route = routes?.find((x) => x.id === Number(tariff.route_id));
              if (!route) return;
              const tariffs = [...route.tariffs.map((t) => ({ partner_id: t.partner.id, product: t.product, rate: t.rate })), { partner_id: Number(tariff.partner_id), product: tariff.product || null, rate: Number(tariff.rate.replace(/\s/g, "")) }];
              void apiSend("PATCH", `/transport/routes/${route.id}`, { tariffs }).then(() => { setTariff({ route_id: "", partner_id: "", product: "", rate: "" }); void mutate(); });
            }}
          >
            Enregistrer le tarif
          </Button>
        </div>
      </Card>
      <Card title="Conditions de manquant par tarif" padded={false}>
        {message && <div className="p-3"><Notice>{message}</Notice></div>}
        <p className="px-5 pt-4 text-[13px] text-muted">Tolérance et prix du m³ prévus au contrat du client ; vides, ceux du client ou de la société et le prix du produit s&apos;appliquent. Fixés par la finance.</p>
        <DataTable rows={tariffs} rowKey={(t) => t.id} empty="Aucun tarif négocié." columns={[
          { key: "route", label: "Route" },
          { key: "partner", label: "Client", render: (t) => t.partner.name },
          { key: "product", label: "Produit", render: (t) => productLabel(t.product) },
          { key: "rate", label: "Tarif par m³", align: "right", render: (t) => fmtGNF(t.rate) },
          { key: "shortage_tolerance", label: "Tolérance (%)", align: "right", render: (t) => <Input disabled={!settings?.can_edit} className="w-24 text-right font-mono" placeholder="–" defaultValue={t.shortage_tolerance === null ? "" : String(t.shortage_tolerance).replace(".", ",")} onBlur={(e) => { const v = parseNumber(e.target.value); if (v !== t.shortage_tolerance) saveTerms(t, { shortage_tolerance: v }); }} /> },
          { key: "shortage_price", label: "Prix du m³ manquant", align: "right", render: (t) => <Input disabled={!settings?.can_edit} className="w-36 text-right font-mono" placeholder="Prix du produit" defaultValue={t.shortage_price ? String(t.shortage_price) : ""} onBlur={(e) => { const v = parseNumber(e.target.value) ?? 0; if (v !== (t.shortage_price ?? 0)) saveTerms(t, { shortage_price: v }); }} /> },
        ]} />
      </Card>
    </div>
  );
}
