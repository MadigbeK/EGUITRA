"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { ArrowUpRight, Pencil, Plus, RotateCcw, Trash2 } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice, cx, demanderConfirmation } from "@/components/ui";
import { Criticite, MatriceCriticite, STATUT_ACTION, Tampon } from "@/components/hsseq/commun";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique, aProfil, useMoi, useReferentiels } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDateTime, pluriel } from "@/lib/format";
import type { Attachment } from "@/lib/hsseq-types";
import { FenetreMesure, FenetreMotif, FenetreRevue } from "./Fenetres";
import { FenetreRisque } from "./FenetreRisque";
import { CHAMP_JOURNAL, Hierarchie, MAITRISE_FORTE, NATURE_RISQUE, NIVEAU_RISQUES, OPERATION_RISQUE, ORDRE_MAITRISE, Revue, STATUT_MESURE, STATUT_RISQUE, TamponRisque, deposerPieceRisque, messageRisque, nomProfil, nomSite } from "./libelles";
import type { Risk, RiskHistoryEntry, RiskMeasure, RiskScores } from "./types";

type Fenetre = { type: "modifier" } | { type: "revue" } | { type: "archive" } | { type: "reactivate" } | { type: "mesure"; mesure: RiskMeasure | null };

/** Texte raccourci pour un nom accessible ou une ligne du journal. */
function court(texte: string, n = 90): string {
  return texte.length > n ? `${texte.slice(0, n).trimEnd()}…` : texte;
}

/**
 * Fiche d'un risque (GET /hsseq/risks/{id}) à côté du registre : événement redouté et danger,
 * cotations brute et résiduelle, propriétaire et revue, mesures groupées dans l'ordre de la
 * hiérarchie des contrôles, actions du plan, pièces jointes, historique. Les commandes suivent
 * `transitions` et `rights` renvoyés par le noyau, qui refuse le reste ; l'auditeur n'en voit aucune.
 */
