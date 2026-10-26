"use client";

/**
 * Fenêtres de la fiche d'un risque : revue (propriétaire ou Responsable HSSEQ), archivage et remise
 * en vigueur avec motif (Responsable HSSEQ), ajout et modification d'une mesure de maîtrise
 * (propriétaire ou Responsable HSSEQ). Chacune affiche le refus du noyau au-dessus de ses boutons.
 */

import { useId, useState } from "react";
import { Button, Field, Input, Modal, Notice, Select, Textarea, cx } from "@/components/ui";
import { Criticite } from "@/components/hsseq/commun";
import { aujourdhui, decaler, useReferentiels } from "@/components/hsseq/actions/outils";
import { INSECABLE, fmtDate } from "@/lib/format";
import type { ControlLevel } from "@/lib/hsseq-types";
import { Hierarchie, ORDRE_MAITRISE, ORDRE_STATUTS_MESURE, SENS_MAITRISE, STATUT_MESURE, messageRisque, revueParDefaut } from "./libelles";
import type { MeasureInput, MeasureStatus, ReviewInput, Risk, RiskMeasure } from "./types";

/** Erreur d'une fenêtre : le message du noyau, au-dessus des boutons. */
function ErreurFenetre({ texte }: { texte: string | null }) {
  return texte ? <Notice tone="danger">{texte}</Notice> : null;
}

/**
 * Revue d'un risque en vigueur : constat facultatif, prochaine revue postérieure à aujourd'hui (à
 * défaut, le délai des réglages de la société, servi par les référentiels). La revue est datée et porte
 * le nom de son auteur.
 */
