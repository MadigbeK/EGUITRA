"use client";

import { use } from "react";
import { FicheSalarie } from "@/components/rh/FicheSalarie";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <FicheSalarie id={id} />;
}
