"use client";

/**
 * Bons de commande fournisseur (Finance > Achats et dépenses) : saisie directe ou depuis un engagement
 * approuvé, soumission au circuit d'approbation (quatre yeux), envoi au fournisseur, réceptions (service
 * fait, bon de livraison joint), pièce d'achat rattachée et son rapprochement avec la commande et la réception.
 */

import { useEffect, useState } from "react";
import { Download, Paperclip, Pencil, Plus, Send, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Kpi, Modal, Notice, PageHeader, Select, Tabs, Textarea, demanderConfirmation } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { CREATION_TIERS, PagesListe, aujourdhui } from "@/components/finance/communPieces";
import { apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { ACHATS_PIECE, ACHATS_TOUS, CATEGORIES_PIECE, TON_BON, type Approbation, type Article, type BonCommande, type CircuitPrevu, type EvenementBon, type Page, type PieceAchat, type PieceJointeBon, type Referentiels } from "@/lib/commerce-types";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, fmtDate, fmtDateTime, fmtDec, fmtGNF, fmtInt, fmtPct, lireNombre, nombreIllisible } from "@/lib/format";
import { LignesSaisie, corpsLignes, lignesDe, nouvelleLigne, totalHt, type LigneSaisie } from "./LignesSaisie";
import { NouveauFournisseur } from "./NouveauFournisseur";

type Vue = "draft" | "approval" | "open" | "to_bill" | "done" | "all";
const PAGE = 100;
const VUES: Array<{ key: Vue; label: string }> = [
  { key: "open", label: "À recevoir" },
  { key: "to_bill", label: "Reçus, à facturer" },
  { key: "approval", label: "En approbation" },
  { key: "draft", label: "Brouillons et refusés" },
  { key: "done", label: "Facturés ou annulés" },
  { key: "all", label: "Tous" },
];

interface EngagementOuvert { id: number; name: string; object: string; partner: { id: number; name: string }; amount: number; remaining: number }

export function BonsCommandePage() {
  const [vue, setVue] = useState<Vue>("open");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [pieces, setPieces] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (vue !== "all") params.set("view", vue);
  if (search) params.set("search", search);
  const { data, error, mutate } = useApi<Page<BonCommande>>(`/commerce/purchase-orders?${params.toString()}`);
  const saisie = useAutorise(ACHATS_TOUS);
  const items = data?.items ?? [];
  return (
    <div>
      <PageHeader
        title="Bons de commande fournisseur"
        subtitle="Depuis un engagement approuvé (approuvé d'office dans sa limite) ou directement (contrôle par le chef comptable ou le DAF, puis approbation de la direction générale) ; la réception constate le service fait, la pièce d'achat se rapproche de la commande et de la réception."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setPieces(true)}><Paperclip className="h-4 w-4" /> Pièces des bons</Button>
            {saisie && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau bon de commande</Button>}
          </div>
        }
      />
      {data && vue === "open" && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Bons à recevoir" value={fmtInt(data.total)} />
          <Kpi label="Commandé HT" value={fmtGNF(items.reduce((s, o) => s + o.amount_untaxed, 0))} />
          <Kpi label="Reçu non facturé HT" value={fmtGNF(items.reduce((s, o) => s + o.to_bill_untaxed, 0))} />
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <Tabs tabs={VUES} value={vue} onChange={(v) => { setVue(v); setOffset(0); }} />
          <Input aria-label="Rechercher un bon de commande" className="max-w-xs" placeholder="Numéro, objet, fournisseur, réf. du devis…" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
        </div>
        <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des bons de commande…">
          {(page) => (
            <>
              <DataTable rows={page.items} rowKey={(o) => o.id} onRowClick={(o) => setSelected(o.id)} empty="Aucun bon de commande pour ce filtre." columns={[
                { key: "name", label: "Bon de commande", render: (o) => <div className="min-w-[180px]"><span className="font-mono text-xs">{o.name}</span><div className="text-[12px] text-muted">{o.object ?? "Sans objet"}{o.commitment ? ` · ${o.commitment.name}` : ""}</div></div> },
                { key: "partner", label: "Fournisseur", render: (o) => o.partner.name },
                { key: "date_planned", label: "Livraison prévue", render: (o) => fmtDate(o.date_planned) },
                { key: "amount_untaxed", label: "HT (GNF)", align: "right", render: (o) => fmtInt(o.amount_untaxed) },
                { key: "received_pct", label: "Reçu", align: "right", render: (o) => fmtPct(o.received_pct) },
                { key: "status", label: "État", render: (o) => <div><Badge tone={TON_BON[o.status]}>{o.status_label}</Badge>{o.approval?.pending_with && o.status === "to_approve" && <div className="text-[11.5px] text-muted">chez : {o.approval.pending_with}</div>}</div> },
              ]} />
              <PagesListe offset={offset} taille={PAGE} total={page.total} libelle="Bons de commande" onPage={setOffset} />
            </>
          )}
        </Etat>
      </Card>
      {pieces && <DocumentsAchats onClose={() => setPieces(false)} onOuvrir={(id) => { setPieces(false); setSelected(id); }} />}
      {creating && <FormBon onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); void mutate(); setSelected(id); }} />}
      {selected !== null && <FicheBon key={selected} id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
    </div>
  );
}

