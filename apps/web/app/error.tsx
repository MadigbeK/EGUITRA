"use client";

import { PageErreur } from "@/components/PageErreur";
import { Button } from "@/components/ui";

export default function Erreur({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageErreur
      code="Erreur"
      titre="Cet écran n'a pas pu s'afficher"
      texte="Une erreur inattendue s'est produite. Réessayez ; si elle se reproduit, signalez-la avec l'heure et l'écran concerné."
      actions={
        <Button onClick={reset}>Réessayer</Button>
      }
    />
  );
}
