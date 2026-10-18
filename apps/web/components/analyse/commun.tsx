"use client";

/**
 * Briques communes des écrans de NIMOVA · Analyse : contexte de la société de travail, période et
 * date d'arrêté, en-tête de section (question, réponse, période, impression, mode nuit), cartes de
 * constats, chiffres clés du contrat, qualité des données, squelettes et garde de société.
 */

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, Info, Moon, Printer, ShieldAlert, Sparkles, Sun, TriangleAlert, type Icon } from "@/components/icons";
import { Badge, Button, Delta, Input, Kpi as KpiCarte, Notice, Segmented, Sparkline, Squelette, cx, type Teinte, type Tone } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import type { Contexte, Evidence, Insight, Kpi, PeriodCode, Quality, Severity, Unit } from "@/lib/analyse-types";
import type { EntiteSociete } from "@/lib/config";
import { fmtDate, fmtGNF, fmtInt, fmtPct, fmtShort } from "@/lib/format";
import { COULEUR, fmtValeur, moisCourt } from "@/components/analyse/charts/commun";

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
export function EnTeteSection({ question, reponse, periode, onPeriode, label, quality, sousTitre }: { question: string; reponse?: ReactNode; periode: Periode; onPeriode: (p: Partial<Periode>) => void; label?: string; quality?: Quality; sousTitre?: ReactNode }) {
  const { sombre, basculer } = useTheme();
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
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Pastille de qualité des données : score et notes au survol. */
export function QualiteDonnees({ quality }: { quality: Quality }) {
  const tone: Tone = quality.score >= 90 ? "ok" : quality.score >= 75 ? "warn" : "danger";
  return (
    <span title={quality.notes.join("\n") || "Aucune réserve"} className="inline-flex items-center gap-1.5">
      <Badge tone={tone}>Qualité des données {quality.score} / 100</Badge>
      {quality.notes.length > 0 && <span className="hidden sm:inline">{quality.notes.length} réserve{quality.notes.length > 1 ? "s" : ""}</span>}
    </span>
  );
}

/* ─── Garde de société ─────────────────────────────────────────────────── */

/** Les sections d'une société ne s'ouvrent que dans ses livres : sinon, on explique et on oriente. */
export function GardeSociete({ attendu, contexte, children }: { attendu: EntiteSociete; contexte: Contexte | undefined; children: ReactNode }) {
  if (!contexte) return <AttenteSection />;
  if (contexte.entity === attendu) return <>{children}</>;
  const nom = attendu === "groupe" ? "EGUITRA GROUP SARLU" : "MB AxisPro Consulting";
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

/* ─── Attente et erreurs ───────────────────────────────────────────────── */

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
  const n = Math.round(value * 5);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted" title={`Confiance ${Math.round(value * 100)} %`}>
      <span aria-hidden className="inline-flex gap-[2px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={cx("h-2 w-[7px] rounded-[2px]", i < n ? "bg-accent-vif" : "bg-line-strong/50")} />
        ))}
      </span>
      Confiance {Math.round(value * 100)} %
    </span>
  );
}

