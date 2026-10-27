import type { Metadata } from "next";
import { CataloguePage } from "@/components/commerce/Catalogue";

export const metadata: Metadata = { title: "Catalogue" };

export default function Page() {
  return <CataloguePage />;
}
