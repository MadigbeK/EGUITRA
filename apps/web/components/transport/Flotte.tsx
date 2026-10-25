"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Field, Input, Modal, Notice, Select } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { fmtDate, fmtGNF, fmtInt, pluriel } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { DOCUMENT_KINDS, OWNERSHIPS, VEHICLE_KINDS, parseNumber, type DepartureIssue, type Ownership, type Ref, type TransportSettings, type VehicleCharge, type VehicleDocument, type VehicleKind } from "./types";

interface Vehicle {
  id: number; name: string; tractor_plate: string | null; trailer_plate: string | null; brand: string | null; capacity_liters: number;
  driver: Ref | null; state: string; year: number | null; date_service: string | null; asset: Ref | null; ownership: Ownership; owner: Ref | null;
  charges: VehicleCharge[]; monthly_charges: number;
  vehicle_kind: VehicleKind; payload_tons: number | null; documents: VehicleDocument[]; document_issues: DepartureIssue[];
}

// Profils de la route d'écriture des ensembles (WRITE) : le parc tient les documents à jour.
const SAISIE: Profile[] = ["admin", "finance", "exploitation"];
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
  const [documenting, setDocumenting] = useState<Vehicle | null>(null);
  const saisie = useAutorise(SAISIE);
  const patch = (path: string, body: Record<string, unknown>, refresh: () => void) =>
    apiSend("PATCH", path, body).then(() => { setMessage(null); refresh(); }).catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"));
  return (
    <div className="space-y-6">
      {message && <Notice tone="danger">{message}</Notice>}
      <Card title="Ensembles routiers" padded={false}>
        <DataTable rows={vehicles ?? []} rowKey={(x) => x.id} columns={[
          { key: "name", label: "Code" },
          { key: "tractor_plate", label: "Tracteur", render: (x) => x.tractor_plate ?? "–" },
          { key: "vehicle_kind", label: "Profil", render: (x) => <Select disabled={!saisie} value={x.vehicle_kind} onChange={(e) => void patch(`/transport/vehicles/${x.id}`, { vehicle_kind: e.target.value }, () => void mutate())} options={VEHICLE_KINDS} /> },
          { key: "capacity_liters", label: "Capacité (L)", align: "right", render: (x) => fmtInt(x.capacity_liters) },
          { key: "payload_tons", label: "Charge utile (t)", align: "right", render: (x) => <Input disabled={!saisie} className="w-20 text-right font-mono" inputMode="decimal" defaultValue={x.payload_tons ? String(x.payload_tons).replace(".", ",") : ""} onBlur={(e) => (parseNumber(e.target.value) ?? 0) !== (x.payload_tons ?? 0) && void patch(`/transport/vehicles/${x.id}`, { payload_tons: parseNumber(e.target.value) ?? 0 }, () => void mutate())} /> },
          { key: "documents", label: "Documents", render: (x) => <EtatDocuments vehicle={x} onOpen={() => setDocumenting(x)} /> },
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
          { key: "monthly_charges", label: "Charges / mois (GNF)", align: "right", render: (x) => (
            <button type="button" className="font-mono underline decoration-dotted underline-offset-4 hover:text-accent" onClick={(e) => { e.stopPropagation(); setCharging(x); }}>
              <span className="sr-only">Charges mensuelles de {x.name} : </span>
              {x.monthly_charges ? fmtInt(x.monthly_charges) : settings?.can_edit ? "Saisir" : "–"}
              {x.monthly_charges > 0 && <span className="sr-only"> GNF</span>}
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
      {documenting && <DocumentsModal vehicle={documenting} canEdit={saisie} onClose={() => setDocumenting(null)} onSaved={() => { setDocumenting(null); void mutate(); }} />}
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

/** État des documents d'un ensemble : à jour, à renouveler, ou manquants et expirés (ces derniers s'opposent au départ). */
function EtatDocuments({ vehicle, onOpen }: { vehicle: Vehicle; onOpen: () => void }) {
  const bloquants = vehicle.document_issues.filter((i) => i.severity === "block").length;
  const vigilance = vehicle.document_issues.length - bloquants;
  const titre = vehicle.document_issues.map((i) => i.message).join("\n") || "Documents exigés à jour";
  return (
    <button type="button" title={titre} className="inline-flex items-center gap-1.5" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
      {bloquants ? <Badge tone="danger">{pluriel(bloquants, "manquant ou expiré", "manquants ou expirés")}</Badge> : vigilance ? <Badge tone="warn">{pluriel(vigilance, "à renouveler", "à renouveler")}</Badge> : <Badge tone="ok">À jour</Badge>}
      <span className="sr-only">Documents de {vehicle.name}</span>
    </button>
  );
}

/** Documents d'un ensemble avec leur date d'expiration : assurance, visite technique, barémage et étanchéité d'une citerne. */
function DocumentsModal({ vehicle, canEdit, onClose, onSaved }: { vehicle: Vehicle; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<VehicleDocument[]>(vehicle.documents.map((d) => ({ ...d })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<VehicleDocument>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("PATCH", `/transport/vehicles/${vehicle.id}`, { documents: lines.filter((l) => l.date_expiry).map(({ kind, name, reference, issuer, date_issue, date_expiry }) => ({ kind, name, reference, issuer, date_issue, date_expiry })) });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  const requis = vehicle.vehicle_kind === "tipper" ? "assurance et visite technique" : "assurance, visite technique, barémage et certificat d'étanchéité de la citerne";
  return (
    <Modal open wide title={`Documents de ${vehicle.name}`} onClose={onClose} footer={canEdit ? <Button variant="primary" loading={busy} onClick={() => void save()}>Enregistrer</Button> : undefined}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="text-[13px] text-muted">
          Exigés pour {vehicle.vehicle_kind === "tipper" ? "une benne" : "une citerne"} : {requis}. Un document manquant ou expiré s&apos;opposera au départ de l&apos;ensemble ;
          il est à renouveler dans les 30 jours qui précèdent son expiration.
        </p>
        {vehicle.document_issues.length > 0 && <Notice tone={vehicle.document_issues.some((i) => i.severity === "block") ? "danger" : "warn"}>{vehicle.document_issues.map((i) => i.message).join(" ")}</Notice>}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <Field label="Document" className="md:col-span-3"><Select disabled={!canEdit} value={l.kind} onChange={(e) => set(i, { kind: e.target.value as VehicleDocument["kind"] })} options={DOCUMENT_KINDS} /></Field>
            <Field label="Numéro" className="md:col-span-2"><Input disabled={!canEdit} value={l.reference ?? ""} onChange={(e) => set(i, { reference: e.target.value || null })} /></Field>
            <Field label="Délivré par" className="md:col-span-3"><Input disabled={!canEdit} value={l.issuer ?? ""} placeholder="Assureur, centre de visite…" onChange={(e) => set(i, { issuer: e.target.value || null })} /></Field>
            <Field label="Délivré le" className="md:col-span-2"><Input disabled={!canEdit} type="date" value={l.date_issue ?? ""} onChange={(e) => set(i, { date_issue: e.target.value || null })} /></Field>
            <Field label="Valable jusqu'au" className="md:col-span-2"><Input disabled={!canEdit} type="date" value={l.date_expiry} onChange={(e) => set(i, { date_expiry: e.target.value })} /></Field>
            {canEdit && <button type="button" title="Retirer" className="mb-2 text-muted hover:text-danger" onClick={() => setLines(lines.filter((_l, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {canEdit && <Button onClick={() => setLines([...lines, { kind: "insurance", name: null, reference: null, issuer: null, date_issue: null, date_expiry: "" }])}><Plus className="h-4 w-4" /> Ajouter un document</Button>}
        {!lines.length && <p className="text-[13px] text-muted">Aucun document enregistré.</p>}
      </div>
    </Modal>
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
