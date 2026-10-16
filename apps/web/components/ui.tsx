"use client";

import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, CheckCircle2, FileUp as FileUpIcon, Info, Loader2, X } from "@/components/icons";
import { cx } from "@/lib/cx";
import { fmtShort } from "@/lib/format";

export { cx };

/* ─── Mise en page ─────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-semibold leading-[1.1] text-ink">{title}</h1>
        {subtitle && <p className="mt-2 max-w-[78ch] text-sm leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Surface de contenu : un aplat crème posé sur le fond, sans bordure ni ombre. */
export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  const head = Boolean(title || actions);
  return (
    <section className={cx("min-w-0 rounded-xl bg-panel", className)}>
      {head && (
        <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pb-1 pt-4">
          {title && <h2 className="font-display text-[17px] font-semibold leading-snug text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={padded ? (head ? "px-5 pb-5 pt-2" : "p-5") : head ? "pb-2" : undefined}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

/** Repère de couleur d'un état ; le texte voisin dit toujours l'état en toutes lettres. */
const MARK: Record<Tone, string> = {
  neutral: "bg-line-strong/60",
  ok: "bg-ok",
  warn: "bg-or",
  danger: "bg-danger",
  accent: "bg-accent",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-2",
  ok: "text-ink-2",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-ink-2",
};

/** Filet supérieur d'un chiffre clé : sa couleur reprend l'état, le libellé le dit en toutes lettres. */
const RULE: Record<Tone, string> = {
  neutral: "border-foret/80",
  ok: "border-pin",
  warn: "border-or",
  danger: "border-danger",
  accent: "border-accent",
};

/**
 * Chiffre clé, présenté comme dans les « chiffres clés » d'un rapport annuel : un filet, le
 * libellé, la valeur. Posés côte à côte, ils forment une bande de chiffres plutôt qu'une grille
 * de cartes identiques.
 */
export function Kpi({ label, value, hint, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className={cx("min-w-0 border-t-2 pb-1 pt-3", RULE[tone])}>
      <div className="text-[13px] font-medium leading-tight text-ink-2">{label}</div>
      <div className={cx("mt-2.5 font-display text-[26px] font-semibold leading-none", tone === "danger" ? "text-danger" : "text-ink")}>{value}</div>
      {hint && <div className="mt-2 text-[12.5px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium leading-5", TONE_TEXT[tone])}>
      <span aria-hidden className={cx("h-[7px] w-[7px] flex-none rounded-[2px]", MARK[tone])} />
      {children}
    </span>
  );
}

/* ─── Contrôles ────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "border border-line-strong/70 text-ink hover:border-line-strong hover:bg-panel-2",
  ghost: "text-ink-2 hover:bg-panel-2 hover:text-ink",
  danger: "border border-danger/60 text-danger hover:bg-danger hover:text-creme",
};

export function Button({ variant = "secondary", loading, className, children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        BUTTON[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

const FIELD = "w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted/75 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-muted";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(FIELD, "min-h-9", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(FIELD, "min-h-[84px] leading-relaxed", props.className)} />;
}

export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string | number; label: string }>; placeholder?: string }) {
  return (
    <select {...props} className={cx(FIELD, "champ-liste min-h-9", props.className)}>
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

/* ─── États ────────────────────────────────────────────────────────────── */

export function Loading({ label = "Chargement des données…" }: { label?: string }) {
  return (
    <div role="status" className="py-12">
      <div className="barre-attente mx-auto w-48 rounded-full" />
      <p className="mt-3 text-center text-sm text-muted">{label}</p>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Une erreur est survenue.";
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg bg-danger/[0.07] px-4 py-3 text-sm text-danger">
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

/** État vide : trois lignes de registre, la dernière plus courte. */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <svg viewBox="0 0 48 24" className="mb-1 h-6 w-12 text-line-strong/60" aria-hidden focusable="false">
        <path d="M0 4h48M0 12h48M0 20h28" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
      <div className="text-sm font-medium text-ink-2">{title}</div>
      {hint && <div className="max-w-md text-[13px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

const NOTICE: Record<Tone, string> = {
  neutral: "bg-panel-2 text-ink-2",
  ok: "bg-ok/[0.08] text-ink",
  warn: "bg-or/[0.16] text-ink",
  danger: "bg-danger/[0.07] text-danger",
  accent: "bg-accent/[0.07] text-ink",
};

const NOTICE_ICON: Record<Tone, string> = {
  neutral: "text-muted",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent",
};

export function Notice({ tone = "accent", children }: { tone?: Tone; children: ReactNode }) {
  const Icon = tone === "warn" || tone === "danger" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cx("flex items-start gap-3 rounded-lg px-4 py-3 text-sm leading-relaxed", NOTICE[tone])}>
      <Icon className={cx("mt-[3px] h-4 w-4 flex-none", NOTICE_ICON[tone])} />
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
  const pad = dense ? "px-3 py-1.5" : "px-3 py-2.5";
  const alignOf = (c: Column<T>) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left");
  const onKey = (row: T) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row);
    }
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined} className={cx(pad, "whitespace-nowrap font-medium", alignOf(c))}>
                  <button
                    type="button"
                    onClick={() => setSort(active ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}
                    className={cx("group inline-flex items-center gap-1 text-[12.5px] font-medium hover:text-ink", c.align === "right" && "flex-row-reverse", active ? "text-ink" : "text-muted")}
                  >
                    {c.label}
                    <span aria-hidden className={cx("inline-flex", !active && "opacity-0 group-hover:opacity-50")}>
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
              className={cx("border-b border-line/80 last:border-0", onRowClick && "cursor-pointer outline-offset-[-2px] hover:bg-panel-2")}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx(pad, alignOf(c), c.align === "right" && "font-mono", c.className)}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="tabular border-t border-ink/25 font-semibold">{footer}</tfoot>}
      </table>
    </div>
  );
}

