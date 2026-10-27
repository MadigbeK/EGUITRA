"use client";

/**
 * Offres commerciales et commandes des clients (Finance > Ventes) : liste, saisie, fiche avec ses actions
 * (envoi, acceptation, refus motivé, nouvelle version, impression), facturation de la commande (acompte en
 * pourcentage ou en montant, solde, quantités exécutées) et offre de travaux vers le chantier.
 */

import { useState } from "react";
import { Download, Pencil, Plus, Send } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Kpi, Modal, Notice, PageHeader, Segmented, Select, Tabs, Textarea, demanderConfirmation } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { PagesListe } from "@/components/finance/communPieces";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { TON_OFFRE, VENTES_ECRITURE, VENTES_FACTURATION, type Article, type LigneDoc, type Offre, type Page, type Referentiels } from "@/lib/commerce-types";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, fmtDate, fmtGNF, fmtInt, fmtPct, lireNombre, nombreIllisible } from "@/lib/format";
import { LignesSaisie, corpsLignes, lignesDe, nouvelleLigne, type LigneSaisie } from "./LignesSaisie";

type Vue = "open" | "orders" | "closed" | "all";
const PAGE = 100;

export function OffresPage({ commandes = false }: { commandes?: boolean }) {
  const [vue, setVue] = useState<Vue>(commandes ? "orders" : "open");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (vue !== "all") params.set("view", vue);
  if (search) params.set("search", search);
  const { data, error, mutate } = useApi<Page<Offre> & { validity_days: number }>(`/commerce/offers?${params.toString()}`);
  const ecriture = useAutorise(VENTES_ECRITURE);
  const onglets: Array<{ key: Vue; label: string }> = commandes
    ? [{ key: "orders", label: "Commandes" }]
    : [{ key: "open", label: "En cours" }, { key: "orders", label: "Acceptées" }, { key: "closed", label: "Refusées, expirées, annulées" }, { key: "all", label: "Toutes" }];
  const items = data?.items ?? [];
  return (
    <div>
      <PageHeader
        title={commandes ? "Commandes des clients" : "Offres commerciales"}
        subtitle={commandes
          ? "Offres acceptées : facturation totale, par acomptes déduits de la facture finale, ou par quantités exécutées ; les offres de travaux se facturent par les situations du chantier."
          : `Offres numérotées par société, valables ${data?.validity_days ?? 15} jours par défaut ; acceptée, une offre devient commande.`}
        actions={ecriture && !commandes ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouvelle offre</Button> : undefined}
      />
      {commandes && data && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Commandes" value={fmtInt(data.total)} />
          <Kpi label="Reste à facturer (HT)" value={fmtGNF(items.reduce((s, o) => s + (o.invoicing?.to_invoice ?? 0), 0))} />
          <Kpi label="Acomptes à déduire (HT)" value={fmtGNF(items.reduce((s, o) => s + (o.invoicing?.to_deduct ?? 0), 0))} />
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          {onglets.length > 1 ? <Tabs tabs={onglets} value={vue} onChange={(v) => { setVue(v); setOffset(0); }} /> : <span />}
          <Input aria-label="Rechercher une offre" className="max-w-xs" placeholder="Numéro, objet ou client…" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
        </div>
        <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des offres…">
          {(page) => (
            <>
              <DataTable rows={page.items} rowKey={(o) => o.id} onRowClick={(o) => setSelected(o.id)} empty={commandes ? "Aucune commande." : "Aucune offre pour ce filtre."} columns={[
                { key: "name", label: "Offre", render: (o) => <div className="min-w-[180px]"><span className="font-mono text-xs">{o.name}</span><div className="text-[12px] text-muted">{o.object ?? "Sans objet"}</div></div> },
                { key: "partner", label: "Client", render: (o) => o.partner.name },
                { key: "date", label: "Date", render: (o) => fmtDate(o.date) },
                commandes
                  ? { key: "to_invoice", label: "Reste à facturer HT", align: "right", render: (o) => fmtInt(o.invoicing?.to_invoice) }
                  : { key: "validity", label: "Validité", render: (o) => <span>{fmtDate(o.validity_date)}{o.expires_in !== null && o.expires_in <= 3 && o.expires_in >= 0 && <span className="block text-[12px] font-semibold text-warn">{o.expires_in === 0 ? "expire aujourd'hui" : `expire dans ${o.expires_in} j`}</span>}</span> },
                { key: "amount_untaxed", label: "HT (GNF)", align: "right", render: (o) => fmtInt(o.amount_untaxed) },
                { key: "status", label: "État", render: (o) => <div><Badge tone={TON_OFFRE[o.status]}>{o.status_label}</Badge>{o.chantier_mode && <div className="text-[11.5px] text-muted">Offre de travaux</div>}</div> },
              ]} />
              <PagesListe offset={offset} taille={PAGE} total={page.total} libelle="Offres" onPage={setOffset} />
            </>
          )}
        </Etat>
      </Card>
      {creating && <FormOffre onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); void mutate(); setSelected(id); }} />}
      {selected !== null && <FicheOffre key={selected} id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} onOpen={setSelected} />}
    </div>
  );
}

