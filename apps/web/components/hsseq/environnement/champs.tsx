"use client";

/**
 * Champs des fenêtres de saisie de l'écran « Environnement et qualité » : site de la saisie (ceux du
 * chef de parc seulement, obligatoire pour lui), ensemble et rotation d'un jour (GET /hsseq/rotations,
 * tous états, bornée aux sites du compte), événement lié du bon domaine (GET /hsseq/events), choix en
 * cartes et pied commun des fenêtres.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Button, Field, Input, Select, cx } from "@/components/ui";
import { nomRotation } from "@/components/hsseq/commun";
import { aujourdhui } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";
import type { EventLine, Page, RotationRef, RotationsAtDate, VehicleRef } from "@/lib/hsseq-types";
import { messageErreur, type Droits } from "./commun";
import type { EventRef, ReferentielsEnvironnement } from "./types";

/** Envoi d'une fenêtre : occupé pendant l'appel, refus du noyau gardé pour l'affichage, fermeture sur la réussite. */
export function useEnvoi(onClose: () => void, defaut: string) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  async function envoyer(appel: () => Promise<unknown>) {
    setEnvoi(true);
    setErreur(null);
    try {
      await appel();
      onClose();
    } catch (e) {
      setErreur(messageErreur(e, defaut));
    } finally {
      setEnvoi(false);
    }
  }
  return { erreur, envoi, envoyer, setErreur };
}

/** Pied d'une fenêtre : retour, et le bouton qui envoie. */
export function Pied({ onClose, action, envoi, pret, onEnvoyer, retour = "Annuler", danger }: { onClose: () => void; action: string; envoi: boolean; pret: boolean; onEnvoyer: () => void; retour?: string; danger?: boolean }) {
  return (
    <>
      <Button onClick={onClose}>{retour}</Button>
      <Button variant={danger ? "danger" : "primary"} loading={envoi} disabled={!pret} onClick={onEnvoyer}>
        {action}
      </Button>
    </>
  );
}

/** Intitulé d'un groupe de boutons (bascule), hors d'un label qui capterait les clics. */
export function Groupe({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
    </div>
  );
}

