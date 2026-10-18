import type { Metadata } from "next";
import { Activite } from "@/components/analyse/Activite";

export const metadata: Metadata = { title: "Activité et honoraires" };

export default function Page() {
  return <Activite />;
}
