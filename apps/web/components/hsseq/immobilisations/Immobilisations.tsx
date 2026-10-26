"use client";

/**
 * HSSEQ, « Immobilisations » (motif V09 du verrou de départ) : véhicules immobilisés par le Responsable
 * HSSEQ le temps de l'enquête d'un événement de criticité élevée, puis l'historique des remises en
 * service (GET /hsseq/immobilizations). Lecture : administration, direction, Responsable HSSEQ, chef de
 * parc et auditeur (leurs sites). La remise en service (POST /hsseq/vehicles/{id}/release, motif écrit
 * obligatoire) ne s'affiche que si la ligne la propose (`transitions`). Filtres portés par l'adresse :
 * evenement (lien de la fiche d'un événement), vehicule.
 */

import Link from "next/link";
import { useState } from "react";
import { Lock, LockOpen, X } from "@/components/icons";
import { Button, Card, DataTable, Empty, ErrorBox, Etat, FEUILLE, Field, Modal, Notice, Textarea, cx, type Tri } from "@/components/ui";
import { NIVEAUX, TYPE_VEHICULE, Tampon, texteErreur } from "@/components/hsseq/commun";
import { Pages, requete, useAdresse } from "@/components/hsseq/actions/outils";
import { codeErreur } from "@/components/transport/departs/motifs";
import { momentCk } from "@/components/hsseq/trajets/outils";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import type { Page, ReasonSetting } from "@/lib/hsseq-types";
import { TamponImmobilisation, dureeEntre, effetVerrou, useMotifV09 } from "./elements";
import type { Immobilization, ImmobilizationCounts } from "./types";

type PageImmobilisations = Page<Immobilization, ImmobilizationCounts>;

/** Remises en service par page d'historique. */
const PAR_PAGE = 20;

const LIEN = "font-semibold text-accent underline-offset-2 hover:underline";

/**
 * Masque les colonnes secondaires de l'historique sur petit écran, en-tête compris : l'immobilisation
 * (3e colonne, la durée reste dans la remise en service) sous 640 px, le motif de la levée (5e) sous 768 px.
 */
const COLONNES_TELEPHONE = "max-sm:[&_tr>:nth-child(3)]:hidden max-md:[&_tr>:nth-child(5)]:hidden";

