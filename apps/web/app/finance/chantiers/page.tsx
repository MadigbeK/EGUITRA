"use client";

import { useState } from "react";
import { HardHat, Pencil, Plus, Unlock } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Kpi, Modal, Notice, PageHeader, ProgressBar, Select, demanderConfirmation } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, fmtDate, fmtDec, fmtGNF, fmtPct, fmtShort, lireNombre, nombreIllisible } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes du noyau (addons/eguitra_chantier/controllers/chantier.py) : saisie et modification
// des chantiers et des situations (WRITE), facturation, annulation par avoir et libération des retenues
// (INVOICE). La direction lit seulement ; le profil chantiers saisit, la finance facture.
const SAISIE: Profile[] = ["admin", "finance", "chantiers"];
const FACTURATION: Profile[] = ["admin", "finance"];

type EtatChantier = "preparation" | "progress" | "received" | "closed";
interface Situation {
  id: number;
  number: number;
  date: string;
  period_label: string | null;
  cumulative_amount: number;
  previous_amount: number;
  amount_period: number;
  retention_amount: number;
  progress_pct: number;
  state: "draft" | "invoiced" | "cancelled";
  invoice: { id: number; name: string; residual: number } | null;
  credit_note: { id: number; name: string } | null;
}
interface Chantier {
  id: number;
  name: string;
  code: string | null;
  client: { id: number; name: string };
  contract_amount: number;
  retention_rate: number;
  state: EtatChantier;
  date_start: string | null;
  date_end: string | null;
  date_reception: string | null;
  location: string | null;
  invoiced_amount: number;
  progress_pct: number;
  retention_total: number;
  retention_released: number;
  retention_outstanding: number;
  retention_released_due: number;
  has_invoiced: boolean;
  invoiced_cumulative: number;
  costs?: number;
  margin?: number;
  situations?: Situation[];
}

const STATE: Record<EtatChantier, readonly [string, "neutral" | "accent" | "ok"]> = { preparation: ["En préparation", "neutral"], progress: ["En cours", "accent"], received: ["Réceptionné", "ok"], closed: ["Clos", "neutral"] };

/** Taux de retenue écrit sans zéro inutile : « 5 % », « 7,5 % ». */
const taux = (v: number) => fmtPct(v, Number.isInteger(v) ? 0 : 1);

export default function ChantiersPage() {
  const { data, error, mutate } = useApi<{ items: Chantier[]; totals: Record<string, number> }>("/chantiers");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const saisie = useAutorise(SAISIE);
  return (
    <div>
      <PageHeader
        title="BTP"
        subtitle="Situations d'avancement, facturation à l'avancement, retenues de garantie suivies jusqu'à leur libération."
        actions={saisie ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau chantier</Button> : undefined}
      />
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des chantiers…">
        {(d) => (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Kpi label="Marchés en portefeuille" value={fmtShort(d.totals.contract_amount)} />
              <Kpi label="Travaux facturés" value={fmtShort(d.totals.invoiced_amount)} tone="ok" />
              <Kpi label="Retenues de garantie à recouvrer" value={fmtShort(d.totals.retention_outstanding)} tone="warn" />
            </div>
            <Card padded={false}>
              <DataTable
                rows={d.items}
                rowKey={(c) => c.id}
                onRowClick={(c) => setSelected(c.id)}
                empty="Aucun chantier."
                columns={[
                  { key: "name", label: "Chantier", render: (c) => <span className="flex items-center gap-2"><HardHat className="h-4 w-4 text-accent" />{c.name}</span> },
                  { key: "client", label: "Maître d'ouvrage", render: (c) => c.client.name },
                  { key: "contract_amount", label: "Marché HT", align: "right", render: (c) => fmtGNF(c.contract_amount) },
                  { key: "progress_pct", label: "Avancement facturé", render: (c) => <div className="w-32"><ProgressBar value={c.progress_pct} tone="accent" /><span className="text-[11px] text-muted">{fmtPct(c.progress_pct, 0)}</span></div> },
                  { key: "invoiced_amount", label: "Facturé HT", align: "right", render: (c) => fmtGNF(c.invoiced_amount) },
                  { key: "retention_outstanding", label: "Retenues", align: "right", render: (c) => fmtGNF(c.retention_outstanding) },
                  { key: "state", label: "État", render: (c) => <Badge tone={STATE[c.state][1]}>{STATE[c.state][0]}</Badge> },
                ]}
              />
            </Card>
          </>
        )}
      </Etat>
      {selected !== null && <ChantierModal key={selected} id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
      {creating && <ChantierForm onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); void mutate(); setSelected(id); }} />}
    </div>
  );
}

function ChantierModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data, error, mutate } = useApi<Chantier>(`/chantiers/${id}`);
  const [mode, setMode] = useState<"amount" | "pct">("pct");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState(false);
  const saisie = useAutorise(SAISIE);
  const facturation = useAutorise(FACTURATION);
  const envoi = useEnvoi();
  const saisi = lireNombre(value);
  const erreurSaisie = nombreIllisible(value) ? AIDE_NOMBRE : saisi !== null && saisi <= 0 ? "Valeur positive attendue." : undefined;
  function relire() {
    void mutate();
    onChanged();
  }
  async function agir(cle: string, fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    const fait = await envoi.run(cle, fn, ok);
    if (fait) relire();
    return fait;
  }
  return (
    <Modal open wide title={data ? `${data.name}, ${data.client.name}` : "Chantier"} onClose={onClose}>
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement du chantier…">
        {(c) => {
          const situations = c.situations ?? [];
          const derniereFacturee = situations.filter((s) => s.state === "invoiced").sort((a, b) => b.number - a.number)[0];
          return (
            <div className="space-y-5">
              {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Marché HT" value={fmtShort(c.contract_amount)} />
                <Kpi label="Facturé HT" value={fmtShort(c.invoiced_amount)} hint={`Avancement ${fmtPct(c.progress_pct)}`} tone="accent" />
                <Kpi label="Coûts imputés" value={fmtShort(c.costs)} />
                <Kpi label="Marge" value={fmtShort(c.margin)} tone={(c.margin ?? 0) >= 0 ? "ok" : "danger"} />
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
                  <div><div className="text-xs text-muted">État</div><Badge tone={STATE[c.state][1]}>{STATE[c.state][0]}</Badge></div>
                  <div><div className="text-xs text-muted">Démarrage</div>{fmtDate(c.date_start)}</div>
                  <div><div className="text-xs text-muted">Fin prévue</div>{fmtDate(c.date_end)}</div>
                  <div><div className="text-xs text-muted">Réception provisoire</div>{fmtDate(c.date_reception)}</div>
                  <div><div className="text-xs text-muted">Retenue de garantie</div>{taux(c.retention_rate)}</div>
                  <div><div className="text-xs text-muted">Localisation</div>{c.location ?? "–"}</div>
                </div>
                {saisie && <Button disabled={!!envoi.busy} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Modifier le chantier</Button>}
              </div>
              {c.state === "closed" && <Notice tone="neutral">Chantier clos : aucune situation ne s&apos;y saisit plus. « Modifier le chantier » le remet en cours au besoin.</Notice>}
              <DataTable dense rows={situations} rowKey={(s) => s.id} empty="Aucune situation." columns={[
                { key: "number", label: "N°", align: "right", render: (s) => String(s.number) },
                { key: "date", label: "Date", render: (s) => fmtDate(s.date) },
                { key: "period_label", label: "Période", render: (s) => s.period_label ?? "–" },
                { key: "cumulative_amount", label: "Cumul HT", align: "right", render: (s) => fmtGNF(s.cumulative_amount) },
                { key: "amount_period", label: "Période HT", align: "right", render: (s) => fmtGNF(s.amount_period) },
                { key: "retention_amount", label: `Retenue ${taux(c.retention_rate)}`, align: "right", render: (s) => fmtGNF(s.retention_amount) },
                { key: "state", label: "", render: (s) => {
                  if (s.state === "draft") return (
                    <span className="flex justify-end gap-2">
                      {/* Sans droit de facturer (chantiers, direction), la situation attend la finance. */}
                      {facturation ? (
                        <Button size="sm" loading={envoi.busy === `facturer-${s.id}`} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation(`Facturer la situation n° ${s.number} ? La facture de ${fmtGNF(s.amount_period)} HT est validée et la retenue de garantie comptabilisée.`, { action: "Facturer", danger: true })) void agir(`facturer-${s.id}`, () => apiSend("POST", `/chantiers/situations/${s.id}/invoice`), "Situation facturée."); }}>Facturer</Button>
                      ) : <Badge tone="warn">À facturer</Badge>}
                      {saisie && <Button variant="danger" size="sm" loading={envoi.busy === `annuler-${s.id}`} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation("Annuler cette situation saisie ? Elle ne sera pas facturée.", { action: "Annuler la situation", danger: true })) void agir(`annuler-${s.id}`, () => apiSend("POST", `/chantiers/situations/${s.id}/cancel`), "Situation annulée."); }}>Annuler</Button>}
                    </span>
                  );
                  if (s.state === "invoiced") return (
                    <span className="flex items-center justify-end gap-2">
                      {s.invoice && <Badge tone="ok">{s.invoice.name}</Badge>}
                      {facturation && s.id === derniereFacturee?.id && <Button variant="danger" size="sm" loading={envoi.busy === `avoir-${s.id}`} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation(`Annuler la situation n° ${s.number} par un avoir ? L'avoir de sa facture et l'extourne de sa retenue sont comptabilisés ce jour ; son cumul redevient facturable.`, { action: "Annuler par un avoir", danger: true })) void agir(`avoir-${s.id}`, () => apiSend("POST", `/chantiers/situations/${s.id}/reverse`), "Situation annulée par un avoir."); }}>Annuler par un avoir</Button>}
                    </span>
                  );
                  return <Badge>{s.credit_note ? `Annulée (avoir ${s.credit_note.name})` : "Annulée"}</Badge>;
                } },
              ]} />
              {saisie && c.state !== "closed" && (
                <Card title="Nouvelle situation">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                    <Field label="Saisie"><Select value={mode} onChange={(e) => setMode(e.target.value as "amount" | "pct")} options={[{ value: "pct", label: "Avancement cumulé (%)" }, { value: "amount", label: "Travaux cumulés HT" }]} /></Field>
                    <Field label={mode === "pct" ? "Avancement cumulé (%)" : "Montant cumulé HT (GNF)"} error={erreurSaisie}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
                    <Field label="Période" className="md:col-span-2"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Travaux d'octobre 2026" /></Field>
                    <div className="flex items-end">
                      <Button variant="primary" loading={envoi.busy === "situation"} disabled={saisi === null || saisi <= 0 || !!envoi.busy} onClick={async () => {
                        const corps = mode === "pct" ? { progress_pct: saisi, period_label: label } : { cumulative_amount: saisi, period_label: label };
                        if (await agir("situation", () => apiSend("POST", `/chantiers/${c.id}/situations`, corps), "Situation enregistrée en brouillon.")) { setValue(""); setLabel(""); }
                      }}>Enregistrer</Button>
                    </div>
                  </div>
                </Card>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-panel-2 px-4 py-3 text-sm">
                <span>
                  Retenues constituées {fmtGNF(c.retention_total)}, libérées {fmtGNF(c.retention_released)}, à recouvrer <b>{fmtGNF(c.retention_outstanding)}</b>.
                  {c.retention_released_due > 0.5 && <> Libérées et non encore réglées par le client : <b>{fmtGNF(c.retention_released_due)}</b>, exigibles et relancées.</>}
                </span>
                {facturation && <Button loading={envoi.busy === "liberer"} disabled={c.retention_outstanding <= 0.5 || !!envoi.busy} onClick={async () => { if (await demanderConfirmation(`Libérer les retenues de garantie ? ${fmtGNF(c.retention_outstanding)} passent de 4117 au compte du client et deviennent exigibles.`, { action: "Libérer les retenues", danger: true })) void agir("liberer", () => apiSend("POST", `/chantiers/${c.id}/release-retention`), "Retenues libérées : elles redeviennent exigibles du client."); }}><Unlock className="h-4 w-4" /> Libérer les retenues</Button>}
              </div>
              {editing && <ChantierEdit chantier={c} onClose={() => setEditing(false)} onDone={() => { setEditing(false); relire(); }} />}
            </div>
          );
        }}
      </Etat>
    </Modal>
  );
}

