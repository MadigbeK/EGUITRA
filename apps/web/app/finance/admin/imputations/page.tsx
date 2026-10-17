"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tabs } from "@/components/ui";
import { AnalyticFields, AnalyticTags, fromDistribution, toDistribution, useAxes, type AxisChoice } from "@/components/finance/AnalyticFields";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Account, AnalyticShare, Ref } from "@/lib/finance-types";

type Tab = "regles" | "obligatoire";

interface Rule {
  id: number;
  sequence: number;
  account_prefix: string | null;
  partner: Ref | null;
  company: Ref | null;
  distribution: AnalyticShare[];
  analytic_distribution: Record<string, number>;
  axes: string[];
}
interface Requirement { id: number; plan: string; axis: string | null; prefix: string; company: Ref | null; domains: string[] }

/**
 * Imputations automatiques de la société de travail : règles analytiques (préfixe de compte, tiers),
 * imputation obligatoire d'un axe. Les règles ne renseignent que les axes laissés vides à la saisie.
 */
export default function ImputationsPage() {
  const [tab, setTab] = useState<Tab>("regles");
  return (
    <div>
      <PageHeader title="Imputations automatiques" subtitle="Ce que la plateforme déduit à la saisie : axes analytiques par compte ou par tiers, axes obligatoires." />
      <Tabs
        tabs={[
          { key: "regles", label: "Règles analytiques" },
          { key: "obligatoire", label: "Imputation obligatoire" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "regles" && <Rules />}
      {tab === "obligatoire" && <Requirements />}
    </div>
  );
}

function Rules() {
  const { data: rules, error, mutate } = useApi<Rule[]>("/finance/analytic-rules");
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  return (
    <div className="space-y-4">
      <Card
        title="Règles d'imputation"
        padded={false}
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Nouvelle règle
          </Button>
        }
      >
        <p className="px-5 pb-3 text-sm text-muted">
          Une ligne dont le compte commence par le préfixe (ou qui porte le tiers) reçoit les comptes analytiques de la règle sur les axes laissés vides. Des règles d&apos;axes différents se cumulent ; sur un même axe, la plus précise l&apos;emporte.
        </p>
        {error && <ErrorBox error={error} />}
        {!rules ? (
          <Loading />
        ) : (
          <DataTable
            rows={rules}
            rowKey={(r) => r.id}
            onRowClick={(r) => setEditing(r)}
            empty="Aucune règle : les axes ne se renseignent qu'à la main."
            columns={[
              { key: "account_prefix", label: "Comptes", render: (r) => <span className="font-mono text-xs">{r.account_prefix ?? "Tous"}</span> },
              { key: "partner", label: "Tiers", render: (r) => r.partner?.name ?? "Tous" },
              { key: "distribution", label: "Imputation", render: (r) => <AnalyticTags shares={r.distribution} /> },
              { key: "company", label: "Société", render: (r) => (r.company ? r.company.name : <Badge tone="accent">Les deux</Badge>) },
            ]}
          />
        )}
      </Card>
      <Simulation />
      {editing && <RuleForm rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </div>
  );
}

function RuleForm({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const { data: axes } = useAxes();
  const [prefix, setPrefix] = useState(rule?.account_prefix ?? "");
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(rule?.partner ?? null);
  const [choice, setChoice] = useState<AxisChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = choice ?? fromDistribution(axes, rule?.analytic_distribution);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  const body = { account_prefix: prefix.trim() || null, partner_id: partner?.id ?? null, analytic_distribution: toDistribution(current) };
  return (
    <Modal
      open
      wide
      title={rule ? "Modifier la règle" : "Nouvelle règle d'imputation"}
      onClose={onClose}
      footer={
        <>
          {rule && (
            <Button variant="danger" loading={busy} onClick={() => run(() => apiSend("DELETE", `/finance/analytic-rules/${rule.id}`))}>
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
          <Button variant="primary" loading={busy} disabled={(!prefix.trim() && !partner) || !toDistribution(current)} onClick={() => run(() => (rule ? apiSend("PATCH", `/finance/analytic-rules/${rule.id}`, body) : apiSend("POST", "/finance/analytic-rules", body)))}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Préfixes de comptes" hint="Par exemple « 6042, 6053 » ; vide : tous les comptes du tiers.">
            <Input className="font-mono" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="60, 61" />
          </Field>
          <Field label="Tiers (facultatif)">
            <PartnerPicker value={partner} onChange={setPartner} kind="supplier" />
          </Field>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Comptes analytiques appliqués</div>
          <AnalyticFields axes={axes} value={current} onChange={setChoice} />
        </div>
      </div>
    </Modal>
  );
}

/** Essai : ce que les règles appliqueraient à une ligne saisie sans analytique. */
function Simulation() {
  const { data: accounts } = useApi<Account[]>("/finance/accounts?limit=3000");
  const [accountId, setAccountId] = useState("");
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const query = accountId || partner ? `/finance/analytic-rules/simulate?account_id=${accountId}&partner_id=${partner?.id ?? ""}` : null;
  const { data } = useApi<{ distribution: AnalyticShare[] }>(query);
  return (
    <Card title="Essayer les règles">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Compte">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Choisir…" options={(accounts ?? []).filter((a) => /^[2678]/.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
        </Field>
        <Field label="Tiers">
          <PartnerPicker value={partner} onChange={setPartner} kind="supplier" />
        </Field>
        <Field label="Imputation déduite">
          <div className="min-h-9 py-1.5">{query ? <AnalyticTags shares={data?.distribution} /> : <span className="text-sm text-muted">Choisissez un compte ou un tiers.</span>}</div>
        </Field>
      </div>
    </Card>
  );
}

const DOMAIN_LABELS: Record<string, string> = { invoice: "Factures", bill: "Pièces d'achat", general: "Opérations diverses" };

function Requirements() {
  const { data, error, mutate } = useApi<Requirement[]>("/finance/analytic-requirements");
  const { data: axes } = useAxes();
  const [form, setForm] = useState({ plan: "activite", prefix: "" });
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function act(fn: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "ok", text: ok });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Erreur" });
    }
  }
  return (
    <Card title="Axes obligatoires" padded={false}>
      <p className="px-5 pb-3 text-sm text-muted">Une pièce qui mouvemente un compte du préfixe ne se valide pas sans répartition complète (100 %) sur l&apos;axe.</p>
      {error && <ErrorBox error={error} />}
      {!data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data}
          rowKey={(r) => r.id}
          empty="Aucun axe obligatoire."
          columns={[
            { key: "plan", label: "Axe" },
            { key: "prefix", label: "Comptes", render: (r) => <span className="font-mono text-xs">{r.prefix}</span> },
            { key: "domains", label: "Pièces", render: (r) => r.domains.map((d) => DOMAIN_LABELS[d] ?? d).join(", ") },
            {
              key: "del",
              label: "",
              align: "right",
              render: (r) =>
                r.company ? (
                  <button type="button" className="text-muted hover:text-danger" aria-label="Retirer" onClick={() => act(() => apiSend("DELETE", `/finance/analytic-requirements/${r.id}`), "Obligation retirée.")}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <Badge tone="accent">Les deux sociétés</Badge>
                ),
            },
          ]}
        />
      )}
      <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
        {message && (
          <div className="w-full">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
        <Field label="Axe">
          <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} options={(axes ?? []).map((a) => ({ value: a.key, label: a.label }))} />
        </Field>
        <Field label="Préfixes de comptes">
          <Input className="font-mono" value={form.prefix} placeholder="60, 61, 62" onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
        </Field>
        <Button variant="primary" disabled={!form.prefix.trim()} onClick={() => act(() => apiSend("POST", "/finance/analytic-requirements", form), "Axe rendu obligatoire.")}>
          Rendre obligatoire
        </Button>
      </div>
    </Card>
  );
}
