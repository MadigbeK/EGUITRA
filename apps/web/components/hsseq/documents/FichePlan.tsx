"use client";

import { useState } from "react";
import { ChevronRight, Pencil, Plus, RotateCcw } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice, demanderConfirmation } from "@/components/ui";
import { Definitions, Panneau, Pieces, Rubrique, aujourdhui } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, pluriel } from "@/lib/format";
import { Commandes, Historique, ListeContacts } from "./elements";
import { FenetrePlan, FenetrePlanifier } from "./fenetres";
import { FORMATS_DOCUMENT, SCENARIO, STATUT_EXERCICE, TamponDocument, deposerPiece, messageDocument, useRafraichir, type Droits } from "./libelles";
import type { Drill, EmergencyPlan, Scenario } from "./types";

type Fenetre = "modifier" | "planifier";

interface Message {
  tone: "ok" | "danger";
  text: string;
}

/** Valeurs codées du journal d'un plan, en clair. */
function valeurPlan(champ: string, v: string): string {
  if (champ === "scenario") return SCENARIO[v as Scenario] ?? v;
  return v;
}

/**
 * Fiche d'un plan d'intervention d'urgence (GET /hsseq/emergency-plans/{id}) : conduite à tenir,
 * moyens, contacts à appeler (appel en un geste), exercices du plan, documents, journal. Le
 * Responsable HSSEQ planifie un exercice, modifie le plan, l'archive ou le remet en vigueur (un seul
 * plan en vigueur par site et par scénario). `onExercice` ouvre la fiche d'un exercice à la place.
 */