function FormOffre({ offre, onClose, onDone }: { offre?: Offre; onClose: () => void; onDone: (id: number) => void }) {
  const { data: refs } = useApi<Referentiels>("/commerce/referentials");
  const { data: catalogue } = useApi<Article[]>("/commerce/catalogue?usage=sale");
  const groupe = refs?.entity === "groupe";
  const { data: chantiers } = useApi<{ items: Array<{ id: number; name: string; client: { id: number; name: string } }> }>(groupe ? "/chantiers" : null);
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(offre?.partner ?? null);
  const [f, setF] = useState({
    object: offre?.object ?? "", date: offre?.date ?? "", validity_days: offre ? String(offre.validity_days || "") : "",
    conditions: offre?.conditions ?? "", discount: "", chantier_mode: offre?.chantier_mode ?? false,
    advance_rate: offre ? String(offre.advance_rate || "") : "", retention_rate: offre ? String(offre.retention_rate ?? 5) : "5",
    chantier_id: offre?.chantier ? String(offre.chantier.id) : "",
  });
  const [lignes, setLignes] = useState<LigneSaisie[]>(offre ? lignesDe(offre.lines, "sale") : [nouvelleLigne()]);
  const envoi = useEnvoi();
  const corps = corpsLignes(lignes, "sale");
  const nombres = [f.validity_days, f.discount, f.advance_rate, f.retention_rate];
  const ready = Boolean(partner && corps && corps.some((l) => !l.display_type) && !nombres.some((v) => nombreIllisible(v)));

  async function enregistrer() {
    let id = offre?.id ?? null;
    const body: Record<string, unknown> = {
      partner_id: partner?.id, object: f.object, conditions: f.conditions, lines: corps,
      chantier_mode: groupe && f.chantier_mode,
    };
    if (f.date) body.date = f.date;
    if (f.validity_days) body.validity_days = lireNombre(f.validity_days);
    if (f.discount) body.discount = lireNombre(f.discount);
    if (groupe && f.chantier_mode) {
      body.advance_rate = lireNombre(f.advance_rate) ?? 0;
      body.retention_rate = lireNombre(f.retention_rate) ?? 0;
      body.chantier_id = f.chantier_id ? Number(f.chantier_id) : null;
    }
    const ok = await envoi.run("enregistrer", async () => {
      id = offre ? (await apiSend<Offre>("PATCH", `/commerce/offers/${offre.id}`, body)).id : (await apiSend<Offre>("POST", "/commerce/offers", body)).id;
    }, undefined, "Enregistrement impossible.");
    if (ok && id !== null) onDone(id);
  }

  return (
    <Modal open wide title={offre ? `Modifier l'offre ${offre.name}` : "Nouvelle offre commerciale"} onClose={onClose} footer={
      <Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={!ready || !!envoi.busy} onClick={() => void enregistrer()}>Enregistrer l&apos;offre</Button>
    }>
      <div className="space-y-4">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Client"><PartnerPicker value={partner} onChange={setPartner} kind="customer" /></Field>
          <Field label="Commentaire ou indication (objet)" className="md:col-span-2"><Input value={f.object} onChange={(e) => setF({ ...f, object: e.target.value })} placeholder="Crépissage du bâtiment principal, assistance technique…" /></Field>
          <Field label="Date de l'offre"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Validité (jours)" hint={`Vide : ${refs?.validity_days ?? 15} jours, réglage de la société.`} error={nombreIllisible(f.validity_days) ? AIDE_NOMBRE : undefined}><Input inputMode="numeric" value={f.validity_days} onChange={(e) => setF({ ...f, validity_days: e.target.value })} /></Field>
          <Field label="Remise générale (%)" hint="Appliquée aux lignes sans remise propre." error={nombreIllisible(f.discount) ? AIDE_NOMBRE : undefined}><Input inputMode="decimal" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></Field>
        </div>
        {groupe && (
          <Card title="Offre de travaux (BTP)">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.chantier_mode} onChange={(e) => setF({ ...f, chantier_mode: e.target.checked })} /> Acceptée, l&apos;offre crée le chantier (ou s&apos;y rattache) ; elle se facture par ses situations.</label>
            {f.chantier_mode && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Avance de démarrage (%)" hint="Facturée une fois, déduite au prorata des situations." error={nombreIllisible(f.advance_rate) ? AIDE_NOMBRE : undefined}><Input inputMode="decimal" value={f.advance_rate} onChange={(e) => setF({ ...f, advance_rate: e.target.value })} /></Field>
                <Field label="Retenue de garantie (%)" error={nombreIllisible(f.retention_rate) ? AIDE_NOMBRE : undefined}><Input inputMode="decimal" value={f.retention_rate} onChange={(e) => setF({ ...f, retention_rate: e.target.value })} /></Field>
                <Field label="Chantier existant"><Select value={f.chantier_id} placeholder="Nouveau chantier" onChange={(e) => setF({ ...f, chantier_id: e.target.value })} options={(chantiers?.items ?? []).filter((c) => !partner || c.client.id === partner.id).map((c) => ({ value: c.id, label: c.name }))} /></Field>
              </div>
            )}
          </Card>
        )}
        <Card title="Lignes">
          <LignesSaisie kind="sale" lignes={lignes} onChange={setLignes} refs={refs} catalogue={catalogue} remiseGenerale={f.discount} />
        </Card>
        <Field label="Conditions de l'offre" hint="Délais, modalités d'exécution et de règlement, imprimés au bas de l'offre."><Textarea value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function FicheOffre({ id, onClose, onChanged, onOpen }: { id: number; onClose: () => void; onChanged: () => void; onOpen: (id: number) => void }) {
  const { data, error, mutate } = useApi<Offre>(`/commerce/offers/${id}`);
  const ecriture = useAutorise(VENTES_ECRITURE);
  const facturation = useAutorise(VENTES_FACTURATION);
  const envoi = useEnvoi();
  const [editing, setEditing] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [courriel, setCourriel] = useState<null | "send" | "remind">(null);
  const [adresse, setAdresse] = useState("");
  const [facture, setFacture] = useState<null | "acompte" | "executees">(null);

  function relire() {
    void mutate();
    onChanged();
  }
  async function agir(cle: string, action: string, corps: Record<string, unknown> = {}, ok?: string) {
    let nouvelle: Offre | null = null;
    const fait = await envoi.run(cle, async () => {
      nouvelle = await apiSend<Offre>("POST", `/commerce/offers/${id}/${action}`, corps);
    }, ok);
    if (fait) {
      relire();
      const n = nouvelle as Offre | null;
      if (n && n.id !== id) onOpen(n.id);
    }
    return fait;
  }

  return (
    <Modal open wide title={data ? `${data.name} · ${data.partner.name}` : "Offre"} onClose={onClose}>
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement de l'offre…">
        {(o) => (
          <div className="space-y-4 text-sm">
            {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><div className="text-xs text-muted">État</div><Badge tone={TON_OFFRE[o.status]}>{o.status_label}</Badge>{o.version > 1 && <span className="ml-1 text-[12px] text-muted">version {o.version}</span>}</div>
              <div><div className="text-xs text-muted">Date</div>{fmtDate(o.date)}</div>
              <div><div className="text-xs text-muted">Validité</div>{o.validity_date ? `${o.validity_days} jours, jusqu'au ${fmtDate(o.validity_date)}` : "–"}</div>
              <div><div className="text-xs text-muted">Montant</div>{fmtGNF(o.amount_untaxed, o.currency)} HT · {fmtGNF(o.amount_total, o.currency)} TTC</div>
              <div className="col-span-2"><div className="text-xs text-muted">Objet</div>{o.object ?? "–"}</div>
              <div><div className="text-xs text-muted">Établie par</div>{o.created_by?.name ?? "–"}</div>
              <div><div className="text-xs text-muted">Envoyée</div>{o.sent_at ? `${fmtDate(o.sent_at)}${o.emailed_to ? ` à ${o.emailed_to}` : ""}` : "–"}</div>
            </div>
            {o.status === "refused" && <Notice tone="warn">Refusée{o.closed_by ? ` (noté par ${o.closed_by.name})` : ""} : {o.refusal_reason}</Notice>}
            {o.status === "expired" && <Notice tone="warn">Expirée le {fmtDate(o.validity_date)} : créez une nouvelle version pour la proposer de nouveau.</Notice>}
            {o.chantier_mode && <Notice tone="neutral">Offre de travaux : avance de démarrage {fmtPct(o.advance_rate)}, retenue de garantie {fmtPct(o.retention_rate)}{o.chantier ? `, chantier ${o.chantier.name}` : ", chantier créé à l'acceptation"}.</Notice>}
            <DataTable dense rows={o.lines ?? []} rowKey={(l) => l.id} columns={[
              { key: "name", label: "Désignation", render: (l) => (l.display_type === "line_section" ? <b>{l.name}</b> : l.display_type === "line_note" ? <i>{l.name}</i> : l.name) },
              { key: "quantity", label: "Qté", align: "right", render: (l) => (l.display_type === "product" ? `${fmtInt(l.quantity)} ${l.uom?.name ?? ""}` : "") },
              { key: "price_unit", label: "PU HT", align: "right", render: (l) => (l.display_type === "product" ? fmtInt(l.price_unit) : "") },
              { key: "discount", label: "Remise", align: "right", render: (l) => (l.discount ? fmtPct(l.discount) : "") },
              { key: "price_subtotal", label: "HT", align: "right", render: (l) => (l.display_type === "product" ? fmtInt(l.price_subtotal) : "") },
              ...(o.status === "accepted" && !o.chantier_mode ? [
                { key: "qty_delivered", label: "Exécuté", align: "right" as const, render: (l: LigneDoc) => (l.display_type === "product" && !l.is_downpayment ? fmtInt(l.qty_delivered) : "") },
                { key: "qty_invoiced", label: "Facturé", align: "right" as const, render: (l: LigneDoc) => (l.display_type === "product" ? fmtInt(l.qty_invoiced) : "") },
              ] : []),
            ]} />
            {o.conditions && <p className="whitespace-pre-line text-ink-2"><b>Conditions : </b>{o.conditions}</p>}
            {(o.versions?.length ?? 0) > 1 && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]"><span className="text-muted">Versions :</span>{o.versions!.map((v) => (
                <button key={v.id} type="button" className={v.id === o.id ? "font-semibold" : "text-accent underline"} onClick={() => v.id !== o.id && onOpen(v.id)}>{v.name} ({v.status_label.toLowerCase()})</button>
              ))}</div>
            )}
            {o.status === "accepted" && <Facturation o={o} facturation={facturation} ecriture={ecriture} envoi={envoi} relire={relire} ouvrir={setFacture} />}
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button loading={envoi.busy === "pdf"} disabled={!!envoi.busy} onClick={() => void envoi.telecharger("pdf", `/commerce/offers/${o.id}/pdf`, `Offre ${o.name}.pdf`)}><Download className="h-4 w-4" /> Offre en PDF</Button>
              {ecriture && o.can.edit && <Button disabled={!!envoi.busy} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Modifier</Button>}
              {ecriture && o.can.send && (
                <>
                  {o.status === "draft" && <Button loading={envoi.busy === "envoyee"} disabled={!!envoi.busy} onClick={() => void agir("envoyee", "send", {}, "Offre marquée envoyée.")}>Marquer envoyée</Button>}
                  <Button disabled={!!envoi.busy} onClick={() => { setAdresse(""); setCourriel("send"); }}><Send className="h-4 w-4" /> Envoyer par courriel</Button>
                </>
              )}
              {ecriture && o.can.remind && <Button disabled={!!envoi.busy} onClick={() => { setAdresse(""); setCourriel("remind"); }}>Relancer le client</Button>}
              {ecriture && o.can.accept && <Button variant="primary" loading={envoi.busy === "accepter"} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation(o.chantier_mode ? "Le client accepte l'offre ? Elle devient commande et crée (ou complète) le chantier, au montant de l'offre." : "Le client accepte l'offre ? Elle devient commande et se facture.", { action: "Accepter" })) void agir("accepter", "accept", {}, "Offre acceptée : elle est devenue commande."); }}>Acceptée par le client</Button>}
              {ecriture && o.can.refuse && <Button disabled={!!envoi.busy} onClick={() => setRefus("")}>Refusée par le client</Button>}
              {ecriture && o.can.version && <Button loading={envoi.busy === "version"} disabled={!!envoi.busy} onClick={() => void agir("version", "version", {}, "Nouvelle version créée.")}>Nouvelle version</Button>}
              {ecriture && o.can.cancel && <Button variant="danger" loading={envoi.busy === "annuler"} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation(o.status === "accepted" ? "Annuler la commande ? Ses factures en brouillon sont annulées ; une commande déjà facturée ne s'annule pas." : "Annuler l'offre ?", { action: "Annuler", danger: true })) void agir("annuler", "cancel", {}, "Annulée."); }}>Annuler</Button>}
            </div>
            {editing && <FormOffre offre={o} onClose={() => setEditing(false)} onDone={() => { setEditing(false); relire(); }} />}
            {refus !== null && (
              <Modal open title="Refus du client" onClose={() => setRefus(null)} footer={<Button variant="primary" disabled={!refus.trim() || !!envoi.busy} loading={envoi.busy === "refuser"} onClick={async () => { if (await agir("refuser", "refuse", { reason: refus }, "Refus enregistré.")) setRefus(null); }}>Enregistrer le refus</Button>}>
                <Field label="Motif donné par le client"><Textarea value={refus} onChange={(e) => setRefus(e.target.value)} placeholder="Prix, délai, projet reporté…" /></Field>
              </Modal>
            )}
            {courriel && (
              <Modal open title={courriel === "send" ? "Envoyer l'offre par courriel" : "Relancer le client"} onClose={() => setCourriel(null)} footer={<Button variant="primary" loading={envoi.busy === "courriel"} disabled={!!envoi.busy} onClick={async () => { if (await agir("courriel", courriel, courriel === "send" ? { email: true, email_to: adresse || undefined } : { email_to: adresse || undefined }, "Courriel envoyé, l'offre en PDF jointe.")) setCourriel(null); }}>Envoyer</Button>}>
                <p className="mb-3 text-sm text-ink-2">L&apos;offre part en PDF jointe. Sans serveur de courrier, imprimez-la et remettez-la au client, puis « Marquer envoyée ».</p>
                <Field label="Adresse du client" hint="Vide : l'adresse de la fiche du client."><Input type="email" value={adresse} onChange={(e) => setAdresse(e.target.value)} /></Field>
              </Modal>
            )}
            {facture && <FormFacture o={o} mode={facture} onClose={() => setFacture(null)} onDone={() => { setFacture(null); relire(); }} />}
          </div>
        )}
      </Etat>
    </Modal>
  );
}

