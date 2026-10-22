"use client";

import { useState } from "react";
import { Download, FileCheck2, Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, FileButton, Input, Kpi, Loading, Modal, Notice, PageHeader, Select, Tabs } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import type { Account } from "@/lib/finance-types";
import { MONTHS_FR, fmtDate, fmtGNF, fmtMonth, fmtShort } from "@/lib/format";

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

export default function TaxPage() {
  const now = new Date();
  const [tab, setTab] = useState<Tab>("tva");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const period = `year=${year}&month=${month}`;
  return (
    <div>
      <PageHeader
        title="Fiscalité"
        subtitle="TVA et retenues à la source préparées à partir des écritures validées, exports avec annexes, historique des déclarations."
        actions={
          <>
            {tab !== "historique" && (
              <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={MONTHS_FR.map((m, i) => ({ value: i + 1, label: m }))} />
            )}
            <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map((y) => ({ value: y, label: String(y) }))} />
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/finance/fiscal/returns", { kind, period: monthIso(year, month) });
      onPrepared();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Préparation impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <Button variant="primary" loading={busy} onClick={prepare}>
        <FileCheck2 className="h-4 w-4" /> Préparer la déclaration
      </Button>
    </div>
  );
}

function VatTab({ period, year, month, onPrepared }: { period: string; year: number; month: number; onPrepared: () => void }) {
  const { data, error } = useApi<Vat>(`/finance/fiscal/vat?${period}`);
  const name = `tva_${year}_${String(month).padStart(2, "0")}`;
  return (
    <div className="space-y-6">
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="TVA collectée" value={fmtShort(data.vat_collected)} hint={`Base ventes ${fmtGNF(data.base_sales)}`} />
            <Kpi label="TVA déductible" value={fmtShort(data.vat_deductible)} hint={`Base achats ${fmtGNF(data.base_purchases)}`} />
            <Kpi label="TVA à payer" value={fmtShort(data.vat_due)} tone={data.vat_due > 0 ? "warn" : "neutral"} />
            <Kpi label="Crédit de TVA" value={fmtShort(data.vat_credit)} tone={data.vat_credit > 0 ? "ok" : "neutral"} />
          </div>
          <Card
            title="Détail par taxe"
            padded={false}
            actions={
              <div className="no-print flex flex-wrap gap-2">
                <Button size="sm" onClick={() => apiDownload(`/finance/fiscal/vat/export?${period}&format=xlsx`, `${name}.xlsx`)}>
                  <Download className="h-3.5 w-3.5" /> XLSX avec annexe
                </Button>
                <Button size="sm" onClick={() => apiDownload(`/finance/fiscal/vat/export?${period}&format=csv&part=declaration`, `${name}_declaration.csv`)}>
                  <Download className="h-3.5 w-3.5" /> CSV déclaration
                </Button>
                <Button size="sm" onClick={() => apiDownload(`/finance/fiscal/vat/export?${period}&format=csv`, `${name}_annexe.csv`)}>
                  <Download className="h-3.5 w-3.5" /> CSV annexe
                </Button>
              </div>
            }
          >
            <DataTable
              rows={data.taxes}
              rowKey={(t) => t.tax_id}
              empty="Aucune TVA comptabilisée sur la période."
              columns={[
                { key: "name", label: "Taxe" },
                { key: "use", label: "Nature", render: (t) => (t.use === "sale" ? "Collectée" : "Déductible") },
                { key: "rate", label: "Taux", align: "right", render: (t) => `${t.rate} %` },
                { key: "amount", label: "Montant", align: "right", render: (t) => fmtGNF(t.amount) },
              ]}
            />
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Notice tone="warn">{data.note} Les retenues à la source n&apos;y figurent jamais : elles ont leur propre déclaration.</Notice>
            <PrepareButton kind="vat" year={year} month={month} onPrepared={onPrepared} />
          </div>
        </>
      )}
    </div>
  );
}

