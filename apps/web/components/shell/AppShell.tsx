"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LogoSociete, MarqueCabinet, Monogramme, moduleOf, type Entite } from "@/components/brand";
import { AlertTriangle, Check, ChevronDown, Grid, ICONES, KeyRound, LogOut, Menu, Search, X, type Icon } from "@/components/icons";
import { IconeModule } from "@/components/accueil/icones-modules";
import { Rosace } from "@/components/guilloche";
import { BarreMenus, ListeMenus } from "@/components/shell/Menus";
import { APPS, ESPACES, appFromPath, type AppCode } from "@/lib/config";
import { NAV, accueilFinance, accueilRh, navFor, type NavSection } from "@/lib/nav";
import type { Company, Me } from "@/lib/types";
import { PANNEAU, Squelette, cx } from "@/components/ui";
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

const TEINTE_APP: Record<AppCode, string> = { finance: "#12956a", transport: "#d9831f", axispro: "#2d82dc", portail: "#2d82dc", mobile: "#e25f35", analyse: "#b8872e", rh: "#c4417a" };

/**
 * Accueil d'une application pour ce compte. Finance s'ouvre sur le premier écran que ses profils
 * ouvrent (le tableau de bord est réservé à la finance et à la direction), RH sur « Mon espace » pour un
 * compte en libre-service. La société de travail (BTP et Immobilier ne servent que le groupe) n'est
 * connue que pour l'application ouverte : chaque application garde la sienne.
 */
