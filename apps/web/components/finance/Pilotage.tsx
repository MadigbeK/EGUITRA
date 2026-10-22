"use client";

/**
 * Briques du pilotage financier, communes au tableau de bord, au rapport mensuel, aux alertes et à
 * l'écran Activités et budget : gravités et valeurs des alertes, questions du dirigeant, ce qui
 * demande une décision, courbe et tableau des flux mensuels de trésorerie, besoin en fonds de
 * roulement.
 */

import Link from "next/link";
import { type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Info, ShieldAlert, TriangleAlert, type Icon } from "@/components/icons";
import { Badge, DataTable, IconTile, cx, type Teinte, type Tone } from "@/components/ui";
import type { Alert, AlertUnit, CashForecast, MonthStatus, MonthlyCash, Question, Severity, Thresholds, Verdict, WorkingCapital } from "@/lib/finance-types";
import { MONTHS_FR, fmtDec, fmtGNF, fmtInt, fmtPct, fmtShort, pluriel } from "@/lib/format";

/* ─── Gravités et valeurs ──────────────────────────────────────────────── */

export const GRAVITE: Record<Severity, { label: string; tone: Tone; teinte: Teinte; icon: Icon; texte: string }> = {
  blocking: { label: "Bloquante", tone: "danger", teinte: "danger", icon: ShieldAlert, texte: "text-danger" },
  critical: { label: "Critique", tone: "danger", teinte: "corail", icon: TriangleAlert, texte: "text-danger" },
  warning: { label: "Élevée", tone: "warn", teinte: "ambre", icon: AlertTriangle, texte: "text-warn" },
  info: { label: "Moyenne", tone: "accent", teinte: "azur", icon: Info, texte: "text-info" },
};

export const GRAVITES: Array<{ value: Severity; label: string }> = [
  { value: "blocking", label: "Bloquante" },
  { value: "critical", label: "Critique" },
  { value: "warning", label: "Élevée" },
  { value: "info", label: "Moyenne" },
];

/** Gravité d'une alerte, tolérante à une gravité inconnue (module métier plus récent). */
export function gravite(s: string) {
  return GRAVITE[s as Severity] ?? GRAVITE.info;
}

/** Valeur d'une règle selon son unité : montant court, taux, jours, ratio, nombre. */
export function fmtValeur(value: number | null | undefined, unit: AlertUnit): string {
  if (value === null || value === undefined || unit === "none") return "–";
  switch (unit) {
    case "gnf":
      return `${fmtShort(value)} GNF`;
    case "pct":
      return fmtPct(value);
    case "days":
      return `${fmtDec(Math.round(value * 10) / 10)} j`;
    case "ratio":
      return value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default:
      return fmtInt(value);
  }
}

/** « 420 M GNF · seuil 1,5 Mds GNF » */
export function valeurEtSeuil(a: Alert): string | null {
  const valeur = a.value === null ? null : fmtValeur(a.value, a.unit);
  const seuil = a.threshold_unit === "none" || (!a.threshold && a.threshold_unit !== "gnf" && a.threshold_unit !== "count") ? null : fmtValeur(a.threshold, a.threshold_unit);
  if (!valeur && !seuil) return null;
  return [valeur, seuil && `seuil ${seuil}`].filter(Boolean).join(" · ");
}

