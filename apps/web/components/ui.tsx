"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Baisse, Check, CheckCircle2, FileUp as FileUpIcon, Hausse, Info, Loader2, X, type Icon } from "@/components/icons";
import { cx } from "@/lib/cx";
import { Ondes } from "@/components/guilloche";
import { fmtPct, fmtShort } from "@/lib/format";

export { cx };

/* ─── Mouvement ────────────────────────────────────────────────────────── */

function abonnerMouvement(rappel: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", rappel);
  return () => mq.removeEventListener("change", rappel);
}

/** Vrai si l'utilisateur a demandé à son système de réduire les animations. */
export function useMouvementReduit(): boolean {
  return useSyncExternalStore(
    abonnerMouvement,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Vrai dès que l'élément entre à l'écran (une seule fois). */
export function useVisible<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [vu, setVu] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || vu) return;
    if (typeof IntersectionObserver === "undefined") {
      setVu(true);
      return;
    }
    const io = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) {
        setVu(true);
        io.disconnect();
      }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [vu]);
  return [ref, vu];
}

/** Valeur qui défile jusqu'à sa cible (ralentissement en fin de course). */
export function useDefilement(cible: number, actif: boolean, duree = 1300): number {
  const reduit = useMouvementReduit();
  const [valeur, setValeur] = useState(0);
  const depuis = useRef(0);
  useEffect(() => {
    if (!actif) return;
    if (reduit) {
      depuis.current = cible;
      setValeur(cible);
      return;
    }
    const origine = depuis.current;
    const t0 = performance.now();
    let image = 0;
    let courant = origine;
    const pas = (t: number) => {
      const p = Math.min(1, (t - t0) / duree);
      courant = origine + (cible - origine) * (1 - Math.pow(1 - p, 4));
      setValeur(courant);
      if (p < 1) image = requestAnimationFrame(pas);
    };
    image = requestAnimationFrame(pas);
    return () => {
      cancelAnimationFrame(image);
      depuis.current = courant;
    };
  }, [cible, actif, reduit, duree]);
  return valeur;
}

const NOMBRE = /[-−]?\d{1,3}(?:[   ]\d{3})+(?:,\d+)?|[-−]?\d+(?:,\d+)?/;

/**
 * Valeur affichée : le premier nombre d'un texte défile depuis zéro quand il entre à l'écran
 * (« 384 M », « 20,6 Mds », « 12 en service »). Le lecteur d'écran lit le texte final.
 */
export function Valeur({ value }: { value: ReactNode }) {
  const texte = typeof value === "number" ? new Intl.NumberFormat("fr-FR").format(value) : typeof value === "string" ? value : null;
  const trouve = texte ? NOMBRE.exec(texte) : null;
  const [ref, vu] = useVisible<HTMLSpanElement>();
  const brut = trouve ? trouve[0] : "";
  const decimales = brut.includes(",") ? (brut.split(",")[1] ?? "").length : 0;
  const cible = trouve ? Number(brut.replace(/[   ]/g, "").replace("−", "-").replace(",", ".")) : 0;
  const courant = useDefilement(cible, vu && trouve !== null);
  if (!texte || !trouve) return <span ref={ref}>{value}</span>;
  const groupe = /[   ]/.test(brut) || Math.abs(cible) >= 10000;
  const format = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: groupe });
  const avant = texte.slice(0, trouve.index);
  const apres = texte.slice(trouve.index + brut.length);
  return (
    <span ref={ref}>
      <span className="sr-only">{texte}</span>
      <span aria-hidden className="tabular">
        {avant}
        {format.format(courant)}
        {apres}
      </span>
    </span>
  );
}

/* ─── Couleurs ─────────────────────────────────────────────────────────── */

/** Gamme des graphiques, dans son ordre fixe (contrôlée pour les daltoniens). */
export const GAMME = ["#12956a", "#2d82dc", "#df8f17", "#c4417a", "#0f9fa0", "#e25f35"] as const;

export type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

/** Teinte vive de chaque état, pour les repères graphiques. */
const VIF: Record<Tone, string> = {
  neutral: "var(--accent-vif)",
  ok: "var(--g-jade)",
  warn: "var(--warn-vif)",
  danger: "var(--danger-vif)",
  accent: "var(--n-or)",
};

export type Teinte = "accent" | "jade" | "azur" | "ambre" | "rose" | "lagon" | "corail" | "or" | "danger";

const TUILE: Record<Teinte, { fond: string; trait: string }> = {
  accent: { fond: "var(--accent-doux)", trait: "var(--accent)" },
  jade: { fond: "#e2f5ea", trait: "#0b7a52" },
  azur: { fond: "#e6f0fc", trait: "#1a64bd" },
  ambre: { fond: "#fdf1d9", trait: "#8a5700" },
  rose: { fond: "#fbe7f0", trait: "#a5305f" },
  lagon: { fond: "#dcf5f4", trait: "#0b6f70" },
  corail: { fond: "#fdebe4", trait: "#b83e16" },
  or: { fond: "#f8efdc", trait: "#7d5c17" },
  danger: { fond: "var(--danger-doux)", trait: "var(--danger)" },
};

