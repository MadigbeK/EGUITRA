"use client";

import { Suspense } from "react";
import { Agenda } from "@/components/agenda/Agenda";
import { Loading } from "@/components/ui";

/** Mon agenda : jour, semaine, semaine de travail, mois, liste et planning d'équipe. */
export default function AgendaPage() {
  return (
    <Suspense fallback={<Loading label="Chargement de l'agenda…" />}>
      <Agenda />
    </Suspense>
  );
}
