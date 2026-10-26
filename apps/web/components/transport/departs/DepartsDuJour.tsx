"use client";

/**
 * Transport, « Départs du jour » : rotations à charger ce jour-là, pas encore en route
 * (GET /hsseq/lock/departures), chacune avec l'état de son départ (Autorisé, À contrôler ou Bloqué)
 * et ses motifs ouverts. Un clic ouvre le panneau du verrou (VerrouDepart) : vérification, motifs,
 * dérogation, départ (profils admin, finance et exploitation ; chef de parc seul quand le verrou est
 * en service pour la rotation). Avant la mise en service du verrou (lock_active faux), le départ est
 * permis et les motifs s'affichent pour information ; les avertissements ne bloquent jamais.
 */

import { useMemo, useState } from "react";
import { FenetreVerrou } from "@/components/transport/VerrouDepart";
import { Card, DataTable, ErrorBox, Etat, Field, Kpi, Notice, Segmented, Select } from "@/components/ui";
import { HORS_VERROU, TYPE_VEHICULE, Tampon, etatDepart, nomRotation } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import { fmtInt, pluriel } from "@/lib/format";
import type { Departure, Departures, HsseqSite, LockEvaluation } from "@/lib/hsseq-types";
import { LigneMotif, RANG_ETAT, avertissements, heure, jourLong, motifsBloquants, saisiesSeules } from "./motifs";

type EtatDepart = "Autorisé" | "À contrôler" | "Bloqué" | "En route" | typeof HORS_VERROU;
type Filtre = "tous" | EtatDepart;

/** Départ lu par l'écran : celui de la liste, mis à jour par le panneau (évaluation, départ). */
type Ligne = Departure & { etat: EtatDepart; parti: string | null };

