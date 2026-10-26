"use client";

/**
 * Briques des écrans d'immobilisation (motif V09) : tampon de l'état, durée d'une immobilisation, motif
 * V09 paramétré (actif ou non pour ce type de véhicule et ce site), effet sur le verrou dit en clair.
 */

import { Badge } from "@/components/ui";
import { tonHsseq } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import { pluriel } from "@/lib/format";
import type { ReasonSetting, Ref, VehicleRef } from "@/lib/hsseq-types";
import type { ImmobilizationStatus } from "./types";

/** Mot de l'état ; « Immobilisé » (alerte) et « Remis en service » (favorable) sont à verser dans TON_HSSEQ. */
export const ETAT_IMMOBILISATION: Record<ImmobilizationStatus, string> = { active: "Immobilisé", lifted: "Remis en service" };

export function TamponImmobilisation({ statut }: { statut: ImmobilizationStatus }) {
  const mot = ETAT_IMMOBILISATION[statut];
  return <Badge tone={tonHsseq(mot, statut === "active" ? "danger" : "ok")}>{mot}</Badge>;
}

/** Durée écoulée entre deux instants : « 5 heures », « 7 jours » (maintenant à défaut de fin). */
export function dureeEntre(debut: string, fin?: string | null): string {
  const ms = (fin ? Date.parse(fin) : Date.now()) - Date.parse(debut);
  if (!Number.isFinite(ms) || ms < 3_600_000) return "moins d'une heure";
  const heures = Math.floor(ms / 3_600_000);
  return heures < 48 ? pluriel(heures, "heure") : pluriel(Math.floor(heures / 24), "jour");
}

/** Paramétrage du motif V09 (GET /hsseq/lock/reasons) ; `actif` faux tant qu'il n'est pas lu. */
export function useMotifV09(actif = true): ReasonSetting | undefined {
  const { data } = useApi<ReasonSetting[]>(actif ? "/hsseq/lock/reasons" : null);
  return data?.find((r) => r.code === "V09");
}

/**
 * Le motif V09 bloque-t-il le départ de ce véhicule ? Actif, pour son type de véhicule, et pas désactivé
 * sur son site ; nul tant que le paramétrage n'est pas lu. (La date de mise en service du verrou, dans
 * les réglages, s'ajoute à cette condition.)
 */
export function v09Bloque(motif: ReasonSetting | undefined, vehicule: VehicleRef, site: Ref | null): boolean | null {
  if (!motif) return null;
  return motif.active && motif.vehicle_kinds.includes(vehicule.vehicle_kind) && !(site && motif.disabled_sites.some((s) => s.id === site.id));
}

/** Effet de l'immobilisation sur le verrou, en une phrase. */
export function effetVerrou(motif: ReasonSetting | undefined, vehicule: VehicleRef, site: Ref | null): string | null {
  const bloque = v09Bloque(motif, vehicule, site);
  if (bloque === null) return null;
  return bloque
    ? `Le verrou refuse tout départ de ${vehicule.name} (motif V09) jusqu'à sa remise en service.`
    : `Le motif V09 n'est pas actif pour ${vehicule.name} : l'immobilisation est enregistrée et notifiée, mais le verrou ne bloque pas encore son départ.`;
}
