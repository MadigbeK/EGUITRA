import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/AppShell";
import { isAppCode } from "@/lib/config";
import { requireUser } from "@/lib/server-api";
import { COOKIES } from "@/lib/session";
import { PasswordForm } from "./PasswordForm";

export const metadata: Metadata = { title: "Mot de passe" };

export default async function PasswordPage() {
  const fromCookie = (await cookies()).get(COOKIES.app)?.value;
  // Application de connexion (y compris Rotations) ; l'application mobile n'a pas de cadre : celui de la finance sert.
  const loginApp = isAppCode(fromCookie) ? fromCookie : "finance";
  const app = loginApp === "mobile" ? "finance" : loginApp;
  const me = await requireUser(app, { allowTemporaryPassword: true });
  return (
    <AppShell app={app} me={me}>
      <PasswordForm app={loginApp} required={me.password_change_required} />
    </AppShell>
  );
}
