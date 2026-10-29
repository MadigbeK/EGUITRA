"use client";

import { BudgetsVoyage } from "@/components/transport/documents/BudgetsVoyage";
import { PageHeader } from "@/components/ui";

export default function TransportBudgets() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets de voyage"
        subtitle="À approuver, à décaisser, à justifier, et les écarts entre budget et réel. Le détail se traite dans la fiche de l'opération."
      />
      <BudgetsVoyage />
    </div>
  );
}
