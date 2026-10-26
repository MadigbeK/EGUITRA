"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Notice, Repartition, Select, cx } from "@/components/ui";
import { STATUT_ACTION, Tampon } from "@/components/hsseq/commun";
import { requete } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import { ETATS } from "@/lib/couleurs";
import { fmtDate, fmtInt, fmtPct, pluriel } from "@/lib/format";
import type { ActionCounts, ActionLine, Page } from "@/lib/hsseq-types";
import { CLASSEMENT, ORDRE_CLASSEMENT, ORDRE_STATUT_EXIGENCE, STATUT_EXIGENCE, anneeCourante, lien, useRafraichir, type VueProps } from "./commun";
import { FenetreAction } from "./fenetres";
import type { AuditCounts, AuditLine, Finding, FindingCounts, Requirement, RequirementCounts, RequirementStatus } from "./types";

const LIEN = "inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline";

/** Repère de couleur de chaque statut d'exigence dans la répartition (le libellé le dit aussi). */
const COULEUR_EXIGENCE: Record<RequirementStatus, string> = { compliant: ETATS.bon, partial: ETATS.attention, non_compliant: ETATS.alerte, not_evaluated: ETATS.neutre };

/** Actions de la revue lues d'un coup : quelques dizaines par an au plus. */
const LIMITE = 100;

/** Ligne du registre des éléments d'entrée : libellé et précision à gauche, valeur à droite, lien vers le détail. */
function Entree({ titre, precision, valeur, href, libelle }: { titre: string; precision: ReactNode; valeur: ReactNode; href: string; libelle: string }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <dt className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">{titre}</span>
        <span className="mt-1 block text-[12.5px] leading-snug text-muted">{precision}</span>
        <Link href={href} className={cx(LIEN, "mt-1.5")}>
          {libelle} <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </dt>
      <dd className="m-0 font-display text-[24px] font-[650] leading-none tracking-[-0.02em] text-ink tabular sm:text-right">{valeur}</dd>
    </div>
  );
}

/**
 * Revue de direction : le noyau n'en tient pas de fiche (date, participants, décisions). L'onglet en
 * rassemble les éléments d'entrée servis par les registres (réalisation du programme d'audits, constats
 * ouverts, conformité aux exigences) et suit les actions qu'elle a décidées, d'origine « review » au plan
 * d'actions ; le Responsable HSSEQ y ajoute une décision.
 */
