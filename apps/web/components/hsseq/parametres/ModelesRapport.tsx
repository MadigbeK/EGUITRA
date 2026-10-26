"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { ArrowUpRight, Pencil, Plus } from "@/components/icons";
import { Button, Etat, FEUILLE, Notice, Tag, cx } from "@/components/ui";
import { Tampon } from "@/components/hsseq/commun";
import { EditeurModele } from "@/components/hsseq/rapports/EditeurModele";
import { moisLong, perimetre } from "@/components/hsseq/rapports/outils";
import type { ReportTemplate } from "@/components/hsseq/rapports/types";
import { useApi, useAutorise } from "@/lib/api-client";
import { fmtPct, pluriel } from "@/lib/format";

/** Profils qui créent et modifient les modèles (CONFIG du noyau). */
const PARAMETRAGE = ["admin", "hsseq"] as const;

/**
 * Modèles du rapport mensuel HSSE, un par donneur d'ordre (GET, POST et PATCH
 * /hsseq/reports/templates, administration et Responsable HSSEQ) : nom, donneur d'ordre, société,
 * périmètre des valeurs calculées (sites, profil de véhicule), premier mois, seuils de l'état,
 * indicateurs proactifs et réactifs, leur ordre et leur plan mois par mois. Le modèle « NIMOVA » reprend
 * les indicateurs du cockpit. `?modele=<id>` ouvre un modèle (lien du rapport mensuel).
 */
export function ModelesRapport() {
  const demande = Number(useSearchParams().get("modele")) || null;
  // active=all : les modèles archivés se lisent et se remettent en service.
  const { data, error, mutate } = useApi<ReportTemplate[]>("/hsseq/reports/templates?active=all");
  const { mutate: muterCles } = useSWRConfig();
  const parametrage = useAutorise(PARAMETRAGE);
  const [edition, setEdition] = useState<number | "nouveau" | null>(demande);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-muted">Un modèle reprend le rapport mensuel exigé par un donneur d&apos;ordre : ses indicateurs, leur numéro et leur ordre, leur plan mois par mois.</p>
        {parametrage && (
          <Button size="sm" onClick={() => setEdition("nouveau")}>
            <Plus className="h-3.5 w-3.5" /> Nouveau modèle
          </Button>
        )}
      </div>
      <Notice tone="accent">
        Un indicateur est calculé par NIMOVA, à partir d&apos;une valeur du catalogue (indicateurs du cockpit, nombres du mois, situations de fin de mois), ou saisi chaque mois par le Responsable HSSEQ. Les valeurs calculées d&apos;un mois se figent le 5 du mois suivant ; le mois se valide ensuite et se rouvre avec un motif. Retirer un indicateur garde ses valeurs passées.
      </Notice>
      {message && <Notice tone="ok">{message}</Notice>}
      <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des modèles de rapport…" vide={{ title: "Aucun modèle de rapport.", hint: "Créez le modèle d'un donneur d'ordre : ses indicateurs et son plan." }}>
        {(liste) => (
          <div className="grid gap-5 xl:grid-cols-2">
            {[...liste]
              .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "fr"))
              .map((t) => (
                <CarteModele key={t.id} t={t} onModifier={() => setEdition(t.id)} />
              ))}
          </div>
        )}
      </Etat>
      {edition !== null && (
        <EditeurModele
          id={edition === "nouveau" ? null : edition}
          onClose={() => setEdition(null)}
          onDone={(t, cree) => {
            setEdition(null);
            setMessage(cree ? `Modèle « ${t.name} » créé.` : `Modèle « ${t.name} » enregistré.`);
            // Le rapport mensuel relit ses modèles et ses mois.
            void muterCles((k) => typeof k === "string" && k.startsWith("/hsseq/reports"));
            void mutate();
          }}
        />
      )}
    </div>
  );
}

/** Carte d'un modèle : donneur d'ordre, société, périmètre et premier mois, indicateurs en service, seuils de l'état. */
function CarteModele({ t, onModifier }: { t: ReportTemplate; onModifier: () => void }) {
  const donneur = t.client_label ?? t.partner?.name;
  const borne = perimetre(t);
  return (
    <section aria-labelledby={`modele-${t.id}`} className={cx(FEUILLE, "min-w-0 p-6", !t.active && "opacity-80")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`modele-${t.id}`} className="font-display text-[17px] font-[620] leading-snug text-ink">
            {t.name}
          </h2>
          <p className="mt-1 text-[12.5px] text-muted">
            {donneur ? `Donneur d'ordre : ${donneur}` : "Donneur d'ordre non précisé"} · {t.company?.name ?? "les deux sociétés"}
            {t.partner && t.client_label ? ` · fiche client : ${t.partner.name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.code === "NIMOVA" && <Tag>Fourni par NIMOVA</Tag>}
          <Tampon mot={t.active ? "En service" : "Archivé"} />
          {t.rights.can_edit && (
            <Button size="sm" onClick={onModifier} aria-label={`Modifier le modèle ${t.name}`}>
              <Pencil className="h-3.5 w-3.5" /> Modifier
            </Button>
          )}
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-snug text-ink-2">
        {pluriel(t.indicators_count, "indicateur en service", "indicateurs en service")}. Conforme à partir de {fmtPct(t.compliant_ratio * 100, 0)} de la cible, sous surveillance à partir de {fmtPct(t.watch_ratio * 100, 0)}.
      </p>
      <p className="mt-1.5 text-[12.5px] leading-snug text-muted">
        {borne ? `Valeurs calculées sur : ${borne}.` : "Valeurs calculées sur toute la société."}
        {t.start_month ? ` Rapport tenu depuis ${moisLong(t.start_month)}.` : ""}
      </p>
      {t.active && (
        <Link href={`/hsseq/rapports?modele=${t.id}`} className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
          Ouvrir le rapport mensuel <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}
