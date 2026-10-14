import type { Metadata } from "next";
import { UsersAdmin } from "@/components/admin/UsersAdmin";
import { requireUser } from "@/lib/server-api";

export const metadata: Metadata = { title: "Utilisateurs" };

export default async function Page() {
  // Sociétés que l'administrateur peut ouvrir à un utilisateur : les siennes.
  const me = await requireUser("finance");
  return <UsersAdmin companies={me.companies} defaultCompany={me.company_id} />;
}
