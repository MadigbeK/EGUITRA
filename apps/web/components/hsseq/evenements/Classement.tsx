"use client";

/**
 * Classement d'un événement (§9.1) : matrice de criticité 5 × 5 cliquable pour le Responsable HSSEQ
 * (gravité potentielle en abscisse, probabilité en ordonnée), gravité réelle, arrêt de travail.
 * Premier classement par la transition « classify » ; ensuite, mise à jour par PATCH (criticité
 * recalculée par le noyau). Les autres profils lisent la matrice, la case retenue marquée.
 */

import { useState, type ReactNode } from "react";
import { Button, Card, Field, Input, Notice, Select } from "@/components/ui";
import { Criticite, DOMAINE, METHODE_ENQUETE, MatriceCriticite, NIVEAUX, TYPE_EVENEMENT, criticite } from "@/components/hsseq/commun";
import { apiSend } from "@/lib/api-client";
import { fmtInt } from "@/lib/format";
import type { Domain, Event as Evenement, EventClassification, EventType, Referentials, Score } from "@/lib/hsseq-types";
import { ChoixNote, champsRefus, delaiEnquete, effetCriticite, fmtJourHeure, messageRefus, niveauSelon, seuilDe } from "./commun";

const OPTIONS_TYPES = (Object.keys(TYPE_EVENEMENT) as EventType[]).map((t) => ({ value: t, label: TYPE_EVENEMENT[t].label }));
const OPTIONS_DOMAINES = (Object.keys(DOMAINE) as Domain[]).map((d) => ({ value: d, label: DOMAINE[d] }));

