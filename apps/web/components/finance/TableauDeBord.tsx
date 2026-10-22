"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ArrowUpRight, Printer } from "@/components/icons";
import { Ondes, Rosace } from "@/components/guilloche";
import { AreaChart, Button, Card, classesBouton, Compteur, DataTable, Donut, ErrorBox, SERIES, Gauge, Input, Kpi, PageHeader, RankBars, Squelette, cx } from "@/components/ui";
import { ETATS } from "@/lib/couleurs";
import { CarteBfr, CourbeTresorerie, Decisions, QuestionsDirigeant } from "@/components/finance/Pilotage";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Dashboard } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtJours, fmtMonth, fmtPct, fmtRatio, fmtShort, pluriel } from "@/lib/format";

/** Ancienneté des créances : jade pour le non échu, puis une rampe d'alerte de plus en plus sombre. */
const AGING: Array<[keyof Dashboard["receivables"]["aging"], string, string]> = [
  ["non_echu", "Non échu", ETATS.bon],
  ["1_30", "Échu de 1 à 30 jours", ETATS.attention],
  ["31_60", "Échu de 31 à 60 jours", ETATS.risque],
  ["61_90", "Échu de 61 à 90 jours", ETATS.alerte],
  ["plus_90", "Échu depuis plus de 90 jours", ETATS.critique],
];

/** Barres des comptes sur le billet : menthe, or, ciel, rose, pêche, en clair sur le fond forêt. */
const BILLET = ["#7fdcb4", "#e6c47e", "#8fd0f5", "#f3a9c9", "#ffb48f"];

/**
 * Registre de chiffres clés : deux cases par rangée dès le téléphone. Sous 640 px, la valeur passe
 * à 22 px et les cases se resserrent, pour que « -11,55 Md » tienne dans une demi-largeur de 360 px.
 */
const REGISTRE = "grid grid-cols-2 gap-4 max-sm:[&_.kpi]:px-3.5 max-sm:[&_.kpi_.font-display]:text-[22px]";

/** Montant d'un compte dans sa devise, à deux décimales : « 81 120,74 USD ». */
const enDevise = (v: number, devise: string) => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" })} ${devise}`;

