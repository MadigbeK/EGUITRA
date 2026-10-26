"use client";

import { useState } from "react";
import { AreaChart, Badge, Button, Card, DataTable, ErrorBox, Field, Input, SERIES, cx } from "@/components/ui";
import { CarteChaleur, Eventail, Puces } from "@/components/analyse/charts";
import { AttenteSection, ErreurLecture, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, LienFiche, Vide, combler, fmtPct, fmtShort, gnfOu, joursOu, moisCourt, pctOu, pluriel, usePeriode } from "@/components/analyse/commun";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import type { CabinetActivite } from "@/lib/analyse-types";
import { AIDE_NOMBRE, fmtDec, fmtGNF, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";

/** Réglages de la valeur du temps (route /analyse/cabinet/reglages). */
interface Reglages {
  hourly_rate: number | null;
  hourly_rate_invalid: string | null;
  cost_ratio_pct: number | null;
  cost_ratio_invalid: string | null;
  cost_ratio_default_pct: number;
}

/**
 * Taux horaire de référence et taux de revient du temps : lus par tous les profils de l'écran, fixés par
 * l'administration et la direction (le noyau le vérifie). Un champ vidé revient au taux déduit des
 * factures ou au taux de revient par défaut ; une saisie illisible bloque l'envoi.
 */
function ReglagesTemps({ rateSource, onChange }: { rateSource: string | null; onChange: () => void }) {
  const peutRegler = useAutorise(["admin", "direction"]);
  const { data, error, mutate } = useApi<Reglages>("/analyse/cabinet/reglages");
  const [taux, setTaux] = useState<string | null>(null);
  const [revient, setRevient] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [fait, setFait] = useState(false);
  if (!data) return error ? <ErreurLecture error={error} onRetry={() => void mutate()} titre="Les réglages de la valeur du temps n'ont pas pu être lus." /> : null;
  const valeurTaux = taux ?? (data.hourly_rate !== null ? String(data.hourly_rate) : "");
  const valeurRevient = revient ?? (data.cost_ratio_pct !== null ? String(data.cost_ratio_pct).replace(".", ",") : "");
  const illisible = nombreIllisible(valeurTaux) || nombreIllisible(valeurRevient);
  async function enregistrer() {
    if (illisible) return;
    setEnvoi(true);
    setErreur(null);
    setFait(false);
    try {
      const res = await apiSend<Reglages>("PATCH", "/analyse/cabinet/reglages", { hourly_rate: lireNombre(valeurTaux), cost_ratio_pct: lireNombre(valeurRevient) });
      await mutate(res, { revalidate: false });
      setTaux(null);
      setRevient(null);
      setFait(true);
      onChange();
    } catch (e) {
      setErreur(e instanceof ApiError ? e : new Error("Le serveur ne répond pas : les réglages ne sont pas enregistrés."));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Card title="Réglages de la valeur du temps" actions={<span className="text-[12.5px] text-muted">{peutRegler ? "Administration et direction" : "Fixés par l'administration ou la direction"}</span>}>
      <p className="text-[12.5px] leading-relaxed text-muted">
        Le taux horaire de référence valorise le temps saisi (réalisation, carnet) ; le taux de revient, en part du taux de vente, donne le coût du temps et la marge par dossier.
        {rateSource === "derived" && " Sans taux réglé, il est déduit des factures d'honoraires des douze derniers mois."}
      </p>
      {(data.hourly_rate_invalid || data.cost_ratio_invalid) && <p className="mt-2 text-[12.5px] font-semibold text-warn">Une valeur enregistrée est illisible et reste ignorée : saisissez-la de nouveau.</p>}
      {peutRegler ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Taux horaire de référence (GNF/h)" hint="Vide : déduit des factures" error={nombreIllisible(valeurTaux) ? AIDE_NOMBRE : undefined}>
            <Input inputMode="decimal" value={valeurTaux} onChange={(e) => setTaux(e.target.value)} className="w-[190px]" />
          </Field>
          <Field label="Taux de revient (% du taux de vente)" hint={`Vide : ${fmtPct(data.cost_ratio_default_pct, 0)}`} error={nombreIllisible(valeurRevient) ? AIDE_NOMBRE : undefined}>
            <Input inputMode="decimal" value={valeurRevient} onChange={(e) => setRevient(e.target.value)} className="w-[150px]" />
          </Field>
          <Button variant="primary" onClick={() => void enregistrer()} loading={envoi} disabled={illisible || (taux === null && revient === null)}>
            Enregistrer
          </Button>
          {fait && <span role="status" className="text-[12.5px] font-semibold text-ok-texte">Réglages enregistrés : l&apos;écran est recalculé.</span>}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-2">
          Taux horaire de référence : <span className="font-semibold">{data.hourly_rate !== null ? fmtGNF(data.hourly_rate) : "non réglé"}</span> · taux de revient :{" "}
          <span className="font-semibold">{fmtPct(data.cost_ratio_pct ?? data.cost_ratio_default_pct, (data.cost_ratio_pct ?? 0) % 1 ? 1 : 0)}</span>
        </p>
      )}
      {erreur !== null && (
        <div className="mt-3">
          <ErrorBox error={erreur} />
        </div>
      )}
    </Card>
  );
}

/** Activité et honoraires : heures par consultant et semaine, taux de réalisation, rentabilité par dossier, honoraires par ligne, prévision. */
export function Activite() {
  return (
    <FournisseurTheme>
      <GardeSociete attendu="cabinet">
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

const semaineCourte = (w: string) => `${w.slice(8, 10)}/${w.slice(5, 7)}`;
const heures = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${fmtDec(Math.round(v * 10) / 10)} h`);

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetActivite>(`/analyse/cabinet/activite${query}`);
  const r = d?.realization;
  const s = d?.summary;
  const tauxConnu = !!r && r.standard_rate !== null;
  const pire = r ? [...r.by_consultant].filter((c) => c.realization_pct !== null).sort((a, b) => (a.realization_pct ?? 0) - (b.realization_pct ?? 0))[0] : undefined;
  const reponse = d && r && (
    <>
      {heures(r.hours)} saisies sur la période{d.time.hours_per_week !== null ? ` (${fmtDec(d.time.hours_per_week)} h par semaine et par consultant)` : ""} ; honoraires facturés : <strong className="font-semibold text-ink">{fmtShort(s?.fees ?? d.revenue.total)} GNF</strong>
      {s && s.fees_previous ? ` (${s.fees > s.fees_previous ? "+" : ""}${fmtPct(((s.fees - s.fees_previous) / s.fees_previous) * 100, 0)} sur un an)` : ""}.{" "}
      {tauxConnu && r.overall_pct !== null ? (
        <>
          Le temps vaut {gnfOu(r.value)} au taux standard : taux de réalisation {fmtPct(r.overall_pct)} (cible 85 %), taux horaire effectif {fmtInt(r.effective_rate ?? 0)} GNF contre {fmtInt(r.standard_rate ?? 0)}.
        </>
      ) : (
        <>Le taux horaire standard n&apos;est pas paramétré : la valeur du temps et le taux de réalisation ne sont pas calculables.</>
      )}{" "}
      Carnet : {heures(d.forecast.backlog_hours)} non facturées{d.forecast.backlog_value !== null ? ` (${fmtShort(d.forecast.backlog_value)} GNF)` : ""}
      {pire && pire.realization_pct !== null ? ` ; ${pire.name} réalise le moins (${fmtPct(pire.realization_pct, 0)}).` : "."}
      {d.revenue.receivables.overdue > 0 && <> Créances échues : {fmtShort(d.revenue.receivables.overdue)} GNF.</>}
    </>
  );
  const semaines = (d?.time.weeks ?? []).slice(-16);
  const consultants = d?.time.consultants ?? [];
  const histo = d?.forecast.history;
  const prev = d?.forecast;

  return (
    <div>
      <EnTeteSection exporter={`/analyse/cabinet/activite.xlsx${query}`} question="Le temps du cabinet se transforme-t-il en honoraires ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErreurLecture error={error} onRetry={() => void mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && r && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Heures par consultant et par semaine" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">{semaines.length} dernières semaines · une case vide : pas de temps saisi</span>}>
              {consultants.length && semaines.length ? (
                <CarteChaleur
                  label="Heures saisies par consultant et par semaine"
                  rows={consultants.map((c) => ({ key: c, label: c }))}
                  cols={semaines}
                  formatCol={semaineCourte}
                  cells={d.time.cells.filter((c) => semaines.includes(c.week)).map((c) => ({ row: c.consultant, col: c.week, value: c.hours > 0 ? c.hours : null }))}
                  echelle="sequentielle"
                  format={(v) => fmtDec(Math.round(v * 10) / 10)}
                  hauteurLigne={38}
                  largeurLibelles={150}
                />
              ) : (
                <Vide titre="Aucun temps saisi" hint="Les feuilles de temps d'AxisPro alimentent cette carte." />
              )}
              {d.time.by_service.length > 0 && (
                <div className="mt-4 grid gap-2.5 sm:grid-cols-5">
                  {d.time.by_service.map((x, i) => (
                    <div key={x.key} className="rounded-xl border border-line bg-panel-2/60 px-3 py-2">
                      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
                        <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
                        <span className="truncate">{x.label}</span>
                      </div>
                      <div className="font-display text-[17px] font-bold tabular text-ink">{heures(x.hours)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Taux de réalisation par consultant" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Facturé / valeur du temps · cible 85 %</span>}>
              {tauxConnu && r.by_consultant.some((c) => c.realization_pct !== null) ? (
                <Puces label="Taux de réalisation par consultant" format={(v) => fmtPct(v, 0)} items={r.by_consultant.filter((c) => c.realization_pct !== null).map((c) => ({ key: String(c.id), label: c.name, value: c.realization_pct ?? 0, target: 85, ranges: [70, 85, 100], detail: `${heures(c.hours)} · ${fmtShort(c.billed)} GNF facturés sur ${gnfOu(c.value)}` }))} />
              ) : (
                <Vide compact titre={tauxConnu ? "Aucune facture d'honoraires sur la période" : "Taux horaire de référence non réglé"} hint={tauxConnu ? undefined : "Réglez-le plus bas, dans les réglages de la valeur du temps : sans lui, la valeur du temps n'existe pas."} />
              )}
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                <Chiffre label="Réalisation globale" value={pctOu(r.overall_pct, 0)} tone={r.overall_pct === null ? undefined : r.overall_pct < 80 ? "warn" : "ok"} hint={r.value !== null ? `${fmtShort(r.billed)} facturés sur ${fmtShort(r.value)} GNF` : `${fmtShort(r.billed)} GNF facturés`} />
                <Chiffre label="Taux horaire effectif" value={r.effective_rate === null ? "–" : fmtInt(r.effective_rate)} hint={r.standard_rate !== null ? `standard ${fmtInt(r.standard_rate)} GNF` : "standard non paramétré"} />
                <Chiffre label="En cours" value={heures(r.wip_hours)} hint={r.wip_value !== null ? `${fmtShort(r.wip_value)} GNF à facturer` : "à facturer"} />
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Honoraires par ligne de service" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Créances {fmtShort(d.revenue.receivables.open)} GNF, dont {fmtShort(d.revenue.receivables.overdue)} échues{d.revenue.receivables.dso_days !== null ? ` · DSO ${joursOu(d.revenue.receivables.dso_days)}` : ""}</span>}>
              {d.revenue.monthly.series.length && d.revenue.monthly.months.length ? (
                <>
                  <AreaChart label="Honoraires mensuels par ligne de service" labels={d.revenue.monthly.months.map((m) => moisCourt(m, true))} series={d.revenue.monthly.series.map((x, i) => ({ key: x.key, label: x.label, values: combler(x.values), color: SERIES[i % SERIES.length]! }))} height={230} format={(v) => fmtGNF(v)} />
                  {d.revenue.unassigned > 0 && <p className="mt-2 text-[12px] leading-snug text-muted">{fmtShort(d.revenue.unassigned)} GNF de chiffre d&apos;affaires sans ligne de service sur la période : imputez les factures d&apos;honoraires sur l&apos;axe des activités du cabinet.</p>}
                </>
              ) : (
                <Vide titre="Aucun honoraire facturé sur 12 mois" />
              )}
            </Card>
            <Card title="Les trois prochains mois" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">{prev?.method ?? ""}{prev?.mape !== null && prev?.mape !== undefined ? ` · MAPE ${fmtPct(prev.mape)}` : ""}</span>}>
              {prev && prev.months.length ? (
                <Eventail
                  label="Honoraires : historique et prévision à trois mois"
                  points={[
                    ...(histo?.months ?? []).slice(-6).map((m, i) => ({ label: moisCourt(m), actual: histo?.values[(histo.values.length - Math.min(6, histo.months.length)) + i] ?? 0, forecast: null, low: null, high: null })),
                    ...prev.months.map((m, i) => ({ label: moisCourt(m), actual: null, forecast: prev.fees[i] ?? null, low: prev.low[i] ?? null, high: prev.high[i] ?? null })),
                  ]}
                  serieLabel="Honoraires"
                  couleur="var(--g-azur)"
                  hauteur={240}
                />
              ) : (
                <Vide compact titre="Pas de prévision" />
              )}
              {prev && prev.backlog.length > 0 && (
                <ul className="mt-3 space-y-1 text-[12.5px]">
                  {prev.backlog.slice(0, 5).map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3">
                      <span className="truncate"><LienFiche href={b.link}>{b.reference}</LienFiche> · {b.name}</span>
                      <span className="whitespace-nowrap text-muted">{heures(b.hours)}{b.value !== null ? ` · ${fmtShort(b.value)} GNF` : ""}{b.age_days !== null ? ` · ${joursOu(b.age_days)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <ReglagesTemps rateSource={r.rate_source} onChange={() => void mutate()} />

          <Card title="Rentabilité par dossier" padded={false} actions={<span className="text-[12.5px] text-muted">Coût du temps : {d.profitability.cost_rate_pct} % du taux de vente{d.profitability.cost_hourly !== null ? ` (${fmtInt(d.profitability.cost_hourly)} GNF/h)` : ""}</span>}>
            <DataTable
              dense
              rows={[...(d.profitability.rows ?? [])].sort((a, b) => (a.margin_pct ?? 101) - (b.margin_pct ?? 101))}
              rowKey={(x) => x.id}
              empty="Aucun dossier avec temps ou honoraires sur la période."
              columns={[
                { key: "name", label: "Dossier", render: (x) => <LienFiche href={x.link}>{x.name}<span className="block text-[11.5px] font-normal text-muted">{x.reference}{x.consultant ? ` · ${x.consultant}` : ""}</span></LienFiche> },
                { key: "hours", label: "Heures", align: "right", render: (x) => heures(x.hours) },
                { key: "realization", label: "Réalisation", align: "right", sortValue: (x) => r.by_dossier.find((y) => y.id === x.id)?.realization_pct ?? -1, render: (x) => { const t = r.by_dossier.find((y) => y.id === x.id)?.realization_pct ?? null; return t === null ? <span className="text-muted">–</span> : <Badge tone={t >= 85 ? "ok" : t >= 70 ? "warn" : "danger"}>{fmtPct(t, 0)}</Badge>; } },
                { key: "fees", label: "Honoraires", align: "right", render: (x) => fmtShort(x.fees) },
                { key: "cost", label: "Coût du temps", align: "right", render: (x) => (x.cost === null ? "–" : fmtShort(x.cost)) },
                { key: "margin", label: "Marge", align: "right", render: (x) => (x.margin === null ? <span className="text-muted">–</span> : <span className={cx("font-semibold", x.margin < 0 ? "text-danger" : "text-ink")}>{fmtShort(x.margin)}</span>) },
                { key: "margin_pct", label: "Taux", align: "right", render: (x) => (x.margin_pct === null ? <span className="text-muted">–</span> : <span className={cx("inline-block min-w-14 rounded-full px-2 py-0.5 text-center text-[12px] font-semibold", x.margin_pct < 30 ? "bg-danger-doux text-danger" : x.margin_pct < 50 ? "bg-warn-doux text-warn" : "bg-ok-doux text-ok-texte")}>{fmtPct(x.margin_pct, 0)}</span>) },
                { key: "fees_ltd", label: "Depuis l'origine", align: "right", render: (x) => <span className="text-muted">{fmtShort(x.fees_ltd)} · {heures(x.hours_ltd)}</span> },
              ]}
            />
            {!tauxConnu && <p className="px-5 py-3 text-[12.5px] leading-snug text-muted">Sans taux horaire standard, le coût du temps et la marge par dossier ne se calculent pas : seules les heures et les honoraires sont affichés ({pluriel(d.profitability.rows.length, "dossier")}).</p>}
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
