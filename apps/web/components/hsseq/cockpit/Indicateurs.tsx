"use client";

import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";
import { Kpi } from "@/components/ui";
import { INDICATEUR, TYPE_VEHICULE, fmtCible, fmtIndicateur } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import type { TonEtat } from "@/lib/couleurs";
import type { Cockpit, Indicator, IndicatorStatus } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { GLISSANTS, indicateursMontres, lienIndicateur, lienPermis } from "./outils";
import { LIEN } from "./ATraiter";

/**
 * Registre des chiffres clés : deux cases par rangée au téléphone, quatre au bureau. Sous 640 px, la
 * valeur passe à 22 px pour que « 44,2 L/100 km » tienne dans une demi-largeur.
 */
const REGISTRE = "grid grid-cols-2 gap-4 lg:grid-cols-4 max-sm:[&_.kpi]:px-3.5 max-sm:[&_.kpi_.font-display]:text-[22px]";

/**
 * Indicateurs du cockpit (§10) : valeur, cible, état (sceau), source écrite et tendance gravée sur
 * douze mois. Un indicateur qui ignore le site (TF, TG) le dit quand un site est choisi ; un
 * indicateur sans objet pour le profil choisi (écart benne sur les citernes) n'est pas montré.
 */
export function BandeIndicateurs({ c }: { c: Cockpit }) {
  const { data: me } = useApi<Me>("/auth/me");
  const visibles = indicateursMontres(c);
  const masques = c.indicators.length - visibles.length;
  return (
    <section aria-labelledby="hsseq-indicateurs">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="hsseq-indicateurs" className="font-display text-[22px] font-[620] tracking-[-0.015em] text-ink">
          Indicateurs
        </h2>
        <p className="text-[12.5px] text-muted">
          {c.period.type === "12m" ? `12 mois glissants, ${c.period.label}` : `Mois de ${c.period.label}`} · heures travaillées de RH : {c.hours_basis === "paid" ? "heures payées" : "heures de présence"}
          {masques > 0 && c.filters.vehicle_kind ? ` · ${masques > 1 ? `${masques} indicateurs sans objet` : "1 indicateur sans objet"} pour le profil ${TYPE_VEHICULE[c.filters.vehicle_kind].toLocaleLowerCase("fr")}` : ""}
        </p>
      </div>
      <div className={REGISTRE}>
        {visibles.map((i) => (
          <Indicateur key={i.code} i={i} c={c} permis={(href) => lienPermis(href, me?.profiles)} />
        ))}
      </div>
    </section>
  );
}

/** Sceau d'un indicateur selon son état servi par le noyau ; « Sous surveillance » à surveiller. */
const TON_ETAT: Record<IndicatorStatus, TonEtat> = { met: "ok", watch: "warn", missed: "danger", no_data: "neutral" };

function Indicateur({ i, c, permis }: { i: Indicator; c: Cockpit; permis: (href: string) => boolean }) {
  const lien = lienIndicateur(i, c);
  const lienListe = lien && permis(lien.href) ? lien : null;
  const horsSite = !i.site_scoped && c.filters.site_id !== null;
  const serie = i.series.flatMap((p) => (p.value === null ? [] : [p.value]));
  return (
    <Kpi
      label={i.label || INDICATEUR[i.code]}
      value={fmtIndicateur(i.value, i.unit)}
      tone={TON_ETAT[i.status] ?? "neutral"}
      serie={serie}
      hint={
        <>
          <span className="block">
            {i.target === null ? "Sans cible" : `Cible ${fmtCible(i.target, i.unit, i.direction)}`}
            {i.status === "watch" ? " · sous surveillance" : ""}
            {c.period.type === "month" && GLISSANTS.has(i.code) ? " · 12 mois glissants" : ""}
          </span>
          <span className="block">Source : {i.source}</span>
          {horsSite && <span className="block font-medium text-ink-2">Par société, sans filtre de site</span>}
          {i.value === null && <span className="block">Sans donnée sur la période</span>}
          {i.note && <span className="block">{i.note}</span>}
          {lienListe && (
            <Link href={lienListe.href} className={`${LIEN} mt-1`}>
              {lienListe.label} <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </>
      }
    />
  );
}
