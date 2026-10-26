"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Clock, HandCoins, ListChecks, Users, type Icon } from "@/components/icons";
import { Button, Card, ErrorBox, Loading, cx } from "@/components/ui";
import { EnTete, aujourdhui as aujourdhuiConakry, cleDate, decalerJour, depuisCle, formatConakry, heure, jourConakry } from "@/components/portail/commun";
import { majuscule, pluriel } from "@/components/portail/cabinet-porteur/briques";
import { erreurLisible } from "@/components/portail/projet/outils";
import { useApi } from "@/lib/api-client";
import type { AgendaItem } from "@/lib/portail-types";

type Nature = AgendaItem["kind"];

const NATURES: Record<Nature, { label: string; couleur: string; doux: string; icon: Icon }> = {
  meeting: { label: "Rendez-vous", couleur: "#2d82dc", doux: "#e6f0fc", icon: Clock },
  event: { label: "Événement du cabinet", couleur: "#c4417a", doux: "#fbe7f0", icon: Users },
  action: { label: "Échéance d'action", couleur: "#df8f17", doux: "#fdf1d9", icon: ListChecks },
  funding: { label: "Relance de financement", couleur: "#12956a", doux: "#e2f5ea", icon: HandCoins },
};

const ETATS: Partial<Record<Nature, Record<string, string>>> = {
  meeting: { confirmed: "confirmé", done: "tenu" },
  event: { registered: "vous êtes inscrit", waitlist: "liste d'attente", attended: "présent", absent: "absent", open: "inscriptions ouvertes" },
  action: { todo: "à faire", in_progress: "en cours", submitted: "remise au cabinet", done: "validée" },
  funding: { identified: "piste identifiée", submitted: "dossier déposé", review: "en instruction", agreed: "accord obtenu", signed: "convention signée", disbursed: "fonds versés", rejected: "refusé", withdrawn: "retiré" },
};

const JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** Lien d'un élément : l'événement visé est mis en évidence sur sa page. */
function lien(item: AgendaItem): string {
  if (item.kind === "event") {
    const id = /^event-(\d+)$/.exec(item.key)?.[1];
    if (id && !item.link.includes("#")) return `${item.link}#evenement-${id}`;
  }
  return item.link;
}

/** Jours couverts par un élément, à Conakry (un événement de plusieurs jours apparaît chaque jour, deux semaines au plus). */
function joursDe(item: AgendaItem): string[] {
  const debut = jourConakry(item.start);
  if (item.all_day || !item.end) return [debut];
  const fin = jourConakry(item.end);
  const jours = [debut];
  let cle = debut;
  while (cle < fin && jours.length < 14) {
    cle = decalerJour(cle, 1);
    jours.push(cle);
  }
  return jours;
}

/**
 * Jours de la grille d'un mois (mois de 0 à 11), semaines du lundi au dimanche. Dates du calendrier à midi
 * UTC, lues en UTC : la grille est la même quel que soit le fuseau de l'appareil.
 */
function grille(annee: number, mois: number): Date[] {
  const premier = new Date(Date.UTC(annee, mois, 1, 12));
  const decalage = (premier.getUTCDay() + 6) % 7;
  const nbJours = new Date(Date.UTC(annee, mois + 1, 0, 12)).getUTCDate();
  const semaines = Math.ceil((decalage + nbJours) / 7);
  return Array.from({ length: semaines * 7 }, (_, i) => new Date(Date.UTC(annee, mois, 1 - decalage + i, 12)));
}

const decaler = decalerJour;

/** Année et mois (0 à 11) d'un jour AAAA-MM-JJ. */
function moisDe(cle: string): { annee: number; mois: number } {
  const d = depuisCle(cle);
  return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() };
}

function LigneAgenda({ item }: { item: AgendaItem }) {
  const n = NATURES[item.kind];
  const I = n.icon;
  const etat = ETATS[item.kind]?.[item.state];
  return (
    <Link href={lien(item)} className="group flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-panel-2">
      <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-xl" style={{ background: n.doux, color: n.couleur }}>
        <I className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold leading-snug text-ink group-hover:text-accent">{item.title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted">
          {item.all_day ? "Toute la journée" : item.end ? `${heure(item.start)} à ${heure(item.end)}` : heure(item.start)}
          {item.detail && `, ${item.detail}`}
          {etat && `, ${etat}`}
          {item.dossier && ` · ${item.dossier}`}
        </span>
      </span>
      <span className="sr-only">{n.label}</span>
    </Link>
  );
}

