"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ClavierReact } from "react";
import { IconeModule } from "@/components/accueil/icones-modules";
import { voisine } from "@/components/accueil/tuiles";
import { ChevronDown } from "@/components/icons";
import { PANNEAU, cx } from "@/components/ui";
import type { NavBadge, NavItem, NavSection } from "@/lib/nav";

export type Pastilles = Partial<Record<NavBadge, { count: number; severe: boolean }>>;

/** Entrée de navigation active pour le chemin courant (l'accueil d'un espace ne s'active que sur lui-même). */
export function estActif(item: NavItem, pathname: string, home: string) {
  return item.href === home ? pathname === home : pathname === item.href || pathname.startsWith(item.href + "/");
}

/** Ce que l'on trouve derrière chaque entrée, en une ligne, sous son nom dans les menus. */
const DESCRIPTIONS: Record<string, string> = {
  "/finance": "Trésorerie, résultat et décisions du jour",
  "/finance/pilotage": "Budget par activité, réalisé et écarts",
  "/finance/rapport": "Le rapport du mois, prêt à imprimer",
  "/finance/approbations": "Pièces et paiements qui attendent un visa",
  "/finance/demandes": "Vos pièces et engagements soumis, et leur état",
  "/finance/fournisseurs": "Fiches et coordonnées des fournisseurs",
  "/finance/guide-achats": "Engager, saisir, soumettre, suivre",
  "/finance/engagements": "Demandes de dépense avant commande",
  "/finance/alertes": "Seuils franchis et anomalies à traiter",
  "/finance/guide": "Mode d'emploi des écrans de la finance",
  "/finance/ventes": "Factures et avoirs clients",
  "/finance/achats": "Factures fournisseurs et dépenses",
  "/finance/tresorerie": "Banques, caisses et rapprochements",
  "/finance/relances": "Créances échues et relances",
  "/finance/tiers": "Clients, fournisseurs et leurs soldes",
  "/finance/immobilisations": "Biens, amortissements et cessions",
  "/finance/dette": "Emprunts et échéanciers",
  "/finance/ecritures": "Journaux et opérations diverses",
  "/finance/plan-comptable": "Les comptes et leur classement",
  "/finance/etats": "Balance, grand livre et états financiers",
  "/finance/fiscalite": "TVA, retenues et déclarations",
  "/finance/clotures": "Contrôles et clôture des périodes",
  "/transport": "Volume du mois, marge, rotations à traiter, contrôles",
  "/transport/rotations": "Saisie, validation et facturation des rotations",
  "/transport/manquants": "Manquants tolérés et excédentaires, créances",
  "/transport/rentabilite": "Marge par ensemble, route, chauffeur, client",
  "/transport/proprietaires": "Ensembles gérés : relevés, commissions, pièces",
  "/transport/taxes": "Barème et état mensuel des taxes spécifiques",
  "/transport/flotte": "Ensembles, propriété, charges, chauffeurs",
  "/transport/routes": "Distances, coûts standard, carburant, tarifs",
  "/transport/parametres": "Manquants, relevés, clients, produits",
  "/finance/chantiers": "Coûts, avancement et marge des chantiers",
  "/finance/immobilier": "Biens, baux et loyers",
  "/finance/admin/utilisateurs": "Comptes, profils et accès",
  "/finance/admin/societes": "Les sociétés et leurs réglages",
  "/finance/admin/axes": "Activités, chantiers et autres axes",
  "/finance/admin/imputations": "Règles d'imputation analytique",
  "/finance/admin/parametres": "Seuils d'alerte et taux",
  "/finance/admin/audit": "Qui a fait quoi, et quand",
  "/axispro": "Portefeuille des projets évalués",
  "/axispro/actions": "Recommandations et leur suivi",
  "/axispro/financements": "Demandes et accords de financement",
  "/axispro/comites": "Réunions et décisions des comités",
  "/axispro/temps": "Temps passé et honoraires",
  "/axispro/grille": "Critères et barème d'évaluation",
  "/axispro/pieces": "Modèles de documents du cabinet",
  "/axispro/admin/utilisateurs": "Comptes, profils et accès",
  "/axispro/admin/societes": "Les sociétés et leurs réglages",
  "/analyse": "Synthèse et constats remarquables",
  "/analyse/rentabilite": "Marges par activité, client et route",
  "/analyse/tresorerie": "Prévision et tension de trésorerie",
  "/analyse/clients": "Concentration, retards et risque client",
  "/analyse/transport": "Coût complet des camions et des routes",
  "/analyse/depenses": "Postes de dépense, dérives et contrôles",
  "/analyse/previsions": "Atterrissage de l'exercice et simulateur",
  "/analyse/fiabilite": "Qualité et cohérence des données",
  "/analyse/portefeuille": "Projets en cours et pipeline",
  "/analyse/diagnostic": "Forces et fragilités des projets",
  "/analyse/comites": "Qualité et délais des décisions",
  "/analyse/financements": "Montants obtenus et taux d'accord",
  "/analyse/activite": "Honoraires, temps et rentabilité",
  "/analyse/risques": "Risques et retards d'exécution",
  "/rh": "Effectif, échéances, absences et masse salariale",
  "/rh/guide": "Mode d'emploi de l'espace RH",
  "/rh/salaries": "Dossiers du personnel, contrats et rémunérations",
  "/rh/conges": "Demandes, planning et soldes de congés",
  "/rh/avances": "Avances sur salaire et prêts, retenues mensuelles",
  "/rh/paie": "Bulletins du mois, contrôles, validation, écriture",
  "/rh/simulateur": "Du salaire de base au net, ou du net au brut",
  "/rh/moi": "Vos congés, vos bulletins, votre équipe",
  "/rh/parametres": "Barème, taux, rubriques, absences, jours fériés",
};

