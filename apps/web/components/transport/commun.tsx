/**
 * Écriture commune des écrans Transport : volumes à décimales fixes, état des rotations, taux de
 * marge jugé au regard de la marge minimale. Les tableaux écrivent les montants entiers (fmtInt)
 * avec l'unité dans l'en-tête ; les volumes gardent toujours leurs deux décimales (les litres).
 */

import { useState } from "react";
import { Button, Field, Input, Modal, Textarea, cx } from "@/components/ui";
import { AIDE_NOMBRE, INSECABLE, fmtPct, lireNombre, nombreIllisible } from "@/lib/format";

// Volumes et espace insécable : une seule écriture des nombres, dans lib/format.ts, partagée avec
// Rotations au téléphone. Réexportés ici pour les écrans Transport qui les prennent dans ce fichier.
export { INSECABLE, fmtFixe, fmtM3, fmtVolume } from "@/lib/format";

/**
 * Mot de l'état d'une rotation, que la table ETAT_TON (lib/couleurs.ts) traduit en ton. Une rotation
 * validée attend sa facture : elle s'écrit « À facturer », au trait neutre, pour ne pas se confondre
 * avec « Facturée » dans la vue « Toutes ».
 */
export const ETAT_ROTATION = { draft: "Saisie", en_route: "En route", done: "À facturer", invoiced: "Facturée", cancelled: "Annulée" } as const;

/**
 * Étapes d'une rotation, dans l'ordre où elle les franchit : saisie, départ (chef de parc), livraison
 * (volume livré et bon de livraison), validation par un autre compte que celui qui l'a saisie,
 * facturation. Écrites sur la fiche (bandeau « Prochaine étape ») et sur l'accueil (compteurs).
 */
export const ETAPES_ROTATION = ["Saisie", "Départ", "Livraison", "Validation", "Facturation"] as const;

/** Où en est une rotation : rang de l'étape à faire (1 à 5), ce qu'il reste à faire, et qui le fait. */
export interface EtapeRotation {
  /** Étape à faire, de 1 à 5 ; 6 : facturée, tout est fait ; null : annulée. */
  rang: number | null;
  /** Mot court, pour une liste : « À faire partir », « Livraison à saisir »… */
  court: string;
  /** Phrase du bandeau de la fiche. */
  texte: string;
}

/** Pas encore partie alors que le verrou HSSEQ exige le départ avant la validation (absent : exigé). */
export function doitPartir(r: { departed_at?: string | null; departure_required?: boolean }): boolean {
  return !r.departed_at && r.departure_required !== false;
}

/**
 * Prochaine étape d'une rotation. Une rotation saisie déjà partie (validée puis remise en saisie pour
 * correction) garde son départ : elle reprend à la livraison ou à la validation.
 */
export function etapeRotation(r: { state: keyof typeof ETAT_ROTATION; departed_at?: string | null; departure_required?: boolean; volume_delivered: number }): EtapeRotation {
  if (r.state === "cancelled") return { rang: null, court: "Annulée", texte: "Rotation annulée : elle n'est ni facturée ni comptée." };
  if (r.state === "invoiced") return { rang: 6, court: "Terminée", texte: "Toutes les étapes sont faites : la rotation est facturée." };
  if (r.state === "done") return { rang: 5, court: "À facturer", texte: "Étape 5 sur 5 : à facturer (finance)." };
  if (r.state === "draft" && doitPartir(r)) return { rang: 2, court: "À faire partir", texte: "Étape 2 sur 5 : à faire partir (chef de parc)." };
  if (!r.volume_delivered) return { rang: 3, court: "Livraison à saisir", texte: "Étape 3 sur 5 : livraison à saisir, volume livré et bon de livraison (exploitation)." };
  return { rang: 4, court: "À valider", texte: "Étape 4 sur 5 : à valider (un autre compte que celui qui l'a saisie)." };
}

/**
 * Motif écrit demandé avant une action (additif, refus, annulation) : remplace la boîte du navigateur,
 * illisible au téléphone. `envoyer` reçoit le motif ; la carte appelante affiche un éventuel refus.
 */
export function FenetreMotif({ titre, aide, action, exemple, danger, onClose, envoyer }: {
  titre: string; aide?: string; action: string; exemple?: string; danger?: boolean; onClose: () => void; envoyer: (motif: string) => void;
}) {
  const [motif, setMotif] = useState("");
  const pret = Boolean(motif.trim());
  return (
    <Modal open title={titre} onClose={onClose} footer={(
      <>
        <Button onClick={onClose}>Retour</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={!pret} onClick={() => { envoyer(motif.trim()); onClose(); }}>{action}</Button>
      </>
    )}>
      <div className="space-y-3">
        {aide && <p className="m-0 text-[13px] leading-snug text-ink-2">{aide}</p>}
        <Field label="Motif (obligatoire)" hint="Il est gardé avec la décision.">
          <Textarea rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={2000} placeholder={exemple} />
        </Field>
      </div>
    </Modal>
  );
}

/** Champ en erreur : bordure et halo d'alerte. */
export const CHAMP_INVALIDE = "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger/15";

/** Valeur d'un nombre pour un champ de saisie : virgule décimale, vide pour zéro. */
export const saisieDe = (value: number | null | undefined) => (value ? String(value).replace(".", ",") : "");

/**
 * Nombre modifié sur place dans un tableau : lu à la française (lireNombre), enregistré à la sortie
 * du champ s'il a changé. Une saisie illisible (« 38.000 », « 12 km ») reste en erreur, avec l'aide,
 * et n'est jamais envoyée : elle ne devient pas 0.
 */
