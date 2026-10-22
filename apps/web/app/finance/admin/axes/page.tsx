"use client";

import { useState } from "react";
import { Pencil, Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Modal, Notice, PageHeader, Select, Tabs } from "@/components/ui";
import { analyticLabel, useAxes } from "@/components/finance/AnalyticFields";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Account, AnalyticAccount } from "@/lib/finance-types";

type Tab = "activite" | "centre_cout" | "metiers";

/**
 * Axes analytiques de la société de travail. La finance tient les activités (avec leur compte de
 * produit) et les centres de coût (rattachés à une activité) ; les axes des métiers (chantiers,
 * ensembles routiers, routes, biens, dossiers) naissent avec leur fiche dans leur module.
 */
export default function AxesPage() {
  const [tab, setTab] = useState<Tab>("activite");
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<AnalyticAccount | "new" | null>(null);
  const { data: activities, error, mutate: refreshActivities } = useApi<AnalyticAccount[]>(`/finance/analytic-accounts?plan=activite${archived ? "&active=all" : ""}`);
  const { data: centers, error: erreurCentres, mutate: refreshCenters } = useApi<AnalyticAccount[]>(`/finance/analytic-accounts?plan=centre_cout${archived ? "&active=all" : ""}`);
  const { data: axes, error: erreurAxes, mutate: refreshAxes } = useAxes();
  const rows = tab === "activite" ? activities : centers;

  function refresh() {
    void refreshActivities();
    void refreshCenters();
    void refreshAxes();
  }

  return (
    <div>
      <PageHeader
        title="Axes analytiques"
        subtitle="Activités et centres de coût de la société de travail ; les axes des métiers se créent avec leur fiche."
        actions={
          tab !== "metiers" && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> {tab === "activite" ? "Nouvelle activité" : "Nouveau centre de coût"}
            </Button>
          )
        }
      />
      <Tabs
        tabs={[
          { key: "activite", label: "Activités", count: activities?.filter((a) => a.active).length },
          { key: "centre_cout", label: "Centres de coût", count: centers?.filter((a) => a.active).length },
          { key: "metiers", label: "Axes des métiers" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab !== "metiers" && (
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="text-muted">
              {tab === "activite"
                ? "Le compte de produit d'une activité est proposé aux lignes de facture de vente qui lui sont imputées."
                : "Un centre de coût rattaché à une activité n'est proposé qu'avec elle ; un écart est signalé à la clôture."}
            </span>
            <label className="flex items-center gap-2 whitespace-nowrap text-ink-2">
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Afficher les archivés
            </label>
          </div>
          {!rows ? (
            <Etat error={tab === "activite" ? error : erreurCentres} onRetry={refresh} />
          ) : (
            <DataTable
              rows={rows}
              rowKey={(a) => a.id}
              onRowClick={(a) => setEditing(a)}
              empty={tab === "activite" ? "Aucune activité." : "Aucun centre de coût."}
              columns={[
                { key: "code", label: "Code", render: (a) => <span className="font-mono text-xs">{a.code ?? "–"}</span> },
                { key: "name", label: "Libellé" },
                tab === "activite"
                  ? { key: "income_account", label: "Compte de produit", render: (a) => (a.income_account ? `${a.income_account.code} ${a.income_account.name}` : "–") }
                  : { key: "activity", label: "Activité de rattachement", render: (a) => a.activity?.name ?? "–" },
                { key: "company", label: "Société", render: (a) => a.company?.name ?? "Les deux sociétés" },
                { key: "active", label: "Statut", render: (a) => (a.active ? <Badge tone="ok">Active</Badge> : <Badge>Archivée</Badge>) },
                { key: "edit", label: "", align: "right", render: () => <Pencil className="ml-auto h-4 w-4 text-muted" /> },
              ]}
            />
          )}
        </Card>
      )}
      {tab === "metiers" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {!axes && <Etat error={erreurAxes} onRetry={() => refreshAxes()} />}
          {axes
            ?.filter((a) => !a.managed)
            .map((axis) => (
              <Card key={axis.key} title={`${axis.label} (${axis.accounts.length})`}>
                {axis.accounts.length === 0 ? (
                  <p className="text-sm text-muted">Aucun compte : ils se créent avec les fiches du module.</p>
                ) : (
                  <ul className="max-h-64 space-y-1 overflow-y-auto text-sm text-ink-2">
                    {axis.accounts.map((a) => (
                      <li key={a.id}>{analyticLabel(a)}</li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
        </div>
      )}
      {editing && tab !== "metiers" && (
        <AxisAccountForm
          plan={tab}
          account={editing === "new" ? null : editing}
          activities={(activities ?? []).filter((a) => a.active)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AxisAccountForm({ plan, account, activities, onClose, onSaved }: { plan: "activite" | "centre_cout"; account: AnalyticAccount | null; activities: AnalyticAccount[]; onClose: () => void; onSaved: () => void }) {
  const { data: incomes } = useApi<Account[]>(plan === "activite" ? "/finance/accounts?prefix=7&limit=2000" : null);
  const [form, setForm] = useState({
    name: account?.name ?? "",
    code: account?.code ?? "",
    income_account_id: account?.income_account ? String(account.income_account.id) : "",
    activity_id: account?.activity ? String(account.activity.id) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(patch?: { active: boolean }) {
    setBusy(true);
    setError(null);
    const body = patch ?? {
      name: form.name.trim(),
      code: form.code.trim(),
      ...(plan === "activite" ? { income_account_id: form.income_account_id ? Number(form.income_account_id) : null } : { activity_id: form.activity_id ? Number(form.activity_id) : null }),
    };
    try {
      if (account) await apiSend("PATCH", `/finance/analytic-accounts/${account.id}`, body);
      else await apiSend("POST", "/finance/analytic-accounts", { plan, ...body });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const noun = plan === "activite" ? "l'activité" : "le centre de coût";
  return (
    <Modal
      open
      title={account ? `Modifier ${noun}` : plan === "activite" ? "Nouvelle activité" : "Nouveau centre de coût"}
      onClose={onClose}
      footer={
        <>
          {account && (
            <Button variant={account.active ? "danger" : "secondary"} loading={busy} onClick={() => save({ active: !account.active })}>
              {account.active ? "Archiver" : "Réactiver"}
            </Button>
          )}
          <Button variant="primary" loading={busy} disabled={!form.name.trim()} onClick={() => save()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Code">
            <Input className="font-mono uppercase" maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Libellé" className="col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
        </div>
        {plan === "activite" ? (
          <Field label="Compte de produit" hint="Proposé aux factures de vente imputées à cette activité, à défaut de compte saisi.">
            <Select value={form.income_account_id} onChange={(e) => setForm({ ...form, income_account_id: e.target.value })} placeholder="Aucun" options={(incomes ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
          </Field>
        ) : (
          <Field label="Activité de rattachement" hint="Le centre de coût n'est proposé qu'avec son activité.">
            <Select value={form.activity_id} onChange={(e) => setForm({ ...form, activity_id: e.target.value })} placeholder="Aucune" options={activities.map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
        )}
        {account && !account.active && <Notice tone="warn">Archivé : il n&apos;est plus proposé à la saisie ; ses imputations passées restent dans les états.</Notice>}
      </div>
    </Modal>
  );
}