export function FenetreRevue({ r, onClose, envoyer }: { r: Risk; onClose: () => void; envoyer: (corps: ReviewInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [constat, setConstat] = useState("");
  const [prochaine, setProchaine] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const demain = decaler(aujourdhui(), 1);
  const dateInvalide = Boolean(prochaine) && prochaine < demain;
  const enPlace = r.measures.filter((m) => m.status === "in_place").length;
  return (
    <Modal
      open
      title={`Revue du risque ${r.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={envoi}
            disabled={dateInvalide}
            onClick={async () => {
              setEnvoi(true);
              setErreur(null);
              try {
                await envoyer({ comment: constat.trim() || null, next_review_date: prochaine || null });
                onClose();
              } catch (e) {
                setErreur(messageRisque(e, "La revue n'a pas été enregistrée."));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            Enregistrer la revue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-snug text-ink-2">
          Vérifiez sur place les mesures et la cotation résiduelle. Une cotation qui a changé se corrige d&apos;abord par «&nbsp;Modifier&nbsp;»&nbsp;; la revue est datée et porte votre nom.
        </p>
        <dl className="grid grid-cols-2 gap-3 rounded-[10px] bg-panel-2 px-3 py-2.5 text-[13px]">
          <div>
            <dt className="text-[12px] text-muted">Criticité résiduelle</dt>
            <dd className="m-0 mt-1">
              <Criticite note={r.residual.criticality} gravite={r.residual.severity} probabilite={r.residual.probability} />
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Mesures en place</dt>
            <dd className="m-0 mt-1 tabular text-ink">
              {enPlace} sur {r.measures.length}
            </dd>
          </div>
        </dl>
        <Field label="Constat" hint={`Facultatif${INSECABLE}; il est journalisé avec la revue.`}>
          <Textarea value={constat} maxLength={2000} onChange={(e) => setConstat(e.target.value)} placeholder="Mesures vues en place, écarts relevés, cotation confirmée" />
        </Field>
        <Field label="Prochaine revue le" hint={`Postérieure à aujourd'hui. Sans date, ${revueParDefaut(ref?.risk_review_months)}.`} error={dateInvalide ? "La prochaine revue est postérieure à aujourd'hui." : undefined}>
          <Input type="date" min={demain} value={prochaine} onChange={(e) => setProchaine(e.target.value)} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/** Archivage ou remise en vigueur (Responsable HSSEQ) : motif écrit obligatoire, journalisé. */
export function FenetreMotif({ transition, r, onClose, envoyer }: { transition: "archive" | "reactivate"; r: Risk; onClose: () => void; envoyer: (reason: string) => Promise<unknown> }) {
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const archiver = transition === "archive";
  const revueEchue = r.review_date < aujourdhui();
  return (
    <Modal
      open
      title={`${archiver ? "Archiver" : "Remettre en vigueur"} le risque ${r.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Retour</Button>
          <Button
            variant={archiver ? "danger" : "primary"}
            loading={envoi}
            disabled={motif.trim().length < 5}
            onClick={async () => {
              setEnvoi(true);
              setErreur(null);
              try {
                await envoyer(motif.trim());
                onClose();
              } catch (e) {
                setErreur(messageRisque(e, archiver ? "Archivage impossible." : "Remise en vigueur impossible."));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            {archiver ? "Archiver le risque" : "Remettre en vigueur"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-ink-2">
          {archiver
            ? `Le risque sort du registre${INSECABLE}: sa fiche reste lisible, ses mesures et ses pièces ne se modifient plus. Le Responsable HSSEQ peut le remettre en vigueur, avec un motif.`
            : `Le risque revient «${INSECABLE}En vigueur${INSECABLE}» avec sa cotation et ses mesures${INSECABLE}; sa revue est due le ${fmtDate(r.review_date)}${revueEchue ? `, déjà échue${INSECABLE}: faites-la sans tarder.` : "."}`}
        </p>
        <Field label="Motif (obligatoire)" hint={`Cinq caractères au moins${INSECABLE}; il est journalisé avec la décision.`}>
          <Textarea value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} placeholder={archiver ? "Activité arrêtée, danger supprimé, risque fusionné avec un autre…" : "Activité reprise, danger réapparu…"} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/**
 * Mesure de maîtrise : niveau choisi dans la hiérarchie des contrôles (de l'élimination du danger à
 * l'équipement de protection), description, état et action du plan qui la met en place. En
 * modification, seuls les champs changés partent au noyau.
 */
export function FenetreMesure({ r, mesure, onClose, envoyer }: { r: Risk; mesure: RiskMeasure | null; onClose: () => void; envoyer: (corps: Partial<MeasureInput>) => Promise<unknown> }) {
  const nom = useId();
  const [niveau, setNiveau] = useState<ControlLevel | null>(mesure?.control_level ?? null);
  const [description, setDescription] = useState(mesure?.description ?? "");
  const [statut, setStatut] = useState<MeasureStatus>(mesure?.status ?? "planned");
  const [action, setAction] = useState(mesure?.action ? String(mesure.action.id) : "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Actions du plan rattachées au risque ; l'action actuelle de la mesure reste proposée.
  const actions = r.actions.map((a) => ({ value: a.id, label: `${a.reference}, ${a.description.length > 70 ? `${a.description.slice(0, 70)}…` : a.description}` }));
  if (mesure?.action && !r.actions.some((a) => a.id === mesure.action?.id)) actions.unshift({ value: mesure.action.id, label: mesure.action.reference });

  /** Corps de la création, ou champs modifiés. */
  function corps(): Partial<MeasureInput> {
    const actionId = action ? Number(action) : null;
    if (!mesure) return { control_level: niveau!, description: description.trim(), status: statut, ...(actionId ? { action_id: actionId } : {}) };
    const c: Partial<MeasureInput> = {};
    if (niveau !== mesure.control_level) c.control_level = niveau!;
    if (description.trim() !== mesure.description) c.description = description.trim();
    if (statut !== mesure.status) c.status = statut;
    if (actionId !== (mesure.action?.id ?? null)) c.action_id = actionId;
    return c;
  }

  return (
    <Modal
      open
      title={mesure ? `Modifier une mesure de ${r.reference}` : `Nouvelle mesure, ${r.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={envoi}
            disabled={!niveau || !description.trim()}
            onClick={async () => {
              const c = corps();
              if (!Object.keys(c).length) return onClose();
              setEnvoi(true);
              setErreur(null);
              try {
                await envoyer(c);
                onClose();
              } catch (e) {
                setErreur(messageRisque(e, "La mesure n'a pas été enregistrée."));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            {mesure ? "Enregistrer" : "Ajouter la mesure"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Niveau de maîtrise</legend>
          <p className="mb-2 text-[12.5px] leading-snug text-muted">Du plus fort au plus faible&nbsp;: la hiérarchie des contrôles. Une mesure qui supprime ou isole le danger passe avant les consignes et les équipements de protection.</p>
          {ORDRE_MAITRISE.map((n) => (
            <label key={n} className={cx("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2 transition-colors", niveau === n ? "border-accent bg-accent-doux" : "border-line hover:border-line-strong")}>
              <input type="radio" name={nom} className="mt-1 accent-[var(--accent)]" checked={niveau === n} onChange={() => setNiveau(n)} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  <Hierarchie niveau={n} />
                </span>
                <span className="block text-[12.5px] leading-snug text-muted">{SENS_MAITRISE[n]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Mesure">
          <Textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="Ce qui est fait, où et par qui" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="État">
            <Select value={statut} onChange={(e) => setStatut(e.target.value as MeasureStatus)} options={ORDRE_STATUTS_MESURE.map((s) => ({ value: s, label: STATUT_MESURE[s] }))} />
          </Field>
          {actions.length > 0 && (
            <Field label="Action de mise en place" hint="Une action du plan rattachée à ce risque.">
              <Select value={action} onChange={(e) => setAction(e.target.value)} placeholder="Aucune" options={actions} />
            </Field>
          )}
        </div>
        {statut === "in_place" && mesure?.status !== "in_place" && <p className="text-[12.5px] leading-snug text-muted">Une mesure mise en place peut abaisser la cotation résiduelle&nbsp;: revoyez-la par «&nbsp;Modifier&nbsp;» dans la fiche.</p>}
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}
