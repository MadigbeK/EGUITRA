"use client";

import { cx } from "@/components/ui";

/** Bascule entre la société de travail et la vue consolidée du groupe. */
export function ScopeToggle({ value, onChange }: { value: "company" | "group"; onChange: (v: "company" | "group") => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel p-0.5 text-sm">
      {(
        [
          ["company", "Société"],
          ["group", "Groupe consolidé"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cx("rounded-md px-3 py-1.5 transition", value === key ? "bg-accent text-accent-ink" : "text-muted hover:text-ink")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
