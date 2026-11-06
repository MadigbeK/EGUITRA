"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Check, ChevronLeft, Lock } from "@/components/icons";
import { Badge, Etat, Notice, classesBouton, cx } from "@/components/ui";
import { BoutonDiscussion } from "@/components/discussions/BoutonDiscussion";
import { MenuPlus, useCabinet } from "@/components/axispro/dossier/commun";
import { useDataRoomAncienne, useDossierDetail } from "@/lib/axispro-api";
import { OUTILS, classificationDe, estV2, etatsEtapes, gateDe, nomGate, suiviDe } from "@/lib/axispro-parcours";
import type { DossierDetail, Scoring } from "@/lib/axispro-types";
import { Surtitre, TITRE_ECRAN, intituleDe } from "./commun";

interface Contexte {
  d: DossierDetail;
  /** Relit le dossier auprès du noyau : en-tête, barre d'étapes et scores se mettent à jour. */
  relire: () => void;
  /** Reporte aussitôt les indicateurs renvoyés par le noyau après la notation d'un critère. */
  majScoring: (s: Scoring) => void;
  /** Le compte écrit dans ce dossier : profil cabinet, décision non scellée, dossier non clos. */
  peutEcrire: boolean;
  /** Une fiche modifiée et non enregistrée retient le changement d'étape au premier clic. */
  signalerModifie: (modifie: boolean) => void;
}

const Ctx = createContext<Contexte | null>(null);

/** Dossier ouvert du parcours : l'en-tête et la barre des 7 étapes le lisent, chaque étape le reçoit d'ici. */
export function useDossier(): Contexte {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDossier hors de DossierParcours");
  return c;
}

const Garde = createContext<(() => boolean) | null>(null);

/**
 * Lien du dossier : avec des modifications non enregistrées, le premier clic avertit et reste sur place,
 * le second abandonne les modifications (EC-05).
 */
