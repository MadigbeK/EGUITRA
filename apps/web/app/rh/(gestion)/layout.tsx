import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { accueilRh } from "@/lib/nav";
import { requireUser } from "@/lib/server-api";

/**
 * Écrans de gestion de NIMOVA · RH (salariés, absences, avances, paie, simulateur, paramètres) : un
 * compte en libre-service (dossier salarié lié, sans profil de gestion) est renvoyé vers « Mon espace »
 * au lieu d'un écran refusé par l'API.
 */
export default async function GestionLayout({ children }: { children: ReactNode }) {
  const me = await requireUser("rh");
  const accueil = accueilRh(me.profiles);
  if (accueil !== "/rh") redirect(accueil);
  return <>{children}</>;
}
