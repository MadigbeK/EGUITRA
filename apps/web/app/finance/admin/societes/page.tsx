import type { Metadata } from "next";
import { CompaniesAdmin } from "@/components/admin/CompaniesAdmin";

export const metadata: Metadata = { title: "Sociétés" };

export default function Page() {
  return <CompaniesAdmin />;
}
