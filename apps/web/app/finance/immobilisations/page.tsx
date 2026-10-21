"use client";

import { useState } from "react";
import { Calculator, Download, Plus, ShieldCheck } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Select } from "@/components/ui";
import { ApiError, apiDownload, apiSend, useApi } from "@/lib/api-client";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import type { Account, Journal } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtShort } from "@/lib/format";

interface Asset {
  id: number;
  name: string;
  code: string | null;
  profile: { id: number; name: string };
  account_asset: string | null;
  purchase_value: number;
  depreciated: number;
  residual: number;
  date_start: string;
  method_number: number;
  method_period: string;
  non_depreciable: boolean;
  months_depreciated: number;
  months_total: number;
  state: "draft" | "open" | "close" | "removed";
  activity: { id: number; name: string } | null;
  location: string | null;
  custodian: string | null;
  takeover_date: string | null;
  takeover_amount: number | null;
  board?: Array<{ id: number; date: string; type: string; amount: number; depreciated: number; remaining: number; posted: boolean; takeover: boolean }>;
  takeover_result?: { theoretical: number; accumulated: number; difference: number; first_depreciation: number | null } | null;
}
interface Profile {
  id: number;
  name: string;
  method_number: number;
  method_period: string;
  period_label: string;
  non_depreciable: boolean;
  account_asset: string;
  account_depreciation: string;
  account_expense: string;
}
interface ControlRow { kind: string; label: string; account: string; account_name: string; profiles: string[]; assets: number; register: number; ledger: number; difference: number; ok: boolean }

const STATE = { draft: ["Brouillon", "neutral"], open: ["En service", "accent"], close: ["Amortie", "ok"], removed: ["Sortie", "neutral"] } as const;
const PERIODS = [
  { value: "month", label: "Mensuelle" },
  { value: "quarter", label: "Trimestrielle" },
  { value: "year", label: "Annuelle" },
];
/** Début de l'exercice en cours : un bien mis en service avant est repris avec son cumul d'amortissements. */
const opening = () => `${new Date().getFullYear()}-01-01`;
const eve = () => `31/12/${new Date().getFullYear() - 1}`;
const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));

function duration(p: { non_depreciable: boolean; method_number: number; period_label?: string }) {
  return p.non_depreciable ? "Non amortissable" : `${p.method_number} ans, dotations ${p.period_label ?? "mensuelles"}`;
}

export default function AssetsPage() {
  const { data, error, mutate } = useApi<{ items: Asset[]; totals: Record<string, number> }>("/finance/assets");
  const [modal, setModal] = useState<null | "asset" | "profile" | "depreciate" | "control">(null);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div>
      <PageHeader
        title="Immobilisations et amortissements"
        subtitle="Registre des immobilisations, plans d'amortissement à dotations mensuelles ; les dotations échues sont comptabilisées chaque nuit et à la clôture du mois."
        actions={
          <>
            <Button onClick={() => setModal("profile")}>Catégories</Button>
            <Button onClick={() => setModal("control")}>
              <ShieldCheck className="h-4 w-4" /> Contrôle de reprise
            </Button>
            <Button onClick={() => apiDownload("/finance/assets/export?format=xlsx", "registre_immobilisations.xlsx")}>
              <Download className="h-4 w-4" /> Registre
            </Button>
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
                { key: "name", label: "Désignation", render: (a) => (a.code ? `${a.code} ${a.name}` : a.name) },
                { key: "profile", label: "Catégorie", render: (a) => a.profile.name },
                { key: "date_start", label: "Mise en service", render: (a) => fmtDate(a.date_start) },
                { key: "purchase_value", label: "Valeur brute", align: "right", render: (a) => fmtGNF(a.purchase_value) },
                { key: "months", label: "Mois amortis", align: "right", render: (a) => (a.non_depreciable ? "–" : `${a.months_depreciated} / ${a.months_total}`) },
                { key: "depreciated", label: "Amortie", align: "right", render: (a) => fmtGNF(a.depreciated) },
                { key: "residual", label: "VNC", align: "right", render: (a) => fmtGNF(a.residual) },
                { key: "location", label: "Localisation", render: (a) => a.location ?? "–" },
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
      {modal === "control" && <TakeoverControl onClose={() => setModal(null)} />}
    </div>
  );
}

function AssetModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: asset, mutate } = useApi<Asset>(`/finance/assets/${id}`);
  const [error, setError] = useState<string | null>(null);
  const [disposing, setDisposing] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <Modal
      open
      wide
      title={asset?.name ?? "Immobilisation"}
      onClose={onClose}
      footer={
        <>
          {asset && asset.state !== "removed" && !editing && <Button onClick={() => setEditing(true)}>Activité, localisation, responsable</Button>}
          {(asset?.state === "open" || asset?.state === "close") && !disposing && (
            <Button onClick={() => setDisposing(true)}>Sortir de l&apos;actif</Button>
          )}
          {asset?.state === "draft" && (
            <Button variant="primary" onClick={() => apiSend("POST", `/finance/assets/${id}/confirm`).then(() => { void mutate(); onChanged(); }).catch((e) => setError(e instanceof ApiError ? e.message : "Erreur"))}>
              Mettre en service
            </Button>
          )}
        </>
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {disposing && asset && <DisposeForm asset={asset} onCancel={() => setDisposing(false)} onDone={() => { setDisposing(false); void mutate(); onChanged(); }} />}
      {editing && asset && <DetailsForm asset={asset} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); void mutate(); onChanged(); }} />}
      {!asset ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
            <dt className="text-muted">Catégorie</dt>
            <dd>{asset.profile.name}</dd>
            <dt className="text-muted">Durée</dt>
            <dd>{asset.non_depreciable ? "Non amortissable" : `${asset.method_number} ans, ${asset.months_depreciated} mois amortis sur ${asset.months_total}`}</dd>
            <dt className="text-muted">Activité</dt>
            <dd>{asset.activity?.name ?? "–"}</dd>
            <dt className="text-muted">Localisation</dt>
            <dd>{asset.location ?? "–"}</dd>
            <dt className="text-muted">Responsable</dt>
            <dd>{asset.custodian ?? "–"}</dd>
            {asset.takeover_date && (
              <>
                <dt className="text-muted">Reprise</dt>
                <dd>{`${fmtGNF(asset.takeover_amount)} cumulés au ${fmtDate(asset.takeover_date)}`}</dd>
              </>
            )}
          </dl>
          <DataTable
            dense
            rows={asset.board ?? []}
            rowKey={(l) => l.id}
            empty={asset.non_depreciable ? "Bien non amortissable : pas de plan." : "Plan d'amortissement non calculé."}
            columns={[
              { key: "date", label: "Date", render: (l) => fmtDate(l.date) },
              { key: "type", label: "Nature", render: (l) => ({ create: "Valeur d'origine", depreciate: "Dotation", remove: "Sortie" })[l.type] ?? l.type },
              { key: "amount", label: "Montant", align: "right", render: (l) => fmtGNF(l.amount) },
              { key: "depreciated", label: "Cumul", align: "right", render: (l) => fmtGNF(l.depreciated) },
              { key: "remaining", label: "VNC", align: "right", render: (l) => fmtGNF(l.remaining) },
              { key: "posted", label: "", render: (l) => (l.takeover ? <Badge tone="neutral">Reprise</Badge> : l.posted ? <Badge tone="ok">Comptabilisée</Badge> : null) },
            ]}
          />
        </div>
      )}
    </Modal>
  );
}

function ActivitySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: activities } = useApi<Array<{ id: number; name: string }>>("/finance/analytic-accounts?plan=activite");
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder="–" options={(activities ?? []).map((a) => ({ value: a.id, label: a.name }))} />;
}

/** Activité (ventilation des dotations à venir), localisation et responsable. */
function DetailsForm({ asset, onCancel, onDone }: { asset: Asset; onCancel: () => void; onDone: () => void }) {
  const [f, setF] = useState({ activity_id: asset.activity ? String(asset.activity.id) : "", location: asset.location ?? "", custodian: asset.custodian ?? "" });
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    try {
      await apiSend("PATCH", `/finance/assets/${asset.id}`, { activity_id: f.activity_id ? Number(f.activity_id) : null, location: f.location, custodian: f.custodian });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <div className="mb-4 space-y-3 rounded-lg bg-panel-2 p-4">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Activité" hint="Les dotations à venir y sont imputées."><ActivitySelect value={f.activity_id} onChange={(v) => setF({ ...f, activity_id: v })} /></Field>
        <Field label="Localisation"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Responsable"><Input value={f.custodian} onChange={(e) => setF({ ...f, custodian: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Annuler</Button>
        <Button variant="primary" onClick={submit}>Enregistrer</Button>
      </div>
    </div>
  );
}

