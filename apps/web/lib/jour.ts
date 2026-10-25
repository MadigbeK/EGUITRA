/**
 * Date du jour à Conakry (AAAA-MM-JJ), valeur par défaut des champs de date : le noyau date les pièces à
 * l'heure de Conakry, quel que soit le fuseau du poste qui saisit. `new Date()` lu à l'heure du poste
 * (getMonth, getDate) donnerait la veille ou le lendemain sur un poste réglé sur un autre fuseau.
 */
export function aujourdhui(): string {
  const parties = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Conakry", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const valeur = (type: Intl.DateTimeFormatPartTypes) => parties.find((p) => p.type === type)?.value ?? "";
  return `${valeur("year")}-${valeur("month")}-${valeur("day")}`;
}

/** Mois en cours à Conakry (1 à 12). */
export function moisEnCours(): number {
  return Number(aujourdhui().slice(5, 7));
}

/** Année en cours à Conakry. */
export function anneeEnCours(): number {
  return Number(aujourdhui().slice(0, 4));
}
