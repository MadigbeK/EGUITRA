"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Plus, Search, Sun } from "@/components/icons";
import { Button, ErrorBox, Loading, Modal, Notice, Segmented, cx } from "@/components/ui";
import { apiGet, apiSend, messageErreur, useApi } from "@/lib/api-client";
import {
  JOURS_COURTS,
  heure,
  instantDe,
  jourDe,
  jourLong,
  jours as suiteDeJours,
  lireInstant,
  lundiDe,
  moisLong,
  moisSuivant,
  premierDuMois,
  rangJour,
  versApi,
  type AgendaMe,
  type Calendrier,
  type DetailEvenement as Detail,
  type ElementSource,
  type Occurrence,
  type Portee,
  type Vue,
  couleurDe,
} from "@/lib/agenda";
import { aujourdhui, decalerJours } from "@/lib/format";
import { DetailEvenement } from "./DetailEvenement";
import { FenetreEvenement, type Brouillon } from "./FenetreEvenement";
import { VueGrille } from "./VueGrille";
import { VueListe, VueMois } from "./VueMois";
import { VuePlanning } from "./VuePlanning";

const CLE_CALQUES = "nimova.agenda.calques";
const CLE_THEME = "nimova.agenda.theme";
const VUES: Array<{ key: Vue; label: string; touche: string }> = [
  { key: "jour", label: "Jour", touche: "1" },
  { key: "semaine", label: "Semaine", touche: "2" },
  { key: "travail", label: "Semaine de travail", touche: "3" },
  { key: "mois", label: "Mois", touche: "4" },
  { key: "liste", label: "Agenda", touche: "5" },
  { key: "planning", label: "Planning", touche: "6" },
];

function bornes(vue: Vue, jour: string): { debut: string; nb: number } {
  if (vue === "semaine") return { debut: lundiDe(jour), nb: 7 };
  if (vue === "travail") return { debut: lundiDe(jour), nb: 5 };
  if (vue === "mois") return { debut: lundiDe(premierDuMois(jour)), nb: 42 };
  if (vue === "liste") return { debut: jour, nb: 30 };
  return { debut: jour, nb: 1 };
}

function deplacer(vue: Vue, jour: string, sens: 1 | -1): string {
  if (vue === "semaine" || vue === "travail") return decalerJours(jour, 7 * sens);
  if (vue === "mois") return moisSuivant(jour, sens);
  if (vue === "liste") return decalerJours(jour, 30 * sens);
  return decalerJours(jour, sens);
}

function titreDe(vue: Vue, jour: string): string {
  const { debut, nb } = bornes(vue, jour);
  if (vue === "mois") return moisLong(jour);
  if (vue === "semaine" || vue === "travail") {
    const fin = decalerJours(debut, nb - 1);
    return `Semaine du ${jourLong(debut).replace(/^\S+ /, "")} au ${jourLong(fin, true).replace(/^\S+ /, "")}`;
  }
  if (vue === "liste") return `À partir du ${jourLong(jour, true).replace(/^\S+ /, "")}`;
  return jourLong(jour, true);
}

function calquesParDefaut(me: AgendaMe): number[] {
  return me.calendars.filter((c) => c.kind !== "resource" && c.level !== "freebusy").map((c) => c.id);
}

/**
 * NIMOVA · Agenda : panneau latéral (mini-calendrier, agendas visibles, sources métier), barre d'outils
 * (aujourd'hui, précédent et suivant, vues, recherche, nouvel événement, mode nuit) et la vue choisie.
 * Clavier : t aujourd'hui, j ou flèche droite suivant, k ou flèche gauche précédent, n nouvel événement,
 * 1 à 6 les vues, / la recherche. Sous 768 pixels, l'écran s'ouvre sur la vue Agenda.
 */
export function Agenda({ vueInitiale }: { vueInitiale?: Vue }) {
  const { data: me, error, mutate: relireMe } = useApi<AgendaMe>("/agenda/me");
  if (error) return <ErrorBox error={error} onRetry={() => void relireMe()} />;
  if (!me) return <Loading label="Chargement de l'agenda…" />;
  return <AgendaPret me={me} vueInitiale={vueInitiale} relireMe={() => void relireMe()} />;
}

