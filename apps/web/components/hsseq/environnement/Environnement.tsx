"use client";

/**
 * Environnement et qualité de NIMOVA · HSSEQ (lot 3, §3 et §10) : déversements et leur récupération,
 * registre des déchets jusqu'à leur enlèvement avec bordereau, poussières mesurées sur site,
 * contaminations de produit, réclamations des clients et leurs actions, consommation, CO₂ par km et
 * écarts de livraison calculés depuis Transport.
 *
 * Vue, filtres et fiche ouverte portés par l'adresse (`vue`, puis les paramètres propres à chaque vue ;
 * `site`, `du` et `au` sont partagés par les vues) : un lien partage la fiche d'un déversement, d'un
 * déchet, d'une mesure, d'une contamination ou d'une réclamation. Contaminations et réclamations ne
 * sont pas ouvertes au chef de parc. L'auditeur externe lit tout ce qui est dans son périmètre, sans
 * aucune commande ni nom de personne.
 */

import { Loading, Tabs } from "@/components/ui";
import { requete, useAdresse } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import type { Page } from "@/lib/hsseq-types";
import { Analyses } from "./Analyses";
import { filtresCommuns, useDroits, type Droits, type Vue } from "./commun";
import { Contaminations } from "./Contaminations";
import { Dechets } from "./Dechets";
import { Deversements } from "./Deversements";
import { Poussieres } from "./Poussieres";
import { Reclamations } from "./Reclamations";

/** Paramètres propres à une vue, retirés de l'adresse quand on change de vue (site et période restent). */
const PARAMETRES_VUE = ["statut", "nature", "gravite", "client", "retard", "depassements", "regroupement", "profil", "deversement", "dechet", "mesure", "contamination", "reclamation"];

/** Vues réservées aux lecteurs de la qualité (QUALITY_READ du noyau). */
const VUES_QUALITE: readonly Vue[] = ["produit", "reclamations"];

/**
 * Ce qui reste à traiter dans chaque registre, sur le site choisi : déversements en cours, déchets
 * entreposés, contaminations ouvertes, réclamations reçues ou répondues (pas encore closes).
 */
function useAtraiter(droits: Droits, site: string | null) {
  const compter = (chemin: string, status: string) => `${chemin}?${requete({ status, site_id: site, limit: 1 })}`;
  const deversements = useApi<Page<unknown>>(compter("/hsseq/spills", "open"));
  const dechets = useApi<Page<unknown>>(compter("/hsseq/wastes", "stored"));
  const contaminations = useApi<Page<unknown>>(droits.qualite ? compter("/hsseq/contaminations", "open") : null);
  const reclamations = useApi<Page<unknown>>(droits.qualite ? compter("/hsseq/complaints", "received,answered") : null);
  return {
    deversements: deversements.data?.total_count,
    dechets: dechets.data?.total_count,
    produit: contaminations.data?.total_count,
    reclamations: reclamations.data?.total_count,
  };
}

export function Environnement() {
  const { lire, ecrire } = useAdresse();
  const droits = useDroits();
  const { site } = filtresCommuns(lire);
  const atraiter = useAtraiter(droits, site || null);

  const vues: Array<{ key: Vue; label: string; count?: number }> = [
    { key: "deversements", label: "Déversements", count: atraiter.deversements },
    { key: "dechets", label: "Déchets", count: atraiter.dechets },
    { key: "poussieres", label: "Poussières" },
    ...(droits.qualite
      ? [
          { key: "produit" as const, label: "Manquants et contaminations", count: atraiter.produit },
          { key: "reclamations" as const, label: "Réclamations", count: atraiter.reclamations },
        ]
      : []),
    { key: "consommation", label: "Consommation et livraisons" },
  ];
  const demandee = lire("vue");
  const vue: Vue = vues.find((v) => v.key === demandee)?.key ?? "deversements";
  const changerVue = (v: Vue) => ecrire({ vue: v === "deversements" ? null : v, ...Object.fromEntries(PARAMETRES_VUE.map((p) => [p, null])) });
  const props = { lire, ecrire, droits };

  return (
    <div>
      <Tabs value={vue} onChange={changerVue} tabs={vues} />
      {/* Vue réservée demandée par un lien : elle attend la lecture de la session avant de retomber sur les déversements. */}
      {!droits.pret && (VUES_QUALITE as string[]).includes(demandee) ? (
        <Loading label="Lecture de vos droits…" />
      ) : vue === "dechets" ? (
        <Dechets {...props} />
      ) : vue === "poussieres" ? (
        <Poussieres {...props} />
      ) : vue === "produit" ? (
        <Contaminations {...props} />
      ) : vue === "reclamations" ? (
        <Reclamations {...props} />
      ) : vue === "consommation" ? (
        <Analyses {...props} />
      ) : (
        <Deversements {...props} />
      )}
    </div>
  );
}
