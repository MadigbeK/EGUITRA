import { APPS, appFromPath, type AppCode, type EntiteSociete } from "./config";
import type { Profile } from "./types";

/** Pastille de l'entrée : nombre d'alertes actives, de validations en attente, de contrôles en anomalie. */
export type NavBadge = "alerts" | "approvals" | "controls";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Profils qui voient l'entrée au menu et ouvrent l'écran ; sans liste, tous ceux de l'application. */
  profiles?: Profile[];
  /**
   * Profils qui ouvrent aussi l'écran sans l'avoir au menu : onglet ou lien d'un autre écran, que le noyau
   * leur sert (ecranOuvert les compte, le menu non).
   */
  acces?: Profile[];
  /** Module réservé à une société : masqué quand la société de travail est l'autre. */
  entity?: EntiteSociete;
  badge?: NavBadge;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

const FIN: Profile[] = ["admin", "direction", "finance"];
/** Profil Achats : engagements, pièces d'achat, fournisseurs, ses demandes et son guide, rien d'autre. */
const ACHATS: Profile[] = ["achats"];
/** Profils métier de Finance : ils engagent des dépenses et suivent leurs demandes, sans en approuver aucune. */
const METIERS: Profile[] = ["exploitation", "chantiers", "immobilier"];
/** Profils approbateurs des circuits (eguitra_approval, APPROVER_PROFILES) : seuls à avoir une corbeille « À approuver ». */
const APPROBATEURS: Profile[] = FIN;
/** Profils qui gèrent l'espace RH (la direction lit et approuve ; l'administration et la RH écrivent). */
export const RH_GESTION: Profile[] = ["admin", "direction", "rh"];
/**
 * Profils de l'espace HSSEQ : l'administration, la direction (Directeur général), le Responsable HSSEQ
 * et l'exploitation (chef de parc). Le conducteur n'y entre pas : il passe par le téléphone.
 */
export const HSSEQ: Profile[] = ["admin", "direction", "hsseq", "exploitation"];
/** Agents du service client : saisie, affectation, comptes de l'espace client (l'administration aussi). */
export const SC_AGENTS: Profile[] = ["admin", "service_client"];
/** Lecture de l'auditeur externe (lot 2), en plus : le noyau borne ses réponses à ses sites et refuse toute écriture. */
const HSSEQ_LECTURE: Profile[] = [...HSSEQ, "auditeur"];

