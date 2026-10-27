import type { ReactNode } from "react";
import { OngletsCommerce } from "@/components/commerce/OngletsCommerce";

/** Achats et dépenses : pièces d'achat, bons de commande, catalogue, tableau de bord des achats. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <OngletsCommerce espace="achats" />
      {children}
    </>
  );
}
