"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Printer } from "@/components/icons";
import { Button, ErrorBox, Field, PageHeader, Segmented, Select, Squelette, cx } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Cockpit as DonneesCockpit, VehicleKind } from "@/lib/hsseq-types";
import { ATraiter } from "./ATraiter";
import { ComiteMensuel } from "./Comite";
import { BandeIndicateurs } from "./Indicateurs";
import { Derogations, MatriceEvenements } from "./Matrice";
import { EnvironnementTerrain } from "./EnvironnementTerrain";
import { RisquesConformite } from "./RisquesConformite";
import { aujourdhui, chaine, decalerMois, lireFiltres, moisLong, type Filtres } from "./outils";

/**
 * Cockpit de NIMOVA · HSSEQ (§3, §10), écran du Responsable HSSEQ et du dirigeant : il se lit en dix
 * secondes. En tête, les filtres (période, société, site, profil), portés par l'adresse de la page.
 * Puis ce qui est à traiter (départs bloqués du jour, actions en retard, échéances à 30 jours), les
 * indicateurs, la situation des risques et de la conformité (lot 2), celle de l'environnement, des
 * urgences, des documents et de la télématique (lot 3), la synthèse du comité mensuel et la matrice
 * de criticité des événements.
 */
export function Cockpit() {
  const router = useRouter();
  const chemin = usePathname();
  const params = useSearchParams();
  const f = useMemo(() => lireFiltres(params), [params]);
  const { data, error, isLoading, mutate } = useApi<DonneesCockpit>(`/hsseq/cockpit${chaine({ period: f.period, month: f.month, company_id: f.company_id, site_id: f.site_id, vehicle_kind: f.vehicle_kind })}`);
  // Changer de filtre garde l'écran : les derniers chiffres reçus restent, pâlis, jusqu'au nouveau calcul.
  const [dernier, setDernier] = useState<DonneesCockpit | null>(null);
  if (data && dernier !== data) setDernier(data);
  const c = data ?? dernier ?? undefined;
  const recalcul = !data && Boolean(dernier) && isLoading;
  const echec = !data && Boolean(dernier) && Boolean(error) && !isLoading;

  const changer = useCallback(
    (modif: Partial<Filtres>) => {
      const n = { ...f, ...modif };
      router.replace(`${chemin}${chaine({ period: n.period === "12m" ? "12m" : null, month: n.month, company_id: n.company_id, site_id: n.site_id, vehicle_kind: n.vehicle_kind })}`, { scroll: false });
    },
    [f, chemin, router],
  );

  return (
    <div>
      <PageHeader
        title="Cockpit HSSEQ"
        subtitle={
          c
            ? `${c.period.type === "12m" ? `12 mois glissants, ${c.period.label}` : `Mois de ${c.period.label}`}, du ${fmtDate(c.period.date_from)} au ${fmtDate(c.period.date_to)}. ${c.period.frozen && c.period.frozen_on ? `Mois figé le ${fmtDate(c.period.frozen_on)}.` : "Chiffres provisoires jusqu'au 5 du mois suivant."} Calcul du ${fmtDateTime(c.computed_at)}.`
            : "Indicateurs du mois et sur 12 mois glissants, calculés chaque jour depuis les données d'origine."
        }
        actions={
          <>
            <span role="status" className={cx("inline-flex items-center gap-2 text-[12.5px] font-medium text-muted", !recalcul && "sr-only")}>
              {recalcul && (
                <>
                  <span aria-hidden className="n-tourne h-3.5 w-3.5 rounded-full border-2 border-accent-vif/25 border-t-accent-vif" />
                  Recalcul…
                </>
              )}
            </span>
            <Button className="max-sm:hidden" onClick={() => window.print()} disabled={!c}>
              <Printer className="h-4 w-4" /> Imprimer
            </Button>
          </>
        }
      />
      <BarreFiltres f={f} c={c} onChange={changer} />
      {error && (
        <div className={cx(c && "mb-5")}>
          <ErrorBox error={error} onRetry={() => mutate()} titre={echec ? "Chiffres des filtres précédents : le calcul avec les nouveaux filtres a échoué." : undefined} />
        </div>
      )}
      {!c && isLoading && <Attente />}
      {c && (
        // Recalcul : le corps pâlit. Échec : les chiffres précédents restent lisibles, en grisaille.
        <div aria-busy={recalcul || undefined} className={cx("space-y-8 transition-[opacity,filter] duration-150 motion-reduce:transition-none", recalcul && "pointer-events-none opacity-60", echec && "grayscale")}>
          <ATraiter c={c} />
          <BandeIndicateurs c={c} />
          <RisquesConformite c={c} />
          <EnvironnementTerrain c={c} />
          <ComiteMensuel c={c} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="min-w-0 xl:col-span-7">
              <MatriceEvenements c={c} />
            </div>
            <div className="min-w-0 xl:col-span-5">
              <Derogations c={c} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Profil = "tous" | VehicleKind;

/** Filtres du cockpit : période (mois ou 12 mois glissants, et son mois), société, site, profil. */
function BarreFiltres({ f, c, onChange }: { f: Filtres; c: DonneesCockpit | undefined; onChange: (modif: Partial<Filtres>) => void }) {
  const courant = aujourdhui().slice(0, 7);
  const mois = Array.from({ length: 24 }, (_, k) => decalerMois(courant, -k));
  const choisi = f.month ?? c?.period.month ?? courant;
  if (!mois.includes(choisi)) mois.push(choisi);
  const societes = c?.referentials.companies ?? [];
  const sites = c?.referentials.sites ?? [];
  const filtre = f.period !== "month" || f.month !== null || f.company_id !== null || f.site_id !== null || f.vehicle_kind !== null;
  return (
    <div role="group" aria-label="Filtres du cockpit" className="no-print mb-7 flex flex-wrap items-end gap-x-5 gap-y-3">
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Période</span>
        <Segmented
          label="Période"
          options={[
            { key: "month", label: "Mois" },
            { key: "12m", label: "12 mois glissants" },
          ]}
          value={f.period}
          onChange={(period) => onChange({ period })}
        />
      </div>
      <Field label={f.period === "12m" ? "Jusqu'au mois de" : "Mois"} className="w-48">
        <Select value={choisi} onChange={(e) => onChange({ month: e.target.value === courant ? null : e.target.value })} options={mois.map((m) => ({ value: m, label: m === courant ? `${moisLong(m)} (en cours)` : moisLong(m) }))} />
      </Field>
      {societes.length > 1 && (
        <Field label="Société" className="w-60">
          <Select value={f.company_id ?? ""} onChange={(e) => onChange({ company_id: e.target.value ? Number(e.target.value) : null })} placeholder="Toutes les sociétés" options={societes.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
      )}
      <Field label="Site" className="w-52">
        <Select value={f.site_id ?? ""} onChange={(e) => onChange({ site_id: e.target.value ? Number(e.target.value) : null })} placeholder="Tous les sites" options={sites.map((s) => ({ value: s.id, label: s.name }))} disabled={!c && sites.length === 0} />
      </Field>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Profil</span>
        <Segmented<Profil>
          label="Profil de véhicule"
          options={[
            { key: "tous", label: "Tous" },
            { key: "tanker", label: "Citerne" },
            { key: "tipper", label: "Benne" },
          ]}
          value={f.vehicle_kind ?? "tous"}
          onChange={(k) => onChange({ vehicle_kind: k === "tous" ? null : k })}
        />
      </div>
      {filtre && (
        <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => onChange({ period: "month", month: null, company_id: null, site_id: null, vehicle_kind: null })}>
          Effacer les filtres
        </Button>
      )}
    </div>
  );
}

/** Squelette du cockpit pendant le premier calcul. */
function Attente() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Calcul du cockpit…</span>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Squelette key={i} className="h-[58px]" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Squelette key={i} className="h-[300px]" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Squelette key={i} className="h-[150px]" />
        ))}
      </div>
    </div>
  );
}
