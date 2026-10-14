import type { AppCode } from "./config";
import type { Profile } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  profiles?: Profile[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

const FIN: Profile[] = ["admin", "direction", "finance"];

/** Navigation par application ; chaque entrée n'apparaît qu'aux profils listés (offre, chapitre 3.4). */
export const NAV: Record<AppCode, NavSection[]> = {
  finance: [
    {
      label: "Pilotage",
      items: [
        { href: "/finance", label: "Tableau de bord", icon: "LayoutDashboard", profiles: FIN },
        { href: "/finance/pilotage", label: "Activités et budget", icon: "TrendingUp", profiles: FIN },
        { href: "/finance/approbations", label: "À valider", icon: "BadgeCheck" },
        { href: "/finance/alertes", label: "Alertes", icon: "Bell", profiles: FIN },
      ],
    },
    {
      label: "Comptabilité",
      items: [
        { href: "/finance/ventes", label: "Ventes", icon: "Receipt", profiles: FIN },
        { href: "/finance/achats", label: "Achats et dépenses", icon: "ShoppingCart", profiles: FIN },
        { href: "/finance/tresorerie", label: "Trésorerie", icon: "Landmark", profiles: FIN },
        { href: "/finance/tiers", label: "Tiers", icon: "Users", profiles: FIN },
        { href: "/finance/immobilisations", label: "Immobilisations", icon: "Boxes", profiles: FIN },
        { href: "/finance/dette", label: "Dette et financement", icon: "HandCoins", profiles: FIN },
        { href: "/finance/ecritures", label: "Journaux et OD", icon: "BookOpen", profiles: FIN },
        { href: "/finance/etats", label: "Balance et états", icon: "FileSpreadsheet", profiles: FIN },
        { href: "/finance/fiscalite", label: "Fiscalité", icon: "Scale", profiles: FIN },
        { href: "/finance/clotures", label: "Clôtures et contrôles", icon: "Lock", profiles: FIN },
      ],
    },
    {
      label: "Métiers",
      items: [
        { href: "/finance/transport", label: "Transport", icon: "Truck", profiles: ["admin", "direction", "finance", "exploitation"] },
        { href: "/finance/chantiers", label: "Chantiers", icon: "HardHat", profiles: ["admin", "direction", "finance", "chantiers"] },
        { href: "/finance/immobilier", label: "Immobilier", icon: "Building2", profiles: ["admin", "direction", "finance", "immobilier"] },
      ],
    },
    {
      label: "Administration",
      items: [
        { href: "/finance/admin/utilisateurs", label: "Utilisateurs", icon: "UserCog", profiles: ["admin"] },
        { href: "/finance/admin/parametres", label: "Seuils et taux", icon: "SlidersHorizontal", profiles: ["admin"] },
        { href: "/finance/admin/audit", label: "Journal d'audit", icon: "ScrollText", profiles: ["admin"] },
      ],
    },
  ],
  axispro: [
    {
      label: "Cabinet",
      items: [
        { href: "/axispro", label: "Dossiers", icon: "FolderKanban" },
        { href: "/axispro/comites", label: "Comités", icon: "Gavel" },
        { href: "/axispro/temps", label: "Temps et facturation", icon: "Clock" },
      ],
    },
    {
      label: "Méthode",
      items: [
        { href: "/axispro/grille", label: "Grille d'évaluation", icon: "ListChecks" },
        { href: "/axispro/pieces", label: "Pièces standard", icon: "FileStack" },
      ],
    },
    {
      label: "Administration",
      items: [{ href: "/axispro/admin/utilisateurs", label: "Utilisateurs", icon: "UserCog", profiles: ["admin"] }],
    },
  ],
  portail: [{ label: "Mon projet", items: [{ href: "/portail", label: "Mon dossier", icon: "FolderOpen" }] }],
  mobile: [{ label: "Rotations", items: [{ href: "/mobile", label: "Rotations", icon: "Truck" }] }],
};

export function navFor(app: AppCode, profiles: Profile[]): NavSection[] {
  return NAV[app]
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.profiles || item.profiles.some((p) => profiles.includes(p))),
    }))
    .filter((section) => section.items.length > 0);
}
