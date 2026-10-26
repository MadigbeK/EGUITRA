"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Segmented, Select, cx, type Column, type Tri } from "@/components/ui";
import { AvecFiche, ChampSite, Pages, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { useEtroit } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtInt } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { ChampsPeriode, Chiffre, ExportRegistres, NATURE_DECHET, ORDRE_DECHETS, STATUT_DECHET, Situation, TamponEnv, filtresCommuns, fmtQuantite, natureDechet, parmi, useRafraichir, type VueProps } from "./commun";
import { FenetreDechet } from "./fenetres";
import { FicheDechet } from "./FicheDechet";
import type { Waste, WasteCounts, WasteKind, WasteLine, WasteStatus } from "./types";

const PAR_PAGE = 50;

/** Statut dans l'adresse et sa clé dans l'API. */
const STATUT_ADRESSE: Record<"entreposes" | "enleves" | "tous", WasteStatus | null> = { entreposes: "stored", enleves: "collected", tous: null };
type FiltreStatut = keyof typeof STATUT_ADRESSE;

const TRIS = ["produced_on", "reference", "pickup_date", "status"];

/** Ce que compte chaque chiffre de la situation, accordé à la nature. */
const ENTREPOSES: Record<WasteKind, string> = {
  used_oil: "huiles usagées entreposées",
  tyres: "pneus entreposés",
  filters: "filtres entreposés",
  other: "autres déchets entreposés",
};

/**
 * Registre des déchets (GET /hsseq/wastes) : quantités entreposées par nature en tête, filtres par
 * statut (entreposés par défaut), nature, site et période d'entreposage, portés par l'adresse avec la
 * fiche ouverte (dechet). Le Responsable HSSEQ et le chef de parc (ses sites) les inscrivent et en
 * enregistrent l'enlèvement, bordereau joint.
 */
