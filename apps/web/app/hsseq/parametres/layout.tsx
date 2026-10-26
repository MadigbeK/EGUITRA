import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server-api";
import type { Profile } from "@/lib/types";

export const metadata: Metadata = { title: "Paramètres" };

/** Profils qui paramètrent sites, grilles et motifs (contrat, §2). */
const PARAMETRAGE: readonly Profile[] = ["admin", "hsseq"];

/**
 * Paramètres de NIMOVA · HSSEQ : l'administration et le Responsable HSSEQ seuls. Un autre profil de
 * l'application est ramené au cockpit, sans rien charger des paramètres.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("hsseq");
  if (!me.profiles.some((p) => PARAMETRAGE.includes(p))) redirect("/hsseq");
  return <>{children}</>;
}
