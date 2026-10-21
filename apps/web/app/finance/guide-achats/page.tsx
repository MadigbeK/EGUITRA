"use client";

import { GuideIntegre } from "@/components/finance/GuideIntegre";
import { GUIDES } from "@/lib/guides";

/** Guide intégré du profil Achats : engagements, pièces d'achat, fournisseurs, suivi (source : docs/guides/guide-achats.md). */
export default function PurchasesGuidePage() {
  return (
    <GuideIntegre
      source={GUIDES.achats ?? ""}
      title="Guide des achats"
      subtitle="Engager une dépense avant la commande, saisir la pièce du fournisseur par catégorie, la soumettre au circuit et suivre son état, tenir les fiches des fournisseurs."
    />
  );
}
