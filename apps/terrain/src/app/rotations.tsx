import { useRouter } from "expo-router";
import { Garde } from "../accueil/Garde";
import { useSession } from "../auth/session";
import { RotationsEcran } from "../rotations/RotationsEcran";

/** Rotations : saisie au parc, file d'envoi. Le module n'ouvre qu'aux profils prévus (accueil/modules.ts) ; le noyau refuse le reste. */
export default function Ecran() {
  const { etape } = useSession();
  const router = useRouter();
  if (etape.nom !== "ouverte") return null;
  return (
    <Garde user={etape.user} module="rotations">
      <RotationsEcran user={etape.user} onRetour={() => router.back()} />
    </Garde>
  );
}
