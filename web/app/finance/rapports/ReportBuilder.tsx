"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileBarChart,
  Download,
  Printer,
  Calendar,
  Columns3,
  ChevronDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  Zap,
} from "lucide-react";

/* ════════════════════════════════════════════════════════════════════════════
   ReportBuilder — le cœur du module Rapports. Cockpit dark green premium.
   Vues rapides (presets 1-clic) + sélecteur de rapport + période + filtres +
   colonnes + export CSV + impression + tableau trié paginé avec ligne TOTAUX.
   Tout changement explicite relance POST /api/finance/reports/run.
   ════════════════════════════════════════════════════════════════════════════ */

/* ─── Types catalogue (shapes backend) ──────────────────────────────────── */
type ColType = "text" | "int" | "number" | "money" | "percent" | "date";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColType;
  default?: boolean;
  align?: "left" | "right" | "center";
  agg?: string | null;
}
interface FilterOption { value: string; label: string }
interface ReportFilter {
  key: string;
  label: string;
  type: string;
  options: FilterOption[];
}
interface ReportDef {
  key: string;
  label: string;
  group: string;
  description?: string;
  mode: "list" | "group";
  has_date: boolean;
  columns: ReportColumn[];
  filters: ReportFilter[];
  default_order?: string;
  default_order_dir?: "asc" | "desc";
}
interface ReportGroup { name: string; reports: ReportDef[] }
interface Preset {
  key: string;
  label: string;
  description?: string;
  report: string;
  period?: string;
  columns?: string[];
  filters?: Record<string, string>;
  sort?: string;
  sort_dir?: "asc" | "desc";
}
export interface ReportCatalog {
  groups: ReportGroup[];
  presets: Preset[];
}

/* ─── Types résultat (shape /reports/run) ───────────────────────────────── */
interface ResultColumn {
  key: string;
  label: string;
  type: ColType;
  align?: "left" | "right" | "center";
  agg?: string | null;
}
type Row = Record<string, unknown>;
interface RunResult {
  report: string;
  label: string;
  mode: "list" | "group";
  columns: ResultColumn[];
  rows: Row[];
  totals: Record<string, number>;
  total_count: number;
  limit: number;
  offset: number;
  has_next: boolean;
  period: { from: string | null; to: string | null };
}

/* ─── Périodes ──────────────────────────────────────────────────────────── */
const PERIODS: { key: string; label: string }[] = [
  { key: "today", label: "Aujourd'hui" },
  { key: "7d", label: "7j" },
  { key: "30d", label: "30j" },
  { key: "month", label: "Mois" },
  { key: "quarter", label: "Trimestre" },
  { key: "year", label: "Année" },
  { key: "12m", label: "12 mois" },
  { key: "all", label: "Tout" },
];

const LIMIT = 200;

/* ─── Formatage des valeurs par type ────────────────────────────────────── */
function fmtValue(v: unknown, type: ColType): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "money": {
      const n = Number(v);
      if (Number.isNaN(n)) return "—";
      return `${n.toLocaleString("fr-FR")} GNF`;
    }
    case "number": {
      const n = Number(v);
      if (Number.isNaN(n)) return "—";
      return n.toLocaleString("fr-FR");
    }
    case "int": {
      const n = Math.trunc(Number(v));
      if (Number.isNaN(n)) return "—";
      return n.toLocaleString("fr-FR");
    }
    case "percent": {
      const n = Number(v);
      if (Number.isNaN(n)) return String(v);
      return `${n}%`;
    }
    case "date": {
      const d = new Date(v as string);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString("fr-FR");
    }
    default:
      return String(v);
  }
}

function alignClass(align?: string): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

