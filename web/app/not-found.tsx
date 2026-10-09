import Link from "next/link";
import { CircleAlert, ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-danger/12 blur-3xl" />
        <div className="absolute -right-32 -bottom-32 h-96 w-96 rounded-full bg-brand-orange/10 blur-3xl" />
      </div>

      <header className="relative mx-auto w-full max-w-4xl px-6 pt-8">
        <Brand size="md" tagline="Pharma · Conakry · depuis 1985" />
      </header>

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-danger/15 text-danger">
          <CircleAlert className="h-8 w-8" strokeWidth={2} />
        </div>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-danger">
          Erreur 404 · Page introuvable
        </p>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-ink md:text-5xl">
          Cette page n&apos;existe pas
        </h1>
        <p className="mt-3 max-w-md text-sm text-ink-3">
          La page que vous cherchez a été déplacée ou n&apos;existe pas.
          Si vous pensez qu&apos;il s&apos;agit d&apos;une erreur, contactez le support.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/">
            <Button size="md">
              <ArrowLeft className="h-4 w-4" />
              Retour à l&apos;accueil
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" size="md">
              Espace client
            </Button>
          </Link>
        </div>
      </main>

      <footer className="relative px-6 py-6 text-center text-xs text-ink-4">
        © 2026 EGUITRA GROUP SARL
      </footer>
    </div>
  );
}