export function DepartsDuJour() {
  const [site, setSite] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [ouvert, setOuvert] = useState<Ligne | null>(null);
  // Évaluations reçues par le panneau et départs faits pendant la séance, par rotation.
  const [evaluations, setEvaluations] = useState<Record<number, LockEvaluation>>({});
  const [partis, setPartis] = useState<Record<number, string>>({});
  const { data: sites } = useApi<HsseqSite[]>("/hsseq/sites");
  const { data, error, mutate } = useApi<Departures>(`/hsseq/lock/departures${site ? `?site_id=${site}` : ""}`, { keepPreviousData: true });

  const lignes = useMemo<Ligne[]>(() => {
    const liste = (data?.items ?? []).map((d) => {
      const recue = evaluations[d.rotation.id];
      const plusRecente = recue && recue.checked_at > d.evaluation.checked_at;
      const maj: Departure = plusRecente ? { ...d, evaluation: recue, pending_checks_only: saisiesSeules(recue) } : d;
      const parti = partis[d.rotation.id] ?? null;
      return { ...maj, parti, etat: parti ? "En route" : etatDepart(maj) } satisfies Ligne;
    });
    // Ce qui demande une action d'abord, puis par véhicule.
    return liste.sort((a, b) => (RANG_ETAT[a.etat] ?? 9) - (RANG_ETAT[b.etat] ?? 9) || a.vehicle.name.localeCompare(b.vehicle.name, "fr"));
  }, [data, evaluations, partis]);

  const compte = (etat: EtatDepart) => lignes.filter((l) => l.etat === etat).length;
  const bloques = compte("Bloqué");
  const aControler = compte("À contrôler");
  const autorises = compte("Autorisé");
  const enRoute = compte("En route");
  const horsVerrou = compte(HORS_VERROU);
  const visibles = filtre === "tous" ? lignes : lignes.filter((l) => l.etat === filtre);
  const courant = ouvert ? (lignes.find((l) => l.rotation.id === ouvert.rotation.id) ?? ouvert) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Départs prévus" value={data ? fmtInt(lignes.length) : "–"} hint={data ? `${jourLong(data.date)}${enRoute ? `, ${pluriel(enRoute, "parti", "partis")}` : ""}` : undefined} />
        <Kpi label="Autorisés" value={data ? fmtInt(autorises) : "–"} tone={autorises ? "ok" : "neutral"} hint={horsVerrou ? `Aucun motif bloquant, ou couvert ; plus ${pluriel(horsVerrou, "départ")} hors verrou` : "Aucun motif bloquant, ou couvert par une dérogation"} />
        <Kpi label="À contrôler" value={data ? fmtInt(aControler) : "–"} tone={aControler ? "warn" : "neutral"} hint="Contrôle avant départ ou alcootest à faire sur NIMOVA Terrain" />
        <Kpi label="Bloqués" value={data ? fmtInt(bloques) : "–"} tone={bloques ? "danger" : "neutral"} hint="Motif à lever, ou à déroger quand il le permet" />
      </div>

      {horsVerrou > 0 && (
        <Notice tone="neutral">
          {`Verrou pas encore en service pour ${pluriel(horsVerrou, "départ")} : rotations chargées avant sa date de mise en service (paramètres HSSEQ). Elles partent comme avant ; leurs motifs s'affichent pour information.`}
        </Notice>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmented<Filtre>
          label="État du départ"
          className="max-w-full overflow-x-auto"
          value={filtre}
          onChange={setFiltre}
          options={[
            { key: "tous", label: `Tous, ${lignes.length}` },
            { key: "Bloqué", label: `Bloqués, ${bloques}` },
            { key: "À contrôler", label: `À contrôler, ${aControler}` },
            { key: "Autorisé", label: `Autorisés, ${autorises}` },
            ...(horsVerrou ? [{ key: HORS_VERROU as Filtre, label: `Hors verrou, ${horsVerrou}` }] : []),
            ...(enRoute ? [{ key: "En route" as const, label: `En route, ${enRoute}` }] : []),
          ]}
        />
        <Field label="Site" className="w-full sm:w-64">
          <Select value={site} onChange={(e) => setSite(e.target.value)} placeholder="Tous les sites" options={(sites ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
      </div>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => mutate()} label="Évaluation des départs du jour…" />
        ) : (
          <>
            {error && (
              <div className="px-5 pt-4">
                <ErrorBox error={error} onRetry={() => mutate()} titre="Les départs n'ont pas pu être relus ; la liste affichée est la précédente." />
              </div>
            )}
            <DataTable
              rows={visibles}
              rowKey={(l) => l.rotation.id}
              onRowClick={(l) => setOuvert(l)}
              empty={lignes.length ? "Aucun départ dans cet état." : "Aucun départ prévu ce jour."}
              columns={[
                {
                  key: "vehicle",
                  label: "Véhicule",
                  sortValue: (l) => l.vehicle.name,
                  render: (l) => (
                    <div className="whitespace-nowrap">
                      <div className="font-semibold text-ink">{l.vehicle.name}</div>
                      <div className="text-[12px] text-muted">
                        {TYPE_VEHICULE[l.vehicle.vehicle_kind]}
                        {l.vehicle.plate ? `, ${l.vehicle.plate}` : ""}
                      </div>
                    </div>
                  ),
                },
                { key: "driver", label: "Conducteur", sortValue: (l) => l.driver?.name ?? "", render: (l) => l.driver?.name ?? <span className="text-muted">Non affecté</span> },
                {
                  key: "rotation",
                  label: "Rotation",
                  sortValue: (l) => l.rotation.route_name ?? "",
                  render: (l) => (
                    <div>
                      <div className="whitespace-nowrap font-mono text-xs text-ink">{nomRotation(l.rotation)}</div>
                      <div className="text-[12px] text-muted">{l.rotation.route_name ?? "–"}</div>
                    </div>
                  ),
                },
                { key: "site", label: "Site", sortValue: (l) => l.site?.name ?? "", render: (l) => l.site?.name ?? "–" },
                { key: "etat", label: "État", sortValue: (l) => RANG_ETAT[l.etat] ?? 9, render: (l) => <Tampon mot={l.etat} /> },
                {
                  key: "motifs",
                  label: "Motifs",
                  sortValue: (l) => motifsBloquants(l.evaluation).length,
                  render: (l) =>
                    l.parti ? (
                      <span className="text-[13px] text-ink-2">Parti à {heure(l.parti)}</span>
                    ) : l.evaluation.reasons.length || avertissements(l.evaluation).length ? (
                      <ul className="min-w-[280px] space-y-2">
                        {[...l.evaluation.reasons, ...avertissements(l.evaluation)].map((r, i) => (
                          <li key={`${r.code}-${i}`}>
                            <LigneMotif motif={r} jour={data.date} dense />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-[13px] text-muted">Aucun motif</span>
                    ),
                },
              ]}
            />
          </>
        )}
      </Card>

      {courant && (
        <FenetreVerrou
          rotationId={courant.rotation.id}
          depart={courant}
          onClose={() => setOuvert(null)}
          onChange={() => void mutate()}
          onEvaluation={(e) => setEvaluations((v) => ({ ...v, [e.rotation_id]: e }))}
          onParti={(id, at) => setPartis((p) => ({ ...p, [id]: at }))}
        />
      )}
    </div>
  );
}
