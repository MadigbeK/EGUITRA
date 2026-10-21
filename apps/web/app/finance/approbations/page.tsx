import type { Metadata } from "next";
import { Approbations } from "@/components/finance/Approbations";

export const metadata: Metadata = { title: "À valider" };

export default function ApprovalsPage() {
  return <Approbations mode="corbeille" />;
}