function WithholdingTab({ period, year, month, onPrepared }: { period: string; year: number; month: number; onPrepared: () => void }) {
  const { data, error } = useApi<Withholding>(`/finance/fiscal/withholding?${period}`);
  const name = `retenues_${year}_${String(month).padStart(2, "0")}`;
  return (
    <div className="space-y-6">
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Retenues opérées à reverser" value={fmtShort(data.total_operated)} tone={data.total_operated > 0 ? "warn" : "neutral"} hint={`Base ${fmtGNF(data.base_total)}`} />
            <Kpi label="Retenues subies (créance sur l'État)" value={fmtShort(data.total_suffered)} hint={`Base ${fmtGNF(data.base_suffered)}`} />
            <Kpi label="Tiers concernés" value={String(new Set(data.by_partner.map((r) => r.partner_id)).size)} />
            <Kpi label="Tiers sans NIF" value={String(data.missing_vat_numbers.length)} tone={data.missing_vat_numbers.length ? "danger" : "ok"} />
          </div>
          {data.missing_vat_numbers.length > 0 && (
            <Notice tone="danger">NIF à compléter dans la fiche tiers avant le dépôt : {data.missing_vat_numbers.join(", ")}.</Notice>
          )}
          <Card
            title="Par nature"
            padded={false}
            actions={
              <div className="no-print flex flex-wrap gap-2">
                <Button size="sm" onClick={() => apiDownload(`/finance/fiscal/withholding/export?${period}&format=xlsx`, `${name}.xlsx`)}>
                  <Download className="h-3.5 w-3.5" /> XLSX avec annexe
                </Button>
                <Button size="sm" onClick={() => apiDownload(`/finance/fiscal/withholding/export?${period}&format=csv&part=declaration`, `${name}_nature.csv`)}>
                  <Download className="h-3.5 w-3.5" /> CSV par nature
                </Button>
                <Button size="sm" onClick={() => apiDownload(`/finance/fiscal/withholding/export?${period}&format=csv&part=tiers`, `${name}_tiers.csv`)}>
                  <Download className="h-3.5 w-3.5" /> CSV par tiers
                </Button>
                <Button size="sm" onClick={() => apiDownload(`/finance/fiscal/withholding/export?${period}&format=csv`, `${name}_annexe.csv`)}>
                  <Download className="h-3.5 w-3.5" /> CSV annexe
                </Button>
              </div>
            }
          >
            <DataTable
              rows={data.by_nature}
              rowKey={(n) => `${n.use}-${n.nature}-${n.rate}`}
              empty="Aucune retenue comptabilisée sur la période."
              columns={[
                { key: "use", label: "Sens", render: (n) => USE[n.use as keyof typeof USE] ?? n.use },
                { key: "nature", label: "Nature" },
                { key: "rate", label: "Taux", align: "right", render: (n) => `${n.rate} %` },
                { key: "partners", label: "Tiers", align: "right" },
                { key: "base", label: "Base", align: "right", render: (n) => fmtGNF(n.base) },
                { key: "amount", label: "Retenue", align: "right", render: (n) => fmtGNF(n.amount) },
              ]}
            />
          </Card>
          <Card title="Par tiers" padded={false}>
            <DataTable
              dense
              rows={data.by_partner}
              rowKey={(r) => `${r.tax_id}-${r.partner_id}`}
              empty="Aucune retenue."
              columns={[
                { key: "partner", label: "Tiers" },
                { key: "vat_number", label: "NIF", render: (r) => r.vat_number ?? <span className="text-danger">à compléter</span> },
                { key: "nature", label: "Nature" },
                { key: "rate", label: "Taux", align: "right", render: (r) => `${r.rate} %` },
                { key: "base", label: "Base", align: "right", render: (r) => fmtGNF(r.base) },
                { key: "amount", label: "Retenue", align: "right", render: (r) => fmtGNF(r.amount) },
              ]}
            />
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Notice tone="warn">{data.note}</Notice>
            <PrepareButton kind="withholding" year={year} month={month} onPrepared={onPrepared} />
          </div>
        </>
      )}
      <WithholdingSettings />
    </div>
  );
}

