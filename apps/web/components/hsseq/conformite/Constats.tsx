"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { X } from "@/components/icons";
import { Card, DataTable, ErrorBox, Etat, Field, Segmented, Select, cx, type Column, type Tri } from "@/components/ui";
import { AvecFiche, ChampSite, Pages, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import { fmtInt, pluriel } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { CLASSEMENT, ORDRE_CLASSEMENT, Recherche, STATUT_CONSTAT, TamponConformite, anneeCourante, lienAudit, parmi, sansAction, useEtroit, type VueProps } from "./commun";
import { FicheConstat } from "./FicheConstat";
import type { AuditCounts, AuditLine, Finding, FindingClass, FindingCounts, FindingStatus } from "./types";

const PAR_PAGE = 50;

/** Statut dans l'adresse et sa clé dans l'API. */
const STATUT_ADRESSE: Record<"ouverts" | "soldes" | "tous", FindingStatus | null> = { ouverts: "open", soldes: "closed", tous: null };
type FiltreStatut = keyof typeof STATUT_ADRESSE;

/** Actions d'un constat en une ligne : nombre, celles en retard, ou ce qui manque. */
function ResumeActions({ f }: { f: Finding }) {
  const vivantes = f.actions.filter((a) => a.status !== "cancelled");
  if (!vivantes.length) return <span className="text-muted">{f.classification === "observation" ? "Aucune" : "Aucune action"}</span>;
  const ouvertes = vivantes.filter((a) => a.status !== "closed").length;
  const retard = vivantes.filter((a) => a.overdue).length;
  return (
    <span className="inline-flex min-w-[8rem] flex-col">
      <span className="text-ink">{pluriel(vivantes.length, "action")}</span>
      <span className={cx("text-[12px]", retard ? "font-semibold text-danger" : "text-muted")}>{retard ? `${fmtInt(retard)} en retard` : ouvertes ? pluriel(ouvertes, "en cours", "en cours") : vivantes.length > 1 ? "Toutes closes" : "Close"}</span>
    </span>
  );
}

/**
 * Constats de tous les audits du périmètre : recherche (référence, description, intitulé de l'audit ou
 * de l'exigence), filtres par statut (ouverts par défaut), classement, audit et site, portés par
 * l'adresse avec la fiche ouverte (constat). Venu de la fiche d'un audit (audit), la liste montre tous
 * ses constats, soldés compris.
 */
export function Constats({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const etroit = useEtroit();
  const courante = anneeCourante();
  const audit = Number(lire("audit")) || null;
  const statutParDefaut: FiltreStatut = audit ? "tous" : "ouverts";
  const statut: FiltreStatut = parmi(lire("statut"), STATUT_ADRESSE) ?? statutParDefaut;
  const classement: FindingClass | null = parmi(lire("classement"), CLASSEMENT);
  const site = lire("site");
  const recherche = lire("q");
  const choisi = Number(lire("constat")) || null;
  const chercher = useCallback((q: string) => ecrire({ q }), [ecrire]);

  const filtres = { q: recherche || null, classification: classement, audit_id: audit, site_id: site || null };
  const cle = `${requete(filtres)}|${statut}`;
  const [tri, setTri] = useState<Tri>({ key: "id", dir: -1 });
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;

  // Nombres de la sélection sans le statut (bascule) ; liste filtrée.
  const { data: compte } = useApi<Page<Finding, FindingCounts>>(`/hsseq/findings?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<Finding, FindingCounts>>(
    `/hsseq/findings?${requete({ ...filtres, status: STATUT_ADRESSE[statut], sort: `${tri.dir === -1 ? "-" : ""}id`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  // Audits proposés au filtre : des deux années passées à l'année suivante, les plus récents d'abord.
  const { data: audits } = useApi<Page<AuditLine, AuditCounts>>(`/hsseq/audits?${requete({ date_from: `${courante - 2}-01-01`, date_to: `${courante + 1}-12-31`, sort: "-planned_date", limit: 500 })}`);

  const parStatut = compte?.counts.by_status;
  const reference = data?.items.find((f) => f.audit.id === audit)?.audit.reference ?? audits?.items.find((a) => a.id === audit)?.reference ?? null;
  const optionsAudits = (audits?.items ?? []).map((a) => ({ value: a.id, label: `${a.reference} : ${a.title}` }));
  if (audit && !optionsAudits.some((o) => o.value === audit)) optionsAudits.unshift({ value: audit, label: reference ?? "Audit choisi" });
  const compact = etroit || choisi !== null;

  const colonnes: Column<Finding>[] = [
    {
      key: "id",
      label: "Constat",
      render: (f) => (
        <span className={cx("block min-w-[15rem] max-w-[52ch]", choisi === f.id && "font-medium")}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11.5px] text-muted">{f.reference}</span>
            {compact && <TamponConformite mot={CLASSEMENT[f.classification].label} />}
          </span>
          {choisi === f.id && <span className="sr-only"> (fiche ouverte)</span>}
          <span className="mt-0.5 line-clamp-2 block leading-snug text-ink">{f.description}</span>
          <span className="mt-1 block text-[12px] leading-snug text-muted">
            Audit {f.audit.reference}
            {f.site ? `, ${f.site.name}` : ""}
            {compact && f.requirement ? `, ${f.requirement.reference}` : ""}
          </span>
        </span>
      ),
    },
    ...(compact
      ? []
      : [
          { key: "classification", label: "Classement", render: (f: Finding) => <TamponConformite mot={CLASSEMENT[f.classification].label} /> },
          {
            key: "requirement",
            label: "Exigence",
            render: (f: Finding) =>
              f.requirement ? (
                <span className="block min-w-[10rem] max-w-[30ch]">
                  <span className="font-mono text-[11.5px] text-muted">{f.requirement.reference}</span>
                  <span className="line-clamp-2 block text-[12.5px] leading-snug text-ink-2">{f.requirement.title}</span>
                </span>
              ) : (
                <span className="text-muted">–</span>
              ),
          },
          { key: "actions", label: "Actions", render: (f: Finding) => <ResumeActions f={f} /> },
        ]),
    {
      key: "status",
      label: "Statut",
      render: (f) => (
        <span className="inline-flex flex-col items-start gap-1">
          <TamponConformite mot={STATUT_CONSTAT[f.status]} />
          {sansAction(f) && <TamponConformite mot="Sans action" />}
        </span>
      ),
    },
  ];

  const liste = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Recherche valeur={recherche} onChange={chercher} placeholder="Référence, constat, audit, exigence" />
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented<FiltreStatut>
            label="Constats affichés"
            value={statut}
            onChange={(s) => ecrire({ statut: s === statutParDefaut ? null : s })}
            options={[
              { key: "ouverts", label: `Ouverts (${fmtInt(parStatut?.open ?? 0)})` },
              { key: "soldes", label: `Soldés (${fmtInt(parStatut?.closed ?? 0)})` },
              { key: "tous", label: `Tous (${fmtInt(compte?.total_count ?? 0)})` },
            ]}
          />
        </div>
        <Field label="Classement" className="w-full sm:w-44">
          <Select value={classement ?? ""} onChange={(e) => ecrire({ classement: e.target.value })} placeholder="Tous" options={ORDRE_CLASSEMENT.map((c) => ({ value: c, label: CLASSEMENT[c].label }))} />
        </Field>
        <Field label="Audit" className="w-full sm:w-72">
          <Select value={audit ? String(audit) : ""} onChange={(e) => ecrire({ audit: e.target.value, statut: null })} placeholder="Tous" options={optionsAudits} />
        </Field>
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
      </div>

      {audit && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-accent-doux px-3.5 py-2 text-[13px] text-ink">
          <span>
            Constats de l&apos;audit{" "}
            <Link href={lienAudit({ id: audit }, audits?.items.find((a) => a.id === audit)?.planned_date)} className="font-semibold text-accent underline-offset-2 hover:underline">
              {reference ?? "choisi"}
            </Link>
          </span>
          <button type="button" onClick={() => ecrire({ audit: null, statut: null })} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-ink-2 transition-colors hover:bg-panel hover:text-ink">
            <X className="h-3.5 w-3.5" /> Tous les constats
          </button>
        </div>
      )}

      {!droits.hsseq && <p className="text-[12.5px] leading-snug text-muted">Un constat est soldé quand ses actions sont closes ou annulées ; une observation sans action l&apos;est d&apos;emblée. Le Responsable HSSEQ saisit les constats et leurs actions.</p>}

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des constats…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(f) => f.id}
              sort={tri}
              onSort={(t) => {
                // Le noyau ne trie les constats que par création (id).
                if (t.key !== "id") return;
                setTri(t);
                setPosition({ cle, offset: 0 });
              }}
              onRowClick={(f) => ecrire({ constat: f.id })}
              empty={statut === "ouverts" && !classement && !audit && !site && !recherche ? "Aucun constat ouvert." : "Aucun constat pour ces filtres."}
              columns={colonnes}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="constats" onPage={(x) => setPosition({ cle, offset: x })} />
          </>
        )}
      </Card>
    </div>
  );

  return <AvecFiche ouverte={choisi !== null} liste={liste} fiche={choisi !== null && <FicheConstat key={choisi} id={choisi} droits={droits} onFermer={() => ecrire({ constat: null })} />} />;
}