function AgendaPret({ me, vueInitiale, relireMe }: { me: AgendaMe; vueInitiale?: Vue; relireMe: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const [vue, setVue] = useState<Vue>(vueInitiale ?? "semaine");
  const [jour, setJour] = useState(aujourdhui());
  const [calques, setCalques] = useState<number[]>(() => calquesParDefaut(me));
  const [sombre, setSombre] = useState(false);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [ouvert, setOuvert] = useState<{ id: number; occurrence: string | null } | null>(null);
  const [annonce, setAnnonce] = useState<{ ton: "ok" | "danger" | "warn"; texte: string } | null>(null);
  const [aDeplacer, setADeplacer] = useState<{ o: Occurrence; debut: Date; fin: Date } | null>(null);
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<Occurrence[] | null>(null);
  const [panneau, setPanneau] = useState(false);
  const champRecherche = useRef<HTMLInputElement>(null);

  // Préférences du poste : agendas cochés, mode nuit ; vue Agenda au téléphone.
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(CLE_CALQUES) ?? "null") as unknown;
      if (Array.isArray(v)) setCalques(v.filter((x): x is number => typeof x === "number"));
      const t = window.localStorage.getItem(CLE_THEME);
      setSombre(t ? t === "sombre" : window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch {
      /* stockage indisponible : valeurs par défaut */
    }
    if (!vueInitiale && window.innerWidth < 768) setVue("liste");
  }, [vueInitiale]);
  const garder = (cle: string, valeur: string) => {
    try {
      window.localStorage.setItem(cle, valeur);
    } catch {
      /* stockage refusé */
    }
  };

  // Liens entrants : ?evenement=…&occurrence=… ouvre une fiche, ?nouveau=1&model=…&id=… un formulaire lié.
  useEffect(() => {
    const id = Number(params.get("evenement"));
    if (Number.isInteger(id) && id > 0) setOuvert({ id, occurrence: params.get("occurrence") });
    if (params.get("nouveau")) {
      const debut = new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000);
      setBrouillon({ mode: "creer", debut, fin: new Date(debut.getTime() + 3_600_000), res_model: params.get("model") ?? undefined, res_id: Number(params.get("id")) || undefined, titre: params.get("titre") ?? undefined });
    }
  }, [params]);

  const calendriers = useMemo(() => new Map<number, Calendrier>(me.calendars.map((c) => [c.id, c])), [me.calendars]);
  const { debut, nb } = bornes(vue, jour);
  const lesJours = useMemo(() => suiteDeJours(debut, nb), [debut, nb]);
  const visibles = calques.filter((id) => calendriers.has(id));
  const cleEvenements = vue === "planning" || !visibles.length ? null : `/agenda/events?start=${versApi(instantDe(debut))}&end=${versApi(instantDe(decalerJours(debut, nb)))}&calendars=${visibles.join(",")}`;
  const evenements = useApi<{ events: Occurrence[] }>(cleEvenements, { keepPreviousData: true });
  const sourcesAffichees = me.sources.filter((s) => s.shown);
  const cleSources = vue === "planning" || !sourcesAffichees.length ? null : `/agenda/sources?start=${debut}&end=${decalerJours(debut, nb - 1)}`;
  const sources = useApi<{ items: ElementSource[] }>(cleSources, { keepPreviousData: true });
  const couleur = useCallback((o: Occurrence) => couleurDe(o, calendriers), [calendriers]);
  const occurrences = evenements.data?.events ?? [];
  const elements = sources.data?.items ?? [];

  const relire = useCallback(() => {
    void evenements.mutate();
    void sources.mutate();
  }, [evenements, sources]);

  const nouveau = useCallback((d?: Date, f?: Date, allday?: boolean) => {
    const s = d ?? instantDe(jour, Math.max(8 * 60, Math.ceil(((Date.now() / 60_000) % 1440) / 30) * 30));
    setBrouillon({ mode: "creer", debut: s, fin: f ?? new Date(s.getTime() + 3_600_000), allday });
  }, [jour]);

  // Raccourcis clavier, hors des champs de saisie et des fenêtres ouvertes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (cible && (cible.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const vueTouche = VUES.find((v) => v.touche === e.key);
      if (vueTouche) return setVue(vueTouche.key);
      if (e.key === "t") return setJour(aujourdhui());
      if (e.key === "j" || e.key === "ArrowRight") return setJour((j) => deplacer(vue, j, 1));
      if (e.key === "k" || e.key === "ArrowLeft") return setJour((j) => deplacer(vue, j, -1));
      if (e.key === "n") {
        e.preventDefault();
        return nouveau();
      }
      if (e.key === "/") {
        e.preventDefault();
        champRecherche.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vue, nouveau]);

  // Recherche : titre, lieu, description, dans les agendas lus en détail.
  useEffect(() => {
    const texte = q.trim();
    if (texte.length < 2) {
      setResultats(null);
      return;
    }
    const t = window.setTimeout(() => {
      apiGet<Occurrence[]>(`/agenda/search?q=${encodeURIComponent(texte)}`).then(setResultats).catch(() => setResultats([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  function basculerCalque(id: number) {
    setCalques((l) => {
      const v = l.includes(id) ? l.filter((x) => x !== id) : [...l, id];
      garder(CLE_CALQUES, JSON.stringify(v));
      return v;
    });
  }

  async function basculerSource(code: string) {
    const codes = me.sources.filter((s) => (s.code === code ? !s.shown : s.shown)).map((s) => s.code);
    try {
      await apiSend("PATCH", "/agenda/preferences", { sources: codes });
      relireMe();
    } catch (e) {
      setAnnonce({ ton: "danger", texte: messageErreur(e) });
    }
  }

  function demanderDeplacement(o: Occurrence, d: Date, f: Date) {
    if (o.recurring && !o.exception) return setADeplacer({ o, debut: d, fin: f });
    void confirmerDeplacement(o, d, f, o.exception ? "this" : "all");
  }

  async function confirmerDeplacement(o: Occurrence, d: Date, f: Date, portee: Portee) {
    setADeplacer(null);
    try {
      const r = await apiSend<{ conflicts: Array<{ message: string }> }>("PATCH", `/agenda/events/${o.id}`, { start: versApi(d), stop: versApi(f), allday: false, scope: portee, occurrence: o.occurrence });
      setAnnonce(r.conflicts.length ? { ton: "warn", texte: `Déplacé. ${r.conflicts.map((c) => c.message).join(" ")}` } : { ton: "ok", texte: `« ${o.title} » déplacé au ${jourLong(jourDe(d))}, ${heure(d)}.` });
    } catch (e) {
      setAnnonce({ ton: "danger", texte: messageErreur(e) });
    }
    relire();
  }

  const ouvrir = (o: Occurrence) => setOuvert({ id: o.id, occurrence: o.series_id && !o.exception ? o.occurrence : null });
  const groupes: Array<[string, Calendrier[]]> = [
    ["Mes agendas", me.calendars.filter((c) => c.mine && c.kind !== "resource")],
    ["Agendas délégués", me.calendars.filter((c) => c.level === "manage")],
    ["Agendas partagés", me.calendars.filter((c) => !c.mine && c.kind !== "resource" && c.level !== "manage")],
    ["Ressources", me.calendars.filter((c) => c.kind === "resource")],
  ];

  const lateral = (
    <aside aria-label="Agendas" className="space-y-5">
      <Button variant="primary" className="w-full" onClick={() => nouveau()}>
        <Plus className="h-4 w-4" /> Nouvel événement
      </Button>
      <MiniCalendrier jour={jour} onJour={(j) => { setJour(j); setPanneau(false); }} />
      {groupes.map(([titre, liste]) =>
        liste.length ? (
          <section key={titre}>
            <h2 className="mb-1.5 text-[12px] font-semibold text-muted">{titre}</h2>
            <ul className="space-y-0.5">
              {liste.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] hover:bg-panel-2">
                    <input type="checkbox" checked={calques.includes(c.id)} onChange={() => basculerCalque(c.id)} className="h-4 w-4 flex-none" style={{ accentColor: c.color }} />
                    <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: c.color }} />
                    <span className="min-w-0 flex-1 truncate">{c.kind === "personal" && c.mine ? "Mon agenda" : c.name}</span>
                    {!c.mine && c.kind !== "resource" && <span className="text-[11px] text-muted">{c.level_label}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {me.sources.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-[12px] font-semibold text-muted">Échéances des modules</h2>
          <ul className="space-y-0.5">
            {me.sources.map((s) => (
              <li key={s.code}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] hover:bg-panel-2">
                  <input type="checkbox" checked={s.shown} onChange={() => void basculerSource(s.code)} className="h-4 w-4 flex-none" style={{ accentColor: s.color }} />
                  <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-sm border-2 border-dashed" style={{ borderColor: s.color }} />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      {me.preferences.ooo.active && <Notice tone="warn">Absence du bureau programmée : les invitations reçues pendant l&apos;absence {me.preferences.ooo.auto_decline ? "sont refusées d'office" : "sont signalées aux invitants"}.</Notice>}
    </aside>
  );

  return (
    <div data-theme={sombre ? "sombre" : undefined} className={cx("-m-4 min-h-[calc(100vh-4rem)] p-4 transition-colors sm:-m-6 sm:p-6 md:-my-8 md:py-8 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10", sombre && "bg-bg text-ink")}>
      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <div className="hidden lg:block">{lateral}</div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button className="lg:hidden" onClick={() => setPanneau(true)} aria-label="Afficher les agendas">Agendas</Button>
            <Button onClick={() => setJour(aujourdhui())} title="Aujourd'hui (t)">Aujourd&apos;hui</Button>
            <div className="flex">
              <button type="button" onClick={() => setJour((j) => deplacer(vue, j, -1))} className="grid h-9 w-9 place-items-center rounded-l-xl border border-line bg-panel text-ink-2 hover:bg-panel-2" aria-label="Période précédente (k)">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setJour((j) => deplacer(vue, j, 1))} className="grid h-9 w-9 place-items-center rounded-r-xl border border-l-0 border-line bg-panel text-ink-2 hover:bg-panel-2" aria-label="Période suivante (j)">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <h1 className="min-w-0 flex-1 truncate font-display text-[20px] font-bold capitalize text-ink" aria-live="polite">{titreDe(vue, jour)}</h1>
            <div className="relative w-full sm:w-64">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input ref={champRecherche} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (/)" aria-label="Rechercher un événement" className="min-h-9 w-full rounded-[10px] border border-line-champ bg-panel py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15" />
              {resultats && (
                <ul className="absolute right-0 top-full z-30 mt-1 max-h-80 w-full min-w-72 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-[var(--ombre-flottante)]">
                  {resultats.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">Aucun événement ne correspond.</li>}
                  {resultats.map((r) => (
                    <li key={r.key}>
                      <button type="button" className="w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-panel-2" onClick={() => { ouvrir(r); setJour(jourDe(lireInstant(r.start))); setQ(""); }}>
                        <span className="block truncate text-[13px] font-semibold">{r.title}</span>
                        <span className="block text-[11.5px] capitalize text-muted">{jourLong(jourDe(lireInstant(r.start)), true)}{r.allday ? "" : `, ${heure(r.start)}`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" onClick={() => setSombre((s) => { garder(CLE_THEME, s ? "clair" : "sombre"); return !s; })} aria-pressed={sombre} title={sombre ? "Repasser en clair" : "Mode nuit"} className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-panel text-ink-2 hover:bg-panel-2">
              {sombre ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="sr-only">{sombre ? "Repasser en clair" : "Mode nuit"}</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <Segmented label="Vue" value={vue} onChange={setVue} options={VUES.map((v) => ({ key: v.key, label: v.label }))} />
          </div>
          {annonce && (
            <div role="status">
              <Notice tone={annonce.ton}>{annonce.texte}</Notice>
            </div>
          )}
          {evenements.error && <ErrorBox error={evenements.error} onRetry={relire} />}
          {!visibles.length && vue !== "planning" && <Notice tone="accent">Aucun agenda coché : cochez au moins un agenda dans le panneau.</Notice>}
          {vue === "planning" ? (
            <VuePlanning me={me} jour={jour} />
          ) : vue === "mois" ? (
            <VueMois jours={lesJours} mois={jour} occurrences={occurrences} sources={elements} couleur={couleur} onOuvrir={ouvrir} onJour={(j) => { setJour(j); setVue("jour"); }} onCreer={nouveau} />
          ) : vue === "liste" ? (
            <VueListe jours={lesJours} occurrences={occurrences} sources={elements} couleur={couleur} onOuvrir={ouvrir} />
          ) : (
            <VueGrille jours={lesJours} occurrences={occurrences} sources={elements} couleur={couleur} travail={me.preferences.work_hours} onOuvrir={ouvrir} onCreer={nouveau} onDeplacer={demanderDeplacement} />
          )}
          <p className="text-[12px] text-muted">Raccourcis : t aujourd&apos;hui · j et k (ou les flèches) période suivante et précédente · n nouvel événement · 1 à 6 les vues · / recherche.</p>
        </div>
      </div>

      {panneau && (
        <Modal open title="Agendas" onClose={() => setPanneau(false)}>
          {lateral}
        </Modal>
      )}
      {brouillon && (
        <FenetreEvenement me={me} brouillon={brouillon} onFermer={() => { setBrouillon(null); if (params.get("nouveau")) router.replace("/agenda"); }} onFait={(r, texte) => {
          setBrouillon(null);
          setAnnonce({ ton: r.conflicts.length || r.warnings.length ? "warn" : "ok", texte });
          if (r.event) setJour(jourDe(lireInstant(r.event.start)));
          relire();
        }} />
      )}
      {ouvert && (
        <DetailEvenement id={ouvert.id} occurrence={ouvert.occurrence} onFermer={() => { setOuvert(null); if (params.get("evenement")) router.replace("/agenda"); }} onChange={() => relire()} onModifier={(d: Detail) => { setOuvert(null); setBrouillon({ mode: "modifier", detail: d }); }} />
      )}
      {aDeplacer && (
        <Modal open title="Déplacer un événement récurrent" onClose={() => { setADeplacer(null); relire(); }} footer={
          <>
            <Button onClick={() => { setADeplacer(null); relire(); }}>Annuler</Button>
            <Button onClick={() => void confirmerDeplacement(aDeplacer.o, aDeplacer.debut, aDeplacer.fin, "all")}>Toute la série</Button>
            <Button onClick={() => void confirmerDeplacement(aDeplacer.o, aDeplacer.debut, aDeplacer.fin, "following")}>Celle-ci et les suivantes</Button>
            <Button variant="primary" onClick={() => void confirmerDeplacement(aDeplacer.o, aDeplacer.debut, aDeplacer.fin, "this")}>Cette occurrence</Button>
          </>
        }>
          <p className="text-[13.5px]">« {aDeplacer.o.title} » vers le {jourLong(jourDe(aDeplacer.debut))}, {heure(aDeplacer.debut)} - {heure(aDeplacer.fin)}.</p>
        </Modal>
      )}
    </div>
  );
}

/** Mini-calendrier du panneau : un mois, le jour affiché et aujourd'hui marqués. */
function MiniCalendrier({ jour, onJour }: { jour: string; onJour: (j: string) => void }) {
  const [mois, setMois] = useState(premierDuMois(jour));
  useEffect(() => setMois(premierDuMois(jour)), [jour]);
  const today = aujourdhui();
  const cases = suiteDeJours(lundiDe(mois), 42);
  return (
    <div className="rounded-2xl border border-line bg-panel p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" aria-label="Mois précédent" onClick={() => setMois((m) => moisSuivant(m, -1))} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-panel-2"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-[13px] font-semibold capitalize">{moisLong(mois)}</span>
        <button type="button" aria-label="Mois suivant" onClick={() => setMois((m) => moisSuivant(m, 1))} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-panel-2"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10.5px] font-semibold text-muted">
        {JOURS_COURTS.map((j) => <span key={j}>{j.slice(0, 2)}</span>)}
      </div>
      <div className="grid grid-cols-7">
        {cases.map((j) => (
          <button key={j} type="button" onClick={() => onJour(j)} aria-label={jourLong(j, true)} aria-current={j === jour ? "date" : undefined} className={cx("m-0.5 grid h-7 place-items-center rounded-full text-[12px] tabular", j === jour ? "bg-accent font-bold text-white" : j === today ? "font-bold text-accent" : j.slice(0, 7) !== mois.slice(0, 7) ? "text-muted/70" : "text-ink-2 hover:bg-panel-2", rangJour(j) > 4 && j !== jour && "opacity-80")}>
            {Number(j.slice(8, 10))}
          </button>
        ))}
      </div>
    </div>
  );
}
