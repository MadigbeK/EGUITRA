import type { Metadata } from "next";
import { BonsCommandePage } from "@/components/commerce/BonsCommande";

export const metadata: Metadata = { title: "Bons de commande" };

export default function Page() {
  return <BonsCommandePage />;
}
