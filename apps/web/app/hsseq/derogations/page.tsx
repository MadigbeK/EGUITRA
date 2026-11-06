import { Derogations } from "@/components/hsseq/derogations/Derogations";
import { PageHeader } from "@/components/ui";

/** File des dérogations au verrou de départ (contrat HSSEQ, §10). */
export default function HsseqDerogations() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dérogations"
        subtitle="Validez ou refusez les demandes du chef de parc ; le contrôle avant départ et l'alcootest ne se dérogent jamais."
      />
      <Derogations />
    </div>
  );
}
