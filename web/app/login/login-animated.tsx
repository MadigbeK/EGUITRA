"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useState } from "react";
import Image from "next/image";

/* ════════════════════════════════════════════════════════════════════════════
   LoginAnimated — sign-in Microsoft Fluent pour app.eguitragroup.com.

   Split : panneau gauche brand (image + voile bleu Fluent), card sign-in
   blanche à droite (Segoe, inputs propres, bouton bleu). Cohérent avec les
   dashboards Fluent. Auth logique inchangée (POST /api/auth/login).
   ════════════════════════════════════════════════════════════════════════════ */

const BG_IMAGE_URL = "/login-bg.jpg";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Identifiant ou mot de passe incorrect.",
  account_disabled: "Ce compte est désactivé. Contactez votre administrateur.",
  must_change_pwd:
    "Vous devez activer votre compte. Cliquez sur le lien d'invitation reçu.",
  rate_limited: "Trop de tentatives. Patientez 15 minutes avant de réessayer.",
  no_access_cookie: "Session expirée, veuillez vous reconnecter.",
  missing_credentials: "Identifiant et mot de passe requis.",
};

export function LoginAnimated({
  nextUrl,
  reason,
}: {
  nextUrl: string;
  reason?: string;
}) {
  const router = useRouter();
  const [formData, setFormData] = useState({ Identifiant: "", "Mot de passe": "" });
  const [error, setError] = useState<string | null>(
    reason ? (ERROR_MESSAGES[reason] ?? reason) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const onChange =
    (name: keyof typeof formData) => (e: ChangeEvent<HTMLInputElement>) => {
      setFormData((prev) => ({ ...prev, [name]: e.target.value }));
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: formData.Identifiant,
          password: formData["Mot de passe"],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        const code = data.detail ?? "unknown_error";
        setError(ERROR_MESSAGES[code] ?? `Erreur : ${code}`);
        setSubmitting(false);
        return;
      }
      router.push(nextUrl as never);
      router.refresh();
    } catch {
      setError("Erreur réseau, vérifiez votre connexion.");
      setSubmitting(false);
    }
  };

  return (
    <section
      className="theme-fluent flex min-h-screen bg-[#f3f6fb]"
      style={{
        fontFamily:
          "'Segoe UI', 'Segoe UI Variable', Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      {/* ── Panneau gauche : brand + image, voile bleu Fluent ── */}
      <div className="relative hidden w-1/2 overflow-hidden lg:block">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${BG_IMAGE_URL}")` }}
          aria-hidden="true"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(0,103,184,0.92) 0%, rgba(0,90,158,0.82) 45%, rgba(0,60,110,0.78) 100%)",
          }}
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          <Image
            src="/logo-eguitra.png"
            alt="EGUITRA GROUP"
            width={720}
            height={480}
            priority
            className="h-auto w-[200px] brightness-0 invert"
          />
          <div>
            <h1 className="font-semibold leading-[1.05] tracking-tight text-white text-[clamp(36px,3.4vw,56px)]">
              Votre catalogue,
              <br />
              vos commandes,
              <br />
              votre encours.
            </h1>
            <p className="mt-6 max-w-md text-lg text-white/85">
              Accès sécurisé à 6 738 références pharmaceutiques, historique Odoo en
              temps réel, encours négocié. Réservé aux pharmacies agréées.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/75">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#4CC585]" />
                Agréé Min. Santé
              </span>
              <span>Conakry · J+1</span>
              <span>Depuis 2014</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Card sign-in droite (blanche Fluent) ── */}
      <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-[400px]">
          {/* Logo mobile */}
          <div className="mb-8 lg:hidden">
            <Image
              src="/logo-eguitra.png"
              alt="EGUITRA GROUP"
              width={720}
              height={480}
              priority
              className="h-auto w-[150px]"
            />
          </div>

          <h2 className="text-[28px] font-semibold tracking-tight text-[#1b1b1b]">
            Espace client
          </h2>
          <p className="mt-2 text-[15px] text-[#5b6470]">
            Connectez-vous à votre espace pharmacie sécurisé.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
            <div>
              <label
                htmlFor="identifier"
                className="mb-1.5 block text-sm font-semibold text-[#1b1b1b]"
              >
                Identifiant
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                value={formData.Identifiant}
                onChange={onChange("Identifiant")}
                required
                disabled={submitting}
                placeholder="email ou pseudo (ex : ph-c712)"
                className="h-11 w-full rounded border border-[#8a8f98] bg-white px-3 text-[15px] text-[#1b1b1b] outline-none transition-colors placeholder:text-[#a0a4ab] focus:border-[#0067B8] focus:ring-2 focus:ring-[#0067B8]/25 disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-semibold text-[#1b1b1b]"
              >
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  value={formData["Mot de passe"]}
                  onChange={onChange("Mot de passe")}
                  required
                  disabled={submitting}
                  placeholder="••••••••"
                  className="h-11 w-full rounded border border-[#8a8f98] bg-white px-3 pr-16 text-[15px] text-[#1b1b1b] outline-none transition-colors placeholder:text-[#a0a4ab] focus:border-[#0067B8] focus:ring-2 focus:ring-[#0067B8]/25 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-[#0067B8] hover:underline"
                >
                  {showPwd ? "Masquer" : "Afficher"}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded border border-[#D83B01]/40 bg-[#FDF3F0] px-3 py-2.5 text-sm text-[#A82A00]"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full bg-[#0067B8] text-[15px] font-semibold text-white transition-colors hover:bg-[#005A9E] disabled:opacity-60"
            >
              {submitting ? "Connexion en cours…" : "Se connecter"}
            </button>

            <div className="flex items-center justify-between pt-1 text-sm">
              <button
                type="button"
                onClick={() => router.push("/aide/connexion" as never)}
                className="text-[#0067B8] hover:underline"
              >
                Mot de passe oublié ?
              </button>
              <span className="text-[#5b6470]">
                Pas de compte ?{" "}
                <a href="https://eguitragroup.com/contact" className="font-semibold text-[#0067B8] hover:underline">
                  Ouvrir
                </a>
              </span>
            </div>
          </form>

          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#e5e9ef] pt-5 text-xs text-[#8a8f98]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#107C10]" />
              Connexion chiffrée
            </span>
            <span>Argon2id · JWT</span>
            <span>© 2026 EGUITRA GROUP SARL</span>
          </div>
        </div>
      </div>
    </section>
  );
}
