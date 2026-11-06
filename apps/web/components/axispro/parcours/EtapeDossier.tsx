"use client";

import { Download, FileSpreadsheet } from "@/components/icons";
import { Button, Card, Notice } from "@/components/ui";
import { useRetour } from "@/components/axispro/dossier/commun";
import { telechargerDossier, telechargerScoring, useDataRoomAncienne, usePieces } from "@/lib/axispro-api";
import { estV2 } from "@/lib/axispro-parcours";
import { fmtInt } from "@/lib/format";
import { useDossier } from "./DossierParcours";

/**
 * Étape 7, dossier complet (EC-11). Ouvert à tous les profils de l'application. Le .zip est produit par le
 * noyau : « Compression… » couvre son temps de préparation. Un dossier de l'ancienne méthode, que la route
 * refuse, télécharge sa data room et son rapport, et l'écran le dit.
 */
export function EtapeDossier() {
  const { d } = useDossier();
  const v2 = estV2(d);
  const { data: pieces } = usePieces(d.id, v2);
  const { data: salle } = useDataRoomAncienne(d.id, !v2);
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  const n = pieces?.count ?? salle?.files.length;
  const compte = n === undefined ? "–" : fmtInt(n);
  const lignes: Array<{ fichier: string; contenu: string }> = !v2 ? [{ fichier: "Pieces/", contenu: `${compte} pièce(s) déposée(s) de la data room` }] : [
    { fichier: `00_Synthese_${d.reference}.pdf`, contenu: "Fiche d'identité, scores, knock-out, score par domaine, pièces manquantes, relances, décisions du comité, historique des versions" },
    { fichier: `01_Scoring_${d.reference}.xlsx`, contenu: `Les ${fmtInt(d.scoring.criteria)} critères avec statut, points, poids, responsable, échéance, observation et pièce rattachée` },
    { fichier: "02_Relance_promoteur.txt", contenu: "Le dernier message de relance généré" },
    { fichier: "Pieces/A_… à J_…", contenu: `${compte} pièce(s) déposée(s), classées par catégorie de data room` },
  ];
  return (
    <Card title="Télécharger le dossier complet">
      <p className="text-[14px] text-ink-2">Un seul fichier .zip réunit tout ce qui concerne le projet {d.reference} :</p>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
        {lignes.map((l) => (
          <li key={l.fichier} className="grid grid-cols-1 gap-1 px-4 py-3 text-[13.5px] sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:gap-4">
            <span className="break-all font-mono text-[12.5px] font-semibold text-ink">{l.fichier}</span>
            <span className="text-muted">{l.contenu}</span>
          </li>
        ))}
      </ul>
      {!v2 && <div className="mt-3"><Notice tone="neutral">Ce dossier suit encore l&apos;ancienne méthode : le .zip réunit ses pièces, et le scoring se télécharge à part.</Notice></div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={enCours === "zip"} disabled={occupe} onClick={() => void envoyer(() => telechargerDossier(d), undefined, "zip")}>
          <Download aria-hidden className="h-4 w-4" /> Télécharger le dossier (.zip)
        </Button>
        <Button loading={enCours === "xlsx"} disabled={occupe} onClick={() => void envoyer(() => telechargerScoring(d), undefined, "xlsx")}>
          <FileSpreadsheet aria-hidden className="h-4 w-4" /> Scoring seul (.xlsx)
        </Button>
        {enCours === "zip" && <span className="text-[13px] text-muted" aria-live="polite">Compression…</span>}
      </div>
      {bandeau && <div className="mt-3">{bandeau}</div>}
    </Card>
  );
}