/** Sceau d'icône : un rond doux de la teinte cerclé d'un filet gravé, l'icône dans sa nuance foncée. */
export function IconTile({ icon: I, teinte = "accent", className }: { icon: Icon; teinte?: Teinte; className?: string }) {
  const t = TUILE[teinte];
  return (
    <span
      aria-hidden
      className={cx("grid h-10 w-10 flex-none place-items-center rounded-full", className)}
      style={{ background: t.fond, color: t.trait, boxShadow: `0 0 0 3px var(--panel), 0 0 0 4px color-mix(in oklab, ${t.trait} 28%, transparent)` }}
    >
      <I className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Variation en pourcentage : flèche et pastille verte ou rouge (« inverse » pour une charge). */
export function Delta({ value, inverse, digits = 1 }: { value: number | null; inverse?: boolean; digits?: number }) {
  if (value === null || !Number.isFinite(value)) return null;
  const hausse = value >= 0;
  const bon = inverse ? !hausse : hausse;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold tabular", bon ? "text-ok-texte" : "text-danger")}>
      <svg viewBox="0 0 10 10" aria-hidden className={cx("h-2 w-2", !hausse && "rotate-180")}>
        <path d="M5 1 9.5 9h-9Z" fill="currentColor" />
      </svg>
      {fmtPct(Math.abs(value), digits)}
      <span className="sr-only">{hausse ? " en hausse" : " en baisse"}</span>
    </span>
  );
}

/* ─── Mise en page ─────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[30px] font-[650] leading-[1.05] tracking-[-0.025em] text-ink sm:text-[38px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-[80ch] text-sm leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Feuille blanche posée sur le fond : un liseré à peine visible et une ombre portée basse. */
export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  const head = Boolean(title || actions);
  return (
    <section className={cx("min-w-0 rounded-[20px] bg-panel shadow-[var(--ombre-feuille)]", className)}>
      {head && (
        <div className="flex min-h-[58px] flex-wrap items-center justify-between gap-x-3 gap-y-2 px-6 pb-1 pt-5">
          {title && <h2 className="font-display text-[17px] font-[620] leading-snug tracking-[-0.01em] text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={padded ? (head ? "px-6 pb-6 pt-2" : "p-6") : head ? "pb-2" : undefined}>{children}</div>
    </section>
  );
}

/** Encre de la gravure d'un chiffre clé, selon son état. */
const ENCRE: Record<Tone, string> = {
  neutral: "text-accent-vif",
  ok: "text-jade",
  warn: "text-warn-vif",
  danger: "text-danger-vif",
  accent: "text-or",
};

/** Sceau d'état : un petit cachet gravé (anneau et point), dans la couleur de l'état. */
function Sceau({ tone }: { tone: Tone }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cx("mt-0.5 h-4 w-4 flex-none", ENCRE[tone])}>
      <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.2 1.4" />
      <circle cx="8" cy="8" r="3.4" fill="currentColor" />
    </svg>
  );
}

/**
 * Chiffre clé, gravé comme un coupon : le libellé, la valeur en grand qui défile, une précision.
 * Un faisceau guilloché propre à chaque libellé court au pied, dans l'encre de l'état ; le sceau
 * dit l'état, le libellé ou la précision le disent aussi en toutes lettres.
 */
export function Kpi({ label, value, hint, tone = "neutral", delta, inverse }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: Icon; teinte?: Teinte; delta?: number | null; inverse?: boolean }) {
  return (
    <div className="n-kpi kpi relative isolate min-w-0 overflow-hidden rounded-[20px] bg-panel px-5 pb-4 pt-4 shadow-[var(--ombre-feuille)]">
      <Ondes graine={label} className={cx("kpi-ondes pointer-events-none absolute -bottom-2 right-0 -z-10 h-[74px] w-[78%] max-w-[300px]", ENCRE[tone])} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[13px] font-medium leading-snug text-ink-2">{label}</div>
        {tone !== "neutral" && <Sceau tone={tone} />}
      </div>
      <div className={cx("mt-3 font-display text-[30px] font-[650] leading-none tracking-[-0.03em]", tone === "danger" ? "text-danger" : "text-ink")}>
        <Valeur value={value} />
      </div>
      {(hint || delta !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-snug text-muted">
          {delta !== undefined && <Delta value={delta} inverse={inverse} />}
          {hint && <span className="min-w-0">{hint}</span>}
        </div>
      )}
    </div>
  );
}

const PASTILLE: Record<Tone, string> = {
  neutral: "bg-panel-3 text-ink-2",
  ok: "bg-ok-doux text-ok-texte",
  warn: "bg-warn-doux text-warn",
  danger: "bg-danger-doux text-danger",
  accent: "bg-accent-doux text-accent",
};

/** Puce d'état : le texte dit l'état, la couleur l'appuie. `vivant` fait battre le point. */
export function Badge({ tone = "neutral", children, vivant }: { tone?: Tone; children: ReactNode; vivant?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-[3px] pl-2 pr-2.5 text-[12px] font-semibold leading-4", PASTILLE[tone])}>
      <span aria-hidden className={cx("h-1.5 w-1.5 flex-none rounded-full", vivant && "n-pouls")} style={{ background: tone === "neutral" ? "var(--muted)" : VIF[tone === "accent" ? "neutral" : tone], "--pouls": "currentColor" } as CSSProperties} />
      {children}
    </span>
  );
}

/** Étiquette neutre (profil, catégorie). */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center whitespace-nowrap rounded-md bg-panel-3 px-2 py-0.5 text-[12px] font-medium text-ink-2">{children}</span>;
}

/* ─── Contrôles ────────────────────────────────────────────────────────── */

/**
 * Les classes passées par un écran l'emportent sur celles du composant pour la taille du texte, la
 * hauteur minimale et les marges intérieures ; sans cela, l'ordre du CSS généré déciderait seul.
 */
const GROUPES = [/^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d[^\]]*\])$/, /^min-h-/, /^px-/, /^py-/, /^w-/];

function ajuste(base: string, extra?: string): string {
  if (!extra) return base;
  const ajout = extra.split(/\s+/).filter(Boolean);
  const garde = base.split(/\s+/).filter((c) => !GROUPES.some((g) => g.test(c) && ajout.some((a) => g.test(a))));
  return [...garde, ...ajout].join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "n-degrade text-accent-ink shadow-[0_8px_18px_-10px_var(--accent-lueur)] hover:shadow-[0_12px_24px_-10px_var(--accent-lueur)] hover:brightness-[1.07]",
  secondary: "border border-line bg-panel text-ink shadow-[0_1px_2px_rgb(16_36_31/0.05)] hover:border-line-strong hover:bg-panel-2",
  ghost: "text-ink-2 hover:bg-panel-3 hover:text-ink",
  danger: "border border-danger/30 bg-panel text-danger hover:border-danger hover:bg-danger hover:text-white",
};

