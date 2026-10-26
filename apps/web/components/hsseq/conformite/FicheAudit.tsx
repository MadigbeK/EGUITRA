"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { CheckCheck, Pencil, Plus, RotateCcw, XCircle } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice, demanderConfirmation } from "@/components/ui";
import { Tampon } from "@/components/hsseq/commun";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";
import {
  Commandes,
  Historique,
  ListeConstats,
  REFERENTIEL,
  STATUT_AUDIT,
  TYPE_AUDITEUR,
  TamponConformite,
  auditEnRetard,
  deposerPreuve,
  lien,
  messageErreur,
  useRafraichir,
  type Droits,
  type Message,
} from "./commun";
import { FenetreAudit, FenetreConstat, FenetreMotif, FenetreRealisation } from "./fenetres";
import type { Audit, AuditStandard, AuditStatus, AuditorKind } from "./types";

type Fenetre = "edit" | "perform" | "reopen" | "cancel" | "constat";

/** Valeurs codées du journal d'un audit, en clair. */
function valeurAudit(champ: string, v: string): string {
  if (champ === "status") return STATUT_AUDIT[v as AuditStatus] ?? v;
  if (champ === "standard") return REFERENTIEL[v as AuditStandard]?.court ?? v;
  if (champ === "auditor_kind") return TYPE_AUDITEUR[v as AuditorKind] ?? v;
  return v;
}

/**
 * Fiche d'un audit : référentiel, périmètre, site, auditeur, dates, conclusion, constats et leurs
 * actions, rapport et pièces, journal. Les commandes suivent `transitions` et `rights` du noyau : le
 * Responsable HSSEQ déclare l'audit réalisé, le clôt (une fois chaque écart majeur couvert par une
 * action), le rouvre ou l'annule avec un motif, ajoute les constats.
 */
