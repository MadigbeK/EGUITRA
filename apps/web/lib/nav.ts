import type { AppCode, EntiteSociete } from "./config";
import type { Profile } from "./types";

/** Pastille de l'entrée : nombre d'alertes actives, de validations en attente, de contrôles en anomalie. */
export type NavBadge = "alerts" | "approvals" | "controls";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  profiles?: Profile[];
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
/** Profils qui tranchent ou suivent les validations depuis « À valider » (le profil Achats suit les siennes). */
const VALIDATION: Profile[] = ["admin", "direction", "finance", "exploitation", "chantiers", "immobilier"];
/** Profils qui gèrent l'espace RH (la direction lit et approuve ; l'administration et la RH écrivent). */
export const RH_GESTION: Profile[] = ["admin", "direction", "rh"];
/**
 * Profils de l'espace HSSEQ : l'administration, la direction (Directeur général), le Responsable HSSEQ
 * et l'exploitation (chef de parc). Le conducteur n'y entre pas : il passe par le téléphone.
 */
export const HSSEQ: Profile[] = ["admin", "direction", "hsseq", "exploitation"];
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
        { href: "/finance/approbations", label: "À valider", icon: "BadgeCheck", profiles: VALIDATION, badge: "approvals" },
        { href: "/finance/demandes", label: "Mes demandes", icon: "BadgeCheck", profiles: ACHATS },
        { href: "/finance/engagements", label: "Engagements de dépense", icon: "ListChecks", profiles: ["admin", "direction", "finance", "achats", "exploitation", "chantiers", "immobilier"] },
        { href: "/finance/alertes", label: "Alertes", icon: "Bell", profiles: FIN, badge: "alerts" },
        { href: "/finance/guide", label: "Guide de la finance", icon: "Info", profiles: FIN },
        { href: "/finance/guide-achats", label: "Guide des achats", icon: "Info", profiles: ACHATS },
      ],
    },
    {
      label: "Comptabilité",
      items: [
        { href: "/finance/ventes", label: "Ventes", icon: "Receipt", profiles: FIN },
        { href: "/finance/achats", label: "Achats et dépenses", icon: "ShoppingCart", profiles: [...FIN, "achats"] },
        { href: "/finance/fournisseurs", label: "Fournisseurs", icon: "Users", profiles: ACHATS },
        { href: "/finance/tresorerie", label: "Trésorerie", icon: "Landmark", profiles: FIN },
        { href: "/finance/relances", label: "Relances clients", icon: "Mail", profiles: FIN },
        { href: "/finance/tiers", label: "Tiers", icon: "Users", profiles: FIN },
        { href: "/finance/immobilisations", label: "Immobilisations", icon: "Boxes", profiles: FIN },
        { href: "/finance/dette", label: "Dette et financement", icon: "HandCoins", profiles: FIN },
        { href: "/finance/ecritures", label: "Journaux et OD", icon: "BookOpen", profiles: FIN },
        { href: "/finance/plan-comptable", label: "Plan comptable", icon: "ListChecks", profiles: ["admin", "finance"] },
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
        { href: "/finance/admin/axes", label: "Axes analytiques", icon: "Layers", profiles: ["admin", "finance"] },
        { href: "/finance/admin/imputations", label: "Imputations automatiques", icon: "Target", profiles: ["admin", "finance"] },
        { href: "/finance/admin/parametres", label: "Seuils et taux", icon: "SlidersHorizontal", profiles: ["admin"] },
        // Lecture : finance ; modification : administration (controllers/invoicing.py d'eguitra_finance).
        { href: "/finance/admin/factures", label: "Factures et journaux", icon: "Receipt", profiles: ["admin", "finance"] },
        { href: "/finance/admin/audit", label: "Journal d'audit", icon: "ScrollText", profiles: ["admin"] },
      ],
    },
  ],
  axispro: [
    {
      label: "Cabinet",
      items: [
        { href: "/axispro", label: "Dossiers", icon: "FolderKanban" },
        { href: "/axispro/actions", label: "Plan d'actions", icon: "ListChecks" },
        { href: "/axispro/financements", label: "Financements", icon: "HandCoins" },
        { href: "/axispro/comites", label: "Comités", icon: "Gavel" },
        { href: "/axispro/temps", label: "Temps et facturation", icon: "Clock" },
        { href: "/axispro/portail", label: "Portail des porteurs", icon: "Users" },
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
        { href: "/transport/rotations", label: "Rotations", icon: "Truck" },
        // Verrou de départ HSSEQ : le noyau répond 403 aux autres profils.
        { href: "/transport/departs", label: "Départs du jour", icon: "Lock", profiles: ["admin", "direction", "exploitation"] },
        { href: "/transport/manquants", label: "Manquants", icon: "Droplet" },
      ],
    },
    {
      label: "Gestion",
      items: [
        { href: "/transport/rentabilite", label: "Rentabilité", icon: "TrendingUp" },
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
      items: [{ href: "/analyse", label: "Cockpit", icon: "Radar", profiles: ["admin", "direction", "finance", "cabinet"] }],
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
      items: [{ href: "/rh/parametres", label: "Paramètres RH", icon: "SlidersHorizontal", profiles: ["admin", "rh"] }],
    },
  ],
  // HSSEQ, lot 1 (spécification HSSEQ, § 3 et § 12) : cockpit, événements, plan d'actions, contrôles.
  // Les rubriques du lot 2 (risques, habilitations, conformité) s'ajouteront ici.
  hsseq: [
    {
      label: "Pilotage",
      items: [
        { href: "/hsseq", label: "Cockpit", icon: "LayoutDashboard", profiles: HSSEQ_LECTURE },
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
        { href: "/hsseq/immobilisations", label: "Immobilisations", icon: "Lock", profiles: HSSEQ_LECTURE },
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
};

/**
 * Accueil d'EGUITRA Finance selon les profils. Le tableau de bord du dirigeant est réservé par le noyau
 * à l'administration, à la direction et à la finance (FIN_READ) : un compte qui porte l'un de ces
 * profils le garde, quels que soient ses autres profils. Les autres comptes s'ouvrent sur leur premier
 * écran utile : Achats et dépenses pour le profil Achats, BTP pour les chantiers, Immobilier pour
 * l'immobilier, Engagements de dépense pour l'exploitation (elle n'approuve aucune étape : sa corbeille
 * « À valider » reste vide). BTP et Immobilier ne servent que le groupe : dans les livres du cabinet
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

export function navFor(app: AppCode, profiles: Profile[], entity?: EntiteSociete | null): NavSection[] {
  return NAV[app]
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => (!item.profiles || item.profiles.some((p) => profiles.includes(p))) && (!item.entity || !entity || item.entity === entity),
      ),
    }))
    .filter((section) => section.items.length > 0);
}
