import type { Metadata } from "next";
import { Portefeuille } from "@/components/analyse/Portefeuille";

export const metadata: Metadata = { title: "Projets et pipeline" };

export default function Page() {
  return <Portefeuille />;
}
