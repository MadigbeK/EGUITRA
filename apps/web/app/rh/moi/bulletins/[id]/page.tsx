import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BulletinPaie } from "@/components/rh/Bulletin";

export const metadata: Metadata = { title: "Mon bulletin de paie" };

/** Bulletin de paie vu par le salarié lui-même (bulletins validés seulement) ; identifiant entier exigé. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <BulletinPaie source={`/rh/me/payslips/${id}`} retour={{ href: "/rh/moi", label: "Mon espace" }} />;
}
