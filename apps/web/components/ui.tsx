"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AlertTriangle, ArrowDown, ArrowUp, Baisse, Check, CheckCircle2, Eye, EyeOff, FileUp as FileUpIcon, Hausse, Info, Loader2, X, type Icon } from "@/components/icons";
import { cx } from "@/lib/cx";
import { Ondes } from "@/components/guilloche";
import { tamponPlein, type TonEtat } from "@/lib/couleurs";
import { fmtAxe, fmtPct, fmtShort } from "@/lib/format";

export { cx };

/* ─── Mouvement ────────────────────────────────────────────────────────── */

function abonnerMouvement(rappel: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", rappel);
  return () => mq.removeEventListener("change", rappel);
}

/** Vrai si l'utilisateur a demandé à son système de réduire les animations. */
export function useMouvementReduit(): boolean {
  return useSyncExternalStore(
    abonnerMouvement,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Vrai dès que l'élément entre à l'écran (une seule fois). `marge` l'annonce un peu avant. */
export function useVisible<T extends Element>(marge = "0px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [vu, setVu] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || vu) return;
    if (typeof IntersectionObserver === "undefined") {
      setVu(true);
      return;
    }
    const io = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) {
        setVu(true);
        io.disconnect();
      }
    }, { threshold: 0.15, rootMargin: marge });
    io.observe(el);
    return () => io.disconnect();
  }, [vu, marge]);
  return [ref, vu];
}

type Connexion = { saveData?: boolean; addEventListener?: (type: "change", rappel: () => void) => void; removeEventListener?: (type: "change", rappel: () => void) => void };

function connexion(): Connexion | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: Connexion }).connection;
}

/** Économie de données demandée au navigateur (Android, Chrome) : les chiffres ne défilent pas. */
function economieDonnees(): boolean {
  return connexion()?.saveData === true;
}

function abonnerConnexion(rappel: () => void) {
  const c = connexion();
  c?.addEventListener?.("change", rappel);
  return () => c?.removeEventListener?.("change", rappel);
}

/** Vrai si le navigateur demande d'économiser les données. */
export function useEconomieDonnees(): boolean {
  return useSyncExternalStore(abonnerConnexion, economieDonnees, () => false);
}

/** Un chiffre s'affiche directement, sans défiler : mouvement réduit ou économie de données. */
function chiffresFixes(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || economieDonnees();
}

const sansAbonnement = () => () => {};

/** Vrai pendant l'hydratation d'une page rendue par le serveur : ce qui s'affiche est déjà peint. */
function useHydratation(): boolean {
  return useSyncExternalStore(sansAbonnement, () => false, () => true);
}

/** Durées du défilement d'un chiffre : entrée à l'écran, puis passage d'une valeur à la suivante. */
const DUREE_ENTREE = 700;
const DUREE_CHANGEMENT = 500;
/** L'entrée part quand le chiffre arrive à 200 px sous le bas de la fenêtre, avant qu'on le voie. */
const MARGE_ENTREE = 200;

/**
 * Nombre affiché par un chiffre qui défile. La valeur finale est l'état de départ : le rendu
 * serveur, l'impression, une capture et le lecteur d'écran sont justes sans attendre. Le défilement
 * depuis zéro ne joue qu'une fois, et seulement sur un chiffre que l'on n'a pas encore vu : au
 * premier affichage s'il est déjà dans la fenêtre, sinon juste avant qu'il y entre. Une valeur juste
 * déjà visible n'est jamais remplacée par un zéro. Ensuite, une nouvelle valeur glisse depuis
 * l'ancienne si elle s'écrit de la même façon (`cle` : préfixe, unité, décimales), sinon elle se pose.
 */
function useChiffre<T extends Element>(ref: RefObject<T | null>, cible: number, cle: string, actif: boolean): number {
  const [affiche, setAffiche] = useState(cible);
  const hydratation = useHydratation();
  // Un nombre est-il déjà peint ? Un texte sans nombre (« – » en attendant les données) ne compte pas.
  const peint = useRef(hydratation && actif);
  const courant = useRef(cible);
  const vise = useRef({ cible, cle });
  const entree = useRef(false);
  const image = useRef(0);

  const poser = useCallback((v: number) => {
    cancelAnimationFrame(image.current);
    courant.current = v;
    setAffiche(v);
  }, []);

  const lancer = useCallback(
    (depuis: number, vers: number, duree: number) => {
      cancelAnimationFrame(image.current);
      if (depuis === vers) {
        poser(vers);
        return;
      }
      courant.current = depuis;
      setAffiche(depuis);
      const t0 = performance.now();
      const pas = (t: number) => {
        const p = Math.min(1, (t - t0) / duree);
        const v = p < 1 ? depuis + (vers - depuis) * (1 - Math.pow(1 - p, 4)) : vers;
        courant.current = v;
        setAffiche(v);
        if (p < 1) image.current = requestAnimationFrame(pas);
      };
      image.current = requestAnimationFrame(pas);
    },
    [poser],
  );

  // Impression lancée pendant un défilement ou avant l'entrée : la valeur finale, tout de suite.
  useEffect(() => {
    const imprimer = () => {
      entree.current = true;
      cancelAnimationFrame(image.current);
      courant.current = vise.current.cible;
      flushSync(() => setAffiche(vise.current.cible));
    };
    window.addEventListener("beforeprint", imprimer);
    return () => window.removeEventListener("beforeprint", imprimer);
  }, []);

  useLayoutEffect(() => {
    const avant = vise.current;
    vise.current = { cible, cle };
    const dejaPeint = peint.current;
    if (actif) peint.current = true;
    const el = ref.current;
    if (!actif || !el || chiffresFixes()) {
      // « – » en attendant les données : l'entrée reste à jouer, pour le premier vrai nombre.
      if (actif) entree.current = true;
      poser(cible);
      return;
    }
    const r = el.getBoundingClientRect();
    const enVue = r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
    const arreter = () => cancelAnimationFrame(image.current);

    if (entree.current) {
      if (avant.cle === cle && enVue) lancer(courant.current, cible, DUREE_CHANGEMENT);
      else poser(cible);
      return arreter;
    }
    if (enVue) {
      entree.current = true;
      // Rendu serveur déjà peint : la valeur juste reste, sans repartir de zéro.
      if (dejaPeint) poser(cible);
      else lancer(0, cible, DUREE_ENTREE);
      return arreter;
    }
    if (r.width === 0 || r.bottom <= 0 || typeof IntersectionObserver === "undefined") {
      // Masqué, ou déjà dépassé par le défilement : rien à jouer.
      entree.current = true;
      poser(cible);
      return;
    }
    // Plus bas dans la page : la valeur juste en attendant, le défilement juste avant l'entrée.
    poser(cible);
    const io = new IntersectionObserver(
      (entrees) => {
        if (!entrees.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (entree.current) return;
        entree.current = true;
        // Atteint d'un saut (ancre, défilement rapide) : déjà visible, la valeur juste reste.
        if (el.getBoundingClientRect().top < window.innerHeight) return;
        lancer(0, vise.current.cible, DUREE_ENTREE);
      },
      { rootMargin: `0px 0px ${MARGE_ENTREE}px 0px` },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      arreter();
    };
  }, [cible, cle, actif, ref, poser, lancer]);

  return affiche;
}

/** Séparateurs de milliers acceptés : espace, espace insécable, espace fine insécable. */
const NOMBRE = /[-−]?\d{1,3}(?:[   ]\d{3})+(?:,\d+)?|[-−]?\d+(?:,\d+)?/;
const SEPARATEUR = /[   ]/g;

/**
 * Valeur affichée : le premier nombre d'un texte défile depuis zéro juste avant d'entrer à l'écran
 * (« 384 M », « 1,74 Md », « 12 en service »), en 700 ms au plus. Le texte final est rendu dès le
 * départ (serveur, impression, capture) ; le lecteur d'écran lit toujours le texte final.
 */
export function Valeur({ value }: { value: ReactNode }) {
  const texte = typeof value === "number" ? new Intl.NumberFormat("fr-FR").format(value) : typeof value === "string" ? value : null;
  const trouve = texte ? NOMBRE.exec(texte) : null;
  const ref = useRef<HTMLSpanElement>(null);
  const brut = trouve ? trouve[0] : "";
  const decimales = brut.includes(",") ? (brut.split(",")[1] ?? "").length : 0;
  const cible = trouve ? Number(brut.replace(SEPARATEUR, "").replace("−", "-").replace(",", ".")) : 0;
  const avant = texte && trouve ? texte.slice(0, trouve.index) : "";
  const apres = texte && trouve ? texte.slice(trouve.index + brut.length) : "";
  const groupe = brut.replace(SEPARATEUR, "") !== brut || Math.abs(cible) >= 10000;
  // Deux valeurs ne glissent l'une vers l'autre que si elles s'écrivent de la même façon :
  // « 980 M » ne défile pas vers « 1,02 Md » (on lirait un instant « 980,00 Md »).
  const cle = `${avant}|${apres}|${decimales}|${groupe ? 1 : 0}`;
  const affiche = useChiffre(ref, cible, cle, trouve !== null);
  if (!texte || !trouve) return <span ref={ref}>{value}</span>;
  // Au repos, le nombre tel qu'il a été écrit (signe, espaces) ; pendant le défilement, reformaté.
  const nombre = affiche === cible ? brut : new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: groupe }).format(affiche);
  return (
    <span ref={ref}>
      <span className="valeur-texte tabular sr-only">{texte}</span>
      <span aria-hidden className="valeur-anim tabular">
        {avant}
        {nombre}
        {apres}
      </span>
    </span>
  );
}

