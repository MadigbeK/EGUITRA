"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useSWRConfig } from "swr";
import { FileCheck2, Pencil, Plus, Printer, RefreshCw } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Kpi, Modal, Notice, PageHeader, Select, Tabs, demanderConfirmation, type Tone } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { BoutonDiscussion } from "@/components/discussions/BoutonDiscussion";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { PAYMENT_STATES, type MoveSummary } from "@/lib/finance-types";
import { AIDE_NOMBRE, INSECABLE, fmtDate, fmtDateTime, fmtDec, fmtGNF, fmtInt, fmtPct, fmtShort, lireNombre, nombreIllisible, pluriel } from "@/lib/format";
import { aujourdhui } from "@/lib/jour";
import type { Profile } from "@/lib/types";

// Profils des routes du noyau (addons/eguitra_immobilier/controllers/immobilier.py) : biens, baux (création,
// correction d'un bail en attente, activation, fin) et émission des loyers (WRITE). La direction lit
// seulement (READ).
const GESTION: Profile[] = ["admin", "finance", "immobilier"];

type Periodicite = "monthly" | "quarterly" | "yearly";
const PERIODES: Record<Periodicite, string> = { monthly: "mois", quarterly: "trimestre", yearly: "an" };
const ETATS_BAIL: Record<Lease["state"], [string, Tone]> = { draft: ["En attente", "warn"], active: ["En cours", "ok"], terminated: ["Résilié", "neutral"] };

interface Lease {
  id: number;
  name: string;
  property: { id: number; name: string };
  tenant: { id: number; name: string };
  date_start: string;
  date_end: string | null;
  rent_start: string | null;
  rent: number;
  charges: number;
  periodicity: Periodicite;
  vat: boolean;
  deposit_amount: number;
  state: "draft" | "active" | "terminated";
  next_invoice_date: string | null;
  invoiced_until: string | null;
  rent_error: string | null;
  rent_error_at: string | null;
}
interface Property { id: number; name: string; kind: string; address: string | null; city: string | null; area_m2: number; acquisition_value: number; current_value: number; valuation_date: string | null; occupied: boolean; lease: Lease | null; pending_leases: number }
interface Summary { properties: number; occupied: number; occupancy_rate: number | null; annual_rent: number; portfolio_value: number; gross_yield: number | null; unpaid_count: number; unpaid_amount: number; leases_expiring_3m: number; rent_errors: number }
interface Receipt { number: string; date: string; invoice_date: string; company: string; company_address: string | null; tenant: string; property: string | null; property_address: string | null; lines: Array<{ name: string; amount: number }>; amount_total: number; currency: string }
interface Echec { lease: string; property: string; message: string }
type Kinds = Array<{ code: string; label: string }>;

/** Relit toutes les données de l'immobilier (synthèse, biens, baux, loyers, impayés) après une écriture. */
function useRelireImmobilier() {
  const { mutate } = useSWRConfig();
  return () => void mutate((cle) => typeof cle === "string" && cle.startsWith("/immobilier/"));
}

/** Un bouton dans une ligne cliquable n'ouvre pas aussi la ligne. */
const arreter = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

