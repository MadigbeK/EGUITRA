"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "@/components/icons";
import { Badge, Card, DataTable, Etat, classesBouton, cx } from "@/components/ui";
import { useCabinet } from "@/components/axispro/dossier/commun";
import { usePilotage, useReference, type FiltrePilotage } from "@/lib/axispro-api";
import { MANDAT, classificationDe, nomPromoteur, noteRelance, suiviDe } from "@/lib/axispro-parcours";
import { fmtDate, fmtFixe, fmtInt } from "@/lib/format";
import { FiltresPastilles, GRILLE_TUILES, PastilleKo, Surtitre, TITRE_ECRAN, TuileChiffre, intituleDe } from "./commun";

const FILTRES = [
  { key: "tous", label: "Tous" },
  { key: "relance", label: "À relancer" },
  { key: "bloques", label: "Bloqués" },
  { key: "apd", label: "APD Ready ou plus" },
] as const;
type Filtre = (typeof FILTRES)[number]["key"];

/**
 * Portefeuille (EC-02) : tous les projets et leur situation, N° décroissant, projets clos compris. Le filtre
 * actif reste dans l'adresse (?filtre=relance) et le noyau restreint les lignes ; le tableau défile dans son
 * cadre sur téléphone, jamais la page.
 */
export function PortefeuilleProjets() {
  const router = useRouter();
  const chemin = usePathname();
  const lu = useSearchParams().get("filtre");
  const filtre: Filtre = FILTRES.some((f) => f.key === lu) ? (lu as Filtre) : "tous";
  const { data, error, mutate } = usePilotage(filtre === "tous" ? undefined : (filtre as FiltrePilotage));
  const { data: reference } = useReference();
  const { cabinet } = useCabinet();
  function choisir(f: Filtre) {
    router.replace(f === "tous" ? chemin : `${chemin}?filtre=${f}`, { scroll: false });
  }
  const c = data?.counters;
  const chiffre = (n: number | undefined) => (n === undefined ? "–" : fmtInt(n));
  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Surtitre>{MANDAT}</Surtitre>
          <h1 className={cx(TITRE_ECRAN, "mt-2")}>Projets en évaluation</h1>
        </div>
        {cabinet && (
          <Link href="/axispro/nouveau" className={cx(classesBouton("primary"), "no-print")}>
            <Plus aria-hidden className="h-4 w-4" /> Nouveau projet
          </Link>
        )}
      </header>
      <div className={cx(GRILLE_TUILES, "mb-4")}>
        <TuileChiffre label="Projets suivis" valeur={chiffre(c?.projects)} />
        <TuileChiffre label="Promoteurs à relancer" valeur={chiffre(c?.to_chase)} ton={c?.to_chase ? "warn" : "neutral"} />
        <TuileChiffre label="Bloqués par un knock-out" valeur={chiffre(c?.blocked)} ton={c?.blocked ? "danger" : "neutral"} />
        <TuileChiffre label="APD Ready ou plus" valeur={chiffre(c?.apd_ready_plus)} ton={c?.apd_ready_plus ? "ok" : "neutral"} />
      </div>
      <div className="no-print mb-4">
        <FiltresPastilles label="Filtre du portefeuille" options={[...FILTRES]} value={filtre} onChange={choisir} />
      </div>
      <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement du portefeuille…">
        <Card padded={false}>
          <DataTable
            rows={data?.rows ?? []}
            rowKey={(d) => d.id}
            empty={filtre === "tous" ? "Aucun projet pour le moment" : "Aucun projet pour ce filtre."}
            onRowClick={(d) => router.push(`/axispro/dossiers/${d.id}/fiche`)}
            columns={[
              { key: "reference", label: "N° MBAP", render: (d) => <span className="whitespace-nowrap font-mono text-[12.5px]">{d.reference}</span> },
              {
                key: "name",
                label: "Projet / promoteur",
                sortValue: (d) => d.name ?? "",
                render: (d) => (
                  <div className="min-w-[220px] max-w-[320px]">
                    <div className="font-semibold text-ink">{intituleDe(d)}</div>
                    {nomPromoteur(d) && <div className="mt-0.5 text-[12.5px] text-muted">{nomPromoteur(d)}</div>}
                  </div>
                ),
              },
              { key: "gate", label: "Gate", sortValue: (d) => d.gate.index, render: (d) => <span className="whitespace-nowrap">{d.gate.index} · {d.gate.name}</span> },
              { key: "readiness", label: "Readiness", align: "right", sortValue: (d) => d.readiness, render: (d) => <b className="font-semibold">{fmtFixe(d.readiness, 1)}</b> },
              { key: "knockouts", label: "KO actifs", align: "center", sortValue: (d) => d.knockouts, render: (d) => <PastilleKo n={d.knockouts} /> },
              {
                key: "classification",
                label: "Classification",
                render: (d) => {
                  const x = classificationDe(d);
                  return <Badge tone={x.ton}>{x.label}</Badge>;
                },
              },
              { key: "pieces", label: "Pièces", align: "right", sortValue: (d) => d.pieces, render: (d) => fmtInt(d.pieces) },
              {
                key: "echeance",
                label: "Prochaine échéance",
                sortValue: (d) => d.next_due,
                render: (d) => (d.next_due ? <span className={cx("whitespace-nowrap", d.next_due_overdue && "font-semibold text-danger")}>{fmtDate(d.next_due)}</span> : <span className="text-muted">–</span>),
              },
              {
                key: "suivi",
                label: "Suivi promoteur",
                sortValue: (d) => (suiviDe(d.followup, d.state).aRelancer ? 0 : 1),
                render: (d) => {
                  const s = suiviDe(d.followup, d.state);
                  return <Badge tone={s.ton}>{s.label}</Badge>;
                },
              },
            ]}
          />
        </Card>
      </Etat>
      <p className="mt-4 text-[13px] leading-relaxed text-muted">{noteRelance(reference?.relance_days)}</p>
      <p className="no-print mt-1 text-[13px] leading-relaxed text-muted">
        Vue en colonnes : <Link href="/axispro/dossiers" className="inline-flex min-h-[42px] items-center font-semibold text-accent hover:underline">vue du cabinet</Link>.
      </p>
    </div>
  );
}
