import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Engagements de dépense" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