/** Choix exclusif en cartes (nature d'une contamination) : titre et portée de chaque option. */
export function ChoixCartes<K extends string>({ legende, nom, options, valeur, onChange, colonnes }: { legende: string; nom: string; options: Array<{ key: K; titre: string; aide: string }>; valeur: K | null; onChange: (k: K) => void; colonnes?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-ink-2">{legende}</legend>
      <div className={cx("grid gap-2", colonnes && "sm:grid-cols-2")}>
        {options.map((o) => (
          <label key={o.key} className={cx("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors", valeur === o.key ? "border-accent bg-accent-doux" : "border-line hover:border-line-strong")}>
            <input type="radio" name={nom} className="mt-1 accent-[var(--accent)]" checked={valeur === o.key} onChange={() => onChange(o.key)} />
            <span>
              <span className="block text-sm font-semibold text-ink">{o.titre}</span>
              <span className="block text-[12.5px] text-muted">{o.aide}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ─── Site de la saisie ───────────────────────────────────────────────── */

/**
 * Sites proposés à une saisie : ceux du chef de parc (obligatoire pour lui : le noyau refuse une saisie
 * sans site ou hors de ses sites), tous les sites actifs pour le Responsable HSSEQ. Le site actuel d'une
 * fiche reste proposé.
 */
function sitesDeSaisie(ref: ReferentielsEnvironnement | undefined, droits: Droits, actuel?: number | null) {
  const tous = ref?.sites ?? [];
  const miens = droits.chefDeParc ? tous.filter((s) => ref?.me.site_ids.includes(s.id)) : tous.filter((s) => s.active);
  const liste = actuel && !miens.some((s) => s.id === actuel) ? [...tous.filter((s) => s.id === actuel), ...miens] : miens;
  return liste.map((s) => ({ value: s.id, label: s.name }));
}

/** Site proposé d'emblée : celui de la fiche, sinon le seul site du chef de parc. */
export function siteParDefaut(ref: ReferentielsEnvironnement | undefined, droits: Droits, actuel?: number | null): string {
  if (actuel) return String(actuel);
  const options = sitesDeSaisie(ref, droits);
  return droits.chefDeParc && options.length === 1 ? String(options[0]!.value) : "";
}

/**
 * Champ du site d'une saisie : facultatif pour hsseq (`facultatif` : libellé de l'absence), obligatoire
 * pour le chef de parc et pour une mesure de poussières (`facultatif` absent).
 */
export function ChampSiteSaisie({ ref_, droits, valeur, onChange, facultatif, actuel, aide, className }: { ref_: ReferentielsEnvironnement | undefined; droits: Droits; valeur: string; onChange: (v: string) => void; facultatif?: string; actuel?: number | null; aide?: string; className?: string }) {
  const options = sitesDeSaisie(ref_, droits, actuel);
  const sansSite = droits.chefDeParc && ref_ !== undefined && options.length === 0;
  return (
    <Field
      label="Site"
      hint={sansSite ? undefined : droits.chefDeParc ? "Parmi les sites qui vous sont rattachés." : aide}
      error={sansSite ? "Aucun site ne vous est rattaché : le Responsable HSSEQ vous rattache d'abord à votre site." : undefined}
      className={className}
    >
      <Select value={valeur} onChange={(e) => onChange(e.target.value)} placeholder={droits.chefDeParc || !facultatif ? "À choisir" : facultatif} options={options} />
    </Field>
  );
}

/* ─── Ensemble et rotation ────────────────────────────────────────────── */

/**
 * Ensemble et rotation rattachés à une fiche : la rotation se choisit parmi celles chargées ou en cours
 * le jour donné (tous états, même parties ou terminées) ; choisir une rotation pose son ensemble. Le
 * noyau rattache de lui-même l'ensemble de la rotation et le site de l'ensemble.
 */
export function ChampsRotation({
  ref_,
  site,
  jourInitial,
  vehicule,
  rotation,
  actuelle,
  vehiculeActuel,
  onVehicule,
  onRotation,
}: {
  ref_: ReferentielsEnvironnement | undefined;
  site: string;
  jourInitial: string;
  vehicule: string;
  rotation: string;
  actuelle?: RotationRef | null;
  vehiculeActuel?: VehicleRef | null;
  onVehicule: (id: string) => void;
  onRotation: (id: string, vehiculeId: number | null) => void;
}) {
  // Le jour suit celui de la fiche (date du déversement, du constat…) tant qu'il n'est pas choisi à la main.
  const [jourChoisi, setJour] = useState<string | null>(null);
  const jour = jourChoisi ?? (jourInitial || aujourdhui());
  const { data: duJour, error } = useApi<RotationsAtDate>(jour ? `/hsseq/rotations?date=${jour}` : null);
  const vehicules = useMemo(() => {
    const tous = ref_?.vehicles ?? [];
    const liste = site ? tous.filter((v) => v.site_id === Number(site) || String(v.id) === vehicule) : tous;
    if (vehiculeActuel && !liste.some((v) => v.id === vehiculeActuel.id)) return [{ ...vehiculeActuel, site_id: null, driver_id: null, payload_tonnes: null }, ...liste];
    return liste;
  }, [ref_, site, vehicule, vehiculeActuel]);
  const rotations = useMemo(() => {
    const liste = (duJour?.items ?? []).map((r) => ({ rotation: r as RotationRef, vehiculeId: r.vehicle.id, vehicule: r.vehicle.name }));
    if (actuelle && !liste.some((r) => r.rotation.id === actuelle.id)) liste.unshift({ rotation: actuelle, vehiculeId: vehiculeActuel?.id ?? 0, vehicule: vehiculeActuel?.name ?? "" });
    return vehicule ? liste.filter((r) => String(r.vehiculeId) === vehicule || String(r.rotation.id) === rotation) : liste;
  }, [duJour, actuelle, vehiculeActuel, vehicule, rotation]);
  const route = (r: RotationRef) => (r.route_name ? `, ${r.route_name}` : "");

  return (
    <>
      <Field label="Ensemble">
        <Select
          value={vehicule}
          onChange={(e) => {
            onVehicule(e.target.value);
            // Une rotation d'un autre ensemble ne reste pas choisie.
            if (rotation && e.target.value && !rotations.some((r) => String(r.rotation.id) === rotation && String(r.vehiculeId) === e.target.value)) onRotation("", null);
          }}
          placeholder="Aucun"
          options={vehicules.map((v) => ({ value: v.id, label: `${v.name}${v.vehicle_kind === "tipper" ? " · Benne" : " · Citerne"}` }))}
        />
      </Field>
      <Field label="Rotation du" hint={error ? "Rotations de ce jour illisibles." : "Rotations chargées ou en cours ce jour-là."}>
        <Input type="date" max={aujourdhui()} value={jour} onChange={(e) => setJour(e.target.value)} />
      </Field>
      <Field label="Rotation" className="md:col-span-2">
        <Select
          value={rotation}
          onChange={(e) => {
            const r = rotations.find((x) => String(x.rotation.id) === e.target.value);
            onRotation(e.target.value, r?.vehiculeId || null);
          }}
          placeholder={duJour && !rotations.length ? "Aucune rotation ce jour-là" : "Aucune"}
          options={rotations.map((r) => ({ value: r.rotation.id, label: `${nomRotation(r.rotation)}${r.vehicule ? ` · ${r.vehicule}` : ""}${route(r.rotation)}` }))}
        />
      </Field>
    </>
  );
}

/* ─── Événement lié ───────────────────────────────────────────────────── */

/**
 * Événement lié à une fiche, du domaine attendu par le noyau (environnement pour un déversement, qualité
 * pour une contamination : event_domain_mismatch sinon) ; les plus récents d'abord. L'événement actuel
 * reste proposé.
 */
export function ChampEvenement({ domaine, valeur, actuel, onChange, className }: { domaine: "environment" | "quality"; valeur: string; actuel?: EventRef | null; onChange: (id: string) => void; className?: string }) {
  const { data } = useApi<Page<EventLine>>(`/hsseq/events?domain=${domaine}&sort=-occurred_at&limit=100`);
  const options = (data?.items ?? []).map((e) => ({ value: e.id, label: `${e.reference} · ${e.title} (${fmtDate(e.occurred_at.slice(0, 10))})` }));
  if (actuel && !options.some((o) => o.value === actuel.id)) options.unshift({ value: actuel.id, label: actuel.reference });
  return (
    <Field label="Événement lié" hint={domaine === "environment" ? "Déclaration du domaine environnement, s'il y en a une." : "Événement du domaine qualité, s'il y en a un."} className={className}>
      <Select value={valeur} onChange={(e) => onChange(e.target.value)} placeholder="Aucun" options={options} />
    </Field>
  );
}
