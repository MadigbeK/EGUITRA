"use client";

import { Financements } from "@/components/axispro/Financements";
import { PageHeader } from "@/components/ui";

export default function FinancementsPage() {
  return (
    <div>
      <PageHeader title="Financements" subtitle="Démarches auprès des banques, fonds et investisseurs, par étape, avec les relances à venir." />
      <Financements />
    </div>
  );
}
