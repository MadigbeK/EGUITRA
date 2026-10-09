"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InputSpotlight } from "@/components/ui/input-spotlight";
import { Label } from "@/components/ui/label";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_invitation: "Ce lien d'invitation est invalide ou a déjà été utilisé.",
  invitation_expired: "Ce lien d'invitation a expiré. Demande un nouveau à ton admin.",
  password_too_short: "Le mot de passe doit faire au moins 12 caractères.",
  missing_fields: "Tous les champs sont requis.",
};

function passwordStrength(p: string): { score: number; label: string } {
  let score = 0;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  const labels = ["Trop court", "Faible", "Moyen", "Bon", "Excellent"];
  const clamped = Math.min(Math.max(score, 0), labels.length - 1);
  return { score, label: labels[clamped]! };
}

export function FirstLoginForm({ initialToken }: { initialToken: string }) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError(ERROR_MESSAGES.password_too_short!);
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/first-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitation_token: token, new_password: password }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };

      if (!res.ok) {
        const code = data.detail ?? "unknown_error";
        setError(ERROR_MESSAGES[code] ?? `Erreur : ${code}`);
        setSubmitting(false);
        return;
      }
      router.push("/finance");
      router.refresh();
    } catch {
      setError("Erreur réseau — vérifiez votre connexion.");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activer mon compte</CardTitle>
        <CardDescription>
          Choisis un mot de passe robuste (≥ 12 caractères). Tu l'utiliseras à chaque connexion.
        </CardDescription>
      </CardHeader>

      <form onSubmit={onSubmit} noValidate>
        <CardBody className="space-y-4">
          {error && (
            <Alert variant="danger" title="Activation impossible">
              {error}
            </Alert>
          )}

          <div>
            <Label htmlFor="token">Token d'invitation</Label>
            <InputSpotlight
              id="token"
              name="invitation_token"
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Reçu par WhatsApp ou email"
              disabled={submitting}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div>
            <Label htmlFor="password">Nouveau mot de passe</Label>
            <InputSpotlight
              id="password"
              name="new_password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <div className="mt-2 flex items-center gap-2">
              <div className="flex h-1 flex-1 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={
                      i < strength.score
                        ? strength.score >= 3
                          ? "flex-1 rounded-full bg-success"
                          : strength.score >= 2
                          ? "flex-1 rounded-full bg-warn"
                          : "flex-1 rounded-full bg-danger"
                        : "flex-1 rounded-full bg-line"
                    }
                  />
                ))}
              </div>
              <span className="w-20 text-right text-xs font-mono text-ink-3">{strength.label}</span>
            </div>
          </div>

          <div>
            <Label htmlFor="confirm">Confirmer</Label>
            <InputSpotlight
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              hasError={mismatch}
              disabled={submitting}
            />
            {mismatch && (
              <p className="mt-1 text-xs text-danger">
                Les deux mots de passe doivent être identiques.
              </p>
            )}
          </div>
        </CardBody>

        <CardFooter className="flex justify-end">
          <Button type="submit" size="lg" loading={submitting} disabled={mismatch || strength.score < 2}>
            Activer le compte
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
