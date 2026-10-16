"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LogoSociete, MarqueCabinet, Monogramme, moduleOf, type Entite } from "@/components/brand";
import { AlertTriangle, Check, ChevronDown, ChevronsLeft, ChevronsRight, ChevronRight, Grid, ICONES, KeyRound, LogOut, Menu, Search, X, type Icon } from "@/components/icons";
import { APPS, CABINET_APPS, type AppCode } from "@/lib/config";
import { navFor, type NavItem, type NavSection } from "@/lib/nav";
import type { Company, Me } from "@/lib/types";
import { cx } from "@/components/ui";

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

/** Entrée de navigation active pour le chemin courant (l'accueil ne s'active que sur lui-même). */
function estActif(item: NavItem, pathname: string, home: string) {
  return item.href === home ? pathname === home : pathname === item.href || pathname.startsWith(item.href + "/");
}

const TEINTE_APP: Record<AppCode, string> = { finance: "#12956a", axispro: "#2d82dc", portail: "#2d82dc", mobile: "#e25f35" };

const CLE_REPLI = "nimova.menu.replie";

/**
 * Coque des applications : colonne de navigation blanche (marque, société, menu à icônes, compte),
 * barre du haut (fil d'Ariane, recherche d'écran, applications), contenu. Le repère de la page
 * ouverte glisse d'une entrée à l'autre ; la colonne se replie en icônes.
 */
