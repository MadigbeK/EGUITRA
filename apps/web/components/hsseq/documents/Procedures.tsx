"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Segmented, Select, Tag, cx, type Column, type Tri } from "@/components/ui";
import { DOMAINE } from "@/components/hsseq/commun";
import { AvecFiche, Pages, requete } from "@/components/hsseq/actions/outils";
import { Recherche } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtInt } from "@/lib/format";
import type { Domain, Page } from "@/lib/hsseq-types";
import { TauxLecture } from "./elements";
import { FenetreProcedure } from "./fenetres";
import { FicheProcedure } from "./FicheProcedure";
import { STATUT_PROCEDURE, TamponDocument, parmi, publicVise, useRafraichir, type VueProps } from "./libelles";
import type { Procedure, ProcedureCounts, ProcedureLine, ProcedureStatus } from "./types";

const PAR_PAGE = 100;

/** Tris servis par le noyau (sort de GET /hsseq/procedures) ; les autres colonnes ne se trient pas. */
const TRIS = ["code", "status"] as const;

/** Filtre de statut porté par l'adresse ; sans lui, les procédures au registre (en vigueur et en rédaction). */
const FILTRE_STATUT: Record<"registre" | "en-vigueur" | "en-redaction" | "archivees" | "toutes", { label: string; statuts: ProcedureStatus[] | null }> = {
  registre: { label: "Au registre", statuts: ["published", "draft"] },
  "en-vigueur": { label: "En vigueur", statuts: ["published"] },
  "en-redaction": { label: "En rédaction", statuts: ["draft"] },
  archivees: { label: "Archivées", statuts: ["archived"] },
  toutes: { label: "Toutes", statuts: null },
};
type FiltreStatut = keyof typeof FILTRE_STATUT;
const ORDRE_FILTRES = Object.keys(FILTRE_STATUT) as FiltreStatut[];
const TOUS_STATUTS: readonly ProcedureStatus[] = ["draft", "published", "archived"];

/** Au téléphone, seule la première colonne reste : elle porte alors la version, la lecture et le statut. */
const TELEPHONE = "max-md:[&_th:not(:first-child)]:hidden max-md:[&_td:not(:first-child)]:hidden";

/** Tampons d'état d'une procédure : son statut, et le brouillon qui attend son document ou sa publication. */
function Etats({ p }: { p: ProcedureLine }) {
  const brouillon = p.draft_version;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <TamponDocument mot={STATUT_PROCEDURE[p.status]} />
      {brouillon && p.status !== "archived" && <TamponDocument mot={brouillon.document.length ? "Brouillon à publier" : "Document à joindre"} />}
    </span>
  );
}

/** Version en vigueur et sa date d'effet ; le brouillon en attente dessous. */
function Version({ p }: { p: ProcedureLine }) {
  const c = p.current_version;
  return (
    <span className="inline-flex min-w-[8.5rem] flex-col">
      {c ? (
        <>
          <span className="whitespace-nowrap text-ink">Version {c.version}</span>
          <span className="whitespace-nowrap text-[12px] text-muted">depuis le {fmtDate(c.effective_date)}</span>
        </>
      ) : (
        <span className="text-muted">Aucune en vigueur</span>
      )}
      {p.draft_version && <span className="whitespace-nowrap text-[12px] text-muted">Brouillon {p.draft_version.version}</span>}
    </span>
  );
}

/**
 * Filtres de la liste des procédures pour leur feuille de l'export (préfixe procedures_ du noyau) : l'export
 * des registres reprend la sélection affichée.
 */
export function filtresExportProcedures(lire: (cle: string) => string): Record<string, string | null> {
  const statut: FiltreStatut = parmi(lire("statut"), FILTRE_STATUT) ?? "registre";
  return { procedures_status: FILTRE_STATUT[statut].statuts?.join(",") ?? null, procedures_domain: parmi(lire("domaine"), DOMAINE), procedures_search: lire("q").trim() || null };
}

/**
 * Procédures du groupe (GET /hsseq/procedures) : registre par statut avec ses nombres, recherche et
 * domaine, version en vigueur et taux de lecture de chacune ; la fiche s'ouvre à côté. Filtres et fiche
 * ouverte portés par l'adresse (statut, domaine, q, procedure). Le noyau trie (référence, statut) et
 * compte les statuts aux autres filtres de la liste. L'auditeur ne lit que les procédures de ses sites,
 * sans les noms des lecteurs.
 */
