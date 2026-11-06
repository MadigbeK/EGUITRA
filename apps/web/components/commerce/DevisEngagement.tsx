"use client";

/**
 * Sur la fiche d'un engagement de dépense : la comparaison des devis fournisseurs (choix motivé, règle des
 * trois devis au-delà du seuil de la société) et les bons de commande qui en découlent.
 */

import { useState } from "react";
import { Download, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Modal, Notice, Textarea } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { ACHATS_TOUS, TON_BON, type Achats } from "@/lib/commerce-types";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, fmtDate, fmtGNF, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { FormBon } from "./BonsCommande";

const DEVIS: Profile[] = ["admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet", "achats"];

export function AchatsEngagement({ commitmentId, onChanged }: { commitmentId: number; onChanged: () => void }) {
  const { data, error, mutate } = useApi<Achats>(`/commerce/commitments/${commitmentId}/purchasing`);
  const saisie = useAutorise(DEVIS);
  const commande = useAutorise(ACHATS_TOUS);
  const envoi = useEnvoi();
  const [ajout, setAjout] = useState(false);
  const [choix, setChoix] = useState<{ id: number; nom: string; motif: string } | null>(null);
  const [bon, setBon] = useState(false);
  function relire() {
    void mutate();
    onChanged();
  }
  return (
    <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des devis…">
      {(d) => (
        <div className="space-y-4">
          {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
          <Card title="Devis fournisseurs comparés" padded={false} actions={saisie && d.editable ? <Button size="sm" onClick={() => setAjout(true)}><Plus className="h-4 w-4" /> Ajouter un devis</Button> : undefined}>
            {d.quotes_required > 0 && <div className="px-4 pt-3"><Notice tone={d.quotes.length >= d.quotes_required ? "neutral" : "warn"}>Au-delà de {fmtGNF(d.threshold)} HT : {d.quotes_required} devis de fournisseurs différents au moins, et le devis retenu motivé, avant l&apos;envoi pour approbation ({d.quotes.length} joint{d.quotes.length > 1 ? "s" : ""}).</Notice></div>}
            <DataTable dense rows={d.quotes} rowKey={(q) => q.id} empty="Aucun devis comparé : facultatif sous le seuil des trois devis." columns={[
              { key: "partner", label: "Fournisseur", render: (q) => <div>{q.partner.name}{q.reference && <div className="text-[11.5px] text-muted">{q.reference}</div>}</div> },
              { key: "amount", label: "HT (GNF)", align: "right", render: (q) => fmtInt(q.amount) },
              { key: "delay_days", label: "Délai", align: "right", render: (q) => (q.delay_days ? `${q.delay_days} j` : "–") },
              { key: "attachment", label: "Pièce", render: (q) => q.attachment ? <Button size="sm" variant="ghost" onClick={() => void envoi.telecharger(`f${q.id}`, `/commerce/supplier-quotes/${q.id}/file`, q.attachment?.name ?? "devis")}><Download className="h-4 w-4" /> {q.attachment.name}</Button>
                : saisie ? <FileButton small label="Joindre" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(file) => { const form = new FormData(); form.append("file", file); void envoi.run(`f${q.id}`, () => apiUpload(`/commerce/supplier-quotes/${q.id}/file`, form), "Devis joint.").then((ok) => ok && relire()); }} /> : "–" },
              { key: "selected", label: "Choix", render: (q) => q.selected ? <div><Badge tone="ok">Retenu</Badge><div className="text-[11.5px] text-muted" title={q.selection_reason ?? undefined}>{q.selection_reason}</div></div>
                : saisie && d.editable ? <Button size="sm" onClick={() => setChoix({ id: q.id, nom: q.partner.name, motif: "" })}>Retenir</Button> : "–" },
              { key: "actions", label: "", render: (q) => saisie && d.editable ? <Button size="sm" variant="ghost" aria-label="Retirer le devis" onClick={() => void envoi.run(`d${q.id}`, () => apiSend("DELETE", `/commerce/supplier-quotes/${q.id}`), "Devis retiré.").then((ok) => ok && relire())}><Trash2 className="h-4 w-4" /></Button> : null },
            ]} />
          </Card>
          <Card title="Bons de commande" padded={false} actions={commande && d.can_order ? <Button size="sm" variant="primary" onClick={() => setBon(true)}><Plus className="h-4 w-4" /> Bon de commande</Button> : undefined}>
            <DataTable dense rows={d.purchase_orders} rowKey={(o) => o.id} empty={d.can_order ? "Aucun bon de commande : créez-le depuis cet engagement (approuvé d'office dans sa limite)." : d.commitment.state === "approved" && d.issue_reserved ? "Aucun bon de commande : le service Achats (Responsable Achats et Contrats) l'émet depuis cet engagement." : "Le bon de commande se crée une fois l'engagement approuvé."} columns={[
              { key: "name", label: "Bon", render: (o) => <span className="font-mono text-xs">{o.name}</span> },
              { key: "date", label: "Date", render: (o) => fmtDate(o.date) },
              { key: "amount_untaxed", label: "HT (GNF)", align: "right", render: (o) => fmtInt(o.amount_untaxed) },
              { key: "status", label: "État", render: (o) => <Badge tone={TON_BON[o.status]}>{o.status_label}</Badge> },
            ]} />
          </Card>
          {ajout && <FormDevis commitmentId={commitmentId} onClose={() => setAjout(false)} onDone={() => { setAjout(false); relire(); }} />}
          {choix && (
            <Modal open title={`Retenir le devis de ${choix.nom}`} onClose={() => setChoix(null)} footer={<Button variant="primary" loading={envoi.busy === "choisir"} disabled={!choix.motif.trim() || !!envoi.busy} onClick={async () => { if (await envoi.run("choisir", () => apiSend("POST", `/commerce/supplier-quotes/${choix.id}/select`, { reason: choix.motif }), "Devis retenu : l'engagement en prend le fournisseur et le montant.")) { setChoix(null); relire(); } }}>Retenir ce devis</Button>}>
              <Field label="Motif du choix" hint="Prix, délai, qualité, références du fournisseur…"><Textarea value={choix.motif} onChange={(e) => setChoix({ ...choix, motif: e.target.value })} /></Field>
            </Modal>
          )}
          {bon && <FormBon engagement={{ id: d.commitment.id, name: d.commitment.name, object: "", partner: d.commitment.partner, amount: d.commitment.amount, remaining: d.commitment.amount - d.purchase_orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.amount_untaxed, 0) }} onClose={() => setBon(false)} onDone={() => { setBon(false); relire(); }} />}
        </div>
      )}
    </Etat>
  );
}

