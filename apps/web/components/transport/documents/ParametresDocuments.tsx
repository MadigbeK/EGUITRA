"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { Button, Card, DataTable, Etat, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtInt, lireNombre, nombreIllisible } from "@/lib/format";
import { ChampNombre, NombreSurPlace } from "../commun";
import type { AccountRef } from "../types";
import { texteErreur } from "./PanneauDocuments";
import type { ReglagesDocuments, Rubrique } from "./types";

interface RouteRow {
  id: number;
  name: string;
  origin: string | null;
  destination: string | null;
  road_fee_per_day: number;
  std_tolls: number;
  duration_days: number | null;
  steps: Array<{ place: string; city: string | null; country: string | null; direction: "out" | "back"; stop_reason: string | null }>;
}

interface Client { id: number; name: string; demurrage_billable: boolean; demurrage_rate: number | null; demurrage_free_days: number | null }

/**
 * Réglages de la chaîne documentaire : numérotation (préfixes), franchise d'immobilisation, mentions,
 * signataires, consignes au chauffeur (administration) ; rubriques des budgets, compte des avances, caisse et
 * tolérance de complément (finance et administration) ; frais de route et étapes types par route ;
 * immobilisation facturée par client.
 */
export function ParametresDocuments() {
  const { data: s, error, mutate } = useApi<ReglagesDocuments>("/transport/documents/settings");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function envoyer(methode: "PATCH" | "PUT", chemin: string, corps: unknown, texte: string) {
    setMessage(null);
    try {
      const res = await apiSend<ReglagesDocuments>(methode, chemin, corps);
      if (res && "prefixes" in res) await mutate(res, { revalidate: false });
      else void mutate();
      setMessage({ tone: "ok", text: texte });
    } catch (e) {
      setMessage({ tone: "danger", text: texteErreur(e) });
    }
  }
  if (!s) return <Etat error={error} onRetry={() => mutate()} />;
  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Generaux s={s} envoyer={envoyer} />
      <Rubriques s={s} envoyer={envoyer} />
      <Comptes s={s} envoyer={envoyer} />
      <FraisDeRoute />
      <Immobilisations />
    </div>
  );
}

type Envoi = (methode: "PATCH" | "PUT", chemin: string, corps: unknown, texte: string) => Promise<void>;

