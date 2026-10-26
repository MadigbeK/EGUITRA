"use client";

import { useState } from "react";
import { FileUp, X } from "@/components/icons";
import { Button, Card, ErrorBox, Etat, Field, Input, Select, type Tri } from "@/components/ui";
import { TYPE_VEHICULE, nomRotation } from "@/components/hsseq/commun";
import { Bascule, ChampSite, Pages, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { moisLong } from "@/components/hsseq/cockpit/outils";
import { useApi } from "@/lib/api-client";
import { INSECABLE, pluriel } from "@/lib/format";
import type { Page, Referentials, ViolationType } from "@/lib/hsseq-types";
import { ListeViolations, type LigneViolation } from "./ListeViolations";
import {
  ORDRE_TYPES,
  SANS_FILTRE,
  TRIS,
  TRI_DEFAUT,
  TYPE_VIOLATION,
  aujourdhui,
  filtresActifs,
  moisCourant,
  moisProposes,
  releve,
  versApi,
  type FiltresViolations,
} from "./outils";
import type { Violation, ViolationCounts } from "./types";

/** Violations par page (limite par défaut du noyau). */
const PAR_PAGE = 50;

type Ecrire = (maj: Record<string, string | number | null>) => void;
type PageViolations = Page<Violation, ViolationCounts>;

const LIEN = "font-semibold text-accent underline-offset-2 hover:underline";

/** « octobre 2026 » → « Octobre 2026 ». */
const capitale = (texte: string) => texte.charAt(0).toLocaleUpperCase("fr") + texte.slice(1);

/**
 * Violations de conduite (GET /hsseq/telematics/violations) : bascules des types avec leur nombre,
 * période, site, véhicule et conducteur portés par l'adresse, puis la liste de la plus récente à la plus
 * ancienne (ou par type). Le chef de parc et l'auditeur ne reçoivent du noyau que les véhicules de leurs
 * sites ; l'auditeur (`nomsCaches`) ni le nom des conducteurs, ni leur filtre. Un nom de véhicule ou de
 * conducteur pose son filtre ; `import` borne la liste aux violations d'un import (onglet « Imports »).
 */
export function Violations({ f, ecrire, importeur, nomsCaches }: { f: FiltresViolations; ecrire: Ecrire; importeur: boolean; nomsCaches: boolean }) {
  const { data: ref } = useReferentiels();
  const api = versApi(f);
  const cle = `${requete(api)}|${f.tri}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const { data, error, mutate } = useApi<PageViolations>(`/hsseq/telematics/violations?${requete({ ...api, sort: f.tri, offset, limit: PAR_PAGE })}`, { keepPreviousData: true });
  // Le noyau compte chaque type sur la sélection filtrée, type compris : les bascules lisent leur
  // nombre dans une sélection sans filtre de type, pour garder celui des types non choisis.
  const { data: sansType } = useApi<PageViolations>(f.types.length ? `/hsseq/telematics/violations?${requete({ ...versApi(f, true), limit: 1 })}` : null, { keepPreviousData: true });
  const parType = (f.types.length ? sansType : data)?.counts.by_type;

  const borne = Boolean(ref?.me.site_ids.length);
  const plusieursSites = !f.site && (!ref || ref.me.site_ids.length !== 1);
  const tri: Tri = { key: f.tri.replace(/^-/, ""), dir: f.tri.startsWith("-") ? -1 : 1 };

  const lignes: LigneViolation[] = (data?.items ?? []).map((v) => ({
    cle: v.id,
    moment: v.occurred_at,
    type: v.violation_type,
    releve: releve(v),
    vehicule: v.vehicle.name,
    detailVehicule: [TYPE_VEHICULE[v.vehicle.vehicle_kind], v.vehicle.plate, plusieursSites ? v.site?.name : null].filter(Boolean).join(", "),
    conducteur: v.driver?.name ?? null,
    rotation: v.rotation ? [nomRotation(v.rotation), v.rotation.route_name].filter(Boolean).join(", ") : "Hors rotation",
    lieu: v.location,
    source: [v.source, v.external_id ? `réf. ${v.external_id}` : null].filter(Boolean).join(", "),
    onVehicule: f.vehicule === v.vehicle.id ? undefined : () => ecrire({ vehicule: v.vehicle.id }),
    onConducteur: nomsCaches || !v.driver || f.conducteur === v.driver.id ? undefined : () => ecrire({ conducteur: v.driver!.id }),
  }));
  const nomImport = f.import ? (data?.items.find((v) => v.import?.id === f.import)?.import?.name ?? null) : null;

  const vide = filtresActifs(f)
    ? { titre: "Aucune violation pour ces filtres.", aide: "Élargissez la période, ou retirez un type, un véhicule ou un conducteur." }
    : borne
      ? { titre: "Aucune violation sur les véhicules de vos sites.", aide: "La liste montre les violations des ensembles rattachés à vos sites, importées par le Responsable HSSEQ." }
      : { titre: "Aucune violation importée.", aide: importeur ? `Importez l'export des boîtiers (CSV ou Excel) dans l'onglet «${INSECABLE}Imports${INSECABLE}».` : "Le Responsable HSSEQ importe les violations relevées par les boîtiers des véhicules (OBC, GPS, IVMS)." };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <ChampPeriode f={f} ecrire={ecrire} />
          <ChampSite ref_={ref} valeur={f.site ? String(f.site) : ""} onChange={(v) => ecrire({ site: v || null, vehicule: null })} />
          <ChampVehicule ref_={ref} f={f} ecrire={ecrire} />
          {!nomsCaches && <ChampConducteur ref_={ref} f={f} ecrire={ecrire} />}
          {filtresActifs(f) && (
            <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => ecrire(SANS_FILTRE)}>
              <X className="h-3.5 w-3.5" /> Effacer les filtres
            </Button>
          )}
        </div>
        <div role="group" aria-label="Types de violation" className="flex flex-wrap gap-2">
          {ORDRE_TYPES.map((t) => (
            <Bascule key={t} actif={f.types.includes(t)} onChange={(actif) => ecrire({ type: basculer(f.types, t, actif) })} nombre={parType?.[t]}>
              {TYPE_VIOLATION[t].label}
            </Bascule>
          ))}
        </div>
        {(nomsCaches || borne) && (
          <p className="text-[12.5px] leading-snug text-muted">
            {borne ? "Véhicules de vos sites seulement." : ""}
            {nomsCaches ? `${borne ? " " : ""}Les conducteurs ne sont pas nommés au profil auditeur.` : ""}
          </p>
        )}
      </div>

      {f.import && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-accent-doux px-3.5 py-2 text-[13px] text-ink">
          <span className="min-w-0 break-words">{nomImport ? `Violations créées par l'import «${INSECABLE}${nomImport}${INSECABLE}»` : "Violations créées par l'import choisi"}</span>
          <button
            type="button"
            onClick={() => ecrire({ import: null })}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-ink-2 transition-colors hover:bg-panel hover:text-ink"
          >
            <X className="h-3.5 w-3.5" /> Toutes les violations
          </button>
        </div>
      )}

      <Card
        padded={false}
        title={data ? capitale(pluriel(data.total_count, "violation")) : "Violations"}
        actions={
          importeur ? (
            <Button size="sm" onClick={() => ecrire({ onglet: "imports" })}>
              <FileUp className="h-3.5 w-3.5" /> Importer un fichier
            </Button>
          ) : undefined
        }
      >
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des violations…" />
        ) : (
          <>
            {error && (
              <div className="px-5 pb-3">
                <ErrorBox error={error} onRetry={() => void mutate()} titre="La liste n'a pas pu être relue ; elle est affichée telle qu'au dernier chargement." />
              </div>
            )}
            <ListeViolations
              lignes={lignes}
              nomsCaches={nomsCaches}
              tri={tri}
              onTri={(t) => {
                if (!(TRIS as readonly string[]).includes(t.key)) return;
                const sens = `${t.dir === -1 ? "-" : ""}${t.key}`;
                ecrire({ tri: sens === TRI_DEFAUT ? null : sens });
              }}
              vide={vide}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="violations" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>
      {data && data.total_count > 0 && (
        <p className="text-[12.5px] leading-snug text-muted">
          Heures de Conakry. Un nom de véhicule{nomsCaches ? "" : " ou de conducteur"} borne la liste à ses violations.{" "}
          {f.tri !== TRI_DEFAUT && (
            <button type="button" className={LIEN} onClick={() => ecrire({ tri: null })}>
              Revenir aux plus récentes d&apos;abord
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Types choisis après un clic sur une bascule, dans l'ordre du noyau ; vide : tous les types. */
function basculer(types: ViolationType[], type: ViolationType, actif: boolean): string | null {
  const suite = ORDRE_TYPES.filter((t) => (t === type ? actif : types.includes(t)));
  return suite.length ? suite.join(",") : null;
}

/** Période : toutes les dates, l'un des douze derniers mois, ou des dates choisies (du, au). */
function ChampPeriode({ f, ecrire }: { f: FiltresViolations; ecrire: Ecrire }) {
  const choix = f.mois ?? (f.du || f.au ? "dates" : "");
  const mois = moisProposes();
  // Un mois plus ancien venu d'un lien reste lisible dans la liste.
  if (f.mois && !mois.includes(f.mois)) mois.push(f.mois);
  return (
    <>
      <Field label="Période" className="w-full sm:w-48">
        <Select
          value={choix}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "dates") ecrire({ mois: null, du: f.du ?? `${moisCourant()}-01`, au: f.au ?? aujourdhui() });
            else ecrire({ mois: v || null, du: null, au: null });
          }}
          placeholder="Toutes les dates"
          options={[...mois.map((m) => ({ value: m, label: capitale(moisLong(m)) })), { value: "dates", label: "Dates choisies" }]}
        />
      </Field>
      {/* Une borne vidée alors que l'autre l'est déjà est ignorée : les dates choisies restent affichées. */}
      {choix === "dates" && (
        <>
          <Field label="Du" className="w-[calc(50%-6px)] sm:w-40">
            <Input type="date" value={f.du ?? ""} max={f.au ?? undefined} onChange={(e) => (e.target.value || f.au) && ecrire({ du: e.target.value || null })} />
          </Field>
          <Field label="Au" className="w-[calc(50%-6px)] sm:w-40">
            <Input type="date" value={f.au ?? ""} min={f.du ?? undefined} onChange={(e) => (e.target.value || f.du) && ecrire({ au: e.target.value || null })} />
          </Field>
        </>
      )}
    </>
  );
}

/** Véhicule : les ensembles du site choisi, sinon ceux des sites du compte (tous pour une lecture complète). */
function ChampVehicule({ ref_, f, ecrire }: { ref_: Referentials | undefined; f: FiltresViolations; ecrire: Ecrire }) {
  const sites = f.site ? [f.site] : ref_?.me.site_ids.length ? ref_.me.site_ids : null;
  const vehicules = (ref_?.vehicles ?? [])
    .filter((v) => !sites || (v.site_id !== null && sites.includes(v.site_id)) || v.id === f.vehicule)
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
  return (
    <Field label="Véhicule" className="w-full sm:w-48">
      <Select
        value={f.vehicule ? String(f.vehicule) : ""}
        onChange={(e) => ecrire({ vehicule: e.target.value || null })}
        placeholder="Tous"
        options={vehicules.map((v) => ({ value: v.id, label: `${v.name}, ${TYPE_VEHICULE[v.vehicle_kind].toLocaleLowerCase("fr")}` }))}
      />
    </Field>
  );
}

/** Conducteur : tous les conducteurs des sociétés, par nom (un conducteur peut changer d'ensemble). */
function ChampConducteur({ ref_, f, ecrire }: { ref_: Referentials | undefined; f: FiltresViolations; ecrire: Ecrire }) {
  const conducteurs = [...(ref_?.drivers ?? [])].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return (
    <Field label="Conducteur" className="w-full sm:w-56">
      <Select value={f.conducteur ? String(f.conducteur) : ""} onChange={(e) => ecrire({ conducteur: e.target.value || null })} placeholder="Tous" options={conducteurs.map((d) => ({ value: d.id, label: d.name }))} />
    </Field>
  );
}