/* ─── Couleurs ─────────────────────────────────────────────────────────── */

/**
 * Couleurs des graphiques et des repères d'état : une seule gamme, sur les jetons (lib/couleurs.ts).
 * ETAT_TON donne le ton d'un état par son mot (« Saisie », « Échue ») : tonEtat(mot).
 */
export { ETATS, ETAT_TON, SERIES, tonEtat } from "@/lib/couleurs";

/**
 * Ton : les quatre tons d'état (lib/couleurs.ts), plus « accent », la couleur de l'application,
 * réservée à la marque, aux actions et à la sélection. Un tampon d'état ne la prend plus : un
 * Badge « accent » s'écrit à l'encre (à remplacer écran par écran par le ton de ETAT_TON).
 */
export type Tone = TonEtat | "accent";

export type Teinte = "accent" | "jade" | "azur" | "ambre" | "rose" | "lagon" | "corail" | "or" | "danger";

const TUILE: Record<Teinte, { fond: string; trait: string }> = {
  accent: { fond: "var(--accent-doux)", trait: "var(--accent)" },
  jade: { fond: "#e2f5ea", trait: "#0b7a52" },
  azur: { fond: "#e6f0fc", trait: "#1a64bd" },
  ambre: { fond: "#fdf1d9", trait: "#8a5700" },
  rose: { fond: "#fbe7f0", trait: "#a5305f" },
  lagon: { fond: "#dcf5f4", trait: "#0b6f70" },
  corail: { fond: "#fdebe4", trait: "#b83e16" },
  or: { fond: "#f8efdc", trait: "#7d5c17" },
  danger: { fond: "var(--danger-doux)", trait: "var(--danger)" },
};

/** Sceau d'icône : un rond doux de la teinte cerclé d'un filet gravé, l'icône dans sa nuance foncée. */
export function IconTile({ icon: I, teinte = "accent", className }: { icon: Icon; teinte?: Teinte; className?: string }) {
  const t = TUILE[teinte];
  return (
    <span
      aria-hidden
      className={cx("grid h-10 w-10 flex-none place-items-center rounded-full", className)}
      style={{ background: t.fond, color: t.trait, boxShadow: `0 0 0 3px var(--panel), 0 0 0 4px color-mix(in oklab, ${t.trait} 28%, transparent)` }}
    >
      <I className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Unité d'une variation : en % de la valeur précédente, ou en points pour un taux (marge, part échue). */
export type UniteDelta = "pct" | "pts";

/** Écart de taux en points : « 2,6 pts », « 1,0 pt » (espace insécable). */
function fmtPoints(v: number, digits: number): string {
  const p = 10 ** digits;
  const r = Math.round(v * p) / p;
  return `${r.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: "always" })} ${r >= 2 ? "pts" : "pt"}`;
}

/**
 * Variation : flèche et pastille verte ou rouge (« inverse » pour une charge). Un taux varie en
 * points (`unite="pts"`, valeur = écart des deux taux) : de 34,7 % à 32,1 %, « ▼ 2,6 pts », et non
 * « ▼ 7,4 % », qui se lirait comme un écart de taux.
 */
export function Delta({ value, inverse, digits = 1, unite = "pct" }: { value: number | null; inverse?: boolean; digits?: number; unite?: UniteDelta }) {
  if (value === null || !Number.isFinite(value)) return null;
  const hausse = value >= 0;
  const bon = inverse ? !hausse : hausse;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold tabular", bon ? "text-ok-texte" : "text-danger")}>
      <svg viewBox="0 0 10 10" aria-hidden className={cx("h-2 w-2", !hausse && "rotate-180")}>
        <path d="M5 1 9.5 9h-9Z" fill="currentColor" />
      </svg>
      {unite === "pts" ? fmtPoints(Math.abs(value), digits) : fmtPct(Math.abs(value), digits)}
      <span className="sr-only">{hausse ? " en hausse" : " en baisse"}</span>
    </span>
  );
}

/* ─── Mise en page ─────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[30px] font-[650] leading-[1.05] tracking-[-0.025em] text-ink sm:text-[38px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-[80ch] text-sm leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Feuille : la surface commune des blocs posés sur le fond, rayon 20 px, liseré à peine visible et
 * ombre portée basse (le liseré est dans l'ombre, sans bordure). Card la porte ; un bloc qui n'est
 * pas une carte (lien, tuile, colonne) prend ces classes.
 */
export const FEUILLE = "rounded-[20px] bg-panel shadow-[var(--ombre-feuille)]";

/** Panneau flottant : menus, sélecteurs, notifications et fenêtres posés au-dessus de la page. */
export const PANNEAU = "rounded-2xl border border-line bg-panel shadow-[var(--ombre-flottante)]";

/** Feuille posée sur le fond, avec un titre et des actions facultatifs. */
export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  const head = Boolean(title || actions);
  return (
    <section className={cx("min-w-0", FEUILLE, className)}>
      {head && (
        <div className="flex min-h-[58px] flex-wrap items-center justify-between gap-x-3 gap-y-2 px-6 pb-1 pt-5">
          {title && <h2 className="font-display text-[17px] font-[620] leading-snug tracking-[-0.01em] text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={padded ? (head ? "px-6 pb-6 pt-2" : "p-6") : head ? "pb-2" : undefined}>{children}</div>
    </section>
  );
}

/** Sceau d'un chiffre clé : seuls les trois états qui disent quelque chose en portent un. */
type EtatSceau = "ok" | "warn" | "danger";

/** Couleur du sceau : il porte l'état (3:1 au moins sur le blanc et sur le fond). */
const SCEAU: Record<EtatSceau, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

/** L'état du sceau en toutes lettres, pour qui ne voit pas sa couleur. */
const ETAT_SCEAU: Record<EtatSceau, string> = {
  ok: "Conforme",
  warn: "À surveiller",
  danger: "Alerte",
};

/**
 * Sceau d'état : un petit cachet gravé, anneau pointillé et marque au centre. La forme dit l'état
 * autant que la couleur : disque pour conforme, triangle pour à surveiller, losange pour alerte.
 */
function Sceau({ tone }: { tone: EtatSceau }) {
  return (
    <>
      <svg viewBox="0 0 16 16" aria-hidden className={cx("mt-0.5 h-4 w-4 flex-none", SCEAU[tone])}>
        <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.2 1.4" />
        {tone === "ok" && <circle cx="8" cy="8" r="3.4" fill="currentColor" />}
        {tone === "warn" && <path d="M8 4.1 11.9 10.6H4.1Z" fill="currentColor" />}
        {tone === "danger" && <path d="M8 3.7 12.3 8 8 12.3 3.7 8Z" fill="currentColor" />}
      </svg>
      <span className="sr-only">{ETAT_SCEAU[tone]}</span>
    </>
  );
}

/** Boîte de dessin de la gravure de tendance (étirée à la largeur du chiffre clé). */
const GRAVURE_L = 240;
const GRAVURE_H = 40;

/**
 * Gravure de tendance : la vraie série d'un chiffre clé, gravée comme le faisceau d'un billet. Le
 * trait médian suit la série, quatre traits voisins l'accompagnent en se resserrant et en s'écartant
 * (le guillochis), le dernier point est marqué. Encre neutre : l'état reste au sceau. Les bornes sont
 * élargies à ±15 % de la moyenne au moins, pour qu'une variation de 2 % ne dessine pas une chute.
 */
function GravureTendance({ valeurs }: { valeurs: number[] }) {
  const n = valeurs.length;
  let lo = Math.min(...valeurs);
  let hi = Math.max(...valeurs);
  const plancher = (valeurs.reduce((s, v) => s + Math.abs(v), 0) / n) * 0.3;
  if (hi - lo < plancher) {
    const milieu = (hi + lo) / 2;
    lo = milieu - plancher / 2;
    hi = milieu + plancher / 2;
  }
  const haut = 10;
  const bas = GRAVURE_H - 10;
  const pts = valeurs.map((v, i) => [(i / (n - 1)) * GRAVURE_L, hi === lo ? GRAVURE_H / 2 : bas - ((v - lo) / (hi - lo)) * (bas - haut)] as [number, number]);
  const suivre = hermite(pts);
  const voisins = [-2, -1, 1, 2].map((k) => {
    let d = "";
    for (let p = 0; p <= 64; p++) {
      const x = (p / 64) * GRAVURE_L;
      const ecart = k * 3.4 * (1 + 0.42 * Math.sin((x / GRAVURE_L) * Math.PI * 5 + k * 1.3));
      d += `${p ? "L" : "M"}${arrondi(x)},${arrondi(suivre(x) + ecart)}`;
    }
    return d;
  });
  const dernier = pts[n - 1]!;
  return (
    <div aria-hidden className="kpi-gravure relative mt-3 h-10 text-ink-2">
      {/* Pas de vector-effect ici : combiné à pathLength sur un tracé étiré, il ne grave qu'une partie
          de la ligne. La hauteur n'est pas étirée (GRAVURE_H vaut la hauteur affichée) : le trait
          garde son épaisseur. */}
      <svg viewBox={`0 0 ${GRAVURE_L} ${GRAVURE_H}`} preserveAspectRatio="none" focusable="false" className="absolute inset-0 h-full w-full overflow-visible">
        {voisins.map((d, i) => (
          <path key={i} d={d} pathLength={1} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.8} className="guilloche-trait" style={{ "--i": i } as CSSProperties} />
        ))}
        <path d={courbe(pts)} pathLength={1} fill="none" stroke="currentColor" strokeOpacity={0.85} strokeWidth={1.6} strokeLinecap="round" className="guilloche-trait" style={{ "--i": 2 } as CSSProperties} />
      </svg>
      <span className="n-apparaitre absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current shadow-[0_0_0_2px_var(--panel)]" style={{ left: "100%", top: `${(dernier[1] / GRAVURE_H) * 100}%`, animationDelay: "900ms" }} />
    </div>
  );
}

/**
 * Chiffre clé, gravé comme un coupon : le libellé, la valeur en grand qui défile, une précision.
 * Le sceau dit l'état (couleur et forme), le libellé ou la précision le disent aussi en toutes
 * lettres. Au pied, la gravure : avec une vraie série (`serie`), la gravure de tendance, seule
 * courbe sous le chiffre ; sans série, des ondes en or, décoratives, gravées une fois puis
 * immobiles, jamais à la couleur de l'état. Le chiffre ne réagit pas au survol : il n'est pas un lien.
 * Un chiffre qui est un taux passe sa variation en points (`deltaUnite="pts"`).
 */
export function Kpi({ label, value, hint, tone = "neutral", delta, deltaUnite, inverse, serie }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; delta?: number | null; deltaUnite?: UniteDelta; inverse?: boolean; serie?: number[] }) {
  const tendance = serie?.filter((v) => Number.isFinite(v)) ?? [];
  const grave = tendance.length >= 2;
  return (
    <div className={cx(FEUILLE, "n-kpi kpi relative isolate min-w-0 overflow-hidden px-5 pb-4 pt-4")}>
      {!grave && <Ondes graine={label} className="kpi-ondes pointer-events-none absolute -bottom-2 right-0 -z-10 h-[74px] w-[78%] max-w-[300px] text-or" />}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[13px] font-medium leading-snug text-ink-2">{label}</div>
        {(tone === "ok" || tone === "warn" || tone === "danger") && <Sceau tone={tone} />}
      </div>
      <div className={cx("mt-3 font-display text-[30px] font-[650] leading-none tracking-[-0.03em]", tone === "danger" ? "text-danger" : "text-ink")}>
        <Valeur value={value} />
      </div>
      {(hint || delta !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-snug text-muted">
          {delta !== undefined && <Delta value={delta} inverse={inverse} unite={deltaUnite} />}
          {hint && <span className="min-w-0">{hint}</span>}
        </div>
      )}
      {grave && <GravureTendance valeurs={tendance} />}
    </div>
  );
}

/**
 * Tampon d'état : rayon de 4 px, filet de 1 px à la couleur de l'état, le mot sans point. Plein
 * (fond doux) pour ce qui demande une action, au trait pour le reste. Le ton « accent » ne dit pas
 * d'état : il s'écrit à l'encre, au trait.
 */
const TAMPON: Record<Tone, string> = {
  neutral: "border-muted/45 text-ink-2",
  ok: "border-ok/55 text-ok-texte",
  warn: "border-warn/45 bg-warn-doux text-warn",
  danger: "border-danger/40 bg-danger-doux text-danger",
  accent: "border-ink/40 text-ink",
};

/**
 * Tampon d'état : le mot dit l'état, la couleur et le plein l'appuient (charte, « États »).
 * `vivant` fait battre le tampon trois fois, pour le seul état vivant d'un écran.
 */
export function Badge({ tone = "neutral", children, vivant }: { tone?: Tone; children: ReactNode; vivant?: boolean }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-[4px] border px-2 py-[2px] text-[12px] font-semibold leading-4", TAMPON[tone], tamponPlein(tone) ? "tampon-plein" : "tampon-trait", vivant && "tampon-vivant")}>
      {children}
    </span>
  );
}

