"use client";

import { PlanActions } from "@/components/axispro/PlanActions";
import { PageHeader } from "@/components/ui";

export default function ActionsPage() {
  return (
    <div>
      <PageHeader title="Plan d'actions" subtitle="Actions de tous les dossiers : écarts de la grille, conditions des comités, traitement des risques. Les comptes rendus des porteurs attendent ici la validation du cabinet." />
      <PlanActions />
    </div>
  );
}