export function FormBon({ bon, engagement, onClose, onDone }: { bon?: BonCommande; engagement?: EngagementOuvert; onClose: () => void; onDone: (id: number) => void }) {
  const { data: refs } = useApi<Referentiels>("/commerce/referentials");
  const { data: catalogue } = useApi<Article[]>("/commerce/catalogue?usage=purchase");
  const { data: engagements } = useApi<EngagementOuvert[]>(bon ? null : "/finance/commitments?state=approved");
  const [commitmentId, setCommitmentId] = useState(engagement ? String(engagement.id) : "");
  const choisi = engagement ?? engagements?.find((e) => String(e.id) === commitmentId);
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(bon?.partner ?? engagement?.partner ?? null);
  const [nouveau, setNouveau] = useState<string | null>(null);
  const creationTiers = useAutorise(CREATION_TIERS);
  const [f, setF] = useState({
    object: bon?.object ?? engagement?.object ?? "", conditions: bon?.conditions ?? "", partner_ref: bon?.partner_ref ?? "",
    date_planned: bon?.date_planned ?? "", quote_kind: bon?.quote_kind ?? "quote", quote_date: bon?.quote_date ?? "",
    payment_term_id: bon?.payment_term ? String(bon.payment_term.id) : "", payment_note: bon?.payment_note ?? "",
    delivery_days: bon?.delivery_days ? String(bon.delivery_days) : "", delivery_place: bon?.delivery_place ?? "",
    tax_exemption: bon?.tax_exemption ?? "",
  });
  const [piece, setPiece] = useState<File | null>(null);
  const [lignes, setLignes] = useState<LigneSaisie[]>(bon ? lignesDe(bon.lines, "purchase") : []);
  const envoi = useEnvoi();
  const corps = corpsLignes(lignes, "purchase");
  // Depuis un engagement, sans ligne : une ligne du reste à commander, sur son compte et son analytique.
  const sansLigne = !bon && !!choisi && lignes.length === 0;
  const ht = sansLigne ? choisi?.remaining ?? 0 : totalHt(lignes);
  const sansTva = lignes.some((l) => l.display_type === "product" && l.tax === "none");
  const delaiInvalide = f.delivery_days.trim() !== "" && !/^\d{1,4}$/.test(f.delivery_days.trim());
  const ready = Boolean((partner || choisi) && corps && (sansLigne || corps.some((l) => !l.display_type)) && !delaiInvalide);
  // Circuit prévu pour ce montant, relu une fois la saisie posée (pas à chaque frappe).
  const [montant, setMontant] = useState(Math.round(ht));
  useEffect(() => {
    const t = setTimeout(() => setMontant(Math.round(ht)), 400);
    return () => clearTimeout(t);
  }, [ht]);
  const circuitParams = new URLSearchParams({ amount: String(montant) });
  if (choisi) circuitParams.set("commitment_id", String(choisi.id));
  if (partner) circuitParams.set("partner_id", String(partner.id));
  const { data: circuit } = useApi<CircuitPrevu>(`/commerce/purchase-orders/circuit?${circuitParams.toString()}`);

  async function enregistrer(soumettre: boolean) {
    let id = bon?.id ?? null;
    const body: Record<string, unknown> = {
      object: f.object, conditions: f.conditions, partner_ref: f.partner_ref, quote_kind: f.quote_kind,
      quote_date: f.quote_date || null, payment_term_id: f.payment_term_id ? Number(f.payment_term_id) : null,
      payment_note: f.payment_note, delivery_days: f.delivery_days.trim() ? Number(f.delivery_days) : null,
      delivery_place: f.delivery_place, tax_exemption: f.tax_exemption,
    };
    if (!bon && !f.payment_term_id) delete body.payment_term_id; // à la création : celles de la fiche du fournisseur
    if (!bon && !f.delivery_place.trim()) delete body.delivery_place; // à la création : l'adresse de la société
    if (partner) body.partner_id = partner.id;
    if (f.date_planned) body.date_planned = f.date_planned;
    if (!sansLigne) body.lines = corps;
    const ok = await envoi.run(soumettre ? "soumettre" : "enregistrer", async () => {
      if (bon) {
        await apiSend("PATCH", `/commerce/purchase-orders/${bon.id}`, body);
      } else {
        if (choisi) body.commitment_id = choisi.id;
        id = (await apiSend<BonCommande>("POST", "/commerce/purchase-orders", body)).id;
      }
      // La pièce du fournisseur est jointe avant la soumission : l'approbateur la voit.
      if (piece && id !== null) {
        const form = new FormData();
        form.append("file", piece);
        form.append("category", f.quote_kind === "proforma" ? "proforma" : "quote");
        await apiUpload(`/commerce/purchase-orders/${id}/documents`, form);
      }
      if (soumettre && id !== null) await apiSend("POST", `/commerce/purchase-orders/${id}/submit`, {});
    }, undefined, "Enregistrement impossible.");
    if (ok && id !== null) onDone(id);
  }

  return (
    <Modal open wide title={bon ? `Modifier ${bon.name}` : "Nouveau bon de commande"} onClose={onClose} footer={
      <div className="flex gap-2">
        <Button loading={envoi.busy === "enregistrer"} disabled={!ready || !!envoi.busy} onClick={() => void enregistrer(false)}>Enregistrer en brouillon</Button>
        <Button variant="primary" loading={envoi.busy === "soumettre"} disabled={!ready || !!envoi.busy} onClick={() => void enregistrer(true)}>Soumettre à l&apos;approbation</Button>
      </div>
    }>
      <div className="space-y-4">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {!bon && !engagement && (
            <Field label="Engagement de dépense approuvé" hint="Facultatif : dans sa limite, le bon est approuvé d'office ; le devis retenu (référence, date, pièce) est repris." className="md:col-span-3">
              <Select value={commitmentId} placeholder="Bon de commande direct (circuit d'approbation)" onChange={(e) => {
                setCommitmentId(e.target.value);
                const e2 = engagements?.find((x) => String(x.id) === e.target.value);
                if (e2) { setPartner(e2.partner); setF({ ...f, object: f.object || e2.object }); }
              }} options={(engagements ?? []).map((e) => ({ value: e.id, label: `${e.name} · ${e.object} · ${e.partner.name} · reste ${fmtInt(e.remaining)} GNF` }))} />
            </Field>
          )}
          <Field label="Fournisseur" hint="Absent de la liste : « Nouveau fournisseur », il est enregistré aussitôt.">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1"><PartnerPicker value={partner} onChange={setPartner} kind="supplier" onCreerDetaille={(nom) => setNouveau(nom)} /></div>
              {creationTiers && <Button size="sm" className="mt-0.5" onClick={() => setNouveau("")} title="Nouveau fournisseur"><Plus className="h-4 w-4" /> Nouveau</Button>}
            </div>
          </Field>
          <Field label="Objet de la commande" className="md:col-span-2"><Input value={f.object} onChange={(e) => setF({ ...f, object: e.target.value })} /></Field>
        </div>
        <Card title="Devis ou facture proforma du fournisseur">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Nature"><Select value={f.quote_kind} onChange={(e) => setF({ ...f, quote_kind: e.target.value as "quote" | "proforma" })} options={[{ value: "quote", label: "Devis" }, { value: "proforma", label: "Facture proforma" }]} /></Field>
            <Field label="Référence"><Input value={f.partner_ref} onChange={(e) => setF({ ...f, partner_ref: e.target.value })} placeholder="DEV-2026-041" /></Field>
            <Field label="Date"><Input type="date" value={f.quote_date} max={aujourdhui()} onChange={(e) => setF({ ...f, quote_date: e.target.value })} /></Field>
            <Field label="Pièce" hint="PDF, JPEG ou PNG ; d'autres pièces se joignent sur la fiche du bon.">
              <FileButton small label={piece ? piece.name : f.quote_kind === "proforma" ? "Joindre la proforma" : "Joindre le devis"} accept=".pdf,.jpg,.jpeg,.png" onFile={setPiece} />
            </Field>
          </div>
        </Card>
        <Card title="Lignes">
          {sansLigne && <Notice tone="neutral">Sans ligne saisie, le bon reprend le reste de l&apos;engagement {choisi?.name} ({fmtGNF(choisi?.remaining)} HT), sur son compte et son analytique.</Notice>}
          <LignesSaisie kind="purchase" lignes={lignes} onChange={setLignes} refs={refs} catalogue={catalogue} />
          {!lignes.length && !choisi && <div className="mt-2"><Button size="sm" onClick={() => setLignes([nouvelleLigne()])}>Ajouter une première ligne</Button></div>}
          {sansTva && (
            <Field label="Mention d'exonération de TVA" hint="Imprimée sous les totaux (par exemple l'exonération dont bénéficie l'achat)." className="mt-3">
              <Input value={f.tax_exemption} onChange={(e) => setF({ ...f, tax_exemption: e.target.value })} />
            </Field>
          )}
        </Card>
        <Card title="Conditions de la commande">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Conditions de paiement" hint="Vide : celles de la fiche du fournisseur.">
              <Select value={f.payment_term_id} placeholder="Selon la fiche du fournisseur" onChange={(e) => setF({ ...f, payment_term_id: e.target.value })} options={(refs?.payment_terms ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            </Field>
            <Field label="Précision sur le règlement" className="md:col-span-2"><Input value={f.payment_note} onChange={(e) => setF({ ...f, payment_note: e.target.value })} placeholder="30 % à la commande, solde à la livraison, par virement" /></Field>
            <Field label="Livraison prévue le"><Input type="date" value={f.date_planned} onChange={(e) => setF({ ...f, date_planned: e.target.value })} /></Field>
            <Field label="Délai de livraison (jours)" error={delaiInvalide ? "Nombre entier de jours." : undefined}><Input inputMode="numeric" value={f.delivery_days} onChange={(e) => setF({ ...f, delivery_days: e.target.value })} /></Field>
            <Field label="Lieu de livraison" hint={refs?.delivery_place ? `Vide : ${refs.delivery_place}` : undefined}><Input value={f.delivery_place} onChange={(e) => setF({ ...f, delivery_place: e.target.value })} /></Field>
          </div>
          <Field label="Autres conditions" hint="Garanties, pénalités, modalités : imprimées au bas du bon." className="mt-3"><Textarea value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
        </Card>
        {circuit && <CircuitApercu circuit={circuit} />}
      </div>
      {nouveau !== null && <NouveauFournisseur nom={nouveau} onClose={() => setNouveau(null)} onChoisi={(p) => { setPartner(p); setNouveau(null); }} />}
    </Modal>
  );
}

/** Circuit prévu pour le montant du bon : chaque niveau, le profil attendu, son seuil, s'il s'applique. */
export function CircuitApercu({ circuit }: { circuit: CircuitPrevu }) {
  if (circuit.covered) return <Notice tone="neutral">Dans la limite de son engagement approuvé : soumis, le bon sera approuvé d&apos;office, sans nouveau circuit.</Notice>;
  return (
    <Card title={`Circuit d'approbation prévu pour ${fmtGNF(circuit.amount)} HT`} padded={false}>
      <DataTable dense rows={circuit.rules} rowKey={(r) => r.id} empty="Aucune règle : le bon sera approuvé dès sa soumission." columns={[
        { key: "sequence", label: "Étape", render: (r) => `${r.sequence}. ${r.name}` },
        { key: "profile_label", label: "Tranchée par" },
        { key: "min_amount", label: "Seuil", render: (r) => seuil(r.min_amount, r.max_amount) + (r.account_prefix ? ` (comptes ${r.account_prefix}…)` : "") },
        { key: "applies", label: "Pour ce bon", render: (r) => (r.applies ? <Badge tone="warn">Requise</Badge> : <Badge>Sans objet</Badge>) },
      ]} />
      <p className="px-4 py-2 text-[12px] text-muted">Séparation des responsabilités : celui qui saisit ou soumet le bon n&apos;en tranche aucune étape, et une même personne ne tranche qu&apos;une étape.</p>
    </Card>
  );
}

/** Plage de montant d'une règle : « au-delà de » strict, « jusqu'à » inclus (comme le moteur). */
function seuil(min: number, max: number | null): string {
  if (min && max) return `Au-delà de ${fmtGNF(min)}, jusqu'à ${fmtGNF(max)} HT inclus`;
  if (max) return `Jusqu'à ${fmtGNF(max)} HT inclus`;
  if (min) return `Au-delà de ${fmtGNF(min)} HT`;
  return "Dès le premier franc";
}

/** Avancement du circuit d'un bon soumis : étapes, décisions, auteurs, dates et commentaires. */
function CircuitAvancement({ approval }: { approval: Approbation }) {
  return (
    <Card title="Circuit d'approbation" padded={false}>
      <DataTable dense rows={approval.steps} rowKey={(s) => `${s.sequence ?? s.label}`} columns={[
        { key: "label", label: "Étape" },
        { key: "profile", label: "Profil attendu" },
        { key: "state", label: "Décision", render: (s) => <Badge tone={s.state === "approved" ? "ok" : s.state === "rejected" ? "danger" : s.state === "pending" ? "warn" : "neutral"}>{DECISION[s.state] ?? s.state}</Badge> },
        { key: "decided_by", label: "Par", render: (s) => s.decided_by ?? "–" },
        { key: "decided_at", label: "Le", render: (s) => (s.decided_at ? fmtDateTime(s.decided_at) : "–") },
        { key: "comment", label: "Commentaire", render: (s) => s.comment ?? "" },
      ]} />
      <p className="px-4 py-2 text-[12px] text-muted">
        {approval.requested_by ? `Soumis par ${approval.requested_by}${approval.requested_at ? ` le ${fmtDateTime(approval.requested_at)}` : ""} · ` : ""}
        Demande n° {approval.request_id}{approval.fingerprint ? ` · empreinte du bon soumis ${approval.fingerprint}…` : ""}. Chaque décision est donnée par un compte authentifié, horodatée et liée à cette empreinte : un bon modifié doit être soumis de nouveau.
      </p>
    </Card>
  );
}

const DECISION: Record<string, string> = { approved: "Approuvé", rejected: "Refusé", pending: "En attente", skipped: "Sans objet" };

function FicheBon({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data, error, mutate } = useApi<BonCommande>(`/commerce/purchase-orders/${id}`);
  const saisie = useAutorise(ACHATS_TOUS);
  const piece = useAutorise(ACHATS_PIECE);
  const envoi = useEnvoi();
  const [editing, setEditing] = useState(false);
  const [reception, setReception] = useState(false);
  const [facture, setFacture] = useState(false);
  const [courriel, setCourriel] = useState<string | null>(null);
  const [annulation, setAnnulation] = useState<{ id: number; name: string; motif: string } | null>(null);
  function relire() {
    void mutate();
    onChanged();
  }
  async function annulerReception() {
    if (!annulation) return;
    const { id: receiptId, motif } = annulation;
    if (await envoi.run("annuler-reception", () => apiSend("POST", `/commerce/receipts/${receiptId}/cancel`, { reason: motif }), "Réception annulée.")) {
      setAnnulation(null);
      relire();
    }
  }
  async function agir(cle: string, action: string, corps: Record<string, unknown> = {}, ok?: string) {
    const fait = await envoi.run(cle, () => apiSend("POST", `/commerce/purchase-orders/${id}/${action}`, corps), ok);
    if (fait) relire();
    return fait;
  }
  return (
    <Modal open wide title={data ? `${data.name} · ${data.partner.name}` : "Bon de commande"} onClose={onClose}>
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement du bon de commande…">
        {(o) => (
          <div className="space-y-4 text-sm">
            {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><div className="text-xs text-muted">État</div><Badge tone={TON_BON[o.status]}>{o.status_label}</Badge></div>
              <div><div className="text-xs text-muted">Montant</div>{fmtGNF(o.amount_untaxed, o.currency)} HT · {fmtGNF(o.amount_total, o.currency)} TTC</div>
              <div><div className="text-xs text-muted">Livraison prévue</div>{fmtDate(o.date_planned)}</div>
              <div><div className="text-xs text-muted">Engagement</div>{o.commitment ? `${o.commitment.name} · ${o.commitment.object}` : "Bon direct"}</div>
              <div><div className="text-xs text-muted">Saisi par</div>{o.created_by?.name ?? "–"}</div>
              <div><div className="text-xs text-muted">Reçu HT</div>{fmtGNF(o.received_untaxed)}</div>
              <div><div className="text-xs text-muted">Facturé HT</div>{fmtGNF(o.billed_untaxed)}</div>
              <div><div className="text-xs text-muted">Envoyé</div>{o.sent_at ? `${fmtDate(o.sent_at)}${o.emailed_to ? ` à ${o.emailed_to}` : ""}` : "–"}</div>
              <div><div className="text-xs text-muted">{o.quote_kind_label} du fournisseur</div>{o.partner_ref ? `${o.partner_ref}${o.quote_date ? ` du ${fmtDate(o.quote_date)}` : ""}` : "–"}</div>
              <div><div className="text-xs text-muted">Conditions de paiement</div>{[o.payment_term?.name, o.payment_note].filter(Boolean).join(" – ") || "–"}</div>
              <div><div className="text-xs text-muted">Délai de livraison</div>{o.delivery_days ? `${fmtInt(o.delivery_days)} jours` : "–"}</div>
              <div><div className="text-xs text-muted">Lieu de livraison</div>{o.delivery_place ?? "–"}</div>
            </div>
            {o.conditions && <div className="text-[12.5px] text-ink-2"><span className="text-muted">Autres conditions : </span><span className="whitespace-pre-line">{o.conditions}</span></div>}
            {o.tax_exemption && <div className="text-[12.5px] text-ink-2"><span className="text-muted">Mention d&apos;exonération : </span>{o.tax_exemption}</div>}
            {o.status === "to_approve" && o.approval?.pending_with && <Notice tone="warn">En approbation, à l&apos;étape de : {o.approval.pending_with}. Celui qui l&apos;a saisi ou soumis n&apos;en tranche aucune étape.</Notice>}
            {o.status === "rejected" && <Notice tone="warn">Refusé{o.approval?.rejected_by ? ` par ${o.approval.rejected_by}` : ""}{o.approval?.rejected_reason ? ` : ${o.approval.rejected_reason}` : ""}. Modifiez-le au besoin, puis soumettez-le de nouveau.</Notice>}
            <DataTable dense rows={o.lines ?? []} rowKey={(l) => l.id} columns={[
              { key: "name", label: "Désignation", render: (l) => (l.display_type === "line_section" ? <b>{l.name}</b> : l.display_type === "line_note" ? <i>{l.name}</i> : <div>{l.name}{l.category && <div className="text-[11.5px] text-muted">{l.category.name}</div>}</div>) },
              { key: "quantity", label: "Commandé", align: "right", render: (l) => (l.display_type === "product" ? `${fmtDec(l.quantity)} ${l.uom?.name ?? ""}` : "") },
              { key: "price_unit", label: "PU HT", align: "right", render: (l) => (l.display_type === "product" ? fmtInt(l.price_unit) : "") },
              { key: "qty_received", label: "Reçu", align: "right", render: (l) => (l.display_type === "product" ? fmtDec(l.qty_received) : "") },
              { key: "qty_invoiced", label: "Facturé", align: "right", render: (l) => (l.display_type === "product" ? fmtDec(l.qty_invoiced) : "") },
              { key: "price_subtotal", label: "HT", align: "right", render: (l) => (l.display_type === "product" ? fmtInt(l.price_subtotal) : "") },
            ]} />
            {o.status === "draft" || o.status === "rejected" ? (o.circuit && <CircuitApercu circuit={o.circuit} />) : null}
            {o.approval && (o.approval.steps?.length ?? 0) > 0 && <CircuitAvancement approval={o.approval} />}
            <PiecesJointes o={o} ecriture={saisie} onChanged={relire} />
            <Historique id={o.id} />
            {(o.receipts?.length ?? 0) > 0 && (
              <Card title="Réceptions (service fait)" padded={false}>
                <DataTable dense rows={o.receipts ?? []} rowKey={(r) => r.id} columns={[
                  { key: "name", label: "Réception", render: (r) => <span className="font-mono text-xs">{r.name}</span> },
                  { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
                  { key: "received_by", label: "Constatée par", render: (r) => r.received_by?.name ?? "–" },
                  { key: "lines", label: "Quantités", render: (r) => r.lines.map((l) => `${fmtDec(l.quantity)} ${l.uom ?? ""} ${l.name}`).join(" ; ") },
                  { key: "attachment", label: "Bon de livraison", render: (r) => r.attachment ? (
                    <Button size="sm" variant="ghost" onClick={() => void envoi.telecharger(`bl${r.id}`, `/commerce/receipts/${r.id}/attachment`, r.attachment?.name ?? "bon-de-livraison")}><Download className="h-4 w-4" /> {r.attachment.name}</Button>
                  ) : saisie && r.state === "done" ? (
                    <FileButton small label="Joindre" accept=".pdf,.jpg,.jpeg,.png" onFile={(file) => { const form = new FormData(); form.append("file", file); void envoi.run(`bl${r.id}`, () => apiUpload(`/commerce/receipts/${r.id}/attachment`, form), "Bon de livraison joint.").then((ok) => ok && relire()); }} />
                  ) : "–" },
                  { key: "state", label: "État", render: (r) => (r.state === "done" ? (
                    saisie ? <Button size="sm" variant="ghost" onClick={() => setAnnulation({ id: r.id, name: r.name, motif: "" })}>Annuler</Button> : <Badge tone="ok">Enregistrée</Badge>
                  ) : <span title={r.cancel_reason ?? undefined}><Badge>Annulée</Badge></span>) },
                ]} />
              </Card>
            )}
            {(o.bills?.length ?? 0) > 0 && <PiecesRapprochees bills={o.bills ?? []} />}
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button loading={envoi.busy === "pdf"} disabled={!!envoi.busy} onClick={() => void envoi.telecharger("pdf", `/commerce/purchase-orders/${o.id}/pdf`, `Bon de commande ${o.name}.pdf`)}><Download className="h-4 w-4" /> Bon de commande en PDF</Button>
              {saisie && o.can.edit && <Button disabled={!!envoi.busy} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Modifier</Button>}
              {saisie && o.can.submit && <Button variant="primary" loading={envoi.busy === "soumettre"} disabled={!!envoi.busy} onClick={() => void agir("soumettre", "submit", {}, "Bon de commande soumis.")}>Soumettre à l&apos;approbation</Button>}
              {saisie && o.can.send && (
                <>
                  <Button loading={envoi.busy === "envoye"} disabled={!!envoi.busy} onClick={() => void agir("envoye", "send", {}, "Bon de commande marqué envoyé.")}>Marquer envoyé</Button>
                  <Button disabled={!!envoi.busy} onClick={() => setCourriel("")}><Send className="h-4 w-4" /> Envoyer au fournisseur</Button>
                </>
              )}
              {saisie && o.can.receive && <Button variant="primary" disabled={!!envoi.busy} onClick={() => setReception(true)}>Enregistrer une réception</Button>}
              {piece && o.can.bill && <Button variant="primary" disabled={!!envoi.busy} onClick={() => setFacture(true)}>Saisir la facture du fournisseur</Button>}
              {saisie && o.can.cancel && <Button variant="danger" loading={envoi.busy === "annuler"} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation("Annuler le bon de commande ? Sa demande d'approbation en cours est abandonnée.", { action: "Annuler", danger: true })) void agir("annuler", "cancel", {}, "Bon de commande annulé."); }}>Annuler</Button>}
            </div>
            {editing && <FormBon bon={o} onClose={() => setEditing(false)} onDone={() => { setEditing(false); relire(); }} />}
            {reception && <FormReception o={o} onClose={() => setReception(false)} onDone={() => { setReception(false); relire(); }} />}
            {facture && <FormPiece o={o} onClose={() => setFacture(false)} onDone={() => { setFacture(false); relire(); }} />}
            {annulation && (
              <Modal open title={`Annuler la réception ${annulation.name}`} onClose={() => setAnnulation(null)} footer={<Button variant="danger" loading={envoi.busy === "annuler-reception"} disabled={!annulation.motif.trim() || !!envoi.busy} onClick={() => void annulerReception()}>Annuler la réception</Button>}>
                <Field label="Motif" hint="Quantités mal saisies, livraison refusée… Les quantités déjà facturées ne se défont pas ainsi."><Textarea value={annulation.motif} onChange={(e) => setAnnulation({ ...annulation, motif: e.target.value })} /></Field>
              </Modal>
            )}
            {courriel !== null && (
              <Modal open title="Envoyer le bon de commande au fournisseur" onClose={() => setCourriel(null)} footer={<Button variant="primary" loading={envoi.busy === "courriel"} disabled={!!envoi.busy} onClick={async () => { if (await agir("courriel", "send", { email: true, email_to: courriel || undefined }, "Courriel envoyé, le bon de commande en PDF joint.")) setCourriel(null); }}>Envoyer</Button>}>
                <p className="mb-3 text-sm text-ink-2">Le bon part en PDF joint. Sans serveur de courrier, imprimez-le et remettez-le, puis « Marquer envoyé ».</p>
                <Field label="Adresse du fournisseur" hint="Vide : l'adresse de la fiche du fournisseur."><Input type="email" value={courriel} onChange={(e) => setCourriel(e.target.value)} /></Field>
              </Modal>
            )}
          </div>
        )}
      </Etat>
    </Modal>
  );
}

/** Pièces jointes du bon : devis, proforma, contrat, bon de livraison, autre ; archivées une fois le bon soumis. */
function PiecesJointes({ o, ecriture, onChanged }: { o: BonCommande; ecriture: boolean; onChanged: () => void }) {
  const envoi = useEnvoi();
  const [categorie, setCategorie] = useState<string>(o.partner_ref && o.quote_kind === "proforma" ? "proforma" : "quote");
  const pieces = o.documents ?? [];
  function joindre(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("category", categorie);
    void envoi.run("joindre", () => apiUpload(`/commerce/purchase-orders/${o.id}/documents`, form), "Pièce jointe au bon.").then((ok) => ok && onChanged());
  }
  async function retirer(p: PieceJointeBon) {
    if (!(await demanderConfirmation(`Retirer « ${p.name} » du bon ${o.name} ?`, { action: "Retirer", danger: true }))) return;
    if (await envoi.run(`retirer${p.id}`, () => apiSend("DELETE", `/commerce/purchase-documents/${p.id}`), "Pièce retirée.")) onChanged();
  }
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Paperclip className="h-4 w-4" /> Pièces jointes</span>} padded={false} actions={ecriture && o.status !== "cancelled" ? (
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Catégorie de la pièce" className="w-44" value={categorie} onChange={(e) => setCategorie(e.target.value)} options={CATEGORIES_PIECE} />
        <FileButton small label="Joindre une pièce" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={joindre} />
      </div>
    ) : undefined}>
      {envoi.message && <div className="px-4 pb-2"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
      <DataTable dense rows={pieces} rowKey={(p) => p.id} empty="Aucune pièce jointe : joignez le devis ou la proforma du fournisseur." columns={[
        { key: "category_label", label: "Catégorie" },
        { key: "name", label: "Pièce", render: (p) => <Button size="sm" variant="ghost" loading={envoi.busy === `pj${p.id}`} onClick={() => void envoi.telecharger(`pj${p.id}`, `/commerce/purchase-documents/${p.id}`, p.name)}><Download className="h-4 w-4" /> {p.name}</Button> },
        { key: "uploaded_by", label: "Jointe par", render: (p) => `${p.uploaded_by?.name ?? "–"}, ${fmtDateTime(p.uploaded_at)}` },
        { key: "origin", label: "Provenance", render: (p) => p.origin ?? p.note ?? "" },
        { key: "removable", label: "", render: (p) => (ecriture && p.removable ? <Button size="sm" variant="ghost" aria-label={`Retirer ${p.name}`} loading={envoi.busy === `retirer${p.id}`} onClick={() => void retirer(p)}><Trash2 className="h-4 w-4" /></Button> : <span className="text-[11.5px] text-muted">{p.removable ? "" : "Archivée"}</span>) },
      ]} />
      <p className="px-4 py-2 text-[12px] text-muted">Une pièce mal jointe se retire tant que le bon n&apos;est pas soumis ; ensuite, les pièces sont archivées avec le bon et ne se suppriment plus.</p>
    </Card>
  );
}

