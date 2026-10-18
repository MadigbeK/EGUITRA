import type { Metadata } from "next";
import { Fiabilite } from "@/components/analyse/Fiabilite";

export const metadata: Metadata = { title: "Fiabilité des données" };

export default function Page() {
  return <Fiabilite />;
}
