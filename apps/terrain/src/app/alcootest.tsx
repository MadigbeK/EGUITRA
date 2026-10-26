import { useLocalSearchParams } from "expo-router";
import { Garde } from "../accueil/Garde";
import { useSession } from "../auth/session";
import { Alcootest } from "../hsseq/Alcootest";

/** Alcootest avant départ. Le module n'ouvre qu'aux profils prévus (accueil/modules.ts) ; le noyau refuse le reste. */
export default function Ecran() {
  const { etape } = useSession();
  // Ouvert depuis un départ (motif V03) : la rotation et son conducteur.
  const { rotation, conducteur } = useLocalSearchParams<{ rotation?: string; conducteur?: string }>();
  if (etape.nom !== "ouverte") return null;
  return (
    <Garde user={etape.user} module="alcootest">
      <Alcootest user={etape.user} rotationInitiale={rotation} conducteurInitial={conducteur} />
    </Garde>
  );
}