export function Dechets({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const etroit = useEtroit();
  const rafraichir = useRafraichir();
  const { site, du, au, api } = filtresCommuns(lire);
  const statut: FiltreStatut = parmi(lire("statut"), STATUT_ADRESSE) ?? "entreposes";
  const nature: WasteKind | null = parmi(lire("nature"), NATURE_DECHET);
  const choisi = Number(lire("dechet")) || null;
  const [tri, setTri] = useState<Tri>({ key: "produced_on", dir: -1 });
  const filtres = { ...api, waste_kind: nature };
  const cle = `${requete(filtres)}|${statut}|${tri.key}|${tri.dir}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [inscrire, setInscrire] = useState(false);

  // Quantités entreposées par nature : sur le site et la période, toutes natures (la situation pose le filtre).
  const { data: situation } = useApi<Page<WasteLine, WasteCounts>>(`/hsseq/wastes?${requete({ ...api, limit: 1 })}`, { keepPreviousData: true });
  // Nombres de la sélection sans le statut (bascule) ; liste filtrée.
  const { data: compte } = useApi<Page<WasteLine, WasteCounts>>(`/hsseq/wastes?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<WasteLine, WasteCounts>>(
    `/hsseq/wastes?${requete({ ...filtres, status: STATUT_ADRESSE[statut], sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const parStatut = compte?.counts.by_status;
  const entreposes = situation?.counts.stored_quantities ?? [];
  const compact = etroit || choisi !== null;

  const colonnes: Column<WasteLine>[] = [
    {
      key: "produced_on",
      label: "Déchet",
      render: (w) => (
        <span className={cx("block min-w-[13rem] max-w-[44ch]", choisi === w.id && "font-medium")}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11.5px] text-muted">{w.reference}</span>
            {compact && <TamponEnv mot={STATUT_DECHET[w.status]} />}
          </span>
          {choisi === w.id && <span className="sr-only"> (fiche ouverte)</span>}
          <span className="mt-0.5 line-clamp-2 block leading-snug text-ink">{natureDechet(w)}</span>
          <span className="mt-1 block text-[12px] leading-snug text-muted">
            Entreposé le {fmtDate(w.produced_on)}
            {w.site ? `, ${w.site.name}` : ""}
          </span>
        </span>
      ),
    },
    { key: "quantity", label: "Quantité", align: "right", render: (w) => <span className="font-semibold text-ink">{fmtQuantite(w.quantity, w.unit)}</span> },
    ...(compact
      ? []
      : [
          {
            key: "pickup_date",
            label: "Enlèvement",
            render: (w: WasteLine) =>
              w.status === "collected" ? (
                <span className="block min-w-[10rem] max-w-[30ch]">
                  <span className="block text-ink">Le {fmtDate(w.pickup_date)}</span>
                  <span className="block text-[12px] leading-snug text-muted">
                    {w.provider?.name ?? "Prestataire non nommé"}
                    {w.manifest_reference ? `, bordereau ${w.manifest_reference}` : ""}
                  </span>
                </span>
              ) : (
                <span className="block min-w-[10rem] max-w-[30ch] text-[12.5px] leading-snug text-muted">{w.provider ? `Prévu avec ${w.provider.name}` : "Prestataire à désigner"}</span>
              ),
          },
          {
            key: "status",
            label: "Statut",
            render: (w: WasteLine) => (
              <span className="inline-flex flex-col items-start gap-1">
                <TamponEnv mot={STATUT_DECHET[w.status]} />
                {w.status === "stored" && w.manifest_attached && <TamponEnv mot="Bordereau joint" />}
              </span>
            ),
          },
        ]),
  ];

  const liste = (
    <div className="space-y-5">
      <Situation label="Déchets entreposés, en attente d'enlèvement">
        {ORDRE_DECHETS.map((k) => {
          const parts = entreposes.filter((q) => q.waste_kind === k);
          const actif = nature === k && statut === "entreposes";
          return (
            <Chiffre
              key={k}
              valeur={situation ? (parts.length ? parts.map((q) => fmtQuantite(q.quantity, q.unit)).join(" + ") : "0") : "–"}
              actif={actif}
              onClick={() => ecrire(actif ? { nature: null } : { nature: k, statut: null })}
            >
              {ENTREPOSES[k]}
            </Chiffre>
          );
        })}
      </Situation>

      <div className="flex flex-wrap items-end gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Segmented<FiltreStatut>
            label="Déchets affichés"
            value={statut}
            onChange={(s) => ecrire({ statut: s === "entreposes" ? null : s })}
            options={[
              { key: "entreposes", label: `Entreposés (${fmtInt(parStatut?.stored ?? 0)})` },
              { key: "enleves", label: `Enlevés (${fmtInt(parStatut?.collected ?? 0)})` },
              { key: "tous", label: `Tous (${fmtInt(compte?.total_count ?? 0)})` },
            ]}
          />
        </div>
        <Field label="Nature" className="w-full sm:w-44">
          <Select value={nature ?? ""} onChange={(e) => ecrire({ nature: e.target.value })} placeholder="Toutes" options={ORDRE_DECHETS.map((k) => ({ value: k, label: NATURE_DECHET[k] }))} />
        </Field>
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
        <ChampsPeriode du={du} au={au} ecrire={ecrire} libelleDu="Entreposés du" />
        {droits.terrain && (
          <Button variant="primary" className="ml-auto" onClick={() => setInscrire(true)}>
            <Plus className="h-4 w-4" /> Inscrire un déchet
          </Button>
        )}
        <ExportRegistres filtres={api} className={droits.terrain ? undefined : "ml-auto"} />
      </div>

      <p className="text-[12.5px] leading-snug text-muted">
        Huiles usagées, pneus, filtres et autres déchets restent au registre jusqu&apos;à leur enlèvement par un prestataire, qui ne s&apos;enregistre qu&apos;avec le numéro et la pièce du bordereau.
      </p>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement du registre des déchets…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(w) => w.id}
              sort={tri}
              onSort={(t) => {
                if (TRIS.includes(t.key)) setTri(t);
              }}
              onRowClick={(w) => ecrire({ dechet: w.id })}
              empty={statut === "entreposes" && !nature && !site && !du && !au ? "Aucun déchet entreposé." : "Aucun déchet pour ces filtres."}
              columns={colonnes}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="déchets" onPage={(x) => setPosition({ cle, offset: x })} />
          </>
        )}
      </Card>

      {inscrire && (
        <FenetreDechet
          droits={droits}
          onClose={() => setInscrire(false)}
          envoyer={async (corps) => {
            const w = await apiSend<Waste>("POST", "/hsseq/wastes", corps);
            void rafraichir();
            // Le déchet inscrit est entreposé : la liste des enlevés ne le montrerait pas.
            ecrire({ dechet: w.id, statut: statut === "tous" ? "tous" : null, nature: nature && nature !== w.waste_kind ? null : nature });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisi !== null} liste={liste} fiche={choisi !== null && <FicheDechet key={choisi} id={choisi} droits={droits} onFermer={() => ecrire({ dechet: null })} />} />;
}
