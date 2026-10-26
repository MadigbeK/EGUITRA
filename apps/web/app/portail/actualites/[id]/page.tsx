import { notFound } from "next/navigation";
import { LectureActualite } from "./LectureActualite";

/** Un identifiant qui n'est pas un entier ne désigne aucune communication : page introuvable, sans appel au noyau. */
export default async function PageActualite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound();
  return <LectureActualite id={Number(id)} />;
}
