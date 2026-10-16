"use client";

import { useState } from "react";
import { Check, X } from "@/components/icons";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDateTime, fmtGNF } from "@/lib/format";

interface Req {
  id: number;
  name: string;
  document: string;
  amount: number;
  partner: string | null;
  company: string;
  requested_by: string;
  requested_at: string;
  state: "pending" | "approved" | "rejected" | "cancelled";
  pending_with: string | null;
  can_decide: boolean;
  steps?: Array<{ sequence: number; label: string; profile: string; state: string; decided_by: string | null; decided_at: string | null; comment: string | null }>;
  document_detail?: { name: string | null; ref?: string | null; date: string; state: string; lines?: Array<{ name: string; account: string; amount: number }> };
}
interface Rule { id: number; name: string; document: string; document_label: string; sequence: number; min_amount: number; max_amount: number | null; account_prefix: string | null; approver_profile: string; approver_label: string; active: boolean }

const STATE = { pending: ["En attente", "warn"], approved: ["Approuvée", "ok"], rejected: ["Refusée", "danger"], cancelled: ["Annulée", "neutral"] } as const;

export default function ApprovalsPage() {
  const [tab, setTab] = useState<"inbox" | "mine" | "all" | "rules">("inbox");
  const { data: inbox, mutate: refreshInbox } = useApi<Req[]>("/approvals/inbox");
  const path = tab === "mine" ? "/approvals/requests?mine=1" : tab === "all" ? "/approvals/requests" : null;
  const { data: list, mutate } = useApi<Req[]>(path);
  const [selected, setSelected] = useState<number | null>(null);
  const rows = tab === "inbox" ? inbox : list;
  return (
    <div>
      <PageHeader title="À valider" subtitle="Corbeille de validation : pièces d'achat et règlements soumis au circuit d'approbation, par seuil et par niveau." />
      <Tabs
        tabs={[
          { key: "inbox", label: "Ma corbeille", count: inbox?.length },
          { key: "mine", label: "Mes demandes" },
          { key: "all", label: "Toutes" },
          { key: "rules", label: "Circuits" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "rules" ? (
        <Rules />
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <Empty title={tab === "inbox" ? "Rien à valider" : "Aucune demande"} hint={tab === "inbox" ? "Les pièces soumises à votre profil apparaîtront ici." : undefined} />
        </Card>
      ) : (
        <Card padded={false}>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r.id)}
            columns={[
              { key: "name", label: "Demande" },
              { key: "partner", label: "Tiers", render: (r) => r.partner ?? "–" },
              { key: "amount", label: "Montant", align: "right", render: (r) => fmtGNF(r.amount) },
              { key: "requested_by", label: "Demandée par" },
              { key: "requested_at", label: "Le", render: (r) => fmtDate(r.requested_at) },
              { key: "state", label: "Statut", render: (r) => <Badge tone={STATE[r.state][1]}>{r.state === "pending" && r.pending_with ? `Chez ${r.pending_with}` : STATE[r.state][0]}</Badge> },
            ]}
          />
        </Card>
      )}
      {selected !== null && <RequestModal id={selected} onClose={() => setSelected(null)} onDecided={() => { void refreshInbox(); void mutate(); }} />}
    </div>
  );
}