/** Retenues configurées (taux et natures arrêtés avec l'expert-comptable) et tiers qui y sont soumis. */
function WithholdingSettings() {
  const { data: taxes, mutate } = useApi<WithholdingTax[]>("/finance/fiscal/withholding-taxes");
  const { data: partners, mutate: mutatePartners } = useApi<WithholdingPartner[]>("/finance/fiscal/withholding-partners");
  const [modal, setModal] = useState<null | "tax" | { partner: WithholdingPartner | null }>(null);
  const [error, setError] = useState<string | null>(null);
  async function toggle(tax: WithholdingTax) {
    setError(null);
    try {
      await apiSend("PATCH", `/finance/fiscal/withholding-taxes/${tax.id}`, { active: !tax.active });
      void mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Modification impossible.");
    }
  }
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card title="Retenues configurées" padded={false} actions={<Button size="sm" onClick={() => setModal("tax")}><Plus className="h-3.5 w-3.5" /> Nouvelle retenue</Button>}>
        {error && <div className="p-3"><Notice tone="danger">{error}</Notice></div>}
        <DataTable
          dense
          rows={taxes ?? []}
          rowKey={(t) => t.id}
          empty="Aucune retenue : les natures et les taux s'arrêtent avec l'expert-comptable."
          columns={[
            { key: "name", label: "Retenue" },
            { key: "use", label: "Sens", render: (t) => USE[t.use] },
            { key: "rate", label: "Taux", align: "right", render: (t) => `${t.rate} %` },
            { key: "account", label: "Compte", render: (t) => t.account?.code ?? "–" },
            { key: "nature", label: "Nature", render: (t) => t.nature ?? "–" },
            { key: "active", label: "", render: (t) => <Button size="sm" onClick={() => toggle(t)}>{t.active ? "Archiver" : "Réactiver"}</Button> },
          ]}
        />
      </Card>
      <Card title="Tiers soumis à retenue" padded={false} actions={<Button size="sm" onClick={() => setModal({ partner: null })}><Plus className="h-3.5 w-3.5" /> Ajouter un tiers</Button>}>
        <DataTable
          dense
          rows={partners ?? []}
          rowKey={(p) => p.id}
          onRowClick={(p) => setModal({ partner: p })}
          empty="Aucun tiers : les retenues par défaut s'appliquent d'office aux factures du tiers, et se modifient ligne par ligne."
          columns={[
            { key: "name", label: "Tiers" },
            { key: "vat", label: "NIF", render: (p) => p.vat ?? "–" },
            { key: "taxes", label: "Retenues par défaut", render: (p) => p.taxes.map((t) => `${t.name} (${t.rate} %)`).join(", ") },
          ]}
        />
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
  const [error, setError] = useState<string | null>(null);
  const options = (accounts ?? []).filter((a) => (f.use === "purchase" ? a.code.startsWith("447") : true)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  async function submit() {
    setError(null);
    try {
      await apiSend("POST", "/finance/fiscal/withholding-taxes", { ...f, rate: Number(f.rate.replace(",", ".")), account_id: Number(f.account_id) });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <Modal open title="Nouvelle retenue à la source" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!f.name || !f.rate || !f.account_id}>Créer la retenue</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Notice tone="accent">Taux et natures arrêtés avec l&apos;expert-comptable. La retenue devient une taxe à taux négatif, rangée hors de la TVA.</Notice>
        <Field label="Libellé"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taux (%)"><Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
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
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!who) return;
    setError(null);
    try {
      await apiSend("PUT", `/finance/fiscal/withholding-partners/${who.id}`, { tax_ids: chosen });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <Modal open title="Retenues par défaut du tiers" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!who}>Enregistrer</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Tiers">{partner ? <div className="text-sm font-semibold">{partner.name}</div> : <PartnerPicker value={who} onChange={setWho} kind="supplier" />}</Field>
        <Field label="Retenues appliquées d'office à ses factures" hint="Modifiables ligne par ligne à la saisie. Aucune case cochée : le tiers n'est plus soumis.">
          <div className="space-y-1">
            {taxes.length === 0 && <span className="text-sm text-muted">Créez d&apos;abord une retenue.</span>}
            {taxes.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.includes(t.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, t.id] : chosen.filter((id) => id !== t.id))} />
                {t.name} ({t.rate} %, {USE[t.use].toLowerCase()})
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
  const [action, setAction] = useState<null | { record: TaxReturn; kind: "file" | "pay" }>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function attach(record: TaxReturn, file: File) {
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    try {
      await apiUpload(`/finance/fiscal/returns/${record.id}/attachment`, form);
      void mutate();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Envoi impossible.");
    }
  }
  return (
    <div className="space-y-4">
      {error && <ErrorBox error={error} />}
      {message && <Notice tone="danger">{message}</Notice>}
      {!data && !error && <Loading />}
      {data && (
        <Card padded={false}>
          <DataTable
            rows={data}
            rowKey={(r) => r.id}
            empty="Aucune déclaration préparée pour cet exercice : préparez-la depuis l'onglet TVA ou Retenues."
            columns={[
              { key: "period", label: "Mois", render: (r) => fmtMonth(r.period.slice(0, 7)) },
              { key: "kind", label: "Nature", render: (r) => KIND[r.kind] },
              { key: "state", label: "État", render: (r) => <Badge tone={RETURN_STATE[r.state][1]}>{RETURN_STATE[r.state][0]}</Badge> },
              { key: "amount_base", label: "Base", align: "right", render: (r) => fmtGNF(r.amount_base) },
              { key: "amount_due", label: "À payer", align: "right", render: (r) => fmtGNF(r.amount_due) },
              { key: "amount_credit", label: "Crédit", align: "right", render: (r) => (r.amount_credit ? fmtGNF(r.amount_credit) : "–") },
              { key: "filed", label: "Dépôt", render: (r) => (r.filed_date ? `${fmtDate(r.filed_date)}, ${r.filed_reference ?? ""}` : "–") },
              { key: "paid", label: "Paiement", render: (r) => (r.paid_date ? `${fmtDate(r.paid_date)}${r.paid_reference ? `, ${r.paid_reference}` : ""}` : "–") },
              { key: "settlement", label: "Liquidation", render: (r) => r.settlement_move?.name ?? "–" },
              {
                key: "actions",
                label: "",
                render: (r) => (
                  <div className="flex flex-wrap justify-end gap-1">
                    {r.attachment ? (
                      <Button size="sm" onClick={() => apiDownload(`/finance/fiscal/returns/${r.id}/attachment`, r.attachment?.name ?? "accuse")}>Accusé</Button>
                    ) : (
                      <FileButton small label="Joindre l'accusé" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(file) => attach(r, file)} />
                    )}
                    {r.state === "prepared" && <Button size="sm" onClick={() => setAction({ record: r, kind: "file" })}>Déposée</Button>}
                    {r.state === "filed" && <Button size="sm" onClick={() => setAction({ record: r, kind: "pay" })}>Payée</Button>}
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}
      {action && <ReturnAction record={action.record} kind={action.kind} onClose={() => setAction(null)} onDone={() => { setAction(null); void mutate(); }} />}
    </div>
  );
}

function ReturnAction({ record, kind, onClose, onDone }: { record: TaxReturn; kind: "file" | "pay"; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), reference: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    try {
      await apiSend("POST", `/finance/fiscal/returns/${record.id}/${kind}`, f);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  const title = `${KIND[record.kind]} de ${fmtMonth(record.period.slice(0, 7))} : ${kind === "file" ? "dépôt" : "paiement"}`;
  return (
    <Modal open title={title} onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={kind === "file" && !f.reference.trim()}>Enregistrer</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {kind === "pay" && <Notice tone="accent">Le règlement lui-même passe par la trésorerie (relevé bancaire ou caisse) : cette étape le constate, sans nouvelle sortie de fonds.</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === "file" ? "Déposée le" : "Payée le"}><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label={kind === "file" ? "Référence de dépôt" : "Référence du paiement"}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