export function Procedures({ lire, ecrire, droits }: VueProps) {
  const rafraichir = useRafraichir();
  const statut: FiltreStatut = parmi(lire("statut"), FILTRE_STATUT) ?? "registre";
  const domaine = parmi(lire("domaine"), DOMAINE);
  const q = lire("q");
  const choisie = Number(lire("procedure")) || null;
  const filtres = { domain: domaine, search: q.trim() || null };
  const [tri, setTri] = useState<Tri>({ key: "code", dir: 1 });
  const cle = `${requete(filtres)}|${statut}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [creer, setCreer] = useState(false);

  const { data, error, mutate } = useApi<Page<ProcedureLine, ProcedureCounts>>(
    `/hsseq/procedures?${requete({ ...filtres, status: FILTRE_STATUT[statut].statuts?.join(",") ?? null, sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  // Nombres des statuts : le noyau les compte aux autres filtres de la liste, sans celui du statut.
  const parStatut = data?.counts.by_status;
  const nombre = (f: FiltreStatut) => (parStatut ? (FILTRE_STATUT[f].statuts ?? TOUS_STATUTS).reduce((n, s) => n + (parStatut[s] ?? 0), 0) : null);
  const compact = choisie !== null;

  const colonnes: Array<Column<ProcedureLine> & { secondaire?: boolean }> = [
    {
      key: "code",
      label: "Procédure",
      sortValue: (p) => p.code,
      render: (p) => (
        <div className="min-w-[15rem] max-w-[52ch]">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-muted">{p.code}</span>
            {p.domain && <Tag>{DOMAINE[p.domain]}</Tag>}
            {choisie === p.id && <span className="sr-only">fiche ouverte</span>}
          </span>
          <span className={cx("mt-1 line-clamp-2 block leading-snug text-ink", choisie === p.id && "font-semibold")}>{p.title}</span>
          <span className="mt-1 block text-[12px] leading-snug text-muted">{publicVise(p.audience)}</span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 md:hidden">
            <Etats p={p} />
            {p.current_version && <span className="text-[12px] text-muted">Version {p.current_version.version}</span>}
            {p.read && p.read.rate !== null && <span className="text-[12px] text-muted tabular">{`Lue à ${fmtInt(p.read.rate)}${INSECABLE}%`}</span>}
          </span>
        </div>
      ),
    },
    { key: "version", label: "Version en vigueur", secondaire: true, sortValue: (p) => p.current_version?.effective_date ?? "", render: (p) => <Version p={p} /> },
    { key: "read", label: "Lecture", secondaire: true, sortValue: (p) => p.read?.rate ?? -1, render: (p) => <TauxLecture stats={p.read} /> },
    { key: "status", label: "Statut", sortValue: (p) => p.status, render: (p) => <Etats p={p} /> },
  ];

  const liste = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Recherche valeur={q} onChange={(v) => ecrire({ q: v || null })} placeholder="Référence, titre" />
        <Field label="Domaine" className="w-full sm:w-44">
          <Select value={domaine ?? ""} onChange={(e) => ecrire({ domaine: e.target.value || null })} placeholder="Tous" options={(Object.keys(DOMAINE) as Domain[]).map((d) => ({ value: d, label: DOMAINE[d] }))} />
        </Field>
        {droits.ecriture && (
          <Button variant="primary" className="sm:ml-auto" onClick={() => setCreer(true)}>
            <Plus className="h-4 w-4" /> Nouvelle procédure
          </Button>
        )}
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented<FiltreStatut>
          label="Procédures affichées"
          value={statut}
          onChange={(s) => ecrire({ statut: s === "registre" ? null : s })}
          options={ORDRE_FILTRES.map((f) => ({ key: f, label: nombre(f) === null ? FILTRE_STATUT[f].label : `${FILTRE_STATUT[f].label} (${fmtInt(nombre(f))})` }))}
        />
      </div>
      <p className="m-0 text-[12.5px] leading-snug text-muted">
        Chaque version publiée est demandée en lecture aux comptes visés&nbsp;; ceux qui ne l&apos;ont pas lue sont relancés à l&apos;intervalle des paramètres, sept jours par défaut.
      </p>
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des procédures…" />
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
                rowKey={(p) => p.id}
                sort={tri}
                onSort={(t) => {
                  if (!(TRIS as readonly string[]).includes(t.key)) return;
                  setTri(t);
                  setPosition({ cle, offset: 0 });
                }}
                onRowClick={(p) => ecrire({ procedure: p.id })}
                empty={domaine || q.trim() ? "Aucune procédure pour ces filtres." : statut === "archivees" ? "Aucune procédure archivée." : "Aucune procédure dans ce registre."}
                columns={colonnes.filter((c) => !(compact && c.secondaire))}
              />
            </div>
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="procédures" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>
      {creer && (
        <FenetreProcedure
          onClose={() => setCreer(false)}
          envoyer={async (corps) => {
            const p = await apiSend<Procedure>("POST", "/hsseq/procedures", corps);
            void rafraichir();
            // La nouvelle procédure, en rédaction, s'ouvre ; un filtre qui l'écarterait de la liste est retiré.
            ecrire({ procedure: p.id, ...(statut === "en-vigueur" || statut === "archivees" ? { statut: null } : {}) });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisie !== null} liste={liste} fiche={choisie !== null && <FicheProcedure key={choisie} id={choisie} droits={droits} onFermer={() => ecrire({ procedure: null })} />} />;
}
