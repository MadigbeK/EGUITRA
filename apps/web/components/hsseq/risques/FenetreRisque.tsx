"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { Criticite, MatriceCriticite } from "@/components/hsseq/commun";
import { aProfil, aujourdhui, decaler, useReferentiels } from "@/components/hsseq/actions/outils";
import { apiSend } from "@/lib/api-client";
import { INSECABLE } from "@/lib/format";
import type { Ref, Score, VehicleKind } from "@/lib/hsseq-types";
import { NATURE_RISQUE, ORDRE_NATURES, messageRisque, revueParDefaut } from "./libelles";
import type { Risk, RiskInput, RiskNature, RiskPatch } from "./types";

type Note = { gravite: Score; probabilite: Score };

/**
 * Création d'un risque (Responsable HSSEQ, POST /hsseq/risks) ou mise à jour (propriétaire ou
 * Responsable HSSEQ, PATCH /hsseq/risks/{id}, champs modifiés seulement). Cotations brute et
 * résiduelle choisies dans deux matrices ; à la création, la résiduelle suit la brute tant qu'elle
 * n'est pas choisie. Le propriétaire n'est désigné que par le Responsable HSSEQ.
 */
export function FenetreRisque({ risque, onClose, onEnregistre }: { risque?: Risk; onClose: () => void; onEnregistre: (r: Risk) => void }) {
  const { data: ref } = useReferentiels();
  const creation = !risque;
  const hsseq = aProfil(ref, "hsseq");
  const [f, setF] = useState({
    nature: risque?.nature ?? "",
    vehicle_kind: risque?.vehicle_kind ?? "",
    activity: risque?.activity ?? "",
    site_id: risque?.site ? String(risque.site.id) : "",
    hazard: risque?.hazard ?? "",
    feared_event: risque?.feared_event ?? "",
    owner_id: risque ? String(risque.owner.id) : "",
    review_date: risque?.review_date ?? "",
  });
  const [brute, setBrute] = useState<Note | null>(risque ? { gravite: risque.raw.severity, probabilite: risque.raw.probability } : null);
  const [residuelle, setResiduelle] = useState<Note | null>(risque ? { gravite: risque.residual.severity, probabilite: risque.residual.probability } : null);
  const [tente, setTente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // À la création, la résiduelle suit la brute tant qu'aucune case n'est choisie.
  const apres = residuelle ?? brute;
  const depasse = Boolean(brute && apres && (apres.gravite > brute.gravite || apres.probabilite > brute.probabilite));

  // Sites ouverts au compte, et le site actuel du risque même s'il n'en fait pas partie.
  const sites: Ref[] = (ref?.sites ?? []).filter((s) => s.active && (!ref?.me.site_ids.length || ref.me.site_ids.includes(s.id)));
  if (risque?.site && !sites.some((s) => s.id === risque.site?.id)) sites.unshift(risque.site);
  // Le propriétaire actuel reste dans la liste, même s'il n'est plus proposé par les référentiels ; les
  // conducteurs, servis par les référentiels pour les participants d'un exercice (`driver`), n'en sont pas.
  const proposes = (ref?.owners ?? []).filter((o: Ref & { driver?: boolean }) => !o.driver);
  const proprietaires = risque && !proposes.some((o) => o.id === risque.owner.id) ? [risque.owner, ...proposes] : proposes;

  const manque = {
    nature: !f.nature,
    hazard: !f.hazard.trim(),
    feared_event: !f.feared_event.trim(),
    brute: !brute,
    owner_id: !f.owner_id,
    review_date: !creation && !f.review_date,
  };
  const incomplet = Object.values(manque).some(Boolean) || depasse;

  /** Corps de la création, ou champs modifiés de la mise à jour. */
  function corps(): RiskInput | RiskPatch {
    const valeurs: RiskInput = {
      nature: f.nature as RiskNature,
      vehicle_kind: (f.vehicle_kind || null) as VehicleKind | null,
      activity: f.activity.trim() || null,
      site_id: f.site_id ? Number(f.site_id) : null,
      hazard: f.hazard.trim(),
      feared_event: f.feared_event.trim(),
      raw_severity: brute!.gravite,
      raw_probability: brute!.probabilite,
      owner_id: Number(f.owner_id),
    };
    if (residuelle) Object.assign(valeurs, { residual_severity: residuelle.gravite, residual_probability: residuelle.probabilite });
    if (f.review_date) valeurs.review_date = f.review_date;
    if (!risque) return valeurs;
    const c: RiskPatch = {};
    if (valeurs.nature !== risque.nature) c.nature = valeurs.nature;
    if (valeurs.vehicle_kind !== risque.vehicle_kind) c.vehicle_kind = valeurs.vehicle_kind;
    if (valeurs.activity !== risque.activity) c.activity = valeurs.activity;
    if (valeurs.site_id !== (risque.site?.id ?? null)) c.site_id = valeurs.site_id;
    if (valeurs.hazard !== risque.hazard) c.hazard = valeurs.hazard;
    if (valeurs.feared_event !== risque.feared_event) c.feared_event = valeurs.feared_event;
    if (valeurs.raw_severity !== risque.raw.severity) c.raw_severity = valeurs.raw_severity;
    if (valeurs.raw_probability !== risque.raw.probability) c.raw_probability = valeurs.raw_probability;
    if (residuelle && residuelle.gravite !== risque.residual.severity) c.residual_severity = residuelle.gravite;
    if (residuelle && residuelle.probabilite !== risque.residual.probability) c.residual_probability = residuelle.probabilite;
    if (hsseq && valeurs.owner_id !== risque.owner.id) c.owner_id = valeurs.owner_id;
    if (f.review_date !== risque.review_date) c.review_date = f.review_date;
    return c;
  }

  async function envoyer() {
    setTente(true);
    if (incomplet) return;
    const c = corps();
    if (risque && !Object.keys(c).length) return onClose();
    setEnvoi(true);
    setErreur(null);
    try {
      onEnregistre(risque ? await apiSend<Risk>("PATCH", `/hsseq/risks/${risque.id}`, c) : await apiSend<Risk>("POST", "/hsseq/risks", c));
    } catch (e) {
      setErreur(messageRisque(e, creation ? "Le risque n'a pas été créé." : "Le risque n'a pas été mis à jour."));
    } finally {
      setEnvoi(false);
    }
  }

  const obligatoire = (manquant: boolean, texte = "Obligatoire.") => (tente && manquant ? texte : undefined);

  return (
    <Modal
      open
      wide
      title={risque ? `Modifier le risque ${risque.reference}` : "Nouveau risque"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={envoi} onClick={() => void envoyer()}>
            {creation ? "Créer le risque" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nature" error={obligatoire(manque.nature)}>
          <Select value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })} placeholder="Choisir" options={ORDRE_NATURES.map((n) => ({ value: n, label: NATURE_RISQUE[n].label }))} />
        </Field>
        <Field label="Profil de véhicule">
          <Select
            value={f.vehicle_kind}
            onChange={(e) => setF({ ...f, vehicle_kind: e.target.value })}
            placeholder="Tous les profils"
            options={[
              { value: "tanker", label: "Citerne" },
              { value: "tipper", label: "Benne" },
            ]}
          />
        </Field>
        <Field label="Site" hint={`Sans site, le risque est commun${INSECABLE}: la direction, le Responsable HSSEQ et son propriétaire le lisent, pas les chefs de parc.`}>
          <Select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })} placeholder="Tous les sites" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Activité" hint="Chargement au dépôt, circulation sur la piste minière, dépotage…">
          <Input value={f.activity} maxLength={200} onChange={(e) => setF({ ...f, activity: e.target.value })} />
        </Field>
        <Field label="Danger" className="md:col-span-2" hint={`La source du dommage${INSECABLE}: produit, énergie, situation de travail.`} error={obligatoire(manque.hazard)}>
          <Textarea className="min-h-[64px]" value={f.hazard} maxLength={4000} onChange={(e) => setF({ ...f, hazard: e.target.value })} />
        </Field>
        <Field label="Événement redouté" className="md:col-span-2" hint={`Ce qui peut arriver${INSECABLE}: renversement, épandage, incendie, braquage…`} error={obligatoire(manque.feared_event)}>
          <Textarea className="min-h-[64px]" value={f.feared_event} maxLength={4000} onChange={(e) => setF({ ...f, feared_event: e.target.value })} />
        </Field>

        <div className="md:col-span-2">
          <p className="text-[13px] font-medium text-ink-2">Cotation</p>
          <p className="mb-3 mt-0.5 text-[12.5px] leading-snug text-muted">Choisissez une case dans chaque matrice&nbsp;: la criticité est la gravité multipliée par la probabilité, notées de 1 à 5.</p>
          <div className="flex flex-wrap gap-x-10 gap-y-6">
            <Cotation
              titre="Avant mesures"
              aide="Criticité brute, sans mesure de maîtrise."
              valeur={brute}
              onChoisir={(n) => setBrute(n)}
              erreur={tente && manque.brute ? "Choisissez la case de la cotation brute." : null}
            />
            <Cotation
              titre="Après mesures"
              aide={creation && !residuelle ? "Identique à la brute tant qu'aucune mesure n'est en place." : "Criticité résiduelle, avec les mesures en place."}
              valeur={apres}
              onChoisir={(n) => setResiduelle(n)}
              erreur={depasse ? `La gravité et la probabilité résiduelles ne dépassent pas les brutes${INSECABLE}: les mesures réduisent le risque.` : null}
              reprendre={creation && residuelle ? () => setResiduelle(null) : undefined}
            />
          </div>
        </div>

        {hsseq ? (
          <Field label="Propriétaire" hint="Il met le risque à jour, ajoute ses mesures et en fait la revue." error={obligatoire(manque.owner_id)}>
            <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} placeholder="Choisir" options={proprietaires.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
        ) : (
          <div className="text-[13px]">
            <p className="font-medium text-ink-2">Propriétaire</p>
            <p className="mt-1.5 text-ink">{risque?.owner.name}</p>
            <p className="mt-1 text-[12px] leading-snug text-muted">Désigné par le Responsable HSSEQ.</p>
          </div>
        )}
        <Field
          label="Prochaine revue"
          hint={creation ? `Sans date, ${revueParDefaut(ref?.risk_review_months)}.` : `La revue elle-même se fait par la commande «${INSECABLE}Faire la revue${INSECABLE}».`}
          error={obligatoire(manque.review_date, "Date de revue obligatoire.")}
        >
          <Input type="date" min={creation ? decaler(aujourdhui(), 1) : undefined} value={f.review_date} onChange={(e) => setF({ ...f, review_date: e.target.value })} />
        </Field>

        {erreur && (
          <div className="md:col-span-2">
            <Notice tone="danger">{erreur}</Notice>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Cotation choisie dans une matrice 5 × 5 cliquable, avec sa criticité. */
function Cotation({ titre, aide, valeur, onChoisir, erreur, reprendre }: { titre: string; aide: string; valeur: Note | null; onChoisir: (n: Note) => void; erreur: string | null; reprendre?: () => void }) {
  return (
    <div className="min-w-0 max-w-[19rem]">
      <p className="text-[13.5px] font-semibold text-ink">{titre}</p>
      <p className="mb-3 text-[12.5px] leading-snug text-muted">{aide}</p>
      <MatriceCriticite label={`${titre}${INSECABLE}: choisir la gravité et la probabilité`} taille="normale" legende={false} valeur={valeur} onChoisir={(gravite, probabilite) => onChoisir({ gravite, probabilite })} />
      <div aria-live="polite" className="mt-3 flex min-h-7 flex-wrap items-center gap-2 text-[13px] text-ink-2">
        {valeur ? (
          <>
            <span className="tabular">
              Gravité {valeur.gravite} × probabilité {valeur.probabilite}
            </span>
            <Criticite gravite={valeur.gravite} probabilite={valeur.probabilite} />
          </>
        ) : (
          <span className="text-muted">Aucune case choisie</span>
        )}
        {reprendre && (
          <button type="button" onClick={reprendre} className="text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline">
            Reprendre la brute
          </button>
        )}
      </div>
      {erreur && <p className="mt-1.5 text-[12px] font-medium leading-snug text-danger">{erreur}</p>}
    </div>
  );
}
