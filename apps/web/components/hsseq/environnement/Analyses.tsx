"use client";

import type { ReactNode } from "react";
import { AreaChart, Card, DataTable, Empty, Etat, Field, Input, Kpi, RankBars, Segmented, type Column } from "@/components/ui";
import { fmtIndicateur } from "@/components/hsseq/commun";
import { ChampSite, aujourdhui, decaler, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { useEtroit } from "@/components/hsseq/conformite/commun";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDec, fmtFixe, fmtInt, fmtMonth, fmtPct, fmtVolume, pluriel } from "@/lib/format";
import type { VehicleKind } from "@/lib/hsseq-types";
import { ExportRegistres, filtresCommuns, type VueProps } from "./commun";
import type { AnalysisGroup, Consumption, ConsumptionItem, Deliveries, TankerRow, TipperRow } from "./types";

/** Regroupement dans l'adresse et sa clé dans l'API (« vehicule » par défaut). */
const REGROUPEMENT: Record<string, { cle: AnalysisGroup; label: string; colonne: string }> = {
  vehicule: { cle: "vehicle", label: "Ensemble", colonne: "Ensemble" },
  site: { cle: "site", label: "Site", colonne: "Site" },
  mois: { cle: "month", label: "Mois", colonne: "Mois" },
  rotation: { cle: "rotation", label: "Rotation", colonne: "Rotation" },
};
type Regroupement = keyof typeof REGROUPEMENT;

/** Profil dans l'adresse (« citerne », « benne ») et sa clé dans l'API. */
const PROFIL: Record<string, VehicleKind> = { citerne: "tanker", benne: "tipper" };

/** Nombre de lignes des classements : les plus fortes valeurs, le détail complet dans le tableau. */
const CLASSEMENT = 8;

const litres = (v: number) => `${fmtInt(v)}${INSECABLE}L`;
const tonnes = (v: number) => `${fmtFixe(v, 1)}${INSECABLE}t`;
const lPour100 = (v: number | null) => fmtIndicateur(v, "l_100km");
const co2ParKm = (v: number | null) => fmtIndicateur(v, "kg_co2_km");
const pourMille = (v: number | null) => fmtIndicateur(v, "per_mille");

/**
 * Lignes d'un tableau dans leur ordre de lecture : les mois et les rotations dans l'ordre chronologique
 * du noyau, les ensembles et les sites par nom (ER-02 avant ER-10).
 */
function ordonner<T extends { label: string }>(items: T[], regroupement: AnalysisGroup): T[] {
  if (regroupement === "month" || regroupement === "rotation") return items;
  return [...items].sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
}