export function FichePlan({ id, droits, onFermer, onExercice }: { id: number; droits: Droits; onFermer: () => void; onExercice: (id: number) => void }) {
  const cle = `/hsseq/emergency-plans/${id}`;
  const { data: plan, error, mutate } = useApi<EmergencyPlan>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  async function ecrire(corps: unknown, texte: string): Promise<EmergencyPlan> {
    const maj = await apiSend<EmergencyPlan>("PATCH", cle, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: texte });
    return maj;
  }

  if (!plan) {
    return (
      <Panneau etiquette="Plan d'intervention" titre="Plan" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement du plan…" />}
      </Panneau>
    );
  }
  const p = plan;

  async function basculerVigueur() {
    const archiver = p.active;
    const ok = await demanderConfirmation(
      archiver
        ? `Le plan ${p.reference} sort des plans en vigueur du site${INSECABLE}: il ne reçoit plus d'exercice, ses exercices passés restent au dossier.`
        : `Le plan ${p.reference} redevient le plan en vigueur pour ce site et ce scénario${INSECABLE}; un autre plan en vigueur sur le même scénario l'en empêche.`,
      { titre: archiver ? `Archiver le plan ${p.reference}${INSECABLE}?` : `Remettre en vigueur le plan ${p.reference}${INSECABLE}?`, action: archiver ? "Archiver" : "Remettre en vigueur", danger: archiver },
    );
    if (!ok) return;
    setOccupe("vigueur");
    setMessage(null);
    try {
      await ecrire({ active: !archiver }, archiver ? "Plan archivé." : "Plan remis en vigueur.");
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, "Opération impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  async function deposer(fichier: File) {
    setOccupe("depot");
    setMessage(null);
    try {
      await deposerPiece("emergency_plan", p.id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Document joint au plan." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  const modifiable = p.rights.can_edit && !droits.auditeur;
  const revueEchue = p.active && p.review_date !== null && p.review_date < aujourdhui();
  const exercices = [...p.drills].sort((a, b) => b.planned_date.localeCompare(a.planned_date) || b.id - a.id);
  const enRetard = exercices.filter((d) => d.overdue).length;

  return (
    <Panneau
      etiquette="Plan d'intervention"
      titre={p.reference}
      onFermer={onFermer}
      sousTitre={
        <>
          <span className="block">{p.title}</span>
          <span className="block">
            {SCENARIO[p.scenario]}, {p.site?.name ?? "site non précisé"}
          </span>
        </>
      }
      tampons={
        <>
          <TamponDocument mot={p.active ? "En vigueur" : "Archivé"} />
          {revueEchue && <TamponDocument mot="Revue échue" />}
          {p.active && !p.next_drill && <TamponDocument mot="Sans exercice prévu" />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Commandes>
        {modifiable && p.active && (
          <Button variant="primary" onClick={() => setFenetre("planifier")}>
            <Plus className="h-4 w-4" /> Planifier un exercice
          </Button>
        )}
        {modifiable && (
          <Button onClick={() => setFenetre("modifier")}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )}
        {modifiable && (
          <Button variant={p.active ? "ghost" : "primary"} loading={occupe === "vigueur"} onClick={() => void basculerVigueur()}>
            {p.active ? (
              "Archiver le plan"
            ) : (
              <>
                <RotateCcw className="h-4 w-4" /> Remettre en vigueur
              </>
            )}
          </Button>
        )}
      </Commandes>

      {!p.active && <Notice tone="neutral">{`Plan archivé${INSECABLE}: il ne reçoit plus d'exercice. Ses exercices passés restent au dossier.`}</Notice>}
      {revueEchue && <Notice tone="warn">{`Revue du plan échue depuis le ${fmtDate(p.review_date)}${INSECABLE}: relisez la conduite à tenir et les contacts avec le site, puis reportez la date de revue.`}</Notice>}
      {enRetard > 0 && <Notice tone="warn">{`${pluriel(enRetard, "exercice planifié", "exercices planifiés")} à une date passée, pas encore ${enRetard > 1 ? "déclarés réalisés" : "déclaré réalisé"}.`}</Notice>}

      <Rubrique titre="Conduite à tenir">
        <p className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-ink">{p.response}</p>
      </Rubrique>

      {p.resources && (
        <Rubrique titre="Moyens d'intervention">
          <p className="m-0 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{p.resources}</p>
        </Rubrique>
      )}

      <Rubrique titre={`Contacts à appeler (${p.contacts.length})`}>
        {p.contacts.length ? (
          <ListeContacts contacts={[...p.contacts].sort((a, b) => a.call_order - b.call_order || a.id - b.id)} />
        ) : (
          <p className="m-0 text-[13px] text-muted">{`Aucun contact retenu${INSECABLE}: l'annuaire de crise du site reste le recours.`}</p>
        )}
      </Rubrique>

      <Rubrique titre={`Exercices (${exercices.length})`}>
        {exercices.length ? (
          <ul className="divide-y divide-line/80 overflow-hidden rounded-[12px] border border-line">
            {exercices.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => onExercice(d.id)} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left outline-offset-[-2px] transition-colors hover:bg-accent-doux/45">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-[11.5px] text-muted">{d.reference}</span>
                      <TamponDocument mot={STATUT_EXERCICE[d.status]} />
                      {d.overdue && <TamponDocument mot="En retard" />}
                    </span>
                    <span className="mt-1 block text-[13px] text-ink">{libelleDate(d)}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-none text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-muted">{`Aucun exercice${modifiable && p.active ? `${INSECABLE}: planifiez le premier.` : "."}`}</p>
        )}
      </Rubrique>

      <Definitions
        lignes={[
          ["Site", p.site?.name ?? "Non précisé"],
          ["Scénario", SCENARIO[p.scenario]],
          ["Prochaine revue", p.review_date ? fmtDate(p.review_date) : "Non programmée"],
          ["Dernier exercice réalisé", p.last_drill ? fmtDate(p.last_drill) : "Aucun"],
          ["Prochain exercice", p.next_drill ? fmtDate(p.next_drill) : "Aucun prévu"],
          ["Société", p.company.name],
        ]}
      />

      <Rubrique
        titre="Documents du plan"
        actions={
          modifiable && (
            <span className="inline-flex items-center gap-2">
              {occupe === "depot" && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre un document" accept={FORMATS_DOCUMENT} onFile={(f) => void deposer(f)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={p.attachments}
          retirable={() => modifiable}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="m-0 text-[13px] text-muted">{`Aucun document${INSECABLE}: plan détaillé, plan d'évacuation, fiches de données de sécurité (PDF ou photo).`}</p>}
        />
      </Rubrique>

      <Historique lignes={p.history} valeur={valeurPlan} />

      {fenetre === "modifier" && <FenetrePlan plan={p} onClose={() => setFenetre(null)} envoyer={(corps) => ecrire(corps, "Plan mis à jour.")} />}
      {fenetre === "planifier" && (
        <FenetrePlanifier
          plans={[p]}
          planId={p.id}
          onClose={() => setFenetre(null)}
          envoyer={async (planId, corps) => {
            const d = await apiSend<Drill>("POST", `/hsseq/emergency-plans/${planId}/drills`, corps);
            await mutate();
            void rafraichir(cle);
            setMessage({ tone: "ok", text: `Exercice ${d.reference} planifié le ${fmtDate(d.planned_date)}.` });
          }}
        />
      )}
    </Panneau>
  );
}

/** Date qui compte pour un exercice : réalisé le…, prévu le…, ou annulé (prévu le…). */
function libelleDate(d: { status: Drill["status"]; planned_date: string; performed_date: string | null; participants_count: number | null }): string {
  if (d.status === "done") return `Réalisé le ${fmtDate(d.performed_date)}${d.participants_count ? `, ${pluriel(d.participants_count, "participant")}` : ""}`;
  if (d.status === "cancelled") return `Annulé, prévu le ${fmtDate(d.planned_date)}`;
  return `Prévu le ${fmtDate(d.planned_date)}`;
}
