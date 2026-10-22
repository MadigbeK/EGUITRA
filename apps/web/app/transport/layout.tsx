import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: { absolute: "NIMOVA · Transport", template: "%s · NIMOVA Transport" } };

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("transport");
  return (
    <AppShell app="transport" me={me}>
      {children}
    </AppShell>
  );
}
