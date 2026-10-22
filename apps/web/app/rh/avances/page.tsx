import type { Metadata } from "next";
import { AvancesPrets } from "@/components/rh/Avances";

export const metadata: Metadata = { title: "Avances et prêts" };

export default function Page() {
  return <AvancesPrets />;
}