function Facturation({ o, facturation, ecriture, envoi, relire, ouvrir }: {
  o: Offre; facturation: boolean; ecriture: boolean; envoi: ReturnType<typeof useEnvoi>; relire: () => void; ouvrir: (m: "acompte" | "executees") => void;
}) {
  const m = o.invoicing;
  const c = o.chantier_detail;
  return (
    <Card title={c ? `Chantier ${c.name}` : "Facturation de la commande"}>
      {c ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><div className="text-xs text-muted">Marché HT</div>{fmtGNF(c.contract_amount)}</div>
            <div><div className="text-xs text-muted">Travaux facturés HT</div>{fmtGNF(c.invoiced_amount)} ({fmtPct(c.progress_pct)})</div>
            <div><div className="text-xs text-muted">Avance de démarrage</div>{c.advance_rate ? `${fmtPct(c.advance_rate)} · ${fmtGNF(c.advance_amount)} HT` : "Aucune"}</div>
            <div><div className="text-xs text-muted">Avance à déduire</div>{fmtGNF(c.advance_remaining)} <span className="text-muted">(déduit : {fmtInt(c.advance_deducted)})</span></div>
          </div>
          <p className="text-[12.5px] text-muted">Les situations d&apos;avancement se saisissent et se facturent dans Métiers &gt; BTP ; chacune déduit l&apos;avance au prorata de ses travaux, jusqu&apos;à épuisement, et retient la garantie sur ses travaux.</p>
          {facturation && o.can.advance && (
            <Button variant="primary" loading={envoi.busy === "avance"} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation(`Facturer l'avance de démarrage (${fmtPct(c.advance_rate)} du marché, ${fmtGNF(c.advance_amount)} HT) ? La facture est validée.`, { action: "Facturer l'avance" })) { if (await envoi.run("avance", () => apiSend("POST", `/commerce/orders/${o.id}/advance`, {}), "Avance de démarrage facturée.")) relire(); } }}>Facturer l&apos;avance de démarrage</Button>
          )}
        </div>
      ) : m && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div><div className="text-xs text-muted">Commandé HT</div>{fmtGNF(m.ordered)}</div>
            <div><div className="text-xs text-muted">Facturé HT</div>{fmtGNF(m.invoiced)}</div>
            <div><div className="text-xs text-muted">Acomptes facturés</div>{fmtGNF(m.advances)}</div>
            <div><div className="text-xs text-muted">Acomptes à déduire</div>{fmtGNF(m.to_deduct)}</div>
            <div><div className="text-xs text-muted">Reste à facturer HT</div><b>{fmtGNF(m.to_invoice)}</b></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {facturation && <Button onClick={() => ouvrir("acompte")} disabled={!!envoi.busy}>Facturer un acompte</Button>}
            {ecriture && <Button onClick={() => ouvrir("executees")} disabled={!!envoi.busy}>Quantités exécutées…</Button>}
            {facturation && <Button variant="primary" loading={envoi.busy === "solde"} disabled={!!envoi.busy || m.to_invoice <= 0} onClick={async () => { if (await envoi.run("solde", () => apiSend("POST", `/commerce/orders/${o.id}/invoice`, { method: "total" }), "Facture créée en brouillon, acomptes déduits : validez-la dans l'onglet Factures.")) relire(); }}>Facturer le reste (acomptes déduits)</Button>}
          </div>
        </div>
      )}
      <DataTable dense rows={o.invoices ?? []} rowKey={(p) => p.id} empty="Aucune facture." columns={[
        { key: "name", label: "Facture", render: (p) => <span className="font-mono text-xs">{p.name ?? "Brouillon"}</span> },
        { key: "kind", label: "Nature", render: (p) => (p.move_type === "out_refund" ? "Avoir" : p.kind === "advance" ? "Acompte ou avance" : "Facture") },
        { key: "date", label: "Date", render: (p) => fmtDate(p.date) },
        { key: "amount_total", label: "TTC (GNF)", align: "right", render: (p) => fmtInt(p.amount_total) },
        { key: "state", label: "État", render: (p) => <Badge tone={p.state === "posted" ? "ok" : p.state === "cancel" ? "neutral" : "warn"}>{p.state === "posted" ? "Validée" : p.state === "cancel" ? "Annulée" : "Brouillon"}</Badge> },
      ]} />
    </Card>
  );
}

