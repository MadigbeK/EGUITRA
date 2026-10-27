"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Download, Printer } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Tabs, cx } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { IfrsPanel } from "@/components/finance/IfrsPanel";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { PagesListe, aujourdhui, useTelechargement } from "@/components/finance/communPieces";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF, fmtInt, fmtPct, pluriel } from "@/lib/format";

type Tab = "bilan" | "resultat" | "flux" | "consolide" | "rapports" | "ifrs" | "export";
interface StatementLine {
  code: string;
  label: string;
  amount: number;
  total: boolean;
  previous?: number;
  month?: number;
  pct_revenue?: number | null;
  /** Numéro de la note annexe du système normal. */
  note?: string | null;
  /** Compte de résultat : « + » produit, « - » charge (montants positifs). */
  sign?: string | null;
  /** Tableau des flux : lettre du modèle (ZA = A … ZH = H). */
  letter?: string | null;
  /** Poste présenté en retrait sous sa rubrique (AE à AH, AJ à AN, AR, AS, BH à BJ). */
  detail?: boolean;
  gross?: number;
  depreciation?: number;
}
/** Origine de la colonne N-1 : exercice précédent de la plateforme, ou états importés (premier exercice). */
interface Previous {
  date_from: string;
  date_to: string;
  source: "platform" | "import" | "mixed";
  imports: Array<{ id: number; company: string; date_to: string; source: string | null; imported_at: string | null }>;
  import_available: boolean;
  difference?: number;
  bf?: number;
  treasury_end?: number;
}

// Jour et début d'exercice à Conakry (le jour UTC changeait de date sur un poste réglé ailleurs).
const todayIso = aujourdhui;
const yearStart = () => `${aujourdhui().slice(0, 4)}-01-01`;

/**
 * Bouton de téléchargement par le client commun (application et société de l'écran) : en chargement
 * pendant l'appel, l'échec écrit sous le bouton au lieu de passer inaperçu.
 */
function Telecharger({ chemin, nom, children, size = "sm", variant, disabled }: { chemin: string; nom: string; children: ReactNode; size?: "sm" | "md"; variant?: "primary" | "secondary"; disabled?: boolean }) {
  const { telecharger, enCours, erreur } = useTelechargement();
  return (
    <span className="no-print inline-flex flex-col">
      <Button size={size} variant={variant} disabled={disabled} loading={enCours !== null} onClick={() => void telecharger("fichier", chemin, nom)}>
        {children}
      </Button>
      {erreur && (
        <span role="alert" className="mt-1 max-w-xs text-[12px] leading-snug text-danger">
          {erreur}
        </span>
      )}
    </span>
  );
}

/**
 * Boutons d'export d'un état (XLSX et CSV), sur la période affichée, et les trois états au modèle du
 * système normal (classeur de l'expert-comptable) à la date d'arrêté.
 */
function ExportButtons({ kind, query, modele }: { kind: string; query: string; modele?: { date: string; scope: string } }) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      <Telecharger chemin={`/finance/statements/export?kind=${kind}&format=xlsx&${query}`} nom={`${kind}.xlsx`}>
        <Download className="h-3.5 w-3.5" /> XLSX
      </Telecharger>
      <Telecharger chemin={`/finance/statements/export?kind=${kind}&format=csv&${query}`} nom={`${kind}.csv`}>
        <Download className="h-3.5 w-3.5" /> CSV
      </Telecharger>
      {modele && (
        <Telecharger variant="primary" chemin={`/finance/statements/export?kind=modele_syscohada&date_to=${modele.date}&scope=${modele.scope}`} nom={`etats_syscohada_${modele.date}.xlsx`}>
          <Download className="h-3.5 w-3.5" /> Modèle SYSCOHADA
        </Telecharger>
      )}
    </div>
  );
}

