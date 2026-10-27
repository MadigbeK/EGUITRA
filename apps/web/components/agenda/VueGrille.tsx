"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as PointeurReact } from "react";
import { cx } from "@/components/ui";
import { JOURS_COURTS, heure, instantDe, jourDe, lireInstant, minutesDe, minutesEnTexte, rangJour, type ElementSource, type Occurrence } from "@/lib/agenda";
import { aujourdhui } from "@/lib/format";

export const HAUTEUR_HEURE = 48;
const PAS = 15;
const JOUR_MIN = 24 * 60;

type Bloc = { o: Occurrence; debut: number; fin: number; voie: number; voies: number };

/** Occurrences d'un jour placées en voies : celles qui se chevauchent se partagent la largeur. */
export function disposer(items: Array<{ o: Occurrence; debut: number; fin: number }>): Bloc[] {
  const tries = [...items].sort((a, b) => a.debut - b.debut || b.fin - a.fin);
  const sortie: Bloc[] = [];
  let grappe: Bloc[] = [];
  let finGrappe = -1;
  const fermer = () => {
    const voies = Math.max(1, ...grappe.map((b) => b.voie + 1));
    for (const b of grappe) b.voies = voies;
    sortie.push(...grappe);
    grappe = [];
  };
  for (const it of tries) {
    if (grappe.length && it.debut >= finGrappe) fermer();
    const finsVoies: number[] = [];
    for (const b of grappe) finsVoies[b.voie] = Math.max(finsVoies[b.voie] ?? -1, b.fin);
    let voie = finsVoies.findIndex((f) => f <= it.debut);
    if (voie < 0) voie = finsVoies.length;
    grappe.push({ ...it, voie, voies: 1 });
    finGrappe = Math.max(finGrappe, it.fin);
  }
  if (grappe.length) fermer();
  return sortie;
}

type Geste =
  | { type: "deplacer"; o: Occurrence; ecart: number; duree: number; col: number; debut: number; bouge: boolean; x0: number; y0: number }
  | { type: "etirer"; o: Occurrence; col: number; debut: number; fin: number; bouge: boolean }
  | { type: "creer"; col: number; debut: number; fin: number; bouge: boolean };

/**
 * Vues Jour, Semaine et Semaine de travail : une colonne par jour, une ligne par quart d'heure. Glisser un
 * événement le déplace (d'un jour à l'autre aussi), tirer son bord bas le raccourcit ou l'allonge, glisser
 * sur une plage vide crée un événement ; un simple clic sur une plage vide propose une heure. La ligne
 * rouge marque l'heure courante ; les heures hors du travail sont grisées.
 */