export function LienGarde({ onClick, ...props }: ComponentProps<typeof Link>) {
  const passer = useContext(Garde);
  return (
    <Link
      {...props}
      onClick={(e) => {
        if (passer && !passer()) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}

/**
 * En-tête commun et barre des 7 étapes du dossier (EC-05, section 6.12), autour de l'étape ouverte. Chaque
 * étape a sa route ; le cadre de l'application se remonte à chaque navigation, le cache garde le dossier lu.
 */
export function DossierParcours({ id, children }: { id: string; children: ReactNode }) {
  const { data, error, mutate } = useDossierDetail(id);
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement du projet…">
      {(d: DossierDetail) => (
        <Cadre
          d={d}
          relire={() => void mutate()}
          majScoring={(s) => void mutate((avant) => (avant ? { ...avant, scoring: s, readiness: s.readiness, apd: s.apd, bankability: s.bankability, classification: s.classification, knockouts: s.knockouts.length, progress: { assessed: s.assessed, criteria: s.criteria } } : avant), { revalidate: false })}
        >
          {children}
        </Cadre>
      )}
    </Etat>
  );
}

function Cadre({ d, relire, majScoring, children }: { d: DossierDetail; relire: () => void; majScoring: (s: Scoring) => void; children: ReactNode }) {
  const { cabinet } = useCabinet();
  // Barre d'étapes : le noyau sert les états de la grille SC-01 V2 ; l'ancienne méthode compte ses pièces ici.
  const { data: salle } = useDataRoomAncienne(d.id, !estV2(d));
  const nbPieces = salle?.files.length ?? null;
  const [modifie, setModifie] = useState(false);
  const [averti, setAverti] = useState(false);

  const signalerModifie = useCallback((m: boolean) => {
    setModifie(m);
    if (!m) setAverti(false);
  }, []);
  const passer = useCallback(() => {
    if (!modifie || averti) return true;
    setAverti(true);
    return false;
  }, [modifie, averti]);

  const peutEcrire = cabinet && !d.locked && d.state !== "closed";
  const valeur = useMemo(() => ({ d, relire, majScoring, peutEcrire, signalerModifie }), [d, relire, majScoring, peutEcrire, signalerModifie]);

  return (
    <Ctx.Provider value={valeur}>
      <Garde.Provider value={passer}>
        <EnTete d={d} />
        <BarreEtapes d={d} nbPieces={nbPieces} />
        {averti && modifie && <div className="mb-4"><Notice tone="warn">Modifications non enregistrées : enregistrez la fiche, ou cliquez de nouveau pour les abandonner.</Notice></div>}
        {d.state === "closed" && <div className="mb-4"><Notice tone="neutral">Projet clos : il se consulte, mais ne se note plus et ne reçoit plus de décision du comité tant qu&apos;il n&apos;est pas repris.</Notice></div>}
        {d.locked && d.state !== "closed" && (
          <div className="mb-4">
            <Notice tone="warn">
              <span className="inline-flex items-center gap-1.5"><Lock aria-hidden className="h-4 w-4 flex-none" /> Décision scellée : le dossier se consulte. Une nouvelle révision s&apos;ouvre depuis les outils du cabinet (Revues scellées).</span>
            </Notice>
          </div>
        )}
        {children}
      </Garde.Provider>
    </Ctx.Provider>
  );
}

function EnTete({ d }: { d: DossierDetail }) {
  const g = gateDe(d);
  const classe = classificationDe(d);
  const suivi = suiviDe(d.followup, d.state);
  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <LienGarde href="/axispro/portefeuille" className="inline-flex min-h-[42px] items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">
          <ChevronLeft aria-hidden className="h-4 w-4" /> Portefeuille
        </LienGarde>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={classe.ton}>{classe.label}</Badge>
          {suivi.label !== "–" && <Badge tone={suivi.ton}>{suivi.label}</Badge>}
        </div>
      </div>
      <Surtitre className="mt-1">{d.reference} · Gate {g} · {nomGate(g, d.gates)}</Surtitre>
      <h1 className={cx(TITRE_ECRAN, "mt-1.5")}>{intituleDe(d)}</h1>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-[14.5px] text-muted">{d.promoter?.name || "Promoteur à renseigner"}</p>
        <div className="no-print ml-auto flex flex-wrap items-center gap-2">
          <BoutonDiscussion model="axispro.dossier" id={d.id} libelle={`${d.reference} ${d.name}`} />
          <MenuPlus label="Outils du cabinet">
            {OUTILS.map((o) => (
              <LienGarde key={o.cle} href={`/axispro/dossiers/${d.id}/outils?onglet=${o.cle}`} className={classesBouton("ghost", "sm", "justify-start")}>
                {o.nom}
              </LienGarde>
            ))}
          </MenuPlus>
        </div>
      </div>
    </header>
  );
}

/** Barre des 7 étapes : quatre colonnes sous 900 pixels, deux sous 480 (EC-12). */
function BarreEtapes({ d, nbPieces }: { d: DossierDetail; nbPieces: number | null }) {
  const chemin = usePathname();
  const active = chemin.split("/").pop();
  return (
    <nav aria-label="Étapes du dossier" className="no-print mb-5 grid grid-cols-2 gap-2 min-[480px]:grid-cols-4 min-[900px]:grid-cols-7">
      {etatsEtapes(d, nbPieces).map((e) => (
        <LienGarde
          key={e.cle}
          href={`/axispro/dossiers/${d.id}/${e.cle}`}
          aria-current={active === e.cle ? "step" : undefined}
          className={cx("block min-h-[42px] min-w-0 rounded-xl border bg-panel px-3 py-2.5 transition-colors hover:border-accent", active === e.cle ? "border-accent ring-1 ring-accent" : "border-line")}
        >
          <span className={cx("flex items-center gap-1 font-mono text-[11.5px] uppercase", e.termine ? "text-ok-texte" : "text-muted")}>
            Étape {e.n}
            {e.termine && (
              <>
                <span aria-hidden>·</span>
                <Check aria-hidden className="h-3 w-3" />
                <span className="sr-only">terminée</span>
              </>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[13.5px] font-semibold text-ink">{e.nom}</span>
          <span className="block truncate text-[12.5px] text-muted">{e.etat}</span>
        </LienGarde>
      ))}
    </nav>
  );
}
