import { redirect } from "next/navigation";
import { DirectorDashboard } from "@/components/finance/TableauDeBord";
import { accueilFinance } from "@/lib/nav";
import { requireUser } from "@/lib/server-api";

/**
 * Accueil d'EGUITRA Finance : le tableau de bord du dirigeant, ou le premier écran utile d'un compte
 * sans profil de la finance (Achats, BTP, Immobilier, Engagements de dépense), qui n'appelle ainsi jamais
 * le tableau de bord (refusé par le noyau).
 */
export default async function Page() {
  const me = await requireUser("finance");
  const accueil = accueilFinance(me.profiles, me.companies.find((c) => c.id === me.company_id)?.entity);
  if (accueil !== "/finance") redirect(accueil);
  return <DirectorDashboard />;
}
