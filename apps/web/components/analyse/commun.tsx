"use client";

/**
 * Briques communes des écrans de NIMOVA · Analyse : contexte de la société de travail, période et
 * date d'arrêté, en-tête de section (question, réponse, période, impression, mode nuit), cartes de
 * constats, chiffres clés du contrat, qualité des données, états vides, squelettes et garde de
 * société. Tout ce qui vient du noyau peut manquer ou valoir null : chaque brique s'en accommode.
 */

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, FileSpreadsheet, Info, Moon, Printer, ShieldAlert, Sparkles, Sun, TriangleAlert, type Icon } from "@/components/icons";
import { Badge, Button, Delta, Empty, Input, Kpi as KpiCarte, Notice, Segmented, Sparkline, Squelette, cx, type Teinte, type Tone } from "@/components/ui";
import { apiDownload, useApi } from "@/lib/api-client";
import type { Contexte, Evidence, Insight, Kpi, PeriodCode, Quality, Severity, Unit } from "@/lib/analyse-types";
import type { EntiteSociete } from "@/lib/config";
import { fmtDate, fmtGNF, fmtInt, fmtPct, fmtShort } from "@/lib/format";
import { COULEUR, fmtValeur, moisCourt } from "@/components/analyse/charts/commun";

/* ─── Valeurs tolérantes ───────────────────────────────────────────────── */

