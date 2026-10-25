"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Modal, Notice, Select, cx } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiDownload, apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { AIDE_NOMBRE, fmtGNF, fmtInt, nombreIllisible, pluriel } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { CHAMP_INVALIDE, NombreSurPlace, TexteSurPlace } from "./commun";
import { DOCUMENT_KINDS, OWNERSHIPS, VEHICLE_KINDS, parseNumber, type DepartureIssue, type Ownership, type Ref, type TransportSettings, type VehicleCharge, type VehicleDocument, type VehicleKind } from "./types";

interface Vehicle {
  id: number; name: string; tractor_plate: string | null; trailer_plate: string | null; brand: string | null; capacity_liters: number;
  driver: Ref | null; state: string; year: number | null; date_service: string | null; asset: Ref | null; ownership: Ownership; owner: Ref | null;
  charges: VehicleCharge[]; monthly_charges: number;
  vehicle_kind: VehicleKind; payload_tonnes: number | null; documents: VehicleDocument[]; document_issues: DepartureIssue[];
}

// Profils de la route d'écriture des ensembles (WRITE) : le parc tient les documents à jour.
const SAISIE: Profile[] = ["admin", "finance", "exploitation"];
interface Driver { id: number; name: string; phone: string | null; license_number: string | null; license_expiry: string | null; partner: Ref | null }

const VIDE_ENSEMBLE = { name: "", tractor_plate: "", trailer_plate: "", capacity_liters: "", driver_id: "", year: "" };
const VIDE_CHAUFFEUR = { name: "", phone: "", license_number: "", license_expiry: "" };

const VEHICLE_STATES = [{ value: "service", label: "En service" }, { value: "maintenance", label: "Maintenance" }, { value: "off", label: "Hors service" }, { value: "sold", label: "Cédé" }];