export default function RealEstatePage() {
  const [tab, setTab] = useState<"biens" | "loyers" | "impayes">("biens");
  const { data: summary, error: summaryError, mutate: refreshSummary } = useApi<Summary>("/immobilier/summary");
  const gestion = useAutorise(GESTION);
  const envoi = useEnvoi();
  const relire = useRelireImmobilier();
  const [echecs, setEchecs] = useState<Echec[]>([]);

  async function emettre() {
    if (!(await demanderConfirmation("Émettre les loyers échus ? Les loyers des baux en cours dus jusqu'à aujourd'hui sont facturés et validés aussitôt ; une facture validée ne s'annule que par un avoir.", { action: "Émettre les loyers", danger: true }))) return;
    const sortie: { res?: { invoices: MoveSummary[]; errors: Echec[] } } = {};
    setEchecs([]);
    const ok = await envoi.run("emettre", async () => {
      sortie.res = await apiSend<{ invoices: MoveSummary[]; errors: Echec[] }>("POST", "/immobilier/rents/generate", {});
    }, undefined, "Émission impossible.");
    const res = sortie.res;
    if (!ok || !res) return;
    const emis = res.invoices.length ? `${pluriel(res.invoices.length, "loyer émis et validé", "loyers émis et validés")}.` : "Aucun loyer échu à émettre.";
    envoi.setMessage({ tone: res.errors.length ? "danger" : "ok", text: res.errors.length ? `${emis} Échec pour ${pluriel(res.errors.length, "bail", "baux")}, détaillé ci-dessous.` : emis });
    setEchecs(res.errors);
    relire();
  }

  return (
    <div>
      <PageHeader title="Immobilier" subtitle="Biens, baux, loyers et quittancement automatique, relances, valorisation du patrimoine." actions={gestion ? <Button variant="primary" loading={envoi.busy === "emettre"} disabled={!!envoi.busy} onClick={() => void emettre()}><RefreshCw className="h-4 w-4" /> Émettre les loyers échus</Button> : undefined} />
      {envoi.message && <div className="mb-4"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
      {echecs.length > 0 && (
        <div className="mb-4">
          <Notice tone="danger">
            <ul className="list-disc pl-5">{echecs.map((e) => <li key={e.lease}>Bail {e.lease} ({e.property}) : {e.message}</li>)}</ul>
          </Notice>
        </div>
      )}
      <Etat data={summary} error={summaryError} onRetry={() => refreshSummary()} label="Chargement de la synthèse…">
        {(s) => (
          <div className="mb-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Kpi label="Biens" value={fmtInt(s.properties)} hint={`${pluriel(s.occupied, "loué")}, ${fmtPct(s.occupancy_rate, 0)} d'occupation`} />
              <Kpi label="Loyers annuels" value={fmtShort(s.annual_rent)} tone="ok" />
              <Kpi label="Valeur du patrimoine" value={fmtShort(s.portfolio_value)} hint="Valeur actuelle, à défaut d'acquisition, bien par bien" />
              <Kpi label="Rendement brut" value={fmtPct(s.gross_yield)} tone="accent" />
              <Kpi label="Loyers impayés" value={fmtShort(s.unpaid_amount)} hint={`${pluriel(s.unpaid_count, "échéance")}, ${pluriel(s.leases_expiring_3m, "bail", "baux")} à échéance sous 3 mois`} tone={s.unpaid_count ? "warn" : "neutral"} />
            </div>
            {s.rent_errors > 0 && (
              <Notice tone="danger">Quittancement en échec pour {pluriel(s.rent_errors, "bail", "baux")} : ouvrez le bien pour lire le motif. Le passage de cette nuit réessaie ; signalez-le à la finance s&apos;il persiste.</Notice>
            )}
          </div>
        )}
      </Etat>
      <Tabs tabs={[{ key: "biens", label: "Biens et baux" }, { key: "loyers", label: "Loyers émis" }, { key: "impayes", label: "Impayés et relances" }]} value={tab} onChange={setTab} />
      {tab === "biens" && <Properties gestion={gestion} />}
      {tab === "loyers" && <Rents />}
      {tab === "impayes" && <Unpaid />}
    </div>
  );
}

/** Biens et baux : créés, modifiés, loués et libérés par les profils de gestion ; lus par la direction. */
function Properties({ gestion }: { gestion: boolean }) {
  const { data, error, mutate } = useApi<{ items: Property[]; kinds: Kinds }>("/immobilier/properties");
  const relire = useRelireImmobilier();
  const [creating, setCreating] = useState(false);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [leasing, setLeasing] = useState<Property | null>(null);
  const [ending, setEnding] = useState<Property | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const bien = data?.items.find((p) => p.id === ouvert);
  function fait(texte: string) {
    setMessage(texte);
    relire();
  }
  return (
    <>
      {message && <div className="mb-3"><Notice tone="ok">{message}</Notice></div>}
      {gestion && <div className="mb-3 flex justify-end"><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau bien</Button></div>}
      <Card padded={false}>
        <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des biens…">
          {(d) => (
            <DataTable rows={d.items} rowKey={(p) => p.id} onRowClick={(p) => setOuvert(p.id)} empty="Aucun bien." columns={[
              { key: "name", label: "Bien", render: (p) => <span className="font-medium text-ink">{p.name}</span> },
              { key: "kind", label: "Nature", render: (p) => d.kinds.find((k) => k.code === p.kind)?.label ?? p.kind },
              { key: "area_m2", label: "Surface", align: "right", render: (p) => (p.area_m2 ? `${fmtDec(p.area_m2)}${INSECABLE}m²` : "–") },
              { key: "current_value", label: "Valeur (GNF)", align: "right", render: (p) => <span title={p.valuation_date ? `Évaluée le ${fmtDate(p.valuation_date)}` : "Valeur d'acquisition"}>{fmtInt(p.current_value || p.acquisition_value)}</span> },
              { key: "lease", label: "Locataire", render: (p) => p.lease ? `${p.lease.tenant.name}, ${fmtGNF(p.lease.rent)} par ${PERIODES[p.lease.periodicity]}` : "–" },
              { key: "occupied", label: "", render: (p) => (
                <span className="flex items-center justify-end gap-2" onClick={arreter} onKeyDown={arreter}>
                  {p.pending_leases > 0 && <Badge tone="warn">{p.pending_leases > 1 ? `${fmtInt(p.pending_leases)} baux en attente` : "Bail en attente"}</Badge>}
                  {p.lease?.date_end && <Badge tone="neutral">Fin le {fmtDate(p.lease.date_end)}</Badge>}
                  {p.occupied ? <Badge tone="ok">Loué</Badge> : <Badge>Libre</Badge>}
                  {gestion && (p.occupied && p.lease ? <Button size="sm" onClick={() => setEnding(p)}>Fin de bail</Button> : <Button size="sm" onClick={() => setLeasing(p)}>Louer</Button>)}
                </span>
              ) },
            ]} />
          )}
        </Etat>
      </Card>
      {creating && data && <PropertyForm kinds={data.kinds} onClose={() => setCreating(false)} onDone={() => { setCreating(false); fait("Bien enregistré."); }} />}
      {bien && data && <BienModal key={bien.id} property={bien} kinds={data.kinds} gestion={gestion} onClose={() => setOuvert(null)} />}
      {leasing && <LeaseForm property={leasing} onClose={() => setLeasing(null)} onDone={(texte) => { setLeasing(null); fait(texte); }} />}
      {ending?.lease && <TerminateForm property={ending} lease={ending.lease} onClose={() => setEnding(null)} onDone={(texte) => { setEnding(null); fait(texte); }} />}
    </>
  );
}

/** Fiche d'un bien : ses caractéristiques et l'historique de ses baux, en attente, en cours et résiliés. */
function BienModal({ property, kinds, gestion, onClose }: { property: Property; kinds: Kinds; gestion: boolean; onClose: () => void }) {
  const { data: leases, error, mutate } = useApi<Lease[]>(`/immobilier/leases?property_id=${property.id}`);
  const relire = useRelireImmobilier();
  const envoi = useEnvoi();
  const [form, setForm] = useState<{ lease?: Lease } | null>(null);
  const [ending, setEnding] = useState<Lease | null>(null);
  const [editing, setEditing] = useState(false);
  const jour = aujourdhui();
  function fait(texte: string) {
    envoi.setMessage({ tone: "ok", text: texte });
    relire();
  }
  async function activer(l: Lease) {
    const premiere = l.rent_start ?? l.date_start;
    if (!(await demanderConfirmation(`Activer le bail ${l.name} ? Le quittancement démarre : les loyers échus depuis le ${fmtDate(premiere)} sont émis et validés à la prochaine émission, au plus tard cette nuit.`, { action: "Activer le bail", danger: true }))) return;
    if (await envoi.run(`activer-${l.id}`, () => apiSend("POST", `/immobilier/leases/${l.id}/activate`), "Bail activé : le quittancement démarre.")) relire();
  }
  const kind = kinds.find((k) => k.code === property.kind)?.label ?? property.kind;
  return (
    <Modal open wide title={property.name} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex justify-end"><BoutonDiscussion model="eguitra.property" id={property.id} libelle={property.name} petit /></div>
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><div className="text-xs text-muted">Nature</div>{kind}</div>
          <div><div className="text-xs text-muted">Adresse</div>{[property.address, property.city].filter(Boolean).join(", ") || "–"}</div>
          <div><div className="text-xs text-muted">Surface</div>{property.area_m2 ? `${fmtDec(property.area_m2)}${INSECABLE}m²` : "–"}</div>
          <div><div className="text-xs text-muted">Valeur</div>{fmtGNF(property.current_value || property.acquisition_value)}{property.valuation_date ? `, évaluée le ${fmtDate(property.valuation_date)}` : ""}</div>
        </div>
        {gestion && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!envoi.busy} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Modifier le bien</Button>
            <Button variant="primary" disabled={!!envoi.busy} onClick={() => setForm({})}><Plus className="h-4 w-4" /> Nouveau bail</Button>
          </div>
        )}
        <Card title="Baux du bien" padded={false}>
          <Etat data={leases} error={error} onRetry={() => mutate()} label="Chargement des baux…">
            {(rows) => (
              <DataTable dense rows={rows} rowKey={(l) => l.id} empty="Aucun bail : le bien n'a jamais été loué." columns={[
                { key: "name", label: "Bail", render: (l) => <div><b>{l.name}</b><div className="text-[12px] text-muted">{l.tenant.name}</div></div> },
                { key: "date_start", label: "Prise d'effet", render: (l) => fmtDate(l.date_start) },
                { key: "date_end", label: "Fin", render: (l) => fmtDate(l.date_end) },
                { key: "rent", label: "Loyer HT (GNF)", align: "right", render: (l) => `${fmtInt(l.rent)} par ${PERIODES[l.periodicity]}` },
                { key: "next_invoice_date", label: "Prochain loyer", render: (l) => (l.state === "active" ? fmtDate(l.next_invoice_date) : "–") },
                { key: "state", label: "État", render: (l) => <Badge tone={ETATS_BAIL[l.state][1]}>{ETATS_BAIL[l.state][0]}</Badge> },
                { key: "actions", label: "", render: (l) => (gestion ? (
                  <span className="flex justify-end gap-2">
                    {l.state === "draft" && <Button size="sm" disabled={!!envoi.busy} onClick={() => setForm({ lease: l })}>Corriger</Button>}
                    {l.state === "draft" && <Button size="sm" variant="primary" loading={envoi.busy === `activer-${l.id}`} disabled={!!envoi.busy || property.occupied} title={property.occupied ? "Le bien a un bail en cours : activez celui-ci après sa fin." : undefined} onClick={() => void activer(l)}>Activer</Button>}
                    {l.state === "active" && <Button size="sm" disabled={!!envoi.busy} onClick={() => setEnding(l)}>Fin de bail</Button>}
                  </span>
                ) : null) },
              ]} />
            )}
          </Etat>
        </Card>
        {(leases ?? []).map((l) => (
          <div key={l.id} className="space-y-2">
            {l.rent_error && <Notice tone="danger">Quittancement du bail {l.name} en échec{l.rent_error_at ? ` le ${fmtDateTime(l.rent_error_at)}` : ""} : {l.rent_error} Le passage de cette nuit réessaie ; signalez-le à la finance s&apos;il persiste.</Notice>}
            {l.state === "active" && l.date_end && l.date_end >= jour && <Notice tone="neutral">Bail {l.name} : fin le {fmtDate(l.date_end)}. Il reste quittancé jusqu&apos;à cette date (dernière période au prorata des jours), puis il est résilié automatiquement.</Notice>}
            {l.state === "terminated" && l.date_end && l.invoiced_until && l.invoiced_until > l.date_end && <Notice tone="warn">Bail {l.name} : loyers émis jusqu&apos;au {fmtDate(l.invoiced_until)}, au-delà de sa fin le {fmtDate(l.date_end)}. La période en trop s&apos;annule par un avoir (finance).</Notice>}
          </div>
        ))}
        {property.occupied && (leases ?? []).some((l) => l.state === "draft") && <p className="text-[12px] text-muted">Un bail en attente s&apos;active une fois le bail en cours terminé (à sa fin, la tâche de nuit le résilie).</p>}
      </div>
      {editing && <PropertyForm kinds={kinds} property={property} onClose={() => setEditing(false)} onDone={() => { setEditing(false); fait("Bien enregistré."); }} />}
      {form && <LeaseForm property={property} lease={form.lease} onClose={() => setForm(null)} onDone={(texte) => { setForm(null); fait(texte); }} />}
      {ending && <TerminateForm property={property} lease={ending} onClose={() => setEnding(null)} onDone={(texte) => { setEnding(null); fait(texte); }} />}
    </Modal>
  );
}

