"use client";

/**
 * Éléments d'entrée de la revue de direction (rubriques 2 à 9 du compte rendu), tels que le noyau les a
 * rassemblés depuis le module (_compute_inputs) : suite de la revue précédente, indicateurs du cockpit
 * sur la période, événements, état des actions, audits et constats, exigences et maturité ISO, risques,
 * environnement et qualité, urgences, documents et télématique. Rien n'est recalculé à l'écran : une
 * revue tenue montre l'instantané figé de sa séance. Chaque fiche citée mène à son registre.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ProgressBar, Repartition, Tag, cx } from "@/components/ui";
import { Criticite, NIVEAUX, ORDRE_NIVEAUX, STATUT_ACTION, STATUT_EVENEMENT, TYPE_EVENEMENT, Tampon, fmtCible, fmtIndicateur } from "@/components/hsseq/commun";
import { aujourdhui } from "@/components/hsseq/actions/outils";
import { ETATS } from "@/lib/couleurs";
import { INSECABLE, fmtDate, fmtDateTime, fmtDec, fmtInt, fmtPct, pluriel } from "@/lib/format";
import type { CriticalityLevel, EventType, FindingClass, RequirementStatus } from "@/lib/hsseq-types";
import { Chiffres, LienEcran, LigneFiche, ListeFiches, Reference, Rubrique, SousTitre, type Chiffre } from "./briques";
import {
  CLASSEMENT,
  ETAT_INDICATEUR,
  NATURE_DECISION,
  ORDRE_ETATS_INDICATEUR,
  ORIGINE,
  PROGRAMME_AUDIT,
  SCENARIO,
  SOURCE_EXIGENCE,
  STATUT_AUDIT,
  STATUT_EXIGENCE,
  TamponRevue,
  VIOLATION,
  dePeriode,
  lienRevue,
} from "./outils";
import type { InputIndicator, Review, ReviewInputs } from "./types";

/* ─── Liens vers les registres (adresses lues par chaque écran) ───────── */

const lienEvenement = (id: number) => `/hsseq/evenements/${id}`;
const lienAction = (id: number) => `/hsseq/actions?action=${id}`;
const lienRisque = (id: number) => `/hsseq/risques?risque=${id}`;
/** Audit dans le programme de son année (vue par défaut de « Audits et conformité »). */
function lienAudit(id: number, prevu: string | null): string {
  const annee = prevu?.slice(0, 4);
  return `/hsseq/conformite?audit=${id}${annee && annee !== aujourdhui().slice(0, 4) ? `&annee=${annee}` : ""}`;
}
const lienConstat = (id: number) => `/hsseq/conformite?vue=constats&statut=tous&constat=${id}`;
const lienExigence = (id: number) => `/hsseq/conformite?vue=exigences&exigence=${id}`;

/** Ancres des rubriques, partagées avec le sommaire de la fiche. */
export const ANCRES = {
  tenue: "revue-tenue",
  entree: "revue-entree",
  suite: "revue-suite",
  indicateurs: "revue-indicateurs",
  evenements: "revue-evenements",
  actions: "revue-actions",
  audits: "revue-audits",
  risques: "revue-risques",
  environnement: "revue-environnement",
  urgences: "revue-urgences",
  compteRendu: "revue-compte-rendu",
  decisions: "revue-decisions",
  conclusions: "revue-conclusions",
  pieces: "revue-pieces",
  historique: "revue-historique",
} as const;

/** Repère de couleur de chaque statut d'exigence dans la répartition (le libellé le dit aussi). */
const COULEUR_EXIGENCE: Record<RequirementStatus, string> = { compliant: ETATS.bon, partial: ETATS.attention, non_compliant: ETATS.alerte, not_evaluated: ETATS.neutre };
const ORDRE_EXIGENCE: readonly RequirementStatus[] = ["compliant", "partial", "non_compliant", "not_evaluated"];
const ORDRE_CLASSES: readonly FindingClass[] = ["major", "minor", "observation"];

const n = (v: number | null | undefined) => v ?? 0;
const sans = (texte: string) => <p className="text-[13px] leading-snug text-muted">{texte}</p>;

