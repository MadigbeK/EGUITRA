import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { default: "Événements", template: "%s · NIMOVA HSSEQ" } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
