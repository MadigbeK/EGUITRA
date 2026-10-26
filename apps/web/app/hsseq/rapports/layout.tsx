import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server-api";
import type { Profile } from "@/lib/types";

export const metadata: Metadata = { title: "Rapport mensuel" };

/** Profils qui lisent le rapport mensuel HSSE (REPORT_READ du noyau). */
const LECTEURS: readonly Profile[] = ["admin", "direction", "hsseq"];

/** Un autre profil de l'application est ramené au cockpit, sans rien charger. */
export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("hsseq");
  if (!me.profiles.some((p) => LECTEURS.includes(p))) redirect("/hsseq");
  return <>{children}</>;
}
