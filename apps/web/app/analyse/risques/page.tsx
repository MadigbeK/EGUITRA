import type { Metadata } from "next";
import { Risques } from "@/components/analyse/Risques";

export const metadata: Metadata = { title: "Risques et exécution" };

export default function Page() {
  return <Risques />;
}