/** Navigation par application ; chaque entrée n'apparaît qu'aux profils listés (offre, chapitre 3.4). */
export const NAV: Record<AppCode, NavSection[]> = {
  finance: [
    {
      label: "Pilotage",
      items: [
        { href: "/finance", label: "Tableau de bord", icon: "LayoutDashboard", profiles: FIN },
        { href: "/finance/pilotage", label: "Activités et budget", icon: "TrendingUp", profiles: FIN },
        { href: "/finance/rapport", label: "Rapport mensuel", icon: "FileText", profiles: FIN },
        // Les profils métier n'approuvent aucune étape (corbeille toujours vide) : ils suivent leurs demandes.
        { href: "/finance/approbations", label: "À approuver", icon: "BadgeCheck", profiles: APPROBATEURS, acces: METIERS, badge: "approvals" },
        { href: "/finance/demandes", label: "Mes demandes", icon: "BadgeCheck", profiles: [...ACHATS, ...METIERS], acces: FIN },
        { href: "/finance/engagements", label: "Engagements de dépense", icon: "ListChecks", profiles: ["admin", "direction", "finance", "achats", "exploitation", "chantiers", "immobilier"] },
        { href: "/finance/alertes", label: "Alertes", icon: "Bell", profiles: FIN, badge: "alerts" },
        // Guides : des pages de lecture, ouvertes à tout compte de Finance ; au menu, celui du profil.
        { href: "/finance/guide", label: "Guide de la finance", icon: "Info", profiles: FIN, acces: [...ACHATS, ...METIERS] },
        { href: "/finance/guide-achats", label: "Guide des achats", icon: "Info", profiles: ACHATS, acces: [...FIN, ...METIERS] },
      ],
    },
    {
      // Achats et ventes (eguitra_commerce) : aussi en onglets de Ventes et d'Achats et dépenses ; rubrique propre
      // pour qu'on les trouve. Profils des routes du module (lib/commerce-types.ts).
      label: "Achats et ventes",
      items: [
        { href: "/finance/ventes/offres", label: "Offres", icon: "FileText", profiles: FIN },
        { href: "/finance/ventes/commandes", label: "Commandes clients", icon: "ListChecks", profiles: FIN },
        { href: "/finance/achats/commandes", label: "Bons de commande", icon: "ShoppingCart", profiles: [...FIN, "achats", "exploitation", "chantiers", "immobilier"] },
        { href: "/finance/ventes/catalogue", label: "Catalogue", icon: "Boxes", profiles: FIN },
        // Le même catalogue que celui des ventes, ouvert par l'onglet « Catalogue » d'Achats et dépenses.
        { href: "/finance/achats/catalogue", label: "Catalogue des achats", icon: "Boxes", profiles: ACHATS, acces: [...FIN, ...METIERS] },
        { href: "/finance/ventes/tableau", label: "Tableau des ventes", icon: "TrendingUp", profiles: FIN },
        { href: "/finance/achats/tableau", label: "Tableau des achats", icon: "Gauge", profiles: [...FIN, "achats"] },
      ],
    },
    {
      label: "Comptabilité",
      items: [
        { href: "/finance/ventes", label: "Ventes", icon: "Receipt", profiles: FIN },
        { href: "/finance/achats", label: "Achats et dépenses", icon: "ShoppingCart", profiles: [...FIN, "achats"] },
        { href: "/finance/fournisseurs", label: "Fournisseurs", icon: "Users", profiles: ACHATS, acces: [...FIN, ...METIERS] },
        { href: "/finance/tresorerie", label: "Trésorerie", icon: "Landmark", profiles: FIN },
        { href: "/finance/budgets-voyage", label: "Budgets de voyage", icon: "Wallet", profiles: FIN, entity: "groupe" },
        { href: "/finance/relances", label: "Relances clients", icon: "Mail", profiles: FIN },
        { href: "/finance/tiers", label: "Clients et fournisseurs", icon: "Users", profiles: FIN },
        { href: "/finance/immobilisations", label: "Immobilisations", icon: "Boxes", profiles: FIN },
        { href: "/finance/dette", label: "Dette et financement", icon: "HandCoins", profiles: FIN },
        { href: "/finance/ecritures", label: "Écritures comptables", icon: "BookOpen", profiles: FIN },
        // Lecture du plan : toute la finance (le noyau la sert à la direction, hors de son menu).
        { href: "/finance/plan-comptable", label: "Plan comptable", icon: "ListChecks", profiles: ["admin", "finance"], acces: ["direction"] },
        { href: "/finance/etats", label: "Balance et états", icon: "FileSpreadsheet", profiles: FIN },
        { href: "/finance/fiscalite", label: "Fiscalité", icon: "Scale", profiles: FIN },
        { href: "/finance/clotures", label: "Clôtures et contrôles", icon: "Lock", profiles: FIN, badge: "controls" },
      ],
    },
    {
      label: "Métiers",
      items: [
        { href: "/finance/chantiers", label: "BTP", icon: "HardHat", profiles: ["admin", "direction", "finance", "chantiers"], entity: "groupe" },
        { href: "/finance/immobilier", label: "Immobilier", icon: "Building2", profiles: ["admin", "direction", "finance", "immobilier"], entity: "groupe" },
      ],
    },
    {
      label: "Administration",
      items: [
        { href: "/finance/admin/utilisateurs", label: "Utilisateurs", icon: "UserCog", profiles: ["admin"] },
        { href: "/finance/admin/societes", label: "Sociétés", icon: "Building2", profiles: ["admin"] },
        { href: "/finance/admin/axes", label: "Axes analytiques", icon: "Layers", profiles: ["admin", "finance"], acces: ["direction"] },
        { href: "/finance/admin/imputations", label: "Règles d'imputation", icon: "Target", profiles: ["admin", "finance"], acces: ["direction"] },
        { href: "/finance/admin/parametres", label: "Seuils et taux", icon: "SlidersHorizontal", profiles: ["admin"] },
        // Lecture : finance ; modification : administration (controllers/invoicing.py d'eguitra_finance).
        { href: "/finance/admin/factures", label: "Factures et journaux", icon: "Receipt", profiles: ["admin", "direction", "finance"] },
        // Réglages des achats et des ventes (eguitra_commerce, controllers/settings.py) : administration et finance.
        { href: "/finance/admin/commerce", label: "Achats et ventes", icon: "SlidersHorizontal", profiles: ["admin", "finance"] },
        { href: "/finance/admin/audit", label: "Journal d'audit", icon: "ScrollText", profiles: ["admin"] },
      ],
    },
  ],
  axispro: [
    {
      label: "Cabinet",
      items: [
        { href: "/axispro", label: "Accueil", icon: "LayoutDashboard" },
        { href: "/axispro/portefeuille", label: "Portefeuille", icon: "FolderKanban" },
        { href: "/axispro/dossiers", label: "Dossiers, vue du cabinet", icon: "FileStack" },
        { href: "/axispro/actions", label: "Plan d'actions", icon: "ListChecks" },
        { href: "/axispro/financements", label: "Financements", icon: "HandCoins" },
        { href: "/axispro/comites", label: "Comités", icon: "Gavel" },
        // Le lecteur ne lit ni les temps passés ni le portail (TIME_READ, eguitra_portail/controllers/cabinet.py).
        { href: "/axispro/temps", label: "Temps et facturation", icon: "Clock", profiles: ["admin", "direction", "cabinet"] },
        { href: "/axispro/portail", label: "Portail des porteurs", icon: "Users", profiles: ["admin", "direction", "cabinet"] },
      ],
    },
    {
      label: "Méthode",
      items: [
        { href: "/axispro/grille", label: "Grille d'évaluation", icon: "ListChecks" },
        { href: "/axispro/pieces", label: "Pièces standard", icon: "FileStack" },
      ],
    },
    {
      label: "Administration",
      items: [
        { href: "/axispro/admin/utilisateurs", label: "Utilisateurs", icon: "UserCog", profiles: ["admin"] },
        { href: "/axispro/admin/societes", label: "Sociétés", icon: "Building2", profiles: ["admin"] },
      ],
    },
  ],
  // Transport : application à part entière, servie au seul groupe (organisation.py).
  transport: [
    {
      label: "Exploitation",
      items: [
        { href: "/transport", label: "Tableau de bord", icon: "LayoutDashboard" },
        { href: "/transport/ordres", label: "Ordres de transport", icon: "FileText" },
        // « Suivi des rotations » : Rotations est la saisie au parc (outil du téléphone), un autre écran.
        { href: "/transport/rotations", label: "Suivi des rotations", icon: "Truck" },
        { href: "/transport/budgets", label: "Budgets de voyage", icon: "Wallet" },
        { href: "/transport/lettres-de-voiture", label: "Lettres de voiture", icon: "FileStack" },
        // Verrou de départ HSSEQ : le noyau répond 403 aux autres profils.
        { href: "/transport/departs", label: "Départs du jour", icon: "Lock", profiles: ["admin", "direction", "exploitation"] },
        { href: "/transport/manquants", label: "Manquants", icon: "Droplet" },
      ],
    },
    {
      label: "Gestion",
      items: [
        { href: "/transport/rentabilite", label: "Rentabilité", icon: "TrendingUp" },
        { href: "/transport/bons-carburant", label: "Bons carburant", icon: "Receipt" },
        { href: "/transport/proprietaires", label: "Propriétaires et répartition", icon: "HandCoins", profiles: FIN },
        { href: "/transport/taxes", label: "Taxes spécifiques", icon: "Receipt" },
      ],
    },
    {
      label: "Référentiels",
      items: [
        { href: "/transport/flotte", label: "Flotte et chauffeurs", icon: "Gauge" },
        { href: "/transport/routes", label: "Routes et tarifs", icon: "Route" },
        { href: "/transport/bareme", label: "Barème officiel", icon: "Scale" },
        { href: "/transport/parametres", label: "Paramètres", icon: "SlidersHorizontal" },
      ],
    },
  ],
  portail: [{ label: "Mon projet", items: [{ href: "/portail", label: "Mon dossier", icon: "FolderOpen" }] }],
  mobile: [{ label: "Rotations", items: [{ href: "/mobile", label: "Rotations", icon: "Truck" }] }],
  // Analyse : la synthèse sert les deux sociétés ; les sections changent avec la société de travail
  // (spécification docs/projet/analyse/specification.md, chapitres 5 et 6).
  analyse: [
    {
      label: "Synthèse",
      items: [{ href: "/analyse", label: "Tableau de bord", icon: "Radar", profiles: ["admin", "direction", "finance", "cabinet"] }],
    },
    {
      label: "EGUITRA GROUP",
      items: [
        { href: "/analyse/rentabilite", label: "Rentabilité", icon: "TrendingUp", profiles: FIN, entity: "groupe" },
        { href: "/analyse/tresorerie", label: "Trésorerie et prévision", icon: "Landmark", profiles: FIN, entity: "groupe" },
        { href: "/analyse/clients", label: "Portefeuille clients", icon: "Users", profiles: FIN, entity: "groupe" },
        { href: "/analyse/transport", label: "Flotte et routes", icon: "Truck", profiles: FIN, entity: "groupe" },
        { href: "/analyse/depenses", label: "Dépenses et contrôles", icon: "ShoppingCart", profiles: FIN, entity: "groupe" },
        { href: "/analyse/previsions", label: "Atterrissage et simulateur", icon: "Target", profiles: FIN, entity: "groupe" },
        { href: "/analyse/fiabilite", label: "Fiabilité des données", icon: "ShieldCheck", profiles: FIN, entity: "groupe" },
      ],
    },
    {
      label: "MB AxisPro Consulting",
      items: [
        { href: "/analyse/portefeuille", label: "Projets et pipeline", icon: "FolderKanban", profiles: ["admin", "direction", "cabinet"], entity: "cabinet" },
        { href: "/analyse/diagnostic", label: "Diagnostic des projets", icon: "Layers", profiles: ["admin", "direction", "cabinet"], entity: "cabinet" },
        { href: "/analyse/comites", label: "Qualité des décisions", icon: "Gavel", profiles: ["admin", "direction", "cabinet"], entity: "cabinet" },
        { href: "/analyse/financements", label: "Financements", icon: "HandCoins", profiles: ["admin", "direction", "cabinet"], entity: "cabinet" },
        { href: "/analyse/activite", label: "Activité et honoraires", icon: "Clock", profiles: ["admin", "direction", "finance", "cabinet"], entity: "cabinet" },
        { href: "/analyse/risques", label: "Risques et exécution", icon: "ShieldAlert", profiles: ["admin", "direction", "cabinet"], entity: "cabinet" },
      ],
    },
  ],
  // RH : les deux sociétés. La gestion (RH_GESTION) ; « Mon espace » et le guide, à tout compte lié à
  // un dossier salarié (libre-service : congés, bulletins, demandes de son équipe).
  rh: [
    {
      label: "Pilotage",
      items: [
        { href: "/rh", label: "Tableau de bord", icon: "LayoutDashboard", profiles: RH_GESTION },
        { href: "/rh/guide", label: "Guide RH", icon: "Info" },
      ],
    },
    {
      label: "Personnel",
      items: [
        { href: "/rh/salaries", label: "Salariés", icon: "Users", profiles: RH_GESTION },
        { href: "/rh/conges", label: "Absences et congés", icon: "Calendar", profiles: RH_GESTION },
        { href: "/rh/avances", label: "Avances et prêts", icon: "HandCoins", profiles: RH_GESTION },
        { href: "/rh/habilitations", label: "Habilitations et sécurité", icon: "ShieldCheck", profiles: RH_GESTION },
      ],
    },
    {
      label: "Paie",
      items: [
        { href: "/rh/paie", label: "Paie du mois", icon: "Wallet", profiles: RH_GESTION },
        { href: "/rh/simulateur", label: "Simulateur de salaire", icon: "Calculator", profiles: RH_GESTION },
      ],
    },
    {
      label: "Mon espace",
      items: [{ href: "/rh/moi", label: "Mon espace", icon: "Home" }],
    },
    {
      label: "Administration",
      items: [{ href: "/rh/parametres", label: "Paramètres RH", icon: "SlidersHorizontal", profiles: ["admin", "rh"], acces: ["direction"] }],
    },
  ],
  // HSSEQ, lot 1 (spécification HSSEQ, § 3 et § 12) : tableau de bord, événements, plan d'actions, contrôles.
  // Les rubriques du lot 2 (risques, habilitations, conformité) s'ajouteront ici.
  hsseq: [
    {
      label: "Pilotage",
      items: [
        { href: "/hsseq", label: "Tableau de bord", icon: "LayoutDashboard", profiles: HSSEQ_LECTURE },
        { href: "/hsseq/rapports", label: "Rapport mensuel", icon: "FileText", profiles: ["admin", "direction", "hsseq"] },
        { href: "/hsseq/revues", label: "Revue de direction", icon: "Gavel", profiles: ["admin", "direction", "hsseq", "auditeur"] },
      ],
    },
    {
      label: "Maîtrise des risques",
      items: [
        { href: "/hsseq/evenements", label: "Événements", icon: "ShieldAlert", profiles: HSSEQ_LECTURE },
        // Tout compte interne responsable d'une action la met à jour, droits renvoyés par la fiche.
        { href: "/hsseq/actions", label: "Plan d'actions", icon: "ListChecks", profiles: HSSEQ_LECTURE },
        { href: "/hsseq/risques", label: "Registre des risques", icon: "Target", profiles: HSSEQ_LECTURE },
        { href: "/hsseq/controles", label: "Contrôles", icon: "ShieldCheck", profiles: HSSEQ_LECTURE },
        { href: "/hsseq/derogations", label: "Dérogations", icon: "BadgeCheck", profiles: HSSEQ_LECTURE },
        { href: "/hsseq/immobilisations", label: "Véhicules immobilisés", icon: "Lock", profiles: HSSEQ_LECTURE },
      ],
    },
    {
      label: "Environnement et terrain",
      items: [
        { href: "/hsseq/environnement", label: "Environnement et qualité", icon: "Feuille", profiles: HSSEQ_LECTURE },
        { href: "/hsseq/telematique", label: "Télématique", icon: "Radar", profiles: HSSEQ_LECTURE },
      ],
    },
    {
      label: "Personnel et conformité",
      items: [
        // Habilitations : pas l'auditeur (le noyau les sert à l'administration, à la direction, à HSSEQ et au chef de parc).
        { href: "/hsseq/habilitations", label: "Habilitations", icon: "UserCog", profiles: HSSEQ },
        { href: "/hsseq/conformite", label: "Audits et conformité", icon: "ScrollText", profiles: HSSEQ_LECTURE },
        { href: "/hsseq/documents", label: "Documents et urgences", icon: "BookOpen", profiles: HSSEQ_LECTURE },
      ],
    },
    {
      label: "Administration",
      items: [{ href: "/hsseq/parametres", label: "Paramètres", icon: "SlidersHorizontal", profiles: ["admin", "hsseq"] }],
    },
  ],
  // Agenda : ouvert à tout compte interne ; l'administration gère les ressources (salles, véhicules).
  agenda: [
    { label: "Agenda", items: [{ href: "/agenda", label: "Mon agenda", icon: "Calendar" }] },
    { label: "Équipe", items: [{ href: "/agenda/planning", label: "Planning d'équipe", icon: "Users" }] },
    { label: "Réglages", items: [{ href: "/agenda/reglages", label: "Réglages de l'agenda", icon: "SlidersHorizontal" }] },
    { label: "Administration", items: [{ href: "/agenda/ressources", label: "Ressources", icon: "Building2", profiles: ["admin"] }] },
  ],
  // Service client : profils des routes du module (addons/eguitra_service_client/controllers/common.py). Les
  // métiers n'y voient que les dossiers qui leur sont assignés ; la direction lit tout.
  "service-client": [
    {
      label: "Service client",
      items: [
        { href: "/service-client", label: "Dossiers", icon: "Inbox" },
        { href: "/service-client/nouveau", label: "Nouveau dossier", icon: "Plus", profiles: SC_AGENTS },
        { href: "/service-client/tableau", label: "Tableau de bord", icon: "LayoutDashboard", profiles: [...SC_AGENTS, "direction"] },
      ],
    },
    { label: "Espace client", items: [{ href: "/service-client/clients", label: "Comptes de l'espace client", icon: "Users", profiles: SC_AGENTS }] },
    { label: "Administration", items: [{ href: "/service-client/reglages", label: "Réglages du service client", icon: "SlidersHorizontal", profiles: [...SC_AGENTS, "direction"] }] },
  ],
  "espace-client": [{ label: "Mes demandes", items: [{ href: "/espace-client", label: "Mes demandes", icon: "Inbox" }] }],
};

