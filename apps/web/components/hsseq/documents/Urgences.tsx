"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Kpi, Segmented, Select, Squelette, Tag, cx, type Column } from "@/components/ui";
import { AvecFiche, Bascule, ChampSite, Pages, aujourdhui, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { anneeCourante } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtInt, pluriel } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { FenetrePlan, FenetrePlanifier } from "./fenetres";
import { FicheExercice } from "./FicheExercice";
import { FichePlan } from "./FichePlan";
import { ORDRE_SCENARIOS, SCENARIO, STATUT_EXERCICE, TamponDocument, parmi, useRafraichir, type VueProps } from "./libelles";
import type { Drill, DrillCounts, DrillLine, DrillStatus, EmergencyPlan, PlanLine } from "./types";

const PAR_PAGE = 50;

/** Filtre de statut des exercices porté par l'adresse ; « planifies » les trie du plus ancien au plus récent (retards d'abord). */
const FILTRE_EXERCICES: Record<"tous" | "planifies" | "realises" | "annules", { label: string; statut: DrillStatus | null }> = {
  tous: { label: "Tous", statut: null },
  planifies: { label: "Planifiés", statut: "planned" },
  realises: { label: "Réalisés", statut: "done" },
  annules: { label: "Annulés", statut: "cancelled" },
};
type FiltreExercices = keyof typeof FILTRE_EXERCICES;

const TELEPHONE = "max-md:[&_th:not(:first-child)]:hidden max-md:[&_td:not(:first-child)]:hidden";

/** Années proposées : l'année suivante (programme en préparation), l'année en cours et les deux précédentes. */
function annees(courante: number, choisie: number | null): number[] {
  return [...new Set([courante + 1, courante, courante - 1, courante - 2, ...(choisie ? [choisie] : [])])].sort((a, b) => b - a);
}

/** Revue d'un plan en vigueur passée (la date de revue n'est pas tenue par le noyau en retard). */
function revueEchue(p: Pick<PlanLine, "active" | "review_date">): boolean {
  return p.active && p.review_date !== null && p.review_date < aujourdhui();
}

/**
 * Plans d'intervention d'urgence et exercices (GET /hsseq/emergency-plans, /hsseq/drills) : situation
 * (plans en vigueur, exercices en retard, exercices réalisés dans l'année), puis la liste des plans ou
 * celle des exercices ; la fiche d'un plan ou d'un exercice s'ouvre à côté. Liste, filtres et fiche
 * portés par l'adresse (liste, site, scenario, archives, statut, annee, plan, exercice). Le chef de
 * parc et l'auditeur ne reçoivent du noyau que les plans et exercices de leurs sites.
 */
