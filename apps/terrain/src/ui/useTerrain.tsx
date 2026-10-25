import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { modeDeLHeure, palette, type Mode, type NomModule, type Palette } from "./terrain";

interface Terrain {
  mode: Mode;
  module: NomModule;
  /** Palette du mode et du module actifs. */
  c: Palette;
}

const Contexte = createContext<Terrain>({ mode: "soleil", module: "rotations", c: palette("soleil", "rotations") });

/**
 * Mode d'affichage de l'application : nuit de cabine si le téléphone est réglé en sombre, sinon selon
 * l'heure de Conakry, revue chaque minute. Module par défaut : Rotations.
 */
export function TerrainProvider({ children }: { children: ReactNode }) {
  const systeme = useColorScheme();
  const [heure, setHeure] = useState<Mode>(() => modeDeLHeure());
  useEffect(() => {
    const minuteur = setInterval(() => setHeure(modeDeLHeure()), 60_000);
    return () => clearInterval(minuteur);
  }, []);
  const mode: Mode = systeme === "dark" ? "nuit" : heure;
  const valeur = useMemo(() => ({ mode, module: "rotations" as const, c: palette(mode, "rotations") }), [mode]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/**
 * Couleur du module auquel l'écran appartient : Rotations (latérite) ou HSSEQ (pétrole). Changer de
 * couleur dit qu'on change de registre.
 */
export function Module({ nom, children }: { nom: NomModule; children: ReactNode }) {
  const { mode } = useContext(Contexte);
  const valeur = useMemo(() => ({ mode, module: nom, c: palette(mode, nom) }), [mode, nom]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useTerrain(): Terrain {
  return useContext(Contexte);
}
