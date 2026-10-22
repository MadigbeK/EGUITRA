import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { TableauDeBordRh } from "@/components/rh/TableauDeBord";
import { accueilRh } from "@/lib/nav";
import { requireUser } from "@/lib/server-api";

/**
 * Accueil de NIMOVA · RH : le tableau de bord pour la gestion ; un compte en libre-service (dossier
 * salarié lié, sans profil de gestion) va à « Mon espace », sans jamais appeler le tableau de bord.
 */
export default async function Page() {
  const me = await requireUser("rh");
  const accueil = accueilRh(me.profiles);
  if (accueil !== "/rh") redirect(accueil);
  return (
    <div>
      <PageHeader title="Ressources humaines" subtitle="Effectif, échéances à traiter, absences, masse salariale et paie du mois de la société de travail." />
      <TableauDeBordRh />
    </div>
  );
}
