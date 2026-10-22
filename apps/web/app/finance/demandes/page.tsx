import type { Metadata } from "next";
import { Approbations } from "@/components/finance/Approbations";

export const metadata: Metadata = { title: "Mes demandes" };

/** Profil Achats : ses pièces d'achat et engagements soumis au circuit, et leur état. */
export default function RequestsPage() {
  return <Approbations mode="demandes" />;
}
