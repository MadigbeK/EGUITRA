"use client";

import { useState } from "react";
import { PageErreur } from "@/components/PageErreur";
import { Button } from "@/components/ui";
import { appFromPath } from "@/lib/config";

/**
 * Écran qui n'a pas pu s'afficher. « Réessayer » redemande l'écran au serveur (retry : reset seul
 * réafficherait la même erreur). La coque n'étant plus là, la déconnexion est proposée ici : un
 * compte n'est jamais enfermé sur cette page.
 */
export default function Erreur({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [sortie, setSortie] = useState(false);

  async function deconnecter() {
    setSortie(true);
    const app = appFromPath(window.location.pathname) ?? "finance";
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = `/login?app=${app}`;
  }

  return (
    <PageErreur
      code="Erreur"
      titre="Cet écran n'a pas pu s'afficher"
      texte="Une erreur inattendue s'est produite, ou le service ne répond pas pour le moment. Réessayez ; si elle se reproduit, signalez-la avec l'heure et l'écran concerné."
      actions={
        <>
          <Button onClick={() => retry()}>Réessayer</Button>
          <Button variant="ghost" loading={sortie} onClick={() => void deconnecter()}>
            Se déconnecter
          </Button>
        </>
      }
    />
  );
}
