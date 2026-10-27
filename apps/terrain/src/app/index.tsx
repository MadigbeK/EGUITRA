import { MaJournee } from "../accueil/MaJournee";
import { useSession } from "../auth/session";

/** Accueil : « Ma journée », les modules ouverts au compte et la file d'envoi. */
export default function Accueil() {
  const { etape } = useSession();
  if (etape.nom !== "ouverte") return null;
  return <MaJournee user={etape.user} />;
}
