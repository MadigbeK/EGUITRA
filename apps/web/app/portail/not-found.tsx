import { PageIntrouvable } from "@/components/portail/projet/outils";

/** Page introuvable du portail : dans la coque du cabinet, sans la marque interne. */
export default function Introuvable() {
  return <PageIntrouvable titre="Cette page n'existe pas." texte="L'adresse est peut-être incomplète, ou la page a été retirée par le cabinet." />;
}
