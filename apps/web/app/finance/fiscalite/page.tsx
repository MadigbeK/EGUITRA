"use client";

import { useState } from "react";
import { Download, FileCheck2, Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Kpi, Modal, Notice, PageHeader, Select, Tabs, demanderConfirmation } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { anneeEnCours, aujourdhui, moisEnCours } from "@/lib/jour";
import type { Account } from "@/lib/finance-types";
import { AIDE_NOMBRE, INSECABLE, MONTHS_FR, fmtDate, fmtDec, fmtGNF, fmtInt, fmtMonth, fmtShort, lireNombre, nombreIllisible } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes d'écriture de la fiscalité (addons/eguitra_finance/controllers/fiscal.py, FIN_WRITE) :
// préparation, dépôt et paiement des déclarations, accusés, retenues et tiers soumis. La direction lit.
const ECRITURE: Profile[] = ["admin", "finance"];

interface Vat {
  period: { from: string; to: string };
  taxes: Array<{ tax_id: number; name: string; use: string; rate: number; amount: number }>;
  base_sales: number;
  base_purchases: number;
  vat_collected: number;
  vat_deductible: number;
  vat_due: number;
  vat_credit: number;
  note: string;
}
interface Withholding {
  by_nature: Array<{ use: string; nature: string; rate: number; base: number; amount: number; partners: number }>;
  by_partner: Array<{ tax_id: number; tax: string; nature: string; use: string; rate: number; partner_id: number | null; partner: string; vat_number: string | null; base: number; amount: number }>;
  base_total: number;
  total_operated: number;
  base_suffered: number;
  total_suffered: number;
  missing_vat_numbers: string[];
  note: string;
}
interface WithholdingTax { id: number; name: string; rate: number; use: "purchase" | "sale"; use_label: string; nature: string | null; account: { id: number; code: string; name: string } | null; active: boolean }
interface WithholdingPartner { id: number; name: string; vat: string | null; taxes: WithholdingTax[] }
interface TaxReturn {
  id: number;
  period: string;
  kind: "vat" | "withholding";
  state: "prepared" | "filed" | "paid";
  amount_base: number;
  amount_collected: number;
  amount_deductible: number;
  amount_due: number;
  amount_credit: number;
  prepared_by: string | null;
  prepared_at: string | null;
  filed_date: string | null;
  filed_reference: string | null;
  paid_date: string | null;
  paid_reference: string | null;
  settlement_move: { id: number; name: string } | null;
  payment_move: { id: number; name: string } | null;
  attachment: { id: number; name: string } | null;
}

type Tab = "tva" | "retenues" | "historique";
const USE = { purchase: "Opérée", sale: "Subie" } as const;
const RETURN_STATE = { prepared: ["Préparée", "neutral"], filed: ["Déposée", "accent"], paid: ["Payée", "ok"] } as const;
const KIND = { vat: "TVA", withholding: "Retenues à la source" } as const;
/** Taux d'une taxe : « 18 % », « 2,5 % » (jusqu'à deux décimales, espace insécable). */
const taux = (r: number) => `${fmtDec(r)}${INSECABLE}%`;