/** Historique du bon, chargé à la demande : chaque action, son auteur, sa date et son détail. */
function Historique({ id }: { id: number }) {
  const [ouvert, setOuvert] = useState(false);
  const { data, error, mutate } = useApi<{ items: EvenementBon[] }>(ouvert ? `/commerce/purchase-orders/${id}/history` : null);
  return (
    <Card title="Historique" padded={false} actions={<Button size="sm" variant="ghost" onClick={() => setOuvert(!ouvert)}>{ouvert ? "Masquer" : "Afficher l'historique"}</Button>}>
      {ouvert && (
        <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement de l'historique…">
          {(h) => (
            <DataTable dense rows={h.items} rowKey={(e) => `${e.date}-${e.kind}-${e.summary}`} empty="Aucune action enregistrée." columns={[
              { key: "date", label: "Date", render: (e) => fmtDateTime(e.date) },
              { key: "label", label: "Action", render: (e) => <Badge tone={e.kind === "rejected" || e.kind === "cancelled" ? "danger" : e.kind === "approved" || e.kind === "approved_auto" ? "ok" : "neutral"}>{e.label}</Badge> },
              { key: "user", label: "Par", render: (e) => e.user ?? "–" },
              { key: "summary", label: "Détail", render: (e) => <div><div>{e.summary}</div>{e.detail && <div className="whitespace-pre-line text-[11.5px] text-muted">{e.detail}</div>}</div> },
            ]} />
          )}
        </Etat>
      )}
    </Card>
  );
}

