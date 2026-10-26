import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server-api";
import type { Profile } from "@/lib/types";

export const metadata: Metadata = { title: "Revue de direction" };

/** Profils qui lisent la revue de direction (REVIEW_READ du noyau, l'auditeur compris). */
const LECTEURS: readonly Profile[] = ["admin", "direction", "hsseq", "auditeur"];

/** Un autre profil de l'application est ramené au cockpit, sans rien charger. */
export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("hsseq");
  if (!me.profiles.some((p) => LECTEURS.includes(p))) redirect("/hsseq");
  return <>{children}</>;
}
