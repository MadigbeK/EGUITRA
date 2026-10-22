import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import { PortailShell } from "@/components/portail/PortailShell";
import { requireUser } from "@/lib/server-api";

// Le portail est celui du cabinet : ni le nom ni le monogramme de la marque interne NIMOVA.
export const metadata: Metadata = {
  title: { absolute: "Portail des porteurs de projets · MB AxisPro", template: "%s · MB AxisPro" },
  description: "Portail des porteurs de projets de MB AxisPro : dossier, pièces, messagerie, rendez-vous, conseils et événements du cabinet.",
  icons: { icon: "/icons/portail.svg" },
};

export const viewport: Viewport = { themeColor: "#23364b" };

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("portail");
  return (
    <Suspense>
      <PortailShell me={me}>{children}</PortailShell>
    </Suspense>
  );
}
