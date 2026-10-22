/**
 * Trois pictogrammes absents du jeu NIMOVA et propres aux écrans du cabinet : l'étoile des avis,
 * le signet des favoris et la lecture vidéo. Même grille de 24 et même trait que `components/icons`.
 */
import type { ReactNode } from "react";
import type { Icon, IconProps } from "@/components/icons";

function picto(nom: string, contenu: ReactNode): Icon {
  function Picto({ strokeWidth = 1.6, title, className, ...props }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
        className={className ?? "h-4 w-4"}
        {...props}
      >
        {title && <title>{title}</title>}
        {contenu}
      </svg>
    );
  }
  Picto.displayName = nom;
  return Picto;
}

export const Etoile = picto("Etoile", <path d="M12 3.6l2.55 5.2 5.7.83-4.13 4.02.98 5.68L12 16.65l-5.1 2.68.98-5.68-4.13-4.02 5.7-.83Z" />);
export const Signet = picto("Signet", <path d="M7 3.5h10a1 1 0 0 1 1 1V20.5l-6-4-6 4V4.5a1 1 0 0 1 1-1Z" />);
export const Lecture = picto("Lecture", (
  <>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M10.3 9.2v5.6l4.6-2.8Z" fill="currentColor" stroke="none" />
  </>
));
