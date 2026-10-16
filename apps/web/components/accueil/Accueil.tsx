"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LogoSociete, Monogramme, SIGNATURE } from "@/components/brand";
import { Check, ChevronDown, ICONES, KeyRound, LogOut, Search, Smartphone, type Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { APPS, type AppCode } from "@/lib/config";
import { navFor } from "@/lib/nav";
import type { Me } from "@/lib/types";

/** Teintes des tuiles, dans l'ordre de la gamme NIMOVA (fond en dégradé, pictogramme blanc). */
const TEINTES = [
  ["#1aa676", "#0b7550"],
  ["#3a93ea", "#1a5fb8"],
  ["#f0a536", "#c97a0c"],
  ["#d9568f", "#a8326a"],
  ["#1cb5b0", "#0b7f7f"],
  ["#f2744c", "#c4471d"],
  ["#7b8cf0", "#4d5bc4"],
  ["#93c23b", "#5f8d16"],
] as const;

type Tuile = { cle: string; libelle: string; espace: string; href: string; icone: Icon; teinte: readonly [string, string] };

function sansAccents(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function salutation() {
  const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: "Africa/Conakry" }).format(new Date()));
  return h < 18 ? "Bonjour" : "Bonsoir";
}

/**
 * Accueil NIMOVA : l'écran de départ commun aux deux espaces de gestion, à la manière de l'accueil
 * d'Odoo. Une tuile par module ouvert au profil, regroupées par espace ; la recherche filtre les
 * tuiles et Entrée ouvre la première.
 */
