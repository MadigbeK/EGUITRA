import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DetailPaie } from "@/components/rh/Paie";

export const metadata: Metadata = { title: "Paie du mois" };

/** Paie d'un mois ; un identifiant qui n'est pas un entier mène à la page introuvable. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <DetailPaie id={id} />;
}