/** Premier jour du mois de `jour`, décalé de `n` mois. */
function debutMois(jour: string, n = 0): string {
  const d = new Date(`${jour.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Périodes proposées : le mois en cours (période par défaut du noyau, sans dates), le mois précédent,
 * les trois derniers mois et l'année, tous jusqu'à aujourd'hui sauf le mois précédent.
 */
function periodes(): Array<{ key: string; label: string; du: string; au: string }> {
  const jour = aujourdhui();
  return [
    { key: "mois", label: "Mois en cours", du: "", au: "" },
    { key: "precedent", label: "Mois précédent", du: debutMois(jour, -1), au: decaler(debutMois(jour), -1) },
    { key: "trimestre", label: "Trois mois", du: debutMois(jour, -2), au: "" },
    { key: "annee", label: "Depuis janvier", du: `${jour.slice(0, 4)}-01-01`, au: "" },
  ];
}

/**
 * Consommation, émissions et écarts de livraison (GET /hsseq/environment/consumption et /deliveries),
 * calculés par le noyau depuis les rotations parties de Transport, jamais ressaisis : chiffres clés,
 * classement ou courbe mensuelle, tableau par regroupement. Période (le mois en cours sans dates),
 * regroupement, profil et site portés par l'adresse ; le chef de parc et l'auditeur ne reçoivent que
 * les ensembles de leurs sites.
 */
export function Analyses({ lire, ecrire }: VueProps) {
  const { data: ref } = useReferentiels();
  const { site, du, au, api } = filtresCommuns(lire);
  const regroupement: Regroupement = Object.hasOwn(REGROUPEMENT, lire("regroupement")) ? lire("regroupement") : "vehicule";
  const profil = Object.hasOwn(PROFIL, lire("profil")) ? lire("profil") : "";
  const filtres = { ...api, group_by: REGROUPEMENT[regroupement]!.cle, vehicle_kind: profil ? PROFIL[profil]! : null };
  const conso = useApi<Consumption>(`/hsseq/environment/consumption?${requete(filtres)}`, { keepPreviousData: true });
  const livraisons = useApi<Deliveries>(`/hsseq/environment/deliveries?${requete(filtres)}`, { keepPreviousData: true });
  const choix = periodes();
  const periode = choix.find((p) => p.du === du && p.au === au)?.key ?? "";
  const lu = conso.data ?? livraisons.data;
  const duAffiche = du || lu?.date_from || "";
  const auAffiche = au || lu?.date_to || "";
  const colonne = REGROUPEMENT[regroupement]!.colonne;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="max-w-full">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Période</span>
            <div className="-mx-1 overflow-x-auto px-1">
              {/* Période saisie à la main : aucune option choisie ; la clé remonte la bascule pour en retirer le repère. */}
              <Segmented<string>
                key={periode ? "proposee" : "saisie"}
                label="Période des analyses"
                value={periode}
                onChange={(k) => {
                  const p = choix.find((x) => x.key === k);
                  if (p) ecrire({ du: p.du, au: p.au });
                }}
                options={choix.map((p) => ({ key: p.key, label: p.label }))}
              />
            </div>
          </div>
          <Field label="Du" className="w-[calc(50%-6px)] sm:w-40">
            <Input type="date" value={duAffiche} max={auAffiche || undefined} onChange={(e) => ecrire({ du: e.target.value, au: auAffiche })} />
          </Field>
          <Field label="Au" className="w-[calc(50%-6px)] sm:w-40">
            <Input type="date" value={auAffiche} min={duAffiche || undefined} onChange={(e) => ecrire({ du: duAffiche, au: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="max-w-full">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Par</span>
            <div className="-mx-1 overflow-x-auto px-1">
              <Segmented<Regroupement> label="Regroupement" value={regroupement} onChange={(g) => ecrire({ regroupement: g === "vehicule" ? null : g })} options={(Object.keys(REGROUPEMENT) as Regroupement[]).map((g) => ({ key: g, label: REGROUPEMENT[g]!.label }))} />
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Profil</span>
            <Segmented<string>
              label="Profil de véhicule"
              value={profil || "tous"}
              onChange={(p) => ecrire({ profil: p === "tous" ? null : p })}
              options={[
                { key: "tous", label: "Tous" },
                { key: "citerne", label: "Citerne" },
                { key: "benne", label: "Benne" },
              ]}
            />
          </div>
          <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
          <ExportRegistres filtres={{ ...api, vehicle_kind: filtres.vehicle_kind }} className="ml-auto" />
        </div>
        {lu && (
          <p className="text-[12.5px] leading-snug text-muted">
            Rotations chargées du {fmtDate(lu.date_from)} au {fmtDate(lu.date_to)}
            {du || au ? "" : ", mois en cours"}. Chiffres calculés depuis Transport, jamais ressaisis.
          </p>
        )}
      </div>

      <Card title="Consommation et émissions">
        {!conso.data ? <Etat error={conso.error} onRetry={() => void conso.mutate()} label="Calcul de la consommation…" /> : <Consommation c={conso.data} colonne={colonne} mensuel={regroupement === "mois"} />}
      </Card>

      <Card title="Écarts de livraison">
        {!livraisons.data ? <Etat error={livraisons.error} onRetry={() => void livraisons.mutate()} label="Calcul des écarts de livraison…" /> : <Livraisons l={livraisons.data} colonne={colonne} mensuel={regroupement === "mois"} profil={profil} />}
      </Card>
    </div>
  );
}

/* ─── Consommation ────────────────────────────────────────────────────── */

/** Chiffres clés de la consommation, puis classement (ou courbe par mois) et tableau par regroupement. */
function Consommation({ c, colonne, mensuel }: { c: Consumption; colonne: string; mensuel: boolean }) {
  const etroit = useEtroit();
  const t = c.totals;
  if (!t.rotations) return <Empty title="Aucune rotation partie sur la période." hint="Les rotations en route, validées ou facturées de Transport alimentent la consommation." />;
  const partSaisie = t.km ? (t.fuel_km * 100) / t.km : null;
  const facteurs = [...new Set(c.factors.map((f) => f.co2_factor))];
  const lignes = c.items.filter((i) => i.l_100km !== null);
  const colonnes: Column<ConsumptionItem>[] = [
    { key: "label", label: colonne, sortValue: (i) => (mensuel ? String(i.key) : i.label), render: (i) => <span className="block min-w-[7rem] font-medium text-ink">{mensuel ? fmtMonth(String(i.key)) : i.label}</span> },
    { key: "rotations", label: "Rotations", align: "right", render: (i) => fmtInt(i.rotations) },
    ...(etroit ? [] : [{ key: "km", label: "Km", align: "right" as const, render: (i: ConsumptionItem) => fmtInt(i.km) }]),
    { key: "fuel_liters", label: "Carburant (L)", align: "right", render: (i) => fmtInt(i.fuel_liters) },
    { key: "l_100km", label: "L/100 km", align: "right", sortValue: (i) => i.l_100km, render: (i) => <span className="font-semibold text-ink">{i.l_100km === null ? "–" : fmtFixe(i.l_100km, 1)}</span> },
    ...(etroit
      ? []
      : [
          { key: "co2_kg", label: "CO₂ (kg)", align: "right" as const, render: (i: ConsumptionItem) => fmtInt(i.co2_kg) },
          { key: "co2_kg_per_km", label: "kg CO₂/km", align: "right" as const, sortValue: (i: ConsumptionItem) => i.co2_kg_per_km, render: (i: ConsumptionItem) => (i.co2_kg_per_km === null ? "–" : fmtFixe(i.co2_kg_per_km, 2)) },
        ]),
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Consommation" value={lPour100(t.l_100km)} hint={partSaisie !== null && partSaisie < 99.95 ? `sur ${fmtInt(t.fuel_km)} km au carburant saisi, ${fmtPct(partSaisie, 0)} des km` : `sur ${fmtInt(t.km)} km parcourus`} />
        <Kpi label="Émissions de CO₂" value={co2ParKm(t.co2_kg_per_km)} hint={facteurs.length === 1 ? `${fmtDec(facteurs[0])} kg de CO₂ par litre (paramètres)` : "facteur d'émission de chaque société"} />
        <Kpi label="Carburant" value={litres(t.fuel_liters)} hint={`${pluriel(t.rotations, "rotation partie", "rotations parties")}`} />
        <Kpi label="CO₂ émis" value={tonnes(t.co2_kg / 1000)} hint={`${fmtInt(t.km)} km parcourus`} />
      </div>
      <p className="text-[12.5px] leading-snug text-muted">Source : {c.source.replace(/^Transport : /, "Transport, ")}. Les ratios ne portent que sur les rotations dont le carburant est saisi.</p>
      {lignes.length > 0 && (
        <Graphique
          titre={mensuel ? "Litres aux 100 km, mois par mois" : `Les plus fortes consommations, par ${colonne.toLocaleLowerCase("fr")}`}
          mensuel={mensuel}
          points={lignes.map((i) => ({ key: i.key, label: mensuel ? fmtMonth(String(i.key)) : i.label, value: i.l_100km ?? 0, detail: `${fmtInt(i.km)} km, ${litres(i.fuel_liters)}` }))}
          format={(v) => lPour100(v)}
          enCours={mensuel && c.date_to.slice(0, 7) === aujourdhui().slice(0, 7)}
        />
      )}
      <div className="-mx-6">
        <DataTable
          rows={ordonner(c.items, c.group_by)}
          rowKey={(i) => String(i.key)}
          dense
          columns={colonnes}
          empty="Aucune rotation."
          footer={
            <tr>
              <td className="px-3 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right">{fmtInt(t.rotations)}</td>
              {!etroit && <td className="px-3 py-2.5 text-right">{fmtInt(t.km)}</td>}
              <td className="px-3 py-2.5 text-right">{fmtInt(t.fuel_liters)}</td>
              <td className="px-3 py-2.5 text-right">{t.l_100km === null ? "–" : fmtFixe(t.l_100km, 1)}</td>
              {!etroit && <td className="px-3 py-2.5 text-right">{fmtInt(t.co2_kg)}</td>}
              {!etroit && <td className="px-3 py-2.5 text-right">{t.co2_kg_per_km === null ? "–" : fmtFixe(t.co2_kg_per_km, 2)}</td>}
            </tr>
          }
        />
      </div>
    </div>
  );
}

/* ─── Écarts de livraison ─────────────────────────────────────────────── */

type LigneCiterne = TankerRow & { key: number | string; label: string };
type LigneBenne = TipperRow & { key: number | string; label: string };

/**
 * Manquants des citernes (‰ du livré, les deux à 15 °C) et écarts de tonnage des bennes (‰ du chargé),
 * selon le profil choisi. Le livré non corrigé reste montré sur grand écran, à côté du livré à 15 °C.
 */
function Livraisons({ l, colonne, mensuel, profil }: { l: Deliveries; colonne: string; mensuel: boolean; profil: string }) {
  const etroit = useEtroit();
  const citernes = profil !== "benne";
  const bennes = profil !== "citerne";
  const tc = l.tanker.totals;
  const tb = l.tipper.totals;
  const libelle = (k: number | string, label: string) => (mensuel ? fmtMonth(String(k)) : label);
  const enCours = mensuel && l.date_to.slice(0, 7) === aujourdhui().slice(0, 7);

  const colonnesCiternes: Column<LigneCiterne>[] = [
    { key: "label", label: colonne, sortValue: (i) => (mensuel ? String(i.key) : i.label), render: (i) => <span className="block min-w-[7rem] font-medium text-ink">{libelle(i.key, i.label)}</span> },
    { key: "rotations", label: "Rotations", align: "right", render: (i) => fmtInt(i.rotations) },
    ...(etroit
      ? []
      : [
          { key: "loaded_15", label: "Chargé à 15 °C (m³)", align: "right" as const, render: (i: LigneCiterne) => fmtVolume(i.loaded_15) },
          { key: "delivered", label: "Livré non corrigé (m³)", align: "right" as const, render: (i: LigneCiterne) => <span className="text-muted">{fmtVolume(i.delivered)}</span> },
        ]),
    { key: "delivered_15", label: "Livré à 15 °C (m³)", align: "right", render: (i) => fmtVolume(i.delivered_15) },
    { key: "shortage", label: "Manquant à 15 °C (m³)", align: "right", render: (i) => fmtVolume(i.shortage) },
    { key: "per_mille", label: "‰", align: "right", sortValue: (i) => i.per_mille, render: (i) => <span className="font-semibold text-ink">{i.per_mille === null ? "–" : fmtFixe(i.per_mille, 2)}</span> },
  ];
  const colonnesBennes: Column<LigneBenne>[] = [
    { key: "label", label: colonne, sortValue: (i) => (mensuel ? String(i.key) : i.label), render: (i) => <span className="block min-w-[7rem] font-medium text-ink">{libelle(i.key, i.label)}</span> },
    { key: "rotations", label: "Rotations", align: "right", render: (i) => fmtInt(i.rotations) },
    { key: "loaded_t", label: "Chargé (t)", align: "right", render: (i) => fmtFixe(i.loaded_t, 1) },
    ...(etroit ? [] : [{ key: "delivered_t", label: "Livré (t)", align: "right" as const, render: (i: LigneBenne) => fmtFixe(i.delivered_t, 1) }]),
    { key: "variance_t", label: "Écart (t)", align: "right", render: (i) => fmtFixe(i.variance_t, 2) },
    { key: "per_mille", label: "‰", align: "right", sortValue: (i) => i.per_mille, render: (i) => <span className="font-semibold text-ink">{i.per_mille === null ? "–" : fmtFixe(i.per_mille, 2)}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {citernes && (
          <Kpi label="Manquants des citernes" value={pourMille(tc.per_mille)} hint={tc.rotations ? `${fmtVolume(tc.shortage)}${INSECABLE}m³ manquants sur ${fmtVolume(tc.delivered_15)}${INSECABLE}m³ livrés, à 15${INSECABLE}°C, ${pluriel(tc.rotations, "rotation livrée", "rotations livrées")}` : "Aucune livraison de citerne sur la période."} />
        )}
        {bennes && (
          <Kpi label="Écarts de tonnage des bennes" value={pourMille(tb.per_mille)} hint={tb.rotations ? `${fmtFixe(tb.variance_t, 1)}${INSECABLE}t d'écart sur ${fmtFixe(tb.loaded_t, 1)}${INSECABLE}t chargées, ${pluriel(tb.rotations, "rotation livrée", "rotations livrées")}` : "Aucune livraison de benne sur la période."} />
        )}
      </div>

      {citernes && (
        <Section titre="Citernes : volume manquant ÷ volume livré, à 15 °C" aide="Volumes de Transport ramenés à 15 °C : manquant (chargé moins livré, corrigés) rapporté au livré à 15 °C ; une rotation sans volume livré n'est pas comptée.">
          {l.tanker.items.length === 0 ? (
            <Empty title="Aucune livraison de citerne sur la période." />
          ) : (
            <>
              <Graphique
                titre={mensuel ? "Manquant des citernes, mois par mois" : `Les plus forts manquants, par ${colonne.toLocaleLowerCase("fr")}`}
                mensuel={mensuel}
                points={l.tanker.items.filter((i) => i.per_mille !== null).map((i) => ({ key: i.key, label: libelle(i.key, i.label), value: i.per_mille ?? 0, detail: `${fmtVolume(i.shortage)}${INSECABLE}m³ sur ${fmtVolume(i.delivered_15)}${INSECABLE}m³ à 15${INSECABLE}°C` }))}
                format={(v) => pourMille(v)}
                enCours={enCours}
              />
              <div className="-mx-6">
                <DataTable
                  rows={ordonner(l.tanker.items, l.group_by)}
                  rowKey={(i) => `c-${i.key}`}
                  dense
                  columns={colonnesCiternes}
                  footer={
                    <tr>
                      <td className="px-3 py-2.5">Total</td>
                      <td className="px-3 py-2.5 text-right">{fmtInt(tc.rotations)}</td>
                      {!etroit && <td className="px-3 py-2.5 text-right">{fmtVolume(tc.loaded_15)}</td>}
                      {!etroit && <td className="px-3 py-2.5 text-right text-muted">{fmtVolume(tc.delivered)}</td>}
                      <td className="px-3 py-2.5 text-right">{fmtVolume(tc.delivered_15)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtVolume(tc.shortage)}</td>
                      <td className="px-3 py-2.5 text-right">{tc.per_mille === null ? "–" : fmtFixe(tc.per_mille, 2)}</td>
                    </tr>
                  }
                />
              </div>
            </>
          )}
        </Section>
      )}

      {bennes && (
        <Section titre="Bennes : écart de tonnage ÷ tonnage chargé" aide="Tonnage chargé : poids net du ticket de pesée, à défaut la quantité chargée ; tonnage livré : la quantité livrée ; l'écart est compté en valeur absolue.">
          {l.tipper.items.length === 0 ? (
            <Empty title="Aucune livraison de benne sur la période." />
          ) : (
            <>
              <Graphique
                titre={mensuel ? "Écart de tonnage des bennes, mois par mois" : `Les plus forts écarts, par ${colonne.toLocaleLowerCase("fr")}`}
                mensuel={mensuel}
                points={l.tipper.items.filter((i) => i.per_mille !== null).map((i) => ({ key: i.key, label: libelle(i.key, i.label), value: i.per_mille ?? 0, detail: `${fmtFixe(i.variance_t, 1)}${INSECABLE}t sur ${fmtFixe(i.loaded_t, 1)}${INSECABLE}t` }))}
                format={(v) => pourMille(v)}
                enCours={enCours}
              />
              <div className="-mx-6">
                <DataTable
                  rows={ordonner(l.tipper.items, l.group_by)}
                  rowKey={(i) => `b-${i.key}`}
                  dense
                  columns={colonnesBennes}
                  footer={
                    <tr>
                      <td className="px-3 py-2.5">Total</td>
                      <td className="px-3 py-2.5 text-right">{fmtInt(tb.rotations)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtFixe(tb.loaded_t, 1)}</td>
                      {!etroit && <td className="px-3 py-2.5 text-right">{fmtFixe(tb.delivered_t, 1)}</td>}
                      <td className="px-3 py-2.5 text-right">{fmtFixe(tb.variance_t, 2)}</td>
                      <td className="px-3 py-2.5 text-right">{tb.per_mille === null ? "–" : fmtFixe(tb.per_mille, 2)}</td>
                    </tr>
                  }
                />
              </div>
            </>
          )}
        </Section>
      )}
    </div>
  );
}

