"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, Tabs } from "@/components/ui";
import { Grilles } from "./Grilles";
import { Motifs } from "./Motifs";
import { Reglages } from "./Reglages";
import { Sites } from "./Sites";

type Onglet = "sites" | "grilles" | "motifs" | "reglages";
const ONGLETS: readonly Onglet[] = ["sites", "grilles", "motifs", "reglages"];

/**
 * Paramètres de NIMOVA · HSSEQ, réservés à l'administration et au Responsable HSSEQ (contrat, §2) :
 * sites et chefs de parc, grilles de contrôle par profil, motifs du verrou de départ, réglages de la
 * société (mise en service, seuils, délais, cibles). Le noyau refuse toute écriture d'un autre profil
 * (403 `forbidden`).
 */
export function ParametresHsseq() {
  // ?onglet=grilles, motifs ou reglages ouvre directement l'onglet (lien depuis les contrôles).
  const demande = useSearchParams().get("onglet");
  const [onglet, setOnglet] = useState<Onglet>((ONGLETS as readonly string[]).includes(demande ?? "") ? (demande as Onglet) : "sites");
  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Sites et chefs de parc, grilles de contrôle par profil de véhicule, motifs du verrou de départ, réglages de la société. Réservé à l'administration et au Responsable HSSEQ." />
      <Tabs
        value={onglet}
        onChange={setOnglet}
        tabs={[
          { key: "sites", label: "Sites" },
          { key: "grilles", label: "Grilles de contrôle" },
          { key: "motifs", label: "Motifs du verrou" },
          { key: "reglages", label: "Réglages" },
        ]}
      />
      {onglet === "sites" && <Sites />}
      {onglet === "grilles" && <Grilles />}
      {onglet === "motifs" && <Motifs />}
      {onglet === "reglages" && <Reglages />}
    </div>
  );
}