function FormFacture({ o, mode, onClose, onDone }: { o: Offre; mode: "acompte" | "executees"; onClose: () => void; onDone: () => void }) {
  const envoi = useEnvoi();
  const [methode, setMethode] = useState<"percentage" | "fixed">("percentage");
  const [valeur, setValeur] = useState("");
  const [libelle, setLibelle] = useState("");
  const lignes = (o.lines ?? []).filter((l) => l.display_type === "product" && !l.is_downpayment);
  const [executees, setExecutees] = useState<Record<number, string>>(Object.fromEntries(lignes.map((l) => [l.id, String(l.qty_delivered ?? 0)])));
  const facturation = useAutorise(VENTES_FACTURATION);
  const v = lireNombre(valeur);

  if (mode === "acompte") {
    return (
      <Modal open title={`Acompte sur ${o.name}`} onClose={onClose} footer={
        <Button variant="primary" loading={!!envoi.busy} disabled={!v || v <= 0 || !!envoi.busy} onClick={async () => { if (await envoi.run("acompte", () => apiSend("POST", `/commerce/orders/${o.id}/invoice`, { method: methode, value: v, label: libelle || undefined }))) onDone(); }}>Créer la facture d&apos;acompte</Button>
      }>
        <div className="space-y-3">
          {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
          <Segmented label="Acompte" options={[{ key: "percentage", label: "Pourcentage" }, { key: "fixed", label: "Montant TTC" }]} value={methode} onChange={setMethode} />
          <Field label={methode === "percentage" ? "Pourcentage de la commande" : "Montant TVA comprise (GNF)"} error={nombreIllisible(valeur) ? AIDE_NOMBRE : undefined}><Input inputMode="decimal" value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder={methode === "percentage" ? "50" : ""} /></Field>
          <Field label="Libellé sur la facture" hint="Par exemple « Avance de démarrage 50 % » ou « Deuxième acompte 30 % »."><Input value={libelle} onChange={(e) => setLibelle(e.target.value)} /></Field>
          <p className="text-[12.5px] text-muted">La facture d&apos;acompte est créée en brouillon (compte 4191, TVA comprise), avec la référence de l&apos;offre ; validez-la dans l&apos;onglet Factures. La facture finale déduit les acomptes.</p>
        </div>
      </Modal>
    );
  }
  const corps = lignes.map((l) => ({ id: l.id, qty_delivered: lireNombre(executees[l.id]) }));
  const illisible = lignes.some((l) => nombreIllisible(executees[l.id]));
  return (
    <Modal open wide title={`Quantités exécutées de ${o.name}`} onClose={onClose} footer={
      <div className="flex gap-2">
        <Button loading={envoi.busy === "enregistrer"} disabled={illisible || !!envoi.busy} onClick={async () => { if (await envoi.run("enregistrer", () => apiSend("PATCH", `/commerce/orders/${o.id}/delivered`, { lines: corps }), "Quantités enregistrées.")) onDone(); }}>Enregistrer</Button>
        {facturation && <Button variant="primary" loading={envoi.busy === "facturer"} disabled={illisible || !!envoi.busy} onClick={async () => { if (await envoi.run("facturer", async () => { await apiSend("PATCH", `/commerce/orders/${o.id}/delivered`, { lines: corps }); await apiSend("POST", `/commerce/orders/${o.id}/invoice`, { method: "delivered" }); })) onDone(); }}>Enregistrer et facturer l&apos;exécuté</Button>}
      </div>
    }>
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      <DataTable dense rows={lignes} rowKey={(l) => l.id} columns={[
        { key: "name", label: "Ligne", render: (l) => l.name },
        { key: "quantity", label: "Commandé", align: "right", render: (l) => `${fmtInt(l.quantity)} ${l.uom?.name ?? ""}` },
        { key: "qty_invoiced", label: "Déjà facturé", align: "right", render: (l) => fmtInt(l.qty_invoiced) },
        { key: "qty_delivered", label: "Exécuté à date", align: "right", render: (l) => <Input aria-label={`Quantité exécutée : ${l.name}`} inputMode="decimal" className="ml-auto w-28 text-right font-mono" value={executees[l.id] ?? ""} onChange={(e) => setExecutees({ ...executees, [l.id]: e.target.value })} /> },
      ]} />
      <p className="mt-3 text-[12.5px] text-muted">La facture porte l&apos;exécuté non encore facturé ; les acomptes ne se déduisent qu&apos;une fois tout exécuté.</p>
    </Modal>
  );
}
