"use client";

/**
 * Revue de direction de NIMOVA · HSSEQ (lot 3), tenue entièrement à partir du module (critère de recette
 * du lot 3) : liste des revues, puis la fiche d'une revue en pleine largeur, document de travail de la
 * séance, du dossier de préparation au compte rendu en PDF. La fiche ouverte (revue) et les filtres de la
 * liste (etat, annee, tri) sont portés par l'adresse : un lien partage une revue.
 *
 * Lecture : administration, direction, hsseq et auditeur (REVIEW_READ du noyau) ; écriture : direction et
 * hsseq ; réouverture d'une revue close : hsseq seul. L'écran n'affiche que les commandes servies par le
 * noyau (`rights`, `transitions`) : un lecteur n'en voit aucune.
 */

import { useAdresse } from "@/components/hsseq/actions/outils";
import { FicheRevue } from "./FicheRevue";
import { ListeRevues } from "./ListeRevues";

export function Revues() {
  const { lire, ecrire } = useAdresse();
  const id = Number(lire("revue")) || null;
  if (id) return <FicheRevue key={id} id={id} onFermer={() => ecrire({ revue: null })} />;
  return <ListeRevues lire={lire} ecrire={ecrire} />;
}
