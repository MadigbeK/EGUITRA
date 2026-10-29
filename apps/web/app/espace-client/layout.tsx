import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EspaceClientShell } from "@/components/service-client/EspaceClientShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = {
  title: { absolute: "Espace client", template: "%s · Espace client" },
  description: "Espace client : vos demandes et réclamations, leur suivi et vos échanges avec le service client.",
  robots: { index: false, follow: false },
};

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("espace-client");
  return <EspaceClientShell me={me}>{children}</EspaceClientShell>;
}
