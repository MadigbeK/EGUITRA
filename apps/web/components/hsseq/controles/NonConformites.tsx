"use client";

import Link from "next/link";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { Button, Card, DataTable, ErrorBox, Etat, Notice, Segmented } from "@/components/ui";
import { MotifCode, STATUT_NON_CONFORMITE, Tampon, nomRotation } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import { fmtDateTime, fmtInt, pluriel } from "@/lib/format";
import type { Nonconformity, Page, Referentials } from "@/lib/hsseq-types";
import { Bascule, Pages, requete } from "@/components/hsseq/actions/outils";
import { ChampSite, ChampVehicule, PhotoManquante, Vehicule } from "./elements";
import { LeverNonConformite } from "./Levee";

/** Nombres servis avec la liste des non-conformités (§7). */
interface NcCounts {
  open: number;
  blocking_open: number;
}

const PAR_PAGE = 50;

type FiltreStatut = "ouvertes" | "levees" | "toutes";
const STATUT_API: Record<FiltreStatut, "open" | "lifted" | null> = { ouvertes: "open", levees: "lifted", toutes: null };

/**
 * Non-conformités des contrôles avant départ, ouvertes et levées. Une non-conformité bloquante
 * ouverte bloque le véhicule au départ (V02), d'une rotation à l'autre, jusqu'à sa levée par le chef
 * de parc (ou le Responsable HSSEQ), photo de la correction à l'appui.
 */