export function FicheAudit({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/audits/${id}`;
  const { data: a, error, mutate } = useApi<Audit>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  /** Écriture sur l'audit ; la réponse est la fiche à jour. Lève le refus du noyau pour la fenêtre qui l'a lancée. */
  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string): Promise<Audit> {
    const maj = await apiSend<Audit>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: texte });
    return maj;
  }

  async function clore(audit: Audit) {
    const ok = await demanderConfirmation(`Clore l'audit ${audit.reference} ? Ses constats ne se modifieront plus ; seul le Responsable HSSEQ le rouvre, avec un motif.`, { titre: "Clore l'audit", action: "Clore l'audit" });
    if (!ok) return;
    setOccupe("close");
    setMessage(null);
    try {
      await ecrire("POST", `${cle}/close`, {}, "Audit clos.");
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Clôture impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  async function deposer(fichier: File) {
    setOccupe("depot");
    setMessage(null);
    try {
      await deposerPreuve("audit", id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Pièce jointe à l'audit." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  if (!a) {
    return (
      <Panneau etiquette="Programme d'audits" titre="Audit" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de l'audit…" />}
      </Panneau>
    );
  }

  const t = new Set(a.transitions);
  const retard = auditEnRetard(a);
  const majeurs = a.findings_list.filter((f) => a.majors_without_action.includes(f.id));
  const lienConstat = (constat: number) => lien("constats", { audit: a.id, statut: "tous", constat });

  return (
    <Panneau
      etiquette="Programme d'audits"
      titre={a.reference}
      onFermer={onFermer}
      sousTitre={a.title}
      tampons={
        <>
          <TamponConformite mot={STATUT_AUDIT[a.status]} />
          {retard && <Tampon mot="En retard" />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Commandes>
        {t.has("perform") && (
          <Button variant="primary" onClick={() => setFenetre("perform")}>
            <CheckCheck className="h-4 w-4" /> Déclarer réalisé
          </Button>
        )}
        {t.has("close") && (
          <Button variant="primary" loading={occupe === "close"} onClick={() => void clore(a)}>
            Clore l&apos;audit
          </Button>
        )}
        {a.rights.can_edit && (
          <Button onClick={() => setFenetre("constat")}>
            <Plus className="h-4 w-4" /> Ajouter un constat
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
            <XCircle className="h-4 w-4" /> Annuler l&apos;audit
          </Button>
        )}
      </Commandes>

      {retard && <Notice tone="warn">Audit prévu le {fmtDate(a.planned_date)}, pas encore déclaré réalisé{droits.hsseq ? " : déclarez-le réalisé, ou annulez-le avec un motif." : "."}</Notice>}
      {majeurs.length > 0 && (
        <Notice tone="warn">
          {majeurs.length > 1 ? "Écarts majeurs sans action" : "Écart majeur sans action"} :{" "}
          {majeurs.map((f, i) => (
            <Fragment key={f.id}>
              {i > 0 && ", "}
              <Link href={lienConstat(f.id)} className="font-semibold text-accent underline-offset-2 hover:underline">
                {f.reference}
              </Link>
            </Fragment>
          ))}
          . L&apos;audit ne se clôt qu&apos;une fois chacun couvert par une action (ni annulée).
        </Notice>
      )}
      {a.status === "cancelled" && a.cancel_reason && <Notice tone="neutral">Audit annulé : {a.cancel_reason}</Notice>}

      <Definitions
        lignes={[
          ["Référentiel", REFERENTIEL[a.standard].long],
          a.partner && ["Client ou donneur d'ordre", a.partner.name],
          ["Site", a.site?.name ?? "Aucun : siège ou plusieurs sites"],
          ["Auditeur", a.auditor ? `${a.auditor.name}, ${TYPE_AUDITEUR[a.auditor_kind]}` : `À désigner (${TYPE_AUDITEUR[a.auditor_kind]})`],
          ["Prévu le", fmtDate(a.planned_date)],
          a.actual_date && ["Réalisé le", fmtDate(a.actual_date)],
          a.closed_at && ["Clos le", `${fmtDate(a.closed_at)}${a.closed_by ? `, par ${a.closed_by.name}` : ""}`],
          a.reopen_reason && ["Motif de la dernière réouverture", a.reopen_reason],
        ]}
      />

      <Rubrique titre="Périmètre">
        <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{a.scope || "Non précisé."}</p>
      </Rubrique>

      {(a.conclusion || a.status === "done" || a.status === "closed") && (
        <Rubrique titre="Conclusion">
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{a.conclusion || "Pas encore rédigée."}</p>
        </Rubrique>
      )}

      <Rubrique
        titre={`Constats (${a.findings_list.length})`}
        actions={
          a.findings_list.length > 0 && (
            <Link href={lien("constats", { audit: a.id, statut: "tous" })} className="text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline">
              Voir dans la liste
            </Link>
          )
        }
      >
        {a.findings_list.length ? (
          <ListeConstats constats={a.findings_list} href={lienConstat} />
        ) : (
          <p className="text-[13px] text-muted">{a.status === "planned" ? "Les constats se saisissent pendant ou après l'audit." : "Aucun constat."}</p>
        )}
      </Rubrique>

      <Rubrique
        titre="Rapport et pièces"
        actions={
          a.rights.can_edit && (
            <span className="inline-flex items-center gap-2">
              {occupe === "depot" && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une pièce" accept={FORMATS_PIECE} onFile={(f) => void deposer(f)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={a.attachments}
          retirable={() => a.rights.can_edit}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">Aucune pièce : plan d&apos;audit, rapport, feuille de présence (PDF ou photo, 8 Mo au plus).</p>}
        />
      </Rubrique>

      <Historique lignes={a.history} valeur={valeurAudit} />

      {fenetre === "edit" && <FenetreAudit audit={a} onClose={() => setFenetre(null)} envoyer={(corps) => ecrire("PATCH", cle, corps, "Audit mis à jour.")} />}
      {fenetre === "perform" && <FenetreRealisation audit={a} onClose={() => setFenetre(null)} envoyer={(jour) => ecrire("POST", `${cle}/perform`, { actual_date: jour }, "Audit déclaré réalisé : saisissez ses constats et sa conclusion.")} />}
      {fenetre === "constat" && <FenetreConstat titre={`Nouveau constat de l'audit ${a.reference}`} onClose={() => setFenetre(null)} envoyer={(corps) => ecrire("POST", `${cle}/findings`, corps, "Constat ajouté à l'audit.")} />}
      {fenetre === "reopen" && (
        <FenetreMotif
          titre={`Rouvrir l'audit ${a.reference}`}
          aide="L'audit revient « Réalisé » : constats, actions et conclusion se modifient de nouveau. Le motif est journalisé."
          action="Rouvrir l'audit"
          onClose={() => setFenetre(null)}
          envoyer={(reason) => ecrire("POST", `${cle}/reopen`, { reason }, "Audit rouvert.")}
        />
      )}
      {fenetre === "cancel" && (
        <FenetreMotif
          titre={`Annuler l'audit ${a.reference}`}
          aide="L'audit annulé sort du programme : il ne compte plus dans les audits planifiés. Le motif est journalisé."
          action="Annuler l'audit"
          danger
          onClose={() => setFenetre(null)}
          envoyer={(reason) => ecrire("POST", `${cle}/cancel`, { reason }, "Audit annulé.")}
        />
      )}
    </Panneau>
  );
}
