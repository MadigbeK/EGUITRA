import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Dette et financement" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
