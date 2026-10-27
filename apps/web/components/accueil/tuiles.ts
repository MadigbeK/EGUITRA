import { APPS, ESPACES, appFromPath, type AppCode, type EntiteSociete, type EspaceCode } from "@/lib/config";
import { navFor } from "@/lib/nav";
import type { Company, Me } from "@/lib/types";

/**
 * Module ouvert au compte : une tuile de l'accueil, une entrée du lanceur. entite : module réservé à
 * une société (BTP et Immobilier : EGUITRA GROUP), ouvert dans ses livres (societePour).
 */
export type Tuile = { cle: string; libelle: string; href: string; motsCles: string; entite?: EntiteSociete };

/** Modules d'un espace (Finance, AxisPro, Analyse) ou outils communs (Rotations, Réglages). */
export type Rayon = { cle: EspaceCode | "outils"; titre: string; tuiles: Tuile[] };

/** Libellés courts des tuiles, comme sur l'accueil d'Odoo (le menu de l'espace garde les longs). */
const COURT: Record<string, string> = {
  "/finance/pilotage": "Budget",
  "/finance/rapport": "Rapport mensuel",
  "/finance/approbations": "À valider",
  "/finance/achats": "Achats",
  "/finance/demandes": "Mes demandes",
  "/finance/fournisseurs": "Fournisseurs",
  "/finance/guide-achats": "Guide des achats",
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
  "/transport": "Transport",
  "/transport/rotations": "Suivi des rotations",
  "/transport/proprietaires": "Propriétaires",
  "/transport/flotte": "Flotte",
  "/transport/routes": "Routes et tarifs",
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
  "/rh": "Tableau RH",
  "/rh/guide": "Guide RH",
  "/rh/salaries": "Salariés",
  "/rh/conges": "Congés",
  "/rh/avances": "Avances",
  "/rh/habilitations": "Habilitations",
  "/rh/paie": "Paie",
  "/rh/simulateur": "Simulateur",
  "/rh/moi": "Mon espace",
};

/**
 * Société transmise par l'accueil aux modules qu'il ouvre : celle qu'il affiche, seulement si elle s'y
 * choisit. Un accueil lu sous une application qui impose sa société (AxisPro : le cabinet ; Transport :
 * le groupe) n'aligne rien : l'utilisateur n'a pas choisi cette société, et Finance, Analyse ou RH
 * auraient changé de livres en silence.
 */
function societeTransmise(me: Me, app: AppCode): Company | undefined {
  return APPS[app].entity ? undefined : me.companies.find((c) => c.id === me.company_id);
}

/**
 * Modules ouverts au compte, rangés par espace : Finance, puis AxisPro, puis Analyse, puis Rotations
 * et Réglages. L'administration des espaces tient en une seule tuile, Réglages. `accueil` : la grille
 * de l'accueil, qui transmet sa société aux modules qu'il ouvre (societeTransmise) ; le lanceur ne le
 * fait pas.
 */
export function rayonsDe(me: Me, app: AppCode, accueil = false): Rayon[] {
  const company = me.companies.find((c) => c.id === me.company_id);
  const transmise = accueil ? societeTransmise(me, app) : undefined;
  const rayons: Rayon[] = [];
  let reglages: string | null = null;
  for (const a of ESPACES) {
    if (!me.apps.includes(a)) continue;
    const tuiles: Tuile[] = [];
    // Société dans laquelle le module s'ouvrira, quand on la connaît : celle de l'application ouverte,
    // celle que l'accueil lui transmet, celle qu'impose l'application. Analyse suit la société de
    // travail quelle que soit l'application ouverte : ses sections sont celles du groupe ou du cabinet.
    const servie = APPS[a].entity;
    const entite =
      a === app || a === "analyse" ? company?.entity : transmise && (!servie || servie === transmise.entity) ? transmise.entity : servie;
    for (const s of navFor(a, me.profiles, entite)) {
      if (s.label === "Administration") {
        reglages ??= s.items[0]?.href ?? null;
        continue;
      }
      for (const i of s.items) {
        // Module réservé à une société, quand celle de l'application n'est pas connue ici (Finance vue
        // depuis AxisPro) : proposé si le compte est ouvert à cette société, et ouvert dans ses livres
        // (societePour) ; jamais proposé pour répondre « ne concerne qu'EGUITRA GROUP ».
        if (i.entity && !entite && !me.companies.some((c) => c.entity === i.entity)) continue;
        tuiles.push({ cle: i.href, libelle: COURT[i.href] ?? i.label, href: i.href, motsCles: `${i.label} ${s.label} ${APPS[a].name}`, entite: i.entity });
      }
    }
    if (tuiles.length) rayons.push({ cle: a, titre: APPS[a].name.replace("NIMOVA · ", ""), tuiles });
  }
  const outils: Tuile[] = [];
  if (me.apps.includes("mobile")) outils.push({ cle: "/mobile", libelle: "Rotations", href: "/mobile", motsCles: "Rotations téléphone parc camion" });
  if (reglages) outils.push({ cle: "reglages", libelle: "Réglages", href: reglages, motsCles: "Réglages administration utilisateurs sociétés seuils audit" });
  if (outils.length) rayons.push({ cle: "outils", titre: "Outils", tuiles: outils });
  return rayons;
}

/**
 * Société à donner à l'application d'une tuile avant de l'ouvrir ; null : rien à changer.
 * - Module réservé à une société (BTP, Immobilier) : ses livres (ceux de la page s'ils le sont).
 * - Depuis l'accueil (`accueil`), la société qu'il affiche si elle s'y choisit et si l'application
 *   ouverte l'accepte (AxisPro ne sert que le cabinet).
 * - Rien pour un module de l'application ouverte : il est déjà dans ses livres.
 */
export function societePour(me: Me, app: AppCode, tuile: Tuile, accueil: boolean): Company | null {
  const cible = appFromPath(tuile.href);
  if (!cible || cible === app) return null;
  const company = me.companies.find((c) => c.id === me.company_id);
  if (tuile.entite) return company?.entity === tuile.entite ? company : (me.companies.find((c) => c.entity === tuile.entite) ?? null);
  const transmise = accueil ? societeTransmise(me, app) : undefined;
  if (!transmise) return null;
  const servie = APPS[cible].entity;
  return servie && servie !== transmise.entity ? null : transmise;
}

/**
 * Donne sa société à l'application d'une tuile (societePour) avant de l'ouvrir. Vrai si rien n'était à
 * changer ou si la société est mémorisée ; faux sur un échec (le module s'ouvre alors dans la société
 * qu'il avait, affichée dans son en-tête).
 */
export async function alignerSociete(me: Me, app: AppCode, tuile: Tuile, accueil: boolean): Promise<boolean> {
  const cible = appFromPath(tuile.href);
  const societe = societePour(me, app, tuile, accueil);
  if (!cible || !societe) return true;
  const res = await fetch("/api/session/company", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: societe.id, app: cible }),
  }).catch(() => null);
  return Boolean(res?.ok);
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
