"use client";

import { cx } from "@/components/ui";

/** Bascule entre la société de travail et la vue consolidée du groupe. */
export function ScopeToggle({ value, onChange }: { value: "company" | "group"; onChange: (v: "company" | "group") => void }) {
  return (
    <div role="group" aria-label="Périmètre" className="inline-flex rounded-lg border border-line-strong/50 bg-panel p-[3px] text-sm">
      {(
        [
          ["company", "Société"],
          ["group", "Groupe consolidé"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cx("inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium transition-colors", value === key ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-panel-2 hover:text-ink")}
        >
          {key === "group" && <span aria-hidden className={cx("h-1.5 w-1.5 rotate-45", value === key ? "bg-or" : "bg-or/70")} />}
          {label}
        </button>
      ))}
    </div>
  );
}
