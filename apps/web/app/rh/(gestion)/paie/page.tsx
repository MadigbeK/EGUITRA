import type { Metadata } from "next";
import { ListePaies } from "@/components/rh/Paie";

export const metadata: Metadata = { title: "Paie" };

export default function Page() {
  return <ListePaies />;
}