/** Date du jour au format du noyau (« 2026-10-15 ») : Conakry vit à l'heure UTC. */
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Le mois de la date d'arrêté est-il clos, c'est-à-dire arrêté à son dernier jour ? */
function moisClos(jour: string): boolean {
  const [a, m, j] = jour.split("-").map(Number);
  if (!a || !m || !j) return false;
  return j === new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Période d'un mois en cours : « du 1er au 15/10, mois en cours ». */
function periodeEnCours(jour: string): string {
  const jj = jour.slice(8, 10);
  const mm = jour.slice(5, 7);
  return jj === "01" ? `le 01/${mm}, premier jour du mois` : `du 1er au ${jj}/${mm}, mois en cours`;
}

/** Précision faite de morceaux facultatifs, séparés par « · », avec une majuscule au début. */
function phrase(morceaux: Array<string | null>): string {
  const texte = morceaux.filter(Boolean).join(" · ");
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/**
 * Cumul depuis l'ouverture de l'exercice d'une série mensuelle : la trajectoire d'un chiffre de
 * l'exercice, dont le dernier point est le chiffre affiché. Un mois en cours ne la fait pas chuter.
 */
function cumulExercice(serie: Array<{ month: string; amount: number }>, debut: string): number[] {
  let total = 0;
  return serie.filter((m) => m.month >= debut).map((m) => (total += m.amount));
}

type Perimetre = "company" | "group";

/** Périmètre d'un calcul, dans une phrase : « chiffres de la société », « calcul du groupe consolidé ». */
const PERIMETRE: Record<Perimetre, string> = { company: "de la société", group: "du groupe consolidé" };

/**
 * Calcul demandé en échec, les chiffres précédents restant à l'écran : la phrase dit de quand ils
 * sont et ce qui n'a pas abouti (« Chiffres au 15/10/2026 : le calcul au 30/09/2026 a échoué. »).
 * Le périmètre n'est écrit que s'il a changé.
 */
function echecCalcul(affiche: { d: Dashboard; scope: Perimetre }, scope: Perimetre, jour: string): string {
  const autre = affiche.scope !== scope;
  return `Chiffres${autre ? ` ${PERIMETRE[affiche.scope]}` : ""} au ${fmtDate(affiche.d.as_of)} : le calcul${autre ? ` ${PERIMETRE[scope]}` : ""} au ${fmtDate(jour)} a échoué.`;
}

/** Tableau de bord du dirigeant (accueil de Finance pour la finance et la direction). */
export function DirectorDashboard() {
  const [scope, setScope] = useState<Perimetre>("company");
  // Arrêté au : vide = aujourd'hui (le noyau calcule à la date du jour de Conakry).
  const [asOf, setAsOf] = useState("");
  const { data, error, isLoading, mutate } = useApi<Dashboard>(`/finance/dashboard?scope=${scope}${asOf ? `&date=${asOf}` : ""}`);
  // Changer de date ou de périmètre garde l'écran : les derniers chiffres reçus restent jusqu'au
  // nouveau calcul, puis glissent de l'ancienne valeur à la nouvelle. Ils sont gardés avec leur
  // périmètre, pour dire de quoi ils sont si le nouveau calcul échoue.
  const [dernier, setDernier] = useState<{ d: Dashboard; scope: Perimetre } | null>(null);
  if (data && dernier?.d !== data) setDernier({ d: data, scope });
  const d = data ?? dernier?.d;
  // Chiffres affichés qui ne sont pas ceux de la date et du périmètre demandés.
  const precedent = !data && dernier ? dernier : null;
  const recalcul = Boolean(precedent) && isLoading;
  const echec = precedent && error && !isLoading ? precedent : null;
  const jour = aujourdhui();
  const demande = asOf || jour;
  const choisirDate = useCallback((v: string) => setAsOf(v), []);

  return (
    <div>
      <PageHeader
        title="Tableau de bord du dirigeant"
        subtitle={d ? `Exercice ${d.fiscal_year.start.slice(0, 4)}, écritures validées arrêtées au ${fmtDate(d.as_of)}, montants hors taxes en GNF${d.companies.length > 1 ? `, ${d.companies.map((c) => c.name).join(" et ")}` : ""}.` : "Indicateurs calculés à chaque saisie."}
        actions={
          <>
            <span role="status" className={cx("inline-flex items-center gap-2 text-[12.5px] font-medium text-muted", !recalcul && "sr-only")}>
              {recalcul && (
                <>
                  <span aria-hidden className="n-tourne h-3.5 w-3.5 rounded-full border-2 border-accent-vif/25 border-t-accent-vif" />
                  Recalcul au {fmtDate(demande)}…
                </>
              )}
            </span>
            {/* Le champ porte la date demandée ; tant qu'elle n'a pas de chiffres, aujourd'hui s'écrit en clair. */}
            <ArreteAu valeur={asOf || (precedent ? jour : d?.as_of) || ""} max={jour} onChange={choisirDate} />
            {asOf && (
              <Button variant="ghost" size="sm" onClick={() => setAsOf("")}>
                Aujourd&apos;hui
              </Button>
            )}
            <ScopeToggle value={scope} onChange={setScope} />
            {/* Au téléphone, « Imprimer ce tableau de bord » reste en pied de page. */}
            <Button className="max-sm:hidden" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimer
            </Button>
          </>
        }
      />
      {error && (
        <div className={cx(d && "mb-5")}>
          <ErrorBox error={error} onRetry={() => mutate()} titre={echec ? echecCalcul(echec, scope, demande) : undefined} />
        </div>
      )}
      {isLoading && !d && <Attente />}
      {d && (
        // Recalcul : le corps pâlit le temps du calcul. Échec : les chiffres précédents restent lisibles
        // (contrastes intacts) mais passent en grisaille, sous l'alerte qui dit de quand ils sont.
        <div aria-busy={recalcul || undefined} className={cx("transition-[opacity,filter] duration-150", recalcul && "pointer-events-none opacity-60", echec && "grayscale")}>
          <DashboardBody d={d} />
        </div>
      )}
    </div>
  );
}

/**
 * Arrêté au : le champ porte la date demandée, à défaut celle des chiffres affichés (as_of du
 * noyau), jamais un « jj/mm/aaaa » vide ; si son calcul échoue, l'alerte dit de quand sont les
 * chiffres restés à l'écran. Une date s'applique à la sortie du champ, sur Entrée, ou une demi-seconde
 * après le dernier changement si elle est complète : taper l'année ne relance pas quatre calculs.
 */
function ArreteAu({ valeur, max, onChange }: { valeur: string; max: string; onChange: (jour: string) => void }) {
  const [saisie, setSaisie] = useState<string | null>(null);
  const appliquer = useCallback(
    (v: string) => {
      setSaisie(null);
      if (dateValide(v, max) && v !== valeur) onChange(v);
    },
    [max, valeur, onChange],
  );
  useEffect(() => {
    if (saisie === null || !dateValide(saisie, max)) return;
    const minuterie = window.setTimeout(() => appliquer(saisie), 600);
    return () => window.clearTimeout(minuterie);
  }, [saisie, max, appliquer]);
  return (
    <label className="inline-flex items-center gap-2 text-[13px] font-medium text-ink-2">
      Arrêté au
      <Input
        type="date"
        value={saisie ?? valeur}
        max={max}
        onChange={(e) => setSaisie(e.target.value)}
        onBlur={(e) => appliquer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") appliquer(e.currentTarget.value);
        }}
        className="w-40"
      />
    </label>
  );
}

/** Date complète (« 2026-09-30 »), d'une année plausible et pas dans le futur. */
function dateValide(v: string, max: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "2000-01-01" && v <= max;
}

/** Squelette du tableau de bord pendant le calcul des indicateurs. */
function Attente() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Calcul des indicateurs…</span>
      <div className="grid gap-5 xl:grid-cols-12">
        <Squelette className="h-[244px] xl:col-span-5" />
        <div className="grid grid-cols-2 gap-4 xl:col-span-7">
          {[0, 1, 2, 3].map((i) => (
            <Squelette key={i} className="h-[114px]" />
          ))}
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-12">
        <Squelette className="h-[330px] xl:col-span-6" />
        <Squelette className="h-[330px] xl:col-span-6" />
      </div>
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  // Un mois en cours n'est pas comparé au mois précédent entier : pas de flèche avant sa clôture.
  const clos = moisClos(d.as_of);
  const variation = clos && d.revenue_prev_month ? ((d.revenue_month - d.revenue_prev_month) / Math.abs(d.revenue_prev_month)) * 100 : null;
  const aging = d.receivables.aging;
  const resultats = new Map(d.result_by_month.map((m) => [m.month, m.amount]));
  const mois = d.revenue_by_month.map((m) => m.month);
  // Le dernier mois de la courbe est-il le mois en cours, encore partiel ?
  const enCours = !clos && mois[mois.length - 1] === d.as_of.slice(0, 7);
  const caTrace = d.revenue_by_month.reduce((s, m) => s + m.amount, 0);
  const debutExercice = d.fiscal_year.start.slice(0, 7);
  // Billet : les comptes des journaux de banque et de caisse ne font pas toute la classe 5 (virements
  // de fonds, crédits de trésorerie, comptes d'attente). Le reste est écrit, pour que la colonne
  // s'additionne jusqu'à la trésorerie nette.
  const sommeComptes = d.cash_by_journal.reduce((s, c) => s + c.balance, 0);
  const autres = d.cash - sommeComptes;
  const avecAutres = Math.abs(autres) > 1;
  const maxCompte = Math.max(1, ...d.cash_by_journal.map((c) => Math.abs(c.balance)), avecAutres ? Math.abs(autres) : 0);
  const activites = [...d.by_activity].sort((a, b) => b.margin - a.margin).slice(0, 6);
  const parts = [...d.by_activity].filter((a) => a.income > 0).sort((a, b) => b.income - a.income);
  const th = d.thresholds;
  // Minimum de la règle d'alerte ; null : seuil à 0 (règle éteinte), le DSCR n'est pas jugé.
  const dscrMin = th.dscr_min;
  const maxDscr = Math.max(2, Math.ceil(((d.dscr ?? 0) * 1.25) / 0.5) * 0.5, (dscrMin ?? 1) + 0.5);
  const wc = d.working_capital;
  const ecl = d.expected_credit_loss.total;
  const budget = d.budget;
  const budgetCa = budget && budget.revenue.budget ? budget.revenue : null;
  const fin = d.cash_forecast.month_end;
  // Trésorerie prévue : les soldes réels des mois clos, puis la prévision de fin de mois affichée.
  const soldes = [...d.cash_monthly.months.filter((m) => m.end !== null && m.month < fin.month).map((m) => m.end as number), fin.end];
  const groupe = d.companies.length > 1;
  const transport = d.transport && d.transport.vehicles.count > 0 ? d.transport : null;
  const alertes = d.alerts.filter((a) => a.status === "alert");
  const ecartEcheancier = Math.abs(d.debt.schedule_gap ?? 0) >= 1;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Le billet : la trésorerie nette gravée sur fond forêt, rosace et vagues guillochées. */}
        <section className="billet relative isolate min-w-0 overflow-hidden rounded-[28px] bg-foret p-6 text-white shadow-[0_34px_60px_-32px_rgb(20_47_41/0.7)] sm:p-7 xl:col-span-5">
          <Rosace epaisseur={0.9} className="pointer-events-none absolute -right-40 top-1/2 -z-10 h-[540px] w-[540px] -translate-y-1/2 text-or opacity-[0.42]" />
          <Ondes graine="tresorerie-nette" lignes={9} className="billet-ondes pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-28 w-full text-menthe" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-white">Trésorerie nette</h2>
              <p className="mt-1 text-[12.5px] leading-snug text-white/65">
                {d.cash_by_journal.length} compte{d.cash_by_journal.length > 1 ? "s" : ""} de banque et caisse, au {fmtDate(d.as_of)}
                {th.cash_min ? `, seuil de sécurité ${fmtShort(th.cash_min)}` : ""}
              </p>
            </div>
            <span aria-hidden className="billet-serie mt-0.5 whitespace-nowrap font-display text-[12px] font-semibold tabular tracking-[0.18em] text-or">
              Nº {d.as_of.split("-").reverse().join("")}
            </span>
          </div>
          <Compteur value={d.cash} className={cx("relative mt-7 text-[34px] sm:text-[50px] xl:text-[38px] 2xl:text-[52px]", d.cash < 0 || (th.cash_min && d.cash < th.cash_min) ? "text-[#ffb4a8]" : "text-white")} />
          {d.cash_by_journal.length === 0 && !avecAutres ? (
            <p className="mt-6 text-sm text-white/65">Aucun compte de trésorerie.</p>
          ) : (
            <>
              <ul className="relative mt-6 space-y-3">
                {d.cash_by_journal.map((c, i) => (
                  <li key={c.journal_id}>
                    <div className="flex items-baseline justify-between gap-4 text-[13px]">
                      {/* Au téléphone, le nom du compte passe à la ligne au lieu d'être coupé. */}
                      <span className="min-w-0 truncate font-medium text-white/90 max-sm:whitespace-normal">
                        {c.name}
                        <span className="ml-2 text-[12px] font-normal text-white/55">{c.type === "cash" ? "Caisse" : "Banque"}</span>
                      </span>
                      {/* Compte en devise : la contre-valeur en GNF s'additionne avec les autres lignes ; le montant dans la devise dessous. */}
                      <span className={cx("whitespace-nowrap text-right font-semibold tabular", c.balance < 0 ? "text-[#ffb4a8]" : "text-white")}>
                        {fmtGNF(c.balance)}
                        {c.currency !== "GNF" && <span className="block text-[11.5px] font-normal text-white/60">{enDevise(c.balance_currency, c.currency)}</span>}
                      </span>
                    </div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/10">
                      <div
                        className="n-pousser-x h-full rounded-full"
                        style={{ width: `${Math.max(2, (Math.abs(c.balance) / maxCompte) * 100)}%`, background: c.balance < 0 ? "#ff8a7a" : BILLET[i % BILLET.length], "--i": i } as CSSProperties}
                      />
                    </div>
                  </li>
                ))}
                {avecAutres && (
                  <li>
                    {/* Libellé honnête tant que le noyau ne détaille pas ce reste (585, 56, comptes d'attente) : le montant garde son signe. */}
                    <div className="flex items-baseline justify-between gap-4 text-[13px] text-white/60">
                      <span className="min-w-0">Autres comptes de trésorerie (classe 5)</span>
                      <span className="whitespace-nowrap font-semibold tabular">{fmtGNF(autres)}</span>
                    </div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/10">
                      <div className="n-pousser-x h-full rounded-full bg-white/35" style={{ width: `${Math.max(2, (Math.abs(autres) / maxCompte) * 100)}%`, "--i": d.cash_by_journal.length } as CSSProperties} />
                    </div>
                  </li>
                )}
              </ul>
              <div className="relative mt-4 flex items-baseline justify-between gap-4 border-t border-white/25 pt-3 text-[13px]">
                <span className="font-semibold text-white">Trésorerie nette</span>
                <span className={cx("whitespace-nowrap font-bold tabular", d.cash < 0 ? "text-[#ffb4a8]" : "text-white")}>{fmtGNF(d.cash)}</span>
              </div>
            </>
          )}
        </section>

        <div className={cx(REGISTRE, "xl:col-span-7")}>
          <Kpi
            label="Chiffre d'affaires du mois"
            value={fmtShort(d.revenue_month)}
            delta={clos ? variation : undefined}
            hint={clos ? (variation === null ? "Pas de mois de comparaison" : "par rapport au mois précédent") : periodeEnCours(d.as_of)}
            serie={clos ? d.revenue_by_month.map((m) => m.amount) : undefined}
          />
          <Kpi
            label="Chiffre d'affaires de l'exercice"
            value={fmtShort(d.margins.revenue)}
            tone={budgetCa && (budgetCa.gap_pct ?? 0) < -(budget?.threshold_pct ?? 10) ? "warn" : "neutral"}
            hint={budgetCa ? `Budget ${fmtShort(budgetCa.budget)} · écart ${fmtPct(budgetCa.gap_pct)}` : "Aucun budget de produits"}
            serie={cumulExercice(d.revenue_by_month, debutExercice)}
          />
          <Kpi label="Excédent brut d'exploitation" value={fmtShort(d.ebe_fy)} tone={d.ebe_fy < 0 ? "danger" : "neutral"} hint={`Marge EBE ${fmtPct(d.margins.ebe_pct)} du chiffre d'affaires`} />
          {/* Un résultat positif ne porte pas de sceau : il n'y a rien à surveiller. */}
          <Kpi
            label="Résultat net de l'exercice"
            value={fmtShort(d.net_result_fy)}
            tone={d.net_result_fy < 0 ? "danger" : "neutral"}
            hint={`Marge nette ${fmtPct(d.margins.net_pct)} · après IFRS 9 : ${fmtShort(d.net_result_fy - ecl)}`}
            serie={cumulExercice(d.result_by_month, debutExercice)}
          />
          <Kpi
            label="Délai de recouvrement (DSO)"
            value={fmtJours(wc.dso)}
            tone={wc.dso !== null && th.dso_target_days ? (wc.dso > th.dso_target_days ? "danger" : "ok") : "neutral"}
            hint={th.dso_target_days ? `Cible ${fmtJours(th.dso_target_days)} · créances échues ${fmtPct(wc.overdue_share_pct)}` : "Cible de recouvrement non fixée"}
          />
          <Kpi
            label="Couverture de la dette (DSCR)"
            value={fmtRatio(d.dscr)}
            tone={d.dscr === null || !dscrMin ? "neutral" : d.dscr < dscrMin ? "danger" : "ok"}
            hint={dscrMin ? `Minimum fixé : ${fmtRatio(dscrMin)}` : "Minimum : seuil non fixé"}
          />
        </div>
      </div>

      <div className={cx(REGISTRE, "xl:grid-cols-4")}>
        <Kpi
          label={`Trésorerie prévue fin ${fin.label}`}
          value={fmtShort(fin.end)}
          tone={fin.end < 0 || (th.cash_min && fin.end < th.cash_min) ? "danger" : "ok"}
          hint={`+ ${fmtShort(fin.receivables)} clients, - ${fmtShort(fin.payables)} fournisseurs, - ${fmtShort(fin.loans)} emprunts`}
          serie={soldes}
        />
        {budget ? (
          <Kpi
            label="Réalisé contre budget cumulé"
            value={fmtPct(budget.expenses.budget ? (budget.expenses.actual / budget.expenses.budget) * 100 : null)}
            tone={budget.overruns.length ? "warn" : "ok"}
            hint={`Charges ${fmtShort(budget.expenses.actual)} / ${fmtShort(budget.expenses.budget)} à fin ${fmtMonth(budget.through.slice(0, 7))}, ${pluriel(budget.overruns.length, "ligne")} hors tolérance`}
          />
        ) : (
          <Kpi label="Réalisé contre budget cumulé" value="–" hint="Aucun budget pour l'exercice (Activités et budget)" />
        )}
        <Kpi label="Besoin en fonds de roulement" value={fmtShort(wc.bfr)} hint={`Cycle ${fmtJours(wc.cycle)} · DPO ${fmtJours(wc.dpo)}`} />
        {/* La dette ne passe au rouge qu'avec des échéances impayées : leur montant est écrit. */}
        <Kpi
          label="Dette financière"
          value={fmtShort(d.debt.accounting_outstanding ?? d.debt.outstanding)}
          tone={d.debt.overdue > 0 ? "danger" : ecartEcheancier ? "warn" : "neutral"}
          hint={phrase([d.debt.overdue > 0 ? `dont ${fmtShort(d.debt.overdue)} échus` : null, `dette nette ${fmtShort(d.debt.net_debt)}`, `gearing ${fmtRatio(d.debt.gearing)}`, ecartEcheancier ? `écart échéancier ${fmtShort(d.debt.schedule_gap)}` : null])}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card
          title="Chiffre d'affaires et résultat par mois"
          className="xl:col-span-6"
          actions={
            mois.length > 0 && (
              <span className="text-[12.5px] text-muted">
                {mois.length > 1 ? `${mois.length} derniers mois` : "Dernier mois"} : <span className="whitespace-nowrap font-semibold tabular text-ink">{fmtShort(caTrace)}</span> facturés
              </span>
            )
          }
        >
          {mois.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Aucune facture validée sur l&apos;exercice.</p>
          ) : (
            <AreaChart
              label="Chiffre d'affaires et résultat par mois"
              labels={mois.map((m) => fmtMonth(m).split(" ")[0] ?? m)}
              series={[
                { key: "ca", label: "Chiffre d'affaires", color: SERIES[0], values: d.revenue_by_month.map((m) => m.amount) },
                // Or foncé de la palette du DG : le bleu d'AxisPro n'a pas sa place dans Finance.
                { key: "resultat", label: "Résultat", color: "var(--or-fonce)", values: mois.map((m) => resultats.get(m) ?? 0) },
              ]}
              height={210}
              format={(v) => fmtGNF(v)}
              enCours={enCours}
            />
          )}
        </Card>
        <Card
          title="Trésorerie en fin de mois"
          className="xl:col-span-6"
          actions={
            <Link href="/finance/pilotage?onglet=tresorerie" className="no-print inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
              Flux mensuels <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <CourbeTresorerie data={d.cash_monthly} forecast={d.cash_forecast} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card
          title={`Ce qui demande une décision${alertes.length ? ` (${Math.min(6, alertes.length)} sur ${alertes.length})` : ""}`}
          className="xl:col-span-7"
          padded={false}
          actions={
            <Link href="/finance/alertes" className="no-print inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
              Toutes les alertes <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <div className="px-3 pb-3">
            <Decisions alerts={d.decisions} groupe={groupe} />
          </div>
        </Card>
        <Card title="Répartition du chiffre d'affaires par activité" className="xl:col-span-5">
          {parts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Imputez les factures sur l&apos;axe Activité pour voir cette répartition.</p>
          ) : (
            <Donut parts={parts.slice(0, 6).map((a, i) => ({ key: String(a.analytic_account_id), label: a.name, value: a.income, color: SERIES[i % SERIES.length]! }))} format={(v) => fmtShort(v)} centre={{ titre: "Produits", valeur: fmtShort(parts.reduce((s, a) => s + a.income, 0)) }} />
          )}
        </Card>
      </div>

      <Card title="Besoin en fonds de roulement et délais" actions={<span className="text-[12.5px] text-muted">Du {fmtDate(wc.date_from)} au {fmtDate(wc.date_to)} ({wc.days} jours)</span>}>
        <CarteBfr wc={wc} thresholds={th} />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-12">
        <Card title="Ancienneté des créances clients" className="xl:col-span-5">
          <Donut parts={AGING.map(([key, label, color]) => ({ key, label, value: aging[key], color }))} format={(v) => fmtShort(v)} centre={{ titre: "Encours clients", valeur: fmtShort(d.receivables.total) }} />
          <p className="mt-3 text-[12.5px] leading-snug text-muted">
            {fmtShort(aging.plus_90)} GNF dorment depuis plus de 90 jours ({pluriel(d.receivables.aging_count?.plus_90 ?? 0, "pièce")}). Perte attendue IFRS 9 : {fmtShort(ecl)} GNF{d.expected_credit_loss.rate_pct !== null ? `, soit ${fmtPct(d.expected_credit_loss.rate_pct)} de l'encours` : ""}.
          </p>
        </Card>
        <Card title="Couverture de la dette" className="xl:col-span-3">
          <Gauge
            value={d.dscr === null ? null : Math.round(d.dscr * 100) / 100}
            max={maxDscr}
            format={(v) => fmtRatio(v)}
            zones={
              dscrMin
                ? [
                    { jusqua: 1, couleur: ETATS.alerte, label: "Insuffisante" },
                    { jusqua: dscrMin, couleur: ETATS.attention, label: "Sous le minimum" },
                    { jusqua: maxDscr, couleur: ETATS.bon, label: "Confortable" },
                  ]
                : [{ jusqua: maxDscr, couleur: ETATS.neutre, label: "Seuil non fixé" }]
            }
            sousTitre={`DSCR sur 12 mois : EBE divisé par le service de la dette, ${dscrMin ? `${fmtRatio(dscrMin)} au moins (seuil fixé)` : "minimum non fixé (Administration > Seuils et taux)"}`}
            vide="Aucun service de dette sur 12 mois"
          />
        </Card>
        <Card title={transport ? `Résultat par ensemble routier${transport.vehicles.basis === "net" ? " après structure" : ""}` : "Marge par activité"} className="lg:col-span-2 xl:col-span-4">
          {transport ? (
            <>
              <RankBars items={transport.vehicles.items.slice(0, 8).map((v) => ({ key: String(v.key ?? v.label), label: v.label, value: v.result, detail: v.km !== null ? `${fmtShort(v.km)} km` : `CA ${fmtShort(v.revenue)}` }))} />
              <p className="mt-3 text-[12.5px] leading-snug text-muted">
                {transport.vehicles.basis === "net"
                  ? `${pluriel(transport.vehicles.deficit.length, "camion")} sur ${transport.vehicles.count} déficitaire${transport.vehicles.deficit.length > 1 ? "s" : ""} une fois les charges de structure absorbées.`
                  : "Marge directe des rotations : le résultat après charges de structure s'affichera dès que le module transport le calcule."}
              </p>
            </>
          ) : activites.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Imputez les pièces sur l&apos;axe Activité pour voir ce classement.</p>
          ) : (
            <RankBars items={activites.map((a) => ({ key: a.analytic_account_id, label: a.name, value: a.margin, detail: `Taux de marge ${fmtPct(a.margin_rate)}` }))} />
          )}
        </Card>
      </div>

      <Card title="Les questions du dirigeant" padded={false}>
        <QuestionsDirigeant questions={d.questions} />
      </Card>

      <Card
        title="Résultat par activité"
        padded={false}
        actions={
          <Link href="/finance/pilotage" className="no-print inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
            Activités et budget <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <DataTable
          rows={d.by_activity}
          rowKey={(r) => r.analytic_account_id}
          empty="Imputez les pièces sur l'axe Activité pour voir ce tableau."
          columns={[
            { key: "name", label: "Activité", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
            { key: "income", label: "Produits", align: "right", render: (r) => fmtShort(r.income) },
            { key: "expense", label: "Charges", align: "right", render: (r) => fmtShort(r.expense) },
            { key: "margin", label: "Marge", align: "right", render: (r) => <span className={cx("font-semibold", r.margin < 0 ? "text-danger" : "text-ink")}>{fmtShort(r.margin)}</span> },
            {
              key: "margin_rate",
              label: "Taux de marge",
              align: "right",
              render: (r) => (
                <span className={cx("inline-block min-w-14 rounded-full px-2 py-0.5 text-center text-[12px] font-semibold", r.margin_rate === null ? "text-muted" : r.margin_rate < 0 ? "bg-danger-doux text-danger" : r.margin_rate < 15 ? "bg-warn-doux text-warn" : "bg-ok-doux text-ok-texte")}>
                  {fmtPct(r.margin_rate)}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <div className="no-print flex flex-wrap gap-2">
        <Link href="/finance/alertes" className={classesBouton()}>Toutes les alertes</Link>
        <Link href="/finance/rapport" className={classesBouton()}>Rapport mensuel</Link>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimer ce tableau de bord
        </Button>
      </div>
    </div>
  );
}
