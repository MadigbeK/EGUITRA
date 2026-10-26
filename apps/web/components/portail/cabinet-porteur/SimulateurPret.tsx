"use client";

import { useId, useState } from "react";
import { ChevronDown, Download } from "@/components/icons";
import { Button, Card, Notice, Repartition, Segmented, Select, cx } from "@/components/ui";
import { INSECABLE, fmtFixe, fmtGNF, fmtInt, pluriel } from "@/lib/format";
import { ChampMontant, ChampNombre, Ligne } from "./champs";
import type { ParamsPret, ResultatPret, TypeDiffere } from "./calculs";

const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Nombre d'une cellule CSV : virgule décimale, sans séparateur de milliers (lisible par un tableur). */
function nombreCsv(v: number, chiffres: number): string {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: chiffres, maximumFractionDigits: chiffres, useGrouping: false });
}

/**
 * Mois de la première échéance (AAAA-MM) en deux listes, mois et année : le champ « mois » du navigateur
 * n'existe ni dans Firefox ni dans Safari de bureau, où il demandait de taper « 2026-11 » sans le dire.
 */
function ChoixMois({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [a, m] = value.split("-").map(Number);
  const maintenant = new Date().getFullYear();
  const annee = a && Number.isFinite(a) ? a : maintenant;
  const mois = m && m >= 1 && m <= 12 ? m : 1;
  const annees = Array.from({ length: 12 }, (_, i) => maintenant - 1 + i);
  if (!annees.includes(annee)) annees.push(annee);
  const ecrire = (x: number, y: number) => onChange(`${y}-${String(x).padStart(2, "0")}`);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
      <Select id={id} aria-label="Mois de la première échéance" value={mois} onChange={(e) => ecrire(Number(e.target.value), annee)} options={NOMS_MOIS.map((nom, i) => ({ value: i + 1, label: nom }))} />
      <Select aria-label="Année de la première échéance" value={annee} onChange={(e) => ecrire(mois, Number(e.target.value))} options={annees.sort((x, y) => x - y).map((y) => ({ value: y, label: String(y) }))} />
    </div>
  );
}

function moisCourt(d: Date) {
  return d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }).replace(".", "");
}

/**
 * Cellule CSV : un nombre calculé s'écrit à la virgule décimale ; un texte commençant par = + - @ ou
 * une tabulation est neutralisé (apostrophe) pour qu'un tableur n'y voie jamais une formule.
 */
