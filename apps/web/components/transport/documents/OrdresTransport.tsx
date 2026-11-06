"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Modal, Notice, Select, Textarea, demanderConfirmation } from "@/components/ui";
import { apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { tonEtat } from "@/lib/couleurs";
import { fmtDate, fmtGNF, lireNombre, nombreIllisible, pluriel } from "@/lib/format";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ChampNombre, ETAT_ROTATION, FenetreMotif } from "../commun";
import type { Referentials } from "../types";
import { PanneauDocuments, texteErreur } from "./PanneauDocuments";
import { ETATS_ORDRE, ETATS_VOYAGE, OPS, type EtatOrdre, type Ordre, type OrdreDetail } from "./types";

interface Liste { items: Ordre[]; total_count: number }

const FILTRES: Array<{ value: string; label: string }> = [
  { value: "draft,validated,executed", label: "En cours (brouillons, validés, exécutés)" },
  { value: "draft", label: "Brouillons" },
  { value: "validated", label: "Validés" },
  { value: "executed", label: "Exécutés (à facturer)" },
  { value: "closed", label: "Clôturés" },
  { value: "cancelled", label: "Annulés" },
  { value: "draft,validated,executed,closed,cancelled", label: "Tous" },
];

/** Ordres de transport : la commande du client, qui regroupe ses opérations et leurs documents. */
export function OrdresTransport() {
  const [etat, setEtat] = useState("draft,validated,executed");
  const [q, setQ] = useState("");
  const { data, error, mutate } = useApi<Liste>(`/transport/orders?state=${etat}${q ? `&q=${encodeURIComponent(q)}` : ""}`, { keepPreviousData: true });
  // Fiche ouverte par l'adresse (/transport/ordres?ordre=…), depuis la fiche d'une opération.
  const demande = Number(useSearchParams().get("ordre"));
  const [ouvert, setOuvert] = useState<number | null>(Number.isInteger(demande) && demande > 0 ? demande : null);
  const [creation, setCreation] = useState(false);
  const saisie = useAutorise(OPS);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Statut"><Select value={etat} onChange={(e) => setEtat(e.target.value)} options={FILTRES} /></Field>
          <Field label="Rechercher" hint="Numéro, client, référence du client"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        </div>
        {saisie && <Button variant="primary" onClick={() => setCreation(true)}><Plus className="h-4 w-4" /> Nouvel ordre de transport</Button>}
      </div>
      <Card padded={false}>
        {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
          <DataTable
            rows={data.items}
            rowKey={(o) => o.id}
            onRowClick={(o) => setOuvert(o.id)}
            empty="Aucun ordre de transport pour ce filtre."
            columns={[
              { key: "name", label: "N°", render: (o) => <span className="font-mono text-xs">{o.name ?? "–"}</span> },
              { key: "date", label: "Date", render: (o) => fmtDate(o.date) },
              { key: "client", label: "Client", render: (o) => o.client.name },
              { key: "product", label: "Marchandise", render: (o) => o.product?.name ?? o.goods_description ?? "–" },
              { key: "quantity", label: "Quantité", align: "right", render: (o) => o.quantity_label ?? "–" },
              { key: "trajet", label: "Origine et destination", render: (o) => `${o.origin ?? "?"} → ${o.destination ?? "?"}` },
              { key: "ops", label: "Opérations", align: "right", render: (o) => `${o.delivered}/${o.operations} livrées` },
              { key: "state", label: "Statut", render: (o) => <Badge tone={tonEtat(o.state_label)}>{o.state_label}</Badge> },
            ]}
          />
        )}
      </Card>
      {creation && <FormulaireOrdre onClose={() => setCreation(false)} onDone={(id) => { setCreation(false); setOuvert(id); void mutate(); }} />}
      {ouvert !== null && <FicheOrdre id={ouvert} saisie={saisie} onClose={() => setOuvert(null)} onChanged={() => void mutate()} />}
    </div>
  );
}

