"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BadgeCheck, Bell, BookOpen, Boxes, Building2, ChevronDown, Clock, FileSpreadsheet, FileStack, FolderKanban,
  FolderOpen, Gavel, HandCoins, HardHat, KeyRound, Landmark, LayoutDashboard, ListChecks, Lock, LogOut, Menu,
  Receipt, Scale, ScrollText, ShoppingCart, SlidersHorizontal, TrendingUp, Truck, UserCog, Users, X,
  type LucideIcon,
} from "lucide-react";
import { APPS, type AppCode } from "@/lib/config";
import { navFor } from "@/lib/nav";
import type { Me } from "@/lib/types";
import { cx } from "@/components/ui";

const ICONS: Record<string, LucideIcon> = {
  BadgeCheck, Bell, BookOpen, Boxes, Building2, Clock, FileSpreadsheet, FileStack, FolderKanban, FolderOpen, Gavel,
  HandCoins, HardHat, Landmark, LayoutDashboard, ListChecks, Lock, Receipt, Scale, ScrollText, ShoppingCart,
  SlidersHorizontal, TrendingUp, Truck, UserCog, Users,
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function AppShell({ app, me, children }: { app: AppCode; me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const sections = navFor(app, me.profiles);
  const home = APPS[app].home;
  const company = me.companies.find((c) => c.id === me.company_id);

  async function logout() {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = `/login?app=${app}`;
  }

  async function switchCompany(id: number) {
    await fetch("/api/session/company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: id, app }),
    });
    router.refresh();
  }

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.label}>
          <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/80">{section.label}</div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon] ?? LayoutDashboard;
              const active = item.href === home ? pathname === home : pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cx(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition",
                      active ? "bg-panel-2 text-accent" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    <Icon className="h-4 w-4 flex-none" strokeWidth={1.8} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div data-app={app} className="flex min-h-screen bg-bg text-ink">
      {/* Barre latérale */}
      <aside
        className={cx(
          "no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-panel transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-4">
          <Link href={home} className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-sm font-black text-accent-ink">
              {app === "axispro" ? "AX" : "EG"}
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight">{APPS[app].name}</span>
              <span className="block text-[11px] text-muted">{APPS[app].tagline}</span>
            </span>
          </Link>
          <button type="button" className="text-muted md:hidden" onClick={() => setOpen(false)} aria-label="Fermer le menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        {nav}
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur md:px-8">
          <button type="button" className="text-muted md:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {me.companies.length > 1 ? (
              <select
                value={me.company_id}
                onChange={(e) => switchCompany(Number(e.target.value))}
                className="max-w-[260px] truncate rounded-lg border border-line bg-panel px-2 py-1.5 text-sm text-ink"
                aria-label="Société"
              >
                {me.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="truncate text-ink-2">{company?.name}</span>
            )}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-panel">
              <span className="grid h-8 w-8 place-items-center rounded-full border border-accent/60 text-xs font-bold text-accent">{initials(me.name)}</span>
              <span className="hidden text-sm text-ink-2 md:inline">{me.name}</span>
              <ChevronDown className="h-4 w-4 text-muted" />
            </button>
            {menu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-line bg-panel p-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
                <Link href="/compte/mot-de-passe" className="flex items-center gap-2 rounded px-3 py-2 text-sm text-ink-2 hover:bg-panel-2">
                  <KeyRound className="h-4 w-4" /> Changer le mot de passe
                </Link>
                {me.apps.filter((a) => a !== app && a !== "mobile").map((a) => (
                  <Link key={a} href={APPS[a].home} className="flex items-center gap-2 rounded px-3 py-2 text-sm text-ink-2 hover:bg-panel-2">
                    <LayoutDashboard className="h-4 w-4" /> {APPS[a].name}
                  </Link>
                ))}
                <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-danger hover:bg-danger/10">
                  <LogOut className="h-4 w-4" /> Se déconnecter
                </button>
              </div>
            )}
          </div>
        </header>
        {me.password_change_required && (
          <div className="no-print border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn md:px-8">
            Votre mot de passe est provisoire.{" "}
            <Link href="/compte/mot-de-passe" className="underline underline-offset-2">
              Choisissez votre mot de passe
            </Link>
            .
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
