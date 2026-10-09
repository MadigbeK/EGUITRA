import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { FirstLoginForm } from "./first-login-form";
import { Brand } from "@/components/brand/brand";

export const metadata: Metadata = {
  title: "Activer mon compte",
  description: "Définir le mot de passe pour activer votre compte EGUITRA Finance.",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function FirstLoginPage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg">
      {/* Background orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-orange/10 blur-3xl" />
        <div className="absolute -right-32 -bottom-32 h-96 w-96 rounded-full bg-brand-green-vif/10 blur-3xl" />
      </div>

      <header className="relative mx-auto w-full max-w-4xl px-6 pt-8 md:pt-10">
        <Brand size="lg" tagline="Pharma · Conakry · depuis 1985" />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-brand-orange to-brand-navy text-ink shadow-[0_0_0_4px_oklch(72%_0.180_55_/_.15)]">
              <KeyRound className="h-6 w-6" strokeWidth={2.2} />
            </div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-brand-orange">
              Activation · Premier accès
            </p>
            <h1 className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight text-ink md:text-3xl">
              Définissez votre <span className="text-brand-green-vif">mot de passe</span>
            </h1>
            <p className="mt-2 text-sm text-ink-3">
              Activez votre compte en créant un mot de passe sécurisé.
            </p>
          </div>

          <FirstLoginForm initialToken={token ?? ""} />
        </div>
      </main>

      <footer className="relative px-6 py-6 text-center text-xs text-ink-4">
        © 2026 EGUITRA GROUP SARL
      </footer>
    </div>
  );
}
