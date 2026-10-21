import type { Metadata } from "next";
import { Clients } from "@/components/analyse/Clients";

export const metadata: Metadata = { title: "Portefeuille clients" };

export default function Page() {
  return <Clients />;
}
