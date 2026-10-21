import type { Metadata } from "next";
import { Diagnostic } from "@/components/analyse/Diagnostic";

export const metadata: Metadata = { title: "Diagnostic des projets" };

export default function Page() {
  return <Diagnostic />;
}
