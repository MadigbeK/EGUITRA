"use client";

import { CloudOff } from "@/components/icons";
import { Badge, Field, Input, Select } from "@/components/ui";
import { TYPE_VEHICULE, tonHsseq } from "@/components/hsseq/commun";
import { fmtDateTime } from "@/lib/format";
import type { DeviceStamp, Referentials, VehicleKind, VehicleRef } from "@/lib/hsseq-types";
import { aujourdhui, debutDuMois } from "@/components/hsseq/actions/outils";

export { ChampSite } from "@/components/hsseq/actions/outils";

/** Type de véhicule dans l'adresse (« citerne », « benne ») et sa clé dans l'API. */
export const TYPE_ADRESSE: Record<string, VehicleKind> = { citerne: "tanker", benne: "tipper" };

/** Filtre de profil (citerne, benne), porté par l'adresse ; l'API le lit en `vehicle_kind`. */
export function ChampProfil({ valeur, onChange }: { valeur: string; onChange: (v: string) => void }) {
  return (
    <Field label="Profil" className="w-full sm:w-36">
      <Select value={valeur} onChange={(e) => onChange(e.target.value)} placeholder="Tous" options={Object.entries(TYPE_ADRESSE).map(([cle, v]) => ({ value: cle, label: TYPE_VEHICULE[v] }))} />
    </Field>
  );
}

/** Objectif de saisie d'un contrôle avant départ : moins de 4 minutes (§5). */
export const DUREE_CIBLE_S = 240;

/** Période d'une vue : bornes lues dans l'adresse, mois en cours par défaut. */
export function periode(lire: (cle: string) => string): { du: string; au: string } {
  return { du: lire("du") || debutDuMois(), au: lire("au") || aujourdhui() };
}

/** Champs « Du » et « Au » d'une période, écrits dans l'adresse. */
export function ChampsPeriode({ du, au, ecrire }: { du: string; au: string; ecrire: (maj: Record<string, string | null>) => void }) {
  return (
    <>
      <Field label="Du" className="w-full sm:w-40">
        <Input type="date" value={du} max={au} onChange={(e) => ecrire({ du: e.target.value || null })} />
      </Field>
      <Field label="Au" className="w-full sm:w-40">
        <Input type="date" value={au} min={du} onChange={(e) => ecrire({ au: e.target.value || null })} />
      </Field>
    </>
  );
}

/** Choix du véhicule, borné au type et au site choisis. */
export function ChampVehicule({ ref_, valeur, type, site, onChange }: { ref_: Referentials | undefined; valeur: string; type?: VehicleKind | null; site?: string; onChange: (v: string) => void }) {
  const vehicules = (ref_?.vehicles ?? []).filter((v) => (!type || v.vehicle_kind === type) && (!site || String(v.site_id) === site));
  return (
    <Field label="Véhicule" className="w-full sm:w-44">
      <Select value={valeur} onChange={(e) => onChange(e.target.value)} placeholder="Tous" options={vehicules.map((v) => ({ value: v.id, label: v.plate ? `${v.name} (${v.plate})` : v.name }))} />
    </Field>
  );
}

/** Véhicule : nom, immatriculation et profil citerne ou benne. */
export function Vehicule({ v }: { v: VehicleRef }) {
  return (
    <span className="inline-flex flex-col">
      <span className="whitespace-nowrap font-medium text-ink">{v.name}</span>
      <span className="whitespace-nowrap text-[12px] text-muted">
        {TYPE_VEHICULE[v.vehicle_kind]}
        {v.plate ? `, ${v.plate}` : ""}
      </span>
    </span>
  );
}

/**
 * Horodatage d'une saisie de terrain : l'heure de saisie sur l'appareil, et pour une saisie hors
 * ligne l'heure de réception par le serveur, distincte (§11).
 */
export function Saisie({ s }: { s: DeviceStamp }) {
  return (
    <span className="inline-flex flex-col">
      <span className="whitespace-nowrap">{fmtDateTime(s.reported_at)}</span>
      {s.offline && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-muted">
          <CloudOff aria-hidden className="h-3.5 w-3.5" />
          Hors ligne, reçu le {fmtDateTime(s.synced_at)}
        </span>
      )}
    </span>
  );
}

/** Tampon d'une photo attendue sur une non-conformité (mot à verser dans TON_HSSEQ, à surveiller). */
export function PhotoManquante({ pluriel }: { pluriel?: boolean }) {
  const mot = pluriel ? "Photos manquantes" : "Photo manquante";
  return <Badge tone={tonHsseq(mot, "warn")}>{mot}</Badge>;
}

/** Durée de saisie : « 3 min 12 s ». */
export function fmtDuree(secondes: number): string {
  const m = Math.floor(secondes / 60);
  const s = Math.round(secondes % 60);
  return m ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}