/** Origine de la colonne N-1, et comparatifs importés que la période choisie ne permet pas d'employer. */
function PreviousNotice({ previous, quoi }: { previous?: Previous; quoi: string }) {
  if (!previous) return null;
  const imports = previous.imports.map((i) => `${i.company}${i.source ? ` (« ${i.source} »)` : ""}`).join(", ");
  return (
    <>
      {previous.source !== "platform" && (
        <Notice tone="accent">
          Colonne N-1 ({quoi}) : états de l&apos;exercice précédent importés pour {imports}
          {previous.source === "mixed" ? ", plateforme pour les autres sociétés" : ""} (Clôtures et contrôles, comparatifs du premier exercice).
        </Notice>
      )}
      {previous.import_available && (
        <Notice tone="warn">
          Des états de l&apos;exercice précédent ont été importés : ils valent pour l&apos;exercice entier. Choisissez l&apos;exercice complet (du premier au dernier jour) pour les voir en colonne N-1 ; la colonne affiche ici la même période de l&apos;an dernier dans la plateforme.
        </Notice>
      )}
    </>
  );
}

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
            <Telecharger size="md" chemin={`/finance/statements/export?kind=all&format=xlsx&date_to=${todayIso()}&scope=${scope}`} nom="etats.xlsx">
              <Download className="h-4 w-4" /> Tous les états (XLSX)
            </Telecharger>
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
          { key: "flux", label: "Tableau des flux" },
          { key: "consolide", label: "Consolidé du groupe" },
          { key: "rapports", label: "Balance, grand livre et rapports" },
          { key: "ifrs", label: "Passerelle IFRS" },
          { key: "export", label: "Export d'audit" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "bilan" && <BalanceSheet scope={scope} />}
      {tab === "resultat" && <IncomeStatement scope={scope} />}
      {tab === "flux" && <CashFlow scope={scope} />}
      {tab === "consolide" && <Consolidated />}
      {tab === "rapports" && <ReportBuilder scope={scope} />}
      {tab === "ifrs" && <IfrsPanel scope={scope} />}
      {tab === "export" && <AuditExport scope={scope} />}
    </div>
  );
}

type Colonne = "note" | "sign" | "letter" | "gross" | "depreciation" | "month" | "amount" | "pct" | "previous";
const ENTETES: Record<Colonne, string> = {
  note: "Note",
  sign: "",
  letter: "",
  gross: "Brut",
  depreciation: "Amort. et dépréc.",
  month: "Mois",
  amount: "Net",
  pct: "% du CA",
  previous: "N-1",
};

/** Cellule d'un montant : négatif en rouge, colonne N-1 en gris. */
function CelluleMontant({ value, muted }: { value: number | undefined; muted?: boolean }) {
  return <td className={cx("px-3 py-1.5 text-right font-mono", muted ? "text-muted" : (value ?? 0) < 0 && "text-danger")}>{fmtInt(value ?? 0)}</td>;
}

/**
 * Tableau d'un état au modèle du système normal : colonnes choisies (note, signe, lettre, brut,
 * amortissements, mois, net, % du CA, N-1), postes en retrait sous leur rubrique, totaux en gras ;
 * apres : lignes sans référence insérées après une rubrique (variation du BF du tableau des flux).
 */
