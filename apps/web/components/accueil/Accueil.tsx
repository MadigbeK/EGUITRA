"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconeModule } from "@/components/accueil/icones-modules";
import { LogoSociete, Monogramme } from "@/components/brand";
import { Check, ChevronDown, KeyRound, LogOut, Search, X } from "@/components/icons";
import { cx } from "@/components/ui";
import { APPS, type AppCode } from "@/lib/config";
import { navFor } from "@/lib/nav";
import type { Me } from "@/lib/types";

type Tuile = { cle: string; libelle: string; href: string; motsCles: string };

/** Libellés courts des tuiles, comme sur l'accueil d'Odoo (le menu de l'espace garde les longs). */
const COURT: Record<string, string> = {
  "/finance/pilotage": "Budget",
  "/finance/rapport": "Rapport mensuel",
  "/finance/approbations": "À valider",
  "/finance/achats": "Achats",
  "/finance/relances": "Relances",
  "/finance/dette": "Dette",
  "/finance/ecritures": "Journaux",
  "/finance/etats": "États financiers",
  "/finance/clotures": "Clôtures",
  "/axispro": "Dossiers",
  "/axispro/actions": "Plan d'actions",
  "/axispro/temps": "Temps",
  "/axispro/grille": "Grille",
  "/axispro/pieces": "Pièces",
};

function sansAccents(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Accueil NIMOVA, à la manière de l'accueil d'Odoo : un fond clair, une grille d'applications.
 * Une tuile par module ouvert au profil (Finance puis AxisPro), Rotations et les réglages en fin.
 * Il suffit de taper pour chercher ; Entrée ouvre le premier module trouvé.
 */
export function Accueil({ me, app }: { me: Me; app: AppCode }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const champ = useRef<HTMLInputElement>(null);
  const company = me.companies.find((c) => c.id === me.company_id);

  const tuiles = useMemo<Tuile[]>(() => {
    const liste: Tuile[] = [];
    let reglages: string | null = null;
    for (const a of ["finance", "axispro"] as const) {
      if (!me.apps.includes(a)) continue;
      for (const s of navFor(a, me.profiles, a === app ? company?.entity : APPS[a].entity)) {
        if (s.label === "Administration") {
          reglages ??= s.items[0]?.href ?? null;
          continue;
        }
        for (const i of s.items) liste.push({ cle: i.href, libelle: COURT[i.href] ?? i.label, href: i.href, motsCles: `${i.label} ${s.label} ${APPS[a].name}` });
      }
    }
    if (me.apps.includes("mobile")) liste.push({ cle: "/mobile", libelle: "Rotations", href: "/mobile", motsCles: "Rotations téléphone parc camion" });
    if (reglages) liste.push({ cle: "reglages", libelle: "Réglages", href: reglages, motsCles: "Réglages administration utilisateurs sociétés seuils audit" });
    return liste;
  }, [me.apps, me.profiles, app, company?.entity]);

  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  const visibles = tuiles.filter((t) => mots.every((m) => sansAccents(`${t.libelle} ${t.motsCles}`).includes(m)));

  // Comme sur Odoo : taper au clavier n'importe où ouvre la recherche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      if (cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.isContentEditable)) return;
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

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(135deg,#eaf4ef_0%,#f3f6f1_45%,#f8f4ea_100%)] text-ink">
      {/* Rubans de lumière en diagonale, comme le fond de l'accueil d'Odoo. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(118deg,transparent_38%,rgb(255_255_255/0.6)_38%,rgb(255_255_255/0.6)_58%,transparent_58%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(118deg,transparent_64%,rgb(165_230_194/0.18)_64%,rgb(165_230_194/0.18)_80%,transparent_80%)]" />

      <header className="relative z-20 flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <span className="inline-flex items-center gap-2.5">
          <Monogramme className="h-8 w-8" />
          <span className="font-display text-[15px] font-bold tracking-[0.06em] text-ink">NIMOVA</span>
        </span>
        <div className="flex items-center gap-1.5">
          <Societe me={me} app={app} />
          <Compte me={me} app={app} />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[800px] px-4 pb-16 pt-[6vh] sm:px-6">
        <div className={cx("mx-auto mb-8 max-w-md transition-all duration-200", q ? "opacity-100" : "pointer-events-none h-0 opacity-0 sm:h-auto")} aria-hidden={!q}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const premiere = visibles[0];
              if (premiere) router.push(premiere.href);
            }}
            className="flex h-11 items-center gap-2.5 rounded-xl border border-line bg-white/95 px-3.5 shadow-[0_2px_10px_-4px_rgb(16_36_31/0.18)]"
          >
            <Search className="h-4 w-4 flex-none text-muted" />
            <input
              ref={champ}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setQ(""), champ.current?.blur())}
              tabIndex={q ? 0 : -1}
              aria-label="Rechercher un module"
              placeholder="Rechercher un module"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted/70"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink" aria-label="Effacer la recherche">
                <X className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>

        <ul className="n-apparaitre grid grid-cols-3 gap-x-2 gap-y-7 sm:grid-cols-4 md:grid-cols-6" style={{ animationDuration: "500ms" }}>
          {visibles.map((t, i) => (
            <li key={t.cle}>
              <Link href={t.href} className="group flex flex-col items-center rounded-xl px-1 py-1 text-center outline-offset-2">
                <span
                  className={cx(
                    "grid h-[66px] w-[66px] place-items-center rounded-[15px] bg-white shadow-[0_1px_2px_rgb(16_36_31/0.08),0_4px_10px_-3px_rgb(16_36_31/0.12)] transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_2px_4px_rgb(16_36_31/0.08),0_10px_20px_-6px_rgb(16_36_31/0.22)] group-active:scale-95",
                    q && i === 0 && "ring-2 ring-accent-vif ring-offset-2 ring-offset-transparent",
                  )}
                >
                  <IconeModule cle={t.cle} className="h-[42px] w-[42px]" />
                </span>
                <span className="mt-2 line-clamp-2 text-[13px] leading-tight text-[#3a4842] group-hover:text-ink">{t.libelle}</span>
              </Link>
            </li>
          ))}
        </ul>
        {visibles.length === 0 && <p className="py-10 text-center text-[14px] text-muted">Aucun module ne correspond à « {q} ».</p>}
      </main>
    </div>
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
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-white/70 hover:text-ink">
        {libelle}
        <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        <span className="sr-only">Changer de société</span>
      </button>
      {open && (
        <div role="group" aria-label="Société" className="n-surgir absolute right-0 top-full z-50 mt-1.5 w-[260px] rounded-xl border border-line bg-white p-1.5 shadow-[var(--ombre-flottante)]">
          {ouvertes.map((c) => (
            <button key={c.id} type="button" aria-pressed={c.id === me.company_id} onClick={() => changer(c.id)} className={cx("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left", c.id === me.company_id ? "bg-panel-2" : "hover:bg-panel-2")}>
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
        <div className="n-surgir absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-line bg-white p-1.5 shadow-[var(--ombre-flottante)]">
          <div className="px-3 pb-2 pt-1.5">
            <div className="truncate text-[13.5px] font-semibold">{me.name}</div>
            <div className="truncate text-[12px] text-muted">{me.login}</div>
          </div>
          <div className="border-t border-line pt-1">
            <Link href="/compte/mot-de-passe" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink-2 hover:bg-panel-2 hover:text-ink">
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
