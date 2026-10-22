import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FournisseurMoi } from "@/components/axispro/moi";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: { absolute: "NIMOVA · MB AxisPro Consulting", template: "%s · MB AxisPro Consulting" } };

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("axispro");
  return (
    <AppShell app="axispro" me={me}>
      <FournisseurMoi moi={{ id: me.id, name: me.name, cabinet: me.profiles.includes("cabinet") }}>{children}</FournisseurMoi>
    </AppShell>
  );
}