function StatementTable({
  lines,
  columns,
  titres = {},
  apres = {},
  pied,
}: {
  lines: StatementLine[];
  columns: Colonne[];
  titres?: Partial<Record<Colonne, string>>;
  apres?: Record<string, ReactNode>;
  pied?: ReactNode;
}) {
  const cellule = (l: StatementLine, c: Colonne) => {
    switch (c) {
      case "note":
        return <td key={c} className="px-2 py-1.5 text-center text-xs text-muted">{l.note ?? ""}</td>;
      case "sign":
        return <td key={c} className="px-2 py-1.5 text-center font-mono text-muted">{l.sign ?? ""}</td>;
      case "letter":
        return <td key={c} className="px-2 py-1.5 text-center font-mono text-xs text-muted">{l.letter ?? ""}</td>;
      case "gross":
        return <CelluleMontant key={c} value={l.gross} />;
      case "depreciation":
        return <CelluleMontant key={c} value={l.depreciation} />;
      case "month":
        return <CelluleMontant key={c} value={l.month} />;
      case "amount":
        return <CelluleMontant key={c} value={l.amount} />;
      case "pct":
        return <td key={c} className="px-3 py-1.5 text-right font-mono text-muted">{l.pct_revenue === null || l.pct_revenue === undefined ? "–" : fmtPct(l.pct_revenue)}</td>;
      case "previous":
        return <CelluleMontant key={c} value={l.previous} muted />;
    }
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-[12.5px] font-medium text-muted">
            <th className="w-14 px-3 py-2 text-left">Réf.</th>
            <th className="px-3 py-2 text-left">Rubrique</th>
            {columns.map((c) => (
              <th key={c} className={cx("px-3 py-2", ["note", "sign", "letter"].includes(c) ? "w-12 text-center" : "text-right")}>
                {titres[c] ?? ENTETES[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {lines.map((l) => (
            <Fragment key={l.code}>
              <tr className={cx("border-b border-line/50", l.total && "bg-panel-2 font-semibold")}>
                <td className="px-3 py-1.5 font-mono text-xs text-muted">{l.code}</td>
                <td className={cx("px-3 py-1.5", l.detail && "pl-7 text-ink-2")}>{l.label}</td>
                {columns.map((c) => cellule(l, c))}
              </tr>
              {apres[l.code]}
            </Fragment>
          ))}
          {pied}
        </tbody>
      </table>
    </div>
  );
}

/** Ligne sans référence d'un état (variation du BF, contrôle de la trésorerie), alignée sur ses colonnes. */
function LigneLibre({ label, valeurs, colonnesTexte, fort, ton }: { label: string; valeurs: Array<number | undefined>; colonnesTexte: number; fort?: boolean; ton?: "danger" }) {
  return (
    <tr className={cx("border-b border-line/50", fort && "font-semibold", ton === "danger" && "text-danger")}>
      <td className="px-3 py-1.5" />
      <td className="px-3 py-1.5 italic">{label}</td>
      {Array.from({ length: colonnesTexte }, (_, i) => <td key={i} />)}
      {valeurs.map((v, i) => <CelluleMontant key={i} value={v} muted={i === valeurs.length - 1 && ton !== "danger"} />)}
    </tr>
  );
}

interface BalanceSheetData {
  actif: StatementLine[];
  passif: StatementLine[];
  difference: number;
  unmapped_accounts: Record<string, number>;
  previous: Previous;
}

function BalanceSheet({ scope }: { scope: string }) {
  const [date, setDate] = useState(todayIso());
  const { data, error, mutate } = useApi<BalanceSheetData>(`/finance/statements/balance-sheet?date=${date}&scope=${scope}`);
  const n1 = data ? `N-1 (${fmtDate(data.previous.date_to)})` : "N-1";
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <Field label="Arrêté au">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ExportButtons kind="bilan" query={`date_to=${date}&scope=${scope}`} modele={{ date, scope }} />
      </div>
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          {Math.abs(data.difference) >= 0.5 ? <Notice tone="danger">Bilan déséquilibré : écart de {fmtGNF(data.difference)}.</Notice> : <Notice tone="ok">Bilan équilibré au {fmtDate(date)}. Montants en GNF ; colonne N-1 : bilan à la clôture de l&apos;exercice précédent.</Notice>}
          {Math.abs(data.previous.difference ?? 0) >= 0.5 && <Notice tone="warn">Bilan N-1 déséquilibré : écart de {fmtGNF(data.previous.difference)}.</Notice>}
          <PreviousNotice previous={data.previous} quoi={`bilan au ${fmtDate(data.previous.date_to)}`} />
          {Object.keys(data.unmapped_accounts).length > 0 && <Notice tone="warn">Comptes hors états : {Object.keys(data.unmapped_accounts).join(", ")}.</Notice>}
          <Card title="Bilan actif" padded={false}>
            <StatementTable lines={data.actif} columns={["note", "gross", "depreciation", "amount", "previous"]} titres={{ previous: n1 }} />
          </Card>
          <Card title="Bilan passif" padded={false}>
            <StatementTable lines={data.passif} columns={["note", "amount", "previous"]} titres={{ previous: n1 }} />
          </Card>
        </>
      )}
    </div>
  );
}

function IncomeStatement({ scope }: { scope: string }) {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayIso());
  const { data, error, mutate } = useApi<{ lines: StatementLine[]; unmapped_accounts: Record<string, number>; previous?: Previous }>(
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
        <div className="ml-auto">
          <ExportButtons kind="resultat" query={`date_from=${from}&date_to=${to}&scope=${scope}`} modele={{ date: to, scope }} />
        </div>
      </div>
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <PreviousNotice previous={data.previous} quoi="compte de résultat" />
          <Card title="Compte de résultat (système normal)" padded={false}>
            <StatementTable
              lines={data.lines}
              columns={["sign", "note", "month", "amount", "pct", "previous"]}
              titres={{ amount: "Exercice", previous: data.previous ? `N-1 (${fmtDate(data.previous.date_from)} – ${fmtDate(data.previous.date_to)})` : "Exercice précédent" }}
            />
          </Card>
        </>
      )}
    </div>
  );
}

