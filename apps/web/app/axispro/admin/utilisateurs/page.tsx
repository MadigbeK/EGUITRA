import type { Metadata } from "next";
import { UsersAdmin } from "@/components/admin/UsersAdmin";

export const metadata: Metadata = { title: "Utilisateurs" };

export default function Page() {
  return <UsersAdmin />;
}
