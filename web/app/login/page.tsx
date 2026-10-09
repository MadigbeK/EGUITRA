import type { Metadata } from "next";
import { LoginAnimated } from "./login-animated";

export const metadata: Metadata = {
  title: "Connexion",
  description:
    "Connexion à la plateforme EGUITRA Finance — réservée aux clients B2B et au staff EGUITRA GROUP.",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ next?: string; reason?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { next, reason } = await searchParams;
  return <LoginAnimated nextUrl={next ?? "/finance"} reason={reason} />;
}
