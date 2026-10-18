import type { Metadata } from "next";
import { Tresorerie } from "@/components/analyse/Tresorerie";

export const metadata: Metadata = { title: "Trésorerie et prévision" };

export default function Page() {
  return <Tresorerie />;
}
