"use client";

import { useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { CheckCheck, Pencil, RotateCcw, XCircle } from "@/components/icons";
import { Button, Etat, Field, FileButton, Input, Loading, Modal, Notice, Select, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { NIVEAU_MAITRISE, STATUT_ACTION, Tampon } from "@/components/hsseq/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDateTime, fmtGNF, pluriel } from "@/lib/format";
import type { ActionStatus, ActionTransition, ControlLevel, HsseqAction, Reminder } from "@/lib/hsseq-types";
import { Escaladee, JOURS_ESCALADE, Origine, Retard } from "./elements";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique, aProfil, aujourdhui, codeErreur, decaler, deposerPiece, joursEntre, messageErreur, useMoi, useReferentiels } from "./outils";

/** Seuil d'une action coûteuse quand les référentiels ne sont pas encore lus (§6). */
const SEUIL_DEFAUT = 50_000_000;

/** Hiérarchie des mesures, de la plus forte à la plus faible. */
const ORDRE_MAITRISE: readonly ControlLevel[] = ["elimination", "substitution", "engineering", "administrative", "ppe"];

const RELANCE: Record<Reminder["kind"], string> = {
  d_minus_7: "Relance à J-7",
  d0: "Relance le jour de l'échéance",
  weekly: "Relance hebdomadaire de retard",
  escalation: "Escalade au Directeur général",
};

/** La même, dans une phrase (« Prochaine : relance à J-7 le … »). */
const RELANCE_PHRASE: Record<Reminder["kind"], string> = {
  d_minus_7: "relance à J-7",
  d0: "relance le jour de l'échéance",
  weekly: "relance hebdomadaire de retard",
  escalation: "escalade au Directeur général",
};

type Fenetre = "close" | "verify" | "cancel" | "reopen" | "edit";

/**
 * Fiche d'une action : description, niveau de maîtrise, responsable, échéance, preuve attendue et
 * preuves jointes, validation de la direction, vérification d'efficacité, relances. Les commandes
 * suivent `transitions` et `rights` renvoyés par le noyau, qui refuse le reste.
 */
export function FicheAction({ id, onFermer }: { id: number; onFermer: () => void }) {
  const { data: a, error, mutate } = useApi<HsseqAction>(`/hsseq/actions/${id}`);
  const { data: ref } = useReferentiels();
  const moi = useMoi();
  const { mutate: muterListes } = useSWRConfig();
  const [message, setMessage] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  const rafraichirListes = () => muterListes((k) => typeof k === "string" && k.startsWith("/hsseq/actions?"));

  /** Écriture sur la fiche ; la réponse est l'action à jour. Lève l'erreur du noyau pour la fenêtre qui l'a lancée. */
  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte?: string): Promise<HsseqAction> {
    const maj = await apiSend<HsseqAction>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichirListes();
    setMessage(texte ? { tone: "ok", text: texte } : null);
    return maj;
  }

  async function transitionDirecte(t: ActionTransition, texte: string) {
    setOccupe(t);
    setMessage(null);
    try {
      await ecrire("POST", `/hsseq/actions/${id}/${t}`, {}, texte);
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Action impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  /** Dépose une preuve et relit la fiche ; lève l'erreur du noyau. */
  async function televerser(fichier: File) {
    await deposerPiece("action", id, fichier);
    await mutate();
  }

  async function deposer(fichier: File) {
    setOccupe("depot");
    setMessage(null);
    try {
      await televerser(fichier);
      setMessage({ tone: "ok", text: "Preuve jointe à l'action." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  if (!a) {
    return (
      <Panneau etiquette="Plan d'actions" titre="Action" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de l'action…" />}
      </Panneau>
    );
  }

  const seuil = ref?.costly_action_threshold ?? SEUIL_DEFAUT;
  const hsseq = aProfil(ref, "hsseq");
  const t = new Set(a.transitions);
  const attenteDirection = a.management_approval.required && !a.management_approval.approved_at && (a.status === "todo" || a.status === "in_progress");
  const retirable = (p: { created_by: { id: number } | null }) => a.rights.can_edit && (hsseq || (moi !== undefined && p.created_by?.id === moi.id));
  const verificationEchue = a.status === "to_verify" && a.verification_date !== null && a.verification_date <= aujourdhui();

  return (
    <Panneau
      etiquette="Plan d'actions"
      titre={a.reference}
      onFermer={onFermer}
      sousTitre={
        <>
          Créée le {fmtDate(a.created_at)}{a.created_by ? ` par ${a.created_by.name}` : ""}
        </>
      }
      tampons={
        <>
          <Tampon mot={STATUT_ACTION[a.status]} />
          {a.overdue && <Tampon mot="En retard" />}
          {a.overdue && a.days_overdue > JOURS_ESCALADE && <Escaladee />}
          {attenteDirection && <Tampon mot="À valider" />}
          {a.effective === true && <Tampon mot="Efficace" />}
          {a.effective === false && <Tampon mot="Non efficace" />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{a.description}</p>

      <Commandes>
        {t.has("approve") && (
          <Button
            variant="primary"
            loading={occupe === "approve"}
            onClick={async () => {
              const ok = await demanderConfirmation(
                `Valider l'action ${a.reference}, d'un coût estimé de ${fmtGNF(a.estimated_cost)} ? Au-delà de ${fmtGNF(seuil)}, la direction valide la dépense avant le démarrage.`,
                { titre: "Valider l'action coûteuse", action: "Valider" },
              );
              if (ok) await transitionDirecte("approve", "Action validée par la direction : son responsable peut la démarrer.");
            }}
          >
            <CheckCheck className="h-4 w-4" /> Valider la dépense
          </Button>
        )}
        {t.has("verify") && (
          <Button variant="primary" onClick={() => setFenetre("verify")}>
            Vérifier l&apos;efficacité
          </Button>
        )}
        {t.has("start") && (
          <Button variant={t.has("close") ? "secondary" : "primary"} loading={occupe === "start"} onClick={() => void transitionDirecte("start", "Action démarrée.")}>
            Démarrer
          </Button>
        )}
        {t.has("close") && (
          <Button variant="primary" onClick={() => setFenetre("close")}>
            Clore l&apos;action
          </Button>
        )}
        {a.rights.can_edit && (
          <Button onClick={() => setFenetre("edit")}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )}
        {t.has("reopen") && (
          <Button onClick={() => setFenetre("reopen")}>
            <RotateCcw className="h-4 w-4" /> Rouvrir
          </Button>
        )}
        {t.has("cancel") && (
          <Button variant="ghost" onClick={() => setFenetre("cancel")}>
            <XCircle className="h-4 w-4" /> Annuler l&apos;action
          </Button>
        )}
      </Commandes>

      {attenteDirection && (
        <Notice tone="warn">
          Action coûteuse : {fmtGNF(a.estimated_cost)} estimés, au-delà du seuil de {fmtGNF(seuil)}. La direction la valide avant son démarrage
          {t.has("approve") ? "." : " ; le démarrage reste fermé jusque-là."}
        </Notice>
      )}
      {a.status === "to_verify" && a.verification_date && (
        <Notice tone={verificationEchue ? "warn" : "accent"}>
          {verificationEchue
            ? `Vérification d'efficacité échue depuis le ${fmtDate(a.verification_date)} : le Responsable HSSEQ juge l'action efficace, ou la renvoie en cours avec une nouvelle échéance.`
            : `Action réalisée${a.done_at ? ` le ${fmtDate(a.done_at)}` : ""} : vérification d'efficacité à partir du ${fmtDate(a.verification_date)}, soit J+90 (dans ${pluriel(joursEntre(aujourdhui(), a.verification_date), "jour")}).`}
        </Notice>
      )}
      {a.overdue && a.days_overdue > JOURS_ESCALADE && (
        <Notice tone="danger">
          {pluriel(a.days_overdue, "jour")} de retard : l&apos;action est escaladée au Directeur général.
        </Notice>
      )}

      <Definitions
        lignes={[
          ["Origine", <Origine key="o" a={a} titre />],
          ["Niveau de maîtrise", a.control_level ? <Maitrise key="m" niveau={a.control_level} /> : "Non précisé"],
          ["Responsable", a.owner.name],
          [
            "Échéance",
            <span key="e" className="inline-flex flex-wrap items-baseline gap-x-2">
              {fmtDate(a.due_date)}
              {a.overdue && <Retard a={a} />}
            </span>,
          ],
          a.site && ["Site", a.site.name],
          ["Coût estimé", a.estimated_cost ? fmtGNF(a.estimated_cost) : "Non chiffré"],
          a.management_approval.approved_at && ["Validée par la direction", `${fmtDate(a.management_approval.approved_at)}${a.management_approval.approved_by ? `, ${a.management_approval.approved_by.name}` : ""}`],
          a.done_at && ["Réalisée le", fmtDate(a.done_at)],
          a.closed_at && ["Close le", fmtDate(a.closed_at)],
        ]}
      />

      <Rubrique
        titre="Preuve de réalisation"
        actions={
          a.rights.can_edit && (
            <span className="inline-flex items-center gap-2">
              {occupe === "depot" && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une preuve" accept={FORMATS_PIECE} onFile={(f) => void deposer(f)} />
            </span>
          )
        }
      >
        <p className="mb-3 rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">Preuve attendue : </span>
          {a.expected_evidence || "Non précisée."}
        </p>
        <Pieces
          pieces={a.evidence}
          retirable={retirable}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">Aucune preuve jointe : l&apos;action ne se clôt qu&apos;avec sa preuve (photo ou PDF).</p>}
        />
      </Rubrique>

      {(a.verification_required || a.verified_at) && (
        <Rubrique titre="Vérification d'efficacité à J+90">
          {a.verified_at ? (
            <div className="space-y-1.5 text-[13px]">
              <p className="flex flex-wrap items-center gap-2">
                {a.effective !== null && <Tampon mot={a.effective ? "Efficace" : "Non efficace"} />}
                <span className="text-muted">
                  Vérifiée le {fmtDate(a.verified_at)}
                  {a.verified_by ? ` par ${a.verified_by.name}` : ""}
                </span>
              </p>
              {a.verification_comment && <p className="leading-snug text-ink-2">{a.verification_comment}</p>}
              {a.effective === false && a.status === "in_progress" && <p className="leading-snug text-muted">Action jugée inefficace : elle est revenue en cours avec une nouvelle échéance.</p>}
            </div>
          ) : (
            <p className="text-[13px] leading-snug text-ink-2">
              Origine de criticité au seuil des paramètres (8 par défaut) : une fois l&apos;action réalisée, le Responsable HSSEQ vérifie son efficacité 90 jours plus tard
              {a.verification_date ? `, le ${fmtDate(a.verification_date)}.` : "."}
            </p>
          )}
        </Rubrique>
      )}

      <Relances a={a} />

      {a.history.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Historique ({a.history.length})</summary>
          <ol className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-ink-2">
            {[...a.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="text-muted">{fmtDateTime(h.at)}</span>, {h.by?.name ?? "Système"} : {h.action}
                {h.note ? ` (${h.note})` : ""}
                {h.field === "status" && h.old_value && h.new_value ? ` (de « ${libelleStatut(h.old_value)} » à « ${libelleStatut(h.new_value)} »)` : h.field === "due_date" && h.new_value ? ` (échéance au ${fmtDate(h.new_value)})` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}

      {fenetre === "close" && (
        <FenetreCloture
          a={a}
          televerser={televerser}
          retirable={retirable}
          onRetiree={() => void mutate()}
          onClose={() => setFenetre(null)}
          envoyer={() => ecrire("POST", `/hsseq/actions/${id}/close`, {}, a.verification_required ? "Action réalisée : vérification d'efficacité dans 90 jours." : "Action close.")}
        />
      )}
      {fenetre === "verify" && <FenetreVerification a={a} onClose={() => setFenetre(null)} envoyer={(corps, texte) => ecrire("POST", `/hsseq/actions/${id}/verify`, corps, texte)} />}
      {(fenetre === "cancel" || fenetre === "reopen") && (
        <FenetreMotif
          transition={fenetre}
          a={a}
          onClose={() => setFenetre(null)}
          envoyer={(reason) => ecrire("POST", `/hsseq/actions/${id}/${fenetre}`, { reason }, fenetre === "cancel" ? "Action annulée." : "Action rouverte : elle revient en cours.")}
        />
      )}
      {fenetre === "edit" && <FenetreModification a={a} hsseq={hsseq} onClose={() => setFenetre(null)} envoyer={(corps) => ecrire("PATCH", `/hsseq/actions/${id}`, corps, "Action mise à jour.")} />}
    </Panneau>
  );
}

function libelleStatut(v: string): string {
  return STATUT_ACTION[v as ActionStatus] ?? v;
}

function Commandes({ children }: { children: ReactNode }) {
  const liste = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!liste.length) return null;
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/** Niveau de maîtrise et sa place dans la hiérarchie des mesures (élimination la plus forte, EPI la plus faible). */
function Maitrise({ niveau }: { niveau: ControlLevel }) {
  const rang = ORDRE_MAITRISE.indexOf(niveau);
  return (
    <span className="inline-flex items-center gap-2" title="Hiérarchie des mesures : élimination, substitution, ingénierie, mesure administrative, équipement de protection">
      <span aria-hidden className="inline-flex items-end gap-[3px]">
        {ORDRE_MAITRISE.map((n, i) => (
          <span key={n} className={cx("w-[5px] rounded-[2px]", i === rang ? "bg-accent" : "bg-line-strong")} style={{ height: `${14 - i * 2}px` }} />
        ))}
      </span>
      {NIVEAU_MAITRISE[niveau]}
      <span className="sr-only">{`, niveau ${rang + 1} sur 5 de la hiérarchie des mesures, de la plus forte à la plus faible`}</span>
    </span>
  );
}

/** Prochaine relance du responsable d'une action ouverte : J-7, échéance, chaque semaine de retard, escalade après 30 jours. */
function prochaineRelance(a: HsseqAction): { date: string; kind: Reminder["kind"] } | null {
  if (a.status !== "todo" && a.status !== "in_progress") return null;
  const jour = aujourdhui();
  const j7 = decaler(a.due_date, -7);
  if (jour < j7) return { date: j7, kind: "d_minus_7" };
  if (jour < a.due_date) return { date: a.due_date, kind: "d0" };
  const retard = joursEntre(a.due_date, jour);
  const semaine = decaler(a.due_date, 7 * (Math.floor(retard / 7) + 1));
  const escalade = decaler(a.due_date, JOURS_ESCALADE + 1);
  if (retard <= JOURS_ESCALADE && escalade <= semaine) return { date: escalade, kind: "escalation" };
  return { date: semaine, kind: "weekly" };
}

function Relances({ a }: { a: HsseqAction }) {
  const prochaine = prochaineRelance(a);
  if (!a.reminders.length && !prochaine) return null;
  return (
    <Rubrique titre="Relances et escalade">
      {a.reminders.length > 0 && (
        <ol className="space-y-1.5 text-[13px]">
          {a.reminders.map((r, i) => (
            <li key={`${r.date}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className={cx("font-medium", r.kind === "escalation" ? "text-danger" : "text-ink")}>{RELANCE[r.kind]}</span>
              <span className="text-[12.5px] text-muted">{fmtDate(r.date)}</span>
              {r.recipients.length > 0 && <span className="text-[12.5px] text-muted">{r.recipients.map((x) => x.name).join(", ")}</span>}
            </li>
          ))}
        </ol>
      )}
      {prochaine && (
        <p className={cx("text-[12.5px] text-muted", a.reminders.length > 0 && "mt-2")}>
          Prochaine : {RELANCE_PHRASE[prochaine.kind]} le {fmtDate(prochaine.date)}.
        </p>
      )}
    </Rubrique>
  );
}

/* ─── Fenêtres ─────────────────────────────────────────────────────────── */

/** Erreur d'une fenêtre : le message du noyau, au-dessus des boutons. */
function ErreurFenetre({ texte }: { texte: string | null }) {
  return texte ? <Notice tone="danger">{texte}</Notice> : null;
}

/** Clôture : la preuve d'abord (refus « proof_required » sans elle), puis l'envoi. */
function FenetreCloture({
  a,
  televerser,
  retirable,
  onRetiree,
  onClose,
  envoyer,
}: {
  a: HsseqAction;
  televerser: (f: File) => Promise<void>;
  retirable: (p: { created_by: { id: number } | null }) => boolean;
  onRetiree: () => void;
  onClose: () => void;
  envoyer: () => Promise<unknown>;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const sansPreuve = a.evidence.length === 0;
  async function deposer(fichier: File) {
    setOccupe(true);
    setErreur(null);
    try {
      await televerser(fichier);
    } catch (e) {
      setErreur(messageErreur(e, "Dépôt impossible."));
    } finally {
      setOccupe(false);
    }
  }
  return (
    <Modal
      open
      title={`Clore l'action ${a.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={envoi}
            disabled={sansPreuve || occupe}
            onClick={async () => {
              setEnvoi(true);
              setErreur(null);
              try {
                await envoyer();
                onClose();
              } catch (e) {
                setErreur(codeErreur(e) === "proof_required" ? "Joignez une preuve de réalisation avant de clore l'action." : messageErreur(e, "Clôture impossible."));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            Clore l&apos;action
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">Preuve attendue : </span>
          {a.expected_evidence || "Non précisée."}
        </p>
        <div className="space-y-2.5">
          <Pieces pieces={a.evidence} retirable={retirable} onRetiree={onRetiree} onErreur={setErreur} vide={<p className="text-[13px] font-medium text-warn">Aucune preuve jointe : l&apos;action ne peut pas être close sans elle.</p>} />
          <div className="flex items-center gap-2">
            <FileButton small label={sansPreuve ? "Joindre la preuve" : "Joindre une autre pièce"} accept={FORMATS_PIECE} onFile={(f) => void deposer(f)} />
            {occupe && <span className="text-[12px] text-muted">Envoi…</span>}
          </div>
          <p className="text-[12px] text-muted">Photo JPEG ou PNG, ou PDF, 8 Mo au plus.</p>
        </div>
        {a.verification_required && (
          <p className="text-[13px] leading-snug text-ink-2">
            Origine de criticité 8 ou plus : l&apos;action passera « À vérifier », vérification d&apos;efficacité le {fmtDate(decaler(aujourdhui(), 90))}.
          </p>
        )}
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/** Vérification d'efficacité à J+90 : efficace, l'action est close ; inefficace, elle revient en cours avec une nouvelle échéance. */
function FenetreVerification({ a, onClose, envoyer }: { a: HsseqAction; onClose: () => void; envoyer: (corps: { effective: boolean; comment: string | null; new_due_date?: string }, texte: string) => Promise<unknown> }) {
  const [efficace, setEfficace] = useState<boolean | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [echeance, setEcheance] = useState(decaler(aujourdhui(), 30));
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const pret = efficace === true || (efficace === false && echeance > aujourdhui());
  return (
    <Modal
      open
      title={`Vérifier l'efficacité de ${a.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={envoi}
            disabled={!pret}
            onClick={async () => {
              if (efficace === null) return;
              setEnvoi(true);
              setErreur(null);
              try {
                await envoyer(
                  efficace ? { effective: true, comment: commentaire.trim() || null } : { effective: false, comment: commentaire.trim() || null, new_due_date: echeance },
                  efficace ? "Action jugée efficace : elle est close." : `Action jugée inefficace : elle revient en cours, échéance au ${fmtDate(echeance)}.`,
                );
                onClose();
              } catch (e) {
                setErreur(codeErreur(e) === "verification_too_early" ? messageErreur(e) : messageErreur(e, "Vérification impossible."));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            Enregistrer la vérification
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">L&apos;action a-t-elle supprimé ou réduit le risque ?</legend>
          {[
            { v: true, titre: "Efficace", aide: "L'action est close." },
            { v: false, titre: "Non efficace", aide: "L'action revient en cours, avec une nouvelle échéance." },
          ].map((o) => (
            <label key={o.titre} className={cx("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors", efficace === o.v ? "border-accent bg-accent-doux" : "border-line hover:border-line-strong")}>
              <input type="radio" name="efficace" className="mt-1 accent-[var(--accent)]" checked={efficace === o.v} onChange={() => setEfficace(o.v)} />
              <span>
                <span className="block text-sm font-semibold text-ink">{o.titre}</span>
                <span className="block text-[12.5px] text-muted">{o.aide}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Constat">
          <Textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Ce qui a été observé sur le terrain" />
        </Field>
        {efficace === false && (
          <Field label="Nouvelle échéance" hint="Postérieure à aujourd'hui.">
            <Input type="date" min={decaler(aujourdhui(), 1)} value={echeance} onChange={(e) => setEcheance(e.target.value)} required />
          </Field>
        )}
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/** Annulation ou réouverture (Responsable HSSEQ) : motif écrit obligatoire. */
function FenetreMotif({ transition, a, onClose, envoyer }: { transition: "cancel" | "reopen"; a: HsseqAction; onClose: () => void; envoyer: (reason: string) => Promise<unknown> }) {
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const annuler = transition === "cancel";
  return (
    <Modal
      open
      title={`${annuler ? "Annuler" : "Rouvrir"} l'action ${a.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Retour</Button>
          <Button
            variant={annuler ? "danger" : "primary"}
            loading={envoi}
            disabled={motif.trim().length < 5}
            onClick={async () => {
              setEnvoi(true);
              setErreur(null);
              try {
                await envoyer(motif.trim());
                onClose();
              } catch (e) {
                setErreur(messageErreur(e, annuler ? "Annulation impossible." : "Réouverture impossible."));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            {annuler ? "Annuler l'action" : "Rouvrir l'action"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-ink-2">
          {annuler ? "L'action annulée sort du plan ; le motif est journalisé." : "L'action revient « En cours » ; le motif est journalisé."}
        </p>
        <Field label="Motif (obligatoire)" hint="Cinq caractères au moins.">
          <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/** Mise à jour (responsable ou Responsable HSSEQ) ; responsable et échéance réservés au Responsable HSSEQ. */
function FenetreModification({ a, hsseq, onClose, envoyer }: { a: HsseqAction; hsseq: boolean; onClose: () => void; envoyer: (corps: Record<string, unknown>) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState({
    description: a.description,
    control_level: a.control_level ?? "administrative",
    expected_evidence: a.expected_evidence ?? "",
    estimated_cost: a.estimated_cost ? String(a.estimated_cost) : "",
    owner_id: String(a.owner.id),
    due_date: a.due_date,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const cout = f.estimated_cost.trim() === "" ? null : Math.round(Number(f.estimated_cost.replace(/\s/g, "")));
  const coutValide = cout === null || (Number.isFinite(cout) && cout >= 0);
  const seuil = ref?.costly_action_threshold ?? SEUIL_DEFAUT;
  // Le responsable actuel reste dans la liste, même s'il n'est plus proposé par les référentiels.
  // Un conducteur n'est pas responsable d'une action.
  const proposes = (ref?.owners ?? []).filter((o) => !o.driver);
  const responsables = proposes.some((o) => o.id === a.owner.id) ? proposes : [a.owner, ...proposes];

  function corps(): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    if (f.description.trim() !== a.description) c.description = f.description.trim();
    if (f.control_level !== a.control_level) c.control_level = f.control_level;
    if (f.expected_evidence.trim() !== (a.expected_evidence ?? "")) c.expected_evidence = f.expected_evidence.trim();
    if (cout !== a.estimated_cost) c.estimated_cost = cout;
    if (hsseq && Number(f.owner_id) !== a.owner.id) c.owner_id = Number(f.owner_id);
    if (hsseq && f.due_date !== a.due_date) c.due_date = f.due_date;
    return c;
  }

  return (
    <Modal
      open
      wide
      title={`Modifier l'action ${a.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={envoi}
            disabled={!f.description.trim() || !f.expected_evidence.trim() || !coutValide || !f.due_date}
            onClick={async () => {
              const c = corps();
              if (!Object.keys(c).length) return onClose();
              setEnvoi(true);
              setErreur(null);
              try {
                await envoyer(c);
                onClose();
              } catch (e) {
                setErreur(messageErreur(e));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Description" className="md:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Niveau de maîtrise" hint="De la mesure la plus forte (élimination) à la plus faible (équipement de protection).">
          <Select value={f.control_level} onChange={(e) => setF({ ...f, control_level: e.target.value as ControlLevel })} options={ORDRE_MAITRISE.map((n) => ({ value: n, label: NIVEAU_MAITRISE[n] }))} />
        </Field>
        <Field label="Coût estimé (GNF)" hint={`Au-delà de ${fmtGNF(seuil)}, la direction valide l'action avant son démarrage.`} error={coutValide ? undefined : "Montant invalide."}>
          <Input inputMode="numeric" value={f.estimated_cost} onChange={(e) => setF({ ...f, estimated_cost: e.target.value })} placeholder="Non chiffré" />
        </Field>
        <Field label="Preuve attendue" className="md:col-span-2">
          <Textarea className="min-h-[60px]" value={f.expected_evidence} onChange={(e) => setF({ ...f, expected_evidence: e.target.value })} />
        </Field>
        {hsseq ? (
          <>
            <Field label="Responsable">
              <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} options={responsables.map((o) => ({ value: o.id, label: o.name }))} />
            </Field>
            <Field label="Échéance">
              <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
            </Field>
          </>
        ) : (
          <p className="text-[12.5px] leading-snug text-muted md:col-span-2">Le responsable et l&apos;échéance se changent par le Responsable HSSEQ.</p>
        )}
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}