/** Sortie de l'actif : cession (prix et acquéreur) ou mise au rebut (prix nul). */
function DisposeForm({ asset, onCancel, onDone }: { asset: Asset; onCancel: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), sale_value: "", note: "" });
  const [buyer, setBuyer] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/finance/assets/${asset.id}/dispose`, {
        date: f.date, sale_value: num(f.sale_value) || 0, partner_id: buyer?.id, note: f.note || undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sortie impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-4 space-y-3 rounded-lg bg-panel-2 p-4">
      <p className="text-sm">
        Sortie de l&apos;actif : dotation jusqu&apos;à la date de sortie, reprise des amortissements, valeur nette comptable en 81x.
        En cas de vente, la créance sur l&apos;acquéreur (485) et le produit de cession (82x) sont comptabilisés.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Date de sortie"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Prix de cession (0 si mise au rebut)"><Input inputMode="numeric" className="font-mono" value={f.sale_value} onChange={(e) => setF({ ...f, sale_value: e.target.value })} /></Field>
        <Field label="Acquéreur"><PartnerPicker value={buyer} onChange={setBuyer} kind="customer" /></Field>
        <Field label="Motif" className="md:col-span-3"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Annuler</Button>
        <Button variant="danger" loading={busy} onClick={() => window.confirm(`Sortir « ${asset.name} » de l'actif ? Les écritures seront comptabilisées.`) && submit()}>Confirmer la sortie</Button>
      </div>
    </div>
  );
}

function AssetForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: profiles } = useApi<Profile[]>("/finance/assets/profiles");
  const [f, setF] = useState({ name: "", profile_id: "", purchase_value: "", date_start: new Date().toISOString().slice(0, 10), code: "", accumulated: "", activity_id: "", location: "", custodian: "" });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Asset["takeover_result"]>(null);
  const takeover = f.date_start < opening();
  const profile = profiles?.find((p) => String(p.id) === f.profile_id);
  async function submit() {
    setError(null);
    try {
      const asset = await apiSend<Asset>("POST", "/finance/assets", {
        name: f.name,
        code: f.code || undefined,
        profile_id: Number(f.profile_id),
        purchase_value: num(f.purchase_value),
        date_start: f.date_start,
        accumulated_depreciation: takeover ? num(f.accumulated || "0") : undefined,
        activity_id: f.activity_id ? Number(f.activity_id) : undefined,
        location: f.location || undefined,
        custodian: f.custodian || undefined,
        confirm: true,
      });
      if (asset.takeover_result && Math.abs(asset.takeover_result.difference) >= 1) {
        setResult(asset.takeover_result);
      } else {
        onDone();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  if (result) {
    return (
      <Modal open title="Immobilisation reprise" onClose={onDone} footer={<Button variant="primary" onClick={onDone}>Fermer</Button>}>
        <Notice tone="warn">
          Le cumul repris ({fmtGNF(result.accumulated)}) diffère du plan théorique ({fmtGNF(result.theoretical)}) de {fmtGNF(result.difference)} :
          l&apos;écart est porté sur la première dotation de l&apos;exercice ({fmtGNF(result.first_depreciation)}). Vérifiez la durée et la date de mise en service si l&apos;écart surprend.
        </Notice>
      </Modal>
    );
  }
  return (
    <Modal open wide title="Nouvelle immobilisation" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!f.name || !f.profile_id || !f.purchase_value || (takeover && f.accumulated === "" && !profile?.non_depreciable)}>Enregistrer et mettre en service</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {profiles && profiles.length === 0 && <Notice tone="warn">Créez d&apos;abord une catégorie (comptes et durée d&apos;amortissement).</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Désignation" className="md:col-span-2">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tracteur RENAULT T 480, citerne 40 000 L" />
          </Field>
          <Field label="Code inventaire (facultatif)">
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label="Catégorie" className="md:col-span-2">
            <Select value={f.profile_id} onChange={(e) => setF({ ...f, profile_id: e.target.value })} placeholder="Choisir…" options={(profiles ?? []).map((p) => ({ value: p.id, label: `${p.name} (${duration(p)})` }))} />
          </Field>
          <Field label="Activité" hint="Les dotations y sont imputées.">
            <ActivitySelect value={f.activity_id} onChange={(v) => setF({ ...f, activity_id: v })} />
          </Field>
          <Field label="Valeur d'acquisition HT">
            <Input inputMode="numeric" className="font-mono" value={f.purchase_value} onChange={(e) => setF({ ...f, purchase_value: e.target.value })} />
          </Field>
          <Field label="Mise en service">
            <Input type="date" value={f.date_start} onChange={(e) => setF({ ...f, date_start: e.target.value })} />
          </Field>
          {takeover && !profile?.non_depreciable && (
            <Field label={`Amortissements cumulés au ${eve()}`} hint="Cumul de l'ancien système (reprise)">
              <Input inputMode="numeric" className="font-mono" value={f.accumulated} onChange={(e) => setF({ ...f, accumulated: e.target.value })} />
            </Field>
          )}
          <Field label="Localisation">
            <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Parc, dépôt, chantier…" />
          </Field>
          <Field label="Responsable">
            <Input value={f.custodian} onChange={(e) => setF({ ...f, custodian: e.target.value })} />
          </Field>
        </div>
        {takeover && (
          <Notice tone="accent">
            Bien déjà en service : les dotations antérieures au {fmtDate(opening())} deviennent des lignes de reprise, sans écriture (le solde d&apos;ouverture du 28x les porte).
            Seules les dotations de l&apos;exercice seront comptabilisées.
          </Notice>
        )}
      </div>
    </Modal>
  );
}

function ProfileForm({ onClose }: { onClose: () => void }) {
  const { data: profiles, mutate } = useApi<Profile[]>("/finance/assets/profiles");
  const { data: accounts } = useApi<Account[]>("/finance/accounts?limit=2000");
  const { data: journals } = useApi<Journal[]>("/finance/journals?type=general");
  const [f, setF] = useState({ name: "", account_asset_id: "", account_depreciation_id: "", account_expense_depreciation_id: "", journal_id: "", method_number: "5", method_period: "month", non_depreciable: false });
  const [error, setError] = useState<string | null>(null);
  const opts = (re: RegExp) => (accounts ?? []).filter((a) => re.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  async function submit() {
    setError(null);
    try {
      await apiSend("POST", "/finance/assets/profiles", {
        ...f,
        account_asset_id: Number(f.account_asset_id),
        account_depreciation_id: Number(f.account_depreciation_id),
        account_expense_depreciation_id: Number(f.account_expense_depreciation_id),
        journal_id: Number(f.journal_id),
        method_number: f.non_depreciable ? undefined : Number(f.method_number),
      });
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
          { key: "method_number", label: "Durée et dotations", render: (p) => duration(p) },
          { key: "account_asset", label: "Immobilisation" },
          { key: "account_depreciation", label: "Amortissement" },
          { key: "account_expense", label: "Dotation" },
        ]} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Nom">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Matériel de transport" />
          </Field>
          <Field label="Durée (années)">
            <Input inputMode="numeric" value={f.method_number} disabled={f.non_depreciable} onChange={(e) => setF({ ...f, method_number: e.target.value })} />
          </Field>
          <Field label="Périodicité des dotations" hint="Mensuelle : une dotation à chaque fin de mois.">
            <Select value={f.method_period} disabled={f.non_depreciable} onChange={(e) => setF({ ...f, method_period: e.target.value })} options={PERIODS} />
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
          <Field label="Journal">
            <Select value={f.journal_id} onChange={(e) => setF({ ...f, journal_id: e.target.value })} placeholder="Choisir…" options={(journals ?? []).map((j) => ({ value: j.id, label: j.name }))} />
          </Field>
          <Field label="Nature" className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.non_depreciable} onChange={(e) => setF({ ...f, non_depreciable: e.target.checked })} />
              Non amortissable (terrains) : inscrit à l&apos;actif, sans plan d&apos;amortissement
            </label>
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

/** Reprise : cumul du registre face au solde d'ouverture des 28x, valeur brute face aux 2x. */
function TakeoverControl({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(opening());
  const { data, error } = useApi<{ has_opening_entry: boolean; ok: boolean; rows: ControlRow[] }>(`/finance/assets/takeover-control?opening_date=${date}`);
  return (
    <Modal open wide title="Contrôle de la reprise des immobilisations" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Date d'ouverture" className="max-w-xs">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {error && <ErrorBox error={error} />}
        {!data && !error && <Loading />}
        {data && (
          <>
            {!data.has_opening_entry ? (
              <Notice tone="warn">Aucun à-nouveau (journal AN) à cette date : reprenez d&apos;abord les soldes d&apos;ouverture.</Notice>
            ) : data.ok ? (
              <Notice tone="ok">Registre et soldes d&apos;ouverture concordent, compte par compte.</Notice>
            ) : (
              <Notice tone="danger">Écarts entre le registre et les soldes d&apos;ouverture : à corriger avant la mise en production.</Notice>
            )}
            <DataTable dense rows={data.rows} rowKey={(r) => `${r.kind}-${r.account}`} empty="Aucune immobilisation en service à cette date." columns={[
              { key: "label", label: "Contrôle" },
              { key: "account", label: "Compte", render: (r) => `${r.account} ${r.account_name}` },
              { key: "profiles", label: "Catégories", render: (r) => r.profiles.join(", ") },
              { key: "register", label: "Registre", align: "right", render: (r) => fmtGNF(r.register) },
              { key: "ledger", label: "Solde d'ouverture", align: "right", render: (r) => fmtGNF(r.ledger) },
              { key: "difference", label: "Écart", align: "right", render: (r) => <span className={r.ok ? "" : "text-danger"}>{fmtGNF(r.difference)}</span> },
            ]} />
          </>
        )}
      </div>
    </Modal>
  );
}
