"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Clock, Download, FileText, Lock, Mail, Paperclip, Send, Smartphone, X } from "@/components/icons";
import { Button, ErrorBox, Loading, Notice, Textarea, cx } from "@/components/ui";
import { EnTete, FORMATS, FORMATS_TEXTE, heure, taille } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { Avatar, LienBouton, PasDeDossier, cleJour, libelleJour, messageErreur, telechargerPiece, verifierFichier } from "@/components/portail/projet/outils";
import { apiUpload, useApi } from "@/lib/api-client";
import type { Attachment, Fil, MessageRow } from "@/lib/portail-types";

/** Écart au-delà duquel deux messages du même auteur ne sont plus regroupés. */
const REGROUPEMENT = 10 * 60_000;

type Groupe = { cle: string; moi: boolean; cabinet: boolean; auteur: string; messages: MessageRow[] };
type Jour = { cle: string; libelle: string; groupes: Groupe[] };

function parJour(messages: MessageRow[]): Jour[] {
  const jours: Jour[] = [];
  for (const m of messages) {
    const cle = cleJour(m.date);
    let j = jours[jours.length - 1];
    if (!j || j.cle !== cle) {
      j = { cle, libelle: libelleJour(m.date), groupes: [] };
      jours.push(j);
    }
    const g = j.groupes[j.groupes.length - 1];
    const precedent = g?.messages[g.messages.length - 1];
    if (g && precedent && g.auteur === m.author && g.moi === m.from_me && new Date(m.date).getTime() - new Date(precedent.date).getTime() < REGROUPEMENT) {
      g.messages.push(m);
    } else {
      j.groupes.push({ cle: `g${m.id}`, moi: m.from_me, cabinet: !m.from_promoter, auteur: m.author, messages: [m] });
    }
  }
  return jours;
}

/** Texte d'un message : les adresses https deviennent des liens, le reste reste du texte. */
function TexteMessage({ texte, moi }: { texte: string; moi: boolean }) {
  const morceaux = texte.split(/(https:\/\/[^\s<>"]*[^\s<>".,;:!?)»])/g);
  return (
    <>
      {morceaux.map((m, i) =>
        i % 2 === 1 ? (
          <a key={i} href={m} target="_blank" rel="noopener noreferrer" className={cx("break-all font-medium underline underline-offset-2", moi ? "text-white" : "text-accent")}>
            {m}
          </a>
        ) : (
          <Fragment key={i}>{m}</Fragment>
        ),
      )}
    </>
  );
}

function PieceJointe({ a, onTelecharger }: { a: Attachment; onTelecharger: (a: Attachment) => void }) {
  return (
    <button
      type="button"
      onClick={() => onTelecharger(a)}
      aria-label={`Télécharger ${a.name}${a.size ? `, ${taille(a.size)}` : ""}`}
      className="flex w-full max-w-[320px] items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2 text-left shadow-[0_1px_2px_rgb(16_36_31/0.05)] transition-colors hover:border-line-strong hover:bg-panel-2"
    >
      <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent-doux text-accent">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{a.name}</span>
        {a.size ? <span className="block text-[11.5px] text-muted">{taille(a.size)}</span> : null}
      </span>
      <Download className="h-4 w-4 flex-none text-muted" />
    </button>
  );
}

