"use client";

/**
 * Champs des simulateurs : montants en GNF affichés avec les espaces des milliers (le curseur reste
 * à sa place pendant la saisie), nombres à virgule décimale (taux, mois, jours) bornés. Toute saisie se
 * lit par lireNombre (lib/format.ts) : une saisie illisible (« 2.500.000 », « 30 j ») est signalée sous le
 * champ et laisse la valeur précédente, au lieu d'être lue 0, multipliée ou divisée par mille.
 */

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { AIDE_NOMBRE, fmtDec, fmtInt, lireNombre } from "@/lib/format";

const CHAMP =
  "w-full rounded-[10px] border border-line-strong/80 bg-panel py-2 pl-3 text-[15px] font-semibold tabular text-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-normal placeholder:text-muted/70 hover:border-line-strong focus:border-accent-vif focus:ring-4 focus:ring-accent-vif/15";
const CHAMP_ERREUR = "border-danger focus:border-danger focus:ring-danger/15";
/** Plus grand montant accepté (15 chiffres). */
const MONTANT_MAX = 999_999_999_999_999;

function Cadre({ id, label, aide, erreur, unite, children }: { id: string; label: string; aide?: ReactNode; erreur?: string | null; unite?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <div className="relative">
        {children}
        {unite && <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] font-semibold text-muted">{unite}</span>}
      </div>
      {erreur ? (
        <p id={`${id}-erreur`} role="alert" className="mt-1.5 text-[12px] font-medium leading-snug text-danger">
          {erreur}
        </p>
      ) : (
        aide && <p id={`${id}-aide`} className="mt-1.5 text-[12px] leading-snug text-muted">{aide}</p>
      )}
    </div>
  );
}

function decrit(id: string, aide: ReactNode, erreur: string | null): string | undefined {
  if (erreur) return `${id}-erreur`;
  return aide ? `${id}-aide` : undefined;
}

/**
 * Montant entier (GNF) : « 250 000 000 ». Chiffres et espaces sont regroupés pendant la frappe ; une autre
 * saisie (virgule, point) est lue par lireNombre et doit donner un montant entier positif.
 */
export function ChampMontant({ label, value, onChange, aide, unite = "GNF" }: { label: string; value: number; onChange: (v: number) => void; aide?: ReactNode; unite?: string }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const chiffresAvant = useRef<number | null>(null);
  // Saisie gardée telle quelle tant qu'elle ne se lit pas comme un montant (le porteur la corrige).
  const [brute, setBrute] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const texte = brute ?? (value > 0 ? fmtInt(Math.round(value)) : "");

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

  function saisir(saisie: string, curseur: number) {
    if (!saisie.trim()) {
      setBrute(null);
      setErreur(null);
      onChange(0);
      return;
    }
    const n = lireNombre(saisie);
    if (n === null) {
      setBrute(saisie);
      setErreur(AIDE_NOMBRE);
      return;
    }
    if (n < 0 || !Number.isInteger(n)) {
      setBrute(saisie);
      setErreur("Montant positif en GNF, sans décimale : écrivez par exemple 2 500 000.");
      return;
    }
    if (n > MONTANT_MAX) {
      setBrute(saisie);
      setErreur("Montant trop élevé.");
      return;
    }
    setErreur(null);
    onChange(n);
    if (/^[\d\s  ]*$/.test(saisie)) {
      // Chiffres et espaces seulement : regroupement immédiat des milliers.
      setBrute(null);
      chiffresAvant.current = saisie.slice(0, curseur).replace(/\D/g, "").replace(/^0+/, "").length;
    } else {
      // « 1 500 000,00 » : lu, mais laissé tel quel pendant la frappe (aucun chiffre ne se colle au montant).
      setBrute(saisie);
    }
  }

  return (
    <Cadre id={id} label={label} aide={aide} erreur={erreur} unite={unite}>
      <input
        ref={ref}
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={texte}
        placeholder="0"
        aria-invalid={erreur ? true : undefined}
        aria-describedby={decrit(id, aide, erreur)}
        onChange={(e) => saisir(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onBlur={() => !erreur && setBrute(null)}
        className={cx(CHAMP, "pr-14", erreur && CHAMP_ERREUR)}
      />
    </Cadre>
  );
}

/** Nombre borné à virgule décimale (taux, durée, délai), lu par lireNombre. */
export function ChampNombre({ label, value, onChange, aide, unite, min = 0, max, decimales = 0 }: { label: string; value: number; onChange: (v: number) => void; aide?: ReactNode; unite?: string; min?: number; max?: number; decimales?: number }) {
  const id = useId();
  const [saisie, setSaisie] = useState<string | null>(null);
  // « refus » : la saisie n'est pas retenue (illisible, décimale dans un entier) ; « borne » : elle est
  // ramenée dans les bornes, et le champ dit pourquoi.
  const [erreur, setErreur] = useState<{ texte: string; nature: "refus" | "borne" } | null>(null);
  const affiche = (v: number) => (decimales ? fmtDec(Math.round(v * 10 ** decimales) / 10 ** decimales) : fmtInt(v));

  function saisir(t: string) {
    setSaisie(t);
    if (!t.trim()) {
      setErreur(null);
      onChange(Math.max(min, 0));
      return;
    }
    const n = lireNombre(t);
    if (n === null) {
      setErreur({ texte: AIDE_NOMBRE, nature: "refus" });
      return;
    }
    if (!decimales && !Number.isInteger(n)) {
      setErreur({ texte: "Nombre entier attendu.", nature: "refus" });
      return;
    }
    const borne = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, n));
    if (borne !== n) {
      const plage = max !== undefined ? `Entre ${affiche(min)} et ${affiche(max)}${unite ? ` ${unite}` : ""}` : `Au moins ${affiche(min)}`;
      setErreur({ texte: `${plage} : valeur ramenée à ${affiche(borne)}.`, nature: "borne" });
      onChange(borne);
      return;
    }
    setErreur(null);
    onChange(n);
  }

  return (
    <Cadre id={id} label={label} aide={aide} erreur={erreur?.texte} unite={unite}>
      <input
        id={id}
        inputMode={decimales ? "decimal" : "numeric"}
        autoComplete="off"
        value={saisie ?? affiche(value)}
        aria-invalid={erreur?.nature === "refus" ? true : undefined}
        aria-describedby={decrit(id, aide, erreur?.texte ?? null)}
        onFocus={() => setSaisie((s) => s ?? affiche(value))}
        onBlur={() => {
          // Une saisie refusée reste affichée avec son message, pour être corrigée ; sinon le champ
          // reprend la valeur retenue.
          if (erreur?.nature === "refus") return;
          setSaisie(null);
          setErreur(null);
        }}
        onChange={(e) => saisir(e.target.value)}
        className={cx(CHAMP, unite ? "pr-16" : "pr-3", erreur?.nature === "refus" && CHAMP_ERREUR)}
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