/**
 * Étapes d'un parcours (gates d'un dossier) : franchies, en cours, à venir. Ici les numéros ont
 * un sens, ils donnent l'ordre du parcours.
 */
export function Etapes({ steps }: { steps: Array<{ key: string; label: string; state: "done" | "current" | "todo"; title?: string }> }) {
  return (
    <ol className="grid gap-3 sm:flex sm:gap-0">
      {steps.map((s, i) => (
        <li key={s.key} title={s.title} className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:items-start sm:gap-2.5">
          <div className="flex items-center sm:w-full">
            <span
              className={cx(
                "grid h-7 w-7 flex-none place-items-center rounded-md font-mono text-[13px] font-semibold",
                s.state === "done" ? "bg-accent text-accent-ink" : s.state === "current" ? "bg-or text-foret" : "border border-line-strong/70 text-muted",
              )}
            >
              {s.state === "done" ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            {i < steps.length - 1 && <span aria-hidden className={cx("mx-2 hidden h-px flex-1 sm:block", s.state === "done" ? "bg-accent" : "bg-line-strong/50")} />}
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
    <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong/70 font-semibold text-ink transition-colors hover:border-line-strong hover:bg-panel-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent", small ? "px-2.5 py-1 text-[12.5px]" : "min-h-9 px-3.5 py-1.5 text-sm")}>
      <FileUpIcon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {label}
      <input type="file" className="sr-only" accept={accept} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
}

/* ─── Onglets et fenêtres ──────────────────────────────────────────────── */

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: Array<{ key: K; label: string; count?: number }>; value: K; onChange: (key: K) => void }) {
  return (
    <div role="tablist" className="no-print mb-5 flex flex-wrap gap-x-6 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cx("-mb-px border-b-2 py-2.5 text-sm font-medium transition-colors", value === t.key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 font-mono text-[12px] text-muted">{t.count}</span>}
        </button>
      ))}
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foret/50 p-4 md:p-10" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx("w-full rounded-xl bg-panel shadow-[0_28px_70px_-20px_rgb(20_47_41/0.45)]", wide ? "max-w-4xl" : "max-w-lg")}>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="font-display text-[19px] font-semibold leading-snug text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="-mr-1 grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/* ─── Chiffres et graphiques (SVG et HTML, sans dépendance) ─────────────── */

/**
 * Compteur : un montant affiché chiffre par chiffre, comme sur le compteur volumétrique d'une
 * citerne. Les rouleaux tournent une fois au premier affichage (sauf mouvement réduit). Un seul
 * compteur par écran : c'est le chiffre que l'écran met en avant.
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
        <span aria-hidden className="compteur-unite ml-[0.12em] self-end font-sans text-[0.3em] font-semibold tracking-[0.04em] text-muted">
          {unit}
        </span>
      )}
    </span>
  );
}

/** Info-bulle d'un repère de graphique : la valeur d'abord, le libellé ensuite. */
function Bulle({ label, value }: { label: string; value: string }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foret px-2.5 py-1.5 text-left shadow-[0_8px_24px_-8px_rgb(20_47_41/0.5)]">
      <span className="block font-mono text-[13px] font-semibold text-creme">{value}</span>
      <span className="block text-[11.5px] text-[#c4d6cd]">{label}</span>
    </span>
  );
}

