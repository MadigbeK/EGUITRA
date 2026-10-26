"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Etat, Field, Input, Modal, Notice, PageHeader, Select, Tabs, demanderConfirmation } from "@/components/ui";
import { AnalyticFields, AnalyticTags, fromDistribution, toDistribution, useAxes, type AxisChoice } from "@/components/finance/AnalyticFields";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { pluriel } from "@/lib/format";
import type { Account, AnalyticShare, ExpenseCategory, Ref } from "@/lib/finance-types";
import type { Profile } from "@/lib/types";

// Profils des routes d'écriture des imputations : règles et axes obligatoires (controllers/analytic_rules.py),
// catégories de dépense (categories.py), types d'opération et modes de paiement (treasury.py) : FIN_WRITE,
// administration et finance. La direction lit les mêmes tables (FIN_READ) sans les modifier.
const ECRITURE: Profile[] = ["admin", "finance"];

type Tab = "regles" | "obligatoire" | "categories" | "types" | "modes";

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

/** Listes d'un formulaire (comptes, taxes, axes) non chargées : le formulaire le dit, avec « Réessayer ». */
function ListesEnEchec({ erreur, onRetry }: { erreur: unknown; onRetry: () => void }) {
  return erreur ? <ErrorBox error={erreur} titre="Listes du formulaire non chargées : les choix proposés sont incomplets." onRetry={onRetry} /> : null;
}

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
          { key: "categories", label: "Catégories de dépense" },
          { key: "types", label: "Types d'opération" },
          { key: "modes", label: "Modes de paiement" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "regles" && <Rules />}
      {tab === "obligatoire" && <Requirements />}
      {tab === "categories" && <Categories />}
      {tab === "types" && <OperationTypes />}
      {tab === "modes" && <PaymentModes />}
    </div>
  );
}

