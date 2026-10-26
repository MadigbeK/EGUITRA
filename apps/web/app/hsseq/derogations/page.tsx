import { Derogations } from "@/components/hsseq/derogations/Derogations";
import { PageHeader } from "@/components/ui";

/** File des dérogations au verrou de départ (contrat HSSEQ, §10). */
export default function HsseqDerogations() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dérogations"
        subtitle="Le chef de parc demande, et sa demande vaut première validation ; le Responsable HSSEQ, une autre personne, donne la seconde ou refuse. Une dérogation vaut pour une seule rotation, jamais sur V01 ni V03, et le Directeur général en est informé."
      />
      <Derogations />
    </div>
  );
}
