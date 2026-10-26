"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "@/components/icons";
import { Card, ProgressBar, Repartition } from "@/components/ui";
import { NIVEAUX, ORDRE_NIVEAUX, nomVehicule } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import { ETATS } from "@/lib/couleurs";
import { fmtDate, fmtInt, fmtPct, pluriel } from "@/lib/format";
import type { Cockpit, FindingClass, RequirementStatus } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { Chiffre, LIEN } from "./ATraiter";
import { lienPermis } from "./outils";

const CLASSES: ReadonlyArray<{ code: FindingClass; label: string; couleur: string }> = [
  { code: "major", label: "Écarts majeurs", couleur: ETATS.alerte },
  { code: "minor", label: "Écarts mineurs", couleur: ETATS.attention },
  { code: "observation", label: "Observations", couleur: ETATS.neutre },
];

const STATUTS: ReadonlyArray<{ code: RequirementStatus; label: string; couleur: string }> = [
  { code: "compliant", label: "Conformes", couleur: ETATS.bon },
  { code: "partial", label: "Partiellement conformes", couleur: ETATS.attention },
  { code: "non_compliant", label: "Non conformes", couleur: ETATS.alerte },
  { code: "not_evaluated", label: "Non évaluées", couleur: ETATS.neutre },
];

/**
 * Situation du lot 2 au cockpit, bornée aux sites du compte : registre des risques, audits de l'année
 * et constats ouverts, exigences et maturité par norme (pas pour le chef de parc, qui ne lit pas le
 * registre des exigences), véhicules immobilisés (V09). Chaque carte mène à son écran.
 */
export function RisquesConformite({ c }: { c: Cockpit }) {
  const { data: me } = useApi<Me>("/auth/me");
  const lien = (href: string, texte: string) =>
    lienPermis(href, me?.profiles) ? (
      <Link href={href} className={LIEN}>
        {texte} <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    ) : null;
  const r = c.risks;
  const a = c.audits;
  const exigences = c.requirements;
  const immobilises = c.immobilizations;
  return (
    <section aria-labelledby="hsseq-conformite">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="hsseq-conformite" className="font-display text-[22px] font-[620] tracking-[-0.015em] text-ink">
          Risques et conformité
        </h2>
        <p className="text-[12.5px] text-muted">Situation du jour · audits de l&apos;année {a.year}</p>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <Card title="Registre des risques" actions={lien("/hsseq/risques?statut=en_vigueur", "Registre")}>
          <Chiffre valeur={r.active}>{r.active > 1 ? "risques en vigueur" : "risque en vigueur"}</Chiffre>
          <Rubrique>Criticité résiduelle, après mesures</Rubrique>
          <Repartition parts={ORDRE_NIVEAUX.map((n) => ({ key: n, label: NIVEAUX[n].label, value: r.by_residual_level[n] ?? 0, color: NIVEAUX[n].couleur }))} format={(v) => pluriel(v, "risque")} />
          <p className="mt-3 text-[12.5px] leading-snug text-muted">
            Avant mesures : {pluriel(r.by_raw_level.high ?? 0, "élevé", "élevés")}, {pluriel(r.by_raw_level.significant ?? 0, "significatif", "significatifs")}.
          </p>
          {r.reviews_overdue > 0 && (
            <p className="mt-2 text-[13px] font-semibold text-warn">
              {lienPermis("/hsseq/risques", me?.profiles) ? (
                <Link href="/hsseq/risques?echue=1" className="underline-offset-2 hover:underline">
                  {pluriel(r.reviews_overdue, "revue échue", "revues échues")}
                </Link>
              ) : (
                pluriel(r.reviews_overdue, "revue échue", "revues échues")
              )}
            </p>
          )}
        </Card>

        <Card title={`Audits ${a.year}`} actions={lien("/hsseq/conformite", "Programme")}>
          <Chiffre valeur={a.done}>{`${a.done > 1 ? "réalisés" : "réalisé"} sur ${pluriel(a.planned, "planifié", "planifiés")}`}</Chiffre>
          {a.planned > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <ProgressBar value={a.rate ?? 0} />
              </div>
              <span className="text-[13px] font-semibold tabular text-ink">{fmtPct(a.rate)}</span>
            </div>
          )}
          <Rubrique>
            {lienPermis("/hsseq/conformite", me?.profiles) ? (
              <Link href="/hsseq/conformite?vue=constats" className="underline-offset-2 hover:underline">
                Constats ouverts
              </Link>
            ) : (
              "Constats ouverts"
            )}
          </Rubrique>
          <ul className="space-y-1.5">
            {CLASSES.map((k) => (
              <li key={k.code} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="inline-flex items-center gap-2 text-ink-2">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: k.couleur }} />
                  {k.label}
                </span>
                <span className="font-semibold tabular text-ink">{fmtInt(c.findings.open_by_class[k.code] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Card>

        {exigences && (
          <Card title="Exigences et maturité" actions={lien("/hsseq/conformite?vue=exigences", "Registre")}>
            <Chiffre valeur={exigences.non_compliant} ton="danger">
              {exigences.non_compliant > 1 ? "exigences non conformes" : "exigence non conforme"}
            </Chiffre>
            <Rubrique>Exigences par statut</Rubrique>
            <Repartition parts={STATUTS.map((s) => ({ key: s.code, label: s.label, value: exigences.by_status[s.code] ?? 0, color: s.couleur }))} format={(v) => pluriel(v, "exigence")} />
            {c.iso_maturity && c.iso_maturity.length > 0 && (
              <>
                <Rubrique>Maturité par norme</Rubrique>
                <ul className="space-y-3">
                  {c.iso_maturity.map((m) => (
                    <li key={m.standard}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="font-medium text-ink">{m.label}</span>
                        <span className="font-semibold tabular text-ink">{m.score === null ? "Non évaluée" : fmtPct(m.score)}</span>
                      </div>
                      <ProgressBar value={m.score ?? 0} epaisseur={6} />
                      <p className="mt-1 text-[11.5px] text-muted">
                        {fmtInt(m.evaluated)} {m.evaluated > 1 ? "évaluées" : "évaluée"} sur {pluriel(m.requirements, "exigence")}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11.5px] leading-snug text-muted">Exigence conforme : 1 ; partiellement conforme : 0,5 ; sur les exigences évaluées.</p>
              </>
            )}
          </Card>
        )}

        <Card title="Véhicules immobilisés" actions={lien("/hsseq/immobilisations", "Immobilisations")}>
          <Chiffre valeur={immobilises.active} ton="danger">
            {immobilises.active > 1 ? "véhicules immobilisés" : "véhicule immobilisé"} le temps d&apos;une enquête (V09)
          </Chiffre>
          {immobilises.items.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Aucun véhicule immobilisé.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line/80 border-t border-line/80">
              {immobilises.items.map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{nomVehicule(x.vehicle)}</span>
                    <span className="block text-[12px] text-muted">
                      {x.site ? `${x.site.name} · ` : ""}depuis le {fmtDate(x.since)}
                    </span>
                  </span>
                  <Link href={`/hsseq/evenements/${x.event.id}`} className={LIEN}>
                    {x.event.reference}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {immobilises.active > immobilises.items.length && <p className="mt-2 text-[12px] text-muted">Les {fmtInt(immobilises.items.length)} plus récents ; la liste complète est dans « Immobilisations ».</p>}
        </Card>
      </div>
    </section>
  );
}

function Rubrique({ children }: { children: ReactNode }) {
  return <h3 className="mb-2.5 mt-5 text-[13px] font-semibold text-ink-2">{children}</h3>;
}
