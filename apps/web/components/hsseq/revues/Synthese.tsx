"use client";

/**
 * Synthèse de la revue de direction : la prochaine revue (la plus proche des revues préparées), la
 * dernière revue tenue avec l'état des actions nées de ses décisions (plan d'actions filtré par
 * review_id), et les décisions encore en cours de mise en œuvre, toutes revues confondues (actions
 * d'origine « revue » ni closes ni annulées). En tête de l'écran des revues, et dans l'onglet « Revue de
 * direction » de l'écran « Audits et conformité ». Chaque bloc mène à sa fiche ou à sa liste.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { FEUILLE, Squelette, cx } from "@/components/ui";
import { useApi, useAutorise } from "@/lib/api-client";
import { INSECABLE, fmtInt, pluriel } from "@/lib/format";
import type { ActionCounts, ActionLine, Page } from "@/lib/hsseq-types";
import { ETAT_REVUE, dateLongue, echeanceRelative, lienRevue, periodeRevue, revueEnRetard, useActionsRevue } from "./outils";
import type { ReviewCounts, ReviewLine } from "./types";

/** Bloc de la synthèse : un lien quand il mène quelque part, sinon une feuille simple. */
function Bloc({ href, titre, children }: { href?: string; titre: string; children: ReactNode }) {
  const classes = cx(FEUILLE, "flex h-full min-w-0 flex-col gap-1.5 px-5 py-4");
  const contenu = (
    <>
      <span className="text-[13px] font-medium text-ink-2">{titre}</span>
      {children}
    </>
  );
  return href ? (
    <Link href={href} className={cx(classes, "outline-offset-2 transition-shadow hover:shadow-[var(--ombre-flottante)]")}>
      {contenu}
    </Link>
  ) : (
    <div className={classes}>{contenu}</div>
  );
}

const GRAND = "font-display text-[20px] font-[650] leading-tight tracking-[-0.015em]";

/**
 * Profils qui lisent les actions des revues au plan d'actions : ceux qui lisent tout le plan (READ_ALL du
 * noyau), et l'auditeur, qui y lit les actions des revues des sociétés de son compte (sans site) tant que
 * son accès court.
 */
const LECTURE_PLAN = ["admin", "direction", "hsseq", "auditeur"] as const;

export function SyntheseRevues() {
  const planComplet = useAutorise(LECTURE_PLAN);
  const { data: prochaines, error: e1 } = useApi<Page<ReviewLine, ReviewCounts>>("/hsseq/reviews?state=prepared&sort=planned_date&limit=1");
  const { data: tenues, error: e2 } = useApi<Page<ReviewLine, ReviewCounts>>("/hsseq/reviews?state=held,closed&sort=-planned_date&limit=1");
  const { data: actions, error: e3 } = useApi<Page<ActionLine, ActionCounts>>(planComplet ? "/hsseq/actions?origin=review&limit=1" : null);
  const derniere = tenues?.items[0];
  const suite = useActionsRevue(planComplet ? (derniere?.id ?? null) : null);

  // Revues refusées au compte : la liste qui suit dit le refus ; la synthèse s'efface.
  if (e1 || e2) return null;
  if (!prochaines || !tenues || (planComplet && !actions && !e3)) {
    return (
      <div aria-hidden className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Squelette key={i} className="h-[112px]" />
        ))}
      </div>
    );
  }

  const prochaine = prochaines.items[0];
  const s = actions?.counts.by_status;
  const ouvertes = s ? s.todo + s.in_progress + s.to_verify : null;
  const retard = actions?.counts.overdue ?? 0;

  return (
    <section aria-label="Synthèse de la revue de direction" className={cx("grid grid-cols-1 gap-3", planComplet ? "md:grid-cols-3" : "md:grid-cols-2")}>
      <Bloc titre="Prochaine revue" href={prochaine ? lienRevue(prochaine.id) : undefined}>
        {prochaine ? (
          <>
            <span className={cx(GRAND, "text-ink")}>{dateLongue(prochaine.planned_date)}</span>
            <span className={cx("text-[12.5px] leading-snug", revueEnRetard(prochaine) ? "font-semibold text-danger" : "text-muted")}>
              {`${prochaine.reference}, date prévue ${echeanceRelative(prochaine.planned_date)}${revueEnRetard(prochaine) ? `${INSECABLE}: la revue n'est pas encore déclarée tenue` : ""}`}
            </span>
            <span className="text-[12.5px] leading-snug text-muted">{`Période${INSECABLE}: ${periodeRevue(prochaine.period.from, prochaine.period.to)}`}</span>
          </>
        ) : (
          <>
            <span className={cx(GRAND, "text-muted")}>Aucune revue préparée</span>
            <span className="text-[12.5px] leading-snug text-muted">La direction ou le Responsable HSSEQ prépare la suivante&nbsp;; NIMOVA en rassemble les éléments d&apos;entrée.</span>
          </>
        )}
      </Bloc>

      <Bloc titre="Dernière revue tenue" href={derniere ? lienRevue(derniere.id) : undefined}>
        {derniere ? (
          <>
            <span className={cx(GRAND, "text-ink")}>{dateLongue(derniere.held_on ?? derniere.planned_date)}</span>
            <span className={cx("text-[12.5px] leading-snug", derniere.state === "held" ? "font-semibold text-warn" : "text-muted")}>
              {`${derniere.reference}, ${derniere.state === "held" ? "tenue, à clore" : ETAT_REVUE[derniere.state].toLocaleLowerCase("fr")}`}
            </span>
            <span className="text-[12.5px] leading-snug text-muted">
              {derniere.decisions_count ? pluriel(derniere.decisions_count, "décision") : "Aucune décision"}
              {/* Actions ouvertes : le compte de la revue (complet) ; leurs retards : le plan d'actions filtré par revue. */}
              {derniere.open_actions ? `, ${pluriel(derniere.open_actions, "action encore ouverte", "actions encore ouvertes")}` : ""}
              {derniere.open_actions && suite.retard ? <span className="font-semibold text-danger">{` dont ${pluriel(suite.retard, "en retard", "en retard")}`}</span> : null}
            </span>
          </>
        ) : (
          <>
            <span className={cx(GRAND, "text-muted")}>Aucune revue tenue</span>
            <span className="text-[12.5px] leading-snug text-muted">La première revue tenue dans NIMOVA apparaîtra ici.</span>
          </>
        )}
      </Bloc>

      {planComplet && (
        <Bloc titre="Décisions en cours de mise en œuvre" href="/hsseq/actions?origine=review">
          <span className={cx(GRAND, ouvertes ? "text-ink" : "text-muted")}>
            <span className="tabular">{fmtInt(ouvertes)}</span> {(ouvertes ?? 0) > 1 ? "actions ouvertes" : "action ouverte"}
          </span>
          <span className={cx("text-[12.5px] leading-snug", retard ? "font-semibold text-danger" : "text-muted")}>{retard ? `dont ${pluriel(retard, "en retard", "en retard")}` : "Aucune en retard"}</span>
          <span className="text-[12.5px] leading-snug text-muted">Actions du plan décidées en revue de direction, suivies jusqu&apos;à leur preuve.</span>
        </Bloc>
      )}
    </section>
  );
}
