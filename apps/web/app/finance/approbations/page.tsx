import type { Metadata } from "next";
import { Approbations } from "@/components/finance/Approbations";

export const metadata: Metadata = { title: "À approuver" };

export default function ApprovalsPage() {
  return <Approbations mode="corbeille" />;
}
