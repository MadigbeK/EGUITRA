"use client";

import { useCallback, useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Segmented, Select, cx, type Column, type Tri } from "@/components/ui";
import { AvecFiche, Bascule, Pages, requete } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtInt, pluriel } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { NORME, ORDRE_NORME, ORDRE_SOURCE, Recherche, SOURCE, STATUT_EXIGENCE, TamponConformite, parmi, useEtroit, useRafraichir, type VueProps } from "./commun";
import { FenetreExigence } from "./fenetres";
import { FicheExigence } from "./FicheExigence";
import type { Requirement, RequirementCounts, RequirementDetail, RequirementSource, RequirementStandard, RequirementStatus } from "./types";

const PAR_PAGE = 50;

/** Tris servis par le noyau (sort de GET /hsseq/requirements) ; les autres colonnes ne se trient pas. */
const TRIS = ["reference", "next_review_date", "status"] as const;

/** Statut dans l'adresse et sa clé dans l'API. */
const STATUT_ADRESSE: Record<"conformes" | "partielles" | "non_conformes" | "non_evaluees", RequirementStatus> = {
  conformes: "compliant",
  partielles: "partial",
  non_conformes: "non_compliant",
  non_evaluees: "not_evaluated",
};
type FiltreStatut = "toutes" | keyof typeof STATUT_ADRESSE;

/** Dernière et prochaine revue d'une exigence. */
function Revue({ r }: { r: Requirement }) {
  return (
    <span className="inline-flex min-w-[9rem] flex-col">
      <span className={r.last_review_at ? "text-ink" : "text-muted"}>{r.last_review_at ? `Revue le ${fmtDate(r.last_review_at)}` : "Jamais revue"}</span>
      <span className={cx("text-[12px]", r.review_overdue ? "font-semibold text-danger" : "text-muted")}>{r.next_review_date ? `Prochaine le ${fmtDate(r.next_review_date)}` : "Prochaine à fixer"}</span>
    </span>
  );
}

/**
 * Registre des exigences légales, normatives et contractuelles des donneurs d'ordre (§7) : source,
 * référence du texte, preuve attendue, statut de conformité et revues. Recherche, source, référentiel,
 * statut, revues en retard et fiche ouverte (exigence) portés par l'adresse ; le Responsable HSSEQ
 * tient le registre, l'administration, la direction et l'auditeur le lisent.
 */
