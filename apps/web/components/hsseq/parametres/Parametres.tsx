"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Tabs } from "@/components/ui";
import { Auditeurs } from "./Auditeurs";
import { Grilles } from "./Grilles";
import { Itineraires } from "./Itineraires";
import { ModelesRapport } from "./ModelesRapport";
import { Motifs } from "./Motifs";
import { Reglages } from "./Reglages";
import { Sites } from "./Sites";

type Onglet = "sites" | "grilles" | "motifs" | "itineraires" | "rapports" | "auditeurs" | "reglages";
const ONGLETS: readonly Onglet[] = ["sites", "grilles", "motifs", "itineraires", "rapports", "auditeurs", "reglages"];

/**
 * Paramètres de NIMOVA · HSSEQ, réservés à l'administration et au Responsable HSSEQ (contrat, §2) :
 * sites et chefs de parc, grilles de contrôle par profil, motifs du verrou de départ, réglages de la
 * société (mise en service, seuils, délais, cibles). Le noyau refuse toute écriture d'un autre profil
 * (403 `forbidden`).
 */
export function ParametresHsseq() {
  // L'onglet est porté par l'adresse (?onglet=grilles, rapports&modele=…) : un lien l'ouvre, même page ouverte.
  const params = useSearchParams();
  const router = useRouter();
  const chemin = usePathname();
  const demande = params.get("onglet");
  const onglet: Onglet = (ONGLETS as readonly string[]).includes(demande ?? "") ? (demande as Onglet) : "sites";
  const setOnglet = (o: Onglet) => router.replace(o === "sites" ? chemin : `${chemin}?onglet=${o}`, { scroll: false });
  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Sites et chefs de parc, grilles de contrôle par profil de véhicule, motifs du verrou de départ, itinéraires, modèles du rapport mensuel, auditeurs externes, réglages de la société. Réservé à l'administration et au Responsable HSSEQ." />
      <Tabs
        value={onglet}
        onChange={setOnglet}
        tabs={[
          { key: "sites", label: "Sites" },
          { key: "grilles", label: "Grilles de contrôle" },
          { key: "motifs", label: "Motifs du verrou" },
          { key: "itineraires", label: "Itinéraires" },
          { key: "rapports", label: "Modèles de rapport" },
          { key: "auditeurs", label: "Auditeurs" },
          { key: "reglages", label: "Réglages" },
        ]}
      />
      {onglet === "sites" && <Sites />}
      {onglet === "grilles" && <Grilles />}
      {onglet === "motifs" && <Motifs />}
      {onglet === "itineraires" && <Itineraires />}
      {onglet === "rapports" && <ModelesRapport />}
      {onglet === "auditeurs" && <Auditeurs />}
      {onglet === "reglages" && <Reglages />}
    </div>
  );
}
