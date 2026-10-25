import { redirect } from "next/navigation";

/**
 * Adresse d'une action seule (/hsseq/actions/{id}) : la fiche s'ouvre dans le registre, à côté de
 * la liste, par le paramètre « action ».
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  redirect(Number.isInteger(n) && n > 0 ? `/hsseq/actions?action=${n}` : "/hsseq/actions");
}
