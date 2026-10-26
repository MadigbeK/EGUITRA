import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { isAppCode } from "@/lib/config";
import { requireUser } from "@/lib/server-api";
import { COOKIES } from "@/lib/session";

export const metadata: Metadata = { title: "Discussion" };

/** Profils internes : la discussion leur est réservée (jamais le porteur de projet, ni un compte sans profil). */
const INTERNES = new Set(["admin", "direction", "finance", "achats", "exploitation", "chantiers", "immobilier", "cabinet", "rh"]);

/**
 * Discussion interne en pleine page (grand écran), hors des applications métier, dans le cadre de
 * l'application de connexion comme « Mes demandes ». Les appels ne portent pas d'en-tête d'application :
 * la passerelle prend l'application de la connexion ; les routes /chat/... n'en exigent aucune.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  const fromCookie = (await cookies()).get(COOKIES.app)?.value;
  const loginApp = isAppCode(fromCookie) ? fromCookie : "finance";
  // Rotations et le portail n'ont pas la discussion : le cadre de la finance sert, le noyau tranche.
  const app = loginApp === "mobile" || loginApp === "portail" ? "finance" : loginApp;
  const me = await requireUser(app);
  if (!me.profiles.some((p) => INTERNES.has(p))) redirect("/acces-refuse");
  return (
    <AppShell app={app} me={me}>
      {children}
    </AppShell>
  );
}
