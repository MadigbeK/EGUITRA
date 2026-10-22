import type { Metadata, Viewport } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Polices embarquées à la construction : servies par le site lui-même (politique de contenu).
// Choix du gérant (16 octobre 2026) : Funnel Sans pour le texte courant et les montants, Funnel
// Display pour les titres et les grands chiffres.
const funnelSans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const funnelDisplay = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "NIMOVA", template: "%s · NIMOVA" },
  description: "NIMOVA, système intégré de gestion d'EGUITRA GROUP et de MB AxisPro",
  robots: { index: false, follow: false },
  // Icône déclarée ici plutôt qu'en fichier app/icon.svg : le portail et sa page de connexion
  // peuvent ainsi la remplacer par celle du cabinet.
  icons: { icon: "/icons/nimova.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#142f29",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${funnelSans.variable} ${funnelDisplay.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
