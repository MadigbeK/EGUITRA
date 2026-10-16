"use client";

import { PageErreur } from "@/components/PageErreur";

export default function Erreur({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageErreur
      code="Oups"
      titre="Cet écran n'a pas pu s'afficher"
      texte="Une erreur inattendue s'est produite. Réessayez ; si elle se reproduit, signalez-la avec l'heure et l'écran concerné."
      actions={
        <button type="button" onClick={reset} className="inline-flex min-h-10 items-center rounded-[10px] border border-line bg-panel px-4 text-sm font-semibold text-ink hover:bg-panel-2">
          Réessayer
        </button>
      }
    />
  );
}
