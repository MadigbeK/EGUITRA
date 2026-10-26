"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Segmented, Select, cx, type Column, type Tri } from "@/components/ui";
import { fmtIndicateur, nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { AvecFiche, ChampSite, Pages, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { useEtroit } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtInt, fmtM3 } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { ChampsPeriode, Chiffre, ExportRegistres, NATURE_CONTAMINATION, ORDRE_CONTAMINATIONS, STATUT_CONTAMINATION, Situation, TamponEnv, filtresCommuns, nombre, parmi, useRafraichir, type VueProps } from "./commun";
import { FenetreContamination } from "./fenetres";
import { FicheContamination } from "./FicheContamination";
import type { Contamination, ContaminationCounts, ContaminationLine, ContaminationNature, ContaminationStatus, Deliveries } from "./types";

const PAR_PAGE = 50;

/** Statut dans l'adresse et sa clé dans l'API. */
const STATUT_ADRESSE: Record<"ouvertes" | "closes" | "toutes", ContaminationStatus | null> = { ouvertes: "open", closes: "closed", toutes: null };
type FiltreStatut = keyof typeof STATUT_ADRESSE;

const TRIS = ["detected_on", "reference", "status"];

/**
 * Manquants et contaminations de produit (vue « produit ») : contaminations saisies par le Responsable
 * HSSEQ (GET /hsseq/contaminations), avec leur constat en tête de ligne, et en tête de vue les manquants
 * des citernes de la période à 15 °C, calculés par Transport (GET /hsseq/environment/deliveries), dont
 * le détail est dans « Consommation et livraisons ».
 * Filtres par statut (ouvertes par défaut), nature, site et période, portés par l'adresse avec la fiche
 * ouverte (contamination). Ni le chef de parc ni les autres profils de terrain n'y ont accès.
 */
export function Contaminations({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const etroit = useEtroit();
  const rafraichir = useRafraichir();
  const { site, du, au, api } = filtresCommuns(lire);
  const statut: FiltreStatut = parmi(lire("statut"), STATUT_ADRESSE) ?? "ouvertes";
  const nature: ContaminationNature | null = parmi(lire("nature"), NATURE_CONTAMINATION);
  const choisi = Number(lire("contamination")) || null;
  const [tri, setTri] = useState<Tri>({ key: "detected_on", dir: -1 });
  const filtres = { ...api, nature };
  const cle = `${requete(filtres)}|${statut}|${tri.key}|${tri.dir}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [saisir, setSaisir] = useState(false);

  const { data: compte } = useApi<Page<ContaminationLine, ContaminationCounts>>(`/hsseq/contaminations?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<ContaminationLine, ContaminationCounts>>(
    `/hsseq/contaminations?${requete({ ...filtres, status: STATUT_ADRESSE[statut], sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  // Manquants des citernes sur la même période (le mois en cours sans période) et le même site.
  const { data: livraisons } = useApi<Deliveries>(`/hsseq/environment/deliveries?${requete({ ...api, group_by: "site", vehicle_kind: "tanker" })}`);
  const parStatut = compte?.counts.by_status;
  const citernes = livraisons?.tanker.totals;
  const compact = etroit || choisi !== null;

  const colonnes: Column<ContaminationLine>[] = [
    {
      key: "detected_on",
      label: "Contamination",
      render: (c) => (
        <span className={cx("block min-w-[13rem] max-w-[42ch]", choisi === c.id && "font-medium")}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11.5px] text-muted">{c.reference}</span>
            {compact && <TamponEnv mot={STATUT_CONTAMINATION[c.status]} />}
          </span>
          {choisi === c.id && <span className="sr-only"> (fiche ouverte)</span>}
          <span className="mt-0.5 block leading-snug text-ink">{NATURE_CONTAMINATION[c.nature].label}</span>
          {c.description && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-2">{c.description}</span>}
          <span className="mt-1 block text-[12px] leading-snug text-muted">
            Constatée le {fmtDate(c.detected_on)}
            {c.site ? `, ${c.site.name}` : ""}
            {compact && c.vehicle ? `, ${c.vehicle.name}` : ""}
          </span>
        </span>
      ),
    },
    ...(compact
      ? []
      : [
          {
            key: "rotation",
            label: "Rotation",
            render: (c: ContaminationLine) =>
              c.rotation || c.vehicle ? (
                <span className="block min-w-[10rem] max-w-[30ch]">
                  <span className="block text-ink">{c.rotation ? nomRotation(c.rotation) : nomVehicule(c.vehicle)}</span>
                  <span className="block text-[12px] leading-snug text-muted">{[c.rotation ? nomVehicule(c.vehicle) : null, c.product?.name].filter(Boolean).join(", ") || "–"}</span>
                </span>
              ) : (
                <span className="text-muted">–</span>
              ),
          },
        ]),
    { key: "volume_m3", label: "Volume touché", align: "right", render: (c) => (c.volume_m3 ? <span className="text-ink">{fmtM3(c.volume_m3)}</span> : <span className="text-muted">–</span>) },
    ...(compact ? [] : [{ key: "status", label: "Statut", render: (c: ContaminationLine) => <TamponEnv mot={STATUT_CONTAMINATION[c.status]} /> }]),
  ];

  const liste = (
    <div className="space-y-5">
      <Situation label="Manquants et contaminations de produit" colonnes={3}>
        <Chiffre valeur={nombre(parStatut?.open)} ton={(parStatut?.open ?? 0) > 0 ? "warn" : undefined}>
          {(parStatut?.open ?? 0) > 1 ? "contaminations ouvertes" : "contamination ouverte"}
        </Chiffre>
        <Chiffre valeur={citernes ? fmtIndicateur(citernes.per_mille, "per_mille") : "–"} onClick={() => ecrire({ vue: "consommation", statut: null, nature: null, contamination: null, profil: "citerne" })}>
          {citernes && citernes.rotations
            ? `manquant des citernes ${du || au ? "sur la période" : "ce mois-ci"} : ${fmtM3(citernes.shortage)} sur ${fmtM3(citernes.delivered_15)} livrés, à 15 °C`
            : `manquant des citernes ${du || au ? "sur la période" : "ce mois-ci"}, aucune livraison`}
        </Chiffre>
        <Chiffre valeur={nombre(parStatut?.closed)}>{(parStatut?.closed ?? 0) > 1 ? "contaminations closes" : "contamination close"}</Chiffre>
      </Situation>

      <div className="flex flex-wrap items-end gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Segmented<FiltreStatut>
            label="Contaminations affichées"
            value={statut}
            onChange={(s) => ecrire({ statut: s === "ouvertes" ? null : s })}
            options={[
              { key: "ouvertes", label: `Ouvertes (${fmtInt(parStatut?.open ?? 0)})` },
              { key: "closes", label: `Closes (${fmtInt(parStatut?.closed ?? 0)})` },
              { key: "toutes", label: `Toutes (${fmtInt(compte?.total_count ?? 0)})` },
            ]}
          />
        </div>
        <Field label="Nature" className="w-full sm:w-52">
          <Select value={nature ?? ""} onChange={(e) => ecrire({ nature: e.target.value })} placeholder="Toutes" options={ORDRE_CONTAMINATIONS.map((k) => ({ value: k, label: NATURE_CONTAMINATION[k].label }))} />
        </Field>
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
        <ChampsPeriode du={du} au={au} ecrire={ecrire} libelleDu="Constatées du" />
        {droits.hsseq && (
          <Button variant="primary" className="ml-auto" onClick={() => setSaisir(true)}>
            <Plus className="h-4 w-4" /> Nouvelle contamination
          </Button>
        )}
        <ExportRegistres filtres={api} className={droits.hsseq ? undefined : "ml-auto"} />
      </div>

      <p className="text-[12.5px] leading-snug text-muted">
        Présence d&apos;eau, mélange, impuretés ou produit hors spécification, reliés à la rotation en cause ; la contamination se clôt une fois les mesures prises décrites. Les manquants viennent de Transport : volume chargé moins volume livré, ramenés à 15 °C, rapportés au livré à 15 °C.
      </p>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des contaminations…" />
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
                if (TRIS.includes(t.key)) setTri(t);
              }}
              onRowClick={(c) => ecrire({ contamination: c.id })}
              empty={statut === "ouvertes" && !nature && !site && !du && !au ? "Aucune contamination ouverte." : "Aucune contamination pour ces filtres."}
              columns={colonnes}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="contaminations" onPage={(x) => setPosition({ cle, offset: x })} />
          </>
        )}
      </Card>

      {saisir && (
        <FenetreContamination
          droits={droits}
          onClose={() => setSaisir(false)}
          envoyer={async (corps) => {
            const c = await apiSend<Contamination>("POST", "/hsseq/contaminations", corps);
            void rafraichir();
            ecrire({ contamination: c.id, statut: statut === "toutes" ? "toutes" : null, nature: nature && nature !== c.nature ? null : nature });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisi !== null} liste={liste} fiche={choisi !== null && <FicheContamination key={choisi} id={choisi} droits={droits} onFermer={() => ecrire({ contamination: null })} />} />;
}
