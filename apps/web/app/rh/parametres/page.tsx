import type { Metadata } from "next";
import { ParametresRh } from "@/components/rh/Parametres";

export const metadata: Metadata = { title: "Paramètres RH" };

export default function Page() {
  return <ParametresRh />;
}