function RequestModal({ id, onClose, onDecided }: { id: number; onClose: () => void; onDecided: () => void }) {
  const { data: r, mutate } = useApi<Req>(`/approvals/${id}`);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    try {
      await apiSend("POST", `/approvals/${id}/${action}`, { comment });
      await mutate();
      onDecided();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Décision impossible.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal
      open
      wide
      title={r?.name ?? "Demande"}
      onClose={onClose}
      footer={
        r?.can_decide && (
          <>
            <Button variant="danger" loading={busy === "reject"} disabled={!comment.trim()} onClick={() => decide("reject")}>
              <X className="h-4 w-4" /> Refuser
            </Button>
            <Button variant="primary" loading={busy === "approve"} onClick={() => decide("approve")}>
              <Check className="h-4 w-4" /> Approuver
            </Button>
          </>
        )
      }
    >
      {!r ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <div className="text-xs text-muted">Montant</div>
              <div className="font-mono font-semibold">{fmtGNF(r.amount)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Tiers</div>
              <div>{r.partner ?? "–"}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Demandée par</div>
              <div>{r.requested_by}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Le</div>
              <div>{fmtDateTime(r.requested_at)}</div>
            </div>
          </div>
          {r.document_detail?.lines && (
            <DataTable dense rows={r.document_detail.lines} rowKey={(_l, i) => i} columns={[{ key: "name", label: "Libellé" }, { key: "account", label: "Compte" }, { key: "amount", label: "Montant", align: "right", render: (l) => fmtGNF(l.amount) }]} />
          )}
          <Card title="Circuit">
            <ol className="space-y-2">
              {r.steps?.map((s) => (
                <li key={s.sequence} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="grid h-6 w-6 place-items-center rounded-md border border-line-strong/70 font-mono text-[13px] font-semibold text-ink-2">{s.sequence}</span>
                  <span className="flex-1">{s.label}</span>
                  <Badge tone={s.state === "approved" ? "ok" : s.state === "rejected" ? "danger" : s.state === "pending" ? "warn" : "neutral"}>
                    {s.state === "approved" ? `Approuvée par ${s.decided_by}` : s.state === "rejected" ? `Refusée par ${s.decided_by}` : s.state === "pending" ? s.profile : "Sans objet"}
                  </Badge>
                  {s.comment && <span className="w-full pl-8 text-xs text-muted">« {s.comment} »</span>}
                </li>
              ))}
            </ol>
          </Card>
          {r.can_decide && (
            <Field label="Commentaire" hint="Obligatoire en cas de refus.">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

function Rules() {
  const { data: rules, mutate } = useApi<Rule[]>("/approvals/rules");
  const [form, setForm] = useState({ name: "", document: "in_invoice", sequence: "1", min_amount: "0", max_amount: "", account_prefix: "", approver_profile: "finance" });
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function add() {
    try {
      await apiSend("POST", "/approvals/rules", { ...form, min_amount: Number(form.min_amount.replace(/\s/g, "")) || 0, max_amount: Number(form.max_amount.replace(/\s/g, "")) || 0 });
      setMessage({ tone: "ok", text: "Règle ajoutée." });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Erreur (réservé à l'administration)." });
    }
  }
  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Card padded={false}>
        {!rules ? (
          <Loading />
        ) : (
          <DataTable
            rows={rules}
            rowKey={(r) => r.id}
            columns={[
              { key: "document_label", label: "Nature" },
              { key: "sequence", label: "Niveau", align: "right", render: (r) => String(r.sequence) },
              { key: "name", label: "Règle" },
              { key: "min_amount", label: "À partir de", align: "right", render: (r) => fmtGNF(r.min_amount) },
              { key: "max_amount", label: "Jusqu'à", align: "right", render: (r) => (r.max_amount ? fmtGNF(r.max_amount) : "–") },
              { key: "account_prefix", label: "Comptes", render: (r) => r.account_prefix ?? "Tous" },
              { key: "approver_label", label: "Approbateur" },
              { key: "active", label: "", render: (r) => <input type="checkbox" checked={r.active} onChange={(e) => apiSend("PATCH", `/approvals/rules/${r.id}`, { active: e.target.checked }).then(() => mutate()).catch(() => setMessage({ tone: "danger", text: "Réservé à l'administration." }))} /> },
            ]}
          />
        )}
      </Card>
      <Card title="Nouvelle règle">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Libellé" className="md:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Investissements : accord de la direction" />
          </Field>
          <Field label="Nature">
            <Select value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} options={[{ value: "in_invoice", label: "Pièces d'achat" }, { value: "payment_out", label: "Règlements fournisseurs" }, { value: "entry", label: "Opérations diverses" }]} />
          </Field>
          <Field label="Approbateur">
            <Select value={form.approver_profile} onChange={(e) => setForm({ ...form, approver_profile: e.target.value })} options={[{ value: "finance", label: "Finance" }, { value: "direction", label: "Direction générale" }, { value: "admin", label: "Administration" }]} />
          </Field>
          <Field label="Niveau">
            <Input value={form.sequence} onChange={(e) => setForm({ ...form, sequence: e.target.value })} />
          </Field>
          <Field label="À partir de (GNF)">
            <Input className="font-mono" value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: e.target.value })} />
          </Field>
          <Field label="Jusqu'à (GNF, vide = sans plafond)">
            <Input className="font-mono" value={form.max_amount} onChange={(e) => setForm({ ...form, max_amount: e.target.value })} />
          </Field>
          <Field label="Comptes commençant par">
            <Input value={form.account_prefix} onChange={(e) => setForm({ ...form, account_prefix: e.target.value })} placeholder="2 pour les investissements" />
          </Field>
        </div>
        <div className="mt-3">
          <Button variant="primary" onClick={add} disabled={!form.name}>
            Ajouter la règle
          </Button>
        </div>
      </Card>
    </div>
  );
}
