"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock, Download, Link2, MapPin, Paperclip, Pencil, Trash2, Users } from "@/components/icons";
import { Badge, Button, ErrorBox, FileButton, Input, Loading, Modal, Notice, cx } from "@/components/ui";
import { apiDownload, apiSend, apiUpload, messageErreur, useApi } from "@/lib/api-client";
import {
  LIBELLES_REPONSE,
  LIBELLES_STATUT,
  LIBELLES_VISIBILITE,
  jourDe,
  jourLong,
  lireInstant,
  plage,
  versApi,
  type DetailEvenement,
  type Portee,
  type Reponse,
} from "@/lib/agenda";
import { depuisSaisieHeure, fmtDateTime, versSaisieHeure } from "@/lib/format";

const TON_REPONSE: Record<Reponse, "ok" | "warn" | "danger" | "neutral"> = { accepted: "ok", tentative: "warn", declined: "danger", needs_action: "neutral" };

/**
 * Fiche d'un événement : détails selon ce que le compte peut lire, réponse (pour soi ou pour son mandant),
 * autre horaire proposé, pièces jointes, export iCalendar, modification et suppression (d'une occurrence,
 * de la suite ou de toute la série).
 */
export function DetailEvenement({ id, occurrence, onFermer, onModifier, onChange }: { id: number; occurrence: string | null; onFermer: () => void; onModifier: (d: DetailEvenement) => void; onChange: (message: string) => void }) {
  const chemin = `/agenda/events/${id}${occurrence ? `?occurrence=${encodeURIComponent(occurrence)}` : ""}`;
  const { data: d, error, mutate } = useApi<DetailEvenement>(chemin);
  const [commentaire, setCommentaire] = useState("");
  const [pour, setPour] = useState<number | null>(null);
  const [proposer, setProposer] = useState(false);
  const [debutPropose, setDebutPropose] = useState("");
  const [finProposee, setFinProposee] = useState("");
  const [supprimer, setSupprimer] = useState(false);
  const [portee, setPortee] = useState<Portee>("this");
  const [message, setMessage] = useState<{ ton: "ok" | "danger"; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  async function agir(cle: string, fn: () => Promise<unknown>, ok: string, fermer = false) {
    setEnvoi(cle);
    setMessage(null);
    try {
      await fn();
      if (fermer) {
        onChange(ok);
        onFermer();
      } else {
        setMessage({ ton: "ok", texte: ok });
        await mutate();
        onChange(ok);
      }
    } catch (e) {
      setMessage({ ton: "danger", texte: messageErreur(e) });
    } finally {
      setEnvoi(null);
    }
  }

  const repondre = (state: Reponse) =>
    agir(`r-${state}`, () => apiSend("POST", `/agenda/events/${id}/respond`, { state, comment: commentaire, scope: d?.recurring ? portee : "all", occurrence: d?.occurrence, for_user_id: pour ?? undefined }), "Réponse enregistrée.");

  const titre = d ? d.title : "Événement";
  const moi = d?.attendees.find((a) => a.me);
  const pourQui = pour ? d?.respond_for?.find((r) => r.user_id === pour) : null;
  return (
    <Modal open wide title={titre} onClose={onFermer}
      footer={d && d.view === "full" ? (
        <>
          <Button onClick={() => void apiDownload(`/agenda/events/${id}/ics${d.occurrence ? `?occurrence=${encodeURIComponent(d.occurrence)}` : ""}`, "evenement.ics").catch((e) => setMessage({ ton: "danger", texte: messageErreur(e) }))}>
            <Download className="h-4 w-4" /> Exporter (.ics)
          </Button>
          {d.can_edit && (
            <>
              <Button variant="danger" onClick={() => setSupprimer(true)}>
                <Trash2 className="h-4 w-4" /> Supprimer
              </Button>
              <Button variant="primary" onClick={() => onModifier(d)}>
                <Pencil className="h-4 w-4" /> Modifier
              </Button>
            </>
          )}
        </>
      ) : undefined}
    >
      {error && <ErrorBox error={error} onRetry={() => void mutate()} />}
      {!d && !error && <Loading label="Chargement de l'événement…" />}
      {d && (
        <div className="space-y-4 text-[13.5px]">
          {message && <Notice tone={message.ton}>{message.texte}</Notice>}
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 font-medium capitalize text-ink">
              <Clock className="h-4 w-4 text-muted" />
              {jourLong(d.allday && d.start_date ? d.start_date : jourDe(lireInstant(d.start)), true)}, {plage(d).toLowerCase()}
            </p>
            {d.recurrence && <p className="pl-6 text-muted">{d.recurrence.label}{d.exception ? " (occurrence modifiée)" : ""}</p>}
            {d.location && (
              <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted" /> {d.location}</p>
            )}
            {d.video_url && (
              <p className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted" />
                <a href={d.video_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline underline-offset-2">Rejoindre la visioconférence</a>
              </p>
            )}
          </div>
          {d.view !== "full" && (
            <Notice tone="accent">{d.view === "busy" ? "Occupation sans détail : l'agenda ne vous est partagé que pour les disponibilités, ou l'événement est privé." : "Événement confidentiel : seul le titre vous est montré."}</Notice>
          )}
          {d.view === "full" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {d.privacy && <Badge>{LIBELLES_VISIBILITE[d.privacy]}</Badge>}
                <Badge>{LIBELLES_STATUT[d.show_as]}</Badge>
                {d.categories.map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-[12px]">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </span>
                ))}
                {d.resource_ids?.map((r) => <Badge key={r.id} tone="accent">{r.name}</Badge>)}
              </div>
              {d.description && <p className="whitespace-pre-line rounded-xl bg-panel-2 px-3 py-2 text-ink">{d.description}</p>}
              {d.link && (
                <p>
                  {d.link.type} :{" "}
                  {d.link.readable && d.link.href ? <Link href={d.link.href} className="font-semibold text-accent underline underline-offset-2">{d.link.label}</Link> : <span className="text-muted">fiche que vous ne lisez pas</span>}
                </p>
              )}
              <div className="text-[12.5px] text-muted">
                {d.organizer && <p>Organisateur : {d.organizer.name}{d.organizer_inactive ? " (compte désactivé)" : ""}</p>}
                {d.created_by && <p>Créé par {d.created_by}{d.created_on_behalf ? ` pour le compte de ${d.created_on_behalf}` : ""}</p>}
                {d.modified_by && d.modified_at && <p>Modifié par {d.modified_by}{d.modified_on_behalf ? ` pour le compte de ${d.modified_on_behalf}` : ""}, le {fmtDateTime(d.modified_at)}</p>}
              </div>

              {d.attendees.length > 0 && (
                <section aria-label="Participants">
                  <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-ink-2"><Users className="h-4 w-4" /> Participants</h3>
                  <ul className="space-y-1">
                    {d.attendees.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel-2 px-2.5 py-1.5">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{a.name}</span>
                          {!a.required && <span className="text-muted"> (facultatif)</span>}
                          {a.comment && <span className="block text-[12px] text-muted">« {a.comment} »</span>}
                          {a.responded_by && <span className="block text-[11.5px] text-muted">Réponse de {a.responded_by}</span>}
                          {a.auto_declined && <span className="block text-[11.5px] text-warn">Refus d&apos;office : absent du bureau</span>}
                          {a.proposal && (
                            <span className="block text-[12px] text-accent">
                              Propose {plage({ start: a.proposal.start, stop: a.proposal.stop, allday: false }).toLowerCase()}
                              {d.can_edit && (
                                <button type="button" className="ml-2 font-semibold underline" onClick={() => void agir(`p-${a.id}`, () => apiSend("POST", `/agenda/events/${id}/proposals/${a.id}/accept`), "Horaire retenu.")}>
                                  Retenir
                                </button>
                              )}
                            </span>
                          )}
                        </span>
                        <Badge tone={TON_REPONSE[a.state]}>{LIBELLES_REPONSE[a.state]}</Badge>
                        {d.can_edit && a.kind !== "user" && (
                          <select aria-label={`Réponse reçue de ${a.name}`} className="rounded-lg border border-line bg-panel px-1.5 py-1 text-[12px]" value={a.state} onChange={(e) => void agir(`x-${a.id}`, () => apiSend("POST", `/agenda/events/${id}/attendees/${a.id}/response`, { state: e.target.value }), "Réponse notée.")}>
                            {(Object.keys(LIBELLES_REPONSE) as Reponse[]).map((k) => <option key={k} value={k}>{LIBELLES_REPONSE[k]}</option>)}
                          </select>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(moi || (d.respond_for && d.respond_for.length > 0)) && (
                <section aria-label="Votre réponse" className="rounded-xl border border-line p-3">
                  <h3 className="mb-2 text-[13px] font-semibold text-ink-2">
                    {pourQui ? `Répondre pour le compte de ${pourQui.name}` : "Votre réponse"}
                    {moi && !pourQui ? ` : ${LIBELLES_REPONSE[moi.state].toLowerCase()}` : ""}
                  </h3>
                  {d.respond_for && d.respond_for.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-3 text-[13px]">
                      {moi && (
                        <label className="inline-flex items-center gap-1.5"><input type="radio" name="pour" checked={pour === null} onChange={() => setPour(null)} /> Pour moi</label>
                      )}
                      {d.respond_for.map((r) => (
                        <label key={r.user_id} className="inline-flex items-center gap-1.5"><input type="radio" name="pour" checked={pour === r.user_id} onChange={() => setPour(r.user_id)} /> Pour {r.name} ({LIBELLES_REPONSE[r.state].toLowerCase()})</label>
                      ))}
                    </div>
                  )}
                  {d.recurring && (
                    <div className="mb-2 flex flex-wrap gap-3 text-[13px]">
                      <label className="inline-flex items-center gap-1.5"><input type="radio" name="portee-r" checked={portee === "this"} onChange={() => setPortee("this")} /> Cette occurrence</label>
                      <label className="inline-flex items-center gap-1.5"><input type="radio" name="portee-r" checked={portee === "all"} onChange={() => setPortee("all")} /> Toute la série</label>
                    </div>
                  )}
                  <Input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Commentaire (facultatif)" aria-label="Commentaire de la réponse" maxLength={500} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" loading={envoi === "r-accepted"} onClick={() => void repondre("accepted")}>Accepter</Button>
                    <Button size="sm" loading={envoi === "r-tentative"} onClick={() => void repondre("tentative")}>Provisoire</Button>
                    <Button size="sm" variant="danger" loading={envoi === "r-declined"} onClick={() => void repondre("declined")}>Refuser</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setProposer((v) => !v); setDebutPropose(versSaisieHeure(d.start)); setFinProposee(versSaisieHeure(d.stop)); }}>Proposer un autre horaire</Button>
                  </div>
                  {proposer && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Input type="datetime-local" value={debutPropose} onChange={(e) => setDebutPropose(e.target.value)} aria-label="Début proposé" className="w-56" />
                      <Input type="datetime-local" value={finProposee} onChange={(e) => setFinProposee(e.target.value)} aria-label="Fin proposée" className="w-56" />
                      <Button size="sm" onClick={() => {
                        const s = depuisSaisieHeure(debutPropose);
                        const e = depuisSaisieHeure(finProposee);
                        if (!s || !e) return setMessage({ ton: "danger", texte: "Indiquez le début et la fin proposés." });
                        void agir("proposer", () => apiSend("POST", `/agenda/events/${id}/propose`, { start: versApi(new Date(s)), stop: versApi(new Date(e)), comment: commentaire, occurrence: d.occurrence, for_user_id: pour ?? undefined }), "Proposition envoyée à l'organisateur.");
                        setProposer(false);
                      }}>Envoyer la proposition</Button>
                    </div>
                  )}
                </section>
              )}

              <section aria-label="Pièces jointes">
                <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-ink-2"><Paperclip className="h-4 w-4" /> Pièces jointes</h3>
                <ul className="space-y-1">
                  {d.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => void apiDownload(`/agenda/events/${id}/attachments/${a.id}`, a.name)}>{a.name}</button>
                      {d.can_edit && (
                        <button type="button" aria-label={`Retirer ${a.name}`} className="text-muted hover:text-danger" onClick={() => void agir(`a-${a.id}`, () => apiSend("DELETE", `/agenda/events/${id}/attachments/${a.id}`), "Pièce retirée.")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                  {d.attachments.length === 0 && <li className="text-[12.5px] text-muted">Aucune pièce jointe.</li>}
                </ul>
                {d.can_edit && (
                  <div className="mt-2">
                    <FileButton small label="Joindre un fichier" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(f) => {
                      const form = new FormData();
                      form.append("file", f);
                      void agir("piece", () => apiUpload(`/agenda/events/${id}/attachments`, form), "Pièce jointe ajoutée.");
                    }} />
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
      {d && supprimer && (
        <Modal open alerte title="Supprimer l'événement" onClose={() => setSupprimer(false)} footer={
          <>
            <Button onClick={() => setSupprimer(false)}>Annuler</Button>
            <Button variant="danger" loading={envoi === "suppr"} onClick={() => void agir("suppr", () => apiSend("DELETE", `/agenda/events/${id}?scope=${d.recurring ? portee : "all"}${d.occurrence ? `&occurrence=${encodeURIComponent(d.occurrence)}` : ""}`), "Événement supprimé.", true)}>Supprimer</Button>
          </>
        }>
          <div className="space-y-3 text-[13.5px]">
            <p>Les participants sont prévenus de l&apos;annulation.</p>
            {d.recurring && (
              <div className="space-y-1.5">
                {([["this", "Cette occurrence"], ["following", "Celle-ci et les suivantes"], ["all", "Toute la série"]] as const).map(([k, l]) => (
                  <label key={k} className={cx("flex items-center gap-2")}>
                    <input type="radio" name="portee-s" checked={portee === k} onChange={() => setPortee(k)} /> {l}
                  </label>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </Modal>
  );
}
