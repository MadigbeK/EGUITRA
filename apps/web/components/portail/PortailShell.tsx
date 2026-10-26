"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { MarqueCabinet } from "@/components/brand";
import {
  AlertTriangle, BadgeCheck, Bell, BookOpen, Calculator, Calendar, Check, ChevronDown, Clock, FileStack, FolderOpen,
  KeyRound, LayoutDashboard, ListChecks, LogOut, Mail, Menu, Sparkles, UserCog, Users, X, type Icon,
} from "@/components/icons";
import { Button, ErrorBox, FEUILLE, PANNEAU, Select, cx, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { pluriel } from "@/lib/format";
import type { DossierRef, Espace, Notifications } from "@/lib/portail-types";
import type { Me } from "@/lib/types";
import { KIND_ICON, dateHeure, lienNotification } from "./commun";
import { erreurLisible } from "./projet/outils";

/* ─── Contexte du portail : l'espace du porteur et le dossier choisi ─────── */

type PortailContext = {
  espace: Espace | undefined;
  dossier: (DossierRef & { unread_messages: number }) | undefined;
  choisir: (id: number) => void;
  rafraichir: () => void;
  me: Me;
};

const Contexte = createContext<PortailContext | null>(null);
const MEMOIRE = "portail-dossier";

/** Dossier choisi lors d'une visite précédente (rien côté serveur, ni si le stockage est indisponible). */
function lireMemoire(): number | null {
  if (typeof window === "undefined") return null;
  try {
    return Number(window.localStorage.getItem(MEMOIRE)) || null;
  } catch {
    return null;
  }
}

function ecrireMemoire(id: number) {
  try {
    window.localStorage.setItem(MEMOIRE, String(id));
  } catch {
    // Stockage indisponible : le choix vaut pour la visite.
  }
}

/** Espace du porteur, dossier choisi (plusieurs dossiers possibles) et rafraîchissement des compteurs. */
export function usePortail(): PortailContext {
  const ctx = useContext(Contexte);
  if (!ctx) throw new Error("usePortail hors du portail");
  return ctx;
}

function initiales(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/* ─── Menu ─────────────────────────────────────────────────────────────── */

type Entree = { href: string; label: string; icon: Icon; badge?: (c: Espace["counts"]) => { n: number; tone: "accent" | "danger" } | null };

const MENU: Array<{ titre: string; entrees: Entree[] }> = [
  {
    titre: "Mon projet",
    entrees: [
      { href: "/portail", label: "Accueil", icon: LayoutDashboard },
      { href: "/portail/projet", label: "Mon projet", icon: FolderOpen },
      { href: "/portail/pieces", label: "Pièces et data room", icon: FileStack },
      {
        href: "/portail/actions", label: "Plan d'actions", icon: ListChecks,
        badge: (c) => (c.tasks_overdue ? { n: c.tasks_overdue, tone: "danger" } : c.tasks_open ? { n: c.tasks_open, tone: "accent" } : null),
      },
    ],
  },
  {
    titre: "Échanges",
    entrees: [
      { href: "/portail/messages", label: "Messages", icon: Mail, badge: (c) => (c.messages ? { n: c.messages, tone: "danger" } : null) },
      { href: "/portail/rendez-vous", label: "Rendez-vous", icon: Clock, badge: (c) => (c.meetings_upcoming ? { n: c.meetings_upcoming, tone: "accent" } : null) },
      { href: "/portail/agenda", label: "Agenda", icon: Calendar },
    ],
  },
  {
    titre: "Le cabinet",
    entrees: [
      {
        href: "/portail/actualites", label: "Actualités", icon: Sparkles,
        badge: (c) => (c.announcements_to_ack ? { n: c.announcements_to_ack, tone: "danger" } : c.announcements_unread ? { n: c.announcements_unread, tone: "accent" } : null),
      },
      { href: "/portail/ressources", label: "Conseils et ressources", icon: BookOpen },
      { href: "/portail/evenements", label: "Événements et formations", icon: Users },
    ],
  },
  {
    titre: "Outils",
    entrees: [
      { href: "/portail/outils", label: "Simulateurs", icon: Calculator },
      { href: "/portail/avis", label: "Votre avis", icon: BadgeCheck },
      { href: "/portail/profil", label: "Mon profil", icon: UserCog },
    ],
  },
];

/** Barre d'onglets du téléphone : les cinq écrans les plus utiles. */
const ONGLETS: Entree[] = [MENU[0]!.entrees[0]!, MENU[0]!.entrees[2]!, MENU[1]!.entrees[0]!, MENU[1]!.entrees[2]!, MENU[2]!.entrees[1]!];

function actif(pathname: string, href: string) {
  return href === "/portail" ? pathname === "/portail" : pathname === href || pathname.startsWith(`${href}/`);
}

function Pastille({ n, tone }: { n: number; tone: "accent" | "danger" }) {
  return (
    <span className={cx("ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums", tone === "danger" ? "bg-danger text-white" : "bg-accent-doux text-accent")}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Navigation({ counts, onNavigate }: { counts: Espace["counts"] | undefined; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu du portail" className="space-y-5">
      {MENU.map((groupe) => (
        <div key={groupe.titre}>
          <div className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted/80">{groupe.titre}</div>
          <ul className="space-y-0.5">
            {groupe.entrees.map((e) => {
              const on = actif(pathname, e.href);
              const badge = counts && e.badge?.(counts);
              const I = e.icon;
              return (
                <li key={e.href}>
                  <Link
                    href={e.href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={cx(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition-colors",
                      on ? "bg-accent-doux text-accent" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    <I className={cx("h-[18px] w-[18px] flex-none", on ? "text-accent" : "text-muted group-hover:text-ink-2")} />
                    <span className="truncate">{e.label}</span>
                    {badge && <Pastille n={badge.n} tone={badge.tone} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ChoixDossier({ espace, dossier, choisir }: { espace: Espace | undefined; dossier: PortailContext["dossier"]; choisir: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  // Squelette pendant le chargement seulement : un espace sans dossier le dit, au lieu d'attendre sans fin.
  if (!espace) return <div className="h-[74px] animate-pulse rounded-2xl bg-panel-2" />;
  if (!dossier) {
    return (
      <div className={cx(FEUILLE, "p-3")}>
        <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">Mon dossier</div>
        <div className="mt-1 text-[13.5px] leading-snug text-ink-2">Aucun dossier n'est encore ouvert à votre nom.</div>
      </div>
    );
  }
  const plusieurs = espace.dossiers.length > 1;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => plusieurs && setOpen((v) => !v)}
        aria-expanded={plusieurs ? open : undefined}
        className={cx(FEUILLE, "w-full p-3 text-left", plusieurs && "hover:ring-1 hover:ring-line-strong")}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">{dossier.reference}</span>
          {dossier.current_gate && <span className="ml-auto rounded-full bg-accent-doux px-2 py-0.5 text-[11px] font-bold text-accent">{dossier.current_gate.code}</span>}
          {plusieurs && <ChevronDown className={cx("h-4 w-4 text-muted transition-transform", open && "rotate-180")} />}
        </div>
        <div className="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug text-ink">{dossier.name}</div>
        {dossier.current_gate && <div className="mt-0.5 truncate text-[12px] text-muted">{dossier.current_gate.name}</div>}
      </button>
      {open && plusieurs && (
        <ul className={cx(PANNEAU, "n-surgir absolute inset-x-0 top-full z-40 mt-2 space-y-0.5 p-1.5")}>
          {espace!.dossiers.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => { choisir(d.id); setOpen(false); }} className={cx("flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left hover:bg-panel-2", d.id === dossier.id && "bg-panel-2")}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] font-semibold text-muted">{d.reference}</span>
                  <span className="block truncate text-[13.5px] font-medium text-ink">{d.name}</span>
                </span>
                {d.unread_messages > 0 && <Pastille n={d.unread_messages} tone="danger" />}
                {d.id === dossier.id && <Check className="mt-1 h-4 w-4 text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sur téléphone et tablette, la colonne du dossier est dans le tiroir : un porteur à plusieurs dossiers voit
 * ici, sur chaque page, le dossier où il écrit et dépose, et en change sans ouvrir le menu.
 */
function BandeauDossier({ espace, dossier, choisir }: { espace: Espace | undefined; dossier: PortailContext["dossier"]; choisir: (id: number) => void }) {
  if (!espace || espace.dossiers.length < 2 || !dossier) return null;
  return (
    <div className="no-print flex items-center gap-2.5 border-b border-line bg-panel-2 px-4 py-2 sm:px-6 lg:hidden">
      <FolderOpen className="h-4 w-4 flex-none text-accent" />
      <span className="flex-none text-[12.5px] font-medium text-muted">Dossier</span>
      <Select
        aria-label="Dossier en cours"
        value={dossier.id}
        onChange={(e) => choisir(Number(e.target.value))}
        options={espace.dossiers.map((d) => ({ value: d.id, label: `${d.reference} · ${d.name}` }))}
        className="min-h-8 min-w-0 flex-1 py-1 text-[13px] font-semibold"
      />
    </div>
  );
}

function Consultant({ dossier }: { dossier: PortailContext["dossier"] }) {
  const c = dossier?.consultant;
  if (!c) return null;
  return (
    <div className="rounded-2xl bg-accent-strong p-4 text-white">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/75">Votre consultant</div>
      <div className="mt-2 flex items-center gap-3">
        <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-full bg-white/15 font-display text-[13px] font-bold">{initiales(c.name)}</span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{c.name}</div>
          {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="block truncate text-[12.5px] text-white/75 hover:text-white">{c.phone}</a>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href="/portail/messages" className="rounded-lg bg-white/12 px-2 py-1.5 text-center text-[12.5px] font-semibold hover:bg-white/20">Écrire</Link>
        <Link href="/portail/rendez-vous" className="rounded-lg bg-white/12 px-2 py-1.5 text-center text-[12.5px] font-semibold hover:bg-white/20">Rendez-vous</Link>
      </div>
    </div>
  );
}

/* ─── Cloche des notifications ─────────────────────────────────────────── */

const CLOCHE = 12;

/** Question de la confirmation « Tout marquer comme lu » (l'action ne se défait pas). */
export function texteToutLire(n: number): string {
  return n > 1
    ? `Les ${pluriel(n, "notification non lue", "notifications non lues")} resteront consultables, mais ne seront plus signalées comme nouvelles.`
    : "La notification non lue restera consultable, mais ne sera plus signalée comme nouvelle.";
}

function Cloche({ count, onChange }: { count: number; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const router = useRouter();
  // La cloche n'affiche que les dernières : la page Notifications donne la suite.
  const { data, error, mutate } = useApi<Notifications>(open ? `/portail/notifications?limit=${CLOCHE}` : null);
  const [toutEnCours, setToutEnCours] = useState(false);
  const [erreurLecture, setErreurLecture] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    // Une fenêtre de confirmation ouverte par-dessus garde les touches et les clics pour elle.
    const fenetre = () => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !fenetre() && setOpen(false);
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && !fenetre() && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  /** Une notification ouverte : marquée lue en passant, la page visée s'ouvre quoi qu'il arrive. */
  async function lire(ids: number[]) {
    try {
      await apiSend("POST", "/portail/notifications/lues", { ids });
    } catch {
      // Elle reste signalée comme nouvelle : le porteur la retrouvera telle quelle.
    }
    void mutate();
    onChange();
  }

  async function toutLire() {
    const oui = await demanderConfirmation(texteToutLire(count), { titre: "Tout marquer comme lu ?", action: "Tout marquer comme lu" });
    if (!oui) return;
    setToutEnCours(true);
    setErreurLecture(null);
    try {
      await apiSend("POST", "/portail/notifications/lues", {});
      void mutate();
      onChange();
    } catch (e) {
      setErreurLecture(e);
    } finally {
      setToutEnCours(false);
    }
  }

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id} className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-2 hover:bg-panel-3" aria-label={`Notifications${count ? `, ${count} non lues` : ""}`}>
        <Bell className="h-5 w-5" />
        {count > 0 && <span className="absolute right-1.5 top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white ring-2 ring-bg">{count > 9 ? "9+" : count}</span>}
      </button>
      {open && (
        <div id={id} className={cx(PANNEAU, "n-surgir absolute right-0 top-full z-50 mt-2 w-[min(92vw,380px)]")}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {count > 0 && (
              <Button variant="ghost" size="sm" loading={toutEnCours} onClick={() => void toutLire()} className="-mr-2 text-accent">
                Tout marquer comme lu
              </Button>
            )}
          </div>
          {erreurLecture !== null && (
            <div className="border-b border-line p-1.5">
              <ErrorBox error={erreurLisible(erreurLecture)} titre="Les notifications n'ont pas pu être marquées comme lues." onRetry={() => void toutLire()} />
            </div>
          )}
          <ul className="max-h-[420px] overflow-y-auto p-1.5">
            {!data &&
              (error ? (
                <li className="p-1.5">
                  <ErrorBox error={erreurLisible(error)} onRetry={() => mutate()} />
                </li>
              ) : (
                <li className="px-3 py-6 text-center text-sm text-muted">Chargement…</li>
              ))}
            {data?.items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Aucune notification.</li>}
            {data?.items.slice(0, CLOCHE).map((n) => {
              const I = KIND_ICON[n.kind] ?? Bell;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read) void lire([n.id]);
                      setOpen(false);
                      const lien = lienNotification(n);
                      if (lien) router.push(lien);
                    }}
                    className={cx("flex w-full gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-panel-2", !n.read && "bg-accent-doux/45")}
                  >
                    <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full bg-panel-2 text-accent"><I className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className={cx("block text-[13.5px] leading-snug", n.read ? "text-ink-2" : "font-semibold text-ink")}>{n.title}</span>
                      {n.body && <span className="mt-0.5 block truncate text-[12.5px] text-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-[11.5px] text-muted/80">{dateHeure(n.date)}</span>
                    </span>
                    {!n.read && <span aria-hidden className="mt-2 h-2 w-2 flex-none rounded-full bg-accent-vif" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <Link href="/portail/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-[13px] font-semibold text-accent hover:bg-panel-2">
            Voir toutes les notifications
          </Link>
        </div>
      )}
    </div>
  );
}

function Compte({ me, entreprise, onLogout }: { me: Me; entreprise: string | null; onLogout: () => void }) {
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
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2.5 rounded-full p-0.5 pr-2 hover:bg-panel-3">
        <span aria-hidden className="bg-accent grid h-9 w-9 place-items-center rounded-full font-display text-[13px] font-bold text-white">{initiales(me.name)}</span>
        <span className="hidden max-w-[160px] text-left leading-tight md:block">
          <span className="block truncate text-[13px] font-semibold text-ink">{me.name}</span>
          {entreprise && <span className="block truncate text-[11.5px] text-muted">{entreprise}</span>}
        </span>
        <ChevronDown className="hidden h-4 w-4 text-muted md:block" />
        <span className="sr-only">Compte de {me.name}</span>
      </button>
      {open && (
        <div className={cx(PANNEAU, "n-surgir absolute right-0 top-full z-50 mt-2 w-60 p-1.5")}>
          <div className="px-3 pb-2 pt-1.5">
            <div className="truncate text-sm font-semibold">{me.name}</div>
            <div className="truncate text-[12px] text-muted">{me.login}</div>
          </div>
          <div className="border-t border-line pt-1.5">
            <Link href="/portail/profil" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">
              <UserCog className="h-4 w-4 text-muted" /> Mon profil
            </Link>
            <Link href="/compte/mot-de-passe" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">
              <KeyRound className="h-4 w-4 text-muted" /> Changer le mot de passe
            </Link>
            <button type="button" onClick={onLogout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger-doux">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Coquille ─────────────────────────────────────────────────────────── */

/**
 * Portail des porteurs, à la marque MB AxisPro Consulting : colonne de menu (dossier en cours, rubriques avec
 * compteurs, consultant joignable), cloche des notifications, barre d'onglets sur téléphone.
 */
export function PortailShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [tiroir, setTiroir] = useState(false);
  const { data: espace, error: erreurEspace, mutate } = useApi<Espace>("/portail/espace", { refreshInterval: 60_000 });
  const voulu = Number(params.get("dossier")) || null;
  const [memo, setMemo] = useState<number | null>(lireMemoire);

  // Un dossier désigné par l'adresse (lien d'une notification, d'une étape, d'un agenda) devient le dossier
  // choisi et mémorisé : les pages ouvertes ensuite par le menu restent sur lui, au lieu de revenir en
  // silence au dossier d'avant. Une adresse qui désigne un dossier qui n'est pas le sien est ignorée.
  useEffect(() => {
    if (!espace || !voulu || voulu === memo) return;
    if (espace.dossiers.some((d) => d.id === voulu)) {
      setMemo(voulu);
      ecrireMemoire(voulu);
    }
  }, [espace, voulu, memo]);

  const dossier = useMemo(() => {
    const dossiers = espace?.dossiers ?? [];
    return dossiers.find((d) => d.id === voulu) ?? dossiers.find((d) => d.id === memo) ?? dossiers[0];
  }, [espace, voulu, memo]);
  const choisir = useCallback(
    (id: number) => {
      setMemo(id);
      ecrireMemoire(id);
      // L'adresse ne doit plus imposer l'autre dossier ; ses autres paramètres restent.
      if (voulu && voulu !== id) {
        const reste = new URLSearchParams(params.toString());
        reste.delete("dossier");
        router.replace(reste.size ? `${pathname}?${reste.toString()}` : pathname);
      }
    },
    [voulu, params, pathname, router],
  );
  const rafraichir = useCallback(() => void mutate(), [mutate]);
  const valeur = useMemo(() => ({ espace, dossier, choisir, rafraichir, me }), [espace, dossier, choisir, rafraichir, me]);

  useEffect(() => setTiroir(false), [pathname]);

  async function deconnexion() {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login?app=portail";
  }

  const colonne = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-5">
      <ChoixDossier espace={espace} dossier={dossier} choisir={choisir} />
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <Navigation counts={espace?.counts} onNavigate={onNavigate} />
      </div>
      <Consultant dossier={dossier} />
    </div>
  );

  return (
    <Contexte.Provider value={valeur}>
      <div data-app="portail" data-societe="cabinet" className="min-h-screen bg-bg text-ink">
        {tiroir && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="n-apparaitre absolute inset-0 bg-foret/45" onClick={() => setTiroir(false)} />
            <div className="n-tiroir absolute inset-y-0 left-0 flex w-[min(88vw,320px)] flex-col bg-bg p-4 shadow-[var(--ombre-flottante)]">
              <div className="mb-4 flex items-center justify-between">
                <MarqueCabinet className="h-9" />
                <button type="button" onClick={() => setTiroir(false)} className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-panel-3" aria-label="Fermer le menu">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {colonne(() => setTiroir(false))}
            </div>
          </div>
        )}

        <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r border-line bg-bg px-4 pb-5 pt-5 lg:flex">
          <Link href="/portail" className="mb-5 block rounded-lg px-1">
            <MarqueCabinet className="h-10" />
          </Link>
          {colonne()}
        </aside>

        <div className="lg:pl-[272px]">
          <header className="no-print sticky top-0 z-20 border-b border-line/70 bg-bg/90 backdrop-blur-md">
            <div className="flex h-16 items-center gap-2 px-4 sm:px-6 lg:px-10">
              <button type="button" onClick={() => setTiroir(true)} className="grid h-10 w-10 place-items-center rounded-xl text-ink-2 hover:bg-panel-3 lg:hidden" aria-label="Ouvrir le menu">
                <Menu className="h-5 w-5" />
              </button>
              <Link href="/portail" className="lg:hidden">
                <MarqueCabinet className="h-8" />
              </Link>
              <div className="hidden min-w-0 lg:block">
                <div className="text-[12px] text-muted">Portail des porteurs de projets</div>
                <div className="truncate text-[14px] font-semibold text-ink">Bonjour {me.name.split(" ")[0]}</div>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Cloche count={espace?.counts.notifications ?? 0} onChange={rafraichir} />
                <Compte me={me} entreprise={espace?.user.company ?? null} onLogout={deconnexion} />
              </div>
            </div>
            <div aria-hidden className="h-[3px] bg-accent" />
          </header>
          <BandeauDossier espace={espace} dossier={dossier} choisir={choisir} />
          {me.password_change_required && (
            <div className="flex items-center gap-2.5 border-b border-warn/15 bg-warn-doux px-5 py-2.5 text-sm text-ink lg:px-10">
              <AlertTriangle className="h-4 w-4 flex-none text-warn" />
              <span>
                Votre mot de passe est provisoire.{" "}
                <Link href="/compte/mot-de-passe" className="font-semibold text-warn underline underline-offset-2">Choisissez votre mot de passe</Link>.
              </span>
            </div>
          )}
          <main key={pathname} className="n-page mx-auto min-w-0 max-w-[1240px] px-4 pb-28 pt-6 sm:px-6 md:pt-8 lg:px-10 lg:pb-12">
            {erreurEspace && !espace ? <ErrorBox error={erreurLisible(erreurEspace)} onRetry={rafraichir} /> : children}
          </main>
        </div>

        <nav aria-label="Raccourcis" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
          <ul className="grid grid-cols-5">
            {ONGLETS.map((e) => {
              const on = actif(pathname, e.href);
              const I = e.icon;
              const badge = espace && e.badge?.(espace.counts);
              return (
                <li key={e.href}>
                  <Link href={e.href} aria-current={on ? "page" : undefined} className={cx("relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold", on ? "text-accent" : "text-muted")}>
                    <I className="h-5 w-5" />
                    <span className="max-w-full truncate px-1">{e.label.split(" ")[0]}</span>
                    {badge && <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-danger" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </Contexte.Provider>
  );
}
