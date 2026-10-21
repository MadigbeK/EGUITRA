/**
 * Marques affichées. NIMOVA est la marque interne commune aux deux structures ; le portail des
 * porteurs de projets, ouvert aux clients du cabinet, porte la marque MB AxisPro.
 *
 * La marque NIMOVA est le pli (choix du gérant, 21 octobre 2026) : un ruban de papier-valeur plié
 * en N, le vert forêt et l'or du DG ; son sceau signe les documents officiels. Les logos des deux sociétés
 * sont ceux de leurs sites (eguitragroup.com, mbaxisproconsulting.com), recadrés dans
 * `public/brand/`.
 */
import { APPS, type AppCode } from "@/lib/config";
import { cx } from "@/lib/cx";

export const SIGNATURE = "La maîtrise intégrée de votre performance.";

const FORET = "#142f29";
const OR = "#d3aa5b";
const PLI_SOMBRE = "#a87d2e";
const CLAIR = "#f1f6f2";
const PLI_CLAIR = "#e6c47e";

/** Le pli : un ruban de papier-valeur plié en N, montants à l'endroit, diagonale à l'envers (or). */
function TracePli({ encre, pli }: { encre: string; pli: string }) {
  return (
    <>
      <rect x="10" y="10" width="12" height="44" fill={encre} />
      <rect x="42" y="10" width="12" height="44" fill={encre} />
      <polygon points="10,10 22,10 54,54 42,54" fill={OR} />
      <polygon points="10,10 22,10 22,26.5" fill={pli} />
      <polygon points="42,37.5 54,54 42,54" fill={pli} />
    </>
  );
}

/**
 * Marque NIMOVA, le pli (fichiers de référence dans `docs/design/logos/nimova/`). Seule par défaut
 * (`tuile={false}` : forêt et or sur fond clair, `clair` : pour les fonds sombres) ; `tuile` la pose
 * en clair sur son carré forêt, comme l'icône d'application.
 */
export function Monogramme({ className, tuile = true, clair, title }: { className?: string; tuile?: boolean; clair?: boolean; title?: string }) {
  const a11y = { role: title ? "img" : undefined, "aria-hidden": title ? undefined : true, focusable: "false" as const };
  if (tuile) {
    return (
      <svg viewBox="0 0 64 64" className={className ?? "h-9 w-9"} {...a11y}>
        {title && <title>{title}</title>}
        <rect width="64" height="64" rx="14" fill={FORET} />
        <g transform="translate(32 32) scale(.72) translate(-32 -32)">
          <TracePli encre={CLAIR} pli={PLI_CLAIR} />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="6 6 52 52" className={className ?? "h-9 w-9"} {...a11y}>
      {title && <title>{title}</title>}
      <TracePli encre={clair ? CLAIR : FORET} pli={clair ? PLI_CLAIR : PLI_SOMBRE} />
    </svg>
  );
}

/** Anneau ondulé de la rosace du sceau (180 points). */
function anneau(base: number, amplitude: number, lobes: number, phase: number): string {
  let d = "";
  for (let i = 0; i < 180; i++) {
    const t = (i / 180) * Math.PI * 2;
    const r = base + amplitude * Math.cos(lobes * t + phase);
    d += `${i ? "L" : "M"}${(32 + r * Math.cos(t)).toFixed(2)} ${(32 + r * Math.sin(t)).toFixed(2)}`;
  }
  return d + "Z";
}
const ANNEAUX = [0, 1, 2, 3, 4].map((j) => anneau(16.5 + j * 2.1, 1.6, 14, j * 0.62));
const CRANS = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * Math.PI * 2;
  return [32 + 27.2 * Math.cos(a), 32 + 27.2 * Math.sin(a), 32 + 29.2 * Math.cos(a), 32 + 29.2 * Math.sin(a)].map((v) => v.toFixed(2));
});

/** Sceau NIMOVA, réservé aux documents officiels : bord crénelé, rosace guillochée, le pli au cœur. */
export function SceauNimova({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className ?? "h-16 w-16"} aria-hidden focusable="false">
      <circle cx="32" cy="32" r="30" fill={FORET} />
      {CRANS.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={OR} strokeWidth=".9" />
      ))}
      {ANNEAUX.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={OR} strokeWidth=".55" />
      ))}
      <circle cx="32" cy="32" r="13.6" fill={FORET} />
      <g transform="translate(32 32) scale(.4) translate(-32 -32)">
        <TracePli encre="#f6f3ea" pli={PLI_CLAIR} />
      </g>
    </svg>
  );
}

/**
 * Cachet d'un document officiel (rapport mensuel, rapport de dossier) : le sceau, l'émetteur et la
 * date d'édition. Il s'imprime avec le document.
 */
export function CachetDocument({ emetteur, date, className }: { emetteur: string; date: string; className?: string }) {
  return (
    <div className={cx("cachet flex items-center gap-4 border-t border-line pt-5", className)}>
      <SceauNimova className="h-16 w-16 flex-none" />
      <div className="text-[12.5px] leading-snug text-muted">
        <div className="font-display text-[14px] font-bold tracking-[0.06em] text-ink">NIMOVA</div>
        Document établi pour {emetteur}, édité le {date}.
      </div>
    </div>
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
      <Monogramme tuile={false} clair={clair} className="h-10 w-10 flex-none" />
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
  cabinet: { complet: ["/brand/mb-axispro.png", "/brand/mb-axispro-blanc.png", 634, 152], embleme: ["/brand/mb-axispro-embleme.png", "/brand/mb-axispro-embleme-blanc.png", 134, 128], nom: "MB AxisPro" },
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
