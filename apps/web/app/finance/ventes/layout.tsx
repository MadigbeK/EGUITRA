import type { ReactNode } from "react";
import { OngletsCommerce } from "@/components/commerce/OngletsCommerce";

/** Ventes : factures et avoirs, offres, commandes, catalogue, tableau de bord (achats et ventes). */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <OngletsCommerce espace="ventes" />
      {children}
    </>
  );
}
