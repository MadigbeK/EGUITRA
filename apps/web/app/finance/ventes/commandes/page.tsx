import type { Metadata } from "next";
import { OffresPage } from "@/components/commerce/Offres";

export const metadata: Metadata = { title: "Commandes des clients" };

export default function Page() {
  return <OffresPage commandes />;
}
