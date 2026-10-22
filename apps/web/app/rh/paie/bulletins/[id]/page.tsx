"use client";

import { use } from "react";
import { BulletinPaie } from "@/components/rh/Bulletin";

/** Bulletin de paie vu par la gestion RH (direction, administration, RH). */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BulletinPaie source={`/rh/payslips/${id}`} retour={{ href: "/rh/paie", label: "Paie" }} />;
}