export function Exigences({ lire, ecrire, droits }: VueProps) {
  const etroit = useEtroit();
  const rafraichir = useRafraichir();
  const recherche = lire("q");
  const source: RequirementSource | null = parmi(lire("source"), SOURCE);
  const norme: RequirementStandard | null = parmi(lire("norme"), NORME);
  const retard = lire("retard") === "1";
  const statut: FiltreStatut = parmi(lire("statut"), STATUT_ADRESSE) ?? "toutes";
  const choisie = Number(lire("exigence")) || null;

  const filtres = { search: recherche || null, source, standard: norme, review_overdue: retard ? 1 : null };
  const cle = `${requete(filtres)}|${statut}`;
  const [tri, setTri] = useState<Tri>({ key: "reference", dir: 1 });
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [creer, setCreer] = useState(false);
  const chercher = useCallback((q: string) => ecrire({ q }), [ecrire]);

  // Nombres sans le statut (bascule des statuts) et revues en retard de la sélection ; liste filtrée.
  const { data: compte } = useApi<Page<Requirement, RequirementCounts>>(`/hsseq/requirements?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data: enRetard } = useApi<Page<Requirement, RequirementCounts>>(`/hsseq/requirements?${requete({ ...filtres, review_overdue: 1, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<Requirement, RequirementCounts>>(
    `/hsseq/requirements?${requete({ ...filtres, status: statut === "toutes" ? null : STATUT_ADRESSE[statut], sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const parStatut = compte?.counts.by_status;
  const compact = etroit || choisie !== null;

  const colonnes: Column<Requirement>[] = [
    {
      key: "reference",
      label: "Exigence",
      render: (r) => (
        <span className={cx("block min-w-[15rem] max-w-[56ch]", choisie === r.id && "font-medium")}>
          <span className="font-mono text-[11.5px] text-muted">{r.reference}</span>
          {choisie === r.id && <span className="sr-only"> (fiche ouverte)</span>}
          <span className="mt-0.5 line-clamp-2 block leading-snug text-ink">{r.title}</span>
          <span className="mt-1 block text-[12px] leading-snug text-muted">
            {SOURCE[r.source]} : {r.source_reference}
            {r.partner ? `, ${r.partner.name}` : ""}
          </span>
          {compact && <span className="mt-0.5 block text-[12px] text-muted">{r.next_review_date ? `Prochaine revue le ${fmtDate(r.next_review_date)}` : r.last_review_at ? `Revue le ${fmtDate(r.last_review_at)}` : "Jamais revue"}</span>}
        </span>
      ),
    },
    ...(compact
      ? []
      : [
          {
            key: "expected_evidence",
            label: "Preuve attendue",
            render: (r: Requirement) => (
              <span className="block min-w-[12rem] max-w-[36ch]">
                <span className={cx("line-clamp-2 block text-[12.5px] leading-snug", r.expected_evidence ? "text-ink-2" : "text-muted")}>{r.expected_evidence || "Non précisée"}</span>
                <span className="mt-0.5 block text-[12px] text-muted">{r.evidence.length ? pluriel(r.evidence.length, "pièce jointe", "pièces jointes") : "Aucune pièce jointe"}</span>
              </span>
            ),
          },
          { key: "next_review_date", label: "Revue", render: (r: Requirement) => <Revue r={r} /> },
        ]),
    {
      key: "status",
      label: "Statut",
      render: (r) => (
        <span className="inline-flex flex-col items-start gap-1">
          <TamponConformite mot={STATUT_EXIGENCE[r.status]} />
          {r.review_overdue && <TamponConformite mot="Revue en retard" />}
        </span>
      ),
    },
  ];

  const liste = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Recherche valeur={recherche} onChange={chercher} placeholder="Référence, texte, intitulé" />
        <Field label="Source" className="w-full sm:w-44">
          <Select value={source ?? ""} onChange={(e) => ecrire({ source: e.target.value })} placeholder="Toutes" options={ORDRE_SOURCE.map((s) => ({ value: s, label: SOURCE[s] }))} />
        </Field>
        <Field label="Référentiel" className="w-full sm:w-44">
          <Select value={norme ?? ""} onChange={(e) => ecrire({ norme: e.target.value })} placeholder="Tous" options={ORDRE_NORME.map((n) => ({ value: n, label: NORME[n] }))} />
        </Field>
        <Bascule actif={retard} onChange={(v) => ecrire({ retard: v ? "1" : null })} nombre={retard ? undefined : enRetard?.total_count}>
          Revue en retard
        </Bascule>
        {droits.hsseq && (
          <Button variant="primary" className="sm:ml-auto" onClick={() => setCreer(true)}>
            <Plus className="h-4 w-4" /> Nouvelle exigence
          </Button>
        )}
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented<FiltreStatut>
          label="Exigences affichées"
          value={statut}
          onChange={(s) => ecrire({ statut: s === "toutes" ? null : s })}
          options={[
            { key: "toutes", label: `Toutes (${fmtInt(compte?.total_count ?? 0)})` },
            { key: "conformes", label: `Conformes (${fmtInt(parStatut?.compliant ?? 0)})` },
            { key: "partielles", label: `Partielles (${fmtInt(parStatut?.partial ?? 0)})` },
            { key: "non_conformes", label: `Non conformes (${fmtInt(parStatut?.non_compliant ?? 0)})` },
            { key: "non_evaluees", label: `Non évaluées (${fmtInt(parStatut?.not_evaluated ?? 0)})` },
          ]}
        />
      </div>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement du registre des exigences…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(r) => r.id}
              sort={tri}
              onSort={(t) => {
                if (!(TRIS as readonly string[]).includes(t.key)) return;
                setTri(t);
                setPosition({ cle, offset: 0 });
              }}
              onRowClick={(r) => ecrire({ exigence: r.id })}
              empty={recherche || source || norme || retard || statut !== "toutes" ? "Aucune exigence pour ces filtres." : "Registre vide."}
              columns={colonnes}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="exigences" onPage={(x) => setPosition({ cle, offset: x })} />
          </>
        )}
      </Card>

      {creer && (
        <FenetreExigence
          onClose={() => setCreer(false)}
          envoyer={async (corps) => {
            const r = await apiSend<RequirementDetail>("POST", "/hsseq/requirements", corps);
            void rafraichir();
            ecrire({ exigence: r.id });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisie !== null} liste={liste} fiche={choisie !== null && <FicheExigence key={choisie} id={choisie} onFermer={() => ecrire({ exigence: null })} />} />;
}
