"use client";

import { Segmented } from "@/components/ui";

/** Bascule entre la société de travail et la vue consolidée du groupe. */
export function ScopeToggle({ value, onChange }: { value: "company" | "group"; onChange: (v: "company" | "group") => void }) {
  return (
    <Segmented
      label="Périmètre"
      value={value}
      onChange={onChange}
      options={[
        { key: "company", label: "Société" },
        { key: "group", label: "Groupe consolidé" },
      ]}
    />
  );
}
