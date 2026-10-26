import { useLocalSearchParams } from "expo-router";
import { Garde } from "../accueil/Garde";
import { useSession } from "../auth/session";
import { Controle } from "../hsseq/Controle";

/** Contrôle avant départ. Le module n'ouvre qu'aux profils prévus (accueil/modules.ts) ; le noyau refuse le reste. */
export default function Ecran() {
  const { etape } = useSession();
  // Ouvert depuis un départ (motif V01) : l'ensemble et la rotation à contrôler, ou le contrôle
  // incomplet à compléter.
  const { vehicule, rotation, complement } = useLocalSearchParams<{ vehicule?: string; rotation?: string; complement?: string }>();
  if (etape.nom !== "ouverte") return null;
  return (
    <Garde user={etape.user} module="controle">
      <Controle user={etape.user} vehiculeInitial={vehicule} rotationInitiale={rotation} complementDe={complement} />
    </Garde>
  );
}
