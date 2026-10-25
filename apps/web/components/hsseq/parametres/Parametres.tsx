"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, Tabs } from "@/components/ui";
import { Grilles } from "./Grilles";
import { Motifs } from "./Motifs";
import { Sites } from "./Sites";

type Onglet = "sites" | "grilles" | "motifs";

/**
 * Paramètres de NIMOVA · HSSEQ, réservés à l'administration et au Responsable HSSEQ (contrat, §2) :
 * sites et chefs de parc, grilles de contrôle par profil, motifs du verrou de départ. Le noyau refuse
 * toute écriture d'un autre profil (403 `forbidden`).
 */
export function ParametresHsseq() {
  // ?onglet=grilles ou motifs ouvre directement l'onglet (lien depuis les contrôles).
  const demande = useSearchParams().get("onglet");
  const [onglet, setOnglet] = useState<Onglet>(demande === "grilles" || demande === "motifs" ? demande : "sites");
  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Sites et chefs de parc, grilles de contrôle par profil de véhicule, motifs du verrou de départ. Réservé à l'administration et au Responsable HSSEQ." />
      <Tabs
        value={onglet}
        onChange={setOnglet}
        tabs={[
          { key: "sites", label: "Sites" },
          { key: "grilles", label: "Grilles de contrôle" },
          { key: "motifs", label: "Motifs du verrou" },
        ]}
      />
      {onglet === "sites" && <Sites />}
      {onglet === "grilles" && <Grilles />}
      {onglet === "motifs" && <Motifs />}
    </div>
  );
}