export function AppShell({ app, me, children }: { app: AppCode; me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [replie, setReplie] = useState(false);
  const [recherche, setRecherche] = useState(false);
  const sections = useMemo(() => navFor(app, me.profiles), [app, me.profiles]);
  const home = APPS[app].home;
  const company = me.companies.find((c) => c.id === me.company_id);
  const entity = entityOf(company, app);

  useEffect(() => {
    try {
      setReplie(window.localStorage.getItem(CLE_REPLI) === "1");
    } catch {
      /* stockage indisponible : colonne dépliée */
    }
  }, []);

  function basculer() {
    setReplie((r) => {
      try {
        window.localStorage.setItem(CLE_REPLI, r ? "0" : "1");
      } catch {
        /* rien à garder */
      }
      return !r;
    });
  }

  // Ctrl+K (ou Cmd+K) ouvre la recherche d'écran.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setRecherche((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const fil = filAriane(sections, pathname, home);

  return (
    <div data-app={app} data-societe={entity} className="min-h-screen bg-bg text-ink lg:flex">
      {/* Colonne de navigation (écran large) */}
      <aside
        className={cx("no-print sticky top-0 hidden h-screen flex-none border-r border-line bg-panel transition-[width] duration-300 ease-[var(--ease-sortie)] lg:block", replie ? "w-[84px]" : "w-[272px]")}
        aria-label="Colonne de navigation"
      >
        <Navigation app={app} me={me} sections={sections} pathname={pathname} replie={replie} onBasculer={basculer} onCompany={switchCompany} onLogout={logout} />
      </aside>

      {/* Tiroir (téléphone, tablette) */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="n-apparaitre absolute inset-0 bg-foret/45" onClick={() => setOpen(false)} />
          <div className="n-tiroir absolute inset-y-0 left-0 flex w-[min(88vw,304px)] flex-col bg-panel shadow-[var(--ombre-flottante)]">
            <button ref={closeButton} type="button" onClick={() => setOpen(false)} className="absolute right-3 top-4 z-10 grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-panel-3" aria-label="Fermer le menu">
              <X className="h-5 w-5" />
            </button>
            <Navigation app={app} me={me} sections={sections} pathname={pathname} replie={false} onNavigate={() => setOpen(false)} onCompany={switchCompany} onLogout={logout} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-bg/95">
          <div className="flex h-16 items-center gap-3 px-3 sm:px-6 lg:px-8 xl:px-10">
            <button ref={menuButton} type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 flex-none place-items-center rounded-xl text-ink-2 hover:bg-panel-3 lg:hidden" aria-label="Ouvrir le menu" aria-expanded={open}>
              <Menu className="h-5 w-5" />
            </button>
            <Link href={home} className="flex min-w-0 items-center gap-2.5 rounded-lg lg:hidden">
              <Monogramme className="h-9 w-9 flex-none" />
              <span className="min-w-0 leading-tight">
                <span className="block font-display text-[15px] font-bold tracking-[0.06em]">NIMOVA</span>
                <span className="block truncate text-[12px] font-semibold text-accent">{moduleOf(app)}</span>
              </span>
            </Link>

            <nav aria-label="Fil d'Ariane" className="hidden min-w-0 items-center gap-1.5 text-[13px] lg:flex">
              <Link href={home} className="rounded font-medium text-muted transition-colors hover:text-ink">
                {APPS[app].name}
              </Link>
              {fil.map((f, i) => (
                <span key={i} className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 flex-none text-line-strong" />
                  <span className={cx("truncate", i === fil.length - 1 ? "font-semibold text-ink" : "font-medium text-muted")}>{f}</span>
                </span>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRecherche(true)}
                className="group flex h-10 items-center gap-2.5 rounded-xl border border-line bg-panel px-3 text-[13px] text-muted shadow-[0_1px_2px_rgb(16_36_31/0.04)] transition-colors hover:border-line-strong hover:text-ink sm:w-64"
                aria-label="Rechercher un écran"
              >
                <Search className="h-4 w-4 flex-none" />
                <span className="hidden flex-1 text-left sm:inline">Rechercher un écran</span>
                <kbd className="hidden rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted sm:inline">Ctrl K</kbd>
              </button>
              <Applications app={app} me={me} />
              <span className="hidden items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-[13px] font-medium capitalize text-ink-2 xl:flex">
                <span aria-hidden className="n-pouls h-2 w-2 rounded-full bg-accent-vif" />
                <Aujourdhui />
              </span>
              <div className="lg:hidden">
                <CompteMenu app={app} me={me} onLogout={logout} placement="bas" />
              </div>
            </div>
          </div>
        </header>
        {passwordBanner}
        <main key={pathname} className="n-page min-w-0 flex-1 px-4 py-6 sm:px-6 md:py-8 lg:px-8 xl:px-10">
          {children}
        </main>
      </div>

      {recherche && <Recherche app={app} me={me} sections={sections} onClose={() => setRecherche(false)} onLogout={logout} />}
    </div>
  );
}

/** Libellés du fil d'Ariane : la rubrique puis l'écran ouvert. */
function filAriane(sections: NavSection[], pathname: string, home: string): string[] {
  for (const s of sections) {
    const item = s.items.find((i) => estActif(i, pathname, home));
    if (item) return item.href === home ? [item.label] : [s.label, item.label];
  }
  if (pathname.startsWith("/compte")) return ["Mon compte"];
  return [];
}

function Aujourdhui() {
  const [texte, setTexte] = useState("");
  useEffect(() => {
    setTexte(new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Conakry" }).format(new Date()));
  }, []);
  return <span>{texte || " "}</span>;
}

/** Colonne de navigation : marque, société de travail, rubriques à icônes, compte. */
function Navigation({
  app,
  me,
  sections,
  pathname,
  replie,
  onBasculer,
  onNavigate,
  onCompany,
  onLogout,
}: {
  app: AppCode;
  me: Me;
  sections: NavSection[];
  pathname: string;
  replie: boolean;
  onBasculer?: () => void;
  onNavigate?: () => void;
  onCompany: (id: number) => void;
  onLogout: () => void;
}) {
  const home = APPS[app].home;
  const liste = useRef<HTMLDivElement>(null);
  const [repere, setRepere] = useState<{ y: number; h: number } | null>(null);

  // Le repère glisse vers l'entrée de la page ouverte (mesurée par rapport à la liste).
  const mesurer = useCallback(() => {
    const boite = liste.current;
    const el = boite?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!boite || !el) return setRepere(null);
    const a = boite.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    setRepere({ y: b.top - a.top, h: b.height });
  }, []);
  useLayoutEffect(() => {
    mesurer();
  }, [mesurer, pathname, replie, sections]);
  useEffect(() => {
    const boite = liste.current;
    if (!boite || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mesurer);
    ro.observe(boite);
    void document.fonts?.ready.then(mesurer);
    return () => ro.disconnect();
  }, [mesurer]);

  return (
    <div className="flex h-full flex-col">
      <div className={cx("flex items-center pb-4 pt-5", replie ? "flex-col gap-3 px-3" : "justify-between gap-2 pl-5 pr-3")}>
        <Link href={home} onClick={onNavigate} className="flex min-w-0 items-center gap-3 rounded-xl" title={APPS[app].name}>
          <Monogramme className="h-10 w-10 flex-none drop-shadow-[0_6px_10px_rgb(20_47_41/0.25)]" />
          {!replie && (
            <span className="min-w-0 leading-none">
              <span className="block font-display text-[19px] font-bold tracking-[0.06em] text-ink">NIMOVA</span>
              <span className="mt-1 block truncate text-[12.5px] font-semibold text-accent">{moduleOf(app)}</span>
            </span>
          )}
        </Link>
        {onBasculer && (
          <button
            type="button"
            onClick={onBasculer}
            className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-line text-muted transition-colors hover:border-line-strong hover:text-ink"
            aria-label={replie ? "Déplier le menu" : "Replier le menu"}
            title={replie ? "Déplier le menu" : "Replier le menu"}
          >
            {replie ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {!replie && <Bascule app={app} me={me} onNavigate={onNavigate} />}

      <div className={cx("pb-3", replie ? "px-3" : "px-4")}>
        <Societe app={app} me={me} replie={replie} onCompany={onCompany} />
      </div>

      <nav aria-label="Navigation" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4">
        <div ref={liste} className={cx("relative", replie ? "px-3" : "px-4")}>
          {repere && (
            <span aria-hidden className="n-repere pointer-events-none absolute left-0 right-0 top-0" style={{ transform: `translateY(${repere.y}px)`, height: repere.h }}>
              <span className={cx("n-degrade absolute inset-y-0 rounded-xl shadow-[0_10px_22px_-12px_var(--accent-lueur)]", replie ? "inset-x-3" : "inset-x-4")} />
              <span className="absolute -left-0 inset-y-1.5 w-1 rounded-r-full bg-accent-vif" />
            </span>
          )}
          {sections.map((section, s) => (
            <div key={section.label} className={s > 0 ? "mt-4" : "mt-1"}>
              {replie ? (
                s > 0 && <div aria-hidden className="mx-auto mb-3 h-px w-8 bg-line" />
              ) : (
                <div className="px-3 pb-1.5 text-[12px] font-semibold text-muted">{section.label}</div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = estActif(item, pathname, home);
                  const I: Icon = ICONES[item.icon] ?? ICONES.LayoutDashboard!;
                  return (
                    <li key={item.href} className="group/entree relative">
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={replie ? item.label : undefined}
                        className={cx(
                          "relative z-[1] flex items-center gap-3 rounded-xl text-[14px] leading-tight transition-colors duration-200",
                          replie ? "justify-center px-0 py-2.5" : "px-3 py-[9px]",
                          active ? "font-semibold text-accent-ink" : "font-medium text-ink-2 hover:bg-panel-2 hover:text-ink",
                        )}
                      >
                        <I className={cx("h-[19px] w-[19px] flex-none transition-transform duration-200", !active && "text-muted group-hover/entree:translate-x-0.5 group-hover/entree:text-accent")} />
                        <span className={replie ? "sr-only" : "truncate"}>{item.label}</span>
                      </Link>
                      {replie && (
                        <span aria-hidden className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foret px-2.5 py-1.5 text-[12.5px] font-semibold text-white opacity-0 shadow-[var(--ombre-levee)] transition-opacity duration-150 group-hover/entree:opacity-100">
                          {item.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className={cx("border-t border-line py-3", replie ? "px-3" : "px-4")}>
        <CompteMenu app={app} me={me} onLogout={onLogout} placement="haut" replie={replie} />
      </div>
    </div>
  );
}

/**
 * Bascule entre les deux espaces de gestion (Finance, AxisPro) : visible d'emblée, chaque espace
 * à sa couleur. Elle n'apparaît que si le compte est ouvert aux deux.
 */
function Bascule({ app, me, onNavigate }: { app: AppCode; me: Me; onNavigate?: () => void }) {
  const espaces = (["finance", "axispro"] as const).filter((a) => me.apps.includes(a));
  if (espaces.length < 2) return null;
  return (
    <div className="px-4 pb-3">
      <div role="group" aria-label="Espace de gestion" className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-panel-2 p-1">
        {espaces.map((a) => {
          const actif = a === app;
          return (
            <Link
              key={a}
              href={APPS[a].home}
              onClick={onNavigate}
              aria-current={actif ? "true" : undefined}
              className={cx("flex items-center justify-center gap-2 rounded-[9px] px-2 py-1.5 text-[13px] font-semibold transition-all duration-200", actif ? "bg-panel text-ink shadow-[0_1px_3px_rgb(16_36_31/0.12),0_0_0_1px_rgb(16_36_31/0.04)]" : "text-muted hover:text-ink")}
            >
              <span aria-hidden className={cx("h-2 w-2 rounded-full", actif && "n-pouls")} style={{ background: TEINTE_APP[a], ["--pouls" as string]: `color-mix(in oklab, ${TEINTE_APP[a]} 55%, transparent)` } as CSSProperties} />
              {moduleOf(a)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Société de travail : logo et nom ; si le compte est ouvert aux deux sociétés, on en change ici. */
function Societe({ app, me, replie, onCompany }: { app: AppCode; me: Me; replie: boolean; onCompany: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const company = me.companies.find((c) => c.id === me.company_id);
  const entite = entityOf(company, app);
  // AxisPro Suite et le portail ne relèvent que du cabinet : pas de choix de société.
  const plusieurs = me.companies.length > 1 && !CABINET_APPS.includes(app);

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

  const carte = (
    <>
      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl border border-line bg-panel">
        <LogoSociete entite={entite} decoratif className="h-6" />
      </span>
      {!replie && (
        <span className="min-w-0 flex-1 text-left leading-tight">
          <span className="block text-[11.5px] font-medium text-muted">Société</span>
          <span className="block truncate text-[13.5px] font-semibold text-ink">{company?.name ?? "–"}</span>
        </span>
      )}
      {!replie && plusieurs && <ChevronDown className={cx("h-4 w-4 flex-none text-muted transition-transform duration-200", open && "rotate-180")} />}
    </>
  );

  if (!plusieurs) {
    return (
      <div className={cx("flex items-center gap-3 rounded-2xl bg-panel-2 p-2", replie && "justify-center")} title={replie ? company?.name : undefined}>
        {carte}
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        title={replie ? `Société : ${company?.name ?? ""}` : undefined}
        className={cx("flex w-full items-center gap-3 rounded-2xl border border-transparent bg-panel-2 p-2 transition-colors hover:border-line-strong", replie && "justify-center")}
      >
        {carte}
        <span className="sr-only">Changer de société</span>
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Société" className={cx("n-surgir absolute z-50 mt-2 w-[264px] rounded-2xl border border-line bg-panel p-1.5 shadow-[var(--ombre-flottante)]", replie ? "left-full top-0 ml-3 mt-0" : "left-0 top-full")}>
          <div className="px-3 pb-1.5 pt-2 text-[12px] font-semibold text-muted">Livres ouverts</div>
          {me.companies.map((c) => {
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
                className={cx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors", actif ? "bg-accent-doux" : "hover:bg-panel-2")}
              >
                <span className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-line bg-panel">
                  <LogoSociete entite={entityOf(c, app)} decoratif className="h-5" />
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

/** Applications du compte : passer de Finance à AxisPro (ou à Rotations) d'un clic. */
function Applications({ app, me }: { app: AppCode; me: Me }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const autres = me.apps.filter((a) => a !== "portail");

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

  if (autres.length < 2) return null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-panel text-ink-2 shadow-[0_1px_2px_rgb(16_36_31/0.04)] transition-colors hover:border-line-strong hover:text-ink"
        aria-label="Applications NIMOVA"
        title="Applications NIMOVA"
      >
        <Grid className="h-4 w-4" />
      </button>
      {open && (
        <div id={panelId} className="n-surgir absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-line bg-panel p-2 shadow-[var(--ombre-flottante)]">
          <div className="px-2.5 pb-2 pt-1.5 text-[12px] font-semibold text-muted">Applications NIMOVA</div>
          <div className="grid gap-1">
            {autres.map((a) => (
              <Link
                key={a}
                href={APPS[a].home}
                onClick={() => setOpen(false)}
                aria-current={a === app ? "true" : undefined}
                className={cx("flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors", a === app ? "bg-panel-2" : "hover:bg-panel-2")}
              >
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-[0_6px_14px_-8px_rgb(16_36_31/0.5)]" style={{ background: `linear-gradient(135deg, ${TEINTE_APP[a]}, color-mix(in oklab, ${TEINTE_APP[a]} 70%, #10241f))` }}>
                  <Monogramme tuile={false} className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[13.5px] font-semibold text-ink">{APPS[a].name}</span>
                  <span className="block truncate text-[12px] text-muted">{APPS[a].tagline}</span>
                </span>
                {a === app && <Check className="h-4 w-4 flex-none text-accent" strokeWidth={2.2} />}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Menu du compte : mot de passe, autres applications, déconnexion. */
function CompteMenu({ app, me, onLogout, placement, replie }: { app: AppCode; me: Me; onLogout: () => void; placement: "haut" | "bas"; replie?: boolean }) {
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
    champ.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

