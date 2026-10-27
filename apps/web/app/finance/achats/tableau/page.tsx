import type { Metadata } from "next";
import { TableauAchats } from "@/components/commerce/Tableaux";

export const metadata: Metadata = { title: "Tableau de bord des achats" };

export default function Page() {
  return <TableauAchats />;
}
