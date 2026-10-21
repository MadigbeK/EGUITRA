"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LogoSociete, MarqueCabinet, Monogramme, moduleOf, type Entite } from "@/components/brand";
import { AlertTriangle, Check, ChevronDown, Grid, ICONES, KeyRound, LogOut, Menu, Search, X, type Icon } from "@/components/icons";
import { IconeModule } from "@/components/accueil/icones-modules";
import { Rosace } from "@/components/guilloche";
import { BarreMenus, ListeMenus } from "@/components/shell/Menus";
import { APPS, ESPACES, type AppCode } from "@/lib/config";
import { navFor, type NavSection } from "@/lib/nav";
import type { Company, Me } from "@/lib/types";
import { cx } from "@/components/ui";
import { Lanceur } from "@/components/shell/Lanceur";
import { EquilibreExercice, pastilles, useEnTeteFinance } from "@/components/finance/EnTete";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Société d'une fiche : le groupe (EGUITRA GROUP) ou le cabinet (MB AxisPro Consulting). */
function entityOf(company: Company | undefined, app: AppCode): Entite {
  if (company?.entity) return company.entity;
  return app === "axispro" || app === "portail" ? "cabinet" : "groupe";
}

const TEINTE_APP: Record<AppCode, string> = { finance: "#12956a", axispro: "#2d82dc", portail: "#2d82dc", mobile: "#e25f35", analyse: "#7c5ce6" };

/**
 * Coque des applications, sans colonne latérale : une barre du haut à la manière d'Odoo (marque et
 * espace, rubriques en menus illustrés, recherche, applications, société, compte) et le contenu sur
 * toute la largeur. Un filigrane guilloché se grave en haut de chaque écran, comme sur un billet.
 */