function Rules() {
  const { data: rules, error, mutate } = useApi<Rule[]>("/finance/analytic-rules");
  const ecriture = useAutorise(ECRITURE);
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  return (
    <div className="space-y-4">
      <Card
        title="Règles d'imputation"
        padded={false}
        actions={
          ecriture ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Nouvelle règle
            </Button>
          ) : undefined
        }
      >
        <p className="px-5 pb-3 text-sm text-muted">
          Une ligne dont le compte commence par le préfixe (ou qui porte le tiers) reçoit les comptes analytiques de la règle sur les axes laissés vides. Des règles d&apos;axes différents se cumulent ; sur un même axe, la plus précise l&apos;emporte.
        </p>
        {!rules ? (
          <Etat error={error} onRetry={() => mutate()} />
        ) : (
          <DataTable
            rows={rules}
            rowKey={(r) => r.id}
            onRowClick={ecriture ? (r) => setEditing(r) : undefined}
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
      {editing && ecriture && <RuleForm rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </div>
  );
}

function RuleForm({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const { data: axes, error: erreurAxes, mutate: relireAxes } = useAxes();
  const [prefix, setPrefix] = useState(rule?.account_prefix ?? "");
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(rule?.partner ?? null);
  const [choice, setChoice] = useState<AxisChoice | null>(null);
  const envoi = useEnvoi();
  const current = choice ?? fromDistribution(axes, rule?.analytic_distribution);

  async function run(cle: string, fn: () => Promise<unknown>) {
    if (await envoi.run(cle, fn, undefined, "Enregistrement impossible.")) onSaved();
  }
  async function supprimer() {
    if (!rule) return;
    const oui = await demanderConfirmation("Supprimer cette règle d'imputation ? Les pièces déjà saisies gardent leur imputation ; les suivantes ne la recevront plus.", { action: "Supprimer la règle", danger: true });
    if (oui) await run("supprimer", () => apiSend("DELETE", `/finance/analytic-rules/${rule.id}`));
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
            <Button variant="danger" loading={envoi.busy === "supprimer"} disabled={envoi.busy !== null} onClick={supprimer}>
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
          <Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={envoi.busy !== null || (!prefix.trim() && !partner) || !toDistribution(current)} onClick={() => run("enregistrer", () => (rule ? apiSend("PATCH", `/finance/analytic-rules/${rule.id}`, body) : apiSend("POST", "/finance/analytic-rules", body)))}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <ListesEnEchec erreur={erreurAxes} onRetry={() => relireAxes()} />
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
  const { data: accounts, error: erreurComptes, mutate: relireComptes } = useApi<Account[]>("/finance/accounts?limit=3000");
  const [accountId, setAccountId] = useState("");
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const query = accountId || partner ? `/finance/analytic-rules/simulate?account_id=${accountId}&partner_id=${partner?.id ?? ""}` : null;
  const { data, error: erreurEssai, mutate: relireEssai } = useApi<{ distribution: AnalyticShare[] }>(query);
  return (
    <Card title="Essayer les règles">
      {erreurComptes && (
        <div className="mb-3">
          <ErrorBox error={erreurComptes} titre="Plan comptable non chargé : le choix du compte est vide." onRetry={() => relireComptes()} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Compte">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Choisir…" options={(accounts ?? []).filter((a) => /^[2678]/.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
        </Field>
        <Field label="Tiers">
          <PartnerPicker value={partner} onChange={setPartner} kind="supplier" />
        </Field>
        <Field label="Imputation déduite">
          <div className="min-h-9 py-1.5">
            {!query ? (
              <span className="text-sm text-muted">Choisissez un compte ou un tiers.</span>
            ) : erreurEssai ? (
              <ErrorBox error={erreurEssai} onRetry={() => relireEssai()} />
            ) : (
              <AnalyticTags shares={data?.distribution} />
            )}
          </div>
        </Field>
      </div>
    </Card>
  );
}

const NATURES: Array<{ value: string; label: string }> = [
  { value: "opex_transport", label: "Charges d'exploitation du transport" },
  { value: "opex_metier", label: "Charges d'exploitation des autres métiers" },
  { value: "personnel", label: "Personnel" },
  { value: "frais_generaux", label: "Frais généraux" },
  { value: "impots", label: "Impôts et taxes" },
  { value: "financier", label: "Charges financières" },
  { value: "capex", label: "Investissement (CAPEX)" },
];

/** Catégories de dépense : la table qui pilote l'imputation des achats (compte, TVA, compte de tiers). */
function Categories() {
  const { data, error, mutate } = useApi<ExpenseCategory[]>("/finance/expense-categories?all=1");
  const ecriture = useAutorise(ECRITURE);
  const [editing, setEditing] = useState<ExpenseCategory | "new" | null>(null);
  const envoi = useEnvoi();
  async function defaults() {
    let texte = "";
    const ok = await envoi.run("usuelles", async () => {
      const res = await apiSend<{ created: number }>("POST", "/finance/expense-categories/defaults");
      texte = res.created ? `${pluriel(res.created, "catégorie usuelle ajoutée", "catégories usuelles ajoutées")}, à revoir avec l'expert-comptable.` : "Les catégories usuelles sont déjà présentes.";
      await mutate();
    });
    if (ok) envoi.setMessage({ tone: "ok", text: texte });
  }
  return (
    <Card
      title="Catégories de dépense"
      padded={false}
      actions={
        ecriture ? (
          <>
            <Button loading={envoi.busy === "usuelles"} disabled={envoi.busy !== null} onClick={defaults}>Proposer les catégories usuelles</Button>
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Nouvelle catégorie
            </Button>
          </>
        ) : undefined
      }
    >
      <p className="px-5 pb-3 text-sm text-muted">
        À la saisie d&apos;une pièce d&apos;achat, la catégorie fixe le compte et la TVA. Un compte de tiers autre que fournisseur (personnel, organismes sociaux, État) fait de la dépense une opération diverse ; une catégorie d&apos;investissement crée l&apos;immobilisation à la validation.
      </p>
      {envoi.message && (
        <div className="px-5 pb-3">
          <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>
        </div>
      )}
      {!data ? (
        <Etat error={error} onRetry={() => mutate()} />
      ) : (
        <DataTable
          rows={data}
          rowKey={(c) => c.id}
          onRowClick={ecriture ? (c) => setEditing(c) : undefined}
          empty={ecriture ? "Aucune catégorie : proposez les catégories usuelles ou créez les vôtres." : "Aucune catégorie de dépense."}
          columns={[
            { key: "name", label: "Catégorie" },
            { key: "nature", label: "Nature", render: (c) => c.nature_label },
            { key: "account", label: "Compte", render: (c) => (c.account ? `${c.account.code} ${c.account.name}` : "–") },
            { key: "partner_account", label: "Compte de tiers", render: (c) => (c.partner_account ? <span>{c.partner_account.code} {c.entry && <Badge tone="accent">OD</Badge>}</span> : "Fournisseur") },
            { key: "tax_mode", label: "TVA", render: (c) => (c.tax_mode === "none" ? "Sans TVA" : c.tax?.name ?? "Par défaut") },
            { key: "active", label: "Statut", render: (c) => (c.active ? <Badge tone="ok">Active</Badge> : <Badge>Archivée</Badge>) },
          ]}
        />
      )}
      {editing && ecriture && <CategoryForm category={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </Card>
  );
}

function CategoryForm({ category, onClose, onSaved }: { category: ExpenseCategory | null; onClose: () => void; onSaved: () => void }) {
  const { data: accounts, error: erreurComptes, mutate: relireComptes } = useApi<Account[]>("/finance/accounts?limit=3000");
  const { data: taxes, error: erreurTaxes, mutate: relireTaxes } = useApi<Array<{ id: number; name: string; amount: number }>>("/finance/taxes?use=purchase");
  const { data: profiles, error: erreurProfils, mutate: relireProfils } = useApi<Array<{ id: number; name: string; account_asset: string }>>("/finance/assets/profiles");
  const [form, setForm] = useState({
    name: category?.name ?? "",
    nature: category?.nature ?? "frais_generaux",
    account_id: category?.account ? String(category.account.id) : "",
    partner_account_id: category?.partner_account ? String(category.partner_account.id) : "",
    tax_mode: category?.tax_mode ?? "deductible",
    tax_id: category?.tax ? String(category.tax.id) : "",
    asset_profile_id: category?.asset_profile ? String(category.asset_profile.id) : "",
  });
  const envoi = useEnvoi();
  const capex = form.nature === "capex";
  const options = (re: RegExp) => (accounts ?? []).filter((a) => re.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  async function save(cle: string, patch?: { active: boolean }) {
    const body = patch ?? {
      name: form.name.trim(),
      nature: form.nature,
      account_id: form.account_id ? Number(form.account_id) : null,
      partner_account_id: form.partner_account_id ? Number(form.partner_account_id) : null,
      tax_mode: form.tax_mode,
      tax_id: form.tax_id ? Number(form.tax_id) : null,
      asset_profile_id: capex && form.asset_profile_id ? Number(form.asset_profile_id) : null,
    };
    const ok = await envoi.run(cle, () => (category ? apiSend("PATCH", `/finance/expense-categories/${category.id}`, body) : apiSend("POST", "/finance/expense-categories", body)), undefined, "Enregistrement impossible.");
    if (ok) onSaved();
  }
  return (
    <Modal
      open
      title={category ? `Catégorie « ${category.name} »` : "Nouvelle catégorie de dépense"}
      onClose={onClose}
      footer={
        <>
          {category && (
            <Button variant={category.active ? "danger" : "secondary"} loading={envoi.busy === "statut"} disabled={envoi.busy !== null} onClick={() => save("statut", { active: !category.active })}>
              {category.active ? "Archiver" : "Réactiver"}
            </Button>
          )}
          <Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={envoi.busy !== null || !form.name.trim() || (!form.account_id && !(capex && form.asset_profile_id))} onClick={() => save("enregistrer")}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <ListesEnEchec
          erreur={erreurComptes ?? erreurTaxes ?? erreurProfils}
          onRetry={() => {
            void relireComptes();
            void relireTaxes();
            void relireProfils();
          }}
        />
        <Field label="Catégorie">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Carburant, entretien, salaires…" />
        </Field>
        <Field label="Nature">
          <Select value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value })} options={NATURES} />
        </Field>
        {capex && (
          <Field label="Catégorie d'immobilisation" hint="L'immobilisation est créée à la validation de la pièce d'achat.">
            <Select value={form.asset_profile_id} onChange={(e) => setForm({ ...form, asset_profile_id: e.target.value })} placeholder="Choisir…" options={(profiles ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.account_asset})` }))} />
          </Field>
        )}
        <Field label={capex ? "Compte d'immobilisation" : "Compte de charge"} hint={capex ? "Vide : celui de la catégorie d'immobilisation." : undefined}>
          <Select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} placeholder="Choisir…" options={options(capex ? /^2/ : /^6/)} />
        </Field>
        <Field label="Compte de tiers" hint="Vide : compte fournisseur du tiers. 42, 43 ou 44 : la dépense devient une opération diverse, sans TVA.">
          <Select value={form.partner_account_id} onChange={(e) => setForm({ ...form, partner_account_id: e.target.value })} placeholder="Fournisseur" options={options(/^4/)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="TVA">
            <Select value={form.tax_mode} onChange={(e) => setForm({ ...form, tax_mode: e.target.value as "deductible" | "none" })} options={[{ value: "deductible", label: "TVA déductible" }, { value: "none", label: "Sans TVA" }]} />
          </Field>
          {form.tax_mode === "deductible" && (
            <Field label="Taxe">
              <Select value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} placeholder="Taxe d'achat par défaut" options={(taxes ?? []).map((t) => ({ value: t.id, label: t.name || `${t.amount} %` }))} />
            </Field>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface OperationType {
  id: number;
  name: string;
  direction: "in" | "out";
  account: { id: number; code: string; name: string } | null;
  reference_required: boolean;
  is_transfer: boolean;
  loan_part: LoanPart;
  to_match: boolean;
  note: string | null;
  active: boolean;
}

type LoanPart = "none" | "disbursement" | "principal" | "interest";
/** Part d'emprunt : la contrepartie est le compte du financement désigné à la saisie ; le sens en découle. */
const PARTS: Record<LoanPart, { label: string; direction?: "in" | "out"; account?: string }> = {
  none: { label: "Aucune" },
  disbursement: { label: "Déblocage", direction: "in", account: "Compte de dette du financement (crédit)" },
  principal: { label: "Capital, hors échéancier", direction: "out", account: "Compte de dette du financement (débit)" },
  interest: { label: "Intérêts, hors échéancier", direction: "out", account: "Charges financières du financement" },
};

/** Types d'opération de trésorerie : sens et contrepartie de chaque mouvement de banque ou de caisse. */
function OperationTypes() {
  const { data, error, mutate } = useApi<OperationType[]>("/finance/treasury/operation-types?all=1");
  const ecriture = useAutorise(ECRITURE);
  const [editing, setEditing] = useState<OperationType | "new" | null>(null);
  const envoi = useEnvoi();
  async function defaults() {
    let texte = "";
    const ok = await envoi.run("usuels", async () => {
      const res = await apiSend<{ created: number }>("POST", "/finance/treasury/operation-types/defaults");
      texte = res.created ? `${pluriel(res.created, "type usuel ajouté", "types usuels ajoutés")}.` : "Les types usuels sont déjà présents.";
      await mutate();
    });
    if (ok) envoi.setMessage({ tone: "ok", text: texte });
  }
  return (
    <Card
      title="Types d'opération de trésorerie"
      padded={false}
      actions={
        ecriture ? (
          <>
            <Button loading={envoi.busy === "usuels"} disabled={envoi.busy !== null} onClick={defaults}>Proposer les types usuels</Button>
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Nouveau type
            </Button>
          </>
        ) : undefined
      }
    >
      <p className="px-5 pb-3 text-sm text-muted">
        À la saisie d&apos;une opération, le type fixe le sens et le compte de contrepartie. Un type client ou fournisseur laisse l&apos;opération à rapprocher de la facture ; un type « virement interne » ouvre le virement par le compte de passage 585. Un type à part d&apos;emprunt demande le financement concerné et prend son compte : déblocage au crédit du compte de dette, remboursement anticipé et intérêts hors échéancier ; les échéances de l&apos;échéancier se règlent depuis le relevé ou par « Régler ».
      </p>
      {envoi.message && (
        <div className="px-5 pb-3">
          <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>
        </div>
      )}
      {!data ? (
        <Etat error={error} onRetry={() => mutate()} />
      ) : (
        <DataTable
          rows={data}
          rowKey={(k) => k.id}
          onRowClick={ecriture ? (k) => setEditing(k) : undefined}
          empty="Aucun type d'opération : la saisie reste libre."
          columns={[
            { key: "name", label: "Type d'opération" },
            { key: "direction", label: "Sens", render: (k) => (k.is_transfer ? <Badge tone="accent">Virement</Badge> : k.direction === "in" ? <Badge tone="ok">Entrée</Badge> : <Badge tone="warn">Sortie</Badge>) },
            {
              key: "account",
              label: "Contrepartie",
              render: (k) =>
                k.loan_part !== "none" ? (
                  <span>{PARTS[k.loan_part].account} <Badge tone="accent">Financement</Badge></span>
                ) : k.account ? (
                  <span>{k.account.code} {k.account.name} {k.to_match && <Badge>À rapprocher</Badge>}</span>
                ) : (
                  "–"
                ),
            },
            { key: "reference_required", label: "Référence", render: (k) => (k.reference_required ? "Obligatoire" : "–") },
            { key: "active", label: "Statut", render: (k) => (k.active ? <Badge tone="ok">Actif</Badge> : <Badge>Archivé</Badge>) },
          ]}
        />
      )}
      {editing && ecriture && <OperationTypeForm kind={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </Card>
  );
}

function OperationTypeForm({ kind, onClose, onSaved }: { kind: OperationType | null; onClose: () => void; onSaved: () => void }) {
  const { data: accounts, error: erreurComptes, mutate: relireComptes } = useApi<Account[]>("/finance/accounts?limit=3000");
  const [form, setForm] = useState({
    name: kind?.name ?? "",
    direction: kind?.direction ?? "out",
    account_id: kind?.account ? String(kind.account.id) : "",
    reference_required: kind?.reference_required ?? false,
    is_transfer: kind?.is_transfer ?? false,
    loan_part: kind?.loan_part ?? ("none" as LoanPart),
    note: kind?.note ?? "",
  });
  const financement = form.loan_part !== "none";
  const envoi = useEnvoi();
  async function save(cle: string, patch?: { active: boolean }) {
    const body = patch ?? {
      ...form,
      loan_part: form.is_transfer ? "none" : form.loan_part,
      account_id: form.account_id && !form.is_transfer && !financement ? Number(form.account_id) : null,
    };
    const ok = await envoi.run(cle, () => (kind ? apiSend("PATCH", `/finance/treasury/operation-types/${kind.id}`, body) : apiSend("POST", "/finance/treasury/operation-types", body)), undefined, "Enregistrement impossible.");
    if (ok) onSaved();
  }
  return (
    <Modal
      open
      title={kind ? `Type « ${kind.name} »` : "Nouveau type d'opération"}
      onClose={onClose}
      footer={
        <>
          {kind && (
            <Button variant={kind.active ? "danger" : "secondary"} loading={envoi.busy === "statut"} disabled={envoi.busy !== null} onClick={() => save("statut", { active: !kind.active })}>
              {kind.active ? "Archiver" : "Réactiver"}
            </Button>
          )}
          <Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={envoi.busy !== null || !form.name.trim() || (!form.is_transfer && !financement && !form.account_id)} onClick={() => save("enregistrer")}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <ListesEnEchec erreur={erreurComptes} onRetry={() => relireComptes()} />
        <Field label="Type d'opération">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Frais bancaires, encaissement client…" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_transfer} onChange={(e) => setForm({ ...form, is_transfer: e.target.checked })} /> Virement interne (entre banques et caisses)
        </label>
        {!form.is_transfer && (
          <>
            <Field label="Part d'emprunt" hint="Déblocage reçu en banque, remboursement anticipé ou intérêts hors échéancier : l'opération désigne le financement et prend son compte.">
              <Select
                value={form.loan_part}
                onChange={(e) => {
                  const part = e.target.value as LoanPart;
                  setForm({ ...form, loan_part: part, direction: PARTS[part].direction ?? form.direction });
                }}
                options={(Object.keys(PARTS) as LoanPart[]).map((p) => ({ value: p, label: PARTS[p].label }))}
              />
            </Field>
            <Field label="Sens">
              <Select value={form.direction} disabled={financement} onChange={(e) => setForm({ ...form, direction: e.target.value as "in" | "out" })} options={[{ value: "out", label: "Sortie" }, { value: "in", label: "Entrée" }]} />
            </Field>
            {financement ? (
              <Notice tone="accent">{PARTS[form.loan_part].account} : choisi à la saisie de l&apos;opération, avec le financement.</Notice>
            ) : (
              <Field label="Compte de contrepartie" hint="Client (41) ou fournisseur (40) : l'opération reste à rapprocher de la facture.">
                <Select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} placeholder="Choisir…" options={(accounts ?? []).filter((a) => !/^5[2-7]/.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
              </Field>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.reference_required} onChange={(e) => setForm({ ...form, reference_required: e.target.checked })} /> Référence obligatoire (facture, contrat, chèque)
        </label>
        <Field label="Commentaire">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

interface PaymentMode { id: number; name: string; sequence: number; active: boolean; company: Ref | null }

/** Liste simple des modes de paiement, proposée aux opérations de trésorerie et aux règlements. */
function PaymentModes() {
  const { data, error, mutate } = useApi<PaymentMode[]>("/finance/payment-modes?all=1");
  const ecriture = useAutorise(ECRITURE);
  const [name, setName] = useState("");
  const envoi = useEnvoi();
  const act = (cle: string, fn: () => Promise<unknown>, ok: string) =>
    envoi.run(cle, async () => {
      await fn();
      await mutate();
    }, ok);
  async function ajouter() {
    const nom = name.trim();
    if (await act("ajout", () => apiSend("POST", "/finance/payment-modes", { name: nom }), `Mode « ${nom} » ajouté.`)) setName("");
  }
  return (
    <Card title="Modes de paiement" padded={false}>
      {!data ? (
        <Etat error={error} onRetry={() => mutate()} />
      ) : (
        <DataTable
          rows={data}
          rowKey={(m) => m.id}
          columns={[
            { key: "name", label: "Mode" },
            { key: "company", label: "Société", render: (m) => m.company?.name ?? "Les deux sociétés" },
            {
              key: "active",
              label: "Proposé",
              render: (m) =>
                ecriture ? (
                  <input
                    type="checkbox"
                    aria-label={`Mode ${m.name} proposé`}
                    checked={m.active}
                    disabled={envoi.busy !== null}
                    onChange={(e) => {
                      const actif = e.target.checked;
                      void act(`mode-${m.id}`, () => apiSend("PATCH", `/finance/payment-modes/${m.id}`, { active: actif }), actif ? "Mode réactivé." : "Mode archivé.");
                    }}
                  />
                ) : m.active ? (
                  <Badge tone="ok">Proposé</Badge>
                ) : (
                  <Badge>Archivé</Badge>
                ),
            },
          ]}
        />
      )}
      {(ecriture || envoi.message) && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          {envoi.message && (
            <div className="w-full">
              <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>
            </div>
          )}
          {ecriture && (
            <>
              <Field label="Nouveau mode">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Orange Money" />
              </Field>
              <Button variant="primary" loading={envoi.busy === "ajout"} disabled={!name.trim() || envoi.busy !== null} onClick={ajouter}>
                Ajouter
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

const DOMAIN_LABELS: Record<string, string> = { invoice: "Factures", bill: "Pièces d'achat", general: "Opérations diverses" };

function Requirements() {
  const { data, error, mutate } = useApi<Requirement[]>("/finance/analytic-requirements");
  const { data: axes, error: erreurAxes, mutate: relireAxes } = useAxes();
  const ecriture = useAutorise(ECRITURE);
  const [form, setForm] = useState({ plan: "activite", prefix: "" });
  const envoi = useEnvoi();
  const act = (cle: string, fn: () => Promise<unknown>, ok: string) =>
    envoi.run(cle, async () => {
      await fn();
      await mutate();
    }, ok);
  async function retirer(r: Requirement) {
    const oui = await demanderConfirmation(`Retirer l'obligation de l'axe ${r.plan} sur les comptes ${r.prefix} ? Les pièces de ces comptes se valideront de nouveau sans répartition sur cet axe.`, { action: "Retirer l'obligation", danger: true });
    if (oui) await act(`retirer-${r.id}`, () => apiSend("DELETE", `/finance/analytic-requirements/${r.id}`), "Obligation retirée.");
  }
  async function ajouter() {
    if (await act("ajout", () => apiSend("POST", "/finance/analytic-requirements", { ...form, prefix: form.prefix.trim() }), "Axe rendu obligatoire.")) setForm({ ...form, prefix: "" });
  }
  return (
    <Card title="Axes obligatoires" padded={false}>
      <p className="px-5 pb-3 text-sm text-muted">Une pièce qui mouvemente un compte du préfixe ne se valide pas sans répartition complète (100 %) sur l&apos;axe.</p>
      {!data ? (
        <Etat error={error} onRetry={() => mutate()} />
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
                !r.company ? (
                  <Badge tone="accent">Les deux sociétés</Badge>
                ) : ecriture ? (
                  <Button variant="ghost" size="sm" loading={envoi.busy === `retirer-${r.id}`} disabled={envoi.busy !== null} aria-label={`Retirer l'obligation ${r.plan}, comptes ${r.prefix}`} onClick={() => retirer(r)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {(ecriture || envoi.message) && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          {envoi.message && (
            <div className="w-full">
              <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>
            </div>
          )}
          {ecriture && (
            <>
              {erreurAxes && (
                <div className="w-full">
                  <ErrorBox error={erreurAxes} titre="Axes analytiques non chargés : le choix de l'axe est vide." onRetry={() => relireAxes()} />
                </div>
              )}
              <Field label="Axe">
                <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} options={(axes ?? []).map((a) => ({ value: a.key, label: a.label }))} />
              </Field>
              <Field label="Préfixes de comptes">
                <Input className="font-mono" value={form.prefix} placeholder="60, 61, 62" onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
              </Field>
              <Button variant="primary" loading={envoi.busy === "ajout"} disabled={!form.prefix.trim() || envoi.busy !== null} onClick={ajouter}>
                Rendre obligatoire
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
