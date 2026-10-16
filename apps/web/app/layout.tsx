import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Barlow_Semi_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Polices embarquées à la construction : servies par le site lui-même (politique de contenu).
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow", display: "swap" });
const barlowSemiCondensed = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-sc", display: "swap" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-barlow-c", display: "swap" });

export const metadata: Metadata = {
  title: { default: "NIMOVA", template: "%s · NIMOVA" },
  description: "NIMOVA, système intégré de gestion d'EGUITRA GROUP et de MB AxisPro Consulting",
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
    <html lang="fr" className={`${barlow.variable} ${barlowSemiCondensed.variable} ${barlowCondensed.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
