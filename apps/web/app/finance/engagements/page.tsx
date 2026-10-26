"use client";

import { useState } from "react";
import { Download, Pencil, Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Etat, Field, FileButton, Input, Kpi, Modal, Notice, PageHeader, ProgressBar, Select, Tabs, Textarea, demanderConfirmation } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { PROFILS_FINANCE, apiSend, apiUpload, useAchatsSeul, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import type { ExpenseCategory } from "@/lib/finance-types";
import { AIDE_NOMBRE, fmtDate, fmtDec, fmtGNF, fmtInt, fmtPct, fmtShort, lireNombre, nombreIllisible } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes du noyau (addons/eguitra_approval/controllers/commitments.py) : saisie, modification,
// soumission, devis et annulation (INTERNAL) ; le solde, par la finance et la direction seules (contrôle de
// l'action close).
const SAISIE: Profile[] = ["admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet", "achats"];
const SOLDE: Profile[] = ["finance", "direction"];

type State = "draft" | "submitted" | "approved" | "rejected" | "done" | "cancelled";
interface CompteRef { id: number; code: string; name: string }
interface Commitment {
  id: number;
  name: string;
  object: string;
  date: string;
  date_expected: string | null;
  partner: { id: number; name: string };
  account: CompteRef | null;
  amount: number;
  consumed: number;
  remaining: number;
  currency: string;
  state: State;
  state_label: string;
  requested_by: string;
  quote: { id: number; name: string } | null;
  approval: { request_id: number; state: string; pending_with: string | null; rejected_by: string | null; rejected_reason: string | null } | null;
  company: string;
  note?: string | null;
  moves?: Array<{ id: number; name: string | null; date: string; state: string; amount_untaxed: number; ref: string | null }>;
  tolerance_pct?: number;
}

const TON: Record<State, "neutral" | "warn" | "ok" | "danger" | "accent"> = {
  draft: "neutral", submitted: "warn", approved: "accent", rejected: "danger", done: "ok", cancelled: "neutral",
};

/**
 * Engagements de dépense : une dépense est approuvée avant d'être commandée (circuit d'approbation,
 * mêmes seuils que les pièces). Engagée, elle est consommée par les pièces d'achat du fournisseur, qui
 * ne refont pas le circuit dans la limite du reste à engager.
 */
export default function EngagementsPage() {
  const [tab, setTab] = useState<"open" | "pending" | "all">("open");
  const query = tab === "open" ? "?state=approved" : tab === "pending" ? "?state=draft,submitted,rejected" : "";
  const { data, error, mutate } = useApi<Commitment[]>(`/finance/commitments${query}`);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const saisie = useAutorise(SAISIE);
  const engaged = (data ?? []).filter((c) => c.state === "approved");
  return (
    <div>
      <PageHeader
        title="Engagements de dépense"
        subtitle="Une dépense s'approuve avant la commande ; les pièces d'achat la consomment sans repasser par le circuit, dans la limite de l'engagement."
        actions={saisie ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouvel engagement</Button> : undefined}
      />
      {tab === "open" && data && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Engagements en cours" value={fmtInt(engaged.length)} />
          <Kpi label="Montant engagé (HT)" value={fmtShort(engaged.reduce((a, c) => a + c.amount, 0))} />
          <Kpi label="Reste à engager (HT)" value={fmtShort(engaged.reduce((a, c) => a + c.remaining, 0))} hint="Engagé moins pièces d'achat comptabilisées" />
        </div>
      )}
      <Tabs tabs={[{ key: "open", label: "En cours" }, { key: "pending", label: "À soumettre ou en approbation" }, { key: "all", label: "Tous" }]} value={tab} onChange={setTab} />
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des engagements…">
        {(rows) => (
          <Card padded={false}>
            <DataTable rows={rows} rowKey={(c) => c.id} onRowClick={(c) => setSelected(c.id)} empty="Aucun engagement." columns={[
              { key: "name", label: "Engagement", render: (c) => <div className="min-w-[200px]"><b>{c.name}</b> {c.object}<div className="text-[12px] text-muted">{c.partner.name}{c.account ? ` · ${c.account.code}` : " · compte à préciser"}</div></div> },
              { key: "date", label: "Date", render: (c) => fmtDate(c.date) },
              { key: "amount", label: "Engagé HT (GNF)", align: "right", render: (c) => fmtInt(c.amount) },
              { key: "consumed", label: "Consommé (GNF)", align: "right", render: (c) => (
                <div className="ml-auto w-28">
                  <ProgressBar value={c.amount ? (c.consumed / c.amount) * 100 : 0} tone={c.consumed > c.amount ? "danger" : "accent"} epaisseur={6} />
                  <span className="text-[11.5px] text-muted">{fmtInt(c.consumed)}</span>
                </div>
              ) },
              { key: "remaining", label: "Reste (GNF)", align: "right", render: (c) => fmtInt(c.remaining) },
              { key: "state", label: "État", render: (c) => <div><Badge tone={TON[c.state]}>{c.state_label}</Badge>{c.approval?.pending_with && <div className="text-[11.5px] text-muted">chez : {c.approval.pending_with}</div>}</div> },
            ]} />
          </Card>
        )}
      </Etat>
      {creating && <CommitmentForm onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); void mutate(); setSelected(id); }} />}
      {selected !== null && <CommitmentDetail key={selected} id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
    </div>
  );
}