interface CashFlowData {
  lines: StatementLine[];
  bf: number;
  treasury_end: number;
  difference: number;
  previous: Previous;
}

function CashFlow({ scope }: { scope: string }) {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayIso());
  const { data, error, mutate } = useApi<CashFlowData>(`/finance/statements/cash-flow?date_from=${from}&date_to=${to}&scope=${scope}`);
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3">
        <Field label="Du">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Au">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="ml-auto flex flex-wrap gap-2">
          <ExportButtons kind="flux" query={`date_from=${from}&date_to=${to}&scope=${scope}`} modele={{ date: to, scope }} />
          <Telecharger chemin={`/finance/statements/export?kind=flux_mensuels&format=xlsx&date_from=${from}&date_to=${to}&scope=${scope}`} nom="flux_mensuels.xlsx">
            <Download className="h-3.5 w-3.5" /> Flux mensuels
          </Telecharger>
        </div>
      </div>
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          {Math.abs(data.difference) < 1 ? (
            <Notice tone="ok">Le tableau rejoint la trésorerie nette du bilan au {fmtDate(to)} : {fmtGNF(data.treasury_end)} (contrôle de ZH : trésorerie actif moins trésorerie passif).</Notice>
          ) : (
            <Notice tone="warn">
              Écart de {fmtGNF(data.difference)} avec la trésorerie nette du bilan ({fmtGNF(data.treasury_end)}) : écritures de
              reclassement ou intérêts courus à analyser avec l&apos;expert-comptable.
            </Notice>
          )}
          {Math.abs(data.previous.difference ?? 0) >= 1 && <Notice tone="warn">N-1 : écart de {fmtGNF(data.previous.difference)} entre la trésorerie nette de fin (ZH) et la trésorerie du bilan.</Notice>}
          <PreviousNotice previous={data.previous} quoi="tableau des flux" />
          <Card title="Tableau des flux de trésorerie (SYSCOHADA révisé)" padded={false}>
            <StatementTable
              lines={data.lines}
              columns={["letter", "amount", "previous"]}
              titres={{ amount: "Période", previous: `N-1 (${fmtDate(data.previous.date_from)} – ${fmtDate(data.previous.date_to)})` }}
              apres={{ FE: <LigneLibre key="bf" label="Variation du BF lié aux activités opérationnelles (FB + FC + FD + FE)" valeurs={[data.bf, data.previous.bf]} colonnesTexte={1} /> }}
              pied={
                <>
                  <LigneLibre label="Contrôle : trésorerie actif - trésorerie passif du bilan" valeurs={[data.treasury_end, data.previous.treasury_end]} colonnesTexte={1} fort />
                  {(Math.abs(data.difference) >= 1 || Math.abs(data.previous.difference ?? 0) >= 1) && (
                    <LigneLibre label="Écart : contrôle - trésorerie nette de fin (H)" valeurs={[data.difference, data.previous.difference]} colonnesTexte={1} fort ton="danger" />
                  )}
                </>
              }
            />
          </Card>
        </>
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
  /** Rang de la première ligne renvoyée (pages de PAGE_RAPPORT lignes). */
  offset: number;
}

function cell(value: unknown, type: string) {
  if (value === null || value === undefined || value === "") return "–";
  if (type === "money" || type === "int") return fmtInt(value);
  if (type === "date") return fmtDate(String(value));
  return String(value);
}

/** Lignes d'un rapport par page ; l'écran s'arrêtait à 2 000 lignes sans le dire, les exports vont plus loin. */
const PAGE_RAPPORT = 500;