/** Étiquette neutre (profil, catégorie). */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center whitespace-nowrap rounded-md bg-panel-3 px-2 py-0.5 text-[12px] font-medium text-ink-2">{children}</span>;
}

/* ─── Contrôles ────────────────────────────────────────────────────────── */

/**
 * Les classes passées par un écran l'emportent sur celles du composant pour la taille du texte, la
 * hauteur minimale et les marges intérieures ; sans cela, l'ordre du CSS généré déciderait seul.
 */
const GROUPES = [/^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d[^\]]*\])$/, /^min-h-/, /^px-/, /^py-/, /^w-/];

function ajuste(base: string, extra?: string): string {
  if (!extra) return base;
  const ajout = extra.split(/\s+/).filter(Boolean);
  const garde = base.split(/\s+/).filter((c) => !GROUPES.some((g) => g.test(c) && ajout.some((a) => g.test(a))));
  return [...garde, ...ajout].join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink shadow-[0_8px_18px_-10px_var(--accent-lueur)] hover:bg-accent-strong hover:shadow-[0_12px_24px_-10px_var(--accent-lueur)]",
  secondary: "border border-line bg-panel text-ink shadow-[0_1px_2px_rgb(16_36_31/0.05)] hover:border-line-strong hover:bg-panel-2",
  ghost: "text-ink-2 hover:bg-panel-3 hover:text-ink",
  danger: "border border-danger/30 bg-panel text-danger hover:border-danger hover:bg-danger hover:text-white",
};

export type ButtonSize = "sm" | "md" | "lg";

/** Tailles : 32 px dans une ligne de tableau ou une barre d'outils, 36 px par défaut, 44 px au toucher. */
const TAILLE: Record<ButtonSize, string> = {
  sm: "min-h-8 gap-1.5 px-2.5 py-1 text-[13px]",
  md: "min-h-9 gap-2 px-3.5 py-1.5 text-sm",
  lg: "min-h-11 gap-2 px-4 py-2 text-[15px]",
};

/** Classes d'un bouton, pour un lien qui doit en avoir l'allure (page d'erreur, raccourcis). */
export function classesBouton(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return ajuste(
    cx(
      "inline-flex items-center justify-center whitespace-nowrap rounded-[10px] font-semibold transition-[transform,box-shadow,background-color,border-color,color,filter] duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:scale-100",
      TAILLE[size],
      BUTTON[variant],
    ),
    className,
  );
}

export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button type="button" {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={classesBouton(variant, size, className)}>
      {loading && <Loader2 className={size === "sm" ? "h-3.5 w-3.5 animate-spin" : "h-4 w-4 animate-spin"} />}
      {children}
    </button>
  );
}

const FIELD =
  "w-full rounded-[10px] border border-line-champ bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted outline-none transition-[border-color,box-shadow] duration-200 hover:border-ink-2 focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-muted";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={ajuste(cx(FIELD, "min-h-9"), props.className)} />;
}

/** Mot de passe avec l'œil : un clic l'affiche en clair pour vérifier la saisie, un second le masque. */
export function PasswordInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const Oeil = visible ? EyeOff : Eye;
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cx(className, "pr-10")} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        aria-pressed={visible}
        title={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[10px] text-muted outline-none transition-colors hover:text-ink focus-visible:text-accent disabled:pointer-events-none"
      >
        <Oeil className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={ajuste(cx(FIELD, "min-h-[84px] leading-relaxed"), props.className)} />;
}

