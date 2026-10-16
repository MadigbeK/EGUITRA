"use client";

import { useEffect, useState } from "react";
import { Input, Select, cx } from "@/components/ui";

/** Nombre saisi à la française (espaces, virgule décimale) ; null si la saisie n'est pas un nombre. */
export function lireNombre(texte: string): number | null {
  const t = texte.replace(/\s/g, "").replace(",", ".");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function ecrireNombre(n: number) {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
}

/**
 * Cellule numérique modifiable sur place : la valeur est enregistrée en quittant le champ, si elle a
 * changé ; une saisie invalide reprend la valeur précédente.
 */
export function CelluleNombre({ value, onSave, className, label, disabled }: { value: number; onSave: (v: number) => void; className?: string; label: string; disabled?: boolean }) {
  const [texte, setTexte] = useState(ecrireNombre(value));
  useEffect(() => setTexte(ecrireNombre(value)), [value]);
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      disabled={disabled}
      className={cx("min-h-8 px-2 py-1 text-right text-[13px] tabular", className ?? "min-w-28")}
      value={texte}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={() => {
        const n = lireNombre(texte);
        if (n === null) {
          setTexte(ecrireNombre(value));
          return;
        }
        if (n !== value) onSave(n);
        else setTexte(ecrireNombre(value));
      }}
    />
  );
}

export function CelluleTexte({ value, onSave, className, label, placeholder }: { value: string; onSave: (v: string) => void; className?: string; label: string; placeholder?: string }) {
  const [texte, setTexte] = useState(value);
  useEffect(() => setTexte(value), [value]);
  return (
    <Input
      aria-label={label}
      placeholder={placeholder}
      className={cx("min-h-8 px-2 py-1 text-[13px]", className ?? "min-w-44")}
      value={texte}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={() => texte.trim() !== value && onSave(texte.trim())}
    />
  );
}

export function CelluleChoix({ value, options, onSave, label, className }: { value: string; options: Record<string, string>; onSave: (v: string) => void; label: string; className?: string }) {
  return (
    <Select
      aria-label={label}
      className={cx("min-h-8 py-1 pl-2 text-[13px]", className ?? "min-w-40")}
      value={value}
      onChange={(e) => onSave(e.target.value)}
      options={Object.entries(options).map(([v, l]) => ({ value: v, label: l }))}
    />
  );
}

/** Montant en millions, une décimale (tableaux du modèle financier). */
export function millions(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const m = Math.round(v / 1e5) / 10;
  return (m === 0 ? 0 : m).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function ratio(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "–";
  return v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function annees(v: number | null | undefined): string {
  if (v === null || v === undefined) return "non atteint";
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} an${v >= 2 ? "s" : ""}`;
}
