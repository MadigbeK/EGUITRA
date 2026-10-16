"use client";

import { useState, type ReactNode } from "react";
import { Calculator, Coins, Download, Landmark, Percent, Plus, Scale, Target, Trash2, TrendingUp } from "@/components/icons";
import { AreaChart, Badge, BarChart, Button, Card, ErrorBox, Field, GAMME, Kpi, Loading, Notice, Segmented, Textarea, cx } from "@/components/ui";
import { ApiError, apiDownload, apiSend, useApi } from "@/lib/api-client";
import type { LineKind, ModelRow, PlanLine, PlanPayload, Stress } from "@/lib/axispro-types";
import { fmtPct, fmtShort } from "@/lib/format";
import { CelluleChoix, CelluleNombre, CelluleTexte, annees, millions, ratio } from "./cellules";

type Vue = "statements" | "flows" | "debt" | "working_capital";

/** Colonnes modifiables de chaque nature d'hypothèse. */
type Colonne = { champ: keyof PlanLine; titre: string; type: "texte" | "nombre" | "choix"; largeur?: string; aide?: string; options?: Record<string, string>; visible?: (l: PlanLine) => boolean };

const SECTIONS: Array<{ kind: LineKind; titre: string; aide: string; nouveau: Record<string, unknown>; colonnes: Colonne[] }> = [
  {
    kind: "capex",
    titre: "Investissements",
    aide: "Année 0 : avant l'exploitation. Durée d'amortissement 0 : terrain, non amorti.",
    nouveau: { name: "Nouvel investissement", amount: 0, year: 0, life: 5 },
    colonnes: [
      { champ: "name", titre: "Libellé", type: "texte", largeur: "min-w-56" },
      { champ: "amount", titre: "Montant", type: "nombre", largeur: "min-w-36" },
      { champ: "year", titre: "Année", type: "nombre", largeur: "min-w-16" },
      { champ: "life", titre: "Amortissement (ans)", type: "nombre", largeur: "min-w-20" },
    ],
  },
  {
    kind: "revenue",
    titre: "Produits",
    aide: "Volume à pleine capacité. Montée en régime : % de la capacité par année, par exemple 60;80;100.",
    nouveau: { name: "Nouveau produit", quantity: 0, price: 0, year: 1 },
    colonnes: [
      { champ: "name", titre: "Produit", type: "texte", largeur: "min-w-48" },
      { champ: "quantity", titre: "Volume annuel", type: "nombre", largeur: "min-w-32" },
      { champ: "unit", titre: "Unité", type: "texte", largeur: "min-w-24" },
      { champ: "price", titre: "Prix unitaire", type: "nombre", largeur: "min-w-28" },
      { champ: "unit_cost", titre: "Coût variable unitaire", type: "nombre", largeur: "min-w-28" },
      { champ: "ramp", titre: "Montée en régime (%)", type: "texte", largeur: "min-w-32" },
      { champ: "growth", titre: "Volumes (%/an)", type: "nombre", largeur: "min-w-20" },
      { champ: "price_growth", titre: "Prix (%/an)", type: "nombre", largeur: "min-w-20" },
      { champ: "year", titre: "1re année", type: "nombre", largeur: "min-w-16" },
    ],
  },
  {
    kind: "variable",
    titre: "Coûts variables en % du chiffre d'affaires",
    aide: "À utiliser quand le coût n'est pas connu par unité : commissions, emballages, redevances.",
    nouveau: { name: "Coût variable", rate: 0 },
    colonnes: [
      { champ: "name", titre: "Libellé", type: "texte", largeur: "min-w-56" },
      { champ: "rate", titre: "% du CA", type: "nombre", largeur: "min-w-20" },
    ],
  },
  {
    kind: "fixed",
    titre: "Charges fixes annuelles",
    aide: "Rubriques des soldes intermédiaires de gestion. Évolution : inflation ou hausse annuelle prévue.",
    nouveau: { name: "Nouvelle charge", category: "external", amount: 0, year: 1 },
    colonnes: [
      { champ: "name", titre: "Libellé", type: "texte", largeur: "min-w-52" },
      { champ: "category", titre: "Rubrique", type: "choix", largeur: "min-w-48" },
      { champ: "amount", titre: "Montant annuel", type: "nombre", largeur: "min-w-36" },
      { champ: "growth", titre: "Évolution (%/an)", type: "nombre", largeur: "min-w-20" },
      { champ: "year", titre: "1re année", type: "nombre", largeur: "min-w-16" },
    ],
  },
  {
    kind: "funding",
    titre: "Plan de financement",
    aide: "Apports, emprunts (taux, durée totale, différé d'amortissement) et subventions (reprise sur la durée indiquée).",
    nouveau: { name: "Nouveau financement", funding_type: "equity", amount: 0, year: 0 },
    colonnes: [
      { champ: "name", titre: "Libellé", type: "texte", largeur: "min-w-48" },
      { champ: "funding_type", titre: "Ressource", type: "choix", largeur: "min-w-48" },
      { champ: "amount", titre: "Montant", type: "nombre", largeur: "min-w-36" },
      { champ: "year", titre: "Année", type: "nombre", largeur: "min-w-16" },
      { champ: "rate", titre: "Taux (%)", type: "nombre", largeur: "min-w-20", visible: (l) => l.funding_type === "loan" },
      { champ: "life", titre: "Durée (ans)", type: "nombre", largeur: "min-w-16", visible: (l) => l.funding_type === "loan" || l.funding_type === "grant" },
      { champ: "grace", titre: "Différé (ans)", type: "nombre", largeur: "min-w-16", visible: (l) => l.funding_type === "loan" },
      { champ: "repayment", titre: "Remboursement", type: "choix", largeur: "min-w-48", visible: (l) => l.funding_type === "loan" },
    ],
  },
];

