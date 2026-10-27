import { Garde } from "../accueil/Garde";
import { useSession } from "../auth/session";
import { NonConformites } from "../hsseq/NonConformites";

/** Non-conformités à lever. Le module n'ouvre qu'aux profils prévus (accueil/modules.ts) ; le noyau refuse le reste. */
export default function Ecran() {
  const { etape } = useSession();
  if (etape.nom !== "ouverte") return null;
  return (
    <Garde user={etape.user} module="nonconformites">
      <NonConformites user={etape.user} />
    </Garde>
  );
}
