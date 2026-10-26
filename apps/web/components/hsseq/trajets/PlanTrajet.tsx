"use client";

/**
 * Plan de trajet d'une rotation (motif V08 du verrou de départ), pour le panneau du verrou de
 * Transport : lecture (horaires, arrêts, conduite prévue par jour, écarts aux règles, validation),
 * saisie et validation par le chef de parc du site (GET et PUT /hsseq/rotations/{id}/journey, POST
 * …/journey/validate). Les commandes suivent `rights` et `transitions` ; le noyau refait le calcul des
 * écarts et refuse un plan non conforme (journey_not_compliant). Heures de Conakry.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CheckCheck, Moon, Pencil, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, ErrorBox, Field, Input, Loading, Notice, ProgressBar, Select, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { texteErreur, tonHsseq } from "@/components/hsseq/commun";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { TonEtat } from "@/lib/couleurs";
import { INSECABLE, fmtInt, pluriel } from "@/lib/format";
import { NATURE_ARRET, deNuit, depuisChamp, duree, dureeArret, ecartsPrevus, heureCk, heureDuJour, jourCk, jourCourt, momentCk, versChamp } from "./outils";
import type { Journey, JourneyInput, JourneyRules, RotationJourney, StopKind } from "./types";

const HEURE = 3_600_000;

export interface PlanTrajetProps {
  rotationId: number;
  /** Plan enregistré ou validé : le panneau du verrou vérifie de nouveau la rotation (V08). */
  onChange?: (ligne: RotationJourney) => void;
}

/** Mot d'état du plan et son ton ; « Validé » et « À établir » sont à verser dans TON_HSSEQ. */
const TON_PLAN: Record<string, TonEtat> = { "À établir": "warn", "Non conforme": "danger", "À valider": "warn", Validé: "ok" };

function etatPlan(j: Journey | null): string {
  if (!j) return "À établir";
  if (j.issues.length) return "Non conforme";
  return j.status === "validated" ? "Validé" : "À valider";
}

/** Champs nommés par un refus 400, en clair. */
const CHAMP: Record<string, string> = {
  planned_departure: "départ prévu",
  planned_arrival: "arrivée prévue",
  stops: "arrêts",
  planned_at: "heure d'un arrêt",
  itinerary: "itinéraire",
  night_driving: "conduite de nuit",
};

const REFUS: Partial<Record<string, string>> = {
  forbidden: "Le plan de trajet revient au chef de parc du site de la rotation.",
};

/** Refus du noyau en clair : champs en cause traduits, sinon le message du noyau. */
function refus(e: unknown, defaut: string): string {
  if (e instanceof ApiError && (e.body.error === "missing_fields" || e.body.error === "invalid_parameter") && e.body.fields?.length) {
    const champs = [...new Set(e.body.fields.map((f) => CHAMP[f] ?? f))].join(", ");
    return `${(e.body.message || "Saisie refusée").replace(/[.\s]+$/, "")}, champs en cause : ${champs}.`;
  }
  if (e instanceof ApiError && e.body.error === "journey_not_compliant") return `Validation refusée, plan non conforme : ${e.body.message ?? ""}`.trim();
  return texteErreur(e, REFUS, defaut);
}

/** Opérations du journal d'un plan, en clair ; les changements d'état doublent « validé » et « revenu à valider ». */
const OPERATION: Record<string, string> = { create: "Plan établi", validate: "Plan validé", invalidated: "Revenu à valider", write: "Modifié" };
const CHAMP_JOURNAL: Record<string, string> = { itinerary: "itinéraire", planned_departure: "départ prévu", planned_arrival: "arrivée prévue", night_driving: "conduite de nuit" };