const TEXTES = ["goods_description", "packaging", "origin", "destination", "destination_country", "consignee", "billing_address", "client_ref", "note", "client_signatory", "attached_documents"] as const;
const NOMBRES = ["quantity", "weight_gross", "weight_net", "goods_value"] as const;
const CASES = [["service_transport", "Transport"], ["with_loading", "Avec chargement"], ["with_unloading", "Avec déchargement"], ["with_storage", "Avec stockage"], ["extra_insurance", "Assurance complémentaire"]] as const;

type Valeurs = Record<string, string | boolean>;

function valeursOrdre(o?: OrdreDetail): Valeurs {
  const v: Valeurs = {
    partner_id: o ? String(o.client.id) : "", partner_name: o?.client.name ?? "", product_id: o?.product ? String(o.product.id) : "", route_id: o?.route ? String(o.route.id) : "",
    date: o?.date ?? new Date().toISOString().slice(0, 10), quantity_uom: o?.quantity_uom ?? "l",
  };
  for (const k of TEXTES) v[k] = (o?.[k] as string | null | undefined) ?? (k === "packaging" && !o ? "Vrac liquide" : "");
  for (const k of NOMBRES) v[k] = o?.[k] ? String(o[k]).replace(".", ",") : "";
  for (const [k] of CASES) v[k] = o ? Boolean(o[k]) : k === "service_transport";
  return v;
}

function corpsOrdre(v: Valeurs): Record<string, unknown> {
  const corps: Record<string, unknown> = { date: v.date, quantity_uom: v.quantity_uom };
  for (const k of ["partner_id", "product_id", "route_id"]) corps[k] = v[k] ? Number(v[k]) : null;
  for (const k of TEXTES) corps[k] = v[k] || null;
  for (const k of NOMBRES) corps[k] = lireNombre(String(v[k] ?? "")) ?? 0;
  for (const [k] of CASES) corps[k] = Boolean(v[k]);
  return corps;
}