export default function TaxPage() {
  const [tab, setTab] = useState<Tab>("tva");
  const [year, setYear] = useState(anneeEnCours);
  const [month, setMonth] = useState(moisEnCours);
  const period = `year=${year}&month=${month}`;
  return (
    <div>
      <PageHeader
        title="Fiscalité"
        subtitle="TVA et retenues à la source préparées à partir des écritures validées, exports avec annexes, historique des déclarations."
        actions={
          <>
            {tab !== "historique" && (
              <Select aria-label="Mois" value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={MONTHS_FR.map((m, i) => ({ value: i + 1, label: m }))} />
            )}
            <Select aria-label="Exercice" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map((y) => ({ value: y, label: String(y) }))} />
          </>
        }
      />
      <Tabs
        tabs={[
          { key: "tva", label: "TVA" },
          { key: "retenues", label: "Retenues à la source" },
          { key: "historique", label: "Historique" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "tva" && <VatTab period={period} year={year} month={month} onPrepared={() => setTab("historique")} />}
      {tab === "retenues" && <WithholdingTab period={period} year={year} month={month} onPrepared={() => setTab("historique")} />}
      {tab === "historique" && <History year={year} />}
    </div>
  );
}

function monthIso(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function PrepareButton({ kind, year, month, onPrepared }: { kind: "vat" | "withholding"; year: number; month: number; onPrepared: () => void }) {
  const ecriture = useAutorise(ECRITURE);
  const envoi = useEnvoi();
  if (!ecriture) return null;
  async function prepare() {
    const ok = await envoi.run("preparer", () => apiSend("POST", "/finance/fiscal/returns", { kind, period: monthIso(year, month) }), undefined, "Préparation impossible.");
    if (ok) onPrepared();
  }
  return (
    <div className="flex items-center gap-2">
      {envoi.message && <span className="text-xs text-danger">{envoi.message.text}</span>}
      <Button variant="primary" loading={envoi.busy === "preparer"} disabled={!!envoi.busy} onClick={prepare}>
        <FileCheck2 className="h-4 w-4" /> Préparer la déclaration
      </Button>
    </div>
  );
}

function VatTab({ period, year, month, onPrepared }: { period: string; year: number; month: number; onPrepared: () => void }) {
  const { data, error, mutate } = useApi<Vat>(`/finance/fiscal/vat?${period}`);
  const envoi = useEnvoi();
  const name = `tva_${year}_${String(month).padStart(2, "0")}`;
  const exporter = (cle: string, suffixe: string, fichier: string) => envoi.telecharger(cle, `/finance/fiscal/vat/export?${period}${suffixe}`, fichier);
  return (
    <div className="space-y-6">
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul de la TVA du mois…">
        {(d) => (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="TVA collectée" value={fmtShort(d.vat_collected)} hint={`Base ventes ${fmtGNF(d.base_sales)}`} />
              <Kpi label="TVA déductible" value={fmtShort(d.vat_deductible)} hint={`Base achats ${fmtGNF(d.base_purchases)}`} />
              <Kpi label="TVA à payer" value={fmtShort(d.vat_due)} tone={d.vat_due > 0 ? "warn" : "neutral"} />
              <Kpi label="Crédit de TVA" value={fmtShort(d.vat_credit)} tone={d.vat_credit > 0 ? "ok" : "neutral"} />
            </div>
            <Card
              title="Détail par taxe"
              padded={false}
              actions={
                <div className="no-print flex flex-wrap gap-2">
                  <Button size="sm" loading={envoi.busy === "xlsx"} disabled={!!envoi.busy} onClick={() => exporter("xlsx", "&format=xlsx", `${name}.xlsx`)}>
                    <Download className="h-3.5 w-3.5" /> XLSX avec annexe
                  </Button>
                  <Button size="sm" loading={envoi.busy === "declaration"} disabled={!!envoi.busy} onClick={() => exporter("declaration", "&format=csv&part=declaration", `${name}_declaration.csv`)}>
                    <Download className="h-3.5 w-3.5" /> CSV déclaration
                  </Button>
                  <Button size="sm" loading={envoi.busy === "annexe"} disabled={!!envoi.busy} onClick={() => exporter("annexe", "&format=csv", `${name}_annexe.csv`)}>
                    <Download className="h-3.5 w-3.5" /> CSV annexe
                  </Button>
                </div>
              }
            >
              <DataTable
                rows={d.taxes}
                rowKey={(t) => t.tax_id}
                empty="Aucune TVA comptabilisée sur la période."
                columns={[
                  { key: "name", label: "Taxe" },
                  { key: "use", label: "Nature", render: (t) => (t.use === "sale" ? "Collectée" : "Déductible") },
                  { key: "rate", label: "Taux", align: "right", render: (t) => taux(t.rate) },
                  { key: "amount", label: "Montant", align: "right", render: (t) => fmtGNF(t.amount) },
                ]}
              />
            </Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Notice tone="warn">{d.note} Les retenues à la source n&apos;y figurent jamais : elles ont leur propre déclaration.</Notice>
              <PrepareButton kind="vat" year={year} month={month} onPrepared={onPrepared} />
            </div>
          </>
        )}
      </Etat>
    </div>
  );
}

function WithholdingTab({ period, year, month, onPrepared }: { period: string; year: number; month: number; onPrepared: () => void }) {
  const { data, error, mutate } = useApi<Withholding>(`/finance/fiscal/withholding?${period}`);
  const envoi = useEnvoi();
  const name = `retenues_${year}_${String(month).padStart(2, "0")}`;
  const exporter = (cle: string, suffixe: string, fichier: string) => envoi.telecharger(cle, `/finance/fiscal/withholding/export?${period}${suffixe}`, fichier);
  return (
    <div className="space-y-6">
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul des retenues du mois…">
        {(d) => (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Retenues opérées à reverser" value={fmtShort(d.total_operated)} tone={d.total_operated > 0 ? "warn" : "neutral"} hint={`Base ${fmtGNF(d.base_total)}`} />
              <Kpi label="Retenues subies (créance sur l'État)" value={fmtShort(d.total_suffered)} hint={`Base ${fmtGNF(d.base_suffered)}`} />
              <Kpi label="Tiers concernés" value={fmtInt(new Set(d.by_partner.map((r) => r.partner_id)).size)} />
              <Kpi label="Tiers sans NIF" value={fmtInt(d.missing_vat_numbers.length)} tone={d.missing_vat_numbers.length ? "danger" : "ok"} />
            </div>
            {d.missing_vat_numbers.length > 0 && (
              <Notice tone="danger">NIF à compléter dans la fiche tiers avant le dépôt : {d.missing_vat_numbers.join(", ")}.</Notice>
            )}
            <Card
              title="Par nature"
              padded={false}
              actions={
                <div className="no-print flex flex-wrap gap-2">
                  <Button size="sm" loading={envoi.busy === "xlsx"} disabled={!!envoi.busy} onClick={() => exporter("xlsx", "&format=xlsx", `${name}.xlsx`)}>
                    <Download className="h-3.5 w-3.5" /> XLSX avec annexe
                  </Button>
                  <Button size="sm" loading={envoi.busy === "nature"} disabled={!!envoi.busy} onClick={() => exporter("nature", "&format=csv&part=declaration", `${name}_nature.csv`)}>
                    <Download className="h-3.5 w-3.5" /> CSV par nature
                  </Button>
                  <Button size="sm" loading={envoi.busy === "tiers"} disabled={!!envoi.busy} onClick={() => exporter("tiers", "&format=csv&part=tiers", `${name}_tiers.csv`)}>
                    <Download className="h-3.5 w-3.5" /> CSV par tiers
                  </Button>
                  <Button size="sm" loading={envoi.busy === "annexe"} disabled={!!envoi.busy} onClick={() => exporter("annexe", "&format=csv", `${name}_annexe.csv`)}>
                    <Download className="h-3.5 w-3.5" /> CSV annexe
                  </Button>
                </div>
              }
            >
              <DataTable
                rows={d.by_nature}
                rowKey={(n) => `${n.use}-${n.nature}-${n.rate}`}
                empty="Aucune retenue comptabilisée sur la période."
                columns={[
                  { key: "use", label: "Sens", render: (n) => USE[n.use as keyof typeof USE] ?? n.use },
                  { key: "nature", label: "Nature" },
                  { key: "rate", label: "Taux", align: "right", render: (n) => taux(n.rate) },
                  { key: "partners", label: "Tiers", align: "right", render: (n) => fmtInt(n.partners) },
                  { key: "base", label: "Base", align: "right", render: (n) => fmtGNF(n.base) },
                  { key: "amount", label: "Retenue", align: "right", render: (n) => fmtGNF(n.amount) },
                ]}
              />
            </Card>
            <Card title="Par tiers" padded={false}>
              <DataTable
                dense
                rows={d.by_partner}
                rowKey={(r) => `${r.tax_id}-${r.partner_id}`}
                empty="Aucune retenue."
                columns={[
                  { key: "partner", label: "Tiers" },
                  { key: "vat_number", label: "NIF", render: (r) => r.vat_number ?? <span className="text-danger">à compléter</span> },
                  { key: "nature", label: "Nature" },
                  { key: "rate", label: "Taux", align: "right", render: (r) => taux(r.rate) },
                  { key: "base", label: "Base", align: "right", render: (r) => fmtGNF(r.base) },
                  { key: "amount", label: "Retenue", align: "right", render: (r) => fmtGNF(r.amount) },
                ]}
              />
            </Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Notice tone="warn">{d.note}</Notice>
              <PrepareButton kind="withholding" year={year} month={month} onPrepared={onPrepared} />
            </div>
          </>
        )}
      </Etat>
      <WithholdingSettings />
    </div>
  );
}

/** Retenues configurées (taux et natures arrêtés avec l'expert-comptable) et tiers qui y sont soumis. */
function WithholdingSettings() {
  const ecriture = useAutorise(ECRITURE);
  const { data: taxes, error: erreurRetenues, mutate } = useApi<WithholdingTax[]>("/finance/fiscal/withholding-taxes");
  const { data: partners, error: erreurTiers, mutate: mutatePartners } = useApi<WithholdingPartner[]>("/finance/fiscal/withholding-partners");
  const [modal, setModal] = useState<null | "tax" | { partner: WithholdingPartner | null }>(null);
  const envoi = useEnvoi();
  async function toggle(tax: WithholdingTax) {
    await envoi.run(`retenue-${tax.id}`, async () => {
      await apiSend("PATCH", `/finance/fiscal/withholding-taxes/${tax.id}`, { active: !tax.active });
      await mutate();
    }, tax.active ? `Retenue « ${tax.name} » archivée.` : `Retenue « ${tax.name} » réactivée.`, "Modification impossible.");
  }
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card title="Retenues configurées" padded={false} actions={ecriture ? <Button size="sm" onClick={() => setModal("tax")}><Plus className="h-3.5 w-3.5" /> Nouvelle retenue</Button> : undefined}>
        {envoi.message && <div className="p-3"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
        <Etat data={taxes} error={erreurRetenues} onRetry={() => mutate()} label="Chargement des retenues…">
          {(rows) => (
            <DataTable
              dense
              rows={rows}
              rowKey={(t) => t.id}
              empty="Aucune retenue : les natures et les taux s'arrêtent avec l'expert-comptable."
              columns={[
                { key: "name", label: "Retenue" },
                { key: "use", label: "Sens", render: (t) => USE[t.use] },
                { key: "rate", label: "Taux", align: "right", render: (t) => taux(t.rate) },
                { key: "account", label: "Compte", render: (t) => t.account?.code ?? "–" },
                { key: "nature", label: "Nature", render: (t) => t.nature ?? "–" },
                {
                  key: "active",
                  label: "",
                  render: (t) => (ecriture ? (
                    <Button size="sm" loading={envoi.busy === `retenue-${t.id}`} disabled={!!envoi.busy} onClick={() => toggle(t)}>{t.active ? "Archiver" : "Réactiver"}</Button>
                  ) : t.active ? null : <Badge>Archivée</Badge>),
                },
              ]}
            />
          )}
        </Etat>
      </Card>
      <Card title="Tiers soumis à retenue" padded={false} actions={ecriture ? <Button size="sm" onClick={() => setModal({ partner: null })}><Plus className="h-3.5 w-3.5" /> Ajouter un tiers</Button> : undefined}>
        <Etat data={partners} error={erreurTiers} onRetry={() => mutatePartners()} label="Chargement des tiers…">
          {(rows) => (
            <DataTable
              dense
              rows={rows}
              rowKey={(p) => p.id}
              onRowClick={ecriture ? (p) => setModal({ partner: p }) : undefined}
              empty="Aucun tiers : les retenues par défaut s'appliquent d'office aux factures du tiers, et se modifient ligne par ligne."
              columns={[
                { key: "name", label: "Tiers" },
                { key: "vat", label: "NIF", render: (p) => p.vat ?? "–" },
                { key: "taxes", label: "Retenues par défaut", render: (p) => p.taxes.map((t) => `${t.name} (${taux(t.rate)})`).join(", ") },
              ]}
            />
          )}
        </Etat>
      </Card>
      {modal === "tax" && <WithholdingForm onClose={() => setModal(null)} onDone={() => { setModal(null); void mutate(); }} />}
      {modal && modal !== "tax" && (
        <PartnerWithholdings partner={modal.partner} taxes={(taxes ?? []).filter((t) => t.active)} onClose={() => setModal(null)} onDone={() => { setModal(null); void mutatePartners(); }} />
      )}
    </div>
  );
}

function WithholdingForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: accounts } = useApi<Account[]>("/finance/accounts?prefix=44&limit=500");
  const [f, setF] = useState({ name: "", rate: "", use: "purchase", account_id: "", nature: "" });
  const envoi = useEnvoi();
  const options = (accounts ?? []).filter((a) => (f.use === "purchase" ? a.code.startsWith("447") : true)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const rate = lireNombre(f.rate);
  const erreurTaux = nombreIllisible(f.rate) ? AIDE_NOMBRE : rate !== null && (rate <= 0 || rate >= 100) ? "Taux compris entre 0 et 100 %." : undefined;
  const pret = Boolean(f.name.trim() && f.account_id) && rate !== null && !erreurTaux;
  async function submit() {
    const ok = await envoi.run("creer", () => apiSend("POST", "/finance/fiscal/withholding-taxes", { ...f, rate, account_id: Number(f.account_id) }), undefined, "Enregistrement impossible.");
    if (ok) onDone();
  }
  return (
    <Modal open title="Nouvelle retenue à la source" onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "creer"} onClick={submit} disabled={!pret || !!envoi.busy}>Créer la retenue</Button>}>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <Notice tone="accent">Taux et natures arrêtés avec l&apos;expert-comptable. La retenue devient une taxe à taux négatif, rangée hors de la TVA.</Notice>
        <Field label="Libellé"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taux (%)" error={erreurTaux}><Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
          <Field label="Sens">
            <Select value={f.use} onChange={(e) => setF({ ...f, use: e.target.value, account_id: "" })} options={[{ value: "purchase", label: "Opérée sur les fournisseurs" }, { value: "sale", label: "Subie sur les ventes" }]} />
          </Field>
        </div>
        <Field label={f.use === "purchase" ? "Compte de l'État (447x)" : "Compte de l'État (44x)"}>
          <Select value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })} placeholder="Choisir…" options={options} />
        </Field>
        <Field label="Nature" hint="Rubrique de la déclaration, telle qu'arrêtée avec l'expert-comptable."><Input value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function PartnerWithholdings({ partner, taxes, onClose, onDone }: { partner: WithholdingPartner | null; taxes: WithholdingTax[]; onClose: () => void; onDone: () => void }) {
  const [who, setWho] = useState<{ id: number; name: string } | null>(partner ? { id: partner.id, name: partner.name } : null);
  const [chosen, setChosen] = useState<number[]>(partner?.taxes.map((t) => t.id) ?? []);
  const envoi = useEnvoi();
  async function submit() {
    if (!who) return;
    const ok = await envoi.run("enregistrer", () => apiSend("PUT", `/finance/fiscal/withholding-partners/${who.id}`, { tax_ids: chosen }), undefined, "Enregistrement impossible.");
    if (ok) onDone();
  }
  return (
    <Modal open title="Retenues par défaut du tiers" onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "enregistrer"} onClick={submit} disabled={!who || !!envoi.busy}>Enregistrer</Button>}>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <Field label="Tiers">{partner ? <div className="text-sm font-semibold">{partner.name}</div> : <PartnerPicker value={who} onChange={setWho} kind="supplier" />}</Field>
        <Field label="Retenues appliquées d'office à ses factures" hint="Modifiables ligne par ligne à la saisie. Aucune case cochée : le tiers n'est plus soumis.">
          <div className="space-y-1">
            {taxes.length === 0 && <span className="text-sm text-muted">Créez d&apos;abord une retenue.</span>}
            {taxes.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.includes(t.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, t.id] : chosen.filter((id) => id !== t.id))} />
                {t.name} ({taux(t.rate)}, {USE[t.use].toLowerCase()})
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function History({ year }: { year: number }) {
  const { data, error, mutate } = useApi<TaxReturn[]>(`/finance/fiscal/returns?year=${year}`);
  const ecriture = useAutorise(ECRITURE);
  const [action, setAction] = useState<null | { record: TaxReturn; kind: "file" | "pay" }>(null);
  const envoi = useEnvoi();
  async function attach(record: TaxReturn, file: File) {
    const form = new FormData();
    form.append("file", file);
    await envoi.run(`accuse-${record.id}`, async () => {
      await apiUpload(`/finance/fiscal/returns/${record.id}/attachment`, form);
      await mutate();
    }, "Accusé joint à la déclaration.", "Envoi impossible.");
  }
  return (
    <div className="space-y-4">
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des déclarations…">
        {(rows) => (
          <Card padded={false}>
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty="Aucune déclaration préparée pour cet exercice : préparez-la depuis l'onglet TVA ou Retenues."
              columns={[
                { key: "period", label: "Mois", render: (r) => fmtMonth(r.period.slice(0, 7)) },
                { key: "kind", label: "Nature", render: (r) => KIND[r.kind] },
                { key: "state", label: "État", render: (r) => <Badge tone={RETURN_STATE[r.state][1]}>{RETURN_STATE[r.state][0]}</Badge> },
                { key: "amount_base", label: "Base", align: "right", render: (r) => fmtGNF(r.amount_base) },
                { key: "amount_due", label: "À payer", align: "right", render: (r) => fmtGNF(r.amount_due) },
                { key: "amount_credit", label: "Crédit", align: "right", render: (r) => (r.amount_credit ? fmtGNF(r.amount_credit) : "–") },
                { key: "filed", label: "Dépôt", render: (r) => (r.filed_date ? `${fmtDate(r.filed_date)}${r.filed_reference ? `, ${r.filed_reference}` : ""}` : "–") },
                { key: "paid", label: "Paiement", render: (r) => (r.paid_date ? `${fmtDate(r.paid_date)}${r.paid_reference ? `, ${r.paid_reference}` : ""}` : "–") },
                { key: "settlement", label: "Liquidation", render: (r) => r.settlement_move?.name ?? "–" },
                {
                  key: "actions",
                  label: "",
                  render: (r) => (
                    <div className="flex flex-wrap justify-end gap-1">
                      {r.attachment ? (
                        <Button size="sm" loading={envoi.busy === `telecharger-${r.id}`} disabled={!!envoi.busy} onClick={() => envoi.telecharger(`telecharger-${r.id}`, `/finance/fiscal/returns/${r.id}/attachment`, r.attachment?.name ?? "accuse")}>Accusé</Button>
                      ) : ecriture ? (
                        envoi.busy === `accuse-${r.id}` ? <Button size="sm" loading>Envoi de l&apos;accusé</Button> : <FileButton small label="Joindre l'accusé" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(file) => void attach(r, file)} />
                      ) : null}
                      {ecriture && r.state === "prepared" && <Button size="sm" disabled={!!envoi.busy} onClick={() => setAction({ record: r, kind: "file" })}>Déposée</Button>}
                      {ecriture && r.state === "filed" && <Button size="sm" disabled={!!envoi.busy} onClick={() => setAction({ record: r, kind: "pay" })}>Payée</Button>}
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </Etat>
      {action && <ReturnAction record={action.record} kind={action.kind} onClose={() => setAction(null)} onDone={() => { setAction(null); void mutate(); }} />}
    </div>
  );
}

function ReturnAction({ record, kind, onClose, onDone }: { record: TaxReturn; kind: "file" | "pay"; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: aujourdhui(), reference: "" });
  const envoi = useEnvoi();
  const libelle = `${KIND[record.kind]} de ${fmtMonth(record.period.slice(0, 7))}`;
  async function submit() {
    const question = kind === "file"
      ? `Marquer la déclaration ${libelle} déposée le ${fmtDate(f.date)} ? Ses montants sont alors figés : elle ne se recalcule plus.`
      : `Marquer la déclaration ${libelle} payée le ${fmtDate(f.date)} ? Ce constat est définitif ; le règlement passe par la trésorerie.`;
    if (!(await demanderConfirmation(question, { action: kind === "file" ? "Marquer déposée" : "Marquer payée", danger: true }))) return;
    const ok = await envoi.run("enregistrer", () => apiSend("POST", `/finance/fiscal/returns/${record.id}/${kind}`, f), undefined, "Enregistrement impossible.");
    if (ok) onDone();
  }
  const title = `${libelle} : ${kind === "file" ? "dépôt" : "paiement"}`;
  return (
    <Modal open title={title} onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "enregistrer"} onClick={submit} disabled={!f.date || (kind === "file" && !f.reference.trim()) || !!envoi.busy}>Enregistrer</Button>}>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        {kind === "pay" && <Notice tone="accent">Le règlement lui-même passe par la trésorerie (relevé bancaire ou caisse) : cette étape le constate, sans nouvelle sortie de fonds.</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === "file" ? "Déposée le" : "Payée le"}><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label={kind === "file" ? "Référence de dépôt" : "Référence du paiement"}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