/** Montant facultatif d'un champ : 0 si vide, null si illisible. */
function montantFacultatif(v: string): number | null {
  return v.trim() ? lireNombre(v) : 0;
}

/** Erreur d'un champ de montant : illisible, ou négatif (strict : nul refusé aussi). */
function erreurMontant(v: string, n: number | null, strict = false): string | undefined {
  if (nombreIllisible(v)) return AIDE_NOMBRE;
  if (n !== null && (strict ? n <= 0 : n < 0)) return strict ? "Montant positif attendu." : "Montant positif ou nul attendu.";
  return undefined;
}

/** Création d'un bien, ou modification (dont la valeur actuelle : valorisation du patrimoine). */
function PropertyForm({ kinds, property, onClose, onDone }: { kinds: Kinds; property?: Property; onClose: () => void; onDone: () => void }) {
  const texte = (v: number | null | undefined) => (v ? fmtDec(v) : "");
  const [f, setF] = useState({
    name: property?.name ?? "", kind: property?.kind ?? "appartement", address: property?.address ?? "", city: property?.city ?? "Conakry",
    area_m2: texte(property?.area_m2), acquisition_value: texte(property?.acquisition_value), current_value: texte(property?.current_value),
    valuation_date: property?.valuation_date ?? "",
  });
  const envoi = useEnvoi();
  const surface = montantFacultatif(f.area_m2);
  const acquisition = montantFacultatif(f.acquisition_value);
  const actuelle = montantFacultatif(f.current_value);
  const erreurs = { area_m2: erreurMontant(f.area_m2, surface), acquisition_value: erreurMontant(f.acquisition_value, acquisition), current_value: erreurMontant(f.current_value, actuelle) };
  const ready = Boolean(f.name.trim()) && !Object.values(erreurs).some(Boolean);
  async function save() {
    const valued = (actuelle ?? 0) !== (property?.current_value ?? 0);
    const body = {
      ...f, name: f.name.trim(), area_m2: surface ?? 0, acquisition_value: acquisition ?? 0, current_value: actuelle ?? 0,
      // Une nouvelle valeur sans date d'évaluation est datée du jour (à Conakry).
      valuation_date: f.valuation_date || (valued && actuelle ? aujourdhui() : null),
    };
    if (await envoi.run("enregistrer", () => (property ? apiSend("PATCH", `/immobilier/properties/${property.id}`, body) : apiSend("POST", "/immobilier/properties", body)), undefined, "Enregistrement impossible.")) onDone();
  }
  return (
    <Modal open title={property ? `Modifier ${property.name}` : "Nouveau bien"} onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={!ready || !!envoi.busy} onClick={() => void save()}>Enregistrer</Button>}>
      <div className="grid grid-cols-2 gap-3">
        {envoi.message && <div className="col-span-2"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
        <Field label="Désignation" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Nature"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={kinds.map((k) => ({ value: k.code, label: k.label }))} /></Field>
        <Field label="Surface (m²)" error={erreurs.area_m2}><Input inputMode="decimal" value={f.area_m2} onChange={(e) => setF({ ...f, area_m2: e.target.value })} /></Field>
        <Field label="Adresse" className="col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Valeur d'acquisition (GNF)" error={erreurs.acquisition_value}><Input inputMode="decimal" className="font-mono" value={f.acquisition_value} onChange={(e) => setF({ ...f, acquisition_value: e.target.value })} /></Field>
        <Field label="Valeur actuelle (GNF)" error={erreurs.current_value}><Input inputMode="decimal" className="font-mono" value={f.current_value} onChange={(e) => setF({ ...f, current_value: e.target.value })} /></Field>
        <Field label="Date de l'évaluation" hint="Vide : date du jour pour une nouvelle valeur"><Input type="date" value={f.valuation_date} onChange={(e) => setF({ ...f, valuation_date: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/**
 * Bail du bien : signé et activé aussitôt quand le bien est libre, ou enregistré en attente (le bien encore
 * loué jusqu'à la fin du bail en cours, par exemple), puis corrigé et activé. Un bail repris en cours porte
 * son premier loyer à émettre : la plateforme n'émet pas les échéances déjà facturées ailleurs.
 */
function LeaseForm({ property, lease, onClose, onDone }: { property: Property; lease?: Lease; onClose: () => void; onDone: (texte: string) => void }) {
  const relire = useRelireImmobilier();
  const [tenant, setTenant] = useState<{ id: number; name: string } | null>(lease?.tenant ?? null);
  const [f, setF] = useState({
    name: lease?.name ?? "", date_start: lease?.date_start ?? aujourdhui(), date_end: lease?.date_end ?? "", rent_start: lease?.rent_start ?? "",
    rent: lease ? fmtDec(lease.rent) : "", charges: lease?.charges ? fmtDec(lease.charges) : "", periodicity: (lease?.periodicity ?? "monthly") as Periodicite,
    deposit_amount: lease?.deposit_amount ? fmtDec(lease.deposit_amount) : "", vat: lease?.vat ?? false,
  });
  const envoi = useEnvoi();
  const loyer = lireNombre(f.rent);
  const charges = montantFacultatif(f.charges);
  const depot = montantFacultatif(f.deposit_amount);
  const erreurs = { rent: erreurMontant(f.rent, loyer, true), charges: erreurMontant(f.charges, charges), deposit_amount: erreurMontant(f.deposit_amount, depot) };
  const erreurFin = f.date_end && f.date_start && f.date_end < f.date_start ? "L'échéance ne peut précéder la prise d'effet." : undefined;
  const erreurPremier = f.rent_start && f.date_start && f.rent_start < f.date_start ? "Le premier loyer ne peut précéder la prise d'effet." : f.rent_start && f.date_end && f.rent_start > f.date_end ? "Le premier loyer ne peut suivre l'échéance du bail." : undefined;
  const premiere = f.rent_start || f.date_start;
  // Le module contract avance d'un mois civil : une échéance le 29, 30 ou 31 glisserait au 28 (le noyau refuse l'activation).
  const horsBorne = premiere && Number(premiere.slice(8, 10)) > 28 ? "Échéance le 29, 30 ou 31 : elle glisserait au 28 après un mois court. Choisissez une date du 1er au 28 ; les jours précédents se facturent à part." : undefined;
  const ready = Boolean(f.name.trim() && tenant && f.date_start && loyer !== null) && !Object.values(erreurs).some(Boolean) && !erreurFin && !erreurPremier;
  const activable = ready && !property.occupied && !horsBorne;

  async function enregistrer(activer: boolean) {
    if (activer && !(await demanderConfirmation(`Activer le bail ${f.name.trim()} ? Le quittancement démarre : les loyers échus depuis le ${fmtDate(premiere)} sont émis et validés à la prochaine émission, au plus tard cette nuit.`, { action: "Activer le bail", danger: true }))) return;
    const corps = {
      name: f.name.trim(), partner_id: tenant?.id, date_start: f.date_start, date_end: f.date_end || null, rent_start: f.rent_start || null,
      rent: loyer, charges: charges ?? 0, deposit_amount: depot ?? 0, periodicity: f.periodicity, vat: f.vat,
    };
    const ok = await envoi.run(activer ? "activer" : "enregistrer", async () => {
      if (lease) {
        await apiSend("PATCH", `/immobilier/leases/${lease.id}`, corps);
        relire();
        // Correction enregistrée : un refus de l'activation s'affiche ici, le bail reste en attente.
        if (activer) await apiSend("POST", `/immobilier/leases/${lease.id}/activate`);
      } else {
        await apiSend("POST", "/immobilier/leases", { ...corps, property_id: property.id, activate: activer });
      }
    }, undefined, "Enregistrement impossible.");
    if (ok) onDone(activer ? `Bail ${corps.name} activé : le quittancement démarre.` : `Bail ${corps.name} enregistré en attente : activez-le quand le bien sera libre.`);
  }

  return (
    <Modal open wide title={lease ? `Corriger le bail ${lease.name}` : `Bail, ${property.name}`} onClose={onClose} footer={
      <div className="flex flex-wrap gap-2">
        <Button loading={envoi.busy === "enregistrer"} disabled={!ready || !!envoi.busy} onClick={() => void enregistrer(false)}>{lease ? "Enregistrer" : "Enregistrer en attente"}</Button>
        <Button variant="primary" loading={envoi.busy === "activer"} disabled={!activable || !!envoi.busy} title={property.occupied ? "Le bien a un bail en cours : enregistrez celui-ci en attente." : undefined} onClick={() => void enregistrer(true)}>{lease ? "Enregistrer et activer" : "Signer et activer le bail"}</Button>
      </div>
    }>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {envoi.message && <div className="md:col-span-3"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
        {property.occupied && <div className="md:col-span-3"><Notice tone="neutral">Le bien a un bail en cours{property.lease?.date_end ? ` jusqu'au ${fmtDate(property.lease.date_end)}` : ""} : ce bail s&apos;enregistre en attente et s&apos;active après la fin du bail en cours.</Notice></div>}
        <Field label="Référence du bail"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Locataire" className="md:col-span-2"><PartnerPicker value={tenant} onChange={setTenant} kind="customer" /></Field>
        <Field label="Prise d'effet" error={!f.rent_start ? horsBorne : undefined}><Input type="date" value={f.date_start} onChange={(e) => setF({ ...f, date_start: e.target.value })} /></Field>
        <Field label="Échéance du bail" hint="Facultative" error={erreurFin}><Input type="date" value={f.date_end} onChange={(e) => setF({ ...f, date_end: e.target.value })} /></Field>
        <Field label="Premier loyer à émettre" hint="Bail repris en cours : première échéance non encore facturée. Vide : la prise d'effet, échéances passées rattrapées." error={erreurPremier ?? (f.rent_start ? horsBorne : undefined)}><Input type="date" value={f.rent_start} onChange={(e) => setF({ ...f, rent_start: e.target.value })} /></Field>
        <Field label="Périodicité"><Select value={f.periodicity} onChange={(e) => setF({ ...f, periodicity: e.target.value as Periodicite })} options={[{ value: "monthly", label: "Mensuelle" }, { value: "quarterly", label: "Trimestrielle" }, { value: "yearly", label: "Annuelle" }]} /></Field>
        <Field label="Loyer HT par période (GNF)" error={erreurs.rent}><Input inputMode="decimal" className="font-mono" value={f.rent} onChange={(e) => setF({ ...f, rent: e.target.value })} /></Field>
        <Field label="Charges par période (GNF)" error={erreurs.charges}><Input inputMode="decimal" className="font-mono" value={f.charges} onChange={(e) => setF({ ...f, charges: e.target.value })} /></Field>
        <Field label="Dépôt de garantie (GNF)" error={erreurs.deposit_amount}><Input inputMode="decimal" className="font-mono" value={f.deposit_amount} onChange={(e) => setF({ ...f, deposit_amount: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={f.vat} onChange={(e) => setF({ ...f, vat: e.target.checked })} /> Bail soumis à la TVA</label>
      </div>
    </Modal>
  );
}

function Rents() {
  const { data, error, mutate } = useApi<MoveSummary[]>("/immobilier/rents");
  const [receipt, setReceipt] = useState<number | null>(null);
  return (
    <>
      <Card padded={false}>
        <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des loyers…">
          {(rows) => (
            <DataTable rows={rows} rowKey={(m) => m.id} empty="Aucun loyer émis." columns={[
              { key: "name", label: "Facture de loyer", render: (m) => <span className="font-mono text-xs">{m.name}</span> },
              { key: "invoice_date", label: "Échéance", render: (m) => fmtDate(m.invoice_date) },
              { key: "partner", label: "Locataire", render: (m) => m.partner?.name ?? "–" },
              { key: "amount_total", label: "Montant TTC", align: "right", render: (m) => fmtGNF(m.amount_total, m.currency) },
              { key: "payment_state", label: "Règlement", render: (m) => <Badge tone={PAYMENT_STATES[m.payment_state]?.tone}>{PAYMENT_STATES[m.payment_state]?.label ?? "–"}</Badge> },
              { key: "x", label: "", render: (m) => (m.payment_state === "paid" || m.payment_state === "in_payment") ? <Button size="sm" onClick={() => setReceipt(m.id)}><FileCheck2 className="h-3.5 w-3.5" /> Quittance</Button> : null },
            ]} />
          )}
        </Etat>
      </Card>
      {receipt !== null && <ReceiptModal id={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

/**
 * Fin de bail. Fin passée ou du jour : les loyers dus jusqu'à elle sont émis, puis le bien redevient libre.
 * Fin future (congé donné) : le bail reste quittancé jusqu'à sa fin, puis la tâche de nuit le résilie.
 */
function TerminateForm({ property, lease, onClose, onDone }: { property: Property; lease: Lease; onClose: () => void; onDone: (texte: string) => void }) {
  const [date, setDate] = useState(aujourdhui());
  const envoi = useEnvoi();
  const future = date > aujourdhui();
  async function submit() {
    const question = future
      ? `Programmer la fin du bail au ${fmtDate(date)} ? Le bail reste en cours et quittancé jusqu'à cette date (dernière période au prorata des jours), puis il est résilié automatiquement et le bien redevient libre.`
      : `Mettre fin au bail le ${fmtDate(date)} ? Les loyers dus jusqu'à cette date sont émis et validés, puis le bien redevient libre. C'est définitif.`;
    if (!(await demanderConfirmation(question, { action: future ? "Programmer la fin" : "Mettre fin au bail", danger: !future }))) return;
    const sortie: { bail?: Lease } = {};
    const ok = await envoi.run("fin", async () => {
      sortie.bail = await apiSend<Lease>("POST", `/immobilier/leases/${lease.id}/terminate`, { date });
    }, undefined, "Fin de bail impossible.");
    const bail = sortie.bail;
    if (!ok || !bail) return;
    const avoir = bail.invoiced_until && bail.date_end && bail.invoiced_until > bail.date_end ? ` Loyers déjà émis jusqu'au ${fmtDate(bail.invoiced_until)} : la période en trop s'annule par un avoir (finance).` : "";
    onDone(future ? `Fin du bail ${lease.name} programmée au ${fmtDate(date)}.` : `Bail ${lease.name} résilié : le bien est libre.${avoir}`);
  }
  return (
    <Modal open title={`Fin de bail, ${property.name}`} onClose={onClose} footer={<Button variant="danger" loading={envoi.busy === "fin"} disabled={!date || !!envoi.busy} onClick={() => void submit()}>{future ? "Programmer la fin du bail" : "Mettre fin au bail"}</Button>}>
      <div className="space-y-3 text-sm">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <p>Bail {lease.name} de {lease.tenant.name}. Fin passée ou du jour : les loyers dus jusqu&apos;à la date de fin sont émis, puis le bien redevient libre. Fin future (congé donné) : le bail reste quittancé jusqu&apos;à sa fin, la dernière période au prorata des jours, puis il est résilié automatiquement. Un loyer déjà émis pour une période postérieure à la fin s&apos;annule par un avoir (finance).</p>
        <Field label="Date de fin"><Input type="date" value={date} min={lease.date_start} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Quittance d'un loyer réglé, datée de son règlement, imprimable. */
function ReceiptModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error, mutate } = useApi<Receipt>(`/immobilier/receipts/${id}`);
  return (
    <Modal open title="Quittance de loyer" onClose={onClose} footer={<Button disabled={!data} onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimer</Button>}>
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement de la quittance…">
        {(r) => (
          <div className="space-y-3 rounded-md bg-[#fffefb] p-7 text-sm leading-relaxed text-foret ring-1 ring-line print:ring-0">
            <div className="flex justify-between"><b>{r.company}</b><span>Quittance n° {r.number}</span></div>
            {r.company_address && <p className="text-[12px] text-muted">{r.company_address}</p>}
            <p>Reçu de {r.tenant} la somme de <b>{fmtGNF(r.amount_total, r.currency)}</b> au titre du loyer et des charges du bien {r.property}{r.property_address ? ` (${r.property_address})` : ""}, échéance du {fmtDate(r.invoice_date)}, pour la période suivante :</p>
            <ul className="list-disc pl-5">{r.lines.map((l, i) => <li key={i}>{l.name} : {fmtGNF(l.amount, r.currency)}</li>)}</ul>
            <p>Dont quittance, sous réserve de tous droits. Fait le {fmtDate(r.date)}.</p>
          </div>
        )}
      </Etat>
    </Modal>
  );
}

function Unpaid() {
  const { data, error, mutate } = useApi<Array<MoveSummary & { late_days: number; net_residual: number }>>("/immobilier/unpaid");
  return (
    <Card padded={false}>
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des impayés…">
        {(rows) => (
          <DataTable rows={rows} rowKey={(m) => m.id} empty="Aucun loyer impayé." columns={[
            { key: "partner", label: "Locataire", render: (m) => m.partner?.name ?? "–" },
            { key: "name", label: "Échéance", render: (m) => `${m.name ?? "Loyer"} du ${fmtDate(m.invoice_date)}` },
            { key: "invoice_date_due", label: "Exigible le", render: (m) => fmtDate(m.invoice_date_due) },
            { key: "late_days", label: "Retard", align: "right", render: (m) => <span className={m.late_days > 30 ? "text-danger" : "text-warn"}>{pluriel(m.late_days, "jour")}</span> },
            { key: "net_residual", label: "Reste dû", align: "right", render: (m) => <span title="Avoirs validés déduits">{fmtGNF(m.net_residual, m.currency)}</span> },
          ]} />
        )}
      </Etat>
    </Card>
  );
}
