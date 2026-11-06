import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { PortailShell } from "@/components/portail/PortailShell";
import { EspaceClientShell } from "@/components/service-client/EspaceClientShell";
import { AppShell } from "@/components/shell/AppShell";
import { isAppCode } from "@/lib/config";
import { requireUser } from "@/lib/server-api";
import { COOKIES } from "@/lib/session";
import { PasswordForm } from "./PasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  // Un porteur de projet reste chez MB AxisPro Consulting : pas de marque interne dans l'onglet.
  const fromCookie = (await cookies()).get(COOKIES.app)?.value;
  if (fromCookie === "portail") return { title: { absolute: "Mot de passe · MB AxisPro Consulting" }, description: "Portail des porteurs de projets de MB AxisPro Consulting : dossier, pièces et échanges avec le cabinet.", icons: { icon: "/icons/portail.svg" } };
  if (fromCookie === "espace-client") return { title: { absolute: "Mot de passe · Espace client" } };
  return { title: "Mot de passe" };
}

export async function generateViewport(): Promise<Viewport> {
  const fromCookie = (await cookies()).get(COOKIES.app)?.value;
  return { themeColor: fromCookie === "portail" ? "#23364b" : "#142f29" };
}

export default async function PasswordPage() {
  const fromCookie = (await cookies()).get(COOKIES.app)?.value;
  // Application de connexion (y compris Rotations) ; l'application mobile n'a pas de cadre : celui de la finance sert.
  // Le compte est lu sous l'application de connexion : une session de Rotations change ici son mot de passe.
  const loginApp = isAppCode(fromCookie) ? fromCookie : "finance";
  const app = loginApp === "mobile" ? "finance" : loginApp;
  const me = await requireUser(loginApp, { allowTemporaryPassword: true });
  // Un compte extérieur reste dans son espace, jamais dans la coque des comptes internes.
  if (app === "espace-client") {
    return (
      <EspaceClientShell me={me}>
        <PasswordForm app={loginApp} required={me.password_change_required} />
      </EspaceClientShell>
    );
  }
  // Portail : mot de passe provisoire, son dossier reste fermé (le cadre n'afficherait que ce refus) ; la
  // coque garde alors sa présentation du portail, sans rien d'interne.
  if (app === "portail" && !me.password_change_required) {
    return (
      <Suspense>
        <PortailShell me={me}>
          <PasswordForm app={loginApp} />
        </PortailShell>
      </Suspense>
    );
  }
  return (
    <AppShell app={app} me={me}>
      <PasswordForm app={loginApp} required={me.password_change_required} />
    </AppShell>
  );
}