/**
 * Saisie d'un engagement, ou modification d'un engagement en brouillon ou refusé (PATCH du noyau), avant
 * sa soumission. Le profil Achats ne choisit pas le compte : la catégorie de dépense le fixe (le plan de
 * comptes ne lui est pas ouvert). Les profils de la finance désignent le compte, ou le laissent à préciser.
 * Les profils métier (exploitation, chantiers, immobilier, cabinet) ne lisent pas le plan de comptes
 * (GET /finance/accounts : FIN_READ) : sans champ, le compte reste à préciser par la finance ; tant qu'il
 * manque, les règles d'approbation réservées à certains comptes s'appliquent aussi (models/commitment.py).
 */
function CommitmentForm({ commitment, onClose, onDone, onChanged }: { commitment?: Commitment; onClose: () => void; onDone: (id: number) => void; onChanged?: () => void }) {
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(commitment?.partner ?? null);
  const { achats, pret } = useAchatsSeul();
  const comptes = useAutorise(PROFILS_FINANCE);
  const charges = useApi<CompteRef[]>(comptes ? "/finance/accounts?prefix=6&limit=2000" : null);
  const immobilisations = useApi<CompteRef[]>(comptes ? "/finance/accounts?prefix=2&limit=2000" : null);
  const categories = useApi<ExpenseCategory[]>(achats ? "/finance/expense-categories" : null);
  const compteInitial = commitment?.account ? String(commitment.account.id) : "";
  // Catégorie dont l'engagement a pris le compte (la première, si plusieurs partagent ce compte).
  const categorieInitiale = commitment?.account ? String(categories.data?.find((x) => x.account?.id === commitment.account?.id)?.id ?? "") : "";
  const [f, setF] = useState({
    object: commitment?.object ?? "", amount: commitment ? fmtDec(commitment.amount) : "", account_id: compteInitial,
    category_id: null as string | null, date_expected: commitment?.date_expected ?? "", note: commitment?.note ?? "",
  });
  const envoi = useEnvoi();
  const montant = lireNombre(f.amount);
  const erreurMontant = nombreIllisible(f.amount) ? AIDE_NOMBRE : montant !== null && montant <= 0 ? "Montant positif attendu." : undefined;
  const ready = Boolean(partner && f.object.trim() && montant !== null && montant > 0);
  const categorie = f.category_id ?? categorieInitiale;

  function corps(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      partner_id: partner?.id, object: f.object.trim(), amount: montant, date_expected: f.date_expected || null, note: f.note,
    };
    if (achats) {
      if (categorie && categorie !== categorieInitiale) body.category_id = Number(categorie);
    } else if (comptes && f.account_id !== compteInitial) {
      body.account_id = f.account_id ? Number(f.account_id) : null;
    }
    return body;
  }

  async function enregistrer(soumettre: boolean) {
    let id: number | null = commitment?.id ?? null;
    const ok = await envoi.run(soumettre ? "soumettre" : "enregistrer", async () => {
      if (commitment) {
        await apiSend("PATCH", `/finance/commitments/${commitment.id}`, corps());
        onChanged?.();
        // Modifications enregistrées : un refus de la soumission s'affiche ici, l'engagement reste en brouillon.
        if (soumettre) await apiSend("POST", `/finance/commitments/${commitment.id}/submit`);
      } else {
        id = (await apiSend<Commitment>("POST", "/finance/commitments", { ...corps(), submit: soumettre })).id;
      }
    }, undefined, "Enregistrement impossible.");
    if (ok && id !== null) onDone(id);
  }

  const optionsComptes = [...(charges.data ?? []), ...(immobilisations.data ?? [])];
  if (commitment?.account && !optionsComptes.some((a) => a.id === commitment.account?.id)) optionsComptes.unshift(commitment.account);
  const erreurListe = charges.error ?? immobilisations.error ?? categories.error;
  return (
    <Modal open wide title={commitment ? `Modifier ${commitment.name}` : "Nouvel engagement de dépense"} onClose={onClose} footer={
      <div className="flex gap-2">
        <Button loading={envoi.busy === "enregistrer"} disabled={!ready || !!envoi.busy} onClick={() => void enregistrer(false)}>{commitment ? "Enregistrer" : "Enregistrer en brouillon"}</Button>
        <Button variant="primary" loading={envoi.busy === "soumettre"} disabled={!ready || !!envoi.busy} onClick={() => void enregistrer(true)}>{commitment ? "Enregistrer et soumettre" : "Soumettre à l'approbation"}</Button>
      </div>
    }>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {envoi.message && <div className="md:col-span-2"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
        {erreurListe && <div className="md:col-span-2"><ErrorBox error={erreurListe} onRetry={() => { void charges.mutate(); void immobilisations.mutate(); void categories.mutate(); }} /></div>}
        <Field label="Fournisseur"><PartnerPicker value={partner} onChange={setPartner} kind="supplier" /></Field>
        <Field label="Objet de la dépense"><Input value={f.object} onChange={(e) => setF({ ...f, object: e.target.value })} placeholder="Gasoil du chantier, location d'engin…" /></Field>
        <Field label="Montant hors taxes (GNF)" error={erreurMontant}><Input inputMode="decimal" className="font-mono" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        {achats ? (
          <Field label="Catégorie de dépense" hint="Elle fixe le compte de charge ou d'immobilisation.">
            <Select value={categorie} placeholder={commitment?.account && !categorieInitiale ? `Inchangé (${commitment.account.code})` : "À préciser par la finance"} onChange={(e) => setF({ ...f, category_id: e.target.value })} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.account ? `${c.name} (${c.account.code})` : c.name }))} />
          </Field>
        ) : comptes ? (
          <Field label="Compte de charge ou d'immobilisation"><Select value={f.account_id} placeholder="À préciser par la finance" onChange={(e) => setF({ ...f, account_id: e.target.value })} options={optionsComptes.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>
        ) : commitment ? (
          <Field label="Compte de charge ou d'immobilisation"><Input disabled value={commitment.account ? `${commitment.account.code} ${commitment.account.name}` : "À préciser par la finance"} /></Field>
        ) : null}
        <Field label="Livraison ou exécution prévue"><Input type="date" value={f.date_expected} onChange={(e) => setF({ ...f, date_expected: e.target.value })} /></Field>
        <Field label="Justification" className="md:col-span-2"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <p className="text-[12px] text-muted md:col-span-2">
          {commitment ? "Le devis se remplace depuis la fiche de l'engagement." : "Le devis se joint après l'enregistrement."}
          {pret && !achats && !comptes && " La finance précise le compte de charge ou d'immobilisation ; tant qu'il manque, l'engagement suit aussi les règles d'approbation réservées à certains comptes, comme les investissements."}
          {" "}L&apos;engagement suit les seuils d&apos;approbation des engagements{comptes && " (À valider > Circuits)"}.
        </p>
      </div>
    </Modal>
  );
}

function CommitmentDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: c, error, mutate } = useApi<Commitment>(`/finance/commitments/${id}`);
  const saisie = useAutorise(SAISIE);
  const soldeur = useAutorise(SOLDE);
  const envoi = useEnvoi();
  const [editing, setEditing] = useState(false);
  function relire() {
    void mutate();
    onChanged();
  }
  async function agir(cle: string, fn: () => Promise<unknown>, ok: string) {
    if (await envoi.run(cle, fn, ok)) relire();
  }
  return (
    <Modal open wide title={c ? `${c.name} · ${c.object}` : "Engagement"} onClose={onClose}>
      <Etat data={c} error={error} onRetry={() => mutate()} label="Chargement de l'engagement…">
        {(c) => (
          <div className="space-y-4 text-sm">
            {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><div className="text-xs text-muted">Fournisseur</div>{c.partner.name}</div>
              <div><div className="text-xs text-muted">Compte</div>{c.account ? `${c.account.code} ${c.account.name}` : "À préciser par la finance"}</div>
              <div><div className="text-xs text-muted">Engagé HT</div>{fmtGNF(c.amount, c.currency)}</div>
              <div><div className="text-xs text-muted">Reste à engager</div>{fmtGNF(c.remaining, c.currency)}</div>
              <div><div className="text-xs text-muted">État</div><Badge tone={TON[c.state]}>{c.state_label}</Badge></div>
              <div><div className="text-xs text-muted">Demandé par</div>{c.requested_by} le {fmtDate(c.date)}</div>
              <div><div className="text-xs text-muted">Exécution prévue</div>{fmtDate(c.date_expected)}</div>
              <div><div className="text-xs text-muted">Tolérance</div>{fmtPct(c.tolerance_pct)}</div>
            </div>
            {c.note && <p className="text-ink-2">{c.note}</p>}
            {c.approval?.pending_with && <Notice tone="warn">En approbation, à l&apos;étape de : {c.approval.pending_with}.</Notice>}
            {c.state === "rejected" && (
              <Notice tone="warn">
                Refusé{c.approval?.rejected_by ? ` par ${c.approval.rejected_by}` : ""}{c.approval?.rejected_reason ? ` : ${c.approval.rejected_reason}` : ""}. Modifiez l&apos;engagement au besoin, puis soumettez-le de nouveau.
              </Notice>
            )}
            {!c.account && ["draft", "rejected", "submitted"].includes(c.state) && (
              <Notice tone="neutral">
                Compte de charge ou d&apos;immobilisation à préciser par la finance (« Modifier », en brouillon ou après un refus). Tant qu&apos;il manque, l&apos;engagement suit aussi les règles d&apos;approbation réservées à certains comptes, comme les investissements.
              </Notice>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {c.quote ? (
                <Button loading={envoi.busy === "telecharger"} disabled={!!envoi.busy} onClick={() => void envoi.telecharger("telecharger", `/finance/commitments/${c.id}/quote`, c.quote?.name ?? "devis")}><Download className="h-4 w-4" /> Devis : {c.quote.name}</Button>
              ) : <span className="text-muted">Aucun devis joint.</span>}
              {saisie && ["draft", "rejected", "submitted"].includes(c.state) && (envoi.busy === "devis" ? (
                <Button size="sm" loading>Envoi du devis…</Button>
              ) : (
                <FileButton small label={c.quote ? "Remplacer le devis" : "Joindre le devis"} accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(file) => { const form = new FormData(); form.append("file", file); void agir("devis", () => apiUpload(`/finance/commitments/${c.id}/quote`, form), "Devis joint."); }} />
              ))}
            </div>
            <Card title="Pièces d'achat rattachées" padded={false}>
              <DataTable dense rows={c.moves ?? []} rowKey={(m) => m.id} empty="Aucune pièce : rattachez la facture du fournisseur à cet engagement à sa saisie." columns={[
                { key: "name", label: "Pièce", render: (m) => m.name ?? "Brouillon" },
                { key: "ref", label: "Référence", render: (m) => m.ref ?? "–" },
                { key: "date", label: "Date", render: (m) => fmtDate(m.date) },
                { key: "amount", label: "HT (GNF)", align: "right", render: (m) => fmtInt(m.amount_untaxed) },
                { key: "state", label: "État", render: (m) => (m.state === "posted" ? <Badge tone="ok">Comptabilisée</Badge> : <Badge>{m.state === "draft" ? "Brouillon" : "Annulée"}</Badge>) },
              ]} />
            </Card>
            <div className="flex flex-wrap gap-2">
              {saisie && (c.state === "draft" || c.state === "rejected") && (
                <>
                  <Button disabled={!!envoi.busy} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Modifier</Button>
                  <Button variant="primary" loading={envoi.busy === "soumettre"} disabled={!!envoi.busy} onClick={() => void agir("soumettre", () => apiSend("POST", `/finance/commitments/${c.id}/submit`), "Engagement soumis à l'approbation.")}>Soumettre à l&apos;approbation</Button>
                </>
              )}
              {c.state === "approved" && soldeur && (
                <Button loading={envoi.busy === "solder"} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation("Solder l'engagement ? Plus aucune pièce d'achat ne pourra s'y rattacher.", { action: "Solder", danger: true })) void agir("solder", () => apiSend("POST", `/finance/commitments/${c.id}/close`), "Engagement soldé."); }}>Solder</Button>
              )}
              {saisie && ["draft", "submitted", "rejected", "approved"].includes(c.state) && (
                <Button variant="danger" loading={envoi.busy === "annuler"} disabled={!!envoi.busy} onClick={async () => { if (await demanderConfirmation("Annuler l'engagement ? Sa demande d'approbation en cours est abandonnée et il ne pourra plus être engagé.", { action: "Annuler l'engagement", danger: true })) void agir("annuler", () => apiSend("POST", `/finance/commitments/${c.id}/cancel`), "Engagement annulé."); }}>Annuler l&apos;engagement</Button>
              )}
            </div>
            {editing && <CommitmentForm commitment={c} onClose={() => setEditing(false)} onChanged={relire} onDone={() => { setEditing(false); relire(); }} />}
          </div>
        )}
      </Etat>
    </Modal>
  );
}
