"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Segmented, Select, Tag, cx, type Column } from "@/components/ui";
import { AvecFiche, Pages, requete } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtInt } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { TauxLecture } from "./elements";
import { FenetreAlerte } from "./fenetres";
import { FicheAlerte } from "./FicheAlerte";
import { NATURE_ALERTE, TamponDocument, parmi, publicVise, statutAlerte, useRafraichir, type VueProps } from "./libelles";
import type { Bulletin, BulletinCounts, BulletinKind, BulletinLine, BulletinStatus } from "./types";

const PAR_PAGE = 100;

/** Filtre de statut porté par l'adresse ; sans lui, toutes (les brouillons d'abord, pour qui les lit). */
const FILTRE_STATUT: Record<"toutes" | "brouillons" | "diffusees" | "archivees", { label: string; statuts: BulletinStatus[] | null }> = {
  toutes: { label: "Toutes", statuts: null },
  brouillons: { label: "Brouillons", statuts: ["draft"] },
  diffusees: { label: "Diffusées", statuts: ["published"] },
  archivees: { label: "Archivées", statuts: ["archived"] },
};
type FiltreStatut = keyof typeof FILTRE_STATUT;
const TOUS_STATUTS: readonly BulletinStatus[] = ["draft", "published", "archived"];

/** Nature dans l'adresse et sa clé dans l'API. */
const NATURE_ADRESSE: Record<"alertes" | "retours", BulletinKind> = { alertes: "flash_alert", retours: "lesson" };

const TELEPHONE = "max-md:[&_th:not(:first-child)]:hidden max-md:[&_td:not(:first-child)]:hidden";

/**
 * Alertes flash et retours d'expérience (GET /hsseq/bulletins) : brouillons, diffusés, archivés avec
 * leurs nombres, nature, taux de lecture ; la fiche s'ouvre à côté. Filtres et fiche ouverte portés par
 * l'adresse (statut, nature, alerte). L'auditeur ne lit que les documents diffusés de ses sites.
 */
