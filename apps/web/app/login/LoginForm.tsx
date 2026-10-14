"use client";

import { useState, type FormEvent } from "react";
import { Lock, ShieldCheck, Smartphone } from "lucide-react";
import { Button, Field, Input, Notice } from "@/components/ui";
import type { AppCode } from "@/lib/config";

type Step = { kind: "credentials" } | { kind: "mfa" } | { kind: "setup"; secret: string; qr: string };

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  return { ok: res.ok, status: res.status, data };
}

export function LoginForm({ app, next, message }: { app: AppCode; next: string; message: string | null }) {
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done() {
    window.location.href = next;
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await post("/api/session/login", { login, password, app });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Connexion impossible.");
    setPassword("");
    if (data.status === "ok") return done();
    if (data.status === "mfa_required") return setStep({ kind: "mfa" });
    if (data.status === "mfa_setup_required") {
      return setStep({ kind: "setup", secret: data.secret ?? "", qr: data.qr_png ?? "" });
    }
    setError("Réponse inattendue du service.");
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const url = step.kind === "setup" ? "/api/session/mfa-setup" : "/api/session/mfa";
    const { ok, status, data } = await post(url, { code });
    setBusy(false);
    if (ok) return done();
    setCode("");
    if (status === 401 && data.error === "invalid_token") {
      setStep({ kind: "credentials" });
    }
    setError(data.message ?? "Code incorrect.");
  }

  return (
    <div className="rounded-2xl border border-line bg-panel p-6 shadow-xl md:p-8">
      {message && step.kind === "credentials" && (
        <div className="mb-4">
          <Notice>{message}</Notice>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {step.kind === "credentials" && (
        <form onSubmit={submitCredentials} className="space-y-4">
          <Field label="Identifiant">
            <Input autoComplete="username" autoFocus value={login} onChange={(e) => setLogin(e.target.value)} required />
          </Field>
          <Field label="Mot de passe">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            <Lock className="h-4 w-4" /> Se connecter
          </Button>
        </form>
      )}

      {step.kind === "mfa" && (
        <form onSubmit={submitCode} className="space-y-4">
          <div className="flex items-center gap-3 text-sm text-ink-2">
            <Smartphone className="h-5 w-5 text-accent" />
            Saisissez le code à 6 chiffres affiché par votre application d'authentification.
          </div>
          <CodeInput value={code} onChange={setCode} />
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={code.length !== 6}>
            <ShieldCheck className="h-4 w-4" /> Valider
          </Button>
          <button type="button" className="w-full text-center text-xs text-muted underline-offset-2 hover:underline" onClick={() => setStep({ kind: "credentials" })}>
            Revenir à l&apos;identifiant
          </button>
        </form>
      )}

      {step.kind === "setup" && (
        <form onSubmit={submitCode} className="space-y-4">
          <div className="text-sm text-ink-2">
            <p className="font-medium text-ink">Activez la double authentification</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
              <li>Installez une application d&apos;authentification (Google Authenticator, Microsoft Authenticator, FreeOTP).</li>
              <li>Scannez le code ci-dessous, ou saisissez la clé à la main.</li>
              <li>Saisissez le code à 6 chiffres affiché par l&apos;application.</li>
            </ol>
          </div>
          {step.qr.startsWith("data:image/png;base64,") && (
            // eslint-disable-next-line @next/next/no-img-element -- image locale générée par le serveur
            <img src={step.qr} alt="QR code d'activation" width={220} height={220} className="mx-auto rounded-lg bg-white p-2" />
          )}
          <div className="rounded-lg border border-line bg-bg px-3 py-2 text-center font-mono text-xs tracking-widest text-ink-2 select-all">
            {step.secret}
          </div>
          <CodeInput value={code} onChange={setCode} />
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={code.length !== 6}>
            <ShieldCheck className="h-4 w-4" /> Activer et se connecter
          </Button>
        </form>
      )}
    </div>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      autoFocus
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      pattern="[0-9]{6}"
      placeholder="000000"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="text-center font-mono text-2xl tracking-[0.5em]"
      aria-label="Code à 6 chiffres"
    />
  );
}
