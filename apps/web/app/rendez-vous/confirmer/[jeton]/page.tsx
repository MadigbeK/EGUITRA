import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfirmationRendezVous } from "@/components/agenda/RendezVousPublic";

export const metadata: Metadata = {
  title: "Confirmer un rendez-vous",
  robots: { index: false, follow: false },
  // Le jeton de l'adresse ne part pas vers un autre site.
  referrer: "no-referrer",
};

/** Lien reçu par courriel : la confirmation n'a lieu qu'au clic sur le bouton (jamais à l'ouverture). */
export default async function ConfirmerRendezVousPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(jeton)) notFound();
  return <ConfirmationRendezVous jeton={jeton} />;
}
