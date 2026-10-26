"use client";

import { useState } from "react";
import { Card, DataTable, ErrorBox, Etat, Field, Kpi, Segmented, Select, Tag, type Tri } from "@/components/ui";
import { RESULTAT_CONTROLE, Tampon, TYPE_VEHICULE, nomRotation } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtDateTime, fmtInt, fmtPct, pluriel } from "@/lib/format";
import type { CheckCounts, CheckLine, CheckResult, Page, Referentials, VehicleKind } from "@/lib/hsseq-types";
import { Pages, requete } from "@/components/hsseq/actions/outils";
import { ChampSite, ChampVehicule, ChampsPeriode, PhotoManquante, TYPE_ADRESSE, Vehicule, periode } from "./elements";

const PAR_PAGE = 50;

/** Tris servis par le noyau (sort de GET /hsseq/checks) ; les autres colonnes ne se trient pas. */
const TRIS = ["reported_at", "result", "reference"] as const;

/** Résultat dans l'adresse et sa clé dans l'API. */
const RESULTAT_ADRESSE: Record<string, CheckResult> = { conforme: "compliant", reserves: "non_compliant", bloquant: "blocking" };
type FiltreResultat = "tous" | "conforme" | "reserves" | "bloquant";

/**
 * Contrôles avant départ réalisés : taux de départs contrôlés et de conformité sur la période, liste
 * des contrôles (véhicule, rotation, conducteur, profil citerne ou benne, résultat, saisie hors ligne,
 * photos manquantes) ; un clic ouvre la fiche du contrôle à côté de la liste.
 */
export function ControlesRealises({ ref_, lire, ecrire, choisi }: { ref_: Referentials | undefined; lire: (cle: string) => string; ecrire: (maj: Record<string, string | number | null>) => void; choisi: number | null }) {
  const { du, au } = periode(lire);
  const site = lire("site");
  const type: VehicleKind | null = TYPE_ADRESSE[lire("type")] ?? null;
  const vehicule = lire("vehicule");
  const resultat: FiltreResultat = lire("resultat") in RESULTAT_ADRESSE ? (lire("resultat") as FiltreResultat) : "tous";

  const filtres = { date_from: du, date_to: au, site_id: site || null, vehicle_kind: type, vehicle_id: vehicule || null };
  const cle = `${requete(filtres)}|${resultat}`;
  const [tri, setTri] = useState<Tri>({ key: "reported_at", dir: -1 });
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;

  // Nombres de la période sans le filtre de résultat (chiffres clés, bascule) ; liste filtrée.
  const { data: compte } = useApi<Page<CheckLine, CheckCounts>>(`/hsseq/checks?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<CheckLine, CheckCounts>>(`/hsseq/checks?${requete({ ...filtres, result: resultat === "tous" ? null : RESULTAT_ADRESSE[resultat], sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`, { keepPreviousData: true });

  const n = compte?.counts;
  const total = compte?.total_count ?? 0;
  const departs = n?.departures ?? 0;
  const tauxDeparts = n && departs ? ((n.departures_checked ?? 0) / departs) * 100 : null;
  const tauxConformite = n && total ? ((n.by_result.compliant + n.by_result.non_compliant) / total) * 100 : null;
  const bloquants = n?.by_result.blocking ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <ChampsPeriode du={du} au={au} ecrire={ecrire} />
        <ChampSite ref_={ref_} valeur={site} onChange={(v) => ecrire({ site: v, vehicule: null })} />
        <Field label="Profil" className="w-full sm:w-36">
          <Select
            value={lire("type")}
            onChange={(e) => ecrire({ type: e.target.value, vehicule: null })}
            placeholder="Tous"
            options={Object.entries(TYPE_ADRESSE).map(([cle, v]) => ({ value: cle, label: TYPE_VEHICULE[v] }))}
          />
        </Field>
        <ChampVehicule ref_={ref_} valeur={vehicule} type={type} site={site} onChange={(v) => ecrire({ vehicule: v })} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          label="Départs contrôlés"
          value={tauxDeparts === null ? "–" : fmtPct(tauxDeparts, 1)}
          tone={tauxDeparts === null ? "neutral" : tauxDeparts >= 100 ? "ok" : "danger"}
          hint={n ? `${fmtInt(n.departures_checked ?? 0)} sur ${pluriel(departs, "départ")} ; objectif 100${INSECABLE}%` : undefined}
        />
        <Kpi
          label="Conformité des contrôles"
          value={tauxConformite === null ? "–" : fmtPct(tauxConformite, 1)}
          tone={tauxConformite === null ? "neutral" : tauxConformite >= 95 ? "ok" : "danger"}
          hint={`Sans point critique non conforme ; objectif 95${INSECABLE}% au moins`}
        />
        <Kpi
          label="Contrôles bloquants"
          value={n ? fmtInt(bloquants) : "–"}
          tone={!n ? "neutral" : bloquants > 0 ? "danger" : "ok"}
          hint="Point critique non conforme : départ bloqué (V02) jusqu'à la levée"
        />
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented
          label="Résultat des contrôles affichés"
          value={resultat}
          onChange={(r) => ecrire({ resultat: r === "tous" ? null : r })}
          options={[
            { key: "tous", label: `Tous (${fmtInt(total)})` },
            { key: "conforme", label: `Conformes (${fmtInt(n?.by_result.compliant ?? 0)})` },
            { key: "reserves", label: `Avec réserves (${fmtInt(n?.by_result.non_compliant ?? 0)})` },
            { key: "bloquant", label: `Bloquants (${fmtInt(bloquants)})` },
          ]}
        />
      </div>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des contrôles…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(c) => c.id}
              sort={tri}
              onSort={(t) => {
                if (!(TRIS as readonly string[]).includes(t.key)) return;
                setTri(t);
                setPosition({ cle, offset: 0 });
              }}
              onRowClick={(c) => ecrire({ controle: c.id })}
              empty="Aucun contrôle avant départ pour ces filtres."
              columns={[
                {
                  key: "reference",
                  label: "Contrôle",
                  render: (c) => (
                    <span className="inline-flex flex-col">
                      <span className="whitespace-nowrap font-mono text-[12px] text-ink">{c.reference}</span>
                      <span className="text-[12px] text-muted">{`${c.template.name}, version ${c.template.version}`}</span>
                      {choisi === c.id && <span className="sr-only">(fiche ouverte)</span>}
                    </span>
                  ),
                },
                { key: "reported_at", label: "Saisi le", render: (c) => <span className="whitespace-nowrap">{fmtDateTime(c.reported_at)}</span> },
                { key: "vehicle", label: "Véhicule", sortValue: (c) => c.vehicle.name, render: (c) => <Vehicule v={c.vehicle} /> },
                { key: "rotation", label: "Rotation", sortValue: (c) => c.rotation?.name ?? c.rotation?.date_loading ?? null, render: (c) => <span className="whitespace-nowrap">{nomRotation(c.rotation)}</span> },
                { key: "driver", label: "Conducteur", sortValue: (c) => c.driver?.name ?? null, render: (c) => c.driver?.name ?? <span className="text-muted">–</span> },
                {
                  key: "result",
                  label: "Résultat",
                  render: (c) => (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <Tampon mot={RESULTAT_CONTROLE[c.result]} />
                      {c.open_nonconformities > 0 && <Tag>{pluriel(c.open_nonconformities, "non-conformité ouverte", "non-conformités ouvertes")}</Tag>}
                      {c.photos_missing && <PhotoManquante pluriel />}
                    </span>
                  ),
                },
              ]}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="contrôles" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>
    </div>
  );
}
