import { cn } from "@/lib/utils";

interface BrandProps {
  /** Affichage compact : mark + wordmark seulement (sans tagline) */
  compact?: boolean;
  /** Taille du mark (38 par défaut, 32 compact) */
  size?: "sm" | "md" | "lg";
  /** Tagline custom (defaults to "Pharma · Conakry · depuis 1985") */
  tagline?: string;
  /** Couleur de la tagline ("muted" = ink-4, "orange" = brand-orange, "green" = green-vif) */
  taglineTone?: "muted" | "orange" | "green";
  className?: string;
}

const MARK_SIZES: Record<NonNullable<BrandProps["size"]>, string> = {
  sm: "w-8 h-8",
  md: "w-9 h-9",
  lg: "w-12 h-12",
};

const WORDMARK_SIZES: Record<NonNullable<BrandProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
};

const TAGLINE_TONE: Record<NonNullable<BrandProps["taglineTone"]>, string> = {
  muted: "text-ink-4",
  orange: "text-brand-orange",
  green: "text-brand-green-vif",
};

export function Brand({
  compact = false,
  size = "md",
  tagline = "Finance · Conakry",
  taglineTone = "muted",
  className,
}: BrandProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className={cn("brand-mark", MARK_SIZES[size])} aria-hidden="true" />
      <div className="flex flex-col leading-none">
        <span
          className={cn(
            "font-display font-bold tracking-tight text-ink",
            WORDMARK_SIZES[size],
          )}
        >
          EGUITRA <span className="text-brand-green-vif">Finance</span>
        </span>
        {!compact && (
          <span
            className={cn(
              "mt-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider",
              TAGLINE_TONE[taglineTone],
            )}
          >
            {tagline.split("·").map((part, i, arr) => (
              <span key={i}>
                {part.trim()}
                {i < arr.length - 1 && (
                  <span className="mx-1 text-brand-orange">●</span>
                )}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
