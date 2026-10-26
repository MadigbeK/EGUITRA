import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BulletinPaie } from "@/components/rh/Bulletin";

export const metadata: Metadata = { title: "Bulletin de paie" };

/** Bulletin de paie vu par la gestion RH (direction, administration, RH) ; identifiant entier exigé. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <BulletinPaie source={`/rh/payslips/${id}`} retour={{ href: "/rh/paie", label: "Paie" }} />;
}
