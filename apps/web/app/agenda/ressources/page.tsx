import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Ressources } from "@/components/agenda/Ressources";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: "Ressources" };

/** Ressources de l'agenda : réservées à l'administration (le noyau refuse les autres profils). */
export default async function RessourcesPage() {
  const me = await requireUser("agenda");
  if (!me.profiles.includes("admin")) redirect("/agenda");
  return (
    <div>
      <PageHeader title="Ressources" subtitle="Salles de réunion, véhicules de service et équipements, réservables par tous sans conflit possible." />
      <Ressources />
    </div>
  );
}
