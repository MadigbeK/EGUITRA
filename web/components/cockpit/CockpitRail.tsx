"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  Users as UsersIcon,
  Package,
  FileQuestion,
  AlertTriangle,
  Receipt,
  RotateCcw,
  Truck,
  Warehouse,
  ClipboardCheck,
  Boxes,
  Percent,
  Crown,
  Phone,
  TrendingUp,
  BarChart2,
  FileBarChart,
  Database,
  UserCog,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";

/* ════════════════════════════════════════════════════════════════════════════
   CockpitRail — rail de navigation natif cockpit (vert sombre, mono).
   Remplace TOTALEMENT l'ancien Shell (plus de triple barre navy).
   Rail gauche compact : logo, items icône+label, footer config + sortie.
   ════════════════════════════════════════════════════════════════════════════ */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: { text: string; tone: "yellow" | "magenta" | "cyan" };
}

/* Les badges des counts seront injectés dynamiquement via props. */
const MAIN_BASE: NavItem[] = [
  { href: "/finance",                label: "Dirigeant",  icon: LayoutDashboard },
  { href: "/finance/pilotage",       label: "Pilotage",   icon: TrendingUp },
  { href: "/finance/ventes",         label: "Ventes",     icon: Receipt },
  { href: "/finance/achats",         label: "Achats",     icon: ShoppingCart },
  { href: "/finance/tresorerie",     label: "Trésorerie", icon: Database },
  { href: "/finance/tiers",          label: "Tiers",      icon: UsersIcon },
  { href: "/finance/immobilisations",label: "Immos",      icon: Boxes },
  { href: "/finance/journaux",       label: "Journaux",   icon: ClipboardList },
  { href: "/finance/balance",        label: "Balance",    icon: BarChart2 },
  { href: "/finance/budget",         label: "Budget",     icon: Percent },
  { href: "/finance/alertes",        label: "Alertes",    icon: AlertTriangle },
  { href: "/finance/clotures",       label: "Clôtures",   icon: ClipboardCheck },
];

const FOOTER: NavItem[] = [
  { href: "/finance/approbations",   label: "À valider",  icon: Crown },
  { href: "/finance/rapports",       label: "Rapports",   icon: FileBarChart },
  { href: "/finance/exports",        label: "Exports",    icon: Package },
  { href: "/finance/parametres",     label: "Config",     icon: Settings },
];

const BADGE_COLOR: Record<string, string> = {
  yellow: "#E0A83C",
  magenta: "#F2777A",
  cyan: "#3DD6F5",
};

export interface CockpitCounts {
  approbations_en_attente: number;
  alertes_actives: number;
}

export function CockpitRail({ initials, counts }: { initials: string; counts?: CockpitCounts }) {
  const pathname = usePathname();

  const MAIN: NavItem[] = MAIN_BASE.map(item => {
    if (!counts) return item;
    if (item.href === "/finance/alertes" && counts.alertes_actives > 0)
      return { ...item, badge: { text: String(counts.alertes_actives), tone: "magenta" as const } };
    return item;
  });
  const FOOT: NavItem[] = FOOTER.map(item => {
    if (!counts) return item;
    if (item.href === "/finance/approbations" && counts.approbations_en_attente > 0)
      return { ...item, badge: { text: String(counts.approbations_en_attente), tone: "yellow" as const } };
    return item;
  });

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(item.href + "/");
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href as never}
        title={item.label}
        className={`group relative flex h-[58px] w-full flex-col items-center justify-center gap-1 rounded-md transition-colors ${
          active
            ? "bg-[#1a2156] text-[#E0A83C]"
            : "text-[#8FA2C0] hover:bg-[#141a46] hover:text-[#EEF3F6]"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
        <span className="text-[9px] font-medium leading-none tracking-tight">{item.label}</span>
        {item.badge && (
          <span
            className="absolute right-2 top-1.5 grid min-w-[15px] place-items-center rounded-full px-1 text-[8.5px] font-bold leading-tight text-[#0a0c24]"
            style={{ backgroundColor: BADGE_COLOR[item.badge.tone] }}
          >
            {item.badge.text}
          </span>
        )}
        {active && (
          <span className="absolute left-0 top-1/2 h-7 w-0.5 -translate-y-1/2 rounded-r bg-[#E0A83C]" />
        )}
      </Link>
    );
  };

  return (
    <aside className="sticky top-0 flex h-screen w-[76px] flex-none flex-col border-r border-[#262d6b] bg-[#07091c] py-3 font-mono">
      {/* Logo + avatar */}
      <div className="flex flex-col items-center gap-2 px-2 pb-3">
        <img src="/logo-mark.png" alt="EGUITRA Finance" className="h-9 w-9 rounded-md object-contain" />
        <div className="grid h-9 w-9 place-items-center rounded-md border border-[#E0A83C]/50 bg-[#141a46] text-xs font-bold text-[#E0A83C]">
          {initials}
        </div>
      </div>

      <div className="mx-3 mb-2 border-t border-[#262d6b]" />

      {/* Nav principale */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
        {MAIN.map(renderItem)}
      </nav>

      {/* Footer */}
      <div className="mt-2 flex flex-col gap-1 px-2">
        <div className="mx-1 mb-1 border-t border-[#262d6b]" />
        {FOOT.map(renderItem)}
        <button
          type="button"
          onClick={logout}
          title="Se déconnecter"
          className="flex h-[58px] w-full flex-col items-center justify-center gap-1 rounded-md text-[#8FA2C0] transition-colors hover:bg-[#F2777A]/10 hover:text-[#F2777A]"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.8} />
          <span className="text-[9px] font-medium leading-none">Sortie</span>
        </button>
      </div>
    </aside>
  );
}
