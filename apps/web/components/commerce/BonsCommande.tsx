"use client";

/**
 * Bons de commande fournisseur (Finance > Achats et dépenses) : saisie directe ou depuis un engagement
 * approuvé, soumission au circuit d'approbation (quatre yeux), envoi au fournisseur, réceptions (service
 * fait, bon de livraison joint), pièce d'achat rattachée et son rapprochement avec la commande et la réception.
 */

import { useState } from "react";
import { Download, Pencil, Plus, Send } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Kpi, Modal, Notice, PageHeader, Select, Tabs, Textarea, demanderConfirmation } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { PagesListe, aujourdhui } from "@/components/finance/communPieces";
import { apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { ACHATS_PIECE, ACHATS_TOUS, TON_BON, type Article, type BonCommande, type Page, type PieceAchat, type Referentiels } from "@/lib/commerce-types";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, fmtDate, fmtDec, fmtGNF, fmtInt, fmtPct, lireNombre, nombreIllisible } from "@/lib/format";
import { LignesSaisie, corpsLignes, lignesDe, nouvelleLigne, type LigneSaisie } from "./LignesSaisie";

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
        subtitle="Depuis un engagement approuvé (approuvé d'office dans sa limite) ou directement (circuit d'approbation des engagements) ; la réception constate le service fait, la pièce d'achat se rapproche de la commande et de la réception."
        actions={saisie ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau bon de commande</Button> : undefined}
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
          <Input aria-label="Rechercher un bon de commande" className="max-w-xs" placeholder="Numéro, objet ou fournisseur…" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
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
  const [f, setF] = useState({
    object: bon?.object ?? engagement?.object ?? "", conditions: bon?.conditions ?? "", partner_ref: bon?.partner_ref ?? "",
    date_planned: bon?.date_planned ?? "",
  });
  const [lignes, setLignes] = useState<LigneSaisie[]>(bon ? lignesDe(bon.lines, "purchase") : []);
  const envoi = useEnvoi();
  const corps = corpsLignes(lignes, "purchase");
  // Depuis un engagement, sans ligne : une ligne du reste à commander, sur son compte et son analytique.
  const sansLigne = !bon && !!choisi && lignes.length === 0;
  const ready = Boolean((partner || choisi) && corps && (sansLigne || corps.some((l) => !l.display_type)));

  async function enregistrer(soumettre: boolean) {
    let id = bon?.id ?? null;
    const body: Record<string, unknown> = { object: f.object, conditions: f.conditions, partner_ref: f.partner_ref };
    if (partner) body.partner_id = partner.id;
    if (f.date_planned) body.date_planned = f.date_planned;
    if (!sansLigne) body.lines = corps;
    const ok = await envoi.run(soumettre ? "soumettre" : "enregistrer", async () => {
      if (bon) {
        await apiSend("PATCH", `/commerce/purchase-orders/${bon.id}`, body);
        if (soumettre) await apiSend("POST", `/commerce/purchase-orders/${bon.id}/submit`, {});
      } else {
        if (choisi) body.commitment_id = choisi.id;
        id = (await apiSend<BonCommande>("POST", "/commerce/purchase-orders", { ...body, submit: soumettre })).id;
      }
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
            <Field label="Engagement de dépense approuvé" hint="Facultatif : dans sa limite, le bon est approuvé d'office." className="md:col-span-3">
              <Select value={commitmentId} placeholder="Bon de commande direct (circuit d'approbation)" onChange={(e) => {
                setCommitmentId(e.target.value);
                const e2 = engagements?.find((x) => String(x.id) === e.target.value);
                if (e2) { setPartner(e2.partner); setF({ ...f, object: f.object || e2.object }); }
              }} options={(engagements ?? []).map((e) => ({ value: e.id, label: `${e.name} · ${e.object} · ${e.partner.name} · reste ${fmtInt(e.remaining)} GNF` }))} />
            </Field>
          )}
          <Field label="Fournisseur"><PartnerPicker value={partner} onChange={setPartner} kind="supplier" /></Field>
          <Field label="Objet de la commande" className="md:col-span-2"><Input value={f.object} onChange={(e) => setF({ ...f, object: e.target.value })} /></Field>
          <Field label="Livraison prévue"><Input type="date" value={f.date_planned} onChange={(e) => setF({ ...f, date_planned: e.target.value })} /></Field>
          <Field label="Référence du devis du fournisseur"><Input value={f.partner_ref} onChange={(e) => setF({ ...f, partner_ref: e.target.value })} /></Field>
        </div>
        <Card title="Lignes">
          {sansLigne && <Notice tone="neutral">Sans ligne saisie, le bon reprend le reste de l&apos;engagement {choisi?.name} ({fmtGNF(choisi?.remaining)} HT), sur son compte et son analytique.</Notice>}
          <LignesSaisie kind="purchase" lignes={lignes} onChange={setLignes} refs={refs} catalogue={catalogue} />
          {!lignes.length && !choisi && <div className="mt-2"><Button size="sm" onClick={() => setLignes([nouvelleLigne()])}>Ajouter une première ligne</Button></div>}
        </Card>
        <Field label="Conditions" hint="Délai, lieu de livraison ou d'exécution, modalités, imprimés au bas du bon."><Textarea value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

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
            </div>
            {o.status === "draft" && o.covered_by_commitment && <Notice tone="neutral">Dans la limite de son engagement approuvé : soumis, il sera approuvé d&apos;office.</Notice>}
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
            {(o.approval?.steps?.length ?? 0) > 0 && (
              <div className="text-[12.5px] text-muted">Circuit : {o.approval!.steps.map((s) => `${s.label} (${s.state === "approved" ? `approuvé par ${s.decided_by}` : s.state === "rejected" ? `refusé par ${s.decided_by}` : s.state === "pending" ? "en attente" : "sans objet"})`).join(" ; ")}</div>
            )}
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
