"use client";

/**
 * Rubrique 11, « Décisions et actions » : les décisions de la revue (éléments de sortie, ISO 45001, 9.3),
 * chacune avec l'action du plan qui la met en œuvre et son état du moment. Tant que la revue n'est pas
 * close (`rights.can_edit`), la direction et le Responsable HSSEQ inscrivent une décision (et au besoin
 * son action, d'un même envoi), la modifient, la retirent tant qu'aucune action ne la porte, ou
 * l'inscrivent au plan d'actions. Les actions nées de la revue (servies avec la fiche, à leur état du
 * moment) se retrouvent au plan d'actions, filtré par revue (review_id).
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "@/components/icons";
import { Button, Notice, Tag, demanderConfirmation } from "@/components/ui";
import { useAutorise } from "@/lib/api-client";
import { STATUT_ACTION, Tampon } from "@/components/hsseq/commun";
import { INSECABLE, fmtDate, pluriel } from "@/lib/format";
import type { ActionLine } from "@/lib/hsseq-types";
import { LienEcran, Reference, Rubrique } from "./briques";
import { ANCRES } from "./ElementsEntree";
import { FenetreActionDecision, FenetreDecision } from "./Fenetres";
import { NATURE_DECISION, TamponRevue, messageRevue, nomCompte } from "./outils";
import type { Review, ReviewDecision } from "./types";

/** Écriture sur la revue ; la réponse du noyau est la fiche à jour. */
export type EnvoiRevue = (methode: "POST" | "PATCH" | "DELETE", chemin: string, corps?: unknown) => Promise<Review>;

type Fenetre = { type: "nouvelle" } | { type: "modifier"; d: ReviewDecision } | { type: "action"; d: ReviewDecision };

const OUVERTE = new Set(["todo", "in_progress", "to_verify"]);

/** Texte raccourci, pour une question de confirmation. */
function court(texte: string, n = 120): string {
  return texte.length > n ? `${texte.slice(0, n).trimEnd()}…` : texte;
}