export function RevueDirection({ lire, ecrire, droits }: VueProps) {
  const router = useRouter();
  const rafraichir = useRafraichir();
  const courante = anneeCourante();
  const annee = /^\d{4}$/.test(lire("annee")) ? Number(lire("annee")) : courante;
  const [creer, setCreer] = useState(false);
  const [message, setMessage] = useState<ReactNode>(null);

  const { data: programme } = useApi<Page<AuditLine, AuditCounts>>(`/hsseq/audits?${requete({ year: annee, limit: 1 })}`, { keepPreviousData: true });
  const { data: constats } = useApi<Page<Finding, FindingCounts>>("/hsseq/findings?status=open&limit=1");
  const { data: exigences } = useApi<Page<Requirement, RequirementCounts>>("/hsseq/requirements?limit=1");
  const { data: echues } = useApi<Page<Requirement, RequirementCounts>>("/hsseq/requirements?review_overdue=1&limit=1");
  const { data: actions, error, mutate } = useApi<Page<ActionLine, ActionCounts>>(`/hsseq/actions?origin=review&sort=due_date&limit=${LIMITE}`);

  const p = programme?.counts;
  const o = constats?.counts.open_by_class;
  const e = exigences?.counts.by_status;
  const a = actions?.counts;
  const ouvertes = a ? a.by_status.todo + a.by_status.in_progress + a.by_status.to_verify : null;

  return (
    <div className="space-y-5">
      <p className="max-w-[90ch] text-[13.5px] leading-relaxed text-ink-2">
        Éléments d&apos;entrée de la revue de direction tirés du programme d&apos;audits, des constats et du registre des exigences, puis les actions qu&apos;elle a décidées, suivies au plan d&apos;actions.
      </p>

      <Card
        title="Éléments d'entrée"
        actions={
          <Select
            aria-label="Année du programme d'audits"
            className="w-28"
            value={String(annee)}
            onChange={(x) => ecrire({ annee: Number(x.target.value) === courante ? null : x.target.value })}
            options={[courante, courante - 1, courante - 2].map((y) => ({ value: y, label: String(y) }))}
          />
        }
      >
        <dl className="divide-y divide-line/80">
          <Entree
            titre={`Programme d'audits ${annee}`}
            precision={p ? (p.planned ? `${fmtInt(p.done)} sur ${pluriel(p.planned, "audit planifié", "audits planifiés")}, annulés exclus.` : "Aucun audit planifié.") : "Chargement…"}
            valeur={p?.completion_rate === null || p?.completion_rate === undefined ? "–" : fmtPct(p.completion_rate, 1)}
            href={lien("programme", { annee: annee === courante ? null : annee })}
            libelle="Programme d'audits"
          />
          <Entree
            titre="Constats d'audit ouverts"
            precision={o ? ORDRE_CLASSEMENT.map((c) => pluriel(o[c], CLASSEMENT[c].label.toLocaleLowerCase("fr"), c === "observation" ? "observations" : `écarts ${CLASSEMENT[c].plusieurs}`)).join(", ") : "Chargement…"}
            valeur={constats ? fmtInt(constats.total_count) : "–"}
            href={lien("constats")}
            libelle="Constats"
          />
          <Entree
            titre="Conformité aux exigences"
            precision={
              e && exigences ? (
                <span className="block space-y-2">
                  <Repartition parts={ORDRE_STATUT_EXIGENCE.map((s) => ({ key: s, label: STATUT_EXIGENCE[s], value: e[s], color: COULEUR_EXIGENCE[s] }))} format={(v) => pluriel(v, "exigence")} />
                  {echues && echues.total_count > 0 && <span className="block font-semibold text-danger">{pluriel(echues.total_count, "revue en retard", "revues en retard")}</span>}
                </span>
              ) : (
                "Chargement…"
              )
            }
            valeur={e && exigences ? `${fmtInt(e.compliant)} sur ${fmtInt(exigences.total_count)}` : "–"}
            href={lien("exigences")}
            libelle="Registre des exigences"
          />
          <Entree
            titre="Actions décidées en revue de direction"
            precision={a ? (a.overdue ? `${pluriel(a.overdue, "action en retard", "actions en retard")}, ${pluriel(a.by_status.closed, "close", "closes")}.` : `Aucune en retard, ${pluriel(a.by_status.closed, "close", "closes")}.`) : "Chargement…"}
            valeur={ouvertes === null ? "–" : pluriel(ouvertes, "ouverte", "ouvertes")}
            href="/hsseq/actions?origine=review&statut=toutes"
            libelle="Plan d'actions"
          />
        </dl>
      </Card>

      <Card
        title="Actions décidées en revue de direction"
        padded={false}
        actions={
          droits.hsseq && (
            <Button size="sm" variant="primary" onClick={() => setCreer(true)}>
              <Plus className="h-3.5 w-3.5" /> Nouvelle action
            </Button>
          )
        }
      >
        {message && (
          <div className="px-6 pb-3">
            <Notice tone="ok">{message}</Notice>
          </div>
        )}
        {!actions ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des actions de la revue…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={actions.items}
              rowKey={(x) => x.id}
              onRowClick={(x) => router.push(`/hsseq/actions?action=${x.id}`)}
              empty="Aucune action décidée en revue de direction."
              columns={[
                {
                  key: "reference",
                  label: "Action",
                  sortValue: (x) => x.reference,
                  render: (x) => (
                    <span className="block min-w-[15rem] max-w-[56ch]">
                      <span className="font-mono text-[11.5px] text-muted">{x.reference}</span>
                      <span className="mt-0.5 line-clamp-2 block leading-snug text-ink">{x.description}</span>
                      <span className="mt-1 block text-[12px] text-muted">Confiée à {x.owner.name}</span>
                    </span>
                  ),
                },
                { key: "due_date", label: "Échéance", sortValue: (x) => x.due_date, render: (x) => <span className="whitespace-nowrap">{fmtDate(x.due_date)}</span> },
                {
                  key: "status",
                  label: "Statut",
                  sortValue: (x) => x.status,
                  render: (x) => (
                    <span className="inline-flex flex-col items-start gap-1">
                      <Tampon mot={STATUT_ACTION[x.status]} />
                      {x.overdue && <Tampon mot="En retard" />}
                    </span>
                  ),
                },
              ]}
            />
            {actions.total_count > actions.items.length && (
              <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
                Les {fmtInt(actions.items.length)} premières échéances sur {fmtInt(actions.total_count)} : la suite est au plan d&apos;actions.
              </p>
            )}
          </>
        )}
      </Card>

      {creer && (
        <FenetreAction
          titre="Nouvelle action de la revue de direction"
          origine={{ origin: "review" }}
          rappel="Action décidée en revue de direction : elle n'a pas de fiche d'origine ni de site, et se suit au plan d'actions."
          onClose={() => setCreer(false)}
          onCreee={(x) => {
            void rafraichir();
            setMessage(
              <>
                Action{" "}
                <Link href={`/hsseq/actions?action=${x.id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
                  {x.reference}
                </Link>{" "}
                ajoutée au plan d&apos;actions.
              </>,
            );
          }}
        />
      )}
    </div>
  );
}
