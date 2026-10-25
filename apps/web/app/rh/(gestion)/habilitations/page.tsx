import type { Metadata } from "next";
import { HabilitationsSecurite } from "@/components/rh/Securite";

export const metadata: Metadata = { title: "Habilitations et sécurité" };

export default function Page() {
  return <HabilitationsSecurite />;
}
