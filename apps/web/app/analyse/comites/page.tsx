import type { Metadata } from "next";
import { Comites } from "@/components/analyse/Comites";

export const metadata: Metadata = { title: "Qualité des décisions" };

export default function Page() {
  return <Comites />;
}
