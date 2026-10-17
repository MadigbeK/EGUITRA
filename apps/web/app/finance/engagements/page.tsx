"use client";

import { useState } from "react";
import { Download, Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, FileButton, Input, Kpi, Loading, Modal, Notice, PageHeader, ProgressBar, Select, Tabs, Textarea } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF, fmtShort } from "@/lib/format";

type State = "draft" | "submitted" | "approved" | "rejected" | "done" | "cancelled";
interface Commitment {
  id: number;
  name: string;
  object: string;
  date: string;
  date_expected: string | null;
  partner: { id: number; name: string };
  account: { id: number; code: string; name: string } | null;
  amount: number;
  consumed: number;
  remaining: number;
  currency: string;
  state: State;
  state_label: string;
  requested_by: string;
  quote: { id: number; name: string } | null;
  approval: { request_id: number; state: string; pending_with: string | null } | null;
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
  const rows = data ?? [];
  const engaged = rows.filter((c) => c.state === "approved");
  return (
    <div>
      <PageHeader
        title="Engagements de dépense"
        subtitle="Une dépense s'approuve avant la commande ; les pièces d'achat la consomment sans repasser par le circuit, dans la limite de l'engagement."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouvel engagement</Button>}
      />
      {tab === "open" && data && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Engagements en cours" value={String(engaged.length)} teinte="azur" />
          <Kpi label="Montant engagé (HT)" value={fmtShort(engaged.reduce((a, c) => a + c.amount, 0))} teinte="lagon" />
          <Kpi label="Reste à engager (HT)" value={fmtShort(engaged.reduce((a, c) => a + c.remaining, 0))} teinte="ambre" hint="Engagé moins pièces d'achat comptabilisées" />
        </div>
      )}
      <Tabs tabs={[{ key: "open", label: "En cours" }, { key: "pending", label: "À soumettre ou en approbation" }, { key: "all", label: "Tous" }]} value={tab} onChange={setTab} />
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : (
        <Card padded={false}>
          <DataTable rows={rows} rowKey={(c) => c.id} onRowClick={(c) => setSelected(c.id)} empty="Aucun engagement." columns={[
            { key: "name", label: "Engagement", render: (c) => <div className="min-w-[200px]"><b>{c.name}</b> {c.object}<div className="text-[12px] text-muted">{c.partner.name}{c.account ? ` · ${c.account.code}` : ""}</div></div> },
            { key: "date", label: "Date", render: (c) => fmtDate(c.date) },
            { key: "amount", label: "Engagé HT", align: "right", render: (c) => fmtShort(c.amount) },
            { key: "consumed", label: "Consommé", align: "right", render: (c) => (
              <div className="w-28">
                <ProgressBar value={c.amount ? (c.consumed / c.amount) * 100 : 0} tone={c.consumed > c.amount ? "danger" : "accent"} epaisseur={6} />
                <span className="text-[11.5px] text-muted">{fmtShort(c.consumed)}</span>
              </div>
            ) },
            { key: "remaining", label: "Reste", align: "right", render: (c) => fmtShort(c.remaining) },
            { key: "state", label: "État", render: (c) => <div><Badge tone={TON[c.state]}>{c.state_label}</Badge>{c.approval?.pending_with && <div className="text-[11.5px] text-muted">chez : {c.approval.pending_with}</div>}</div> },
          ]} />
        </Card>
      )}
      {creating && <CommitmentForm onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); void mutate(); setSelected(id); }} />}
      {selected !== null && <CommitmentDetail id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
    </div>
  );
}

