"use client";

import { classesBouton, cx } from "@/components/ui";
import { ouvrirDiscussion } from "@/lib/discussions";
import { IconeDiscussion } from "./IconeDiscussion";

/**
 * Bouton « Discussion » d'une fiche (dossier AxisPro, chantier, rotation, bien) : ouvre, dans le panneau
 * de la coque, la conversation de la fiche, ouverte à qui peut lire la fiche (le noyau le vérifie).
 * `clair` : sur un fond sombre (bandeau d'un dossier).
 */
export function BoutonDiscussion({ model, id, libelle, clair, petit, className }: { model: string; id: number; libelle?: string; clair?: boolean; petit?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => ouvrirDiscussion({ objet: { model, id } })}
      aria-haspopup="dialog"
      aria-label={libelle ? `Discussion : ${libelle}` : undefined}
      className={cx(
        clair
          ? "inline-flex min-h-9 items-center gap-2 rounded-[10px] bg-white/15 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/25"
          : classesBouton("secondary", petit ? "sm" : "md"),
        className,
      )}
    >
      <IconeDiscussion className={petit ? "h-3.5 w-3.5" : "h-4 w-4"} />
      Discussion
    </button>
  );
}