export function Urgences({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const rafraichir = useRafraichir();
  const liste: "plans" | "exercices" = lire("liste") === "exercices" ? "exercices" : "plans";
  const site = /^\d+$/.test(lire("site")) ? lire("site") : "";
  const scenario = parmi(lire("scenario"), SCENARIO);
  const planOuvert = Number(lire("plan")) || null;
  const exerciceOuvert = Number(lire("exercice")) || null;
  const ouverte = planOuvert !== null || exerciceOuvert !== null;
  const courante = anneeCourante();
  const [creer, setCreer] = useState<"plan" | "exercice" | null>(null);

  // Situation, au site choisi : plans en vigueur (tous, pour compter ceux sans exercice prévu), retards, année en cours.
  const { data: enVigueur } = useApi<Page<PlanLine>>(`/hsseq/emergency-plans?${requete({ site_id: site || null, limit: 500 })}`, { keepPreviousData: true });
  const { data: tous } = useApi<Page<DrillLine, DrillCounts>>(`/hsseq/drills?${requete({ site_id: site || null, limit: 1 })}`, { keepPreviousData: true });
  const { data: annee } = useApi<Page<DrillLine, DrillCounts>>(`/hsseq/drills?${requete({ site_id: site || null, year: courante, limit: 1 })}`, { keepPreviousData: true });

  const ouvrirPlan = (id: number) => ecrire({ plan: id, exercice: null });
  const ouvrirExercice = (id: number) => ecrire({ exercice: id, plan: null });

  const vue = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented<"plans" | "exercices">
          label="Liste affichée"
          value={liste}
          onChange={(l) => ecrire({ liste: l === "plans" ? null : l, statut: null, annee: null, archives: null })}
          options={[
            { key: "plans", label: "Plans d'intervention" },
            { key: "exercices", label: "Exercices" },
          ]}
        />
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v || null })} />
        <Field label="Scénario" className="w-full sm:w-48">
          <Select value={scenario ?? ""} onChange={(e) => ecrire({ scenario: e.target.value || null })} placeholder="Tous" options={ORDRE_SCENARIOS.map((s) => ({ value: s, label: SCENARIO[s] }))} />
        </Field>
        {droits.ecriture && (
          <Button variant="primary" className="sm:ml-auto" onClick={() => setCreer(liste === "plans" ? "plan" : "exercice")}>
            <Plus className="h-4 w-4" /> {liste === "plans" ? "Nouveau plan" : "Planifier un exercice"}
          </Button>
        )}
      </div>
      {liste === "plans" ? (
        <ListePlans lire={lire} ecrire={ecrire} site={site} scenario={scenario} choisi={planOuvert} compact={ouverte} onOuvrir={ouvrirPlan} />
      ) : (
        <ListeExercices lire={lire} ecrire={ecrire} site={site} scenario={scenario} choisi={exerciceOuvert} compact={ouverte} onOuvrir={ouvrirExercice} />
      )}
      {creer === "plan" && (
        <FenetrePlan
          onClose={() => setCreer(null)}
          envoyer={async (corps) => {
            const p = await apiSend<EmergencyPlan>("POST", "/hsseq/emergency-plans", corps);
            void rafraichir();
            ecrire({ plan: p.id, exercice: null });
          }}
        />
      )}
      {creer === "exercice" && (
        <FenetrePlanifier
          plans={(enVigueur?.items ?? []).filter((p) => p.active)}
          onClose={() => setCreer(null)}
          envoyer={async (planId, corps) => {
            const d = await apiSend<Drill>("POST", `/hsseq/emergency-plans/${planId}/drills`, corps);
            void rafraichir();
            ecrire({ exercice: d.id, plan: null });
          }}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className={cx(ouverte && "max-lg:hidden")}>
        <Situation plans={enVigueur} tous={tous} annee={annee} courante={courante} />
      </div>
      <AvecFiche
        ouverte={ouverte}
        liste={vue}
        fiche={
          exerciceOuvert !== null ? (
            <FicheExercice key={`e${exerciceOuvert}`} id={exerciceOuvert} droits={droits} onFermer={() => ecrire({ exercice: null })} onPlan={ouvrirPlan} />
          ) : (
            planOuvert !== null && <FichePlan key={`p${planOuvert}`} id={planOuvert} droits={droits} onFermer={() => ecrire({ plan: null })} onExercice={ouvrirExercice} />
          )
        }
      />
    </div>
  );
}

/* ─── Situation ───────────────────────────────────────────────────────── */

/** Chiffres clés : plans en vigueur (et ceux sans exercice prévu), exercices en retard, exercices réalisés dans l'année. */
function Situation({ plans, tous, annee, courante }: { plans?: Page<PlanLine>; tous?: Page<DrillLine, DrillCounts>; annee?: Page<DrillLine, DrillCounts>; courante: number }) {
  if (!plans || !tous || !annee) {
    return (
      <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Squelette key={i} className="h-[118px]" />
        ))}
      </div>
    );
  }
  const sansExercice = plans.items.filter((p) => p.active && !p.next_drill).length;
  const echues = plans.items.filter(revueEchue).length;
  const retard = tous.counts.overdue;
  const faits = annee.counts.by_status.done ?? 0;
  const prevus = faits + (annee.counts.by_status.planned ?? 0);
  const indications = [sansExercice ? pluriel(sansExercice, "plan sans exercice prévu", "plans sans exercice prévu") : null, echues ? pluriel(echues, "revue échue", "revues échues") : null].filter(Boolean);
  return (
    <section aria-label="Situation des plans et des exercices" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Kpi label="Plans d'intervention en vigueur" value={fmtInt(plans.total_count)} tone={sansExercice || echues ? "warn" : "neutral"} hint={indications.length ? indications.join(", ") : "Un plan par site et par scénario"} />
      <Kpi label="Exercices en retard" value={fmtInt(retard)} tone={retard > 0 ? "danger" : "ok"} hint="Prévus à une date passée, ni réalisés ni annulés" />
      <Kpi label={`Exercices réalisés en ${courante}`} value={fmtInt(faits)} hint={prevus ? `sur ${pluriel(prevus, "exercice prévu", "exercices prévus")} dans l'année, annulés exclus` : "Aucun exercice prévu dans l'année"} />
    </section>
  );
}

/* ─── Plans ───────────────────────────────────────────────────────────── */

