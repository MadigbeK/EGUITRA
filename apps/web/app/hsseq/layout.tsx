import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: { absolute: "NIMOVA · HSSEQ", template: "%s · NIMOVA HSSEQ" } };

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("hsseq");
  return (
    <AppShell app="hsseq" me={me}>
      {children}
    </AppShell>
  );
}
