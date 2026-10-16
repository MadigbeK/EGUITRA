import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorker } from "@/components/mobile/ServiceWorker";

export const metadata: Metadata = {
  title: { absolute: "NIMOVA · Rotations" },
  manifest: "/mobile.webmanifest",
  icons: { icon: "/icons/nimova.svg", apple: "/icons/rotations-180.png" },
  appleWebApp: { capable: true, title: "Rotations", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#b83e16",
};

/** Application Rotations : sans menu latéral, pensée pour le téléphone et le travail hors réseau. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div data-app="mobile" className="min-h-screen bg-bg text-ink">
      <ServiceWorker />
      {children}
    </div>
  );
}
