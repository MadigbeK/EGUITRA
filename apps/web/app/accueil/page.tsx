import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Accueil } from "@/components/accueil/Accueil";
import { accueilApp } from "@/lib/config";
import { requireUser } from "@/lib/server-api";
import { COOKIES } from "@/lib/session";

export const metadata: Metadata = { title: { absolute: "Accueil · NIMOVA" } };

/** Accueil NIMOVA : l'écran de départ des deux espaces de gestion (Finance, AxisPro). */
export default async function Page() {
  const memo = (await cookies()).get(COOKIES.app)?.value;
  if (memo === "portail") redirect("/portail");
  const h = await headers();
  const app = accueilApp(memo, h.get("x-forwarded-host") ?? h.get("host"));
  const me = await requireUser(app);
  return <Accueil me={me} app={app} />;
}