/**
 * Accueil d'EGUITRA Finance selon les profils. Le tableau de bord du dirigeant est réservé par le noyau
 * à l'administration, à la direction et à la finance (FIN_READ) : un compte qui porte l'un de ces
 * profils le garde, quels que soient ses autres profils. Les autres comptes s'ouvrent sur leur premier
 * écran utile : Achats et dépenses pour le profil Achats, BTP pour les chantiers, Immobilier pour
 * l'immobilier, Engagements de dépense pour l'exploitation (elle n'approuve aucune étape : elle suit ses
 * demandes dans « Mes demandes »). BTP et Immobilier ne servent que le groupe : dans la société du cabinet
 * (entity, société de travail de Finance quand on la connaît), ces profils vont aux engagements.
 */
export function accueilFinance(profiles: readonly Profile[], entity?: EntiteSociete | null): string {
  if (profiles.some((p) => FIN.includes(p))) return "/finance";
  if (profiles.includes("achats")) return "/finance/achats";
  const groupe = entity !== "cabinet";
  if (groupe && profiles.includes("chantiers")) return "/finance/chantiers";
  if (groupe && profiles.includes("immobilier")) return "/finance/immobilier";
  if (profiles.some((p) => p === "exploitation" || p === "chantiers" || p === "immobilier")) return "/finance/engagements";
  return "/finance";
}

