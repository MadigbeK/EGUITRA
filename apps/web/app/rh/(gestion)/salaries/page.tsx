import type { Metadata } from "next";
import { ListeSalaries } from "@/components/rh/Salaries";

export const metadata: Metadata = { title: "Salariés" };

export default function Page() {
  return <ListeSalaries />;
}
