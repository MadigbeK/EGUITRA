import type { Metadata } from "next";
import { Depenses } from "@/components/analyse/Depenses";

export const metadata: Metadata = { title: "Dépenses et contrôles" };

export default function Page() {
  return <Depenses />;
}
