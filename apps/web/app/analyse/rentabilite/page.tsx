import type { Metadata } from "next";
import { Rentabilite } from "@/components/analyse/Rentabilite";

export const metadata: Metadata = { title: "Rentabilité" };

export default function Page() {
  return <Rentabilite />;
}
