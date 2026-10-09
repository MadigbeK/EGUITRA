import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ApiError, apiFetch } from "@/lib/api-server";
import { readAuthCookies } from "@/lib/auth-cookies";
import type { UserPublic } from "@/lib/auth-types";
import { CockpitRail } from "@/components/cockpit/CockpitRail";

/* EGUITRA Finance — shell cockpit : rail de navigation + contenu plein cadre. */

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const { access } = await readAuthCookies();
  if (!access) redirect("/login?reason=no_access_cookie");

  let user: UserPublic;
  try {
    user = await apiFetch<UserPublic>("/auth/me", { accessToken: access });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect("/login?reason=session_expired");
    throw e;
  }
  if (user.role === "porteur") redirect("/axispro/portail");

  return (
    <div className="theme-cockpit flex min-h-screen bg-[#0a0c24]">
      <CockpitRail initials={getInitials(user.name)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
