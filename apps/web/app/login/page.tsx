import type { Metadata } from "next";
import { headers } from "next/headers";
import { APPS, appFromHost, isAppCode } from "@/lib/config";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion" };

const MESSAGES: Record<string, string> = {
  app_forbidden: "Votre profil ne donne pas accès à cette application.",
  password_changed: "Mot de passe modifié. Reconnectez-vous avec le nouveau mot de passe.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const app = isAppCode(params.app) ? params.app : appFromHost((await headers()).get("host"));
  const next = params.next && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : APPS[app].home;
  const message = (params.error && MESSAGES[params.error]) || (params.message && MESSAGES[params.message]) || null;

  return (
    <div data-app={app} className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-ink">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-lg font-black text-accent-ink">
            {app === "axispro" || app === "portail" ? "AX" : "EG"}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{APPS[app].name}</h1>
          <p className="mt-1 text-sm text-muted">{APPS[app].tagline}</p>
        </div>
        <LoginForm app={app} next={next} message={message} />
        <p className="mt-8 text-center text-[11px] text-muted">
          Accès réservé. Connexions journalisées, double authentification obligatoire.
        </p>
      </div>
    </div>
  );
}