const PARAMETRES: Array<{ champ: string; titre: string; aide?: string }> = [
  { champ: "first_year", titre: "Première année d'exploitation", aide: "Par défaut, l'année du démarrage prévu." },
  { champ: "horizon", titre: "Horizon (années)" },
  { champ: "discount_rate", titre: "Taux d'actualisation (%)", aide: "Coût du capital retenu pour la VAN." },
  { champ: "tax_rate", titre: "Impôt sur les sociétés (%)" },
  { champ: "min_tax_rate", titre: "Impôt minimum (% du CA)" },
  { champ: "tax_holiday", titre: "Années d'exonération" },
  { champ: "loss_carry_years", titre: "Report des déficits (exercices)", aide: "0 : sans limite." },
  { champ: "receivable_days", titre: "Crédit clients (jours)" },
  { champ: "inventory_days", titre: "Stocks (jours de coûts variables)" },
  { champ: "payable_days", titre: "Crédit fournisseurs (jours)" },
  { champ: "dscr_target", titre: "DSCR exigé par les banques" },
  { champ: "equity_target", titre: "Apport minimal exigé (%)" },
];

export function ModeleFinancier({ dossierId, reference }: { dossierId: number; reference: string }) {
  const chemin = `/axispro/dossiers/${dossierId}/plan`;
  const { data, error, mutate } = useApi<PlanPayload>(chemin);
  const { data: stress, mutate: recalculer } = useApi<Stress | null>(data?.lines.length ? `${chemin}/stress` : null);
  const [message, setMessage] = useState<string | null>(null);
  const [vue, setVue] = useState<Vue>("statements");

  async function envoyer(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
    setMessage(null);
    try {
      const p = await apiSend<PlanPayload>(method, path, body);
      await mutate(p, { revalidate: false });
      void recalculer();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Enregistrement impossible.");
      void mutate();
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading label="Calcul du modèle financier…" />;
  const a = data.analysis;
  const ind = a.indicators;
  const p = data.plan;
  const vide = data.lines.length === 0;
  const ligne = (rows: ModelRow[], key: string) => rows.find((r) => r.key === key)?.values ?? [];
  const nombres = (vals: Array<number | null>) => vals.map((v) => v ?? 0);

  return (
    <div className="space-y-6">
      {message && <Notice tone="danger">{message}</Notice>}
      {vide ? (
        <Notice tone="accent">
          Le modèle est vide. Saisissez les investissements, les produits, les charges et le plan de financement ci-dessous : les comptes prévisionnels, la rentabilité et la couverture de la dette se calculent à chaque modification.
          {data.dossier.investment > 0 && ` Investissement annoncé à l'ouverture du dossier : ${fmtShort(data.dossier.investment)} GNF.`}
        </Notice>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <Kpi label="VAN du projet" value={fmtShort(ind.npv)} icon={TrendingUp} teinte={ind.npv >= 0 ? "jade" : "danger"} tone={ind.npv >= 0 ? "ok" : "danger"} hint={`Au taux de ${fmtPct(p.discount_rate, 1)}`} />
            <Kpi label="TRI du projet" value={fmtPct(ind.irr_project)} icon={Percent} teinte="azur" tone={ind.irr_project !== null && ind.irr_project >= p.discount_rate ? "ok" : "warn"} hint={`Fonds propres : ${fmtPct(ind.irr_equity)}`} />
            <Kpi label="DSCR minimal" value={ratio(ind.dscr_min)} icon={Scale} teinte={ind.dscr_min === null || ind.dscr_min >= p.dscr_target ? "jade" : "danger"} tone={ind.dscr_min === null ? "neutral" : ind.dscr_min >= p.dscr_target ? "ok" : "danger"} hint={ind.dscr_min === null ? "Pas d'emprunt" : `Exigé ${ratio(p.dscr_target)}, moyen ${ratio(ind.dscr_avg)}, LLCR ${ratio(ind.llcr)}`} />
            <Kpi label="Délai de récupération" value={annees(ind.payback)} icon={Target} teinte="lagon" hint={`Actualisé : ${annees(ind.discounted_payback)}`} />
            <Kpi label="Marge d'EBE en croisière" value={fmtPct(ind.ebitda_margin)} icon={Calculator} teinte="ambre" hint={`Point mort : ${fmtPct(ind.breakeven_ratio, 0)} du CA`} />
            <Kpi label="Apport des promoteurs" value={fmtPct(ind.equity_share, 0)} icon={Coins} teinte="or" tone={ind.equity_share !== null && ind.equity_share >= p.equity_target ? "ok" : "warn"} hint={`Endettement : ${ratio(ind.gearing)} fois les fonds propres`} />
          </div>

          {a.alerts.length > 0 && (
            <Notice tone="warn">
              <ul className="space-y-1">
                {a.alerts.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Notice>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <Card title="Activité et trésorerie" className="xl:col-span-8">
              <AreaChart
                labels={a.labels}
                format={(v) => `${millions(v)} M`}
                formatAxis={(v) => fmtShort(v)}
                series={[
                  { key: "ca", label: "Chiffre d'affaires", values: nombres(ligne(a.statements, "revenue")), color: GAMME[1] },
                  { key: "ebe", label: "EBE", values: nombres(ligne(a.statements, "ebitda")), color: GAMME[0] },
                  { key: "treso", label: "Trésorerie cumulée", values: nombres(ligne(a.flows, "cash_cumulative")), color: GAMME[2] },
                ]}
              />
            </Card>
            <Card title={`Couverture de la dette (DSCR, exigé ${ratio(p.dscr_target)})`} className="xl:col-span-4">
              {ind.dscr_min === null ? (
                <p className="text-sm text-muted">Aucun service de la dette sur l&apos;horizon.</p>
              ) : (
                <BarChart
                  format={(v) => ratio(v)}
                  data={ligne(a.debt, "dscr")
                    .map((v, i) => ({ label: a.labels[i] ?? String(i), value: v }))
                    .filter((x): x is { label: string; value: number } => x.value !== null)
                    .map((x) => ({ ...x, tone: x.value >= p.dscr_target ? ("ok" as const) : ("danger" as const) }))}
                />
              )}
            </Card>
          </div>

          <Card
            title="Comptes prévisionnels (millions de GNF)"
            actions={<Segmented label="Tableau" value={vue} onChange={setVue} options={[{ key: "statements", label: "Résultat" }, { key: "flows", label: "Flux" }, { key: "debt", label: "Dette" }, { key: "working_capital", label: "BFR et point mort" }]} />}
            padded={false}
          >
            <TableauModele labels={a.labels} rows={a[vue]} />
          </Card>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
            <Card title="Plan de financement initial" className="xl:col-span-5">
              <PlanInitial plan={a.financing_plan} />
            </Card>
            <Card title="Sensibilités et scénarios" className="xl:col-span-7">
              {!stress ? <Loading label="Calcul des sensibilités…" /> : <Sensibilites s={stress} />}
            </Card>
          </div>
        </>
      )}

      <Card
        title="Hypothèses"
        actions={
          !vide && (
            <Button onClick={() => apiDownload(`${chemin}.xlsx`, `${reference}_modele_financier.xlsx`)}>
              <Download className="h-4 w-4" /> Export XLSX
            </Button>
          )
        }
      >
        <div className="space-y-7">
          {SECTIONS.map((sec) => (
            <Section key={sec.kind} section={sec} lignes={data.lines.filter((l) => l.kind === sec.kind)} options={data.options} chemin={chemin} envoyer={envoyer} />
          ))}
        </div>
      </Card>

      <Card title="Paramètres du calcul">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {PARAMETRES.map((par) => (
            <Field key={par.champ} label={par.titre} hint={par.aide}>
              <CelluleNombre
                label={par.titre}
                className="w-full"
                value={Number((p as unknown as Record<string, number | null>)[par.champ] ?? 0)}
                onSave={(v) => envoyer("PATCH", chemin, { [par.champ]: v })}
              />
            </Field>
          ))}
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
            <input type="checkbox" checked={p.residual_value} onChange={(e) => envoyer("PATCH", chemin, { residual_value: e.target.checked })} />
            Valeur résiduelle en fin d&apos;horizon
          </label>
        </div>
        <Field label="Hypothèses et sources" className="mt-4">
          <Textarea defaultValue={p.notes ?? ""} placeholder="Origine des prix, des volumes, des devis d'équipement, conditions des banques…" onBlur={(e) => e.target.value !== (p.notes ?? "") && envoyer("PATCH", chemin, { notes: e.target.value })} />
        </Field>
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          Calcul annuel. Amortissement linéaire dès la mise en service ; subvention reprise au résultat sur sa durée ; impôt avec report des déficits, exonération et impôt minimum ; BFR en jours. CFADS = EBE - impôt - variation du BFR ; DSCR = CFADS / service de la dette. Flux du projet après impôt normatif sur le résultat d&apos;exploitation, valeur résiduelle (valeur nette comptable et BFR récupéré) en dernière année ; flux des fonds propres après dette, dette restante déduite.
        </p>
      </Card>
    </div>
  );
}

function Section({
  section,
  lignes,
  options,
  chemin,
  envoyer,
}: {
  section: (typeof SECTIONS)[number];
  lignes: PlanLine[];
  options: PlanPayload["options"];
  chemin: string;
  envoyer: (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<void>;
}) {
  const choix = (c: Colonne) => (c.champ === "category" ? options.categories : c.champ === "funding_type" ? options.funding_types : options.repayments);
  function enregistrer(l: PlanLine, champ: keyof PlanLine, valeur: unknown) {
    const corps: Record<string, unknown> = { [champ]: valeur };
    // Un emprunt exige une durée et un taux : valeurs de départ au passage en emprunt.
    if (champ === "funding_type" && valeur === "loan") Object.assign(corps, { life: l.life || 5, rate: l.rate || 12, repayment: l.repayment || "annuity" });
    void envoyer("PATCH", `/axispro/plan-lines/${l.id}`, corps);
  }
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">{section.titre}</h3>
          <p className="text-[12.5px] text-muted">{section.aide}</p>
        </div>
        <Button className="min-h-8 px-2.5 py-1 text-[13px]" onClick={() => envoyer("POST", `${chemin}/lines`, { kind: section.kind, ...section.nouveau })}>
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </div>
      {lignes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong/70 px-3 py-3 text-[13px] text-muted">Aucune ligne.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-panel-2 text-left text-[12px] text-muted">
              <tr>
                {section.colonnes.map((c) => (
                  <th key={c.champ} className={cx("whitespace-nowrap px-2 py-2 font-semibold", c.type === "nombre" && "text-right")}>
                    {c.titre}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  {section.colonnes.map((c) => (
                    <td key={c.champ} className="px-2 py-1.5">
                      {c.visible && !c.visible(l) ? (
                        <span className="block text-center text-muted">–</span>
                      ) : c.type === "nombre" ? (
                        <CelluleNombre label={`${c.titre}, ${l.name}`} className={c.largeur} value={Number(l[c.champ] ?? 0)} onSave={(v) => enregistrer(l, c.champ, v)} />
                      ) : c.type === "choix" ? (
                        <CelluleChoix label={`${c.titre}, ${l.name}`} className={c.largeur} value={String(l[c.champ] || "")} options={choix(c)} onSave={(v) => enregistrer(l, c.champ, v)} />
                      ) : (
                        <CelluleTexte label={`${c.titre}, ${l.name}`} className={c.largeur} value={String(l[c.champ] || "")} placeholder={c.champ === "ramp" ? "60;80;100" : undefined} onSave={(v) => enregistrer(l, c.champ, v)} />
                      )}
                    </td>
                  ))}
                  <td className="px-1 text-right">
                    <button type="button" aria-label={`Supprimer ${l.name}`} title="Supprimer" className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger" onClick={() => window.confirm(`Supprimer « ${l.name} » ?`) && envoyer("DELETE", `/axispro/plan-lines/${l.id}`)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TableauModele({ labels, rows }: { labels: string[]; rows: ModelRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] tabular">
        <thead className="bg-panel-2 text-[12px] text-muted">
          <tr>
            <th className="sticky left-0 bg-panel-2 px-4 py-2 text-left font-semibold" />
            {labels.map((l) => (
              <th key={l} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cx("border-t border-line", r.strong && "bg-panel-2/60 font-semibold text-ink")}>
              <td className={cx("sticky left-0 whitespace-nowrap px-4 py-1.5", r.strong ? "bg-panel-2" : "bg-panel")}>{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} className={cx("whitespace-nowrap px-3 py-1.5 text-right", r.strong && v !== null && v < 0 && "text-danger")}>
                  {r.ratio ? ratio(v) : millions(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanInitial({ plan }: { plan: PlanPayload["analysis"]["financing_plan"] }) {
  const lignes = (titre: string, items: Array<{ label: string; amount: number }>, total: number): ReactNode => (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{titre}</div>
      <ul className="space-y-1 text-[13.5px]">
        {items.map((x) => (
          <li key={x.label} className="flex justify-between gap-3">
            <span className="text-ink-2">{x.label}</span>
            <span className="whitespace-nowrap tabular">{fmtShort(x.amount)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 border-t border-line pt-1 font-semibold">
          <span>Total</span>
          <span className="whitespace-nowrap tabular">{fmtShort(total)}</span>
        </li>
      </ul>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {lignes("Emplois", plan.uses, plan.uses_total)}
        {lignes("Ressources", plan.resources, plan.resources_total)}
      </div>
      <div className={cx("flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold", plan.gap >= 0 ? "bg-ok-doux text-ok-texte" : "bg-danger-doux text-danger")}>
        <span className="inline-flex items-center gap-2">
          <Landmark className="h-4 w-4" /> {plan.gap >= 0 ? "Plan équilibré, excédent" : "Ressources manquantes"}
        </span>
        <span className="tabular">{fmtShort(Math.abs(plan.gap))} GNF</span>
      </div>
    </div>
  );
}

function Sensibilites({ s }: { s: Stress }) {
  const m = s.margins;
  const pct = (v: number | null) => (v === null ? "aucune marge" : v >= 100 ? "plus de 100 %" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {s.scenarios.map((sc) => (
          <div key={sc.key} className={cx("rounded-xl border p-3", sc.key === "base" ? "border-accent/40 bg-accent-doux/40" : "border-line")}>
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-semibold text-ink">{sc.label}</span>
              <Badge tone={sc.indicators.npv >= 0 ? "ok" : "danger"}>{sc.indicators.npv >= 0 ? "VAN positive" : "VAN négative"}</Badge>
            </div>
            <dl className="mt-2 space-y-0.5 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-muted">VAN</dt><dd className="tabular">{fmtShort(sc.indicators.npv)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">TRI projet</dt><dd className="tabular">{fmtPct(sc.indicators.irr_project)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">DSCR minimal</dt><dd className="tabular">{ratio(sc.indicators.dscr_min)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Trésorerie minimale</dt><dd className={cx("tabular", sc.indicators.cash_min < 0 && "text-danger")}>{fmtShort(sc.indicators.cash_min)}</dd></div>
            </dl>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">{sc.description}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="py-1.5 pr-3 text-left font-semibold">VAN selon l&apos;hypothèse (M GNF)</th>
              {s.sensitivities[0]?.rows.map((r) => (
                <th key={r.shock} className="px-2 py-1.5 text-right font-semibold">
                  {r.shock > 0 ? "+" : ""}
                  {r.shock} %
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.sensitivities.map((x) => (
              <tr key={x.key} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink-2">{x.label}</td>
                {x.rows.map((r) => (
                  <td key={r.shock} className={cx("px-2 py-1.5 text-right", r.npv < 0 && "font-semibold text-danger")}>
                    {millions(r.npv)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[11.5px] text-muted">Classées de la plus influente à la moins influente. Le taux d&apos;intérêt ne joue que sur la dette et la rentabilité des fonds propres.</p>
      </div>
      <div className="rounded-xl bg-panel-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
        <b>Marges de sécurité.</b> Le prix de vente peut baisser de {pct(m.price_npv)} et les volumes de {pct(m.volume_npv)} avant que la VAN devienne négative.
        {m.price_dscr !== null && ` Avant que le DSCR passe sous 1 : ${pct(m.price_dscr)} sur le prix, ${pct(m.volume_dscr)} sur les volumes.`}
      </div>
    </div>
  );
}
