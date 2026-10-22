"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ClavierReact, type MouseEvent as SourisReact, type PointerEvent as PointeurReact } from "react";
import { IconeModule } from "@/components/accueil/icones-modules";
import { LogoSociete, Monogramme } from "@/components/brand";
import { Check, ChevronDown, KeyRound, LogOut, Search, X } from "@/components/icons";
import { rayonsDe, sansAccents, voisine, type Tuile } from "@/components/accueil/tuiles";
import { PANNEAU, cx, useMouvementReduit } from "@/components/ui";
import { APPS, appFromPath, type AppCode } from "@/lib/config";
import type { Me } from "@/lib/types";

/**
 * Chaque application mémorise sa société de travail : le module ouvert depuis l'accueil reçoit
 * d'abord la société affichée sur l'accueil, quand il l'accepte (AxisPro ne sert que le cabinet).
 */
async function alignerSociete(me: Me, app: AppCode, href: string) {
  const cible = appFromPath(href);
  const company = me.companies.find((c) => c.id === me.company_id);
  if (!cible || cible === app || !company) return;
  const servie = APPS[cible].entity;
  if (servie && servie !== company.entity) return;
  await fetch("/api/session/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_id: company.id, app: cible }) }).catch(() => null);
}

/** Durée pendant laquelle les icônes jouent leur entrée (la vague des tuiles comprise). */
const INTRO_MS = 3200;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Accueil NIMOVA, à la manière de l'accueil d'Odoo : un fond clair, une grille d'applications.
 * Le mouvement porte l'écran : les tuiles arrivent en vague et leurs icônes s'animent, chaque tuile
 * s'incline sous le curseur, la grille glisse quand on cherche, la tuile choisie s'ouvre en plein
 * écran. Il suffit de taper pour chercher ; les flèches déplacent le focus d'une tuile à l'autre.
 */
export function Accueil({ me, app }: { me: Me; app: AppCode }) {
  const router = useRouter();
  const reduit = useMouvementReduit();
  const [q, setQ] = useState("");
  const [intro, setIntro] = useState(true);
  const champ = useRef<HTMLInputElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const grille = useRef<HTMLUListElement>(null);
  const positions = useRef(new Map<string, DOMRect>());
  const voile = useRef<HTMLDivElement | null>(null);

  const tuiles = useMemo(() => rayonsDe(me, app).flatMap((r) => r.tuiles), [me, app]);

  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  const visibles = tuiles.filter((t) => mots.every((m) => sansAccents(`${t.libelle} ${t.motsCles}`).includes(m)));
  const signature = visibles.map((t) => t.cle).join("|");

  useEffect(() => {
    const t = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Le voile d'ouverture disparaît avec l'accueil.
  useEffect(() => () => voile.current?.remove(), []);

  // Comme sur Odoo : taper au clavier n'importe où ouvre la recherche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      if (cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.tagName === "SELECT" || cible.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        champ.current?.focus();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
        e.preventDefault();
        setQ((v) => v + e.key);
        champ.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Grille fluide : quand la recherche retire ou rend des tuiles, chacune glisse à sa nouvelle place.
  useLayoutEffect(() => {
    const ul = grille.current;
    if (!ul) return;
    const avant = positions.current;
    const apres = new Map<string, DOMRect>();
    ul.querySelectorAll<HTMLElement>("li[data-cle]").forEach((li) => {
      const cle = li.dataset.cle!;
      const r = li.getBoundingClientRect();
      apres.set(cle, r);
      const p = avant.get(cle);
      if (reduit || avant.size === 0) return;
      if (!p) {
        li.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(0.34,1.4,0.64,1)" });
      } else if (Math.abs(p.left - r.left) > 1 || Math.abs(p.top - r.top) > 1) {
        li.animate([{ transform: `translate(${p.left - r.left}px, ${p.top - r.top}px)` }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(0.22,1,0.36,1)" });
      }
    });
    positions.current = apres;
  }, [signature, reduit]);

  // Fond : les rubans et la lumière suivent le curseur.
  function suivre(e: PointeurReact<HTMLDivElement>) {
    if (reduit || e.pointerType !== "mouse") return;
    const el = page.current;
    if (!el) return;
    el.style.setProperty("--px", ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
    el.style.setProperty("--py", ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
    el.style.setProperty("--lx", `${e.clientX}px`);
    el.style.setProperty("--ly", `${e.clientY}px`);
  }

  // Ouverture : la tuile grandit jusqu'à couvrir l'écran, puis le module s'affiche.
  function ouvrir(e: SourisReact<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const aligne = alignerSociete(me, app, href);
    const boite = e.currentTarget.querySelector<HTMLElement>(".tuile-boite");
    if (reduit || !boite) {
      void aligne.then(() => router.push(href));
      return;
    }
    const r = boite.getBoundingClientRect();
    const v = document.createElement("div");
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:15px;background:#fff;z-index:100;display:grid;place-items:center;box-shadow:0 30px 80px -20px rgb(16 36 31 / .35);pointer-events:none`;
    const icone = boite.querySelector("svg")?.cloneNode(true) as SVGElement | undefined;
    if (icone) {
      icone.style.width = "42px";
      icone.style.height = "42px";
      v.appendChild(icone);
    }
    document.body.appendChild(v);
    voile.current?.remove();
    voile.current = v;
    v.animate(
      [
        { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: "15px", background: "#ffffff" },
        { left: "0px", top: "0px", width: "100vw", height: "100vh", borderRadius: "0px", background: "#eef2ef" },
      ],
      { duration: 520, easing: "cubic-bezier(0.7,0,0.2,1)", fill: "forwards" },
    );
    icone?.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(2.6)", opacity: 0 }], { duration: 480, easing: "cubic-bezier(0.22,1,0.36,1)", fill: "forwards" });
    void Promise.all([aligne, new Promise((fin) => window.setTimeout(fin, 180))]).then(() => router.push(href));
    window.setTimeout(() => v.remove(), 6000);
  }

  // Flèches : le focus passe d'une tuile à sa voisine, en ligne comme en colonne.
  function naviguer(e: ClavierReact<HTMLUListElement>) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const liens = [...(grille.current?.querySelectorAll<HTMLAnchorElement>("a.tuile") ?? [])];
    const i = liens.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    e.preventDefault();
    const cible = voisine(liens, i, e.key);
    liens[cible]?.focus();
  }

  return (
    <div ref={page} onPointerMove={suivre} className="relative min-h-screen overflow-hidden bg-bg text-ink">
      {/* Rubans de lumière en diagonale, comme le fond de l'accueil d'Odoo ; ils dérivent et suivent le curseur. */}
      <div aria-hidden className="accueil-ruban pointer-events-none absolute -inset-[10%] bg-[linear-gradient(118deg,transparent_38%,rgb(255_255_255/0.62)_38%,rgb(255_255_255/0.62)_58%,transparent_58%)]" />
      <div aria-hidden className="accueil-ruban-2 pointer-events-none absolute -inset-[10%] bg-[linear-gradient(118deg,transparent_64%,rgb(165_230_194/0.2)_64%,rgb(165_230_194/0.2)_80%,transparent_80%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_circle_at_var(--lx,50%)_var(--ly,30%),rgb(255_255_255/0.55),transparent_70%)]" />

      <header className="relative z-20 flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <span className="n-entree inline-flex items-center gap-2.5" style={{ "--i": 0 } as CSSProperties}>
          <Monogramme tuile={false} className="h-8 w-8" />
          <span className="font-display text-[15px] font-bold tracking-[0.06em] text-ink">NIMOVA</span>
        </span>
        <div className="n-entree flex items-center gap-1.5" style={{ "--i": 1 } as CSSProperties}>
          <Societe me={me} app={app} />
          <Compte me={me} app={app} />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[800px] px-4 pb-16 pt-[6vh] sm:px-6">
        <h1 className="sr-only">Applications NIMOVA</h1>
        {/* Recherche toujours visible : au toucher, aucune frappe au clavier ne pourrait la faire apparaître. */}
        <div className="n-entree mx-auto mb-8 max-w-md" style={{ "--i": 1 } as CSSProperties}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const premiere = visibles[0];
              if (premiere) void alignerSociete(me, app, premiere.href).then(() => router.push(premiere.href));
            }}
            className="flex h-11 items-center gap-2.5 rounded-xl border border-line bg-white/95 px-3.5 shadow-[0_2px_10px_-4px_rgb(16_36_31/0.18)]"
          >
            <Search className="h-4 w-4 flex-none text-muted" />
            <input
              ref={champ}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQ("");
                  champ.current?.blur();
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  grille.current?.querySelector<HTMLAnchorElement>("a.tuile")?.focus();
                }
              }}
              aria-label="Rechercher un module"
              placeholder="Rechercher un module"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted/70"
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink" aria-label="Effacer la recherche">
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="hidden rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted sm:inline">Ctrl K</kbd>
            )}
          </form>
        </div>

        <ul ref={grille} onKeyDown={naviguer} className="grid grid-cols-3 gap-x-2 gap-y-7 sm:grid-cols-4 md:grid-cols-6">
          {visibles.map((t, i) => (
            <li key={t.cle} data-cle={t.cle} className="tuile-entree" style={{ "--d": `${120 + i * 45}ms` } as CSSProperties}>
              <TuileModule t={t} premiere={Boolean(q) && i === 0} joue={intro && !q} delaiIntro={`${420 + i * 45}ms`} reduit={reduit} onOuvrir={ouvrir} />
            </li>
          ))}
        </ul>
        {visibles.length === 0 && <p className="n-apparaitre py-10 text-center text-[14px] text-muted">Aucun module ne correspond à « {q} ».</p>}
      </main>
    </div>
  );
}