/** Une alerte : gravité, domaine, constat, valeur face au seuil, action recommandée, écran où agir. */
export function AlerteLigne({ a, groupe }: { a: Alert; groupe?: boolean }) {
  const g = gravite(a.severity);
  const ok = a.status !== "alert";
  const chiffres = valeurEtSeuil(a);
  const corps = (
    <div className={cx("flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors", a.link && "group-hover:bg-panel-2")}>
      <IconTile icon={g.icon} teinte={ok ? "jade" : g.teinte} className="h-9 w-9 rounded-[10px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-[13.5px] font-semibold text-ink">{a.title}</span>
          <span className="flex flex-none items-center gap-1.5">
            <span className="rounded-md bg-panel-3 px-1.5 py-px text-[11.5px] font-medium text-ink-2">{a.domain}</span>
            {ok ? <Badge tone={a.status === "na" ? "neutral" : "ok"}>{a.status === "na" ? "Sans objet" : "Conforme"}</Badge> : <Badge tone={g.tone}>{g.label}</Badge>}
          </span>
        </div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-muted">
          {groupe && `${a.company}, `}
          {a.message}
          {chiffres && <span className="ml-1 whitespace-nowrap font-mono text-[12px] text-ink-2">({chiffres})</span>}
        </div>
        {!ok && a.action && (
          <div className="mt-1 text-[12.5px] leading-snug text-ink-2">
            <span className="font-semibold">Action : </span>
            {a.action}
          </div>
        )}
      </div>
      {a.link && <ChevronRight className="no-print mt-2 h-4 w-4 flex-none text-line-strong transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />}
    </div>
  );
  return a.link ? (
    <Link href={a.link} className="group block rounded-xl">
      {corps}
    </Link>
  ) : (
    <div className="group">{corps}</div>
  );
}

/** Ce qui demande une décision : les six alertes les plus graves, avec leur action. */
export function Decisions({ alerts, groupe }: { alerts: Alert[]; groupe?: boolean }) {
  const actives = alerts.filter((a) => a.status === "alert").slice(0, 6);
  if (!actives.length) return <p className="px-2 py-4 text-sm text-muted">Aucune décision urgente : tous les seuils fixés sont respectés.</p>;
  return (
    <ul className="space-y-1">
      {actives.map((a, i) => (
        <li key={`${a.key}-${a.company}-${i}`}>
          <AlerteLigne a={a} groupe={groupe} />
        </li>
      ))}
    </ul>
  );
}

/* ─── Questions du dirigeant ───────────────────────────────────────────── */

export const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  green: { label: "Conforme", tone: "ok" },
  orange: { label: "Vigilance", tone: "warn" },
  red: { label: "Critique", tone: "danger" },
  grey: { label: "Sans objet", tone: "neutral" },
};

/** Les onze questions du dirigeant : question, réponse chiffrée, verdict et lecture. */
export function QuestionsDirigeant({ questions }: { questions: Question[] }) {
  return (
    <ol className="divide-y divide-line">
      {questions.map((q, i) => (
        <li key={q.key} className="grid gap-x-5 gap-y-1.5 px-5 py-3.5 md:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.6fr)] md:items-start">
          <div className="flex gap-3">
            <span aria-hidden className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-panel-3 text-[11.5px] font-bold tabular text-ink-2">
              {i + 1}
            </span>
            <span className="text-[13.5px] font-semibold leading-snug text-ink">{q.question}</span>
          </div>
          <div className="flex items-center gap-2.5 pl-9 md:flex-col md:items-end md:pl-0">
            <span className="whitespace-nowrap font-display text-[17px] font-bold tabular text-ink">{q.answer}</span>
            <Badge tone={VERDICT[q.verdict].tone}>{q.threshold_unset ? "Seuil non fixé" : VERDICT[q.verdict].label}</Badge>
          </div>
          <p className="pl-9 text-[12.5px] leading-relaxed text-muted md:pl-0">{q.reading}</p>
        </li>
      ))}
    </ol>
  );
}

/* ─── Flux mensuels de trésorerie ──────────────────────────────────────── */

export const STATUT_MOIS: Record<MonthStatus, { label: string; tone: Tone }> = {
  a_venir: { label: "À venir", tone: "neutral" },
  sous_seuil: { label: "Sous le seuil", tone: "danger" },
  cash_net_negatif: { label: "Cash net négatif", tone: "warn" },
  conforme: { label: "Conforme", tone: "ok" },
};

const H = 210;

/** "2026-03" -> "mars" (abrégé) */
const moisCourt = (month: string) => MONTHS_FR[Number(month.slice(5, 7)) - 1] ?? month;

/**
 * Trésorerie de fin de mois : solde réel (trait plein), prévision des mois suivants (pointillés,
 * à partir des échéances), seuil de sécurité (trait rouge) et point bas de l'exercice.
 */
