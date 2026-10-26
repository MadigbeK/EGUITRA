import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { isAppCode } from "@/lib/config";
import { requireUser } from "@/lib/server-api";
import { COOKIES } from "@/lib/session";

export const metadata: Metadata = { title: "Mes demandes" };

/**
 * « Mes demandes » : l'espace partagé de suivi des demandes adressées au support de la plateforme
 * (offre, chapitres 6.4, 7.2 et 7.4), hors des applications métier, dans le cadre de l'application de
 * connexion comme le changement du mot de passe. Les appels de ces pages ne portent pas d'en-tête
 * d'application (lib/api-client.ts : « compte » n'en est pas une) : la passerelle prend l'application
 * de la connexion et sa société de travail ; les routes /support/... n'exigent aucune application.
 * Un porteur de projet n'y a pas accès : il s'adresse à son consultant.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  const fromCookie = (await cookies()).get(COOKIES.app)?.value;
  const loginApp = isAppCode(fromCookie) ? fromCookie : "finance";
  // Rotations n'a pas de cadre : celui de la finance sert, comme pour le mot de passe.
  const app = loginApp === "mobile" ? "finance" : loginApp;
  const me = await requireUser(app);
  if (me.profiles.includes("porteur")) redirect("/acces-refuse");
  return (
    <AppShell app={app} me={me}>
      {children}
    </AppShell>
  );
}