export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string | number; label: string }>; placeholder?: string }) {
  return (
    <select {...props} className={ajuste(cx(FIELD, "champ-liste min-h-9"), props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-[12px] leading-snug text-muted">{hint}</span>}
      {error && <span className="mt-1.5 block text-[12px] font-medium leading-snug text-danger">{error}</span>}
    </label>
  );
}

/**
 * Bascule à curseur glissant (périmètre, période) : le repère glisse sous l'option choisie.
 */
export function Segmented<K extends string>({ options, value, onChange, label, className }: { options: Array<{ key: K; label: string }>; value: K; onChange: (k: K) => void; label?: string; className?: string }) {
  const boite = useRef<HTMLDivElement>(null);
  const [repere, setRepere] = useState<{ x: number; w: number } | null>(null);
  const mesurer = useCallback(() => {
    const el = boite.current?.querySelector<HTMLElement>(`[data-cle="${CSS.escape(value)}"]`);
    if (el) setRepere({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);
  useEffect(() => {
    mesurer();
    const el = boite.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mesurer]);
  return (
    <div ref={boite} role="group" aria-label={label} className={cx("relative inline-flex rounded-xl border border-line bg-panel-2 p-1", className)}>
      {repere && <span aria-hidden className="n-repere absolute inset-y-1 left-0 rounded-[9px] bg-panel shadow-[0_1px_3px_rgb(16_36_31/0.12),0_0_0_1px_rgb(16_36_31/0.04)]" style={{ transform: `translateX(${repere.x}px)`, width: repere.w }} />}
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          data-cle={o.key}
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={cx("relative z-[1] rounded-[9px] px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200", o.key === value ? "text-ink" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─── États ────────────────────────────────────────────────────────────── */

/** Chargement : un libellé qui dit ce qui charge et le squelette du contenu attendu. */
export function Loading({ label = "Chargement des données…" }: { label?: string }) {
  return (
    <div role="status" className="px-5 py-8">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="n-tourne h-4 w-4 rounded-full border-2 border-accent-vif/25 border-t-accent-vif" />
        <span className="text-[13px] font-medium text-muted">{label}</span>
      </div>
      <div aria-hidden className="mt-5 space-y-3">
        <div className="n-squelette h-3 w-[72%] rounded-full" />
        <div className="n-squelette h-3 w-[88%] rounded-full" />
        <div className="n-squelette h-3 w-[54%] rounded-full" />
      </div>
    </div>
  );
}

/** Squelette d'un bloc (carte de chiffre, graphique) pendant le chargement. */
export function Squelette({ className }: { className?: string }) {
  return <div aria-hidden className={cx("n-squelette rounded-2xl", className)} />;
}

/** Erreur d'un appel, avec « Réessayer ». `titre` dit d'abord ce que l'échec laisse à l'écran. */
export function ErrorBox({ error, onRetry, titre }: { error: unknown; onRetry?: () => void; titre?: ReactNode }) {
  const message = error instanceof Error ? error.message : "Une erreur est survenue.";
  return (
    <div role="alert" className="n-surgir flex items-start gap-3 rounded-xl border border-danger/15 bg-danger-doux px-4 py-3 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
      <div className="flex-1">
        {titre && <div className="font-semibold">{titre}</div>}
        {message}
      </div>
      {onRetry && (
        <button type="button" onClick={() => onRetry()} className="font-semibold underline underline-offset-2">
          Réessayer
        </button>
      )}
    </div>
  );
}

/**
 * État d'un appel d'API : chargement tant que `data` n'est pas arrivé, erreur avec « Réessayer »
 * si l'appel a échoué, état vide pour une liste sans ligne, sinon le contenu. Sans enfant, il tient
 * lieu de retour anticipé : `if (!data) return <Etat error={error} onRetry={() => mutate()} />`.
 */
export function Etat<T>({ data, error, onRetry, label, vide, children }: { data?: T; error?: unknown; onRetry?: () => void; label?: string; vide?: string | { title: string; hint?: string }; children?: ReactNode | ((data: T) => ReactNode) }) {
  if (data === undefined) return error ? <ErrorBox error={error} onRetry={onRetry} /> : <Loading label={label} />;
  if (vide && Array.isArray(data) && data.length === 0) {
    const v = typeof vide === "string" ? { title: vide } : vide;
    return <Empty title={v.title} hint={v.hint} />;
  }
  const contenu = typeof children === "function" ? children(data) : children;
  // Données déjà là mais rechargement en échec : l'erreur s'affiche au-dessus des dernières valeurs.
  if (!error) return <>{contenu}</>;
  return (
    <>
      <div className="mb-4">
        <ErrorBox error={error} onRetry={onRetry} />
      </div>
      {contenu}
    </>
  );
}

/** État vide : trois cartes empilées aux couleurs de l'application, et ce qu'il faut faire. */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <svg viewBox="0 0 64 48" className="mb-2 h-12 w-16" aria-hidden focusable="false">
        <rect x="14" y="4" width="36" height="26" rx="6" fill="var(--accent-doux)" />
        <rect x="8" y="12" width="48" height="30" rx="7" fill="var(--panel)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <path d="M17 24h18M17 31h28" stroke="var(--accent-vif)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="47" cy="24" r="3" fill="var(--n-or)" />
      </svg>
      <div className="text-sm font-semibold text-ink-2">{title}</div>
      {hint && <div className="max-w-md text-[13px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

const NOTICE: Record<Tone, string> = {
  neutral: "border-line bg-panel-2 text-ink-2",
  ok: "border-ok/15 bg-ok-doux text-ink",
  warn: "border-warn/15 bg-warn-doux text-ink",
  danger: "border-danger/15 bg-danger-doux text-danger",
  accent: "border-accent/15 bg-accent-doux text-ink",
};

const NOTICE_ICON: Record<Tone, string> = {
  neutral: "text-muted",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent",
};

export function Notice({ tone = "accent", children }: { tone?: Tone; children: ReactNode }) {
  const I = tone === "warn" || tone === "danger" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("n-surgir flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed", NOTICE[tone])}>
      <I className={cx("mt-[3px] h-4 w-4 flex-none", NOTICE_ICON[tone])} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ─── Tableau ──────────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, footer, onRowClick, empty = "Aucune donnée.", dense }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T, index: number) => string | number; footer?: ReactNode; onRowClick?: (row: T) => void; empty?: string; dense?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const value = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[col.key] as string | number | null);
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va > vb ? 1 : -1) * sort.dir;
    });
  }, [rows, sort, columns]);

  if (!rows.length) return <Empty title={empty} />;
  const pad = dense ? "px-3 py-1.5" : "px-3 py-3";
  const alignOf = (c: Column<T>) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left");
  const onKey = (row: T) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    // Seule la ligne elle-même réagit : un bouton ou un champ de la ligne garde sa touche Entrée.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row);
    }
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px]">
        <thead>
          <tr className="border-y border-line bg-panel-2">
            {columns.map((c) => {
              // Colonne sans titre (cases, actions) : rien à trier.
              if (!c.label) return <th key={c.key} scope="col" className={cx(dense ? "px-3 py-2" : "px-3 py-2.5", "first:pl-5 last:pr-5")} />;
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined} className={cx(dense ? "px-3 py-2" : "px-3 py-2.5", "whitespace-nowrap font-medium first:pl-5 last:pr-5", alignOf(c))}>
                  <button
                    type="button"
                    onClick={() => setSort(active ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}
                    className={cx("group inline-flex items-center gap-1 rounded text-[12.5px] font-semibold transition-colors hover:text-ink", c.align === "right" && "flex-row-reverse", active ? "text-accent" : "text-muted")}
                  >
                    {c.label}
                    <span aria-hidden className={cx("inline-flex transition-opacity", !active && "opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60")}>
                      {active && sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="tabular">
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? onKey(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cx("n-ligne border-b border-line/80 transition-colors last:border-0", onRowClick ? "cursor-pointer outline-offset-[-2px] hover:bg-accent-doux/45" : "hover:bg-panel-2/70")}
              style={i < 18 ? { animationDelay: `${i * 22}ms` } : { animation: "none" }}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx(pad, "first:pl-5 last:pr-5", alignOf(c), c.align === "right" && "whitespace-nowrap font-mono", c.className)}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "–")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="tabular border-t border-line bg-panel-2 font-semibold [&_td:first-child]:pl-5 [&_td:last-child]:pr-5">{footer}</tfoot>}
      </table>
    </div>
  );
}

/**
 * Étapes d'un parcours (gates d'un dossier) : franchies, en cours, à venir. Ici les numéros ont
 * un sens, ils donnent l'ordre du parcours. L'étape en cours bat doucement.
 */
