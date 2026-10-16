/**
 * Marques affichées. NIMOVA est la marque interne commune aux deux structures ; le portail des
 * porteurs de projets, ouvert aux clients du cabinet, porte la marque MB AxisPro Consulting.
 *
 * Le monogramme reprend le N du DG dans son carré vert : deux fûts vert d'eau (les deux
 * structures) reliés par une diagonale dorée (la plateforme commune).
 */
import { APPS, type AppCode } from "@/lib/config";
import { cx } from "@/lib/cx";

export const SIGNATURE = "La maîtrise intégrée de votre performance.";

export function Monogramme({ className, tuile = true, title }: { className?: string; tuile?: boolean; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className ?? "h-9 w-9"} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} focusable="false">
      {title && <title>{title}</title>}
      {tuile && <rect width="100" height="100" rx="22" fill="#142f29" />}
      <path d="M25 23h13l37 54H62Z" fill="#d4aa5b" />
      <path d="M25 23h13v54H25ZM62 23h13v54H62Z" fill="#a5e6c2" />
    </svg>
  );
}

/** Nom de module affiché sous NIMOVA (« Finance », « AxisPro », « Rotations »). */
export function moduleOf(app: AppCode): string {
  return APPS[app].name.replace(/^NIMOVA · /, "");
}

/** Bloc marque : monogramme, NIMOVA, module. Variante claire pour les fonds sombres. */
export function MarqueNimova({ app, clair, className }: { app?: AppCode; clair?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-3", className)}>
      <Monogramme className="h-9 w-9 flex-none" />
      <span className="leading-none">
        <span className={cx("block font-display text-[21px] font-semibold tracking-[0.08em]", clair ? "text-creme" : "text-foret")}>NIMOVA</span>
        {app && <span className={cx("mt-1 block text-[13px] font-medium", clair ? "text-menthe" : "text-muted")}>{moduleOf(app)}</span>}
      </span>
    </span>
  );
}

/**
 * Marque du cabinet pour le portail, en attendant son logo officiel (prérequis client) :
 * composition typographique sobre, sans monogramme inventé.
 */
export function MarqueCabinet({ clair, className }: { clair?: boolean; className?: string }) {
  return (
    <span className={cx("inline-block leading-none", className)}>
      <span className={cx("block font-display text-[21px] font-semibold", clair ? "text-creme" : "text-nuit")}>MB AxisPro</span>
      <span className={cx("mt-1 block text-[13px] font-medium tracking-[0.04em]", clair ? "text-[#c9d6e3]" : "text-muted")}>Consulting</span>
    </span>
  );
}
