import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Accueil } from "@/components/accueil/Accueil";
import { requireUser } from "@/lib/server-api";
import { COOKIES } from "@/lib/session";

export const metadata: Metadata = { title: { absolute: "Accueil · NIMOVA" } };

/** Accueil NIMOVA : l'écran de départ des deux espaces de gestion (Finance, AxisPro). */
export default async function Page() {
  const memo = (await cookies()).get(COOKIES.app)?.value;
  if (memo === "portail") redirect("/portail");
  const app = memo === "axispro" ? "axispro" : "finance";
  const me = await requireUser(app);
  return <Accueil me={me} app={app} />;
}
