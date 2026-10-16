/**
 * Marques affichées. NIMOVA est la marque interne commune aux deux structures ; le portail des
 * porteurs de projets, ouvert aux clients du cabinet, porte la marque MB AxisPro Consulting.
 *
 * Le monogramme reprend le N du DG dans son carré vert : deux fûts vert d'eau (les deux
 * structures) reliés par une diagonale dorée (la plateforme commune). Les logos des deux sociétés
 * sont ceux de leurs sites (eguitragroup.com, mbaxisproconsulting.com), recadrés dans
 * `public/brand/`.
 */
import { APPS, type AppCode } from "@/lib/config";
import { cx } from "@/lib/cx";

export const SIGNATURE = "La maîtrise intégrée de votre performance.";

export function Monogramme({ className, tuile = true, title }: { className?: string; tuile?: boolean; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className ?? "h-9 w-9"} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} focusable="false">
      {title && <title>{title}</title>}
      {tuile && <rect width="100" height="100" rx="24" fill="#183d33" />}
      <path d="M25 23h13l37 54H62Z" fill="#d3aa5b" />
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
      <Monogramme className="h-10 w-10 flex-none" />
      <span className="leading-none">
        <span className={cx("block font-display text-[20px] font-bold tracking-[0.06em]", clair ? "text-white" : "text-ink")}>NIMOVA</span>
        {app && <span className={cx("mt-1 block text-[12.5px] font-semibold", clair ? "text-menthe" : "text-accent")}>{moduleOf(app)}</span>}
      </span>
    </span>
  );
}

export type Entite = "groupe" | "cabinet";

const LOGOS: Record<Entite, { complet: [string, string, number, number]; embleme: [string, string, number, number]; nom: string }> = {
  groupe: { complet: ["/brand/eguitra-group.png", "/brand/eguitra-group-blanc.png", 370, 176], embleme: ["/brand/eguitra-embleme.png", "/brand/eguitra-embleme-blanc.png", 188, 128], nom: "EGUITRA GROUP" },
  cabinet: { complet: ["/brand/mb-axispro.png", "/brand/mb-axispro-blanc.png", 634, 152], embleme: ["/brand/mb-axispro-embleme.png", "/brand/mb-axispro-embleme-blanc.png", 134, 128], nom: "MB AxisPro Consulting" },
};

/**
 * Logo d'une société : complet (emblème et nom) ou emblème seul, en couleur sur fond clair, en
 * blanc sur fond sombre. La hauteur se règle par la classe (`h-8`, `h-10`…).
 */
export function LogoSociete({ entite, variante = "embleme", clair, className, decoratif }: { entite: Entite; variante?: "complet" | "embleme"; clair?: boolean; className?: string; decoratif?: boolean }) {
  const logo = LOGOS[entite];
  const [sombre, blanc, w, h] = logo[variante];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- fichier du site, sans transformation
    <img src={clair ? blanc : sombre} width={w} height={h} alt={decoratif ? "" : logo.nom} className={cx("w-auto select-none object-contain", className)} draggable={false} />
  );
}

/** Marque du cabinet pour le portail : son logo officiel. */
export function MarqueCabinet({ clair, className }: { clair?: boolean; className?: string }) {
  return <LogoSociete entite="cabinet" variante="complet" clair={clair} className={cx("h-10", className)} />;
}