/** Pièces jointes de tous les bons de la société : retrouver un devis, une proforma, un bon de livraison. */
function DocumentsAchats({ onClose, onOuvrir }: { onClose: () => void; onOuvrir: (id: number) => void }) {
  const [search, setSearch] = useState("");
  const [categorie, setCategorie] = useState("");
  const envoi = useEnvoi();
  const params = new URLSearchParams({ limit: "100" });
  if (search) params.set("search", search);
  if (categorie) params.set("category", categorie);
  const { data, error, mutate } = useApi<Page<PieceJointeBon>>(`/commerce/purchase-documents?${params.toString()}`);
  return (
    <Modal open wide title="Pièces des bons de commande" onClose={onClose}>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Rechercher une pièce" className="max-w-sm" placeholder="Bon, fournisseur, référence du devis, nom du fichier…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select aria-label="Catégorie" className="w-52" value={categorie} placeholder="Toutes les catégories" onChange={(e) => setCategorie(e.target.value)} options={CATEGORIES_PIECE} />
        </div>
        <Etat data={data} error={error} onRetry={() => mutate()} label="Recherche des pièces…">
          {(page) => (
            <DataTable dense rows={page.items} rowKey={(p) => p.id} empty="Aucune pièce pour cette recherche." columns={[
              { key: "order", label: "Bon de commande", render: (p) => <button type="button" className="text-left text-accent underline-offset-2 hover:underline" onClick={() => onOuvrir(p.order.id)}><span className="font-mono text-xs">{p.order.name}</span><div className="text-[11.5px] text-muted">{p.order.partner}{p.order.partner_ref ? ` · ${p.order.partner_ref}` : ""}</div></button> },
              { key: "category_label", label: "Catégorie" },
              { key: "name", label: "Pièce", render: (p) => <Button size="sm" variant="ghost" loading={envoi.busy === `d${p.id}`} onClick={() => void envoi.telecharger(`d${p.id}`, `/commerce/purchase-documents/${p.id}`, p.name)}><Download className="h-4 w-4" /> {p.name}</Button> },
              { key: "uploaded_at", label: "Jointe le", render: (p) => `${fmtDate(p.uploaded_at)} · ${p.uploaded_by?.name ?? ""}` },
            ]} />
          )}
        </Etat>
      </div>
    </Modal>
  );
}

