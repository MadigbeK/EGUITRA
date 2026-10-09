"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputSpotlightProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Erreur visible (border rouge + ring danger) */
  hasError?: boolean;
}

/**
 * Input « spotlight » avec halo orange capsule au hover/move, animé via GSAP.
 *
 * Inspiré du pattern Aceternity / Once UI, adapté à la palette EGUITRA Finance :
 *   • Bleu #3b82f6 → orange capsule oklch(72% 0.180 55)
 *   • Background → panel sombre dark theme (oklch(25% 0.035 250))
 *
 * À utiliser sur les inputs HÉRO seulement (login, first-login, search principale).
 * Pour les inputs dense (qty stepper catalogue, etc.), utiliser <Input> standard.
 */
function InputSpotlight({
  ref,
  className,
  type,
  hasError,
  ...props
}: InputSpotlightProps & { ref?: React.RefObject<HTMLInputElement | null> }) {
  const radius = 120; // rayon du halo
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const gradientRef = React.useRef<HTMLDivElement | null>(null);
  const [mousePosition, setMousePosition] = React.useState({ x: 0, y: 0 });

  // Couleur halo : orange capsule EGUITRA GROUP
  const haloColor = "oklch(72% 0.180 55)";

  useGSAP(
    () => {
      gsap.set(gradientRef.current, {
        background: `radial-gradient(0px circle at ${mousePosition.x}px ${mousePosition.y}px, ${haloColor}, transparent 80%)`,
      });
    },
    { scope: containerRef },
  );

  function handleMouseMove(e: React.MouseEvent) {
    if (!containerRef.current) return;
    const { left, top } = containerRef.current.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;
    setMousePosition({ x, y });
    gsap.to(gradientRef.current, {
      background: `radial-gradient(${radius}px circle at ${x}px ${y}px, ${haloColor}, transparent 80%)`,
      duration: 0.1,
    });
  }

  function handleMouseEnter(e: React.MouseEvent) {
    if (!containerRef.current) return;
    const { left, top } = containerRef.current.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;
    setMousePosition({ x, y });
    gsap.set(gradientRef.current, {
      background: `radial-gradient(0px circle at ${x}px ${y}px, ${haloColor}, transparent 80%)`,
    });
    gsap.to(gradientRef.current, {
      background: `radial-gradient(${radius}px circle at ${x}px ${y}px, ${haloColor}, transparent 80%)`,
      duration: 0.3,
    });
  }

  function handleMouseLeave() {
    gsap.to(gradientRef.current, {
      background: `radial-gradient(0px circle at ${mousePosition.x}px ${mousePosition.y}px, ${haloColor}, transparent 80%)`,
      duration: 0.3,
    });
  }

  return (
    <div
      ref={containerRef}
      className="group/input relative rounded-lg p-[2px] transition duration-300"
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={gradientRef}
        className="absolute inset-0 rounded-lg"
        aria-hidden="true"
      />

      <input
        ref={ref}
        type={type}
        aria-invalid={hasError || undefined}
        className={cn(
          "relative z-10 flex h-11 w-full rounded-md border-none px-3.5 py-2 text-sm transition-all duration-300",
          "bg-panel text-ink",
          "placeholder:text-ink-4",
          "shadow-[0px_0px_1px_1px_oklch(33%_0.030_250)]",
          "group-hover/input:shadow-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          hasError &&
            "shadow-[0px_0px_1px_1px_oklch(64%_0.180_25)] focus-visible:ring-danger",
          className,
        )}
        {...props}
      />
    </div>
  );
}
InputSpotlight.displayName = "InputSpotlight";

export { InputSpotlight };
