/**
 * Écriture commune des écrans Transport : volumes à décimales fixes, état des rotations, taux de
 * marge jugé au regard de la marge minimale. Les tableaux écrivent les montants entiers (fmtInt)
 * avec l'unité dans l'en-tête ; les volumes gardent toujours leurs deux décimales (les litres).
 */

import { INSECABLE, fmtPct } from "@/lib/format";

// Volumes et espace insécable : une seule écriture des nombres, dans lib/format.ts, partagée avec
// Rotations au téléphone. Réexportés ici pour les écrans Transport qui les prennent dans ce fichier.
export { INSECABLE, fmtFixe, fmtM3, fmtVolume } from "@/lib/format";

/**
 * Mot de l'état d'une rotation, que la table ETAT_TON (lib/couleurs.ts) traduit en ton. Une rotation
 * validée attend sa facture : elle s'écrit « À facturer », au trait neutre, pour ne pas se confondre
 * avec « Facturée » dans la vue « Toutes ».
 */
export const ETAT_ROTATION = { draft: "Saisie", en_route: "En route", done: "À facturer", invoiced: "Facturée", cancelled: "Annulée" } as const;

/** Le minimum écrit comme il est réglé : « 15 % », « 12,5 % ». */
function fmtMinimum(minimum: number): string {
  return fmtPct(minimum, Number.isInteger(minimum) ? 0 : 1);
}

/**
 * Taux écrit sans décimale, sauf s'il faut en montrer une ou deux pour qu'un taux sous le minimum ne
 * s'affiche pas égal à lui (14,6 % ne s'écrit pas « 15 % » face à un minimum de 15 %).
 */
function fmtTaux(taux: number, minimum: number | null): string {
  for (const d of [0, 1] as const) {
    const p = 10 ** d;
    if (minimum === null || taux >= minimum || Math.round(taux * p) / p < minimum) return fmtPct(taux, d);
  }
  return fmtPct(taux, 2);
}

/**
 * Taux de marge d'une ligne, jugé au regard de la marge minimale de la règle d'alerte (Seuils et
 * taux, servie par le noyau) : sous le minimum, il passe à surveiller, en semi-gras, avec le minimum
 * écrit à côté ; une marge négative est en alerte. Sans minimum (null ou 0), la marge n'est pas
 * jugée. Un taux estimé (coût standard de la route, aucun frais saisi) s'écrit en italique.
 */
export function TauxMarge({ taux, minimum, negative, estime }: { taux: number | null; minimum: number | null; negative?: boolean; estime?: boolean }) {
  if (taux === null || !Number.isFinite(taux)) return <span className="text-muted">–</span>;
  const seuil = minimum !== null && minimum > 0 ? minimum : null;
  const sous = seuil !== null && taux < seuil;
  const texte = fmtTaux(taux, seuil);
  if (negative) {
    return (
      <span className={estime ? "font-semibold italic text-danger" : "font-semibold text-danger"}>
        {texte}
        <span className="sr-only">{estime ? ", marge estimée négative" : ", marge négative"}</span>
      </span>
    );
  }
  if (sous) {
    return (
      <span className={estime ? "font-semibold italic text-warn" : "font-semibold text-warn"} title={`Sous la marge minimale de ${fmtMinimum(seuil)} (Seuils et taux)${estime ? ", d'après la marge estimée" : ""}`}>
        {texte}
        <span aria-hidden className="ml-1 text-[11.5px] font-medium">
          &lt;{INSECABLE}{fmtMinimum(seuil)}
        </span>
        <span className="sr-only">{`, sous le minimum de ${fmtMinimum(seuil)}${estime ? ", estimé" : ""}`}</span>
      </span>
    );
  }
  return (
    <span className={estime ? "italic text-muted" : "text-ink-2"}>
      {texte}
      {estime && <span className="sr-only">, estimé</span>}
    </span>
  );
}
