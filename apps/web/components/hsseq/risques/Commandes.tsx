"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Download, Plus } from "@/components/icons";
import { Button } from "@/components/ui";
import { aProfil, aujourdhui, requete, useAdresse, useReferentiels } from "@/components/hsseq/actions/outils";
import { apiDownload } from "@/lib/api-client";
import { lireFiltres, versApi } from "./adresse";
import { FenetreRisque } from "./FenetreRisque";
import { messageRisque } from "./libelles";

/**
 * Commandes de l'en-tête du registre : export Excel avec les filtres en cours (profils du cockpit,
 * pas l'auditeur) et création d'un risque (Responsable HSSEQ), ouvert ensuite dans sa fiche.
 */
export function CommandesRegistre() {
  const { lire, ecrire } = useAdresse();
  const { data: ref } = useReferentiels();
  const { mutate } = useSWRConfig();
  const [creer, setCreer] = useState(false);
  const [export_, setExport] = useState<{ envoi: boolean; erreur: string | null }>({ envoi: false, erreur: null });
  const exporter = aProfil(ref, "admin", "direction", "hsseq", "exploitation");
  // L'auditeur ne crée rien, même s'il porte un autre profil : le noyau lui refuse toute écriture.
  const creation = aProfil(ref, "hsseq") && !aProfil(ref, "auditeur");
  if (!exporter && !creation) return null;

  async function telecharger() {
    setExport({ envoi: true, erreur: null });
    try {
      await apiDownload(`/hsseq/risks/export.xlsx?${requete(versApi(lireFiltres(lire)))}`, `registre_risques_${aujourdhui()}.xlsx`);
      setExport({ envoi: false, erreur: null });
    } catch (e) {
      setExport({ envoi: false, erreur: messageRisque(e, "L'export n'a pas abouti.") });
    }
  }

  return (
    <>
      {exporter && (
        <Button loading={export_.envoi} onClick={() => void telecharger()}>
          <Download className="h-4 w-4" /> Exporter le registre
        </Button>
      )}
      {creation && (
        <Button variant="primary" onClick={() => setCreer(true)}>
          <Plus className="h-4 w-4" /> Nouveau risque
        </Button>
      )}
      {export_.erreur && (
        <p role="alert" className="w-full text-[12.5px] font-medium text-danger sm:text-right">
          {export_.erreur}
        </p>
      )}
      {creer && (
        <FenetreRisque
          onClose={() => setCreer(false)}
          onEnregistre={(r) => {
            setCreer(false);
            void mutate((k) => typeof k === "string" && (k.startsWith("/hsseq/risks?") || k.startsWith("/hsseq/risks/matrix")));
            ecrire({ risque: r.id });
          }}
        />
      )}
    </>
  );
}
