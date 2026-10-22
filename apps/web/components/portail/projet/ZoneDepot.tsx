"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { FileUp } from "@/components/icons";
import { cx } from "@/components/ui";
import { FORMATS, FORMATS_TEXTE } from "@/components/portail/commun";

/**
 * Zone de dépôt : on y glisse un fichier, ou on le choisit sur l'appareil (clic, clavier).
 * Un seul fichier à la fois.
 */
export function ZoneDepot({ onFile, disabled, titre = "Glissez un document ici" }: { onFile: (f: File) => void; disabled?: boolean; titre?: string }) {
  const id = useId();
  const [survol, setSurvol] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  function deposer(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setSurvol(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setSurvol(true);
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={deposer}
      className={cx(
        "relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-5 py-8 text-center transition-colors focus-within:border-accent-vif focus-within:ring-4 focus-within:ring-accent-vif/15",
        disabled ? "border-line bg-panel-2 opacity-60" : survol ? "border-accent-vif bg-accent-doux" : "border-line-strong/70 bg-panel-2/50 hover:border-accent-vif/60",
      )}
    >
      <span aria-hidden className={cx("grid h-12 w-12 place-items-center rounded-full transition-transform", survol ? "scale-110 bg-accent text-white" : "bg-accent-doux text-accent")}>
        <FileUp className="h-6 w-6" />
      </span>
      <p className="text-[14px] font-semibold text-ink">{survol ? "Déposez le fichier" : titre}</p>
      <p className="text-[13px] text-muted">
        ou{" "}
        <label htmlFor={id} className={cx("font-semibold text-accent underline underline-offset-2", disabled ? "cursor-not-allowed" : "cursor-pointer hover:text-accent-strong")}>
          choisissez-le sur votre appareil
        </label>
      </p>
      <input
        ref={champ}
        id={id}
        type="file"
        accept={FORMATS}
        aria-label="Choisir un document à envoyer au cabinet"
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          if (champ.current) champ.current.value = "";
        }}
      />
      <p className="text-[12px] leading-snug text-muted">{FORMATS_TEXTE}</p>
    </div>
  );
}
