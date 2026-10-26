"use client";

import { Lock } from "@/components/icons";
import { MOTIFS, Tampon } from "@/components/hsseq/commun";
import { fmtDate } from "@/lib/format";
import type { Fitness } from "@/lib/hsseq-types";
import { APTITUDE, APTITUDE_DETAIL, ETAT_HABILITATION, Repere, delai } from "./outils";
import type { QualificationCell, QualificationRow, QualificationType } from "./types";

/**
 * Matrice des compétences : un conducteur par ligne (nom figé à gauche quand le tableau défile au
 * téléphone), une habilitation par colonne, puis l'aptitude en statut et le départ. Une case valide se
 * tait (sa date seule) ; à renouveler, échue ou absente, elle porte son repère, son mot et sa couleur.
 */
export function Matrice({ lignes, types }: { lignes: QualificationRow[]; types: QualificationType[] }) {
  return (
    <div role="region" aria-label="Matrice des compétences" tabIndex={0} className="overflow-x-auto outline-offset-2">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <caption className="sr-only">
          Matrice des compétences : une ligne par conducteur, une colonne par habilitation avec son état et son échéance, puis l&apos;aptitude médicale en statut et le droit au départ (motif V04).
        </caption>
        <thead>
          <tr className="border-y border-line bg-panel-2 text-[12px] font-semibold text-muted">
            <th scope="col" className="sticky left-0 z-[1] bg-panel-2 px-3 py-2.5 pl-5 text-left align-bottom">
              Conducteur
            </th>
            {types.map((t) => (
              <th key={t.code} scope="col" className="min-w-[7.75rem] px-3 py-2.5 text-left align-bottom">
                <span className="block leading-snug text-ink-2">{t.name}</span>
                {t.mandatory && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted" title="Obligatoire pour les conducteurs : échue, elle bloque le départ (V04)">
                    <Lock className="h-3 w-3" aria-hidden />
                    Obligatoire
                  </span>
                )}
              </th>
            ))}
            <th scope="col" className="min-w-[6.5rem] px-3 py-2.5 text-left align-bottom">
              <span className="block leading-snug text-ink-2">Aptitude médicale</span>
              <span className="mt-1 block text-[11px] font-medium text-muted">Statut seul</span>
            </th>
            <th scope="col" className="px-3 py-2.5 pr-5 text-left align-bottom">
              Départ
            </th>
          </tr>
        </thead>
        <tbody className="tabular">
          {lignes.map((r) => (
            <tr key={r.employee.id} className="border-b border-line/70 last:border-0">
              <th scope="row" className="sticky left-0 z-[1] max-w-[13rem] bg-panel px-3 py-2.5 pl-5 text-left align-top font-medium text-ink">
                <span className="block leading-snug">{r.employee.name}</span>
                <span className="block text-[12px] font-normal text-muted">{r.site?.name ?? "Sans ensemble attitré"}</span>
              </th>
              {types.map((t) => (
                <td key={t.code} className="px-3 py-2.5 align-top">
                  <Case c={r.qualifications.find((c) => c.code === t.code)} />
                </td>
              ))}
              <td className="px-3 py-2.5 align-top">
                <Aptitude f={r.fitness} />
              </td>
              <td className="px-3 py-2.5 pr-5 align-top">
                <Depart r={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Date d'obtention et d'échéance, en infobulle d'une case. */
function infobulle(c: QualificationCell): string {
  const obtenue = c.obtained_on ? `Obtenue le ${fmtDate(c.obtained_on)}` : "";
  const fin = c.expires_on ? `valable jusqu'au ${fmtDate(c.expires_on)}` : "sans échéance";
  return `${c.name} : ${ETAT_HABILITATION[c.status].toLocaleLowerCase("fr")}. ${obtenue ? `${obtenue}, ${fin}` : fin.charAt(0).toUpperCase() + fin.slice(1)}.`;
}

/** Case d'une habilitation : la date seule si elle est valide, le repère et le mot sinon. */
function Case({ c }: { c: QualificationCell | undefined }) {
  if (!c) return <span className="text-muted">–</span>;
  switch (c.status) {
    case "valid":
      return (
        <span title={infobulle(c)} className="whitespace-nowrap text-ink-2">
          {c.expires_on ? fmtDate(c.expires_on) : "Sans échéance"}
          <span className="sr-only">, valide</span>
        </span>
      );
    case "to_renew":
      return (
        <span title={infobulle(c)} className="block whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5 font-semibold text-warn">
            <Repere forme="triangle" />
            {fmtDate(c.expires_on)}
          </span>
          <span className="block text-[11.5px] text-muted">
            <span className="sr-only">à renouveler, </span>
            {delai(c.days_left)}
          </span>
        </span>
      );
    case "expired":
      return (
        <span title={infobulle(c)} className="block whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
            <Repere forme="losange" />
            Échue
          </span>
          <span className="block text-[11.5px] text-muted">{fmtDate(c.expires_on)}</span>
        </span>
      );
    case "missing":
      return c.mandatory ? (
        <span title={`${c.name} : absente. Obligatoire pour les conducteurs.`} className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-danger">
          <Repere forme="losange-vide" />
          Absente
        </span>
      ) : (
        <span title={`${c.name} : non détenue (facultative).`} className="text-muted">
          –<span className="sr-only">non détenue</span>
        </span>
      );
  }
}

/** Aptitude médicale en statut seul : jamais de motif ni de détail médical. */
function Aptitude({ f }: { f: Fitness }) {
  if (f === "fit") return <span className="text-ink-2">{APTITUDE.fit}</span>;
  const alerte = f === "unfit";
  return (
    <span title={APTITUDE_DETAIL[f]} className={alerte ? "inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-danger" : "inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-warn"}>
      <Repere forme={alerte ? "losange" : "triangle"} />
      {APTITUDE[f]}
    </span>
  );
}

/**
 * Départ au regard du motif V04 : bloqué (habilitation obligatoire échue, aptitude inapte ou échue,
 * habilitation obligatoire absente après la date des réglages), avertissement (obligatoire absente
 * avant cette date, aptitude à revoir), sinon autorisé, au trait.
 */
function Depart({ r }: { r: QualificationRow }) {
  if (r.blocking) {
    return (
      <span title={`Motif V04 : ${MOTIFS.V04.libelle}.`} className="inline-flex">
        <Tampon mot="Bloqué" />
        <span className="sr-only">{`, motif V04 : ${MOTIFS.V04.libelle}`}</span>
      </span>
    );
  }
  if (r.status === "missing" || r.fitness === "review") {
    const raison = r.status === "missing" ? "Habilitation obligatoire absente : avertissement jusqu'à la date fixée dans les réglages, puis départ refusé." : APTITUDE_DETAIL.review;
    return (
      <span title={raison} className="inline-flex">
        <Tampon mot="Avertissement" />
        <span className="sr-only">{`, ${raison}`}</span>
      </span>
    );
  }
  return <span className="text-[12.5px] text-muted">Autorisé</span>;
}

/** Légende de la matrice : formes, mots et effet sur le départ. */
export function Legende() {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-[12.5px] leading-snug text-ink-2 sm:grid-cols-2">
      <div className="flex gap-2">
        <dt className="flex-none text-muted">Date seule</dt>
        <dd className="m-0">Valide jusqu&apos;à cette date.</dd>
      </div>
      <div className="flex gap-2">
        <dt className="flex flex-none items-center gap-1.5 font-semibold text-warn">
          <Repere forme="triangle" />À renouveler
        </dt>
        <dd className="m-0">Échéance dans les 30 jours ; alertes à J-30 et J-7.</dd>
      </div>
      <div className="flex gap-2">
        <dt className="flex flex-none items-center gap-1.5 font-semibold text-danger">
          <Repere forme="losange" />
          Échue
        </dt>
        <dd className="m-0">Obligatoire, elle refuse le départ (V04) jusqu&apos;au renouvellement saisi dans RH.</dd>
      </div>
      <div className="flex gap-2">
        <dt className="flex flex-none items-center gap-1.5 font-semibold text-danger">
          <Repere forme="losange-vide" />
          Absente
        </dt>
        <dd className="m-0">Obligatoire et jamais délivrée : avertissement, puis départ refusé à partir de la date fixée dans les réglages.</dd>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <dt className="flex-none text-muted">Aptitude</dt>
        <dd className="m-0">Statut seul, sans détail médical : apte ; à revoir (apte avec réserve, ou non renseignée) ; non apte (inapte, ou visite échue : départ refusé).</dd>
      </div>
    </dl>
  );
}