const SENS_PASTILLE: Record<NavBadge, [string, string]> = { approvals: [" en attente", " en attente"], controls: [" contrôle en anomalie", " contrôles en anomalie"], alerts: [" alerte", " alertes"] };

function Compte({ n, severe, sens }: { n: number; severe: boolean; sens: string }) {
  return (
    <span className={cx("inline-grid min-w-[20px] flex-none place-items-center rounded-full px-1.5 py-px text-[11px] font-bold leading-4 tabular", severe ? "bg-danger text-white" : "bg-warn-doux text-warn")}>
      {n}
      <span className="sr-only">{sens}</span>
    </span>
  );
}

function pastilleDe(item: NavItem, badges?: Pastilles) {
  const p = item.badge ? badges?.[item.badge] : undefined;
  return p && p.count > 0 ? { ...p, sens: SENS_PASTILLE[item.badge!][p.count > 1 ? 1 : 0] } : null;
}

/**
 * Barre des rubriques, à la manière des menus d'Odoo : chaque rubrique ouvre un panneau de ses
 * écrans, avec leur icône illustrée et une ligne qui dit ce qu'on y trouve. Un fil d'or marque la
 * rubrique de l'écran ouvert ; une pastille blanche suit le curseur d'une rubrique à l'autre. Une
 * rubrique d'un seul écran est un lien direct.
 */
