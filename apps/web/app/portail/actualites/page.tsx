"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Flag } from "@/components/icons";
import { Badge, Card, Empty, ErrorBox, Loading, Notice, Segmented, cx } from "@/components/ui";
import { EnTete, formatConakry, jourConakry, quand } from "@/components/portail/commun";
import { NATURE, TitreSection, dateSimple, majuscule, pluriel } from "@/components/portail/cabinet-porteur/briques";
import { erreurLisible } from "@/components/portail/projet/outils";
import { useApi } from "@/lib/api-client";
import type { AnnouncementRow } from "@/lib/portail-types";

type Filtre = "toutes" | "opportunites" | "importantes" | "non-lues";

const FILTRES: Record<Filtre, (a: AnnouncementRow) => boolean> = {
  toutes: () => true,
  opportunites: (a) => a.kind === "opportunity",
  importantes: (a) => a.kind === "important" || a.kind === "alert" || a.require_ack,
  "non-lues": (a) => !a.read,
};

const VIDE: Record<Filtre, string> = {
  toutes: "Aucune communication pour l'instant.",
  opportunites: "Aucune opportunité de financement en cours.",
  importantes: "Aucune information importante en attente.",
  "non-lues": "Vous avez tout lu.",
};

function horodatage(a: AnnouncementRow) {
  return a.published_at ? new Date(a.published_at).getTime() : 0;
}

function CarteActualite({ a, epinglee }: { a: AnnouncementRow; epinglee?: boolean }) {
  const n = NATURE[a.kind];
  const I = n.icon;
  const aConfirmer = a.require_ack && !a.acknowledged;
  return (
    <Link
      href={`/portail/actualites/${a.id}`}
      className={cx(
        "group relative flex h-full gap-4 overflow-hidden rounded-[20px] p-5 shadow-[var(--ombre-feuille)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--ombre-levee)] sm:p-6",
        epinglee ? "bg-accent-doux" : "bg-panel",
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: n.trait }} />
      <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-2xl" style={{ background: n.fond, color: n.encre }}>
        <I className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={n.tone}>{a.kind_label}</Badge>
          {a.pinned && (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent">
              <Flag className="h-3.5 w-3.5" /> Épinglée
            </span>
          )}
          {aConfirmer && <Badge tone="danger">À confirmer</Badge>}
          <span className="ml-auto text-[12px] text-muted">{majuscule(quand(a.published_at))}</span>
        </span>
        <span className="mt-2.5 flex items-start gap-2">
          {!a.read && (
            <>
              <span aria-hidden className="mt-[0.55em] h-2 w-2 flex-none rounded-full bg-accent-vif" />
              <span className="sr-only">Non lue : </span>
            </>
          )}
          <span className={cx("font-display text-[17px] leading-snug", a.read ? "font-semibold text-ink-2" : "font-bold text-ink")}>{a.title}</span>
        </span>
        <span className={cx("mt-1.5 block text-[13.5px] leading-relaxed text-muted", epinglee ? "line-clamp-3" : "line-clamp-2")}>{a.excerpt}</span>
        <span className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-[12px] text-muted">
          <span>{a.author}</span>
          {a.expire_date && <span>Jusqu'au {dateSimple(a.expire_date, false)}</span>}
          {a.cta_label && <span className="font-semibold text-accent">{a.cta_label}</span>}
          <ArrowRight className="ml-auto h-4 w-4 text-muted transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-accent" />
        </span>
      </span>
    </Link>
  );
}

/** Communications du cabinet : épinglées en tête, puis par mois de publication. */
export default function Actualites() {
  const { data, error, mutate } = useApi<AnnouncementRow[]>("/portail/actualites");
  const [filtre, setFiltre] = useState<Filtre>("toutes");

  const triees = useMemo(() => [...(data ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || horodatage(b) - horodatage(a)), [data]);
  const visibles = useMemo(() => triees.filter(FILTRES[filtre]), [triees, filtre]);
  const epinglees = visibles.filter((a) => a.pinned);
  const parMois = useMemo(() => {
    const groupes: Array<{ cle: string; titre: string; items: AnnouncementRow[] }> = [];
    for (const a of visibles.filter((x) => !x.pinned)) {
      // Mois de publication à Conakry.
      const cle = a.published_at ? jourConakry(a.published_at).slice(0, 7) : "sans-date";
      const titre = a.published_at ? majuscule(formatConakry(a.published_at, { month: "long", year: "numeric" })) : "Sans date";
      const dernier = groupes[groupes.length - 1];
      if (dernier?.cle === cle) dernier.items.push(a);
      else groupes.push({ cle, titre, items: [a] });
    }
    return groupes;
  }, [visibles]);

  if (error) return <ErrorBox error={erreurLisible(error)} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Chargement des actualités du cabinet…" />;

  const nonLues = data.filter((a) => !a.read).length;
  const aConfirmer = data.filter((a) => a.require_ack && !a.acknowledged);
  const compte = (f: Filtre) => data.filter(FILTRES[f]).length;

  return (
    <div className="space-y-6">
      <EnTete
        surtitre="Le cabinet"
        titre="Actualités"
        texte="Appels à projets, opportunités de financement, informations importantes et rendez-vous de MB AxisPro Consulting."
      />

      {aConfirmer.length > 0 && (
        <Notice tone="warn">
          {aConfirmer.length === 1 ? (
            <>
              Le cabinet vous demande de confirmer la lecture de{" "}
              <Link href={`/portail/actualites/${aConfirmer[0]!.id}`} className="font-semibold underline underline-offset-2">« {aConfirmer[0]!.title} »</Link>.
            </>
          ) : (
            <>Le cabinet vous demande de confirmer la lecture de {aConfirmer.length} communications, marquées « À confirmer ».</>
          )}
        </Notice>
      )}

      {data.length === 0 ? (
        <Card>
          <Empty title={VIDE.toutes} hint="Le cabinet publie ici les appels à projets, les informations utiles à votre dossier et ses rendez-vous. Vous serez prévenu à chaque nouvelle communication." />
        </Card>
      ) : (
        <>
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <Segmented<Filtre>
              label="Filtrer les communications"
              value={filtre}
              onChange={setFiltre}
              options={[
                { key: "toutes", label: `Toutes (${data.length})` },
                { key: "opportunites", label: `Opportunités (${compte("opportunites")})` },
                { key: "importantes", label: `Importantes (${compte("importantes")})` },
                { key: "non-lues", label: `Non lues (${nonLues})` },
              ]}
            />
          </div>

          <p aria-live="polite" className="sr-only">{pluriel(visibles.length, "communication")}</p>

          {visibles.length === 0 && (
            <Card>
              <Empty title={VIDE[filtre]} hint={filtre === "non-lues" ? "Les nouvelles communications du cabinet apparaîtront ici." : "Essayez un autre filtre."} />
            </Card>
          )}

          {epinglees.length > 0 && (
            <section aria-labelledby="actualites-epinglees">
              <TitreSection id="actualites-epinglees">À retenir</TitreSection>
              <ul className={cx("grid gap-4", epinglees.length > 1 && "lg:grid-cols-2")}>
                {epinglees.map((a) => (
                  <li key={a.id}>
                    <CarteActualite a={a} epinglee />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {parMois.map((g) => (
            <section key={g.cle} aria-labelledby={`mois-${g.cle}`}>
              <TitreSection id={`mois-${g.cle}`} compte={g.items.length}>{g.titre}</TitreSection>
              <ul className="space-y-3">
                {g.items.map((a) => (
                  <li key={a.id}>
                    <CarteActualite a={a} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
