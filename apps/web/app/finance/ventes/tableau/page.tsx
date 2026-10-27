import type { Metadata } from "next";
import { TableauVentes } from "@/components/commerce/Tableaux";

export const metadata: Metadata = { title: "Tableau de bord des ventes" };

export default function Page() {
  return <TableauVentes />;
}