function FormDevis({ commitmentId, onClose, onDone }: { commitmentId: number; onClose: () => void; onDone: () => void }) {
  const envoi = useEnvoi();
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ amount: "", reference: "", delay_days: "", note: "" });
  const montant = lireNombre(f.amount);
  const ready = Boolean(partner && montant && montant > 0 && !nombreIllisible(f.delay_days));
  return (
    <Modal open title="Ajouter un devis fournisseur" onClose={onClose} footer={
      <Button variant="primary" loading={!!envoi.busy} disabled={!ready || !!envoi.busy} onClick={async () => { if (await envoi.run("ajouter", () => apiSend("POST", `/commerce/commitments/${commitmentId}/quotes`, { partner_id: partner?.id, amount: montant, reference: f.reference, delay_days: lireNombre(f.delay_days), note: f.note }))) onDone(); }}>Ajouter</Button>
    }>
      <div className="grid grid-cols-1 gap-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <Field label="Fournisseur consulté"><PartnerPicker value={partner} onChange={setPartner} kind="supplier" /></Field>
        <Field label="Montant hors taxes (GNF)" error={nombreIllisible(f.amount) ? AIDE_NOMBRE : undefined}><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Référence du devis"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Délai (jours)"><Input inputMode="numeric" value={f.delay_days} onChange={(e) => setF({ ...f, delay_days: e.target.value })} /></Field>
        <Field label="Observations"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <p className="text-[12px] text-muted">La pièce du devis se joint ensuite, sur sa ligne.</p>
      </div>
    </Modal>
  );
}