function accueilDe(a: AppCode, me: Me, ouverte: AppCode): string {
  const entite = a === ouverte ? me.companies.find((c) => c.id === me.company_id)?.entity : undefined;
  if (a === "finance") return accueilFinance(me.profiles, entite);
  if (a === "rh") return accueilRh(me.profiles);
  return APPS[a].home;
}

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
  // Finance s'ouvre sur le premier écran des profils sans tableau de bord (Achats, BTP, Immobilier,
  // Engagements) ; RH sur « Mon espace » pour un compte en libre-service (sans profil de gestion).
  const home = accueilDe(app, me, app);
  const entity = entityOf(company, app);
  // Finance : équilibre de l'exercice dans la barre du haut, pastilles dans la navigation.
  const enTete = useEnTeteFinance(app, me);
  const badges = useMemo(() => pastilles(enTete), [enTete]);
  // Retour au clic : une fine barre à la couleur de l'application pendant le changement d'écran.
  const { barre, demarrer } = useProgression(pathname);
  const progression = <div ref={barre} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[2.5px] origin-left bg-accent" style={{ opacity: 0, transform: "scaleX(0)" }} />;

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

  // Société mémorisée que l'administrateur a retirée au compte : la page s'est ouverte dans la société
  // par défaut (requireUser). La mémoire périmée est oubliée, sans recharger, et un bandeau le dit.
  const [societeRetiree, setSocieteRetiree] = useState(Boolean(me.societe_retiree));
  useEffect(() => {
    if (!me.societe_retiree) return;
    void fetch("/api/session/company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: null, app }),
    }).catch(() => undefined);
  }, [me.societe_retiree, app]);

  const passwordBanner = (
    <>
      {me.password_change_required && (
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
      )}
      {societeRetiree && (
        <div role="status" className="no-print flex items-center gap-2.5 border-b border-warn/15 bg-warn-doux px-5 py-2.5 text-sm text-ink md:px-8">
          <AlertTriangle className="h-4 w-4 flex-none text-warn" />
          <span className="min-w-0 flex-1">
            La société choisie précédemment n&apos;est plus ouverte à votre compte : vous travaillez dans les livres de <strong className="font-semibold">{company?.name ?? "votre société par défaut"}</strong>.
          </span>
          <button type="button" onClick={() => setSocieteRetiree(false)} className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted transition-colors hover:bg-panel/70 hover:text-ink" aria-label="Fermer ce message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );

  if (app === "portail") {
    return (
      <div data-app={app} data-societe="cabinet" data-societe-id={me.company_id} data-utilisateur-id={me.id} data-compte={me.login} className="min-h-screen bg-bg text-ink">
        <a href="#contenu" className="sr-only z-[60] rounded-lg bg-panel px-4 py-2 text-sm font-semibold text-ink shadow-[var(--ombre-flottante)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Aller au contenu
        </a>
        <header className="no-print sticky top-0 z-30 border-b border-line bg-panel/95">
          {progression}
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 md:px-8">
            <Link href={home} className="rounded-lg">
              <MarqueCabinet className="h-9 sm:h-10" />
            </Link>
            <CompteMenu app={app} me={me} onLogout={logout} placement="bas" />
          </div>
          <div aria-hidden className="h-[3px] bg-accent" />
        </header>
        {passwordBanner}
        <main id="contenu" tabIndex={-1} key={pathname} className="outline-none n-page mx-auto min-w-0 max-w-6xl px-5 py-8 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    );
  }

  return (
    // data-societe-id : société affichée, envoyée par le client de l'API à chaque appel (lib/api-client) ;
    // data-utilisateur-id et data-compte : compte de la page, pour la reconnexion sur place (Reconnexion).
    <div data-app={app} data-societe={entity} data-societe-id={me.company_id} data-utilisateur-id={me.id} data-compte={me.login} className="min-h-screen bg-bg text-ink">
      <a href="#contenu" className="sr-only z-[60] rounded-lg bg-panel px-4 py-2 text-sm font-semibold text-ink shadow-[var(--ombre-flottante)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Aller au contenu
      </a>
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
        {progression}
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
              className="flex h-10 items-center gap-2.5 whitespace-nowrap rounded-xl px-2.5 text-[13px] text-muted transition-colors hover:bg-panel/80 hover:text-ink xl:w-60 xl:border xl:border-line xl:bg-panel xl:px-3"
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
        <main id="contenu" tabIndex={-1} key={pathname} className="outline-none n-page relative min-w-0 px-4 py-6 sm:px-6 md:py-8 lg:px-8 xl:px-10">
          {children}
        </main>
      </div>

      {recherche && <Recherche app={app} me={me} sections={sections} onClose={() => setRecherche(false)} onLogout={logout} onAller={(href) => demarrer(href.split(/[?#]/)[0] ?? href)} />}
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
      <Link href={accueilDe(app, me, app)} className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 pl-1 pr-2">
        {marque}
      </Link>
    );
  }
  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={panelId} className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-panel/80">
        {marque}
        <span className="sr-only">Changer d&apos;espace</span>
      </button>
      {open && (
        <div id={panelId} className={cx(PANNEAU, "n-surgir absolute left-0 top-full z-50 mt-2 w-[310px] p-1.5")}>
          {espaces.map((a) => (
            <Link
              key={a}
              href={accueilDe(a, me, app)}
              onClick={() => setOpen(false)}
              aria-current={a === app ? "true" : undefined}
              className={cx("tuile group flex items-center gap-3 rounded-xl p-2.5 transition-colors", a === app ? "bg-accent-doux" : "hover:bg-panel-2")}
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
              href={accueilDe(a, me, app)}
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
        <div id={panelId} role="group" aria-label="Société" className={cx(PANNEAU, "n-surgir absolute right-0 top-full z-50 mt-2 w-[284px] p-1.5")}>
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
                className={cx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors", actif ? "bg-accent-doux" : "hover:bg-panel-2")}
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
    <span aria-hidden className="bg-accent grid h-9 w-9 flex-none place-items-center rounded-full font-display text-[13px] font-bold tracking-[0.04em] text-white shadow-[0_6px_14px_-8px_var(--accent-lueur)]">
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
            PANNEAU,
            "n-surgir absolute z-50 w-64 p-1.5 text-ink",
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
              <Link key={a} href={accueilDe(a, me, app)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">
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
function Recherche({ app, me, sections, onClose, onLogout, onAller }: { app: AppCode; me: Me; sections: NavSection[]; onClose: () => void; onLogout: () => void; onAller: (href: string) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const listeId = useId();
  const champ = useRef<HTMLInputElement>(null);

  const choix = useMemo<Choix[]>(() => {
    const aller = (href: string) => () => {
      onClose();
      onAller(href);
      router.push(href);
    };
    const ecrans = sections.flatMap((s) => s.items.map((i) => ({ cle: i.href, libelle: i.label, rubrique: s.label, icone: ICONES[i.icon] ?? ICONES.LayoutDashboard!, aller: aller(i.href) })));
    const apps = me.apps
      .filter((a) => a !== app && a !== "portail")
      .map((a) => ({ cle: `app-${a}`, libelle: `Ouvrir ${APPS[a].name}`, rubrique: "Applications", icone: Grid, aller: aller(accueilDe(a, me, app)) }));
    const compte = [
      { cle: "mdp", libelle: "Changer le mot de passe", rubrique: "Compte", icone: KeyRound, aller: aller("/compte/mot-de-passe") },
      { cle: "sortie", libelle: "Se déconnecter", rubrique: "Compte", icone: LogOut, aller: onLogout },
    ];
    return [...ecrans, ...apps, ...compte];
  }, [sections, me, app, onClose, onLogout, onAller, router]);

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
      <div className={cx(PANNEAU, "n-surgir relative w-full max-w-xl overflow-hidden")}>
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
                  <span className={cx("grid h-8 w-8 flex-none place-items-center rounded-lg transition-colors", i === actif ? "bg-accent text-white" : "bg-panel-3 text-muted")}>
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

/* ─── Retour au clic : barre de progression et écran en chargement ──────── */

/** Écrans dont le squelette (loading.tsx) est affiché : la barre attend leur contenu. */
let squelettes = 0;
const abonnesSquelettes = new Set<() => void>();

function signalerSquelette(delta: 1 | -1) {
  squelettes += delta;
  abonnesSquelettes.forEach((rappel) => rappel());
}

/** Chemin d'un lien de l'application que l'on vient de suivre ; null pour un nouvel onglet, un autre site, un fichier. */
function cheminDuClic(e: MouseEvent): string | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const lien = (e.target as Element | null)?.closest?.("a[href]");
  if (!(lien instanceof HTMLAnchorElement)) return null;
  if ((lien.target && lien.target !== "_self") || lien.hasAttribute("download")) return null;
  const url = new URL(lien.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return null;
  return url.pathname;
}

/**
 * Fine barre en haut de l'écran, à la couleur de l'application, pendant un changement d'écran. Elle
 * ne paraît que si l'attente dépasse 150 ms, avance vite puis ralentit, et se remplit quand l'écran
 * arrive ; si l'écran arrive d'abord en squelette, elle attend son contenu. Elle part d'un clic sur
 * un lien (menus, lanceur, liens des écrans) ou de la recherche. Mouvement réduit : elle paraît et
 * disparaît sans glisser.
 */
function useProgression(pathname: string) {
  const barre = useRef<HTMLDivElement>(null);
  const chemin = useRef(pathname);
  const etat = useRef<{ attente?: number; garde?: number; avance?: Animation; visible: boolean }>({ visible: false });

  const finir = useCallback(() => {
    const s = etat.current;
    window.clearTimeout(s.attente);
    window.clearTimeout(s.garde);
    s.attente = undefined;
    s.garde = undefined;
    const el = barre.current;
    if (!el || !s.visible) return;
    s.visible = false;
    if (s.avance) {
      // La barre se remplit depuis l'endroit atteint (hors rendu, sa position ne peut être relevée).
      try {
        s.avance.commitStyles();
      } catch {
        el.style.transform = "scaleX(0.6)";
      }
      s.avance.cancel();
      s.avance = undefined;
    }
    const remettre = () => {
      if (etat.current.visible) return;
      el.getAnimations().forEach((a) => a.cancel());
      el.style.opacity = "0";
      el.style.transform = "scaleX(0)";
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return remettre();
    el.animate([{ transform: el.style.transform || "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 200, easing: "ease-out", fill: "forwards" });
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, delay: 160, easing: "ease-out", fill: "forwards" }).onfinish = remettre;
  }, []);

  const montrer = useCallback(() => {
    const s = etat.current;
    const el = barre.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    s.visible = true;
    el.style.opacity = "1";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transform = "scaleX(1)";
      return;
    }
    el.style.transform = "scaleX(0)";
    s.avance = el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(0.92)" }], { duration: 9000, easing: "cubic-bezier(0.1, 0.75, 0.2, 1)", fill: "forwards" });
  }, []);

  const demarrer = useCallback(
    (cible?: string) => {
      if (cible !== undefined && cible === chemin.current) return;
      const s = etat.current;
      window.clearTimeout(s.garde);
      // Filet : une navigation qui n'aboutit pas (erreur, lien sans suite) ne laisse pas la barre.
      s.garde = window.setTimeout(finir, 15000);
      if (s.visible || s.attente !== undefined) return;
      s.attente = window.setTimeout(() => {
        s.attente = undefined;
        montrer();
      }, 150);
    },
    [finir, montrer],
  );

  // L'écran demandé est là : la barre se remplit, sauf si un squelette attend encore son contenu.
  useEffect(() => {
    chemin.current = pathname;
    if (squelettes === 0) finir();
  }, [pathname, finir]);

  useEffect(() => {
    const surSquelette = () => (squelettes > 0 ? demarrer() : finir());
    const surClic = (e: MouseEvent) => {
      const cible = cheminDuClic(e);
      if (cible) demarrer(cible);
    };
    abonnesSquelettes.add(surSquelette);
    document.addEventListener("click", surClic);
    if (squelettes > 0) demarrer();
    const s = etat.current;
    return () => {
      abonnesSquelettes.delete(surSquelette);
      document.removeEventListener("click", surClic);
      window.clearTimeout(s.attente);
      window.clearTimeout(s.garde);
    };
  }, [demarrer, finir]);

  return { barre, demarrer };
}

/** Nom de l'écran demandé, d'après la navigation de son application (l'entrée la plus précise). */
function nomEcran(pathname: string): string | null {
  const app = appFromPath(pathname);
  if (!app) return null;
  let trouve: { href: string; label: string } | null = null;
  for (const s of NAV[app]) {
    for (const i of s.items) {
      if ((pathname === i.href || pathname.startsWith(`${i.href}/`)) && (!trouve || i.href.length > trouve.href.length)) trouve = i;
    }
  }
  return trouve?.label ?? null;
}

/**
 * Écran en cours d'ouverture, prêt pour un loading.tsx : la forme de l'écran attendu paraît dès le
 * clic, sans entrée animée ; à la place du sous-titre, le nom de l'écran qui s'ouvre. La barre du
 * haut attend alors son contenu. Les loading.tsx ont été retirés le 22 octobre 2026 : avec eux, Next
 * précharge les mises en page de chaque lien visible (un appel au noyau par tuile de l'accueil) et
 * les redirections par profil passent après l'envoi de la page. À rebrancher quand ces deux effets
 * auront été mesurés en recette.
 */
export function ChargementEcran() {
  const pathname = usePathname();
  const nom = nomEcran(pathname);
  useEffect(() => {
    signalerSquelette(1);
    return () => signalerSquelette(-1);
  }, []);
  // Les blocs de la page entrent d'ordinaire en montant (.n-page) : le squelette, lui, est là d'emblée.
  const fixe: CSSProperties = { animation: "none" };
  return (
    <div role="status">
      <div className="mb-6" style={fixe}>
        <Squelette className="h-8 w-[min(420px,72%)] sm:h-10" />
        <p className="mt-2 text-sm leading-relaxed text-muted" style={{ animation: "n-apparaitre 280ms ease-out 450ms both" }}>
          {nom ? `Ouverture de l'écran « ${nom} »…` : "Ouverture de l'écran…"}
        </p>
      </div>
      <div aria-hidden className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" style={fixe}>
        {[0, 1, 2, 3].map((n) => (
          <Squelette key={n} className={cx("h-[114px]", n > 1 && "hidden sm:block")} />
        ))}
      </div>
      <div aria-hidden className="mt-6" style={fixe}>
        <Squelette className="h-[320px]" />
      </div>
    </div>
  );
}
