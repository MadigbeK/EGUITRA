import type { Metadata } from "next";
import { SimulateurSalaire } from "@/components/rh/Simulateur";

export const metadata: Metadata = { title: "Simulateur de salaire" };

export default function Page() {
  return <SimulateurSalaire />;
}
