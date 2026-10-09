import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "info" | "success" | "warn" | "danger";

interface AlertProps {
  variant?: Variant;
  title?: string;
  children: ReactNode;
  className?: string;
}

const VARIANTS: Record<Variant, string> = {
  info: "border-line bg-bg-2 text-ink-2",
  success: "border-success/40 bg-success/10 text-ink-2",
  warn: "border-warn/50 bg-warn/10 text-ink-2",
  danger: "border-danger/50 bg-danger/10 text-ink-2",
};

const TITLE_COLOR: Record<Variant, string> = {
  info: "text-ink",
  success: "text-success-2",
  warn: "text-warn",
  danger: "text-danger",
};

export function Alert({ variant = "info", title, children, className }: AlertProps) {
  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-lg border border-l-4 px-4 py-3 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {title && (
        <p className={cn("mb-1 font-display font-semibold tracking-tight", TITLE_COLOR[variant])}>
          {title}
        </p>
      )}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
