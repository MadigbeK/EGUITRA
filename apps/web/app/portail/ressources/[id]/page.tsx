import { notFound } from "next/navigation";
import { LectureRessource } from "./LectureRessource";

/** Un identifiant qui n'est pas un entier ne désigne aucun conseil : page introuvable, sans appel au noyau. */
export default async function PageRessource({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound();
  return <LectureRessource id={Number(id)} />;
}
