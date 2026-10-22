import type { Metadata } from "next";
import { MonEspace } from "@/components/rh/MonEspace";

export const metadata: Metadata = { title: "Mon espace" };

export default function Page() {
  return <MonEspace />;
}