/**
 * Fiche du chantier (PATCH du noyau) : état, dates, réception provisoire, montant du marché et avenant,
 * retenue de garantie, localisation. Le noyau fige la retenue et le maître d'ouvrage dès la première
 * situation facturée, refuse un marché sous les travaux facturés, une réception sans date et la clôture
 * d'un chantier qui a des situations en brouillon : l'écran le dit avant l'envoi.
 */
function ChantierEdit({ chantier: c, onClose, onDone }: { chantier: Chantier; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    state: c.state as EtatChantier, date_start: c.date_start ?? "", date_end: c.date_end ?? "", date_reception: c.date_reception ?? "",
    contract_amount: c.contract_amount ? fmtDec(c.contract_amount) : "", avenant: "", retention_rate: fmtDec(c.retention_rate), location: c.location ?? "",
  });
  const envoi = useEnvoi();
  const marche = f.contract_amount.trim() ? lireNombre(f.contract_amount) : 0;
  const avenant = f.avenant.trim() ? lireNombre(f.avenant) : 0;
  const retenue = lireNombre(f.retention_rate);
  const nouveauMarche = marche !== null && avenant !== null ? marche + avenant : null;
  const brouillons = (c.situations ?? []).filter((s) => s.state === "draft").length;
  const erreurMarche = nombreIllisible(f.contract_amount) ? AIDE_NOMBRE : marche !== null && marche < 0 ? "Montant positif attendu." : undefined;
  const erreurAvenant = nombreIllisible(f.avenant)
    ? AIDE_NOMBRE
    : nouveauMarche !== null && nouveauMarche < c.invoiced_cumulative - 0.5
      ? `Le marché ne descend pas sous les travaux déjà facturés (${fmtGNF(c.invoiced_cumulative)}).`
      : nouveauMarche !== null && nouveauMarche < 0 ? "Le marché ne peut pas être négatif." : undefined;
  const erreurRetenue = nombreIllisible(f.retention_rate) || retenue === null ? AIDE_NOMBRE : retenue < 0 || retenue > 100 ? "Pourcentage de 0 à 100." : undefined;
  const erreurReception = f.state === "received" && !f.date_reception ? "Date requise pour un chantier réceptionné." : f.date_reception && f.date_start && f.date_reception < f.date_start ? "La réception ne précède pas le démarrage." : undefined;
  const erreurFin = f.date_end && f.date_start && f.date_end < f.date_start ? "La fin prévue ne précède pas le démarrage." : undefined;
  const erreurEtat = f.state === "closed" && c.state !== "closed" && brouillons ? "Facturez ou annulez d'abord les situations en brouillon." : undefined;
  const pret = !erreurMarche && !erreurAvenant && !erreurRetenue && !erreurReception && !erreurFin && !erreurEtat && nouveauMarche !== null && retenue !== null;

  async function enregistrer() {
    const corps: Record<string, unknown> = {
      state: f.state, date_start: f.date_start || null, date_end: f.date_end || null, date_reception: f.date_reception || null,
      contract_amount: nouveauMarche, location: f.location,
    };
    // Taux figé après la première facture : il n'est envoyé que s'il peut changer.
    if (!c.has_invoiced) corps.retention_rate = retenue;
    if (await envoi.run("enregistrer", () => apiSend("PATCH", `/chantiers/${c.id}`, corps), undefined, "Enregistrement impossible.")) onDone();
  }
  return (
    <Modal open wide title={`Modifier ${c.name}`} onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={!pret || !!envoi.busy} onClick={() => void enregistrer()}>Enregistrer</Button>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {envoi.message && <div className="md:col-span-3"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
        <Field label="État" error={erreurEtat}>
          <Select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as EtatChantier })} options={(Object.keys(STATE) as EtatChantier[]).map((k) => ({ value: k, label: STATE[k][0] }))} />
        </Field>
        <Field label="Démarrage"><Input type="date" value={f.date_start} onChange={(e) => setF({ ...f, date_start: e.target.value })} /></Field>
        <Field label="Fin prévue" error={erreurFin}><Input type="date" value={f.date_end} onChange={(e) => setF({ ...f, date_end: e.target.value })} /></Field>
        <Field label="Réception provisoire" error={erreurReception}><Input type="date" value={f.date_reception} onChange={(e) => setF({ ...f, date_reception: e.target.value })} /></Field>
        <Field label="Montant du marché HT (GNF)" error={erreurMarche}><Input inputMode="decimal" className="font-mono" value={f.contract_amount} onChange={(e) => setF({ ...f, contract_amount: e.target.value })} /></Field>
        <Field label="Avenant HT (GNF)" error={erreurAvenant} hint={f.avenant.trim() && nouveauMarche !== null ? `Nouveau montant du marché : ${fmtGNF(nouveauMarche)}` : "Ajouté au marché ; négatif pour une réduction."}>
          <Input inputMode="decimal" className="font-mono" value={f.avenant} onChange={(e) => setF({ ...f, avenant: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Retenue de garantie (%)" error={c.has_invoiced ? undefined : erreurRetenue} hint={c.has_invoiced ? "Figée depuis la première situation facturée : les retenues comptabilisées en dépendent." : undefined}>
          <Input inputMode="decimal" disabled={c.has_invoiced} value={f.retention_rate} onChange={(e) => setF({ ...f, retention_rate: e.target.value })} />
        </Field>
        <Field label="Localisation" className="md:col-span-2"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <p className="text-[12px] text-muted md:col-span-3">
          Maître d&apos;ouvrage : {c.client.name}{c.has_invoiced ? ", inchangeable depuis la première facture." : "."} Un chantier clos n&apos;accepte plus de situation ; il se remet « En cours » ou « Réceptionné » ici.
        </p>
      </div>
    </Modal>
  );
}

function ChantierForm({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ name: "", code: "", contract_amount: "", retention_rate: "5", location: "", date_start: "" });
  const envoi = useEnvoi();
  const marche = f.contract_amount.trim() ? lireNombre(f.contract_amount) : 0;
  const retenue = lireNombre(f.retention_rate);
  const erreurMarche = nombreIllisible(f.contract_amount) ? AIDE_NOMBRE : marche !== null && marche < 0 ? "Montant positif attendu." : undefined;
  const erreurRetenue = nombreIllisible(f.retention_rate) || retenue === null ? AIDE_NOMBRE : retenue < 0 || retenue > 100 ? "Pourcentage de 0 à 100." : undefined;
  const pret = Boolean(f.name.trim() && client && !erreurMarche && !erreurRetenue && marche !== null && retenue !== null);
  async function submit() {
    let id: number | null = null;
    const ok = await envoi.run("creer", async () => {
      id = (await apiSend<Chantier>("POST", "/chantiers", { ...f, name: f.name.trim(), partner_id: client?.id, contract_amount: marche, retention_rate: retenue, date_start: f.date_start || undefined })).id;
    }, undefined, "Enregistrement impossible.");
    if (ok && id !== null) onDone(id);
  }
  return (
    <Modal open title="Nouveau chantier" onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "creer"} onClick={() => void submit()} disabled={!pret || !!envoi.busy}>Créer</Button>}>
      <div className="grid grid-cols-2 gap-3">
        {envoi.message && <div className="col-span-2"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
        <Field label="Chantier" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Maître d'ouvrage" className="col-span-2"><PartnerPicker value={client} onChange={setClient} kind="customer" /></Field>
        <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Localisation"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Montant du marché HT (GNF)" error={erreurMarche}><Input inputMode="decimal" className="font-mono" value={f.contract_amount} onChange={(e) => setF({ ...f, contract_amount: e.target.value })} /></Field>
        <Field label="Retenue de garantie (%)" error={erreurRetenue}><Input inputMode="decimal" value={f.retention_rate} onChange={(e) => setF({ ...f, retention_rate: e.target.value })} /></Field>
        <Field label="Démarrage"><Input type="date" value={f.date_start} onChange={(e) => setF({ ...f, date_start: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