export function Flotte() {
  const { data: vehicles, error: erreurEnsembles, mutate } = useApi<Vehicle[]>("/transport/vehicles");
  const { data: drivers, error: erreurChauffeurs, mutate: refreshDrivers } = useApi<Driver[]>("/transport/drivers");
  const { data: settings } = useApi<TransportSettings>("/transport/settings");
  const { data: assets } = useApi<{ items: Array<{ id: number; name: string; code: string | null; state: string }> }>(settings?.can_edit ? "/finance/assets" : null);
  const [v, setV] = useState(VIDE_ENSEMBLE);
  const [d, setD] = useState(VIDE_CHAUFFEUR);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<"ensemble" | "chauffeur" | null>(null);
  const [charging, setCharging] = useState<Vehicle | null>(null);
  const [documenting, setDocumenting] = useState<Vehicle | null>(null);
  // La direction lit la flotte : le noyau réserve l'écriture à l'administration, la finance et l'exploitation.
  const saisie = useAutorise(SAISIE);
  const echec = (e: unknown) => setMessage(e instanceof ApiError ? e.message : "Enregistrement impossible.");
  const patch = (path: string, body: Record<string, unknown>, refresh: () => void) =>
    apiSend("PATCH", path, body).then(() => { setMessage(null); refresh(); }).catch(echec);
  const patchVehicle = (x: Vehicle, body: Record<string, unknown>) => patch(`/transport/vehicles/${x.id}`, body, () => void mutate());
  const patchDriver = (x: Driver, body: Record<string, unknown>) => patch(`/transport/drivers/${x.id}`, body, () => void refreshDrivers());
  const ensembleIllisible = nombreIllisible(v.capacity_liters) || nombreIllisible(v.year);

  async function ajouter(kind: "ensemble" | "chauffeur") {
    setEnvoi(kind);
    setMessage(null);
    try {
      if (kind === "ensemble") {
        await apiSend("POST", "/transport/vehicles", { ...v, capacity_liters: Math.round(parseNumber(v.capacity_liters) ?? 0), year: Math.round(parseNumber(v.year) ?? 0), driver_id: v.driver_id ? Number(v.driver_id) : undefined });
        setV(VIDE_ENSEMBLE);
        void mutate();
      } else {
        await apiSend("POST", "/transport/drivers", d);
        setD(VIDE_CHAUFFEUR);
        void refreshDrivers();
      }
    } catch (e) {
      echec(e);
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <div className="space-y-6">
      {message && <Notice tone="danger">{message}</Notice>}
      <Card title="Ensembles routiers" padded={false}>
        {!vehicles ? <Etat error={erreurEnsembles} onRetry={() => mutate()} /> : (
          <DataTable rows={vehicles} rowKey={(x) => x.id} empty="Aucun ensemble routier." columns={[
            { key: "name", label: "Code", render: (x) => <TexteSurPlace requis label={`Code de ${x.name}`} disabled={!saisie} className="w-24" value={x.name} onCommit={(t) => void patchVehicle(x, { name: t })} /> },
            { key: "tractor_plate", label: "Tracteur", render: (x) => <TexteSurPlace label={`Immatriculation du tracteur de ${x.name}`} disabled={!saisie} className="w-32" value={x.tractor_plate} onCommit={(t) => void patchVehicle(x, { tractor_plate: t })} /> },
            { key: "trailer_plate", label: "Citerne ou benne", render: (x) => <TexteSurPlace label={`Immatriculation de la remorque de ${x.name}`} disabled={!saisie} className="w-32" value={x.trailer_plate} onCommit={(t) => void patchVehicle(x, { trailer_plate: t })} /> },
            { key: "vehicle_kind", label: "Profil", render: (x) => <Select disabled={!saisie} value={x.vehicle_kind} onChange={(e) => void patchVehicle(x, { vehicle_kind: e.target.value })} options={VEHICLE_KINDS} /> },
            { key: "capacity_liters", label: "Capacité (L)", align: "right", render: (x) => <NombreSurPlace label={`Capacité de ${x.name} (litres)`} disabled={!saisie} className="w-28" value={x.capacity_liters} onCommit={(n) => void patchVehicle(x, { capacity_liters: Math.round(n ?? 0) })} /> },
            { key: "payload_tonnes", label: "Charge utile (t)", align: "right", render: (x) => <NombreSurPlace label={`Charge utile de ${x.name} (tonnes)`} disabled={!saisie} className="w-20" value={x.payload_tonnes} onCommit={(n) => void patchVehicle(x, { payload_tonnes: n ?? 0 })} /> },
            { key: "documents", label: "Documents", render: (x) => <EtatDocuments vehicle={x} onOpen={() => setDocumenting(x)} /> },
            { key: "year", label: "Année", align: "right", render: (x) => <NombreSurPlace label={`Année de fabrication de ${x.name}`} disabled={!saisie} className="w-20" value={x.year} onCommit={(n) => void patchVehicle(x, { year: Math.round(n ?? 0) })} /> },
            { key: "date_service", label: "Mise en service", render: (x) => <Input type="date" disabled={!saisie} className="w-36" defaultValue={x.date_service ?? ""} onBlur={(e) => e.target.value !== (x.date_service ?? "") && void patchVehicle(x, { date_service: e.target.value || null })} /> },
            { key: "asset", label: "Immobilisation", render: (x) => (settings?.can_edit && assets ? (
              <Select value={x.asset?.id ?? ""} placeholder="Non rattaché" onChange={(e) => void patchVehicle(x, { asset_id: e.target.value ? Number(e.target.value) : null })} options={assets.items.filter((a) => a.state !== "removed").map((a) => ({ value: a.id, label: a.code ? `${a.code} ${a.name}` : a.name }))} />
            ) : x.asset ? x.asset.name : <Badge tone={x.state === "service" || x.state === "maintenance" ? "warn" : "neutral"}>Non rattaché</Badge>) },
            { key: "driver", label: "Chauffeur", render: (x) => <Select disabled={!saisie} value={x.driver?.id ?? ""} placeholder="–" onChange={(e) => void patchVehicle(x, { driver_id: e.target.value ? Number(e.target.value) : null })} options={(drivers ?? []).map((dr) => ({ value: dr.id, label: dr.name }))} /> },
            { key: "state", label: "État", render: (x) => <Select disabled={!saisie} value={x.state} onChange={(e) => void patchVehicle(x, { state: e.target.value })} options={VEHICLE_STATES} /> },
            { key: "ownership", label: "Propriété", render: (x) => (settings?.can_edit ? (
              <div className="flex min-w-64 flex-col gap-1.5">
                <Select value={x.ownership} onChange={(e) => void patchVehicle(x, { ownership: e.target.value })} options={OWNERSHIPS} />
                {x.ownership === "managed" && <PartnerPicker kind="supplier" value={x.owner} placeholder="Propriétaire…" onChange={(p) => void patchVehicle(x, { owner_id: p?.id ?? null })} />}
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
        )}
        {saisie && vehicles && (
          <div className="grid grid-cols-2 items-start gap-2 border-t border-line p-3 md:grid-cols-7">
            <Field label="Code"><Input placeholder="ER-01" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="Plaque du tracteur"><Input value={v.tractor_plate} onChange={(e) => setV({ ...v, tractor_plate: e.target.value })} /></Field>
            <Field label="Plaque de la remorque"><Input value={v.trailer_plate} onChange={(e) => setV({ ...v, trailer_plate: e.target.value })} /></Field>
            <Field label="Capacité (L)" error={nombreIllisible(v.capacity_liters) ? AIDE_NOMBRE : undefined}>
              <Input inputMode="numeric" aria-invalid={nombreIllisible(v.capacity_liters) || undefined} className={cx("font-mono", CHAMP_INVALIDE)} value={v.capacity_liters} onChange={(e) => setV({ ...v, capacity_liters: e.target.value })} />
            </Field>
            <Field label="Année" error={nombreIllisible(v.year) ? AIDE_NOMBRE : undefined}>
              <Input inputMode="numeric" aria-invalid={nombreIllisible(v.year) || undefined} className={cx("font-mono", CHAMP_INVALIDE)} value={v.year} onChange={(e) => setV({ ...v, year: e.target.value })} />
            </Field>
            <Field label="Chauffeur habituel"><Select value={v.driver_id} onChange={(e) => setV({ ...v, driver_id: e.target.value })} placeholder="–" options={(drivers ?? []).map((x) => ({ value: x.id, label: x.name }))} /></Field>
            <Button variant="primary" className="mt-6" loading={envoi === "ensemble"} disabled={!v.name.trim() || ensembleIllisible} onClick={() => void ajouter("ensemble")}>Ajouter l&apos;ensemble</Button>
          </div>
        )}
      </Card>
      {charging && <ChargesModal vehicle={charging} canEdit={Boolean(settings?.can_edit)} onClose={() => setCharging(null)} onSaved={() => { setCharging(null); void mutate(); }} />}
      {documenting && <DocumentsModal vehicle={documenting} canEdit={saisie} onClose={() => setDocumenting(null)} onSaved={() => { setDocumenting(null); void mutate(); }} />}
      <Card title="Chauffeurs" padded={false}>
        {!drivers ? <Etat error={erreurChauffeurs} onRetry={() => refreshDrivers()} /> : (
          <DataTable rows={drivers} rowKey={(x) => x.id} empty="Aucun chauffeur." columns={[
            { key: "name", label: "Nom", render: (x) => <TexteSurPlace requis label={`Nom de ${x.name}`} disabled={!saisie} className="w-48" value={x.name} onCommit={(t) => void patchDriver(x, { name: t })} /> },
            { key: "phone", label: "Téléphone", render: (x) => <TexteSurPlace label={`Téléphone de ${x.name}`} disabled={!saisie} className="w-32" value={x.phone} onCommit={(t) => void patchDriver(x, { phone: t })} /> },
            { key: "license_number", label: "Permis", render: (x) => <TexteSurPlace label={`Permis de ${x.name}`} disabled={!saisie} className="w-32" value={x.license_number} onCommit={(t) => void patchDriver(x, { license_number: t })} /> },
            { key: "license_expiry", label: "Validité", render: (x) => (
              <span className="inline-flex items-center gap-2">
                {x.license_expiry && x.license_expiry < new Date().toISOString().slice(0, 10) && <Badge tone="danger">Expiré</Badge>}
                <Input type="date" aria-label={`Validité du permis de ${x.name}`} disabled={!saisie} className="w-36" defaultValue={x.license_expiry ?? ""} onBlur={(e) => e.target.value !== (x.license_expiry ?? "") && void patchDriver(x, { license_expiry: e.target.value || null })} />
              </span>
            ) },
            { key: "partner", label: "Fiche tiers", render: (x) => (saisie
              ? <div className="min-w-56"><PartnerPicker kind="supplier" value={x.partner} placeholder="Frais de mission, manquants…" onChange={(p) => void patchDriver(x, { partner_id: p?.id ?? null })} /></div>
              : x.partner?.name ?? "–") },
          ]} />
        )}
        {saisie && drivers && (
          <div className="grid grid-cols-2 items-start gap-2 border-t border-line p-3 md:grid-cols-5">
            <Field label="Nom"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <Field label="Téléphone"><Input value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
            <Field label="N° de permis"><Input value={d.license_number} onChange={(e) => setD({ ...d, license_number: e.target.value })} /></Field>
            <Field label="Permis valable jusqu'au"><Input type="date" value={d.license_expiry} onChange={(e) => setD({ ...d, license_expiry: e.target.value })} /></Field>
            <Button variant="primary" className="mt-6" loading={envoi === "chauffeur"} disabled={!d.name.trim()} onClick={() => void ajouter("chauffeur")}>Ajouter le chauffeur</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** État des documents d'un ensemble : à jour, à renouveler, ou manquants et expirés (ces derniers s'opposent au départ). */
function EtatDocuments({ vehicle, onOpen }: { vehicle: Vehicle; onOpen: () => void }) {
  const bloquants = vehicle.document_issues.filter((i) => i.severity === "block").length;
  const vigilance = vehicle.document_issues.length - bloquants;
  const titre = vehicle.document_issues.map((i) => i.label).join("\n") || "Documents exigés à jour";
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
      await apiSend("PATCH", `/transport/vehicles/${vehicle.id}`, { documents: lines.filter((l) => l.expiry_date).map(({ id, kind, reference, issuer, date_start, expiry_date }) => ({ id, kind, reference, issuer, date_start, expiry_date })) });
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
        {vehicle.document_issues.length > 0 && <Notice tone={vehicle.document_issues.some((i) => i.severity === "block") ? "danger" : "warn"}>{vehicle.document_issues.map((i) => i.label).join(" ")}</Notice>}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <Field label="Document" className="md:col-span-3"><Select disabled={!canEdit} value={l.kind} onChange={(e) => set(i, { kind: e.target.value as VehicleDocument["kind"] })} options={DOCUMENT_KINDS} /></Field>
            <Field label="Numéro" className="md:col-span-2"><Input disabled={!canEdit} value={l.reference ?? ""} onChange={(e) => set(i, { reference: e.target.value || null })} /></Field>
            <Field label="Délivré par" className="md:col-span-3"><Input disabled={!canEdit} value={l.issuer ?? ""} placeholder="Assureur, centre de visite…" onChange={(e) => set(i, { issuer: e.target.value || null })} /></Field>
            <Field label="Valable à partir du" className="md:col-span-2"><Input disabled={!canEdit} type="date" value={l.date_start ?? ""} onChange={(e) => set(i, { date_start: e.target.value || null })} /></Field>
            <Field label="Valable jusqu'au" className="md:col-span-2"><Input disabled={!canEdit} type="date" value={l.expiry_date} onChange={(e) => set(i, { expiry_date: e.target.value })} /></Field>
            {l.id ? <PieceDocument vehicleId={vehicle.id} doc={l} canEdit={canEdit} onDone={(a) => set(i, { attachment: a })} /> : null}
            {canEdit && <button type="button" title="Retirer" className="mb-2 text-muted hover:text-danger" onClick={() => setLines(lines.filter((_l, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {canEdit && <Button onClick={() => setLines([...lines, { kind: "insurance", reference: null, issuer: null, date_start: null, expiry_date: "" }])}><Plus className="h-4 w-4" /> Ajouter un document</Button>}
        <p className="text-[12px] text-muted">Un renouvellement s&apos;ajoute comme un nouveau document : l&apos;ancien reste à l&apos;historique. La pièce jointe se joint au document une fois enregistré.</p>
        {!lines.length && <p className="text-[13px] text-muted">Aucun document enregistré.</p>}
      </div>
    </Modal>
  );
}

/** Pièce jointe d'un document enregistré : la lire, ou en joindre une (PDF, image). */
function PieceDocument({ vehicleId, doc, canEdit, onDone }: { vehicleId: number; doc: VehicleDocument; canEdit: boolean; onDone: (a: VehicleDocument["attachment"]) => void }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const chemin = `/transport/vehicles/${vehicleId}/documents/${doc.id}/file`;
  return (
    <div className="col-span-2 flex flex-wrap items-center gap-3 text-[12.5px] md:col-span-12">
      {doc.attachment ? <button type="button" className="text-accent hover:underline" onClick={() => void apiDownload(chemin, doc.attachment!.name)}>{doc.attachment.name}</button> : <span className="text-muted">Aucune pièce jointe</span>}
      {canEdit && (
        <label className="cursor-pointer text-accent hover:underline">
          {doc.attachment ? "Remplacer" : "Joindre la pièce"}
          <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.append("file", file);
            setErreur(null);
            apiUpload<VehicleDocument>(chemin, form).then((row) => onDone(row.attachment ?? null)).catch((err) => setErreur(err instanceof ApiError ? err.message : "Envoi impossible."));
          }} />
        </label>
      )}
      {erreur && <span className="text-danger">{erreur}</span>}
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
