import { Garde } from "../accueil/Garde";
import { useSession } from "../auth/session";
import { Dossier } from "../hsseq/Dossier";

/** Habilitations et aptitude du conducteur. Le module n'ouvre qu'aux profils prévus (accueil/modules.ts). */
export default function Ecran() {
  const { etape } = useSession();
  if (etape.nom !== "ouverte") return null;
  return (
    <Garde user={etape.user} module="dossier">
      <Dossier />
    </Garde>
  );
}
