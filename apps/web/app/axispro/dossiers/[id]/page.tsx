import { redirect } from "next/navigation";

/**
 * Un projet s'ouvre à l'étape 1 (fiche). Un lien vers un ancien onglet (?onglet=risques) mène à l'outil du
 * cabinet correspondant.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string | string[] }> }) {
  const { id } = await params;
  const { onglet } = await searchParams;
  redirect(typeof onglet === "string" && onglet ? `/axispro/dossiers/${id}/outils?onglet=${encodeURIComponent(onglet)}` : `/axispro/dossiers/${id}/fiche`);
}