export function Alertes({ lire, ecrire, droits }: VueProps) {
  const rafraichir = useRafraichir();
  const demande = parmi(lire("statut"), FILTRE_STATUT) ?? "toutes";
  // L'auditeur ne lit pas les brouillons : le filtre ne lui est pas proposé.
  const statut: FiltreStatut = demande === "brouillons" && droits.auditeur ? "toutes" : demande;
  const natureAdresse = parmi(lire("nature"), NATURE_ADRESSE);
  const nature = natureAdresse ? NATURE_ADRESSE[natureAdresse] : null;
  const choisie = Number(lire("alerte")) || null;
  const filtres = { kind: nature };
  const cle = `${requete(filtres)}|${statut}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [creer, setCreer] = useState(false);

  const { data: compte } = useApi<Page<BulletinLine, BulletinCounts>>(`/hsseq/bulletins?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<BulletinLine, BulletinCounts>>(
    `/hsseq/bulletins?${requete({ ...filtres, status: FILTRE_STATUT[statut].statuts?.join(",") ?? null, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const parStatut = compte?.counts.by_status;
  const nombre = (f: FiltreStatut) => (parStatut ? (FILTRE_STATUT[f].statuts ?? TOUS_STATUTS).reduce((n, s) => n + (parStatut[s] ?? 0), 0) : null);
  const filtresProposes = (Object.keys(FILTRE_STATUT) as FiltreStatut[]).filter((f) => f !== "brouillons" || !droits.auditeur);
  const compact = choisie !== null;

  const colonnes: Array<Column<BulletinLine> & { secondaire?: boolean }> = [
    {
      key: "reference",
      label: "Document",
      sortValue: (b) => b.reference,
      render: (b) => (
        <div className="min-w-[15rem] max-w-[52ch]">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-muted">{b.reference}</span>
            <Tag>{NATURE_ALERTE[b.kind].label}</Tag>
            {choisie === b.id && <span className="sr-only">fiche ouverte</span>}
          </span>
          <span className={cx("mt-1 line-clamp-2 block leading-snug text-ink", choisie === b.id && "font-semibold")}>{b.title}</span>
          <span className="mt-1 block text-[12px] leading-snug text-muted">{publicVise(b.audience)}</span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 md:hidden">
            <TamponDocument mot={statutAlerte(b.kind, b.status)} />
            {b.published_at && <span className="text-[12px] text-muted">le {fmtDate(b.published_at)}</span>}
            {b.read && b.read.rate !== null && <span className="text-[12px] text-muted tabular">{`Lu à ${fmtInt(b.read.rate)}${INSECABLE}%`}</span>}
          </span>
        </div>
      ),
    },
    {
      key: "published_at",
      label: "Diffusion",
      secondaire: true,
      sortValue: (b) => b.published_at ?? "9999",
      render: (b) => (b.published_at ? <span className="whitespace-nowrap">{fmtDate(b.published_at)}</span> : <span className="whitespace-nowrap text-muted">Pas encore diffusé{NATURE_ALERTE[b.kind].feminin ? "e" : ""}</span>),
    },
    { key: "read", label: "Lecture", secondaire: true, sortValue: (b) => b.read?.rate ?? -1, render: (b) => <TauxLecture stats={b.read} /> },
    { key: "status", label: "Statut", sortValue: (b) => b.status, render: (b) => <TamponDocument mot={statutAlerte(b.kind, b.status)} /> },
  ];

  const liste = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Nature" className="w-full sm:w-56">
          <Select
            value={natureAdresse ?? ""}
            onChange={(e) => ecrire({ nature: e.target.value || null })}
            placeholder="Alertes et retours d'expérience"
            options={[
              { value: "alertes", label: NATURE_ALERTE.flash_alert.pluriel },
              { value: "retours", label: NATURE_ALERTE.lesson.pluriel },
            ]}
          />
        </Field>
        {droits.ecriture && (
          <Button variant="primary" className="sm:ml-auto" onClick={() => setCreer(true)}>
            <Plus className="h-4 w-4" /> Nouvelle alerte
          </Button>
        )}
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented<FiltreStatut>
          label="Documents affichés"
          value={statut}
          onChange={(s) => ecrire({ statut: s === "toutes" ? null : s })}
          options={filtresProposes.map((f) => ({ key: f, label: nombre(f) === null ? FILTRE_STATUT[f].label : `${FILTRE_STATUT[f].label} (${fmtInt(nombre(f))})` }))}
        />
      </div>
      <p className="m-0 text-[12.5px] leading-snug text-muted">
        Alertes et retours d&apos;expérience partent anonymes&nbsp;: la diffusion est refusée tant que le texte cite un nom de personne ou une immatriculation. Chaque compte visé en accuse lecture, depuis le web ou NIMOVA Terrain.
      </p>
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des alertes…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <div className={TELEPHONE}>
              <DataTable
                rows={data.items}
                rowKey={(b) => b.id}
                onRowClick={(b) => ecrire({ alerte: b.id })}
                empty={nature || statut !== "toutes" ? "Aucun document pour ces filtres." : "Aucune alerte ni aucun retour d'expérience."}
                columns={colonnes.filter((c) => !(compact && c.secondaire))}
              />
            </div>
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="alertes" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>
      {creer && (
        <FenetreAlerte
          onClose={() => setCreer(false)}
          envoyer={async (corps) => {
            const b = await apiSend<Bulletin>("POST", "/hsseq/bulletins", corps);
            void rafraichir();
            // Le brouillon s'ouvre avec son contrôle d'anonymat ; un filtre qui l'écarterait est retiré.
            ecrire({ alerte: b.id, ...(statut === "diffusees" || statut === "archivees" ? { statut: null } : {}), ...(nature && nature !== b.kind ? { nature: null } : {}) });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisie !== null} liste={liste} fiche={choisie !== null && <FicheAlerte key={choisie} id={choisie} droits={droits} onFermer={() => ecrire({ alerte: null })} />} />;
}
