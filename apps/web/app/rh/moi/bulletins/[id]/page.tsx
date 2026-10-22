"use client";

import { use } from "react";
import { BulletinPaie } from "@/components/rh/Bulletin";

/** Bulletin de paie vu par le salarié lui-même (bulletins validés seulement). */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BulletinPaie source={`/rh/me/payslips/${id}`} retour={{ href: "/rh/moi", label: "Mon espace" }} />;
}