/* ════════════════════════════════════════════════════════════════════════ */
export function ReportBuilder({
  catalog,
  catalogError,
}: {
  catalog: ReportCatalog | null;
  catalogError: string | null;
}) {
  const allReports = useMemo<ReportDef[]>(
    () => catalog?.groups.flatMap((g) => g.reports) ?? [],
    [catalog],
  );
  const presets = catalog?.presets ?? [];

  const reportByKey = useCallback(
    (key: string) => allReports.find((r) => r.key === key),
    [allReports],
  );

  /* ─── État courant ────────────────────────────────────────────────────── */
  const [reportKey, setReportKey] = useState<string>("");
  const [period, setPeriod] = useState<string>("month");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [useCustomDates, setUseCustomDates] = useState(false);
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);

  const currentReport = reportByKey(reportKey);

  /* ─── Fermer le popover colonnes au clic extérieur ────────────────────── */
  useEffect(() => {
    if (!colsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) {
        setColsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [colsOpen]);

  /* ─── Exécution /run ──────────────────────────────────────────────────── */
  const reqSeq = useRef(0);
  const runReport = useCallback(
    async (overrides?: {
      report?: string;
      period?: string;
      dateFrom?: string;
      dateTo?: string;
      useCustomDates?: boolean;
      columns?: string[];
      filters?: Record<string, string>;
      sort?: string;
      sortDir?: "asc" | "desc";
      offset?: number;
    }) => {
      const rk = overrides?.report ?? reportKey;
      if (!rk) return;
      const def = reportByKey(rk);
      if (!def) return;

      const cols = overrides?.columns ?? selectedCols;
      const flt = overrides?.filters ?? filters;
      const off = overrides?.offset ?? offset;
      const srt = overrides?.sort ?? sort;
      const srtDir = overrides?.sortDir ?? sortDir;
      const per = overrides?.period ?? period;
      const custom = overrides?.useCustomDates ?? useCustomDates;
      const df = overrides?.dateFrom ?? dateFrom;
      const dt = overrides?.dateTo ?? dateTo;

      const body: Record<string, unknown> = {
        report: rk,
        limit: LIMIT,
        offset: off,
      };
      if (cols.length) body.columns = cols;
      // Filtres non-vides uniquement
      const cleanFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(flt)) {
        if (v) cleanFilters[k] = v;
      }
      if (Object.keys(cleanFilters).length) body.filters = cleanFilters;
      if (srt) {
        body.sort = srt;
        body.sort_dir = srtDir;
      }
      if (def.has_date) {
        if (custom && df && dt) {
          body.date_from = df;
          body.date_to = dt;
        } else {
          body.period = per;
        }
      }

      const seq = ++reqSeq.current;
      setLoading(true);
      setRunError(null);
      try {
        const res = await fetch("/api/finance/reports/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RunResult;
        if (seq !== reqSeq.current) return; // requête obsolète
        setResult(data);
      } catch (e) {
        if (seq !== reqSeq.current) return;
        setRunError(e instanceof Error ? e.message : "Erreur de chargement");
        setResult(null);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [reportKey, reportByKey, selectedCols, filters, offset, sort, sortDir, period, useCustomDates, dateFrom, dateTo],
  );

  /* ─── Charger un preset ───────────────────────────────────────────────── */
  const loadPreset = useCallback(
    (p: Preset) => {
      const def = reportByKey(p.report);
      if (!def) return;
      const cols = p.columns?.length
        ? p.columns
        : def.columns.filter((c) => c.default).map((c) => c.key);
      const finalCols = cols.length ? cols : def.columns.map((c) => c.key);
      const per = p.period ?? (def.has_date ? "month" : "all");
      const flt = p.filters ?? {};
      const srt = p.sort ?? def.default_order ?? "";
      const srtDir = p.sort_dir ?? def.default_order_dir ?? "desc";

      setReportKey(p.report);
      setActivePreset(p.key);
      setPeriod(per);
      setUseCustomDates(false);
      setDateFrom("");
      setDateTo("");
      setSelectedCols(finalCols);
      setFilters(flt);
      setSort(srt);
      setSortDir(srtDir);
      setOffset(0);

      runReport({
        report: p.report,
        period: per,
        useCustomDates: false,
        columns: finalCols,
        filters: flt,
        sort: srt,
        sortDir: srtDir,
        offset: 0,
      });
    },
    [reportByKey, runReport],
  );

  /* ─── Montage : charger le 1er preset (ou 1er rapport) ────────────────── */
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !catalog) return;
    didInit.current = true;
    if (presets.length > 0) {
      loadPreset(presets[0]!);
    } else if (allReports.length > 0) {
      changeReport(allReports[0]!.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  /* ─── Changer de rapport manuellement (reset défauts) ─────────────────── */
  const changeReport = useCallback(
    (rk: string) => {
      const def = reportByKey(rk);
      if (!def) return;
      const cols = def.columns.filter((c) => c.default).map((c) => c.key);
      const finalCols = cols.length ? cols : def.columns.map((c) => c.key);
      const per = def.has_date ? "month" : "all";
      const srt = def.default_order ?? "";
      const srtDir = def.default_order_dir ?? "desc";

      setReportKey(rk);
      setActivePreset(null);
      setPeriod(per);
      setUseCustomDates(false);
      setDateFrom("");
      setDateTo("");
      setSelectedCols(finalCols);
      setFilters({});
      setSort(srt);
      setSortDir(srtDir);
      setOffset(0);

      runReport({
        report: rk,
        period: per,
        useCustomDates: false,
        columns: finalCols,
        filters: {},
        sort: srt,
        sortDir: srtDir,
        offset: 0,
      });
    },
    [reportByKey, runReport],
  );

  /* ─── Handlers période / filtres / colonnes / tri / pagination ────────── */
  const onPeriod = (p: string) => {
    setPeriod(p);
    setUseCustomDates(false);
    setActivePreset(null);
    setOffset(0);
    runReport({ period: p, useCustomDates: false, offset: 0 });
  };

  const onCustomDates = () => {
    if (!dateFrom || !dateTo) return;
    setUseCustomDates(true);
    setActivePreset(null);
    setOffset(0);
    runReport({ useCustomDates: true, dateFrom, dateTo, offset: 0 });
  };

  const onFilter = (key: string, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setActivePreset(null);
    setOffset(0);
    runReport({ filters: next, offset: 0 });
  };

  const onToggleCol = (key: string) => {
    let next: string[];
    if (selectedCols.includes(key)) {
      if (selectedCols.length <= 1) return; // au moins 1 colonne
      next = selectedCols.filter((c) => c !== key);
    } else {
      // Conserver l'ordre du catalogue
      const order = currentReport?.columns.map((c) => c.key) ?? [];
      next = order.filter((k) => selectedCols.includes(k) || k === key);
    }
    setSelectedCols(next);
    setActivePreset(null);
    setOffset(0);
    runReport({ columns: next, offset: 0 });
  };

  const onSort = (key: string) => {
    let nextDir: "asc" | "desc" = "desc";
    if (sort === key) {
      nextDir = sortDir === "asc" ? "desc" : "asc";
    }
    setSort(key);
    setSortDir(nextDir);
    setActivePreset(null);
    setOffset(0);
    runReport({ sort: key, sortDir: nextDir, offset: 0 });
  };

  const onPage = (newOffset: number) => {
    if (newOffset < 0) return;
    setOffset(newOffset);
    runReport({ offset: newOffset });
  };

  /* ─── Export CSV ──────────────────────────────────────────────────────── */
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    if (exporting || !reportKey) return;
    const def = reportByKey(reportKey);
    if (!def) return;
    setExporting(true);
    const body: Record<string, unknown> = { report: reportKey, limit: LIMIT, offset };
    if (selectedCols.length) body.columns = selectedCols;
    const cleanFilters: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters)) if (v) cleanFilters[k] = v;
    if (Object.keys(cleanFilters).length) body.filters = cleanFilters;
    if (sort) {
      body.sort = sort;
      body.sort_dir = sortDir;
    }
    if (def.has_date) {
      if (useCustomDates && dateFrom && dateTo) {
        body.date_from = dateFrom;
        body.date_to = dateTo;
      } else {
        body.period = period;
      }
    }
    try {
      const res = await fetch("/api/finance/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      a.href = url;
      a.download = match?.[1] ?? `${reportKey}_soguiprem.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed", e);
    } finally {
      setExporting(false);
    }
  };

  /* ─── Affichage ───────────────────────────────────────────────────────── */
  const cols = result?.columns ?? [];
  const rows = result?.rows ?? [];
  const totals = result?.totals ?? {};
  const hasTotals = Object.keys(totals).length > 0;
  const totalCount = result?.total_count ?? 0;
  const periodFrom = result?.period?.from;
  const periodTo = result?.period?.to;

  if (catalogError || !catalog) {
    return (
      <main className="relative min-h-screen bg-[#0a0c24] font-mono">
        <HeaderBar label={null} totalCount={0} live={false} />
        <div className="px-6 py-8 md:px-10">
          <div className="rounded-md border border-[#FF8A3D]/40 bg-[#FF8A3D]/10 px-4 py-3 text-sm text-[#FF8A3D]">
            Catalogue de rapports indisponible{catalogError ? ` (${catalogError})` : ""}.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="report-builder relative min-h-screen bg-[#0a0c24] font-mono">
      <HeaderBar
        label={result?.label ?? currentReport?.label ?? null}
        totalCount={totalCount}
        live={!!result}
      />

      <div className="px-6 py-6 md:px-10">
        {/* ═══ VUES RAPIDES (presets) ══════════════════════════════════════ */}
        {presets.length > 0 && (
          <section className="print-hide mb-6">
            <div className="mb-2 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-[#E0A83C]" />
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5c7d68]">
                Vues rapides
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => {
                const active = activePreset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    title={p.description ?? p.label}
                    onClick={() => loadPreset(p)}
                    className={`rounded-md border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                      active
                        ? "border-[#E0A83C] bg-[#E0A83C] text-[#0a0c24]"
                        : "border-[#262d6b] text-[#8FA2C0] hover:border-[#E0A83C] hover:text-[#E0A83C]"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ═══ BARRE D'OUTILS ══════════════════════════════════════════════ */}
        <section className="print-hide mb-5 rounded-md border border-[#262d6b] bg-[#10133a] p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Sélecteur de rapport */}
            <div className="flex min-w-[220px] flex-col gap-1">
              <label className="text-[9px] uppercase tracking-[0.16em] text-[#5c7d68]">
                Rapport
              </label>
              <div className="relative">
                <select
                  value={reportKey}
                  onChange={(e) => changeReport(e.target.value)}
                  className="w-full appearance-none rounded-sm border border-[#262d6b] bg-[#0a0c24] px-3 py-2 pr-8 text-[12px] font-bold text-[#EEF3F6] outline-none focus:border-[#E0A83C]"
                >
                  {catalog.groups.map((g) => (
                    <optgroup key={g.name} label={g.name}>
                      {g.reports.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5c7d68]" />
              </div>
            </div>

            {/* Période */}
            {currentReport?.has_date && (
              <div className="flex flex-col gap-1">
                <label className="text-[9px] uppercase tracking-[0.16em] text-[#5c7d68]">
                  Période
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  {PERIODS.map((p) => {
                    const active = !useCustomDates && period === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => onPeriod(p.key)}
                        className={`rounded-sm border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                          active
                            ? "border-[#E0A83C] bg-[#E0A83C] text-[#0a0c24]"
                            : "border-[#262d6b] text-[#8FA2C0] hover:border-[#E0A83C] hover:text-[#E0A83C]"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setUseCustomDates((v) => !v)}
                    className={`flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      useCustomDates
                        ? "border-[#E0A83C] bg-[#E0A83C] text-[#0a0c24]"
                        : "border-[#262d6b] text-[#8FA2C0] hover:border-[#E0A83C] hover:text-[#E0A83C]"
                    }`}
                  >
                    <Calendar className="h-3 w-3" />
                    Dates…
                  </button>
                </div>
                {useCustomDates && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="rounded-sm border border-[#262d6b] bg-[#0a0c24] px-2 py-1 text-[11px] text-[#EEF3F6] outline-none focus:border-[#E0A83C]"
                    />
                    <span className="text-[10px] text-[#5c7d68]">→</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="rounded-sm border border-[#262d6b] bg-[#0a0c24] px-2 py-1 text-[11px] text-[#EEF3F6] outline-none focus:border-[#E0A83C]"
                    />
                    <button
                      type="button"
                      onClick={onCustomDates}
                      disabled={!dateFrom || !dateTo}
                      className="rounded-sm border border-[#262d6b] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8FA2C0] transition-colors hover:border-[#E0A83C] hover:text-[#E0A83C] disabled:opacity-40"
                    >
                      Appliquer
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Filtres */}
            {currentReport?.filters.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label className="text-[9px] uppercase tracking-[0.16em] text-[#5c7d68]">
                  {f.label}
                </label>
                <div className="relative">
                  <select
                    value={filters[f.key] ?? ""}
                    onChange={(e) => onFilter(f.key, e.target.value)}
                    className="appearance-none rounded-sm border border-[#262d6b] bg-[#0a0c24] px-3 py-2 pr-8 text-[12px] text-[#EEF3F6] outline-none focus:border-[#E0A83C]"
                  >
                    <option value="">Tous</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5c7d68]" />
                </div>
              </div>
            ))}

            {/* Actions : colonnes / export / imprimer */}
            <div className="ml-auto flex items-end gap-2">
              {/* Colonnes */}
              <div className="relative flex flex-col gap-1" ref={colsRef}>
                <label className="text-[9px] uppercase tracking-[0.16em] text-[#5c7d68]">
                  &nbsp;
                </label>
                <button
                  type="button"
                  onClick={() => setColsOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-sm border border-[#262d6b] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#8FA2C0] transition-colors hover:border-[#E0A83C] hover:text-[#E0A83C]"
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  Colonnes ({selectedCols.length})
                  <ChevronDown className="h-3 w-3" />
                </button>
                {colsOpen && currentReport && (
                  <div className="absolute right-0 top-full z-20 mt-1 max-h-[320px] w-[240px] overflow-y-auto rounded-md border border-[#262d6b] bg-[#10133a] p-2 shadow-xl">
                    {currentReport.columns.map((c) => {
                      const checked = selectedCols.includes(c.key);
                      const last = checked && selectedCols.length <= 1;
                      return (
                        <label
                          key={c.key}
                          className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] transition-colors hover:bg-[#141a46] ${
                            last ? "opacity-50" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={last}
                            onChange={() => onToggleCol(c.key)}
                            className="h-3.5 w-3.5 accent-[#E0A83C]"
                          />
                          <span className="text-[#c4d6cb]">{c.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Export */}
              <div className="flex flex-col gap-1">
                <label className="text-[9px] uppercase tracking-[0.16em] text-[#5c7d68]">
                  &nbsp;
                </label>
                <button
                  type="button"
                  onClick={onExport}
                  disabled={exporting}
                  className="flex items-center gap-1.5 rounded-sm border border-[#262d6b] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#8FA2C0] transition-colors hover:border-[#E0A83C] hover:text-[#E0A83C] disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting ? "Export…" : "CSV"}
                </button>
              </div>

              {/* Imprimer */}
              <div className="flex flex-col gap-1">
                <label className="text-[9px] uppercase tracking-[0.16em] text-[#5c7d68]">
                  &nbsp;
                </label>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 rounded-sm border border-[#262d6b] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#8FA2C0] transition-colors hover:border-[#E0A83C] hover:text-[#E0A83C]"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimer
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ TABLEAU DE RÉSULTATS ════════════════════════════════════════ */}
        <div className="overflow-hidden rounded-md border border-[#262d6b] bg-[#10133a]">
          {/* Titre tableau + plage de dates */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262d6b] px-5 py-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#EEF3F6]">
              <FileBarChart className="h-3.5 w-3.5 text-[#E0A83C]" />
              {result?.label ?? currentReport?.label ?? "Rapport"}
            </h2>
            <span className="text-[10px] text-[#5c7d68]">
              {periodFrom && periodTo
                ? `${new Date(periodFrom).toLocaleDateString("fr-FR")} → ${new Date(periodTo).toLocaleDateString("fr-FR")}`
                : "Toutes périodes"}
            </span>
          </div>

          {/* Erreur */}
          {runError && (
            <div className="border-b border-[#262d6b] bg-[#F2777A]/10 px-5 py-3 text-[12px] text-[#F2777A]">
              Erreur : {runError}
            </div>
          )}

          {/* Table */}
          <div className="relative overflow-x-auto">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#10133a]/60">
                <Loader2 className="h-6 w-6 animate-spin text-[#E0A83C]" />
              </div>
            )}
            <table
              className={`w-full text-[11px] transition-opacity ${loading ? "opacity-50" : ""}`}
            >
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-[0.16em] text-[#5c7d68]">
                  {cols.map((c) => {
                    const sorted = sort === c.key;
                    return (
                      <th
                        key={c.key}
                        onClick={() => onSort(c.key)}
                        className={`cursor-pointer select-none border-b border-[#262d6b] px-3 py-2.5 font-medium transition-colors hover:text-[#E0A83C] ${alignClass(
                          c.align,
                        )}`}
                      >
                        <span
                          className={`inline-flex items-center gap-1 ${
                            c.align === "right" ? "flex-row-reverse" : ""
                          } ${sorted ? "text-[#E0A83C]" : ""}`}
                        >
                          {c.label}
                          {sorted ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={Math.max(1, cols.length)}
                      className="px-3 py-12 text-center text-[#5c7d68]"
                    >
                      Aucune donnée pour ces critères.
                    </td>
                  </tr>
                )}
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-[#1a2156] transition-colors last:border-0 hover:bg-[#141a46]"
                  >
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 ${alignClass(c.align)} ${
                          c.type === "money" || c.type === "number" || c.type === "int"
                            ? "text-[#c4d6cb]"
                            : "text-[#EEF3F6]"
                        }`}
                      >
                        {fmtValue(row[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {hasTotals && rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-[#262d6b] bg-[#141a46] font-bold text-[#E0A83C]">
                    {cols.map((c, idx) => {
                      if (idx === 0 && totals[c.key] === undefined) {
                        return (
                          <td key={c.key} className={`px-3 py-2.5 ${alignClass(c.align)}`}>
                            TOTAL
                          </td>
                        );
                      }
                      const has = totals[c.key] !== undefined;
                      return (
                        <td key={c.key} className={`px-3 py-2.5 ${alignClass(c.align)}`}>
                          {has ? fmtValue(totals[c.key], c.type) : idx === 0 ? "TOTAL" : ""}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pied : compteur + pagination */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#262d6b] px-5 py-3 text-[11px]">
            <span className="text-[#5c7d68]">
              {rows.length.toLocaleString("fr-FR")} / {totalCount.toLocaleString("fr-FR")} lignes
            </span>
            {(result?.has_next || offset > 0) && (
              <div className="print-hide flex items-center gap-2">
                <span className="text-[#5c7d68]">
                  page {Math.floor(offset / LIMIT) + 1}
                </span>
                {offset > 0 ? (
                  <button
                    type="button"
                    onClick={() => onPage(Math.max(0, offset - LIMIT))}
                    className="rounded-sm border border-[#262d6b] px-3 py-1.5 text-[#c4d6cb] transition-colors hover:bg-[#141a46]"
                  >
                    ‹ Précédent
                  </button>
                ) : (
                  <span className="rounded-sm border border-[#1a2156] px-3 py-1.5 text-[#3a5244]">
                    ‹ Précédent
                  </span>
                )}
                {result?.has_next ? (
                  <button
                    type="button"
                    onClick={() => onPage(offset + LIMIT)}
                    className="rounded-sm border border-[#262d6b] px-3 py-1.5 text-[#c4d6cb] transition-colors hover:bg-[#141a46]"
                  >
                    Suivant ›
                  </button>
                ) : (
                  <span className="rounded-sm border border-[#1a2156] px-3 py-1.5 text-[#3a5244]">
                    Suivant ›
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Print CSS : masquer le rail nav + les contrôles, garder le tableau */}
      <style jsx global>{`
        @media print {
          aside {
            display: none !important;
          }
          .print-hide {
            display: none !important;
          }
          .report-builder {
            background: #fff !important;
            color: #000 !important;
          }
        }
      `}</style>
    </main>
  );
}

/* ─── Bandeau jaune cockpit ─────────────────────────────────────────────── */
function HeaderBar({
  label,
  totalCount,
  live,
}: {
  label: string | null;
  totalCount: number;
  live: boolean;
}) {
  return (
    <div className="relative border-b border-[#262d6b] bg-[#E0A83C]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 md:px-10">
        <div className="flex items-center gap-2.5">
          <span className="brand-mark !h-7 !w-7" aria-hidden="true" />
          <span className="text-sm font-bold tracking-tight text-[#0a0c24]">
            EGUITRA <span className="text-[#0a0c24]/60">//</span> RAPPORTS
          </span>
        </div>
        {label && (
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#0a0c24]/60">
              {label}
            </span>
            <span className="text-lg font-bold tabular-nums text-[#0a0c24]">
              {totalCount.toLocaleString("fr-FR")} lignes
            </span>
          </div>
        )}
        <div className="ml-auto">
          <span
            className="inline-flex items-center gap-1.5 rounded-sm bg-[#0a0c24] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: live ? "#33A98C" : "#FF8A3D" }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: live ? "#33A98C" : "#FF8A3D" }}
            />
            {live ? "LIVE · POSTGRES" : "EN ATTENTE"}
          </span>
        </div>
      </div>
    </div>
  );
}
