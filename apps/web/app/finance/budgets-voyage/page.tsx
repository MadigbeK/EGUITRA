"use client";

import { BudgetsVoyage } from "@/components/transport/documents/BudgetsVoyage";
import { Notice, PageHeader } from "@/components/ui";

/** Côté caisse : avances à décaisser et budgets à justifier (transport d'EGUITRA GROUP SARLU). */
export default function FinanceBudgetsVoyage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets de voyage"
        subtitle="Avances de frais de route à décaisser par la caisse, justifications et clôtures à faire."
      />
      <Notice tone="accent">Transport d'EGUITRA GROUP SARLU : choisissez cette société en haut de l'écran. Décaissement, justification et clôture se font dans la fiche de l'opération.</Notice>
      <BudgetsVoyage vues={["to_disburse", "to_justify", "to_approve", "variances"]} initiale="to_disburse" />
    </div>
  );
}
