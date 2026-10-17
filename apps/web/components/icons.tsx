/**
 * Jeu d'icônes NIMOVA, dessiné pour le projet : grille de 24, un trait de 1,6 aux extrémités
 * arrondies, aucune dépendance. Les noms reprennent ceux de l'ancienne bibliothèque pour que les
 * écrans n'aient qu'un chemin d'import à changer ; `ICONES` les donne par nom à la navigation.
 */
import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { strokeWidth?: number | string; title?: string };
export type Icon = ((props: IconProps) => ReactNode) & { displayName?: string };

const POINT = { fill: "currentColor", stroke: "none" } as const;

function dessin(nom: string, contenu: ReactNode): Icon {
  function Icone({ strokeWidth = 1.6, title, className, ...props }: IconProps) {
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
  Icone.displayName = nom;
  return Icone;
}

const BOUCLIER = "M12 3 19.5 5.75v5.5c0 4.6-3.1 8.4-7.5 9.75-4.4-1.35-7.5-5.15-7.5-9.75v-5.5Z";
const FEUILLE = "M6 3.5h8l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5ZM14 3.5V8h4.5";

/* Actions */
export const Plus = dessin("Plus", <path d="M12 5v14M5 12h14" />);
export const X = dessin("X", <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const Pencil = dessin("Pencil", (
  <>
    <path d="M4.5 19.5 5.5 15 15.5 5a2.5 2.5 0 0 1 3.5 3.5l-10 10Z" />
    <path d="M13.5 7l3.5 3.5" />
  </>
));
export const Trash2 = dessin("Trash2", <path d="M4 6.5h16M9 6.5v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 6.5l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6M10 10.5v6M14 10.5v6" />);
export const Copy = dessin("Copy", (
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5" />
  </>
));
export const Search = dessin("Search", (
  <>
    <circle cx="10.5" cy="10.5" r="6.25" />
    <path d="M15.25 15.25 20 20" />
  </>
));
export const Download = dessin("Download", <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />);
export const FileUp = dessin("FileUp", <path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14" />);
export const ImageUp = FileUp;
export const Printer = dessin("Printer", (
  <>
    <path d="M7 8.5V4h10v4.5" />
    <path d="M7 17.5H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 8.5h14a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-2" />
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
    <path d="M10 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h4" />
    <path d="M15 7.5 19.5 12 15 16.5M19.5 12H9" />
  </>
));
export const Menu = dessin("Menu", <path d="M4 7h16M4 12h16M4 17h10" />);
export const Filter = dessin("Filter", <path d="M4 5h16l-6.25 7.5V19l-3.5 1.5v-8Z" />);
export const MoreHorizontal = dessin("MoreHorizontal", (
  <>
    <circle cx="6" cy="12" r="1.5" {...POINT} />
    <circle cx="12" cy="12" r="1.5" {...POINT} />
    <circle cx="18" cy="12" r="1.5" {...POINT} />
  </>
));
export const Grid = dessin("Grid", (
  <>
    {[6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" {...POINT} />))}
  </>
));

/* Directions */
export const ChevronDown = dessin("ChevronDown", <path d="M7 10l5 5 5-5" />);
export const ChevronUp = dessin("ChevronUp", <path d="M7 14l5-5 5 5" />);
export const ChevronRight = dessin("ChevronRight", <path d="M10 7l5 5-5 5" />);
export const ChevronLeft = dessin("ChevronLeft", <path d="M14 7l-5 5 5 5" />);
export const ChevronsLeft = dessin("ChevronsLeft", <path d="M11.5 7 6.5 12l5 5M17.5 7l-5 5 5 5" />);
export const ChevronsRight = dessin("ChevronsRight", <path d="M12.5 7l5 5-5 5M6.5 7l5 5-5 5" />);
export const ArrowUp = dessin("ArrowUp", <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />);
export const ArrowDown = dessin("ArrowDown", <path d="M12 5v14M6.5 13.5 12 19l5.5-5.5" />);
export const ArrowRight = dessin("ArrowRight", <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />);
export const ArrowUpRight = dessin("ArrowUpRight", <path d="M7 17 17 7M8.5 7H17v8.5" />);
export const ArrowLeftRight = dessin("ArrowLeftRight", <path d="M4 8.5h15.5M16 5l3.5 3.5L16 12M20 15.5H4.5M8 12l-3.5 3.5L8 19" />);
export const ArrowUpDown = dessin("ArrowUpDown", <path d="M8 4.5v15M4.5 8 8 4.5 11.5 8M16 19.5v-15M12.5 16l3.5 3.5 3.5-3.5" />);
/** Triangles pleins des variations (hausse, baisse). */
export const Hausse = dessin("Hausse", <path d="M12 6.5 18.5 17h-13Z" {...POINT} />);
export const Baisse = dessin("Baisse", <path d="M12 17.5 18.5 7h-13Z" {...POINT} />);
export const TrendingUp = dessin("TrendingUp", (
  <>
    <path d="M3.5 16.5 9 11l4 4 7.5-7.5" />
    <path d="M15 7.5h5.5V13" />
  </>
));
export const TrendingDown = dessin("TrendingDown", (
  <>
    <path d="M3.5 7.5 9 13l4-4 7.5 7.5" />
    <path d="M15 16.5h5.5V11" />
  </>
));

/* États */
export const Check = dessin("Check", <path d="M5 12.5l4.5 4.5L19 7.5" />);
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
    <path d="M12 11v5" />
    <circle cx="12" cy="7.9" r="1" {...POINT} />
  </>
));
export const AlertTriangle = dessin("AlertTriangle", (
  <>
    <path d="M10.3 4.6 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4.5" />
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
export const Bell = dessin("Bell", (
  <>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </>
));
/** Rosette de validation (« À valider »). */
export const BadgeCheck = dessin("BadgeCheck", (
  <>
    <path d="M12 3l2.2 1.6 2.7-.1.8 2.6 2.2 1.6-.9 2.6.9 2.6-2.2 1.6-.8 2.6-2.7-.1L12 21l-2.2-1.6-2.7.1-.8-2.6-2.2-1.6.9-2.6-.9-2.6 2.2-1.6.8-2.6 2.7.1Z" />
    <path d="M8.75 12.25 11 14.5l4.25-4.5" />
  </>
));

/* Sécurité */
export const Lock = dessin("Lock", (
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" />
  </>
));
export const Unlock = dessin("Unlock", (
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
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
export const FileSpreadsheet = dessin("FileSpreadsheet", (
  <>
    <path d={FEUILLE} />
    <path d="M8 12h8v6H8ZM8 15h8M12 12v6" />
  </>
));
export const FileStack = dessin("FileStack", (
  <>
    <path d="M9 3.5h6.5L20 8v9.5a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 17.5V5A1.5 1.5 0 0 1 9 3.5Z" />
    <path d="M15.5 3.5V8H20M4.5 7.5v12A1.5 1.5 0 0 0 6 21h9" />
  </>
));
export const Inbox = dessin("Inbox", (
  <>
    <path d="M3.5 13.5 6 5.5h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" />
    <path d="M3.5 13.5h5l1 2.5h5l1-2.5h5" />
  </>
));
export const Mail = dessin("Mail", (
  <>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3.5 7l8.5 6.5L20.5 7" />
  </>
));
export const Smartphone = dessin("Smartphone", (
  <>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.25" />
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
    <rect x="3.5" y="6.5" width="17" height="13" rx="2" />
    <path d="M3.5 8.5c0-1.2 1-2 2.1-2.3L15 3.6c.8-.2 1.5.4 1.5 1.2v1.7M14.5 11.5h6v4h-6a2 2 0 0 1 0-4Z" />
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
    <path d="M2.5 18h19M5 18v-3.5a7 7 0 0 1 14 0V18" />
    <path d="M9.5 8.2V13M14.5 8.2V13" />
  </>
));
export const Calculator = dessin("Calculator", (
  <>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8v3H8Z" />
    <path d="M8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01M8.5 17h.01M12 17h.01M15.5 17h.01" strokeWidth="2.4" />
  </>
));
export const LayoutDashboard = dessin("LayoutDashboard", (
  <>
    <rect x="3.5" y="3.5" width="7" height="9" rx="1.75" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.75" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.75" />
    <rect x="3.5" y="15.5" width="7" height="5" rx="1.75" />
  </>
));
export const Receipt = dessin("Receipt", (
  <>
    <path d="M5.5 3.5h13v17l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5Z" />
    <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
  </>
));
export const ShoppingCart = dessin("ShoppingCart", (
  <>
    <path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H6.6" />
    <circle cx="9" cy="19" r="1.5" />
    <circle cx="17" cy="19" r="1.5" />
  </>
));
export const Landmark = dessin("Landmark", (
  <>
    <path d="M3.5 9.5 12 4l8.5 5.5Z" />
    <path d="M5.75 12v6M9.9 12v6M14.1 12v6M18.25 12v6M3.5 20.5h17" />
  </>
));
export const Users = dessin("Users", (
  <>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </>
));
export const UserCog = dessin("UserCog", (
  <>
    <circle cx="9.5" cy="8" r="3.5" />
    <path d="M3 20a6.5 6.5 0 0 1 10-5.5" />
    <circle cx="17.5" cy="17" r="2.25" />
    <path d="M17.5 13.25v1.5M17.5 19.25v1.5M21.25 17h-1.5M15.25 17h-1.5" />
  </>
));
export const Boxes = dessin("Boxes", (
  <>
    <path d="M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9Z" />
    <path d="M4.5 7.5 12 11.5l7.5-4M12 11.5v9" />
  </>
));
/** Billet : dette et financement. */
export const HandCoins = dessin("HandCoins", (
  <>
    <rect x="3" y="6.5" width="18" height="11" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6.5 9.5h.01M17.5 14.5h.01" strokeWidth="2.4" />
  </>
));
export const BookOpen = dessin("BookOpen", (
  <>
    <path d="M12 6.5c-2-1.5-4.8-2-8.5-2v13c3.7 0 6.5.5 8.5 2 2-1.5 4.8-2 8.5-2v-13c-3.7 0-6.5.5-8.5 2Z" />
    <path d="M12 6.5v13" />
  </>
));
export const Scale = dessin("Scale", (
  <>
    <path d="M12 4v16.5M7.5 20.5h9M5 7.5h14" />
    <path d="M5 7.5 2.75 13a2.4 2.4 0 0 0 4.5 0Z" />
    <path d="M19 7.5 16.75 13a2.4 2.4 0 0 0 4.5 0Z" />
  </>
));
export const SlidersHorizontal = dessin("SlidersHorizontal", (
  <>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </>
));
/** Registre de contrôle : journal d'audit. */
export const ScrollText = dessin("ScrollText", (
  <>
    <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
    <path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4" />
  </>
));
export const FolderKanban = dessin("FolderKanban", (
  <>
    <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    <path d="M8.5 11v5M12 11v3M15.5 11v6" />
  </>
));
export const FolderOpen = dessin("FolderOpen", (
  <>
    <path d="M3.5 18.5V6a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h6.5A1.5 1.5 0 0 1 19 8.5V10" />
    <path d="M3.5 18.5 6 11h15.5L19 18.5Z" />
  </>
));
export const Gavel = dessin("Gavel", (
  <>
    <path d="m14.5 3.5 6 6-3 3-6-6Z" />
    <path d="m11.5 9.5-8 8 3 3 8-8" />
    <path d="M13 21h8" />
  </>
));
export const Clock = dessin("Clock", (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>
));
export const ListChecks = dessin("ListChecks", <path d="M3.5 6.5 5 8l3-3M3.5 13 5 14.5l3-3M11 6.5h9.5M11 13h9.5M11 19.5h9.5M4.5 19.5h2" />);
export const Calendar = dessin("Calendar", (
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </>
));
export const Home = dessin("Home", <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19Z" />);
export const Fuel = dessin("Fuel", (
  <>
    <path d="M4.5 20.5V5.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 20.5h13M4.5 10.5h10" />
    <path d="M14.5 8.5H16a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3" />
  </>
));
export const Droplet = dessin("Droplet", <path d="M12 3.5s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Z" />);
export const MapPin = dessin("MapPin", (
  <>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </>
));
export const Route = dessin("Route", (
  <>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8.5 18H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7.5" />
  </>
));
export const Gauge = dessin("Gauge", (
  <>
    <path d="M4.5 17.5a8.5 8.5 0 1 1 15 0" />
    <path d="M12 13.5 15.5 9" />
    <circle cx="12" cy="13.75" r="1.4" {...POINT} />
  </>
));
export const PieChart = dessin("PieChart", (
  <>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12Z" />
    <path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15Z" />
  </>
));
export const Target = dessin("Target", (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.75" />
    <circle cx="12" cy="12" r="1.25" {...POINT} />
  </>
));
export const Percent = dessin("Percent", (
  <>
    <path d="M18.5 5.5 5.5 18.5" />
    <circle cx="7.5" cy="7.5" r="2.25" />
    <circle cx="16.5" cy="16.5" r="2.25" />
  </>
));
export const Flag = dessin("Flag", <path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11" />);
export const Layers = dessin("Layers", (
  <>
    <path d="M12 3.5 21 8l-9 4.5L3 8Z" />
    <path d="M3 12l9 4.5 9-4.5M3 16l9 4.5 9-4.5" />
  </>
));
export const Coins = dessin("Coins", (
  <>
    <ellipse cx="9.5" cy="7" rx="5.5" ry="2.5" />
    <path d="M4 7v4c0 1.4 2.5 2.5 5.5 2.5S15 12.4 15 11V7" />
    <path d="M9 16.4c.3 1.2 2.6 2.1 5.5 2.1 3 0 5.5-1.1 5.5-2.5v-4c0-1.2-1.7-2.2-4.2-2.4" />
  </>
));

/** Icônes de la navigation, par le nom inscrit dans `lib/nav.ts`. */
export const ICONES: Record<string, Icon> = {
  LayoutDashboard,
  TrendingUp,
  FileText,
  BadgeCheck,
  Bell,
  Receipt,
  ShoppingCart,
  Landmark,
  Mail,
  Users,
  Boxes,
  HandCoins,
  BookOpen,
  FileSpreadsheet,
  Scale,
  Lock,
  Truck,
  HardHat,
  Building2,
  UserCog,
  SlidersHorizontal,
  ScrollText,
  FolderKanban,
  Gavel,
  Clock,
  ListChecks,
  FileStack,
  FolderOpen,
  Info,
  Layers,
  Target,
};
