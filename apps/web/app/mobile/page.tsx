import { RotationsApp } from "@/components/mobile/RotationsApp";
import { requireUser } from "@/lib/server-api";

export default async function MobilePage() {
  const me = await requireUser("mobile");
  return <RotationsApp me={{ id: me.id, name: me.name }} />;
}