/**
 * Colonnes d'une série : barres fines (24 px au plus), extrémité arrondie, valeurs négatives sous
 * la ligne de base, info-bulle au survol et au clavier, dernière colonne étiquetée.
 */
export function BarChart({ data, height = 180, format }: { data: Array<{ label: string; value: number; tone?: Tone }>; height?: number; format?: (v: number) => string }) {
  const [focus, setFocus] = useState<number | null>(null);
  const show = format ?? ((v: number) => String(v));
  const pos = Math.max(0, ...data.map((d) => d.value));
  const neg = Math.max(0, ...data.map((d) => -d.value));
  const span = Math.max(1, pos + neg);
  const base = (pos / span) * 100;
  const last = data.length - 1;
  return (
    <div>
      <div className="relative flex gap-1.5" style={{ height }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-line/80" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-line-strong/40" style={{ top: `${base}%` }} />
        {pos > 0 && (
          <span aria-hidden className="pointer-events-none absolute left-0 top-0 -translate-y-1/2 bg-panel pr-1.5 font-mono text-[11px] text-muted">
            {fmtShort(pos)}
          </span>
        )}
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / span) * 100;
          const negative = d.value < 0;
          const color = negative ? "bg-danger" : d.tone === "accent" ? "bg-or" : "bg-accent";
          return (
            <div
              key={`${d.label}-${i}`}
              tabIndex={0}
              aria-label={`${d.label} : ${show(d.value)}`}
              onPointerEnter={() => setFocus(i)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              className="relative flex min-w-0 flex-1 justify-center outline-offset-2"
            >
              <div
                className={cx("absolute w-full max-w-6 transition-opacity", color, negative ? "rounded-b-[4px]" : "rounded-t-[4px]", focus !== null && focus !== i && "opacity-55")}
                style={negative ? { top: `${base}%`, height: `${Math.max(h, 0.8)}%` } : { bottom: `${100 - base}%`, height: `${Math.max(h, 0.8)}%` }}
              />
              {i === last && focus === null && (
                <span aria-hidden className="absolute -translate-y-full whitespace-nowrap pb-1 font-mono text-[11.5px] font-semibold text-ink" style={negative ? { top: `${base}%` } : { bottom: `${100 - base + h}%`, transform: "none" }}>
                  {fmtShort(d.value)}
                </span>
              )}
              {focus === i && <Bulle label={d.label} value={show(d.value)} />}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        {data.map((d, i) => (
          <span key={`${d.label}-${i}`} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const METER: Record<Tone, [string, string]> = {
  neutral: ["bg-line", "bg-line-strong"],
  ok: ["bg-ok/15", "bg-ok"],
  warn: ["bg-or/25", "bg-or"],
  danger: ["bg-danger/15", "bg-danger"],
  accent: ["bg-accent/15", "bg-accent"],
};

/** Jauge : le remplissage porte l'état, le fond est un pas plus clair de la même teinte. */
export function ProgressBar({ value, tone = "accent" }: { value: number; tone?: Tone }) {
  const pct = Math.max(0, Math.min(100, value));
  const [track, fill] = METER[tone];
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-[3px]", track)}>
      <div className={cx("h-full rounded-r-[3px]", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Répartition d'un total en segments (six au plus), séparés par un filet de la couleur du fond.
 * La légende donne chaque part en toutes lettres : la couleur n'est jamais seule.
 */
export function Repartition({ parts, format }: { parts: Array<{ key: string; label: string; value: number; color: string }>; format?: (v: number) => string }) {
  const [focus, setFocus] = useState<string | null>(null);
  const show = format ?? ((v: number) => String(v));
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px]">
        {total === 0 ? (
          <div className="h-full w-full rounded-[3px] bg-line" />
        ) : (
          visible.map((p, i) => (
            <div
              key={p.key}
              tabIndex={0}
              aria-label={`${p.label} : ${show(p.value)}`}
              onPointerEnter={() => setFocus(p.key)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(p.key)}
              onBlur={() => setFocus(null)}
              className={cx("relative h-full outline-offset-2 transition-opacity", i === 0 && "rounded-l-[3px]", i === visible.length - 1 && "rounded-r-[3px]", focus && focus !== p.key && "opacity-50")}
              style={{ width: `${(p.value / total) * 100}%`, minWidth: 3, background: p.color }}
            >
              {focus === p.key && <Bulle label={p.label} value={`${show(p.value)} (${Math.round((p.value / total) * 100)} %)`} />}
            </div>
          ))
        )}
      </div>
      <ul className="mt-4 space-y-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-ink-2">
              <span aria-hidden className="h-2.5 w-2.5 flex-none translate-y-[1px] rounded-[2px]" style={{ background: p.color }} />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="font-mono text-ink">{show(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