/** Nombre fini ou null. */
export function nombre(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Série sans trous : les null sont remplacés par la dernière valeur connue (0 avant la première). */
export function combler(values: Array<number | null | undefined>): number[] {
  let dernier = 0;
  return values.map((v) => {
    if (typeof v === "number" && Number.isFinite(v)) dernier = v;
    return dernier;
  });
}

/** Les seuls nombres d'une liste. */
export function nombres(values: Array<number | null | undefined> | undefined | null): number[] {
  return (values ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/** « 12,5 % » ou « – ». */
export function pctOu(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "–" : fmtPct(v, digits);
}

/** « 1,2 Mds GNF » ou « – ». */
export function gnfOu(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "–" : `${fmtShort(v)} GNF`;
}

/** « 38 j » ou « – ». */
export function joursOu(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "–" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: digits })} j`;
}

/** Pluriel simple. */
export function pluriel(n: number, un: string, plusieurs = `${un}s`): string {
  return `${fmtInt(n)} ${n > 1 ? plusieurs : un}`;
}

/* ─── Contexte ─────────────────────────────────────────────────────────── */

export function useContexte() {
  return useApi<Contexte>("/analyse/contexte", { dedupingInterval: 60_000 });
}

/* ─── Période ──────────────────────────────────────────────────────────── */

export interface Periode {
  code: Exclude<PeriodCode, "custom">;
  dateTo: string;
}

const PERIODES: Array<{ key: Periode["code"]; label: string }> = [
  { key: "ytd", label: "Exercice" },
  { key: "12m", label: "12 mois" },
  { key: "q", label: "Trimestre" },
  { key: "m", label: "Mois" },
];

const CLE_PERIODE = "nimova.analyse.periode";

/** Période et date d'arrêté, mémorisées pour toute la session d'analyse. */
export function usePeriode(): [Periode, (p: Partial<Periode>) => void, string] {
  const [periode, setPeriode] = useState<Periode>({ code: "ytd", dateTo: "" });
  useEffect(() => {
    try {
      const brut = window.sessionStorage.getItem(CLE_PERIODE);
      if (brut) {
        const p = JSON.parse(brut) as Periode;
        if (PERIODES.some((x) => x.key === p.code)) setPeriode({ code: p.code, dateTo: typeof p.dateTo === "string" ? p.dateTo : "" });
      }
    } catch {
      /* préférence non mémorisée */
    }
  }, []);
  const changer = useCallback((p: Partial<Periode>) => {
    setPeriode((courant) => {
      const suivant = { ...courant, ...p };
      try {
        window.sessionStorage.setItem(CLE_PERIODE, JSON.stringify(suivant));
      } catch {
        /* rien à garder */
      }
      return suivant;
    });
  }, []);
  const query = `?period=${periode.code}${periode.dateTo ? `&date_to=${periode.dateTo}` : ""}`;
  return [periode, changer, query];
}

/* ─── Mode nuit ────────────────────────────────────────────────────────── */

const CLE_THEME = "nimova.analyse.theme";
const ThemeContexte = createContext<{ sombre: boolean; basculer: () => void }>({ sombre: false, basculer: () => undefined });

/** Cockpit sombre ou clair, au choix de l'utilisateur ; les graphiques suivent les jetons. */
export function FournisseurTheme({ children }: { children: ReactNode }) {
  const [sombre, setSombre] = useState(false);
  useEffect(() => {
    try {
      setSombre(window.localStorage.getItem(CLE_THEME) === "sombre");
    } catch {
      /* thème clair */
    }
  }, []);
  const basculer = useCallback(() => {
    setSombre((s) => {
      try {
        window.localStorage.setItem(CLE_THEME, s ? "clair" : "sombre");
      } catch {
        /* rien à garder */
      }
      return !s;
    });
  }, []);
  const valeur = useMemo(() => ({ sombre, basculer }), [sombre, basculer]);
  return (
    <ThemeContexte.Provider value={valeur}>
      <div data-theme={sombre ? "sombre" : undefined} className={cx("an-page -m-4 min-h-[calc(100vh-4rem)] p-4 transition-colors duration-300 sm:-m-6 sm:p-6 md:-my-8 md:py-8 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10", sombre && "bg-bg text-ink")}>
        {children}
      </div>
    </ThemeContexte.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContexte);
}

/* ─── En-tête de section ───────────────────────────────────────────────── */

/**
 * Titre en forme de question, réponse en une phrase, sélecteur de période et date d'arrêté,
 * impression et mode nuit. La réponse arrive avec les données : un squelette la précède.
 */
/** En-tête d'une section. exporter : chemin du classeur Excel de la section (même période). */
export function EnTeteSection({ question, reponse, periode, onPeriode, label, quality, sousTitre, exporter }: { question: string; reponse?: ReactNode; periode: Periode; onPeriode: (p: Partial<Periode>) => void; label?: string; quality?: Quality; sousTitre?: ReactNode; exporter?: string }) {
  const { sombre, basculer } = useTheme();
  const [exportEnCours, setExportEnCours] = useState(false);
  async function exporterClasseur() {
    if (!exporter) return;
    setExportEnCours(true);
    try {
      const nom = (exporter.split("?")[0] ?? exporter).replace(/^\/analyse\//, "analyse_").replaceAll("/", "_");
      await apiDownload(exporter, nom);
    } finally {
      setExportEnCours(false);
    }
  }
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-[62ch]">
          <h1 className="text-[26px] font-[680] leading-[1.12] text-ink sm:text-[30px]">{question}</h1>
          {reponse !== undefined ? (
            <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{reponse}</p>
          ) : (
            <div aria-hidden className="mt-3 space-y-2">
              <Squelette className="h-3.5 w-[92%] rounded-full" />
              <Squelette className="h-3.5 w-[64%] rounded-full" />
            </div>
          )}
          {(label || sousTitre || quality) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
              {label && <span>{label}</span>}
              {sousTitre}
              {quality && <QualiteDonnees quality={quality} />}
            </div>
          )}
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Segmented label="Période" value={periode.code} onChange={(code) => onPeriode({ code })} options={PERIODES} />
          <label className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
            <span className="hidden sm:inline">Arrêté au</span>
            <Input type="date" aria-label="Date d'arrêté" value={periode.dateTo} max={new Date().toISOString().slice(0, 10)} onChange={(e) => onPeriode({ dateTo: e.target.value })} className="w-[150px]" />
          </label>
          <Button onClick={basculer} aria-pressed={sombre} title={sombre ? "Repasser en clair" : "Mode nuit"} className="px-2.5">
            {sombre ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span className="sr-only">{sombre ? "Mode clair" : "Mode nuit"}</span>
          </Button>
          {exporter && (
            <Button onClick={exporterClasseur} loading={exportEnCours} title="Toutes les données de l'écran dans un classeur Excel">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
          )}
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Pastille de qualité des données : score et réserves au survol, réserves dépliables. */
export function QualiteDonnees({ quality }: { quality: Quality }) {
  const [ouvert, setOuvert] = useState(false);
  const notes = quality.notes ?? [];
  const tone: Tone = quality.score >= 90 ? "ok" : quality.score >= 70 ? "warn" : "danger";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={tone}>Qualité des données {Math.round(quality.score)} / 100</Badge>
      {notes.length > 0 && (
        <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert} className="no-print inline-flex items-center gap-1 font-semibold text-muted hover:text-ink">
          {notes.length} réserve{notes.length > 1 ? "s" : ""}
          <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", ouvert && "rotate-180")} />
        </button>
      )}
      {ouvert && (
        <ul className="n-apparaitre basis-full list-disc space-y-0.5 pl-5 pt-1 text-[12px] leading-snug text-ink-2">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </span>
  );
}

/* ─── Garde de société ─────────────────────────────────────────────────── */

/** Les sections d'une société ne s'ouvrent que dans ses livres : sinon, on explique et on oriente. */
export function GardeSociete({ attendu, contexte, children }: { attendu: EntiteSociete; contexte: Contexte | undefined; children: ReactNode }) {
  if (!contexte) return <AttenteSection />;
  if (contexte.entity === attendu) return <>{children}</>;
  const nom = attendu === "groupe" ? "EGUITRA GROUP SARLU" : "MB AxisPro";
  return (
    <div className="mx-auto max-w-2xl py-10">
      <Notice tone="accent">
        <p className="font-semibold">Cette analyse concerne {nom}.</p>
        <p className="mt-1">
          Vous travaillez dans les livres de {contexte.company.name}. {contexte.can_switch ? "Choisissez l'autre société dans la colonne de gauche pour ouvrir cette section, ou " : "Votre compte n'est pas ouvert à cette société ; "}
          <Link href="/analyse" className="font-semibold text-accent underline underline-offset-2">
            revenez au cockpit
          </Link>
          .
        </p>
      </Notice>
    </div>
  );
}

/* ─── Attente, erreurs, vides ──────────────────────────────────────────── */

export function AttenteSection() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Calcul des analyses…</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Squelette key={i} className="h-[118px]" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-12">
        <Squelette className="h-[340px] xl:col-span-7" />
        <Squelette className="h-[340px] xl:col-span-5" />
      </div>
      <Squelette className="h-[260px]" />
    </div>
  );
}

/** État vide d'un bloc : ce qui manque et, si l'on sait, ce qu'il faut saisir pour le voir. */
export function Vide({ titre, hint, compact }: { titre: string; hint?: string; compact?: boolean }) {
  if (compact) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong/60 bg-panel-2/50 px-4 py-5 text-center text-[13px] text-muted">
        {titre}
        {hint && <span className="mt-1 block text-[12px]">{hint}</span>}
      </p>
    );
  }
  return <Empty title={titre} hint={hint} />;
}

/* ─── Constats ─────────────────────────────────────────────────────────── */

export const GRAVITE: Record<Severity, { label: string; tone: Tone; teinte: Teinte; icon: Icon; couleur: string }> = {
  critical: { label: "Critique", tone: "danger", teinte: "danger", icon: ShieldAlert, couleur: "var(--danger-vif)" },
  high: { label: "Élevée", tone: "danger", teinte: "corail", icon: TriangleAlert, couleur: "var(--g-corail)" },
  medium: { label: "Moyenne", tone: "warn", teinte: "ambre", icon: AlertTriangle, couleur: "var(--warn-vif)" },
  info: { label: "À noter", tone: "accent", teinte: "azur", icon: Info, couleur: "var(--g-azur)" },
  positive: { label: "Point fort", tone: "ok", teinte: "jade", icon: CheckCircle2, couleur: "var(--g-jade)" },
};

const DOMAINES: Record<string, string> = {
  rentabilite: "Rentabilité",
  tresorerie: "Trésorerie",
  clients: "Clients",
  transport: "Transport",
  depenses: "Dépenses",
  previsions: "Prévisions",
  fiabilite: "Fiabilité",
  portefeuille: "Portefeuille",
  diagnostic: "Diagnostic",
  comites: "Comités",
  financements: "Financements",
  activite: "Activité",
  risques: "Risques",
};

/** Confiance d'un constat : cinq segments allumés en proportion. */
function Confiance({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, nombre(value) ?? 0));
  const n = Math.round(v * 5);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted" title={`Confiance ${Math.round(v * 100)} %`}>
      <span aria-hidden className="inline-flex gap-[2px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={cx("h-2 w-[7px] rounded-[2px]", i < n ? "bg-accent-vif" : "bg-line-strong/50")} />
        ))}
      </span>
      Confiance {Math.round(v * 100)} %
    </span>
  );
}

/** Évidence ramenée à une forme simple, quelle que soit la règle qui l'a produite. */
export type EvidenceNormalisee =
  | { type: "bars"; labels: string[]; values: number[]; highlight?: number }
  | { type: "series"; labels: string[]; values: number[]; reference?: number }
  | { type: "scatter"; points: Array<{ x: number; y: number; highlight?: boolean }> }
  | { type: "table"; columns: string[]; rows: Array<Array<string | number>> };

type Dict = Record<string, unknown>;
const estDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texte = (v: unknown, defaut = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : defaut);

/**
 * Les règles du noyau produisent des évidences de formes variées (barres par clients, marches d'un
 * pont, chiffres de Benford, semaines de trésorerie, paires de doublons…) : on les ramène ici à
 * quatre formes dessinables. Une forme inconnue ne dessine rien.
 */
export function normaliserEvidence(e: Evidence | null | undefined): EvidenceNormalisee | null {
  if (!e || !estDict(e.data)) return null;
  const d = e.data;
  try {
    if (e.type === "bars") {
      if (Array.isArray(d.labels) && Array.isArray(d.values)) {
        const values = liste(d.values).map((v) => nombre(v) ?? 0);
        return { type: "bars", labels: liste(d.labels).map((l) => texte(l)), values, highlight: typeof d.highlight === "number" ? d.highlight : undefined };
      }
      if (Array.isArray(d.clients)) {
        const c = liste(d.clients).filter(estDict);
        return { type: "bars", labels: c.map((x) => texte(x.name)), values: c.map((x) => nombre(x.revenue) ?? 0), highlight: 0 };
      }
      if (Array.isArray(d.steps)) {
        const s = liste(d.steps).filter(estDict).filter((x) => x.kind !== "total");
        const values = s.map((x) => nombre(x.value) ?? 0);
        const pire = values.reduce((m, v, i) => (v < (values[m] ?? 0) ? i : m), 0);
        return { type: "bars", labels: s.map((x) => texte(x.label)), values, highlight: pire };
      }
      if (Array.isArray(d.digits)) {
        const g = liste(d.digits).filter(estDict);
        const excess = g.findIndex((x) => x.excess === true);
        return { type: "bars", labels: g.map((x) => texte(x.d)), values: g.map((x) => nombre(x.observed) ?? 0), highlight: excess >= 0 ? excess : undefined };
      }
    }
    if (e.type === "series") {
      if (Array.isArray(d.values)) {
        const values = combler(liste(d.values).map(nombre));
        const labels = Array.isArray(d.labels) ? liste(d.labels).map((l) => texte(l)) : Array.isArray(d.months) ? liste(d.months).map((m) => moisCourt(texte(m))) : values.map((_, i) => String(i + 1));
        return { type: "series", labels, values, reference: nombre(d.reference) ?? undefined };
      }
      if (Array.isArray(d.series)) {
        const s = liste(d.series).filter(estDict);
        return { type: "series", labels: s.map((x) => moisCourt(texte(x.month))), values: combler(s.map((x) => nombre(x.actual) ?? nombre(x.forecast))) };
      }
      if (Array.isArray(d.weeks)) {
        const w = liste(d.weeks).filter(estDict);
        return { type: "series", labels: w.map((x) => `S${texte(x.week)}`), values: combler(w.map((x) => nombre(x.p50) ?? nombre(x.balance_p50))), reference: nombre(d.threshold) ?? undefined };
      }
      if (Array.isArray(d.monthly_actuals)) {
        const values = combler(liste(d.monthly_actuals).map(nombre));
        return { type: "series", labels: values.map((_, i) => String(i + 1)), values };
      }
    }
    if (e.type === "scatter" && Array.isArray(d.points)) {
      const p = liste(d.points).filter(estDict);
      const points = p
        .map((x) => ({ x: nombre(x.x) ?? nombre(x.revenue), y: nombre(x.y) ?? nombre(x.charges), highlight: x.highlight === true || x.excluded === true }))
        .filter((x): x is { x: number; y: number; highlight: boolean } => x.x !== null && x.y !== null);
      return points.length ? { type: "scatter", points } : null;
    }
    if (e.type === "table") {
      if (Array.isArray(d.columns) && Array.isArray(d.rows)) {
        return { type: "table", columns: liste(d.columns).map((c) => texte(c)), rows: liste(d.rows).map((r) => liste(r).map((c) => (typeof c === "number" ? c : texte(c, "–")))) };
      }
      if (estDict(d.route)) {
        const r = d.route;
        return { type: "table", columns: ["Tarif", "GNF/m³"], rows: [["Tarif moyen", fmtInt(nombre(r.avg_rate))], ["Point mort", fmtInt(nombre(r.breakeven_rate))], ["Tarif cible", fmtInt(nombre(r.target_rate))]] };
      }
      if (Array.isArray(d.rotations)) {
        return { type: "table", columns: ["Rotation", "L/100 km", "Attendu"], rows: liste(d.rotations).filter(estDict).slice(0, 4).map((r) => [texte(r.rotation), (nombre(r.value) ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 }), (nombre(r.expected) ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })]) };
      }
      if (Array.isArray(d.pairs)) {
        return { type: "table", columns: ["Fournisseur", "Pièces", "Montant"], rows: liste(d.pairs).filter(estDict).slice(0, 4).map((p) => [texte(p.partner), `${texte(estDict(p.a) ? p.a.name : "")} / ${texte(estDict(p.b) ? p.b.name : "")}`, fmtShort(nombre(p.amount_at_risk))]) };
      }
      if (Array.isArray(d.lines)) {
        return { type: "table", columns: ["Pièce", "Tiers", "Montant"], rows: liste(d.lines).filter(estDict).slice(0, 4).map((l) => [texte(l.move), texte(l.partner, "–"), fmtShort(nombre(l.amount))]) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Mini-évidence d'un constat : barres, série, nuage ou table, en 54 px de haut. */
export function MiniEvidence({ evidence, severity }: { evidence: Evidence | null | undefined; severity: Severity }) {
  const n = normaliserEvidence(evidence);
  if (!n) return null;
  const couleur = GRAVITE[severity]?.couleur ?? GRAVITE.info.couleur;
  const W = 240;
  const H = 54;
  if (n.type === "bars") {
    const max = Math.max(1, ...n.values.map(Math.abs));
    const bw = W / Math.max(1, n.values.length);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[54px] w-full" aria-hidden focusable="false">
        {n.values.map((v, i) => {
          const h = Math.max(2, (Math.abs(v) / max) * (H - 14));
          const neg = v < 0;
          return (
            <g key={i}>
              <rect x={i * bw + bw * 0.18} y={neg ? H - 14 : H - 14 - h} width={bw * 0.64} height={h} rx={2.5} fill={n.highlight === i ? couleur : neg ? "var(--danger-vif)" : "var(--line-strong)"} className="an-barre" style={{ "--i": i } as CSSProperties} />
              {n.values.length <= 9 && (
                <text x={i * bw + bw / 2} y={H - 2} textAnchor="middle" fontSize={8.5} fill="var(--muted)">
                  {(n.labels[i] ?? "").slice(0, Math.max(3, Math.floor(bw / 5)))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }
  if (n.type === "series") {
    const tous = n.reference !== undefined ? [...n.values, n.reference] : n.values;
    if (!n.values.length) return null;
    const lo = Math.min(...tous);
    const hi = Math.max(...tous);
    const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
    const x = (i: number) => (n.values.length <= 1 ? W / 2 : (i / (n.values.length - 1)) * (W - 8) + 4);
    const d = n.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[54px] w-full" aria-hidden focusable="false">
        {n.reference !== undefined && <line x1={0} x2={W} y1={y(n.reference)} y2={y(n.reference)} stroke="var(--line-strong)" strokeDasharray="3 3" />}
        <path d={`${d} L${x(n.values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`} fill={couleur} fillOpacity={0.14} className="an-fondu" />
        <path d={d} fill="none" stroke={couleur} strokeWidth={2} strokeLinecap="round" pathLength={1} className="an-tracer" />
        <circle cx={x(n.values.length - 1)} cy={y(n.values[n.values.length - 1] ?? 0)} r={3.2} fill={couleur} stroke="var(--panel)" strokeWidth={1.5} />
      </svg>
    );
  }
  if (n.type === "scatter") {
    const xs = n.points.map((p) => p.x);
    const ys = n.points.map((p) => p.y);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[54px] w-full" aria-hidden focusable="false">
        <line x1={0} x2={W} y1={H - 4} y2={H - 4} stroke="var(--line)" />
        {n.points.map((p, i) => (
          <circle key={i} cx={6 + ((p.x - x0) / (x1 - x0 || 1)) * (W - 12)} cy={H - 8 - ((p.y - y0) / (y1 - y0 || 1)) * (H - 14)} r={p.highlight ? 4 : 3} fill={p.highlight ? couleur : "var(--line-strong)"} fillOpacity={p.highlight ? 0.95 : 0.8} className="an-eclore" style={{ "--i": i } as CSSProperties} />
        ))}
      </svg>
    );
  }
  if (!n.rows.length) return null;
  return (
    <table className="w-full text-[11px] tabular">
      <tbody>
        {n.rows.slice(0, 3).map((r, i) => (
          <tr key={i} className="border-b border-line/60 last:border-0">
            {r.slice(0, 4).map((c, j) => (
              <td key={j} className={cx("max-w-[120px] truncate py-0.5", j > 0 && "text-right text-ink-2")}>
                {typeof c === "number" ? c.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Valeur d'une métrique de constat, dans son unité. */
export function valeurMetrique(value: number | null, unit: Unit): string {
  if (value === null || !Number.isFinite(value)) return "–";
  return unit === "gnf" ? `${fmtShort(value)} GNF` : unit === "ratio" && Math.abs(value) < 1 ? value.toLocaleString("fr-FR", { maximumFractionDigits: 4 }) : fmtValeur(value, unit);
}

/**
 * Carte de constat : gravité, domaine, titre, récit, métrique face à sa référence, impact en GNF,
 * confiance, mini-évidence, action et lien ; « Pourquoi ce constat ? » déplie la méthode.
 */
export function CarteConstat({ insight, compact, rang }: { insight: Insight; compact?: boolean; rang?: number }) {
  const g = GRAVITE[insight.severity] ?? GRAVITE.info;
  const [ouvert, setOuvert] = useState(false);
  const I = g.icon;
  const evidence = normaliserEvidence(insight.evidence);
  const metric = insight.metric && insight.metric.value !== null ? insight.metric : null;
  const impact = nombre(insight.impact_gnf);
  return (
    <article className={cx("an-carte n-levable relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--ombre-carte)]", compact ? "p-4" : "p-5")} style={{ "--i": rang ?? 0 } as CSSProperties}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: g.couleur }} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-[9px]" style={{ background: `color-mix(in oklab, ${g.couleur} 16%, var(--panel))`, color: g.couleur }}>
            <I className="h-4 w-4" />
          </span>
          <Badge tone={g.tone}>{g.label}</Badge>
          <span className="truncate rounded-md bg-panel-3 px-1.5 py-px text-[11.5px] font-medium text-ink-2">{DOMAINES[insight.domain] ?? insight.domain}</span>
        </div>
        {impact !== null && impact > 0 && (
          <span className="flex-none text-right">
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Impact</span>
            <span className="block font-display text-[15px] font-bold leading-tight tabular text-ink">{fmtShort(impact)} GNF</span>
          </span>
        )}
      </div>
      <h3 className="mt-3 text-[15.5px] font-semibold leading-snug text-ink">{insight.title}</h3>
      <p className={cx("mt-1.5 text-[13px] leading-relaxed text-ink-2", compact && "line-clamp-3")}>{insight.narrative}</p>
      {(metric || evidence) && (
        <div className={cx("mt-3 grid items-end gap-3", metric && evidence ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1")}>
          {metric && (
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium text-muted">{metric.label}</div>
              <div className={cx("font-display text-[22px] font-bold leading-none tabular", insight.severity === "critical" || insight.severity === "high" ? "text-danger" : insight.severity === "positive" ? "text-ok-texte" : "text-ink")}>{valeurMetrique(metric.value, metric.unit)}</div>
              {metric.reference !== null && (
                <div className="mt-0.5 text-[11.5px] text-muted">
                  {metric.reference_label ?? "Référence"} : <span className="font-semibold tabular text-ink-2">{valeurMetrique(metric.reference, metric.unit)}</span>
                </div>
              )}
            </div>
          )}
          {evidence && (
            <div className="min-w-0 rounded-xl bg-panel-2/70 px-2.5 pb-1 pt-2">
              <MiniEvidence evidence={insight.evidence} severity={insight.severity} />
            </div>
          )}
        </div>
      )}
      {insight.action && (
        <p className="mt-3 flex gap-2 rounded-xl border border-accent/15 bg-accent-doux/60 px-3 py-2 text-[12.5px] leading-snug text-ink">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" />
          <span>
            <span className="font-semibold">Action : </span>
            {insight.action}
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <Confiance value={insight.confidence} />
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert} className="no-print inline-flex items-center gap-1 text-[12px] font-semibold text-muted transition-colors hover:text-ink">
            Pourquoi ce constat ?
            <ChevronDown className={cx("h-3.5 w-3.5 transition-transform duration-200", ouvert && "rotate-180")} />
          </button>
          {insight.link && (
            <Link href={insight.link} className="no-print inline-flex items-center gap-1 text-[12px] font-semibold text-accent hover:underline">
              Voir <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
      {ouvert && (
        <div className="n-apparaitre mt-2 rounded-xl border border-line bg-panel-2/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">Méthode : </span>
          {insight.method || "Règle métier documentée dans la spécification."}
          <span className="mt-1 block text-[11.5px] text-muted">
            Identifiant {insight.id}
            {typeof insight.score === "number" ? ` · score ${insight.score.toLocaleString("fr-FR")}` : ""}
          </span>
        </div>
      )}
    </article>
  );
}

/** Grille de constats, les plus graves d'abord (l'API les a déjà classés) ; un même constat peut revenir. */
export function Constats({ insights, titre = "Constats remarquables", colonnes = 3, compact }: { insights: Insight[] | undefined | null; titre?: string; colonnes?: 2 | 3; compact?: boolean }) {
  const liste = insights ?? [];
  const graves = liste.filter((i) => i.severity === "critical" || i.severity === "high").length;
  const forts = liste.filter((i) => i.severity === "positive").length;
  return (
    <section aria-label={titre}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[16.5px] font-semibold text-ink">{titre}</h2>
        {liste.length > 0 && (
          <span className="text-[12.5px] text-muted">
            {graves} à traiter · {forts} point{forts > 1 ? "s" : ""} fort{forts > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {liste.length === 0 ? (
        <Vide compact titre="Aucun constat sur la période." hint="Les règles n'ont rien relevé d'anormal, ou les données manquent pour les appliquer." />
      ) : (
        <div className={cx("n-cascade grid gap-4", colonnes === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2")}>
          {liste.map((i, k) => (
            <CarteConstat key={`${i.id}-${k}`} insight={i} compact={compact} rang={k} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── Chiffres clés ────────────────────────────────────────────────────── */

const STATUT: Record<Kpi["status"], Tone> = { good: "ok", warn: "warn", bad: "danger", neutral: "neutral" };

/** Carte de chiffre clé du contrat : valeur, variation N-1, cible, tendance 12 mois, définition au survol. */
export function KpiContrat({ kpi, icon, teinte }: { kpi: Kpi; icon?: Icon; teinte?: Teinte }) {
  const cible = kpi.target !== null ? `cible ${fmtValeur(kpi.target, kpi.unit)}` : null;
  const ref = kpi.previous !== null && (kpi.previous !== 0 || kpi.delta_pct !== null) ? `N-1 ${fmtValeur(kpi.previous, kpi.unit)}` : null;
  const tendance = nombres(kpi.trend);
  const statut = STATUT[kpi.status] ?? "neutral";
  return (
    <div title={kpi.definition} className={cx("min-w-0", tendance.length > 1 && "kpi-avec-tendance overflow-hidden rounded-[20px] bg-panel shadow-[var(--ombre-feuille)]")}>
      <KpiCarte label={kpi.label} value={kpi.value === null ? "–" : fmtValeur(kpi.value, kpi.unit)} tone={statut} icon={icon} teinte={teinte} delta={kpi.delta_pct} inverse={kpi.inverse} hint={[ref, cible].filter(Boolean).join(" · ") || (kpi.value === null ? "Non calculable sur la période" : kpi.definition)} />
      {tendance.length > 1 && (
        <div className="px-5 pb-3">
          <Sparkline values={tendance} color={statut === "danger" ? COULEUR.mauvais : statut === "warn" ? COULEUR.alerte : COULEUR.accent} height={32} />
        </div>
      )}
    </div>
  );
}

/** Bande de chiffres clés compacte (une ligne par indicateur), pour les sections. */
export function LigneKpi({ kpis }: { kpis: Kpi[] }) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => (
        <li key={k.key} title={k.definition} className="an-carte flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3.5 py-2.5">
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium text-muted">{k.label}</span>
            <span className={cx("block font-display text-[19px] font-bold leading-tight tabular", k.status === "bad" ? "text-danger" : "text-ink")}>{k.value === null ? "–" : fmtValeur(k.value, k.unit)}</span>
          </span>
          <span className="flex flex-col items-end gap-1">
            <Delta value={k.delta_pct} inverse={k.inverse} />
            {k.target !== null && <span className="text-[11px] text-muted">cible {fmtValeur(k.target, k.unit)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ─── Divers ───────────────────────────────────────────────────────────── */

/** Petit bloc chiffré d'une carte : libellé, valeur, précision. */
export function Chiffre({ label, value, hint, tone, grand }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "warn" | "ok"; grand?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className={cx("mt-1 font-display font-bold leading-tight tabular", grand ? "text-[24px]" : "text-[19px]", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok-texte" : "text-ink")}>{value}</div>
      {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

/** Lien discret vers un autre écran. */
export function LienEcran({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="no-print inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
      {children} <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/** Lien vers une fiche (dossier AxisPro, écran de la finance) quand le noyau en donne un. */
export function LienFiche({ href, children, className }: { href?: string | null; children: ReactNode; className?: string }) {
  return href ? (
    <Link href={href} className={cx("font-medium text-ink hover:text-accent", className)}>
      {children}
    </Link>
  ) : (
    <span className={cx("font-medium text-ink", className)}>{children}</span>
  );
}

export { fmtDate, fmtGNF, fmtInt, fmtPct, fmtShort, fmtValeur, moisCourt };