export function Etapes({ steps }: { steps: Array<{ key: string; label: string; state: "done" | "current" | "todo"; title?: string }> }) {
  return (
    <ol className="grid gap-3 sm:flex sm:gap-0">
      {steps.map((s, i) => (
        <li key={s.key} title={s.title} className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:items-start sm:gap-2.5">
          <div className="flex items-center sm:w-full">
            <span
              className={cx(
                "grid h-8 w-8 flex-none place-items-center rounded-full text-[13px] font-bold tabular",
                s.state === "done" ? "bg-accent text-accent-ink shadow-[0_6px_14px_-8px_var(--accent-lueur)]" : s.state === "current" ? "n-pouls bg-or text-foret" : "border-2 border-line-strong/70 bg-panel text-muted",
              )}
              style={s.state === "current" ? ({ "--pouls": "rgb(211 170 91 / 0.55)" } as CSSProperties) : undefined}
            >
              {s.state === "done" ? <Check className="h-4 w-4" strokeWidth={2.4} /> : i + 1}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden className="relative mx-2 hidden h-[3px] flex-1 overflow-hidden rounded-full bg-line sm:block">
                {s.state === "done" && <span className="n-pousser-x absolute inset-0 rounded-full bg-accent-vif" style={{ "--i": i } as CSSProperties} />}
              </span>
            )}
          </div>
          <span className={cx("text-[13px] leading-snug sm:pr-4", s.state === "current" ? "font-semibold text-ink" : s.state === "done" ? "text-ink-2" : "text-muted")}>
            {s.label}
            {s.state === "current" && <span className="sr-only"> (étape en cours)</span>}
            {s.state === "done" && <span className="sr-only"> (franchie)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Bouton d'envoi de fichier : un libellé qui ouvre le sélecteur, à l'allure d'un bouton secondaire. */
export function FileButton({ label, accept, onFile, small }: { label: string; accept?: string; onFile: (file: File) => void; small?: boolean }) {
  return (
    <label className={classesBouton("secondary", small ? "sm" : "md", "relative cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-vif")}>
      <FileUpIcon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {label}
      <input type="file" className="sr-only" accept={accept} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
}

/* ─── Onglets et fenêtres ──────────────────────────────────────────────── */

/** Onglets soulignés : le trait glisse sous l'onglet choisi. */
export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: Array<{ key: K; label: string; count?: number }>; value: K; onChange: (key: K) => void }) {
  const boite = useRef<HTMLDivElement>(null);
  const [trait, setTrait] = useState<{ x: number; y: number; w: number } | null>(null);
  const mesurer = useCallback(() => {
    const el = boite.current?.querySelector<HTMLElement>(`[data-cle="${CSS.escape(value)}"]`);
    if (el) setTrait({ x: el.offsetLeft, y: el.offsetTop + el.offsetHeight - 2, w: el.offsetWidth });
  }, [value]);
  useEffect(() => {
    mesurer();
    const el = boite.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    el.querySelectorAll("button").forEach((b) => ro.observe(b));
    void document.fonts?.ready.then(mesurer);
    return () => ro.disconnect();
  }, [mesurer]);
  return (
    <div ref={boite} className="no-print relative mb-5 flex flex-wrap gap-x-6 border-b border-line">
      {tabs.map((t) => {
        const actif = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            data-cle={t.key}
            aria-pressed={actif}
            onClick={() => onChange(t.key)}
            className={cx("inline-flex items-center gap-1.5 py-3 text-sm font-semibold transition-colors", actif ? "text-ink" : "text-muted hover:text-ink")}
          >
            {t.label}
            {t.count !== undefined && <span className={cx("rounded-full px-1.5 py-px text-[11.5px] font-semibold tabular transition-colors", actif ? "bg-accent-doux text-accent" : "bg-panel-3 text-muted")}>{t.count}</span>}
          </button>
        );
      })}
      {trait && <span aria-hidden className="n-repere absolute left-0 top-0 h-[3px] rounded-full bg-accent-vif" style={{ transform: `translate(${trait.x}px, ${trait.y}px)`, width: trait.w }} />}
    </div>
  );
}

/** Fenêtres ouvertes, de la plus ancienne à la plus récente : seule la dernière répond à Échap. */
const PILE: string[] = [];

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const fenetre = useRef<HTMLDivElement>(null);
  const titreId = useId();
  // onClose change à chaque rendu de l'écran : lu par référence, il ne relance pas l'effet (qui
  // reprendrait le focus à chaque frappe).
  const fermer = useRef(onClose);
  useEffect(() => {
    fermer.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const avant = document.activeElement as HTMLElement | null;
    const boite = fenetre.current;
    // Le premier champ prend le focus ; à défaut, la fenêtre elle-même.
    const premier = boite?.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])");
    (premier ?? boite)?.focus();
    PILE.push(titreId);
    const onKey = (e: globalThis.KeyboardEvent) => {
      // Une confirmation ouverte par-dessus une fenêtre garde les touches pour elle.
      if (PILE[PILE.length - 1] !== titreId) return;
      if (e.key === "Escape") fermer.current();
      if (e.key !== "Tab" || !boite) return;
      const cibles = [...boite.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const debut = cibles[0];
      const fin = cibles[cibles.length - 1];
      if (!debut || !fin) return;
      if (e.shiftKey && (document.activeElement === debut || document.activeElement === boite)) {
        e.preventDefault();
        fin.focus();
      } else if (!e.shiftKey && document.activeElement === fin) {
        e.preventDefault();
        debut.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      PILE.splice(PILE.indexOf(titreId), 1);
      if (avant?.isConnected) avant.focus();
    };
  }, [open, titreId]);
  if (!open) return null;
  return (
    <div className="n-apparaitre fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foret/45 p-4 md:p-10">
      <div ref={fenetre} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titreId} className={cx(PANNEAU, "n-surgir w-full outline-none", wide ? "max-w-4xl" : "max-w-lg")}>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id={titreId} className="text-[19px] font-semibold leading-snug text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="-mr-1 grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-panel-3 hover:text-ink" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children != null && children !== false && <div className="p-5">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t border-line bg-panel-2 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

export interface OptionsConfirmation {
  /** Titre de la fenêtre ; à défaut, la question jusqu'à son premier point d'interrogation. */
  titre?: string;
  /** Libellé du bouton qui confirme (« Supprimer », « Publier ») ; « Confirmer » à défaut. */
  action?: string;
  /** Action destructrice ou irréversible : le bouton passe en rouge. */
  danger?: boolean;
}

/** Fenêtre de confirmation : la question, « Annuler » et le bouton de l'action. */
export function Confirmation({ open, question, titre, action = "Confirmer", danger, onConfirm, onCancel }: OptionsConfirmation & { open: boolean; question: string; onConfirm: () => void; onCancel: () => void }) {
  const fin = question.indexOf("?");
  const entete = titre ?? (fin >= 0 ? question.slice(0, fin + 1) : question);
  const corps = titre ? question : fin >= 0 ? question.slice(fin + 1).trim() : "";
  return (
    <Modal
      open={open}
      title={entete}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Annuler</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {action}
          </Button>
        </>
      }
    >
      {corps ? <p className="text-sm leading-relaxed text-ink-2">{corps}</p> : undefined}
    </Modal>
  );
}

/**
 * Demande une confirmation dans une fenêtre NIMOVA, à la place de `window.confirm`, et rend la
 * réponse. La fenêtre prend l'application et le thème de l'élément qui a déclenché la demande.
 */
export function demanderConfirmation(question: string, options: OptionsConfirmation = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const origine = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    const hote = document.createElement("div");
    const app = origine.closest("[data-app]")?.getAttribute("data-app");
    const theme = origine.closest("[data-theme]")?.getAttribute("data-theme");
    if (app) hote.dataset.app = app;
    if (theme) hote.dataset.theme = theme;
    document.body.appendChild(hote);
    const racine = createRoot(hote);
    let repondu = false;
    const repondre = (oui: boolean) => {
      if (repondu) return;
      repondu = true;
      resolve(oui);
      // Démontée après l'événement en cours : React ne retire pas une racine pendant qu'il la traite.
      setTimeout(() => {
        racine.unmount();
        hote.remove();
      });
    };
    racine.render(<Confirmation open question={question} {...options} onConfirm={() => repondre(true)} onCancel={() => repondre(false)} />);
  });
}

/* ─── Chiffres et graphiques (SVG et HTML, sans dépendance) ─────────────── */

/**
 * Compteur : un montant affiché chiffre par chiffre, comme sur le compteur volumétrique d'une
 * citerne. Les rouleaux tournent au premier affichage (sauf mouvement réduit ou économie de
 * données). Chaque rouleau porte sa position finale (--chiffre) : l'impression, une capture et le
 * lecteur d'écran lisent toujours le montant juste. Un seul compteur par écran : c'est le chiffre
 * que l'écran met en avant.
 */
export function Compteur({ value, unit = "GNF", className }: { value: number; unit?: string; className?: string }) {
  const econome = useEconomieDonnees();
  const n = Math.round(value);
  const digits = Math.abs(n).toString();
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  let rang = 0;
  return (
    <span className={cx("compteur", econome && "compteur-fixe", className)}>
      <span className="sr-only">{`${n < 0 ? "moins " : ""}${new Intl.NumberFormat("fr-FR").format(Math.abs(n))} ${unit}`}</span>
      {n < 0 && (
        <span aria-hidden className="compteur-signe">
          −
        </span>
      )}
      {groups.map((group, g) => (
        <span key={g} aria-hidden className="compteur-groupe">
          {group.split("").map((d, i) => (
            <span key={i} className="compteur-case">
              <span className="compteur-rouleau" style={{ "--chiffre": Number(d), "--rang": rang++ } as CSSProperties}>
                {"0123456789".split("").map((k) => (
                  <span key={k}>{k}</span>
                ))}
              </span>
            </span>
          ))}
        </span>
      ))}
      {unit && (
        <span aria-hidden className="compteur-unite ml-[0.14em] self-end font-sans text-[0.32em] font-semibold tracking-[0.02em] text-muted">
          {unit}
        </span>
      )}
    </span>
  );
}

