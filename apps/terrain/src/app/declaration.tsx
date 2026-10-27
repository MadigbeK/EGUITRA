import { Garde } from "../accueil/Garde";
import { useSession } from "../auth/session";
import { Declaration } from "../hsseq/Declaration";

/** Déclaration d'un événement. Le module n'ouvre qu'aux profils prévus (accueil/modules.ts) ; le noyau refuse le reste. */
export default function Ecran() {
  const { etape } = useSession();
  if (etape.nom !== "ouverte") return null;
  return (
    <Garde user={etape.user} module="declaration">
      <Declaration user={etape.user} />
    </Garde>
  );
}
