import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClocheCabinet } from "@/components/axispro/ClocheCabinet";
import { FournisseurMoi } from "@/components/axispro/moi";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: { absolute: "NIMOVA · MB AxisPro Consulting", template: "%s · MB AxisPro Consulting" } };

/** Compte sans droit d'écriture sur les dossiers : la barre du haut le dit (section 5 du cahier AxisPro). */
function PuceLectureSeule() {
  return <span className="whitespace-nowrap text-[13px] text-muted">· lecture seule</span>;
}

export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireUser("axispro");
  return (
    <AppShell app="axispro" me={me} actions={<>{!me.profiles.includes("cabinet") && <PuceLectureSeule />}<ClocheCabinet /></>}>
      <FournisseurMoi moi={{ id: me.id, name: me.name, cabinet: me.profiles.includes("cabinet"), scelle: me.profiles.includes("associe") || (me.profiles.includes("direction") && !me.profiles.includes("admin")), associe: me.profiles.includes("associe") }}>{children}</FournisseurMoi>
    </AppShell>
  );
}
