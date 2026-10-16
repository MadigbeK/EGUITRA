/** Applications servies par ce projet. Le code d'application est transmis à l'API à la connexion. */
export type AppCode = "finance" | "axispro" | "portail" | "mobile";

/** Les deux sociétés : EGUITRA GROUP SARLU (« groupe ») et MB AxisPro Consulting (« cabinet »). */
export type EntiteSociete = "groupe" | "cabinet";

/**
 * Registre des applications (le pendant du noyau : addons/eguitra_api/organisation.py).
 * Noms affichés (décision du gérant, 16 octobre 2026) : NIMOVA, marque interne, suivie du module.
 * Le portail, ouvert aux clients du cabinet, porte la marque MB AxisPro Consulting.
 * entity : société servie, null pour les deux. Finance sert les deux sociétés ; AxisPro Suite et le
 * portail, le seul cabinet ; Rotations, le seul groupe (le noyau l'impose).
 */
export const APPS: Record<AppCode, { name: string; home: string; tagline: string; entity: EntiteSociete | null }> = {
  finance: { name: "NIMOVA · Finance", home: "/finance", tagline: "Pilotage financier du groupe", entity: null },
  axispro: { name: "NIMOVA · AxisPro", home: "/axispro", tagline: "Évaluation et suivi des projets", entity: "cabinet" },
  portail: { name: "Portail des porteurs de projets", home: "/portail", tagline: "MB AxisPro Consulting", entity: "cabinet" },
  mobile: { name: "NIMOVA · Rotations", home: "/mobile", tagline: "Saisie des rotations au parc", entity: "groupe" },
};

export function isAppCode(value: unknown): value is AppCode {
  return typeof value === "string" && value in APPS;
}

/** Application par défaut selon le nom d'hôte (axispro.* -> AxisPro Suite, sinon EGUITRA Finance). */
export function appFromHost(host: string | null): AppCode {
  const h = (host ?? "").toLowerCase();
  if (h.startsWith("axispro.")) return "axispro";
  if (h.startsWith("portail.")) return "portail";
  return "finance";
}

/**
 * Espace ouvert par l'accueil NIMOVA : celui mémorisé à la connexion, à défaut celui de l'adresse
 * (axispro.* : AxisPro). Sans cela, un consultant du cabinet arrivant sur axispro.* sans cookie
 * serait envoyé vers la connexion à Finance, qui ne lui est pas ouverte.
 */
export function accueilApp(memo: string | undefined, host: string | null): "finance" | "axispro" {
  if (memo === "finance" || memo === "axispro") return memo;
  return appFromHost(host) === "axispro" ? "axispro" : "finance";
}

/** Application déduite du chemin demandé. */
export function appFromPath(pathname: string): AppCode | null {
  const first = pathname.split("/")[1] ?? "";
  return isAppCode(first) ? first : null;
}
