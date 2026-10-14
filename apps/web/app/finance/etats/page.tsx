"use client";

import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button, Card, DataTable, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Tabs, cx } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF, fmtInt } from "@/lib/format";

type Tab = "bilan" | "resultat" | "rapports" | "ifrs" | "export";
interface StatementLine { code: string; label: string; amount: number; total: boolean; previous?: number }

const todayIso = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export default function StatementsPage() {
  const [tab, setTab] = useState<Tab>("bilan");
  const [scope, setScope] = useState<"company" | "group">("company");
  return (
    <div>
      <PageHeader
        title="Balance et états financiers"
        subtitle="États SYSCOHADA révisé, rapports paramétrables, passerelle IFRS et export d'audit."
        actions={
          <>
            <ScopeToggle value={scope} onChange={setScope} />
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimer
            </Button>
          </>
        }
      />
      <Tabs
        tabs={[
          { key: "bilan", label: "Bilan" },
          { key: "resultat", label: "Compte de résultat" },
          { key: "rapports", label: "Balance, grand livre et rapports" },
          { key: "ifrs", label: "Passerelle IFRS" },
          { key: "export", label: "Export d'audit" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "bilan" && <BalanceSheet scope={scope} />}
      {tab === "resultat" && <IncomeStatement scope={scope} />}
      {tab === "rapports" && <ReportBuilder scope={scope} />}
      {tab === "ifrs" && <Ifrs scope={scope} />}
      {tab === "export" && <AuditExport scope={scope} />}
    </div>
  );
}

function StatementTable({ lines, compare }: { lines: StatementLine[]; compare?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
          <th className="w-14 px-3 py-2 text-left">Réf.</th>
          <th className="px-3 py-2 text-left">Rubrique</th>
          <th className="px-3 py-2 text-right">Exercice</th>
          {compare && <th className="px-3 py-2 text-right">Exercice précédent</th>}
        </tr>
      </thead>
      <tbody className="tabular">
        {lines.map((l) => (
          <tr key={l.code} className={cx("border-b border-line/50", l.total && "bg-panel-2 font-semibold")}>
            <td className="px-3 py-1.5 font-mono text-xs text-muted">{l.code}</td>
            <td className="px-3 py-1.5">{l.label}</td>
            <td className={cx("px-3 py-1.5 text-right font-mono", l.amount < 0 && "text-danger")}>{fmtInt(l.amount)}</td>
            {compare && <td className="px-3 py-1.5 text-right font-mono text-muted">{fmtInt(l.previous)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BalanceSheet({ scope }: { scope: string }) {
  const [date, setDate] = useState(todayIso());
  const { data, error } = useApi<{ actif: StatementLine[]; passif: StatementLine[]; difference: number; unmapped_accounts: Record<string, number> }>(
    `/finance/statements/balance-sheet?date=${date}&scope=${scope}`,
  );
  return (
    <div className="space-y-4">
      <div className="no-print flex items-end gap-3">
        <Field label="Arrêté au">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          {data.difference !== 0 ? <Notice tone="danger">Bilan déséquilibré : écart de {fmtGNF(data.difference)}.</Notice> : <Notice tone="ok">Bilan équilibré au {fmtDate(date)}. Montants nets en GNF.</Notice>}
          {Object.keys(data.unmapped_accounts).length > 0 && <Notice tone="warn">Comptes hors états : {Object.keys(data.unmapped_accounts).join(", ")}.</Notice>}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Actif" padded={false}>
              <StatementTable lines={data.actif} />
            </Card>
            <Card title="Passif" padded={false}>
              <StatementTable lines={data.passif} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function IncomeStatement({ scope }: { scope: string }) {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayIso());
  const { data, error } = useApi<{ lines: StatementLine[]; unmapped_accounts: Record<string, number> }>(
    `/finance/statements/income?date_from=${from}&date_to=${to}&compare=previous_year&scope=${scope}`,
  );
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3">
        <Field label="Du">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Au">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <Card title="Compte de résultat (système normal)" padded={false}>
          <StatementTable lines={data.lines} compare />
        </Card>
      )}
    </div>
  );
}

interface CatalogReport {
  key: string;
  label: string;
  description: string;
  has_date: boolean;
  filters: Array<{ key: string; label: string; type: string; options: Array<{ value: string; label: string }> }>;
}
interface RunResult {
  label: string;
  columns: Array<{ key: string; label: string; type: string; align: string }>;
  rows: Array<Record<string, unknown>>;
  totals: Record<string, number>;
  total_count: number;
}

function cell(value: unknown, type: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "money" || type === "int") return fmtInt(value);
  if (type === "date") return fmtDate(String(value));
  return String(value);
}

function ReportBuilder({ scope }: { scope: string }) {
  const { data: catalog } = useApi<{ groups: Array<{ name: string; reports: CatalogReport[] }> }>("/finance/reports/catalog");
  const reports = useMemo(() => catalog?.groups.flatMap((g) => g.reports) ?? [], [catalog]);
  const [key, setKey] = useState("balance");
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayIso());
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const report = reports.find((r) => r.key === key);

  const body = () => ({ report: key, date_from: report?.has_date ? from : undefined, date_to: report?.has_date ? to : undefined, filters, scope, limit: 2000 });
  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await apiSend<RunResult>("POST", "/finance/reports/run", body()));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(format: "csv" | "xlsx") {
    const res = await fetch("/api/odoo/finance/reports/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body(), format }) });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${key}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="no-print grid grid-cols-1 gap-3 md:grid-cols-6">
          <Field label="Rapport" className="md:col-span-2">
            <Select value={key} onChange={(e) => { setKey(e.target.value); setFilters({}); setResult(null); }} options={reports.map((r) => ({ value: r.key, label: r.label }))} />
          </Field>
          {report?.has_date && (
            <>
              <Field label="Du">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Au">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </>
          )}
          {report?.filters.filter((f) => f.type !== "partner").map((f) => (
            <Field key={f.key} label={f.label}>
              {f.type === "select" ? (
                <Select value={filters[f.key] ?? ""} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} placeholder="Tous" options={f.options} />
              ) : (
                <Input value={filters[f.key] ?? ""} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
          <div className="flex items-end gap-2">
            <Button variant="primary" loading={busy} onClick={run}>
              Afficher
            </Button>
          </div>
        </div>
        {report && <p className="mt-2 text-xs text-muted">{report.description}</p>}
      </Card>
      {Boolean(error) && <ErrorBox error={error} />}
      {result && (
        <Card
          title={`${result.label} · ${result.total_count} ligne(s)`}
          padded={false}
          actions={
            <div className="no-print flex gap-2">
              <Button className="px-2 py-1 text-xs" onClick={() => exportFile("csv")}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button className="px-2 py-1 text-xs" onClick={() => exportFile("xlsx")}>
                <Download className="h-3.5 w-3.5" /> XLSX
              </Button>
            </div>
          }
        >
          <DataTable
            dense
            rows={result.rows}
            rowKey={(_r, i) => i}
            columns={result.columns.map((c) => ({
              key: c.key,
              label: c.label,
              align: (c.align as "left" | "right") ?? "left",
              render: (r: Record<string, unknown>) => cell(r[c.key], c.type),
              sortValue: (r: Record<string, unknown>) => (typeof r[c.key] === "number" ? (r[c.key] as number) : String(r[c.key] ?? "")),
            }))}
            footer={
              Object.keys(result.totals).length > 0 ? (
                <tr>
                  {result.columns.map((c, i) => (
                    <td key={c.key} className={cx("px-3 py-2", c.align === "right" && "text-right font-mono")}>
                      {c.key in result.totals ? fmtInt(result.totals[c.key]) : i === 0 ? "TOTAL" : ""}
                    </td>
                  ))}
                </tr>
              ) : undefined
            }
          />
        </Card>
      )}
    </div>
  );
}

function Ifrs({ scope }: { scope: string }) {
  const [date, setDate] = useState(todayIso());
  const { data, error } = useApi<{ lines: Array<{ label: string; section: string; amount: number; syscohada: string[] }>; note: string }>(`/finance/ifrs?date=${date}&scope=${scope}`);
  return (
    <div className="space-y-4">
      <Field label="Arrêté au" className="no-print max-w-xs">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          <Notice tone="warn">{data.note}</Notice>
          <Card padded={false}>
            <DataTable
              dense
              rows={data.lines}
              rowKey={(l) => l.label}
              columns={[
                { key: "section", label: "État", render: (l) => ({ actif: "Bilan, actif", passif: "Bilan, passif", resultat: "Résultat" })[l.section] ?? l.section },
                { key: "label", label: "Poste IFRS" },
                { key: "syscohada", label: "Rubriques SYSCOHADA", render: (l) => l.syscohada.join(", ") },
                { key: "amount", label: "Montant", align: "right", render: (l) => fmtInt(l.amount) },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function AuditExport({ scope }: { scope: string }) {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayIso());
  return (
    <Card title="Export des écritures pour l'audit">
      <p className="mb-4 text-sm text-muted">Toutes les écritures validées de la période, ligne par ligne, avec journal, pièce, compte, tiers, lettrage, devise et dates de saisie. Format CSV (séparateur point-virgule) ou Excel.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Du">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Au">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button onClick={() => apiDownload(`/finance/exports/entries?date_from=${from}&date_to=${to}&scope=${scope}&format=csv`, "ecritures.csv")}>
          <Download className="h-4 w-4" /> CSV
        </Button>
        <Button variant="primary" onClick={() => apiDownload(`/finance/exports/entries?date_from=${from}&date_to=${to}&scope=${scope}&format=xlsx`, "ecritures.xlsx")}>
          <Download className="h-4 w-4" /> Excel
        </Button>
      </div>
    </Card>
  );
}
