import { redirect } from "next/navigation";
import { DirectorDashboard } from "@/components/finance/TableauDeBord";
import { accueilFinance } from "@/lib/nav";
import { requireUser } from "@/lib/server-api";

/**
 * Accueil d'EGUITRA Finance : le tableau de bord du dirigeant, ou l'écran Achats et dépenses pour le
 * profil Achats seul, qui n'appelle ainsi jamais le tableau de bord (refusé par le noyau).
 */
export default async function Page() {
  const me = await requireUser("finance");
  const accueil = accueilFinance(me.profiles);
  if (accueil !== "/finance") redirect(accueil);
  return <DirectorDashboard />;
}
