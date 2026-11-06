import useSWR from "swr";
import { CLE_NON_LUS_AGENDA } from "@/lib/agenda";
import { APPS, ESPACES, appFromPath, type AppCode, type EntiteSociete, type EspaceCode } from "@/lib/config";
import { CLE_NON_LUS, discussionOuverte, lireDiscret } from "@/lib/discussions";
import { navFor } from "@/lib/nav";
import type { Company, Me, Profile } from "@/lib/types";

/**
 * Module ouvert au compte : une tuile de l'accueil, une entrée du lanceur. entite : module réservé à
 * une société (BTP et Immobilier : EGUITRA GROUP), ouvert dans ses livres (societePour).
 */
export type Tuile = { cle: string; libelle: string; href: string; motsCles: string; entite?: EntiteSociete };

/** Modules d'un espace (Finance, AxisPro, Analyse) ou outils communs (Rotations, Discussion, Réglages). */
export type Rayon = { cle: EspaceCode | "outils"; titre: string; tuiles: Tuile[] };

// Une tuile porte le nom de son entrée de menu (lib/nav.ts) : un écran, un seul nom, sur l'accueil, dans
// le lanceur, dans les menus et dans la recherche (le dictionnaire des libellés courts a été retiré le
// 4 novembre 2026 ; la famille, au-dessus des tuiles, dit l'application).

/** Anciens noms des écrans renommés le 4 novembre 2026 : la recherche de l'accueil les retrouve encore. */
const ANCIENS_NOMS: Record<string, string> = {
  "/finance/approbations": "valider corbeille validation",
  "/finance/tiers": "tiers",
  "/finance/ecritures": "journaux od operations diverses",
  "/finance/admin/imputations": "imputations automatiques",
  "/transport/rotations": "rotations",
  "/analyse": "cockpit analyse",
  "/hsseq": "cockpit",
  "/hsseq/immobilisations": "immobilisations",
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
 * Modules ouverts au compte, rangés par espace : Finance, puis AxisPro, puis Analyse, puis Rotations,
 * la discussion et Réglages. L'administration des espaces tient en une seule tuile, Réglages. `accueil` : la grille
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
        tuiles.push({ cle: i.href, libelle: i.label, href: i.href, motsCles: `${s.label} ${APPS[a].name} ${ANCIENS_NOMS[i.href] ?? ""}`, entite: i.entity });
      }
    }
    if (tuiles.length) rayons.push({ cle: a, titre: APPS[a].name.replace("NIMOVA · ", ""), tuiles });
  }
  const outils: Tuile[] = [];
  if (me.apps.includes("mobile")) outils.push({ cle: "/mobile", libelle: "Rotations", href: "/mobile", motsCles: "Rotations téléphone parc camion" });
  // Discussion interne en pleine page : la tuile porte le nombre de messages non lus (useCompteurs).
  if (discussionOuverte(me)) outils.push({ cle: "/discussions", libelle: "Discussion", href: "/discussions", motsCles: "Discussion messages conversations collègues" });
  if (reglages) outils.push({ cle: "reglages", libelle: "Réglages", href: reglages, motsCles: "Réglages administration utilisateurs sociétés seuils audit" });
  if (outils.length) rayons.push({ cle: "outils", titre: "Outils", tuiles: outils });
  return rayons;
}

/** Application du métier de chaque profil : sa famille passe en tête de l'accueil et du lanceur. */
const METIER: Array<[Profile, EspaceCode]> = [
  ["exploitation", "transport"],
  ["cabinet", "axispro"],
  ["associe", "axispro"],
  ["rh", "rh"],
  ["hsseq", "hsseq"],
  ["service_client", "service-client"],
  ["achats", "finance"],
];

/**
 * Application principale du compte, dont la famille ouvre l'accueil : l'Analyse pour la direction ;
 * l'application ouverte pour l'administration et la finance ; sinon celle du métier du profil (Transport
 * pour l'exploitation, AxisPro pour le cabinet, RH, HSSEQ, Service client, Finance pour les achats) ;
 * à défaut, l'application retenue à la connexion.
 */
