import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: { absolute: "NIMOVA · Finance", template: "%s · NIMOVA Finance" } };

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("finance");
  return (
    <AppShell app="finance" me={me}>
      {children}
    </AppShell>
  );
}
