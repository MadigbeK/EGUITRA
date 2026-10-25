import { useSession } from "../auth/session";
import { RotationsEcran } from "../rotations/RotationsEcran";

/** Accueil : Rotations, seul module du socle. Les modules HSSEQ viendront à côté. */
export default function Accueil() {
  const { etape } = useSession();
  if (etape.nom !== "ouverte") return null;
  // Un autre compte repart d'un écran vierge.
  return <RotationsEcran key={etape.user.id} user={etape.user} />;
}
