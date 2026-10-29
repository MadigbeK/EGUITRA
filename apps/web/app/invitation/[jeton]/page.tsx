import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Invitation } from "@/components/service-client/PagesPubliques";

export const metadata: Metadata = {
  title: { absolute: "Espace client : votre mot de passe" },
  robots: { index: false, follow: false },
  // Le jeton de l'adresse ne part pas vers un autre site.
  referrer: "no-referrer",
};

/** Lien d'invitation à l'espace client (reçu par courriel) : rien n'est fait à l'ouverture, seulement à l'envoi du formulaire. */
export default async function InvitationPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(jeton)) notFound();
  return <Invitation jeton={jeton} />;
}
