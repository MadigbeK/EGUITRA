/** Applications servies par ce projet. Le code d'application est transmis à l'API à la connexion. */
export type AppCode = "finance" | "axispro" | "portail" | "mobile";

/**
 * Noms affichés (décision du gérant, 16 octobre 2026) : NIMOVA, marque interne, suivie du module.
 * Le portail, ouvert aux clients du cabinet, porte la marque MB AxisPro Consulting.
 */
export const APPS: Record<AppCode, { name: string; home: string; tagline: string }> = {
  finance: { name: "NIMOVA · Finance", home: "/finance", tagline: "Pilotage financier du groupe" },
  axispro: { name: "NIMOVA · AxisPro", home: "/axispro", tagline: "Évaluation et suivi des projets" },
  portail: { name: "Portail des porteurs de projets", home: "/portail", tagline: "MB AxisPro Consulting" },
  mobile: { name: "NIMOVA · Rotations", home: "/mobile", tagline: "Saisie des rotations au parc" },
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

/** Application déduite du chemin demandé. */
export function appFromPath(pathname: string): AppCode | null {
  const first = pathname.split("/")[1] ?? "";
  return isAppCode(first) ? first : null;
}
