import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DepotPublic } from "@/components/axispro/DepotPublic";

export const metadata: Metadata = {
  title: "Dépôt de pièces",
  robots: { index: false, follow: false },
  // Le jeton de l'adresse ne part pas vers un autre site.
  referrer: "no-referrer",
};

/** Lien reçu du cabinet : le promoteur dépose ses pièces sans compte (référence V2.0, AJ-02). */
export default async function DepotPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(jeton)) notFound();
  return <DepotPublic jeton={jeton} />;
}
