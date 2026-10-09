import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  // Primary = orange capsule (CTA principal pharma)
  primary:
    "bg-brand-orange text-brand-navy-deep font-bold hover:brightness-110 active:translate-y-px disabled:opacity-50",
  // Secondary = outline ghost-dark
  secondary:
    "border border-line text-ink-2 hover:bg-panel hover:text-ink hover:border-line-strong disabled:opacity-50",
  // Ghost = sans border, juste hover bg panel
  ghost:
    "text-ink-3 hover:bg-panel hover:text-ink disabled:opacity-50",
  // Danger = rouge solide
  danger:
    "bg-danger text-ink font-semibold hover:brightness-110 disabled:opacity-50",
  // Success = vert vif solide (validations)
  success:
    "bg-success text-brand-navy-deep font-bold hover:brightness-110 disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", loading, disabled, children, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded font-medium transition-all duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
          "disabled:cursor-not-allowed",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" opacity="0.25" />
            <path d="M21 12a9 9 0 0 1-9 9" />
          </svg>
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
