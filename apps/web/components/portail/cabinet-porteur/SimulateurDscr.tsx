"use client";

import { Card, Gauge, Notice, Segmented, cx } from "@/components/ui";
import { fmtGNF, fmtPct, fmtRatio, pluriel } from "@/lib/format";
import { ChampMontant, Ligne } from "./champs";
import { DSCR_CIBLE, calculerDscr, capitalPourEcheance, type ParamsDscr, type ParamsPret, type ResultatPret } from "./calculs";

export function SimulateurDscr({ params, onChange, pret, resultatPret }: { params: ParamsDscr; onChange: (p: ParamsDscr) => void; pret: ParamsPret; resultatPret: ResultatPret }) {
  const maj = (champ: Partial<ParamsDscr>) => onChange({ ...params, ...champ });
  const depuisPret = params.source === "pret" && resultatPret.ok;
  const service = depuisPret && resultatPret.ok ? resultatPret.echeance * 12 : params.service;
  const c = calculerDscr(params.ebe, params.impots, params.renouvellement, service);
  const ratio = c.ratio;
  const zone = ratio === null ? null : ratio < 1 ? "danger" : ratio < DSCR_CIBLE ? "warn" : "ok";
  const r = resultatPret.ok ? resultatPret.tauxMensuel : pret.taux / 1200;
  const n = resultatPret.ok ? resultatPret.moisAmortissement : Math.max(0, pret.duree - pret.differe);
  const empruntMax = capitalPourEcheance(c.echeanceMax, r, n);
  const baisse = ratio !== null && ratio > 0 ? fmtPct((1 - 1 / ratio) * 100, 0) : null;

  let phrase: string;
  if (c.flux <= 0) phrase = "L'activité ne dégage pas encore de flux disponible pour rembourser une dette : revoyez d'abord la rentabilité d'exploitation.";
  else if (ratio === null) phrase = "Indiquez le service annuel de la dette pour mesurer la couverture.";
  else if (ratio < 1) phrase = `Les flux de l'activité ne couvrent pas les remboursements : il manque ${fmtGNF(-c.ecart)} par an. Allongez la durée, réduisez le montant emprunté ou renforcez l'apport.`;
  else if (ratio < DSCR_CIBLE) phrase = `Les remboursements sont couverts, mais la marge est mince : une baisse de ${baisse} des flux suffit à les mettre en défaut. Les banques demandent souvent ${fmtRatio(DSCR_CIBLE)} au moins.`;
  else phrase = `Confortable : les flux couvrent ${fmtRatio(ratio)} fois les remboursements. Ils peuvent baisser de ${baisse} avant de manquer.`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card title="Vos chiffres annuels">
        <div className="space-y-4">
          <ChampMontant label="Excédent brut d'exploitation (EBE)" value={params.ebe} onChange={(ebe) => maj({ ebe })} aide="Chiffre d'affaires moins achats, charges externes, salaires et taxes d'exploitation." />
          <ChampMontant label="Impôts sur le bénéfice" value={params.impots} onChange={(impots) => maj({ impots })} />
          <ChampMontant label="Investissements de renouvellement" value={params.renouvellement} onChange={(renouvellement) => maj({ renouvellement })} aide="Ce qu'il faut réinvestir chaque année pour garder l'outil en état." />
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-ink-2">Service annuel de la dette</div>
            <Segmented<ParamsDscr["source"]>
              label="Origine du service de la dette"
              value={params.source}
              onChange={(source) => maj({ source })}
              options={[
                { key: "pret", label: "Simulateur de prêt" },
                { key: "saisie", label: "Je le saisis" },
              ]}
            />
          </div>
          {params.source === "saisie" ? (
            <ChampMontant label="Remboursements annuels (capital et intérêts)" value={params.service} onChange={(s) => maj({ service: s })} aide="Toutes les échéances de l'année, tous prêts confondus." />
          ) : resultatPret.ok ? (
            <p className="rounded-xl bg-panel-2 px-3.5 py-3 text-[13px] leading-snug text-ink-2">
              12 échéances de {fmtGNF(resultatPret.echeance)}, soit <b className="text-ink">{fmtGNF(service)}</b> par an, d'après l'onglet « Prêt ».
            </p>
          ) : (
            <Notice tone="warn">Le simulateur de prêt est incomplet : {resultatPret.raison.toLowerCase()}</Notice>
          )}
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        <Card title="Couverture du service de la dette">
          <div className="grid items-center gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
            <div role="img" aria-label={ratio === null ? "DSCR non calculable" : `DSCR de ${fmtRatio(ratio)}, ${zone === "ok" ? "confortable" : zone === "warn" ? "limite" : "insuffisant"}`}>
              <Gauge
                value={ratio === null ? null : Math.max(0, ratio)}
                max={2.5}
                format={(v) => fmtRatio(v)}
                vide="Non calculable"
                sousTitre="DSCR"
                zones={[
                  { jusqua: 1, couleur: "var(--danger-vif)", label: "Insuffisant" },
                  { jusqua: DSCR_CIBLE, couleur: "var(--warn-vif)", label: "Limite" },
                  { jusqua: 2.5, couleur: "var(--g-jade)", label: "Confortable" },
                ]}
              />
            </div>
            <div className="min-w-0">
              <p
                aria-live="polite"
                className={cx(
                  "rounded-2xl px-4 py-3.5 text-[14px] leading-relaxed",
                  zone === "danger" || c.flux <= 0 ? "bg-danger-doux text-ink" : zone === "warn" ? "bg-warn-doux text-ink" : zone === "ok" ? "bg-ok-doux text-ink" : "bg-panel-2 text-ink-2",
                )}
              >
                {phrase}
              </p>
              <dl className="mt-3">
                <Ligne label="Flux disponible pour la dette" valeur={fmtGNF(c.flux)} ton={c.flux <= 0 ? "danger" : undefined} />
                <Ligne label="Service annuel de la dette" valeur={fmtGNF(service)} />
                <Ligne label="DSCR = flux disponible ÷ service" valeur={ratio === null ? "–" : fmtRatio(ratio)} fort ton={zone === "danger" ? "danger" : zone === "warn" ? "warn" : zone === "ok" ? "ok" : undefined} />
              </dl>
            </div>
          </div>
        </Card>

        <Card title={`Ce que l'activité peut supporter (DSCR de ${fmtRatio(DSCR_CIBLE)})`}>
          {c.flux <= 0 ? (
            <p className="text-[13.5px] text-muted">Sans flux disponible, aucune échéance n'est supportable.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-accent-doux px-4 py-3.5">
                  <div className="text-[12.5px] text-ink-2">Échéance mensuelle maximale</div>
                  <div className="mt-0.5 font-display text-[22px] font-bold tabular text-ink">{fmtGNF(c.echeanceMax)}</div>
                </div>
                <div className="rounded-2xl bg-panel-2 px-4 py-3.5">
                  <div className="text-[12.5px] text-ink-2">Service annuel maximal</div>
                  <div className="mt-0.5 font-display text-[22px] font-bold tabular text-ink">{fmtGNF(c.serviceMax)}</div>
                </div>
              </div>
              {n > 0 && (
                <p className="mt-4 text-[13.5px] leading-relaxed text-ink-2">
                  Au taux de {fmtPct(pret.taux, 2)} sur {pluriel(n, "mois", "mois")} d'amortissement (hypothèses de l'onglet « Prêt »), cette échéance rembourse un emprunt d'environ{" "}
                  <b className="text-ink">{fmtGNF(empruntMax)}</b>
                  {resultatPret.ok && empruntMax < resultatPret.capitalAmorti ? ", moins que le montant simulé." : "."}
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