/** Lien vers une action du plan, dans un message. */
function LienAction({ a }: { a: { id: number; reference: string } }) {
  return (
    <Link href={`/hsseq/actions?action=${a.id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
      {a.reference}
    </Link>
  );
}

/**
 * Action qui met en œuvre une décision : référence, état du moment, responsable et échéance ; un lien
 * vers sa fiche au plan pour qui lit les actions des revues.
 */
function ActionDecision({ a, lien }: { a: ActionLine; lien: boolean }) {
  const contenu = (
    <>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[12.5px] text-muted">Action</span>
        <Reference>{a.reference}</Reference>
        <Tampon mot={STATUT_ACTION[a.status]} />
        {a.overdue && <Tampon mot="En retard" />}
        {a.approval_pending && <Tampon mot="À valider" />}
      </span>
      <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
        {`${nomCompte(a.owner)}, échéance le ${fmtDate(a.due_date)}`}
        {a.overdue ? `, ${pluriel(a.days_overdue, "jour")} de retard` : ""}
      </span>
    </>
  );
  if (!lien) return <div className="py-1">{contenu}</div>;
  return (
    <Link href={`/hsseq/actions?action=${a.id}`} className="-mx-1.5 block rounded-[10px] px-1.5 py-1 outline-offset-2 transition-colors hover:bg-accent-doux/45">
      {contenu}
    </Link>
  );
}

/**
 * Profils qui lisent les actions des revues au plan d'actions : ceux qui lisent tout le plan (READ_ALL du
 * noyau), et l'auditeur, qui y lit les actions des revues des sociétés de son compte tant que son accès court.
 */
const LECTURE_PLAN = ["admin", "direction", "hsseq", "auditeur"] as const;

export function Decisions({ r, envoyer }: { r: Review; envoyer: EnvoiRevue }) {
  const planLisible = useAutorise(LECTURE_PLAN);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: ReactNode } | null>(null);
  const [occupe, setOccupe] = useState<number | null>(null);
  // Actions nées de la revue, servies avec la fiche à leur état du moment (une action de revue n'a pas de site).
  const actions = r.actions;
  const modifiable = r.rights.can_edit;
  const liees = new Set(r.decisions.flatMap((d) => (d.action ? [d.action.id] : [])));
  const autres = actions.filter((a) => !liees.has(a.id));
  const inscrites = r.decisions.filter((d) => d.action).length;
  const enCours = r.decisions.filter((d) => d.action && OUVERTE.has(d.action.status)).length;
  const ouvertes = actions.filter((a) => OUVERTE.has(a.status)).length;
  const retard = actions.filter((a) => a.overdue).length;
  const fermer = () => setFenetre(null);

  async function retirer(d: ReviewDecision) {
    const ok = await demanderConfirmation(`«${INSECABLE}${court(d.description)}${INSECABLE}» sort des décisions de la revue${INSECABLE}; le retrait est journalisé.`, { titre: `Retirer cette décision${INSECABLE}?`, action: "Retirer", danger: true });
    if (!ok) return;
    setOccupe(d.id);
    setMessage(null);
    try {
      await envoyer("DELETE", `/hsseq/reviews/${r.id}/decisions/${d.id}`);
      setMessage({ tone: "ok", text: "Décision retirée." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageRevue(e, "Retrait impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  return (
    <Rubrique
      id={ANCRES.decisions}
      numero={11}
      titre="Décisions et actions"
      aide={`Améliorations, changements du système de management, ressources, objectifs${INSECABLE}: chaque décision s'inscrit au plan d'actions, suivie jusqu'à sa preuve.`}
      actions={
        modifiable && (
          <Button size="sm" variant="primary" onClick={() => setFenetre({ type: "nouvelle" })}>
            <Plus className="h-3.5 w-3.5" /> Inscrire une décision
          </Button>
        )
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {r.decisions.length === 0 ? (
        <p className="text-[13px] leading-snug text-muted">
          {r.state === "prepared"
            ? `Aucune décision${INSECABLE}: elles se prennent en séance. Une revue se clôt avec au moins une décision.`
            : `Aucune décision${INSECABLE}: une revue de direction se clôt avec au moins une décision.`}
        </p>
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">
            {`${pluriel(r.decisions.length, "décision")}${INSECABLE}: ${pluriel(inscrites, "inscrite", "inscrites")} au plan d'actions`}
            {enCours ? `, dont ${pluriel(enCours, "encore en cours", "encore en cours")}` : ""}
            {r.decisions.length - inscrites ? `${INSECABLE}; ${pluriel(r.decisions.length - inscrites, "sans action", "sans action")}` : ""}.
          </p>
          <ol className="space-y-3">
            {r.decisions.map((d, i) => (
              <li key={d.id} className="rounded-[14px] border border-line px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold tabular text-muted">{i + 1}.</span>
                    <Tag>{NATURE_DECISION[d.topic]?.court ?? d.topic}</Tag>
                  </span>
                  {modifiable && (
                    <span className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setFenetre({ type: "modifier", d })} aria-label={`Modifier la décision ${i + 1}`}>
                        <Pencil className="h-3.5 w-3.5" /> Modifier
                      </Button>
                      {/* Une décision portée par une action se conserve (le noyau refuse son retrait). */}
                      {!d.action && (
                        <Button size="sm" variant="ghost" loading={occupe === d.id} onClick={() => void retirer(d)} aria-label={`Retirer la décision ${i + 1}`}>
                          <Trash2 className="h-3.5 w-3.5" /> Retirer
                        </Button>
                      )}
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-ink">{d.description}</p>
                <p className="mt-1 text-[12.5px] text-muted">
                  {d.owner ? `Responsable${INSECABLE}: ${nomCompte(d.owner)}` : "Responsable à désigner"}
                  {d.due_date ? `, échéance le ${fmtDate(d.due_date)}` : ""}
                </p>
                <div className="mt-3 border-t border-line/80 pt-2.5">
                  {d.action ? (
                    <ActionDecision a={d.action} lien={planLisible} />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <TamponRevue mot="Sans action" />
                        <span className="text-[12.5px] text-muted">Pas inscrite au plan d&apos;actions.</span>
                      </span>
                      {modifiable && (
                        <Button size="sm" onClick={() => setFenetre({ type: "action", d })}>
                          <Plus className="h-3.5 w-3.5" /> Inscrire au plan d&apos;actions
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {autres.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink">Autres actions nées de la revue</p>
          <ul className="space-y-1.5">
            {autres.map((a) => (
              <li key={a.id} className="rounded-[12px] border border-line px-3 py-2">
                <ActionDecision a={a} lien={planLisible} />
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink">{a.description}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions.length > 0 && (
        <p className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
          <span>
            {`${pluriel(actions.length, "action née", "actions nées")} de la revue au plan d'actions${INSECABLE}: ${pluriel(ouvertes, "encore ouverte", "encore ouvertes")}`}
            {retard ? <span className="font-semibold text-danger">{`, dont ${pluriel(retard, "en retard", "en retard")}`}</span> : null}.
          </span>
          {planLisible && <LienEcran href={`/hsseq/actions?revue=${r.id}`}>Plan d&apos;actions</LienEcran>}
        </p>
      )}

      {fenetre?.type === "nouvelle" && (
        <FenetreDecision
          revue={r}
          onClose={fermer}
          envoyer={async (corps) => {
            const maj = await envoyer("POST", `/hsseq/reviews/${r.id}/decisions`, corps);
            const nouvelle = maj.decisions.find((x) => !r.decisions.some((y) => y.id === x.id));
            setMessage({
              tone: "ok",
              text: nouvelle?.action ? (
                <>
                  Décision inscrite, et son action <LienAction a={nouvelle.action} /> au plan d&apos;actions.
                </>
              ) : (
                "Décision inscrite."
              ),
            });
          }}
        />
      )}
      {fenetre?.type === "modifier" && (
        <FenetreDecision
          revue={r}
          decision={fenetre.d}
          onClose={fermer}
          envoyer={async (corps) => {
            await envoyer("PATCH", `/hsseq/reviews/${r.id}/decisions/${fenetre.d.id}`, corps);
            setMessage({ tone: "ok", text: "Décision mise à jour." });
          }}
        />
      )}
      {fenetre?.type === "action" && (
        <FenetreActionDecision
          decision={fenetre.d}
          onClose={fermer}
          envoyer={async (corps) => {
            const maj = await envoyer("POST", `/hsseq/reviews/${r.id}/decisions/${fenetre.d.id}/action`, corps);
            const action = maj.decisions.find((x) => x.id === fenetre.d.id)?.action;
            setMessage({
              tone: "ok",
              text: action ? (
                <>
                  Action <LienAction a={action} /> inscrite au plan d&apos;actions, d&apos;origine «&nbsp;Revue de direction&nbsp;».
                </>
              ) : (
                "Action inscrite au plan d'actions."
              ),
            });
          }}
        />
      )}
    </Rubrique>
  );
}
