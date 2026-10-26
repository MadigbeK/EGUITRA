"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ClavierReact, type MouseEvent as SourisReact } from "react";
import { IconeModule } from "@/components/accueil/icones-modules";
import { alignerSociete, rayonsDe, societePour, voisine, type Tuile } from "@/components/accueil/tuiles";
import { ChevronRight } from "@/components/icons";
import { PANNEAU, cx, useMouvementReduit } from "@/components/ui";
import type { AppCode } from "@/lib/config";
import type { Me } from "@/lib/types";

/** Durée de la fermeture du panneau (son animation de sortie). */
const SORTIE_MS = 170;
/** Durée pendant laquelle les icônes jouent leur entrée à l'ouverture. */
const JEU_MS = 1500;

type Etat = "ferme" | "ouvert" | "sortie";

/** Module ouvert dans la page courante : l'accueil d'un espace ne s'active que sur lui-même. */
function estOuvert(href: string, pathname: string) {
  return href === "/finance" || href === "/axispro" || href === "/analyse" || href === "/rh" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/** Neuf points, comme le lanceur de Microsoft 365 ou de Google ; ils ondulent au survol. */
function Gaufre({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      {[0, 1, 2].flatMap((l) =>
        [0, 1, 2].map((c) => <circle key={`${l}${c}`} className="gaufre-point" cx={5 + c * 7} cy={5 + l * 7} r={2} fill="currentColor" style={{ "--n": l + c } as CSSProperties} />),
      )}
    </svg>
  );
}

/**
 * Lanceur d'applications, à la manière de Microsoft 365 et de Google : le bouton à neuf points
 * ouvre, depuis n'importe quel écran, le panneau des modules NIMOVA rangés par espace. On y saute
 * d'un module à l'autre, ou l'on rejoint l'accueil : le panneau s'étend alors en plein écran et
 * l'accueil prend le relais. Le panneau se déploie depuis le bouton et ses icônes s'animent.
 */
export function Lanceur({ me, app }: { me: Me; app: AppCode }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduit = useMouvementReduit();
  const [etat, setEtat] = useState<Etat>("ferme");
  const [joue, setJoue] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const panneau = useRef<HTMLDivElement>(null);
  const voile = useRef<{ el: HTMLDivElement; entree: Animation } | null>(null);
  const panneauId = useId();
  const rayons = useMemo(() => rayonsDe(me, app), [me, app]);
  const rang = useMemo(() => new Map(rayons.flatMap((r) => r.tuiles).map((t, i) => [t.cle, i])), [rayons]);
  const ouvert = etat === "ouvert";

  const fermer = useCallback(
    (rendreFocus: boolean) => {
      setEtat((e) => (e === "ouvert" ? (reduit ? "ferme" : "sortie") : e));
      if (rendreFocus) bouton.current?.focus();
    },
    [reduit],
  );

  useEffect(() => {
    if (etat !== "sortie") return;
    const t = window.setTimeout(() => setEtat("ferme"), SORTIE_MS);
    return () => window.clearTimeout(t);
  }, [etat]);

  // À l'ouverture : le focus va au module ouvert (ou au premier), les icônes jouent leur entrée.
  useEffect(() => {
    if (!ouvert) return;
    const p = panneau.current;
    const cible = p?.querySelector<HTMLAnchorElement>("a[aria-current=page]") ?? p?.querySelector<HTMLAnchorElement>("a[data-module]");
    cible?.focus({ preventScroll: true });
    // Le module ouvert peut être plus bas que la zone visible : on fait défiler le panneau seul.
    const zone = p?.firstElementChild;
    if (cible && zone) {
      const b = cible.getBoundingClientRect();
      const z = zone.getBoundingClientRect();
      if (b.bottom > z.bottom) zone.scrollTop += b.bottom - z.bottom + 12;
    }
    setJoue(true);
    const t = window.setTimeout(() => setJoue(false), JEU_MS);
    return () => window.clearTimeout(t);
  }, [ouvert]);

  // Échap ou un clic au-dehors referment le panneau.
  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fermer(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!boite.current?.contains(e.target as Node)) fermer(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [ouvert, fermer]);

  // Le voile du passage vers l'accueil part avec la coque : il achève de couvrir l'écran, puis
  // s'efface sur l'accueil qui fait entrer ses tuiles.
  useEffect(
    () => () => {
      const v = voile.current;
      voile.current = null;
      if (!v) return;
      const effacer = () => void v.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-out", fill: "forwards" }).finished.catch(() => undefined).then(() => v.el.remove());
      void v.entree.finished.then(effacer, effacer);
      window.setTimeout(() => v.el.remove(), 1500);
    },
    [],
  );

  // Module réservé à une société (BTP, Immobilier) d'une autre application : sa société lui est
  // donnée avant de l'ouvrir, sans quoi il s'ouvrirait dans les livres du cabinet et répondrait 422.
  function ouvrir(e: SourisReact<HTMLAnchorElement>, t: Tuile) {
    fermer(false);
    if (!societePour(me, app, t, false) || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void alignerSociete(me, app, t, false).then(() => router.push(t.href));
  }

  function naviguer(e: ClavierReact<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const liens = [...(panneau.current?.querySelectorAll<HTMLAnchorElement>("a[data-module]") ?? [])];
    const i = liens.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    e.preventDefault();
    liens[voisine(liens, i, e.key)]?.focus();
  }

  // Vers l'accueil : le panneau s'étend jusqu'à couvrir l'écran, puis l'accueil fait entrer ses tuiles.
  function versAccueil(e: SourisReact<HTMLAnchorElement>) {
    const p = panneau.current;
    if (!p || reduit || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const r = p.getBoundingClientRect();
    const v = document.createElement("div");
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:16px;background:#fff;z-index:100;pointer-events:none;box-shadow:0 30px 80px -20px rgb(16 36 31 / .35)`;
    document.body.appendChild(v);
    voile.current?.el.remove();
    const entree = v.animate(
      [
        { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: "16px", background: "#ffffff" },
        { left: "0px", top: "0px", width: "100vw", height: "100vh", borderRadius: "0px", background: "#f1f5f0" },
      ],
      { duration: 480, easing: "cubic-bezier(0.7,0,0.2,1)", fill: "forwards" },
    );
    voile.current = { el: v, entree };
    setEtat("ferme");
    window.setTimeout(() => router.push("/accueil"), 160);
    // Filet : si l'accueil tarde, le voile ne reste pas sur la coque.
    window.setTimeout(() => v.remove(), 6000);
  }

  return (
    <div
      ref={boite}
      className="relative"
      onBlur={(e) => {
        // Tab hors du panneau le referme (un clic dans ses marges ne donne le focus à rien : on le garde).
        if (ouvert && e.relatedTarget && !boite.current?.contains(e.relatedTarget as Node)) fermer(false);
      }}
    >
      <button
        ref={bouton}
        type="button"
        onClick={() => (ouvert ? fermer(false) : setEtat("ouvert"))}
        aria-expanded={ouvert}
        aria-controls={ouvert ? panneauId : undefined}
        aria-haspopup="dialog"
        aria-label="Applications NIMOVA"
        title="Applications NIMOVA"
        className={cx(
          "gaufre grid h-10 w-10 place-items-center rounded-xl border shadow-[0_1px_2px_rgb(16_36_31/0.04)] transition-colors duration-200",
          ouvert ? "border-transparent bg-accent text-white" : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink",
        )}
      >
        <Gaufre className="h-[18px] w-[18px]" />
      </button>

      {etat !== "ferme" && (
        <div
          ref={panneau}
          id={panneauId}
          role="dialog"
          aria-label="Applications NIMOVA"
          onKeyDown={naviguer}
          className={cx(
            PANNEAU,
            "lanceur fixed inset-x-3 top-[68px] z-50 flex max-h-[calc(100dvh-84px)] flex-col overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[372px]",
            etat === "sortie" && "lanceur-sortie",
          )}
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain px-2.5 pb-2 pt-3">
            {rayons.map((r, ri) => (
              // Chaque famille à la couleur de son application, comme sur l'accueil ([data-app] de globals.css,
              // Finance comprise : sous Transport ou RH, sa famille garde le jade).
              <section key={r.cle} data-app={r.cle === "outils" ? undefined : r.cle} aria-label={r.titre} className={cx(ri > 0 && "mt-1.5 border-t border-line pt-3")}>
                <h2 className={cx("lanceur-titre flex items-center gap-2 px-2.5 pb-1.5 text-[12.5px] font-semibold", r.cle === "outils" ? "text-muted" : "text-accent-strong")} style={{ "--i": rang.get(r.tuiles[0]!.cle) ?? 0 } as CSSProperties}>
                  <span aria-hidden className={cx("h-1.5 w-1.5 flex-none rounded-full", r.cle === "outils" ? "bg-line-strong" : "bg-accent-vif")} />
                  {r.titre}
                </h2>
                <ul className="grid grid-cols-3 gap-0.5">
                  {r.tuiles.map((t) => {
                    const n = rang.get(t.cle) ?? 0;
                    const actif = estOuvert(t.href, pathname);
                    return (
                      <li key={t.cle} className="lanceur-item" style={{ "--i": n } as CSSProperties}>
                        <Link
                          data-module
                          href={t.href}
                          aria-current={actif ? "page" : undefined}
                          onClick={(e) => ouvrir(e, t)}
                          className={cx(
                            "tuile group relative flex flex-col items-center gap-1.5 rounded-xl px-1 pb-2.5 pt-3 text-center outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent",
                            actif ? "bg-accent-doux" : "hover:bg-panel-2 focus-visible:bg-panel-2",
                            joue && "joue",
                          )}
                          style={{ "--d-intro": `${140 + n * 26}ms` } as CSSProperties}
                        >
                          <IconeModule cle={t.cle} className="h-9 w-9 transition-transform duration-300 ease-[var(--ease-ressort)] group-hover:-translate-y-0.5 group-hover:scale-110" />
                          <span className={cx("line-clamp-2 text-[12px] leading-tight", actif ? "font-semibold text-ink" : "text-ink-2 group-hover:text-ink")}>{t.libelle}</span>
                          {actif && <span aria-hidden className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent-vif" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <div className="lanceur-pied border-t border-line bg-panel-2 p-2">
            <Link href="/accueil" onClick={versAccueil} className="group flex items-center gap-3 rounded-xl px-2.5 py-2 outline-none transition-colors hover:bg-panel-3 focus-visible:ring-2 focus-visible:ring-accent">
              <span className="gaufre grid h-9 w-9 flex-none place-items-center rounded-[10px] border border-line bg-panel-2 text-accent">
                <Gaufre className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink">Accueil NIMOVA</span>
                <span className="block truncate text-[12px] text-muted">Tous les modules en plein écran</span>
              </span>
              <ChevronRight className="h-4 w-4 flex-none text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
