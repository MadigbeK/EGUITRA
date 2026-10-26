"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Input, Notice, PasswordInput, cx } from "@/components/ui";
import { APPS, type AppCode } from "@/lib/config";
import { MESSAGE_RESEAU } from "@/lib/erreurs";

type Step = { kind: "credentials" } | { kind: "mfa" } | { kind: "setup"; secret: string; qr: string };

/** Envoi d'une étape de la connexion ; une coupure du réseau rend une réponse en échec qui le dit. */
async function post(url: string, body: unknown) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, string>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network", message: MESSAGE_RESEAU } as Record<string, string> };
  }
}

/** Phrase d'accueil : l'application ouverte, ou le cabinet pour les porteurs de projets. */
function introduction(app: AppCode): string {
  if (app === "portail") return "Votre espace de porteur de projet chez MB AxisPro Consulting.";
  const tagline = APPS[app].tagline;
  return `${APPS[app].name}, ${tagline.charAt(0).toLowerCase()}${tagline.slice(1)}.`;
}

const TITRES: Record<Step["kind"], string> = {
  credentials: "Connexion",
  mfa: "Code de vérification",
  setup: "Double authentification",
};

/**
 * Connexion en trois étapes (identifiant, code, activation de la double authentification). Sur la
 * page de connexion, elle mène ensuite à `next`. Dans la fenêtre de reconnexion (`enFenetre`, session
 * expirée sur une page ouverte), elle appelle `onConnecte` sans quitter la page, l'identifiant du
 * compte déjà saisi (`identifiant`) ; la fenêtre porte alors le titre.
 */
export function LoginForm({ app, next, message, enFenetre = false, identifiant = "", onConnecte }: { app: AppCode; next: string; message: string | null; enFenetre?: boolean; identifiant?: string; onConnecte?: () => void | Promise<void> }) {
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [login, setLogin] = useState(identifiant);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done() {
    if (onConnecte) return void onConnecte();
    window.location.href = next;
  }

  // Le bouton reste en chargement jusqu'à l'écran suivant quand la connexion aboutit ; sinon il est
  // toujours rendu (finally), même sur une coupure du réseau.
  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let connecte = false;
    try {
      const { ok, data } = await post("/api/session/login", { login, password, app });
      if (!ok) return setError(data.message ?? "Connexion impossible.");
      setPassword("");
      if (data.status === "ok") {
        connecte = true;
        return done();
      }
      if (data.status === "mfa_required") return setStep({ kind: "mfa" });
      if (data.status === "mfa_setup_required") {
        return setStep({ kind: "setup", secret: data.secret ?? "", qr: data.qr_png ?? "" });
      }
      setError("Réponse inattendue du service.");
    } finally {
      if (!connecte) setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let connecte = false;
    try {
      const url = step.kind === "setup" ? "/api/session/mfa-setup" : "/api/session/mfa";
      const { ok, status, data } = await post(url, { code });
      if (ok) {
        connecte = true;
        return done();
      }
      // Code refusé : il est effacé. Coupure du réseau ou service indisponible : il reste, il pourra
      // repartir tel quel.
      if (status === 400 || status === 401) setCode("");
      if (status === 401 && data.error === "invalid_token") {
        setStep({ kind: "credentials" });
      }
      setError(data.message ?? "Code incorrect.");
    } finally {
      if (!connecte) setBusy(false);
    }
  }

  return (
    <div>
      {!enFenetre && <h1 className="font-display text-[30px] font-semibold leading-tight text-ink">{TITRES[step.kind]}</h1>}
      {(!enFenetre || step.kind !== "credentials") && (
        <p className={cx("text-sm leading-relaxed text-muted", !enFenetre && "mt-2")}>
          {step.kind === "credentials" && introduction(app)}
          {step.kind === "mfa" && "Saisissez le code à 6 chiffres affiché par votre application d'authentification."}
          {step.kind === "setup" && "Première connexion : reliez votre compte à une application d'authentification."}
        </p>
      )}

      <div className={cx("space-y-4", enFenetre ? (step.kind === "credentials" ? "" : "mt-4") : "mt-8")}>
        {message && step.kind === "credentials" && <Notice>{message}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {step.kind === "credentials" && (
          <form onSubmit={submitCredentials} className="space-y-4">
            <Field label="Identifiant">
              <Input autoComplete="username" autoFocus={!identifiant} value={login} onChange={(e) => setLogin(e.target.value)} required className="min-h-11" />
            </Field>
            <Field label="Mot de passe">
              {/* Identifiant déjà connu (reconnexion) : le mot de passe prend le focus (data-autofocus, lu par Modal). */}
              <PasswordInput autoComplete="current-password" autoFocus={Boolean(identifiant)} data-autofocus={identifiant ? "" : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required className="min-h-11" />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" loading={busy}>
              Se connecter
            </Button>
          </form>
        )}

        {step.kind === "mfa" && (
          <form onSubmit={submitCode} className="space-y-5">
            <CodeInput value={code} onChange={setCode} />
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>
              Valider
            </Button>
            <button type="button" className="w-full text-center text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setStep({ kind: "credentials" })}>
              Revenir à l&apos;identifiant
            </button>
          </form>
        )}

        {step.kind === "setup" && (
          <form onSubmit={submitCode} className="space-y-5">
            <ol className="space-y-2 text-[13px] leading-snug text-ink-2">
              <li className="flex gap-3">
                <span className="font-mono font-semibold text-muted">1</span>
                Installez une application d&apos;authentification (Google Authenticator, Microsoft Authenticator, FreeOTP).
              </li>
              <li className="flex gap-3">
                <span className="font-mono font-semibold text-muted">2</span>
                Scannez le code ci-dessous, ou saisissez la clé à la main.
              </li>
              <li className="flex gap-3">
                <span className="font-mono font-semibold text-muted">3</span>
                Saisissez le code à 6 chiffres affiché par l&apos;application.
              </li>
            </ol>
            {step.qr.startsWith("data:image/png;base64,") && (
              // eslint-disable-next-line @next/next/no-img-element -- image locale générée par le serveur
              <img src={step.qr} alt="QR code d'activation" width={196} height={196} className="mx-auto rounded-lg bg-white p-2" />
            )}
            <div className="rounded-lg bg-panel-2 px-3 py-2.5 text-center font-mono text-[13px] tracking-[0.18em] text-ink-2 select-all">{step.secret}</div>
            <CodeInput value={code} onChange={setCode} />
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>
              Activer et se connecter
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Code à 6 chiffres présenté en cases de compteur. Un seul champ de saisie, transparent et posé
 * sur les cases : clavier numérique, collage et lecteurs d'écran fonctionnent normalement.
 */
function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = Math.min(value.length, 5);
  return (
    <div className="group relative">
      <input
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
        aria-label="Code à 6 chiffres"
      />
      <div aria-hidden className="flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={cx(
              "grid h-14 flex-1 place-items-center rounded-lg border bg-panel font-compteur text-[32px] font-semibold text-ink transition-colors",
              i === current ? "border-line-strong group-focus-within:border-accent group-focus-within:ring-2 group-focus-within:ring-accent/20" : "border-line-strong/60",
            )}
          >
            {value[i] ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}
