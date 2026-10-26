"use client";

import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";
import { classesBouton } from "@/components/ui";
import { SyntheseRevues } from "@/components/hsseq/revues/Synthese";
import type { VueProps } from "./commun";

/**
 * Onglet « Revue de direction » de l'écran « Audits et conformité » : la revue de direction se tient
 * désormais dans son propre écran (/hsseq/revues, lot 3), où le noyau en rassemble les éléments
 * d'entrée (dont le programme d'audits, les constats et les exigences de cet écran), et où se prennent
 * ses décisions. L'onglet en garde la synthèse : prochaine revue, dernière revue tenue, décisions en cours
 * de mise en œuvre. Les propriétés de vue (adresse, droits) ne lui servent plus.
 */
export function RevueDirection(_props: VueProps) {
  return (
    <div className="space-y-5">
      <p className="max-w-[90ch] text-[13.5px] leading-relaxed text-ink-2">
        La revue de direction se tient dans son propre écran&nbsp;: NIMOVA y rassemble ses éléments d&apos;entrée, dont le programme d&apos;audits, les constats et le registre des exigences, la direction y inscrit ses décisions, chacune suivie au plan d&apos;actions, et le compte rendu se télécharge en PDF.
      </p>
      <SyntheseRevues />
      <Link href="/hsseq/revues" className={classesBouton("primary")}>
        Ouvrir la revue de direction <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
