"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ChevronLeft, Paperclip, Send } from "@/components/icons";
import { BadgeEtat, Etoiles, Fil } from "@/components/service-client/commun";
import { Button, Card, Etat, Notice, Textarea } from "@/components/ui";
import { apiSend, apiUpload, messageErreur, useApi } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { PIECES_ACCEPTEES, type FicheClient } from "@/lib/service-client";

/** Une demande vue par le client : échanges (jamais les notes internes), réponse, pièces, satisfaction. */
export default function DemandeClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate } = useApi<FicheClient>(`/espace-client/tickets/${id}`);
  const maj = (f: FicheClient) => void mutate(f, { revalidate: false });
  return (
    <div>
      <Link href="/espace-client" className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
        <ChevronLeft className="h-4 w-4" /> Mes demandes
      </Link>
      <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement de votre demande…">
        {(d) => (
          <div className="space-y-5">
            <header>
              <div className="text-[13px] font-semibold tabular text-muted">
                {d.name} · {d.kind_label} · {d.company.name}
              </div>
              <h1 className="mt-1 font-display text-[24px] font-[650] leading-tight text-ink">{d.subject}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                <BadgeEtat etat={d.state} libelle={d.state_label} />
                <span>Déposée le {fmtDateTime(d.date_open)}</span>
                <span>· Suivie par {d.handled_by}</span>
                {d.link?.label && <span>· {d.link.type} {d.link.label}</span>}
              </div>
            </header>
            {d.merged_into && <Notice tone="warn">Cette demande a été regroupée avec la demande {d.merged_into}, qui reprend tous vos échanges.</Notice>}
            {d.can.confirm && <Confirmer d={d} onFait={maj} />}
            {d.satisfaction.can_rate && <Avis d={d} onFait={maj} />}
            {d.satisfaction.score && (
              <Card title="Votre avis">
                <Etoiles valeur={d.satisfaction.score} />
                {d.satisfaction.comment && <p className="mt-2 whitespace-pre-line text-[13px] text-ink-2">« {d.satisfaction.comment} »</p>}
              </Card>
            )}
            <Card title="Échanges">
              <Fil messages={d.messages} base={`/espace-client/tickets/${d.id}`} interne={false} />
            </Card>
            {d.can.reply ? <Repondre d={d} onFait={maj} /> : <Notice tone="accent">Cette demande est close : pour une nouvelle question, déposez une nouvelle demande.</Notice>}
          </div>
        )}
      </Etat>
    </div>
  );
}

function Repondre({ d, onFait }: { d: FicheClient; onFait: (f: FicheClient) => void }) {
  const [texte, setTexte] = useState("");
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  async function envoyer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const form = new FormData();
      form.set("body", texte);
      for (const f of fichiers) form.append("files", f);
      onFait(await apiUpload<FicheClient>(`/espace-client/tickets/${d.id}/messages`, form));
      setTexte("");
      setFichiers([]);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Card title="Répondre">
      <Textarea rows={5} value={texte} onChange={(e) => setTexte(e.target.value)} maxLength={5000} aria-label="Votre message" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-accent">
          <Paperclip className="h-4 w-4" /> Joindre des pièces ({fichiers.length}) : PDF, photo, Word ou Excel, 10 Mo au plus
          <input type="file" multiple accept={PIECES_ACCEPTEES} className="sr-only" onChange={(e) => setFichiers(Array.from(e.target.files ?? []).slice(0, 5))} />
        </label>
        <Button variant="primary" loading={envoi} disabled={!texte.trim() && !fichiers.length} onClick={envoyer}>
          <Send className="h-4 w-4" /> Envoyer
        </Button>
      </div>
      {erreur && <p className="mt-2 text-[13px] font-semibold text-danger">{erreur}</p>}
    </Card>
  );
}

function Confirmer({ d, onFait }: { d: FicheClient; onFait: (f: FicheClient) => void }) {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <Notice tone="ok">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>Votre demande est résolue. Si tout est en ordre, confirmez-le ; sinon, répondez ci-dessous et elle sera reprise.</span>
        <Button
          size="sm"
          loading={envoi}
          onClick={async () => {
            setEnvoi(true);
            setErreur(null);
            try {
              onFait(await apiSend<FicheClient>("POST", `/espace-client/tickets/${d.id}/confirm`));
            } catch (e) {
              setErreur(messageErreur(e));
            } finally {
              setEnvoi(false);
            }
          }}
        >
          Confirmer la résolution
        </Button>
      </div>
      {erreur && <p className="mt-2 font-semibold text-danger">{erreur}</p>}
    </Notice>
  );
}

function Avis({ d, onFait }: { d: FicheClient; onFait: (f: FicheClient) => void }) {
  const [note, setNote] = useState<number | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <Card title="Votre avis sur notre réponse">
      <Etoiles valeur={note} onChange={setNote} taille="text-[28px]" />
      <Textarea rows={2} className="mt-3" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Un commentaire (facultatif)" maxLength={2000} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={!note}
          loading={envoi}
          onClick={async () => {
            setEnvoi(true);
            setErreur(null);
            try {
              onFait(await apiSend<FicheClient>("POST", `/espace-client/tickets/${d.id}/satisfaction`, { score: note, comment: commentaire }));
            } catch (e) {
              setErreur(messageErreur(e));
            } finally {
              setEnvoi(false);
            }
          }}
        >
          Donner mon avis
        </Button>
      </div>
      {erreur && <p className="mt-2 text-[13px] font-semibold text-danger">{erreur}</p>}
    </Card>
  );
}