function cellule(v: string | number, chiffres = 2): string {
  if (typeof v === "number") return nombreCsv(Math.abs(v) < 0.005 ? 0 : v, chiffres);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Tableau d'amortissement en CSV : point-virgule, virgule décimale, en-tête des hypothèses. */
function exporterCsv(p: ParamsPret, r: Extract<ResultatPret, { ok: true }>) {
  const lignes: Array<Array<string | number>> = [
    ["Simulation de prêt", "Portail MB AxisPro Consulting"],
    ["Montant emprunté (GNF)", p.montant],
    ["Taux annuel (%)", p.taux],
    ["Durée totale (mois)", String(p.duree)],
    ["Différé (mois)", String(p.differe)],
    ["Type de différé", p.differe ? (p.typeDiffere === "partiel" ? "Partiel (intérêts seuls)" : "Total (intérêts capitalisés)") : "Sans différé"],
    ["Échéance constante (GNF)", r.echeance],
    ["Total remboursé (GNF)", r.totalRembourse],
    ["Coût total du crédit (GNF)", r.coutCredit],
    [],
    ["N°", "Mois", "Capital dû en début de mois (GNF)", "Intérêts (GNF)", "Capital remboursé (GNF)", "Échéance (GNF)", "Capital dû en fin de mois (GNF)", "Période"],
    ...r.lignes.map((l) => [
      String(l.rang),
      `${String(l.date.getMonth() + 1).padStart(2, "0")}/${l.date.getFullYear()}`,
      l.capitalDebut,
      l.interets,
      l.amortissement,
      l.echeance,
      l.capitalFin,
      l.differe ? "Différé" : "Amortissement",
    ]),
  ];
  const csv = "﻿" + lignes.map((l) => l.map((c) => cellule(c)).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `simulation-pret-${Math.round(p.montant)}-GNF-${p.duree}-mois.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SimulateurPret({ params, onChange, resultat }: { params: ParamsPret; onChange: (p: ParamsPret) => void; resultat: ResultatPret }) {
  const [tableau, setTableau] = useState(true);
  const [tout, setTout] = useState(false);
  const zone = useId();
  const maj = (champ: Partial<ParamsPret>) => onChange({ ...params, ...champ });
  const r = resultat.ok ? resultat : null;
  const lignes = r ? (tout ? r.lignes : r.lignes.slice(0, 12)) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card title="Votre prêt">
        <div className="space-y-4">
          <ChampMontant label="Montant emprunté" value={params.montant} onChange={(montant) => maj({ montant })} />
          <div className="grid grid-cols-2 gap-3">
            <ChampNombre label="Taux annuel" unite="%" decimales={2} max={100} value={params.taux} onChange={(taux) => maj({ taux })} />
            <ChampNombre label="Durée totale" unite="mois" min={1} max={360} value={params.duree} onChange={(duree) => maj({ duree })} />
          </div>
          <ChampNombre label="Différé" unite="mois" max={120} value={params.differe} onChange={(differe) => maj({ differe })} aide="Mois sans remboursement de capital au début du prêt, compris dans la durée totale." />
          {params.differe > 0 && (
            <div>
              <div id={`${zone}-type`} className="mb-1.5 text-[13px] font-medium text-ink-2">Pendant le différé</div>
              <Segmented<TypeDiffere>
                label="Type de différé"
                value={params.typeDiffere}
                onChange={(typeDiffere) => maj({ typeDiffere })}
                options={[
                  { key: "partiel", label: "Je paie les intérêts" },
                  { key: "total", label: "Rien à payer" },
                ]}
              />
              <p className="mt-1.5 text-[12px] leading-snug text-muted">
                {params.typeDiffere === "partiel" ? "Différé partiel : seuls les intérêts sont payés, le capital reste dû." : "Différé total : les intérêts s'ajoutent au capital, ce qui alourdit les échéances suivantes."}
              </p>
            </div>
          )}
          <div>
            <label htmlFor={`${zone}-debut`} className="mb-1.5 block text-[13px] font-medium text-ink-2">Première échéance</label>
            <ChoixMois id={`${zone}-debut`} value={params.debut} onChange={(debut) => maj({ debut })} />
          </div>
          <p className="text-[12px] leading-snug text-muted">Remboursement mensuel à échéances constantes. Assurance et frais de dossier non compris : demandez-les à la banque.</p>
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        {!r ? (
          <Notice tone="warn">{resultat.ok ? "" : resultat.raison}</Notice>
        ) : (
          <>
            <section aria-label="Résultat de la simulation" className="relative overflow-hidden rounded-[22px] bg-accent-strong p-6 text-white shadow-[0_30px_60px_-36px_rgb(16_40_70/0.7)] sm:p-7">
              <div className="text-[13px] font-medium text-white/70">Échéance mensuelle{params.differe > 0 ? " après le différé" : ""}</div>
              <div aria-live="polite" className="mt-1 font-display text-[34px] font-bold leading-none tabular sm:text-[42px]">
                {fmtInt(r.echeance)} <span className="text-[16px] font-semibold text-white/70">GNF</span>
              </div>
              <div className="mt-2 text-[13px] text-white/75">
                {pluriel(r.moisAmortissement, "échéance")}
                {params.differe > 0 && (
                  <>
                    , précédées de {params.differe} mois de différé {params.typeDiffere === "partiel" ? `à ${fmtGNF(r.echeanceDiffere)} par mois` : "sans paiement"}
                  </>
                )}
                .
              </div>
              <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                  { l: "Coût total du crédit", v: fmtGNF(r.coutCredit) },
                  { l: "Total remboursé", v: fmtGNF(r.totalRembourse) },
                  { l: "Annuité en régime de croisière", v: fmtGNF(r.echeance * 12) },
                ].map((x) => (
                  <div key={x.l} className="rounded-2xl bg-white/[0.09] px-4 py-3 ring-1 ring-white/10">
                    <dt className="text-[12px] text-white/75">{x.l}</dt>
                    <dd className="mt-0.5 text-[15.5px] font-bold tabular">{x.v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <Card title="Ce que vous remboursez">
              <Repartition
                format={(v) => fmtGNF(v)}
                parts={[
                  { key: "capital", label: "Capital emprunté", value: params.montant, color: "var(--accent-vif)" },
                  { key: "interets", label: "Intérêts", value: Math.max(0, r.coutCredit), color: "var(--n-or)" },
                ]}
              />
              <dl className="mt-3">
                {params.typeDiffere === "total" && params.differe > 0 && <Ligne label="Capital à amortir après le différé" valeur={fmtGNF(r.capitalAmorti)} />}
                <Ligne label="Le crédit coûte, pour 100 GNF empruntés" valeur={`${fmtFixe((r.coutCredit / params.montant) * 100, 1)}${INSECABLE}GNF`} />
              </dl>
            </Card>

            <Card
              padded={false}
              title="Tableau d'amortissement"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => exporterCsv(params, r)}>
                    <Download className="h-4 w-4" /> Exporter en CSV
                  </Button>
                  <Button variant="ghost" aria-expanded={tableau} aria-controls={zone} onClick={() => setTableau((v) => !v)}>
                    {tableau ? "Replier" : "Déplier"}
                    <ChevronDown className={cx("h-4 w-4 transition-transform", tableau && "rotate-180")} />
                  </Button>
                </div>
              }
            >
              <div id={zone} hidden={!tableau}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-[13px]">
                    <caption className="sr-only">Tableau d'amortissement, montants en GNF</caption>
                    <thead>
                      <tr className="border-y border-line bg-panel-2 text-[12px] text-muted">
                        <th scope="col" className="px-3 py-2.5 pl-6 text-left font-semibold">N°</th>
                        <th scope="col" className="px-3 py-2.5 text-left font-semibold">Mois</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-semibold">Capital dû</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-semibold">Intérêts</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-semibold">Capital remboursé</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-semibold">Échéance</th>
                        <th scope="col" className="px-3 py-2.5 pr-6 text-right font-semibold">Reste dû</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {lignes.map((l) => (
                        <tr key={l.rang} className={cx("border-b border-line/70", l.differe && "bg-[#f8efdc]/50")}>
                          <td className="px-3 py-2 pl-6 text-muted">{l.rang}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-2">
                            {moisCourt(l.date)}
                            {l.differe && <span className="ml-1.5 rounded-full bg-[#f8efdc] px-1.5 py-px text-[10.5px] font-semibold text-[#7d5c17]">différé</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-ink-2">{fmtInt(l.capitalDebut)}</td>
                          <td className="px-3 py-2 text-right text-ink-2">{fmtInt(l.interets)}</td>
                          <td className="px-3 py-2 text-right text-ink-2">{fmtInt(l.amortissement)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-ink">{fmtInt(l.echeance)}</td>
                          <td className="px-3 py-2 pr-6 text-right text-ink-2">{fmtInt(l.capitalFin)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {tout && (
                      <tfoot className="tabular">
                        <tr className="bg-panel-2 font-semibold text-ink">
                          <td colSpan={3} className="px-3 py-2.5 pl-6">Total</td>
                          <td className="px-3 py-2.5 text-right">{fmtInt(r.lignes.reduce((s, l) => s + (l.differe && params.typeDiffere === "total" ? 0 : l.interets), 0))}</td>
                          <td className="px-3 py-2.5 text-right">{fmtInt(r.lignes.reduce((s, l) => s + l.amortissement, 0))}</td>
                          <td className="px-3 py-2.5 text-right">{fmtInt(r.totalRembourse)}</td>
                          <td className="px-3 py-2.5 pr-6" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {r.lignes.length > 12 && (
                  <div className="border-t border-line px-6 py-3">
                    <button type="button" onClick={() => setTout((v) => !v)} className="text-[13px] font-semibold text-accent hover:underline">
                      {tout ? "N'afficher que les 12 premières échéances" : `Tout afficher (${r.lignes.length} échéances)`}
                    </button>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