export function principale(me: Me, app: AppCode): string {
  if (me.profiles.includes("direction") && me.apps.includes("analyse")) return "analyse";
  if (me.profiles.some((p) => p === "admin" || p === "finance")) return app;
  return METIER.find(([p, a]) => me.profiles.includes(p) && me.apps.includes(a))?.[1] ?? app;
}

/** Familles dans l'ordre de l'accueil : l'application principale en tête, puis l'ordre habituel, les outils en fin. */
export function enTete(rayons: Rayon[], tete: string): Rayon[] {
  const premiere = rayons.find((r) => r.cle === tete);
  return premiere ? [premiere, ...rayons.filter((r) => r !== premiere)] : rayons;
}

/** Pastille d'une tuile : un nombre, sa gravité (rouge) et ce qu'il compte, pour les lecteurs d'écran. */
export type Pastille = { n: number; severe: boolean; sens: string };

type EnTeteFinance = { badges: { alerts: number; alerts_severe: number; approvals: number; controls: number; controls_blocking: number } };
type NonLus = { unread: number };
type NonLusAgenda = { unread: number; invitations: number };

const PROFILS_FINANCE: readonly Profile[] = ["admin", "direction", "finance"];

const lire = <T>(cle: string) => lireDiscret<T>(cle);

function pastille(n: number | undefined, severe: boolean, un: string, plusieurs: string): Pastille | null {
  return n && n > 0 ? { n, severe, sens: n > 1 ? plusieurs : un } : null;
}

/**
 * Compteurs des tuiles, lus aux routes que la coque appelle déjà : l'en-tête de Finance (/finance/shell :
 * demandes à approuver, alertes, contrôles en anomalie ; profils de la finance seuls, sinon le noyau
 * répond 403), les messages non lus de la discussion et les notifications de l'agenda. Chaque route
 * n'est appelée que si le compte y a droit et hors d'une session au mot de passe provisoire ou de
 * Rotations ; mêmes clés que la coque (une seule lecture, partagée). Lectures discrètes (lireDiscret) :
 * ni fenêtre de reconnexion ni effet sur la déconnexion après inactivité. `actif` : faux, rien n'est lu
 * (lanceur fermé). `relire` : faux, une valeur déjà en mémoire (lue par la coque) n'est pas relue.
 */
export function useCompteurs(me: Me, actif = true, relire = true): Record<string, Pastille> {
  const session = actif && !me.password_change_required && me.session_app !== "mobile";
  const options = { revalidateOnFocus: false, revalidateIfStale: relire, shouldRetryOnError: false, dedupingInterval: 30_000 };
  const finance = session && me.apps.includes("finance") && me.profiles.some((p) => PROFILS_FINANCE.includes(p));
  const { data: shell } = useSWR<EnTeteFinance>(finance ? "/finance/shell" : null, lire, options);
  const { data: chat } = useSWR<NonLus>(session && discussionOuverte(me) ? CLE_NON_LUS : null, lire, options);
  const { data: agenda } = useSWR<NonLusAgenda>(session && me.apps.includes("agenda") ? CLE_NON_LUS_AGENDA : null, lire, options);
  const b = shell?.badges;
  const compteurs: Record<string, Pastille | null> = {
    "/finance/approbations": pastille(b?.approvals, false, "demande à approuver", "demandes à approuver"),
    "/finance/alertes": pastille(b?.alerts, (b?.alerts_severe ?? 0) > 0, "alerte active", "alertes actives"),
    "/finance/clotures": pastille(b?.controls, (b?.controls_blocking ?? 0) > 0, "contrôle en anomalie", "contrôles en anomalie"),
    "/discussions": pastille(chat?.unread, false, "message non lu", "messages non lus"),
    "/agenda": pastille(agenda ? agenda.unread + agenda.invitations : 0, false, "notification ou invitation", "notifications ou invitations"),
  };
  return Object.fromEntries(Object.entries(compteurs).filter((e): e is [string, Pastille] => e[1] !== null));
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
