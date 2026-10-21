"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { Monogramme } from "@/components/brand";
import { APPS, appFromPath } from "@/lib/config";

/**
 * Page d'incident (adresse inconnue, erreur d'un écran) : la route qui s'interrompt, un titre
 * clair, ce que l'on peut faire. Le lien ramène à l'accueil de l'application ouverte.
 */
export function PageErreur({ code, titre, texte, actions }: { code: string; titre: string; texte: string; actions?: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const app = appFromPath(pathname) ?? "finance";
  return (
    <div data-app={app} className="flex min-h-[70vh] items-center justify-center px-5 py-16">
      <div className="w-full max-w-[520px] text-center">
        <Monogramme tuile={false} className="n-entree mx-auto h-14 w-14" />
        <svg viewBox="0 0 320 70" className="mx-auto mt-8 w-full max-w-[320px]" aria-hidden focusable="false">
          <path d="M10 52 C70 52 90 18 160 22 S240 44 250 40" fill="none" stroke="var(--line-strong)" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" pathLength={1} className="n-tracer" style={{ "--retard": "200ms" } as CSSProperties} />
          <circle cx="10" cy="52" r="7" fill="var(--panel)" stroke="var(--accent-vif)" strokeWidth="3" />
          <path d="M262 18v34M262 20h26l-7 7 7 7h-26" fill="var(--n-or)" stroke="var(--n-or)" strokeWidth="2.5" strokeLinejoin="round" className="n-apparaitre" style={{ animationDelay: "1300ms" }} />
        </svg>
        <p className="n-entree mt-6 font-display text-[64px] font-bold leading-none tracking-[-0.03em] text-accent" style={{ "--i": 2 } as CSSProperties}>
          {code}
        </p>
        <h1 className="n-entree mt-3 text-[24px] font-bold text-ink" style={{ "--i": 3 } as CSSProperties}>
          {titre}
        </h1>
        <p className="n-entree mx-auto mt-2 max-w-[42ch] text-sm leading-relaxed text-muted" style={{ "--i": 4 } as CSSProperties}>
          {texte}
        </p>
        <div className="n-entree mt-7 flex flex-wrap justify-center gap-2" style={{ "--i": 5 } as CSSProperties}>
          {actions}
          <Link href={APPS[app].home} className="n-degrade inline-flex min-h-10 items-center rounded-[10px] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_-10px_var(--accent-lueur)] transition hover:brightness-[1.07]">
            Revenir à l&apos;accueil de {APPS[app].name.replace("NIMOVA · ", "")}
          </Link>
        </div>
      </div>
    </div>
  );
}
