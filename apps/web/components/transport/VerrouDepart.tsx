"use client";

/**
 * Panneau du verrou de départ d'une rotation, réutilisable par Transport (« Départs du jour », liste
 * des rotations) : état du départ et vérification par le serveur (POST /hsseq/lock/evaluate, heure de
 * la vérification), motifs détaillés, dérogations en attente ou actives de la rotation, demande de
 * dérogation par le chef de parc (un motif à la fois, V01 et V03 jamais), puis « Faire partir »
 * (POST /transport/rotations/{id}/depart), dont le refus 422 departure_blocked s'affiche ici.
 *
 * Le verrou se décide toujours côté serveur (§4) : l'écran demande, le serveur autorise ou refuse.
 * Le départ est ouvert aux profils qui écrivent les rotations (admin, finance, exploitation : WRITE de
 * Transport) ; verrou en service pour la rotation (lock_active), le noyau HSSEQ le réserve au chef de
 * parc (profil exploitation, sites de la rotation). La demande de dérogation reste au seul chef de parc.
 * Verrou pas encore en service : le départ est permis, motifs et avertissements s'affichent pour
 * information. Les avertissements (warnings) ne bloquent jamais ; une dérogation couvre un seul motif,
 * plusieurs peuvent être actives sur la rotation (active_waivers).
 */

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { BadgeCheck, Bell, CheckCircle2, Clock, Lock, RefreshCw, Truck } from "@/components/icons";
import { Button, ErrorBox, Field, Loading, Modal, Notice, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { HORS_VERROU, STATUT_DEROGATION, TYPE_VEHICULE, Tampon, nomRotation } from "@/components/hsseq/commun";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { fmtDateTime, pluriel } from "@/lib/format";
import type { Departure, DepartureBlocked, LockEvaluation, LockReason, NewWaiver, Page, ReasonCode, TransportBlocker, Waiver } from "@/lib/hsseq-types";
import type { Profile } from "@/lib/types";
import {
  CodeMotif,
  JAMAIS_DEROGEABLES,
  JUSTIFICATION_MIN,
  JamaisDerogeables,
  LigneMotif,
  avertissements,
  codeErreur,
  etatEvaluation,
  heure,
  levee,
  messageErreur,
  motifsBloquants,
  quand,
  tonMotif,
} from "./departs/motifs";

/** Profils qui écrivent les rotations de Transport (WRITE) : ils font partir une rotation hors verrou. */
const PROFILS_DEPART: Profile[] = ["admin", "finance", "exploitation"];

/** Chef de parc : seul à faire partir une rotation soumise au verrou et à demander une dérogation. */
const CHEF_DE_PARC: Profile[] = ["exploitation"];

/** Fenêtres du rattachement automatique (référentiels HSSEQ), à défaut celles du paramétrage initial. */
const FENETRES = { check_window_hours: 12, breath_test_window_hours: 4 };

const ERREURS_DEPART: Partial<Record<string, string>> = {
  forbidden: "Départ refusé à votre profil : verrou en service, il revient au chef de parc du site de la rotation (profil Exploitation transport).",
  business_rule: "Seule une rotation saisie, pas encore partie, part en route.",
};

const ERREURS_DEMANDE: Partial<Record<string, string>> = {
  not_waivable: "V01 et V03 ne sont jamais dérogeables : le contrôle avant départ et l'alcootest se font sur NIMOVA Terrain.",
  reason_not_open: "Ce motif n'est plus ouvert pour la rotation. Vérifiez à nouveau le verrou.",
  conflict: "Une dérogation est déjà demandée ou active pour cette rotation et ce motif : une dérogation couvre un seul motif.",
  reason_required: "Le motif écrit est obligatoire.",
  forbidden: "Seul un chef de parc du site de la rotation demande une dérogation.",
};

export interface VerrouDepartProps {
  rotationId: number;
  /** Départ du jour déjà lu (GET /hsseq/lock/departures) : en-tête et première évaluation, sans nouvel appel. */
  depart?: Departure;
  /** Après un départ, une demande ou une annulation de dérogation : la liste appelante se recharge. */
  onChange?: () => void;
  /** Nouvelle évaluation reçue : la liste appelante peut mettre la ligne à jour sans tout réévaluer. */
  onEvaluation?: (evaluation: LockEvaluation) => void;
  /** Rotation passée en route (heure du navigateur). */
  onParti?: (rotationId: number, at: string) => void;
}

/** L'évaluation la plus récente des deux (celle de la liste ou celle du panneau). */
function plusRecente(a: LockEvaluation | undefined, b: LockEvaluation | undefined): LockEvaluation | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.checked_at > a.checked_at ? b : a;
}

