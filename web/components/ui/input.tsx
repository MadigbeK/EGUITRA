import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, hasError, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded border bg-panel px-3 text-base text-ink",
          "placeholder:text-ink-4",
          "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg focus:ring-brand-orange",
          "disabled:cursor-not-allowed disabled:bg-bg-2 disabled:text-ink-4",
          "transition-shadow",
          hasError
            ? "border-danger focus:ring-danger"
            : "border-line hover:border-line-strong",
          className,
        )}
        aria-invalid={hasError || undefined}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