export function Accueil({ me, app }: { me: Me; app: AppCode }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [bonjour, setBonjour] = useState("Bonjour");
  const [date, setDate] = useState("");
  const champ = useRef<HTMLInputElement>(null);
  const company = me.companies.find((c) => c.id === me.company_id);

  useEffect(() => {
    setBonjour(salutation());
    setDate(new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Conakry" }).format(new Date()));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        champ.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Une section par espace ouvert au compte : ses modules, filtrés par profil (et par société pour Finance).
  const espaces = useMemo(() => {
    let rang = 0;
    return (["finance", "axispro"] as const)
      .filter((a) => me.apps.includes(a))
      .map((a) => {
        const sections = navFor(a, me.profiles, a === app ? company?.entity : APPS[a].entity);
        const vers = (i: (typeof sections)[number]["items"][number]): Tuile => ({ cle: i.href, libelle: i.label, espace: APPS[a].name, href: i.href, icone: ICONES[i.icon] ?? ICONES.LayoutDashboard!, teinte: TEINTES[rang++ % TEINTES.length]! });
        // L'administration se range à part, en petites étiquettes, comme les paramètres d'Odoo.
        const tuiles = sections.filter((x) => x.label !== "Administration").flatMap((x) => x.items.map(vers));
        const reglages = sections.filter((x) => x.label === "Administration").flatMap((x) => x.items.map(vers));
        return { app: a, tuiles, reglages };
      });
  }, [me.apps, me.profiles, app, company?.entity]);

  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  const garde = (t: Tuile) => mots.every((m) => sansAccents(`${t.libelle} ${t.espace}`).includes(m));
  const visibles = espaces.map((e) => ({ ...e, tuiles: e.tuiles.filter(garde), reglages: e.reglages.filter(garde) }));
  const premiere = visibles.flatMap((e) => [...e.tuiles, ...e.reglages])[0];
  const rotations = me.apps.includes("mobile");

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#1f4d3e_0%,#142f29_42%,#0b1e1a_100%)] text-white">
      {/* Le grand N du monogramme, tracé en fond, et la bande verticale de la couverture du DG. */}
      <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -right-32 top-10 hidden h-[110vh] opacity-90 lg:block" focusable="false">
        <path d="M120 80h70l290 440h-70Z" fill="none" stroke="#d3aa5b" strokeOpacity="0.28" strokeWidth="2" pathLength={1} className="n-tracer" style={{ "--retard": "300ms" } as CSSProperties} />
        <path d="M120 80h70v440h-70ZM410 80h70v440h-70Z" fill="none" stroke="#a5e6c2" strokeOpacity="0.2" strokeWidth="2" pathLength={1} className="n-tracer" style={{ "--retard": "100ms" } as CSSProperties} />
      </svg>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-[22%] hidden w-[72px] bg-[#22634c]/25 lg:block" />

      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 pt-5 sm:px-8">
        <span className="inline-flex items-center gap-3">
          <Monogramme className="h-10 w-10 drop-shadow-[0_8px_16px_rgb(0_0_0/0.35)]" />
          <span className="leading-none">
            <span className="block font-display text-[19px] font-bold tracking-[0.06em]">NIMOVA</span>
            <span className="mt-1 hidden text-[12px] font-medium text-menthe sm:block">Système intégré de gestion</span>
          </span>
        </span>
        <div className="flex items-center gap-2">
          {company && <Societe me={me} app={app} />}
          <Compte me={me} app={app} />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <div className="n-entree max-w-2xl" style={{ "--i": 0 } as CSSProperties}>
          <p className="text-[14px] font-medium capitalize text-menthe/90">{date || " "}</p>
          <h1 className="mt-2 text-[34px] font-bold leading-tight sm:text-[44px]">
            {bonjour}, {me.name.split(/\s+/)[0]}
          </h1>
          <p className="mt-2 text-[16px] text-white/85">{SIGNATURE}</p>
        </div>

        <form
          className="n-entree mt-8 max-w-xl"
          style={{ "--i": 1 } as CSSProperties}
          onSubmit={(e) => {
            e.preventDefault();
            if (premiere) router.push(premiere.href);
          }}
        >
          <label className="flex h-14 items-center gap-3 rounded-2xl bg-white px-4 text-ink shadow-[0_24px_50px_-24px_rgb(0_0_0/0.6)] focus-within:ring-4 focus-within:ring-menthe/40">
            <Search className="h-5 w-5 flex-none text-accent" />
            <input
              ref={champ}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un module : trésorerie, dossiers, transport…"
              aria-label="Rechercher un module"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/80"
            />
            <kbd className="hidden rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted sm:inline">Ctrl K</kbd>
          </label>
        </form>

        <div className="mt-12 space-y-12">
          {visibles.map((e) =>
            e.tuiles.length + e.reglages.length === 0 ? null : (
              <section key={e.app} aria-labelledby={`espace-${e.app}`}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-3">
                  <h2 id={`espace-${e.app}`} className="flex items-center gap-3 text-[18px] font-bold">
                    <span aria-hidden className={cx("h-2.5 w-2.5 rounded-full", e.app === "finance" ? "bg-[#1aa676]" : "bg-[#3a93ea]")} />
                    {APPS[e.app].name}
                    <span className="hidden text-[13px] font-medium text-white/75 sm:inline">{APPS[e.app].tagline}</span>
                  </h2>
                  <Link href={APPS[e.app].home} className="rounded-lg text-[13px] font-semibold text-menthe hover:text-white hover:underline">
                    Ouvrir l&apos;espace
                  </Link>
                </div>
                <ul className="grid grid-cols-3 gap-x-3 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(112px,1fr))]">
                  {e.tuiles.map((t, i) => (
                    <li key={t.cle} className="n-surgir" style={{ animationDelay: `${180 + i * 35}ms` }}>
                      <TuileModule t={t} premiere={mots.length > 0 && t === premiere} />
                    </li>
                  ))}
                </ul>
                {e.reglages.length > 0 && (
                  <div className="mt-7 flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-[12.5px] font-semibold text-white/80">Administration</span>
                    {e.reglages.map((t) => {
                      const I = t.icone;
                      return (
                        <Link key={t.cle} href={t.href} className={cx("inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.07] px-3 py-1.5 text-[12.5px] font-medium text-white/95 transition-colors hover:border-white/40 hover:bg-white/15", t === premiere && mots.length > 0 && "ring-2 ring-white/80")}>
                          <I className="h-3.5 w-3.5" />
                          {t.libelle}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            ),
          )}
          {mots.length > 0 && !premiere && <p className="rounded-2xl bg-white/10 px-5 py-6 text-center text-[15px] text-white/90">Aucun module ne correspond à « {q} ».</p>}

          {rotations && mots.length === 0 && (
            <section aria-label="Sur le terrain" className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/15 bg-white/[0.06] p-4">
              <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-[linear-gradient(145deg,#f2744c,#c4471d)] shadow-[0_12px_24px_-12px_rgb(242_116_76/0.9)]">
                <Smartphone className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">NIMOVA · Rotations</div>
                <div className="text-[13px] text-white/80">Saisie des rotations au parc, sur téléphone, même sans réseau.</div>
              </div>
              <Link href={APPS.mobile.home} className="rounded-xl bg-white px-4 py-2 text-[13px] font-semibold text-foret hover:bg-menthe">
                Ouvrir Rotations
              </Link>
            </section>
          )}
        </div>

        <footer className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/15 pt-6">
          <LogoSociete entite="groupe" variante="complet" clair className="h-9 opacity-90" />
          <span aria-hidden className="h-7 w-px bg-white/20" />
          <LogoSociete entite="cabinet" variante="complet" clair className="h-7 opacity-90" />
        </footer>
      </main>
    </div>
  );
}

/** Tuile de module : carré en dégradé, pictogramme blanc, libellé dessous. */
function TuileModule({ t, premiere }: { t: Tuile; premiere: boolean }) {
  const I = t.icone;
  return (
    <Link href={t.href} className="group flex flex-col items-center gap-2.5 rounded-2xl p-1 text-center outline-offset-4">
      <span
        className={cx(
          "relative grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-[22px] transition-transform duration-300 ease-[var(--ease-ressort)] group-hover:-translate-y-1 group-hover:scale-[1.06] group-active:scale-95 sm:h-[78px] sm:w-[78px]",
          premiere && "ring-4 ring-white/80",
        )}
        style={{ background: `linear-gradient(145deg, ${t.teinte[0]}, ${t.teinte[1]})`, boxShadow: `0 14px 26px -14px ${t.teinte[0]}` }}
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-[linear-gradient(180deg,rgb(255_255_255/0.22),transparent)]" />
        <I className="relative h-8 w-8 text-white drop-shadow-[0_2px_3px_rgb(0_0_0/0.25)]" strokeWidth={1.8} />
      </span>
      <span className="line-clamp-2 text-[13px] font-medium leading-tight text-white/95 group-hover:text-white">{t.libelle}</span>
    </Link>
  );
}

/** Société de travail : logo et nom ; on en change ici si le compte est ouvert aux deux. */
function Societe({ me, app }: { me: Me; app: AppCode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const company = me.companies.find((c) => c.id === me.company_id);
  const servie = APPS[app].entity;
  const ouvertes = servie ? me.companies.filter((c) => c.entity === servie) : me.companies;

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

  async function changer(id: number) {
    setOpen(false);
    if (id === me.company_id) return;
    const res = await fetch("/api/session/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_id: id, app }) }).catch(() => null);
    if (res?.ok) window.location.reload();
  }

  if (!company) return null;
  const pastille = (
    <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-white">
      <LogoSociete entite={company.entity ?? "groupe"} decoratif className="h-5" />
    </span>
  );
  if (ouvertes.length < 2)
    return (
      <span className="hidden items-center gap-2.5 rounded-xl bg-white/10 py-1.5 pl-1.5 pr-3 text-[13px] font-semibold sm:flex">
        {pastille}
        <span className="max-w-[180px] truncate">{company.name}</span>
      </span>
    );
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2.5 rounded-xl bg-white/10 py-1.5 pl-1.5 pr-2.5 text-[13px] font-semibold transition-colors hover:bg-white/15">
        {pastille}
        <span className="hidden max-w-[180px] truncate sm:inline">{company.name}</span>
        <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} />
        <span className="sr-only">Changer de société</span>
      </button>
      {open && (
        <div role="group" aria-label="Société" className="n-surgir absolute right-0 top-full z-50 mt-2 w-[270px] rounded-2xl border border-line bg-panel p-1.5 text-ink shadow-[var(--ombre-flottante)]">
          {ouvertes.map((c) => (
            <button key={c.id} type="button" aria-pressed={c.id === me.company_id} onClick={() => changer(c.id)} className={cx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", c.id === me.company_id ? "bg-accent-doux" : "hover:bg-panel-2")}>
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-line bg-panel">
                <LogoSociete entite={c.entity ?? "groupe"} decoratif className="h-5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{c.name}</span>
              {c.id === me.company_id && <Check className="h-4 w-4 text-accent" strokeWidth={2.2} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Menu du compte : mot de passe, déconnexion. */
function Compte({ me, app }: { me: Me; app: AppCode }) {
  const [open, setOpen] = useState(false);
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
  }, [open]);
  async function sortir() {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = `/login?app=${app}`;
  }
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={me.name} className="grid h-11 w-11 place-items-center rounded-full bg-[linear-gradient(135deg,#a5e6c2,#d3aa5b)] font-display text-[14px] font-bold text-foret shadow-[0_8px_18px_-8px_rgb(0_0_0/0.5)]">
        {initials(me.name)}
        <span className="sr-only">Compte de {me.name}</span>
      </button>
      {open && (
        <div className="n-surgir absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-line bg-panel p-1.5 text-ink shadow-[var(--ombre-flottante)]">
          <div className="px-3 pb-2.5 pt-2">
            <div className="truncate text-sm font-semibold">{me.name}</div>
            <div className="truncate text-[12px] text-muted">{me.login}</div>
          </div>
          <div className="border-t border-line pt-1.5">
            <Link href="/compte/mot-de-passe" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">
              <KeyRound className="h-4 w-4 text-muted" /> Changer le mot de passe
            </Link>
            <button type="button" onClick={sortir} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger-doux">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