export function Button({ variant = "secondary", loading, className, children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={ajuste(
        cx(
          "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-sm font-semibold transition-[transform,box-shadow,background-color,border-color,color,filter] duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:scale-100",
          BUTTON[variant],
        ),
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

const FIELD =
  "w-full rounded-[10px] border border-line-strong/80 bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted/70 outline-none transition-[border-color,box-shadow] duration-200 hover:border-line-strong focus:border-accent-vif focus:ring-4 focus:ring-accent-vif/15 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-muted";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={ajuste(cx(FIELD, "min-h-9"), props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={ajuste(cx(FIELD, "min-h-[84px] leading-relaxed"), props.className)} />;
}

export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string | number; label: string }>; placeholder?: string }) {
  return (
    <select {...props} className={ajuste(cx(FIELD, "champ-liste min-h-9"), props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-[12px] leading-snug text-muted">{hint}</span>}
      {error && <span className="mt-1.5 block text-[12px] font-medium leading-snug text-danger">{error}</span>}
    </label>
  );
}

/**
 * Bascule à curseur glissant (périmètre, période) : le repère glisse sous l'option choisie.
 */
export function Segmented<K extends string>({ options, value, onChange, label, className }: { options: Array<{ key: K; label: string }>; value: K; onChange: (k: K) => void; label?: string; className?: string }) {
  const boite = useRef<HTMLDivElement>(null);
  const [repere, setRepere] = useState<{ x: number; w: number } | null>(null);
  const mesurer = useCallback(() => {
    const el = boite.current?.querySelector<HTMLElement>(`[data-cle="${CSS.escape(value)}"]`);
    if (el) setRepere({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);
  useEffect(() => {
    mesurer();
    const el = boite.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mesurer]);
  return (
    <div ref={boite} role="group" aria-label={label} className={cx("relative inline-flex rounded-xl border border-line bg-panel-2 p-1", className)}>
      {repere && <span aria-hidden className="n-repere absolute inset-y-1 left-0 rounded-[9px] bg-panel shadow-[0_1px_3px_rgb(16_36_31/0.12),0_0_0_1px_rgb(16_36_31/0.04)]" style={{ transform: `translateX(${repere.x}px)`, width: repere.w }} />}
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          data-cle={o.key}
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={cx("relative z-[1] rounded-[9px] px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200", o.key === value ? "text-ink" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─── États ────────────────────────────────────────────────────────────── */

/** Chargement : un libellé qui dit ce qui charge et le squelette du contenu attendu. */
export function Loading({ label = "Chargement des données…" }: { label?: string }) {
  return (
    <div role="status" className="px-5 py-8">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="n-tourne h-4 w-4 rounded-full border-2 border-accent-vif/25 border-t-accent-vif" />
        <span className="text-[13px] font-medium text-muted">{label}</span>
      </div>
      <div aria-hidden className="mt-5 space-y-3">
        <div className="n-squelette h-3 w-[72%] rounded-full" />
        <div className="n-squelette h-3 w-[88%] rounded-full" />
        <div className="n-squelette h-3 w-[54%] rounded-full" />
      </div>
    </div>
  );
}

/** Squelette d'un bloc (carte de chiffre, graphique) pendant le chargement. */
export function Squelette({ className }: { className?: string }) {
  return <div aria-hidden className={cx("n-squelette rounded-2xl", className)} />;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Une erreur est survenue.";
  return (
    <div role="alert" className="n-surgir flex items-start gap-3 rounded-xl border border-danger/15 bg-danger-doux px-4 py-3 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
          Réessayer
        </button>
      )}
    </div>
  );
}

/** État vide : trois cartes empilées aux couleurs de l'application, et ce qu'il faut faire. */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <svg viewBox="0 0 64 48" className="mb-2 h-12 w-16" aria-hidden focusable="false">
        <rect x="14" y="4" width="36" height="26" rx="6" fill="var(--accent-doux)" />
        <rect x="8" y="12" width="48" height="30" rx="7" fill="var(--panel)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <path d="M17 24h18M17 31h28" stroke="var(--accent-vif)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="47" cy="24" r="3" fill="var(--n-or)" />
      </svg>
      <div className="text-sm font-semibold text-ink-2">{title}</div>
      {hint && <div className="max-w-md text-[13px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

const NOTICE: Record<Tone, string> = {
  neutral: "border-line bg-panel-2 text-ink-2",
  ok: "border-ok/15 bg-ok-doux text-ink",
  warn: "border-warn/15 bg-warn-doux text-ink",
  danger: "border-danger/15 bg-danger-doux text-danger",
  accent: "border-accent/15 bg-accent-doux text-ink",
};

const NOTICE_ICON: Record<Tone, string> = {
  neutral: "text-muted",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent",
};

export function Notice({ tone = "accent", children }: { tone?: Tone; children: ReactNode }) {
  const I = tone === "warn" || tone === "danger" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cx("n-surgir flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed", NOTICE[tone])}>
      <I className={cx("mt-[3px] h-4 w-4 flex-none", NOTICE_ICON[tone])} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ─── Tableau ──────────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, footer, onRowClick, empty = "Aucune donnée.", dense }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T, index: number) => string | number; footer?: ReactNode; onRowClick?: (row: T) => void; empty?: string; dense?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const value = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[col.key] as string | number | null);
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va > vb ? 1 : -1) * sort.dir;
    });
  }, [rows, sort, columns]);

  if (!rows.length) return <Empty title={empty} />;
  const pad = dense ? "px-3 py-1.5" : "px-3 py-3";
  const alignOf = (c: Column<T>) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left");
  const onKey = (row: T) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    // Seule la ligne elle-même réagit : un bouton ou un champ de la ligne garde sa touche Entrée.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row);
    }
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px]">
        <thead>
          <tr className="border-y border-line bg-panel-2">
            {columns.map((c) => {
              // Colonne sans titre (cases, actions) : rien à trier.
              if (!c.label) return <th key={c.key} scope="col" className={cx(dense ? "px-3 py-2" : "px-3 py-2.5", "first:pl-5 last:pr-5")} />;
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined} className={cx(dense ? "px-3 py-2" : "px-3 py-2.5", "whitespace-nowrap font-medium first:pl-5 last:pr-5", alignOf(c))}>
                  <button
                    type="button"
                    onClick={() => setSort(active ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}
                    className={cx("group inline-flex items-center gap-1 rounded text-[12.5px] font-semibold transition-colors hover:text-ink", c.align === "right" && "flex-row-reverse", active ? "text-accent" : "text-muted")}
                  >
                    {c.label}
                    <span aria-hidden className={cx("inline-flex transition-opacity", !active && "opacity-0 group-hover:opacity-60")}>
                      {active && sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="tabular">
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? onKey(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cx("n-ligne border-b border-line/80 transition-colors last:border-0", onRowClick ? "cursor-pointer outline-offset-[-2px] hover:bg-accent-doux/45" : "hover:bg-panel-2/70")}
              style={i < 18 ? { animationDelay: `${i * 22}ms` } : { animation: "none" }}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx(pad, "first:pl-5 last:pr-5", alignOf(c), c.align === "right" && "whitespace-nowrap font-mono", c.className)}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "–")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="tabular border-t border-line bg-panel-2 font-semibold [&_td:first-child]:pl-5 [&_td:last-child]:pr-5">{footer}</tfoot>}
      </table>
    </div>
  );
}