function ReportBuilder({ scope }: { scope: string }) {
  const { data: catalog, error: erreurCatalogue, mutate: relireCatalogue } = useApi<{ groups: Array<{ name: string; reports: CatalogReport[] }> }>("/finance/reports/catalog");
  const reports = useMemo(() => catalog?.groups.flatMap((g) => g.reports) ?? [], [catalog]);
  const [key, setKey] = useState("balance");
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayIso());
  const [filters, setFilters] = useState<Record<string, string>>({});
  // Tiers choisis dans les filtres de type « tiers » : leur nom, pour le sélecteur.
  const [tiers, setTiers] = useState<Record<string, { id: number; name: string } | null>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const report = reports.find((r) => r.key === key);

  const criteres = () => ({ report: key, date_from: report?.has_date ? from : undefined, date_to: report?.has_date ? to : undefined, filters, scope });
  async function run(offset = 0) {
    setBusy(true);
    setError(null);
    try {
      setResult(await apiSend<RunResult>("POST", "/finance/reports/run", { ...criteres(), limit: PAGE_RAPPORT, offset }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  /** Export du rapport entier par le client commun (application et société de l'écran), en GET. */
  function exportPath(format: "csv" | "xlsx") {
    const c = criteres();
    const params = new URLSearchParams({ report: c.report, format, scope: c.scope, filters: JSON.stringify(c.filters) });
    if (c.date_from) params.set("date_from", c.date_from);
    if (c.date_to) params.set("date_to", c.date_to);
    return `/finance/reports/export?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      {erreurCatalogue && !catalog && <ErrorBox error={erreurCatalogue} onRetry={() => relireCatalogue()} />}
      <Card>
        <div className="no-print grid grid-cols-1 gap-3 md:grid-cols-6">
          <Field label="Rapport" className="md:col-span-2">
            <Select value={key} onChange={(e) => { setKey(e.target.value); setFilters({}); setTiers({}); setResult(null); }} options={reports.map((r) => ({ value: r.key, label: r.label }))} />
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
          {report?.filters.map((f) => (
            <Field key={f.key} label={f.label} className={f.type === "partner" ? "md:col-span-2" : undefined}>
              {f.type === "partner" ? (
                // Filtre « Tiers » : choix d'un tiers existant, sans création depuis un rapport.
                <PartnerPicker
                  creation={false}
                  kind="customer"
                  placeholder="Tous les tiers"
                  value={tiers[f.key] ?? null}
                  onChange={(p) => {
                    setTiers({ ...tiers, [f.key]: p });
                    setFilters({ ...filters, [f.key]: p ? String(p.id) : "" });
                  }}
                />
              ) : f.type === "select" ? (
                <Select value={filters[f.key] ?? ""} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} placeholder="Tous" options={f.options} />
              ) : (
                <Input value={filters[f.key] ?? ""} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
          <div className="flex items-end gap-2">
            <Button variant="primary" loading={busy} onClick={() => void run(0)}>
              Afficher
            </Button>
          </div>
        </div>
        {report && <p className="mt-2 text-xs text-muted">{report.description}</p>}
      </Card>
      {Boolean(error) && <ErrorBox error={error} onRetry={() => void run(result?.offset ?? 0)} />}
      {result && (
        <Card
          title={`${result.label}, ${pluriel(result.total_count, "ligne")}`}
          padded={false}
          actions={
            <div className="no-print flex gap-2">
              <Telecharger chemin={exportPath("csv")} nom={`${key}.csv`}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Telecharger>
              <Telecharger chemin={exportPath("xlsx")} nom={`${key}.xlsx`}>
                <Download className="h-3.5 w-3.5" /> XLSX
              </Telecharger>
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
                      {c.key in result.totals ? fmtInt(result.totals[c.key]) : i === 0 ? (result.total_count > result.rows.length ? "TOTAL (toutes les lignes)" : "TOTAL") : ""}
                    </td>
                  ))}
                </tr>
              ) : undefined
            }
          />
          <PagesListe offset={result.offset} taille={PAGE_RAPPORT} total={result.total_count} libelle="Lignes" onPage={(o) => void run(o)} />
        </Card>
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
        <Telecharger size="md" chemin={`/finance/exports/entries?date_from=${from}&date_to=${to}&scope=${scope}&format=csv`} nom="ecritures.csv">
          <Download className="h-4 w-4" /> CSV
        </Telecharger>
        <Telecharger size="md" variant="primary" chemin={`/finance/exports/entries?date_from=${from}&date_to=${to}&scope=${scope}&format=xlsx`} nom="ecritures.xlsx">
          <Download className="h-4 w-4" /> Excel
        </Telecharger>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-panel-2 p-4">
          <div className="mb-1 text-sm font-semibold">Grand livre</div>
          <p className="mb-3 text-xs text-muted">Par compte : report à nouveau, lignes avec activité et solde progressif, total du compte.</p>
          <ExportButtons kind="grand_livre" query={`date_from=${from}&date_to=${to}&scope=${scope}`} />
        </div>
        <div className="rounded-lg bg-panel-2 p-4">
          <div className="mb-1 text-sm font-semibold">Balance générale</div>
          <p className="mb-3 text-xs text-muted">Par classe : soldes d&apos;ouverture, mouvements, soldes débiteur et créditeur.</p>
          <ExportButtons kind="balance" query={`date_from=${from}&date_to=${to}&scope=${scope}`} />
        </div>
        <div className="rounded-lg bg-panel-2 p-4 md:col-span-2">
          <div className="mb-1 text-sm font-semibold">Fichier SAF-T (norme OCDE 2.0)</div>
          <p className="mb-3 text-xs text-muted">
            Société de travail : en-tête (NIF, RCCM), comptes avec soldes d&apos;ouverture et de clôture, clients et fournisseurs avec leur compte, table des taxes, une transaction par pièce.
          </p>
          <Telecharger disabled={scope === "group"} chemin={`/finance/exports/saft?date_from=${from}&date_to=${to}`} nom="SAF-T.xml">
            <Download className="h-3.5 w-3.5" /> SAF-T (XML)
          </Telecharger>
          {scope === "group" && <span className="ml-2 text-xs text-muted">Un fichier par société : quittez la vue consolidée.</span>}
        </div>
      </div>
    </Card>
  );
}

interface ConsolidatedRow { code: string; label: string; total: boolean; companies: number[]; eliminations: number; group: number }
interface ConsolidatedData {
  date_from: string;
  date_to: string;
  companies: Array<{ id: number; name: string }>;
  intra_group_partners: number;
  income: ConsolidatedRow[];
  balance: ConsolidatedRow[];
}

/** Vue consolidée : chaque société, éliminations des opérations entre sociétés du groupe, groupe. */
function Consolidated() {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(todayIso());
  const { data, error, mutate } = useApi<ConsolidatedData>(`/finance/statements/consolidated?date_from=${from}&date_to=${to}`);
  const table = (rows: ConsolidatedRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-[12.5px] font-medium text-muted">
            <th className="w-14 px-3 py-2 text-left">Réf.</th>
            <th className="px-3 py-2 text-left">Rubrique</th>
            {data!.companies.map((c) => <th key={c.id} className="px-3 py-2 text-right">{c.name}</th>)}
            <th className="px-3 py-2 text-right">Éliminations</th>
            <th className="px-3 py-2 text-right">Groupe</th>
          </tr>
        </thead>
        <tbody>
          {rows.filter((r) => r.total || r.group || r.companies.some(Boolean)).map((r) => (
            <tr key={r.code} className={cx("border-b border-line/60", r.total && "bg-panel-2 font-semibold")}>
              <td className="px-3 py-1.5 font-mono text-xs text-muted">{r.code}</td>
              <td className="px-3 py-1.5">{r.label}</td>
              {r.companies.map((v, i) => <td key={i} className="px-3 py-1.5 text-right tabular">{fmtGNF(v)}</td>)}
              <td className={cx("px-3 py-1.5 text-right tabular", Math.abs(r.eliminations) > 0.5 ? "text-warn" : "text-muted")}>{Math.abs(r.eliminations) > 0.5 ? fmtGNF(r.eliminations) : "–"}</td>
              <td className="px-3 py-1.5 text-right tabular">{fmtGNF(r.group)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <Notice tone="accent">
            Les opérations entre sociétés du groupe (ventes et achats réciproques, créances et dettes, comptes courants) s&apos;éliminent : {pluriel(data.intra_group_partners, "fiche de tiers représente", "fiches de tiers représentent")} les sociétés du groupe. Les frais communs refacturés s&apos;éliminent de même dès qu&apos;ils sont facturés entre sociétés.
          </Notice>
          <Card title={`Compte de résultat consolidé du ${fmtDate(data.date_from)} au ${fmtDate(data.date_to)}`} padded={false}>{table(data.income)}</Card>
          <Card title={`Bilan consolidé au ${fmtDate(data.date_to)}`} padded={false}>{table(data.balance)}</Card>
        </>
      )}
    </div>
  );
}
