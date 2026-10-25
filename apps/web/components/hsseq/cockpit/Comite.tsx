"use client";

import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";
import { Badge, Card, Notice, Repartition, cx } from "@/components/ui";
import { INDICATEUR, fmtCible, fmtIndicateur } from "@/components/hsseq/commun";
import { ETATS } from "@/lib/couleurs";
import { MONTHS_FR, fmtDate, pluriel } from "@/lib/format";
import type { Cockpit, Indicator } from "@/lib/hsseq-types";
import { LIEN } from "./ATraiter";
import {
  MOT_ETAT,
  PROACTIFS,
  REACTIFS,
  etatIndicateur,
  fmtCase,
  fmtPrevu,
  indicateursMontres,
  lienIndicateur,
  liens,
  moisComite,
  moisEnEcart,
  prevuMois,
  realiseMois,
  reference,
  tient,
  tonEtatIndicateur,
  unite,
  type EtatIndicateur,
} from "./outils";

interface Ligne {
  i: Indicator;
  ref: string;
  etat: EtatIndicateur;
  ecarts: string[];
}

/** Ordre de lecture des états : ce qui demande une décision d'abord. */
const ORDRE: EtatIndicateur[] = ["non_conforme", "surveillance", "conforme", "sans_donnee"];

const COULEUR_ETAT: Record<EtatIndicateur, string> = {
  conforme: ETATS.bon,
  surveillance: ETATS.attention,
  non_conforme: ETATS.alerte,
  sans_donnee: ETATS.neutre,
};

/** « oct. », « janv. » : nom abrégé d'un mois « AAAA-MM ». */
const moisCourt = (m: string) => MONTHS_FR[Number(m.slice(5, 7)) - 1] ?? m;

/** « mars, avr. et juin » : liste de mois abrégés, avec l'année quand elle change. */
function listeMois(mois: string[]): string {
  const annees = new Set(mois.map((m) => m.slice(0, 4)));
  const noms = mois.map((m) => (annees.size > 1 ? `${moisCourt(m)} ${m.slice(0, 4)}` : moisCourt(m)));
  return noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : (noms[0] ?? "");
}

/**
 * Comité mensuel HSSEQ, au format des donneurs d'ordre : santé globale des indicateurs (conformes,
 * sous surveillance, non conformes), points d'attention, puis indicateurs proactifs et réactifs,
 * prévu contre réalisé par mois, avec l'état de chacun. Tout vient de GET /hsseq/cockpit.
 */