/**
 * Accueil de NIMOVA · RH selon les profils : le tableau de bord pour la gestion (administration,
 * direction, RH) ; « Mon espace » pour un compte en libre-service (dossier salarié lié, sans profil).
 */
export function accueilRh(profiles: readonly Profile[]): string {
  return profiles.some((p) => RH_GESTION.includes(p)) ? "/rh" : "/rh/moi";
}

/**
 * Doublons du menu : une seule entrée par écran. Un compte à la fois de la finance et des achats voyait
 * deux fois les mêmes fiches, le même catalogue, deux guides, deux suivis des demandes : l'entrée de
 * gauche se retire quand celle de droite, plus complète, est au menu. L'écran retiré reste ouvert
 * (onglets, liens, adresse) : voir `acces` et ecranOuvert.
 */
const DOUBLONS: Record<string, string> = {
  "/finance/fournisseurs": "/finance/tiers",
  "/finance/achats/catalogue": "/finance/ventes/catalogue",
  "/finance/guide-achats": "/finance/guide",
  "/finance/demandes": "/finance/approbations",
};

export function navFor(app: AppCode, profiles: Profile[], entity?: EntiteSociete | null): NavSection[] {
  const sections = NAV[app].map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => (!item.profiles || item.profiles.some((p) => profiles.includes(p))) && (!item.entity || !entity || item.entity === entity),
    ),
  }));
  const presents = new Set(sections.flatMap((s) => s.items.map((i) => i.href)));
  return sections
    .map((section) => ({ ...section, items: section.items.filter((i) => !(DOUBLONS[i.href] && presents.has(DOUBLONS[i.href]!))) }))
    .filter((section) => section.items.length > 0);
}

/**
 * L'écran de ce chemin est-il ouvert à ces profils ? D'après l'entrée de navigation la plus précise qui le
 * couvre : l'entrée elle-même ou l'une de ses sous-pages (fiche, onglet). L'accueil d'une application
 * (« /finance », « /rh »…) ne couvre que lui-même. Un écran sans entrée, une entrée sans profils, un chemin
 * hors des applications restent ouverts : le noyau tranche alors, comme avant. Les profils `acces`
 * (écran joint par un lien, hors du menu) comptent. La société (entity) n'entre pas en jeu : le noyau
 * refuse lui-même le module de l'autre société, avec le motif.
 */
export function ecranOuvert(pathname: string, profils: readonly Profile[]): boolean {
  const app = appFromPath(pathname);
  if (!app) return true;
  const chemin = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let entree: NavItem | null = null;
  for (const section of NAV[app]) {
    for (const item of section.items) {
      const couvre = chemin === item.href || (item.href !== APPS[app].home && chemin.startsWith(`${item.href}/`));
      if (couvre && (!entree || item.href.length > entree.href.length)) entree = item;
    }
  }
  if (!entree?.profiles) return true;
  return [...entree.profiles, ...(entree.acces ?? [])].some((p) => profils.includes(p));
}
