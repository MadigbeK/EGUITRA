"use client";

import { GuideIntegre } from "@/components/finance/GuideIntegre";
import { Card, Empty, PageHeader } from "@/components/ui";
import { GUIDES } from "@/lib/guides";

/** Guide intégré de l'espace RH (source : docs/guides/guide-rh.md, recopiée par docs/guides/web.js). */
export default function GuideRhPage() {
  const source = GUIDES.rh ?? "";
  if (!source.trim())
    return (
      <div>
        <PageHeader title="Guide RH" />
        <Card>
          <Empty title="Le guide RH n'est pas encore publié" hint="Il décrira la tenue des dossiers, les absences, la préparation de la paie et « Mon espace »." />
        </Card>
      </div>
    );
  return (
    <GuideIntegre
      source={source}
      title="Guide RH"
      subtitle="Tenir les dossiers du personnel, gérer les absences et les congés, préparer, contrôler et valider la paie, et utiliser « Mon espace »."
    />
  );
}
