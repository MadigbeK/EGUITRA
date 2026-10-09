"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Brand } from "@/components/brand/brand";

export interface NavItemDef {
  href: string;
  label: string;
  /** Icône SVG (16-20px conseillé) */
  icon: ReactNode;
  /** Pastille compteur ou alerte */
  badge?: { text: string; tone?: "neutral" | "orange" | "danger" | "green" };
  /** Marque l'item courant actif */
  active?: boolean;
  /** Variant logout (rouge) */
  danger?: boolean;
}

export interface NavGroupDef {
  items: NavItemDef[];
}

export interface UserDef {
  initials: string;
  label: string;
  sublabel?: string;
}

export interface BreadcrumbDef {
  label: string;
  href?: string;
}

export interface UtilityInfoDef {
  /** "MODE CLIENT" / "MODE ADMIN · LIVE" — pill décorative */
  modePill?: { text: string; tone?: "green" | "orange" };
  /** Sync info ("Odoo sync · il y a 34s") */
  syncInfo?: string;
  /** Date courante */
  date?: string;
  /** Heure */
  time?: string;
  /** Devise / langue */
  locale?: string;
}

interface ShellProps {
  /** Mode = client (vert vif) ou admin (orange) — détermine la couleur active sidebar */
  mode?: "client" | "admin";
  user: UserDef;
  /** Navigation principale sidebar (items en col compacte) */
  nav: NavItemDef[];
  /** Footer sidebar (Aide, Sortie...) */
  navFooter?: NavItemDef[];
  /** Breadcrumb dans utility bar */
  breadcrumb?: BreadcrumbDef[];
  /** Infos utility bar (mode pill, sync, date, etc.) */
  utility?: UtilityInfoDef;
  /** Top nav (Catalogue, Actualités, Conseiller...) — null si pas voulu */
  topnav?: { label: string; href: string; active?: boolean }[];
  /** Cart count (pill orange dans top bar) */
  cartCount?: number;
  /** Notifications count (badge bell, mode admin uniquement en général) */
  notifCount?: number;
  /** Slot custom tout en bas de la sidebar (ex: LogoutButton interactif) */
  sidebarExtraFooter?: ReactNode;
  /** Contenu principal */
  children: ReactNode;
}

export function Shell({
  mode = "client",
  user,
  nav,
  navFooter = [],
  breadcrumb = [],
  utility,
  topnav,
  cartCount,
  notifCount,
  sidebarExtraFooter,
  children,
}: ShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* ════ Top bar 2 rows ════ */}
      <TopUtility breadcrumb={breadcrumb} utility={utility} mode={mode} />
      <TopMain
        topnav={topnav}
        cartCount={cartCount}
        notifCount={notifCount}
        user={user}
        mode={mode}
        onMenuToggle={() => setDrawerOpen((o) => !o)}
      />

      {/* Backdrop drawer mobile */}
      <div
        className={cn(
          "fixed inset-0 z-[55] bg-black/50 transition-opacity duration-200 md:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* ════ Shell : sidebar + main ════ */}
      <div className="grid min-h-[calc(100vh-96px)] grid-cols-1 md:grid-cols-[88px_1fr] xl:grid-cols-[96px_1fr]">
        <Sidebar
          mode={mode}
          user={user}
          nav={nav}
          navFooter={navFooter}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          extraFooter={sidebarExtraFooter}
        />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Top bar — utility row (40px) avec breadcrumb + mode pill + sync
   ───────────────────────────────────────────────────────────────── */
function TopUtility({
  breadcrumb,
  utility,
  mode,
}: {
  breadcrumb?: BreadcrumbDef[];
  utility?: UtilityInfoDef;
  mode: "client" | "admin";
}) {
  return (
    <div
      className={cn(
        "chrome-utility sticky top-0 z-[51] flex h-10 items-center gap-4 border-b border-line px-4 text-xs text-ink-3 md:px-6",
        mode === "admin"
          ? "bg-gradient-to-r from-[oklch(15%_0.040_250)] to-[oklch(17%_0.060_60)]"
          : "bg-[oklch(15%_0.040_250)]",
      )}
    >
      {/* Breadcrumb */}
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Fil d'Ariane" className="hidden flex-1 items-center gap-1.5 sm:flex">
          {breadcrumb.map((b, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={i} className="inline-flex items-center gap-1.5">
                {b.href && !isLast ? (
                  <Link href={b.href as any} className="hover:text-ink-2">
                    {b.label}
                  </Link>
                ) : (
                  <span className={isLast ? "font-semibold text-ink" : ""}>{b.label}</span>
                )}
                {!isLast && <span className="text-ink-4">/</span>}
              </span>
            );
          })}
        </nav>
      )}

      {/* Mode pill (admin LIVE / client) */}
      {utility?.modePill && (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest",
            utility.modePill.tone === "orange"
              ? "bg-brand-orange-soft text-brand-orange"
              : "bg-brand-green-soft text-brand-green-vif",
          )}
        >
          <span
            className={cn(
              "h-1 w-1 rounded-full",
              utility.modePill.tone === "orange" ? "bg-brand-orange" : "bg-brand-green-vif",
              "animate-pulse-soft",
            )}
          />
          {utility.modePill.text}
        </span>
      )}

      {/* Right side : sync + date + locale */}
      <div className="ml-auto hidden flex-wrap items-center gap-3.5 sm:flex">
        {utility?.syncInfo && (
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-green-vif shadow-[0_0_0_3px_oklch(60%_0.180_145_/_.18)]" />
            {utility.syncInfo}
          </span>
        )}
        {(utility?.date || utility?.time) && (
          <span>
            {utility.date}
            {utility.time && (
              <>
                {" · "}
                <b className="font-mono font-medium text-ink-2">{utility.time}</b>
              </>
            )}
          </span>
        )}
        {utility?.locale && <span>{utility.locale}</span>}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Top bar — main row (56px) avec brand + nav + search + cart + avatar
   ───────────────────────────────────────────────────────────────── */
