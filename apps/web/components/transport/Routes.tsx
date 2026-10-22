"use client";

import { useState } from "react";
import { Fuel, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Input, Notice, Select } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDec, fmtGNF, fmtShort } from "@/lib/format";
import { parseNumber, type Ref, type Referentials, type RouteStandards, type TransportSettings } from "./types";

interface Tariff { id: number; partner: Ref; product: string | null; rate: number; shortage_tolerance: number | null; shortage_price: number | null }
interface RouteRow extends RouteStandards { id: number; name: string; distance_km: number; distance_return_km: number | null; round_trip_km: number; round_trip_inconsistent: boolean; duration_days: number | null; default_rate: number; tariffs: Tariff[]; fuel_per_km: number | null }

/** Routes, coûts standard, prix du carburant, tarifs négociés et conditions de manquant. */
export function RoutesTarifs() {
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
          { key: "std_fuel_liters", label: "Carburant réf. (L)", align: "right", render: (x) => (
            <span className="inline-flex items-center gap-2">
              {x.fuel_per_km !== null && <span className="text-[11.5px] text-muted" title="Litres par km parcouru, aller et retour">{fmtDec(x.fuel_per_km)} L/km</span>}
              <Input className="w-20 text-right font-mono" inputMode="decimal" defaultValue={x.std_fuel_liters || ""} onBlur={(e) => (parseNumber(e.target.value) ?? 0) !== x.std_fuel_liters && patchRoute(x, { std_fuel_liters: parseNumber(e.target.value) ?? 0 })} />
            </span>
          ) },
          ...(["std_driver_bonus", "std_tolls", "std_other_costs"] as const).map((k) => ({
            key: k, label: { std_driver_bonus: "Prime de route", std_tolls: "Péages", std_other_costs: "Autres frais" }[k], align: "right" as const,
            render: (x: RouteRow) => <Input className="w-28 text-right font-mono" inputMode="numeric" defaultValue={x[k] || ""} onBlur={(e) => (parseNumber(e.target.value) ?? 0) !== x[k] && patchRoute(x, { [k]: parseNumber(e.target.value) ?? 0 })} />,
          })),
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
      <PrixCarburant canEdit={Boolean(settings?.can_edit)} />
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

/** Prix du carburant de la flotte : coût standard des rotations (prix applicable à la date de chargement). */
function PrixCarburant({ canEdit }: { canEdit: boolean }) {
  const { data, mutate } = useApi<{ current: number; items: Array<{ id: number; date_from: string; price: number; note: string | null }> }>("/transport/fuel-prices");
  const [form, setForm] = useState({ date_from: new Date().toISOString().slice(0, 10), price: "", note: "" });
  const [message, setMessage] = useState<string | null>(null);
  async function send(method: "POST" | "DELETE", path: string, body?: Record<string, unknown>) {
    setMessage(null);
    try {
      await apiSend(method, path, body);
      void mutate();
      return true;
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erreur");
      return false;
    }
  }
  return (
    <Card title="Prix du carburant" padded={false} actions={data ? <span className="inline-flex items-center gap-1.5 text-[13px] text-muted"><Fuel className="h-4 w-4" /> En vigueur : <span className="font-mono text-ink">{data.current ? `${fmtGNF(data.current)} / L` : "non renseigné"}</span></span> : undefined}>
      <p className="px-5 pt-4 text-[13px] text-muted">
        Prix du litre appliqué aux forfaits de carburant des routes (coût standard). Une rotation prend le prix en vigueur à sa date de
        chargement ; validée, elle le garde : un nouveau prix ne réécrit pas les rotations passées.
      </p>
      {message && <div className="px-5 pt-3"><Notice tone="danger">{message}</Notice></div>}
      <DataTable rows={data?.items ?? []} rowKey={(x) => x.id} empty="Aucun prix enregistré." columns={[
        { key: "date_from", label: "À partir du", render: (x) => fmtDate(x.date_from) },
        { key: "price", label: "Prix du litre", align: "right", render: (x) => fmtGNF(x.price) },
        { key: "note", label: "Source", render: (x) => x.note ?? "–" },
        { key: "actions", label: "", render: (x) => (canEdit ? <button type="button" title="Supprimer" className="text-muted hover:text-danger" onClick={() => void send("DELETE", `/transport/fuel-prices/${x.id}`)}><Trash2 className="h-4 w-4" /></button> : null) },
      ]} />
      {canEdit && (
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-5">
          <Input type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} />
          <Input placeholder="Prix du litre (GNF)" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <Input className="md:col-span-2" placeholder="Source (structure des prix d'octobre…)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Button variant="primary" disabled={!form.date_from || !parseNumber(form.price)} onClick={() => void send("POST", "/transport/fuel-prices", { date_from: form.date_from, price: parseNumber(form.price), note: form.note || null }).then((ok) => ok && setForm({ ...form, price: "", note: "" }))}>Enregistrer le prix</Button>
        </div>
      )}
    </Card>
  );
}