export function NonConformites({ ref_, lire, ecrire }: { ref_: Referentials | undefined; lire: (cle: string) => string; ecrire: (maj: Record<string, string | number | null>) => void }) {
  const statut: FiltreStatut = (["levees", "toutes"] as string[]).includes(lire("statut")) ? (lire("statut") as FiltreStatut) : "ouvertes";
  const bloquantes = lire("bloquantes") === "1";
  const site = lire("site");
  const vehicule = lire("vehicule");
  const filtres = { site_id: site || null, vehicle_id: vehicule || null };
  const cle = `${requete(filtres)}|${statut}|${bloquantes}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [levee, setLevee] = useState<Nonconformity | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { mutate: muter } = useSWRConfig();

  // Nombres sans le statut ni la bascule (ouvertes, bloquantes ouvertes, total) ; liste filtrée.
  const { data: compte } = useApi<Page<Nonconformity, NcCounts>>(`/hsseq/checks/nonconformities?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<Nonconformity, NcCounts>>(
    `/hsseq/checks/nonconformities?${requete({ ...filtres, status: STATUT_API[statut], blocking: bloquantes ? 1 : null, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const ouvertes = compte?.counts.open ?? 0;
  const bloquantesOuvertes = compte?.counts.blocking_open ?? 0;
  const total = compte?.total_count ?? 0;

  return (
    <div className="space-y-5">
      {message && <Notice tone="ok">{message}</Notice>}
      {bloquantesOuvertes > 0 && (
        <Notice tone="danger">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <MotifCode code="V02" />
            <span>
              {pluriel(bloquantesOuvertes, "non-conformité bloquante ouverte", "non-conformités bloquantes ouvertes")} : chaque véhicule concerné reste bloqué au départ, d&apos;une rotation à l&apos;autre, jusqu&apos;à la levée par le chef de parc, photo de la correction à l&apos;appui.
            </span>
          </span>
        </Notice>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented
            label="Non-conformités affichées"
            value={statut}
            onChange={(s) => ecrire({ statut: s === "ouvertes" ? null : s })}
            options={[
              { key: "ouvertes", label: `Ouvertes (${fmtInt(ouvertes)})` },
              { key: "levees", label: `Levées (${fmtInt(Math.max(0, total - ouvertes))})` },
              { key: "toutes", label: `Toutes (${fmtInt(total)})` },
            ]}
          />
        </div>
        <Bascule actif={bloquantes} onChange={(v) => ecrire({ bloquantes: v ? "1" : null })} nombre={statut === "ouvertes" ? bloquantesOuvertes : undefined}>
          Bloquantes seulement
        </Bascule>
        <ChampSite ref_={ref_} valeur={site} onChange={(v) => ecrire({ site: v, vehicule: null })} />
        <ChampVehicule ref_={ref_} valeur={vehicule} site={site} onChange={(v) => ecrire({ vehicule: v })} />
      </div>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des non-conformités…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(n) => n.id}
              onRowClick={(n) => ecrire({ controle: n.check.id })}
              empty={statut === "ouvertes" ? "Aucune non-conformité ouverte." : "Aucune non-conformité pour ces filtres."}
              columns={[
                {
                  key: "item",
                  label: "Point non conforme",
                  sortValue: (n) => n.item.label,
                  render: (n) => (
                    <span className="flex min-w-[14rem] max-w-[40ch] flex-col gap-1">
                      <span className="leading-snug text-ink">{n.item.label}</span>
                      {n.item.blocking ? <span className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">Point critique</span> : <span className="text-[12px] text-muted">Non bloquant</span>}
                      {n.comment && <span className="line-clamp-2 text-[12px] leading-snug text-ink-2">{n.comment}</span>}
                    </span>
                  ),
                },
                {
                  key: "vehicle",
                  label: "Véhicule",
                  sortValue: (n) => n.vehicle.name,
                  render: (n) => (
                    <span className="inline-flex flex-col gap-1">
                      <Vehicule v={n.vehicle} />
                      {n.item.blocking && n.status === "open" && (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold text-danger">
                          <MotifCode code="V02" /> Départ bloqué
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "found_at",
                  label: "Constatée le",
                  sortValue: (n) => n.found_at,
                  render: (n) => (
                    <span className="inline-flex flex-col">
                      <span className="whitespace-nowrap">{fmtDateTime(n.found_at)}</span>
                      <span className="whitespace-nowrap text-[12px] text-muted">
                        {n.check.reference}
                        {n.rotation ? `, ${nomRotation(n.rotation)}` : ""}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "photos",
                  label: "Photos",
                  sortValue: (n) => n.photos.length,
                  render: (n) => (n.photos_missing ? <PhotoManquante /> : <span className="whitespace-nowrap text-ink-2">{pluriel(n.photos.length, "photo")}</span>),
                },
                {
                  key: "status",
                  label: "Statut",
                  sortValue: (n) => n.status,
                  render: (n) => (
                    <span className="inline-flex flex-col items-start gap-1">
                      <span className="inline-flex flex-wrap gap-1.5">
                        {n.item.blocking && n.status === "open" && <Tampon mot="Bloquante" />}
                        <Tampon mot={STATUT_NON_CONFORMITE[n.status]} />
                      </span>
                      {n.status === "lifted" && (
                        <span className="text-[12px] leading-snug text-muted">
                          Le {fmtDateTime(n.lifted_at)}
                          {n.lifted_by ? `, ${n.lifted_by.name}` : ""}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "commandes",
                  label: "",
                  render: (n) => (
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      {n.action && (
                        <Link href={`/hsseq/actions?action=${n.action.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline">
                          Action {n.action.reference}
                        </Link>
                      )}
                      {n.status === "open" && n.rights.can_close && (
                        <Button
                          size="sm"
                          variant="primary"
                          aria-label={`Lever la non-conformité « ${n.item.label} » sur ${n.vehicle.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMessage(null);
                            setLevee(n);
                          }}
                        >
                          Lever
                        </Button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="non-conformités" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>

      {levee && (
        <LeverNonConformite
          nc={levee}
          onClose={() => setLevee(null)}
          onLevee={(c) => {
            void muter(`/hsseq/checks/${c.id}`, c, { revalidate: false });
            setMessage(`Non-conformité « ${levee.item.label} » levée sur ${levee.vehicle.name}.`);
            setLevee(null);
          }}
        />
      )}
    </div>
  );
}
