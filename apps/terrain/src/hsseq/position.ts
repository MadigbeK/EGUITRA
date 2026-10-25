import * as Location from "expo-location";
import { useEffect, useState } from "react";
import type { Position } from "./types";

/** Position relevée sans geste, avec son heure ; `derniere` : la dernière connue, faute de signal. */
export interface Releve extends Position {
  at: string;
  derniere: boolean;
  /** Vitesse en km/h, si l'appareil la donne. */
  vitesse: number | null;
}

/**
 * Relevé de la position (système « terrain », § 3.14) : précision équilibrée, la dernière position
 * connue faute de signal, jamais d'attente du GPS pour enregistrer. Refus d'autorisation : null.
 */
export async function relever(): Promise<Releve | null> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const connue = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
    const actuelle = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]).catch(() => null);
    const p = actuelle ?? connue;
    if (!p) return null;
    return {
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      gps_accuracy: p.coords.accuracy ?? null,
      at: new Date(p.timestamp).toISOString(),
      derniere: !actuelle,
      vitesse: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed * 3.6 : null,
    };
  } catch {
    return null;
  }
}

/** Position relevée à l'ouverture de l'écran : undefined pendant le relevé, null sans position. */
export function usePosition(): Releve | null | undefined {
  const [releve, setReleve] = useState<Releve | null | undefined>(undefined);
  useEffect(() => {
    let actif = true;
    void relever().then((r) => actif && setReleve(r));
    return () => {
      actif = false;
    };
  }, []);
  return releve;
}

/** Champs de position d'une fiche, à plat (contrat HSSEQ, § 1). */
export function positionDeLaFiche(r: Releve | null | undefined): Partial<Position> {
  return r ? { latitude: r.latitude, longitude: r.longitude, gps_accuracy: r.gps_accuracy } : {};
}
