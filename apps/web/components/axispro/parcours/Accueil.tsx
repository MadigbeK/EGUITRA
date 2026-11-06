"use client";

import Link from "next/link";
import { Plus } from "@/components/icons";
import { Badge, Card, Empty, Etat, classesBouton, cx } from "@/components/ui";
import { useCabinet } from "@/components/axispro/dossier/commun";
import { usePilotage } from "@/lib/axispro-api";
import { ETAPES, METHODE, dateLongue, salutation, suiviDe } from "@/lib/axispro-parcours";
import type { Pilotage } from "@/lib/axispro-types";
import { fmtDate, fmtFixe, fmtInt } from "@/lib/format";
import { GRILLE_TUILES, LigneProjet, ListeProjets, Surtitre, TITRE_ECRAN, TuileChiffre } from "./commun";

/**
 * Accueil de MB AxisPro Consulting (EC-01) : l'état du portefeuille et les actions du jour, en un appel au
 * pilotage. Le bouton « Nouveau projet » est réservé au profil cabinet (POST /axispro/dossiers) ; le comité
 * et les lecteurs consultent.
 */
export function Accueil() {
  const { data, error, mutate } = usePilotage();
  const { moi, cabinet } = useCabinet();
  const prenom = moi?.name.split(/\s+/)[0] ?? "";
  return (
    <div>
      <header className="mb-5">
        <Surtitre>{dateLongue()}</Surtitre>
        <h1 className={cx(TITRE_ECRAN, "mt-2")} suppressHydrationWarning>
          {salutation()}
          {prenom ? ` ${prenom}` : ""}, voici l&apos;état de vos projets
        </h1>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <p className="max-w-[72ch] text-sm leading-relaxed text-muted">{METHODE}</p>
          <div className="no-print flex flex-wrap items-center gap-2">
            {cabinet && (
              <Link href="/axispro/nouveau" className={classesBouton("primary")}>
                <Plus aria-hidden className="h-4 w-4" /> Nouveau projet
              </Link>
            )}
            <Link href="/axispro/portefeuille" className={classesBouton()}>Ouvrir le portefeuille</Link>
          </div>
        </div>
      </header>
      <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des projets…">
        {(p: Pilotage) => (p.rows.length === 0 ? <SansProjet cabinet={cabinet} /> : <Tableau p={p} />)}
      </Etat>
    </div>
  );
}

/**
 * Sans aucun projet (RG-01-02). « Créer un projet d'exemple » n'est pas proposé : aucune donnée de
 * démonstration en production, règle du projet qui prévaut sur le prototype.
 */
function SansProjet({ cabinet }: { cabinet: boolean }) {
  return (
    <Card>
      <Empty
        title="Aucun projet pour le moment"
        action={cabinet ? <Link href="/axispro/nouveau" className={classesBouton("primary")}>Enregistrer le premier projet</Link> : undefined}
      />
    </Card>
  );
}

function Tableau({ p }: { p: Pilotage }) {
  const c = p.counters;
  return (
    <div className="space-y-4">
      <div className={GRILLE_TUILES}>
        <TuileChiffre label="Projets suivis" valeur={fmtInt(c.projects)} />
        <TuileChiffre label="Promoteurs à relancer" valeur={fmtInt(c.to_chase)} ton={c.to_chase > 0 ? "warn" : "neutral"} />
        <TuileChiffre label="Bloqués par un knock-out" valeur={fmtInt(c.blocked)} ton={c.blocked > 0 ? "danger" : "neutral"} />
        <TuileChiffre label="Prêts pour le comité" valeur={fmtInt(c.ready)} ton={c.ready > 0 ? "ok" : "neutral"} />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ListeProjets
          titre="À relancer aujourd'hui"
          projets={p.to_chase}
          lien="/axispro/portefeuille?filtre=relance"
          vide="Aucun promoteur à relancer aujourd'hui."
          droite={(d) => {
            const s = suiviDe(d.followup, d.state);
            return <Badge tone={s.ton}>{s.label}</Badge>;
          }}
        />
        <ListeProjets
          titre="Prêts pour le comité"
          projets={p.ready}
          vide="Aucun projet ne remplit encore les conditions du gate suivant."
          droite={(d) => <Badge tone="ok">Vers Gate {d.target_gate}</Badge>}
        />
        <ListeProjets
          titre="Bloqués par un knock-out"
          projets={p.blocked}
          lien="/axispro/portefeuille?filtre=bloques"
          vide="Aucun projet bloqué."
          droite={(d) => <Badge tone="danger">{fmtInt(d.knockouts)} KO · Gate {d.gate.index}</Badge>}
        />
        <ListeProjets
          titre="Fiches à compléter"
          projets={p.to_complete}
          vide="Toutes les fiches sont complètes."
          droite={(d) => <Badge tone="neutral">{d.reason}</Badge>}
        />
        <ProjetsParGate lignes={p.by_gate} />
        <Card title="Derniers projets modifiés">
          {p.recent.map((d) => (
            <LigneProjet key={d.id} d={d} droite={<span className="whitespace-nowrap text-[13px] tabular text-muted">{fmtDate(d.updated_at)} · {fmtFixe(d.readiness, 1)}/100</span>} />
          ))}
        </Card>
      </div>
      <Parcours />
    </div>
  );
}

/** Une barre par gate de 0 à 7 ; le gate le plus fourni donne l'échelle. */
function ProjetsParGate({ lignes }: { lignes: Pilotage["by_gate"] }) {
  return (
    <Card title="Projets par gate">
      <ul className="space-y-2">
        {lignes.map((l) => (
          <li key={l.index} className="grid grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_2rem] items-center gap-3 text-[13.5px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="flex-none rounded border border-line bg-panel-2 px-1 font-mono text-[11.5px] text-muted">G{l.index}</span>
              <span className="truncate text-ink-2" title={l.name}>{l.name}</span>
            </span>
            <span className="block h-3 overflow-hidden rounded bg-panel-3" aria-hidden>
              <span className="block h-full rounded bg-accent" style={{ width: `${l.pct}%` }} />
            </span>
            <span className="text-right font-semibold tabular text-ink">{fmtInt(l.count)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Les 7 étapes, texte fixe (annexe E). */
function Parcours() {
  return (
    <Card title="Le parcours d'évaluation">
      <p className="mb-3 text-[13.5px] text-muted">Chaque projet suit ces 7 étapes, accessibles depuis la barre d&apos;étapes de son dossier.</p>
      <ol className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        {ETAPES.map((e) => (
          <li key={e.n} className="min-w-0 rounded-xl border border-line p-3.5">
            <div className="font-mono text-[11.5px] uppercase text-accent">Étape {e.n}</div>
            <div className="mt-1 text-[14px] font-semibold text-ink">{e.nom}</div>
            <p className="mt-1 text-[12.5px] leading-snug text-muted">{e.texte}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