function PiecesRapprochees({ bills }: { bills: PieceAchat[] }) {
  return (
    <Card title="Pièces d'achat rattachées et rapprochement" padded={false}>
      <DataTable dense rows={bills} rowKey={(b) => b.id} columns={[
        { key: "name", label: "Pièce", render: (b) => <div><span className="font-mono text-xs">{b.name ?? "Brouillon"}</span>{b.ref && <div className="text-[11.5px] text-muted">{b.ref}</div>}</div> },
        { key: "amount_untaxed", label: "HT (GNF)", align: "right", render: (b) => fmtInt(b.amount_untaxed) },
        { key: "match", label: "Rapprochement", render: (b) => (b.match ? (b.match.ok ? <Badge tone="ok">Conforme</Badge> : <div><Badge tone="danger">Écart</Badge><div className="mt-1 text-[12px] text-ink-2">{b.match.issues.join(" ")}</div><div className="text-[11.5px] text-muted">{b.match.mode === "block" ? "Écart bloquant : corrigez la pièce ou la réception." : "Passe par le circuit des pièces d'achat."}</div></div>) : "–") },
        { key: "state", label: "État", render: (b) => <div><Badge tone={b.state === "posted" ? "ok" : b.state === "cancel" ? "neutral" : "warn"}>{b.state === "posted" ? "Comptabilisée" : b.state === "cancel" ? "Annulée" : "Brouillon"}</Badge>{b.approval?.pending_with && <div className="text-[11.5px] text-muted">chez : {b.approval.pending_with}</div>}</div> },
      ]} />
      <p className="px-4 py-2 text-[12px] text-muted">Une pièce conforme (quantités dans le reçu, prix dans la tolérance) se valide sans circuit ; elle se complète (justificatif, échéance) dans l&apos;onglet Pièces d&apos;achat.</p>
    </Card>
  );
}