export function ComiteMensuel({ c }: { c: Cockpit }) {
  const mois = moisComite(c);
  const lignes: Ligne[] = indicateursMontres(c).map((i) => ({ i, ref: reference(i.code), etat: etatIndicateur(i, mois, c.period.type), ecarts: moisEnEcart(i, mois, c.period.type) }));
  const parFamille = (codes: readonly string[]) => lignes.filter((l) => codes.includes(l.i.code)).sort((a, b) => codes.indexOf(a.i.code) - codes.indexOf(b.i.code));
  const compte = (e: EtatIndicateur) => lignes.filter((l) => l.etat === e).length;
  const attention = lignes.filter((l) => l.etat === "non_conforme" || l.etat === "surveillance").sort((a, b) => ORDRE.indexOf(a.etat) - ORDRE.indexOf(b.etat));
  const premier = mois[0];
  const dernier = mois[mois.length - 1];
  return (
    <Card
      title="Comité mensuel"
      actions={
        <Link href={liens.actions(c.filters, { origine: "review", statut: "toutes" })} className={LIEN}>
          Actions décidées en revue de direction <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <p className="max-w-[90ch] text-[13.5px] leading-relaxed text-ink-2">
        Synthèse de {c.period.type === "12m" ? `${c.period.label}, 12 mois glissants` : `${c.period.label}, avec les mois de l'année`} : prévu contre réalisé
        {premier && dernier && premier !== dernier ? ` de ${moisCourt(premier)} ${premier.slice(0, 4)} à ${moisCourt(dernier)} ${dernier.slice(0, 4)}` : ""}.{" "}
        {c.period.frozen && c.period.frozen_on ? `Mois figé le ${fmtDate(c.period.frozen_on)}.` : "Chiffres du mois provisoires : ils se figent le 5 du mois suivant."}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section aria-labelledby="comite-sante" className="xl:col-span-5">
          <h3 id="comite-sante" className="text-[15px] font-semibold text-ink">
            1. Santé globale des indicateurs
          </h3>
          <p className="mb-4 mt-1 text-[13px] text-muted">
            {compte("conforme")} sur {pluriel(lignes.length, "indicateur suivi", "indicateurs suivis")} {compte("conforme") > 1 ? "conformes" : "conforme"}.
          </p>
          <Repartition parts={ORDRE.map((e) => ({ key: e, label: MOT_ETAT[e], value: compte(e), color: COULEUR_ETAT[e] }))} format={(v) => pluriel(v, "indicateur")} />
          <p className="mt-3 text-[12px] leading-snug text-muted">
            Conforme : cible tenue sur la période et chaque mois affiché. Sous surveillance : cible tenue sur la période, manquée sur au moins un mois. Non conforme : cible manquée sur la période.
          </p>
        </section>

        <section aria-labelledby="comite-attention" className="xl:col-span-7">
          <h3 id="comite-attention" className="text-[15px] font-semibold text-ink">
            2. Points d&apos;attention à discuter
          </h3>
          {attention.length === 0 ? (
            <div className="mt-3">
              <Notice tone="ok">Tous les indicateurs suivis tiennent leur cible sur la période et sur chaque mois affiché.</Notice>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-line/80">
              {attention.map((l) => (
                <PointAttention key={l.i.code} l={l} c={c} nbMois={mois.length} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <TableFamille titre="3. Indicateurs proactifs" sousTitre="Ce que l'on fait pour prévenir : contrôles, alcootests, déclaration, actions, habilitations." id="comite-proactifs" lignes={parFamille(PROACTIFS)} mois={mois} c={c} />
      <TableFamille titre="4. Indicateurs réactifs" sousTitre="Ce que l'on constate : accidents, gravité, positifs, dérogations, consommation, écarts de produit." id="comite-reactifs" lignes={parFamille(REACTIFS)} mois={mois} c={c} />

      <details className="group mt-6 border-t border-line pt-4">
        <summary className="cursor-pointer text-[13px] font-semibold text-accent outline-offset-2">Définitions, formules et sources</summary>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-[12.5px] leading-snug sm:grid-cols-2">
          {[...parFamille(PROACTIFS), ...parFamille(REACTIFS)].map(({ i, ref }) => (
            <div key={i.code}>
              <dt className="font-semibold text-ink">
                <span className="font-mono text-muted">{ref}</span> {i.label || INDICATEUR[i.code]}
              </dt>
              <dd className="mt-0.5 text-ink-2">
                {i.formula}. Source : {i.source}.{i.note ? ` ${i.note}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
  );
}

function PointAttention({ l, c, nbMois }: { l: Ligne; c: Cockpit; nbMois: number }) {
  const { i } = l;
  const lienListe = lienIndicateur(i, c);
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[13.5px] font-medium text-ink">
          <span className="mr-1.5 font-mono text-[12px] text-muted">{l.ref}</span>
          {i.label || INDICATEUR[i.code]}
        </p>
        <Badge tone={tonEtatIndicateur(l.etat)}>{MOT_ETAT[l.etat]}</Badge>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-muted">
        {l.etat === "non_conforme" ? `Réalisé ${fmtIndicateur(i.value, i.unit)} pour une cible ${fmtCible(i.target, i.unit, i.direction)} sur la période` : `Cible tenue sur la période (${fmtIndicateur(i.value, i.unit)})`}
        {l.ecarts.length > 0 ? ` ; écart sur ${l.ecarts.length} mois sur ${nbMois} : ${listeMois(l.ecarts)}.` : "."}
      </p>
      {lienListe && (
        <Link href={lienListe.href} className={cx(LIEN, "mt-1")}>
          {lienListe.label} <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </li>
  );
}

/** Repère d'écart dans une case : un losange, la forme de l'alerte (le sceau des chiffres clés). */
function Ecart() {
  return (
    <>
      <svg viewBox="0 0 8 8" aria-hidden focusable="false" className="mr-1 inline-block h-[7px] w-[7px] align-[1px]">
        <path d="M4 0 8 4 4 8 0 4Z" fill="currentColor" />
      </svg>
      <span className="sr-only">écart : </span>
    </>
  );
}

function TableFamille({ titre, sousTitre, id, lignes, mois, c }: { titre: string; sousTitre: string; id: string; lignes: Ligne[]; mois: string[]; c: Cockpit }) {
  const annees = new Set(mois.map((m) => m.slice(0, 4)));
  return (
    <section aria-labelledby={id} className="mt-7">
      <h3 id={id} className="text-[15px] font-semibold text-ink">
        {titre}
      </h3>
      <p className="mt-1 text-[13px] text-muted">{sousTitre}</p>
      {lignes.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Aucun indicateur de cette famille pour ce filtre.</p>
      ) : (
        <div role="region" aria-label={`Tableau : ${titre.replace(/^\d+\.\s*/, "")}`} tabIndex={0} className="mt-3 overflow-x-auto rounded-xl border border-line outline-offset-2">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <caption className="sr-only">
              {titre} : prévu par mois, réalisé de chaque mois, réalisé de la période et état. Une case marquée d&apos;un losange manque le prévu.
            </caption>
            <thead>
              <tr className="border-b border-line bg-panel-2 text-[12px] font-semibold text-muted">
                <th scope="col" className="px-3 py-2 pl-4 text-left">
                  Réf.
                </th>
                <th scope="col" className="px-3 py-2 text-left">
                  Indicateur
                </th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">
                  Prévu par mois
                </th>
                {mois.map((m) => {
                  const courant = m === c.period.month;
                  return (
                    <th key={m} scope="col" className={cx("whitespace-nowrap px-2 py-2 text-right", courant && "bg-accent-doux/60 text-ink")}>
                      <span className="block">{moisCourt(m)}</span>
                      <span className="block text-[10.5px] font-medium text-muted">{courant && !c.period.frozen ? "provisoire" : annees.size > 1 ? m.slice(0, 4) : ""}</span>
                    </th>
                  );
                })}
                <th scope="col" className="whitespace-nowrap border-l border-line px-3 py-2 text-right">
                  Période
                </th>
                <th scope="col" className="px-3 py-2 pr-4 text-left">
                  État
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {lignes.map(({ i, ref, etat }) => {
                const prevu = prevuMois(i, c.period.type);
                return (
                  <tr key={i.code} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2.5 pl-4 font-mono text-[12px] text-muted">{ref}</td>
                    <th scope="row" className="px-3 py-2.5 text-left font-medium text-ink">
                      {i.label || INDICATEUR[i.code]}
                      <span className="block text-[11.5px] font-normal text-muted">{unite(i)}</span>
                    </th>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-ink-2">{fmtPrevu(prevu, i.unit, i.direction)}</td>
                    {mois.map((m) => {
                      const v = realiseMois(i, m);
                      const ecart = tient(v, prevu, i.direction) === false;
                      return (
                        <td key={m} className={cx("whitespace-nowrap px-2 py-2.5 text-right", m === c.period.month && "bg-accent-doux/30", ecart ? "font-semibold text-danger" : "text-ink")}>
                          {ecart && <Ecart />}
                          {fmtCase(v, i.unit)}
                        </td>
                      );
                    })}
                    <td className={cx("whitespace-nowrap border-l border-line px-3 py-2.5 text-right font-semibold", i.met === false ? "text-danger" : "text-ink")}>{fmtCase(i.value, i.unit)}</td>
                    <td className="px-3 py-2.5 pr-4">
                      <Badge tone={tonEtatIndicateur(etat)}>{MOT_ETAT[etat]}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