export function VueGrille({
  jours,
  occurrences,
  sources,
  couleur,
  travail,
  onOuvrir,
  onCreer,
  onDeplacer,
}: {
  jours: string[];
  occurrences: Occurrence[];
  sources: ElementSource[];
  couleur: (o: Occurrence) => string;
  travail: Record<string, [string, string][]>;
  onOuvrir: (o: Occurrence) => void;
  onCreer: (debut: Date, fin: Date, allday?: boolean) => void;
  onDeplacer: (o: Occurrence, debut: Date, fin: Date) => void;
}) {
  const corps = useRef<HTMLDivElement>(null);
  const defile = useRef<HTMLDivElement>(null);
  const [geste, setGeste] = useState<Geste | null>(null);
  const [maintenant, setMaintenant] = useState(() => new Date());
  const today = aujourdhui();

  useEffect(() => {
    const t = window.setInterval(() => setMaintenant(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // À l'ouverture, la grille montre le début de la journée de travail.
  useLayoutEffect(() => {
    if (defile.current) defile.current.scrollTop = 7 * HAUTEUR_HEURE - 8;
  }, []);

  const parJour = useMemo(() => {
    const map = new Map<string, Array<{ o: Occurrence; debut: number; fin: number }>>();
    const enHaut = new Map<string, Array<Occurrence | ElementSource>>();
    for (const j of jours) {
      map.set(j, []);
      enHaut.set(j, []);
    }
    for (const o of occurrences) {
      if (o.allday) {
        const a = o.start_date ?? jourDe(lireInstant(o.start));
        const b = o.end_date ?? a;
        for (const j of jours) if (j >= a && j <= b) enHaut.get(j)!.push(o);
        continue;
      }
      const s = lireInstant(o.start);
      const e = lireInstant(o.stop);
      for (const j of jours) {
        const debutJour = instantDe(j).getTime();
        const finJour = debutJour + JOUR_MIN * 60_000;
        if (s.getTime() >= finJour || e.getTime() <= debutJour) continue;
        const debut = s.getTime() <= debutJour ? 0 : minutesDe(s);
        const fin = e.getTime() >= finJour ? JOUR_MIN : minutesDe(e) || JOUR_MIN;
        map.get(j)!.push({ o, debut, fin: Math.max(fin, debut + PAS) });
      }
    }
    for (const s of sources) for (const j of jours) if (j >= s.date && j <= s.end_date) enHaut.get(j)!.push(s);
    return { blocs: new Map([...map].map(([j, items]) => [j, disposer(items)])), enHaut };
  }, [jours, occurrences, sources]);

  function position(e: { clientX: number; clientY: number }) {
    const r = corps.current!.getBoundingClientRect();
    const col = Math.max(0, Math.min(jours.length - 1, Math.floor(((e.clientX - r.left) / r.width) * jours.length)));
    const brut = ((e.clientY - r.top) / HAUTEUR_HEURE) * 60;
    return { col, minute: Math.max(0, Math.min(JOUR_MIN, Math.round(brut / PAS) * PAS)) };
  }

  // Geste en cours : lu par les écouteurs de la fenêtre (référence), affiché par l'état ; les actions
  // partent au lâcher, une seule fois.
  const gesteRef = useRef<Geste | null>(null);
  const rappels = useRef({ onOuvrir, onDeplacer, onCreer, jours });
  useEffect(() => {
    rappels.current = { onOuvrir, onDeplacer, onCreer, jours };
  });
  const maj = (g: Geste | null) => {
    gesteRef.current = g;
    setGeste(g);
  };
  const actif = geste !== null;
  useEffect(() => {
    if (!actif) return;
    const bouger = (e: PointerEvent) => {
      const g = gesteRef.current;
      if (!g || !corps.current) return;
      const p = position(e);
      if (g.type === "deplacer") {
        const loin = Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) > 4;
        maj({ ...g, col: p.col, debut: Math.max(0, Math.min(JOUR_MIN - PAS, p.minute - g.ecart)), bouge: g.bouge || loin });
      } else if (g.type === "etirer") {
        maj({ ...g, fin: Math.max(g.debut + PAS, p.minute), bouge: true });
      } else {
        maj({ ...g, fin: p.minute, bouge: true });
      }
    };
    const lacher = () => {
      const g = gesteRef.current;
      maj(null);
      if (!g) return;
      const { onOuvrir: ouvrir, onDeplacer: deplacer, onCreer: creer, jours: js } = rappels.current;
      if (g.type === "deplacer") {
        if (!g.bouge) return ouvrir(g.o);
        const debut = instantDe(js[g.col]!, g.debut);
        return deplacer(g.o, debut, new Date(debut.getTime() + g.duree * 60_000));
      }
      if (g.type === "etirer") return g.bouge ? deplacer(g.o, lireInstant(g.o.start), instantDe(js[g.col]!, g.fin)) : ouvrir(g.o);
      const [a, b] = g.fin > g.debut ? [g.debut, g.fin] : [g.fin, g.debut];
      const debut = instantDe(js[g.col]!, a);
      creer(debut, b - a >= PAS && g.bouge ? instantDe(js[g.col]!, b) : new Date(debut.getTime() + 60 * 60_000));
    };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
    return () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
    };
    // position lit la grille par sa référence : seul le début et la fin du geste comptent ici.
  }, [actif]);

  function saisirEvenement(e: PointeurReact, o: Occurrence, b: Bloc, col: number, bord: boolean) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!o.can_edit) {
      onOuvrir(o);
      return;
    }
    e.preventDefault();
    if (bord) {
      maj({ type: "etirer", o, col, debut: b.debut, fin: b.fin, bouge: false });
      return;
    }
    const p = position(e);
    const duree = (lireInstant(o.stop).getTime() - lireInstant(o.start).getTime()) / 60_000;
    maj({ type: "deplacer", o, ecart: p.minute - b.debut, duree, col, debut: b.debut, bouge: false, x0: e.clientX, y0: e.clientY });
  }

  function saisirVide(e: PointeurReact) {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = position(e);
    const debut = Math.floor(p.minute / 30) * 30;
    maj({ type: "creer", col: p.col, debut, fin: debut, bouge: false });
  }

  const colonnes = `56px repeat(${jours.length}, minmax(0, 1fr))`;
  const maintenantMin = minutesDe(maintenant);
  const colAujourdhui = jours.indexOf(today);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      {/* En-têtes des jours et ligne des événements de la journée entière */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: colonnes }}>
        <div className="px-1 py-2 text-right text-[10.5px] font-medium text-muted">Journée</div>
        {jours.map((j) => {
          const items = parJour.enHaut.get(j) ?? [];
          return (
            <div key={j} className="min-w-0 border-l border-line px-1 pb-1.5 pt-2">
              <div className={cx("mb-1 text-center text-[12px] font-semibold", j === today ? "text-accent" : "text-ink-2")}>
                {JOURS_COURTS[rangJour(j)]}{" "}
                <span className={cx("inline-grid h-6 min-w-6 place-items-center rounded-full px-1 tabular", j === today && "bg-accent text-white")}>{Number(j.slice(8, 10))}</span>
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 4).map((it) =>
                  "source" in it ? (
                    <Link key={it.key} href={it.href} title={`${it.source_label} : ${it.title}${it.status ? ` (${it.status})` : ""}`} className={cx("block truncate rounded-md border border-dashed px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-panel-2", it.tone === "danger" ? "border-danger" : "")} style={{ borderColor: it.tone === "danger" ? undefined : it.color }}>
                      {it.title}
                    </Link>
                  ) : (
                    <button key={it.key} type="button" onClick={() => onOuvrir(it)} className={cx("block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-white", it.masked && "ag-masque")} style={{ background: couleur(it) }} aria-label={`${it.title}, journée entière`}>
                      {it.title}
                    </button>
                  ),
                )}
                {items.length > 4 && <span className="block px-1.5 text-[11px] text-muted">+{items.length - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grille horaire */}
      <div ref={defile} className="max-h-[68vh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: colonnes }}>
          <div aria-hidden className="relative" style={{ height: 24 * HAUTEUR_HEURE }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10.5px] tabular text-muted" style={{ top: h * HAUTEUR_HEURE }}>
                {h > 0 ? `${String(h).padStart(2, "0")}:00` : ""}
              </div>
            ))}
          </div>
          <div ref={corps} className="relative grid select-none" style={{ gridColumn: "2 / -1", gridTemplateColumns: `repeat(${jours.length}, minmax(0, 1fr))`, height: 24 * HAUTEUR_HEURE }} onPointerDown={saisirVide} role="region" aria-label="Grille horaire : glissez sur une plage vide pour créer un événement">
            {jours.map((j, col) => {
              const plages = travail[String(rangJour(j))] ?? [];
              return (
                <div key={j} className="relative border-l border-line">
                  {/* Hors des heures de travail : grisé */}
                  <div aria-hidden className="absolute inset-0 bg-panel-2" />
                  {plages.map(([a, b], i) => {
                    const [ha, ma] = a.split(":").map(Number);
                    const [hb, mb] = b.split(":").map(Number);
                    const top = ((ha! * 60 + ma!) / 60) * HAUTEUR_HEURE;
                    return <div key={i} aria-hidden className="absolute inset-x-0 bg-panel" style={{ top, height: ((hb! * 60 + mb!) / 60) * HAUTEUR_HEURE - top }} />;
                  })}
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} aria-hidden className="absolute inset-x-0 border-t border-line/70" style={{ top: h * HAUTEUR_HEURE }} />
                  ))}
                  {(parJour.blocs.get(j) ?? []).map((b) => {
                    const enCours = geste && geste.type !== "creer" && geste.o.key === b.o.key;
                    const largeur = 100 / b.voies;
                    const fin = enCours && geste.type === "etirer" ? geste.fin : b.fin;
                    return (
                      <div
                        key={`${b.o.key}-${j}`}
                        className={cx("absolute overflow-hidden rounded-lg px-1.5 py-1 text-[11.5px] leading-tight text-white shadow-[0_1px_2px_rgb(16_36_31/0.18)] outline-none focus-within:ring-2 focus-within:ring-accent", b.o.masked && "ag-masque", b.o.my_response === "needs_action" && "opacity-80 ring-1 ring-inset ring-white/60", enCours && geste.type === "deplacer" && geste.bouge && "opacity-40")}
                        style={{ top: (b.debut / 60) * HAUTEUR_HEURE + 1, height: Math.max(18, ((fin - b.debut) / 60) * HAUTEUR_HEURE - 2), left: `calc(${b.voie * largeur}% + 2px)`, width: `calc(${largeur}% - 4px)`, background: couleur(b.o) }}
                      >
                        <button
                          type="button"
                          onPointerDown={(e) => saisirEvenement(e, b.o, b, col, false)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOuvrir(b.o);
                            }
                          }}
                          className={cx("block h-full w-full text-left outline-none", b.o.can_edit ? "cursor-grab" : "cursor-pointer")}
                          aria-label={`${b.o.title}, de ${heure(b.o.start)} à ${heure(b.o.stop)}${b.o.location ? `, ${b.o.location}` : ""}`}
                        >
                          <span className="block truncate font-semibold">{b.o.title}</span>
                          <span className="block truncate opacity-90">
                            {heure(b.o.start)} - {heure(b.o.stop)}
                            {b.o.location ? ` · ${b.o.location}` : ""}
                          </span>
                        </button>
                        {b.o.can_edit && <span aria-hidden onPointerDown={(e) => saisirEvenement(e, b.o, b, col, true)} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" />}
                      </div>
                    );
                  })}
                  {geste?.type === "deplacer" && geste.bouge && geste.col === col && (
                    <div aria-hidden className="pointer-events-none absolute inset-x-1 rounded-lg border-2 border-dashed border-accent bg-accent-doux/70 px-1.5 py-1 text-[11px] font-semibold text-accent" style={{ top: (geste.debut / 60) * HAUTEUR_HEURE, height: (geste.duree / 60) * HAUTEUR_HEURE }}>
                      {minutesEnTexte(geste.debut)}
                    </div>
                  )}
                  {geste?.type === "creer" && geste.col === col && geste.bouge && (
                    <div aria-hidden className="pointer-events-none absolute inset-x-1 rounded-lg bg-accent/25 px-1.5 py-1 text-[11px] font-semibold text-accent" style={{ top: (Math.min(geste.debut, geste.fin) / 60) * HAUTEUR_HEURE, height: (Math.abs(geste.fin - geste.debut) / 60) * HAUTEUR_HEURE }}>
                      {minutesEnTexte(Math.min(geste.debut, geste.fin))} - {minutesEnTexte(Math.max(geste.debut, geste.fin))}
                    </div>
                  )}
                  {col === colAujourdhui && (
                    <div aria-hidden className="ag-maintenant pointer-events-none absolute inset-x-0 z-10 h-[2px]" style={{ top: (maintenantMin / 60) * HAUTEUR_HEURE }}>
                      <span className="ag-maintenant absolute -left-1 -top-[4px] h-2.5 w-2.5 rounded-full" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
