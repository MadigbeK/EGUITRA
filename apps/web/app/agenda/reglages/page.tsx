import type { Metadata } from "next";
import { Reglages } from "@/components/agenda/Reglages";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Réglages de l'agenda" };

export default function ReglagesPage() {
  return (
    <div>
      <PageHeader title="Réglages de l'agenda" subtitle="Heures de travail, rappels, absence du bureau, partages, délégations, lien d'abonnement, import et rendez-vous en ligne." />
      <Reglages />
    </div>
  );
}
