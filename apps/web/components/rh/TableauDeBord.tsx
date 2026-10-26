"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Calendar, Info, ShieldAlert, Users, Wallet } from "@/components/icons";
import { AreaChart, Badge, Button, Card, Empty, ErrorBox, Kpi, RankBars, Repartition, Squelette, SERIES, type Tone } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtDec, fmtGNF, fmtInt, fmtMonth, fmtPct, fmtShort, pluriel } from "@/lib/format";
import type { AlertSeverity, RhAlert, Summary } from "@/lib/rh-types";
import { EtatPaie, FiltreSociete, PastilleSociete, accord, avecSociete, moisLong, nomCourt, periode, useMeta } from "./commun";

const TON_ALERTE: Record<AlertSeverity, Tone> = { danger: "danger", warn: "warn", info: "accent" };
const RANG: Record<AlertSeverity, number> = { danger: 0, warn: 1, info: 2 };

function IconeAlerte({ severity }: { severity: AlertSeverity }) {
  const I = severity === "danger" ? ShieldAlert : severity === "warn" ? AlertTriangle : Info;
  const couleur = severity === "danger" ? "text-danger" : severity === "warn" ? "text-warn" : "text-accent";
  return <I className={`mt-0.5 h-4 w-4 flex-none ${couleur}`} />;
}

/**
 * Tableau de bord RH, consolidé sur les sociétés du compte (ou l'une d'elles, par le filtre) :
 * effectif, échéances, absences, masse salariale, paie du mois de chaque société.
 */
export function TableauDeBordRh() {
  const { data: meta } = useMeta();
  const [societe, setSociete] = useState<number | null>(null);
  const filtre = (meta?.companies.length ?? 0) > 1 && (
    <div className="mb-5">
      <FiltreSociete companies={meta?.companies} value={societe} onChange={setSociete} />
    </div>
  );
  return (
    <div>
      {filtre}
      <Contenu societe={societe} />
    </div>
  );
}

