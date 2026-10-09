"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogIn } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { InputSpotlight } from "@/components/ui/input-spotlight";
import { Label } from "@/components/ui/label";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Identifiant ou mot de passe incorrect.",
  account_disabled: "Ce compte est désactivé. Contactez votre administrateur.",
  must_change_pwd:
    "Vous devez activer votre compte. Cliquez sur le lien d'invitation reçu, ou demandez-en un nouveau.",
  rate_limited: "Trop de tentatives. Patientez 15 minutes avant de réessayer.",
  no_access_cookie: "Session expirée — veuillez vous reconnecter.",
  missing_credentials: "Identifiant et mot de passe requis.",
};

export function LoginForm({ nextUrl, reason }: { nextUrl: string; reason?: string }) {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    reason ? (ERROR_MESSAGES[reason] ?? reason) : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };

      if (!res.ok) {
        const code = data.detail ?? "unknown_error";
        setError(ERROR_MESSAGES[code] ?? `Erreur : ${code}`);
        setSubmitting(false);
        return;
      }
      router.push(nextUrl);
      router.refresh();
    } catch {
      setError("Erreur réseau — vérifiez votre connexion.");
      setSubmitting(false);
    }
  }

  return (
    <Card className="shadow-soft">
      <CardHeader>
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-green-vif to-brand-green-deep text-brand-navy-deep shadow-[0_0_0_4px_oklch(60%_0.180_145_/_.12)]">
          <LogIn className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <CardTitle>
          Espace <span className="text-brand-green-vif">Client</span>
        </CardTitle>
        <CardDescription>
          Accédez à votre espace pharmacie sécurisé.
        </CardDescription>
      </CardHeader>

      <form onSubmit={onSubmit} noValidate>
        <CardBody className="space-y-5">
          {error && (
            <Alert variant="danger" title="Connexion impossible">
              {error}
            </Alert>
          )}

          <div>
            <Label htmlFor="login">Identifiant</Label>
            <InputSpotlight
              id="login"
              name="login"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="email ou pseudo (ex : ph-c712)"
              disabled={submitting}
            />
          </div>

          <div>
            <Label htmlFor="password">Mot de passe</Label>
            <InputSpotlight
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={submitting}
            />
          </div>
        </CardBody>

        <CardFooter className="flex items-center justify-between gap-3">
          <a
            href="/aide/connexion"
            className="text-xs text-ink-3 hover:text-ink hover:underline"
          >
            Mot de passe oublié ?
          </a>
          <Button type="submit" loading={submitting} size="md">
            Se connecter
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