/** Agenda unifié : rendez-vous, événements, échéances d'actions et relances de financement. */
export default function Agenda() {
  const { data, error, mutate } = useApi<AgendaItem[]>("/portail/agenda");
  // « Aujourd'hui » est le jour de Conakry, comme les dates de l'agenda.
  const aujourdhui = aujourdhuiConakry();
  const [curseur, setCurseur] = useState(() => moisDe(aujourdhuiConakry()));
  const [jour, setJour] = useState<string | null>(null);
  const grilleRef = useRef<HTMLDivElement>(null);
  const focaliser = useRef(false);

  const parJour = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const it of data ?? []) {
      for (const j of joursDe(it)) {
        const liste = m.get(j);
        if (liste) liste.push(it);
        else m.set(j, [it]);
      }
    }
    for (const liste of m.values()) liste.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
    return m;
  }, [data]);

  const jours = useMemo(() => grille(curseur.annee, curseur.mois), [curseur]);
  const prefixeMois = `${curseur.annee}-${String(curseur.mois + 1).padStart(2, "0")}`;
  const cleFocus = jour && jour.startsWith(prefixeMois) ? jour : aujourdhui.startsWith(prefixeMois) ? aujourdhui : `${prefixeMois}-01`;

  useEffect(() => {
    if (!focaliser.current) return;
    focaliser.current = false;
    grilleRef.current?.querySelector<HTMLButtonElement>(`[data-jour="${cleFocus}"]`)?.focus();
  }, [cleFocus]);

  function allerAuMois(annee: number, mois: number) {
    const d = new Date(Date.UTC(annee, mois, 1, 12));
    setCurseur({ annee: d.getUTCFullYear(), mois: d.getUTCMonth() });
  }

  function choisir(cle: string, focus = false) {
    const m = moisDe(cle);
    if (m.annee !== curseur.annee || m.mois !== curseur.mois) setCurseur(m);
    focaliser.current = focus;
    setJour(cle);
  }

  function clavier(e: KeyboardEvent<HTMLDivElement>) {
    const pas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const base = cleFocus;
    if (e.key in pas) {
      e.preventDefault();
      choisir(decaler(base, pas[e.key]!), true);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const rang = (depuisCle(base).getUTCDay() + 6) % 7;
      choisir(decaler(base, e.key === "Home" ? -rang : 6 - rang), true);
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const d = depuisCle(base);
      d.setUTCMonth(d.getUTCMonth() + (e.key === "PageUp" ? -1 : 1));
      choisir(cleDate(d), true);
    }
  }

  if (error) return <ErrorBox error={erreurLisible(error)} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Chargement de votre agenda…" />;

  const titreMois = majuscule(formatConakry(new Date(Date.UTC(curseur.annee, curseur.mois, 1, 12)), { month: "long", year: "numeric" }));
  const duMois = data.filter((it) => joursDe(it).some((j) => j.startsWith(prefixeMois)));
  const compteNature = (k: Nature) => duMois.filter((it) => it.kind === k).length;

  const prochains: Array<{ cle: string; items: AgendaItem[] }> = [];
  let total = 0;
  for (const cle of [...parJour.keys()].filter((k) => k >= aujourdhui).sort()) {
    if (total >= 14) break;
    const items = parJour.get(cle) ?? [];
    prochains.push({ cle, items });
    total += items.length;
  }
  const duJour = jour ? parJour.get(jour) ?? [] : [];

  return (
    <div className="space-y-6">
      <EnTete
        surtitre="Échanges"
        titre="Agenda"
        texte="Vos rendez-vous, les événements du cabinet, les échéances de vos actions et les relances de financement, réunis sur un seul calendrier."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
            <h2 aria-live="polite" className="mr-auto font-display text-[20px] font-bold text-ink">{titreMois}</h2>
            <Button
              variant="ghost"
              onClick={() => {
                const m = moisDe(aujourdhui);
                allerAuMois(m.annee, m.mois);
                setJour(aujourdhui);
              }}
            >
              Aujourd'hui
            </Button>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => allerAuMois(curseur.annee, curseur.mois - 1)} aria-label="Mois précédent" className="grid h-9 w-9 place-items-center rounded-xl border border-line text-ink-2 hover:bg-panel-2">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => allerAuMois(curseur.annee, curseur.mois + 1)} aria-label="Mois suivant" className="grid h-9 w-9 place-items-center rounded-xl border border-line text-ink-2 hover:bg-panel-2">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="px-2 pb-3 sm:px-4">
            <div aria-hidden className="grid grid-cols-7 pb-1.5">
              {JOURS.map((j, i) => (
                <span key={j} className={cx("text-center text-[11.5px] font-semibold uppercase tracking-[0.06em]", i >= 5 ? "text-muted/70" : "text-muted")}>{j}</span>
              ))}
            </div>
            <div ref={grilleRef} role="group" aria-label={`Calendrier de ${titreMois}. Flèches pour changer de jour, Page précédente et Page suivante pour changer de mois.`} onKeyDown={clavier} className="grid grid-cols-7 gap-1">
              {jours.map((d) => {
                const cle = cleDate(d);
                const items = parJour.get(cle) ?? [];
                const horsMois = d.getUTCMonth() !== curseur.mois;
                const estAujourdhui = cle === aujourdhui;
                const choisi = cle === jour;
                const libelle = `${majuscule(formatConakry(d, { weekday: "long", day: "numeric", month: "long" }))}${estAujourdhui ? ", aujourd'hui" : ""}, ${items.length ? pluriel(items.length, "élément") : "rien de prévu"}`;
                return (
                  <button
                    key={cle}
                    type="button"
                    data-jour={cle}
                    tabIndex={cle === cleFocus ? 0 : -1}
                    aria-pressed={choisi}
                    aria-label={libelle}
                    onClick={() => choisir(cle)}
                    className={cx(
                      "group relative flex h-14 flex-col items-stretch rounded-xl p-1 text-left transition-colors sm:h-[92px] sm:p-1.5",
                      choisi ? "bg-accent-doux ring-2 ring-accent-vif" : "hover:bg-panel-2",
                      horsMois && !choisi && "opacity-45",
                    )}
                  >
                    <span
                      className={cx(
                        "grid h-6 w-6 place-items-center self-center rounded-full text-[12.5px] font-semibold tabular sm:self-start",
                        estAujourdhui ? "bg-accent text-white" : choisi ? "text-accent" : "text-ink-2",
                      )}
                    >
                      {d.getUTCDate()}
                    </span>
                    {items.length > 0 && (
                      <>
                        <span aria-hidden className="mt-auto flex justify-center gap-0.5 pb-0.5 sm:hidden">
                          {items.slice(0, 3).map((it, i) => (
                            <span key={`${it.key}-${i}`} className="h-1.5 w-1.5 rounded-full" style={{ background: NATURES[it.kind].couleur }} />
                          ))}
                        </span>
                        <span aria-hidden className="mt-1 hidden min-w-0 space-y-0.5 sm:block">
                          {items.slice(0, 2).map((it, i) => (
                            <span key={`${it.key}-${i}`} className="block truncate rounded-[5px] px-1.5 py-px text-[11px] font-medium leading-4" style={{ background: NATURES[it.kind].doux, color: "var(--ink)", boxShadow: `inset 2px 0 0 ${NATURES[it.kind].couleur}` }}>
                              {it.title}
                            </span>
                          ))}
                          {items.length > 2 && <span className="block px-1.5 text-[10.5px] font-semibold text-muted">+{items.length - 2}</span>}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <ul className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line px-4 py-3.5 text-[12.5px] text-ink-2 sm:px-6" aria-label="Légende">
            {(Object.keys(NATURES) as Nature[]).map((k) => (
              <li key={k} className="inline-flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: NATURES[k].couleur }} />
                {NATURES[k].label}
                <span className="tabular text-muted">{compteNature(k)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <aside>
          <Card
            title={jour ? majuscule(formatConakry(depuisCle(jour), { weekday: "long", day: "numeric", month: "long" })) : "Prochainement"}
            actions={
              jour ? (
                <button type="button" onClick={() => setJour(null)} className="text-[13px] font-semibold text-accent hover:underline">
                  Prochains jours
                </button>
              ) : undefined
            }
          >
            {jour ? (
              duJour.length === 0 ? (
                <p className="text-[13.5px] leading-relaxed text-muted">
                  Rien de prévu ce jour-là.{" "}
                  {jour >= aujourdhui && (
                    <Link href="/portail/rendez-vous" className="font-semibold text-accent hover:underline">
                      Demander un rendez-vous
                    </Link>
                  )}
                </p>
              ) : (
                <ul className="-mx-2.5 space-y-0.5">
                  {duJour.map((it, i) => (
                    <li key={`${it.key}-${i}`}>
                      <LigneAgenda item={it} />
                    </li>
                  ))}
                </ul>
              )
            ) : prochains.length === 0 ? (
              <p className="text-[13.5px] leading-relaxed text-muted">
                Aucun rendez-vous ni échéance à venir.{" "}
                <Link href="/portail/rendez-vous" className="font-semibold text-accent hover:underline">
                  Demander un rendez-vous
                </Link>{" "}
                ou{" "}
                <Link href="/portail/evenements" className="font-semibold text-accent hover:underline">
                  voir les événements
                </Link>
                .
              </p>
            ) : (
              <ol className="space-y-4">
                {prochains.map((g) => (
                  <li key={g.cle}>
                    <button type="button" onClick={() => choisir(g.cle)} className="mb-1 text-[12px] font-bold uppercase tracking-[0.08em] text-muted hover:text-accent">
                      {g.cle === aujourdhui ? "Aujourd'hui" : g.cle === decaler(aujourdhui, 1) ? "Demain" : formatConakry(depuisCle(g.cle), { weekday: "long", day: "numeric", month: "long" })}
                    </button>
                    <ul className="-mx-2.5 space-y-0.5">
                      {g.items.map((it, i) => (
                        <li key={`${it.key}-${i}`}>
                          <LigneAgenda item={it} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted">
            L'agenda couvre les 45 derniers jours et les huit prochains mois. Les rendez-vous en attente de confirmation figurent dans « Rendez-vous ».
          </p>
        </aside>
      </div>
    </div>
  );
}
