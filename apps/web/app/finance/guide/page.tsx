"use client";

import { GuideIntegre } from "@/components/finance/GuideIntegre";
import { GUIDES } from "@/lib/guides";

/** Guide intégré de la finance : où saisir quoi, règles, rythme de travail, écrans (source : docs/guides/guide-finance.md). */
export default function GuidePage() {
  return (
    <GuideIntegre
      source={GUIDES.finance ?? ""}
      title="Guide de la finance"
      subtitle="Règles comptables et instructions de saisie : où saisir quoi, les règles à ne jamais enfreindre, le rythme de travail, chaque écran."
    />
  );
}
