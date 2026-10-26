import { useLocalSearchParams } from "expo-router";
import { Garde } from "../accueil/Garde";
import { useSession } from "../auth/session";
import { Controle } from "../hsseq/Controle";

/** Contrôle avant départ. Le module n'ouvre qu'aux profils prévus (accueil/modules.ts) ; le noyau refuse le reste. */
export default function Ecran() {
  const { etape } = useSession();
  const { vehicule } = useLocalSearchParams<{ vehicule?: string }>();
  if (etape.nom !== "ouverte") return null;
  return (
    <Garde user={etape.user} module="controle">
      <Controle user={etape.user} vehiculeInitial={vehicule} />
    </Garde>
  );
}