export function BarreMenus({ sections, pathname, home, badges, className }: { sections: NavSection[]; pathname: string; home: string; badges?: Pastilles; className?: string }) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [joue, setJoue] = useState(false);
  const [survol, setSurvol] = useState<{ x: number; w: number } | null>(null);
  const [fil, setFil] = useState<{ x: number; w: number } | null>(null);
  const [place, setPlace] = useState<{ left: number; width: number } | null>(null);
  const barre = useRef<HTMLDivElement>(null);
  const panneau = useRef<HTMLDivElement>(null);
  const idBase = useId();
  const active = sections.find((s) => s.items.some((i) => estActif(i, pathname, home)))?.label ?? null;
  const section = sections.find((s) => s.label === ouvert) ?? null;

  const declencheur = useCallback((label: string | null) => (label ? barre.current?.querySelector<HTMLElement>(`[data-rubrique="${CSS.escape(label)}"]`) : null), []);

  // Le fil d'or se pose sous la rubrique de l'écran ouvert, et glisse quand on change de rubrique.
  const mesurerFil = useCallback(() => {
    const el = declencheur(active);
    setFil(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
  }, [active, declencheur]);
  useLayoutEffect(() => mesurerFil(), [mesurerFil]);
  useEffect(() => {
    void document.fonts?.ready.then(mesurerFil);
    window.addEventListener("resize", mesurerFil);
    return () => window.removeEventListener("resize", mesurerFil);
  }, [mesurerFil]);

  // Changer d'écran referme le menu.
  useEffect(() => setOuvert(null), [pathname]);

  // Place du panneau : sous sa rubrique, sans sortir de l'écran ; largeur selon le nombre d'écrans.
  useLayoutEffect(() => {
    const el = declencheur(ouvert);
    const b = barre.current;
    if (!el || !b || !section) return setPlace(null);
    const n = section.items.length;
    const colonnes = n <= 3 ? n : n <= 8 ? 2 : 3;
    const width = Math.min(window.innerWidth - 32, colonnes * 292 + 20);
    const gauche = el.getBoundingClientRect().left - 14;
    const left = Math.max(16, Math.min(gauche, window.innerWidth - width - 16)) - b.getBoundingClientRect().left;
    setPlace({ left, width });
  }, [ouvert, section, declencheur]);

  // À l'ouverture, les icônes jouent leur entrée.
  useEffect(() => {
    if (!ouvert) return;
    setJoue(true);
    const t = window.setTimeout(() => setJoue(false), 1400);
    return () => window.clearTimeout(t);
  }, [ouvert]);

  // Échap, un clic au-dehors ou le focus qui sort referment le panneau.
  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      declencheur(ouvert)?.focus();
      setOuvert(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!barre.current?.contains(e.target as Node)) setOuvert(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [ouvert, declencheur]);

  function suivre(label: string) {
    const el = declencheur(label);
    if (el) setSurvol({ x: el.offsetLeft, w: el.offsetWidth });
    // Comme une barre de menus : une fois un menu ouvert, survoler une autre rubrique l'ouvre.
    if (ouvert && ouvert !== label && sections.find((s) => s.label === label)!.items.length > 1) setOuvert(label);
  }

  function clavierRubrique(e: ClavierReact<HTMLElement>, label: string) {
    const rubriques = [...(barre.current?.querySelectorAll<HTMLElement>("[data-rubrique]") ?? [])];
    const i = rubriques.findIndex((r) => r.dataset.rubrique === label);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const cible = rubriques[(i + (e.key === "ArrowRight" ? 1 : rubriques.length - 1)) % rubriques.length];
      cible?.focus();
      if (ouvert && cible?.dataset.rubrique && cible.tagName === "BUTTON") setOuvert(cible.dataset.rubrique);
    }
    if (e.key === "ArrowDown" && e.currentTarget.tagName === "BUTTON") {
      e.preventDefault();
      setOuvert(label);
      window.requestAnimationFrame(() => panneau.current?.querySelector<HTMLAnchorElement>("a[data-module]")?.focus());
    }
  }

  function clavierPanneau(e: ClavierReact<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const liens = [...(panneau.current?.querySelectorAll<HTMLAnchorElement>("a[data-module]") ?? [])];
    const i = liens.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === "ArrowUp" && liens[i]!.getBoundingClientRect().top <= liens[0]!.getBoundingClientRect().top + 5) {
      declencheur(ouvert)?.focus();
      return;
    }
    liens[voisine(liens, i, e.key)]?.focus();
  }

  return (
    <div
      ref={barre}
      className={cx("relative items-center", className)}
      onPointerLeave={() => setSurvol(null)}
      onBlur={(e) => {
        if (ouvert && e.relatedTarget && !barre.current?.contains(e.relatedTarget as Node)) setOuvert(null);
      }}
    >
      <nav aria-label="Rubriques" className="relative flex items-center gap-0.5">
        <span aria-hidden className="menus-survol pointer-events-none absolute inset-y-1.5 left-0 rounded-[11px] bg-panel shadow-[0_1px_2px_rgb(16_36_31/0.08),0_6px_16px_-8px_rgb(16_36_31/0.25)]" style={{ transform: `translateX(${survol?.x ?? fil?.x ?? 0}px)`, width: survol?.w ?? 0, opacity: survol ? 1 : 0 }} />
        {fil && <span aria-hidden className="menus-fil pointer-events-none absolute -bottom-[13px] left-0 h-[2.5px] rounded-full bg-or" style={{ transform: `translateX(${fil.x + 12}px)`, width: Math.max(0, fil.w - 24) }} />}
        {sections.map((s) => {
          const dedans = s.label === active;
          const total = s.items.reduce((n, i) => n + (pastilleDe(i, badges)?.count ?? 0), 0);
          const severe = s.items.some((i) => pastilleDe(i, badges)?.severe);
          const libelle = (
            <>
              <span>{s.label}</span>
              {total > 0 && <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", severe ? "bg-danger-vif" : "bg-warn-vif")} />}
            </>
          );
          const classe = cx(
            "relative z-[1] flex h-10 items-center gap-1.5 rounded-[11px] px-3 text-[14px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent",
            dedans ? "font-semibold text-ink" : "font-medium text-ink-2 hover:text-ink",
          );
          if (s.items.length === 1) {
            const item = s.items[0]!;
            return (
              <Link key={s.label} href={item.href} data-rubrique={s.label} aria-current={dedans ? "page" : undefined} onPointerEnter={() => suivre(s.label)} onKeyDown={(e) => clavierRubrique(e, s.label)} className={classe}>
                {item.label === s.label ? libelle : <span>{item.label}</span>}
              </Link>
            );
          }
          const id = `${idBase}-${s.label}`;
          return (
            <button
              key={s.label}
              type="button"
              data-rubrique={s.label}
              aria-expanded={ouvert === s.label}
              aria-controls={ouvert === s.label ? id : undefined}
              onClick={() => setOuvert((o) => (o === s.label ? null : s.label))}
              onPointerEnter={() => suivre(s.label)}
              onKeyDown={(e) => clavierRubrique(e, s.label)}
              className={classe}
            >
              {libelle}
              {total > 0 && <span className="sr-only">{`, ${total} à traiter`}</span>}
              <ChevronDown className={cx("h-3.5 w-3.5 text-muted transition-transform duration-300 ease-[var(--ease-ressort)]", ouvert === s.label && "rotate-180")} />
            </button>
          );
        })}
      </nav>

      {section && place && (
        <div
          ref={panneau}
          id={`${idBase}-${section.label}`}
          role="region"
          aria-label={section.label}
          onKeyDown={clavierPanneau}
          key={section.label}
          className={cx(PANNEAU, "menus-panneau absolute top-[calc(100%+14px)] z-50 p-1.5")}
          style={{ left: place.left, width: place.width }}
        >
          <ul className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${section.items.length <= 3 ? section.items.length : section.items.length <= 8 ? 2 : 3}, minmax(0, 1fr))` }}>
            {section.items.map((item, n) => {
              const actif = estActif(item, pathname, home);
              const p = pastilleDe(item, badges);
              return (
                <li key={item.href} className="menus-item" style={{ "--i": n } as CSSProperties}>
                  <Link
                    data-module
                    href={item.href}
                    aria-current={actif ? "page" : undefined}
                    onClick={() => setOuvert(null)}
                    className={cx("tuile group flex items-start gap-3 rounded-xl p-3 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent", actif ? "bg-accent-doux" : "hover:bg-panel-2 focus-visible:bg-panel-2", joue && "joue")}
                    style={{ "--d-intro": `${90 + n * 30}ms` } as CSSProperties}
                  >
                    <IconeModule cle={item.href} className="h-10 w-10 flex-none transition-transform duration-300 ease-[var(--ease-ressort)] group-hover:scale-110" />
                    <span className="min-w-0 flex-1 pt-0.5">
                      <span className="flex items-center gap-2">
                        <span className={cx("truncate text-[14px] leading-snug text-ink", actif ? "font-bold" : "font-semibold")}>{item.label}</span>
                        {p && <Compte n={p.count} severe={p.severe} sens={p.sens} />}
                      </span>
                      {DESCRIPTIONS[item.href] && <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{DESCRIPTIONS[item.href]}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Menu du téléphone : les rubriques et leurs écrans, chacun avec son icône illustrée. */
export function ListeMenus({ sections, pathname, home, badges, onNavigate }: { sections: NavSection[]; pathname: string; home: string; badges?: Pastilles; onNavigate?: () => void }) {
  return (
    <nav aria-label="Rubriques" className="space-y-5">
      {sections.map((s) => (
        <section key={s.label}>
          <h2 className="px-3 pb-1.5 text-[13px] font-semibold text-muted">{s.label}</h2>
          <ul className="space-y-0.5">
            {s.items.map((item) => {
              const actif = estActif(item, pathname, home);
              const p = pastilleDe(item, badges);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={actif ? "page" : undefined}
                    className={cx("tuile group flex items-center gap-3 rounded-2xl px-3 py-2 text-[15px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", actif ? "bg-accent-doux font-semibold text-ink" : "font-medium text-ink-2 hover:bg-panel-2 hover:text-ink")}
                  >
                    <IconeModule cle={item.href} className="h-8 w-8 flex-none" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {p && <Compte n={p.count} severe={p.severe} sens={p.sens} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