interface ListeProps {
  lire: (cle: string) => string;
  ecrire: (maj: Record<string, string | number | null>) => void;
  site: string;
  scenario: string | null;
  choisi: number | null;
  compact: boolean;
  onOuvrir: (id: number) => void;
}

/** Plans d'intervention, par site et par scénario ; les archivés sur demande. */
function ListePlans({ lire, ecrire, site, scenario, choisi, compact, onOuvrir }: ListeProps) {
  const archives = lire("archives") === "1";
  const { data, error, mutate } = useApi<Page<PlanLine>>(`/hsseq/emergency-plans?${requete({ site_id: site || null, scenario, active: archives ? "all" : null, limit: 500 })}`, { keepPreviousData: true });
  const colonnes: Array<Column<PlanLine> & { secondaire?: boolean }> = [
    {
      key: "reference",
      label: "Plan",
      sortValue: (p) => p.reference,
      render: (p) => (
        <div className="min-w-[14rem] max-w-[50ch]">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-muted">{p.reference}</span>
            <Tag>{SCENARIO[p.scenario]}</Tag>
            {choisi === p.id && <span className="sr-only">fiche ouverte</span>}
          </span>
          <span className={cx("mt-1 line-clamp-2 block leading-snug text-ink", choisi === p.id && "font-semibold")}>{p.title}</span>
          <span className="mt-1 block text-[12px] text-muted">{p.site?.name ?? "Site non précisé"}</span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 md:hidden">
            <EtatsPlan p={p} />
            {p.next_drill && <span className="text-[12px] text-muted">Prochain exercice le {fmtDate(p.next_drill)}</span>}
          </span>
        </div>
      ),
    },
    { key: "last_drill", label: "Dernier exercice", secondaire: true, sortValue: (p) => p.last_drill ?? "", render: (p) => (p.last_drill ? <span className="whitespace-nowrap">{fmtDate(p.last_drill)}</span> : <span className="text-muted">Aucun</span>) },
    {
      key: "next_drill",
      label: "Prochain exercice",
      sortValue: (p) => p.next_drill ?? "9999",
      render: (p) => (p.next_drill ? <span className={cx("whitespace-nowrap", p.next_drill < aujourdhui() && "font-semibold text-danger")}>{fmtDate(p.next_drill)}</span> : <span className="text-muted">Aucun prévu</span>),
    },
    {
      key: "review_date",
      label: "Revue du plan",
      secondaire: true,
      sortValue: (p) => p.review_date ?? "9999",
      render: (p) => (p.review_date ? <span className={cx("whitespace-nowrap", revueEchue(p) && "font-semibold text-danger")}>{fmtDate(p.review_date)}</span> : <span className="text-muted">Non programmée</span>),
    },
    { key: "status", label: "Statut", sortValue: (p) => (p.active ? 0 : 1), render: (p) => <EtatsPlan p={p} /> },
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Bascule actif={archives} onChange={(v) => ecrire({ archives: v ? "1" : null })}>
          Plans archivés
        </Bascule>
        <p className="m-0 text-[12.5px] leading-snug text-muted">Un seul plan en vigueur par site et par scénario&nbsp;; chacun s&apos;éprouve par des exercices réguliers.</p>
      </div>
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des plans…" />
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
                onRowClick={(p) => onOuvrir(p.id)}
                empty={site || scenario ? "Aucun plan pour ces filtres." : "Aucun plan d'intervention."}
                columns={colonnes.filter((c) => !(compact && c.secondaire))}
              />
            </div>
          </>
        )}
      </Card>
    </>
  );
}

/** Tampons d'un plan : en vigueur ou archivé, revue échue, sans exercice prévu. */
function EtatsPlan({ p }: { p: PlanLine }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <TamponDocument mot={p.active ? "En vigueur" : "Archivé"} />
      {revueEchue(p) && <TamponDocument mot="Revue échue" />}
      {p.active && !p.next_drill && <TamponDocument mot="Sans exercice prévu" />}
    </span>
  );
}

/* ─── Exercices ───────────────────────────────────────────────────────── */

