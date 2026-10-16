import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

// Le portail est celui du cabinet : ni le nom ni le monogramme de la marque interne NIMOVA.
export const metadata: Metadata = {
  title: { default: "Portail des porteurs de projets · MB AxisPro Consulting", template: "%s · MB AxisPro Consulting" },
  icons: { icon: "/icons/portail.svg" },
};

export const viewport: Viewport = { themeColor: "#23364b" };

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("portail");
  return (
    <AppShell app="portail" me={me}>
      {children}
    </AppShell>
  );
}
