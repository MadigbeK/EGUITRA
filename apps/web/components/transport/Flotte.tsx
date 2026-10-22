"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Field, Input, Modal, Notice, Select } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF } from "@/lib/format";
import { OWNERSHIPS, parseNumber, type Ownership, type Ref, type TransportSettings, type VehicleCharge } from "./types";

interface Vehicle { id: number; name: string; tractor_plate: string | null; trailer_plate: string | null; brand: string | null; capacity_liters: number; driver: Ref | null; state: string; year: number | null; date_service: string | null; asset: Ref | null; ownership: Ownership; owner: Ref | null; charges: VehicleCharge[]; monthly_charges: number }
interface Driver { id: number; name: string; phone: string | null; license_number: string | null; license_expiry: string | null; partner: Ref | null }

const VEHICLE_STATES = [{ value: "service", label: "En service" }, { value: "maintenance", label: "Maintenance" }, { value: "off", label: "Hors service" }, { value: "sold", label: "Cédé" }];

export function Flotte() {
  const { data: vehicles, mutate } = useApi<Vehicle[]>("/transport/vehicles");
  const { data: drivers, mutate: refreshDrivers } = useApi<Driver[]>("/transport/drivers");
  const { data: settings } = useApi<TransportSettings>("/transport/settings");
  const { data: assets } = useApi<{ items: Array<{ id: number; name: string; code: string | null; state: string }> }>(settings?.can_edit ? "/finance/assets" : null);
  const [v, setV] = useState({ name: "", tractor_plate: "", trailer_plate: "", capacity_liters: "", driver_id: "", year: "" });
  const [d, setD] = useState({ name: "", phone: "", license_number: "", license_expiry: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [charging, setCharging] = useState<Vehicle | null>(null);
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
          { key: "ownership", label: "Propriété", render: (x) => (settings?.can_edit ? (
            <div className="flex min-w-64 flex-col gap-1.5">
              <Select value={x.ownership} onChange={(e) => void patch(`/transport/vehicles/${x.id}`, { ownership: e.target.value }, () => void mutate())} options={OWNERSHIPS} />
              {x.ownership === "managed" && <PartnerPicker kind="supplier" value={x.owner} placeholder="Propriétaire…" onChange={(p) => void patch(`/transport/vehicles/${x.id}`, { owner_id: p?.id ?? null }, () => void mutate())} />}
            </div>
          ) : x.ownership === "managed" ? <span>Géré · {x.owner?.name ?? "–"}</span> : "Propre") },
          { key: "monthly_charges", label: "Charges / mois", align: "right", render: (x) => (
            <button type="button" className="font-mono underline decoration-dotted underline-offset-4 hover:text-accent" onClick={(e) => { e.stopPropagation(); setCharging(x); }}>
              {x.monthly_charges ? fmtGNF(x.monthly_charges) : settings?.can_edit ? "Saisir" : "–"}
            </button>
          ) },
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
      {charging && <ChargesModal vehicle={charging} canEdit={Boolean(settings?.can_edit)} onClose={() => setCharging(null)} onSaved={() => { setCharging(null); void mutate(); }} />}
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

/** Charges mensuelles d'un ensemble (assurance, géolocalisation, vignettes…) : relevés des propriétaires. */
function ChargesModal({ vehicle, canEdit, onClose, onSaved }: { vehicle: Vehicle; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<VehicleCharge[]>(vehicle.charges.map((c) => ({ ...c })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<VehicleCharge>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const monthly = lines.reduce((sum, l) => sum + (l.periodicity === "year" ? l.amount / 12 : l.amount), 0);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("PATCH", `/transport/vehicles/${vehicle.id}`, { charges: lines.filter((l) => l.name.trim()).map(({ name, amount, periodicity, date_from, date_to }) => ({ name, amount, periodicity, date_from, date_to })) });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open wide title={`Charges mensuelles de ${vehicle.name}`} onClose={onClose} footer={canEdit ? <Button variant="primary" loading={busy} onClick={() => void save()}>Enregistrer</Button> : undefined}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="text-[13px] text-muted">
          Charges fixes de l&apos;ensemble, retenues dans les relevés des propriétaires au prorata des jours de la période (base « frais déclarés »).
          Une charge annuelle compte pour un douzième par mois. Total : <span className="font-mono text-ink">{fmtGNF(monthly)}</span> par mois.
        </p>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <Field label="Charge" className="md:col-span-3"><Input disabled={!canEdit} value={l.name} placeholder="Assurance, GPS, vignette…" onChange={(e) => set(i, { name: e.target.value })} /></Field>
            <Field label="Montant" className="md:col-span-2"><Input disabled={!canEdit} inputMode="numeric" className="font-mono" value={l.amount ? String(l.amount) : ""} onChange={(e) => set(i, { amount: parseNumber(e.target.value) ?? 0 })} /></Field>
            <Field label="Périodicité" className="md:col-span-2"><Select disabled={!canEdit} value={l.periodicity} onChange={(e) => set(i, { periodicity: e.target.value as VehicleCharge["periodicity"] })} options={[{ value: "month", label: "Mensuelle" }, { value: "year", label: "Annuelle" }]} /></Field>
            <Field label="Du" className="md:col-span-2"><Input disabled={!canEdit} type="date" value={l.date_from ?? ""} onChange={(e) => set(i, { date_from: e.target.value || null })} /></Field>
            <Field label="Au" className="md:col-span-2"><Input disabled={!canEdit} type="date" value={l.date_to ?? ""} onChange={(e) => set(i, { date_to: e.target.value || null })} /></Field>
            {canEdit && <button type="button" title="Retirer" className="mb-2 text-muted hover:text-danger md:col-span-1" onClick={() => setLines(lines.filter((_l, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {canEdit && <Button onClick={() => setLines([...lines, { name: "", amount: 0, periodicity: "month", date_from: null, date_to: null }])}><Plus className="h-4 w-4" /> Ajouter une charge</Button>}
      </div>
    </Modal>
  );
}