function Contenu({ societe }: { societe: number | null }) {
  const { data, error, mutate } = useApi<Summary>(avecSociete("/rh/summary", societe));
  if (error) return <ErrorBox error={error} onRetry={() => mutate()} />;
  if (!data)
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Squelette key={i} className="h-[118px]" />
        ))}
      </div>
    );

  const alertes = [...data.alerts].sort((a, b) => RANG[a.severity] - RANG[b.severity] || (a.date ?? "").localeCompare(b.date ?? ""));
  const tendance = data.payroll_trend;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Effectif" value={String(data.headcount)} hint={`${data.headcount_trial} en période d'essai`} />
        <Kpi label="Entrées et sorties de l'année" value={`${data.hires_year} / ${data.exits_year}`} hint={`Rotation sur 12 mois : ${fmtPct(data.turnover_rate)}`} tone={data.turnover_rate !== null && data.turnover_rate > 15 ? "warn" : "neutral"} />
        <Kpi label="Masse salariale mensuelle" value={fmtShort(data.monthly_payroll_estimate)} hint="Salaires de base et éléments fixes des actifs" />
        <Kpi
          label="Taux d'absence (30 jours)"
          value={fmtPct(data.absenteeism_rate)}
          hint={pluriel(data.pending_leaves, "demande à valider", "demandes à valider")}
          tone={data.absenteeism_rate !== null && data.absenteeism_rate > 5 ? "warn" : data.pending_leaves ? "accent" : "neutral"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-7" title="Échéancier" actions={<Badge tone={alertes.some((a) => a.severity === "danger") ? "danger" : alertes.length ? "warn" : "ok"}>{alertes.length ? pluriel(alertes.length, "point") : "Rien à signaler"}</Badge>}>
          {alertes.length === 0 ? (
            <Empty title="Aucune échéance proche" hint="Fins d'essai et de contrat, documents, soldes de congés et fiches complètes : tout est à jour." />
          ) : (
            <ul className="-mx-2 divide-y divide-line/70">
              {alertes.slice(0, 14).map((a, i) => (
                <AlerteLigne key={`${a.kind}-${a.employee?.id ?? "x"}-${i}`} a={a} />
              ))}
              {alertes.length > 14 && <li className="px-2 pt-3 text-[13px] text-muted">Et {pluriel(alertes.length - 14, "autre point", "autres points")}.</li>}
            </ul>
          )}
        </Card>

        <div className="space-y-6 xl:col-span-5">
          <Card title="Paie du mois" actions={<Link className="text-[13px] font-semibold text-accent hover:underline" href="/rh/paie">Toutes les paies</Link>}>
            {data.current_payrolls.length > 0 ? (
              <ul className="-mx-2 divide-y divide-line/70">
                {data.current_payrolls.map((p) => (
                  <li key={p.id}>
                    <Link href={`/rh/paie/${p.id}`} className="block rounded-xl px-2 py-3 transition-colors hover:bg-panel-2">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <PastilleSociete company={p.company} />
                        <EtatPaie state={p.state} />
                      </span>
                      <span className="mt-2 flex items-baseline justify-between gap-3">
                        <span className="text-sm capitalize text-ink-2">{moisLong(p.month)}</span>
                        <span className="font-display text-[20px] font-[650] tabular text-ink">{fmtGNF(p.totals.net)}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap justify-between gap-x-3 text-[12.5px] text-muted">
                        <span>
                          {pluriel(p.totals.headcount, "bulletin")}, coût employeur {fmtShort(p.totals.employer_cost)}
                        </span>
                        <span className={p.anomalies ? "text-warn" : ""}>{pluriel(p.anomalies, "anomalie")}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-3 text-sm text-ink-2">
                <p>La paie du mois n&apos;est pas encore préparée.</p>
                <Link href="/rh/paie">
                  <Button variant="primary">
                    <Wallet className="h-4 w-4" /> Préparer la paie
                  </Button>
                </Link>
              </div>
            )}
          </Card>

          <Card title="Absents aujourd'hui" actions={<Link className="text-[13px] font-semibold text-accent hover:underline" href="/rh/conges">Planning</Link>}>
            {data.absent_today.length === 0 ? (
              <p className="text-sm text-muted">Personne n&apos;est absent aujourd&apos;hui.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.absent_today.map((a) => (
                  <li key={a.employee.id} className="flex items-center justify-between gap-3">
                    <Link href={`/rh/salaries/${a.employee.id}`} className="font-medium text-ink hover:underline">
                      {a.employee.name}
                    </Link>
                    <span className="text-[13px] text-muted">
                      {a.type}, jusqu&apos;au {fmtDate(a.date_to)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-8" title="Masse salariale des 12 derniers mois">
          {tendance.length < 2 ? (
            <Empty title="Pas encore d'historique" hint="La courbe se dessine dès deux mois de paie validée." />
          ) : (
            <AreaChart
              label="Masse salariale"
              labels={tendance.map((t) => fmtMonth(t.month.slice(0, 7)))}
              format={(v) => fmtGNF(v)}
              formatAxis={(v) => fmtShort(v)}
              series={[
                { key: "cout", label: "Coût employeur", values: tendance.map((t) => t.employer_cost), color: SERIES[3] },
                { key: "brut", label: "Brut", values: tendance.map((t) => t.gross), color: SERIES[1] },
                { key: "net", label: "Net versé", values: tendance.map((t) => t.net), color: SERIES[0] },
              ]}
            />
          )}
        </Card>
        <Card className="xl:col-span-4" title="Le personnel">
          <dl className="space-y-2.5 text-sm">
            <Chiffre icone={Users} label="Ancienneté moyenne" value={data.average_seniority === null ? "–" : `${fmtDec(data.average_seniority)} ${accord(data.average_seniority, "an")}`} />
            <Chiffre icone={Users} label="Âge moyen" value={data.average_age === null ? "–" : `${fmtDec(data.average_age)} ans`} />
            <Chiffre icone={Users} label="Part des femmes" value={fmtPct(data.women_share, 0)} />
            <Chiffre icone={Calendar} label="Demandes d'absence à valider" value={String(data.pending_leaves)} />
          </dl>
          {data.by_contract.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Contrats</div>
              <Repartition parts={data.by_contract.map((c, i) => ({ key: c.code, label: c.label, value: c.headcount, color: SERIES[i % SERIES.length]! }))} format={(v) => String(v)} />
            </div>
          )}
        </Card>
      </div>

      {data.by_company.length > 1 && (
        <Card title="Par société">
          <div className="grid gap-6 lg:grid-cols-2">
            <ul className="space-y-3">
              {data.by_company.map((c) => (
                <li key={c.company.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
                  <PastilleSociete company={c.company} />
                  <span className="text-sm text-ink-2">
                    <b className="tabular text-ink">{fmtInt(c.headcount)}</b> {accord(c.headcount, "salarié")}, masse salariale <b className="tabular text-ink">{fmtShort(c.monthly_payroll_estimate)}</b> par mois
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <div className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Masse salariale mensuelle</div>
              <Repartition parts={data.by_company.map((c, i) => ({ key: String(c.company.id), label: nomCourt(c.company), value: c.monthly_payroll_estimate, color: SERIES[i % SERIES.length]! }))} format={(v) => fmtShort(v)} />
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Effectif par département">
          {data.by_department.length === 0 ? (
            <Empty title="Aucun département" hint="Créez les départements dans les paramètres RH." />
          ) : (
            <RankBars items={data.by_department.map((d) => ({ key: d.name, label: d.name, value: d.headcount }))} format={(v) => `${v} pers.`} />
          )}
        </Card>
        <Card title="Effectif par catégorie">
          {data.by_category.length === 0 ? (
            <Empty title="Aucun salarié" />
          ) : (
            <RankBars couleur="var(--n-or)" items={data.by_category.map((c) => ({ key: c.code, label: c.label, value: c.headcount }))} format={(v) => `${v} pers.`} />
          )}
        </Card>
      </div>

      <Card title="Absences à venir" actions={<Link className="text-[13px] font-semibold text-accent hover:underline" href="/rh/conges">Toutes les absences</Link>}>
        {data.upcoming_leaves.length === 0 ? (
          <p className="text-sm text-muted">Aucune absence prévue dans les prochains jours.</p>
        ) : (
          <ul className="divide-y divide-line/70 text-sm">
            {data.upcoming_leaves.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium text-ink">{l.employee.name}</span>
                <span className="text-muted">
                  {l.type.name}, {periode(l.date_from, l.date_to, l.half_day)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AlerteLigne({ a }: { a: RhAlert }) {
  return (
    <li>
      <Link href={a.href} className="group flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-panel-2">
        <IconeAlerte severity={a.severity} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">{a.message}</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">
            {a.employee?.name ?? "Paie"}
            {a.date ? `, ${fmtDate(a.date)}` : ""}
          </span>
        </span>
        <Badge tone={TON_ALERTE[a.severity]}>{a.severity === "danger" ? "Urgent" : a.severity === "warn" ? "À traiter" : "Info"}</Badge>
        <ArrowRight className="mt-1 h-4 w-4 flex-none text-muted opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    </li>
  );
}

function Chiffre({ icone: I, label, value }: { icone: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-ink-2">
        <I className="h-4 w-4 text-accent" /> {label}
      </dt>
      <dd className="font-semibold tabular text-ink">{value}</dd>
    </div>
  );
}