/**
 * Étapes d'un parcours (gates d'un dossier) : franchies, en cours, à venir. Ici les numéros ont
 * un sens, ils donnent l'ordre du parcours. L'étape en cours bat doucement.
 */
export function Etapes({ steps }: { steps: Array<{ key: string; label: string; state: "done" | "current" | "todo"; title?: string }> }) {
  return (
    <ol className="grid gap-3 sm:flex sm:gap-0">
      {steps.map((s, i) => (
        <li key={s.key} title={s.title} className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:items-start sm:gap-2.5">
          <div className="flex items-center sm:w-full">
            <span
              className={cx(
                "grid h-8 w-8 flex-none place-items-center rounded-full text-[13px] font-bold tabular",
                s.state === "done" ? "n-degrade text-accent-ink shadow-[0_6px_14px_-8px_var(--accent-lueur)]" : s.state === "current" ? "n-pouls bg-or text-foret" : "border-2 border-line-strong/70 bg-panel text-muted",
              )}
              style={s.state === "current" ? ({ "--pouls": "rgb(211 170 91 / 0.55)" } as CSSProperties) : undefined}
            >
              {s.state === "done" ? <Check className="h-4 w-4" strokeWidth={2.4} /> : i + 1}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden className="relative mx-2 hidden h-[3px] flex-1 overflow-hidden rounded-full bg-line sm:block">
                {s.state === "done" && <span className="n-pousser-x absolute inset-0 rounded-full bg-accent-vif" style={{ "--i": i } as CSSProperties} />}
              </span>
            )}
          </div>
          <span className={cx("text-[13px] leading-snug sm:pr-4", s.state === "current" ? "font-semibold text-ink" : s.state === "done" ? "text-ink-2" : "text-muted")}>
            {s.label}
            {s.state === "current" && <span className="sr-only"> (étape en cours)</span>}
            {s.state === "done" && <span className="sr-only"> (franchie)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Bouton d'envoi de fichier : un libellé qui ouvre le sélecteur, à l'allure d'un bouton secondaire. */
export function FileButton({ label, accept, onFile, small }: { label: string; accept?: string; onFile: (file: File) => void; small?: boolean }) {
  return (
    <label className={cx("relative inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-panel font-semibold text-ink shadow-[0_1px_2px_rgb(16_36_31/0.05)] transition-colors hover:border-line-strong hover:bg-panel-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-vif", small ? "px-2.5 py-1 text-[12.5px]" : "min-h-9 px-3.5 py-1.5 text-sm")}>
      <FileUpIcon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {label}
      <input type="file" className="sr-only" accept={accept} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
}

/* ─── Onglets et fenêtres ──────────────────────────────────────────────── */

/** Onglets soulignés : le trait glisse sous l'onglet choisi. */
export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: Array<{ key: K; label: string; count?: number }>; value: K; onChange: (key: K) => void }) {
  const boite = useRef<HTMLDivElement>(null);
  const [trait, setTrait] = useState<{ x: number; y: number; w: number } | null>(null);
  const mesurer = useCallback(() => {
    const el = boite.current?.querySelector<HTMLElement>(`[data-cle="${CSS.escape(value)}"]`);
    if (el) setTrait({ x: el.offsetLeft, y: el.offsetTop + el.offsetHeight - 2, w: el.offsetWidth });
  }, [value]);
  useEffect(() => {
    mesurer();
    const el = boite.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    el.querySelectorAll("button").forEach((b) => ro.observe(b));
    void document.fonts?.ready.then(mesurer);
    return () => ro.disconnect();
  }, [mesurer]);
  return (
    <div ref={boite} className="no-print relative mb-5 flex flex-wrap gap-x-6 border-b border-line">
      {tabs.map((t) => {
        const actif = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            data-cle={t.key}
            aria-pressed={actif}
            onClick={() => onChange(t.key)}
            className={cx("inline-flex items-center gap-1.5 py-3 text-sm font-semibold transition-colors", actif ? "text-ink" : "text-muted hover:text-ink")}
          >
            {t.label}
            {t.count !== undefined && <span className={cx("rounded-full px-1.5 py-px text-[11.5px] font-semibold tabular transition-colors", actif ? "bg-accent-doux text-accent" : "bg-panel-3 text-muted")}>{t.count}</span>}
          </button>
        );
      })}
      {trait && <span aria-hidden className="n-repere absolute left-0 top-0 h-[3px] rounded-full bg-accent-vif" style={{ transform: `translate(${trait.x}px, ${trait.y}px)`, width: trait.w }} />}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="n-apparaitre fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foret/45 p-4 md:p-10" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx("n-surgir w-full rounded-2xl border border-line bg-panel shadow-[var(--ombre-flottante)]", wide ? "max-w-4xl" : "max-w-lg")}>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="text-[19px] font-semibold leading-snug text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="-mr-1 grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-panel-3 hover:text-ink" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t border-line bg-panel-2 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/* ─── Chiffres et graphiques (SVG et HTML, sans dépendance) ─────────────── */

/**
 * Compteur : un montant affiché chiffre par chiffre, comme sur le compteur volumétrique d'une
 * citerne. Les rouleaux tournent au premier affichage (sauf mouvement réduit). Un seul compteur
 * par écran : c'est le chiffre que l'écran met en avant.
 */
export function Compteur({ value, unit = "GNF", className }: { value: number; unit?: string; className?: string }) {
  const n = Math.round(value);
  const digits = Math.abs(n).toString();
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  let rang = 0;
  return (
    <span className={cx("compteur", className)}>
      <span className="sr-only">{`${n < 0 ? "moins " : ""}${new Intl.NumberFormat("fr-FR").format(Math.abs(n))} ${unit}`}</span>
      {n < 0 && (
        <span aria-hidden className="compteur-signe">
          −
        </span>
      )}
      {groups.map((group, g) => (
        <span key={g} aria-hidden className="compteur-groupe">
          {group.split("").map((d, i) => (
            <span key={i} className="compteur-case">
              <span className="compteur-rouleau" style={{ "--chiffre": Number(d), "--rang": rang++ } as CSSProperties}>
                {"0123456789".split("").map((k) => (
                  <span key={k}>{k}</span>
                ))}
              </span>
            </span>
          ))}
        </span>
      ))}
      {unit && (
        <span aria-hidden className="compteur-unite ml-[0.14em] self-end font-sans text-[0.32em] font-semibold tracking-[0.02em] text-muted">
          {unit}
        </span>
      )}
    </span>
  );
}

/** Info-bulle d'un graphique : carte blanche, libellé puis valeurs. */
function Bulle({ titre, lignes, className, style }: { titre: string; lignes: Array<{ couleur?: string; nom?: string; valeur: string }>; className?: string; style?: CSSProperties }) {
  return (
    <span className={cx("pointer-events-none absolute z-20 min-w-[132px] whitespace-nowrap rounded-xl border border-line bg-panel px-3 py-2 text-left shadow-[var(--ombre-flottante)]", className)} style={style}>
      <span className="block text-[11.5px] font-semibold text-muted">{titre}</span>
      {lignes.map((l, i) => (
        <span key={i} className="mt-1 flex items-center gap-2 text-[12.5px]">
          {l.couleur && <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: l.couleur }} />}
          {l.nom && <span className="text-ink-2">{l.nom}</span>}
          <span className="ml-auto pl-2 font-semibold tabular text-ink">{l.valeur}</span>
        </span>
      ))}
    </span>
  );
}

/** Graduations « rondes » d'un axe (1, 2 ou 5 fois une puissance de dix). */
function graduations(min: number, max: number, nombre = 4): number[] {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 1;
  const brut = (hi - lo) / nombre;
  const ordre = 10 ** Math.floor(Math.log10(brut));
  const r = brut / ordre;
  const pas = Math.max(1, (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * ordre);
  lo = Math.floor(lo / pas) * pas;
  hi = Math.ceil(hi / pas) * pas;
  const t: number[] = [];
  for (let v = lo; v <= hi + pas / 2; v += pas) t.push(Math.round(v / pas) * pas);
  return t;
}

/** Courbe monotone (Fritsch-Carlson) : lisse, sans dépasser les valeurs réelles. */
function courbe(points: Array<[number, number]>): string {
  const n = points.length;
  const p = (v: number) => Math.round(v * 100) / 100;
  if (n === 0) return "";
  if (n === 1) return `M${p(points[0]![0])},${p(points[0]![1])}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    dx.push(x1 - x0);
    m.push((y1 - y0) / (x1 - x0 || 1));
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = m[i - 1]!;
    const b = m[i]!;
    if (a * b <= 0) t.push(0);
    else {
      const w1 = 2 * dx[i]! + dx[i - 1]!;
      const w2 = dx[i]! + 2 * dx[i - 1]!;
      t.push((w1 + w2) / (w1 / a + w2 / b));
    }
  }
  t.push(m[n - 2]!);
  let d = `M${p(points[0]![0])},${p(points[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const h = dx[i]!;
    d += ` C${p(x0 + h / 3)},${p(y0 + (t[i]! * h) / 3)} ${p(x1 - h / 3)},${p(y1 - (t[i + 1]! * h) / 3)} ${p(x1)},${p(y1)}`;
  }
  return d;
}

/**
 * Courbes d'une ou plusieurs séries sur un même axe (jamais deux échelles) : tracé animé, aire en
 * dégradé sous la première série, réticule et info-bulle au survol comme au clavier (flèches).
 * Avec deux séries ou plus, la légende permet de masquer une série.
 */
export function AreaChart({ labels, series, height = 220, format, formatAxis, label }: { labels: string[]; series: Array<{ key: string; label: string; values: number[]; color: string }>; height?: number; format?: (v: number) => string; formatAxis?: (v: number) => string; label?: string }) {
  const id = useId().replace(/:/g, "");
  const [masque, setMasque] = useState<string[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const show = format ?? ((v: number) => fmtShort(v));
  const axe = formatAxis ?? ((v: number) => fmtShort(v));
  const visibles = series.filter((s) => !masque.includes(s.key));
  const n = labels.length;
  const toutes = visibles.flatMap((s) => s.values);
  const ticks = graduations(Math.min(0, ...toutes), Math.max(0, ...toutes));
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const W = 1000;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => height - ((v - lo) / (hi - lo || 1)) * height;
  const pct = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const zero = y(0);

  function survol(clientX: number) {
    const r = zone.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setFocus(Math.round(ratio * (n - 1)));
  }

  function clavier(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setFocus((f) => {
        const base = f ?? n - 1;
        return Math.min(n - 1, Math.max(0, base + (e.key === "ArrowRight" ? 1 : -1)));
      });
    }
  }

  const pasEtiquette = n > 12 ? Math.ceil(n / 8) : 1;
  return (
    <div>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {series.map((s) => {
            const actif = !masque.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={actif}
                onClick={() => setMasque((m) => (actif ? (visibles.length > 1 ? [...m, s.key] : m) : m.filter((k) => k !== s.key)))}
                className={cx("inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-all", actif ? "border-line bg-panel text-ink-2" : "border-dashed border-line-strong/70 bg-transparent text-muted line-through")}
              >
                <span aria-hidden className="h-2.5 w-2.5 rounded-full transition-transform" style={{ background: s.color, transform: actif ? "scale(1)" : "scale(0.6)" }} />
                {s.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <div aria-hidden className="relative w-12 flex-none" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] tabular text-muted" style={{ top: y(t) }}>
              {axe(t)}
            </span>
          ))}
        </div>
        <div
          ref={zone}
          tabIndex={0}
          role="img"
          aria-label={label ?? `Graphique : ${series.map((s) => s.label).join(", ")}`}
          onPointerMove={(e) => survol(e.clientX)}
          onPointerLeave={() => setFocus(null)}
          onFocus={() => setFocus((f) => f ?? n - 1)}
          onBlur={() => setFocus(null)}
          onKeyDown={clavier}
          className="relative min-w-0 flex-1 rounded-md outline-offset-4"
          style={{ height }}
        >
          <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden focusable="false">
            <defs>
              {visibles.map((s) => (
                <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--line-strong)" : "var(--line)"} strokeDasharray={t === 0 ? undefined : "4 6"} vectorEffect="non-scaling-stroke" />
            ))}
            {visibles.map((s, k) => {
              const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
              const d = courbe(pts);
              const aire = pts.length ? `${d} L${x(pts.length - 1)},${zero} L${x(0)},${zero} Z` : "";
              return (
                <g key={s.key}>
                  {k === 0 && <path d={aire} fill={`url(#${id}-${s.key})`} className="n-apparaitre" style={{ animationDuration: "1200ms" }} />}
                  <path d={d} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="n-tracer" style={{ "--retard": `${150 + k * 180}ms` } as CSSProperties} />
                </g>
              );
            })}
          </svg>
          {focus !== null && n > 0 && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-ink/35" style={{ left: `${pct(focus)}%` }} />
              {visibles.map((s) => {
                const v = s.values[focus];
                if (v === undefined) return null;
                return <span key={s.key} aria-hidden className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel shadow-[0_1px_4px_rgb(16_36_31/0.3)]" style={{ left: `${pct(focus)}%`, top: (y(v) / height) * 100 + "%", background: s.color }} />;
              })}
              <Bulle
                titre={labels[focus] ?? ""}
                lignes={visibles.map((s) => ({ couleur: s.color, nom: visibles.length > 1 ? s.label : undefined, valeur: show(s.values[focus] ?? 0) }))}
                className="top-1"
                style={pct(focus) > 62 ? { right: `calc(${100 - pct(focus)}% + 14px)` } : { left: `calc(${pct(focus)}% + 14px)` }}
              />
            </>
          )}
        </div>
      </div>
      <div aria-hidden className="relative ml-14 mt-2 h-4">
        {labels.map((l, i) =>
          i % pasEtiquette === 0 || i === n - 1 ? (
            <span key={`${l}-${i}`} className={cx("absolute -translate-x-1/2 whitespace-nowrap text-[11px] transition-colors", focus === i ? "font-semibold text-ink" : "text-muted", n > 6 && i % 2 === 1 && i !== n - 1 && focus !== i && "max-sm:hidden")} style={{ left: `${pct(i)}%` }}>
              {l}
            </span>
          ) : null,
        )}
      </div>
      <table className="sr-only">
        <caption>{label ?? "Données du graphique"}</caption>
        <thead>
          <tr>
            <th scope="col">Période</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}-${i}`}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.key}>{show(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Colonnes d'une série : barres en dégradé de la couleur de l'application, extrémité arrondie,
 * valeurs négatives sous la ligne de base, poussée animée, info-bulle au survol et au clavier.
 */
export function BarChart({ data, height = 190, format }: { data: Array<{ label: string; value: number; tone?: Tone }>; height?: number; format?: (v: number) => string }) {
  const [focus, setFocus] = useState<number | null>(null);
  const show = format ?? ((v: number) => String(v));
  const ticks = graduations(Math.min(0, ...data.map((d) => d.value)), Math.max(0, ...data.map((d) => d.value)), 3);
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const span = hi - lo || 1;
  const base = (hi / span) * 100;
  const last = data.length - 1;
  return (
    <div className="flex gap-2">
      <div aria-hidden className="relative w-12 flex-none" style={{ height }}>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] tabular text-muted" style={{ top: `${((hi - t) / span) * 100}%` }}>
            {fmtShort(t)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative flex gap-[6px]" style={{ height }}>
          {ticks.map((t) => (
            <div key={t} aria-hidden className={cx("pointer-events-none absolute inset-x-0 border-t", t === 0 ? "border-line-strong" : "border-dashed border-line")} style={{ top: `${((hi - t) / span) * 100}%` }} />
          ))}
          {data.map((d, i) => {
            const h = (Math.abs(d.value) / span) * 100;
            const negative = d.value < 0;
            const couleur = negative ? "var(--danger-vif)" : d.tone === "accent" ? "var(--n-or)" : "var(--accent-vif)";
            const fonce = negative ? "var(--danger)" : d.tone === "accent" ? "#b48a35" : "var(--accent)";
            return (
              <div
                key={`${d.label}-${i}`}
                tabIndex={0}
                role="img"
                aria-label={`${d.label} : ${show(d.value)}`}
                onPointerEnter={() => setFocus(i)}
                onPointerLeave={() => setFocus(null)}
                onFocus={() => setFocus(i)}
                onBlur={() => setFocus(null)}
                className="relative flex min-w-0 flex-1 justify-center rounded-md outline-offset-2"
              >
                <div
                  className={cx("absolute w-full max-w-7 transition-[opacity,filter] duration-200", negative ? "n-pousser-y-bas rounded-b-[6px]" : "n-pousser-y rounded-t-[6px]", focus !== null && focus !== i ? "opacity-40" : "opacity-100", focus === i && "brightness-110")}
                  style={
                    {
                      top: negative ? `${base}%` : undefined,
                      bottom: negative ? undefined : `${100 - base}%`,
                      height: `${Math.max(h, 0.8)}%`,
                      background: `linear-gradient(${negative ? "0deg" : "180deg"}, ${couleur}, ${fonce})`,
                      "--i": i,
                    } as CSSProperties
                  }
                />
                {i === last && focus === null && (
                  <span aria-hidden className="absolute whitespace-nowrap pb-1 text-[11.5px] font-semibold tabular text-ink" style={negative ? { top: `calc(${base + h}% + 4px)` } : { bottom: `${100 - base + h}%` }}>
                    {fmtShort(d.value)}
                  </span>
                )}
                {focus === i && <Bulle titre={d.label} lignes={[{ couleur, valeur: show(d.value) }]} className="bottom-full mb-2 left-1/2 -translate-x-1/2" />}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-[6px]">
          {data.map((d, i) => (
            <span key={`${d.label}-${i}`} className={cx("min-w-0 flex-1 truncate text-center text-[11px] transition-colors", focus === i ? "font-semibold text-ink" : "text-muted")}>
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const METER: Record<Tone, [string, string]> = {
  neutral: ["var(--panel-3)", "var(--accent-vif)"],
  ok: ["var(--ok-doux)", "var(--g-jade)"],
  warn: ["var(--warn-doux)", "var(--warn-vif)"],
  danger: ["var(--danger-doux)", "var(--danger-vif)"],
  accent: ["var(--accent-doux)", "var(--accent-vif)"],
};

/** Jauge linéaire : le remplissage porte l'état et se remplit à l'affichage. */
export function ProgressBar({ value, tone = "accent", rayures, epaisseur = 8 }: { value: number; tone?: Tone; rayures?: boolean; epaisseur?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const [track, fill] = METER[tone];
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ background: track, height: epaisseur }}>
      <div className={cx("n-pousser-x h-full rounded-full", rayures && "n-rayures-fixes")} style={{ width: `${pct}%`, backgroundColor: fill, boxShadow: `0 0 12px -2px ${fill}` }} />
    </div>
  );
}

/**
 * Répartition d'un total en segments (six au plus), séparés par un jour de 3 px ; ils se
 * remplissent l'un après l'autre. La légende donne chaque part en toutes lettres.
 */
export function Repartition({ parts, format }: { parts: Array<{ key: string; label: string; value: number; color: string }>; format?: (v: number) => string }) {
  const [focus, setFocus] = useState<string | null>(null);
  const show = format ?? ((v: number) => String(v));
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="flex h-3.5 w-full gap-[3px]">
        {total === 0 ? (
          <div className="h-full w-full rounded-full bg-panel-3" />
        ) : (
          visible.map((p, i) => (
            <div
              key={p.key}
              tabIndex={0}
              role="img"
              aria-label={`${p.label} : ${show(p.value)}`}
              onPointerEnter={() => setFocus(p.key)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(p.key)}
              onBlur={() => setFocus(null)}
              className={cx("n-pousser-x relative h-full rounded-full outline-offset-2 transition-[opacity,transform] duration-200", focus && focus !== p.key && "opacity-40", focus === p.key && "scale-y-125")}
              style={{ width: `${(p.value / total) * 100}%`, minWidth: 6, background: p.color, "--i": i } as CSSProperties}
            >
              {focus === p.key && <Bulle titre={p.label} lignes={[{ couleur: p.color, valeur: `${show(p.value)} (${Math.round((p.value / total) * 100)} %)` }]} className="bottom-full mb-2 left-1/2 -translate-x-1/2" />}
            </div>
          ))
        )}
      </div>
      <ul className="mt-4 space-y-1">
        {parts.map((p) => (
          <li
            key={p.key}
            onPointerEnter={() => p.value > 0 && setFocus(p.key)}
            onPointerLeave={() => setFocus(null)}
            className={cx("flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors", focus === p.key && "bg-panel-2")}
          >
            <span className="flex min-w-0 items-center gap-2.5 text-ink-2">
              <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: p.color }} />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="flex items-center gap-2.5">
              <span className="font-semibold tabular text-ink">{show(p.value)}</span>
              <span className="w-11 rounded-full bg-panel-3 py-px text-center text-[11px] font-semibold tabular text-muted">{total > 0 ? `${Math.round((Math.max(0, p.value) / total) * 100)} %` : "–"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Anneau de répartition : chaque part se trace à son tour ; au survol, la part s'épaissit et le
 * centre donne son montant. La légende à côté dit tout en toutes lettres.
 */
export function Donut({ parts, format, centre, size = 160, epaisseur = 20 }: { parts: Array<{ key: string; label: string; value: number; color: string }>; format?: (v: number) => string; centre?: { titre: string; valeur: string }; size?: number; epaisseur?: number }) {
  const [focus, setFocus] = useState<string | null>(null);
  const show = format ?? ((v: number) => fmtShort(v));
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const visibles = parts.filter((p) => p.value > 0);
  const r = 50 - epaisseur / 2 - 3;
  const jour = visibles.length > 1 ? 1.4 : 0;
  let cumul = 0;
  const choisi = visibles.find((p) => p.key === focus);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden focusable="false">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--panel-3)" strokeWidth={epaisseur} />
          {total > 0 &&
            visibles.map((p, i) => {
              const part = (p.value / total) * 100;
              const longueur = Math.max(0.01, part - jour);
              const debut = cumul;
              cumul += part;
              return (
                <circle
                  key={p.key}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={p.color}
                  pathLength={100}
                  strokeWidth={focus === p.key ? epaisseur + 5 : epaisseur}
                  strokeDasharray={`${longueur} ${100 - longueur}`}
                  strokeDashoffset={-debut}
                  className={cx("n-anneau cursor-pointer transition-[stroke-width,opacity] duration-200", focus && focus !== p.key && "opacity-45")}
                  style={{ "--i": i } as CSSProperties}
                  onPointerEnter={() => setFocus(p.key)}
                  onPointerLeave={() => setFocus(null)}
                />
              );
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="max-w-[70%]">
            <div className="truncate text-[11.5px] font-medium text-muted">{choisi ? choisi.label : centre?.titre ?? "Total"}</div>
            <div className="font-display text-[19px] font-bold leading-tight tabular text-ink">{choisi ? show(choisi.value) : centre?.valeur ?? show(total)}</div>
            {choisi && total > 0 && <div className="text-[11.5px] font-semibold text-muted">{Math.round((choisi.value / total) * 100)} %</div>}
          </div>
        </div>
      </div>
      <ul className="min-w-[200px] flex-1 space-y-1">
        {parts.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onPointerEnter={() => p.value > 0 && setFocus(p.key)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => p.value > 0 && setFocus(p.key)}
              onBlur={() => setFocus(null)}
              className={cx("flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors", focus === p.key && "bg-panel-2")}
            >
              <span className="flex min-w-0 items-center gap-2.5 text-ink-2">
                <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: p.color }} />
                <span className="truncate">{p.label}</span>
              </span>
              <span className="whitespace-nowrap font-semibold tabular text-ink">{show(p.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Jauge en demi-cercle : zones colorées (insuffisant, limite, confortable), aiguille qui se pose
 * sur la valeur avec un léger rebond. Le texte sous la jauge dit la valeur et la zone.
 */
export function Gauge({ value, max, zones, format, sousTitre, vide }: { value: number | null; max: number; zones: Array<{ jusqua: number; couleur: string; label: string }>; format?: (v: number) => string; sousTitre?: string; vide?: string }) {
  const show = format ?? ((v: number) => String(v));
  const borne = (v: number) => Math.max(0, Math.min(max, v));
  const angle = (v: number) => -90 + (borne(v) / max) * 180;
  const point = (v: number, rayon: number) => {
    const a = ((angle(v) - 90) * Math.PI) / 180;
    return [100 + rayon * Math.cos(a), 100 + rayon * Math.sin(a)] as const;
  };
  const arc = (de: number, a: number, rayon: number) => {
    const [x0, y0] = point(de, rayon);
    const [x1, y1] = point(a, rayon);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${rayon},${rayon} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  let debut = 0;
  const zoneDe = value === null ? null : zones.find((z) => value < z.jusqua) ?? zones[zones.length - 1];
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 112" className="w-full max-w-[260px]" aria-hidden focusable="false">
        {zones.map((z, i) => {
          const de = debut;
          debut = Math.min(max, z.jusqua);
          const ecart = i < zones.length - 1 ? max * 0.012 : 0;
          return <path key={z.label} d={arc(de, Math.max(de, debut - ecart), 78)} fill="none" stroke={z.couleur} strokeWidth="16" strokeLinecap={i === 0 || i === zones.length - 1 ? "round" : "butt"} pathLength={1} className="n-tracer" style={{ "--retard": `${100 + i * 160}ms` } as CSSProperties} />;
        })}
        {value !== null && (
          <g className="n-aiguille" style={{ transform: `rotate(${angle(value)}deg)`, transformOrigin: "100px 100px", "--depart": "-90deg" } as CSSProperties}>
            <path d="M100 32 L104.5 100 L95.5 100 Z" fill="var(--ink)" />
          </g>
        )}
        <circle cx="100" cy="100" r="9" fill="var(--panel)" stroke="var(--ink)" strokeWidth="4" />
      </svg>
      <div className="-mt-1 text-center">
        <div className="font-display text-[30px] font-bold leading-none tabular text-ink">{value === null ? "–" : show(value)}</div>
        {value === null && vide && <div className="mt-1.5 inline-flex rounded-full bg-panel-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted">{vide}</div>}
        {zoneDe && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: zoneDe.couleur }} />
            {zoneDe.label}
          </div>
        )}
        {sousTitre && <div className="mt-1.5 text-[12px] text-muted">{sousTitre}</div>}
      </div>
    </div>
  );
}

/**
 * Classement horizontal (cinq premiers, marges par activité) : rang, libellé, barre en dégradé
 * texturée qui s'allonge à l'affichage, montant au bout. Une valeur négative passe au rouge.
 */
export function RankBars({ items, format, couleur = "var(--accent-vif)" }: { items: Array<{ key: string | number; label: string; value: number; detail?: string }>; format?: (v: number) => string; couleur?: string }) {
  const show = format ?? ((v: number) => fmtShort(v));
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <ol className="space-y-3">
      {items.map((item, i) => {
        const negatif = item.value < 0;
        const c = negatif ? "var(--danger-vif)" : couleur;
        return (
          <li key={item.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[13px] sm:grid-cols-[1.25rem_minmax(0,9.5rem)_minmax(0,1fr)]">
            <span className="text-right font-semibold tabular text-muted">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink-2" title={item.label}>
                {item.label}
              </span>
              {item.detail && <span className="block truncate text-[11.5px] text-muted">{item.detail}</span>}
            </span>
            <span className="col-start-2 flex min-w-0 items-center gap-2.5 sm:col-start-auto">
              <span className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-lg bg-panel-2">
                <span
                  className="n-pousser-x n-rayures-fixes absolute inset-y-0 left-0 rounded-lg"
                  style={{ width: `${Math.max(3, (Math.abs(item.value) / max) * 100)}%`, backgroundColor: c, opacity: 0.9, "--i": i } as CSSProperties}
                />
              </span>
              <span className={cx("w-[4.75rem] flex-none text-right font-semibold tabular", negatif ? "text-danger" : "text-ink")}>{show(item.value)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Anneau de progression (score sur 100, part des critères évalués) : il se remplit à l'affichage,
 * la valeur au centre défile. Sur fond sombre, `clair` passe le texte et la piste en blanc.
 */
export function Anneau({ value, max = 100, couleur = "var(--accent-vif)", taille = 120, epaisseur = 10, centre, sous, clair }: { value: number | null; max?: number; couleur?: string; taille?: number; epaisseur?: number; centre?: string; sous?: string; clair?: boolean }) {
  const r = 50 - epaisseur / 2 - 1;
  const part = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="relative flex-none" style={{ width: taille, height: taille }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden focusable="false">
        <circle cx="50" cy="50" r={r} fill="none" stroke={clair ? "rgb(255 255 255 / 0.18)" : "var(--panel-3)"} strokeWidth={epaisseur} />
        {value !== null && <circle cx="50" cy="50" r={r} fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(0.01, part)} ${100 - part}`} className="n-anneau" />}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className={cx("font-display font-bold leading-none tabular", clair ? "text-white" : "text-ink")} style={{ fontSize: taille * 0.24 }}>
            {centre ?? (value === null ? "–" : <Valeur value={String(Math.round(value))} />)}
          </div>
          {sous && <div className={cx("mt-1 text-[11.5px] font-semibold", clair ? "text-white/75" : "text-muted")}>{sous}</div>}
        </div>
      </div>
    </div>
  );
}

/** Petite courbe de tendance, sans axe ; la dernière valeur est marquée d'un point. */
export function Sparkline({ values, color = "var(--accent-vif)", height = 40 }: { values: number[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const W = 200;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, height - 4 - ((v - lo) / (hi - lo || 1)) * (height - 8)] as [number, number]);
  const d = courbe(pts);
  const dernier = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="h-10 w-full overflow-visible" aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${W},${height} L0,${height} Z`} fill={`url(#${id})`} className="n-apparaitre" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" pathLength={1} className="n-tracer" />
      <circle cx={dernier[0]} cy={dernier[1]} r="3.5" fill={color} stroke="var(--panel)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