export function AppShell({ app, me, children }: { app: AppCode; me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [defile, setDefile] = useState(false);
  const [recherche, setRecherche] = useState(false);
  const company = me.companies.find((c) => c.id === me.company_id);
  // Les modules d'une société (transport, chantiers, immobilier) n'apparaissent que dans ses livres.
  const sections = useMemo(() => navFor(app, me.profiles, company?.entity), [app, me.profiles, company?.entity]);
  const home = APPS[app].home;
  const entity = entityOf(company, app);
  // Finance : équilibre de l'exercice dans la barre du haut, pastilles dans la navigation.
  const enTete = useEnTeteFinance(app, me);
  const badges = useMemo(() => pastilles(enTete), [enTete]);

  // La barre du haut se détache du contenu (liseré, flou) dès que la page défile.
  useEffect(() => {
    const onScroll = () => setDefile(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Ctrl+K (ou Cmd+K) ouvre la recherche d'écran (absente du portail).
  useEffect(() => {
    if (app === "portail") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setRecherche((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

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

  const logout = useCallback(async () => {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = `/login?app=${app}`;
  }, [app]);

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
    <div className="no-print flex items-center gap-2.5 border-b border-warn/15 bg-warn-doux px-5 py-2.5 text-sm text-ink md:px-8">
      <AlertTriangle className="h-4 w-4 flex-none text-warn" />
      <span>
        Votre mot de passe est provisoire.{" "}
        <Link href="/compte/mot-de-passe" className="font-semibold text-warn underline underline-offset-2">
          Choisissez votre mot de passe
        </Link>
        .
      </span>
    </div>
  );

  if (app === "portail") {
    return (
      <div data-app={app} data-societe="cabinet" className="min-h-screen bg-bg text-ink">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-panel/95">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 md:px-8">
            <Link href={home} className="rounded-lg">
              <MarqueCabinet className="h-9 sm:h-10" />
            </Link>
            <CompteMenu app={app} me={me} onLogout={logout} placement="bas" />
          </div>
          <div aria-hidden className="h-[3px] bg-[linear-gradient(90deg,#1f73d6,#2d82dc_40%,#0f9fa0)]" />
        </header>
        {passwordBanner}
        <main key={pathname} className="n-page mx-auto min-w-0 max-w-6xl px-5 py-8 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div data-app={app} data-societe={entity} className="min-h-screen bg-bg text-ink">
      {/* Menu du téléphone et de la tablette */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="n-apparaitre absolute inset-0 bg-foret/45" onClick={() => setOpen(false)} />
          <div className="n-tiroir absolute inset-y-0 left-0 flex w-[min(90vw,340px)] flex-col bg-panel shadow-[var(--ombre-flottante)]">
            <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-4">
              <Link href={home} onClick={() => setOpen(false)} className="flex min-w-0 items-center gap-2.5 rounded-xl">
                <Monogramme tuile={false} className="h-9 w-9 flex-none" />
                <span className="min-w-0 leading-none">
                  <span className="block font-display text-[15px] font-bold tracking-[0.06em]">NIMOVA</span>
                  <span className="mt-1 block truncate text-[12.5px] font-semibold text-accent">{moduleOf(app)}</span>
                </span>
              </Link>
              <button ref={closeButton} type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-panel-3" aria-label="Fermer le menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Bascule app={app} me={me} onNavigate={() => setOpen(false)} />
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-1">
              <ListeMenus sections={sections} pathname={pathname} home={home} badges={badges} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}

      <header className={cx("no-print sticky top-0 z-30 transition-[background-color,box-shadow] duration-300", defile ? "bg-bg/85 shadow-[0_1px_0_var(--line),0_12px_24px_-20px_rgb(16_36_31/0.35)] backdrop-blur-md" : "bg-bg")}>
        <div className="flex h-[68px] items-center gap-2 px-3 sm:px-6 lg:px-8 xl:px-10">
          <button ref={menuButton} type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 flex-none place-items-center rounded-xl text-ink-2 hover:bg-panel-3 lg:hidden" aria-label="Ouvrir le menu" aria-expanded={open}>
            <Menu className="h-5 w-5" />
          </button>
          <EspaceMenu app={app} me={me} />
          <BarreMenus sections={sections} pathname={pathname} home={home} badges={badges} className="ml-2 hidden lg:flex xl:ml-5" />

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setRecherche(true)}
              className="flex h-10 items-center gap-2.5 whitespace-nowrap rounded-xl px-2.5 text-[13px] text-muted transition-colors hover:bg-white/80 hover:text-ink xl:w-60 xl:border xl:border-line xl:bg-panel xl:px-3"
              aria-label="Rechercher un écran"
            >
              <Search className="h-[18px] w-[18px] flex-none" />
              <span className="hidden flex-1 text-left xl:inline">Rechercher un écran</span>
              <kbd className="hidden rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted xl:inline">Ctrl K</kbd>
            </button>
            {ESPACES.some((a) => me.apps.includes(a)) && <Lanceur me={me} app={app} />}
            <EquilibreExercice data={enTete} />
            <SocieteEnTete app={app} me={me} onCompany={switchCompany} />
            <CompteMenu app={app} me={me} onLogout={logout} />
          </div>
        </div>
      </header>
      {passwordBanner}
      <div className="relative overflow-x-clip">
        <Rosace key={`filigrane-${pathname}`} className="filigrane no-print pointer-events-none absolute -right-40 -top-48 h-[560px] w-[560px] text-accent-vif" />
        <main key={pathname} className="n-page relative min-w-0 px-4 py-6 sm:px-6 md:py-8 lg:px-8 xl:px-10">
          {children}
        </main>
      </div>

      {recherche && <Recherche app={app} me={me} sections={sections} onClose={() => setRecherche(false)} onLogout={logout} />}
    </div>
  );
}

/** Marque et espace de travail ; si le compte en a plusieurs, on en change ici (et l'on rejoint l'accueil). */
function EspaceMenu({ app, me }: { app: AppCode; me: Me }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const espaces = ESPACES.filter((a) => me.apps.includes(a));
  const plusieurs = espaces.length > 1;

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

  const marque = (
    <>
      <Monogramme tuile={false} className="h-9 w-9 flex-none" />
      <span className="min-w-0 text-left leading-none">
        <span className="block font-display text-[15px] font-bold tracking-[0.06em] text-ink">NIMOVA</span>
        <span className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-accent">
          <span className="truncate">{moduleOf(app)}</span>
          {plusieurs && <ChevronDown className={cx("h-3.5 w-3.5 flex-none transition-transform duration-300 ease-[var(--ease-ressort)]", open && "rotate-180")} />}
        </span>
      </span>
    </>
  );

  if (!plusieurs) {
    return (
      <Link href={APPS[app].home} className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 pl-1 pr-2">
        {marque}
      </Link>
    );
  }
  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={panelId} className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-white/80">
        {marque}
        <span className="sr-only">Changer d&apos;espace</span>
      </button>
      {open && (
        <div id={panelId} className="n-surgir absolute left-0 top-full z-50 mt-2 w-[310px] rounded-[22px] border border-line bg-white p-2 shadow-[var(--ombre-flottante)]">
          {espaces.map((a) => (
            <Link
              key={a}
              href={APPS[a].home}
              onClick={() => setOpen(false)}
              aria-current={a === app ? "true" : undefined}
              className={cx("tuile group flex items-center gap-3 rounded-2xl p-2.5 transition-colors", a === app ? "bg-accent-doux" : "hover:bg-[#f2f6f3]")}
            >
              <IconeModule cle={APPS[a].home} className="h-9 w-9 flex-none" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">{moduleOf(a)}</span>
                <span className="block truncate text-[12.5px] text-muted">{APPS[a].tagline}</span>
              </span>
              {a === app && <Check className="h-4 w-4 flex-none text-accent" strokeWidth={2.2} />}
            </Link>
          ))}
          <Link href="/accueil" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-3 border-t border-line px-2.5 pb-1.5 pt-3 text-[13.5px] font-semibold text-ink-2 hover:text-ink">
            <Grid className="h-4 w-4 text-muted" /> Accueil NIMOVA
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Bascule entre les espaces de gestion (Finance, AxisPro, Analyse) : visible d'emblée, chaque
 * espace à sa couleur. Elle n'apparaît que si le compte est ouvert à plusieurs d'entre eux.
 */
function Bascule({ app, me, onNavigate }: { app: AppCode; me: Me; onNavigate?: () => void }) {
  const espaces = ESPACES.filter((a) => me.apps.includes(a));
  if (espaces.length < 2) return null;
  return (
    <div className="px-4 pb-3">
      <div role="group" aria-label="Espace de gestion" className={cx("grid gap-1 rounded-xl border border-line bg-panel-2 p-1", espaces.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {espaces.map((a) => {
          const actif = a === app;
          return (
            <Link
              key={a}
              href={APPS[a].home}
              onClick={onNavigate}
              aria-current={actif ? "true" : undefined}
              className={cx("flex min-w-0 items-center justify-center gap-1.5 rounded-[9px] px-1.5 py-1.5 text-[13px] font-semibold transition-all duration-200", actif ? "bg-panel text-ink shadow-[0_1px_3px_rgb(16_36_31/0.12),0_0_0_1px_rgb(16_36_31/0.04)]" : "text-muted hover:text-ink")}
            >
              <span aria-hidden className={cx("h-2 w-2 flex-none rounded-full", actif && "n-pouls")} style={{ background: TEINTE_APP[a], ["--pouls" as string]: `color-mix(in oklab, ${TEINTE_APP[a]} 55%, transparent)` } as CSSProperties} />
              <span className="truncate">{moduleOf(a)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Société de travail, en pastille dans la barre du haut ; si le compte est ouvert aux deux, on en change ici. */
function SocieteEnTete({ app, me, onCompany }: { app: AppCode; me: Me; onCompany: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const company = me.companies.find((c) => c.id === me.company_id);
  const entite = entityOf(company, app);
  // Une application qui ne sert qu'une société n'en propose pas d'autre (AxisPro, portail, Rotations).
  const servie = APPS[app].entity;
  const ouvertes = servie ? me.companies.filter((c) => c.entity === servie) : me.companies;
  const plusieurs = ouvertes.length > 1;

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

  const pastille = (
    <>
      <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white shadow-[0_0_0_1px_rgb(16_36_31/0.08),0_4px_10px_-6px_rgb(16_36_31/0.3)]">
        <LogoSociete entite={entite} decoratif className="h-[18px]" />
      </span>
      <span className="hidden max-w-[190px] truncate text-[13px] font-semibold text-ink-2 2xl:inline">{company?.name ?? "–"}</span>
    </>
  );

  if (!plusieurs) {
    return (
      <span className="hidden items-center gap-2 sm:flex" title={company?.name}>
        {pastille}
        <span className="sr-only">Société : {company?.name}</span>
      </span>
    );
  }
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={panelId} title={`Société : ${company?.name ?? ""}`} className="flex items-center gap-2 rounded-full p-0.5 pr-0.5 transition-colors hover:bg-white/80 2xl:pr-3">
        {pastille}
        <ChevronDown className={cx("hidden h-3.5 w-3.5 text-muted transition-transform duration-200 2xl:block", open && "rotate-180")} />
        <span className="sr-only">Changer de société</span>
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Société" className="n-surgir absolute right-0 top-full z-50 mt-2 w-[284px] rounded-[22px] border border-line bg-white p-2 shadow-[var(--ombre-flottante)]">
          <div className="px-3 pb-1.5 pt-1.5 text-[12.5px] font-semibold text-muted">Livres ouverts</div>
          {ouvertes.map((c) => {
            const actif = c.id === me.company_id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={actif}
                onClick={() => {
                  setOpen(false);
                  onCompany(c.id);
                }}
                className={cx("flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors", actif ? "bg-accent-doux" : "hover:bg-[#f2f6f3]")}
              >
                <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white shadow-[0_0_0_1px_rgb(16_36_31/0.08)]">
                  <LogoSociete entite={entityOf(c, app)} decoratif className="h-[18px]" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{c.name}</span>
                {actif && <Check className="h-4 w-4 flex-none text-accent" strokeWidth={2.2} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Menu du compte : mot de passe, autres applications, déconnexion. */
function CompteMenu({ app, me, onLogout, placement = "bas", replie }: { app: AppCode; me: Me; onLogout: () => void; placement?: "haut" | "bas"; replie?: boolean }) {
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
  const avatar = (
    <span aria-hidden className="n-degrade grid h-9 w-9 flex-none place-items-center rounded-full font-display text-[13px] font-bold tracking-[0.04em] text-white shadow-[0_6px_14px_-8px_var(--accent-lueur)]">
      {initials(me.name)}
    </span>
  );
  return (
    <div ref={box} className="relative">
      {placement === "haut" ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          title={replie ? me.name : undefined}
          className={cx("flex w-full items-center gap-3 rounded-2xl p-1.5 text-left transition-colors hover:bg-panel-2", replie && "justify-center")}
        >
          {avatar}
          {!replie && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold text-ink">{me.name}</span>
              <span className="block truncate text-[12px] text-muted">{me.login}</span>
            </span>
          )}
          {!replie && <ChevronDown className={cx("h-4 w-4 flex-none text-muted transition-transform duration-200", !open && "rotate-180")} />}
          <span className="sr-only">Compte de {me.name}</span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={panelId} className="flex items-center gap-1.5 rounded-full p-0.5" title={me.name}>
          {avatar}
          <span className="sr-only">Compte de {me.name}</span>
        </button>
      )}
      {open && (
        <div
          id={panelId}
          className={cx(
            "n-surgir absolute z-50 w-64 rounded-2xl border border-line bg-panel p-1.5 text-ink shadow-[var(--ombre-flottante)]",
            placement === "haut" ? (replie ? "bottom-0 left-full ml-3" : "bottom-full left-0 mb-2") : "right-0 top-full mt-2",
          )}
        >
          <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
            {avatar}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{me.name}</div>
              <div className="truncate text-[12px] text-muted">{me.login}</div>
            </div>
          </div>
          <div className="border-t border-line pt-1.5">
            <Link href="/compte/mot-de-passe" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">
              <KeyRound className="h-4 w-4 text-muted" /> Changer le mot de passe
            </Link>
            {others.map((a) => (
              <Link key={a} href={APPS[a].home} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: TEINTE_APP[a] }} />
                Ouvrir {APPS[a].name}
              </Link>
            ))}
            <button type="button" onClick={onLogout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger-doux">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Choix = { cle: string; libelle: string; rubrique: string; icone: Icon; aller: () => void };

function sansAccents(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Recherche d'écran (Ctrl+K) : on tape quelques lettres, Entrée ouvre l'écran. */
function Recherche({ app, me, sections, onClose, onLogout }: { app: AppCode; me: Me; sections: NavSection[]; onClose: () => void; onLogout: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const listeId = useId();
  const champ = useRef<HTMLInputElement>(null);

  const choix = useMemo<Choix[]>(() => {
    const aller = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const ecrans = sections.flatMap((s) => s.items.map((i) => ({ cle: i.href, libelle: i.label, rubrique: s.label, icone: ICONES[i.icon] ?? ICONES.LayoutDashboard!, aller: aller(i.href) })));
    const apps = me.apps
      .filter((a) => a !== app && a !== "portail")
      .map((a) => ({ cle: `app-${a}`, libelle: `Ouvrir ${APPS[a].name}`, rubrique: "Applications", icone: Grid, aller: aller(APPS[a].home) }));
    const compte = [
      { cle: "mdp", libelle: "Changer le mot de passe", rubrique: "Compte", icone: KeyRound, aller: aller("/compte/mot-de-passe") },
      { cle: "sortie", libelle: "Se déconnecter", rubrique: "Compte", icone: LogOut, aller: onLogout },
    ];
    return [...ecrans, ...apps, ...compte];
  }, [sections, me.apps, app, onClose, onLogout, router]);

  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  const filtres = choix.filter((c) => mots.every((m) => sansAccents(`${c.libelle} ${c.rubrique}`).includes(m)));
  const actif = Math.min(index, Math.max(0, filtres.length - 1));

  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    champ.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        e.preventDefault();
        champ.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      precedent?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    document.getElementById(`${listeId}-${actif}`)?.scrollIntoView({ block: "nearest" });
  }, [actif, listeId]);

  let rubrique = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Rechercher un écran">
      <div className="n-apparaitre absolute inset-0 bg-foret/45" onClick={onClose} />
      <div className="n-surgir relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--ombre-flottante)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-5 w-5 flex-none text-accent" />
          <input
            ref={champ}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(filtres.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                filtres[actif]?.aller();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listeId}
            aria-activedescendant={filtres.length ? `${listeId}-${actif}` : undefined}
            aria-label="Écran à ouvrir"
            placeholder="Trésorerie, relances, dossiers…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted/70"
          />
          <kbd className="rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted">Échap</kbd>
        </div>
        <ul id={listeId} role="listbox" aria-label="Écrans" className="max-h-[52vh] overflow-y-auto p-2">
          {filtres.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Aucun écran ne correspond à « {q} ».</li>}
          {filtres.map((c, i) => {
            const titre = c.rubrique !== rubrique ? (rubrique = c.rubrique) : null;
            const I = c.icone;
            return (
              <li key={c.cle} role="presentation">
                {titre && <div className="px-3 pb-1 pt-2.5 text-[11.5px] font-semibold text-muted">{titre}</div>}
                <div
                  id={`${listeId}-${i}`}
                  role="option"
                  aria-selected={i === actif}
                  onPointerMove={() => setIndex(i)}
                  onClick={() => c.aller()}
                  className={cx("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors", i === actif ? "bg-accent-doux text-ink" : "text-ink-2")}
                >
                  <span className={cx("grid h-8 w-8 flex-none place-items-center rounded-lg transition-colors", i === actif ? "n-degrade text-white" : "bg-panel-3 text-muted")}>
                    <I className="h-4 w-4" />
                  </span>
                  <span className="flex-1 font-medium">{c.libelle}</span>
                  {i === actif && <span aria-hidden className="text-[12px] font-semibold text-accent">Entrée</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

