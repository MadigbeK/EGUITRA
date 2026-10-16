"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MarqueCabinet, Monogramme, moduleOf } from "@/components/brand";
import { ChevronDown, KeyRound, LogOut, Menu, X } from "@/components/icons";
import { APPS, type AppCode } from "@/lib/config";
import { navFor } from "@/lib/nav";
import type { Company, Me } from "@/lib/types";
import { cx } from "@/components/ui";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Société d'une fiche : le groupe (vert forêt) ou le cabinet (bleu nuit). */
function entityOf(company: Company | undefined, app: AppCode): "groupe" | "cabinet" {
  if (company?.entity) return company.entity;
  return app === "axispro" || app === "portail" ? "cabinet" : "groupe";
}

const PASTILLE: Record<"groupe" | "cabinet", string> = { groupe: "bg-foret", cabinet: "bg-nuit" };

/**
 * Coque des applications. À gauche, le dos du registre : sa couleur et son titre disent dans
 * quels livres on travaille (vert forêt pour EGUITRA GROUP, bleu nuit pour MB AxisPro Consulting).
 * Puis la colonne de navigation, en texte seul, avec le choix de la société.
 */
export function AppShell({ app, me, children }: { app: AppCode; me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sections = navFor(app, me.profiles);
  const home = APPS[app].home;
  const company = me.companies.find((c) => c.id === me.company_id);
  const entity = entityOf(company, app);

  // Tiroir du téléphone : Échap le ferme, le focus va au bouton de fermeture puis revient au menu.
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const trigger = menuButton.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  async function logout() {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = `/login?app=${app}`;
  }

  async function switchCompany(id: number) {
    if (id === me.company_id) return;
    const res = await fetch("/api/session/company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: id, app }),
    }).catch(() => null);
    // Rechargement complet : aucune donnée de l'autre société ne doit rester affichée (les écrans
    // gardent en mémoire les réponses déjà reçues).
    if (res?.ok) window.location.reload();
  }

  const passwordBanner = me.password_change_required && (
    <div className="no-print bg-or/20 px-5 py-2.5 text-sm text-ink md:px-10">
      Votre mot de passe est provisoire.{" "}
      <Link href="/compte/mot-de-passe" className="font-semibold underline underline-offset-2">
        Choisissez votre mot de passe
      </Link>
      .
    </div>
  );

  if (app === "portail") {
    return (
      <div data-app={app} data-societe="cabinet" className="min-h-screen bg-bg text-ink">
        <header className="no-print sur-dos bg-dos text-dos-ink">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 md:px-8">
            <Link href={home} className="rounded-md">
              <MarqueCabinet clair />
            </Link>
            <CompteMenu app={app} me={me} onLogout={logout} placement="bas" />
          </div>
        </header>
        {passwordBanner}
        <main className="mx-auto min-w-0 max-w-6xl px-5 py-8 md:px-8 md:py-10">{children}</main>
      </div>
    );
  }

  const navigation = (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-6">
        <Link href={home} onClick={() => setOpen(false)} className="inline-block rounded-md leading-none">
          <span className="block font-display text-[20px] font-semibold tracking-[0.08em] text-foret">NIMOVA</span>
          <span className="mt-1 block text-[13px] font-medium text-muted">{moduleOf(app)}</span>
        </Link>
        {me.companies.length <= 1 && company && <p className="mt-3 text-[12.5px] leading-snug text-ink-2">{company.name}</p>}
      </div>

      {me.companies.length > 1 && (
        <div className="px-3 pb-4">
          <div aria-hidden className="px-2 pb-1.5 text-[12px] font-medium text-muted">
            Société
          </div>
          <div role="group" aria-label="Société" className="space-y-0.5">
            {me.companies.map((c) => {
              const active = c.id === me.company_id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => switchCompany(c.id)}
                  className={cx("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors", active ? "bg-panel-2 font-semibold text-ink" : "text-ink-2 hover:bg-panel-2")}
                >
                  <span aria-hidden className={cx("grid h-4 w-4 flex-none place-items-center rounded-[4px]", PASTILLE[entityOf(c, app)])}>
                    {active && <span className="h-1.5 w-1.5 rounded-[1px] bg-or" />}
                  </span>
                  <span className="min-w-0 truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <nav aria-label="Navigation" className="flex-1 space-y-5 overflow-y-auto border-t border-line px-3 pb-6 pt-5">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="px-2 pb-1.5 text-[12px] font-medium text-muted">{section.label}</div>
            <ul className="space-y-px">
              {section.items.map((item) => {
                const active = item.href === home ? pathname === home : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center justify-between gap-2 rounded-lg px-2 py-[7px] text-[14px] leading-tight transition-colors",
                        active ? "bg-dos/[0.07] font-semibold text-ink" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                      )}
                    >
                      <span className="truncate">{item.label}</span>
                      {active && <span aria-hidden className="h-1.5 w-1.5 flex-none rotate-45 bg-or" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );

  return (
    <div data-app={app} data-societe={entity} className="min-h-screen bg-bg text-ink lg:flex">
      {/* Dos du registre (écran large) */}
      <aside className="no-print sur-dos sticky top-0 hidden h-screen w-16 flex-none flex-col items-center bg-dos py-4 text-dos-ink lg:flex">
        <Link href={home} className="rounded-lg" title={APPS[app].name}>
          <Monogramme tuile={false} className="h-10 w-10" title={APPS[app].name} />
        </Link>
        <div className="flex flex-1 items-center justify-center py-6" aria-hidden>
          <span className="titre-dos font-display text-[13px] font-semibold tracking-[0.16em] text-dos-ink/75">
            {company?.name ?? APPS[app].name}
            <span className="mx-3 inline-block h-6 w-px bg-or align-middle" />
            {moduleOf(app)}
          </span>
        </div>
        <CompteMenu app={app} me={me} onLogout={logout} placement="cote" />
      </aside>

      {/* Colonne de navigation (écran large) */}
      <aside className="no-print sticky top-0 hidden h-screen w-[232px] flex-none border-r border-line bg-panel lg:block">{navigation}</aside>

      {/* Barre du haut et tiroir (téléphone, tablette) */}
      <header className="no-print sur-dos sticky top-0 z-30 flex items-center justify-between gap-3 bg-dos px-3 py-2.5 text-dos-ink lg:hidden">
        <button ref={menuButton} type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg" aria-label="Ouvrir le menu" aria-expanded={open}>
          <Menu className="h-5 w-5" />
        </button>
        <Link href={home} className="flex min-w-0 items-center gap-2.5 rounded-lg">
          <Monogramme tuile={false} className="h-8 w-8 flex-none" />
          <span className="min-w-0 leading-tight">
            <span className="block font-display text-[15px] font-semibold tracking-[0.08em]">NIMOVA</span>
            <span className="block truncate text-[12px] text-dos-ink/75">{company?.name ?? moduleOf(app)}</span>
          </span>
        </Link>
        <CompteMenu app={app} me={me} onLogout={logout} placement="bas" />
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-foret/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(86vw,300px)] flex-col bg-panel shadow-[0_0_60px_-10px_rgb(20_47_41/0.5)]">
            <button ref={closeButton} type="button" onClick={() => setOpen(false)} className="absolute right-2 top-3 grid h-10 w-10 place-items-center rounded-lg text-muted" aria-label="Fermer le menu">
              <X className="h-5 w-5" />
            </button>
            {navigation}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {passwordBanner}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 xl:px-10 xl:py-9">{children}</main>
      </div>
    </div>
  );
}

/** Menu du compte : mot de passe, autres applications, déconnexion. */
function CompteMenu({ app, me, onLogout, placement }: { app: AppCode; me: Me; onLogout: () => void; placement: "cote" | "bas" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const others = me.apps.filter((a) => a !== app && a !== "mobile");
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cx("flex items-center gap-1.5 rounded-lg", placement === "bas" ? "px-1.5 py-1" : "p-0")}
        title={me.name}
      >
        <span className="grid h-9 w-9 place-items-center rounded-lg border border-dos-accent/50 font-display text-[13px] font-semibold tracking-[0.06em] text-dos-ink">{initials(me.name)}</span>
        {placement === "bas" && <ChevronDown className="h-4 w-4 opacity-70" />}
        <span className="sr-only">Compte de {me.name}</span>
      </button>
      {open && (
        <div
          id={panelId}
          className={cx(
            "absolute z-50 w-64 rounded-xl bg-panel p-1.5 text-ink shadow-[0_18px_50px_-12px_rgb(20_47_41/0.45)]",
            placement === "cote" ? "bottom-0 left-full ml-3" : "right-0 top-full mt-2",
          )}
        >
          <div className="px-3 pb-2.5 pt-2">
            <div className="truncate text-sm font-semibold">{me.name}</div>
            <div className="truncate text-[12px] text-muted">{me.login}</div>
          </div>
          <div className="border-t border-line pt-1.5">
            <Link href="/compte/mot-de-passe" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">
              <KeyRound className="h-4 w-4 text-muted" /> Changer le mot de passe
            </Link>
            {others.map((a) => (
              <Link key={a} href={APPS[a].home} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">
                <span aria-hidden className="grid h-4 w-4 place-items-center">
                  <span className="h-1.5 w-1.5 rotate-45 bg-or" />
                </span>
                Ouvrir {APPS[a].name}
              </Link>
            ))}
            <button type="button" onClick={onLogout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger/[0.07]">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
