/** Applications servies par ce projet. Le code d'application est transmis à l'API à la connexion. */
export type AppCode = "finance" | "axispro" | "portail" | "mobile";

export const APPS: Record<AppCode, { name: string; home: string; tagline: string }> = {
  finance: { name: "EGUITRA Finance", home: "/finance", tagline: "Pilotage financier du groupe" },
  axispro: { name: "AxisPro Suite", home: "/axispro", tagline: "Évaluation et suivi des projets" },
  portail: { name: "Portail AxisPro", home: "/portail", tagline: "Espace des porteurs de projets" },
  mobile: { name: "EGUITRA Rotations", home: "/mobile", tagline: "Saisie des rotations au parc" },
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