/** Exercices de tous les plans : statut avec ses nombres, année ; les planifiés du plus ancien au plus récent. */
function ListeExercices({ lire, ecrire, site, scenario, choisi, compact, onOuvrir }: ListeProps) {
  const statut: FiltreExercices = parmi(lire("statut"), FILTRE_EXERCICES) ?? "tous";
  const annee = /^\d{4}$/.test(lire("annee")) ? Number(lire("annee")) : null;
  const courante = anneeCourante();
  const filtres = { site_id: site || null, scenario, year: annee };
  const cle = `${requete(filtres)}|${statut}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const { data: compte } = useApi<Page<DrillLine, DrillCounts>>(`/hsseq/drills?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<DrillLine, DrillCounts>>(
    `/hsseq/drills?${requete({ ...filtres, status: FILTRE_EXERCICES[statut].statut, sort: statut === "planifies" ? "planned_date" : null, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const n = compte?.counts.by_status;
  const total = n ? (n.planned ?? 0) + (n.done ?? 0) + (n.cancelled ?? 0) : null;
  const nombre = (f: FiltreExercices) => {
    const s = FILTRE_EXERCICES[f].statut;
    return !n ? null : s ? (n[s] ?? 0) : total;
  };
  const colonnes: Array<Column<DrillLine> & { secondaire?: boolean }> = [
    {
      key: "reference",
      label: "Exercice",
      sortValue: (d) => d.reference,
      render: (d) => (
        <div className="min-w-[14rem] max-w-[50ch]">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-muted">{d.reference}</span>
            <Tag>{SCENARIO[d.scenario]}</Tag>
            {choisi === d.id && <span className="sr-only">fiche ouverte</span>}
          </span>
          <span className={cx("mt-1 line-clamp-2 block leading-snug text-ink", choisi === d.id && "font-semibold")}>{d.plan.title}</span>
          <span className="mt-1 block text-[12px] text-muted">
            {d.plan.reference}, {d.site?.name ?? "site non précisé"}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 md:hidden">
            <TamponDocument mot={STATUT_EXERCICE[d.status]} />
            {d.overdue && <TamponDocument mot="En retard" />}
            <span className="text-[12px] text-muted">{d.status === "done" ? `Réalisé le ${fmtDate(d.performed_date)}` : `Prévu le ${fmtDate(d.planned_date)}`}</span>
          </span>
        </div>
      ),
    },
    {
      key: "planned_date",
      label: "Prévu le",
      sortValue: (d) => d.planned_date,
      render: (d) => <span className={cx("whitespace-nowrap", d.overdue && "font-semibold text-danger")}>{fmtDate(d.planned_date)}</span>,
    },
    { key: "performed_date", label: "Réalisé le", secondaire: true, sortValue: (d) => (d.status === "done" ? (d.performed_date ?? "") : ""), render: (d) => (d.status === "done" ? <span className="whitespace-nowrap">{fmtDate(d.performed_date)}</span> : <span className="text-muted">–</span>) },
    { key: "participants_count", label: "Participants", align: "right", secondaire: true, sortValue: (d) => d.participants_count ?? -1, render: (d) => (d.participants_count ? fmtInt(d.participants_count) : <span className="text-muted">–</span>) },
    {
      key: "status",
      label: "Statut",
      sortValue: (d) => d.status,
      render: (d) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <TamponDocument mot={STATUT_EXERCICE[d.status]} />
          {d.overdue && <TamponDocument mot="En retard" />}
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Segmented<FiltreExercices>
            label="Exercices affichés"
            value={statut}
            onChange={(s) => ecrire({ statut: s === "tous" ? null : s })}
            options={(Object.keys(FILTRE_EXERCICES) as FiltreExercices[]).map((f) => ({ key: f, label: nombre(f) === null ? FILTRE_EXERCICES[f].label : `${FILTRE_EXERCICES[f].label} (${fmtInt(nombre(f))})` }))}
          />
        </div>
        <Field label="Année" className="w-full sm:w-36">
          <Select value={annee ? String(annee) : ""} onChange={(e) => ecrire({ annee: e.target.value || null })} placeholder="Toutes" options={annees(courante, annee).map((y) => ({ value: y, label: String(y) }))} />
        </Field>
      </div>
      {statut === "planifies" && (compte?.counts.overdue ?? 0) > 0 && (
        <p className="m-0 text-[12.5px] font-medium leading-snug text-danger">{`${pluriel(compte?.counts.overdue ?? 0, "exercice en retard", "exercices en retard")}, en tête de liste.`}</p>
      )}
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des exercices…" />
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
                rowKey={(d) => d.id}
                onRowClick={(d) => onOuvrir(d.id)}
                empty={site || scenario || annee || statut !== "tous" ? "Aucun exercice pour ces filtres." : "Aucun exercice planifié."}
                columns={colonnes.filter((c) => !(compact && c.secondaire))}
              />
            </div>
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="exercices" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>
    </>
  );
}