export function VerrouDepart({ rotationId, depart, onChange, onEvaluation, onParti }: VerrouDepartProps) {
  const chefDeParc = useAutorise(CHEF_DE_PARC);
  const ecritRotations = useAutorise(PROFILS_DEPART);
  // Sans départ déjà lu (panneau ouvert depuis la liste des rotations), le verrou s'évalue à l'ouverture.
  const lu = useSWR<LockEvaluation, ApiError>(
    `verrou:${rotationId}`,
    () => apiSend<LockEvaluation>("POST", "/hsseq/lock/evaluate", { rotation_id: rotationId }),
    { revalidateOnMount: !depart, revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const evaluation = plusRecente(lu.data, depart?.evaluation);
  const derogations = useApi<Page<Waiver>>(`/hsseq/waivers?rotation_id=${rotationId}&status=pending_hsseq,active,refused&limit=20`);
  const [parti, setParti] = useState<string | null>(null);
  const [refus, setRefus] = useState<{ at: string; message: string; blockers: TransportBlocker[] } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [demande, setDemande] = useState(false);
  const titreRefus = useRef<HTMLHeadingElement>(null);
  const commandes = useRef<HTMLDivElement>(null);

  // Rappel par référence : l'écran appelant passe une nouvelle fonction à chaque rendu.
  const rappel = useRef(onEvaluation);
  useEffect(() => {
    rappel.current = onEvaluation;
  });
  useEffect(() => {
    if (lu.data) rappel.current?.(lu.data);
  }, [lu.data]);
  useEffect(() => {
    if (refus) titreRefus.current?.focus();
  }, [refus]);

  const enAttente = evaluation?.reasons.some((r) => r.pending && !r.waiver_id && r.severity === "block") ?? false;
  const { data: referentiels } = useApi<Partial<typeof FENETRES>>(enAttente ? "/hsseq/referentials" : null);

  if (!evaluation) {
    return lu.error ? <ErrorBox error={lu.error} onRetry={() => lu.mutate()} titre="Le verrou n'a pas pu être évalué." /> : <Loading label="Évaluation du verrou par le serveur…" />;
  }

  const lignes = derogations.data?.items ?? [];
  const enService = evaluation.lock_active !== false;
  const avis = avertissements(evaluation);
  // Verrou en service, le noyau HSSEQ réserve le départ au chef de parc ; hors verrou, à tout profil qui écrit les rotations.
  const peutPartir = enService ? chefDeParc : ecritRotations;
  const attente = (code: string) => lignes.find((w) => w.reason_code === code && w.status === "pending_hsseq");
  const bloquants = motifsBloquants(evaluation);
  // Une demande porte sur un seul motif ouvert, dérogeable, sans demande déjà en cours.
  const candidats = bloquants.filter((r) => r.waivable && !JAMAIS_DEROGEABLES.includes(r.code) && !attente(r.code));
  const etat = parti ? "En route" : etatEvaluation(evaluation);
  const vehicule = depart?.vehicle.name ?? "la rotation";
  const maintenant = new Date().toISOString();

  async function reverifier() {
    setErreur(null);
    setInfo(null);
    void derogations.mutate();
    await lu.mutate();
  }

  async function fairePartir() {
    setErreur(null);
    setInfo(null);
    const ok = await demanderConfirmation(
      enService
        ? "Le serveur vérifie le verrou une dernière fois : il refuse le départ si un motif bloquant reste ouvert sans dérogation active."
        : "Verrou pas encore en service pour cette rotation : elle part sans contrôle du verrou ; les avertissements sont notés au départ.",
      { titre: `Faire partir ${vehicule} ?`, action: "Faire partir" },
    );
    if (!ok) return;
    setEnvoi(true);
    try {
      await apiSend("POST", `/transport/rotations/${rotationId}/depart`);
      const at = new Date().toISOString();
      setParti(at);
      setRefus(null);
      setDemande(false);
      onParti?.(rotationId, at);
      onChange?.();
    } catch (e) {
      if (codeErreur(e) === "departure_blocked" && e instanceof ApiError) {
        const corps = e.body as unknown as Partial<DepartureBlocked>;
        setRefus({ at: new Date().toISOString(), message: e.message, blockers: corps.blockers ?? [] });
        // Les motifs du panneau suivent la vérification qui vient de refuser le départ.
        void lu.mutate();
        void derogations.mutate();
      } else {
        setErreur(messageErreur(e, ERREURS_DEPART, "Le départ n'a pas pu être demandé."));
      }
    } finally {
      setEnvoi(false);
    }
  }

  async function annuler(w: Waiver) {
    setErreur(null);
    setInfo(null);
    const active = w.status === "active";
    const ok = await demanderConfirmation(
      active ? "La dérogation cesse de couvrir le motif : le départ sera de nouveau bloqué par lui." : "La demande est retirée ; le Responsable HSSEQ n'aura plus à la valider.",
      { titre: active ? `Annuler la dérogation ${w.reference} ?` : `Retirer la demande ${w.reference} ?`, action: active ? "Annuler la dérogation" : "Retirer la demande", danger: true },
    );
    if (!ok) return;
    try {
      await apiSend<Waiver>("POST", `/hsseq/waivers/${w.id}/cancel`);
      setInfo(active ? `Dérogation ${w.reference} annulée.` : `Demande ${w.reference} retirée.`);
      void derogations.mutate();
      void lu.mutate();
      onChange?.();
    } catch (e) {
      setErreur(messageErreur(e, {}, "L'annulation n'a pas abouti."));
    }
  }

  return (
    <div className="space-y-5">
      {depart && <EnteteDepart depart={depart} />}

      <TeteVerrou etat={etat} evaluation={evaluation} parti={parti} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">Vérifié par le serveur {quand(evaluation.checked_at, maintenant)}. Seul le serveur autorise un départ.</p>
        {!parti && (
          <Button size="sm" loading={lu.isValidating} onClick={() => void reverifier()}>
            {!lu.isValidating && <RefreshCw className="h-3.5 w-3.5" />} Vérifier à nouveau
          </Button>
        )}
      </div>
      {lu.error && <ErrorBox error={lu.error} onRetry={() => lu.mutate()} titre="La nouvelle vérification n'a pas abouti ; l'état affiché est le précédent." />}

      {refus && (
        <section aria-labelledby={`refus-${rotationId}`} className="rounded-2xl border border-danger/25 bg-danger-doux px-4 py-4">
          <h3 id={`refus-${rotationId}`} ref={titreRefus} tabIndex={-1} className="font-display text-[16px] font-[650] leading-snug text-danger outline-none">
            Départ refusé par le serveur {quand(refus.at, refus.at)}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink">{refus.message}</p>
          {refus.blockers.length > 0 && (
            <ul className="mt-3 space-y-3">
              {refus.blockers.map((b) => (
                <li key={`${b.code}-${b.since}`}>
                  <LigneMotif motif={b} fin={<span className="flex-none text-[12px] font-medium text-ink-2">{b.waivable ? "Dérogeable" : "Jamais dérogeable"}</span>} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}

      {evaluation.reasons.length > 0 && (
        <section aria-labelledby={`motifs-${rotationId}`}>
          <h3 id={`motifs-${rotationId}`} className="mb-2.5 font-display text-[16px] font-[650] text-ink">
            {!enService ? `Motifs relevés pour information, ${evaluation.reasons.length}` : bloquants.length ? `Motifs ouverts, ${bloquants.length}` : "Motifs"}
            {enService && evaluation.reasons.length > bloquants.length && <span className="font-sans text-[13px] font-medium text-muted">{`, ${pluriel(evaluation.reasons.length - bloquants.length, "couvert par une dérogation", "couverts par une dérogation")}`}</span>}
          </h3>
          <ul className="space-y-2.5">
            {evaluation.reasons.map((r, i) => (
              <li key={`${r.code}-${i}`}>
                <CarteMotif motif={r} attente={Boolean(attente(r.code))} enService={enService} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {avis.length > 0 && (
        <section aria-labelledby={`avertissements-${rotationId}`}>
          <h3 id={`avertissements-${rotationId}`} className="mb-2.5 font-display text-[16px] font-[650] text-ink">
            {`Avertissements, ${avis.length}`}
            <span className="font-sans text-[13px] font-medium text-muted">, sans effet sur le départ</span>
          </h3>
          <ul className="space-y-2.5">
            {avis.map((r, i) => (
              <li key={`${r.code}-avis-${i}`}>
                <CarteMotif motif={r} attente={false} enService={enService} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {enAttente && !parti && (
        <Notice tone="neutral">
          Le contrôle avant départ et l&apos;alcootest se font sur NIMOVA Terrain. Saisis sans rotation, ils sont rattachés à ce départ s&apos;ils datent de moins de{" "}
          {pluriel(referentiels?.check_window_hours ?? FENETRES.check_window_hours, "heure")} pour le contrôle du véhicule et de moins de{" "}
          {pluriel(referentiels?.breath_test_window_hours ?? FENETRES.breath_test_window_hours, "heure")} pour l&apos;alcootest du conducteur. Vérifiez à nouveau une fois les saisies faites.
        </Notice>
      )}

      <DerogationsRotation
        id={`derogations-${rotationId}`}
        lignes={lignes}
        erreur={derogations.error}
        actives={evaluation.active_waivers ?? []}
        onAnnuler={(w) => void annuler(w)}
      />

      {chefDeParc && enService && !parti && demande && (
        <DemandeDerogation
          rotationId={rotationId}
          contexte={depart ? `${nomRotation(depart.rotation)}, ${depart.vehicle.name}${depart.driver ? `, ${depart.driver.name}` : ""}` : null}
          candidats={candidats}
          ouverts={bloquants.map((r) => r.code)}
          onFermer={() => {
            setDemande(false);
            // « Demander une dérogation » revient dans la barre : il reprend le focus.
            setTimeout(() => commandes.current?.querySelector<HTMLButtonElement>("button")?.focus());
          }}
          onEnvoyee={(w) => {
            setDemande(false);
            setInfo(`Demande ${w.reference} envoyée : votre validation compte pour 1 sur 2. La seconde revient au Responsable HSSEQ, une autre personne ; le Directeur général sera informé à l'activation.`);
            void derogations.mutate();
            onChange?.();
          }}
        />
      )}

      {!parti && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="max-w-[52ch] text-[12.5px] leading-snug text-muted">
            {!enService
              ? ecritRotations
                ? "Verrou pas encore en service pour cette rotation : elle part comme avant, sans dérogation à demander."
                : "Verrou pas encore en service pour cette rotation ; le départ revient aux profils qui écrivent les rotations."
              : chefDeParc
                ? candidats.length === 0 && bloquants.length > 0 && !demande
                  ? "Aucun motif ouvert ne peut faire l'objet d'une nouvelle demande de dérogation."
                  : "Une dérogation couvre un seul motif, pour cette seule rotation, avec votre validation puis celle du Responsable HSSEQ."
                : ecritRotations
                  ? "Verrou en service : seul le chef de parc du site fait partir la rotation ou demande une dérogation."
                  : "Seul le chef de parc du site fait partir la rotation ou demande une dérogation ; vous lisez l'état du départ."}
          </p>
          {(peutPartir || (chefDeParc && enService)) && (
            <div ref={commandes} className="flex flex-wrap gap-2">
              {chefDeParc && enService && candidats.length > 0 && !demande && (
                <Button onClick={() => setDemande(true)}>
                  <BadgeCheck className="h-4 w-4" /> Demander une dérogation
                </Button>
              )}
              {peutPartir && (
                <Button variant={evaluation.allowed ? "primary" : "secondary"} loading={envoi} onClick={() => void fairePartir()}>
                  {!envoi && <Truck className="h-4 w-4" />} Faire partir
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Véhicule, conducteur, rotation et site du départ. */
function EnteteDepart({ depart }: { depart: Departure }) {
  const v = depart.vehicle;
  const cases: Array<[string, ReactNode]> = [
    ["Véhicule", `${v.name}, ${TYPE_VEHICULE[v.vehicle_kind].toLocaleLowerCase("fr")}${v.plate ? `, ${v.plate}` : ""}`],
    ["Conducteur", depart.driver?.name ?? "Non affecté"],
    ["Rotation", `${nomRotation(depart.rotation)}${depart.rotation.route_name ? `, ${depart.rotation.route_name}` : ""}`],
    ["Site", depart.site?.name ?? "–"],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {cases.map(([cle, valeur]) => (
        <div key={cle} className="min-w-0">
          <dt className="text-[12px] font-medium text-muted">{cle}</dt>
          <dd className="text-[13.5px] text-ink">{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

const ALLURE: Record<string, { cadre: string; titre: string; icone: typeof Lock; mot: string }> = {
  [HORS_VERROU]: { cadre: "border-line bg-panel-2", titre: "text-ink", icone: Clock, mot: HORS_VERROU },
  Bloqué: { cadre: "border-danger/25 bg-danger-doux", titre: "text-danger", icone: Lock, mot: "Départ bloqué" },
  "À contrôler": { cadre: "border-warn/25 bg-warn-doux", titre: "text-warn", icone: Clock, mot: "À contrôler" },
  Autorisé: { cadre: "border-ok/25 bg-ok-doux", titre: "text-ok-texte", icone: CheckCircle2, mot: "Départ autorisé" },
  "En route": { cadre: "border-line bg-panel-2", titre: "text-ink", icone: Truck, mot: "En route" },
};

/** Aplat d'état du départ : ce qui bloque, ce qui reste à faire, ou le feu vert. */
function TeteVerrou({ etat, evaluation, parti }: { etat: string; evaluation: LockEvaluation; parti: string | null }) {
  const id = useId();
  const a = ALLURE[etat] ?? ALLURE.Bloqué!;
  const Icone = a.icone;
  const bloquants = motifsBloquants(evaluation);
  const nbAvis = avertissements(evaluation).length;
  let texte: string;
  if (parti) texte = evaluation.lock_active !== false ? `Rotation en route depuis ${heure(parti)}. Le serveur a vérifié le verrou au départ.` : `Rotation en route depuis ${heure(parti)}.`;
  else if (etat === HORS_VERROU)
    texte = `Rotation chargée avant la mise en service du verrou : son départ n'est pas bloqué.${evaluation.reasons.length ? ` ${pluriel(evaluation.reasons.length, "motif relevé", "motifs relevés")} pour information.` : ""}`;
  else if (etat === "Autorisé")
    texte = evaluation.reasons.some((r) => r.waiver_id)
      ? "Tous les motifs bloquants sont levés ou couverts par une dérogation active."
      : "Aucun motif bloquant ouvert.";
  else if (etat === "À contrôler")
    texte = `${bloquants.map((r) => r.code).join(" et ")} : saisie de terrain encore à faire par le conducteur, contrôle avant départ ou alcootest.`;
  else texte = `${pluriel(bloquants.length, "motif")} à lever, ou à couvrir par une dérogation quand il est dérogeable, avant de partir.`;
  if (!parti && nbAvis) texte += ` ${pluriel(nbAvis, "avertissement")} sans effet sur le départ.`;
  return (
    <section aria-labelledby={id} className={cx("flex items-start gap-3 rounded-2xl border px-4 py-3.5", a.cadre)}>
      <Icone className={cx("mt-0.5 h-5 w-5 flex-none", a.titre)} />
      <div className="min-w-0 flex-1">
        <h3 id={id} className={cx("font-display text-[18px] font-[650] leading-snug", a.titre)}>
          {a.mot}
        </h3>
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink">{texte}</p>
      </div>
      <Tampon mot={etat} />
    </section>
  );
}

/** Motif détaillé : code, libellé, précision, source, date, qui le lève, et sa dérogation éventuelle. */
function CarteMotif({ motif, attente, enService }: { motif: LockReason; attente: boolean; enService: boolean }) {
  const qui = levee(motif);
  const mot = motif.severity === "warn" ? "Avertissement" : motif.waiver_id ? "Sous dérogation" : attente ? "Attente Responsable HSSEQ" : motif.pending ? "Non fait" : enService ? "Bloquant" : "Pour information";
  return (
    <article className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-start gap-2.5">
        <CodeMotif code={motif.code} ton={tonMotif(motif)} />
        <h4 className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink">{motif.label}</h4>
        <Tampon mot={mot} />
      </div>
      {motif.detail && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{motif.detail}</p>}
      <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1 text-[12.5px] sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Source</dt>
        <dd className="text-ink-2">{motif.source}</dd>
        {motif.since && (
          <>
            <dt className="text-muted">Depuis</dt>
            <dd className="text-ink-2">{fmtDateTime(motif.since)}</dd>
          </>
        )}
        {qui && (
          <>
            <dt className="text-muted">Lève ce motif</dt>
            <dd className="text-ink-2">{qui}</dd>
          </>
        )}
        <dt className="text-muted">Dérogation</dt>
        <dd className="inline-flex items-center gap-1.5 text-ink-2">
          {motif.severity === "warn" ? (
            "Sans objet : un avertissement ne bloque pas le départ"
          ) : motif.waivable ? (
            motif.waiver_id ? "Active pour cette rotation" : attente ? "Demandée, en attente du Responsable HSSEQ" : "Possible, sur demande du chef de parc"
          ) : (
            <>
              <Lock className="h-3.5 w-3.5 text-muted" /> Jamais dérogeable
            </>
          )}
        </dd>
      </dl>
    </article>
  );
}

/** Phrase d'une dérogation de la rotation : où elle en est, qui l'a validée, jusqu'à quand. */
function texteDerogation(w: Waiver): string {
  if (w.status === "pending_hsseq") return `Demandée par ${w.requested_by.name} ${quand(w.requested_at, new Date().toISOString())} : sa demande vaut première validation, 1 sur 2. La seconde revient au Responsable HSSEQ.`;
  if (w.status === "active") {
    const qui = w.approvals.map((a) => a.by.name).join(" puis ");
    const dg = w.management_notified_at ? ` Directeur général informé le ${fmtDateTime(w.management_notified_at)}.` : " Le Directeur général en est informé.";
    return `Validée par ${qui} ; pour ce seul motif et cette seule rotation, jusqu'à sa fin prévue, le ${fmtDateTime(w.expires)}.${dg}`;
  }
  if (w.status === "refused") return `Refusée${w.refusal_reason ? ` : ${w.refusal_reason}` : "."}`;
  return STATUT_DEROGATION[w.status];
}

/** Dérogations de la rotation : en attente, actives (une par motif), puis refusées. */
function DerogationsRotation({ id, lignes, erreur, actives, onAnnuler }: { id: string; lignes: Waiver[]; erreur: unknown; actives: LockEvaluation["active_waivers"]; onAnnuler: (w: Waiver) => void }) {
  const ordre: Record<string, number> = { pending_hsseq: 0, active: 1, refused: 2 };
  const triees = [...lignes].sort((a, b) => (ordre[a.status] ?? 3) - (ordre[b.status] ?? 3) || b.requested_at.localeCompare(a.requested_at));
  if (!triees.length && !erreur) return null;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="mb-2.5 font-display text-[16px] font-[650] text-ink">
        Dérogations de la rotation
      </h3>
      {erreur ? (
        actives.length ? (
          <ul className="space-y-1.5 text-[13px] text-ink-2">
            {actives.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <CodeMotif code={a.reason_code} ton="warn" />
                Dérogation active{a.expires ? `, jusqu'à la fin prévue de la rotation, le ${fmtDateTime(a.expires)}` : ""}.
              </li>
            ))}
          </ul>
        ) : (
          <ErrorBox error={erreur} titre="Les dérogations de la rotation n'ont pas pu être lues." />
        )
      ) : (
        <ul className="space-y-2.5">
          {triees.map((w) => (
            <li key={w.id} className="rounded-xl border border-line bg-panel px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <CodeMotif code={w.reason_code} ton={w.status === "active" ? "warn" : "danger"} />
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-ink">{w.reason_label}</span>
                <Tampon mot={STATUT_DEROGATION[w.status]} />
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                <span className="font-mono text-[12px] text-muted">{w.reference}</span> · {texteDerogation(w)}
              </p>
              <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink-2">« {w.justification} »</blockquote>
              {w.transitions.includes("cancel") && (
                <div className="mt-2.5">
                  <Button size="sm" variant="ghost" onClick={() => onAnnuler(w)}>
                    {w.status === "active" ? "Annuler la dérogation" : "Retirer la demande"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Demande de dérogation du chef de parc : un seul motif ouvert et dérogeable, un motif écrit
 * obligatoire ; sa demande vaut première validation (§4.1, §12 décision 7).
 */
function DemandeDerogation({
  rotationId,
  contexte,
  candidats,
  ouverts,
  onFermer,
  onEnvoyee,
}: {
  rotationId: number;
  contexte: string | null;
  candidats: LockReason[];
  ouverts: string[];
  onFermer: () => void;
  onEnvoyee: (w: Waiver) => void;
}) {
  const [code, setCode] = useState<ReasonCode | "">(candidats.length === 1 ? candidats[0]!.code : "");
  const [texte, setTexte] = useState("");
  const [tente, setTente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const titre = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    titre.current?.focus();
  }, []);
  const longueur = texte.trim().length;
  const erreurCode = tente && !code ? "Choisissez le motif à déroger." : undefined;
  const erreurTexte = tente && longueur < JUSTIFICATION_MIN ? `Le motif écrit compte ${JUSTIFICATION_MIN} caractères au moins ; ${pluriel(longueur, "caractère")} pour l'instant.` : undefined;

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setTente(true);
    if (!code || longueur < JUSTIFICATION_MIN) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const corps: NewWaiver = { rotation_id: rotationId, reason_code: code, justification: texte.trim() };
      onEnvoyee(await apiSend<Waiver>("POST", "/hsseq/waivers", corps));
    } catch (err) {
      setErreur(messageErreur(err, ERREURS_DEMANDE, "La demande n'a pas pu être envoyée."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-titre`} className="rounded-2xl border border-line bg-panel-2 px-4 py-4 sm:px-5">
      <form noValidate onSubmit={(e) => void envoyer(e)} className="space-y-4">
        <div>
          <h3 id={`${id}-titre`} ref={titre} tabIndex={-1} className="font-display text-[17px] font-[650] text-ink outline-none">
            Demander une dérogation
          </h3>
          {contexte && <p className="mt-0.5 text-[13px] text-muted">{contexte}</p>}
        </div>

        <fieldset aria-describedby={erreurCode ? `${id}-code` : undefined}>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Motif à déroger, un seul par demande</legend>
          <div className="grid gap-2">
            {candidats.map((r) => (
              <label
                key={r.code}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 transition-colors focus-within:ring-4 focus-within:ring-accent/15 hover:border-line-strong has-[:checked]:border-accent has-[:checked]:bg-accent-doux/40"
              >
                <input type="radio" name={`${id}-motif`} value={r.code} checked={code === r.code} onChange={() => setCode(r.code)} className="mt-1 h-4 w-4 flex-none accent-[var(--accent)]" />
                <CodeMotif code={r.code} ton="danger" />
                <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink">
                  {r.label}
                  {r.detail && <span className="mt-0.5 block text-[12.5px] text-muted">{r.detail}</span>}
                </span>
              </label>
            ))}
          </div>
          {erreurCode && (
            <p id={`${id}-code`} className="mt-1.5 text-[12px] font-medium text-danger">
              {erreurCode}
            </p>
          )}
        </fieldset>

        <JamaisDerogeables ouverts={ouverts} />

        <Field label="Motif écrit, obligatoire" hint={`${pluriel(longueur, "caractère")}, ${JUSTIFICATION_MIN} au moins`} error={erreurTexte}>
          <Textarea
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            rows={4}
            maxLength={2000}
            required
            aria-invalid={erreurTexte ? true : undefined}
            placeholder="Pourquoi partir malgré ce motif, et ce qui est fait pour le lever."
          />
        </Field>

        <ul className="grid gap-1.5 text-[13px] leading-snug text-ink-2">
          <li className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 flex-none text-muted" />
            Un seul motif, pour cette seule rotation : la dérogation expire à la fin prévue de la rotation.
          </li>
          <li className="flex items-start gap-2">
            <BadgeCheck className="mt-0.5 h-4 w-4 flex-none text-muted" />
            Deux validations : la vôtre, que vaut cette demande, puis celle du Responsable HSSEQ, une autre personne.
          </li>
          <li className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 flex-none text-muted" />
            Le Directeur général est informé ; la dérogation est journalisée et compte dans les indicateurs.
          </li>
        </ul>

        {erreur && <Notice tone="danger">{erreur}</Notice>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onFermer}>Annuler</Button>
          <Button type="submit" variant="primary" loading={envoi}>
            Valider ma demande
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * Panneau du verrou dans une fenêtre, pour un écran de Transport qui ouvre le départ d'une rotation
 * depuis une liste (« Départs du jour », rotations).
 */
export function FenetreVerrou({ titre, onClose, ...props }: VerrouDepartProps & { titre?: string; onClose: () => void }) {
  return (
    <Modal open wide title={titre ?? (props.depart ? `Départ de ${props.depart.vehicle.name}` : "Verrou de départ")} onClose={onClose}>
      <VerrouDepart {...props} />
    </Modal>
  );
}