/** Mini-évidence d'un constat : barres, série, nuage ou table, en 48 px de haut. */
export function MiniEvidence({ evidence, severity }: { evidence: Evidence; severity: Severity }) {
  const couleur = GRAVITE[severity].couleur;
  const W = 240;
  const H = 54;
  if (evidence.type === "bars") {
    const { labels, values, highlight } = evidence.data;
    const max = Math.max(1, ...values.map(Math.abs));
    const bw = W / Math.max(1, values.length);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[54px] w-full" aria-hidden focusable="false">
        {values.map((v, i) => {
          const h = Math.max(2, (Math.abs(v) / max) * (H - 14));
          const neg = v < 0;
          return (
            <g key={i}>
              <rect x={i * bw + bw * 0.18} y={neg ? H - 14 : H - 14 - h} width={bw * 0.64} height={h} rx={2.5} fill={highlight === i ? couleur : "var(--line-strong)"} className="an-barre" style={{ "--i": i } as CSSProperties} />
              {values.length <= 9 && (
                <text x={i * bw + bw / 2} y={H - 2} textAnchor="middle" fontSize={8.5} fill="var(--muted)">
                  {labels[i]?.slice(0, Math.max(3, Math.floor(bw / 5)))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }
  if (evidence.type === "series") {
    const { values, reference } = evidence.data;
    const tous = reference !== undefined ? [...values, reference] : values;
    const lo = Math.min(...tous);
    const hi = Math.max(...tous);
    const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
    const x = (i: number) => (values.length <= 1 ? W / 2 : (i / (values.length - 1)) * (W - 8) + 4);
    const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[54px] w-full" aria-hidden focusable="false">
        {reference !== undefined && <line x1={0} x2={W} y1={y(reference)} y2={y(reference)} stroke="var(--line-strong)" strokeDasharray="3 3" />}
        <path d={`${d} L${x(values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`} fill={couleur} fillOpacity={0.14} className="an-fondu" />
        <path d={d} fill="none" stroke={couleur} strokeWidth={2} strokeLinecap="round" pathLength={1} className="an-tracer" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1] ?? 0)} r={3.2} fill={couleur} stroke="var(--panel)" strokeWidth={1.5} />
      </svg>
    );
  }
  if (evidence.type === "scatter") {
    const pts = evidence.data.points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[54px] w-full" aria-hidden focusable="false">
        <line x1={0} x2={W} y1={H - 4} y2={H - 4} stroke="var(--line)" />
        {pts.map((p, i) => (
          <circle key={i} cx={6 + ((p.x - x0) / (x1 - x0 || 1)) * (W - 12)} cy={H - 8 - ((p.y - y0) / (y1 - y0 || 1)) * (H - 14)} r={p.highlight ? 4 : 3} fill={p.highlight ? couleur : "var(--line-strong)"} fillOpacity={p.highlight ? 0.95 : 0.8} className="an-eclore" style={{ "--i": i } as CSSProperties} />
        ))}
      </svg>
    );
  }
  return (
    <table className="w-full text-[11px] tabular">
      <tbody>
        {evidence.data.rows.slice(0, 3).map((r, i) => (
          <tr key={i} className="border-b border-line/60 last:border-0">
            {r.map((c, j) => (
              <td key={j} className={cx("py-0.5", j > 0 && "text-right text-ink-2")}>
                {String(c)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Valeur d'une métrique de constat, dans son unité. */
export function valeurMetrique(value: number, unit: Unit): string {
  return unit === "gnf" ? `${fmtShort(value)} GNF` : fmtValeur(value, unit);
}

/**
 * Carte de constat : gravité, domaine, titre, récit, métrique face à sa référence, impact en GNF,
 * confiance, mini-évidence, action et lien ; « Pourquoi ce constat ? » déplie la méthode.
 */
export function CarteConstat({ insight, compact, rang }: { insight: Insight; compact?: boolean; rang?: number }) {
  const g = GRAVITE[insight.severity] ?? GRAVITE.info;
  const [ouvert, setOuvert] = useState(false);
  const I = g.icon;
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
        {insight.impact_gnf !== null && insight.impact_gnf > 0 && (
          <span className="flex-none text-right">
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Impact</span>
            <span className="block font-display text-[15px] font-bold leading-tight tabular text-ink">{fmtShort(insight.impact_gnf)} GNF</span>
          </span>
        )}
      </div>
      <h3 className="mt-3 text-[15.5px] font-semibold leading-snug text-ink">{insight.title}</h3>
      <p className={cx("mt-1.5 text-[13px] leading-relaxed text-ink-2", compact && "line-clamp-3")}>{insight.narrative}</p>
      {(insight.metric || insight.evidence) && (
        <div className={cx("mt-3 grid items-end gap-3", insight.metric && insight.evidence ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1")}>
          {insight.metric && (
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium text-muted">{insight.metric.label}</div>
              <div className={cx("font-display text-[22px] font-bold leading-none tabular", insight.severity === "critical" || insight.severity === "high" ? "text-danger" : insight.severity === "positive" ? "text-ok-texte" : "text-ink")}>{valeurMetrique(insight.metric.value, insight.metric.unit)}</div>
              {insight.metric.reference !== null && (
                <div className="mt-0.5 text-[11.5px] text-muted">
                  {insight.metric.reference_label ?? "Référence"} : <span className="font-semibold tabular text-ink-2">{valeurMetrique(insight.metric.reference, insight.metric.unit)}</span>
                </div>
              )}
            </div>
          )}
          {insight.evidence && (
            <div className="min-w-0 rounded-xl bg-panel-2/70 px-2.5 pt-2 pb-1">
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
            {insight.score !== undefined ? ` · score ${insight.score.toLocaleString("fr-FR")}` : ""}
          </span>
        </div>
      )}
    </article>
  );
}

/** Grille de constats, les plus graves d'abord (l'API les a déjà classés). */
export function Constats({ insights, titre = "Constats remarquables", colonnes = 3, compact }: { insights: Insight[]; titre?: string; colonnes?: 2 | 3; compact?: boolean }) {
  if (!insights.length) return null;
  return (
    <section aria-label={titre}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[16.5px] font-semibold text-ink">{titre}</h2>
        <span className="text-[12.5px] text-muted">
          {insights.filter((i) => i.severity === "critical" || i.severity === "high").length} à traiter · {insights.filter((i) => i.severity === "positive").length} point{insights.filter((i) => i.severity === "positive").length > 1 ? "s" : ""} fort{insights.filter((i) => i.severity === "positive").length > 1 ? "s" : ""}
        </span>
      </div>
      <div className={cx("n-cascade grid gap-4", colonnes === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2")}>
        {insights.map((i, k) => (
          <CarteConstat key={i.id} insight={i} compact={compact} rang={k} />
        ))}
      </div>
    </section>
  );
}

/* ─── Chiffres clés ────────────────────────────────────────────────────── */

const STATUT: Record<Kpi["status"], Tone> = { good: "ok", warn: "warn", bad: "danger", neutral: "neutral" };

/** Carte de chiffre clé du contrat : valeur, variation N-1, cible, tendance 12 mois, définition au survol. */
export function KpiContrat({ kpi, icon, teinte }: { kpi: Kpi; icon?: Icon; teinte?: Teinte }) {
  const cible = kpi.target !== null ? `cible ${fmtValeur(kpi.target, kpi.unit)}` : null;
  const ref = kpi.previous !== null ? `N-1 ${fmtValeur(kpi.previous, kpi.unit)}` : null;
  return (
    <div title={kpi.definition} className="min-w-0">
      <KpiCarte label={kpi.label} value={fmtValeur(kpi.value, kpi.unit)} tone={STATUT[kpi.status]} icon={icon} teinte={teinte} delta={kpi.delta_pct} inverse={kpi.inverse} hint={[ref, cible].filter(Boolean).join(" · ") || kpi.definition} />
      {kpi.trend.length > 1 && (
        <div className="-mt-[3px] rounded-b-2xl border-x border-b border-line bg-panel px-4 pb-2 pt-1">
          <Sparkline values={kpi.trend} color={kpi.status === "bad" ? COULEUR.mauvais : kpi.status === "warn" ? COULEUR.alerte : COULEUR.accent} height={32} />
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
            <span className={cx("block font-display text-[19px] font-bold leading-tight tabular", k.status === "bad" ? "text-danger" : "text-ink")}>{fmtValeur(k.value, k.unit)}</span>
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

export { fmtDate, fmtGNF, fmtInt, fmtPct, fmtShort, fmtValeur, moisCourt };
