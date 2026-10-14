import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("axispro");
  return (
    <AppShell app="axispro" me={me}>
      {children}
    </AppShell>
  );
}
