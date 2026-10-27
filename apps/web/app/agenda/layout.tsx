import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: { absolute: "NIMOVA · Agenda", template: "%s · NIMOVA Agenda" } };

/** NIMOVA · Agenda : tous les comptes internes, les deux sociétés (un seul agenda par compte). */
export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("agenda");
  return (
    <AppShell app="agenda" me={me}>
      {children}
    </AppShell>
  );
}