export function Immobilisations() {
  const { lire, ecrire } = useAdresse();
  const evenement = Number(lire("evenement") || lire("event_id")) || null;
  const vehicule = Number(lire("vehicule") || lire("vehicle_id")) || null;
  const filtres = { event_id: evenement, vehicle_id: vehicule };
  const [tri, setTri] = useState<Tri>({ key: "since", dir: -1 });
  const cle = `${requete(filtres)}|${tri.dir}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;

  const actives = useApi<PageImmobilisations>(`/hsseq/immobilizations?${requete({ ...filtres, status: "active", limit: 100 })}`);
  const levees = useApi<PageImmobilisations>(`/hsseq/immobilizations?${requete({ ...filtres, status: "lifted", sort: tri.dir === -1 ? "-since" : "since", offset, limit: PAR_PAGE })}`, { keepPreviousData: true });
  const motifV09 = useMotifV09();
  const parametrage = useAutorise(["admin", "hsseq"]);
  const hsseq = useAutorise(["hsseq"]);
  const [remise, setRemise] = useState<Immobilization | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function relire() {
    void actives.mutate();
    void levees.mutate();
  }

  // Nom du filtre posé par l'adresse, lu dans les lignes reçues.
  const lignes = [...(actives.data?.items ?? []), ...(levees.data?.items ?? [])];
  const filtre = evenement
    ? `de l'événement ${lignes.find((i) => i.event.id === evenement)?.event.reference ?? "choisi"}`
    : vehicule
      ? `de ${lignes.find((i) => i.vehicle.id === vehicule)?.vehicle.name ?? "ce véhicule"}`
      : null;

  return (
    <div className="space-y-6">
      {filtre && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-accent-doux px-3.5 py-2 text-[13px] text-ink">
          <span>
            Immobilisations {filtre}
            {evenement && (
              <>
                {" "}
                ·{" "}
                <Link href={`/hsseq/evenements/${evenement}`} className={LIEN}>
                  fiche de l&apos;événement
                </Link>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => ecrire({ evenement: null, event_id: null, vehicule: null, vehicle_id: null })}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-ink-2 transition-colors hover:bg-panel hover:text-ink"
          >
            <X className="h-3.5 w-3.5" /> Toutes les immobilisations
          </button>
        </div>
      )}

      {motifV09 && !motifV09.active && (
        <Notice tone="neutral">
          Le motif V09 du verrou n&apos;est pas encore activé : une immobilisation est enregistrée et notifiée, mais elle ne bloque pas encore le départ du véhicule.{" "}
          {parametrage ? (
            <Link href="/hsseq/parametres?onglet=motifs" className={LIEN}>
              Motifs du verrou
            </Link>
          ) : (
            "L'administration ou le Responsable HSSEQ l'active dans les paramètres."
          )}
        </Notice>
      )}
      {message && <Notice tone="ok">{message}</Notice>}

      <section aria-labelledby="immobilisations-en-cours" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="immobilisations-en-cours" className="font-display text-[17px] font-[620] leading-snug tracking-[-0.01em] text-ink">
            En cours{actives.data ? `, ${actives.data.total_count}` : ""}
          </h2>
          {!hsseq && (actives.data?.total_count ?? 0) > 0 && <p className="text-[12.5px] text-muted">La remise en service revient au Responsable HSSEQ.</p>}
        </div>
        {!actives.data ? (
          <div className={FEUILLE}>
            <Etat error={actives.error} onRetry={() => void actives.mutate()} label="Chargement des immobilisations en cours…" />
          </div>
        ) : actives.data.items.length === 0 ? (
          <div className={FEUILLE}>
            <Empty
              title={filtre ? "Aucune immobilisation en cours pour ce filtre." : "Aucun véhicule immobilisé."}
              hint="Le Responsable HSSEQ immobilise un véhicule depuis la fiche d'un événement de criticité élevée, le temps de l'enquête."
            />
          </div>
        ) : (
          <>
            {actives.error && <ErrorBox error={actives.error} onRetry={() => void actives.mutate()} titre="La liste n'a pas pu être relue ; elle est affichée telle qu'au dernier chargement." />}
            <ul className="grid gap-4 lg:grid-cols-2">
              {actives.data.items.map((i) => (
                <li key={i.id} className="min-w-0">
                  <CarteImmobilisation i={i} motifV09={motifV09} onRemettre={() => setRemise(i)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <Card padded={false} title="Remises en service">
        {!levees.data ? (
          <Etat error={levees.error} onRetry={() => void levees.mutate()} label="Chargement de l'historique…" />
        ) : (
          <>
            {levees.error && (
              <div className="px-5 pb-3">
                <ErrorBox error={levees.error} onRetry={() => void levees.mutate()} />
              </div>
            )}
            <div className={COLONNES_TELEPHONE}>
              <DataTable
                rows={levees.data.items}
                rowKey={(i) => i.id}
                sort={tri}
                onSort={(t) => {
                  if (t.key === "since") setTri(t);
                }}
                empty={filtre ? "Aucune remise en service pour ce filtre." : "Aucun véhicule remis en service pour l'instant."}
                columns={[
                  { key: "vehicle", label: "Véhicule", render: (i) => <Vehicule i={i} /> },
                  { key: "event", label: "Événement", render: (i) => <Evenement i={i} /> },
                  {
                    key: "since",
                    label: "Immobilisé",
                    render: (i) => (
                      <span className="block whitespace-nowrap">
                        {momentCk(i.since)}
                        {i.imposed_by && <span className="block text-[12px] text-muted">{i.imposed_by.name}</span>}
                      </span>
                    ),
                  },
                  {
                    key: "lifted_at",
                    label: "Remis en service",
                    render: (i) => (
                      <span className="block whitespace-nowrap">
                        {momentCk(i.lifted_at)}
                        <span className="block text-[12px] text-muted">
                          {`après ${dureeEntre(i.since, i.lifted_at)}`}
                          {i.lifted_by ? `, ${i.lifted_by.name}` : ""}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "lift_reason",
                    label: "Motif de la levée",
                    render: (i) => <span className="line-clamp-3 block min-w-[16rem] max-w-[48ch] leading-snug text-ink-2">{i.lift_reason ?? "–"}</span>,
                  },
                ]}
              />
            </div>
            <Pages offset={levees.data.offset} limit={levees.data.limit} total={levees.data.total_count} nom="remises en service" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>

      {remise && (
        <FenetreRemise
          i={remise}
          onClose={() => setRemise(null)}
          onRelire={relire}
          onRemis={(maj) => {
            setRemise(null);
            setMessage(`${maj.vehicle.name} remis en service : le motif V09 ne bloque plus ses départs.`);
            relire();
          }}
        />
      )}
    </div>
  );
}

/** Véhicule, son profil, sa plaque et son site. */
function Vehicule({ i }: { i: Immobilization }) {
  return (
    <span className="block whitespace-nowrap">
      <span className="font-semibold text-ink">{i.vehicle.name}</span>
      <span className="block text-[12px] text-muted">
        {TYPE_VEHICULE[i.vehicle.vehicle_kind]}
        {i.vehicle.plate ? `, ${i.vehicle.plate}` : ""}
        {i.site ? `, ${i.site.name}` : ""}
      </span>
    </span>
  );
}

/** Événement à l'origine : référence (lien vers sa fiche), titre, niveau de criticité. */
function Evenement({ i }: { i: Immobilization }) {
  return (
    <span className="block min-w-[14rem] max-w-[44ch]">
      <Link href={`/hsseq/evenements/${i.event.id}`} className={cx(LIEN, "font-mono text-[12.5px]")}>
        {i.event.reference}
      </Link>
      <span className="mt-0.5 line-clamp-2 block leading-snug text-ink-2">{i.event.title}</span>
    </span>
  );
}

/** Immobilisation en cours : véhicule, depuis quand et par qui, événement, motif, effet sur le verrou, remise en service. */
function CarteImmobilisation({ i, motifV09, onRemettre }: { i: Immobilization; motifV09: ReasonSetting | undefined; onRemettre: () => void }) {
  // Motif inactif partout : l'encart en tête de page le dit déjà une fois pour toutes.
  const effet = motifV09?.active ? effetVerrou(motifV09, i.vehicle, i.site) : null;
  const niveau = i.event.level ? NIVEAUX[i.event.level].label : null;
  const titre = `immobilisation-${i.id}`;
  return (
    <article aria-labelledby={titre} className={cx(FEUILLE, "flex h-full flex-col gap-4 p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titre} className="font-display text-[20px] font-[650] leading-tight tracking-[-0.01em] text-ink">
            {i.vehicle.name}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {TYPE_VEHICULE[i.vehicle.vehicle_kind]}
            {i.vehicle.plate ? `, ${i.vehicle.plate}` : ""}
            {i.site ? `, ${i.site.name}` : ""}
          </p>
        </div>
        <TamponImmobilisation statut="active" />
      </div>

      <dl className="grid grid-cols-1 gap-x-5 gap-y-3 text-[13px] sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[12px] text-muted">Depuis</dt>
          <dd className="m-0 mt-0.5 text-ink">
            {momentCk(i.since)}
            <span className="block text-[12px] text-muted">{`${dureeEntre(i.since)} d'immobilisation`}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[12px] text-muted">Immobilisé par</dt>
          <dd className="m-0 mt-0.5 text-ink">{i.imposed_by?.name ?? "–"}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-[12px] text-muted">Événement à l&apos;origine</dt>
          <dd className="m-0 mt-0.5 text-ink">
            <span className="flex flex-wrap items-center gap-2">
              <Link href={`/hsseq/evenements/${i.event.id}`} className={cx(LIEN, "font-mono text-[12.5px]")}>
                {i.event.reference}
              </Link>
              {niveau && <Tampon mot={niveau} />}
            </span>
            <span className="mt-0.5 block leading-snug">{i.event.title}</span>
          </dd>
        </div>
      </dl>

      {i.reason && <blockquote className="m-0 border-l-2 border-line-strong pl-3 text-[13.5px] leading-relaxed text-ink">« {i.reason} »</blockquote>}

      {effet && (
        <p className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-2">
          <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none text-muted" />
          {effet}
        </p>
      )}

      {i.transitions.includes("release") && (
        <div className="mt-auto flex justify-end border-t border-line pt-3">
          <Button variant="primary" onClick={onRemettre}>
            <LockOpen className="h-4 w-4" /> Remettre en service
          </Button>
        </div>
      )}
    </article>
  );
}

const REFUS_REMISE: Partial<Record<string, string>> = {
  reason_required: "Indiquez le motif de la levée : il est journalisé avec la remise en service.",
  invalid_transition: "Ce véhicule n'est plus immobilisé : la liste est relue.",
  forbidden: "Seul le Responsable HSSEQ remet un véhicule en service.",
};

/** Remise en service (Responsable HSSEQ) : motif écrit obligatoire, journalisé ; V09 tombe pour le véhicule. */
function FenetreRemise({ i, onClose, onRemis, onRelire }: { i: Immobilization; onClose: () => void; onRemis: (maj: Immobilization) => void; onRelire: () => void }) {
  const [motif, setMotif] = useState("");
  const [tente, setTente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const court = motif.trim().length < 5;

  async function remettre() {
    setTente(true);
    setErreur(null);
    if (court) return;
    setEnvoi(true);
    try {
      onRemis(await apiSend<Immobilization>("POST", `/hsseq/vehicles/${i.vehicle.id}/release`, { reason: motif.trim() }));
    } catch (e) {
      setErreur(texteErreur(e, REFUS_REMISE, "La remise en service n'a pas abouti."));
      // Levée entre-temps par une autre personne : la liste est relue, la fenêtre garde le message.
      if (codeErreur(e) === "invalid_transition") onRelire();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      title={`Remettre ${i.vehicle.name} en service`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={envoi} onClick={() => void remettre()}>
            {!envoi && <LockOpen className="h-4 w-4" />} Remettre en service
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          Immobilisé depuis le {momentCk(i.since)}
          {i.imposed_by ? ` par ${i.imposed_by.name}` : ""}, événement <span className="font-mono text-[12.5px]">{i.event.reference}</span> : {i.event.title}
        </p>
        <p className="text-[13px] leading-relaxed text-ink-2">
          Le motif V09 tombe : {i.vehicle.name} peut de nouveau partir en rotation, si les autres motifs du verrou le permettent. L&apos;enquête de l&apos;événement suit son cours.
        </p>
        <Field label="Motif de la levée (obligatoire)" hint="Ce qui a été vérifié, réparé ou décidé ; cinq caractères au moins. Journalisé." error={tente && court ? "Le motif de la levée est obligatoire." : undefined}>
          <Textarea rows={3} maxLength={2000} value={motif} onChange={(e) => setMotif(e.target.value)} aria-invalid={tente && court ? true : undefined} placeholder="Vérin de levée et alarme de proximité contrôlés par l'atelier, consigne affichée au point de déversement" />
        </Field>
        {erreur && <Notice tone="danger">{erreur}</Notice>}
      </div>
    </Modal>
  );
}
