"use client";

import { type CSSProperties } from "react";
import { Badge, Card, DataTable, cx } from "@/components/ui";
import { ETATS } from "@/lib/couleurs";
import { CarteChaleur, PetitsMultiples } from "@/components/analyse/charts";
import { AttenteSection, ErreurLecture, BandeauCible, CIBLE, Chiffre, Ciblable, Constats, EnTeteSection, FournisseurTheme, GardeSociete, LIGNES_CIBLES, LienFiche, Vide, fmtDate, fmtPct, joursOu, pctOu, pluriel, useAncre, useCible, useDefiler, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetDiagnostic, CompartmentRow } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

/** Faiblesses systémiques des projets : carte domaines × dossiers, critères manquants, knock-outs, preuves, progression. */
export function Diagnostic() {
  return (
    <FournisseurTheme>
      <GardeSociete attendu="cabinet">
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

const PRIORITE: Record<string, string> = { high: "Priorité haute", medium: "Priorité moyenne", low: "Priorité basse" };

/** Couleur d'un score sur 100, aux seuils de priorité de la méthode (30, 50, 65). */
function teinte(score: number | null) {
  if (score === null) return "var(--color-line)";
  return score < 30 ? ETATS.critique : score < 50 ? ETATS.risque : score < 65 ? ETATS.attention : ETATS.passable;
}

/** Suivi par compartiment : retard et charge de chaque bloc d'expertise sur le portefeuille, consultants affectés. */
function Compartiments({ rows, vise }: { rows: CompartmentRow[]; vise: string | null }) {
  return (
    <Card title="Par compartiment d'expertise" className={LIGNES_CIBLES} padded={false} actions={<span className="text-[12.5px] text-muted">Score moyen de la méthode, manques à traiter et consultants · outil de scoring du cabinet</span>}>
      <DataTable
        dense
        rows={rows}
        rowKey={(r) => r.code}
        columns={[
          {
            key: "label",
            label: "Compartiment",
            render: (r) => (
              <Ciblable id={`compartiment-${r.code}`} actif={r.code === vise} className="block">
              <span className="flex items-start gap-2">
                <span className="mt-px inline-flex flex-none items-center rounded-md border border-accent/25 bg-accent-doux px-1.5 py-px font-mono text-[11.5px] font-bold leading-4 text-accent">{r.code}</span>
                <span className="min-w-0 font-medium text-ink">
                  {r.label}
                  <span className="block max-w-[46ch] text-[11.5px] font-normal leading-snug text-muted">{r.domains.join(" · ")}</span>
                </span>
              </span>
              </Ciblable>
            ),
          },
          {
            key: "mean",
            label: "Score moyen",
            render: (r) => (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                  <span className="n-pousser-x block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, r.mean ?? 0))}%`, background: teinte(r.mean) }} />
                </span>
                <span className="tabular text-[12px] text-ink-2">{r.mean === null ? "–" : fmtInt(r.mean)}</span>
              </span>
            ),
          },
          { key: "gaps", label: "Manques", align: "right", render: (r) => <span className="tabular">{fmtInt(r.gaps)}{r.gaps_per_dossier !== null && <span className="block text-[11px] text-muted">{r.gaps_per_dossier.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} par dossier</span>}</span> },
          { key: "studies", label: "Études renseignées", align: "right", render: (r) => <span className="tabular">{fmtInt(r.studies)}</span> },
          { key: "knockouts", label: "Knock-outs", align: "right", render: (r) => (r.knockouts ? <Badge tone="danger">{r.knockouts}</Badge> : <span className="text-muted">0</span>) },
          {
            key: "consultants",
            label: "Consultants",
            render: (r) => (
              <span className="block max-w-[30ch] text-[12px] leading-snug">
                {r.consultants.map((c, i) => (
                  <span key={c.name} className="text-ink-2">
                    {i > 0 && ", "}
                    {c.name} <span className="text-muted">({c.dossiers})</span>
                  </span>
                ))}
                {r.unassigned > 0 && (
                  <span className="block text-warn" title={r.unassigned_dossiers.map((x) => x.reference ?? x.name).join(", ")}>
                    {pluriel(r.unassigned, "dossier sans consultant", "dossiers sans consultant")}
                  </span>
                )}
                {!r.consultants.length && !r.unassigned && <span className="text-muted">–</span>}
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetDiagnostic>(`/analyse/cabinet/diagnostic${query}`);
  const heat = d?.domain_heatmap;
  const moyennes = (heat?.averages ?? []).filter((a) => a.mean !== null);
  const faible = [...moyennes].sort((a, b) => (a.mean ?? 0) - (b.mean ?? 0))[0];
  const premier = d?.top_gaps?.[0];
  const knockouts = (d?.knockouts ?? []).reduce((s, k) => s + k.count, 0);
  const ev = d?.evidence;
  const reponse = d && (
    <>
      {faible ? (
        <>
          Le domaine le plus faible du portefeuille est <strong className="font-semibold text-ink">{faible.label}</strong> ({fmtInt(faible.mean ?? 0)} / 100 en moyenne sur {faible.n} dossier{faible.n > 1 ? "s" : ""})
        </>
      ) : (
        <>Aucun domaine n&apos;est encore évalué</>
      )}
      {premier && <> ; le critère le plus souvent manquant est « {premier.label} » ({premier.frequency} dossier{premier.frequency > 1 ? "s" : ""} sur {heat?.dossiers.length ?? 0})</>}. {knockouts > 0 ? `${pluriel(knockouts, "critère éliminatoire reste actif", "critères éliminatoires restent actifs")}` : "Aucun critère éliminatoire actif"}
      {(d.knockouts_pending ?? 0) > 0 && ` (${d.knockouts_pending} encore à évaluer)`}
      {ev && ev.coverage_pct !== null && <> ; {fmtPct(ev.coverage_pct, 0)} des critères exigeant une preuve en ont une</>}.
      {(d.evaluation_backlog?.criteria ?? 0) > 0 && <> {pluriel(d.evaluation_backlog.criteria, "critère", "critères")} des gates atteints reste{d.evaluation_backlog.criteria > 1 ? "nt" : ""} à évaluer sur {pluriel(d.evaluation_backlog.dossiers, "dossier")}.</>}
    </>
  );
  const dossiers = heat?.dossiers ?? [];
  const domaines = heat?.domains ?? [];
  const cellules = heat?.cells ?? [];
  const transposer = dossiers.length <= 8;

  // Cible d'un constat : un compartiment (?compartment=C1), un critère (?criterion=C006, manquant ou
  // éliminatoire) ou un domaine (?domain=DOM02, sur la carte des scores et dans les moyennes).
  const compartiment = useCible("compartment");
  const critere = useCible("criterion");
  const domaine = useCible("domain");
  const compartimentVise = compartiment ? ((d?.compartments ?? []).find((c) => c.code === compartiment) ?? null) : null;
  const ecartVise = critere ? ((d?.top_gaps ?? []).find((g) => g.code === critere) ?? null) : null;
  const eliminatoireVise = critere ? ((d?.knockouts ?? []).find((k) => k.code === critere) ?? null) : null;
  const domaineVise = domaine ? ((heat?.averages ?? []).find((a) => a.code === domaine) ?? domaines.find((x) => x.code === domaine) ?? null) : null;
  const domaineSurCarte = !!domaine && domaines.some((x) => x.code === domaine);
  const { tour } = useAncre();
  useDefiler(
    compartimentVise ? `compartiment-${compartimentVise.code}` : eliminatoireVise ? `eliminatoire-${eliminatoireVise.code}` : ecartVise ? `critere-${ecartVise.code}` : domaineVise ? "carte-domaines" : null,
    !!d,
    tour,
    domaineVise && !compartimentVise && !eliminatoireVise && !ecartVise ? "start" : "center",
  );

  return (
    <div>
      <EnTeteSection exporter={`/analyse/cabinet/diagnostic.xlsx${query}`} question="Quelles faiblesses reviennent d'un projet à l'autre ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {d && compartiment && (
        <BandeauCible absent={!compartimentVise}>
          {compartimentVise ? (
            <>
              Compartiment <strong className="font-semibold">{compartimentVise.code} · {compartimentVise.label}</strong> mis en évidence dans le suivi par compartiment.
            </>
          ) : (
            <>Le compartiment visé ({compartiment}) n&apos;est suivi sur aucun dossier en cours.</>
          )}
        </BandeauCible>
      )}
      {d && critere && (
        <BandeauCible absent={!ecartVise && !eliminatoireVise}>
          {ecartVise || eliminatoireVise ? (
            <>
              Critère <strong className="font-semibold">{critere} · {(ecartVise ?? eliminatoireVise)?.label}</strong> mis en évidence
              {eliminatoireVise && ecartVise ? " parmi les critères éliminatoires actifs et les critères manquants." : eliminatoireVise ? " parmi les critères éliminatoires actifs." : " parmi les critères qui manquent le plus souvent."}
            </>
          ) : (
            <>Le critère visé ({critere}) ne manque plus sur les gates atteints et n&apos;est pas éliminatoire actif.</>
          )}
        </BandeauCible>
      )}
      {d && domaine && (
        <BandeauCible absent={!domaineVise}>
          {domaineVise ? (
            <>
              Domaine <strong className="font-semibold">{domaineVise.label}</strong> mis en évidence{domaineSurCarte ? " sur la carte des scores et dans les moyennes." : " dans les moyennes (il ne figure pas sur la grille de la carte)."}
            </>
          ) : (
            <>Le domaine visé ({domaine}) ne figure pas dans la grille des dossiers en cours.</>
          )}
        </BandeauCible>
      )}
      {error && <ErreurLecture error={error} onRetry={() => void mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <Card title={<span id="carte-domaines">{transposer ? "Score par domaine et par dossier" : "Score par dossier et par domaine"}</span>} actions={<span className="text-[12.5px] text-muted">Dernière évaluation · pivot 50 (seuil CONDITIONAL GO){heat?.policy ? ` · ${heat.policy.name}, version ${heat.policy.version}` : ""}{heat?.other_policy_dossiers ? ` · ${pluriel(heat.other_policy_dossiers, "dossier suit", "dossiers suivent")} une autre version de grille (hors carte)` : ""}</span>}>
            {dossiers.length && domaines.length && cellules.length ? (
              <>
                <CarteChaleur
                  label="Scores par dossier et par domaine d'évaluation"
                  rows={transposer ? domaines.map((x) => ({ key: x.code, label: x.label })) : dossiers.map((x) => ({ key: x.reference, label: x.name }))}
                  cols={transposer ? dossiers.map((x) => x.reference) : domaines.map((x) => x.code)}
                  formatCol={(code) => (transposer ? (dossiers.find((x) => x.reference === code)?.name ?? code) : (domaines.find((x) => x.code === code)?.label ?? code))}
                  cells={cellules.map((c) => ({ row: transposer ? c.domain : c.dossier, col: transposer ? c.dossier : c.domain, value: c.score, detail: c.priority ? `${PRIORITE[c.priority] ?? c.priority}${c.priority_label ? ` (${c.priority_label.toLowerCase()})` : ""}` : "Non évalué" }))}
                  format={(v) => String(Math.round(v))}
                  pivot={50}
                  domaine={[0, 100]}
                  largeurLibelles={transposer ? 230 : 210}
                  hauteurLigne={28}
                  surligneLigne={transposer && domaineSurCarte ? domaine : null}
                  surligneColonne={!transposer && domaineSurCarte ? domaine : null}
                />
                {moyennes.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                    {moyennes.map((m) => (
                      <span key={m.code} title={m.deliverable ?? undefined} className={cx("rounded-md", m.code === domaine && cx(CIBLE, "bg-accent-doux/60 px-1.5 font-semibold text-ink"))}>
                        {m.label} <span className="font-semibold tabular text-ink-2">{fmtInt(m.mean ?? 0)}</span>
                        {m.weak > 0 && <span className="text-danger"> · {m.weak} faible{m.weak > 1 ? "s" : ""}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Vide titre="Aucune évaluation" hint="Les scores par domaine viennent des évaluations de la grille, dossier par dossier." />
            )}
          </Card>

          {(d.compartments ?? []).length > 0 && <Compartiments rows={d.compartments ?? []} vise={compartimentVise?.code ?? null} />}

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Les critères qui manquent le plus souvent" className={cx("xl:col-span-7", LIGNES_CIBLES)} padded={false} actions={<span className="text-[12.5px] text-muted">Thèmes de formation ou de prestation à proposer</span>}>
              <DataTable
                dense
                rows={d.top_gaps ?? []}
                rowKey={(r) => r.code}
                empty="Aucun critère manquant sur les gates atteints."
                columns={[
                  { key: "label", label: "Critère", render: (r) => <Ciblable id={`critere-${r.code}`} actif={r.code === ecartVise?.code}><span className="font-medium text-ink">{r.label}<span className="block text-[11.5px] font-normal text-muted">{r.code} · {r.domain}{r.gate ? ` · ${r.gate}` : ""}{r.knockout ? " · éliminatoire" : r.critical ? " · critique" : ""}</span></span></Ciblable> },
                  {
                    key: "frequency",
                    label: "Dossiers",
                    render: (r) => (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                          <span className="n-pousser-x block h-full rounded-full bg-corail" style={{ width: `${Math.min(100, r.frequency_pct)}%` }} />
                        </span>
                        <span className="tabular text-[12px] text-ink-2">{r.frequency} ({fmtPct(r.frequency_pct, 0)})</span>
                      </span>
                    ),
                  },
                  { key: "avg_priority", label: "Priorité", align: "right", render: (r) => (r.avg_priority === null ? "–" : <Badge tone={r.avg_priority >= 2.5 ? "danger" : r.avg_priority >= 2 ? "warn" : "neutral"}>{r.avg_priority.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} / 3</Badge>) },
                  { key: "theme", label: "À proposer", render: (r) => <span className="block max-w-[30ch] text-[12.5px] font-semibold leading-snug text-accent">{r.theme ?? "–"}</span> },
                  { key: "details", label: "Dossiers concernés", render: (r) => <span className="block max-w-[22ch] text-[12px] leading-snug text-muted">{r.details.map((x, i) => (<span key={x.id}>{i > 0 && ", "}<LienFiche href={x.link} className="font-normal text-muted">{x.reference}</LienFiche></span>))}</span> },
                ]}
              />
              {(d.themes ?? []).length > 0 && (
                <div className="border-t border-line px-5 py-3">
                  <div className="mb-1.5 text-[12.5px] font-semibold text-ink-2">Thèmes par domaine</div>
                  <ul className="flex flex-wrap gap-2 text-[12px]">
                    {d.themes.map((t) => (
                      <li key={t.domain} className={cx("rounded-full border border-line bg-panel-2 px-2.5 py-1 text-ink-2", t.domain === domaine && cx(CIBLE, "bg-accent-doux"))} title={t.deliverable ?? undefined}>
                        <span className="font-semibold">{t.label}</span> : {t.gaps} écart{t.gaps > 1 ? "s" : ""} sur {pluriel(t.dossiers, "dossier")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
            <div className="space-y-5 xl:col-span-5">
              <Card title="Critères éliminatoires actifs" actions={(d.knockouts_pending ?? 0) > 0 ? <Badge tone="warn">{d.knockouts_pending} à évaluer</Badge> : undefined}>
                {(d.knockouts ?? []).length === 0 ? (
                  <Vide compact titre="Aucun critère éliminatoire défini" />
                ) : (
                  <ul className="space-y-2">
                    {d.knockouts.map((k) => (
                      <li key={k.code} id={`eliminatoire-${k.code}`} className={cx("flex scroll-mt-28 items-start justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-[12.5px]", k.code === eliminatoireVise?.code && cx(CIBLE, "bg-accent-doux/60"))}>
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">{k.label}</span>
                          <span className="block text-[11.5px] text-muted">
                            {k.code} · {k.domain}
                            {k.details.length > 0 && (
                              <>
                                {" · "}
                                {k.details.map((x, i) => (
                                  <span key={x.id}>
                                    {i > 0 && ", "}
                                    <LienFiche href={x.link} className="font-normal text-muted">{x.reference}</LienFiche>
                                  </span>
                                ))}
                              </>
                            )}
                          </span>
                        </span>
                        <Badge tone={k.count ? "danger" : "ok"}>{k.count ? `${k.count} actif${k.count > 1 ? "s" : ""}` : "Aucun"}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Preuves et pièces">
                {ev ? (
                  <>
                    <div className="grid grid-cols-3 gap-2.5">
                      <Chiffre label="Critères couverts" value={pctOu(ev.coverage_pct, 0)} tone={(ev.coverage_pct ?? 100) < 75 ? "warn" : "ok"} hint={`${ev.proven} sur ${ev.required} exigeant une preuve`} />
                      <Chiffre label="Preuves périmées" value={String(ev.expired)} tone={ev.expired ? "warn" : undefined} />
                      <Chiffre label="Pièces dues manquantes" value={String(ev.missing)} tone={ev.missing > 20 ? "danger" : ev.missing ? "warn" : undefined} hint={ev.missing ? `âge médian ${joursOu(ev.missing_median_age_days)}${ev.missing_over_60 ? ` · ${ev.missing_over_60} de plus de 60 j` : ""}` : undefined} />
                    </div>
                    {ev.missing > 0 && (
                      <div className="mt-3">
                        <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Âge des pièces manquantes</div>
                        <div className="flex h-3 gap-[2px]">
                          {ev.missing_by_age.map((a, i) => (
                            <span key={a.bucket} className="n-pousser-x h-full rounded-[3px]" style={{ width: `${(a.count / Math.max(1, ev.missing)) * 100}%`, background: [ETATS.passable, ETATS.attention, ETATS.risque, ETATS.critique][i % 4], minWidth: a.count ? 3 : 0, "--i": i } as CSSProperties} title={`${a.label} : ${a.count}`} />
                          ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
                          {ev.missing_by_age.map((a, i) => (
                            <span key={a.bucket} className="inline-flex items-center gap-1">
                              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: [ETATS.passable, ETATS.attention, ETATS.risque, ETATS.critique][i % 4] }} />
                              {a.label} : {a.count}
                            </span>
                          ))}
                        </div>
                        {ev.rows.length > 0 && (
                          <ul className="mt-3 space-y-1 text-[12px] text-muted">
                            {ev.rows.slice(0, 6).map((r) => (
                              <li key={`${r.id}-${r.code}`} className="flex items-center justify-between gap-3">
                                <span className="truncate">
                                  <LienFiche href={r.link} className="font-normal text-ink-2">{r.reference}</LienFiche> · {r.label}
                                </span>
                                <span className="whitespace-nowrap">{joursOu(r.age_days)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <Vide compact titre="Aucune pièce attendue" />
                )}
              </Card>
            </div>
          </div>

          <Card title="Progression des scores, revue après revue" actions={<span className="text-[12.5px] text-muted">Score Readiness aux instantanés de comité et à ce jour{d.progression?.median_velocity_per_month !== null && d.progression?.median_velocity_per_month !== undefined ? ` · vitesse médiane ${d.progression.median_velocity_per_month.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} point${Math.abs(d.progression.median_velocity_per_month) >= 2 ? "s" : ""} par mois` : ""}</span>}>
            {d.progression?.dossiers?.length && d.progression.dates.length >= 2 ? (
              <>
                <PetitsMultiples
                  label="Progression du score Readiness par dossier"
                  labels={d.progression.dates.map((x) => fmtDate(x).slice(0, 5))}
                  items={d.progression.dossiers.map((x) => {
                    const premierConnu = x.scores.find((s) => s !== null) ?? 0;
                    let dernier = premierConnu;
                    const ligne = d.progression.rows.find((r) => r.id === x.id);
                    return { key: x.reference, label: x.reference, values: x.scores.map((s) => (s === null ? dernier : (dernier = s))), detail: ligne ? `${ligne.name}${ligne.delta !== null ? ` · ${ligne.delta >= 0 ? "+" : ""}${fmtInt(ligne.delta)} pt en ${joursOu(ligne.days)}` : ""}` : undefined };
                  })}
                  colonnes={4}
                  format={(v) => `${Math.round(v)} / 100`}
                />
                <p className="mt-2 text-[12px] leading-snug text-muted">Avant la première évaluation d&apos;un dossier, le premier score connu est reporté. {d.progression.improving} dossier{d.progression.improving > 1 ? "s" : ""} en progression{d.progression.stagnating.length ? `, ${d.progression.stagnating.length} sans progrès` : ""}.</p>
              </>
            ) : (
              <Vide compact titre="Pas encore deux instantanés" hint="La progression se lit d'une revue de comité à l'autre." />
            )}
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
