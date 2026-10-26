"use client";

import { ErrorBox, Kpi, Squelette, cx, type Tone } from "@/components/ui";
import { fmtCible, fmtIndicateur } from "@/components/hsseq/commun";
import { requete } from "@/components/hsseq/actions/outils";
import { MOT_ETAT, etatIndicateur, moisLong } from "@/components/hsseq/cockpit/outils";
import { heureCk, jourCk } from "@/components/hsseq/trajets/outils";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtInt } from "@/lib/format";
import type { Cockpit, Indicator, IndicatorStatus } from "@/lib/hsseq-types";
import { aujourdhui, comptesEnClair, moisCourant } from "./outils";

/** Ton du chiffre clé : l'état servi par le noyau (conforme, sous surveillance, non conforme). */
const TON: Record<IndicatorStatus, Tone> = { met: "ok", watch: "warn", missed: "danger", no_data: "neutral" };

const capitale = (texte: string) => texte.charAt(0).toLocaleUpperCase("fr") + texte.slice(1);

/** « d'octobre 2026 », « de septembre 2026 ». */
const duMois = (mois: string) => {
  const nom = moisLong(mois);
  return /^[aeiouéh]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
};

/** « aujourd'hui », « hier », « il y a 12 jours » (jours de Conakry). */
function depuis(iso: string): string {
  const jours = Math.round((Date.parse(`${aujourdhui()}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 864e5);
  return jours <= 0 ? "aujourd'hui" : jours === 1 ? "hier" : `il y a ${fmtInt(jours)} jours`;
}

/**
 * Série du rapport aux voyages pour la gravure, à partir du premier mois qui compte une violation : les
 * mois d'avant le premier import comptent zéro sans rien dire de la conduite.
 */
function serie(i: Indicator): number[] {
  const valeurs = i.series.map((p) => p.value);
  const debut = valeurs.findIndex((v) => v !== null && v > 0);
  return debut < 0 ? [] : valeurs.slice(debut).filter((v): v is number => v !== null);
}

/**
 * Situation du mois en tête de la télématique, lue au cockpit (GET /hsseq/cockpit) : seul le cockpit
 * rapporte les violations aux voyages (départs du mois). Violations pour 100 voyages (valeur, cible et
 * état servis par le noyau, série en gravure), violations du mois par type, dernier import. Elle suit le
 * mois et le site des filtres, pas le type, le véhicule ni le conducteur ; bornée aux sites du compte,
 * comme le cockpit.
 */
export function Situation({ mois, site }: { mois: string; site: number | null }) {
  const { data, error, mutate } = useApi<Cockpit>(`/hsseq/cockpit?${requete({ month: mois, site_id: site })}`, { keepPreviousData: true });
  if (!data) {
    if (error) return <ErrorBox error={error} onRetry={() => void mutate()} titre="Situation du mois indisponible" />;
    return (
      <div aria-hidden className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Squelette key={i} className={cx("h-[132px]", i === 0 && "col-span-2 lg:col-span-1")} />
        ))}
      </div>
    );
  }
  const i = data.indicators.find((x) => x.code === "telematics_violations");
  const t = data.telematics;
  const enCours = mois === moisCourant();
  const nomSite = site ? data.referentials.sites.find((s) => s.id === site)?.name : null;
  const rapport = !i ? "Indicateur non servi par le cockpit." : i.value === null ? `${capitale(moisLong(mois))}${INSECABLE}: aucun départ, pas de rapport.` : `${capitale(moisLong(mois))}, cible ${fmtCible(i.target, i.unit, i.direction)}${INSECABLE}: ${MOT_ETAT[etatIndicateur(i)].toLocaleLowerCase("fr")}`;
  return (
    <section aria-label={`Situation ${duMois(mois)}`} className="space-y-2">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 max-sm:[&_.kpi]:px-3.5 max-sm:[&_.kpi_.font-display]:text-[22px]">
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <Kpi label="Violations pour 100 voyages" value={i ? fmtIndicateur(i.value, i.unit) : "–"} tone={i ? TON[i.status] : "neutral"} hint={rapport} serie={i ? serie(i) : undefined} />
        </div>
        <Kpi
          label={enCours ? "Violations du mois, à ce jour" : "Violations du mois"}
          value={t ? fmtInt(t.violations) : "–"}
          hint={t ? capitale(comptesEnClair(t.by_type) || "aucune violation importée") : undefined}
        />
        <Kpi
          label="Dernier import"
          value={t?.last_import_at ? jourCk(t.last_import_at) : "Aucun"}
          hint={t?.last_import_at ? `À ${heureCk(t.last_import_at)}, ${depuis(t.last_import_at)}` : "Les violations arrivent par l'import des fichiers des boîtiers."}
        />
      </div>
      <p className="text-[12.5px] leading-snug text-muted">
        Situation {duMois(mois)}
        {nomSite ? `, ${nomSite}` : ""}, lue au cockpit&nbsp;: voyages partis dans le mois, violations importées. Elle suit la période et le site choisis, pas les autres filtres.
        {error ? ` Elle n'a pas pu être relue${INSECABLE}: chiffres du dernier chargement.` : ""}
      </p>
    </section>
  );
}
