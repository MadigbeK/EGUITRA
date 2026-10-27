"use client";

import { Suspense } from "react";
import { Agenda } from "@/components/agenda/Agenda";
import { Loading } from "@/components/ui";

/** Planning d'équipe : disponibilités des collègues et des ressources, en lecture seule. */
export default function PlanningPage() {
  return (
    <Suspense fallback={<Loading label="Chargement du planning…" />}>
      <Agenda vueInitiale="planning" />
    </Suspense>
  );
}
