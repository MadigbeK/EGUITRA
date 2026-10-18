import type { Metadata } from "next";
import { Transport } from "@/components/analyse/Transport";

export const metadata: Metadata = { title: "Flotte et routes" };

export default function Page() {
  return <Transport />;
}
