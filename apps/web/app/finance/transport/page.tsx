import { redirect } from "next/navigation";

/** Le transport est une application à part entière (NIMOVA · Transport) : l'ancienne adresse y mène. */
export default function AncienTransport() {
  redirect("/transport");
}
