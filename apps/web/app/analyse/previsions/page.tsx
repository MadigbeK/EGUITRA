import type { Metadata } from "next";
import { Previsions } from "@/components/analyse/Previsions";

export const metadata: Metadata = { title: "Atterrissage et simulateur" };

export default function Page() {
  return <Previsions />;
}
