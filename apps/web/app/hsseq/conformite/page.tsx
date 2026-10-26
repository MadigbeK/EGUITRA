"use client";

import { Suspense } from "react";
import { Conformite } from "@/components/hsseq/conformite/Conformite";
import { Loading, PageHeader } from "@/components/ui";

/** Audits et conformité de NIMOVA · HSSEQ (lot 2) : programme d'audits, constats, exigences, revue de direction. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Audits et conformité"
        subtitle="Programme d'audits et constats classés écart majeur, écart mineur ou observation, avec leurs actions ; registre des exigences légales, normatives et contractuelles des donneurs d'ordre, leur preuve et leur revue ; éléments de la revue de direction. Un audit ne se clôt qu'une fois chaque écart majeur couvert par une action."
      />
      <Suspense fallback={<Loading label="Chargement des audits…" />}>
        <Conformite />
      </Suspense>
    </div>
  );
}