/** Tuile : boîte blanche qui s'incline sous le curseur, reflet, icône vivante, libellé. */
function TuileModule({ t, premiere, joue, delaiIntro, reduit, onOuvrir }: { t: Tuile; premiere: boolean; joue: boolean; delaiIntro: string; reduit: boolean; onOuvrir: (e: SourisReact<HTMLAnchorElement>, href: string) => void }) {
  const boite = useRef<HTMLSpanElement>(null);

  function incliner(e: PointeurReact<HTMLAnchorElement>) {
    const el = boite.current;
    if (!el || reduit || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${((x - 0.5) * 18).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${((0.5 - y) * 18).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  }

  function relacher() {
    const el = boite.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }

  return (
    <Link
      href={t.href}
      onClick={(e) => onOuvrir(e, t.href)}
      onPointerMove={incliner}
      onPointerLeave={relacher}
      className={cx("tuile group flex flex-col items-center rounded-xl px-1 py-1 text-center outline-none", joue && "joue")}
      style={{ "--d-intro": delaiIntro } as CSSProperties}
    >
      <span
        ref={boite}
        className={cx(
          "tuile-boite relative grid h-[66px] w-[66px] place-items-center rounded-[15px] bg-white shadow-[0_1px_2px_rgb(16_36_31/0.08),0_4px_10px_-3px_rgb(16_36_31/0.12)] group-hover:shadow-[0_2px_4px_rgb(16_36_31/0.08),0_14px_24px_-8px_rgb(16_36_31/0.26)] group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[#f3f6f1]",
          premiere && "ring-2 ring-accent ring-offset-2 ring-offset-[#f3f6f1]",
        )}
      >
        <span aria-hidden className="tuile-reflet pointer-events-none absolute inset-0 rounded-[15px]" />
        <IconeModule cle={t.cle} className="relative h-[42px] w-[42px]" />
      </span>
      <span className="mt-2 line-clamp-2 text-[13px] leading-tight text-ink-2 transition-colors group-hover:text-ink">{t.libelle}</span>
    </Link>
  );
}

function useFermeture(open: boolean, setOpen: (v: boolean) => void) {
  const box = useRef<HTMLDivElement>(null);
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
  }, [open, setOpen]);
  return box;
}

/** Société de travail, en toutes lettres comme sur Odoo ; on en change ici si le compte est ouvert aux deux. */
function Societe({ me, app }: { me: Me; app: AppCode }) {
  const [open, setOpen] = useState(false);
  const box = useFermeture(open, setOpen);
  const company = me.companies.find((c) => c.id === me.company_id);
  const servie = APPS[app].entity;
  const ouvertes = servie ? me.companies.filter((c) => c.entity === servie) : me.companies;
  if (!company) return null;

  async function changer(id: number) {
    setOpen(false);
    if (id === me.company_id) return;
    const res = await fetch("/api/session/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_id: id, app }) }).catch(() => null);
    if (res?.ok) window.location.reload();
  }

  const libelle = (
    <>
      <LogoSociete entite={company.entity ?? "groupe"} decoratif className="h-5" />
      <span className="hidden max-w-[200px] truncate sm:inline">{company.name}</span>
    </>
  );
  if (ouvertes.length < 2) return <span className="flex items-center gap-2 px-2 text-[13px] text-ink-2">{libelle}</span>;
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-panel/70 hover:text-ink">
        {libelle}
        <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        <span className="sr-only">Changer de société</span>
      </button>
      {open && (
        <div role="group" aria-label="Société" className={cx(PANNEAU, "n-surgir absolute right-0 top-full z-50 mt-1.5 w-[260px] p-1.5")}>
          {ouvertes.map((c) => (
            <button key={c.id} type="button" aria-pressed={c.id === me.company_id} onClick={() => changer(c.id)} className={cx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", c.id === me.company_id ? "bg-accent-doux" : "hover:bg-panel-2")}>
              <span className="grid h-8 w-8 flex-none place-items-center rounded-md border border-line bg-white">
                <LogoSociete entite={c.entity ?? "groupe"} decoratif className="h-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</span>
              {c.id === me.company_id && <Check className="h-4 w-4 text-accent" strokeWidth={2.2} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compte : avatar carré comme sur Odoo, mot de passe, déconnexion. */
function Compte({ me, app }: { me: Me; app: AppCode }) {
  const [open, setOpen] = useState(false);
  const box = useFermeture(open, setOpen);
  async function sortir() {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = `/login?app=${app}`;
  }
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} title={me.name} className="grid h-8 w-8 place-items-center rounded-lg bg-[#1f5a47] text-[12px] font-bold text-white">
        {initials(me.name)}
        <span className="sr-only">Compte de {me.name}</span>
      </button>
      {open && (
        <div className={cx(PANNEAU, "n-surgir absolute right-0 top-full z-50 mt-1.5 w-60 p-1.5")}>
          <div className="px-3 pb-2 pt-1.5">
            <div className="truncate text-[13.5px] font-semibold">{me.name}</div>
            <div className="truncate text-[12px] text-muted">{me.login}</div>
          </div>
          <div className="border-t border-line pt-1">
            <Link href="/compte/mot-de-passe" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-ink-2 hover:bg-panel-2 hover:text-ink">
              <KeyRound className="h-4 w-4 text-muted" /> Changer le mot de passe
            </Link>
            <button type="button" onClick={sortir} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-danger hover:bg-danger-doux">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