function FormReception({ o, onClose, onDone }: { o: BonCommande; onClose: () => void; onDone: () => void }) {
  const envoi = useEnvoi();
  const lignes = (o.lines ?? []).filter((l) => l.display_type === "product" && (l.qty_received ?? 0) < l.quantity);
  const [qte, setQte] = useState<Record<number, string>>(Object.fromEntries(lignes.map((l) => [l.id, fmtDec(l.quantity - (l.qty_received ?? 0))])));
  const [date, setDate] = useState(aujourdhui());
  const [note, setNote] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const illisible = lignes.some((l) => nombreIllisible(qte[l.id]));
  async function enregistrer() {
    const ok = await envoi.run("recevoir", async () => {
      const res = await apiSend<BonCommande>("POST", `/commerce/purchase-orders/${o.id}/receipts`, {
        date, note, lines: lignes.map((l) => ({ id: l.id, quantity: lireNombre(qte[l.id]) ?? 0 })),
      });
      if (fichier && res.receipt) {
        const form = new FormData();
        form.append("file", fichier);
        await apiUpload(`/commerce/receipts/${res.receipt.id}/attachment`, form);
      }
    }, undefined, "Réception impossible.");
    if (ok) onDone();
  }
  return (
    <Modal open wide title={`Réception de ${o.name}`} onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "recevoir"} disabled={illisible || !!envoi.busy} onClick={() => void enregistrer()}>Enregistrer la réception</Button>}>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <DataTable dense rows={lignes} rowKey={(l) => l.id} columns={[
          { key: "name", label: "Ligne", render: (l) => l.name },
          { key: "quantity", label: "Commandé", align: "right", render: (l) => `${fmtDec(l.quantity)} ${l.uom?.name ?? ""}` },
          { key: "qty_received", label: "Déjà reçu", align: "right", render: (l) => fmtDec(l.qty_received) },
          { key: "recu", label: "Reçu ce jour", align: "right", render: (l) => <Input aria-label={`Quantité reçue : ${l.name}`} inputMode="decimal" className="ml-auto w-28 text-right font-mono" value={qte[l.id] ?? ""} aria-invalid={nombreIllisible(qte[l.id])} title={nombreIllisible(qte[l.id]) ? AIDE_NOMBRE : undefined} onChange={(e) => setQte({ ...qte, [l.id]: e.target.value })} /> },
        ]} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Date de réception"><Input type="date" value={date} max={aujourdhui()} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Observations" className="md:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Livraison conforme, réserve sur…" /></Field>
        </div>
        <div className="flex items-center gap-2">
          <FileButton small label={fichier ? `Bon de livraison : ${fichier.name}` : "Joindre le bon de livraison"} accept=".pdf,.jpg,.jpeg,.png" onFile={setFichier} />
          <span className="text-[12px] text-muted">Constatée par vous, aujourd&apos;hui : nom et date sont gardés.</span>
        </div>
      </div>
    </Modal>
  );
}