/** Pastilles de comptes par niveau de criticité, du plus élevé au plus faible, avec le repère de couleur du niveau. */
function ParNiveau({ comptes, nom }: { comptes: Partial<Record<CriticalityLevel, number>> | undefined; nom: (niveau: CriticalityLevel, nombre: number) => string }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {[...ORDRE_NIVEAUX].reverse().map((niveau) => (
        <li key={niveau} className="inline-flex min-h-8 items-center gap-2 rounded-[10px] border border-line bg-panel px-2.5 py-1 text-[13px] text-ink-2">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: NIVEAUX[niveau].couleur }} />
          <span className="font-semibold tabular text-ink">{fmtInt(n(comptes?.[niveau]))}</span>
          {nom(niveau, n(comptes?.[niveau]))}
        </li>
      ))}
    </ul>
  );
}

/** Pastille d'un compte nommé (« Excès de vitesse 17 »). */
function Compte({ label, valeur }: { label: string; valeur: number }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-md bg-panel-3 px-2 py-0.5 text-[12.5px] text-ink-2">
      {label}
      <span className="font-semibold tabular text-ink">{fmtInt(valeur)}</span>
    </li>
  );
}

/** « 1 majeur, 2 mineurs, 1 observation » ; « Aucun constat » sinon. */
function constatsEnClair(c: Partial<Record<FindingClass, number>> | undefined): string {
  const parts = ORDRE_CLASSES.filter((k) => n(c?.[k]) > 0).map((k) => pluriel(n(c?.[k]), CLASSEMENT[k]?.un ?? k, CLASSEMENT[k]?.plusieurs ?? k));
  return parts.length ? parts.join(", ") : "Aucun constat";
}

/* ─── Points d'attention ──────────────────────────────────────────────── */

/**
 * En-tête des éléments d'entrée : date et période du rassemblement, puis les points qui appellent une
 * décision, chacun menant à sa rubrique.
 */
export function EnTeteEntree({ r }: { r: Review }) {
  if (!r.inputs) {
    return (
      <Rubrique id={ANCRES.entree} titre="Éléments d'entrée">
        {sans(`Pas encore rassemblés${INSECABLE}: ils le sont à la préparation de la revue, puis à chaque rafraîchissement.`)}
      </Rubrique>
    );
  }
  const e = r.inputs;
  const indicateurs = e.indicators ?? [];
  const horsCible = indicateurs.filter((i) => i.status === "missed").length;
  const surveillance = indicateurs.filter((i) => i.status === "watch").length;
  const majeurs = n(e.audits?.open_findings_by_class?.major);
  const mineurs = n(e.audits?.open_findings_by_class?.minor);
  const nonConformes = n(e.requirements?.by_status?.non_compliant);
  const eleves = n(e.risks?.by_residual_level?.high);
  const significatifs = n(e.risks?.by_residual_level?.significant);
  const precedentes = e.previous_review?.decisions ?? [];
  const nonSoldees = precedentes.filter((d) => !d.action || !["closed", "cancelled"].includes(d.action.status)).length;
  const points: Array<{ ancre: string; valeur: number; label: string; precision?: string; ton?: "danger" | "warn" }> = [
    { ancre: ANCRES.indicateurs, valeur: horsCible, label: horsCible > 1 ? "indicateurs non conformes" : "indicateur non conforme", precision: `${fmtInt(surveillance)} sous surveillance, sur ${fmtInt(indicateurs.length)}`, ton: horsCible ? "danger" : undefined },
    { ancre: ANCRES.evenements, valeur: n(e.events?.notable_count), label: n(e.events?.notable_count) > 1 ? "événements marquants" : "événement marquant", precision: `sur ${pluriel(n(e.events?.total), "événement")}`, ton: n(e.events?.notable_count) ? "warn" : undefined },
    { ancre: ANCRES.actions, valeur: n(e.actions?.overdue), label: n(e.actions?.overdue) > 1 ? "actions en retard" : "action en retard", precision: "au plan d'actions", ton: n(e.actions?.overdue) ? "danger" : undefined },
    { ancre: ANCRES.audits, valeur: majeurs + mineurs, label: majeurs + mineurs > 1 ? "écarts d'audit ouverts" : "écart d'audit ouvert", precision: `dont ${pluriel(majeurs, "majeur")}`, ton: majeurs ? "danger" : mineurs ? "warn" : undefined },
    { ancre: ANCRES.audits, valeur: nonConformes, label: nonConformes > 1 ? "exigences non conformes" : "exigence non conforme", precision: `${pluriel(n(e.requirements?.by_status?.partial), "partiellement conforme", "partiellement conformes")}`, ton: nonConformes ? "danger" : undefined },
    { ancre: ANCRES.risques, valeur: eleves + significatifs, label: "risques résiduels significatifs ou élevés", precision: `dont ${pluriel(eleves, "élevé", "élevés")}`, ton: eleves ? "danger" : significatifs ? "warn" : undefined },
    ...(e.previous_review ? [{ ancre: ANCRES.suite, valeur: nonSoldees, label: nonSoldees > 1 ? "décisions précédentes non soldées" : "décision précédente non soldée", precision: `sur ${pluriel(precedentes.length, "décision")} de ${e.previous_review.reference}`, ton: nonSoldees ? ("warn" as const) : undefined }] : []),
  ];
  return (
    <Rubrique
      id={ANCRES.entree}
      titre="Éléments d'entrée"
      aide={
        r.inputs_generated_at
          ? `Rassemblés par NIMOVA le ${fmtDateTime(r.inputs_generated_at)}${e.period?.label ? ` sur la période ${dePeriode(e.period.label)}` : ""}. ${r.state === "prepared" ? "Ils se rafraîchissent jusqu'à la séance, puis restent figés." : `Figés à la tenue de la revue${INSECABLE}: ils restent ceux de la séance.`}`
          : "Pas encore rassemblés."
      }
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {points.map((p) => (
          <li key={p.label + p.ancre} className="min-w-0">
            <a href={`#${p.ancre}`} className="flex h-full flex-col gap-1 rounded-[12px] border border-line px-3.5 py-3 outline-offset-2 transition-colors hover:border-line-strong hover:bg-panel-2">
              <span className={cx("font-display text-[22px] font-[650] leading-none tracking-[-0.02em] tabular", p.ton === "danger" ? "text-danger" : p.ton === "warn" ? "text-warn" : "text-ink")}>{fmtInt(p.valeur)}</span>
              <span className="text-[13px] font-medium leading-snug text-ink-2">{p.label}</span>
              {p.precision && <span className="text-[12px] leading-snug text-muted">{p.precision}</span>}
            </a>
          </li>
        ))}
      </ul>
    </Rubrique>
  );
}

