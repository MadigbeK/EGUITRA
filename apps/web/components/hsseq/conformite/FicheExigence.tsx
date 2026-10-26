"use client";

import { useState } from "react";
import { FileCheck2, Pencil } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice } from "@/components/ui";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";
import { Commandes, Historique, ListeConstats, NORME, SOURCE, STATUT_EXIGENCE, TamponConformite, deposerPreuve, lien, messageErreur, useRafraichir, type Message } from "./commun";
import { FenetreExigence, FenetreRevue } from "./fenetres";
import type { RequirementDetail, RequirementSource, RequirementStandard, RequirementStatus } from "./types";

/** Valeurs codées du journal d'une exigence, en clair. */
function valeurExigence(champ: string, v: string): string {
  if (champ === "status") return STATUT_EXIGENCE[v as RequirementStatus] ?? v;
  if (champ === "source") return SOURCE[v as RequirementSource] ?? v;
  if (champ === "standard") return NORME[v as RequirementStandard] ?? v;
  return v;
}

/**
 * Fiche d'une exigence du registre : source et référence du texte, résumé, preuve attendue et preuves
 * jointes, statut et dernière revue, constats d'audit liés, journal. Le Responsable HSSEQ la modifie et
 * en fait la revue de conformité (`rights`, `transitions`) ; les autres profils la lisent.
 */
export function FicheExigence({ id, onFermer }: { id: number; onFermer: () => void }) {
  const cle = `/hsseq/requirements/${id}`;
  const { data: r, error, mutate } = useApi<RequirementDetail>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<"edit" | "review" | null>(null);
  const [occupe, setOccupe] = useState(false);

  /** Écriture sur l'exigence ; la réponse est la fiche à jour. Lève le refus du noyau pour la fenêtre qui l'a lancée. */
  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string) {
    const maj = await apiSend<RequirementDetail>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: texte });
  }

  async function deposer(fichier: File) {
    setOccupe(true);
    setMessage(null);
    try {
      await deposerPreuve("requirement", id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Preuve jointe à l'exigence." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Dépôt impossible.") });
    } finally {
      setOccupe(false);
    }
  }

  if (!r) {
    return (
      <Panneau etiquette="Registre des exigences" titre="Exigence" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de l'exigence…" />}
      </Panneau>
    );
  }

  const revue = r.transitions.includes("review");

  return (
    <Panneau
      etiquette="Registre des exigences"
      titre={r.reference}
      onFermer={onFermer}
      sousTitre={r.title}
      tampons={
        <>
          <TamponConformite mot={STATUT_EXIGENCE[r.status]} />
          {r.review_overdue && <TamponConformite mot="Revue en retard" />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Commandes>
        {revue && (
          <Button variant="primary" onClick={() => setFenetre("review")}>
            <FileCheck2 className="h-4 w-4" /> Revoir la conformité
          </Button>
        )}
        {r.rights.can_edit && (
          <Button onClick={() => setFenetre("edit")}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )}
      </Commandes>

      {r.review_overdue && r.next_review_date && <Notice tone="warn">Revue prévue le {fmtDate(r.next_review_date)}, pas encore faite.</Notice>}

      <Definitions
        lignes={[
          ["Source", SOURCE[r.source]],
          ["Référence du texte", r.source_reference],
          r.partner && ["Client ou donneur d'ordre", r.partner.name],
          ["Référentiel", r.standard ? NORME[r.standard] : "Aucun"],
          ["Dernière revue", r.last_review_at ? `${fmtDate(r.last_review_at)}${r.last_reviewed_by ? `, par ${r.last_reviewed_by.name}` : ""}` : "Jamais revue"],
          ["Prochaine revue", r.next_review_date ? fmtDate(r.next_review_date) : "Non programmée"],
        ]}
      />

      {r.summary && (
        <Rubrique titre="Résumé">
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{r.summary}</p>
        </Rubrique>
      )}

      <Rubrique
        titre="Preuves de conformité"
        actions={
          r.rights.can_edit && (
            <span className="inline-flex items-center gap-2">
              {occupe && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une preuve" accept={FORMATS_PIECE} onFile={(x) => void deposer(x)} />
            </span>
          )
        }
      >
        <p className="mb-3 rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">Preuve attendue : </span>
          {r.expected_evidence || "Non précisée."}
        </p>
        <Pieces
          pieces={r.evidence}
          retirable={() => r.rights.can_edit}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">Aucune preuve jointe.</p>}
        />
      </Rubrique>

      {r.review_comment && (
        <Rubrique titre="Constat de la dernière revue">
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{r.review_comment}</p>
        </Rubrique>
      )}

      {r.findings.length > 0 && (
        <Rubrique titre={`Constats d'audit liés (${r.findings.length})`}>
          <ListeConstats constats={r.findings} href={(constat) => lien("constats", { statut: "tous", constat })} />
        </Rubrique>
      )}

      <Historique lignes={r.history} valeur={valeurExigence} />

      {fenetre === "edit" && <FenetreExigence exigence={r} onClose={() => setFenetre(null)} envoyer={(corps) => ecrire("PATCH", cle, corps, "Exigence mise à jour.")} />}
      {fenetre === "review" && <FenetreRevue exigence={r} onClose={() => setFenetre(null)} envoyer={(corps) => ecrire("POST", `${cle}/review`, corps, "Revue de conformité enregistrée.")} />}
    </Panneau>
  );
}
