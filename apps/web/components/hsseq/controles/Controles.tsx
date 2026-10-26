"use client";

import Link from "next/link";
import { SlidersHorizontal } from "@/components/icons";
import { Tabs, classesBouton } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import type { Nonconformity, Page } from "@/lib/hsseq-types";
import { AvecFiche, aProfil, useAdresse, useReferentiels } from "@/components/hsseq/actions/outils";
import { Alcootests } from "./Alcootests";
import { ControlesRealises } from "./ControlesRealises";
import { FicheControle } from "./FicheControle";
import { NonConformites } from "./NonConformites";

type Vue = "controles" | "non-conformites" | "alcootests";
const VUES: readonly Vue[] = ["controles", "non-conformites", "alcootests"];

/** Paramètres propres à une vue, retirés de l'adresse quand on change de vue. */
const PARAMETRES_VUE = ["resultat", "statut", "bloquantes", "test", "annules", "vehicule", "controle"];

/**
 * Contrôles (§3, §5) : contrôles avant départ réalisés, non-conformités et leur levée, alcootests.
 * Vue, filtres et fiche ouverte portés par l'adresse ; la fiche d'un contrôle s'ouvre à côté de la
 * liste depuis les contrôles comme depuis les non-conformités.
 */
export function Controles() {
  const { lire, ecrire } = useAdresse();
  const { data: ref } = useReferentiels();
  const vue: Vue = (VUES as readonly string[]).includes(lire("vue")) ? (lire("vue") as Vue) : "controles";
  const choisi = vue === "alcootests" ? null : Number(lire("controle")) || null;
  const { data: nc } = useApi<Page<Nonconformity, { open: number; blocking_open: number }>>("/hsseq/checks/nonconformities?status=open&limit=1");

  const changerVue = (v: Vue) => ecrire({ vue: v === "controles" ? null : v, ...Object.fromEntries(PARAMETRES_VUE.map((p) => [p, null])) });

  const liste =
    vue === "controles" ? (
      <ControlesRealises ref_={ref} lire={lire} ecrire={ecrire} choisi={choisi} />
    ) : vue === "non-conformites" ? (
      <NonConformites ref_={ref} lire={lire} ecrire={ecrire} />
    ) : (
      <Alcootests ref_={ref} lire={lire} ecrire={ecrire} />
    );

  return (
    <div>
      <Tabs
        value={vue}
        onChange={changerVue}
        tabs={[
          { key: "controles", label: "Contrôles réalisés" },
          { key: "non-conformites", label: "Non-conformités", count: nc?.counts.open },
          { key: "alcootests", label: "Alcootests" },
        ]}
      />
      <AvecFiche ouverte={choisi !== null} liste={liste} fiche={choisi !== null && <FicheControle key={choisi} id={choisi} onFermer={() => ecrire({ controle: null })} />} />
    </div>
  );
}

/** Lien vers la gestion des grilles de contrôle (Paramètres), pour l'administration et le Responsable HSSEQ. */
export function LienGrilles() {
  const { data: ref } = useReferentiels();
  if (!aProfil(ref, "admin", "hsseq")) return null;
  return (
    <Link href="/hsseq/parametres?onglet=grilles" className={classesBouton("secondary")}>
      <SlidersHorizontal className="h-4 w-4" /> Grilles de contrôle
    </Link>
  );
}
