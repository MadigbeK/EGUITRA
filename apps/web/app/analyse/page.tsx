import type { Metadata } from "next";
import { Synthese } from "@/components/analyse/Synthese";

export const metadata: Metadata = { title: "Cockpit" };

/** Cockpit de la société de travail : celui du groupe ou celui du cabinet. */
export default function Page() {
  return <Synthese />;
}
