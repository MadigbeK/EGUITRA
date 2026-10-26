"use client";

/**
 * Fenêtres de saisie de l'écran « Environnement et qualité » : déclaration et modification d'un
 * déversement, inscription d'un déchet et son enlèvement (bordereau joint d'abord), mesure de
 * poussières, contamination, réclamation et sa réponse, clôture avec un texte obligatoire, motif d'une
 * réouverture. En modification, seuls les champs changés partent. Chaque fenêtre garde le refus du
 * noyau au-dessus des boutons et se ferme sur la réussite.
 */

import { useState } from "react";
import { Field, FileButton, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { ErreurFenetre } from "@/components/hsseq/conformite/commun";
import { FORMATS_PIECE, Pieces, aujourdhui, useReferentiels } from "@/components/hsseq/actions/outils";
import { fmtDate } from "@/lib/format";
import { ChampEvenement, ChampSiteSaisie, ChampsRotation, ChoixCartes, Groupe, Pied, siteParDefaut, useEnvoi } from "./champs";
import {
  GRAVITE,
  NATURE_CONTAMINATION,
  NATURE_DECHET,
  NATURE_RECLAMATION,
  ORDRE_CONTAMINATIONS,
  ORDRE_DECHETS,
  ORDRE_GRAVITES,
  ORDRE_RECLAMATIONS,
  ORDRE_UNITES,
  TamponEnv,
  UNITE_DECHET,
  UNITE_PAR_DEFAUT,
  UNITE_POUSSIERE,
  depuisChampHeure,
  ecrireNombre,
  fmtPoussiere,
  fmtQuantite,
  lireNombre,
  messageErreur,
  piecesLues,
  versChampHeure,
  type Droits,
} from "./commun";
import type {
  AnswerInput,
  CollectInput,
  Complaint,
  ComplaintInput,
  ComplaintNature,
  ComplaintSeverity,
  Contamination,
  ContaminationInput,
  ContaminationNature,
  DustInput,
  DustMeasure,
  DustUnit,
  ReferentielsEnvironnement,
  Spill,
  SpillInput,
  Waste,
  WasteInput,
  WasteKind,
  WasteUnit,
} from "./types";

/** Heure courante pour un champ « date et heure », en UTC (l'heure de Conakry). */
const maintenant = () => new Date().toISOString().slice(0, 16);

/** Garde, d'un corps complet, les seules valeurs qui changent par rapport à la fiche (modification). */
function changes<T extends object>(valeurs: T, avant: Partial<Record<keyof T, unknown>>): Partial<T> {
  return Object.fromEntries(Object.entries(valeurs).filter(([cle, v]) => v !== avant[cle as keyof T])) as Partial<T>;
}

const id = (v: string): number | null => (v ? Number(v) : null);

/* ─── Déversement ─────────────────────────────────────────────────────── */

/**
 * Déclaration (sans `deversement`) ou modification d'un déversement : date et heure, site (ceux du
 * chef de parc, obligatoire pour lui), lieu, produit, volumes déversé et récupéré, coût, ensemble,
 * rotation et événement du domaine environnement, récupération et confinement.
 */
export function FenetreDeversement({ deversement, droits, onClose, envoyer }: { deversement?: Spill; droits: Droits; onClose: () => void; envoyer: (corps: SpillInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const refEnv = ref as ReferentielsEnvironnement | undefined;
  const d = deversement;
  const [f, setF] = useState(() => ({
    occurred_at: versChampHeure(d?.occurred_at) || maintenant(),
    site_id: siteParDefaut(refEnv, droits, d?.site?.id),
    location: d?.location ?? "",
    product_label: d?.product_label ?? "",
    volume_liters: ecrireNombre(d?.volume_liters),
    recovered_liters: ecrireNombre(d ? d.recovered_liters : 0),
    cost: d?.cost ? ecrireNombre(d.cost) : "",
    vehicle_id: d?.vehicle ? String(d.vehicle.id) : "",
    rotation_id: d?.rotation ? String(d.rotation.id) : "",
    event_id: d?.event ? String(d.event.id) : "",
    recovery: d?.recovery ?? "",
  }));
  // Le site du chef de parc se pose quand les référentiels arrivent après l'ouverture.
  if (!f.site_id && droits.chefDeParc && siteParDefaut(refEnv, droits)) setF({ ...f, site_id: siteParDefaut(refEnv, droits) });
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, d ? "Modification impossible." : "Déclaration impossible.");
  const volume = lireNombre(f.volume_liters);
  const recupere = lireNombre(f.recovered_liters) ?? 0;
  const cout = lireNombre(f.cost);
  const erreurVolume = f.volume_liters && (volume === null || volume <= 0) ? "Volume positif, en litres." : undefined;
  const erreurRecupere = recupere < 0 || (volume !== null && recupere > volume) ? "Entre zéro et le volume déversé." : undefined;
  const erreurCout = f.cost && (cout === null || cout < 0) ? "Montant invalide." : undefined;
  const futur = f.occurred_at > maintenant();
  const pret = Boolean(f.occurred_at && !futur && volume && volume > 0 && !erreurRecupere && !erreurCout && (!droits.chefDeParc || f.site_id));

  function corps(): SpillInput {
    const valeurs: SpillInput = {
      occurred_at: depuisChampHeure(f.occurred_at),
      site_id: id(f.site_id),
      location: f.location.trim() || null,
      product_label: f.product_label.trim() || null,
      volume_liters: volume ?? 0,
      recovered_liters: recupere,
      cost: Math.round(cout ?? 0),
      vehicle_id: id(f.vehicle_id),
      rotation_id: id(f.rotation_id),
      event_id: id(f.event_id),
      recovery: f.recovery.trim() || null,
    };
    if (!d) return valeurs;
    return changes(valeurs, {
      occurred_at: d.occurred_at.slice(0, 16) === f.occurred_at ? valeurs.occurred_at : d.occurred_at,
      site_id: d.site?.id ?? null,
      location: d.location,
      product_label: d.product_label,
      volume_liters: d.volume_liters,
      recovered_liters: d.recovered_liters,
      cost: d.cost,
      vehicle_id: d.vehicle?.id ?? null,
      rotation_id: d.rotation?.id ?? null,
      event_id: d.event?.id ?? null,
      recovery: d.recovery,
    });
  }

  return (
    <Modal
      open
      wide
      title={d ? `Modifier le déversement ${d.reference}` : "Déclarer un déversement"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={d ? "Enregistrer" : "Déclarer le déversement"}
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => {
            const c = corps();
            if (!Object.keys(c).length) return onClose();
            void lancer(() => envoyer(c));
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Survenu le" error={futur ? "Date et heure passées." : undefined}>
          <Input type="datetime-local" max={maintenant()} value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} required />
        </Field>
        <ChampSiteSaisie ref_={refEnv} droits={droits} valeur={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} facultatif="Aucun : siège ou lieu hors site" actuel={d?.site?.id} aide="Sans site, le déversement n'est lu que par l'administration, la direction et le Responsable HSSEQ." />
        <Field label="Lieu" className="md:col-span-2">
          <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Poste de chargement, aire de lavage, station du client…" maxLength={300} />
        </Field>
        <Field label="Produit" hint={d?.product ? `Produit de Transport : ${d.product.name}.` : "Gasoil, essence, huile moteur, liquide de refroidissement, eaux souillées…"}>
          <Input value={f.product_label} onChange={(e) => setF({ ...f, product_label: e.target.value })} maxLength={200} />
        </Field>
        <Field label="Coût (GNF)" hint="Dépollution, produit perdu." error={erreurCout}>
          <Input inputMode="numeric" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="Non chiffré" />
        </Field>
        <Field label="Volume déversé (L)" error={erreurVolume}>
          <Input inputMode="decimal" value={f.volume_liters} onChange={(e) => setF({ ...f, volume_liters: e.target.value })} required />
        </Field>
        <Field label="Volume récupéré (L)" error={erreurRecupere}>
          <Input inputMode="decimal" value={f.recovered_liters} onChange={(e) => setF({ ...f, recovered_liters: e.target.value })} />
        </Field>
        <ChampsRotation
          ref_={refEnv}
          site={f.site_id}
          jourInitial={f.occurred_at.slice(0, 10)}
          vehicule={f.vehicle_id}
          rotation={f.rotation_id}
          actuelle={d?.rotation}
          vehiculeActuel={d?.vehicle}
          onVehicule={(v) => setF((x) => ({ ...x, vehicle_id: v }))}
          onRotation={(r, v) => setF((x) => ({ ...x, rotation_id: r, vehicle_id: v ? String(v) : x.vehicle_id }))}
        />
        <ChampEvenement domaine="environment" valeur={f.event_id} actuel={d?.event} onChange={(v) => setF({ ...f, event_id: v })} className="md:col-span-2" />
        <Field label="Récupération et confinement" hint="Obligatoire pour clore le déversement : moyens engagés, produit repompé, terres évacuées." className="md:col-span-2">
          <Textarea value={f.recovery} onChange={(e) => setF({ ...f, recovery: e.target.value })} maxLength={4000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Clôture et réouverture ──────────────────────────────────────────── */

/**
 * Clôture qui exige un texte (récupération d'un déversement, mesures d'une contamination), repris de la
 * fiche et complété au besoin ; il part avec la transition.
 */
export function FenetreCloture({ titre, aide, label, texte, action, onClose, envoyer }: { titre: string; aide: string; label: string; texte: string | null; action: string; onClose: () => void; envoyer: (texte: string) => Promise<unknown> }) {
  const [valeur, setValeur] = useState(texte ?? "");
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Clôture impossible.");
  return (
    <Modal open title={titre} onClose={onClose} footer={<Pied onClose={onClose} action={action} envoi={envoi} pret={Boolean(valeur.trim())} onEnvoyer={() => void lancer(() => envoyer(valeur.trim()))} />}>
      <div className="space-y-4">
        <p className="text-[13px] leading-snug text-ink-2">{aide}</p>
        <Field label={label}>
          <Textarea value={valeur} onChange={(e) => setValeur(e.target.value)} maxLength={4000} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/** Réouverture d'une fiche close (Responsable HSSEQ) : motif écrit obligatoire, journalisé. */
export function FenetreMotif({ titre, aide, onClose, envoyer }: { titre: string; aide: string; onClose: () => void; envoyer: (motif: string) => Promise<unknown> }) {
  const [motif, setMotif] = useState("");
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Réouverture impossible.");
  return (
    <Modal open title={titre} onClose={onClose} footer={<Pied onClose={onClose} retour="Retour" action="Rouvrir" envoi={envoi} pret={motif.trim().length >= 5} onEnvoyer={() => void lancer(() => envoyer(motif.trim()))} />}>
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-ink-2">{aide}</p>
        <Field label="Motif (obligatoire)" hint="Cinq caractères au moins.">
          <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/* ─── Déchets ─────────────────────────────────────────────────────────── */

/**
 * Inscription (sans `dechet`) ou modification d'un déchet du registre : nature (précision obligatoire
 * pour un autre déchet), quantité et unité proposée selon la nature, site, date d'entreposage,
 * prestataire et bordereau quand ils sont déjà connus.
 */
export function FenetreDechet({ dechet, droits, onClose, envoyer }: { dechet?: Waste; droits: Droits; onClose: () => void; envoyer: (corps: WasteInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const refEnv = ref as ReferentielsEnvironnement | undefined;
  const w = dechet;
  const [f, setF] = useState(() => ({
    waste_kind: w?.waste_kind ?? ("" as WasteKind | ""),
    description: w?.description ?? "",
    quantity: ecrireNombre(w?.quantity),
    unit: w?.unit ?? ("" as WasteUnit | ""),
    site_id: siteParDefaut(refEnv, droits, w?.site?.id),
    produced_on: w?.produced_on ?? aujourdhui(),
    provider_name: w?.provider?.name ?? "",
    manifest_reference: w?.manifest_reference ?? "",
    note: w?.note ?? "",
  }));
  if (!f.site_id && droits.chefDeParc && siteParDefaut(refEnv, droits)) setF({ ...f, site_id: siteParDefaut(refEnv, droits) });
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, w ? "Modification impossible." : "Inscription impossible.");
  const quantite = lireNombre(f.quantity);
  const unite = f.unit || (f.waste_kind ? UNITE_PAR_DEFAUT[f.waste_kind] : "");
  const precision = f.waste_kind === "other" && !f.description.trim();
  const pret = Boolean(f.waste_kind && quantite && quantite > 0 && !precision && f.produced_on && f.produced_on <= aujourdhui() && (!droits.chefDeParc || f.site_id));

  function corps(): WasteInput {
    const valeurs: WasteInput = {
      waste_kind: f.waste_kind || undefined,
      description: f.description.trim() || null,
      quantity: quantite ?? 0,
      unit: (unite || undefined) as WasteUnit | undefined,
      site_id: id(f.site_id),
      produced_on: f.produced_on,
      provider_name: f.provider_name.trim() || null,
      manifest_reference: f.manifest_reference.trim() || null,
      note: f.note.trim() || null,
    };
    if (!w) return valeurs;
    return changes(valeurs, {
      waste_kind: w.waste_kind, description: w.description, quantity: w.quantity, unit: w.unit, site_id: w.site?.id ?? null, produced_on: w.produced_on,
      provider_name: w.provider?.name ?? null, manifest_reference: w.manifest_reference, note: w.note,
    });
  }

  return (
    <Modal
      open
      wide
      title={w ? `Modifier le déchet ${w.reference}` : "Inscrire un déchet au registre"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={w ? "Enregistrer" : "Inscrire le déchet"}
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => {
            const c = corps();
            if (!Object.keys(c).length) return onClose();
            void lancer(() => envoyer(c));
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nature">
          <Select value={f.waste_kind} onChange={(e) => setF({ ...f, waste_kind: e.target.value as WasteKind | "", unit: "" })} placeholder="À choisir" options={ORDRE_DECHETS.map((k) => ({ value: k, label: NATURE_DECHET[k] }))} />
        </Field>
        <Field label="Précision" hint="Obligatoire pour un autre déchet : batteries, terres souillées, chiffons…" error={precision && f.description !== "" ? "Précisez le déchet." : undefined}>
          <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={200} />
        </Field>
        <Field label="Quantité" error={f.quantity && (quantite === null || quantite <= 0) ? "Quantité positive." : undefined}>
          <Input inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required />
        </Field>
        <Field label="Unité" hint={f.waste_kind && !f.unit ? "Proposée selon la nature." : undefined}>
          <Select value={unite} onChange={(e) => setF({ ...f, unit: e.target.value as WasteUnit })} placeholder={f.waste_kind ? undefined : "Selon la nature"} options={ORDRE_UNITES.map((u) => ({ value: u, label: UNITE_DECHET[u] }))} />
        </Field>
        <ChampSiteSaisie ref_={refEnv} droits={droits} valeur={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} facultatif="Aucun" actuel={w?.site?.id} />
        <Field label="Entreposé le">
          <Input type="date" max={aujourdhui()} value={f.produced_on} onChange={(e) => setF({ ...f, produced_on: e.target.value })} required />
        </Field>
        <Field label="Prestataire prévu" hint="Le collecteur agréé, s'il est déjà connu.">
          <Input value={f.provider_name} onChange={(e) => setF({ ...f, provider_name: e.target.value })} maxLength={200} />
        </Field>
        <Field label="Numéro du bordereau" hint="Bordereau de suivi des déchets, s'il est déjà établi.">
          <Input value={f.manifest_reference} onChange={(e) => setF({ ...f, manifest_reference: e.target.value })} maxLength={64} />
        </Field>
        <Field label="Observations" className="md:col-span-2">
          <Textarea className="min-h-[60px]" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={2000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Enlèvement d'un déchet par un prestataire : date (entre l'entreposage et aujourd'hui), prestataire,
 * numéro du bordereau, et le bordereau lui-même, joint d'abord (le noyau refuse l'enlèvement sans lui).
 */
export function FenetreEnlevement({ dechet, anonyme, televerser, retirable, onRetiree, onClose, envoyer }: { dechet: Waste; anonyme: boolean; televerser: (f: File) => Promise<void>; retirable: (p: { created_by: { id: number } | null }) => boolean; onRetiree: () => void; onClose: () => void; envoyer: (corps: CollectInput) => Promise<unknown> }) {
  const [f, setF] = useState({ pickup_date: aujourdhui() < dechet.produced_on ? dechet.produced_on : aujourdhui(), provider_name: dechet.provider?.name ?? "", manifest_reference: dechet.manifest_reference ?? "" });
  const { erreur, envoi, envoyer: lancer, setErreur } = useEnvoi(onClose, "Enlèvement impossible.");
  const [depot, setDepot] = useState(false);
  const sansBordereau = dechet.attachments.length === 0;
  const pret = Boolean(f.pickup_date && f.pickup_date <= aujourdhui() && f.pickup_date >= dechet.produced_on && f.provider_name.trim() && f.manifest_reference.trim() && !sansBordereau && !depot);
  async function joindre(fichier: File) {
    setDepot(true);
    setErreur(null);
    try {
      await televerser(fichier);
    } catch (e) {
      setErreur(messageErreur(e, "Dépôt impossible."));
    } finally {
      setDepot(false);
    }
  }
  return (
    <Modal
      open
      wide
      title={`Enlèvement de ${dechet.reference}`}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action="Enregistrer l'enlèvement"
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => void lancer(() => envoyer({ pickup_date: f.pickup_date, provider_name: f.provider_name.trim(), manifest_reference: f.manifest_reference.trim() }))}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <p className="rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2 md:col-span-2">
          <span className="font-semibold text-ink">{dechet.description ? `${NATURE_DECHET[dechet.waste_kind]}, ${dechet.description}` : NATURE_DECHET[dechet.waste_kind]} : </span>
          {fmtQuantite(dechet.quantity, dechet.unit)}, entreposé le {fmtDate(dechet.produced_on)}
          {dechet.site ? `, ${dechet.site.name}` : ""}.
        </p>
        <Field label="Enlevé le" hint="Entre l'entreposage et aujourd'hui.">
          <Input type="date" min={dechet.produced_on} max={aujourdhui()} value={f.pickup_date} onChange={(e) => setF({ ...f, pickup_date: e.target.value })} required />
        </Field>
        <Field label="Prestataire">
          <Input value={f.provider_name} onChange={(e) => setF({ ...f, provider_name: e.target.value })} placeholder="Collecteur agréé" maxLength={200} required />
        </Field>
        <Field label="Numéro du bordereau" className="md:col-span-2">
          <Input value={f.manifest_reference} onChange={(e) => setF({ ...f, manifest_reference: e.target.value })} placeholder="Numéro du bordereau de suivi des déchets" maxLength={64} required />
        </Field>
        <div className="space-y-2.5 md:col-span-2">
          <span className="block text-[13px] font-medium text-ink-2">Bordereau signé</span>
          <Pieces pieces={piecesLues(dechet.attachments, anonyme)} retirable={retirable} onRetiree={onRetiree} onErreur={setErreur} vide={<p className="text-[13px] font-medium text-warn">Aucun bordereau joint : l&apos;enlèvement ne s&apos;enregistre pas sans lui.</p>} />
          <div className="flex items-center gap-2">
            <FileButton small label={sansBordereau ? "Joindre le bordereau" : "Joindre une autre pièce"} accept={FORMATS_PIECE} onFile={(x) => void joindre(x)} />
            {depot && <span className="text-[12px] text-muted">Envoi…</span>}
          </div>
          <p className="text-[12px] text-muted">PDF ou photo JPEG ou PNG, 8 Mo au plus.</p>
        </div>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Poussières ──────────────────────────────────────────────────────── */

/**
 * Saisie (sans `mesure`) ou modification d'une mesure de poussières : site (obligatoire), date, point de
 * mesure, valeur et seuil dans la même unité, appareil ou méthode. Le dépassement se lit dès la saisie.
 */
export function FenetreMesure({ mesure, droits, onClose, envoyer }: { mesure?: DustMeasure; droits: Droits; onClose: () => void; envoyer: (corps: DustInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const refEnv = ref as ReferentielsEnvironnement | undefined;
  const m = mesure;
  const [f, setF] = useState(() => ({
    site_id: siteParDefaut(refEnv, droits, m?.site.id),
    measured_on: m?.measured_on ?? aujourdhui(),
    point: m?.point ?? "",
    value: ecrireNombre(m?.value),
    unit: m?.unit ?? ("mg_m3" as DustUnit),
    threshold: ecrireNombre(m?.threshold),
    method: m?.method ?? "",
    note: m?.note ?? "",
  }));
  if (!f.site_id && droits.chefDeParc && siteParDefaut(refEnv, droits)) setF({ ...f, site_id: siteParDefaut(refEnv, droits) });
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, m ? "Modification impossible." : "Saisie impossible.");
  const valeur = lireNombre(f.value);
  const seuil = lireNombre(f.threshold);
  const pret = Boolean(f.site_id && f.measured_on && f.measured_on <= aujourdhui() && valeur !== null && valeur >= 0 && seuil !== null && seuil > 0);

  function corps(): DustInput {
    const valeurs: DustInput = {
      site_id: Number(f.site_id),
      measured_on: f.measured_on,
      point: f.point.trim() || null,
      value: valeur ?? 0,
      unit: f.unit,
      threshold: seuil ?? 0,
      method: f.method.trim() || null,
      note: f.note.trim() || null,
    };
    if (!m) return valeurs;
    return changes(valeurs, { site_id: m.site.id, measured_on: m.measured_on, point: m.point, value: m.value, unit: m.unit, threshold: m.threshold, method: m.method, note: m.note });
  }

  return (
    <Modal
      open
      wide
      title={m ? "Modifier la mesure de poussières" : "Saisir une mesure de poussières"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={m ? "Enregistrer" : "Enregistrer la mesure"}
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => {
            const c = corps();
            if (!Object.keys(c).length) return onClose();
            void lancer(() => envoyer(c));
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChampSiteSaisie ref_={refEnv} droits={droits} valeur={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} actuel={m?.site.id} />
        <Field label="Mesuré le">
          <Input type="date" max={aujourdhui()} value={f.measured_on} onChange={(e) => setF({ ...f, measured_on: e.target.value })} required />
        </Field>
        <Field label="Point de mesure" className="md:col-span-2">
          <Input value={f.point} onChange={(e) => setF({ ...f, point: e.target.value })} placeholder="Piste d'accès, aire de chargement, limite de propriété…" maxLength={200} />
        </Field>
        <Groupe label="Unité" className="md:col-span-2">
          <Segmented<DustUnit>
            label="Unité de la mesure et du seuil"
            value={f.unit}
            onChange={(u) => setF({ ...f, unit: u })}
            options={[
              { key: "mg_m3", label: UNITE_POUSSIERE.mg_m3 },
              { key: "ug_m3", label: UNITE_POUSSIERE.ug_m3 },
            ]}
          />
        </Groupe>
        <Field label={`Valeur mesurée (${UNITE_POUSSIERE[f.unit]})`} error={f.value && (valeur === null || valeur < 0) ? "Valeur positive ou nulle." : undefined}>
          <Input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required />
        </Field>
        <Field label={`Seuil (${UNITE_POUSSIERE[f.unit]})`} hint="Valeur limite de l'autorisation du site ou du donneur d'ordre, dans l'unité de la mesure." error={f.threshold && (seuil === null || seuil <= 0) ? "Seuil positif." : undefined}>
          <Input inputMode="decimal" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} required />
        </Field>
        {valeur !== null && seuil !== null && seuil > 0 && (
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2 md:col-span-2">
            <TamponEnv mot={valeur > seuil ? "Seuil dépassé" : "Sous le seuil"} />
            {fmtPoussiere(valeur, f.unit)} pour un seuil de {fmtPoussiere(seuil, f.unit)}.
          </p>
        )}
        <Field label="Appareil ou méthode" className="md:col-span-2">
          <Input value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="Pompe et cassette, capteur optique, durée du prélèvement" maxLength={200} />
        </Field>
        <Field label="Observations" className="md:col-span-2">
          <Textarea className="min-h-[60px]" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={2000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Contamination ───────────────────────────────────────────────────── */

/**
 * Saisie (sans `contamination`) ou modification d'une contamination de produit (Responsable HSSEQ) :
 * nature, constat, date, rotation (son ensemble, son site et son produit sont repris par le noyau),
 * volume touché, coût, événement du domaine qualité, mesures prises.
 */
export function FenetreContamination({ contamination, droits, onClose, envoyer }: { contamination?: Contamination; droits: Droits; onClose: () => void; envoyer: (corps: ContaminationInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const refEnv = ref as ReferentielsEnvironnement | undefined;
  const c = contamination;
  const [nature, setNature] = useState<ContaminationNature | null>(c?.nature ?? null);
  const [f, setF] = useState(() => ({
    description: c?.description ?? "",
    detected_on: c?.detected_on ?? aujourdhui(),
    site_id: c?.site ? String(c.site.id) : "",
    vehicle_id: c?.vehicle ? String(c.vehicle.id) : "",
    rotation_id: c?.rotation ? String(c.rotation.id) : "",
    volume_m3: c?.volume_m3 ? ecrireNombre(c.volume_m3) : "",
    cost: c?.cost ? ecrireNombre(c.cost) : "",
    event_id: c?.event ? String(c.event.id) : "",
    measures: c?.measures ?? "",
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, c ? "Modification impossible." : "Enregistrement impossible.");
  const volume = lireNombre(f.volume_m3);
  const cout = lireNombre(f.cost);
  const erreurVolume = f.volume_m3 && (volume === null || volume < 0) ? "Volume positif ou nul, en m³." : undefined;
  const erreurCout = f.cost && (cout === null || cout < 0) ? "Montant invalide." : undefined;
  const pret = Boolean(nature && f.description.trim() && f.detected_on && f.detected_on <= aujourdhui() && !erreurVolume && !erreurCout);

  function corps(): ContaminationInput {
    const valeurs: ContaminationInput = {
      nature: nature ?? undefined,
      description: f.description.trim(),
      detected_on: f.detected_on,
      site_id: id(f.site_id),
      vehicle_id: id(f.vehicle_id),
      rotation_id: id(f.rotation_id),
      volume_m3: volume ?? 0,
      cost: Math.round(cout ?? 0),
      event_id: id(f.event_id),
      measures: f.measures.trim() || null,
    };
    if (!c) return valeurs;
    return changes(valeurs, {
      nature: c.nature, description: c.description, detected_on: c.detected_on, site_id: c.site?.id ?? null, vehicle_id: c.vehicle?.id ?? null, rotation_id: c.rotation?.id ?? null,
      volume_m3: c.volume_m3 ?? 0, cost: c.cost, event_id: c.event?.id ?? null, measures: c.measures,
    });
  }

  return (
    <Modal
      open
      wide
      title={c ? `Modifier la contamination ${c.reference}` : "Nouvelle contamination de produit"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={c ? "Enregistrer" : "Enregistrer la contamination"}
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => {
            const x = corps();
            if (!Object.keys(x).length) return onClose();
            void lancer(() => envoyer(x));
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <ChoixCartes legende="Nature" nom="nature-contamination" colonnes valeur={nature} onChange={setNature} options={ORDRE_CONTAMINATIONS.map((k) => ({ key: k, titre: NATURE_CONTAMINATION[k].label, aide: NATURE_CONTAMINATION[k].aide }))} />
        </div>
        <Field label="Constat" className="md:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ce qui a été constaté, où, par qui (jaugeage, analyse, filtre du client)" maxLength={4000} />
        </Field>
        <Field label="Constatée le">
          <Input type="date" max={aujourdhui()} value={f.detected_on} onChange={(e) => setF({ ...f, detected_on: e.target.value })} required />
        </Field>
        <ChampSiteSaisie ref_={refEnv} droits={droits} valeur={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} facultatif="Celui de l'ensemble" actuel={c?.site?.id} />
        <ChampsRotation
          ref_={refEnv}
          site={f.site_id}
          jourInitial={f.detected_on}
          vehicule={f.vehicle_id}
          rotation={f.rotation_id}
          actuelle={c?.rotation}
          vehiculeActuel={c?.vehicle}
          onVehicule={(v) => setF((x) => ({ ...x, vehicle_id: v }))}
          onRotation={(r, v) => setF((x) => ({ ...x, rotation_id: r, vehicle_id: v ? String(v) : x.vehicle_id }))}
        />
        <Field label="Volume touché (m³)" error={erreurVolume}>
          <Input inputMode="decimal" value={f.volume_m3} onChange={(e) => setF({ ...f, volume_m3: e.target.value })} placeholder="Non mesuré" />
        </Field>
        <Field label="Coût (GNF)" hint="Produit déclassé, reprise, analyses." error={erreurCout}>
          <Input inputMode="numeric" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="Non chiffré" />
        </Field>
        <ChampEvenement domaine="quality" valeur={f.event_id} actuel={c?.event} onChange={(v) => setF({ ...f, event_id: v })} className="md:col-span-2" />
        <Field label="Mesures prises" hint="Obligatoires pour clore la contamination." className="md:col-span-2">
          <Textarea value={f.measures} onChange={(e) => setF({ ...f, measures: e.target.value })} placeholder="Purge, reprise du produit, contrôle de l'étanchéité…" maxLength={4000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Réclamation ─────────────────────────────────────────────────────── */

/**
 * Saisie (sans `reclamation`) ou modification d'une réclamation client (Responsable HSSEQ) : client ou
 * rotation (le client de la rotation est repris ; une rotation d'un autre client est refusée), nature,
 * gravité, date de réception, réclamation ; en modification, l'échéance de la réponse.
 */
export function FenetreReclamation({ reclamation, droits, onClose, envoyer }: { reclamation?: Complaint; droits: Droits; onClose: () => void; envoyer: (corps: ComplaintInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const refEnv = ref as ReferentielsEnvironnement | undefined;
  const r = reclamation;
  const [f, setF] = useState(() => ({
    partner_id: r ? String(r.partner.id) : "",
    vehicle_id: r?.vehicle ? String(r.vehicle.id) : "",
    rotation_id: r?.rotation ? String(r.rotation.id) : "",
    site_id: r?.site ? String(r.site.id) : "",
    nature: r?.nature ?? ("" as ComplaintNature | ""),
    severity: r?.severity ?? ("minor" as ComplaintSeverity),
    received_on: r?.received_on ?? aujourdhui(),
    description: r?.description ?? "",
    response_due: r?.response_due ?? "",
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, r ? "Modification impossible." : "Enregistrement impossible.");
  const clients = refEnv?.clients ?? [];
  const optionsClients = clients.map((c) => ({ value: c.id, label: c.name }));
  if (r && !optionsClients.some((o) => o.value === r.partner.id)) optionsClients.unshift({ value: r.partner.id, label: r.partner.name });
  const pret = Boolean((f.partner_id || f.rotation_id) && f.nature && f.description.trim() && f.received_on && f.received_on <= aujourdhui());

  function corps(): ComplaintInput {
    const valeurs: ComplaintInput = {
      partner_id: id(f.partner_id),
      vehicle_id: id(f.vehicle_id),
      rotation_id: id(f.rotation_id),
      site_id: id(f.site_id),
      nature: f.nature || undefined,
      severity: f.severity,
      received_on: f.received_on,
      description: f.description.trim(),
    };
    // Sans client choisi, le noyau reprend celui de la rotation : la clé ne part pas.
    if (!valeurs.partner_id) delete valeurs.partner_id;
    if (!r) return valeurs;
    const modifs = changes(valeurs, {
      partner_id: r.partner.id, vehicle_id: r.vehicle?.id ?? null, rotation_id: r.rotation?.id ?? null, site_id: r.site?.id ?? null, nature: r.nature, severity: r.severity,
      received_on: r.received_on, description: r.description,
    });
    if (f.response_due && f.response_due !== r.response_due) modifs.response_due = f.response_due;
    return modifs;
  }

  return (
    <Modal
      open
      wide
      title={r ? `Modifier la réclamation ${r.reference}` : "Nouvelle réclamation client"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={r ? "Enregistrer" : "Enregistrer la réclamation"}
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => {
            const x = corps();
            if (!Object.keys(x).length) return onClose();
            void lancer(() => envoyer(x));
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Client" hint={optionsClients.length ? "À défaut, celui de la rotation choisie." : "Liste des clients non servie : choisissez la rotation, son client est repris."} className="md:col-span-2">
          <Select value={f.partner_id} onChange={(e) => setF({ ...f, partner_id: e.target.value })} placeholder="Celui de la rotation" options={optionsClients} />
        </Field>
        <ChampsRotation
          ref_={refEnv}
          site={f.site_id}
          jourInitial={r?.rotation?.date_loading ?? f.received_on}
          vehicule={f.vehicle_id}
          rotation={f.rotation_id}
          actuelle={r?.rotation}
          vehiculeActuel={r?.vehicle}
          onVehicule={(v) => setF((x) => ({ ...x, vehicle_id: v }))}
          onRotation={(rot, v) => setF((x) => ({ ...x, rotation_id: rot, vehicle_id: v ? String(v) : x.vehicle_id }))}
        />
        <Field label="Nature">
          <Select value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value as ComplaintNature | "" })} placeholder="À choisir" options={ORDRE_RECLAMATIONS.map((n) => ({ value: n, label: NATURE_RECLAMATION[n] }))} />
        </Field>
        <Groupe label="Gravité">
          <Segmented<ComplaintSeverity> label="Gravité de la réclamation" value={f.severity} onChange={(g) => setF({ ...f, severity: g })} options={ORDRE_GRAVITES.map((g) => ({ key: g, label: GRAVITE[g] }))} />
        </Groupe>
        <Field label="Reçue le" hint={r ? undefined : "La réponse est attendue dans le délai des paramètres de la société (15 jours par défaut)."}>
          <Input type="date" max={aujourdhui()} value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} required />
        </Field>
        <ChampSiteSaisie ref_={refEnv} droits={droits} valeur={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} facultatif="Celui de l'ensemble" actuel={r?.site?.id} />
        {r && (
          <Field label="Réponse attendue avant le" hint="Calculée à la réception ; modifiable si le client accorde un autre délai.">
            <Input type="date" min={f.received_on} value={f.response_due} onChange={(e) => setF({ ...f, response_due: e.target.value })} />
          </Field>
        )}
        <Field label="Réclamation" className="md:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ce que le client signale, avec ses chiffres (volume manquant, heure d'arrivée…)" maxLength={4000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Réponse au client (texte obligatoire), datée entre la réception et aujourd'hui ; une réponse déjà
 * donnée se complète (la date retenue est alors celle de la nouvelle réponse).
 */
export function FenetreReponse({ reclamation, onClose, envoyer }: { reclamation: Complaint; onClose: () => void; envoyer: (corps: AnswerInput) => Promise<unknown> }) {
  const r = reclamation;
  const [reponse, setReponse] = useState(r.response ?? "");
  const [le, setLe] = useState(r.responded_on ?? aujourdhui());
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Réponse impossible.");
  const pret = Boolean(reponse.trim() && le && le >= r.received_on && le <= aujourdhui());
  return (
    <Modal
      open
      wide
      title={r.response ? `Compléter la réponse à ${r.reference}` : `Répondre à ${r.reference}`}
      onClose={onClose}
      footer={<Pied onClose={onClose} action="Enregistrer la réponse" envoi={envoi} pret={pret} onEnvoyer={() => void lancer(() => envoyer({ response: reponse.trim(), responded_on: le }))} />}
    >
      <div className="space-y-4">
        <p className="rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">{r.partner.name} : </span>
          {r.description}
        </p>
        <Field label="Réponse au client">
          <Textarea className="min-h-[120px]" value={reponse} onChange={(e) => setReponse(e.target.value)} placeholder="Ce qui a été constaté, ce qui est fait (avoir, enquête, actions)" maxLength={4000} />
        </Field>
        <Field label="Répondue le" hint={r.response_due ? `Réponse attendue avant le ${fmtDate(r.response_due)}.` : undefined}>
          <Input type="date" min={r.received_on} max={aujourdhui()} value={le} onChange={(e) => setLe(e.target.value)} required />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}