/* ─── 2. Suite de la revue précédente ─────────────────────────────────── */

function Suite({ e }: { e: ReviewInputs }) {
  const p = e.previous_review;
  return (
    <Rubrique id={ANCRES.suite} numero={2} titre="Suite de la revue précédente" aide={p ? "État des actions à la date où les éléments d'entrée ont été rassemblés." : undefined}>
      {!p ? (
        sans(`Aucune revue précédente tenue pour cette société${INSECABLE}: c'est la première revue de direction dans NIMOVA.`)
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">
            Revue{" "}
            <Link href={lienRevue(p.id)} className="font-semibold text-accent underline-offset-2 hover:underline">
              {p.reference}
            </Link>
            {p.held_on ? `, tenue le ${fmtDate(p.held_on)}` : ""}
            {`${INSECABLE}: ${pluriel(p.decisions.length, "décision")}.`}
          </p>
          {p.decisions.length > 0 && (
            <ListeFiches>
              {p.decisions.map((d) => (
                <LigneFiche
                  key={d.id}
                  href={d.action ? lienAction(d.action.id) : undefined}
                  entete={
                    <>
                      <Tag>{NATURE_DECISION[d.topic]?.court ?? d.topic}</Tag>
                      {d.action ? <Tampon mot={STATUT_ACTION[d.action.status]} /> : <TamponRevue mot="Sans action" />}
                    </>
                  }
                  texte={d.description}
                  precision={d.action ? `Action ${d.action.reference}${d.action.due_date ? `, échéance le ${fmtDate(d.action.due_date)}` : ""}` : "Aucune action inscrite au plan pour cette décision."}
                />
              ))}
            </ListeFiches>
          )}
        </>
      )}
    </Rubrique>
  );
}

/* ─── 3. Indicateurs ──────────────────────────────────────────────────── */

const FAMILLE = { proactive: "Proactif", reactive: "Réactif" } as const;

