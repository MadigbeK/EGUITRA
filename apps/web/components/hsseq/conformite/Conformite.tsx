"use client";

/**
 * Audits et conformité de NIMOVA · HSSEQ (lot 2, §3 et §7) : programme d'audits, constats et leurs
 * actions, registre des exigences, revue de direction. Vue, filtres et fiche ouverte portés par
 * l'adresse (`vue`, puis les paramètres propres à chaque vue) : un lien partage la fiche d'un audit,
 * d'un constat ou d'une exigence. Le registre des exigences n'est pas ouvert au chef de parc ; la revue
 * de direction l'est à l'administration, à la direction et au Responsable HSSEQ. L'auditeur externe lit
 * tout ce qui est dans son périmètre, sans aucune commande.
 */

import { Loading, Tabs } from "@/components/ui";
import { useAdresse } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import type { Page } from "@/lib/hsseq-types";
import { useDroits, type Vue } from "./commun";
import { Constats } from "./Constats";
import { Exigences } from "./Exigences";
import { Programme } from "./Programme";
import { RevueDirection } from "./RevueDirection";
import type { Finding, FindingCounts } from "./types";

/** Paramètres propres à une vue, retirés de l'adresse quand on change de vue. */
const PARAMETRES_VUE = ["annee", "referentiel", "site", "statut", "audit", "classement", "constat", "source", "norme", "retard", "q", "exigence"];

export function Conformite() {
  const { lire, ecrire } = useAdresse();
  const droits = useDroits();
  // Constats encore ouverts, sur tout le périmètre du compte : le nombre de l'onglet.
  const { data: ouverts } = useApi<Page<Finding, FindingCounts>>("/hsseq/findings?status=open&limit=1");

  const vues: Array<{ key: Vue; label: string; count?: number }> = [
    { key: "programme", label: "Programme d'audits" },
    { key: "constats", label: "Constats", count: ouverts?.total_count },
    ...(droits.exigences ? [{ key: "exigences" as const, label: "Exigences" }] : []),
    ...(droits.revue ? [{ key: "revue" as const, label: "Revue de direction" }] : []),
  ];
  const demandee = lire("vue");
  const vue: Vue = vues.find((v) => v.key === demandee)?.key ?? "programme";
  const changerVue = (v: Vue) => ecrire({ vue: v === "programme" ? null : v, ...Object.fromEntries(PARAMETRES_VUE.map((p) => [p, null])) });
  const props = { lire, ecrire, droits };

  return (
    <div>
      <Tabs value={vue} onChange={changerVue} tabs={vues} />
      {/* Vue réservée demandée par un lien : elle attend la lecture de la session avant de retomber sur le programme. */}
      {!droits.pret && (demandee === "exigences" || demandee === "revue") ? (
        <Loading label="Lecture de vos droits…" />
      ) : vue === "constats" ? (
        <Constats {...props} />
      ) : vue === "exigences" ? (
        <Exigences {...props} />
      ) : vue === "revue" ? (
        <RevueDirection {...props} />
      ) : (
        <Programme {...props} />
      )}
    </div>
  );
}
