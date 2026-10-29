import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Satisfaction } from "@/components/service-client/PagesPubliques";

export const metadata: Metadata = {
  title: { absolute: "Votre avis sur notre réponse" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Satisfaction demandée par courriel à la résolution d'un dossier : la note n'est enregistrée qu'à l'envoi. */
export default async function SatisfactionPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(jeton)) notFound();
  return <Satisfaction jeton={jeton} />;
}
