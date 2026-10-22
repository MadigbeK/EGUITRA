"use client";

import { Card, Notice, Segmented, cx } from "@/components/ui";
import { fmtGNF, fmtShort } from "@/lib/format";
import { ChampMontant, ChampNombre, Ligne } from "./champs";
import { calculerSeuil, decimal, type ParamsSeuil } from "./calculs";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « vers la fin d'août » : moment de l'année où le seuil est franchi (ventes régulières dès janvier). */
function quandSeuil(mois: number | null): string {
  if (mois === null) return "";
  if (mois >= 11.95) return " à la toute fin de l'exercice";
  const i = Math.max(0, Math.floor(mois));
  const nom = MOIS[i] ?? "";
  return ` vers ${mois - i >= 0.5 ? "la fin" : "le début"} ${/^[aeiou]/.test(nom) ? "d'" : "de "}${nom}`;
}

/** Pas « rond » d'un axe (1, 2 ou 5 fois une puissance de dix). */
function pasRond(etendue: number, nombre = 4): number {
  if (etendue <= 0) return 1;
  const brut = etendue / nombre;
  const ordre = 10 ** Math.floor(Math.log10(brut));
  const r = brut / ordre;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * ordre;
}

/** Droites du chiffre d'affaires et des coûts totaux : la perte à gauche du seuil, le bénéfice à droite. */
function GraphiqueSeuil({ ca, tauxCv, cf, seuil }: { ca: number; tauxCv: number; cf: number; seuil: number | null }) {
  const W = 560;
  const H = 300;
  const G = 58;
  const D = 18;
  const Hh = 18;
  const B = 34;
  const xmax = Math.max(ca, seuil ?? 0, cf, 1) * 1.25;
  const coutMax = cf + tauxCv * xmax;
  const pasY = pasRond(Math.max(xmax, coutMax));
  const ymax = Math.ceil(Math.max(xmax, coutMax) / pasY) * pasY;
  const pasX = pasRond(xmax);
  const sx = (v: number) => G + (v / xmax) * (W - G - D);
  const sy = (v: number) => H - B - (v / ymax) * (H - B - Hh);
  const ticksX: number[] = [];
  for (let v = 0; v <= xmax; v += pasX) ticksX.push(v);
  const ticksY: number[] = [];
  for (let v = 0; v <= ymax + pasY / 2; v += pasY) ticksY.push(v);
  const p = (x: number, y: number) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
  const seuilVisible = seuil !== null && seuil <= xmax;
  const description = seuil === null
    ? "Graphique : les coûts restent au-dessus du chiffre d'affaires, aucun seuil n'est atteint."
    : `Graphique : la droite du chiffre d'affaires croise celle des coûts totaux à ${fmtGNF(seuil)}. À gauche, perte ; à droite, bénéfice.`;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={description}>
        {ticksY.map((v) => (
          <g key={`y${v}`}>
            <line x1={G} x2={W - D} y1={sy(v)} y2={sy(v)} stroke={v === 0 ? "var(--line-strong)" : "var(--line)"} strokeDasharray={v === 0 ? undefined : "4 5"} />
            <text x={G - 8} y={sy(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)">{fmtShort(v)}</text>
          </g>
        ))}
        {ticksX.map((v) => (
          <text key={`x${v}`} x={sx(v)} y={H - B + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmtShort(v)}</text>
        ))}
        {seuilVisible && seuil !== null && (
          <>
            <polygon points={`${p(0, cf)} ${p(seuil, seuil)} ${p(0, 0)}`} fill="var(--danger-vif)" opacity="0.12" />
            <polygon points={`${p(seuil, seuil)} ${p(xmax, xmax)} ${p(xmax, coutMax)}`} fill="var(--g-jade)" opacity="0.14" />
          </>
        )}
        <line x1={sx(0)} x2={sx(xmax)} y1={sy(cf)} y2={sy(cf)} stroke="var(--muted)" strokeDasharray="2 4" strokeWidth="1.3" />
        <text x={sx(xmax) - 4} y={sy(cf) - 6} textAnchor="end" fontSize="10.5" fill="var(--muted)">Charges fixes</text>
        <line x1={sx(0)} y1={sy(cf)} x2={sx(xmax)} y2={sy(coutMax)} stroke="var(--g-corail)" strokeWidth="2.5" strokeLinecap="round" />
        <line x1={sx(0)} y1={sy(0)} x2={sx(xmax)} y2={sy(xmax)} stroke="var(--accent-vif)" strokeWidth="2.5" strokeLinecap="round" />
        {ca > 0 && (
          <g>
            <line x1={sx(ca)} x2={sx(ca)} y1={sy(0)} y2={Hh} stroke="var(--ink-2)" strokeDasharray="3 4" strokeWidth="1.2" />
            <text x={sx(ca)} y={Hh - 5} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--ink-2)">CA prévu</text>
          </g>
        )}
        {seuilVisible && seuil !== null && (
          <g>
            <circle cx={sx(seuil)} cy={sy(seuil)} r="6" fill="var(--panel)" stroke="var(--ink)" strokeWidth="2.5" />
            <text x={sx(seuil) + 10} y={sy(seuil) + 16} fontSize="11.5" fontWeight="700" fill="var(--ink)">Seuil : {fmtShort(seuil)}</text>
          </g>
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-2"><span aria-hidden className="h-[3px] w-5 rounded-full bg-accent-vif" /> Chiffre d'affaires</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden className="h-[3px] w-5 rounded-full bg-corail" /> Coûts totaux</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-4 rounded-sm bg-danger-vif/25" /> Zone de perte</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-4 rounded-sm bg-jade/25" /> Zone de bénéfice</span>
      </figcaption>
    </figure>
  );
}

export function SimulateurSeuil({ params, onChange }: { params: ParamsSeuil; onChange: (p: ParamsSeuil) => void }) {
  const maj = (champ: Partial<ParamsSeuil>) => onChange({ ...params, ...champ });
  const s = calculerSeuil(params);
  // Tolérance d'un franc : les arrondis du calcul ne font pas basculer un seuil tout juste atteint.
  const atteint = s.seuil !== null && s.ca >= s.seuil - 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card title="Votre activité sur un an">
        <div className="space-y-4">
          <ChampMontant label="Chiffre d'affaires prévu" value={params.ca} onChange={(ca) => maj({ ca })} />
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-ink-2">Charges variables</div>
            <Segmented<ParamsSeuil["mode"]>
              label="Saisie des charges variables"
              value={params.mode}
              onChange={(mode) => maj({ mode })}
              options={[
                { key: "pct", label: "En % du CA" },
                { key: "montant", label: "En montant" },
              ]}
            />
          </div>
          {params.mode === "pct" ? (
            <ChampNombre label="Part des charges variables" unite="% du CA" decimales={1} max={100} value={params.cvPct} onChange={(cvPct) => maj({ cvPct })} aide="Achats consommés, transport, commissions : ce qui augmente avec les ventes." />
          ) : (
            <ChampMontant label="Charges variables annuelles" value={params.cvMontant} onChange={(cvMontant) => maj({ cvMontant })} aide="Achats consommés, transport, commissions : ce qui augmente avec les ventes." />
          )}
          <ChampMontant label="Charges fixes annuelles" value={params.cf} onChange={(cf) => maj({ cf })} aide="Loyer, salaires fixes, assurances, abonnements, intérêts : ce qui reste dû même sans vente." />
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        <section aria-label="Seuil de rentabilité" className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[20px] bg-panel p-5 shadow-[var(--ombre-feuille)]">
            <div className="text-[12.5px] font-medium text-ink-2">Seuil de rentabilité</div>
            <div aria-live="polite" className="mt-1.5 font-display text-[22px] font-bold leading-tight tabular text-ink">{s.seuil === null ? "Inatteignable" : fmtGNF(s.seuil)}</div>
            <div className="mt-1 text-[12px] text-muted">de chiffre d'affaires par an</div>
          </div>
          <div className="rounded-[20px] bg-panel p-5 shadow-[var(--ombre-feuille)]">
            <div className="text-[12.5px] font-medium text-ink-2">Point mort</div>
            <div className="mt-1.5 font-display text-[22px] font-bold leading-tight tabular text-ink">
              {s.moisPointMort === null ? "–" : `${decimal(s.moisPointMort, 1)} mois`}
            </div>
            <div className="mt-1 text-[12px] text-muted">{s.joursPointMort === null ? "Chiffre d'affaires à renseigner" : `soit ${Math.round(s.joursPointMort)} jours d'activité`}</div>
          </div>
          <div className={cx("rounded-[20px] p-5 shadow-[var(--ombre-feuille)]", atteint ? "bg-ok-doux" : "bg-danger-doux")}>
            <div className="text-[12.5px] font-medium text-ink-2">Marge de sécurité</div>
            <div className={cx("mt-1.5 font-display text-[22px] font-bold leading-tight tabular", atteint ? "text-ok-texte" : "text-danger")}>
              {s.indiceSecurite === null ? "–" : `${decimal(s.indiceSecurite * 100, 0)} %`}
            </div>
            <div className="mt-1 text-[12px] text-ink-2">{s.margeSecurite === null ? "Aucun seuil" : fmtGNF(s.margeSecurite)}</div>
          </div>
        </section>

        {s.seuil === null ? (
          <Notice tone="danger">Les charges variables absorbent tout le chiffre d'affaires : chaque vente coûte plus qu'elle ne rapporte. Revoyez vos prix ou vos coûts d'achat.</Notice>
        ) : atteint ? (
          <Notice tone="ok">
            Le seuil est franchi{quandSeuil(s.moisPointMort)}, si l'exercice commence en janvier et que les ventes sont régulières. Au-delà, chaque vente dégage {decimal(s.tauxMcv * 100, 0)} % de marge.
          </Notice>
        ) : (
          <Notice tone="warn">
            Avec ce chiffre d'affaires, l'activité perd {fmtGNF(-s.resultat)} par an. Il manque {fmtGNF(s.seuil - s.ca)} de ventes pour couvrir les charges.
          </Notice>
        )}

        <Card title="Seuil de rentabilité en image">
          <GraphiqueSeuil ca={s.ca} tauxCv={s.tauxCv} cf={s.cf} seuil={s.seuil} />
        </Card>

        <Card title="Le calcul">
          <dl>
            <Ligne label="Chiffre d'affaires" valeur={fmtGNF(s.ca)} />
            <Ligne label="Charges variables" valeur={`${fmtGNF(s.cv)} (${decimal(s.tauxCv * 100, 1)} %)`} />
            <Ligne label="Marge sur coûts variables" valeur={`${fmtGNF(s.mcv)} (${decimal(s.tauxMcv * 100, 1)} %)`} />
            <Ligne label="Charges fixes" valeur={fmtGNF(s.cf)} />
            <Ligne label="Résultat d'exploitation" valeur={fmtGNF(s.resultat)} fort ton={s.resultat >= 0 ? "ok" : "danger"} />
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">Seuil = charges fixes ÷ taux de marge sur coûts variables. Point mort calculé sur une année de 12 mois et 360 jours, ventes supposées régulières.</p>
        </Card>
      </div>
    </div>
  );
}
