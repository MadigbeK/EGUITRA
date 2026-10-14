import type { Metadata } from "next";
import { MovesPage } from "@/components/finance/MovesPage";

export const metadata: Metadata = { title: "Ventes" };

export default function SalesPage() {
  return <MovesPage kind="sales" />;
}
