"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpRight, ChevronLeft, Lock, Paperclip, Send, X } from "@/components/icons";
import { OngletsPortail } from "@/components/portail/cabinet/OngletsPortail";
import { Coche, LectureSeule, RESERVE_CABINET, Recherche, correspond, messageErreur, useEcriture } from "@/components/portail/cabinet/outils";
import { FORMATS, FORMATS_TEXTE, dateLongue, heure, quand, taille } from "@/components/portail/commun";
import { Badge, Button, classesBouton, Empty, ErrorBox, FEUILLE, Loading, Notice, PageHeader, Segmented, Textarea, cx } from "@/components/ui";
import { apiDownload, apiUpload, useApi } from "@/lib/api-client";
import type { Attachment, Conversation, ConversationRow, MessageRow } from "@/lib/portail-types";

const CHEMIN = "/axispro/portail/messages";
const PANNEAU = cx(FEUILLE, "flex min-w-0 flex-col overflow-hidden lg:h-[min(78vh,840px)]");

export default function MessagesPortailPage() {
  return (
    <div>
      <PageHeader
        title="Messages des porteurs"
        subtitle="La messagerie de tous les dossiers ouverts au portail. Les notes internes restent entre consultants : le porteur ne les voit jamais."
      />
      <OngletsPortail />
      <Suspense fallback={<Loading label="Chargement des conversations…" />}>
        <Messagerie />
      </Suspense>
    </div>
  );
}

type Filtre = "toutes" | "non_lues" | "attente";

