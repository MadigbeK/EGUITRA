import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PriseRendezVous } from "@/components/agenda/RendezVousPublic";

export const metadata: Metadata = { title: "Prise de rendez-vous", robots: { index: false, follow: false } };

/** Page publique d'un type de rendez-vous (sans compte). Introuvable tant que le service n'est pas ouvert. */
export default async function RendezVousPage({ params }: { params: Promise<{ cle: string }> }) {
  const { cle } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(cle)) notFound();
  return <PriseRendezVous cle={cle} />;
}
