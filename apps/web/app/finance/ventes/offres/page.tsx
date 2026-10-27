import type { Metadata } from "next";
import { OffresPage } from "@/components/commerce/Offres";

export const metadata: Metadata = { title: "Offres commerciales" };

export default function Page() {
  return <OffresPage />;
}
