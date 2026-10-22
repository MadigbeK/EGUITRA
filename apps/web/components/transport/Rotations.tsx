"use client";

import { useState } from "react";
import { CheckCheck, FileText, Plus, Smartphone } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Modal, Notice, Select } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDec, fmtGNF, fmtPct, fmtShort, pluriel } from "@/lib/format";
import { parseNumber, type Ref, type Referentials } from "./types";

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
  std_cost: number;
  estimated_margin: number;
  invoice: { id: number; name: string | null } | null;
}

const STATE = { draft: ["Saisie", "warn"], done: ["Validée", "accent"], invoiced: ["Facturée", "ok"], cancelled: ["Annulée", "neutral"] } as const;

/** Rotations : saisie, validation, facturation ; marge estimée tant qu'aucun frais n'est saisi. */
export function Rotations() {
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
        const claims = res.claims.length ? ` ${pluriel(res.claims.length, "créance sur chauffeur", "créances sur chauffeur")} en opérations diverses, à valider dans Journaux et OD.` : "";
        const unclaimed = res.unclaimed.length ? ` Sans fiche tiers, créance à passer à la main : ${res.unclaimed.map((u) => `${u.driver?.name ?? "chauffeur non renseigné"} (${u.rotation}, ${fmtGNF(u.amount)})`).join(", ")}.` : "";
        setMessage({ tone: res.unclaimed.length ? "danger" : "ok", text: `${pluriel(res.invoices.length, "facture créée", "factures créées")} en brouillon, à valider dans Ventes.${claims}${unclaimed}` });
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
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => mutate()} />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}
            empty="Aucune rotation pour ce filtre."
            columns={[
              { key: "sel", label: "", render: (r) => <input type="checkbox" readOnly checked={selected.includes(r.id)} aria-label={`Sélectionner la rotation ${r.name ?? r.id}`} /> },
              { key: "name", label: "N°", render: (r) => <span className="font-mono text-xs">{r.name ?? "–"}{r.source === "mobile" && <Smartphone className="ml-1 inline h-3 w-3 text-accent" />}</span> },
              { key: "date_loading", label: "Chargement", render: (r) => fmtDate(r.date_loading) },
              { key: "vehicle", label: "Ensemble", render: (r) => r.vehicle.name, sortValue: (r) => r.vehicle.name },
              { key: "client", label: "Client", render: (r) => r.client.name, sortValue: (r) => r.client.name },
              { key: "route", label: "Route", render: (r) => r.route.name },
              { key: "volume", label: "Livré (m³)", align: "right", render: (r) => <span title={r.over_capacity ? `Chargé au-delà de la capacité (${fmtDec(r.capacity_liters / 1000)} m³)` : undefined} className={r.over_capacity ? "text-danger" : ""}>{fmtDec(r.volume_delivered || r.volume_loaded)}{r.over_capacity && <span className="sr-only">, chargé au-delà de la capacité ({fmtDec(r.capacity_liters / 1000)} m³)</span>}</span> },
              { key: "shortage", label: "Manquant", align: "right", render: (r) => (r.shortage ? <span className={r.shortage_excess > 0 ? "font-semibold text-danger" : "text-muted"} title={r.shortage_excess > 0 ? `${fmtDec(r.shortage_excess)} m³ hors tolérance, ${fmtGNF(r.shortage_value)}` : "Dans la tolérance"}>{fmtDec(r.shortage)}<span className="sr-only">{r.shortage_excess > 0 ? `, ${fmtDec(r.shortage_excess)} m³ hors tolérance, ${fmtGNF(r.shortage_value)}` : ", dans la tolérance"}</span></span> : "–") },
              { key: "revenue", label: "Montant", align: "right", render: (r) => fmtGNF(r.revenue) },
              { key: "margin", label: "Marge", align: "right", render: (r) => (!r.total_cost && r.std_cost ? (
                <span className="italic text-muted" title={`Marge estimée avec le coût standard de la route (${fmtGNF(r.std_cost)}) : aucun frais saisi`}>{fmtShort(r.estimated_margin)} est.</span>
              ) : <span className={r.margin < 0 ? "text-danger" : ""}>{fmtShort(r.margin)} <span className="text-muted">({fmtPct(r.margin_rate, 0)})</span></span>) },
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
  const { data: ref, error: erreurChargement, mutate: majReferentiels } = useApi<Referentials>("/transport/referentials");
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
        <Etat error={erreurChargement} onRetry={() => majReferentiels()} />
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
          <GainEstime ref_={ref} f={f} />
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

/** Gain estimé à la saisie : montant facturable moins les forfaits de la route au prix du carburant en vigueur. */
function GainEstime({ ref_, f }: { ref_: Referentials; f: Record<string, string> }) {
  const route = ref_.routes.find((r) => String(r.id) === f.route_id);
  if (!route) return null;
  const volume = parseNumber(f.volume_delivered ?? "") ?? parseNumber(f.volume_loaded ?? "") ?? 0;
  const tariffs = route.tariffs.filter((t) => String(t.partner_id) === f.partner_id);
  const rate = parseNumber(f.rate ?? "") ?? (tariffs.find((t) => t.product === f.product) ?? tariffs.find((t) => !t.product))?.rate ?? route.default_rate;
  const fuel = route.std_fuel_liters * (ref_.fuel_price ?? 0);
  const standard = fuel + route.std_driver_bonus + route.std_tolls + route.std_other_costs;
  const revenue = volume * rate;
  if (!standard && !revenue) return null;
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--fond-doux,transparent)] p-3 ring-1 ring-line md:grid-cols-4">
      <div><div className="text-[12px] text-muted">Montant estimé</div><div className="font-mono text-[15px] text-ink">{fmtGNF(revenue)}</div></div>
      <div>
        <div className="text-[12px] text-muted">Coût standard de la route</div>
        <div className="font-mono text-[15px] text-ink">{fmtGNF(standard)}</div>
        {route.std_fuel_liters > 0 && !ref_.fuel_price && <div className="text-[11.5px] text-warn">Prix du carburant non renseigné (Routes et tarifs)</div>}
      </div>
      <div><div className="text-[12px] text-muted">Marge estimée</div><div className={`font-mono text-[15px] font-semibold ${revenue - standard < 0 ? "text-danger" : "text-ink"}`}>{fmtGNF(revenue - standard)}</div></div>
      <div className="text-[12px] leading-snug text-muted">
        {route.std_fuel_liters ? `${fmtDec(route.std_fuel_liters)} L à ${fmtGNF(ref_.fuel_price ?? 0)}, prime, péages et autres forfaits. ` : "Aucun forfait de carburant pour cette route. "}
        Figé à la validation de la rotation.
      </div>
    </div>
  );
}
