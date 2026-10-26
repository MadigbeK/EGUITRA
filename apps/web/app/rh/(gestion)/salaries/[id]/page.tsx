import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FicheSalarie } from "@/components/rh/FicheSalarie";

export const metadata: Metadata = { title: "Dossier salarié" };

/** Dossier d'un salarié ; un identifiant qui n'est pas un entier mène à la page introuvable. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <FicheSalarie id={id} />;
}
