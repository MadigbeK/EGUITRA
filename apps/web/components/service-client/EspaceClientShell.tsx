"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogOut } from "@/components/icons";
import { VeilleInactivite } from "@/components/shell/VeilleInactivite";
import { cx } from "@/components/ui";
import type { Me } from "@/lib/types";
import { ECHEC_DECONNEXION, fermerSession } from "@/lib/deconnexion";

/**
 * Cadre de l'espace client : sobre, sans la marque interne ni les outils des comptes internes (discussion,
 * agenda, lanceur). Le nom des sociétés dont le client suit les demandes, ses demandes, la nouvelle demande, la
 * déconnexion.
 */
export function EspaceClientShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const societes = me.companies.map((c) => c.name).join(" · ");
  async function deconnecter() {
    if (!(await fermerSession())) {
      window.alert(ECHEC_DECONNEXION);
      return;
    }
    window.location.href = "/login?app=espace-client";
  }
  const liens = [
    { href: "/espace-client", label: "Mes demandes" },
    { href: "/espace-client/nouvelle", label: "Nouvelle demande" },
    { href: "/compte/mot-de-passe", label: "Mot de passe" },
  ];
  return (
    <div data-app="espace-client" data-compte={me.login} className="min-h-screen bg-panel-2 text-ink">
      <VeilleInactivite app="espace-client" />
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="leading-tight">
            <span className="block font-display text-[18px] font-bold text-ink">Espace client</span>
            <span className="block text-[12.5px] text-muted">{societes}</span>
          </div>
          <nav className="flex flex-wrap items-center gap-1" aria-label="Espace client">
            {liens.map((l) => (
              <Link key={l.href} href={l.href} className={cx("rounded-lg px-3 py-2 text-[13.5px] font-semibold", pathname === l.href ? "bg-accent-doux text-accent" : "text-ink-2 hover:bg-panel-3")}>
                {l.label}
              </Link>
            ))}
            <span className="ml-2 hidden text-[13px] text-muted sm:inline">{me.name}</span>
            <button type="button" onClick={() => void deconnecter()} className="ml-1 inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-semibold text-ink-2 hover:bg-panel-3">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