/** Info-bulle d'un graphique : carte blanche, libellé puis valeurs. */
function Bulle({ titre, lignes, className, style }: { titre: string; lignes: Array<{ couleur?: string; nom?: string; valeur: string }>; className?: string; style?: CSSProperties }) {
  return (
    <span className={cx("pointer-events-none absolute z-20 min-w-[132px] whitespace-nowrap rounded-xl border border-line bg-panel px-3 py-2 text-left shadow-[var(--ombre-flottante)]", className)} style={style}>
      <span className="block text-[11.5px] font-semibold text-muted">{titre}</span>
      {lignes.map((l, i) => (
        <span key={i} className="mt-1 flex items-center gap-2 text-[12.5px]">
          {l.couleur && <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: l.couleur }} />}
          {l.nom && <span className="text-ink-2">{l.nom}</span>}
          <span className="ml-auto pl-2 font-semibold tabular text-ink">{l.valeur}</span>
        </span>
      ))}
    </span>
  );
}

/** Graduations « rondes » d'un axe (1, 2 ou 5 fois une puissance de dix). */
function graduations(min: number, max: number, nombre = 4): number[] {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 1;
  const brut = (hi - lo) / nombre;
  const ordre = 10 ** Math.floor(Math.log10(brut));
  const r = brut / ordre;
  const pas = Math.max(1, (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * ordre);
  lo = Math.floor(lo / pas) * pas;
  hi = Math.ceil(hi / pas) * pas;
  const t: number[] = [];
  for (let v = lo; v <= hi + pas / 2; v += pas) t.push(Math.round(v / pas) * pas);
  return t;
}

/** Coordonnée arrondie au centième, pour des tracés SVG courts. */
const arrondi = (v: number) => Math.round(v * 100) / 100;

/** Pentes de Fritsch-Carlson en chaque point : la courbe reste monotone entre deux valeurs. */
function pentes(points: Array<[number, number]>): number[] {
  const n = points.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    dx.push(x1 - x0);
    m.push((y1 - y0) / (x1 - x0 || 1));
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = m[i - 1]!;
    const b = m[i]!;
    if (a * b <= 0) t.push(0);
    else {
      const w1 = 2 * dx[i]! + dx[i - 1]!;
      const w2 = dx[i]! + 2 * dx[i - 1]!;
      t.push((w1 + w2) / (w1 / a + w2 / b));
    }
  }
  t.push(m[n - 2]!);
  return t;
}

/** Tronçons de Bézier de la courbe monotone, un par intervalle (« C… »), sans le point de départ. */
function troncons(points: Array<[number, number]>): string[] {
  const n = points.length;
  if (n < 2) return [];
  const t = pentes(points);
  const liste: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const h = x1 - x0;
    liste.push(` C${arrondi(x0 + h / 3)},${arrondi(y0 + (t[i]! * h) / 3)} ${arrondi(x1 - h / 3)},${arrondi(y1 - (t[i + 1]! * h) / 3)} ${arrondi(x1)},${arrondi(y1)}`);
  }
  return liste;
}

/** Courbe monotone (Fritsch-Carlson) : lisse, sans dépasser les valeurs réelles. */
function courbe(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  const [x0, y0] = points[0]!;
  return `M${arrondi(x0)},${arrondi(y0)}${troncons(points).join("")}`;
}

/** La même courbe monotone, lue en un point quelconque (x croissants, deux points au moins). */
function hermite(points: Array<[number, number]>): (x: number) => number {
  const t = pentes(points);
  return (x) => {
    let i = 0;
    while (i < points.length - 2 && x > points[i + 1]![0]) i++;
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1] ?? points[i]!;
    const h = x1 - x0 || 1;
    const s = Math.min(1, Math.max(0, (x - x0) / h));
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * t[i]! + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * (t[i + 1] ?? 0);
  };
}

/**
 * Courbes d'une ou plusieurs séries sur un même axe (jamais deux échelles) : tracé animé, aire en
 * dégradé sous la première série, réticule et info-bulle au survol comme au clavier (flèches).
 * Avec deux séries ou plus, la légende permet de masquer une série. `enCours` : la dernière période
 * n'est pas close (mois en cours) ; son tronçon se trace en pointillé et son point est creux, pour
 * qu'une fin de mois partielle ne se lise pas comme une chute.
 */
