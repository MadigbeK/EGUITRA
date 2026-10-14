import type { Metadata } from "next";
import { MovesPage } from "@/components/finance/MovesPage";

export const metadata: Metadata = { title: "Achats et dépenses" };

export default function PurchasesPage() {
  return <MovesPage kind="purchases" />;
}
