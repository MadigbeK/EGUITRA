"use client";

import { ErrorBox, Loading, Tabs } from "@/components/ui";
import { useAdresse } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import type { Me } from "@/lib/types";
import { Imports } from "./Imports";
import { SANS_FILTRE, lireFiltres, moisDuRapport } from "./outils";
import { Situation } from "./Situation";
import { Violations } from "./Violations";

/** Profils de lecture complète : ils lisent l'historique des imports (IMPORT_READ du noyau). */
const LECTURE_COMPLETE = ["admin", "direction", "hsseq"];

type Onglet = "violations" | "imports";

/**
 * Télématique de NIMOVA · HSSEQ (lot 3) : violations de conduite relevées par les boîtiers des véhicules
 * (OBC, GPS, IVMS), importées en CSV ou en Excel en attendant l'interface du fournisseur
 * (controllers/telematics.py). En tête, la situation du mois lue au cockpit (violations pour 100 voyages) ;
 * puis les violations, filtrées par type, période, site, véhicule et conducteur ; pour l'administration,
 * la direction et le Responsable HSSEQ, l'onglet des imports, où le Responsable HSSEQ seul importe un
 * fichier. Le chef de parc et l'auditeur lisent les violations des véhicules de leurs sites, l'auditeur
 * sans le nom des conducteurs et sans aucune commande. Onglet et filtres portés par l'adresse (./outils.ts).
 */
export function Telematique() {
  const { lire, ecrire } = useAdresse();
  const { data: moi, error, mutate } = useApi<Me>("/auth/me");
  const f = lireFiltres(lire);
  // Les commandes et colonnes dépendent du profil : rien ne s'affiche avant la lecture de la session.
  if (!moi) return error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de la télématique…" />;

  const lectureComplete = moi.profiles.some((p) => LECTURE_COMPLETE.includes(p));
  const importeur = moi.profiles.includes("hsseq");
  // Auditeur externe sans profil de lecture complète : le noyau ne lui sert pas les noms (personal_data_hidden).
  const nomsCaches = moi.profiles.includes("auditeur") && !lectureComplete;
  const onglet: Onglet = lire("onglet") === "imports" && lectureComplete ? "imports" : "violations";

  return (
    <div className="space-y-6">
      <Situation mois={moisDuRapport(f)} site={f.site} />
      {lectureComplete && (
        <Tabs<Onglet>
          value={onglet}
          onChange={(o) => ecrire({ onglet: o === "violations" ? null : o })}
          tabs={[
            { key: "violations", label: "Violations" },
            { key: "imports", label: "Imports" },
          ]}
        />
      )}
      {onglet === "imports" ? (
        <Imports importeur={importeur} onVoir={(id) => ecrire({ ...SANS_FILTRE, onglet: null, import: id })} />
      ) : (
        <Violations f={f} ecrire={ecrire} importeur={importeur} nomsCaches={nomsCaches} />
      )}
    </div>
  );
}
