"use client";

import { BudgetsVoyage } from "@/components/transport/documents/BudgetsVoyage";
import { PageHeader } from "@/components/ui";

export default function TransportBudgets() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets de voyage"
        subtitle="Approuvez, décaissez puis justifiez chaque budget ; ouvrez l'opération pour le détail."
      />
      <BudgetsVoyage />
    </div>
  );
}