function Indicateurs({ e }: { e: ReviewInputs }) {
  const liste = e.indicators ?? [];
  const parEtat = (s: InputIndicator["status"]) => liste.filter((i) => i.status === s).length;
  // Hors cible d'abord, puis l'ordre du cockpit.
  const lignes = [...liste].sort((a, b) => ORDRE_ETATS_INDICATEUR.indexOf(a.status) - ORDRE_ETATS_INDICATEUR.indexOf(b.status));
  return (
    <Rubrique
      id={ANCRES.indicateurs}
      numero={3}
      titre="Indicateurs de la période"
      aide="Indicateurs du cockpit calculés sur les mois de la période, et leur état au regard de la cible des réglages."
      actions={<LienEcran href="/hsseq">Cockpit</LienEcran>}
    >
      {!liste.length ? (
        sans("Aucun indicateur rassemblé.")
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">
            {`Sur ${pluriel(liste.length, "indicateur")}${INSECABLE}: `}
            <span className={cx(parEtat("missed") > 0 && "font-semibold text-danger")}>{pluriel(parEtat("missed"), "non conforme", "non conformes")}</span>
            {`, ${pluriel(parEtat("watch"), "sous surveillance", "sous surveillance")}, ${pluriel(parEtat("met"), "conforme")}, ${pluriel(parEtat("no_data"), "sans donnée", "sans donnée")}.`}
          </p>
          <ul className="divide-y divide-line/80 overflow-hidden rounded-[12px] border border-line">
            <li aria-hidden className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem_10rem] gap-x-4 bg-panel-2 px-3.5 py-2 text-[12px] font-semibold text-muted sm:grid">
              <span>Indicateur</span>
              <span className="text-right">Valeur</span>
              <span className="text-right">Cible</span>
              <span className="text-right">État</span>
            </li>
            {lignes.map((i) => (
              <li key={i.code} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_10rem] sm:items-center">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium leading-snug text-ink">{i.label}</span>
                  <span className="block text-[12px] leading-snug text-muted" title={i.formula}>
                    {`${FAMILLE[i.family] ?? ""}, source${INSECABLE}: ${i.source}`}
                  </span>
                </span>
                <span className="text-right font-display text-[16px] font-[650] tabular text-ink">
                  <span className="sr-only">Valeur </span>
                  {fmtIndicateur(i.value, i.unit)}
                </span>
                <span className="text-[12.5px] text-muted sm:text-right">
                  <span className="sm:sr-only">Cible </span>
                  {fmtCible(i.target, i.unit, i.direction)}
                </span>
                <span className="text-right">
                  <Tampon mot={ETAT_INDICATEUR[i.status]} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Rubrique>
  );
}

/* ─── 4. Événements ───────────────────────────────────────────────────── */

function Evenements({ e }: { e: ReviewInputs }) {
  const ev = e.events;
  const types = Object.entries(ev?.by_type ?? {}).filter(([, v]) => n(v) > 0) as Array<[EventType, number]>;
  return (
    <Rubrique id={ANCRES.evenements} numero={4} titre="Événements" aide="Événements survenus sur la période, et les plus critiques." actions={<LienEcran href="/hsseq/evenements">Événements</LienEcran>}>
      {!ev ? (
        sans("Aucun événement rassemblé.")
      ) : (
        <>
          <Chiffres
            lignes={[
              { label: "Événements de la période", valeur: fmtInt(ev.total) },
              { label: "Encore ouverts", valeur: fmtInt(ev.open), ton: ev.open ? "warn" : undefined },
              { label: "Non encore classés", valeur: fmtInt(ev.unclassified), ton: ev.unclassified ? "warn" : undefined },
              { label: "Criticité significative ou élevée", valeur: fmtInt(ev.notable_count), ton: ev.notable_count ? "warn" : undefined },
            ]}
          />
          <div className="space-y-2">
            <SousTitre>Par criticité</SousTitre>
            <ParNiveau comptes={ev.by_level} nom={(niveau) => NIVEAUX[niveau].label.toLocaleLowerCase("fr")} />
          </div>
          {types.length > 0 && (
            <div className="space-y-2">
              <SousTitre>Par type</SousTitre>
              <ul className="flex flex-wrap gap-1.5">
                {types.map(([t, v]) => (
                  <Compte key={t} label={TYPE_EVENEMENT[t]?.label ?? t} valeur={v} />
                ))}
              </ul>
            </div>
          )}
          <div>
            <SousTitre>Événements marquants</SousTitre>
            {!ev.notable.length ? (
              sans("Aucun événement de criticité significative ou élevée sur la période.")
            ) : (
              <>
                <ListeFiches>
                  {ev.notable.map((x) => (
                    <LigneFiche
                      key={x.id}
                      href={lienEvenement(x.id)}
                      entete={
                        <>
                          <Reference>{x.reference}</Reference>
                          <Criticite note={x.criticality} />
                          <Tampon mot={STATUT_EVENEMENT[x.status] ?? x.status} />
                        </>
                      }
                      texte={x.title}
                      precision={[x.occurred_at ? fmtDate(x.occurred_at) : null, x.site, TYPE_EVENEMENT[x.event_type]?.label].filter(Boolean).join(", ")}
                    />
                  ))}
                </ListeFiches>
                {ev.notable_count > ev.notable.length && <p className="mt-2 text-[12.5px] text-muted">{`Les ${fmtInt(ev.notable.length)} plus critiques sur ${fmtInt(ev.notable_count)}.`}</p>}
              </>
            )}
          </div>
        </>
      )}
    </Rubrique>
  );
}

/* ─── 5. Actions ──────────────────────────────────────────────────────── */

function Actions({ e }: { e: ReviewInputs }) {
  const a = e.actions;
  return (
    <Rubrique id={ANCRES.actions} numero={5} titre="État des actions" aide={`Registre du plan d'actions à la date du rassemblement${INSECABLE}; créations et clôtures sur la période.`} actions={<LienEcran href="/hsseq/actions?retard=1">Actions en retard</LienEcran>}>
      {!a ? (
        sans("Aucune action rassemblée.")
      ) : (
        <>
          <Chiffres
            lignes={[
              { label: "À faire", valeur: fmtInt(n(a.open_by_status.todo)) },
              { label: "En cours", valeur: fmtInt(n(a.open_by_status.in_progress)) },
              { label: "À vérifier (efficacité)", valeur: fmtInt(n(a.open_by_status.to_verify)) },
              { label: "En retard", valeur: fmtInt(a.overdue), ton: a.overdue ? "danger" : undefined },
              { label: "Créées sur la période", valeur: fmtInt(a.created) },
              { label: "Closes sur la période", valeur: fmtInt(a.closed) },
              { label: "Réalisées dans les délais", valeur: fmtPct(a.on_time_rate) },
              { label: "Efficaces à la vérification", valeur: fmtPct(a.effectiveness_rate) },
            ]}
          />
          {a.overdue_items.length > 0 && (
            <div>
              <SousTitre>Actions en retard</SousTitre>
              <ListeFiches>
                {a.overdue_items.map((x) => (
                  <LigneFiche
                    key={x.id}
                    href={lienAction(x.id)}
                    entete={
                      <>
                        <Reference>{x.reference}</Reference>
                        <span className="text-[12px] text-muted">{ORIGINE[x.origin] ?? x.origin}</span>
                      </>
                    }
                    texte={x.description}
                    precision={`${x.owner ?? "Conducteur"}, échéance le ${fmtDate(x.due_date)}`}
                    fin={<span className="whitespace-nowrap text-[13px] font-semibold text-danger">{pluriel(x.days_overdue, "jour")}</span>}
                  />
                ))}
              </ListeFiches>
              {a.overdue > a.overdue_items.length && <p className="mt-2 text-[12.5px] text-muted">{`Les ${fmtInt(a.overdue_items.length)} plus anciennes sur ${fmtInt(a.overdue)}.`}</p>}
            </div>
          )}
        </>
      )}
    </Rubrique>
  );
}

/* ─── 6. Audits, constats et exigences ────────────────────────────────── */

function Audits({ e }: { e: ReviewInputs }) {
  const au = e.audits;
  const ex = e.requirements;
  const maturite = e.iso_maturity ?? [];
  return (
    <Rubrique id={ANCRES.audits} numero={6} titre="Audits, constats et exigences" aide="Programme d'audits de la période, constats encore ouverts, conformité aux exigences légales, normatives et contractuelles.">
      <div>
        <SousTitre lien={{ href: "/hsseq/conformite", label: "Programme d'audits" }}>Audits de la période</SousTitre>
        {!au || !au.planned ? (
          sans("Aucun audit planifié sur la période.")
        ) : (
          <>
            <p className="mb-2 text-[13.5px] text-ink-2">{`${pluriel(au.done, "audit réalisé", "audits réalisés")} sur ${pluriel(au.planned, "planifié", "planifiés")}${au.rate !== null ? ` (${fmtPct(au.rate)})` : ""}, audits annulés exclus.`}</p>
            <ListeFiches>
              {au.items.map((x) => (
                <LigneFiche
                  key={x.id}
                  href={lienAudit(x.id, x.planned_date)}
                  entete={
                    <>
                      <Reference>{x.reference}</Reference>
                      <TamponRevue mot={STATUT_AUDIT[x.status] ?? x.status} />
                    </>
                  }
                  texte={x.title}
                  precision={`${PROGRAMME_AUDIT[x.standard] ?? x.standard}, prévu le ${fmtDate(x.planned_date)}${x.actual_date ? `, réalisé le ${fmtDate(x.actual_date)}` : ""}`}
                  fin={<span className="text-[12.5px] text-muted">{constatsEnClair(x.findings)}</span>}
                />
              ))}
            </ListeFiches>
          </>
        )}
      </div>

      <div>
        <SousTitre lien={{ href: "/hsseq/conformite?vue=constats", label: "Constats" }}>Constats encore ouverts</SousTitre>
        {au && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {ORDRE_CLASSES.map((c) => (
              <Compte key={c} label={CLASSEMENT[c]?.label ?? c} valeur={n(au.open_findings_by_class[c])} />
            ))}
          </ul>
        )}
        {!au?.open_findings.length ? (
          sans("Aucun écart majeur ni mineur ouvert.")
        ) : (
          <ListeFiches>
            {au.open_findings.map((f) => (
              <LigneFiche
                key={f.id}
                href={lienConstat(f.id)}
                entete={
                  <>
                    <Reference>{f.reference}</Reference>
                    <Tampon mot={CLASSEMENT[f.classification]?.label ?? f.classification} />
                  </>
                }
                texte={f.description}
                precision={f.audit ? `Audit ${f.audit}` : undefined}
              />
            ))}
          </ListeFiches>
        )}
      </div>

      <div>
        <SousTitre lien={{ href: "/hsseq/conformite?vue=exigences", label: "Registre des exigences" }}>Conformité aux exigences</SousTitre>
        {!ex ? (
          sans("Registre des exigences non rassemblé.")
        ) : (
          <>
            <Repartition parts={ORDRE_EXIGENCE.map((s) => ({ key: s, label: STATUT_EXIGENCE[s] ?? s, value: n(ex.by_status[s]), color: COULEUR_EXIGENCE[s] }))} format={(v) => pluriel(v, "exigence")} />
            {ex.non_compliant.length > 0 && (
              <div className="mt-3">
                <ListeFiches>
                  {ex.non_compliant.map((x) => (
                    <LigneFiche
                      key={x.id}
                      href={lienExigence(x.id)}
                      entete={
                        <>
                          <Reference>{x.reference}</Reference>
                          <Tampon mot={STATUT_EXIGENCE[x.status] ?? x.status} />
                        </>
                      }
                      texte={x.title}
                      precision={`${SOURCE_EXIGENCE[x.source] ?? x.source}, ${x.source_reference}`}
                    />
                  ))}
                </ListeFiches>
              </div>
            )}
          </>
        )}
      </div>

      {maturite.length > 0 && (
        <div>
          <SousTitre>Maturité par norme</SousTitre>
          <ul className="space-y-2.5">
            {maturite.map((m) => (
              <li key={m.standard} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
                <span className="text-[13.5px] text-ink">
                  <span className="font-medium">{m.label}</span>
                  <span className="ml-2 text-[12px] text-muted">{`${pluriel(m.requirements, "exigence")}, ${pluriel(m.evaluated, "évaluée", "évaluées")}`}</span>
                </span>
                <span className="font-display text-[16px] font-[650] tabular text-ink">{fmtPct(m.score)}</span>
                <span className="col-span-2 block">
                  <ProgressBar value={m.score ?? 0} epaisseur={6} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-snug text-muted">Part des exigences évaluées tenues&nbsp;: conforme pour 1, partiellement conforme pour 0,5.</p>
        </div>
      )}
    </Rubrique>
  );
}

/* ─── 7. Risques ──────────────────────────────────────────────────────── */

const NOM_RISQUES: Record<CriticalityLevel, [string, string]> = {
  low: ["faible", "faibles"],
  moderate: ["modéré", "modérés"],
  significant: ["significatif", "significatifs"],
  high: ["élevé", "élevés"],
};

function Risques({ e }: { e: ReviewInputs }) {
  const ri = e.risks;
  return (
    <Rubrique id={ANCRES.risques} numero={7} titre="Risques" aide="Risques en vigueur au registre, cotés après mesures de maîtrise." actions={<LienEcran href="/hsseq/risques">Registre des risques</LienEcran>}>
      {!ri ? (
        sans("Registre des risques non rassemblé.")
      ) : (
        <>
          <Chiffres
            lignes={[
              { label: "Risques en vigueur", valeur: fmtInt(ri.active) },
              { label: "Revues de risque échues", valeur: fmtInt(ri.reviews_overdue), ton: ri.reviews_overdue ? "danger" : undefined },
            ]}
          />
          <div className="space-y-2">
            <SousTitre>Criticité résiduelle, après mesures</SousTitre>
            <ParNiveau comptes={ri.by_residual_level} nom={(niveau, nombre) => NOM_RISQUES[niveau][nombre > 1 ? 1 : 0]} />
          </div>
          <div>
            <SousTitre>Risques résiduels significatifs ou élevés</SousTitre>
            {!ri.high_residual.length ? (
              sans("Aucun risque résiduel significatif ni élevé.")
            ) : (
              <ListeFiches>
                {ri.high_residual.map((x) => (
                  <LigneFiche
                    key={x.id}
                    href={lienRisque(x.id)}
                    entete={
                      <>
                        <Reference>{x.reference}</Reference>
                        <Criticite note={x.residual_criticality} />
                      </>
                    }
                    texte={x.feared_event}
                    precision={x.owner ? `Propriétaire${INSECABLE}: ${x.owner}` : undefined}
                  />
                ))}
              </ListeFiches>
            )}
          </div>
        </>
      )}
    </Rubrique>
  );
}

/* ─── 8. Environnement et qualité ─────────────────────────────────────── */

/** Litres, entiers : « 425 L ». */
const litres = (v: number | null | undefined) => `${fmtInt(n(v))}${INSECABLE}L`;

function Environnement({ e }: { e: ReviewInputs }) {
  const en = e.environment;
  if (!en) {
    return (
      <Rubrique id={ANCRES.environnement} numero={8} titre="Environnement et qualité">
        {sans("Environnement et qualité non rassemblés.")}
      </Rubrique>
    );
  }
  const groupes: Array<{ titre: string; lignes: Chiffre[] }> = [
    {
      titre: "Environnement",
      lignes: [
        { label: "Déversements", valeur: fmtInt(en.spills), precision: en.spills ? `${litres(en.spill_liters)} déversés, ${litres(en.spill_recovered_liters)} récupérés` : undefined, ton: en.spills ? "warn" : undefined },
        { label: "Contaminations de produit", valeur: fmtInt(en.contaminations), ton: en.contaminations ? "warn" : undefined },
        { label: "Mesures de poussières", valeur: fmtInt(en.dust_measurements), precision: `${pluriel(en.dust_exceedances, "dépassement")} du seuil` },
        { label: "Enlèvements de déchets avec bordereau", valeur: fmtInt(en.wastes_collected) },
        { label: "Déchets en attente d'enlèvement", valeur: fmtInt(en.wastes_stored_now), precision: "au jour du rassemblement" },
      ],
    },
    {
      titre: "Carburant, émissions et écarts de livraison",
      lignes: [
        { label: "Consommation", valeur: fmtIndicateur(en.fuel_consumption, "l_100km") },
        { label: "Émissions de CO₂", valeur: fmtIndicateur(en.co2_emissions, "kg_co2_km"), precision: en.co2_kg ? `${fmtDec(Math.round(en.co2_kg / 100) / 10)}${INSECABLE}t au total` : undefined },
        { label: "Écarts de livraison des citernes", valeur: fmtIndicateur(en.tanker_shortage, "per_mille") },
        { label: "Écarts de tonnage des bennes", valeur: fmtIndicateur(en.tipper_variance, "per_mille") },
      ],
    },
    {
      titre: "Réclamations des clients",
      lignes: [
        { label: "Reçues sur la période", valeur: fmtInt(en.complaints.received) },
        { label: "Traitées dans le délai", valeur: fmtPct(en.complaints.on_time_rate) },
        { label: "Encore ouvertes", valeur: fmtInt(en.complaints.open_now), precision: "au jour du rassemblement", ton: en.complaints.open_now ? "warn" : undefined },
      ],
    },
  ];
  return (
    <Rubrique id={ANCRES.environnement} numero={8} titre="Environnement et qualité" aide={`Déversements, poussières et déchets${INSECABLE}; carburant et émissions${INSECABLE}; réclamations des clients.`} actions={<LienEcran href="/hsseq/environnement">Environnement et qualité</LienEcran>}>
      {groupes.map((g) => (
        <div key={g.titre}>
          <SousTitre>{g.titre}</SousTitre>
          <Chiffres lignes={g.lignes} />
        </div>
      ))}
    </Rubrique>
  );
}

/* ─── 9. Urgences, documents et télématique ───────────────────────────── */

function Urgences({ e }: { e: ReviewInputs }) {
  const ur = e.emergency;
  const doc = e.documents;
  const tel = e.telematics;
  const violations = Object.entries(tel?.by_type ?? {}).filter(([, v]) => n(v) > 0) as Array<[string, number]>;
  return (
    <Rubrique id={ANCRES.urgences} numero={9} titre="Urgences, documents et télématique" aide="Plans d'intervention et exercices, procédures et alertes diffusées, violations de conduite relevées.">
      <div>
        <SousTitre lien={{ href: "/hsseq/documents", label: "Documents et urgences" }}>Urgences</SousTitre>
        {!ur ? (
          sans("Urgences non rassemblées.")
        ) : (
          <>
            <Chiffres
              lignes={[
                { label: "Plans d'intervention en vigueur", valeur: fmtInt(ur.plans_active) },
                { label: "Exercices réalisés sur planifiés", valeur: `${fmtInt(ur.drills_done)} sur ${fmtInt(ur.drills_planned)}`, ton: ur.drills_done < ur.drills_planned ? "warn" : undefined },
              ]}
            />
            {ur.plans_without_recent_drill.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-[12.5px] font-medium text-warn">Plans sans exercice réalisé depuis douze mois</p>
                <ListeFiches>
                  {ur.plans_without_recent_drill.map((p) => (
                    <LigneFiche key={p.id} entete={<Reference>{p.reference}</Reference>} texte={p.title} precision={[SCENARIO[p.scenario] ?? p.scenario, p.site].filter(Boolean).join(", ")} />
                  ))}
                </ListeFiches>
              </div>
            )}
          </>
        )}
      </div>
      <div>
        <SousTitre>Documents</SousTitre>
        {!doc ? (
          sans("Documents non rassemblés.")
        ) : (
          <Chiffres
            lignes={[
              { label: "Procédures en vigueur", valeur: fmtInt(doc.procedures_published) },
              { label: "Taux de lecture des procédures", valeur: fmtPct(doc.read_rate) },
              { label: "Alertes et retours d'expérience diffusés", valeur: fmtInt(doc.bulletins_published) },
            ]}
          />
        )}
      </div>
      <div>
        <SousTitre lien={{ href: "/hsseq/telematique", label: "Télématique" }}>Conduite des véhicules</SousTitre>
        {!tel ? (
          sans("Télématique non rassemblée.")
        ) : (
          <>
            <Chiffres
              lignes={[
                { label: "Violations de conduite", valeur: fmtInt(tel.violations), ton: tel.violations ? "warn" : undefined },
                { label: "Pour 100 voyages", valeur: fmtIndicateur(tel.per_100_trips, "per_100_trips") },
              ]}
            />
            {violations.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {violations.map(([t, v]) => (
                  <Compte key={t} label={VIOLATION[t] ?? t} valeur={v} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Rubrique>
  );
}

/* ─── Ensemble ────────────────────────────────────────────────────────── */

/** Rubriques 2 à 9 de la fiche ; sans éléments rassemblés, une rubrique d'attente. */
export function ElementsEntree({ r, vide }: { r: Review; vide?: ReactNode }) {
  const e = r.inputs;
  if (!e) {
    return (
      <Rubrique id={ANCRES.suite} numero={2} titre="Éléments d'entrée">
        {vide ?? sans("Les éléments d'entrée ne sont pas encore rassemblés.")}
      </Rubrique>
    );
  }
  return (
    <>
      <Suite e={e} />
      <Indicateurs e={e} />
      <Evenements e={e} />
      <Actions e={e} />
      <Audits e={e} />
      <Risques e={e} />
      <Environnement e={e} />
      <Urgences e={e} />
    </>
  );
}
