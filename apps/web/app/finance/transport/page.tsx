"use client";

import { useState } from "react";
import { CheckCheck, Download, Droplet, FileText, Percent, Plus, Receipt, Smartphone, TrendingUp } from "@/components/icons";
import { Badge, Button, Card, Compteur, DataTable, ErrorBox, Field, IconTile, Input, Kpi, Loading, Modal, Notice, PageHeader, Repartition, Select, Tabs } from "@/components/ui";
import { Manquants } from "@/components/transport/Manquants";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { Parametres } from "@/components/transport/Parametres";
import { Rentabilite } from "@/components/transport/Rentabilite";
import { Taxes } from "@/components/transport/Taxes";
import { parseNumber, type Ref, type Referentials, type TransportSettings } from "@/components/transport/types";
import { ApiError, apiDownload, apiSend, useApi } from "@/lib/api-client";
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
  invoice: { id: number; name: string | null } | null;
}

const STATE = { draft: ["Saisie", "warn"], done: ["Validée", "accent"], invoiced: ["Facturée", "ok"], cancelled: ["Annulée", "neutral"] } as const;
type Tab = "rotations" | "rentabilite" | "manquants" | "taxes" | "flotte" | "routes" | "parametres";

export default function TransportPage() {
  const [tab, setTab] = useState<Tab>("rotations");
  // margin_min : marge minimale de la règle d'alerte (30 % par défaut) ; null : seuil à 0, la marge n'est pas jugée.
  const { data: summary } = useApi<{ rotations: number; volume: number; revenue: number; margin: number; margin_rate: number | null; margin_min: number | null; to_invoice: { count: number; amount: number }; shortage_excess: { count: number; volume: number; value: number }; drafts: number; fleet: Record<string, number> }>("/transport/summary");
  const sousMinimum = Boolean(summary && summary.margin_rate !== null && summary.margin_min !== null && summary.margin_rate < summary.margin_min);
  return (
    <div>
      <PageHeader
        title="Transport pétrolier"
        subtitle="La rotation est la source unique : facturation, coûts par ensemble et par route, marge."
        actions={
          <Button onClick={() => apiDownload(`/transport/exports/rotations?format=xlsx`, "rotations.xlsx")}>
            <Download className="h-4 w-4" /> Exporter les rotations
          </Button>
        }
      />
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
            <Kpi
              label="Marge du mois"
              value={fmtShort(summary.margin)}
              icon={Percent}
              teinte={sousMinimum ? "ambre" : "jade"}
              tone={summary.margin_rate === null || summary.margin_min === null ? "neutral" : sousMinimum ? "warn" : "ok"}
              hint={`Taux de marge ${fmtPct(summary.margin_rate)}, ${summary.margin_min !== null ? `minimum ${fmtPct(summary.margin_min, 0)}` : "seuil non fixé"}`}
            />
            <Kpi label="À facturer" value={fmtShort(summary.to_invoice.amount)} icon={Receipt} teinte="or" tone="accent" hint={`${summary.to_invoice.count} rotation(s) validée(s)`} />
            <Kpi label="Saisies à valider" value={String(summary.drafts)} icon={Smartphone} teinte="corail" tone={summary.drafts > 0 ? "warn" : "neutral"} hint="Rotations saisies au bureau ou au parc" />
          </div>
        </div>
      )}
      <Tabs tabs={[{ key: "rotations", label: "Rotations" }, { key: "rentabilite", label: "Rentabilité" }, { key: "manquants", label: "Manquants" }, { key: "taxes", label: "Taxes spécifiques" }, { key: "flotte", label: "Flotte et chauffeurs" }, { key: "routes", label: "Routes et tarifs" }, { key: "parametres", label: "Paramètres" }]} value={tab} onChange={setTab} />
      {tab === "rotations" && <Rotations />}
      {tab === "rentabilite" && <Rentabilite />}
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
        const claims = res.claims.length ? ` ${res.claims.length} créance(s) sur chauffeur en opérations diverses, à valider dans Journaux et OD.` : "";
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
      if (!f.date_return) delete body.date_return;
      for (const k of ["volume_loaded", "volume_delivered", "rate", "distance_km", ...(ref?.measures ?? []).map((m) => m.code), ...(ref?.costs.map((c) => c.code) ?? [])]) {
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
            <Field label="Retour au dépôt"><Input type="date" value={f.date_return ?? ""} onChange={set("date_return")} /></Field>
            <Field label="Distance parcourue (km)" hint="Vide : aller-retour de la route"><Input inputMode="numeric" value={f.distance_km ?? ""} onChange={set("distance_km")} /></Field>
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

interface Vehicle { id: number; name: string; tractor_plate: string | null; trailer_plate: string | null; brand: string | null; capacity_liters: number; driver: Ref | null; state: string; year: number | null; date_service: string | null; asset: Ref | null }
interface Driver { id: number; name: string; phone: string | null; license_number: string | null; license_expiry: string | null; partner: Ref | null }

const VEHICLE_STATES = [{ value: "service", label: "En service" }, { value: "maintenance", label: "Maintenance" }, { value: "off", label: "Hors service" }, { value: "sold", label: "Cédé" }];

function Fleet() {
  const { data: vehicles, mutate } = useApi<Vehicle[]>("/transport/vehicles");
  const { data: drivers, mutate: refreshDrivers } = useApi<Driver[]>("/transport/drivers");
  const { data: settings } = useApi<TransportSettings>("/transport/settings");
  const { data: assets } = useApi<{ items: Array<{ id: number; name: string; code: string | null; state: string }> }>(settings?.can_edit ? "/finance/assets" : null);
  const [v, setV] = useState({ name: "", tractor_plate: "", trailer_plate: "", capacity_liters: "", driver_id: "", year: "" });
  const [d, setD] = useState({ name: "", phone: "", license_number: "", license_expiry: "" });
  const [message, setMessage] = useState<string | null>(null);
  const patch = (path: string, body: Record<string, unknown>, refresh: () => void) =>
    apiSend("PATCH", path, body).then(() => { setMessage(null); refresh(); }).catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"));
  return (
    <div className="space-y-6">
      {message && <Notice tone="danger">{message}</Notice>}
      <Card title="Ensembles routiers" padded={false}>
        <DataTable rows={vehicles ?? []} rowKey={(x) => x.id} columns={[
          { key: "name", label: "Code" },
          { key: "tractor_plate", label: "Tracteur", render: (x) => x.tractor_plate ?? "–" },
          { key: "capacity_liters", label: "Capacité (L)", align: "right", render: (x) => x.capacity_liters.toLocaleString("fr-FR") },
          { key: "year", label: "Année", align: "right", render: (x) => <Input className="w-20 text-right font-mono" defaultValue={x.year ?? ""} inputMode="numeric" onBlur={(e) => Number(e.target.value || 0) !== (x.year ?? 0) && void patch(`/transport/vehicles/${x.id}`, { year: Number(e.target.value || 0) }, () => void mutate())} /> },
          { key: "date_service", label: "Mise en service", render: (x) => <Input type="date" className="w-36" defaultValue={x.date_service ?? ""} onBlur={(e) => e.target.value !== (x.date_service ?? "") && void patch(`/transport/vehicles/${x.id}`, { date_service: e.target.value || null }, () => void mutate())} /> },
          { key: "asset", label: "Immobilisation", render: (x) => (settings?.can_edit && assets ? (
            <Select value={x.asset?.id ?? ""} placeholder="Non rattaché" onChange={(e) => void patch(`/transport/vehicles/${x.id}`, { asset_id: e.target.value ? Number(e.target.value) : null }, () => void mutate())} options={assets.items.filter((a) => a.state !== "removed").map((a) => ({ value: a.id, label: a.code ? `${a.code} ${a.name}` : a.name }))} />
          ) : x.asset ? x.asset.name : <Badge tone={x.state === "service" || x.state === "maintenance" ? "warn" : "neutral"}>Non rattaché</Badge>) },
          { key: "driver", label: "Chauffeur", render: (x) => <Select value={x.driver?.id ?? ""} placeholder="–" onChange={(e) => void patch(`/transport/vehicles/${x.id}`, { driver_id: e.target.value ? Number(e.target.value) : null }, () => void mutate())} options={(drivers ?? []).map((dr) => ({ value: dr.id, label: dr.name }))} /> },
          { key: "state", label: "État", render: (x) => <Select value={x.state} onChange={(e) => void patch(`/transport/vehicles/${x.id}`, { state: e.target.value }, () => void mutate())} options={VEHICLE_STATES} /> },
        ]} />
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-7">
          <Input placeholder="Code (ER-01)" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <Input placeholder="Plaque tracteur" value={v.tractor_plate} onChange={(e) => setV({ ...v, tractor_plate: e.target.value })} />
          <Input placeholder="Plaque citerne" value={v.trailer_plate} onChange={(e) => setV({ ...v, trailer_plate: e.target.value })} />
          <Input placeholder="Capacité (L)" inputMode="numeric" value={v.capacity_liters} onChange={(e) => setV({ ...v, capacity_liters: e.target.value })} />
          <Input placeholder="Année" inputMode="numeric" value={v.year} onChange={(e) => setV({ ...v, year: e.target.value })} />
          <Select value={v.driver_id} onChange={(e) => setV({ ...v, driver_id: e.target.value })} placeholder="Chauffeur" options={(drivers ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <Button variant="primary" disabled={!v.name} onClick={() => apiSend("POST", "/transport/vehicles", { ...v, capacity_liters: Number(v.capacity_liters) || 0, year: Number(v.year) || 0, driver_id: v.driver_id ? Number(v.driver_id) : undefined }).then(() => { setV({ name: "", tractor_plate: "", trailer_plate: "", capacity_liters: "", driver_id: "", year: "" }); void mutate(); }).catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"))}>Ajouter</Button>
        </div>
      </Card>
      <Card title="Chauffeurs" padded={false}>
        <DataTable rows={drivers ?? []} rowKey={(x) => x.id} columns={[
          { key: "name", label: "Nom" },
          { key: "phone", label: "Téléphone", render: (x) => x.phone ?? "–" },
          { key: "license_number", label: "Permis", render: (x) => x.license_number ?? "–" },
          { key: "license_expiry", label: "Validité", render: (x) => (x.license_expiry && x.license_expiry < new Date().toISOString().slice(0, 10) ? <Badge tone="danger">Expiré {fmtDate(x.license_expiry)}</Badge> : fmtDate(x.license_expiry)) },
          { key: "partner", label: "Fiche tiers", render: (x) => <div className="min-w-56"><PartnerPicker kind="supplier" value={x.partner} placeholder="Frais de mission, manquants…" onChange={(p) => void patch(`/transport/drivers/${x.id}`, { partner_id: p?.id ?? null }, () => void refreshDrivers())} /></div> },
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
interface RouteRow { id: number; name: string; distance_km: number; distance_return_km: number | null; round_trip_km: number; round_trip_inconsistent: boolean; duration_days: number | null; default_rate: number; tariffs: Tariff[] }

function Routes() {
  const { data: routes, mutate } = useApi<RouteRow[]>("/transport/routes");
  const { data: ref } = useApi<Referentials>("/transport/referentials");
  const { data: settings } = useApi<TransportSettings>("/transport/settings");
  const [message, setMessage] = useState<string | null>(null);
  const productLabel = (code: string | null) => (code ? ref?.products.find((p) => p.code === code)?.label ?? code : "Tous produits");
  const tariffs = (routes ?? []).flatMap((route) => route.tariffs.map((t) => ({ ...t, route: route.name })));
  function saveTerms(t: Tariff, body: Record<string, unknown>) {
    setMessage(null);
    apiSend("PATCH", `/transport/tariffs/${t.id}`, body).then(() => { setMessage(`Conditions de manquant de ${t.partner.name} enregistrées.`); void mutate(); }).catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"));
  }
  function patchRoute(route: RouteRow, body: Record<string, unknown>) {
    setMessage(null);
    apiSend("PATCH", `/transport/routes/${route.id}`, body).then(() => void mutate()).catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"));
  }
  const [r, setR] = useState({ name: "", distance_km: "", distance_return_km: "", duration_days: "", default_rate: "" });
  const [tariff, setTariff] = useState({ route_id: "", partner_id: "", product: "", rate: "" });
  return (
    <div className="space-y-6">
      {message && <Notice>{message}</Notice>}
      <Card title="Routes tarifées" padded={false}>
        <DataTable rows={routes ?? []} rowKey={(x) => x.id} columns={[
          { key: "name", label: "Route" },
          { key: "distance_km", label: "Aller (km)", align: "right", render: (x) => <Input className="w-24 text-right font-mono" inputMode="numeric" defaultValue={x.distance_km || ""} onBlur={(e) => Number(e.target.value || 0) !== x.distance_km && patchRoute(x, { distance_km: Number(e.target.value || 0) })} /> },
          { key: "distance_return_km", label: "Aller-retour (km)", align: "right", render: (x) => (
            <span className="inline-flex items-center gap-2">
              {x.round_trip_inconsistent && <span title="Écart de plus de 15 % avec deux fois l'aller"><Badge tone="warn">Incohérent</Badge></span>}
              <Input className="w-24 text-right font-mono" inputMode="numeric" placeholder={String(x.round_trip_km || "")} defaultValue={x.distance_return_km ?? ""} onBlur={(e) => Number(e.target.value || 0) !== (x.distance_return_km ?? 0) && patchRoute(x, { distance_return_km: Number(e.target.value || 0) })} />
            </span>
          ) },
          { key: "duration_days", label: "Durée (j)", align: "right", render: (x) => <Input className="w-20 text-right font-mono" inputMode="decimal" defaultValue={x.duration_days ? String(x.duration_days).replace(".", ",") : ""} onBlur={(e) => (parseNumber(e.target.value) ?? 0) !== (x.duration_days ?? 0) && patchRoute(x, { duration_days: parseNumber(e.target.value) ?? 0 })} /> },
          { key: "default_rate", label: "Tarif par m³", align: "right", render: (x) => fmtGNF(x.default_rate) },
          { key: "tariffs", label: "Tarifs clients", render: (x) => x.tariffs.map((t) => `${t.partner.name}${t.product ? ` (${productLabel(t.product)})` : ""} : ${fmtShort(t.rate)}`).join(", ") || "–" },
        ]} />
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-6">
          <Input placeholder="Conakry - Siguiri" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
          <Input placeholder="Aller (km)" inputMode="numeric" value={r.distance_km} onChange={(e) => setR({ ...r, distance_km: e.target.value })} />
          <Input placeholder="Aller-retour (km)" inputMode="numeric" value={r.distance_return_km} onChange={(e) => setR({ ...r, distance_return_km: e.target.value })} />
          <Input placeholder="Durée (jours)" inputMode="decimal" value={r.duration_days} onChange={(e) => setR({ ...r, duration_days: e.target.value })} />
          <Input placeholder="Tarif par m³ (GNF)" inputMode="numeric" value={r.default_rate} onChange={(e) => setR({ ...r, default_rate: e.target.value })} />
          <Button variant="primary" disabled={!r.name} onClick={() => apiSend("POST", "/transport/routes", { name: r.name, distance_km: Number(r.distance_km) || 0, distance_return_km: Number(r.distance_return_km) || 0, duration_days: parseNumber(r.duration_days) ?? 0, default_rate: parseNumber(r.default_rate) ?? 0 }).then(() => { setR({ name: "", distance_km: "", distance_return_km: "", duration_days: "", default_rate: "" }); void mutate(); }).catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"))}>Ajouter la route</Button>
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
              const tariffs = [...route.tariffs.map((t) => ({ partner_id: t.partner.id, product: t.product, rate: t.rate })), { partner_id: Number(tariff.partner_id), product: tariff.product || null, rate: parseNumber(tariff.rate) ?? 0 }];
              void apiSend("PATCH", `/transport/routes/${route.id}`, { tariffs }).then(() => { setTariff({ route_id: "", partner_id: "", product: "", rate: "" }); void mutate(); });
            }}
          >
            Enregistrer le tarif
          </Button>
        </div>
      </Card>
      <Card title="Conditions de manquant par tarif" padded={false}>
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
