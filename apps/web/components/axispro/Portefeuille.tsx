"use client";

import Link from "next/link";
import { AlertTriangle, Calendar, Clock, HandCoins, ShieldAlert, Users } from "@/components/icons";
import { Badge, Card, ErrorBox, RankBars, Repartition, cx } from "@/components/ui";
import { COULEUR_FINANCEMENT, ETATS } from "@/lib/couleurs";
import { useApi } from "@/lib/api-client";
import { FUNDING_STATE, RISK_LEVEL, type FundingState, type PortefeuilleDevises, type TotauxDevise } from "@/lib/axispro-types";
import { INSECABLE, aujourdhui, fmtDate, fmtDec, fmtPct, pluriel } from "@/lib/format";
import { montantDevise, ratio } from "./cellules";
import { note } from "./dossier/commun";

const COULEUR_ETAPE: Partial<Record<FundingState, string>> = COULEUR_FINANCEMENT;
const OBTENUS: FundingState[] = ["signed", "disbursed"];

/**
 * Pilotage du portefeuille du cabinet : financements obtenus et en cours, actions en retard,
 * risques critiques, relances des financeurs, rentabilité des dossiers, charge des consultants.
 *
 * Devises : les montants de chaque devise restent à part (le noyau ne les additionne jamais) ; la
 * devise de la société vient en tête, les autres suivent sous chaque chiffre. Le DSCR d'un projet se
 * compare au DSCR bancaire de la grille en vigueur.
 */
