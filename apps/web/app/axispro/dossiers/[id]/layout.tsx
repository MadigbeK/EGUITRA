import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Dossier de projet" };

/** Un identifiant qui n'est pas un entier ne mène à aucun dossier : page introuvable, sans appel au noyau. */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  return children;
}