export function PlanTrajet({ rotationId, onChange }: PlanTrajetProps) {
  const { data: ligne, error, mutate } = useApi<RotationJourney>(`/hsseq/rotations/${rotationId}/journey`);
  const [saisie, setSaisie] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "danger"; texte: string } | null>(null);
  const titreId = useId();
  const commandes = useRef<HTMLDivElement>(null);

  if (!ligne) {
    return error ? <ErrorBox error={error} onRetry={() => void mutate()} titre="Le plan de trajet n'a pas pu être lu." /> : <Loading label="Chargement du plan de trajet…" />;
  }

  const l = ligne;
  const j = l.journey;
  const mot = etatPlan(j);
  const peutValider = l.transitions.includes("validate");
  const vehicule = l.vehicle?.name ?? "la rotation";

  /** Fiche à jour reçue du noyau : elle remplace la fiche affichée, et le verrou se vérifie de nouveau. */
  function maj(suivante: RotationJourney) {
    void mutate(suivante, { revalidate: false });
    onChange?.(suivante);
  }

  async function valider() {
    setMessage(null);
    const ok = await demanderConfirmation(
      "Le motif V08 tombe pour cette rotation. Une modification ultérieure du plan le remet à valider ; la validation est journalisée.",
      { titre: `Valider le plan de trajet de ${vehicule} ?`, action: "Valider le plan" },
    );
    if (!ok) return;
    setEnvoi(true);
    try {
      maj(await apiSend<RotationJourney>("POST", `/hsseq/rotations/${rotationId}/journey/validate`, {}));
      setMessage({ tone: "ok", texte: "Plan validé : le motif V08 est levé pour cette rotation." });
    } catch (e) {
      setMessage({ tone: "danger", texte: refus(e, "La validation n'a pas abouti.") });
      // Le plan a pu changer entre-temps (écarts, rotation partie) : la fiche est relue.
      void mutate();
    } finally {
      setEnvoi(false);
    }
  }

  function fermerSaisie() {
    setSaisie(false);
    // « Modifier le plan » revient dans la barre : il reprend le focus.
    setTimeout(() => commandes.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }

  return (
    <section aria-labelledby={titreId} className="rounded-2xl border border-line bg-panel px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titreId} className="font-display text-[16px] font-[650] leading-snug text-ink">
          Plan de trajet
        </h3>
        <Badge tone={tonHsseq(mot, TON_PLAN[mot])}>{mot}</Badge>
      </div>
      <Regles ligne={l} />

      {message && (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.texte}</Notice>
        </div>
      )}

      {saisie ? (
        <SaisiePlan
          ligne={l}
          onAnnuler={fermerSaisie}
          onEnregistre={(suivante) => {
            maj(suivante);
            const s = suivante.journey;
            setMessage(
              !s
                ? null
                : s.issues.length
                  ? { tone: "warn", texte: `Plan enregistré, mais non conforme : ${pluriel(s.issues.length, "écart")} à corriger avant la validation.` }
                  : j?.status === "validated"
                    ? { tone: "ok", texte: "Plan modifié : il revient à valider." }
                    : { tone: "ok", texte: suivante.transitions.includes("validate") ? "Plan enregistré et conforme : il reste à le valider." : "Plan enregistré." },
            );
            fermerSaisie();
          }}
        />
      ) : (
        <>
          {j ? <LecturePlan ligne={l} plan={j} /> : <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">Aucun plan de trajet pour cette rotation : le motif V08 reste ouvert tant qu&apos;un plan conforme n&apos;est pas validé.</p>}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className="max-w-[52ch] text-[12.5px] leading-snug text-muted">
              {l.rotation.state !== "draft"
                ? "Rotation partie : le plan ne se modifie plus."
                : l.rights.can_edit
                  ? j?.issues.length
                    ? "Un plan non conforme ne se valide pas : modifiez les horaires, les arrêts ou la conduite de nuit."
                    : j?.status === "validated"
                      ? "Une modification du plan le remet à valider."
                      : "Vous établissez et validez le plan des rotations de votre site."
                  : j?.status === "validated"
                    ? "Le chef de parc du site a validé ce plan."
                    : "Le chef de parc du site établit et valide le plan avant le départ."}
            </p>
            {(l.rights.can_edit || peutValider) && (
              <div ref={commandes} className="flex flex-wrap gap-2">
                {l.rights.can_edit && (
                  <Button variant={j ? "secondary" : "primary"} onClick={() => setSaisie(true)}>
                    {j ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {j ? "Modifier le plan" : "Établir le plan"}
                  </Button>
                )}
                {peutValider && (
                  <Button variant="primary" loading={envoi} onClick={() => void valider()}>
                    {!envoi && <CheckCheck className="h-4 w-4" />} Valider le plan
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Route de la rotation en une ligne : « Conakry - Siguiri, de Conakry à Siguiri, 790 km, durée standard 2 jours ». */
function decrireRoute(route: NonNullable<RotationJourney["route"]>): string {
  const parties = [route.name];
  if (route.origin && route.destination) parties.push(`de ${route.origin} à ${route.destination}`);
  if (route.distance_km) parties.push(`${fmtInt(route.distance_km)}${INSECABLE}km`);
  if (route.duration_days) parties.push(`durée standard ${String(route.duration_days).replace(".", ",")}${INSECABLE}${route.duration_days > 1 ? "jours" : "jour"}`);
  return parties.join(", ");
}

/** Règles qui s'appliquent : route et circulation de nuit, conduite prévue au plus par jour. */
function Regles({ ligne }: { ligne: RotationJourney }) {
  const r = ligne.rules;
  const route = ligne.route;
  const nuit = `${heureDuJour(r.night_start_hour)} à ${heureDuJour(r.night_end_hour)}`;
  return (
    <p className="mt-1 text-[12.5px] leading-snug text-muted">
      {route ? `${decrireRoute(route)} : circulation de nuit ${route.night_driving_forbidden ? `interdite de ${nuit}` : "permise"}. ` : "Rotation sans route tarifée : aucune interdiction de nuit. "}
      {r.max_driving_hours ? `Conduite prévue au plus ${duree(r.max_driving_hours)} par jour. ` : ""}
      Heures de Conakry.
    </p>
  );
}

/** Plan lu : étapes horodatées, itinéraire, conduite prévue par jour, écarts, validation et journal. */
function LecturePlan({ ligne, plan }: { ligne: RotationJourney; plan: Journey }) {
  const r = ligne.rules;
  const interdite = Boolean(ligne.route?.night_driving_forbidden);
  const jourDepart = jourCk(plan.planned_departure);
  const etapes = [
    { cle: "depart", quand: plan.planned_departure, titre: "Départ", lieu: null as string | null },
    ...plan.stops.map((s) => ({ cle: `arret-${s.id}`, quand: s.planned_at, titre: `${NATURE_ARRET[s.kind]} de ${dureeArret(s.duration_minutes)}`, lieu: s.place })),
    { cle: "arrivee", quand: plan.planned_arrival, titre: "Arrivée", lieu: null },
  ];
  const journal = plan.history.filter((h) => h.field !== "status");
  return (
    <div className="mt-3 space-y-4">
      <ol aria-label="Étapes prévues" className="space-y-1.5">
        {etapes.map((e) => {
          const nuit = deNuit(Date.parse(e.quand), r);
          const autreJour = jourCk(e.quand) !== jourDepart;
          return (
            <li key={e.cle} className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-x-3 text-[13.5px]">
              <span className="tabular text-ink">
                {autreJour && <span className="block text-[11.5px] text-muted">{jourCk(e.quand).slice(0, 5)}</span>}
                <span className="inline-flex items-center gap-1 font-semibold">
                  {heureCk(e.quand)}
                  {nuit && <Moon aria-hidden className={cx("h-3.5 w-3.5", interdite ? "text-danger" : "text-muted")} />}
                </span>
                {nuit && <span className="sr-only">, de nuit</span>}
              </span>
              <span className="min-w-0 text-ink-2">
                <span className="font-medium text-ink">{e.titre}</span>
                {e.lieu ? `, ${e.lieu}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[12.5px] text-muted">
        Départ le {jourDepart}
        {plan.night_driving ? " ; conduite de nuit déclarée." : plan.drives_at_night ? ` ; les horaires passent par la nuit (${heureDuJour(r.night_start_hour)} à ${heureDuJour(r.night_end_hour)}).` : "."}
      </p>

      {plan.itinerary && (
        <p className="text-[13px] leading-relaxed text-ink-2">
          <span className="font-medium text-ink">Itinéraire : </span>
          {plan.itinerary}
        </p>
      )}

      <ConduiteParJour jours={plan.driving_hours_by_day} max={r.max_driving_hours} />

      {plan.issues.length > 0 && (
        <Notice tone="danger">
          <span className="font-semibold">{plan.issues.length > 1 ? "Écarts aux règles du trajet" : "Écart aux règles du trajet"}</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {plan.issues.map((x) => (
              <li key={`${x.code}-${x.label}`}>{x.label}</li>
            ))}
          </ul>
        </Notice>
      )}

      {plan.status === "validated" && (
        <p className="text-[13px] text-ink-2">
          Validé{plan.validated_by ? ` par ${plan.validated_by.name}` : ""} le {momentCk(plan.validated_at)}.
        </p>
      )}

      {journal.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Journal du plan ({journal.length})</summary>
          <ol className="mt-2 space-y-1 text-[12.5px] leading-snug text-ink-2">
            {[...journal].reverse().map((h) => (
              <li key={h.id}>
                <span className="text-muted">{momentCk(h.at)}</span>, {h.by?.name ?? "Système"} : {OPERATION[h.action] ?? h.action}
                {h.action === "write" && h.field ? ` (${CHAMP_JOURNAL[h.field] ?? h.field})` : ""}
                {h.note && h.action !== "invalidated" ? ` (${h.note})` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** Heures de conduite prévues par jour, au regard du maximum des paramètres. */
function ConduiteParJour({ jours, max }: { jours: Array<{ date: string; hours: number }>; max: number }) {
  if (!jours.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-medium text-muted">Conduite prévue</p>
      <ul className="space-y-2">
        {jours.map((d) => {
          const depasse = max > 0 && d.hours > max + 1e-6;
          return (
            <li key={d.date}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink-2">{jourCourt(d.date)}</span>
                <span className={cx("tabular font-semibold", depasse ? "text-danger" : "text-ink")}>
                  {duree(d.hours)}
                  {max > 0 && <span className="font-normal text-muted"> sur {duree(max)}</span>}
                  {depasse && <span className="sr-only">, au-delà du maximum</span>}
                </span>
              </div>
              {max > 0 && (
                <div aria-hidden className="mt-1">
                  <ProgressBar value={(d.hours / max) * 100} tone={depasse ? "danger" : "accent"} epaisseur={5} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ─── Saisie ──────────────────────────────────────────────────────────── */

interface ArretSaisi {
  cle: number;
  kind: StopKind;
  place: string;
  /** Champ « datetime-local », heure de Conakry. */
  quand: string;
  minutes: string;
}

interface Brouillon {
  depart: string;
  arrivee: string;
  itineraire: string;
  nuit: boolean;
  arrets: ArretSaisi[];
}

let prochaineCle = 1;

/** Arrivée proposée d'après la durée standard de la route (jours), depuis un départ « datetime-local » ; vide sans durée. */
function arriveeProposee(depart: string, ligne: RotationJourney): string {
  const debut = depuisChamp(depart);
  const jours = ligne.route?.duration_days;
  return debut && jours ? versChamp(new Date(Date.parse(debut) + jours * 24 * HEURE).toISOString()) : "";
}

function depuisPlan(ligne: RotationJourney): Brouillon {
  const j = ligne.journey;
  if (!j) {
    const depart = `${ligne.rotation.date_loading}T06:00`;
    return { depart, arrivee: arriveeProposee(depart, ligne), itineraire: "", nuit: false, arrets: [] };
  }
  return {
    depart: versChamp(j.planned_departure),
    arrivee: versChamp(j.planned_arrival),
    itineraire: j.itinerary ?? "",
    nuit: j.night_driving,
    arrets: j.stops.map((s) => ({ cle: prochaineCle++, kind: s.kind, place: s.place ?? "", quand: versChamp(s.planned_at), minutes: String(s.duration_minutes) })),
  };
}

/** Le plan saisi dit-il la même chose que le plan enregistré ? (Un envoi identique remettrait un plan validé à valider.) */
function identique(corps: JourneyInput, j: Journey | null): boolean {
  if (!j) return false;
  const arrets = (liste: JourneyInput["stops"]) => JSON.stringify([...liste].sort((a, b) => a.planned_at.localeCompare(b.planned_at)).map((s) => [s.kind, s.place ?? "", s.planned_at, s.duration_minutes]));
  return (
    corps.planned_departure === j.planned_departure &&
    corps.planned_arrival === j.planned_arrival &&
    (corps.itinerary ?? "") === (j.itinerary ?? "") &&
    corps.night_driving === j.night_driving &&
    arrets(corps.stops) === arrets(j.stops.map((s) => ({ kind: s.kind, place: s.place, planned_at: s.planned_at, duration_minutes: s.duration_minutes })))
  );
}

/** Saisie du plan (chef de parc) : horaires, itinéraire, conduite de nuit, arrêts ; aperçu des écarts avant l'envoi. */
function SaisiePlan({ ligne, onAnnuler, onEnregistre }: { ligne: RotationJourney; onAnnuler: () => void; onEnregistre: (l: RotationJourney) => void }) {
  const [b, setB] = useState<Brouillon>(() => depuisPlan(ligne));
  const [tente, setTente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const titre = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    titre.current?.focus();
  }, []);

  const depart = depuisChamp(b.depart);
  const arrivee = depuisChamp(b.arrivee);
  const horairesOk = depart !== null && arrivee !== null && arrivee > depart;
  const erreurDepart = tente && !depart ? "Heure de départ à saisir." : undefined;
  const erreurArrivee = tente && !arrivee ? "Heure d'arrivée à saisir." : depart && arrivee && arrivee <= depart ? "L'arrivée suit le départ." : undefined;
  // Comme le noyau : un arrêt commence au départ prévu ou après, et finit à l'arrivée prévue au plus tard.
  const erreursArrets = b.arrets.map((a) => {
    const quand = depuisChamp(a.quand);
    const minutes = Number(a.minutes);
    const fin = quand && Number.isInteger(minutes) && minutes > 0 ? Date.parse(quand) + minutes * 60_000 : null;
    return {
      quand: !quand ? (tente ? "Heure à saisir." : undefined) : horairesOk && (quand < depart! || (fin ?? Date.parse(quand)) > Date.parse(arrivee!)) ? "Entre le départ et l'arrivée, durée comprise." : undefined,
      minutes: !Number.isInteger(minutes) || minutes <= 0 ? (tente || a.minutes !== "" ? "Minutes, nombre entier." : undefined) : undefined,
    };
  });
  const arretsOk = erreursArrets.every((e) => !e.quand && !e.minutes) && b.arrets.every((a) => depuisChamp(a.quand) !== null);
  const pret = horairesOk && arretsOk;

  const apercu = horairesOk
    ? ecartsPrevus(
        {
          depart: Date.parse(depart!),
          arrivee: Date.parse(arrivee!),
          arrets: b.arrets.filter((a) => depuisChamp(a.quand)).map((a) => ({ debut: Date.parse(depuisChamp(a.quand)!), minutes: Number(a.minutes) })),
          nuitDeclaree: b.nuit,
        },
        ligne.rules,
        ligne.route,
      )
    : null;

  function arret(cle: number, maj: Partial<ArretSaisi>) {
    setB({ ...b, arrets: b.arrets.map((a) => (a.cle === cle ? { ...a, ...maj } : a)) });
  }

  function ajouterArret() {
    // Proposé à l'heure ronde du milieu du trajet, ou trois heures après le départ.
    const base = horairesOk ? (Date.parse(depart!) + Date.parse(arrivee!)) / 2 : depart ? Date.parse(depart) + 3 * HEURE : null;
    const quand = base === null ? "" : versChamp(new Date(Math.floor(base / HEURE) * HEURE).toISOString());
    setB({ ...b, arrets: [...b.arrets, { cle: prochaineCle++, kind: "break", place: "", quand, minutes: "30" }] });
  }

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setTente(true);
    setErreur(null);
    if (!pret) return;
    const corps: JourneyInput = {
      itinerary: b.itineraire.trim() || null,
      night_driving: b.nuit,
      planned_departure: depart!,
      planned_arrival: arrivee!,
      stops: b.arrets.map((a) => ({ kind: a.kind, place: a.place.trim() || null, planned_at: depuisChamp(a.quand)!, duration_minutes: Number(a.minutes) })),
    };
    if (identique(corps, ligne.journey)) {
      onAnnuler();
      return;
    }
    setEnvoi(true);
    try {
      onEnregistre(await apiSend<RotationJourney>("PUT", `/hsseq/rotations/${ligne.rotation.id}/journey`, corps));
    } catch (err) {
      setErreur(refus(err, "Le plan n'a pas pu être enregistré."));
    } finally {
      setEnvoi(false);
    }
  }

  const r: JourneyRules = ligne.rules;
  return (
    <form noValidate onSubmit={(e) => void envoyer(e)} aria-labelledby={`${id}-titre`} className="mt-4 space-y-4">
      <h4 id={`${id}-titre`} ref={titre} tabIndex={-1} className="text-[14px] font-semibold text-ink outline-none">
        {ligne.journey ? "Modifier le plan de trajet" : "Établir le plan de trajet"}
      </h4>
      {ligne.journey?.status === "validated" && <Notice tone="warn">Ce plan est validé : modifié puis enregistré, il revient à valider, et le motif V08 se rouvre jusqu&apos;à la nouvelle validation.</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Départ prévu" hint="Heure de Conakry." error={erreurDepart}>
          <Input type="datetime-local" value={b.depart} onChange={(e) => setB({ ...b, depart: e.target.value })} required aria-invalid={erreurDepart ? true : undefined} />
        </Field>
        <Field label="Arrivée prévue" hint={ligne.route?.duration_days && !ligne.journey ? "Heure de Conakry. Proposée d'après la durée standard de la route : ajustez-la." : "Heure de Conakry."} error={erreurArrivee}>
          <Input type="datetime-local" min={b.depart || undefined} value={b.arrivee} onChange={(e) => setB({ ...b, arrivee: e.target.value })} required aria-invalid={erreurArrivee ? true : undefined} />
        </Field>
      </div>

      <Field label="Itinéraire" hint="Axes empruntés, points de passage, contournements.">
        <Textarea rows={2} className="min-h-[60px]" maxLength={4000} value={b.itineraire} onChange={(e) => setB({ ...b, itineraire: e.target.value })} placeholder="RN1 par Kindia et Mamou, nuit au parc gardé de Mamou" />
      </Field>

      <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-ink">
        <input type="checkbox" className="mt-1 h-4 w-4 flex-none accent-[var(--accent)]" checked={b.nuit} onChange={(e) => setB({ ...b, nuit: e.target.checked })} />
        <span>
          Conduite de nuit prévue
          <span className="block text-[12px] text-muted">
            Entre {heureDuJour(r.night_start_hour)} et {heureDuJour(r.night_end_hour)}
            {ligne.route?.night_driving_forbidden ? `, interdite sur ${ligne.route.name}` : ""}. Les horaires saisis le disent aussi.
          </span>
        </span>
      </label>

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Arrêts, pauses et repos prévus</legend>
        {b.arrets.length === 0 ? (
          <p className="mb-2 text-[12.5px] text-muted">Aucun arrêt : toute la durée du trajet compte comme conduite.</p>
        ) : (
          <ul className="mb-2 space-y-2">
            {b.arrets.map((a, i) => {
              const err = erreursArrets[i];
              return (
                <li key={a.cle} className="grid grid-cols-2 items-start gap-2 rounded-xl border border-line bg-panel-2 p-2.5 sm:grid-cols-[7.5rem_minmax(0,12.5rem)_5.5rem_minmax(0,1fr)_auto]">
                  <Field label="Nature">
                    <Select value={a.kind} onChange={(e) => arret(a.cle, { kind: e.target.value as StopKind })} options={(Object.keys(NATURE_ARRET) as StopKind[]).map((k) => ({ value: k, label: NATURE_ARRET[k] }))} />
                  </Field>
                  <Field label="Heure" error={err?.quand}>
                    <Input type="datetime-local" min={b.depart || undefined} max={b.arrivee || undefined} value={a.quand} onChange={(e) => arret(a.cle, { quand: e.target.value })} aria-invalid={err?.quand ? true : undefined} />
                  </Field>
                  <Field label="Minutes" error={err?.minutes}>
                    <Input inputMode="numeric" value={a.minutes} onChange={(e) => arret(a.cle, { minutes: e.target.value.replace(/[^\d]/g, "") })} aria-invalid={err?.minutes ? true : undefined} />
                  </Field>
                  <Field label="Lieu">
                    <Input maxLength={200} value={a.place} onChange={(e) => arret(a.cle, { place: e.target.value })} placeholder="Mamou, parc gardé" />
                  </Field>
                  <div className="col-span-2 flex justify-end sm:col-span-1 sm:pt-[26px]">
                    <Button size="sm" variant="ghost" onClick={() => setB({ ...b, arrets: b.arrets.filter((x) => x.cle !== a.cle) })} aria-label={`Retirer l'arrêt ${i + 1}`} title="Retirer">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sm:hidden">Retirer</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Button size="sm" onClick={ajouterArret}>
          <Plus className="h-3.5 w-3.5" /> Ajouter un arrêt
        </Button>
      </fieldset>

      {apercu && (
        <div className="space-y-3 rounded-xl border border-line px-3.5 py-3">
          <ConduiteParJour jours={apercu.parJour} max={r.max_driving_hours} />
          {apercu.ecarts.length ? (
            <div role="status" className="text-[13px] leading-snug text-warn">
              <p className="font-semibold">Ce plan ne sera pas conforme, il ne pourra pas être validé :</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">
                {apercu.ecarts.map((x) => (
                  <li key={`${x.code}-${x.label}`}>{x.label}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p role="status" className="text-[13px] text-ok-texte">Conforme aux règles du trajet : il pourra être validé après l&apos;enregistrement.</p>
          )}
        </div>
      )}

      {erreur && <Notice tone="danger">{erreur}</Notice>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onAnnuler}>Annuler</Button>
        <Button type="submit" variant="primary" loading={envoi}>
          Enregistrer le plan
        </Button>
      </div>
    </form>
  );
}
