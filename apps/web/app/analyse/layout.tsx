import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: { absolute: "NIMOVA · Analyse", template: "%s · NIMOVA Analyse" } };

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("analyse");
  return (
    <AppShell app="analyse" me={me}>
      {children}
    </AppShell>
  );
}
