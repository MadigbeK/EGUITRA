/**
 * EGUITRA Finance fonts — Apothicaire Scientifique
 *
 * Outfit (display) + Source Sans 3 (body) + JetBrains Mono (data / SKU / prix).
 * Tous via next/font/google, self-hosted automatiquement.
 *
 * Variables CSS : --font-outfit, --font-source-sans-3, --font-jetbrains-mono
 * Consommées via tailwind.config.ts (fontFamily.display / .sans / .mono).
 */
import { Outfit, Source_Sans_3, JetBrains_Mono } from "next/font/google";

export const outfit = Outfit({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-outfit",
  display: "swap",
});

export const sourceSans3 = Source_Sans_3({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-source-sans-3",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