function Generaux({ s, envoyer }: { s: ReglagesDocuments; envoyer: Envoi }) {
  const [f, setF] = useState({ free_days: String(s.free_days), authorities_note: s.authorities_note, waybill_note: s.waybill_note, order_signatory: s.order_signatory, order_signatory_name: s.order_signatory_name, operations_manager: s.operations_manager });
  const [prefixes, setPrefixes] = useState<Record<string, string>>(s.prefixes);
  const [consignes, setConsignes] = useState<string[]>(s.instructions.map((i) => i.name));
  const [station, setStation] = useState(s.fuel_station);
  useEffect(() => { setPrefixes(s.prefixes); setConsignes(s.instructions.map((i) => i.name)); setStation(s.fuel_station); }, [s]);
  const ro = !s.can_edit;
  return (
    <Card title="Documents : numérotation, mentions et consignes" actions={!ro ? (
      <Button size="sm" variant="primary" disabled={nombreIllisible(f.free_days)} onClick={() => void envoyer("PATCH", "/transport/documents/settings", {
        ...f, free_days: lireNombre(f.free_days) ?? 0, prefixes, instructions: consignes.filter((c) => c.trim()), fuel_station_id: station?.id ?? null,
      }, "Réglages des documents enregistrés.")}>Enregistrer</Button>
    ) : undefined}>
      {ro && <p className="mb-3 text-[12.5px] text-muted">Réglés par l'administration.</p>}
      <fieldset disabled={ro} className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {s.documents.map((d) => (
            <Field key={d.code} label={d.label} hint={`Numéros : ${prefixes[d.code] ?? d.default}/année/0001`}>
              <Input value={prefixes[d.code] ?? ""} onChange={(e) => setPrefixes({ ...prefixes, [d.code]: e.target.value.toUpperCase() })} />
            </Field>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <ChampNombre label="Franchise d'immobilisation (jours)" value={f.free_days} onChange={(e) => setF({ ...f, free_days: e.target.value })} />
          <Field label="Signataire des ordres de transport"><Input value={f.order_signatory} onChange={(e) => setF({ ...f, order_signatory: e.target.value })} /></Field>
          <Field label="Nom du signataire"><Input value={f.order_signatory_name} onChange={(e) => setF({ ...f, order_signatory_name: e.target.value })} /></Field>
          <Field label="Responsable des opérations" hint="Signe l'ordre de mission et le budget"><Input value={f.operations_manager} onChange={(e) => setF({ ...f, operations_manager: e.target.value })} /></Field>
          <Field label="Station carburant habituelle" className="md:col-span-2"><PartnerPicker kind="supplier" creation={false} value={station} onChange={setStation} placeholder="Station…" /></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Mention aux autorités (ordre de mission)"><Textarea rows={2} value={f.authorities_note} onChange={(e) => setF({ ...f, authorities_note: e.target.value })} /></Field>
          <Field label="Autres mentions de la lettre de voiture" hint="Une par ligne, sous la franchise"><Textarea rows={2} value={f.waybill_note} onChange={(e) => setF({ ...f, waybill_note: e.target.value })} /></Field>
        </div>
        <div>
          <div className="mb-1 text-[13px] font-semibold text-ink">Consignes au chauffeur (lettre de voiture)</div>
          {consignes.map((c, i) => (
            <div key={i} className="mb-1 flex gap-2">
              <Input aria-label={`Consigne ${i + 1}`} value={c} onChange={(e) => setConsignes(consignes.map((x, j) => (j === i ? e.target.value : x)))} />
              {!ro && <Button size="sm" variant="ghost" aria-label="Retirer la consigne" onClick={() => setConsignes(consignes.filter((_x, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
          {!ro && <Button size="sm" onClick={() => setConsignes([...consignes, ""])}><Plus className="h-4 w-4" /> Consigne</Button>}
        </div>
      </fieldset>
    </Card>
  );
}

function Rubriques({ s, envoyer }: { s: ReglagesDocuments; envoyer: Envoi }) {
  const [lignes, setLignes] = useState<Rubrique[]>(s.rubrics);
  useEffect(() => setLignes(s.rubrics), [s]);
  const { data: charges } = useApi<AccountRef[]>(s.can_edit_rubrics ? "/finance/accounts?prefix=6&limit=2000" : null);
  const ro = !s.can_edit_rubrics;
  const maj = (i: number, patch: Partial<Rubrique>) => setLignes(lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const opt = (liste: Array<{ code: string; label: string }>) => liste.map((x) => ({ value: x.code, label: x.label }));
  return (
    <Card title="Rubriques des budgets de voyage" actions={!ro ? (
      <Button size="sm" variant="primary" disabled={lignes.some((l) => !l.name.trim() || !l.code.trim())} onClick={() => void envoyer("PUT", "/transport/budget-rubrics", {
        rubrics: lignes.map((l) => ({ id: l.id, code: l.code, name: l.name, kind: l.kind, unit: l.unit, cost_field: l.cost_field, prefill: l.prefill, active: l.active, account_id: l.account?.id ?? null })),
      }, "Rubriques enregistrées.")}>Enregistrer</Button>
    ) : undefined} padded={false}>
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[980px] text-[13px]">
          <thead><tr className="text-left text-muted"><th>Code</th><th>Rubrique</th><th>Nature</th><th>Unité</th><th>Coût de la rotation</th><th>Pré-remplissage</th><th>Compte de charge</th><th>Active</th></tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={l.id ?? `n${i}`}>
                <td className="w-24 pr-1"><Input aria-label="Code" disabled={ro || Boolean(l.id)} value={l.code} onChange={(e) => maj(i, { code: e.target.value })} /></td>
                <td className="pr-1"><Input aria-label="Rubrique" disabled={ro} value={l.name} onChange={(e) => maj(i, { name: e.target.value })} /></td>
                <td className="pr-1"><Select aria-label="Nature" disabled={ro} value={l.kind} onChange={(e) => maj(i, { kind: e.target.value as Rubrique["kind"] })} options={opt(s.kinds)} /></td>
                <td className="pr-1"><Select aria-label="Unité" disabled={ro} value={l.unit} onChange={(e) => maj(i, { unit: e.target.value as Rubrique["unit"] })} options={opt(s.units)} /></td>
                <td className="pr-1"><Select aria-label="Coût" disabled={ro} value={l.cost_field} onChange={(e) => maj(i, { cost_field: e.target.value })} options={opt(s.cost_fields)} /></td>
                <td className="pr-1"><Select aria-label="Pré-remplissage" disabled={ro} value={l.prefill} onChange={(e) => maj(i, { prefill: e.target.value })} options={opt(s.prefills)} /></td>
                <td className="pr-1"><Select aria-label="Compte" disabled={ro} value={l.account?.id ?? ""} placeholder="Compte usuel" onChange={(e) => {
                  const a = (charges ?? []).find((x) => String(x.id) === e.target.value);
                  maj(i, { account: a ? { id: a.id, code: a.code, name: a.name } : null });
                }} options={(charges ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></td>
                <td><input type="checkbox" aria-label="Active" disabled={ro} checked={l.active} onChange={(e) => maj(i, { active: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!ro && <Button size="sm" className="mt-2" onClick={() => setLignes([...lignes, { code: "", name: "", kind: "cash", unit: "fixed", cost_field: "other_costs", prefill: "none", active: true, account: null }])}><Plus className="h-4 w-4" /> Rubrique</Button>}
        <p className="mt-2 text-[12.5px] text-muted">À la clôture d'un budget, les montants réels d'une rubrique remplacent le coût déclaré correspondant de la rotation. Les comptes de charge sont à valider avec l'expert-comptable.</p>
      </div>
    </Card>
  );
}

function Comptes({ s, envoyer }: { s: ReglagesDocuments; envoyer: Envoi }) {
  const { data: comptes } = useApi<AccountRef[]>(s.can_edit_rubrics ? "/finance/accounts?prefix=42&limit=500" : null);
  const [tolerance, setTolerance] = useState(String(s.complement_tolerance || ""));
  if (!s.can_edit_rubrics) return null;
  return (
    <Card title="Avances de frais de route">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Compte des avances" hint="Vide : 4213 (frais avancés au personnel), sinon 4211">
          <Select value={s.advance_account?.id ?? ""} placeholder="Compte par défaut" onChange={(e) => void envoyer("PATCH", "/transport/documents/accounts", { advance_account_id: e.target.value ? Number(e.target.value) : null }, "Compte enregistré.")}
            options={(comptes ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
        </Field>
        <Field label="Caisse des budgets de voyage" hint="Proposée au décaissement et à la clôture">
          <Select value={s.journal?.id ?? ""} placeholder="Première caisse" onChange={(e) => void envoyer("PATCH", "/transport/documents/accounts", { journal_id: e.target.value ? Number(e.target.value) : null }, "Caisse enregistrée.")}
            options={s.journals.map((j) => ({ value: j.id, label: j.name }))} />
        </Field>
        <div className="flex items-end gap-2">
          <ChampNombre label="Tolérance de complément (GNF)" hint="Au-delà : additif motivé obligatoire" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
          <Button size="sm" disabled={nombreIllisible(tolerance)} onClick={() => void envoyer("PATCH", "/transport/documents/accounts", { complement_tolerance: lireNombre(tolerance) ?? 0 }, "Tolérance enregistrée.")}>Enregistrer</Button>
        </div>
      </div>
    </Card>
  );
}

/** Frais de route par jour et étapes types de chaque route (pré-remplissage du budget et du plan de voyage). */
function FraisDeRoute() {
  const { data: routes, mutate } = useApi<RouteRow[]>("/transport/routes");
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  async function patch(id: number, corps: Record<string, unknown>) {
    setErreur(null);
    try {
      await apiSend("PATCH", `/transport/routes/${id}`, corps);
      void mutate();
    } catch (e) {
      setErreur(texteErreur(e));
    }
  }
  return (
    <Card title="Frais de route et étapes types par route" padded={false}>
      {erreur && <div className="p-3"><Notice tone="danger">{erreur}</Notice></div>}
      <DataTable
        rows={routes ?? []}
        rowKey={(r) => r.id}
        empty="Aucune route."
        columns={[
          { key: "name", label: "Route", render: (r) => r.name },
          { key: "fee", label: "Frais de route par jour (GNF)", align: "right", render: (r) => <NombreSurPlace label={`Frais de route par jour, ${r.name}`} value={r.road_fee_per_day || null} onCommit={(n) => void patch(r.id, { road_fee_per_day: n ?? 0 })} /> },
          { key: "tolls", label: "Péages (GNF)", align: "right", render: (r) => <NombreSurPlace label={`Péages, ${r.name}`} value={r.std_tolls || null} onCommit={(n) => void patch(r.id, { std_tolls: n ?? 0 })} /> },
          { key: "days", label: "Durée (jours)", align: "right", render: (r) => fmtInt(r.duration_days ?? 0) },
          { key: "steps", label: "Étapes types", render: (r) => (
            <button type="button" className="text-accent underline" onClick={() => setOuverte(ouverte === r.id ? null : r.id)}>{r.steps.length ? r.steps.map((x) => x.place).join(", ") : "Ajouter"}</button>
          ) },
        ]}
      />
      {ouverte !== null && routes?.find((r) => r.id === ouverte) && (
        <EtapesRoute route={routes.find((r) => r.id === ouverte)!} onSave={(steps) => void patch(ouverte, { steps })} />
      )}
    </Card>
  );
}

function EtapesRoute({ route, onSave }: { route: RouteRow; onSave: (steps: RouteRow["steps"]) => void }) {
  const [etapes, setEtapes] = useState(route.steps);
  useEffect(() => setEtapes(route.steps), [route]);
  const maj = (i: number, k: string, v: string) => setEtapes(etapes.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  return (
    <div className="space-y-2 border-t border-line p-3">
      <div className="text-[13px] text-muted">{route.name} : départ {route.origin ?? "?"}, destination {route.destination ?? "?"} (ajoutés d'office au plan) ; étapes intermédiaires :</div>
      {etapes.map((e, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Input aria-label="Lieu" placeholder="Lieu" value={e.place} onChange={(x) => maj(i, "place", x.target.value)} />
          <Input aria-label="Ville" placeholder="Ville" value={e.city ?? ""} onChange={(x) => maj(i, "city", x.target.value)} />
          <Input aria-label="Pays" placeholder="Pays" value={e.country ?? ""} onChange={(x) => maj(i, "country", x.target.value)} />
          <Select aria-label="Sens" value={e.direction} onChange={(x) => maj(i, "direction", x.target.value)} options={[{ value: "out", label: "Aller" }, { value: "back", label: "Retour" }]} />
          <Input aria-label="Motif d'escale" placeholder="Motif d'escale" value={e.stop_reason ?? ""} onChange={(x) => maj(i, "stop_reason", x.target.value)} />
          <Button size="sm" variant="ghost" aria-label="Retirer l'étape" onClick={() => setEtapes(etapes.filter((_x, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setEtapes([...etapes, { place: "", city: "", country: "Guinée", direction: "out", stop_reason: "" }])}><Plus className="h-4 w-4" /> Étape</Button>
        <Button size="sm" variant="primary" disabled={etapes.some((e) => !e.place.trim())} onClick={() => onSave(etapes)}>Enregistrer les étapes</Button>
      </div>
    </div>
  );
}

/** Immobilisation au-delà de la franchise, facturée ou non, par client (finance et administration). */
function Immobilisations() {
  const { data: clients, mutate } = useApi<Client[]>("/transport/clients");
  const [erreur, setErreur] = useState<string | null>(null);
  async function patch(id: number, corps: Record<string, unknown>) {
    setErreur(null);
    try {
      await apiSend("PATCH", `/transport/clients/${id}`, corps);
      void mutate();
    } catch (e) {
      setErreur(texteErreur(e));
    }
  }
  return (
    <Card title="Immobilisation des camions par client" padded={false}>
      {erreur && <div className="p-3"><Notice tone="danger">{erreur}</Notice></div>}
      <DataTable
        rows={clients ?? []}
        rowKey={(c) => c.id}
        empty="Aucun client du transport."
        columns={[
          { key: "name", label: "Client", render: (c) => c.name },
          { key: "billable", label: "Facturée", render: (c) => <input type="checkbox" aria-label={`Immobilisation facturée, ${c.name}`} checked={c.demurrage_billable} onChange={(e) => void patch(c.id, { demurrage_billable: e.target.checked })} /> },
          { key: "rate", label: "Tarif journalier (GNF)", align: "right", render: (c) => <NombreSurPlace label={`Tarif journalier, ${c.name}`} value={c.demurrage_rate} nullable onCommit={(n) => void patch(c.id, { demurrage_rate: n ?? 0 })} /> },
          { key: "free", label: "Franchise propre (jours)", align: "right", render: (c) => <NombreSurPlace label={`Franchise, ${c.name}`} value={c.demurrage_free_days} nullable placeholder="Société" onCommit={(n) => void patch(c.id, { demurrage_free_days: n ?? 0 })} /> },
        ]}
      />
      <p className="p-3 text-[12.5px] text-muted">Les jours entre l'arrivée et le départ du véhicule (toute journée commencée compte), moins la franchise, s'ajoutent à la facture des rotations du client quand l'immobilisation est facturée.</p>
    </Card>
  );
}