function FormPiece({ o, onClose, onDone }: { o: BonCommande; onClose: () => void; onDone: () => void }) {
  const envoi = useEnvoi();
  const lignes = (o.lines ?? []).filter((l) => l.display_type === "product" && (l.qty_to_bill ?? 0) > 0);
  const [valeurs, setValeurs] = useState<Record<number, { q: string; p: string }>>(Object.fromEntries(lignes.map((l) => [l.id, { q: fmtDec(l.qty_to_bill ?? 0), p: fmtDec(l.price_unit) }])));
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(aujourdhui());
  const [resultat, setResultat] = useState<PieceAchat | null>(null);
  const illisible = lignes.some((l) => nombreIllisible(valeurs[l.id]?.q) || nombreIllisible(valeurs[l.id]?.p));
  async function enregistrer(soumettre: boolean) {
    await envoi.run(soumettre ? "soumettre" : "enregistrer", async () => {
      const res = await apiSend<BonCommande>("POST", `/commerce/purchase-orders/${o.id}/bill`, {
        ref, invoice_date: date, submit: soumettre,
        lines: lignes.map((l) => ({ id: l.id, quantity: lireNombre(valeurs[l.id]?.q), price_unit: lireNombre(valeurs[l.id]?.p) })),
      });
      setResultat(res.bill ?? null);
    }, undefined, "Saisie impossible.");
  }
  if (resultat) {
    return (
      <Modal open title="Pièce d'achat rattachée" onClose={onDone} footer={<Button variant="primary" onClick={onDone}>Fermer</Button>}>
        <div className="space-y-3 text-sm">
          {resultat.match?.ok ? <Notice tone="ok">Conforme à la commande et à la réception{resultat.state === "posted" ? " : comptabilisée sans circuit." : "."}</Notice> : (
            <Notice tone="warn">Écart de rapprochement : {resultat.match?.issues.join(" ")} {resultat.match?.mode === "block" ? "La pièce ne se valide pas tant que l'écart dure." : "Soumise, elle passe par le circuit des pièces d'achat."}</Notice>
          )}
          <p>Pièce {resultat.name ?? "en brouillon"}{resultat.approval?.pending_with ? `, en validation chez : ${resultat.approval.pending_with}` : ""}. Joignez la facture du fournisseur dans l&apos;onglet Pièces d&apos;achat.</p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open wide title={`Facture du fournisseur sur ${o.name}`} onClose={onClose} footer={
      <div className="flex gap-2">
        <Button loading={envoi.busy === "enregistrer"} disabled={illisible || !!envoi.busy} onClick={() => void enregistrer(false)}>Enregistrer en brouillon</Button>
        <Button variant="primary" loading={envoi.busy === "soumettre"} disabled={illisible || !!envoi.busy} onClick={() => void enregistrer(true)}>Enregistrer et soumettre</Button>
      </div>
    }>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Numéro de la facture du fournisseur"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <Field label="Date de la facture"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <DataTable dense rows={lignes} rowKey={(l) => l.id} columns={[
          { key: "name", label: "Ligne", render: (l) => l.name },
          { key: "recu", label: "Reçu non facturé", align: "right", render: (l) => `${fmtDec(l.qty_to_bill)} ${l.uom?.name ?? ""}` },
          { key: "q", label: "Quantité facturée", align: "right", render: (l) => <Input aria-label={`Quantité facturée : ${l.name}`} inputMode="decimal" className="ml-auto w-28 text-right font-mono" value={valeurs[l.id]?.q ?? ""} onChange={(e) => setValeurs({ ...valeurs, [l.id]: { q: e.target.value, p: valeurs[l.id]?.p ?? "" } })} /> },
          { key: "p", label: "PU HT facturé", align: "right", render: (l) => <Input aria-label={`Prix facturé : ${l.name}`} inputMode="decimal" className="ml-auto w-32 text-right font-mono" value={valeurs[l.id]?.p ?? ""} onChange={(e) => setValeurs({ ...valeurs, [l.id]: { q: valeurs[l.id]?.q ?? "", p: e.target.value } })} /> },
          { key: "commande", label: "PU commandé", align: "right", render: (l) => fmtInt(l.price_unit) },
        ]} />
        <p className="text-[12.5px] text-muted">Saisissez ce que facture le fournisseur. La pièce se rapproche de la commande (prix) et de la réception (quantités) : conforme, elle se valide sans circuit ; en écart, elle suit la règle de la société.</p>
      </div>
    </Modal>
  );
}
