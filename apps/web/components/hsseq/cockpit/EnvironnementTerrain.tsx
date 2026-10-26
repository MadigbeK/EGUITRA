"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "@/components/icons";
import { Card, ProgressBar, RankBars } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDateTime, fmtInt, fmtPct, pluriel } from "@/lib/format";
import type { Cockpit, ViolationType } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { Chiffre, LIEN } from "./ATraiter";
import { lienPermis } from "./outils";

const VIOLATION: Record<ViolationType, string> = {
  speeding: "Excès de vitesse",
  harsh_braking: "Freinages brusques",
  night_driving: "Conduite de nuit",
  driving_time: "Temps de conduite dépassé",
};

/**
 * Situation du lot 3 au cockpit, bornée aux sites du compte : environnement et qualité (fiches
 * ouvertes ; contaminations et réclamations pour qui les lit), urgences (plans, exercices en retard et
 * à venir), documents (procédures en vigueur et taux de lecture), télématique (violations du mois par
 * type, dernier import). Chaque carte mène à son écran.
 */
export function EnvironnementTerrain({ c }: { c: Cockpit }) {
  const { data: me } = useApi<Me>("/auth/me");
  const lien = (href: string, texte: string) =>
    lienPermis(href, me?.profiles) ? (
      <Link href={href} className={LIEN}>
        {texte} <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    ) : null;
  const e = c.environment;
  const u = c.emergency;
  const d = c.documents;
  const t = c.telematics;
  if (!e || !u || !d || !t) return null;
  return (
    <section aria-labelledby="hsseq-terrain">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="hsseq-terrain" className="font-display text-[22px] font-[620] tracking-[-0.015em] text-ink">
          Environnement, urgences et terrain
        </h2>
        <p className="text-[12.5px] text-muted">Situation du jour · violations de {c.period.label}</p>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <Card title="Environnement et qualité" actions={lien("/hsseq/environnement", "Fiches")}>
          <Chiffre valeur={e.spills_open} ton="danger">
            {e.spills_open > 1 ? "déversements ouverts" : "déversement ouvert"}
          </Chiffre>
          <ul className="mt-4 space-y-1.5">
            <Ligne terme="Déchets en attente de collecte" valeur={fmtInt(e.wastes_stored)} />
            <Ligne terme="Dépassements de poussières, 30 jours" valeur={fmtInt(e.dust_exceedances_30d)} alerte={e.dust_exceedances_30d > 0} />
            {e.contaminations_open !== null && <Ligne terme="Manquants et contaminations ouverts" valeur={fmtInt(e.contaminations_open)} alerte={e.contaminations_open > 0} />}
            {e.complaints_open !== null && <Ligne terme="Réclamations en cours" valeur={fmtInt(e.complaints_open)} />}
            {e.complaints_overdue !== null && <Ligne terme="Réclamations hors délai de réponse" valeur={fmtInt(e.complaints_overdue)} alerte={e.complaints_overdue > 0} />}
          </ul>
        </Card>

        <Card title="Urgences" actions={lien("/hsseq/documents", "Plans et exercices")}>
          <Chiffre valeur={u.overdue} ton="danger">
            {u.overdue > 1 ? "exercices en retard" : "exercice en retard"}
          </Chiffre>
          <ul className="mt-4 space-y-1.5">
            <Ligne terme="Plans d'urgence en vigueur" valeur={fmtInt(u.plans_active)} />
            <Ligne terme="Exercices des 30 prochains jours" valeur={fmtInt(u.upcoming)} />
          </ul>
        </Card>

        <Card title="Documents" actions={lien("/hsseq/documents", "Procédures")}>
          <Chiffre valeur={d.procedures_published}>{d.procedures_published > 1 ? "procédures en vigueur" : "procédure en vigueur"}</Chiffre>
          {d.targets > 0 && (
            <>
              <div className="mt-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <ProgressBar value={d.read_rate ?? 0} tone={(d.read_rate ?? 0) >= 100 ? "ok" : "warn"} />
                </div>
                <span className="text-[13px] font-semibold tabular text-ink">{fmtPct(d.read_rate)}</span>
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted">
                {fmtInt(d.read)} {d.read > 1 ? "accusés de lecture" : "accusé de lecture"} sur {pluriel(d.targets, "attendu", "attendus")}
              </p>
            </>
          )}
        </Card>

        <Card title="Télématique" actions={lien("/hsseq/telematique", "Violations")}>
          <Chiffre valeur={t.violations} ton="warn">
            {t.violations > 1 ? "violations de conduite" : "violation de conduite"} dans le mois
          </Chiffre>
          {t.violations > 0 && (
            <div className="mt-4">
              <RankBars
                items={(Object.keys(VIOLATION) as ViolationType[]).map((k) => ({ key: k, label: VIOLATION[k], value: t.by_type[k] ?? 0 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value)}
                format={(v) => fmtInt(v)}
              />
            </div>
          )}
          <p className="mt-3 text-[12.5px] text-muted">{t.last_import_at ? `Dernier import le ${fmtDateTime(t.last_import_at)}.` : "Aucun import des boîtiers pour l'instant."}</p>
        </Card>
      </div>
    </section>
  );
}

function Ligne({ terme, valeur, alerte }: { terme: string; valeur: ReactNode; alerte?: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-ink-2">{terme}</span>
      <span className={alerte ? "font-semibold tabular text-danger" : "font-semibold tabular text-ink"}>{valeur}</span>
    </li>
  );
}