export function NombreSurPlace({ value, onCommit, label, disabled, className, placeholder, nullable }: {
  value: number | null; onCommit: (n: number | null) => void; label: string; disabled?: boolean; className?: string; placeholder?: string;
  /** Champ vidé : null (valeur héritée) au lieu de 0. */
  nullable?: boolean;
}) {
  const [texte, setTexte] = useState(saisieDe(value));
  const illisible = nombreIllisible(texte);
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Input
        aria-label={label}
        aria-invalid={illisible || undefined}
        title={illisible ? AIDE_NOMBRE : undefined}
        disabled={disabled}
        inputMode="decimal"
        className={cx("text-right font-mono", CHAMP_INVALIDE, className)}
        placeholder={placeholder}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => {
          if (illisible) return;
          const n = lireNombre(texte) ?? (nullable ? null : 0);
          if (n !== (nullable ? value : value ?? 0)) onCommit(n);
        }}
      />
      {illisible && <span role="alert" className="text-[11px] font-medium text-danger">Nombre illisible</span>}
    </span>
  );
}

/** Champ numérique d'un formulaire : lu à la française ; illisible, il passe en erreur avec l'aide. */
export function ChampNombre({ label, value, onChange, hint, className }: {
  label: string; value: string | undefined; onChange: (e: { target: { value: string } }) => void; hint?: string; className?: string;
}) {
  const illisible = nombreIllisible(value);
  return (
    <Field label={label} hint={hint} error={illisible ? AIDE_NOMBRE : undefined} className={className}>
      <Input inputMode="decimal" aria-invalid={illisible || undefined} className={cx("font-mono", CHAMP_INVALIDE)} value={value ?? ""} onChange={onChange} />
    </Field>
  );
}

/**
 * Texte modifié sur place dans un tableau (immatriculation, téléphone…), enregistré à la sortie du
 * champ s'il a changé ; requis : un champ vidé n'est pas envoyé (le noyau l'exige).
 */
export function TexteSurPlace({ value, onCommit, label, disabled, className, placeholder, requis }: {
  value: string | null; onCommit: (t: string) => void; label: string; disabled?: boolean; className?: string; placeholder?: string; requis?: boolean;
}) {
  const [texte, setTexte] = useState(value ?? "");
  const manquant = requis && !texte.trim();
  return (
    <Input
      aria-label={label}
      aria-invalid={manquant || undefined}
      disabled={disabled}
      className={cx(CHAMP_INVALIDE, className)}
      placeholder={placeholder}
      value={texte}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={() => {
        const t = texte.trim();
        if (!manquant && t !== (value ?? "")) onCommit(t);
      }}
    />
  );
}

/** Le minimum écrit comme il est réglé : « 15 % », « 12,5 % ». */
function fmtMinimum(minimum: number): string {
  return fmtPct(minimum, Number.isInteger(minimum) ? 0 : 1);
}

/**
 * Taux écrit sans décimale, sauf s'il faut en montrer une ou deux pour qu'un taux sous le minimum ne
 * s'affiche pas égal à lui (14,6 % ne s'écrit pas « 15 % » face à un minimum de 15 %).
 */
function fmtTaux(taux: number, minimum: number | null): string {
  for (const d of [0, 1] as const) {
    const p = 10 ** d;
    if (minimum === null || taux >= minimum || Math.round(taux * p) / p < minimum) return fmtPct(taux, d);
  }
  return fmtPct(taux, 2);
}

/**
 * Taux de marge d'une ligne, jugé au regard de la marge minimale de la règle d'alerte (Seuils et
 * taux, servie par le noyau) : sous le minimum, il passe à surveiller, en semi-gras, avec le minimum
 * écrit à côté ; une marge négative est en alerte. Sans minimum (null ou 0), la marge n'est pas
 * jugée. Un taux estimé (coût standard de la route, aucun frais saisi) s'écrit en italique.
 */
export function TauxMarge({ taux, minimum, negative, estime }: { taux: number | null; minimum: number | null; negative?: boolean; estime?: boolean }) {
  if (taux === null || !Number.isFinite(taux)) return <span className="text-muted">–</span>;
  const seuil = minimum !== null && minimum > 0 ? minimum : null;
  const sous = seuil !== null && taux < seuil;
  const texte = fmtTaux(taux, seuil);
  if (negative) {
    return (
      <span className={estime ? "font-semibold italic text-danger" : "font-semibold text-danger"}>
        {texte}
        <span className="sr-only">{estime ? ", marge estimée négative" : ", marge négative"}</span>
      </span>
    );
  }
  if (sous) {
    return (
      <span className={estime ? "font-semibold italic text-warn" : "font-semibold text-warn"} title={`Sous la marge minimale de ${fmtMinimum(seuil)} (Seuils et taux)${estime ? ", d'après la marge estimée" : ""}`}>
        {texte}
        <span aria-hidden className="ml-1 text-[11.5px] font-medium">
          &lt;{INSECABLE}{fmtMinimum(seuil)}
        </span>
        <span className="sr-only">{`, sous le minimum de ${fmtMinimum(seuil)}${estime ? ", estimé" : ""}`}</span>
      </span>
    );
  }
  return (
    <span className={estime ? "italic text-muted" : "text-ink-2"}>
      {texte}
      {estime && <span className="sr-only">, estimé</span>}
    </span>
  );
}