export function CourbeTresorerie({ data, forecast }: { data: MonthlyCash; forecast?: CashForecast | null }) {
  const reel = data.months.filter((m) => m.end !== null);
  const labels = data.months.map((m) => moisCourt(m.month));
  const index = new Map(data.months.map((m, i) => [m.month, i]));
  // Mois de la prévision au-delà de l'exercice : ajoutés en bout d'axe.
  const prevision: Array<{ i: number; v: number; label: string }> = [];
  if (forecast) {
    for (const step of [forecast.month_end, ...forecast.months]) {
      let i = index.get(step.month);
      if (i === undefined) {
        i = labels.length;
        labels.push(moisCourt(step.month));
        index.set(step.month, i);
      }
      prevision.push({ i, v: step.end, label: step.label });
    }
  }
  const n = labels.length;
  const seuil = data.threshold ?? null;
  const valeurs = [...reel.map((m) => m.end as number), ...prevision.map((p) => p.v), ...(seuil ? [seuil] : []), 0];
  let lo = Math.min(...valeurs);
  let hi = Math.max(...valeurs);
  if (hi === lo) hi = lo + 1;
  const marge = (hi - lo) * 0.08;
  lo -= marge;
  hi += marge;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100;
  const pts = reel.map((m) => ({ i: index.get(m.month)!, v: m.end as number, label: m.label }));
  const trace = (p: Array<{ i: number; v: number }>) => p.map((q, k) => `${k ? "L" : "M"}${(x(q.i) * 10).toFixed(1)},${((y(q.v) / 100) * H).toFixed(1)}`).join(" ");
  const debutPrev = pts.length && prevision.length ? [pts.length > 1 && prevision[0]!.i === pts[pts.length - 1]!.i ? pts[pts.length - 2]! : pts[pts.length - 1]!] : [];
  const low = data.summary.low_point;
  const lowPt = low ? pts.find((p) => p.label === low.label) : undefined;
  const resume = `Trésorerie de fin de mois${seuil ? `, seuil de sécurité ${fmtShort(seuil)} GNF` : ""}${low ? `, point bas fin ${low.label} à ${fmtShort(low.end)} GNF` : ""}.`;

  if (!pts.length && !prevision.length) return <p className="py-8 text-center text-sm text-muted">Aucun mouvement de trésorerie sur l&apos;exercice.</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-5 rounded bg-azur" />Solde de fin de mois</span>
        {prevision.length > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0 w-5 border-t-2 border-dashed border-azur" />Prévision (échéances)</span>}
        {seuil ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0 w-5 border-t-2 border-dashed border-danger-vif" />Seuil de sécurité</span> : null}
      </div>
      <div className="flex gap-2">
        <div aria-hidden className="relative w-14 flex-none text-right text-[11px] tabular text-muted" style={{ height: H }}>
          {[hi - marge, (hi + lo) / 2, lo + marge].map((t, k) => (
            <span key={k} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>{fmtShort(t)}</span>
          ))}
        </div>
        <div role="img" aria-label={resume} className="relative min-w-0 flex-1" style={{ height: H }}>
          <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden focusable="false">
            <line x1="0" x2="1000" y1={(y(0) / 100) * H} y2={(y(0) / 100) * H} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />
            {seuil ? <line x1="0" x2="1000" y1={(y(seuil) / 100) * H} y2={(y(seuil) / 100) * H} stroke="var(--danger-vif)" strokeDasharray="6 5" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null}
            {pts.length > 0 && <path d={trace(pts)} fill="none" stroke="var(--g-azur)" strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {prevision.length > 0 && <path d={trace([...debutPrev, ...prevision])} fill="none" stroke="var(--g-azur)" strokeWidth="2" strokeDasharray="7 6" vectorEffect="non-scaling-stroke" />}
          </svg>
          {pts.map((p) => (
            <span key={`r${p.i}`} aria-hidden title={`${p.label} : ${fmtGNF(p.v)}`} className={cx("absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel", seuil && p.v < seuil ? "bg-danger-vif" : "bg-azur")} style={{ left: `${x(p.i)}%`, top: `${y(p.v)}%` }} />
          ))}
          {prevision.map((p) => (
            <span key={`p${p.i}`} aria-hidden title={`Prévision fin ${p.label} : ${fmtGNF(p.v)}`} className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-azur bg-panel" style={{ left: `${x(p.i)}%`, top: `${y(p.v)}%` }} />
          ))}
          {lowPt && (
            <span aria-hidden className="absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-[10.5px] font-semibold text-white" style={{ left: `${Math.min(92, Math.max(8, x(lowPt.i)))}%`, top: `calc(${y(lowPt.v)}% + 9px)` }}>
              Point bas
            </span>
          )}
        </div>
      </div>
      <div aria-hidden className="relative ml-16 mt-2 h-4">
        {labels.map((l, i) => (
          <span key={`${l}-${i}`} className={cx("absolute -translate-x-1/2 text-[11px] text-muted", n > 8 && i % 2 === 1 && "max-sm:hidden")} style={{ left: `${x(i)}%` }}>
            {l}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] leading-snug text-muted">
        {low ? `Point bas fin ${low.label} à ${fmtShort(low.end)} GNF. ` : ""}
        {data.summary.active_months > 0 && `${data.summary.negative_months} mois sur ${data.summary.active_months} en cash net négatif${data.summary.negative_months > data.summary.active_months / 2 ? " : l'exploitation ne s'autofinance pas" : ""}.`}
      </p>
    </div>
  );
}

/** Tableau des flux mensuels : chiffre d'affaires, encaissements, décaissements, cash net, solde, contrôle ; puis la prévision. */
export function FluxMensuels({ data, forecast }: { data: MonthlyCash; forecast?: CashForecast | null }) {
  const lignes = data.months;
  return (
    <div>
      <DataTable
        dense
        rows={lignes}
        rowKey={(m) => m.month}
        columns={[
          { key: "label", label: "Mois", render: (m) => <span className={cx("capitalize", m.current && "font-semibold text-ink")}>{m.label}{m.current && <span className="ml-1.5 text-[11.5px] font-medium normal-case text-muted">(en cours)</span>}</span> },
          { key: "revenue", label: "CA HT facturé", align: "right", render: (m) => fmtInt(m.revenue) },
          { key: "receipts", label: "Encaissements", align: "right", render: (m) => fmtInt(m.receipts) },
          { key: "payments", label: "Décaissements", align: "right", render: (m) => fmtInt(m.payments) },
          { key: "net", label: "Cash net", align: "right", render: (m) => <span className={m.net < 0 ? "text-danger" : m.net > 0 ? "text-ok" : undefined}>{fmtInt(m.net)}</span> },
          { key: "end", label: "Solde fin de mois", align: "right", render: (m) => (m.end === null ? "–" : <span className={m.end < 0 ? "text-danger" : undefined}>{fmtInt(m.end)}</span>) },
          { key: "status", label: "Contrôle", render: (m) => <Badge tone={STATUT_MOIS[m.status].tone}>{STATUT_MOIS[m.status].label}</Badge> },
        ]}
        footer={
          <tr>
            <td className="px-3 py-2">Exercice (ouverture {fmtInt(data.opening)})</td>
            <td className="px-3 py-2 text-right font-mono">{fmtInt(lignes.reduce((s, m) => s + m.revenue, 0))}</td>
            <td className="px-3 py-2 text-right font-mono">{fmtInt(data.summary.receipts)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmtInt(data.summary.payments)}</td>
            <td className={cx("px-3 py-2 text-right font-mono", data.summary.net < 0 && "text-danger")}>{fmtInt(data.summary.net)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmtInt(data.summary.end)}</td>
            <td className="px-3 py-2" />
          </tr>
        }
      />
      {forecast && <Prevision forecast={forecast} seuil={data.threshold} />}
    </div>
  );
}

/** Prévision : fin du mois en cours puis trois mois, à partir des échéances clients, fournisseurs et d'emprunt. */
export function Prevision({ forecast, seuil }: { forecast: CashForecast; seuil: number | null }) {
  const steps = [{ ...forecast.month_end, label: `fin ${forecast.month_end.label}` }, ...forecast.months.map((m) => ({ ...m, label: `fin ${m.label}` }))];
  return (
    <div className="border-t border-line">
      <div className="px-5 pb-1 pt-4 text-[13.5px] font-semibold text-ink">Prévision de trésorerie</div>
      <p className="px-5 pb-2 text-[12.5px] leading-snug text-muted">
        À partir de {fmtGNF(forecast.start)} en banques et caisses : créances clients à encaisser selon leur échéance
        {forecast.month_end.doubtful_excluded > 0 && ` (hors ${fmtShort(forecast.month_end.doubtful_excluded)} GNF échus depuis plus de 90 jours, tenus pour douteux)`}, dettes fournisseurs et échéances d&apos;emprunt à régler.
      </p>
      <DataTable
        dense
        rows={steps}
        rowKey={(s) => s.month}
        columns={[
          { key: "label", label: "Échéance", render: (s) => <span className="capitalize">{s.label}</span> },
          { key: "receivables", label: "Créances à encaisser", align: "right", render: (s) => fmtInt(s.receivables) },
          { key: "payables", label: "Fournisseurs à payer", align: "right", render: (s) => fmtInt(s.payables) },
          { key: "loans", label: "Échéances d'emprunt", align: "right", render: (s) => fmtInt(s.loans) },
          { key: "net", label: "Flux net", align: "right", render: (s) => <span className={s.net < 0 ? "text-danger" : undefined}>{fmtInt(s.net)}</span> },
          { key: "end", label: "Trésorerie prévue", align: "right", render: (s) => <span className={cx("font-semibold", (s.end < 0 || (seuil !== null && seuil > 0 && s.end < seuil)) && "text-danger")}>{fmtInt(s.end)}</span> },
          { key: "x", label: "", render: (s) => (seuil !== null && seuil > 0 && s.end < seuil ? <Badge tone="danger">Sous le seuil</Badge> : null) },
        ]}
      />
    </div>
  );
}

/* ─── Besoin en fonds de roulement ─────────────────────────────────────── */

function Chiffre({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "warn" | "ok" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className={cx("mt-1 font-display text-[19px] font-bold tabular leading-tight", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11.5px] text-muted">{hint}</div>}
    </div>
  );
}

const jours = (v: number | null) => (v === null ? "–" : `${fmtDec(Math.round(v * 10) / 10)} j`);

/**
 * BFR et délais : DSO face à la cible, DPO, DIO, cycle, part échue, concentration. Un seuil null (laissé
 * à 0 : règle éteinte) ne juge pas la valeur : « seuil non fixé ».
 */
export function CarteBfr({ wc, thresholds }: { wc: WorkingCapital; thresholds: Thresholds }) {
  const cible = thresholds.dso_target_days;
  const partMax = thresholds.receivable_overdue_share_pct;
  const concMax = thresholds.client_concentration_pct;
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Chiffre label="BFR" value={`${fmtShort(wc.bfr)}`} hint={`SYSCOHADA : ${fmtShort(wc.bfr_syscohada)}`} />
      <Chiffre label="Cycle d'exploitation" value={jours(wc.cycle)} hint="DSO + DIO - DPO" />
      <Chiffre label="DSO (recouvrement)" value={jours(wc.dso)} hint={cible ? `Cible ${fmtInt(cible)} j · 12 mois ${jours(wc.dso_12m)}` : `12 mois glissants ${jours(wc.dso_12m)}`} tone={wc.dso !== null && cible ? (wc.dso > cible ? "danger" : "ok") : undefined} />
      <Chiffre label="DPO (fournisseurs)" value={jours(wc.dpo)} hint={wc.dio !== null && wc.stocks ? `DIO ${jours(wc.dio)}` : "Sans stock"} />
      <Chiffre label="Créances échues" value={fmtPct(wc.overdue_share_pct)} hint={`${fmtShort(wc.receivables_overdue)} GNF sur ${fmtShort(wc.receivables)} GNF · ${partMax ? `seuil ${fmtPct(partMax, 0)}` : "seuil non fixé"}`} tone={wc.overdue_share_pct !== null && partMax && wc.overdue_share_pct > partMax ? "danger" : undefined} />
      <Chiffre label="Dettes fournisseurs échues" value={`${fmtShort(wc.payables_overdue)}`} hint={`sur ${fmtShort(wc.payables)} GNF`} tone={wc.payables_overdue > 0.5 ? "warn" : undefined} />
      <Chiffre label="Premier client" value={fmtPct(wc.concentration.pct)} hint={`${wc.concentration.partner ?? "du chiffre d'affaires"} · ${concMax ? `seuil ${fmtPct(concMax, 0)}` : "seuil non fixé"}`} tone={wc.concentration.pct !== null && concMax && wc.concentration.pct > concMax ? "warn" : undefined} />
      <Chiffre label="Douteux (+ de 90 j)" value={`${fmtShort(wc.receivables_doubtful)}`} hint={pluriel(wc.receivables_aging_count.plus_90, "pièce")} tone={wc.receivables_doubtful > 0 ? "danger" : undefined} />
    </div>
  );
}
