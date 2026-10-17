"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Tabs } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";

interface ChartAccount { id: number; code: string; name: string; type: string; reconcile: boolean; active: boolean; analytic_required: boolean }

const TYPES: Record<string, string> = {
  asset_receivable: "Clients",
  asset_cash: "Trésorerie",
  asset_current: "Actif circulant",
  asset_non_current: "Actif non courant",
  asset_prepayments: "Charges constatées d'avance",
  asset_fixed: "Immobilisations",
  liability_payable: "Fournisseurs",
  liability_credit_card: "Carte de paiement",
  liability_current: "Passif circulant",
  liability_non_current: "Dettes financières",
  equity: "Capitaux propres",
  equity_unaffected: "Résultat non affecté",
  income: "Produits",
  income_other: "Autres produits",
  expense: "Charges",
  expense_other: "Autres charges",
  expense_depreciation: "Dotations",
  expense_direct_cost: "Coût des ventes",
  off_balance: "Hors bilan",
};
const CLASSES = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
type Classe = (typeof CLASSES)[number];
const CLASS_LABELS: Record<Classe, string> = { "1": "1 Capitaux", "2": "2 Immobilisations", "3": "3 Stocks", "4": "4 Tiers", "5": "5 Trésorerie", "6": "6 Charges", "7": "7 Produits", "8": "8 HAO" };

/**
 * Plan de comptes SYSCOHADA de la société de travail, tenu par la finance : un compte se crée sous une
 * racine existante (nature reprise du compte voisin), se désactive une fois soldé (jamais supprimé) et
 * peut exiger l'axe Activité.
 */
export default function ChartPage() {
  const [classe, setClasse] = useState<Classe>("6");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<ChartAccount | "new" | null>(null);
  const params = new URLSearchParams({ limit: "3000" });
  if (search.trim()) params.set("search", search.trim());
  else params.set("prefix", classe);
  if (archived) params.set("all", "1");
  const { data, error, mutate } = useApi<ChartAccount[]>(`/finance/accounts?${params.toString()}`);
  return (
    <div>
      <PageHeader
        title="Plan comptable"
        subtitle="Référentiel SYSCOHADA révisé de la société de travail : tout compte utilisé dans les pièces doit y exister."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Nouveau compte
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <Tabs tabs={CLASSES.map((c) => ({ key: c, label: CLASS_LABELS[c] }))} value={classe} onChange={(c) => { setClasse(c); setSearch(""); }} />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Désactivés
            </label>
            <Input className="max-w-xs" placeholder="Code ou intitulé…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {error && <ErrorBox error={error} />}
        {!data && !error ? (
          <Loading />
        ) : (
          <DataTable
            dense
            rows={data ?? []}
            rowKey={(a) => a.id}
            onRowClick={(a) => setEditing(a)}
            empty="Aucun compte."
            columns={[
              { key: "code", label: "Compte", render: (a) => <span className="font-mono text-xs">{a.code}</span> },
              { key: "name", label: "Intitulé" },
              { key: "type", label: "Nature", render: (a) => TYPES[a.type] ?? a.type },
              { key: "reconcile", label: "Lettrable", render: (a) => (a.reconcile ? "Oui" : "–") },
              { key: "analytic_required", label: "Analytique", render: (a) => (a.analytic_required ? <Badge tone="accent">Activité obligatoire</Badge> : "–") },
              { key: "active", label: "Statut", render: (a) => (a.active ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge>) },
            ]}
          />
        )}
      </Card>
      {editing && <AccountForm account={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </div>
  );
}

function AccountForm({ account, onClose, onSaved }: { account: ChartAccount | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: account?.code ?? "", name: account?.name ?? "", analytic_required: account?.analytic_required ?? false, reconcile: account?.reconcile ?? false });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(patch?: { active: boolean }) {
    setBusy(true);
    setError(null);
    try {
      if (account) {
        await apiSend("PATCH", `/finance/accounts/${account.id}`, patch ?? { name: form.name.trim(), analytic_required: form.analytic_required, reconcile: form.reconcile });
        onSaved();
      } else {
        const res = await apiSend<ChartAccount & { sibling: { code: string; name: string } }>("POST", "/finance/accounts", { code: form.code.trim(), name: form.name.trim(), analytic_required: form.analytic_required });
        setCreated(`Compte ${res.code} créé : nature « ${TYPES[res.type] ?? res.type} »${res.reconcile ? ", lettrable" : ""}, reprise du compte ${res.sibling.code} ${res.sibling.name}.`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  const fixedReconcile = account ? ["asset_receivable", "liability_payable"].includes(account.type) : true;
  return (
    <Modal
      open
      title={account ? `Compte ${account.code}` : "Nouveau compte"}
      onClose={created ? onSaved : onClose}
      footer={
        created ? (
          <Button variant="primary" onClick={onSaved}>
            Fermer
          </Button>
        ) : (
          <>
            {account && (
              <Button variant={account.active ? "danger" : "secondary"} loading={busy} onClick={() => save({ active: !account.active })}>
                {account.active ? "Désactiver" : "Réactiver"}
              </Button>
            )}
            <Button variant="primary" loading={busy} disabled={!form.name.trim() || (!account && !form.code.trim())} onClick={() => save()}>
              Enregistrer
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {created && <Notice tone="ok">{created}</Notice>}
        {!account && (
          <Field label="Code" hint="Sous une racine existante du plan (trois premiers chiffres) ; la nature et le lettrage suivent le compte voisin.">
            <Input className="font-mono" inputMode="numeric" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="605210" />
          </Field>
        )}
        <Field label="Intitulé">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.analytic_required} onChange={(e) => setForm({ ...form, analytic_required: e.target.checked })} /> Imputation analytique obligatoire (axe Activité)
        </label>
        {account && !fixedReconcile && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.reconcile} onChange={(e) => setForm({ ...form, reconcile: e.target.checked })} /> Compte lettrable
          </label>
        )}
        {account && <p className="text-xs text-muted">Un compte mouvementé ne se supprime pas : soldé, il se désactive et sort des listes de saisie.</p>}
      </div>
    </Modal>
  );
}
