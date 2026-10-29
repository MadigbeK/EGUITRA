import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: { absolute: "NIMOVA · Service client", template: "%s · NIMOVA Service client" } };

/** NIMOVA · Service client : demandes et réclamations des clients, chaque société ses dossiers. */
export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("service-client");
  return (
    <AppShell app="service-client" me={me}>
      {children}
    </AppShell>
  );
}