export function Portefeuille() {
  const { data, error, mutate } = useApi<PortefeuilleDevises>("/axispro/portfolio");
  // Même clé que l'en-tête de la liste des dossiers : une seule lecture de la grille en vigueur.
  const { data: grille } = useApi<{ dscr_target: number } | null>("/axispro/policy");
  const erreur = error && (
    <div className="mb-5">
      <ErrorBox titre={data ? "Rechargement du pilotage impossible : les chiffres affichés peuvent dater." : "Pilotage du portefeuille indisponible."} error={error} onRetry={() => void mutate()} />
    </div>
  );
  if (!data || data.projects.length === 0) return erreur || null;
  const devise = data.currency ?? null;
  const f = data.financing;
  const totaux: TotauxDevise[] = f.by_currency ?? [{ currency: devise ?? "", need: f.need, investment: f.investment, requested: f.requested, granted: f.granted }];
  const principal = totaux.find((t) => t.currency === devise) ?? { currency: devise ?? "", need: f.need, investment: f.investment, requested: f.requested, granted: f.granted };
  const autres = totaux.filter((t) => t !== principal);
  const enCours = f.pipeline
    .filter((p) => !["rejected", "withdrawn"].includes(p.state))
    .map((p) => ({ p, valeur: OBTENUS.includes(p.state) ? p.granted : p.requested }))
    .filter((x) => x.valeur > 0);
  const rentables = data.projects.filter((p) => p.irr_project !== null).sort((a, b) => (b.irr_project ?? 0) - (a.irr_project ?? 0));
  const jour = aujourdhui();
  const seuilDscr = grille?.dscr_target ?? null;
  const couverture = (t: Pick<TotauxDevise, "need" | "granted">) => (t.need ? fmtPct((t.granted / t.need) * 100, 0) : "–");

  return (
    <div className="mb-5 space-y-5">
      {erreur}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card title="Financement des projets" className="xl:col-span-7">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Chiffre titre="Besoin des dossiers" valeur={montantDevise(principal.need, devise)} autres={autres.filter((t) => t.need).map((t) => montantDevise(t.need, t.currency))} />
            <Chiffre titre="Sollicité" valeur={montantDevise(principal.requested, devise)} autres={autres.filter((t) => t.requested).map((t) => montantDevise(t.requested, t.currency))} />
            <Chiffre titre="Obtenu" valeur={montantDevise(principal.granted, devise)} autres={autres.filter((t) => t.granted).map((t) => montantDevise(t.granted, t.currency))} accent />
            <Chiffre titre="Couverture du besoin" valeur={couverture(principal)} autres={autres.filter((t) => t.need).map((t) => `${t.currency}${INSECABLE}: ${couverture(t)}`)} />
          </div>
          {enCours.length > 0 ? (
            <div className="mt-4">
              <Repartition
                format={(v) => montantDevise(v, devise)}
                parts={enCours.map(({ p, valeur }) => ({ key: p.state, label: `${FUNDING_STATE[p.state].label} (${p.count})`, value: valeur, color: COULEUR_ETAPE[p.state] ?? ETATS.neutre }))}
              />
            </div>
          ) : (
            autres.length === 0 && <p className="mt-4 text-[13px] text-muted">Aucune démarche de financement enregistrée : onglet « Financements » des dossiers.</p>
          )}
          {autres.some((t) => t.requested || t.granted) && (
            <p className="mt-3 text-[12.5px] text-muted">
              Démarches en d&apos;autres devises, à part :{" "}
              {autres
                .filter((t) => t.requested || t.granted)
                .map((t) => `${montantDevise(t.requested, t.currency)} sollicités, ${montantDevise(t.granted, t.currency)} obtenus`)
                .join(" ; ")}
              .
            </p>
          )}
          <div className="mt-3 text-right">
            <Link href="/axispro/financements" className="text-[13px] font-semibold text-accent hover:underline">
              Toutes les démarches
            </Link>
          </div>
        </Card>
        <Card title="À surveiller" className="xl:col-span-5">
          <div className="grid grid-cols-3 gap-3">
            <Alerte icone={AlertTriangle} titre="Actions en retard" valeur={data.actions.overdue} tone={data.actions.overdue ? "danger" : "ok"} href="/axispro/actions" />
            <Alerte icone={Clock} titre="À valider" valeur={data.actions.submitted} tone={data.actions.submitted ? "warn" : "ok"} href="/axispro/actions" />
            <Alerte icone={ShieldAlert} titre="Risques critiques" valeur={data.risks.critical} tone={data.risks.critical ? "danger" : "ok"} />
          </div>
          <ul className="mt-4 space-y-2 text-[13px]">
            {data.follow_ups.slice(0, 4).map((r) => (
              <li key={`f${r.id}`} className="flex items-start gap-2">
                <Calendar className={cx("mt-0.5 h-4 w-4 flex-none", (r.next_date ?? "") < jour ? "text-danger" : "text-muted")} />
                <span className="min-w-0">
                  <b className="tabular">{fmtDate(r.next_date)}</b> relancer {r.funder.name}
                  {r.dossier && (
                    <>
                      {" "}
                      pour{" "}
                      <Link href={`/axispro/dossiers/${r.dossier.id}`} className="font-semibold text-accent hover:underline">
                        {r.dossier.reference}
                      </Link>
                    </>
                  )}
                  {r.next_step ? `, ${r.next_step}` : ""}
                </span>
              </li>
            ))}
            {data.risks.list
              .filter((r) => r.level === "critical")
              .slice(0, 3)
              .map((r) => (
                <li key={`r${r.id}`} className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 flex-none" style={{ color: RISK_LEVEL[r.level].color }} />
                  <span className="min-w-0">
                    {r.name}
                    {r.dossier && (
                      <>
                        ,{" "}
                        <Link href={`/axispro/dossiers/${r.dossier.id}`} className="font-semibold text-accent hover:underline">
                          {r.dossier.reference}
                        </Link>
                      </>
                    )}{" "}
                    <Badge tone="danger">criticité {r.score}</Badge>
                  </span>
                </li>
              ))}
            {data.follow_ups.length === 0 && data.risks.critical === 0 && <li className="text-muted">Aucune relance dans les 14 jours, aucun risque critique.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card title="Rentabilité des projets modélisés" className="xl:col-span-7" padded={false}>
          {rentables.length === 0 ? (
            <p className="px-5 py-5 text-[13px] text-muted">Aucun modèle financier saisi pour l&apos;instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] tabular">
                <thead className="bg-panel-2 text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Projet</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Project Readiness, APD Readiness, Bankability">Readiness / APD / Bank.</th>
                    <th className="px-3 py-2 text-right font-semibold">TRI</th>
                    <th className="px-3 py-2 text-right font-semibold" title={seuilDscr !== null ? `En rouge : sous le DSCR bancaire de la grille en vigueur (${ratio(seuilDscr)})` : undefined}>DSCR min.</th>
                    <th className="px-3 py-2 text-right font-semibold">VAN</th>
                    <th className="px-4 py-2 text-right font-semibold">Besoin</th>
                  </tr>
                </thead>
                <tbody>
                  {rentables.slice(0, 8).map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="px-4 py-2">
                        <Link href={`/axispro/dossiers/${p.id}`} className="font-semibold text-ink hover:text-accent">
                          {p.name}
                        </Link>
                        <div className="text-[12px] text-muted">{p.reference}{p.gate ? `, ${p.gate}` : ""}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular">{!p.assessed ? "–" : `${note(p.readiness)} / ${note(p.apd)} / ${note(p.bankability)}`}</td>
                      <td className="px-3 py-2 text-right">{fmtPct(p.irr_project)}</td>
                      <td className={cx("px-3 py-2 text-right", p.dscr_min !== null && seuilDscr !== null && p.dscr_min < seuilDscr && "font-semibold text-danger")}>{ratio(p.dscr_min)}</td>
                      <td className={cx("whitespace-nowrap px-3 py-2 text-right", (p.npv ?? 0) < 0 && "text-danger")}>{montantDevise(p.npv, p.currency)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">{montantDevise(p.financing_need, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Charge des consultants (30 derniers jours)" className="xl:col-span-5">
          {data.workload.length === 0 ? (
            <p className="text-[13px] text-muted">Aucun temps saisi.</p>
          ) : (
            <RankBars items={data.workload.map((w) => ({ key: w.name, label: w.name, value: w.hours, detail: pluriel(w.dossiers, "dossier") }))} format={(v) => `${fmtDec(v)}${INSECABLE}h`} />
          )}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-muted" /> {fmtDec(data.fees.unbilled_hours)}{INSECABLE}h à facturer</span>
            <span className="inline-flex items-center gap-1.5"><HandCoins className="h-4 w-4 text-muted" /> {montantDevise(data.fees.invoiced_year, data.fees.currency ?? devise)} facturés cette année</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Chiffre({ titre, valeur, autres, accent }: { titre: string; valeur: string; autres?: string[]; accent?: boolean }) {
  return (
    <div>
      <div className="text-[12.5px] text-muted">{titre}</div>
      <div className={cx("font-display text-[21px] font-bold tabular", accent ? "text-accent" : "text-ink")}>{valeur}</div>
      {/* Montants des autres devises, jamais ajoutés au premier. */}
      {autres?.map((a) => (
        <div key={a} className="text-[12px] font-semibold tabular text-ink-2">
          + {a}
        </div>
      ))}
    </div>
  );
}

function Alerte({ icone: I, titre, valeur, tone, href }: { icone: typeof Clock; titre: string; valeur: number; tone: "ok" | "warn" | "danger"; href?: string }) {
  const corps = (
    <div className={cx("rounded-xl border px-3 py-2.5", tone === "danger" ? "border-danger/30 bg-danger-doux/50" : tone === "warn" ? "border-ambre/30 bg-warn-doux/50" : "border-line bg-panel-2")}>
      <I className={cx("h-4 w-4", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-muted")} />
      <div className="mt-1 font-display text-[22px] font-bold tabular text-ink">{valeur}</div>
      <div className="text-[12px] leading-tight text-muted">{titre}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl hover:brightness-[0.98]">
      {corps}
    </Link>
  ) : (
    corps
  );
}
