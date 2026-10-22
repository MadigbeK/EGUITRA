import type { Metadata } from "next";
import { GestionConges } from "@/components/rh/Conges";

export const metadata: Metadata = { title: "Absences et congés" };

export default function Page() {
  return <GestionConges />;
}
