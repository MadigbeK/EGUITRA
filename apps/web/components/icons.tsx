/**
 * Jeu d'icônes NIMOVA, dessiné pour le projet : grille de 24, un seul trait de 1,5, extrémités
 * franches et angles vifs (le dessin du monogramme), aucune dépendance. Les noms reprennent ceux
 * de l'ancienne bibliothèque pour que les écrans n'aient qu'un chemin d'import à changer.
 *
 * Règle d'usage : une icône seulement quand elle dit quelque chose que le texte ne dit pas
 * (bouton sans libellé, état, pièce jointe). Les menus et la plupart des boutons restent en texte.
 */
import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { strokeWidth?: number | string; title?: string };
export type Icon = ((props: IconProps) => ReactNode) & { displayName?: string };

const POINT = { fill: "currentColor", stroke: "none" } as const;

function dessin(nom: string, contenu: ReactNode): Icon {
  function Icone({ strokeWidth = 1.5, title, className, ...props }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
  Icone.displayName = nom;
  return Icone;
}

const BOUCLIER = "M12 3 19.5 5.75v5.5c0 4.6-3.1 8.4-7.5 9.75-4.4-1.35-7.5-5.15-7.5-9.75v-5.5Z";
const FEUILLE = "M5.5 3.5h8.5l4.5 4.5v12.5h-13ZM14 3.5V8h4.5";

/* Actions */
export const Plus = dessin("Plus", <path d="M12 4.5v15M4.5 12h15" />);
export const X = dessin("X", <path d="M6 6l12 12M18 6 6 18" />);
export const Pencil = dessin("Pencil", (
  <>
    <path d="M4.5 19.5 5.5 15 15.5 5l3.5 3.5-10 10Z" />
    <path d="M13.5 7l3.5 3.5" />
  </>
));
export const Trash2 = dessin("Trash2", <path d="M3.5 6.5h17M9 6.5v-3h6v3M6 6.5l1 14h10l1-14M10 10.5v6.5M14 10.5v6.5" />);
export const Copy = dessin("Copy", (
  <>
    <rect x="8.5" y="8.5" width="12" height="12" />
    <path d="M15.5 8.5v-5h-12v12h5" />
  </>
));
export const Search = dessin("Search", (
  <>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5.5 5.5" />
  </>
));
export const Download = dessin("Download", <path d="M12 3.5v12M7 10.5l5 5 5-5M4.5 20h15" />);
export const FileUp = dessin("FileUp", <path d="M12 16V4M7 9l5-5 5 5M4.5 20h15" />);
export const ImageUp = FileUp;
export const Printer = dessin("Printer", (
  <>
    <path d="M7 8.5v-5h10v5" />
    <path d="M7 17.5H3.5v-9h17v9H17" />
    <path d="M7 14h10v6.5H7Z" />
  </>
));
export const Send = dessin("Send", (
  <>
    <path d="M20.5 3.5 3.5 10.5l7 3 3 7Z" />
    <path d="M10.5 13.5l10-10" />
  </>
));
export const RefreshCw = dessin("RefreshCw", (
  <>
    <path d="M19.5 12a7.5 7.5 0 0 1-13.4 4.6M4.5 12a7.5 7.5 0 0 1 13.4-4.6" />
    <path d="M18.5 3.5v4.25h-4.25M5.5 20.5v-4.25h4.25" />
  </>
));
export const RotateCcw = dessin("RotateCcw", (
  <>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 3.75v4.5H9" />
  </>
));
export const Undo2 = dessin("Undo2", (
  <>
    <path d="M9 14.5 4.5 10 9 5.5" />
    <path d="M4.5 10h10a5 5 0 0 1 0 10h-3" />
  </>
));
export const Paperclip = dessin("Paperclip", <path d="M16.5 7.5 9 15a1.9 1.9 0 0 0 2.7 2.7l7.6-7.6a3.9 3.9 0 0 0-5.5-5.5L6.2 12.2a5.9 5.9 0 0 0 8.4 8.4l5.4-5.4" />);
export const Link2 = dessin("Link2", <path d="M9.5 16H7a4 4 0 0 1 0-8h2.5M14.5 8H17a4 4 0 0 1 0 8h-2.5M8.5 12h7" />);
export const LogOut = dessin("LogOut", (
  <>
    <path d="M10 4H4.5v16H10" />
    <path d="M15 7.5 19.5 12 15 16.5M19.5 12H9" />
  </>
));
export const Menu = dessin("Menu", <path d="M3.5 7.5h17M3.5 12h17M3.5 16.5h17" />);

/* Directions */
export const ChevronDown = dessin("ChevronDown", <path d="M6.5 9.5 12 15l5.5-5.5" />);
export const ChevronRight = dessin("ChevronRight", <path d="M9.5 6.5 15 12l-5.5 5.5" />);
export const ChevronLeft = dessin("ChevronLeft", <path d="M14.5 6.5 9 12l5.5 5.5" />);
export const ArrowUp = dessin("ArrowUp", <path d="M12 19.5v-15M6.5 10 12 4.5 17.5 10" />);
export const ArrowDown = dessin("ArrowDown", <path d="M12 4.5v15M6.5 14 12 19.5 17.5 14" />);
export const ArrowRight = dessin("ArrowRight", <path d="M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5" />);
export const ArrowLeftRight = dessin("ArrowLeftRight", <path d="M4 8.5h15.5M16 5l3.5 3.5L16 12M20 15.5H4.5M8 12l-3.5 3.5L8 19" />);
export const ArrowUpDown = dessin("ArrowUpDown", <path d="M8 4.5v15M4.5 8 8 4.5 11.5 8M16 19.5v-15M12.5 16l3.5 3.5 3.5-3.5" />);
/** Triangles pleins des variations (hausse, baisse). */
export const Hausse = dessin("Hausse", <path d="M12 6.5 18.5 17h-13Z" {...POINT} />);
export const Baisse = dessin("Baisse", <path d="M12 17.5 18.5 7h-13Z" {...POINT} />);

/* États */
export const Check = dessin("Check", <path d="M4.5 12.5l5 5 10-11" />);
export const CheckCheck = dessin("CheckCheck", <path d="M2.5 12.5l4.5 4.5 8.5-9.5M11.5 15.5l1.5 1.5 8.5-9.5" />);
export const Circle = dessin("Circle", <circle cx="12" cy="12" r="8.5" />);
export const CheckCircle2 = dessin("CheckCircle2", (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8 12.5l2.75 2.75L16.25 9.5" />
  </>
));
export const XCircle = dessin("XCircle", (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </>
));
export const Info = dessin("Info", (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 10.5v6" />
    <circle cx="12" cy="7.75" r="1" {...POINT} />
  </>
));
export const AlertTriangle = dessin("AlertTriangle", (
  <>
    <path d="M12 3.75 21.25 19.75H2.75Z" />
    <path d="M12 9.5v5" />
    <circle cx="12" cy="17" r="1" {...POINT} />
  </>
));
export const TriangleAlert = AlertTriangle;
export const ShieldAlert = dessin("ShieldAlert", (
  <>
    <path d={BOUCLIER} />
    <path d="M12 8.5v5" />
    <circle cx="12" cy="16" r="1" {...POINT} />
  </>
));
export const ShieldCheck = dessin("ShieldCheck", (
  <>
    <path d={BOUCLIER} />
    <path d="M8.75 12l2.25 2.25 4.25-4.5" />
  </>
));
export const ShieldOff = dessin("ShieldOff", (
  <>
    <path d={BOUCLIER} />
    <path d="M4 4l16 16" />
  </>
));
export const Loader2 = dessin("Loader2", <path d="M20.5 12A8.5 8.5 0 1 1 12 3.5" />);
export const Wifi = dessin("Wifi", (
  <>
    <path d="M4 9.25a11.5 11.5 0 0 1 16 0M6.75 12.5a7.5 7.5 0 0 1 10.5 0M9.5 15.75a3.6 3.6 0 0 1 5 0" />
    <circle cx="12" cy="18.75" r="1.1" {...POINT} />
  </>
));
export const CloudOff = dessin("CloudOff", (
  <>
    <path d="M8 18.5H6.5a4 4 0 0 1-.6-7.95A6 6 0 0 1 17.3 8.6a4.75 4.75 0 0 1 1.2 9.6" />
    <path d="M3.5 3.5l17 17" />
  </>
));

/* Sécurité */
export const Lock = dessin("Lock", (
  <>
    <rect x="5" y="10.5" width="14" height="10" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" />
  </>
));
export const Unlock = dessin("Unlock", (
  <>
    <rect x="5" y="10.5" width="14" height="10" />
    <path d="M8 10.5V8a4 4 0 0 1 7.75-1.4M12 14.5v2.5" />
  </>
));
export const LockOpen = Unlock;
export const KeyRound = dessin("KeyRound", (
  <>
    <circle cx="8" cy="15.5" r="4" />
    <path d="M10.9 12.6 19.5 4M16.5 7l2.5 2.5M14 9.5l2 2" />
  </>
));

/* Objets */
export const FileText = dessin("FileText", (
  <>
    <path d={FEUILLE} />
    <path d="M8.5 12.5h7M8.5 15.5h7M8.5 18.5h4" />
  </>
));
export const FileCheck2 = dessin("FileCheck2", (
  <>
    <path d={FEUILLE} />
    <path d="M8.75 14.5l2.25 2.25 4.25-4.5" />
  </>
));
export const Inbox = dessin("Inbox", (
  <>
    <path d="M3.5 13.5 6 5.5h12l2.5 8v6h-17Z" />
    <path d="M3.5 13.5h5l1 2.5h5l1-2.5h5" />
  </>
));
export const Mail = dessin("Mail", (
  <>
    <rect x="3" y="5.5" width="18" height="13" />
    <path d="M3 6.25l9 7 9-7" />
  </>
));
export const Smartphone = dessin("Smartphone", (
  <>
    <rect x="6.5" y="2.5" width="11" height="19" />
    <path d="M10.5 18.5h3" />
  </>
));
export const Building2 = dessin("Building2", (
  <>
    <path d="M4 20.5v-15l8-2.5v17.5M12 9h8v11.5M2.5 20.5h19" />
    <path d="M7.5 8.5H9M7.5 12H9M7.5 15.5H9M15.5 12.5H17M15.5 16H17" />
  </>
));
export const Wallet = dessin("Wallet", (
  <>
    <rect x="3.5" y="6.5" width="17" height="13" />
    <path d="M3.5 6.5l13-3v3M14.5 11.5h6v4h-6Z" />
  </>
));
/** Camion-citerne : le métier premier d'EGUITRA. */
export const Truck = dessin("Truck", (
  <>
    <rect x="2.5" y="8" width="11.5" height="6.5" rx="3.25" />
    <path d="M14 10h3.5l3 3.25V17H14ZM2.5 17H14" />
    <circle cx="6" cy="18.25" r="1.75" />
    <circle cx="17.25" cy="18.25" r="1.75" />
  </>
));
export const HardHat = dessin("HardHat", (
  <>
    <path d="M3 17.5h18M5 17.5v-2.75a7 7 0 0 1 14 0v2.75" />
    <path d="M10 8.25V6h4v2.25" />
  </>
));
export const Calculator = dessin("Calculator", (
  <>
    <rect x="5" y="3" width="14" height="18" />
    <path d="M8 7h8v3H8Z" />
    <path d="M8.25 13.5h1.5M11.25 13.5h1.5M14.25 13.5h1.5M8.25 17h1.5M11.25 17h1.5M14.25 17h1.5" />
  </>
));
