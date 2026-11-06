"use client";

import { Copy } from "@/components/icons";
import { useState } from "react";
import { Button, Card, DataTable, Input, Notice, demanderConfirmation } from "@/components/ui";
import { useRetour } from "@/components/axispro/dossier/commun";
import { creerLienDepot, retirerLienDepot, useLiensDepot } from "@/lib/axispro-api";
import { fmtDate, fmtInt } from "@/lib/format";
import { useDossier } from "./DossierParcours";

/**
 * Lien de dépôt du promoteur (AJ-02), à l'étape 2 : une adresse propre au projet, de durée limitée, sans compte. Le
 * jeton n'existe en clair qu'à la création : il s'affiche une seule fois. Le promoteur ne voit ni les scores ni les
 * autres pièces ; ses pièces arrivent « À vérifier » (RG-06-04).
 */
export function CarteLienDepot() {
  const { d } = useDossier();
  const { data, mutate } = useLiensDepot(d.id, true);
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  const [adresse, setAdresse] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const jours = data?.default_days ?? 14;
  const actifs = (data?.links ?? []).filter((l) => l.valid);

  async function creer() {
    const r = await envoyer(() => creerLienDepot(d.id, jours), undefined, "creer-lien");
    if (!r) return;
    setAdresse(`${window.location.origin}/depot/${r.token}`);
    setCopie(false);
    void mutate();
  }

  async function copier() {
    if (!adresse) return;
    try {
      await navigator.clipboard.writeText(adresse);
      setCopie(true);
    } catch {
      // Presse-papiers refusé : l'adresse se sélectionne pour une copie à la main.
      (document.getElementById("adresse-depot") as HTMLInputElement | null)?.select();
    }
  }

  async function retirer(id: number) {
    if (!(await demanderConfirmation("Retirer ce lien ? Le promoteur ne pourra plus déposer par cette adresse.", { action: "Retirer", danger: true }))) return;
    const r = await envoyer(() => retirerLienDepot(id), "Lien retiré.", `retire-lien-${id}`);
    if (r) void mutate();
  }

  return (
    <Card title="Lien de dépôt pour le promoteur">
      <p className="text-[14px] text-ink-2">Le promoteur dépose ses pièces sans compte. Il ne voit ni les scores ni les autres pièces du dossier ; ses pièces arrivent « À vérifier ».</p>
      <Button className="mt-3" disabled={occupe} loading={enCours === "creer-lien"} onClick={() => void creer()}>Créer un lien valable {fmtInt(jours)} jours</Button>
      {adresse && (
        <div className="mt-3 space-y-2">
          <Notice tone="ok">Copiez ce lien maintenant et transmettez-le au promoteur : il ne s&apos;affichera plus.</Notice>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="adresse-depot" readOnly value={adresse} aria-label="Lien de dépôt" onFocus={(e) => e.target.select()} />
            <Button className="flex-none" onClick={() => void copier()}><Copy aria-hidden className="h-4 w-4" /> {copie ? "Copié" : "Copier"}</Button>
          </div>
        </div>
      )}
      {bandeau}
      {actifs.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          <DataTable
            dense
            rows={actifs}
            rowKey={(l) => l.id}
            columns={[
              { key: "created_at", label: "Créé le", render: (l) => <span className="whitespace-nowrap">{fmtDate(l.created_at)}</span> },
              { key: "created_by", label: "Par", render: (l) => l.created_by },
              { key: "expires_at", label: "Expire le", render: (l) => <span className="whitespace-nowrap">{fmtDate(l.expires_at)}</span> },
              { key: "pieces", label: "Pièces reçues", align: "right", render: (l) => fmtInt(l.pieces) },
              { key: "retirer", label: "", render: (l) => <Button size="sm" disabled={occupe} loading={enCours === `retire-lien-${l.id}`} onClick={() => void retirer(l.id)}>Retirer</Button> },
            ]}
          />
        </div>
      )}
    </Card>
  );
}