function Messagerie() {
  const params = useSearchParams();
  const router = useRouter();
  const ecriture = useEcriture();
  const choisi = Number(params.get("dossier")) || null;
  const { data: liste, error, mutate: recharger } = useApi<ConversationRow[]>("/axispro/portail/conversations", { refreshInterval: 30_000 });
  const [q, setQ] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("toutes");

  function ouvrir(id: number | null) {
    router.replace(id ? `${CHEMIN}?dossier=${id}` : CHEMIN, { scroll: false });
  }

  const toutes = liste ?? [];
  const nonLues = toutes.filter((r) => r.unread > 0).length;
  const enAttente = toutes.filter((r) => r.waiting).length;
  const rows = toutes.filter(
    (r) =>
      (filtre === "toutes" || (filtre === "non_lues" ? r.unread > 0 : r.waiting)) &&
      correspond(q, r.dossier.reference, r.dossier.name, r.dossier.promoter, r.dossier.consultant, ...r.portal_users),
  );
  const ligneChoisie = toutes.find((r) => r.dossier.id === choisi);

  return (
    <div className="space-y-4">
      <LectureSeule ecriture={ecriture}>Lecture seule : votre profil lit les échanges. Seul le profil cabinet répond aux porteurs et écrit des notes internes.</LectureSeule>
      {error && <ErrorBox error={error} onRetry={() => void recharger()} />}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,370px)_minmax(0,1fr)]">
        <section aria-label="Conversations" className={cx(PANNEAU, choisi !== null && "max-lg:hidden")}>
          <div className="space-y-2.5 border-b border-line px-4 pb-3 pt-4">
            <Recherche label="Rechercher une conversation" placeholder="Dossier, porteur, consultant" value={q} onChange={setQ} />
            <div className="-mx-1 overflow-x-auto px-1">
              <Segmented
                label="Conversations affichées"
                value={filtre}
                onChange={setFiltre}
                options={[
                  { key: "toutes", label: `Toutes (${toutes.length})` },
                  { key: "non_lues", label: `Non lues (${nonLues})` },
                  { key: "attente", label: `En attente (${enAttente})` },
                ]}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto max-lg:max-h-[70vh]">
            {!liste ? (
              !error && <Loading label="Chargement des conversations…" />
            ) : rows.length === 0 ? (
              <Empty title={toutes.length ? "Aucune conversation dans cette sélection." : "Aucune conversation pour l'instant."} hint={toutes.length ? undefined : "Les échanges apparaissent ici dès qu'un porteur a un compte sur le portail."} />
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <LigneConversation key={r.dossier.id} r={r} actif={r.dossier.id === choisi} onOuvrir={() => ouvrir(r.dossier.id)} />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-label="Fil de la conversation" className={cx(PANNEAU, !choisi && "max-lg:hidden")}>
          {choisi ? (
            <Fil
              key={choisi}
              dossierId={choisi}
              ecriture={ecriture}
              onRetour={() => ouvrir(null)}
              onLu={() => {
                if (ligneChoisie && ligneChoisie.unread > 0) void recharger();
              }}
              onEnvoye={() => void recharger()}
            />
          ) : (
            <div className="grid flex-1 place-items-center">
              <Empty title="Choisissez une conversation." hint="Les messages des porteurs de tous les dossiers arrivent ici ; ceux qui attendent une réponse sont signalés dans la liste." />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LigneConversation({ r, actif, onOuvrir }: { r: ConversationRow; actif: boolean; onOuvrir: () => void }) {
  const last = r.last_message;
  return (
    <li>
      <button
        type="button"
        onClick={onOuvrir}
        aria-current={actif ? "true" : undefined}
        className={cx("relative block w-full px-4 py-3 text-left transition-colors", actif ? "bg-accent-doux/70" : "hover:bg-panel-2")}
      >
        {actif && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent-vif" />}
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className={cx("flex-none text-[13.5px] text-ink", r.unread > 0 ? "font-bold" : "font-semibold")}>{r.dossier.reference}</span>
              <span className="truncate text-[13.5px] text-ink-2">{r.dossier.name}</span>
            </span>
            <span className="block truncate text-[12px] text-muted">
              {r.dossier.promoter}
              {r.dossier.consultant ? `, suivi par ${r.dossier.consultant}` : ", sans consultant"}
            </span>
          </span>
          <span className="flex flex-none flex-col items-end gap-1">
            {last && <span className="whitespace-nowrap text-[11.5px] text-muted">{quand(last.date)}</span>}
            {r.unread > 0 && (
              <span className="min-w-[20px] rounded-full bg-accent-vif px-1.5 py-px text-center text-[11px] font-bold tabular text-white">
                {r.unread}
                <span className="sr-only"> {r.unread > 1 ? "messages non lus" : "message non lu"}</span>
              </span>
            )}
          </span>
        </span>
        {last ? (
          <span className={cx("mt-1 line-clamp-2 block text-[12.5px] leading-snug", r.unread > 0 ? "text-ink" : "text-ink-2")}>
            <span className="font-semibold">{last.author} :</span> {last.body}
          </span>
        ) : (
          <span className="mt-1 block text-[12.5px] text-muted">Aucun message pour l&apos;instant.</span>
        )}
        {(r.waiting || r.dossier.state !== "open") && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {r.waiting && <Badge tone="warn">En attente de réponse</Badge>}
            {r.dossier.state === "closed" && <Badge>Dossier clos</Badge>}
            {r.dossier.state === "on_hold" && <Badge>Dossier suspendu</Badge>}
          </span>
        )}
      </button>
    </li>
  );
}

function jour(d: string) {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
}

function Fil({ dossierId, ecriture, onRetour, onLu, onEnvoye }: { dossierId: number; ecriture: boolean; onRetour: () => void; onLu: () => void; onEnvoye: () => void }) {
  const { data, error, mutate } = useApi<Conversation>(`/axispro/portail/conversations/${dossierId}`, { refreshInterval: 30_000, onSuccess: onLu });
  const zone = useRef<HTMLDivElement>(null);
  const [erreurPj, setErreurPj] = useState<string | null>(null);
  const nombre = data?.messages.length ?? 0;

  useEffect(() => {
    const el = zone.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nombre, dossierId]);

  async function telecharger(a: Attachment) {
    setErreurPj(null);
    try {
      await apiDownload(`/axispro/portail/documents/${a.id}/download`, a.name);
    } catch (e) {
      setErreurPj(messageErreur(e));
    }
  }

  const d = data?.dossier;
  return (
    <>
      <header className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
        <button type="button" onClick={onRetour} className="-ml-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-accent hover:bg-accent-doux lg:hidden">
          <ChevronLeft className="h-4 w-4" /> Conversations
        </button>
        <div className="min-w-0 flex-1 basis-64">
          {d ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[18px] font-[620] leading-snug text-ink">
                  {d.reference} <span className="font-normal text-ink-2">{d.name}</span>
                </h2>
                {d.current_gate && <Badge tone="accent">{`${d.current_gate.code} ${d.current_gate.name}`}</Badge>}
                {d.state === "closed" && <Badge>Dossier clos</Badge>}
                {d.state === "on_hold" && <Badge>Dossier suspendu</Badge>}
              </div>
              <p className="mt-1 text-[12.5px] leading-snug text-muted">
                Porteur : <span className="text-ink-2">{d.promoter}</span>
                {data.portal_users.length > 0 && (
                  <>
                    {". Comptes du portail : "}
                    {data.portal_users.map((u, i) => (
                      <Fragment key={u.id}>
                        {i > 0 && ", "}
                        <span className="text-ink-2" title={[u.phone, u.email].filter(Boolean).join(", ") || undefined}>
                          {u.name}
                        </span>
                      </Fragment>
                    ))}
                  </>
                )}
                {`. Consultant : ${d.consultant?.name ?? "non désigné"}.`}
              </p>
            </>
          ) : (
            <div className="n-squelette h-5 w-60 rounded-full" />
          )}
        </div>
        <Link href={`/axispro/dossiers/${dossierId}`} className={classesBouton("secondary", "sm")}>
          Fiche du dossier <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <div ref={zone} className="min-h-0 flex-1 overflow-y-auto bg-panel-2/40 px-4 py-4 max-lg:max-h-[60vh] sm:px-5" aria-live="polite">
        {error ? (
          <ErrorBox error={error} onRetry={() => void mutate()} />
        ) : !data ? (
          <Loading label="Chargement des messages…" />
        ) : data.messages.length === 0 ? (
          <Empty title="Aucun message dans ce dossier." hint="Écrivez le premier message au porteur : il sera prévenu sur son portail." />
        ) : (
          <ol className="space-y-3">
            {data.messages.map((m, i) => {
              const precedent = data.messages[i - 1];
              const nouveauJour = !precedent || jour(precedent.date) !== jour(m.date);
              return (
                <Fragment key={m.id}>
                  {nouveauJour && (
                    <li aria-hidden className="flex items-center gap-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                      <span className="h-px flex-1 bg-line" />
                      {dateLongue(m.date, false)}
                      <span className="h-px flex-1 bg-line" />
                    </li>
                  )}
                  <Bulle m={m} onTelecharger={telecharger} />
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>

      {erreurPj && (
        <div className="border-t border-line px-5 py-2">
          <Notice tone="danger">{erreurPj}</Notice>
        </div>
      )}
      <Saisie dossierId={dossierId} ecriture={ecriture} onEnvoye={() => Promise.all([mutate(), onEnvoye()])} />
    </>
  );
}

function Bulle({ m, onTelecharger }: { m: MessageRow; onTelecharger: (a: Attachment) => void }) {
  const cabinet = !m.from_promoter;
  return (
    <li className={cx("flex", cabinet ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "max-w-[min(100%,620px)] rounded-2xl px-4 py-2.5 shadow-[0_1px_2px_rgb(16_36_31/0.05)]",
          m.internal ? "border border-dashed border-warn/50 bg-warn-doux" : cabinet ? "rounded-br-md bg-accent-doux" : "rounded-bl-md border border-line bg-panel",
        )}
      >
        {m.internal && (
          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-bold text-warn">
            <Lock className="h-3.5 w-3.5" /> Note interne, invisible du porteur
          </div>
        )}
        <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
          <span className="font-semibold text-ink">{m.from_me ? "Vous" : m.author}</span>
          {!cabinet && <span className="text-muted">porteur</span>}
          <time dateTime={m.date} className="text-muted" title={dateLongue(m.date)}>
            {heure(m.date)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{m.body}</p>
        {m.attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {m.attachments.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onTelecharger(a)}
                  title={`Télécharger ${a.name}`}
                  className="inline-flex max-w-[280px] items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-[12.5px] font-medium text-ink transition-colors hover:border-accent-vif/50 hover:text-accent"
                >
                  <Paperclip className="h-3.5 w-3.5 flex-none" />
                  <span className="truncate">{a.name}</span>
                  {a.size ? <span className="flex-none text-muted">{taille(a.size)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function Saisie({ dossierId, ecriture, onEnvoye }: { dossierId: number; ecriture: boolean; onEnvoye: () => Promise<unknown> }) {
  const [texte, setTexte] = useState("");
  const [interne, setInterne] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const champFichier = useRef<HTMLInputElement>(null);
  const vide = !texte.trim() && !fichier;

  async function envoyer(e?: FormEvent) {
    e?.preventDefault();
    if (vide || envoi || !ecriture) return;
    setEnvoi(true);
    setErreur(null);
    const form = new FormData();
    form.set("body", texte.trim());
    if (interne) form.set("internal", "1");
    if (fichier) form.set("file", fichier);
    try {
      await apiUpload<MessageRow>(`/axispro/portail/conversations/${dossierId}`, form);
      setTexte("");
      setFichier(null);
      if (champFichier.current) champFichier.current.value = "";
      await onEnvoye();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  }

  function raccourci(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void envoyer();
    }
  }

  return (
    <form onSubmit={envoyer} className={cx("border-t px-4 py-3.5 transition-colors sm:px-5", interne ? "border-warn/40 bg-warn-doux/70" : "border-line bg-panel")}>
      {erreur && (
        <div className="mb-2.5">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      <label htmlFor={`message-${dossierId}`} className="sr-only">
        {interne ? "Note interne" : "Réponse au porteur"}
      </label>
      <Textarea
        id={`message-${dossierId}`}
        aria-label={interne ? "Note interne, invisible du porteur" : "Réponse au porteur"}
        value={texte}
        disabled={!ecriture}
        onChange={(e) => setTexte(e.target.value)}
        onKeyDown={raccourci}
        maxLength={5000}
        placeholder={!ecriture ? RESERVE_CABINET : interne ? "Note pour l'équipe du cabinet, invisible du porteur…" : "Votre réponse au porteur…"}
        className={cx("min-h-[72px]", interne && "border-warn/50")}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Coche checked={interne} onChange={setInterne} disabled={!ecriture} ariaLabel="Note interne, invisible du porteur">
          Note interne
        </Coche>
        <label className={cx("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold text-accent focus-within:outline focus-within:outline-2 focus-within:outline-accent-vif", ecriture ? "cursor-pointer hover:bg-accent-doux" : "cursor-not-allowed opacity-50")}>
          <Paperclip className="h-4 w-4" /> Joindre un fichier
          <input ref={champFichier} type="file" aria-label="Joindre un fichier au message" className="sr-only" accept={FORMATS} disabled={!ecriture} onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
        </label>
        {fichier && (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-[12.5px] text-ink">
            <Paperclip className="h-3.5 w-3.5 flex-none text-muted" />
            <span className="truncate">{fichier.name}</span>
            <span className="flex-none text-muted">{taille(fichier.size)}</span>
            <button
              type="button"
              aria-label="Retirer la pièce jointe"
              className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-panel-3 hover:text-ink"
              onClick={() => {
                setFichier(null);
                if (champFichier.current) champFichier.current.value = "";
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <span className="ml-auto hidden text-[11.5px] text-muted md:inline">Ctrl + Entrée pour envoyer</span>
        <Button type="submit" variant="primary" loading={envoi} disabled={vide || !ecriture} title={!ecriture ? RESERVE_CABINET : undefined}>
          {interne ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {interne ? "Enregistrer la note" : "Envoyer"}
        </Button>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
        {interne ? "La note et sa pièce jointe restent invisibles du porteur." : "Le porteur est prévenu sur son portail."} Pièces jointes : {FORMATS_TEXTE}
      </p>
    </form>
  );
}