export function FicheRisque({ id, onFermer }: { id: number; onFermer: () => void }) {
  const { data: r, error, mutate } = useApi<Risk>(`/hsseq/risks/${id}`);
  const { data: ref } = useReferentiels();
  const moi = useMoi();
  const { mutate: muter } = useSWRConfig();
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  /** Liste, situation et matrices du registre, relues après une écriture sur la fiche. */
  const relireRegistre = () => muter((k) => typeof k === "string" && (k.startsWith("/hsseq/risks?") || k.startsWith("/hsseq/risks/matrix")));

  /** Écriture sur la fiche ; la réponse est le risque à jour. Lève l'erreur du noyau pour la fenêtre qui l'a lancée. */
  async function ecrire(methode: "POST" | "PATCH" | "DELETE", chemin: string, corps: unknown, texte: string | ((maj: Risk) => string)): Promise<Risk> {
    const maj = await apiSend<Risk>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void relireRegistre();
    setMessage({ tone: "ok", text: typeof texte === "function" ? texte(maj) : texte });
    return maj;
  }

  if (!r) {
    return (
      <Panneau etiquette="Registre des risques" titre="Risque" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement du risque…" />}
      </Panneau>
    );
  }
  const risque = r;

  async function mettreEnVigueur() {
    const ok = await demanderConfirmation(`Il entre au registre avec sa cotation et ses mesures${INSECABLE}; son propriétaire en fera la revue d'ici le ${fmtDate(risque.review_date)}.`, {
      titre: `Mettre en vigueur le risque ${risque.reference}${INSECABLE}?`,
      action: "Mettre en vigueur",
    });
    if (!ok) return;
    setOccupe("activate");
    setMessage(null);
    try {
      await ecrire("POST", `/hsseq/risks/${risque.id}/activate`, {}, `Risque mis en vigueur${INSECABLE}: il entre au registre.`);
    } catch (e) {
      setMessage({ tone: "danger", text: messageRisque(e, "Mise en vigueur impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  async function retirerMesure(m: RiskMeasure) {
    const ok = await demanderConfirmation(`«${INSECABLE}${court(m.description, 140)}${INSECABLE}» sort des mesures du risque${INSECABLE}; le retrait est journalisé.`, { titre: `Retirer cette mesure${INSECABLE}?`, action: "Retirer", danger: true });
    if (!ok) return;
    setOccupe(`mesure-${m.id}`);
    setMessage(null);
    try {
      await ecrire("DELETE", `/hsseq/risks/${risque.id}/measures/${m.id}`, undefined, "Mesure retirée.");
    } catch (e) {
      setMessage({ tone: "danger", text: messageRisque(e, "Retrait impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  async function deposer(fichier: File) {
    setOccupe("depot");
    setMessage(null);
    try {
      await deposerPieceRisque(risque.id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Pièce jointe au risque." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageRisque(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  // L'auditeur lit sans écrire (le noyau refuse toute écriture à ce profil).
  const lecture = aProfil(ref, "auditeur");
  const t = new Set(lecture ? [] : r.transitions);
  const modifiable = r.rights.can_edit && !lecture;
  const hsseq = aProfil(ref, "hsseq");
  const retirable = (p: Attachment) => modifiable && (hsseq || (moi !== undefined && p.created_by?.id === moi.id));
  const groupes = ORDRE_MAITRISE.map((n) => ({ niveau: n, mesures: r.measures.filter((m) => m.control_level === n) })).filter((g) => g.mesures.length > 0);
  // Risque encore significatif ou élevé après mesures, maîtrisé par des consignes ou des équipements de protection seulement.
  const seulementFaibles = r.status !== "archived" && r.measures.length > 0 && !r.measures.some((m) => MAITRISE_FORTE.includes(m.control_level)) && (r.residual.level === "high" || r.residual.level === "significant");
  const fermer = () => setFenetre(null);
  const mesureOuverte = fenetre?.type === "mesure" ? fenetre : null;
  const motifOuvert = fenetre?.type === "archive" || fenetre?.type === "reactivate" ? fenetre.type : null;

  return (
    <Panneau
      etiquette="Registre des risques"
      titre={r.reference}
      onFermer={onFermer}
      sousTitre={
        <>
          <span className="block">{NATURE_RISQUE[r.nature].label}</span>
          <span className="block">
            Créé le {fmtDate(r.created_at)}
            {r.created_by ? ` par ${r.created_by.name}` : ""}
          </span>
        </>
      }
      tampons={
        <>
          <TamponRisque mot={STATUT_RISQUE[r.status]} />
          {r.review_overdue && <TamponRisque mot="Revue échue" />}
          <Criticite note={r.residual.criticality} gravite={r.residual.severity} probabilite={r.residual.probability} />
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div>
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{r.feared_event}</p>
        <p className="mt-1.5 whitespace-pre-line text-[13px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">Danger&nbsp;: </span>
          {r.hazard}
        </p>
      </div>

      <Commandes>
        {t.has("activate") && (
          <Button variant="primary" loading={occupe === "activate"} onClick={() => void mettreEnVigueur()}>
            Mettre en vigueur
          </Button>
        )}
        {t.has("review") && (
          <Button variant="primary" onClick={() => setFenetre({ type: "revue" })}>
            Faire la revue
          </Button>
        )}
        {t.has("reactivate") && (
          <Button variant="primary" onClick={() => setFenetre({ type: "reactivate" })}>
            <RotateCcw className="h-4 w-4" /> Remettre en vigueur
          </Button>
        )}
        {modifiable && (
          <Button onClick={() => setFenetre({ type: "modifier" })}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )}
        {t.has("archive") && (
          <Button variant="ghost" onClick={() => setFenetre({ type: "archive" })}>
            Archiver
          </Button>
        )}
      </Commandes>

      {r.status === "draft" && (
        <Notice tone="accent">
          {t.has("activate")
            ? `À évaluer${INSECABLE}: vérifiez la cotation et les mesures, puis mettez le risque en vigueur${INSECABLE}; sa revue court dès lors.`
            : `À évaluer${INSECABLE}: le Responsable HSSEQ le met en vigueur une fois la cotation et les mesures vérifiées.`}
        </Notice>
      )}
      {r.status === "archived" && (
        <Notice tone="neutral">
          <span className="font-semibold text-ink">Archivé&nbsp;: </span>
          {r.archive_reason ?? "motif non renseigné."}
        </Notice>
      )}
      {r.review_overdue && <Notice tone="danger">{`Revue échue depuis le ${fmtDate(r.review_date)}${INSECABLE}: le propriétaire et le Responsable HSSEQ sont relancés chaque semaine jusqu'à la revue.`}</Notice>}

      <Rubrique titre="Cotation">
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <CotationLue titre="Avant mesures" s={r.raw} />
          <CotationLue titre="Après mesures" s={r.residual} />
        </div>
        <p className="mt-3 text-[12.5px] leading-snug text-muted">
          {r.residual.criticality < r.raw.criticality
            ? `Les mesures ramènent la criticité de ${r.raw.criticality} à ${r.residual.criticality}.`
            : `Criticité résiduelle égale à la brute${INSECABLE}: aucune mesure n'est encore comptée dans la cotation.`}
        </p>
      </Rubrique>

      <Definitions
        lignes={[
          ["Profil", nomProfil(r.vehicle_kind)],
          ["Site", nomSite(r.site)],
          ["Activité", r.activity ?? "Non précisée"],
          ["Propriétaire", `${r.owner.name}${moi?.id === r.owner.id ? " (vous)" : ""}`],
          ["Prochaine revue", r.status === "archived" ? "Sans objet, risque archivé" : <Revue key="revue" date={r.review_date} echue={r.review_overdue} statut={r.status} />],
          ["Dernière revue", r.last_review_at ? `${fmtDate(r.last_review_at)}${r.last_reviewed_by ? `, ${r.last_reviewed_by.name}` : ""}` : "Aucune depuis la création"],
        ]}
      />
      {r.review_comment && (
        <div>
          <p className="mb-1.5 text-[12px] text-muted">Constat de la dernière revue</p>
          <blockquote className="border-l-2 border-line-strong pl-3 text-[13.5px] leading-relaxed text-ink">{r.review_comment}</blockquote>
        </div>
      )}

      <Rubrique
        titre={`Mesures de maîtrise (${r.measures.length})`}
        actions={
          modifiable && (
            <Button size="sm" onClick={() => setFenetre({ type: "mesure", mesure: null })}>
              <Plus className="h-3.5 w-3.5" /> Ajouter une mesure
            </Button>
          )
        }
      >
        {groupes.length === 0 ? (
          <p className="text-[13px] leading-snug text-muted">Aucune mesure de maîtrise{modifiable ? `${INSECABLE}: ajoutez-les par niveau, de la suppression du danger à l'équipement de protection.` : "."}</p>
        ) : (
          <ol className="space-y-4">
            {groupes.map((g) => (
              <li key={g.niveau}>
                <p className="mb-1.5 text-[12.5px] font-semibold text-ink-2">
                  <Hierarchie niveau={g.niveau} />
                </p>
                <ul className="space-y-1.5">
                  {g.mesures.map((m) => (
                    <Mesure key={m.id} m={m} modifiable={modifiable} occupe={occupe === `mesure-${m.id}`} onModifier={() => setFenetre({ type: "mesure", mesure: m })} onRetirer={() => void retirerMesure(m)} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {seulementFaibles && (
          <div className="mt-3">
            <Notice tone="warn">
              {`Risque encore ${NIVEAU_RISQUES[r.residual.level ?? "significant"][0]} après mesures, maîtrisé par des consignes ou des équipements de protection seulement${INSECABLE}: la hiérarchie des contrôles demande d'abord de supprimer, de remplacer ou d'isoler le danger.`}
            </Notice>
          </div>
        )}
      </Rubrique>

      <Rubrique
        titre={`Actions du plan (${r.actions.length})`}
        actions={
          // Le plan d'actions filtré par ce risque (risk_id), closes et annulées comprises.
          r.actions.length > 0 && (
            <Link href={`/hsseq/actions?risque=${r.id}`} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline">
              Actions du risque au plan <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )
        }
      >
        {r.actions.length === 0 ? (
          <p className="text-[13px] leading-snug text-muted">Aucune action du plan n&apos;est rattachée à ce risque.</p>
        ) : (
          <ul className="space-y-1.5">
            {r.actions.map((a) => (
              <li key={a.id}>
                <Link href={`/hsseq/actions?action=${a.id}`} className="block rounded-[10px] border border-line px-3 py-2 outline-offset-2 transition-colors hover:border-line-strong hover:bg-panel-2">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11.5px] text-muted">{a.reference}</span>
                    <span className="inline-flex flex-wrap gap-1.5">
                      <Tampon mot={STATUT_ACTION[a.status]} />
                      {a.overdue && <Tampon mot="En retard" />}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-ink">{a.description}</span>
                  <span className="mt-1 block text-[12px] text-muted">
                    {a.owner.name}, échéance le {fmtDate(a.due_date)}
                    {a.overdue ? `, ${pluriel(a.days_overdue, "jour")} de retard` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Rubrique>

      <Rubrique
        titre="Pièces jointes"
        actions={
          modifiable && (
            <span className="inline-flex items-center gap-2">
              {occupe === "depot" && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une pièce" accept={FORMATS_PIECE} onFile={(f) => void deposer(f)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={r.attachments}
          retirable={retirable}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">Aucune pièce&nbsp;: étude de dangers, photos du poste, compte rendu de visite…</p>}
        />
      </Rubrique>

      {r.history.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Historique ({r.history.length})</summary>
          <ol className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-ink-2">
            {[...r.history]
              .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
              .map((h) => (
                <li key={h.id}>
                  <span className="text-muted">{fmtDateTime(h.at)}</span>, {h.by ? (h.by.name || (h.by as { function?: string }).function || "Utilisateur interne") : "Système"}
                  {`${INSECABLE}: ${ligneJournal(h)}`}
                </li>
              ))}
          </ol>
        </details>
      )}

      {fenetre?.type === "modifier" && (
        <FenetreRisque
          risque={r}
          onClose={fermer}
          onEnregistre={(maj) => {
            fermer();
            void mutate(maj, { revalidate: false });
            void relireRegistre();
            setMessage({ tone: "ok", text: "Risque mis à jour." });
          }}
        />
      )}
      {fenetre?.type === "revue" && <FenetreRevue r={r} onClose={fermer} envoyer={(corps) => ecrire("POST", `/hsseq/risks/${r.id}/review`, corps, (maj) => `Revue enregistrée${INSECABLE}: prochaine revue le ${fmtDate(maj.review_date)}.`)} />}
      {motifOuvert && (
        <FenetreMotif
          transition={motifOuvert}
          r={r}
          onClose={fermer}
          envoyer={(reason) => ecrire("POST", `/hsseq/risks/${r.id}/${motifOuvert}`, { reason }, motifOuvert === "archive" ? `Risque archivé${INSECABLE}: il sort du registre.` : "Risque remis en vigueur.")}
        />
      )}
      {mesureOuverte && (
        <FenetreMesure
          r={r}
          mesure={mesureOuverte.mesure}
          onClose={fermer}
          envoyer={(corps) =>
            mesureOuverte.mesure
              ? ecrire("PATCH", `/hsseq/risks/${r.id}/measures/${mesureOuverte.mesure.id}`, corps, "Mesure mise à jour.")
              : ecrire("POST", `/hsseq/risks/${r.id}/measures`, corps, "Mesure ajoutée.")
          }
        />
      )}
    </Panneau>
  );
}

/** Commandes de la fiche ; rien quand le compte n'en a aucune. */
function Commandes({ children }: { children: ReactNode }) {
  const liste = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!liste.length) return null;
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/** Cotation lue : la case de la matrice 5 × 5 marquée, la note et son niveau en toutes lettres. */
function CotationLue({ titre, s }: { titre: string; s: RiskScores }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-ink-2">
        {titre}
        <Criticite note={s.criticality} gravite={s.severity} probabilite={s.probability} />
      </p>
      {/* La matrice redit la note pour l'œil ; le texte voisin la donne au lecteur d'écran. */}
      <div aria-hidden>
        <MatriceCriticite label={titre} valeur={{ gravite: s.severity, probabilite: s.probability }} legende={false} />
      </div>
      <p className="mt-1.5 text-[12px] text-muted tabular">
        Gravité {s.severity} × probabilité {s.probability}
      </p>
    </div>
  );
}

/** Mesure de maîtrise : description, état, action qui la met en place ; modifier et retirer selon les droits. */
function Mesure({ m, modifiable, occupe, onModifier, onRetirer }: { m: RiskMeasure; modifiable: boolean; occupe: boolean; onModifier: () => void; onRetirer: () => void }) {
  const nom = court(m.description, 60);
  return (
    <li className="flex items-start gap-2 rounded-[10px] bg-panel-2 py-2 pl-3 pr-1.5">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-line text-[13px] leading-snug text-ink">{m.description}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-2">
          <TamponRisque mot={STATUT_MESURE[m.status]} />
          {m.action && (
            <Link href={`/hsseq/actions?action=${m.action.id}`} className="text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline">
              Action {m.action.reference}
            </Link>
          )}
        </p>
      </div>
      {modifiable && (
        <span className="flex flex-none items-center">
          <BoutonIcone label={`Modifier la mesure «${INSECABLE}${nom}${INSECABLE}»`} onClick={onModifier}>
            <Pencil className="h-4 w-4" />
          </BoutonIcone>
          <BoutonIcone label={`Retirer la mesure «${INSECABLE}${nom}${INSECABLE}»`} onClick={onRetirer} disabled={occupe} danger>
            <Trash2 className="h-4 w-4" />
          </BoutonIcone>
        </span>
      )}
    </li>
  );
}

function BoutonIcone({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx("grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-panel-3 disabled:opacity-45", danger ? "hover:text-danger" : "hover:text-ink")}
    >
      {children}
    </button>
  );
}

/** Ligne du journal : l'opération, le champ modifié avec ses valeurs avant et après, ou la note (motif, constat, mesure). */
function ligneJournal(h: RiskHistoryEntry): string {
  const operation = OPERATION_RISQUE[h.action] ?? h.action;
  if (h.action === "write" && h.field) {
    const c = CHAMP_JOURNAL[h.field];
    const lire = (v: string | null) => (v ? court(c?.valeur ? c.valeur(v) : v, 60) : "vide");
    return `${c?.label ?? h.field} de «${INSECABLE}${lire(h.old_value)}${INSECABLE}» à «${INSECABLE}${lire(h.new_value)}${INSECABLE}»`;
  }
  return h.note ? `${operation} (${court(h.note)})` : operation;
}