function Bulles({ g, onTelecharger }: { g: Groupe; onTelecharger: (a: Attachment) => void }) {
  return (
    <div className={cx("mb-3 flex gap-2", g.moi ? "justify-end" : "justify-start")}>
      {!g.moi && <Avatar nom={g.auteur} taille={32} degrade={g.cabinet} className="mt-[22px]" />}
      <div className={cx("flex min-w-0 max-w-[86%] flex-col gap-1 sm:max-w-[72%]", g.moi ? "items-end" : "items-start")}>
        {!g.moi && (
          <span className="px-1 text-[12px] font-semibold text-ink-2">
            {g.auteur}
            {g.cabinet && <span className="font-normal text-muted"> · MB AxisPro</span>}
          </span>
        )}
        {g.messages.map((m, i) => {
          const dernier = i === g.messages.length - 1;
          return (
            <div key={m.id} className={cx("flex max-w-full flex-col gap-1", g.moi ? "items-end" : "items-start")}>
              <div
                className={cx(
                  "max-w-full rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed",
                  g.moi ? "n-degrade text-white shadow-[0_8px_18px_-12px_var(--accent-lueur)]" : "bg-panel-2 text-ink ring-1 ring-line",
                  dernier && (g.moi ? "rounded-br-md" : "rounded-bl-md"),
                )}
              >
                <p className="whitespace-pre-wrap break-words">
                  <TexteMessage texte={m.body} moi={g.moi} />
                </p>
                <time dateTime={m.date} className={cx("mt-0.5 block text-right text-[11px] tabular-nums", g.moi ? "text-white/75" : "text-muted")}>
                  {heure(m.date)}
                </time>
              </div>
              {m.attachments.length > 0 && (
                <ul className={cx("flex w-full flex-col gap-1.5", g.moi ? "items-end" : "items-start")} aria-label="Pièces jointes">
                  {m.attachments.map((a) => (
                    <li key={a.id} className={cx("flex w-full", g.moi ? "justify-end" : "justify-start")}>
                      <PieceJointe a={a} onTelecharger={onTelecharger} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ajusterHauteur(el: HTMLTextAreaElement | null | undefined) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

export default function Messagerie() {
  const { espace, dossier, rafraichir } = usePortail();
  const chemin = dossier ? `/portail/dossiers/${dossier.id}/fil` : null;
  const { data, error, mutate } = useApi<Fil>(chemin, { refreshInterval: 20_000, revalidateOnFocus: true });
  const [texte, setTexte] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const boite = useRef<HTMLDivElement>(null);
  const saisie = useRef<HTMLDivElement>(null);
  const enBas = useRef(true);
  const premier = useRef(true);

  const messages = data?.messages;
  const jours = useMemo(() => parJour(messages ?? []), [messages]);
  const nombre = messages?.length ?? 0;
  const dernierId = messages?.at(-1)?.id;

  // Nouveau dossier : on repart du bas du fil.
  useEffect(() => {
    enBas.current = true;
    premier.current = true;
  }, [chemin]);

  // Défilement vers le dernier message, sauf si le porteur relit plus haut.
  useEffect(() => {
    const el = boite.current;
    if (!el || !nombre) return;
    if (enBas.current) el.scrollTo({ top: el.scrollHeight, behavior: premier.current ? "auto" : "smooth" });
    premier.current = false;
  }, [nombre, dernierId]);

  // La lecture du fil marque les messages lus : le compteur du menu se remet à jour.
  useEffect(() => {
    if (dernierId !== undefined) rafraichir();
  }, [dernierId, rafraichir]);

  if (espace && !espace.dossiers.length) return <PasDeDossier />;
  if (error && !data) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!data || !dossier) return <Loading label="Chargement de vos échanges…" />;

  const consultant = data.consultant;

  async function envoyer() {
    if (!chemin || envoi) return;
    const corps = texte.trim();
    if (!corps && !fichier) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const form = new FormData();
      form.append("body", corps);
      if (fichier) form.append("file", fichier);
      const row = await apiUpload<MessageRow>(chemin, form);
      setTexte("");
      setFichier(null);
      const zone = saisie.current?.querySelector("textarea");
      if (zone) zone.style.height = "";
      enBas.current = true;
      await mutate((f) => (f ? { ...f, messages: [...f.messages.filter((m) => m.id !== row.id), row] } : f), { revalidate: false });
      zone?.focus();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  async function telecharger(a: Attachment) {
    try {
      await telechargerPiece(a.id, a.name);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <div className="space-y-0">
      <EnTete surtitre="Échanges" titre="Messages" />

      <section
        aria-label="Messagerie avec le cabinet"
        className="flex h-[calc(100dvh-18.5rem)] min-h-[440px] flex-col overflow-hidden rounded-[20px] bg-panel shadow-[var(--ombre-feuille)] lg:h-[calc(100dvh-15rem)]"
      >
        {/* Interlocuteur */}
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <Avatar nom={consultant?.name ?? "MB AxisPro"} taille={44} degrade />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-ink">{consultant?.name ?? "L'équipe MB AxisPro"}</div>
            <div className="truncate text-[12.5px] text-muted">
              {consultant ? "Votre consultant MB AxisPro" : "Le cabinet vous répond ici"} · {dossier.reference}
            </div>
          </div>
          {consultant?.phone && (
            <LienBouton href={`tel:${consultant.phone.replace(/\s/g, "")}`} label={`Appeler ${consultant.name} au ${consultant.phone}`} className="px-3">
              <Smartphone className="h-4 w-4" />
              <span className="hidden sm:inline">{consultant.phone}</span>
            </LienBouton>
          )}
          <LienBouton href="/portail/rendez-vous" variant="ghost" className="hidden md:inline-flex">
            <Clock className="h-4 w-4" />
            Rendez-vous
          </LienBouton>
        </header>

        {/* Fil */}
        <div
          ref={boite}
          role="log"
          aria-live="polite"
          aria-label="Messages échangés avec le cabinet"
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            enBas.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
          className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,var(--panel)_0%,var(--panel-2)_100%)] px-3 pb-4 sm:px-6"
        >
          {nombre === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <span aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-accent-doux text-accent">
                <Mail className="h-6 w-6" />
              </span>
              <p className="text-[15px] font-semibold text-ink">Aucun message pour l'instant.</p>
              <p className="max-w-sm text-[13px] leading-relaxed text-muted">
                {data.closed ? "Aucun échange n'a eu lieu sur ce dossier." : "Posez votre question ou partagez un document : votre consultant vous répond ici."}
              </p>
            </div>
          ) : (
            jours.map((j) => (
              <section key={j.cle} aria-label={j.libelle}>
                <div className="sticky top-0 z-[1] flex justify-center py-3">
                  <span className="rounded-full bg-panel/95 px-3 py-1 text-[11.5px] font-semibold text-muted shadow-[0_1px_2px_rgb(16_36_31/0.06)] ring-1 ring-line backdrop-blur">{j.libelle}</span>
                </div>
                {j.groupes.map((g) => (
                  <Bulles key={g.cle} g={g} onTelecharger={(a) => void telecharger(a)} />
                ))}
              </section>
            ))
          )}
        </div>

        {/* Saisie */}
        {data.closed ? (
          <div className="flex items-center gap-2.5 border-t border-line bg-panel-2 px-4 py-3.5 text-[13px] text-muted sm:px-5">
            <Lock className="h-4 w-4 flex-none" />
            Ce dossier est clos : la messagerie est en lecture seule.
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void envoyer();
            }}
            className="border-t border-line bg-panel px-3 py-3 sm:px-4"
          >
            {erreur && (
              <div className="mb-2">
                <Notice tone="danger">{erreur}</Notice>
              </div>
            )}
            {fichier && (
              <div className="mb-2 flex items-center gap-2.5 rounded-xl bg-accent-doux/70 px-3 py-2">
                <Paperclip className="h-4 w-4 flex-none text-accent" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{fichier.name}</span>
                <span className="flex-none text-[12px] text-muted">{taille(fichier.size)}</span>
                <button type="button" onClick={() => setFichier(null)} aria-label={`Retirer la pièce jointe ${fichier.name}`} className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted hover:bg-panel hover:text-ink">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div ref={saisie} className="flex items-end gap-2">
              <label
                title="Joindre un fichier"
                className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-xl text-muted transition-colors hover:bg-panel-3 hover:text-ink focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-vif"
              >
                <Paperclip className="h-5 w-5" />
                <input
                  type="file"
                  accept={FORMATS}
                  className="sr-only"
                  aria-label="Joindre un fichier au message"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const faute = verifierFichier(f);
                    if (faute) {
                      setErreur(faute);
                    } else {
                      setErreur(null);
                      setFichier(f);
                    }
                  }}
                />
              </label>
              <Textarea
                aria-label="Votre message au cabinet"
                value={texte}
                rows={1}
                maxLength={5000}
                placeholder="Écrivez votre message…"
                onChange={(e) => {
                  setTexte(e.target.value);
                  ajusterHauteur(e.currentTarget);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void envoyer();
                  }
                }}
                className="max-h-40 min-h-10 resize-none py-2"
              />
              <Button type="submit" variant="primary" loading={envoi} disabled={!texte.trim() && !fichier} aria-label="Envoyer le message" className="min-h-10 px-3">
                {!envoi && <Send className="h-4 w-4" />}
                <span className="hidden sm:inline">Envoyer</span>
              </Button>
            </div>
            <p className="mt-1.5 hidden pl-12 text-[11.5px] text-muted sm:block">Ctrl + Entrée pour envoyer. Pièce jointe : {FORMATS_TEXTE}</p>
          </form>
        )}
      </section>
    </div>
  );
}
