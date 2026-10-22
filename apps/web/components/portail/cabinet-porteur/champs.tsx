"use client";

/**
 * Champs des simulateurs : montants en GNF affichés avec les espaces des milliers (le curseur reste
 * à sa place pendant la saisie), nombres à virgule décimale (taux, mois, jours) bornés.
 */

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

const CHAMP =
  "w-full rounded-[10px] border border-line-strong/80 bg-panel py-2 pl-3 text-[15px] font-semibold tabular text-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-normal placeholder:text-muted/70 hover:border-line-strong focus:border-accent-vif focus:ring-4 focus:ring-accent-vif/15";

const milliers = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function Cadre({ id, label, aide, unite, children }: { id: string; label: string; aide?: ReactNode; unite?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <div className="relative">
        {children}
        {unite && <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] font-semibold text-muted">{unite}</span>}
      </div>
      {aide && <p id={`${id}-aide`} className="mt-1.5 text-[12px] leading-snug text-muted">{aide}</p>}
    </div>
  );
}

/** Montant entier (GNF) : « 250 000 000 », saisie libre, chiffres seuls retenus. */
export function ChampMontant({ label, value, onChange, aide, unite = "GNF" }: { label: string; value: number; onChange: (v: number) => void; aide?: ReactNode; unite?: string }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const chiffresAvant = useRef<number | null>(null);
  const texte = value > 0 ? milliers.format(Math.round(value)) : "";

  // Après reformatage, le curseur revient derrière le même nombre de chiffres.
  useLayoutEffect(() => {
    const el = ref.current;
    const n = chiffresAvant.current;
    if (!el || n === null || document.activeElement !== el) return;
    chiffresAvant.current = null;
    let pos = 0;
    let vus = 0;
    while (pos < el.value.length && vus < n) {
      if (/\d/.test(el.value.charAt(pos))) vus++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
  });

  return (
    <Cadre id={id} label={label} aide={aide} unite={unite}>
      <input
        ref={ref}
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={texte}
        placeholder="0"
        aria-describedby={aide ? `${id}-aide` : undefined}
        onChange={(e) => {
          const brut = e.target.value;
          const curseur = e.target.selectionStart ?? brut.length;
          const chiffres = brut.replace(/\D/g, "").replace(/^0+/, "").slice(0, 15);
          chiffresAvant.current = Math.min(chiffres.length, brut.slice(0, curseur).replace(/\D/g, "").length);
          onChange(chiffres ? Number(chiffres) : 0);
        }}
        className={cx(CHAMP, "pr-14")}
      />
    </Cadre>
  );
}

function lire(texte: string): number | null {
  const propre = texte.replace(/[\s  ]/g, "").replace(",", ".");
  if (propre === "" || propre === ".") return 0;
  const n = Number(propre);
  return Number.isFinite(n) ? n : null;
}

/** Nombre borné à virgule décimale (taux, durée, délai). */
export function ChampNombre({ label, value, onChange, aide, unite, min = 0, max, decimales = 0 }: { label: string; value: number; onChange: (v: number) => void; aide?: ReactNode; unite?: string; min?: number; max?: number; decimales?: number }) {
  const id = useId();
  const [saisie, setSaisie] = useState<string | null>(null);
  const affiche = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: decimales, useGrouping: false });
  const borne = (v: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, decimales ? v : Math.round(v)));
  return (
    <Cadre id={id} label={label} aide={aide} unite={unite}>
      <input
        id={id}
        inputMode={decimales ? "decimal" : "numeric"}
        autoComplete="off"
        value={saisie ?? affiche(value)}
        aria-describedby={aide ? `${id}-aide` : undefined}
        onFocus={() => setSaisie(affiche(value))}
        onBlur={() => setSaisie(null)}
        onChange={(e) => {
          const t = e.target.value.replace(decimales ? /[^\d,.\s]/g : /\D/g, "");
          setSaisie(t);
          const n = lire(t);
          if (n !== null) onChange(borne(n));
        }}
        className={cx(CHAMP, unite ? "pr-16" : "pr-3")}
      />
    </Cadre>
  );
}

/** Ligne de résultat : libellé à gauche, valeur à droite. */
export function Ligne({ label, valeur, fort, ton }: { label: ReactNode; valeur: ReactNode; fort?: boolean; ton?: "ok" | "danger" | "warn" }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 py-2.5", fort && "border-t border-line pt-3")}>
      <dt className={cx("text-[13.5px]", fort ? "font-semibold text-ink" : "text-ink-2")}>{label}</dt>
      <dd className={cx("text-right tabular", fort ? "text-[16px] font-bold" : "text-[14px] font-semibold", ton === "ok" ? "text-ok-texte" : ton === "danger" ? "text-danger" : ton === "warn" ? "text-warn" : "text-ink")}>{valeur}</dd>
    </div>
  );
}
