import type { Metadata } from "next";
import type { ReactNode } from "react";

// Gabarit repris de la rubrique : un titre simple l'effacerait pour l'état de rapprochement.
export const metadata: Metadata = { title: { default: "Trésorerie", template: "%s · NIMOVA Finance" } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
