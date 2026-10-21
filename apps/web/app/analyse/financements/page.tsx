import type { Metadata } from "next";
import { Financements } from "@/components/analyse/Financements";

export const metadata: Metadata = { title: "Financements" };

export default function Page() {
  return <Financements />;
}
