"use client";

import { useState } from "react";
import { Calculator, Plus } from "lucide-react";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Select } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Account, Journal } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtShort } from "@/lib/format";

interface Asset {
  id: number;
  name: string;
  code: string | null;
  profile: { id: number; name: string };
  purchase_value: number;
  depreciated: number;
  residual: number;
  date_start: string;
  method_number: number;
  method_period: string;
  state: "draft" | "open" | "close" | "removed";
  board?: Array<{ id: number; date: string; type: string; amount: number; depreciated: number; remaining: number; posted: boolean }>;
}
interface Profile { id: number; name: string; method_number: number; method_period: string; account_asset: string; account_depreciation: string; account_expense: string }

const STATE = { draft: ["Brouillon", "neutral"], open: ["En service", "accent"], close: ["Amortie", "ok"], removed: ["Sortie", "neutral"] } as const;

export default function AssetsPage() {
  const { data, error, mutate } = useApi<{ items: Asset[]; totals: Record<string, number> }>("/finance/assets");
  const [modal, setModal] = useState<null | "asset" | "profile" | "depreciate">(null);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div>
      <PageHeader
        title="Immobilisations et amortissements"
        subtitle="Registre des immobilisations, plans d'amortissement, dotations comptabilisées."
        actions={
          <>
            <Button onClick={() => setModal("profile")}>Catégories</Button>
            <Button onClick={() => setModal("depreciate")}>
              <Calculator className="h-4 w-4" /> Comptabiliser les dotations
            </Button>
            <Button variant="primary" onClick={() => setModal("asset")}>
              <Plus className="h-4 w-4" /> Nouvelle immobilisation
            </Button>
          </>
        }
      />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi label="Valeur brute" value={fmtShort(data.totals.purchase_value)} />
            <Kpi label="Amortissements cumulés" value={fmtShort(data.totals.depreciated)} />
            <Kpi label="Valeur nette comptable" value={fmtShort(data.totals.residual)} tone="accent" />
          </div>
          <Card padded={false}>
            <DataTable
              rows={data.items}
              rowKey={(a) => a.id}
              onRowClick={(a) => setSelected(a.id)}
              empty="Aucune immobilisation."
              columns={[
                { key: "name", label: "Désignation" },
                { key: "profile", label: "Catégorie", render: (a) => a.profile.name },
                { key: "date_start", label: "Mise en service", render: (a) => fmtDate(a.date_start) },
                { key: "purchase_value", label: "Valeur brute", align: "right", render: (a) => fmtGNF(a.purchase_value) },
                { key: "depreciated", label: "Amortie", align: "right", render: (a) => fmtGNF(a.depreciated) },
                { key: "residual", label: "VNC", align: "right", render: (a) => fmtGNF(a.residual) },
                { key: "state", label: "Statut", render: (a) => <Badge tone={STATE[a.state][1]}>{STATE[a.state][0]}</Badge> },
              ]}
            />
          </Card>
        </div>
      )}
      {selected !== null && <AssetModal id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
      {modal === "asset" && <AssetForm onClose={() => setModal(null)} onDone={() => { setModal(null); void mutate(); }} />}
      {modal === "profile" && <ProfileForm onClose={() => setModal(null)} />}
      {modal === "depreciate" && <DepreciateForm onClose={() => setModal(null)} onDone={() => mutate()} />}
    </div>
  );
}

function AssetModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: asset, mutate } = useApi<Asset>(`/finance/assets/${id}`);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      wide
      title={asset?.name ?? "Immobilisation"}
      onClose={onClose}
      footer={
        asset?.state === "draft" && (
          <Button variant="primary" onClick={() => apiSend("POST", `/finance/assets/${id}/confirm`).then(() => { void mutate(); onChanged(); }).catch((e) => setError(e instanceof ApiError ? e.message : "Erreur"))}>
            Mettre en service
          </Button>
        )
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {!asset ? (
        <Loading />
      ) : (
        <DataTable
          dense
          rows={asset.board ?? []}
          rowKey={(l) => l.id}
          empty="Plan d'amortissement non calculé."
          columns={[
            { key: "date", label: "Date", render: (l) => fmtDate(l.date) },
            { key: "type", label: "Nature", render: (l) => ({ create: "Valeur d'origine", depreciate: "Dotation", remove: "Sortie" })[l.type] ?? l.type },
            { key: "amount", label: "Montant", align: "right", render: (l) => fmtGNF(l.amount) },
            { key: "depreciated", label: "Cumul", align: "right", render: (l) => fmtGNF(l.depreciated) },
            { key: "remaining", label: "VNC", align: "right", render: (l) => fmtGNF(l.remaining) },
            { key: "posted", label: "", render: (l) => (l.posted ? <Badge tone="ok">Comptabilisée</Badge> : null) },
          ]}
        />
      )}
    </Modal>
  );
}

function AssetForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: profiles } = useApi<Profile[]>("/finance/assets/profiles");
  const [f, setF] = useState({ name: "", profile_id: "", purchase_value: "", date_start: new Date().toISOString().slice(0, 10), code: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    try {
      await apiSend("POST", "/finance/assets", { ...f, profile_id: Number(f.profile_id), purchase_value: Number(f.purchase_value.replace(/\s/g, "")), confirm: true });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <Modal open title="Nouvelle immobilisation" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!f.name || !f.profile_id || !f.purchase_value}>Enregistrer et mettre en service</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {profiles && profiles.length === 0 && <Notice tone="warn">Créez d&apos;abord une catégorie (comptes et durée d&apos;amortissement).</Notice>}
        <Field label="Désignation">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tracteur RENAULT T 480, citerne 40 000 L" />
        </Field>
        <Field label="Catégorie">
          <Select value={f.profile_id} onChange={(e) => setF({ ...f, profile_id: e.target.value })} placeholder="Choisir…" options={(profiles ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.method_number} ${p.method_period === "year" ? "ans" : "périodes"})` }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valeur d'acquisition HT">
            <Input inputMode="numeric" className="font-mono" value={f.purchase_value} onChange={(e) => setF({ ...f, purchase_value: e.target.value })} />
          </Field>
          <Field label="Mise en service">
            <Input type="date" value={f.date_start} onChange={(e) => setF({ ...f, date_start: e.target.value })} />
          </Field>
        </div>
        <Field label="Code inventaire (facultatif)">
          <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function ProfileForm({ onClose }: { onClose: () => void }) {
  const { data: profiles, mutate } = useApi<Profile[]>("/finance/assets/profiles");
  const { data: accounts } = useApi<Account[]>("/finance/accounts?limit=2000");
  const { data: journals } = useApi<Journal[]>("/finance/journals?type=general");
  const [f, setF] = useState({ name: "", account_asset_id: "", account_depreciation_id: "", account_expense_depreciation_id: "", journal_id: "", method_number: "5" });
  const [error, setError] = useState<string | null>(null);
  const opts = (re: RegExp) => (accounts ?? []).filter((a) => re.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  async function submit() {
    setError(null);
    try {
      await apiSend("POST", "/finance/assets/profiles", { ...f, account_asset_id: Number(f.account_asset_id), account_depreciation_id: Number(f.account_depreciation_id), account_expense_depreciation_id: Number(f.account_expense_depreciation_id), journal_id: Number(f.journal_id), method_number: Number(f.method_number) });
      setF({ ...f, name: "" });
      void mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <Modal open wide title="Catégories d'immobilisations" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!f.name || !f.account_asset_id || !f.account_depreciation_id || !f.account_expense_depreciation_id || !f.journal_id}>Ajouter la catégorie</Button>}>
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <DataTable dense rows={profiles ?? []} rowKey={(p) => p.id} empty="Aucune catégorie." columns={[
          { key: "name", label: "Catégorie" },
          { key: "method_number", label: "Durée", render: (p) => `${p.method_number} ${p.method_period === "year" ? "ans" : "périodes"}` },
          { key: "account_asset", label: "Immobilisation" },
          { key: "account_depreciation", label: "Amortissement" },
          { key: "account_expense", label: "Dotation" },
        ]} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Nom">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Matériel de transport" />
          </Field>
          <Field label="Durée (années)">
            <Input inputMode="numeric" value={f.method_number} onChange={(e) => setF({ ...f, method_number: e.target.value })} />
          </Field>
          <Field label="Journal">
            <Select value={f.journal_id} onChange={(e) => setF({ ...f, journal_id: e.target.value })} placeholder="Choisir…" options={(journals ?? []).map((j) => ({ value: j.id, label: j.name }))} />
          </Field>
          <Field label="Compte d'immobilisation (2x)">
            <Select value={f.account_asset_id} onChange={(e) => setF({ ...f, account_asset_id: e.target.value })} placeholder="Choisir…" options={opts(/^2[1-4]/)} />
          </Field>
          <Field label="Compte d'amortissement (28x)">
            <Select value={f.account_depreciation_id} onChange={(e) => setF({ ...f, account_depreciation_id: e.target.value })} placeholder="Choisir…" options={opts(/^28/)} />
          </Field>
          <Field label="Compte de dotation (681)">
            <Select value={f.account_expense_depreciation_id} onChange={(e) => setF({ ...f, account_expense_depreciation_id: e.target.value })} placeholder="Choisir…" options={opts(/^68/)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function DepreciateForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState<string | null>(null);
  async function submit() {
    try {
      await apiSend("POST", "/finance/assets/depreciate", { date });
      setMessage("Dotations comptabilisées.");
      onDone();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erreur");
    }
  }
  return (
    <Modal open title="Comptabiliser les dotations" onClose={onClose} footer={<Button variant="primary" onClick={submit}>Comptabiliser</Button>}>
      <div className="space-y-3">
        {message && <Notice>{message}</Notice>}
        <Field label="Jusqu'au" hint="Toutes les dotations des immobilisations en service jusqu'à cette date.">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
