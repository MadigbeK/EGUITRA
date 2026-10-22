"use client";

import { use } from "react";
import { DetailPaie } from "@/components/rh/Paie";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DetailPaie id={id} />;
}
