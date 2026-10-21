import { APPS, ESPACES, type AppCode, type EspaceCode } from "@/lib/config";
import { navFor } from "@/lib/nav";
import type { Me } from "@/lib/types";

/** Module ouvert au compte : une tuile de l'accueil, une entrée du lanceur. */
export type Tuile = { cle: string; libelle: string; href: string; motsCles: string };

/** Modules d'un espace (Finance, AxisPro, Analyse) ou outils communs (Rotations, Réglages). */
export type Rayon = { cle: EspaceCode | "outils"; titre: string; tuiles: Tuile[] };

/** Libellés courts des tuiles, comme sur l'accueil d'Odoo (le menu de l'espace garde les longs). */
const COURT: Record<string, string> = {
  "/finance/pilotage": "Budget",
  "/finance/rapport": "Rapport mensuel",
  "/finance/approbations": "À valider",
  "/finance/achats": "Achats",
  "/finance/relances": "Relances",
  "/finance/dette": "Dette",
  "/finance/ecritures": "Journaux",
  "/finance/etats": "États financiers",
  "/finance/clotures": "Clôtures",
  "/axispro": "Dossiers",
  "/axispro/actions": "Plan d'actions",
  "/axispro/temps": "Temps",
  "/axispro/grille": "Grille",
  "/axispro/pieces": "Pièces",
  "/analyse": "Analyse",
  "/analyse/tresorerie": "Prévision de trésorerie",
  "/analyse/clients": "Clients",
  "/analyse/transport": "Flotte et routes",
  "/analyse/depenses": "Dépenses",
  "/analyse/previsions": "Atterrissage",
  "/analyse/fiabilite": "Fiabilité",
  "/analyse/portefeuille": "Pipeline",
  "/analyse/diagnostic": "Diagnostic",
  "/analyse/comites": "Décisions",
  "/analyse/activite": "Honoraires",
};

/**
 * Modules ouverts au compte, rangés par espace : Finance, puis AxisPro, puis Analyse, puis Rotations
 * et Réglages. L'administration des espaces tient en une seule tuile, Réglages.
 */
export function rayonsDe(me: Me, app: AppCode): Rayon[] {
  const company = me.companies.find((c) => c.id === me.company_id);
  const rayons: Rayon[] = [];
  let reglages: string | null = null;
  for (const a of ESPACES) {
    if (!me.apps.includes(a)) continue;
    const tuiles: Tuile[] = [];
    // Analyse suit la société de travail quelle que soit l'application ouverte : ses sections
    // sont celles du groupe ou du cabinet.
    const entite = a === app || a === "analyse" ? company?.entity : APPS[a].entity;
    for (const s of navFor(a, me.profiles, entite)) {
      if (s.label === "Administration") {
        reglages ??= s.items[0]?.href ?? null;
        continue;
      }
      for (const i of s.items) tuiles.push({ cle: i.href, libelle: COURT[i.href] ?? i.label, href: i.href, motsCles: `${i.label} ${s.label} ${APPS[a].name}` });
    }
    if (tuiles.length) rayons.push({ cle: a, titre: APPS[a].name.replace("NIMOVA · ", ""), tuiles });
  }
  const outils: Tuile[] = [];
  if (me.apps.includes("mobile")) outils.push({ cle: "/mobile", libelle: "Rotations", href: "/mobile", motsCles: "Rotations téléphone parc camion" });
  if (reglages) outils.push({ cle: "reglages", libelle: "Réglages", href: reglages, motsCles: "Réglages administration utilisateurs sociétés seuils audit" });
  if (outils.length) rayons.push({ cle: "outils", titre: "Outils", tuiles: outils });
  return rayons;
}

export function sansAccents(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Tuile voisine dans une grille selon la flèche : la suivante ou la précédente en ligne, et en
 * colonne celle de la ligne voisine la plus proche du centre de la tuile courante.
 */
export function voisine(liens: HTMLElement[], i: number, touche: string): number {
  if (touche === "ArrowRight") return Math.min(liens.length - 1, i + 1);
  if (touche === "ArrowLeft") return Math.max(0, i - 1);
  if (touche === "Home") return 0;
  if (touche === "End") return liens.length - 1;
  const r = liens[i]!.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const bas = touche === "ArrowDown";
  const candidats = liens.map((l, n) => ({ n, b: l.getBoundingClientRect() })).filter(({ b }) => (bas ? b.top > r.top + 5 : b.top < r.top - 5));
  if (!candidats.length) return i;
  const ligne = bas ? Math.min(...candidats.map((c) => c.b.top)) : Math.max(...candidats.map((c) => c.b.top));
  const memeLigne = candidats.filter((c) => Math.abs(c.b.top - ligne) < 5);
  return memeLigne.reduce((m, c) => (Math.abs(c.b.left + c.b.width / 2 - x) < Math.abs(m.b.left + m.b.width / 2 - x) ? c : m)).n;
}