export function AreaChart({ labels, series, height = 220, format, formatAxis, label, enCours }: { labels: string[]; series: Array<{ key: string; label: string; values: number[]; color: string }>; height?: number; format?: (v: number) => string; formatAxis?: (v: number) => string; label?: string; enCours?: boolean }) {
  const id = useId().replace(/:/g, "");
  const [masque, setMasque] = useState<string[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const show = format ?? ((v: number) => fmtShort(v));
  const axe = formatAxis ?? ((v: number) => fmtAxe(v));
  const partiel = Boolean(enCours) && labels.length >= 2;
  const periode = (i: number) => `${labels[i] ?? ""}${partiel && i === labels.length - 1 ? " (en cours)" : ""}`;
  const visibles = series.filter((s) => !masque.includes(s.key));
  const n = labels.length;
  const toutes = visibles.flatMap((s) => s.values);
  const ticks = graduations(Math.min(0, ...toutes), Math.max(0, ...toutes));
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const W = 1000;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => height - ((v - lo) / (hi - lo || 1)) * height;
  const pct = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const zero = y(0);

  function survol(clientX: number) {
    const r = zone.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setFocus(Math.round(ratio * (n - 1)));
  }

  function clavier(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setFocus((f) => {
        const base = f ?? n - 1;
        return Math.min(n - 1, Math.max(0, base + (e.key === "ArrowRight" ? 1 : -1)));
      });
    }
  }

  const pasEtiquette = n > 12 ? Math.ceil(n / 8) : 1;
  return (
    <div>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {series.map((s) => {
            const actif = !masque.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={actif}
                onClick={() => setMasque((m) => (actif ? (visibles.length > 1 ? [...m, s.key] : m) : m.filter((k) => k !== s.key)))}
                className={cx("inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-all", actif ? "border-line bg-panel text-ink-2" : "border-dashed border-line-strong/70 bg-transparent text-muted line-through")}
              >
                <span aria-hidden className="h-2.5 w-2.5 rounded-full transition-transform" style={{ background: s.color, transform: actif ? "scale(1)" : "scale(0.6)" }} />
                {s.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <div aria-hidden className="relative w-12 flex-none" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] tabular text-muted" style={{ top: y(t) }}>
              {axe(t)}
            </span>
          ))}
        </div>
        <div
          ref={zone}
          tabIndex={0}
          role="img"
          aria-label={label ?? `Graphique : ${series.map((s) => s.label).join(", ")}`}
          onPointerMove={(e) => survol(e.clientX)}
          onPointerLeave={() => setFocus(null)}
          onFocus={() => setFocus((f) => f ?? n - 1)}
          onBlur={() => setFocus(null)}
          onKeyDown={clavier}
          className="relative min-w-0 flex-1 rounded-md outline-offset-4"
          style={{ height }}
        >
          <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden focusable="false">
            <defs>
              {visibles.map((s) => (
                <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--line-strong)" : "var(--line)"} strokeDasharray={t === 0 ? undefined : "4 6"} vectorEffect="non-scaling-stroke" />
            ))}
            {visibles.map((s, k) => {
              const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
              const d = courbe(pts);
              const aire = pts.length ? `${d} L${x(pts.length - 1)},${zero} L${x(0)},${zero} Z` : "";
              // Période en cours : le tracé plein s'arrête à la dernière période close, la suite en pointillé.
              const coupe = partiel && pts.length === n && n >= 2;
              const segments = coupe ? troncons(pts) : [];
              const plein = coupe ? `M${arrondi(pts[0]![0])},${arrondi(pts[0]![1])}${segments.slice(0, -1).join("")}` : d;
              const pointille = coupe ? `M${arrondi(pts[n - 2]![0])},${arrondi(pts[n - 2]![1])}${segments[n - 2] ?? ""}` : "";
              return (
                <g key={s.key}>
                  {k === 0 && <path d={aire} fill={`url(#${id}-${s.key})`} className="n-apparaitre" style={{ animationDuration: "1200ms" }} />}
                  <path d={plein} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="n-tracer" style={{ "--retard": `${150 + k * 180}ms` } as CSSProperties} />
                  {coupe && <path d={pointille} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" strokeDasharray="5 6" vectorEffect="non-scaling-stroke" className="n-apparaitre" style={{ animationDelay: `${900 + k * 180}ms` }} />}
                </g>
              );
            })}
          </svg>
          {partiel &&
            visibles.map((s, k) => {
              const v = s.values[n - 1];
              if (v === undefined || s.values.length !== n || focus === n - 1) return null;
              return <span key={s.key} aria-hidden className="n-apparaitre pointer-events-none absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-panel" style={{ left: "100%", top: `${(y(v) / height) * 100}%`, borderColor: s.color, animationDelay: `${900 + k * 180}ms` }} />;
            })}
          {focus !== null && n > 0 && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-ink/35" style={{ left: `${pct(focus)}%` }} />
              {visibles.map((s) => {
                const v = s.values[focus];
                if (v === undefined) return null;
                return <span key={s.key} aria-hidden className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel shadow-[0_1px_4px_rgb(16_36_31/0.3)]" style={{ left: `${pct(focus)}%`, top: (y(v) / height) * 100 + "%", background: s.color }} />;
              })}
              <Bulle
                titre={periode(focus)}
                lignes={visibles.map((s) => ({ couleur: s.color, nom: visibles.length > 1 ? s.label : undefined, valeur: show(s.values[focus] ?? 0) }))}
                className="top-1"
                style={pct(focus) > 62 ? { right: `calc(${100 - pct(focus)}% + 14px)` } : { left: `calc(${pct(focus)}% + 14px)` }}
              />
            </>
          )}
        </div>
      </div>
      <div aria-hidden className="relative ml-14 mt-2 h-4">
        {labels.map((l, i) =>
          i % pasEtiquette === 0 || i === n - 1 ? (
            <span key={`${l}-${i}`} className={cx("absolute -translate-x-1/2 whitespace-nowrap text-[11px] transition-colors", focus === i ? "font-semibold text-ink" : "text-muted", n > 6 && i % 2 === 1 && i !== n - 1 && focus !== i && "max-sm:hidden")} style={{ left: `${pct(i)}%` }}>
              {l}
            </span>
          ) : null,
        )}
      </div>
      <table className="sr-only">
        <caption>{label ?? "Données du graphique"}</caption>
        <thead>
          <tr>
            <th scope="col">Période</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}-${i}`}>
              <th scope="row">{periode(i)}</th>
              {series.map((s) => (
                <td key={s.key}>{show(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Colonnes d'une série : barres pleines de la couleur de l'application, extrémité arrondie,
 * valeurs négatives sous la ligne de base, poussée animée, info-bulle au survol et au clavier.
 */
export function BarChart({ data, height = 190, format }: { data: Array<{ label: string; value: number; tone?: Tone }>; height?: number; format?: (v: number) => string }) {
  const [focus, setFocus] = useState<number | null>(null);
  const show = format ?? ((v: number) => String(v));
  const ticks = graduations(Math.min(0, ...data.map((d) => d.value)), Math.max(0, ...data.map((d) => d.value)), 3);
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const span = hi - lo || 1;
  const base = (hi / span) * 100;
  const last = data.length - 1;
  return (
    <div className="flex gap-2">
      <div aria-hidden className="relative w-12 flex-none" style={{ height }}>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] tabular text-muted" style={{ top: `${((hi - t) / span) * 100}%` }}>
            {fmtAxe(t)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative flex gap-[6px]" style={{ height }}>
          {ticks.map((t) => (
            <div key={t} aria-hidden className={cx("pointer-events-none absolute inset-x-0 border-t", t === 0 ? "border-line-strong" : "border-dashed border-line")} style={{ top: `${((hi - t) / span) * 100}%` }} />
          ))}
          {data.map((d, i) => {
            const h = (Math.abs(d.value) / span) * 100;
            const negative = d.value < 0;
            const couleur = negative ? "var(--danger)" : d.tone === "accent" ? "var(--or-fonce)" : "var(--accent)";
            return (
              <div
                key={`${d.label}-${i}`}
                tabIndex={0}
                role="img"
                aria-label={`${d.label} : ${show(d.value)}`}
                onPointerEnter={() => setFocus(i)}
                onPointerLeave={() => setFocus(null)}
                onFocus={() => setFocus(i)}
                onBlur={() => setFocus(null)}
                className="relative flex min-w-0 flex-1 justify-center rounded-md outline-offset-2"
              >
                <div
                  className={cx("absolute w-full max-w-7 transition-[opacity,filter] duration-200", negative ? "n-pousser-y-bas rounded-b-[6px]" : "n-pousser-y rounded-t-[6px]", focus !== null && focus !== i ? "opacity-40" : "opacity-100", focus === i && "brightness-110")}
                  style={
                    {
                      top: negative ? `${base}%` : undefined,
                      bottom: negative ? undefined : `${100 - base}%`,
                      height: `${Math.max(h, 0.8)}%`,
                      background: couleur,
                      "--i": i,
                    } as CSSProperties
                  }
                />
                {i === last && focus === null && (
                  <span aria-hidden className="absolute whitespace-nowrap pb-1 text-[11.5px] font-semibold tabular text-ink" style={negative ? { top: `calc(${base + h}% + 4px)` } : { bottom: `${100 - base + h}%` }}>
                    {fmtShort(d.value)}
                  </span>
                )}
                {focus === i && <Bulle titre={d.label} lignes={[{ couleur, valeur: show(d.value) }]} className="bottom-full mb-2 left-1/2 -translate-x-1/2" />}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-[6px]">
          {data.map((d, i) => (
            <span key={`${d.label}-${i}`} className={cx("min-w-0 flex-1 truncate text-center text-[11px] transition-colors", focus === i ? "font-semibold text-ink" : "text-muted")}>
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const METER: Record<Tone, [string, string]> = {
  neutral: ["var(--panel-3)", "var(--accent)"],
  ok: ["var(--ok-doux)", "var(--ok)"],
  warn: ["var(--warn-doux)", "var(--warn)"],
  danger: ["var(--danger-doux)", "var(--danger)"],
  accent: ["var(--accent-doux)", "var(--accent)"],
};

/** Jauge linéaire : le remplissage porte l'état et se remplit à l'affichage. */
export function ProgressBar({ value, tone = "accent", rayures, epaisseur = 8 }: { value: number; tone?: Tone; rayures?: boolean; epaisseur?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const [track, fill] = METER[tone];
  return (
    <div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className="w-full overflow-hidden rounded-full" style={{ background: track, height: epaisseur }}>
      <div className={cx("n-pousser-x h-full rounded-full", rayures && "n-rayures-fixes")} style={{ width: `${pct}%`, backgroundColor: fill, boxShadow: `0 0 12px -2px ${fill}` }} />
    </div>
  );
}

/**
 * Répartition d'un total en segments (six au plus), séparés par un jour de 3 px ; ils se
 * remplissent l'un après l'autre. La légende donne chaque part en toutes lettres.
 */
export function Repartition({ parts, format }: { parts: Array<{ key: string; label: string; value: number; color: string }>; format?: (v: number) => string }) {
  const [focus, setFocus] = useState<string | null>(null);
  const show = format ?? ((v: number) => String(v));
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="flex h-3.5 w-full gap-[3px]">
        {total === 0 ? (
          <div className="h-full w-full rounded-full bg-panel-3" />
        ) : (
          visible.map((p, i) => (
            <div
              key={p.key}
              tabIndex={0}
              role="img"
              aria-label={`${p.label} : ${show(p.value)}`}
              onPointerEnter={() => setFocus(p.key)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(p.key)}
              onBlur={() => setFocus(null)}
              className={cx("n-pousser-x relative h-full rounded-full outline-offset-2 transition-[opacity,transform] duration-200", focus && focus !== p.key && "opacity-40", focus === p.key && "scale-y-125")}
              style={{ width: `${(p.value / total) * 100}%`, minWidth: 6, background: p.color, "--i": i } as CSSProperties}
            >
              {focus === p.key && <Bulle titre={p.label} lignes={[{ couleur: p.color, valeur: `${show(p.value)} (${Math.round((p.value / total) * 100)} %)` }]} className="bottom-full mb-2 left-1/2 -translate-x-1/2" />}
            </div>
          ))
        )}
      </div>
      <ul className="mt-4 space-y-1">
        {parts.map((p) => (
          <li
            key={p.key}
            onPointerEnter={() => p.value > 0 && setFocus(p.key)}
            onPointerLeave={() => setFocus(null)}
            className={cx("flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors", focus === p.key && "bg-panel-2")}
          >
            <span className="flex min-w-0 items-center gap-2.5 text-ink-2">
              <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: p.color }} />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="flex items-center gap-2.5">
              <span className="font-semibold tabular text-ink">{show(p.value)}</span>
              <span className="w-11 rounded-full bg-panel-3 py-px text-center text-[11px] font-semibold tabular text-muted">{total > 0 ? `${Math.round((Math.max(0, p.value) / total) * 100)} %` : "–"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Anneau de répartition : chaque part se trace à son tour ; au survol, la part s'épaissit et le
 * centre donne son montant. La légende à côté dit tout en toutes lettres.
 */
export function Donut({ parts, format, centre, size = 160, epaisseur = 20 }: { parts: Array<{ key: string; label: string; value: number; color: string }>; format?: (v: number) => string; centre?: { titre: string; valeur: string }; size?: number; epaisseur?: number }) {
  const [focus, setFocus] = useState<string | null>(null);
  const show = format ?? ((v: number) => fmtShort(v));
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const visibles = parts.filter((p) => p.value > 0);
  const r = 50 - epaisseur / 2 - 3;
  const jour = visibles.length > 1 ? 1.4 : 0;
  let cumul = 0;
  const choisi = visibles.find((p) => p.key === focus);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden focusable="false">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--panel-3)" strokeWidth={epaisseur} />
          {total > 0 &&
            visibles.map((p, i) => {
              const part = (p.value / total) * 100;
              const longueur = Math.max(0.01, part - jour);
              const debut = cumul;
              cumul += part;
              return (
                <circle
                  key={p.key}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={p.color}
                  pathLength={100}
                  strokeWidth={focus === p.key ? epaisseur + 5 : epaisseur}
                  strokeDasharray={`${longueur} ${100 - longueur}`}
                  strokeDashoffset={-debut}
                  className={cx("n-anneau cursor-pointer transition-[stroke-width,opacity] duration-200", focus && focus !== p.key && "opacity-45")}
                  style={{ "--i": i } as CSSProperties}
                  onPointerEnter={() => setFocus(p.key)}
                  onPointerLeave={() => setFocus(null)}
                />
              );
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="max-w-[70%]">
            <div className="truncate text-[11.5px] font-medium text-muted">{choisi ? choisi.label : centre?.titre ?? "Total"}</div>
            <div className="font-display text-[19px] font-bold leading-tight tabular text-ink">{choisi ? show(choisi.value) : centre?.valeur ?? show(total)}</div>
            {choisi && total > 0 && <div className="text-[11.5px] font-semibold text-muted">{Math.round((choisi.value / total) * 100)} %</div>}
          </div>
        </div>
      </div>
      <ul className="min-w-[200px] flex-1 space-y-1">
        {parts.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onPointerEnter={() => p.value > 0 && setFocus(p.key)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => p.value > 0 && setFocus(p.key)}
              onBlur={() => setFocus(null)}
              className={cx("flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors", focus === p.key && "bg-panel-2")}
            >
              <span className="flex min-w-0 items-center gap-2.5 text-ink-2">
                <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: p.color }} />
                <span className="truncate">{p.label}</span>
              </span>
              <span className="whitespace-nowrap font-semibold tabular text-ink">{show(p.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Jauge en demi-cercle : zones colorées (insuffisant, limite, confortable), aiguille qui se pose
 * sur la valeur avec un léger rebond. Le texte sous la jauge dit la valeur et la zone.
 */
export function Gauge({ value, max, zones, format, sousTitre, vide }: { value: number | null; max: number; zones: Array<{ jusqua: number; couleur: string; label: string }>; format?: (v: number) => string; sousTitre?: string; vide?: string }) {
  const show = format ?? ((v: number) => String(v));
  const borne = (v: number) => Math.max(0, Math.min(max, v));
  const angle = (v: number) => -90 + (borne(v) / max) * 180;
  const point = (v: number, rayon: number) => {
    const a = ((angle(v) - 90) * Math.PI) / 180;
    return [100 + rayon * Math.cos(a), 100 + rayon * Math.sin(a)] as const;
  };
  const arc = (de: number, a: number, rayon: number) => {
    const [x0, y0] = point(de, rayon);
    const [x1, y1] = point(a, rayon);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${rayon},${rayon} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  let debut = 0;
  const zoneDe = value === null ? null : zones.find((z) => value < z.jusqua) ?? zones[zones.length - 1];
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 112" className="w-full max-w-[260px]" aria-hidden focusable="false">
        {zones.map((z, i) => {
          const de = debut;
          debut = Math.min(max, z.jusqua);
          const ecart = i < zones.length - 1 ? max * 0.012 : 0;
          return <path key={z.label} d={arc(de, Math.max(de, debut - ecart), 78)} fill="none" stroke={z.couleur} strokeWidth="16" strokeLinecap={i === 0 || i === zones.length - 1 ? "round" : "butt"} pathLength={1} className="n-tracer" style={{ "--retard": `${100 + i * 160}ms` } as CSSProperties} />;
        })}
        {value !== null && (
          <g className="n-aiguille" style={{ transform: `rotate(${angle(value)}deg)`, transformOrigin: "100px 100px", "--depart": "-90deg" } as CSSProperties}>
            <path d="M100 32 L104.5 100 L95.5 100 Z" fill="var(--ink)" />
          </g>
        )}
        <circle cx="100" cy="100" r="9" fill="var(--panel)" stroke="var(--ink)" strokeWidth="4" />
      </svg>
      <div className="-mt-1 text-center">
        <div className="font-display text-[30px] font-bold leading-none tabular text-ink">{value === null ? "–" : show(value)}</div>
        {value === null && vide && <div className="mt-1.5 inline-flex rounded-full bg-panel-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted">{vide}</div>}
        {zoneDe && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: zoneDe.couleur }} />
            {zoneDe.label}
          </div>
        )}
        {sousTitre && <div className="mt-1.5 text-[12px] text-muted">{sousTitre}</div>}
      </div>
    </div>
  );
}

/**
 * Classement horizontal (cinq premiers, marges par activité) : rang, libellé, barre pleine
 * texturée qui s'allonge à l'affichage, montant au bout. Une valeur négative passe au rouge.
 */
export function RankBars({ items, format, couleur = "var(--accent-vif)" }: { items: Array<{ key: string | number; label: string; value: number; detail?: string }>; format?: (v: number) => string; couleur?: string }) {
  const show = format ?? ((v: number) => fmtShort(v));
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <ol className="space-y-3">
      {items.map((item, i) => {
        const negatif = item.value < 0;
        const c = negatif ? "var(--danger-vif)" : couleur;
        return (
          <li key={item.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[13px] sm:grid-cols-[1.25rem_minmax(0,9.5rem)_minmax(0,1fr)]">
            <span className="text-right font-semibold tabular text-muted">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink-2" title={item.label}>
                {item.label}
              </span>
              {item.detail && <span className="block truncate text-[11.5px] text-muted">{item.detail}</span>}
            </span>
            <span className="col-start-2 flex min-w-0 items-center gap-2.5 sm:col-start-auto">
              <span className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-lg bg-panel-2">
                <span
                  className="n-pousser-x n-rayures-fixes absolute inset-y-0 left-0 rounded-lg"
                  style={{ width: `${Math.max(3, (Math.abs(item.value) / max) * 100)}%`, backgroundColor: c, opacity: 0.9, "--i": i } as CSSProperties}
                />
              </span>
              <span className={cx("w-[4.75rem] flex-none text-right font-semibold tabular", negatif ? "text-danger" : "text-ink")}>{show(item.value)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Anneau de progression (score sur 100, part des critères évalués) : il se remplit à l'affichage,
 * la valeur au centre défile. Sur fond sombre, `clair` passe le texte et la piste en blanc.
 */
export function Anneau({ value, max = 100, couleur = "var(--accent-vif)", taille = 120, epaisseur = 10, centre, sous, clair }: { value: number | null; max?: number; couleur?: string; taille?: number; epaisseur?: number; centre?: string; sous?: string; clair?: boolean }) {
  const r = 50 - epaisseur / 2 - 1;
  const part = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="relative flex-none" style={{ width: taille, height: taille }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden focusable="false">
        <circle cx="50" cy="50" r={r} fill="none" stroke={clair ? "rgb(255 255 255 / 0.18)" : "var(--panel-3)"} strokeWidth={epaisseur} />
        {value !== null && <circle cx="50" cy="50" r={r} fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(0.01, part)} ${100 - part}`} className="n-anneau" />}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className={cx("font-display font-bold leading-none tabular", clair ? "text-white" : "text-ink")} style={{ fontSize: taille * 0.24 }}>
            {centre ?? (value === null ? "–" : <Valeur value={String(Math.round(value))} />)}
          </div>
          {sous && <div className={cx("mt-1 text-[11.5px] font-semibold", clair ? "text-white/75" : "text-muted")}>{sous}</div>}
        </div>
      </div>
    </div>
  );
}

/** Petite courbe de tendance, sans axe ; la dernière valeur est marquée d'un point. */
export function Sparkline({ values, color = "var(--accent-vif)", height = 40 }: { values: number[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const W = 200;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, height - 4 - ((v - lo) / (hi - lo || 1)) * (height - 8)] as [number, number]);
  const d = courbe(pts);
  const dernier = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="h-10 w-full overflow-visible" aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${W},${height} L0,${height} Z`} fill={`url(#${id})`} className="n-apparaitre" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" pathLength={1} className="n-tracer" />
      <circle cx={dernier[0]} cy={dernier[1]} r="3.5" fill={color} stroke="var(--panel)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