function TopMain({
  topnav,
  cartCount,
  notifCount,
  user,
  mode,
  onMenuToggle,
}: {
  topnav?: { label: string; href: string; active?: boolean }[];
  cartCount?: number;
  notifCount?: number;
  user: UserDef;
  mode: "client" | "admin";
  onMenuToggle: () => void;
}) {
  return (
    <div className="chrome-topbar sticky top-10 z-50 flex h-14 items-center gap-2 border-b border-line bg-[oklch(20%_0.040_250_/_.96)] px-4 backdrop-blur-md md:px-6">
      {/* Hamburger mobile only */}
      <button
        onClick={onMenuToggle}
        className="grid h-9 w-9 place-items-center rounded border border-line bg-panel text-ink-2 md:hidden"
        aria-label="Ouvrir le menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      <Brand
        size="md"
        tagline={mode === "admin" ? "EGUITRA Finance · Admin · Commercial" : "Pharma · Conakry · depuis 1985"}
        taglineTone={mode === "admin" ? "orange" : "muted"}
      />

      {topnav && topnav.length > 0 && (
        <nav className="ml-8 hidden gap-0.5 md:flex">
          {topnav.map((n) => (
            <Link
              key={n.href}
              href={n.href as any}
              className={cn(
                "rounded px-3.5 py-1.5 text-sm font-medium transition-colors",
                n.active
                  ? mode === "admin"
                    ? "text-brand-orange"
                    : "text-brand-green-vif"
                  : "text-ink-3 hover:bg-panel hover:text-ink",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Notifications (admin) */}
        {typeof notifCount === "number" && (
          <button
            className="relative grid h-8 w-8 place-items-center rounded border border-line bg-panel text-ink-2 hover:bg-panel-2 hover:text-ink"
            aria-label="Notifications"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10 21a2 2 0 0 0 4 0" />
            </svg>
            {notifCount > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-[14px] place-items-center rounded-pill bg-danger px-1 font-mono text-[9px] font-bold text-white shadow-[0_0_0_2px_oklch(20%_0.040_250)]">
                {notifCount}
              </span>
            )}
          </button>
        )}

        {/* Cart (client) */}
        {typeof cartCount === "number" && (
          <Link
            href={"/panier" as any}
            className="inline-flex h-8 items-center gap-2 rounded bg-brand-orange px-3 text-xs font-bold text-brand-navy-deep hover:brightness-110"
          >
            Panier
            <span className="rounded-pill bg-brand-navy-deep px-1.5 font-mono text-[10px] text-brand-orange">
              {cartCount}
            </span>
          </Link>
        )}

        {/* Avatar staff/client */}
        <div
          className={cn(
            "grid h-8 w-8 place-items-center rounded font-display text-xs font-bold",
            mode === "admin"
              ? "border border-line-strong bg-brand-navy text-ink"
              : "bg-gradient-to-br from-brand-green-vif to-brand-green-deep text-brand-navy-deep",
          )}
          title={user.label}
        >
          {user.initials}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Sidebar 88px (desktop) / drawer 240px (mobile)
   ───────────────────────────────────────────────────────────────── */
function Sidebar({
  mode,
  user,
  nav,
  navFooter,
  open,
  onClose,
  extraFooter,
}: {
  mode: "client" | "admin";
  user: UserDef;
  nav: NavItemDef[];
  navFooter: NavItemDef[];
  open: boolean;
  onClose: () => void;
  extraFooter?: ReactNode;
}) {
  return (
    <aside
      className={cn(
        // Desktop : sidebar 88px collée à gauche, sticky sous top bar
        "chrome-sidebar border-r border-line bg-[oklch(16%_0.030_250)] md:sticky md:top-[96px] md:flex md:h-[calc(100vh-96px)] md:flex-col md:gap-1 md:overflow-y-auto md:px-2 md:py-4",
        // Mobile : drawer 240px overlay
        "fixed inset-y-0 left-0 z-[60] flex w-60 flex-col gap-1 overflow-y-auto px-3 py-4 transition-transform duration-200 md:translate-x-0 md:w-auto md:px-2",
        open ? "translate-x-0 shadow-[18px_0_36px_oklch(0%_0_0_/_.4)]" : "-translate-x-full",
      )}
    >
      {/* Avatar block */}
      <div className="flex flex-col items-center pb-3">
        <div
          className={cn(
            "grid h-12 w-12 place-items-center rounded-lg font-display text-lg font-bold",
            mode === "admin"
              ? "border border-brand-orange bg-gradient-to-br from-brand-navy to-brand-navy-deep text-ink shadow-[inset_0_1px_0_oklch(100%_0_0_/_.15),0_0_0_3px_oklch(72%_0.180_55_/_.15)]"
              : "bg-gradient-to-br from-brand-green-vif to-brand-green-deep text-brand-navy-deep shadow-[inset_0_1px_0_oklch(100%_0_0_/_.2),0_0_0_3px_oklch(60%_0.180_145_/_.12)]",
          )}
        >
          {user.initials}
        </div>
        <div
          className={cn(
            "mt-2 px-2 text-center font-mono text-[9px] font-bold uppercase tracking-widest",
            mode === "admin" ? "text-brand-orange" : "text-ink-3",
          )}
        >
          {user.sublabel ?? user.label}
        </div>
      </div>

      {nav.map((item, i) => (
        <NavItem key={i} item={item} mode={mode} onNavigate={onClose} />
      ))}

      {(navFooter.length > 0 || extraFooter) && (
        <div className="mt-auto flex flex-col gap-1 pt-2">
          <div className="mx-4 border-t border-line" />
          {navFooter.map((item, i) => (
            <NavItem key={`f-${i}`} item={item} mode={mode} onNavigate={onClose} />
          ))}
          {extraFooter && <div className="px-1 md:px-0">{extraFooter}</div>}
        </div>
      )}
    </aside>
  );
}

function NavItem({
  item,
  mode,
  onNavigate,
}: {
  item: NavItemDef;
  mode: "client" | "admin";
  onNavigate: () => void;
}) {
  const activeBg =
    mode === "admin"
      ? "bg-gradient-to-br from-brand-orange-soft to-transparent text-brand-orange"
      : "bg-gradient-to-br from-brand-green-soft to-transparent text-brand-green-vif";

  const dotIndicator =
    mode === "admin"
      ? "bg-brand-green-vif shadow-[0_0_0_2px_oklch(60%_0.180_145_/_.2)]"
      : "bg-brand-orange shadow-[0_0_0_2px_oklch(72%_0.180_55_/_.2)]";

  return (
    <Link
      href={item.href as any}
      onClick={onNavigate}
      title={item.label}
      className={cn(
        // Desktop : tile carrée 72×62 centered
        "relative mx-auto flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        // Mobile : full row left-aligned
        "md:h-[62px] md:w-[72px] md:flex-col md:justify-center md:gap-1 md:px-0 md:py-0 md:text-[10px]",
        item.active
          ? cn(activeBg, "md:active")
          : item.danger
            ? "text-danger hover:bg-danger/10"
            : "text-ink-3 hover:bg-panel hover:text-ink-2",
      )}
    >
      <span className="h-5 w-5 flex-none md:h-5 md:w-5 [&_svg]:h-full [&_svg]:w-full">
        {item.icon}
      </span>
      <span className="md:font-semibold md:tracking-tight md:leading-none">{item.label}</span>

      {/* Badge compteur */}
      {item.badge && (
        <span
          className={cn(
            "ml-auto rounded-pill border px-1.5 font-mono text-[10px] font-bold leading-tight",
            "md:absolute md:right-2 md:top-1.5 md:ml-0 md:rounded-pill md:px-1 md:text-[8.5px]",
            item.badge.tone === "danger"
              ? "border-danger/40 bg-danger text-white md:border-0"
              : item.badge.tone === "orange"
                ? "border-brand-orange/40 bg-brand-orange text-brand-navy-deep md:border-0"
                : item.badge.tone === "green"
                  ? "border-success/40 bg-success text-brand-navy-deep md:border-0"
                  : "border-line bg-bg-2 text-ink-3",
          )}
        >
          {item.badge.text}
        </span>
      )}

      {/* Indicateur dot right (desktop seul) — orange pour client, vert pour admin */}
      {item.active && (
        <span
          className={cn(
            "absolute -right-[9px] top-1/2 hidden h-1.5 w-1.5 -translate-y-1/2 rounded-full md:block",
            dotIndicator,
          )}
        />
      )}
    </Link>
  );
}