function CommitmentForm({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const { data: accounts } = useApi<Array<{ id: number; code: string; name: string }>>("/finance/accounts?prefix=6&limit=2000");
  const { data: assets } = useApi<Array<{ id: number; code: string; name: string }>>("/finance/accounts?prefix=2&limit=2000");
  const [f, setF] = useState({ object: "", amount: "", account_id: "", date_expected: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit(send: boolean) {
    setError(null);
    try {
      const c = await apiSend<Commitment>("POST", "/finance/commitments", {
        ...f, partner_id: partner?.id, amount: Number(f.amount.replace(/\s/g, "").replace(",", ".")) || 0,
        account_id: f.account_id ? Number(f.account_id) : null, date_expected: f.date_expected || null, submit: send,
      });
      onDone(c.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  const ready = Boolean(partner && f.object && f.amount);
  return (
    <Modal open wide title="Nouvel engagement de dépense" onClose={onClose} footer={
      <div className="flex gap-2">
        <Button disabled={!ready} onClick={() => submit(false)}>Enregistrer en brouillon</Button>
        <Button variant="primary" disabled={!ready} onClick={() => submit(true)}>Soumettre à l&apos;approbation</Button>
      </div>
    }>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {error && <div className="md:col-span-2"><Notice tone="danger">{error}</Notice></div>}
        <Field label="Fournisseur"><PartnerPicker value={partner} onChange={setPartner} kind="supplier" /></Field>
        <Field label="Objet de la dépense"><Input value={f.object} onChange={(e) => setF({ ...f, object: e.target.value })} placeholder="Gasoil du chantier, location d'engin…" /></Field>
        <Field label="Montant hors taxes"><Input inputMode="numeric" className="font-mono" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Compte de charge ou d'immobilisation"><Select value={f.account_id} placeholder="À préciser par la finance" onChange={(e) => setF({ ...f, account_id: e.target.value })} options={[...(accounts ?? []), ...(assets ?? [])].map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>
        <Field label="Livraison ou exécution prévue"><Input type="date" value={f.date_expected} onChange={(e) => setF({ ...f, date_expected: e.target.value })} /></Field>
        <Field label="Justification" className="md:col-span-2"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <p className="text-[12px] text-muted md:col-span-2">Le devis se joint après l&apos;enregistrement. L&apos;engagement suit les seuils d&apos;approbation des engagements (À valider &gt; Circuits).</p>
      </div>
    </Modal>
  );
}

function CommitmentDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: c, mutate } = useApi<Commitment>(`/finance/commitments/${id}`);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "ok", text: ok });
      void mutate();
      onChanged();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
    }
  }
  return (
    <Modal open wide title={c ? `${c.name} · ${c.object}` : "Engagement"} onClose={onClose}>
      {!c ? <Loading /> : (
        <div className="space-y-4 text-sm">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><div className="text-xs text-muted">Fournisseur</div>{c.partner.name}</div>
            <div><div className="text-xs text-muted">Compte</div>{c.account ? `${c.account.code} ${c.account.name}` : "–"}</div>
            <div><div className="text-xs text-muted">Engagé HT</div>{fmtGNF(c.amount, c.currency)}</div>
            <div><div className="text-xs text-muted">Reste à engager</div>{fmtGNF(c.remaining, c.currency)}</div>
            <div><div className="text-xs text-muted">État</div><Badge tone={TON[c.state]}>{c.state_label}</Badge></div>
            <div><div className="text-xs text-muted">Demandé par</div>{c.requested_by} le {fmtDate(c.date)}</div>
            <div><div className="text-xs text-muted">Exécution prévue</div>{fmtDate(c.date_expected)}</div>
            <div><div className="text-xs text-muted">Tolérance</div>{c.tolerance_pct} %</div>
          </div>
          {c.note && <p className="text-ink-2">{c.note}</p>}
          {c.approval?.pending_with && <Notice tone="warn">En approbation, à l&apos;étape de : {c.approval.pending_with}.</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            {c.quote ? (
              <Button onClick={() => apiDownload(`/finance/commitments/${c.id}/quote`, c.quote!.name)}><Download className="h-4 w-4" /> Devis : {c.quote.name}</Button>
            ) : <span className="text-muted">Aucun devis joint.</span>}
            {["draft", "rejected", "submitted"].includes(c.state) && (
              <FileButton small label={c.quote ? "Remplacer le devis" : "Joindre le devis"} accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(file) => { const form = new FormData(); form.append("file", file); void run(() => apiUpload(`/finance/commitments/${c.id}/quote`, form), "Devis joint."); }} />
            )}
          </div>
          <Card title="Pièces d'achat rattachées" padded={false}>
            <DataTable dense rows={c.moves ?? []} rowKey={(m) => m.id} empty="Aucune pièce : rattachez la facture du fournisseur à cet engagement à sa saisie." columns={[
              { key: "name", label: "Pièce", render: (m) => m.name ?? "Brouillon" },
              { key: "ref", label: "Référence", render: (m) => m.ref ?? "–" },
              { key: "date", label: "Date", render: (m) => fmtDate(m.date) },
              { key: "amount", label: "HT", align: "right", render: (m) => fmtShort(m.amount_untaxed) },
              { key: "state", label: "État", render: (m) => (m.state === "posted" ? <Badge tone="ok">Comptabilisée</Badge> : <Badge>{m.state === "draft" ? "Brouillon" : "Annulée"}</Badge>) },
            ]} />
          </Card>
          <div className="flex flex-wrap gap-2">
            {(c.state === "draft" || c.state === "rejected") && <Button variant="primary" onClick={() => run(() => apiSend("POST", `/finance/commitments/${c.id}/submit`), "Engagement soumis à l'approbation.")}>Soumettre à l&apos;approbation</Button>}
            {c.state === "approved" && <Button onClick={() => window.confirm("Solder l'engagement ? Plus aucune pièce ne pourra s'y rattacher.") && run(() => apiSend("POST", `/finance/commitments/${c.id}/close`), "Engagement soldé.")}>Solder</Button>}
            {["draft", "submitted", "rejected", "approved"].includes(c.state) && <Button variant="danger" onClick={() => window.confirm("Annuler l'engagement ?") && run(() => apiSend("POST", `/finance/commitments/${c.id}/cancel`), "Engagement annulé.")}>Annuler</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
