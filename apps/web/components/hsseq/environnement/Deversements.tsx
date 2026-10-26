"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Segmented, cx, type Column, type Tri } from "@/components/ui";
import { nomVehicule } from "@/components/hsseq/commun";
import { AvecFiche, ChampSite, Pages, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { useEtroit } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { ChampsPeriode, Chiffre, ExportRegistres, STATUT_DEVERSEMENT, Situation, TamponEnv, filtresCommuns, fmtLitres, nombre, parmi, produitDeverse, useRafraichir, type VueProps } from "./commun";
import { FenetreDeversement } from "./fenetres";
import { FicheDeversement } from "./FicheDeversement";
import type { Spill, SpillCounts, SpillLine, SpillStatus } from "./types";

const PAR_PAGE = 50;

/** Statut dans l'adresse et sa clé dans l'API. */
const STATUT_ADRESSE: Record<"en_cours" | "clos" | "tous", SpillStatus | null> = { en_cours: "open", clos: "closed", tous: null };
type FiltreStatut = keyof typeof STATUT_ADRESSE;

/** Tris servis par le noyau (`sort`). */
const TRIS = ["occurred_at", "reference", "volume_liters", "status"];

/**
 * Déversements du périmètre (GET /hsseq/spills) : situation (en cours, volumes déversés et récupérés),
 * filtres par statut (en cours par défaut), site et période, portés par l'adresse avec la fiche ouverte
 * (deversement). Le Responsable HSSEQ et le chef de parc (ses sites) les déclarent ; la clôture revient
 * au Responsable HSSEQ, une fois la récupération décrite.
 */
export function Deversements({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const etroit = useEtroit();
  const rafraichir = useRafraichir();
  const { site, du, au, api } = filtresCommuns(lire);
  const statut: FiltreStatut = parmi(lire("statut"), STATUT_ADRESSE) ?? "en_cours";
  const choisi = Number(lire("deversement")) || null;
  const [tri, setTri] = useState<Tri>({ key: "occurred_at", dir: -1 });
  const cle = `${requete(api)}|${statut}|${tri.key}|${tri.dir}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [declarer, setDeclarer] = useState(false);

  // Nombres de la sélection sans le statut (bascule et situation) ; liste filtrée.
  const { data: compte } = useApi<Page<SpillLine, SpillCounts>>(`/hsseq/spills?${requete({ ...api, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<SpillLine, SpillCounts>>(
    `/hsseq/spills?${requete({ ...api, status: STATUT_ADRESSE[statut], sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const c = compte?.counts;
  const compact = etroit || choisi !== null;
  const periode = du || au ? "sur la période" : "depuis l'ouverture du registre";
  const taux = c && c.volume_liters ? (c.recovered_liters * 100) / c.volume_liters : null;

  const colonnes: Column<SpillLine>[] = [
    {
      key: "occurred_at",
      label: "Déversement",
      render: (s) => (
        <span className={cx("block min-w-[14rem] max-w-[46ch]", choisi === s.id && "font-medium")}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11.5px] text-muted">{s.reference}</span>
            {compact && <TamponEnv mot={STATUT_DEVERSEMENT[s.status]} />}
          </span>
          {choisi === s.id && <span className="sr-only"> (fiche ouverte)</span>}
          <span className="mt-0.5 line-clamp-2 block leading-snug text-ink">{s.location ?? "Lieu non précisé"}</span>
          <span className="mt-1 block text-[12px] leading-snug text-muted">
            {fmtDateTime(s.occurred_at)}
            {s.site ? `, ${s.site.name}` : ", hors site"}
            {compact ? `, ${produitDeverse(s)}` : ""}
          </span>
        </span>
      ),
    },
    ...(compact
      ? []
      : [
          {
            key: "product",
            label: "Produit",
            render: (s: SpillLine) => (
              <span className="block min-w-[9rem] max-w-[28ch]">
                <span className="block text-ink">{produitDeverse(s)}</span>
                {s.vehicle && <span className="block text-[12px] text-muted">{nomVehicule(s.vehicle)}</span>}
              </span>
            ),
          },
          { key: "event", label: "Événement", render: (s: SpillLine) => (s.event ? <span className="whitespace-nowrap font-mono text-[12px] text-ink-2">{s.event.reference}</span> : <span className="text-muted">–</span>) },
        ]),
    {
      key: "volume_liters",
      label: "Volume",
      align: "right",
      render: (s) => (
        <span className="inline-flex flex-col items-end">
          <span className="font-semibold text-ink">{fmtLitres(s.volume_liters)}</span>
          <span className="text-[12px] text-muted">{`${fmtPct(s.recovery_rate, 0)} récupérés`}</span>
        </span>
      ),
    },
    ...(compact ? [] : [{ key: "status", label: "Statut", render: (s: SpillLine) => <TamponEnv mot={STATUT_DEVERSEMENT[s.status]} /> }]),
  ];

  const liste = (
    <div className="space-y-5">
      <Situation label="Situation des déversements" colonnes={3}>
        <Chiffre valeur={nombre(c?.by_status.open)} ton={(c?.by_status.open ?? 0) > 0 ? "warn" : undefined}>
          {(c?.by_status.open ?? 0) > 1 ? "déversements en cours de traitement" : "déversement en cours de traitement"}
        </Chiffre>
        <Chiffre valeur={c ? fmtLitres(c.volume_liters) : "–"}>déversés {periode}</Chiffre>
        <Chiffre valeur={c ? fmtLitres(c.recovered_liters) : "–"}>{taux === null ? "récupérés" : `récupérés, soit ${fmtPct(taux, 1)}`}</Chiffre>
      </Situation>

      <div className="flex flex-wrap items-end gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Segmented<FiltreStatut>
            label="Déversements affichés"
            value={statut}
            onChange={(s) => ecrire({ statut: s === "en_cours" ? null : s })}
            options={[
              { key: "en_cours", label: `En cours (${fmtInt(c?.by_status.open ?? 0)})` },
              { key: "clos", label: `Clos (${fmtInt(c?.by_status.closed ?? 0)})` },
              { key: "tous", label: `Tous (${fmtInt(compte?.total_count ?? 0)})` },
            ]}
          />
        </div>
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
        <ChampsPeriode du={du} au={au} ecrire={ecrire} />
        {droits.terrain && (
          <Button variant="primary" className="ml-auto" onClick={() => setDeclarer(true)}>
            <Plus className="h-4 w-4" /> Déclarer un déversement
          </Button>
        )}
        <ExportRegistres filtres={api} className={droits.terrain ? undefined : "ml-auto"} />
      </div>

      <p className="text-[12.5px] leading-snug text-muted">
        Le Responsable HSSEQ clôt un déversement une fois la récupération et le confinement décrits. Relié à un événement du domaine environnement, le déversement en garde la déclaration et l&apos;enquête.
      </p>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des déversements…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(s) => s.id}
              sort={tri}
              onSort={(t) => {
                if (TRIS.includes(t.key)) setTri(t);
              }}
              onRowClick={(s) => ecrire({ deversement: s.id })}
              empty={statut === "en_cours" && !site && !du && !au ? "Aucun déversement en cours de traitement." : "Aucun déversement pour ces filtres."}
              columns={colonnes}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="déversements" onPage={(x) => setPosition({ cle, offset: x })} />
          </>
        )}
      </Card>

      {declarer && (
        <FenetreDeversement
          droits={droits}
          onClose={() => setDeclarer(false)}
          envoyer={async (corps) => {
            const s = await apiSend<Spill>("POST", "/hsseq/spills", corps);
            void rafraichir();
            // Le déversement déclaré est en cours : la liste des clos ne le montrerait pas.
            ecrire({ deversement: s.id, statut: statut === "tous" ? "tous" : null });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisi !== null} liste={liste} fiche={choisi !== null && <FicheDeversement key={choisi} id={choisi} droits={droits} onFermer={() => ecrire({ deversement: null })} />} />;
}
