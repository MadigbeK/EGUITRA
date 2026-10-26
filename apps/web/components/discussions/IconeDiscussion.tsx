import type { IconProps } from "@/components/icons";

/** Bulles de discussion, au dessin du jeu d'icônes NIMOVA (grille de 24, trait de 1,6). */
export function IconeDiscussion({ strokeWidth = 1.6, className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden className={className ?? "h-4 w-4"} {...props}>
      <path d="M15.5 9.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1v3l3.5-3" />
      <path d="M11 10.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v2.5l-3-2.5h-2a2 2 0 0 1-2-2Z" />
    </svg>
  );
}