/** Intertitre d'une partie d'une carte, et ce qu'elle mesure. */
function Section({ titre, aide, children }: { titre: string; aide: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div>
        <h3 className="text-[14px] font-semibold text-ink">{titre}</h3>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{aide}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Graphique sobre d'un regroupement : courbe d'une seule série mois par mois (le mois en cours en
 * pointillé), sinon classement des plus fortes valeurs, le détail complet restant dans le tableau.
 */
function Graphique({ titre, mensuel, points, format, enCours }: { titre: string; mensuel: boolean; points: Array<{ key: number | string; label: string; value: number; detail: string }>; format: (v: number) => string; enCours: boolean }) {
  if (!points.length) return null;
  if (mensuel && points.length >= 2) {
    return (
      <figure className="m-0 space-y-2">
        <figcaption className="text-[13px] font-medium text-ink-2">{titre}</figcaption>
        <AreaChart labels={points.map((p) => p.label)} series={[{ key: "valeur", label: titre, values: points.map((p) => p.value), color: "var(--accent)" }]} format={format} formatAxis={(v) => fmtDec(v)} label={titre} enCours={enCours} height={190} />
      </figure>
    );
  }
  const classes = [...points].sort((a, b) => b.value - a.value).slice(0, CLASSEMENT);
  return (
    <figure className="m-0 space-y-3">
      <figcaption className="text-[13px] font-medium text-ink-2">
        {titre}
        {points.length > CLASSEMENT ? <span className="text-muted">{`, ${CLASSEMENT} premiers sur ${points.length}`}</span> : null}
      </figcaption>
      <RankBars items={classes.map((p) => ({ key: p.key, label: p.label, value: p.value, detail: p.detail }))} format={format} />
    </figure>
  );
}
