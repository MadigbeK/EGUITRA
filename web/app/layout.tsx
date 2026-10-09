import type { Metadata, Viewport } from "next";
import { outfit, sourceSans3, jetbrainsMono } from "./fonts";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: {
    default: "EGUITRA Finance",
    template: "%s · EGUITRA Finance",
  },
  description: "Pilotage financier du groupe EGUITRA : comptabilité, trésorerie, rentabilité.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.eguitragroup.com"
  ),
  robots: {
    index: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true",
    follow: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "EGUITRA Finance",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1A9E9E",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr-GN"
      className={`${outfit.variable} ${sourceSans3.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/* Skip link a11y */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-brand-orange focus:px-3 focus:py-2 focus:text-brand-navy-deep focus:font-semibold"
        >
          Aller au contenu
        </a>
        <ServiceWorkerRegister />
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