export function Classement({ e, referentiels, onMaj }: { e: Evenement; referentiels?: Referentials; onMaj: (e: Evenement) => void }) {
  const premier = e.transitions.includes("classify");
  // Reclassement : Responsable HSSEQ (can_approve), fiche déjà classée et pas encore close.
  const reclasser = !premier && e.rights.can_approve && e.status !== "reported" && e.status !== "closed";
  const editable = premier || reclasser;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {editable ? <Formulaire e={e} referentiels={referentiels} premier={premier} onMaj={onMaj} /> : <Lecture e={e} referentiels={referentiels} />}
      <Card title="Effets du niveau (§9.1)">
        <ul className="space-y-3 text-[13.5px] leading-snug">
          {(["high", "significant", "moderate", "low"] as const).map((n) => {
            const s = seuilDe(n, referentiels?.criticality_thresholds);
            const actif = e.level === n;
            return (
              <li key={n} className={actif ? "rounded-xl bg-accent-doux p-3" : "px-3"}>
                <span className="flex flex-wrap items-center gap-2">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: NIVEAUX[n].couleur }} />
                  <b className="text-ink">{NIVEAUX[n].label}</b>
                  <span className="text-muted tabular">{`${s.min} à ${s.max}`}</span>
                  {actif && <span className="text-[12px] font-semibold text-accent">Niveau de l'événement</span>}
                </span>
                <span className="mt-1 block text-ink-2">{effetCriticite(n, referentiels?.criticality_thresholds).texte}</span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Lecture({ e, referentiels }: { e: Evenement; referentiels?: Referentials }) {
  const classe = e.criticality !== null;
  return (
    <Card title="Criticité retenue">
      <div className="flex flex-wrap items-start gap-6">
        <MatriceCriticite label="Matrice de criticité de l'événement" taille="normale" valeur={classe && e.potential_severity && e.probability ? { gravite: e.potential_severity, probabilite: e.probability } : null} />
        <dl className="min-w-[14rem] flex-1 space-y-2 text-[13.5px]">
          <Ligne terme="Criticité" valeur={<Criticite note={e.criticality} gravite={e.potential_severity} probabilite={e.probability} />} />
          <Ligne terme="Gravité réelle" valeur={e.actual_severity ?? "–"} />
          <Ligne terme="Gravité potentielle" valeur={e.potential_severity ?? "–"} />
          <Ligne terme="Probabilité" valeur={e.probability ?? "–"} />
          <Ligne terme="Arrêt de travail" valeur={e.lost_time ? `Oui, ${fmtInt(e.days_lost)} jours perdus` : "Non"} />
          <Ligne terme="Véhicule immobilisé" valeur={e.vehicle_immobilized ? "Oui" : "Non"} />
          {e.classified_at && <Ligne terme="Classé le" valeur={`${fmtJourHeure(e.classified_at)}${e.classified_by ? `, par ${e.classified_by.name}` : ""}`} />}
          {e.level && (
            <Ligne
              terme="Enquête attendue"
              valeur={(() => {
                const s = seuilDe(e.level, referentiels?.criticality_thresholds);
                return s.method ? `${METHODE_ENQUETE[s.method]}, sous ${delaiEnquete(s.investigation_days) ?? "–"}` : "Aucune";
              })()}
            />
          )}
        </dl>
      </div>
      {!classe && <p className="mt-4 text-[13px] text-muted">En attente de classement par le Responsable HSSEQ.</p>}
    </Card>
  );
}

function Ligne({ terme, valeur }: { terme: string; valeur: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line/70 pb-2 last:border-0">
      <dt className="text-muted">{terme}</dt>
      <dd className="text-right font-medium text-ink tabular">{valeur}</dd>
    </div>
  );
}

function Formulaire({ e, referentiels, premier, onMaj }: { e: Evenement; referentiels?: Referentials; premier: boolean; onMaj: (e: Evenement) => void }) {
  const [type, setType] = useState<EventType>(e.type);
  const [domaine, setDomaine] = useState<Domain>(e.domain);
  const [reelle, setReelle] = useState<Score | null>(e.actual_severity);
  const [potentielle, setPotentielle] = useState<Score | null>(e.potential_severity);
  const [probabilite, setProbabilite] = useState<Score | null>(e.probability);
  const [arret, setArret] = useState(e.lost_time);
  const [jours, setJours] = useState(e.days_lost ? String(e.days_lost) : "");
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [champs, setChamps] = useState<string[]>([]);
  const [tente, setTente] = useState(false);

  const note = criticite(potentielle, probabilite);
  const niveau = niveauSelon(note, referentiels?.criticality_thresholds);
  const effet = niveau ? effetCriticite(niveau, referentiels?.criticality_thresholds) : null;
  const joursPerdus = arret ? Number.parseInt(jours || "0", 10) : 0;
  const joursInvalides = arret && (!Number.isInteger(joursPerdus) || joursPerdus < 0);

  async function envoyer() {
    setTente(true);
    setRefus(null);
    setChamps([]);
    if (!reelle || !potentielle || !probabilite || joursInvalides) {
      setRefus("Notez la gravité réelle, puis choisissez la case de la matrice (gravité potentielle et probabilité).");
      return;
    }
    const corps: EventClassification = {
      type,
      domain: domaine,
      actual_severity: reelle,
      potential_severity: potentielle,
      probability: probabilite,
      lost_time: arret,
      days_lost: joursPerdus,
    };
    setEnvoi(true);
    try {
      onMaj(premier ? await apiSend<Evenement>("POST", `/hsseq/events/${e.id}/classify`, corps) : await apiSend<Evenement>("PATCH", `/hsseq/events/${e.id}`, corps));
    } catch (err) {
      setRefus(messageRefus(err, "Le classement n'a pas été enregistré."));
      setChamps(champsRefus(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Card title={premier ? "Classer l'événement" : "Mettre à jour le classement"}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type d'événement">
            <Select value={type} onChange={(ev) => setType(ev.target.value as EventType)} options={OPTIONS_TYPES} />
          </Field>
          <Field label="Domaine">
            <Select value={domaine} onChange={(ev) => setDomaine(ev.target.value as Domain)} options={OPTIONS_DOMAINES} />
          </Field>
        </div>

        <ChoixNote legende="Gravité réelle" aide="Ce qui est arrivé ; conservée pour les statistiques." valeur={reelle} onChange={setReelle} erreur={(tente && !reelle) || champs.includes("actual_severity")} />

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-2">Gravité potentielle et probabilité</p>
          <p className="mb-3 text-[12.5px] leading-snug text-muted">Choisissez la case : la criticité retenue est la gravité potentielle multipliée par la probabilité.</p>
          <MatriceCriticite
            label="Matrice de criticité : choisir la gravité potentielle et la probabilité"
            taille="normale"
            valeur={potentielle && probabilite ? { gravite: potentielle, probabilite } : null}
            onChoisir={(g, p) => {
              setPotentielle(g);
              setProbabilite(p);
            }}
          />
          {tente && (!potentielle || !probabilite) && <p className="mt-2 text-[12px] font-medium text-danger">Choisissez une case de la matrice.</p>}
        </div>

        <div aria-live="polite">
          {note !== null && effet && (
            <div className="space-y-2">
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                Criticité : <Criticite gravite={potentielle} probabilite={probabilite} />
              </p>
              <Notice tone={effet.ton}>{effet.texte}</Notice>
            </div>
          )}
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Conséquences</legend>
          <label className="flex items-center gap-2 text-[13.5px] text-ink">
            <input type="checkbox" checked={arret} onChange={(ev) => setArret(ev.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Arrêt de travail (accident avec arrêt)
          </label>
          {arret && (
            <Field label="Jours perdus" className="max-w-[12rem]" error={(tente && joursInvalides) || champs.includes("days_lost") ? "Nombre de jours entier." : undefined}>
              <Input inputMode="numeric" value={jours} onChange={(ev) => setJours(ev.target.value.replace(/\D/g, ""))} />
            </Field>
          )}
          <p className="text-[12px] text-muted">Immobilisation du véhicule pour l&apos;enquête : au lot 2, avec le motif V09 du verrou ; elle ne se saisit pas encore.</p>
        </fieldset>

        {refus && <Notice tone="danger">{refus}</Notice>}
        <div className="flex justify-end">
          <Button variant="primary" loading={envoi} onClick={envoyer}>
            {premier ? "Classer l'événement" : "Enregistrer le classement"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