/** Champs de l'ordre de transport, communs à la création et à la fiche. */
function ChampsOrdre({ v, set, refs: ref, disabled }: { v: Valeurs; set: (k: string, val: string | boolean) => void; refs: Referentials; disabled?: boolean }) {
  const texte = (k: string) => (e: { target: { value: string } }) => set(k, e.target.value);
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Client" className="md:col-span-2">
          <PartnerPicker kind="customer" value={v.partner_id ? { id: Number(v.partner_id), name: String(v.partner_name) } : null}
            onChange={(p) => { set("partner_id", p ? String(p.id) : ""); set("partner_name", p?.name ?? ""); }} />
        </Field>
        <Field label="Date"><Input type="date" value={String(v.date)} onChange={texte("date")} /></Field>
        <Field label="Référence du client"><Input value={String(v.client_ref)} onChange={texte("client_ref")} /></Field>
      </div>
      <div className="flex flex-wrap gap-4 text-[13.5px]">
        {CASES.map(([k, label]) => (
          <label key={k} className="inline-flex items-center gap-2"><input type="checkbox" checked={Boolean(v[k])} onChange={(e) => set(k, e.target.checked)} /> {label}</label>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Produit transporté"><Select value={String(v.product_id)} onChange={texte("product_id")} placeholder="–" options={ref.products.map((p) => ({ value: p.id, label: p.label }))} /></Field>
        <Field label="Description de la marchandise"><Input value={String(v.goods_description)} onChange={texte("goods_description")} /></Field>
        <Field label="Conditionnement"><Input value={String(v.packaging)} onChange={texte("packaging")} /></Field>
        <ChampNombre label="Quantité" value={String(v.quantity)} onChange={texte("quantity")} />
        <Field label="Unité"><Select value={String(v.quantity_uom)} onChange={texte("quantity_uom")} options={[{ value: "l", label: "litres" }, { value: "kg", label: "kg" }, { value: "t", label: "t" }]} /></Field>
        <ChampNombre label="Poids brut" value={String(v.weight_gross)} onChange={texte("weight_gross")} />
        <ChampNombre label="Poids net" value={String(v.weight_net)} onChange={texte("weight_net")} />
        <ChampNombre label="Valeur (GNF)" value={String(v.goods_value)} onChange={texte("goods_value")} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Route" hint="Origine et destination proposées"><Select value={String(v.route_id)} onChange={texte("route_id")} placeholder="–" options={ref.routes.map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Field label="Origine"><Input value={String(v.origin)} onChange={texte("origin")} /></Field>
        <Field label="Destination"><Input value={String(v.destination)} onChange={texte("destination")} /></Field>
        <Field label="Pays de destination"><Input value={String(v.destination_country)} onChange={texte("destination_country")} /></Field>
        <Field label="Destinataire réel" hint="Vide : le client" className="md:col-span-2"><Input value={String(v.consignee)} onChange={texte("consignee")} /></Field>
        <Field label="Signataire pour le client" className="md:col-span-2"><Input value={String(v.client_signatory)} onChange={texte("client_signatory")} /></Field>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Adresse de facturation" hint="Vide : adresse du client"><Textarea rows={2} value={String(v.billing_address)} onChange={texte("billing_address")} /></Field>
        <Field label="Documents joints"><Textarea rows={2} value={String(v.attached_documents)} onChange={texte("attached_documents")} /></Field>
        <Field label="Observation"><Textarea rows={2} value={String(v.note)} onChange={texte("note")} /></Field>
      </div>
    </fieldset>
  );
}

function FormulaireOrdre({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const { data: ref, error, mutate } = useApi<Referentials>("/transport/referentials");
  const [v, setV] = useState<Valeurs>(valeursOrdre());
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const illisible = NOMBRES.some((k) => nombreIllisible(String(v[k] ?? "")));
  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    try {
      const o = await apiSend<OrdreDetail>("POST", "/transport/orders", corpsOrdre(v));
      onDone(o.id);
    } catch (e) {
      setErreur(texteErreur(e, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open wide title="Nouvel ordre de transport" onClose={() => !busy && onClose()} footer={<Button variant="primary" loading={busy} disabled={!v.partner_id || illisible} onClick={() => void enregistrer()}>Enregistrer</Button>}>
      {!ref ? <Etat error={error} onRetry={() => mutate()} /> : (
        <div className="space-y-3">
          {erreur && <Notice tone="danger">{erreur}</Notice>}
          <ChampsOrdre v={v} set={(k, val) => setV((x) => ({ ...x, [k]: val }))} refs={ref} />
        </div>
      )}
    </Modal>
  );
}

function FicheOrdre({ id, saisie, onClose, onChanged }: { id: number; saisie: boolean; onClose: () => void; onChanged: () => void }) {
  const { data: o, error, mutate } = useApi<OrdreDetail>(`/transport/orders/${id}`);
  const { data: ref } = useApi<Referentials>("/transport/referentials");
  const [v, setV] = useState<Valeurs | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const [annulation, setAnnulation] = useState(false);
  useEffect(() => { if (o) setV(valeursOrdre(o)); }, [o]);
  const modifiable = saisie && !!o && (o.state === "draft" || o.state === "validated" || o.state === "executed");

  async function agir(appel: () => Promise<OrdreDetail>) {
    setBusy(true);
    setErreur(null);
    try {
      await mutate(await appel(), { revalidate: false });
      onChanged();
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setBusy(false);
    }
  }
  function annuler(motif: string) {
    void agir(() => apiSend<OrdreDetail>("POST", `/transport/orders/${id}/cancel`, { reason: motif }));
  }
  async function valider() {
    if (!(await demanderConfirmation("Valider l'ordre de transport ? Il vaut accord du client ; joignez l'ordre signé si vous l'avez.", { action: "Valider" }))) return;
    void agir(() => apiSend<OrdreDetail>("POST", `/transport/orders/${id}/validate`));
  }

  return (
    <Modal open wide title={o ? `Ordre de transport ${o.name ?? ""}` : "Ordre de transport"} onClose={onClose} footer={o && saisie ? (
      <>
        {o.state === "validated" && o.rotations.every((r) => r.state === "draft" || r.state === "cancelled") && <Button loading={busy} onClick={() => void agir(() => apiSend<OrdreDetail>("POST", `/transport/orders/${id}/reset`))}>Remettre en brouillon</Button>}
        {modifiable && <Button variant="danger" loading={busy} onClick={() => setAnnulation(true)}>Annuler l'ordre</Button>}
        {modifiable && v && <Button loading={busy} onClick={() => void agir(() => apiSend<OrdreDetail>("PATCH", `/transport/orders/${id}`, corpsOrdre(v)))}>Enregistrer</Button>}
        {o.state === "draft" && <Button variant="primary" loading={busy} disabled={o.missing.length > 0} title={o.missing.length ? `Il manque : ${o.missing.join(", ")}` : undefined} onClick={() => void valider()}>Valider (accord du client)</Button>}
      </>
    ) : undefined}>
      {!o || !ref || !v ? <Etat error={error} onRetry={() => mutate()} /> : (
        <div className="space-y-5">
          {erreur && <Notice tone="danger">{erreur}</Notice>}
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Badge tone={tonEtat(ETATS_ORDRE[o.state as EtatOrdre])}>{ETATS_ORDRE[o.state as EtatOrdre]}</Badge>
            {o.validated_by && <span>Validé par {o.validated_by.name} le {fmtDate(o.validated_at)}</span>}
            {o.cancel_reason && <span>· Annulé : {o.cancel_reason}</span>}
            <span>· {pluriel(o.operations, "opération")}, {o.delivered} livrée(s), {o.invoiced} facturée(s)</span>
          </div>
          <ChampsOrdre v={v} set={(k, val) => setV((x) => (x ? { ...x, [k]: val } : x))} refs={ref} disabled={!modifiable} />
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <span className="font-semibold text-ink">Ordre signé par le client :</span>
            {o.signed_attachment ? <span>{o.signed_attachment.name}</span> : <span className="text-muted">aucun</span>}
            {saisie && o.state !== "cancelled" && (
              <FileButton small label={o.signed_attachment ? "Remplacer" : "Joindre"} onFile={(f) => {
                const form = new FormData();
                form.append("file", f);
                void agir(() => apiUpload<OrdreDetail>(`/transport/orders/${id}/signed`, form));
              }} />
            )}
          </div>
          <PanneauDocuments titre="Document de l'ordre" documents={[o.document]} />
          <Card title={`Opérations (${o.rotations.length})`} actions={saisie && modifiable ? <Button size="sm" onClick={() => setNouvelle(true)}><Plus className="h-4 w-4" /> Nouvelle opération</Button> : undefined} padded={false}>
            <DataTable
              rows={o.rotations}
              rowKey={(r) => r.id}
              empty="Aucune opération : ajoutez-en une par camion."
              columns={[
                { key: "name", label: "Opération", render: (r) => <Link className="inline-flex items-center gap-1 font-mono text-xs text-accent underline" href={`/transport/operations?id=${r.id}`}>{r.name}<ArrowUpRight className="h-3 w-3" /></Link> },
                { key: "vehicle", label: "Ensemble", render: (r) => r.vehicle.name },
                { key: "engins", label: "Tracteur / remorque", render: (r) => `${r.tractor?.name ?? "–"} / ${r.trailer?.name ?? "–"}` },
                { key: "driver", label: "Chauffeur", render: (r) => r.driver?.name ?? "–" },
                { key: "etd", label: "Départ prévu", render: (r) => fmtDate(r.date_planned_departure) },
                { key: "docs", label: "Documents", render: (r) => <Badge tone={r.documents_ready === 4 ? "ok" : "warn"}>{r.documents_ready}/4 prêts</Badge> },
                { key: "budget", label: "Budget", render: (r) => ETATS_VOYAGE[r.trip_state] },
                { key: "state", label: "Statut", render: (r) => <Badge tone={tonEtat(ETAT_ROTATION[r.state])}>{ETAT_ROTATION[r.state]}</Badge> },
              ]}
            />
          </Card>
          {o.goods_value > 0 && <p className="text-[12.5px] text-muted">Valeur déclarée : {fmtGNF(o.goods_value)}.</p>}
        </div>
      )}
      {nouvelle && o && ref && <NouvelleOperation ordre={o} ref_={ref} onClose={() => setNouvelle(false)} onDone={() => { setNouvelle(false); void mutate(); onChanged(); }} />}
      {annulation && o && <FenetreMotif titre={`Annuler l'ordre ${o.name ?? ""}`} aide="L'ordre annulé ne donne plus d'opération ; le motif reste lisible sur l'ordre." action="Annuler l'ordre" danger onClose={() => setAnnulation(false)} envoyer={annuler} />}
    </Modal>
  );
}

/** Opération (un camion) de l'ordre : ensemble, tracteur et remorque, équipage, dates prévues. */
function NouvelleOperation({ ordre, ref_, onClose, onDone }: { ordre: OrdreDetail; ref_: Referentials; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ route_id: ordre.route ? String(ordre.route.id) : "", date_planned_departure: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const vehicule = ref_.vehicles.find((v) => String(v.id) === f.vehicle_id);
  const chauffeurs = ref_.drivers.filter((d) => d.crew_role !== "assistant");
  const convoyeurs = ref_.drivers;
  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    try {
      const corps: Record<string, unknown> = {};
      for (const k of ["vehicle_id", "trailer_id", "driver_id", "co_driver_id", "route_id"]) if (f[k]) corps[k] = Number(f[k]);
      for (const k of ["date_planned_departure", "date_planned_arrival", "date_planned_return"]) if (f[k]) corps[k] = f[k];
      const planned = lireNombre(f.volume_planned ?? "");
      if (planned !== null) corps.volume_planned = planned;
      await apiSend("POST", `/transport/orders/${ordre.id}/operations`, corps);
      onDone();
    } catch (e) {
      setErreur(texteErreur(e, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open wide title={`Nouvelle opération de l'ordre ${ordre.name ?? ""}`} onClose={() => !busy && onClose()} footer={<Button variant="primary" loading={busy} disabled={!f.vehicle_id || nombreIllisible(f.volume_planned)} onClick={() => void enregistrer()}>Créer l'opération</Button>}>
      <div className="space-y-3">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Ensemble routier"><Select value={f.vehicle_id ?? ""} onChange={(e) => {
            const v = ref_.vehicles.find((x) => String(x.id) === e.target.value);
            setF({ ...f, vehicle_id: e.target.value, driver_id: v?.driver_id ? String(v.driver_id) : f.driver_id ?? "" });
          }} placeholder="Choisir…" options={ref_.vehicles.map((v) => ({ value: v.id, label: `${v.name} ${v.tractor_plate ?? ""}` }))} /></Field>
          <Field label="Remorque" hint="Vide : celle de l'ensemble"><Select value={f.trailer_id ?? ""} onChange={set("trailer_id")} placeholder="–" options={(ref_.trailers ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="Route"><Select value={f.route_id ?? ""} onChange={set("route_id")} placeholder="Celle de l'ordre" options={ref_.routes.map((r) => ({ value: r.id, label: r.name }))} /></Field>
          <Field label="Chauffeur" hint="Vide : chauffeur habituel"><Select value={f.driver_id ?? ""} onChange={set("driver_id")} placeholder="–" options={chauffeurs.map((d) => ({ value: d.id, label: d.name }))} /></Field>
          <Field label="Convoyeur"><Select value={f.co_driver_id ?? ""} onChange={set("co_driver_id")} placeholder="–" options={convoyeurs.map((d) => ({ value: d.id, label: d.name }))} /></Field>
          <ChampNombre label="Volume prévu (m³)" hint={vehicule ? `Vide : reste de l'ordre, ${vehicule.capacity_liters / 1000} m³ au plus` : "Vide : reste de l'ordre"} value={f.volume_planned} onChange={set("volume_planned")} />
          <Field label="Départ prévu"><Input type="date" value={f.date_planned_departure ?? ""} onChange={set("date_planned_departure")} /></Field>
          <Field label="Arrivée prévue"><Input type="date" value={f.date_planned_arrival ?? ""} onChange={set("date_planned_arrival")} /></Field>
          <Field label="Retour au parc prévu"><Input type="date" value={f.date_planned_return ?? ""} onChange={set("date_planned_return")} /></Field>
        </div>
      </div>
    </Modal>
  );
}
