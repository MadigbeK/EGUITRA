"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Plus, Trash2 } from "@/components/icons";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Notice, Select, Textarea, demanderConfirmation } from "@/components/ui";
import { apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { tonEtat } from "@/lib/couleurs";
import { fmtDate, fmtDateTime, fmtGNF, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";
import { ChampNombre, ETAT_ROTATION, FenetreMotif, fmtM3 } from "../commun";
import type { Referentials } from "../types";
import { PanneauDocuments, texteErreur } from "./PanneauDocuments";
import {
  ETATS_BUDGET, ETATS_VOYAGE, NATURES, UNITES,
  type BudgetDetail, type Colis, type Engin, type LettreVoiture, type LigneBudget, type Operation, type ReglagesDocuments, type Voyage,
} from "./types";

/** Adresse d'une opération : /transport/operations?id=… (fiche complète, documents compris). */
export function OperationDepuisAdresse() {
  const id = Number(useSearchParams().get("id"));
  if (!Number.isInteger(id) || id <= 0) return <Notice tone="accent">Ouvrez une opération depuis un ordre de transport ou la liste des rotations.</Notice>;
  return <FicheOperation id={id} />;
}

/** Action commune des cartes : appel, puis relecture de l'opération ; l'erreur est rendue à la carte. */
function useAction(onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  async function agir(appel: () => Promise<unknown>, ok?: () => void) {
    setBusy(true);
    setErreur(null);
    try {
      await appel();
      ok?.();
      onChanged();
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, erreur, agir };
}

export function FicheOperation({ id }: { id: number }) {
  const { data: op, error, mutate } = useApi<Operation>(`/transport/rotations/${id}/operation`);
  const { data: reglages } = useApi<ReglagesDocuments>("/transport/documents/settings");
  const { data: ref } = useApi<Referentials>("/transport/referentials");
  if (!op || !reglages || !ref) return <Etat error={error} onRetry={() => mutate()} />;
  const r = op.rotation;
  const recharger = () => void mutate();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-muted">
        <Badge tone={tonEtat(ETAT_ROTATION[r.state])}>{ETAT_ROTATION[r.state]}</Badge>
        <span>{r.vehicle.name} · {r.route.name} · {r.client.name} · {r.product_label}</span>
        {r.order && <Link className="inline-flex items-center gap-1 text-accent underline" href={`/transport/ordres?ordre=${r.order.id}`}>Ordre {r.order.name} <ArrowUpRight className="h-3 w-3" /></Link>}
        <Badge tone={tonEtat(ETATS_VOYAGE[r.trip_state])}>{ETATS_VOYAGE[r.trip_state]}</Badge>
      </div>
      <PanneauDocuments documents={op.documents} combine={`/transport/rotations/${id}/documents.pdf`} nomCombine={`Documents ${r.name ?? id}.pdf`} />
      <Planification op={op} ref_={ref} onChanged={recharger} />
      <PlanVoyage op={op} onChanged={recharger} />
      <BudgetsOperation op={op} reglages={reglages} onChanged={recharger} />
      {op.can.cash || op.trip.state === "to_justify" || op.trip.state === "closed" ? <Justification id={id} reglages={reglages} cash={op.can.cash} onChanged={recharger} /> : null}
      <CarteLettreVoiture op={op} onChanged={recharger} />
    </div>
  );
}

/* ─── Planification : engins, équipage, dates prévues ─────────────────── */

function Planification({ op, ref_, onChanged }: { op: Operation; ref_: Referentials; onChanged: () => void }) {
  const r = op.rotation;
  const { data: engins } = useApi<Array<Engin & { kind: "tractor" | "trailer"; active: boolean }>>("/transport/units");
  const initial = () => ({
    tractor_id: r.tractor ? String(r.tractor.id) : "", trailer_id: r.trailer ? String(r.trailer.id) : "",
    driver_id: r.driver ? String(r.driver.id) : "", co_driver_id: r.co_driver ? String(r.co_driver.id) : "",
    date_planned_departure: r.date_planned_departure ?? "", date_planned_arrival: r.date_planned_arrival ?? "",
    date_planned_return: r.date_planned_return ?? "", volume_planned: r.volume_planned ? String(r.volume_planned).replace(".", ",") : "",
  });
  const [f, setF] = useState<Record<string, string>>(initial);
  useEffect(() => setF(initial()), [op]);
  const { busy, erreur, agir } = useAction(onChanged);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const modifiable = op.can.ops && (r.state === "draft" || r.state === "en_route" || r.state === "done");
  function enregistrer() {
    const corps: Record<string, unknown> = {};
    for (const k of ["tractor_id", "driver_id"]) if (f[k]) corps[k] = Number(f[k]);
    for (const k of ["trailer_id", "co_driver_id"]) corps[k] = f[k] ? Number(f[k]) : null;
    for (const k of ["date_planned_departure", "date_planned_arrival", "date_planned_return"]) if (f[k]) corps[k] = f[k];
    corps.volume_planned = lireNombre(f.volume_planned ?? "") ?? 0;
    void agir(() => apiSend("PATCH", `/transport/rotations/${r.id}`, corps));
  }
  const tracteurs = (engins ?? []).filter((e) => e.kind === "tractor" && e.active);
  const remorques = (engins ?? []).filter((e) => e.kind === "trailer" && e.active);
  return (
    <Card title={`Opération ${r.name ?? ""}`} actions={modifiable ? <Button size="sm" loading={busy} disabled={nombreIllisible(f.volume_planned)} onClick={enregistrer}>Enregistrer</Button> : undefined}>
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {r.state === "done" && modifiable && <Notice tone="accent">Changer d'engin ou de chauffeur remet une rotation validée en saisie : un autre compte la revalide.</Notice>}
      <fieldset disabled={!modifiable} className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Tracteur"><Select value={f.tractor_id} onChange={set("tractor_id")} placeholder="–" options={tracteurs.map((e) => ({ value: e.id, label: e.name }))} /></Field>
        <Field label="Remorque"><Select value={f.trailer_id} onChange={set("trailer_id")} placeholder="–" options={remorques.map((e) => ({ value: e.id, label: e.name }))} /></Field>
        <Field label="Chauffeur"><Select value={f.driver_id} onChange={set("driver_id")} placeholder="–" options={ref_.drivers.filter((d) => d.crew_role !== "assistant").map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="Convoyeur"><Select value={f.co_driver_id} onChange={set("co_driver_id")} placeholder="–" options={ref_.drivers.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="Départ prévu"><Input type="date" value={f.date_planned_departure} onChange={set("date_planned_departure")} /></Field>
        <Field label="Arrivée prévue"><Input type="date" value={f.date_planned_arrival} onChange={set("date_planned_arrival")} /></Field>
        <Field label="Retour au parc prévu"><Input type="date" value={f.date_planned_return} onChange={set("date_planned_return")} /></Field>
        <ChampNombre label="Volume prévu (m³)" value={f.volume_planned} onChange={set("volume_planned")} />
      </fieldset>
      <p className="mt-3 text-[12.5px] text-muted">
        Chargement le {fmtDate(r.date_loading)} · chargé {fmtM3(r.volume_loaded)} · livré {fmtM3(r.volume_delivered)}
        {r.shortage ? ` · manquant ${fmtM3(r.shortage)}` : ""}{r.delivery_note ? ` · ${r.delivery_note}` : ""}. Volumes, tarif et frais se corrigent dans la fiche de la rotation.
      </p>
    </Card>
  );
}

/* ─── Ordre de mission : plan de voyage et mention ────────────────────── */

type Etape = Operation["mission"]["steps"][number];

function PlanVoyage({ op, onChanged }: { op: Operation; onChanged: () => void }) {
  const m = op.mission;
  const [etapes, setEtapes] = useState<Etape[]>(m.steps);
  const [mention, setMention] = useState(m.authorities_note ?? "");
  useEffect(() => { setEtapes(m.steps); setMention(m.authorities_note ?? ""); }, [m]);
  const { busy, erreur, agir } = useAction(onChanged);
  const modifiable = op.can.ops && op.rotation.state !== "cancelled";
  const maj = (i: number, k: keyof Etape, v: string) => setEtapes(etapes.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  return (
    <Card title={`Ordre de mission ${m.name ?? "(numéroté à la première impression)"}`} actions={modifiable ? (
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={() => void agir(() => apiSend("PUT", `/transport/rotations/${op.rotation.id}/mission`, { reset: true }))}>Plan de la route</Button>
        <Button size="sm" loading={busy} disabled={etapes.some((e) => !e.place.trim())} onClick={() => void agir(() => apiSend("PUT", `/transport/rotations/${op.rotation.id}/mission`, { steps: etapes, authorities_note: mention }))}>Enregistrer le plan</Button>
      </div>
    ) : undefined}>
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {m.from_route && <p className="mb-2 text-[12.5px] text-muted">Plan proposé par la route (départ, étapes types, destination, retour à la base) : il devient celui de l'ordre de mission à la première impression ou à l'enregistrement.</p>}
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-muted"><th className="py-1">Lieu</th><th>Ville</th><th>Pays</th><th>Sens</th><th>Motif d'escale</th><th /></tr></thead>
        <tbody>
          {etapes.map((e, i) => (
            <tr key={i}>
              <td className="pr-2"><Input aria-label="Lieu" disabled={!modifiable} value={e.place} onChange={(x) => maj(i, "place", x.target.value)} /></td>
              <td className="pr-2"><Input aria-label="Ville" disabled={!modifiable} value={e.city} onChange={(x) => maj(i, "city", x.target.value)} /></td>
              <td className="pr-2"><Input aria-label="Pays" disabled={!modifiable} value={e.country} onChange={(x) => maj(i, "country", x.target.value)} /></td>
              <td className="pr-2"><Select aria-label="Sens" disabled={!modifiable} value={e.direction} onChange={(x) => maj(i, "direction", x.target.value)} options={[{ value: "out", label: "Aller" }, { value: "back", label: "Retour" }]} /></td>
              <td className="pr-2"><Input aria-label="Motif d'escale" disabled={!modifiable} value={e.stop_reason} onChange={(x) => maj(i, "stop_reason", x.target.value)} /></td>
              <td>{modifiable && <Button size="sm" variant="ghost" aria-label="Retirer l'étape" onClick={() => setEtapes(etapes.filter((_x, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {modifiable && <Button size="sm" className="mt-2" onClick={() => setEtapes([...etapes, { place: "", city: "", country: "Guinée", direction: "out", stop_reason: "" }])}><Plus className="h-4 w-4" /> Étape</Button>}
      <Field label="Mention aux autorités" hint={`Vide : ${m.authorities_default ?? "mention de la société"}`} className="mt-3">
        <Textarea rows={2} disabled={!modifiable} value={mention} onChange={(e) => setMention(e.target.value)} />
      </Field>
    </Card>
  );
}

/* ─── Budgets de voyage ───────────────────────────────────────────────── */

function BudgetsOperation({ op, reglages, onChanged }: { op: Operation; reglages: ReglagesDocuments; onChanged: () => void }) {
  const [ouvert, setOuvert] = useState<number | null>(op.budgets[0]?.id ?? null);
  const { busy, erreur, agir } = useAction(onChanged);
  const initial = op.budgets.find((b) => b.kind === "initial");
  const peutAdditif = op.can.ops && initial?.state === "approved" && op.trip.state !== "closed";
  const [additif, setAdditif] = useState(false);
  function nouvelAdditif(motif: string) {
    void agir(() => apiSend<BudgetDetail>("POST", `/transport/rotations/${op.rotation.id}/budgets/new`, { kind: "additive", reason: motif }));
  }
  const total = op.budgets.filter((b) => b.state !== "rejected").reduce((s, b) => s + b.amount_total, 0);
  return (
    <Card title="Budget de voyage" actions={op.can.ops && op.rotation.state !== "cancelled" ? (
      <div className="flex gap-2">
        {!initial && <Button size="sm" variant="primary" loading={busy} onClick={() => void agir(() => apiSend("POST", `/transport/rotations/${op.rotation.id}/budgets/new`, { kind: "initial" }))}>Budget initial (pré-rempli)</Button>}
        {peutAdditif && <Button size="sm" loading={busy} onClick={() => setAdditif(true)}><Plus className="h-4 w-4" /> Additif</Button>}
      </div>
    ) : undefined}>
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {additif && <FenetreMotif titre="Additif au budget de voyage" aide="Dépense imprévue en route : l'additif suit le même circuit d'approbation que le budget." action="Créer l'additif" exemple="Éclatement de pneu, attente au dépôt…" onClose={() => setAdditif(false)} envoyer={nouvelAdditif} />}
      {!op.budgets.length ? <p className="text-[13px] text-muted">Aucun budget : le budget initial se pré-remplit depuis la route (jours prévus × frais de route, carburant selon la distance et la consommation, péages).</p> : (
        <div className="space-y-2">
          {op.budgets.map((b) => (
            <div key={b.id} className="rounded-xl ring-1 ring-line">
              <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setOuvert(ouvert === b.id ? null : b.id)} aria-expanded={ouvert === b.id}>
                <span className="font-semibold text-ink">{b.name} · {b.label}{b.reason ? ` : ${b.reason}` : ""}</span>
                <span className="flex items-center gap-2 text-[13px]">
                  <span className="font-mono">{fmtGNF(b.amount_total)}</span>
                  <Badge tone={tonEtat(ETATS_BUDGET[b.state])}>{ETATS_BUDGET[b.state]}</Badge>
                  {b.disbursed && <Badge tone="ok">Avance décaissée</Badge>}
                </span>
              </button>
              {ouvert === b.id && <EditeurBudget id={b.id} op={op} reglages={reglages} onChanged={onChanged} />}
            </div>
          ))}
          <p className="text-right text-[13px] text-muted">Total budgétisé (hors refusés) : <span className="font-mono text-ink">{fmtGNF(total)}</span></p>
        </div>
      )}
    </Card>
  );
}

interface LigneSaisie { rubric_id: string; kind: string; description: string; quantity: string; unit: string; price_unit: string; reference: string; partner: { id: number; name: string } | null }

const versSaisie = (l: LigneBudget): LigneSaisie => ({
  rubric_id: String(l.rubric.id), kind: l.kind, description: l.description ?? "", quantity: String(l.quantity).replace(".", ","),
  unit: l.unit, price_unit: String(l.price_unit).replace(".", ","), reference: l.reference ?? "", partner: l.partner,
});

function EditeurBudget({ id, op, reglages, onChanged }: { id: number; op: Operation; reglages: ReglagesDocuments; onChanged: () => void }) {
  const { data: b, error, mutate } = useApi<BudgetDetail>(`/transport/budgets/${id}`);
  const [lignes, setLignes] = useState<LigneSaisie[]>([]);
  const [journal, setJournal] = useState("");
  // Motif demandé avant un refus ou une annulation (fenêtre, lisible au téléphone).
  const [motifDemande, setMotifDemande] = useState<"refus" | "annulation" | null>(null);
  useEffect(() => { if (b) setLignes(b.lines.map(versSaisie)); }, [b]);
  useEffect(() => { if (reglages.journal) setJournal(String(reglages.journal.id)); }, [reglages.journal]);
  const apres = () => { void mutate(); onChanged(); };
  const { busy, erreur, agir } = useAction(apres);
  if (!b) return <div className="p-3"><Etat error={error} onRetry={() => mutate()} /></div>;
  const modifiable = op.can.ops && (b.state === "draft" || b.state === "rejected");
  const rubriques = reglages.rubrics.filter((r) => r.active && r.id);
  const illisible = lignes.some((l) => nombreIllisible(l.quantity) || nombreIllisible(l.price_unit));
  const maj = (i: number, patch: Partial<LigneSaisie>) => setLignes(lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const corps = () => ({ lines: lignes.map((l) => ({
    rubric_id: Number(l.rubric_id), kind: l.kind, unit: l.unit, description: l.description || null, reference: l.reference || null,
    quantity: lireNombre(l.quantity) ?? 0, price_unit: lireNombre(l.price_unit) ?? 0, partner_id: l.kind === "nature" ? l.partner?.id ?? null : null,
  })) });
  const total = lignes.reduce((s, l) => s + (lireNombre(l.quantity) ?? 0) * (lireNombre(l.price_unit) ?? 0), 0);
  function trancher(decision: "approve" | "reject", motif?: string) {
    if (!b?.approval) return;
    const corpsDecision: Record<string, unknown> = decision === "reject" ? { comment: motif } : {};
    void agir(() => apiSend("POST", `/approvals/${b.approval!.request_id}/${decision}`, corpsDecision));
  }
  function annuler(motif: string) {
    void agir(() => apiSend("POST", `/transport/budgets/${id}/cancel`, { reason: motif }));
  }
  return (
    <div className="space-y-3 border-t border-line p-3">
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {motifDemande === "refus" && <FenetreMotif titre={`Refuser le budget ${b.name}`} aide="Le demandeur lit ce motif pour corriger son budget." action="Refuser" danger onClose={() => setMotifDemande(null)} envoyer={(m) => trancher("reject", m)} />}
      {motifDemande === "annulation" && <FenetreMotif titre={`Annuler le budget ${b.name}`} action="Annuler le budget" danger onClose={() => setMotifDemande(null)} envoyer={annuler} />}
      {b.missing.length > 0 && modifiable && <Notice tone="warn">À compléter avant la soumission : {b.missing.join(", ")}.</Notice>}
      {b.approval && (
        <p className="text-[12.5px] text-muted">
          Circuit : {b.approval.steps.map((s) => `${s.label} (${s.state === "approved" ? `approuvé par ${s.decided_by}` : s.state === "rejected" ? `refusé par ${s.decided_by}` : s.state === "pending" ? "en attente" : "sans objet"})`).join(" ; ")}
          {b.approval.rejected_reason ? `. Motif du refus : ${b.approval.rejected_reason}` : ""}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead><tr className="text-left text-muted"><th>Rubrique</th><th>Nature</th><th>Libellé</th><th>Qté</th><th>Unité</th><th>Prix</th><th className="text-right">Montant</th><th>Station</th><th>Référence</th><th /></tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="pr-1"><Select aria-label="Rubrique" disabled={!modifiable} value={l.rubric_id} onChange={(e) => {
                  const r = rubriques.find((x) => String(x.id) === e.target.value);
                  maj(i, { rubric_id: e.target.value, kind: r?.kind ?? l.kind, unit: r?.unit ?? l.unit });
                }} options={rubriques.map((r) => ({ value: r.id!, label: r.name }))} /></td>
                <td className="pr-1"><Select aria-label="Nature" disabled={!modifiable} value={l.kind} onChange={(e) => maj(i, { kind: e.target.value })} options={NATURES} /></td>
                <td className="pr-1"><Input aria-label="Libellé" disabled={!modifiable} value={l.description} onChange={(e) => maj(i, { description: e.target.value })} /></td>
                <td className="w-20 pr-1"><Input aria-label="Quantité" inputMode="decimal" disabled={!modifiable} value={l.quantity} onChange={(e) => maj(i, { quantity: e.target.value })} /></td>
                <td className="pr-1"><Select aria-label="Unité" disabled={!modifiable} value={l.unit} onChange={(e) => maj(i, { unit: e.target.value })} options={UNITES} /></td>
                <td className="w-28 pr-1"><Input aria-label="Prix" inputMode="decimal" disabled={!modifiable} value={l.price_unit} onChange={(e) => maj(i, { price_unit: e.target.value })} /></td>
                <td className="pr-1 text-right font-mono">{fmtInt((lireNombre(l.quantity) ?? 0) * (lireNombre(l.price_unit) ?? 0))}</td>
                <td className="min-w-[180px] pr-1">{l.kind === "nature" ? (modifiable ? <PartnerPicker kind="supplier" creation={false} value={l.partner} onChange={(p) => maj(i, { partner: p })} placeholder="Station…" /> : l.partner?.name ?? "–") : <span className="text-muted">–</span>}</td>
                <td className="pr-1"><Input aria-label="Référence" disabled={!modifiable} value={l.reference} onChange={(e) => maj(i, { reference: e.target.value })} /></td>
                <td>{modifiable && <Button size="sm" variant="ghost" aria-label="Retirer la ligne" onClick={() => setLignes(lignes.filter((_x, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={6} className="pt-2 text-right font-semibold">Total</td><td className="pt-2 text-right font-mono font-semibold">{fmtInt(total)}</td><td colSpan={3} /></tr></tfoot>
        </table>
      </div>
      {b.voucher_list.length > 0 && <p className="text-[12.5px] text-muted">Bons carburant : {b.voucher_list.map((v) => `${v.name} (${v.station.name}, ${fmtGNF(v.amount)}, ${v.state === "reconciled" ? "rapproché" : v.state === "cancelled" ? "annulé" : "remis"})`).join(" ; ")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {modifiable && <Button size="sm" onClick={() => setLignes([...lignes, { rubric_id: String(rubriques[0]?.id ?? ""), kind: rubriques[0]?.kind ?? "cash", description: "", quantity: "1", unit: rubriques[0]?.unit ?? "fixed", price_unit: "", reference: "", partner: null }])}><Plus className="h-4 w-4" /> Ligne</Button>}
        {modifiable && b.kind === "initial" && <Button size="sm" loading={busy} onClick={() => void agir(() => apiSend("POST", `/transport/budgets/${id}/prefill`))}>Pré-remplir depuis la route</Button>}
        {modifiable && <Button size="sm" loading={busy} disabled={illisible} onClick={() => void agir(() => apiSend("PATCH", `/transport/budgets/${id}`, corps()))}>Enregistrer</Button>}
        {modifiable && <Button size="sm" variant="primary" loading={busy} disabled={illisible || !lignes.length} onClick={() => void agir(async () => { await apiSend("PATCH", `/transport/budgets/${id}`, corps()); await apiSend("POST", `/transport/budgets/${id}/submit`); })}>Soumettre à l'approbation</Button>}
        {b.approval?.can_decide && b.state === "submitted" && (
          <>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void trancher("approve")}>Approuver</Button>
            <Button size="sm" variant="danger" loading={busy} onClick={() => setMotifDemande("refus")}>Refuser</Button>
          </>
        )}
        {op.can.cash && b.state === "approved" && b.amount_cash > 0 && !b.disbursed && (
          <>
            <Select aria-label="Caisse" value={journal} onChange={(e) => setJournal(e.target.value)} placeholder="Caisse…" options={reglages.journals.map((j) => ({ value: j.id, label: j.name }))} />
            <Button size="sm" variant="primary" loading={busy} disabled={!journal} onClick={async () => {
              if (!(await demanderConfirmation(`Remettre ${fmtGNF(b.amount_cash)} en espèces au chauffeur, en avance de frais de route ?`, { action: "Décaisser" }))) return;
              void agir(() => apiSend("POST", `/transport/budgets/${id}/disburse`, { journal_id: Number(journal) }));
            }}>Décaisser l'avance ({fmtGNF(b.amount_cash)})</Button>
          </>
        )}
        {b.disbursement && <span className="text-[12.5px] text-muted">Avance décaissée par {b.disbursed_by?.name ?? "la finance"} le {fmtDateTime(b.disbursed_at)} ({b.disbursement.journal}).</span>}
        {op.can.ops && b.state !== "cancelled" && !b.disbursed && <Button size="sm" variant="ghost" loading={busy} onClick={() => setMotifDemande("annulation")}>Annuler le budget</Button>}
      </div>
    </div>
  );
}

/* ─── Justification au retour (finance) ───────────────────────────────── */

function Justification({ id, reglages, cash, onChanged }: { id: number; reglages: ReglagesDocuments; cash: boolean; onChanged: () => void }) {
  const { data: t, error, mutate } = useApi<Voyage>(`/transport/rotations/${id}/trip`);
  const [f, setF] = useState<Record<string, string>>({ unit: "fixed", quantity: "1" });
  const [journal, setJournal] = useState(reglages.journal ? String(reglages.journal.id) : "");
  const [message, setMessage] = useState<string | null>(null);
  const apres = () => { void mutate(); onChanged(); };
  const { busy, erreur, agir } = useAction(apres);
  if (!t) return <Card title="Justification au retour"><Etat error={error} onRetry={() => mutate()} /></Card>;
  const s = t.summary;
  const ouverte = cash && !s.closed_at;
  const rubriques = reglages.rubrics.filter((r) => r.active && r.id);
  function ajouter() {
    void agir(() => apiSend("POST", `/transport/rotations/${id}/trip/expenses`, {
      rubric_id: Number(f.rubric_id), amount: lireNombre(f.amount ?? "") ?? 0, quantity: lireNombre(f.quantity ?? "") ?? 1, unit: f.unit,
      description: f.description || null, reference: f.reference || null, date: f.date || null,
    }), () => setF({ unit: "fixed", quantity: "1" }));
  }
  async function cloturer() {
    const texte = s.balance > 0 ? `Clôturer : le chauffeur rend ${fmtGNF(s.balance)} en caisse.` : s.balance < 0 ? `Les dépenses dépassent l'avance de ${fmtGNF(-s.balance)} : la clôture exige un additif approuvé (dans la tolérance, il est créé et soumis au circuit).` : "Clôturer : l'avance est entièrement justifiée.";
    if (!(await demanderConfirmation(`${texte} Les montants réels remplacent les coûts déclarés de la rotation.`, { action: "Clôturer" }))) return;
    setMessage(null);
    void agir(async () => {
      const res = await apiSend<Voyage>("POST", `/transport/rotations/${id}/trip/close`, journal ? { journal_id: Number(journal) } : {});
      if (res.complement_budget) setMessage(`Complément de ${fmtGNF(res.complement_budget.amount_cash)} soumis à l'approbation (${res.complement_budget.name}) : la clôture se fera une fois approuvé et décaissé, par une autre personne.`);
    });
  }
  return (
    <Card title="Justification au retour" actions={<Badge tone={tonEtat(ETATS_VOYAGE[s.state])}>{ETATS_VOYAGE[s.state]}</Badge>}>
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {message && <Notice tone="accent">{message}</Notice>}
      <div className="grid grid-cols-2 gap-3 text-[13.5px] md:grid-cols-4">
        <div><div className="text-[12px] text-muted">Avance décaissée</div><div className="font-mono">{fmtGNF(s.advance)}</div></div>
        <div><div className="text-[12px] text-muted">Dépenses en espèces</div><div className="font-mono">{fmtGNF(s.cash_spent)}</div></div>
        <div><div className="text-[12px] text-muted">{s.balance >= 0 ? "Reliquat à rendre" : "Dépassement à couvrir"}</div><div className={`font-mono ${s.balance < 0 ? "text-danger" : ""}`}>{fmtGNF(Math.abs(s.balance))}</div></div>
        <div><div className="text-[12px] text-muted">Bons carburant (réel)</div><div className="font-mono">{fmtGNF(s.nature_amount)}</div></div>
      </div>
      <DataTable
        rows={t.expenses}
        rowKey={(e) => e.id}
        empty="Aucune dépense justifiée."
        columns={[
          { key: "rubric", label: "Rubrique", render: (e) => e.rubric.name },
          { key: "date", label: "Date", render: (e) => fmtDate(e.date) },
          { key: "description", label: "Libellé", render: (e) => e.description ?? "–" },
          { key: "reference", label: "Pièce", render: (e) => e.reference ?? "–" },
          { key: "amount", label: "Montant", align: "right", render: (e) => fmtInt(e.amount) },
          { key: "pj", label: "Pièces jointes", render: (e) => (
            <span className="flex flex-wrap items-center gap-2">
              {e.attachments.map((a) => <button key={a.id} type="button" className="text-accent underline" onClick={() => void apiDownload(`/transport/trip-expenses/${e.id}/attachments/${a.id}`, a.name)}>{a.name}</button>)}
              {ouverte && <FileButton small label="Joindre" onFile={(fichier) => { const form = new FormData(); form.append("file", fichier); void agir(() => apiUpload(`/transport/trip-expenses/${e.id}/attachments`, form)); }} />}
            </span>
          ) },
          { key: "x", label: "", render: (e) => (ouverte ? <Button size="sm" variant="ghost" aria-label="Retirer la dépense" onClick={() => void agir(() => apiSend("DELETE", `/transport/trip-expenses/${e.id}`))}><Trash2 className="h-4 w-4" /></Button> : null) },
        ]}
      />
      {ouverte && (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-7">
          <Field label="Rubrique"><Select value={f.rubric_id ?? ""} onChange={(e) => setF({ ...f, rubric_id: e.target.value })} placeholder="Choisir…" options={rubriques.map((r) => ({ value: r.id!, label: r.name }))} /></Field>
          <Field label="Date"><Input type="date" value={f.date ?? ""} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Libellé"><Input value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <ChampNombre label="Quantité" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          <Field label="Unité"><Select value={f.unit ?? "fixed"} onChange={(e) => setF({ ...f, unit: e.target.value })} options={UNITES} /></Field>
          <ChampNombre label="Montant (GNF)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <Field label="Pièce"><Input value={f.reference ?? ""} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <div className="md:col-span-7"><Button size="sm" loading={busy} disabled={!f.rubric_id || !f.amount || nombreIllisible(f.amount) || nombreIllisible(f.quantity)} onClick={ajouter}><Plus className="h-4 w-4" /> Ajouter la dépense</Button></div>
        </div>
      )}
      <TableauEcarts ecarts={t.variances} />
      {ouverte && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {s.blockers.length > 0 && <Notice tone="warn">Clôture impossible pour l'instant : {s.blockers.join(" ; ")}.</Notice>}
          <Select aria-label="Caisse" value={journal} onChange={(e) => setJournal(e.target.value)} placeholder="Caisse…" options={reglages.journals.map((j) => ({ value: j.id, label: j.name }))} />
          <Button variant="primary" loading={busy} disabled={s.blockers.length > 0} onClick={() => void cloturer()}>Clôturer le budget</Button>
          <span className="text-[12.5px] text-muted">La clôture revient à une autre personne que celle qui a saisi les dépenses.</span>
        </div>
      )}
      {s.closed_at && <p className="mt-3 text-[12.5px] text-muted">Clôturé le {fmtDateTime(s.closed_at)}. {s.costs_reported ? "Les montants réels sont reportés sur la rotation." : "Rotation figée (mois clôturé ou relevé préparé) : les montants réels restent au budget."}</p>}
    </Card>
  );
}

export function TableauEcarts({ ecarts }: { ecarts: Voyage["variances"] }) {
  if (!ecarts.rows.length) return null;
  return (
    <table className="mt-4 w-full text-[13px]">
      <thead><tr className="text-left text-muted"><th>Rubrique</th><th className="text-right">Budget</th><th className="text-right">Réel</th><th className="text-right">Écart</th></tr></thead>
      <tbody>
        {ecarts.rows.map((r) => (
          <tr key={r.rubric.id}><td>{r.rubric.name}</td><td className="text-right font-mono">{fmtInt(r.budget)}</td><td className="text-right font-mono">{fmtInt(r.actual)}</td><td className={`text-right font-mono ${r.gap > 0 ? "text-danger" : ""}`}>{fmtInt(r.gap)}</td></tr>
        ))}
        <tr className="font-semibold"><td>Total</td><td className="text-right font-mono">{fmtInt(ecarts.budget)}</td><td className="text-right font-mono">{fmtInt(ecarts.actual)}</td><td className={`text-right font-mono ${ecarts.gap > 0 ? "text-danger" : ""}`}>{fmtInt(ecarts.gap)}</td></tr>
      </tbody>
    </table>
  );
}

/* ─── Lettre de voiture et réception ──────────────────────────────────── */

const versHeure = (v: string | null | undefined) => (v ? v.slice(0, 16) : "");

function CarteLettreVoiture({ op, onChanged }: { op: Operation; onChanged: () => void }) {
  const w: LettreVoiture = op.waybill;
  const entete = () => ({
    bill_of_lading: w.bill_of_lading ?? "", client_ref: w.client_ref ?? "", shipper: w.shipper ?? "", loading_place: w.loading_place ?? "",
    consignee: w.consignee ?? "", destination: w.destination ?? "", forwarder: w.forwarder ?? "", delivery_agent: w.delivery_agent ?? "",
    loader_clerk: w.loader_clerk ?? "", note: w.note ?? "", loading_at: versHeure(w.loading_at), arrival_planned_at: versHeure(w.arrival_planned_at),
  });
  const recep = () => ({
    receiver_name: w.reception?.receiver_name ?? "", vehicle_arrival_at: versHeure(w.reception?.vehicle_arrival_at),
    unloading_at: versHeure(w.reception?.unloading_at), vehicle_departure_at: versHeure(w.reception?.vehicle_departure_at),
    received_qty: w.reception?.received_qty ? String(w.reception.received_qty).replace(".", ",") : "",
    damaged_qty: w.reception?.damaged_qty ? String(w.reception.damaged_qty).replace(".", ",") : "",
    damage_cause: w.reception?.damage_cause ?? "",
  });
  const [f, setF] = useState<Record<string, string>>(entete);
  const [r, setR] = useState<Record<string, string>>(recep);
  const [visa, setVisa] = useState(Boolean(w.reception?.receiver_visa));
  const [colis, setColis] = useState<Colis[]>(w.packages ?? []);
  useEffect(() => { setF(entete()); setR(recep()); setVisa(Boolean(w.reception?.receiver_visa)); setColis(w.packages ?? []); }, [w]);
  const { busy, erreur, agir } = useAction(onChanged);
  const modifiable = op.can.ops && op.rotation.state !== "cancelled";
  const reception = modifiable && op.rotation.state !== "invoiced";
  const ef = w.effective;
  const champ = (k: string, label: string, place?: string | null) => (
    <Field label={label} hint={place && !f[k] ? `Vide : ${place}` : undefined}><Input disabled={!modifiable} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  const majColis = (i: number, patch: Partial<Colis>) => setColis(colis.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  function enregistrer() {
    const corps: Record<string, unknown> = { ...f, loading_at: f.loading_at || null, arrival_planned_at: f.arrival_planned_at || null };
    corps.packages = colis.map((c) => ({ ...c, weight_gross: Number(c.weight_gross) || 0, weight_net: Number(c.weight_net) || 0, count: Number(c.count) || 0 }));
    void agir(() => apiSend("PUT", `/transport/rotations/${op.rotation.id}/waybill`, corps));
  }
  function receptionner() {
    void agir(() => apiSend("POST", `/transport/rotations/${op.rotation.id}/waybill/reception`, {
      ...r, received_qty: lireNombre(r.received_qty ?? "") ?? 0, damaged_qty: lireNombre(r.damaged_qty ?? "") ?? 0,
      vehicle_arrival_at: r.vehicle_arrival_at || null, unloading_at: r.unloading_at || null, vehicle_departure_at: r.vehicle_departure_at || null,
      receiver_visa: visa,
    }));
  }
  const rec = w.reception;
  return (
    <Card title={`Lettre de voiture ${w.name ?? "(numérotée à la première impression)"}`} actions={modifiable ? <Button size="sm" loading={busy} onClick={enregistrer}>Enregistrer la lettre</Button> : undefined}>
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {champ("shipper", "Chargeur", ef.shipper)}
        {champ("loading_place", "Lieu de chargement", ef.loading_place)}
        <Field label="Date et heure de chargement"><Input type="datetime-local" disabled={!modifiable} value={f.loading_at ?? ""} onChange={(e) => setF({ ...f, loading_at: e.target.value })} /></Field>
        {champ("bill_of_lading", "Connaissement")}
        {champ("consignee", "Destinataire", ef.consignee)}
        {champ("destination", "Destination", ef.destination)}
        <Field label="Arrivée estimée" hint="Vide : arrivée prévue de l'opération"><Input type="datetime-local" disabled={!modifiable} value={f.arrival_planned_at ?? ""} onChange={(e) => setF({ ...f, arrival_planned_at: e.target.value })} /></Field>
        {champ("client_ref", "Référence du client", ef.client_ref)}
        {champ("forwarder", "Transitaire")}
        {champ("delivery_agent", "Agent livreur")}
        {champ("loader_clerk", "Commis chargeur")}
        {champ("note", "Observations")}
      </div>
      <div className="mt-3">
        <div className="mb-1 text-[13px] font-semibold text-ink">Colis {!colis.length && ef.packages.length > 0 ? <span className="font-normal text-muted">(tirés de l'opération : {ef.packages.map((p) => `${p.nature} ${fmtInt(p.gross)} ${p.uom}`).join(", ")})</span> : null}</div>
        {colis.map((c, i) => (
          <div key={i} className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-8">
            <Input aria-label="Nature" disabled={!modifiable} placeholder="Nature" value={c.nature} onChange={(e) => majColis(i, { nature: e.target.value })} />
            <Input aria-label="Description" disabled={!modifiable} placeholder="Description" value={c.description ?? ""} onChange={(e) => majColis(i, { description: e.target.value })} />
            <PoidsColis label="Poids brut" disabled={!modifiable} value={c.weight_gross} onChange={(n) => majColis(i, { weight_gross: n })} />
            <PoidsColis label="Poids net" disabled={!modifiable} value={c.weight_net} onChange={(n) => majColis(i, { weight_net: n })} />
            <Input aria-label="Conditionnement" disabled={!modifiable} placeholder="Conditionnement" value={c.packaging ?? ""} onChange={(e) => majColis(i, { packaging: e.target.value })} />
            <Input aria-label="Emballage" disabled={!modifiable} placeholder="Emballage" value={c.wrapping ?? ""} onChange={(e) => majColis(i, { wrapping: e.target.value })} />
            <Input aria-label="Dimensions et volumes" disabled={!modifiable} placeholder="Dimensions" value={c.dimensions ?? ""} onChange={(e) => majColis(i, { dimensions: e.target.value })} />
            <div className="flex gap-1">
              <Input aria-label="Nombre" disabled={!modifiable} inputMode="numeric" placeholder="Nombre" value={String(c.count || "")} onChange={(e) => majColis(i, { count: Number(e.target.value) || 0 })} />
              {modifiable && <Button size="sm" variant="ghost" aria-label="Retirer le colis" onClick={() => setColis(colis.filter((_x, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        ))}
        {modifiable && <Button size="sm" onClick={() => setColis([...colis, { nature: ef.packages[0]?.nature ?? "", description: null, weight_gross: ef.packages[0]?.gross ?? 0, weight_net: ef.packages[0]?.net ?? 0, packaging: ef.packages[0]?.packaging ?? null, wrapping: null, dimensions: null, count: 0 }])}><Plus className="h-4 w-4" /> Colis</Button>}
      </div>
      <div className="mt-4 rounded-xl p-3 ring-1 ring-line">
        <div className="mb-2 font-semibold text-ink">Réception</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Réceptionnaire"><Input disabled={!reception} value={r.receiver_name ?? ""} onChange={(e) => setR({ ...r, receiver_name: e.target.value })} /></Field>
          <Field label="Arrivée du véhicule"><Input type="datetime-local" disabled={!reception} value={r.vehicle_arrival_at ?? ""} onChange={(e) => setR({ ...r, vehicle_arrival_at: e.target.value })} /></Field>
          <Field label="Déchargement"><Input type="datetime-local" disabled={!reception} value={r.unloading_at ?? ""} onChange={(e) => setR({ ...r, unloading_at: e.target.value })} /></Field>
          <Field label="Départ du véhicule"><Input type="datetime-local" disabled={!reception} value={r.vehicle_departure_at ?? ""} onChange={(e) => setR({ ...r, vehicle_departure_at: e.target.value })} /></Field>
          <ChampNombre label="Reçu conforme (L)" value={r.received_qty} onChange={(e) => setR({ ...r, received_qty: e.target.value })} />
          <ChampNombre label="Avarie (L)" value={r.damaged_qty} onChange={(e) => setR({ ...r, damaged_qty: e.target.value })} />
          <Field label="Causes de l'avarie" className="md:col-span-2"><Input disabled={!reception} value={r.damage_cause ?? ""} onChange={(e) => setR({ ...r, damage_cause: e.target.value })} /></Field>
        </div>
        <label className="mt-2 inline-flex items-center gap-2 text-[13.5px]"><input type="checkbox" disabled={!reception} checked={visa} onChange={(e) => setVisa(e.target.checked)} /> Visa du réceptionnaire obtenu</label>
        {rec && (
          <p className="mt-2 text-[12.5px] text-muted">
            {rec.received_at ? `Saisie par ${rec.received_by?.name ?? "?"} le ${fmtDateTime(rec.received_at)}. ` : ""}
            Manquant {fmtInt(rec.shortage_qty)} L. {rec.immobilized_days ? `Immobilisation : ${rec.immobilized_days} jour(s), dont ${rec.billable_days} au-delà de la franchise de ${rec.free_days} jour(s)${rec.demurrage_amount ? `, ${fmtGNF(rec.demurrage_amount)} à facturer` : rec.billable_days ? ", non facturée (client sans immobilisation facturée)" : ""}.` : `Franchise : ${rec.free_days} jour(s).`}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {reception && <Button size="sm" variant="primary" loading={busy} disabled={nombreIllisible(r.received_qty) || nombreIllisible(r.damaged_qty)} onClick={receptionner}>Enregistrer la réception</Button>}
          {reception && <FileButton small label={rec?.attachment ? "Remplacer la lettre visée" : "Joindre la lettre visée"} onFile={(fichier) => { const form = new FormData(); form.append("file", fichier); void agir(() => apiUpload(`/transport/rotations/${op.rotation.id}/waybill/visa`, form)); }} />}
          {rec?.attachment && <button type="button" className="text-[13px] text-accent underline" onClick={() => void apiDownload(`/transport/rotations/${op.rotation.id}/waybill/visa`, rec.attachment!.name)}>{rec.attachment.name}</button>}
          <span className="text-[12.5px] text-muted">La quantité reçue conforme devient le volume livré de la rotation (une seule saisie).</span>
        </div>
      </div>
    </Card>
  );
}

/**
 * Poids d'un colis : la saisie reste telle que tapée (« 12, » avant « 12,5 ») et se lit à la française ;
 * reconstruire le champ depuis le nombre effaçait la virgule (12,5 devenait 125).
 */
function PoidsColis({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (n: number) => void }) {
  const [texte, setTexte] = useState(value ? String(value).replace(".", ",") : "");
  useEffect(() => {
    // Colis retiré ou rechargé : le champ reprend la valeur reçue.
    if ((lireNombre(texte) ?? 0) !== value) setTexte(value ? String(value).replace(".", ",") : "");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const illisible = nombreIllisible(texte);
  return (
    <Input aria-label={label} aria-invalid={illisible || undefined} title={illisible ? "Nombre illisible" : undefined} disabled={disabled} inputMode="decimal" placeholder={label} value={texte}
      onChange={(e) => { setTexte(e.target.value); onChange(lireNombre(e.target.value) ?? 0); }} />
  );
}
