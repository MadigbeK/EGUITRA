import { PageErreur } from "@/components/PageErreur";

export default function Introuvable() {
  return <PageErreur code="404" titre="Cette page n'existe pas" texte="L'adresse est peut-être incomplète, ou la page a été déplacée. Vérifiez-la ou revenez à l'accueil." />;
}
