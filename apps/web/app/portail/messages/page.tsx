"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Clock, Download, FileText, Loader2, Lock, Mail, Paperclip, Send, Smartphone, X } from "@/components/icons";
import { Button, ErrorBox, FEUILLE, Loading, Notice, Textarea, cx } from "@/components/ui";
import { EnTete, FORMATS, FORMATS_TEXTE, heure, taille } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { Avatar, LienBouton, PasDeDossier, cleJour, libelleJour, messageErreur, telechargerPiece, useRetour, verifierFichier } from "@/components/portail/projet/outils";
import { apiGet, apiSend, apiUpload } from "@/lib/api-client";
import type { Attachment, DossierRef, Fil, MessageRow } from "@/lib/portail-types";

/** Écart au-delà duquel deux messages du même auteur ne sont plus regroupés. */
const REGROUPEMENT = 10 * 60_000;
/** Relecture des nouveaux messages, onglet visible. */
const RELECTURE = 20_000;

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

/** Messages réunis sans doublon, dans l'ordre du fil (date, puis ordre d'arrivée). */
function fusion(liste: MessageRow[], ajout: MessageRow[]): MessageRow[] {
  const parId = new Map(liste.map((m) => [m.id, m]));
  for (const m of ajout) parId.set(m.id, m);
  return [...parId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
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

function PieceJointe({ a, enCours, onTelecharger }: { a: Attachment; enCours: boolean; onTelecharger: (a: Attachment) => void }) {
  return (
    <button
      type="button"
      onClick={() => onTelecharger(a)}
      disabled={enCours}
      aria-busy={enCours || undefined}
      aria-label={`Télécharger ${a.name}${a.size ? `, ${taille(a.size)}` : ""}`}
      className="flex w-full max-w-[320px] items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2 text-left shadow-[0_1px_2px_rgb(16_36_31/0.05)] transition-colors hover:border-line-strong hover:bg-panel-2 disabled:opacity-70"
    >
      <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent-doux text-accent">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{a.name}</span>
        {a.size ? <span className="block text-[11.5px] text-muted">{taille(a.size)}</span> : null}
      </span>
      {enCours ? <Loader2 className="h-4 w-4 flex-none animate-spin text-muted" /> : <Download className="h-4 w-4 flex-none text-muted" />}
    </button>
  );
}

function Bulles({ g, telechargement, onTelecharger }: { g: Groupe; telechargement: number | null; onTelecharger: (a: Attachment) => void }) {
  return (
    <div className={cx("mb-3 flex gap-2", g.moi ? "justify-end" : "justify-start")}>
      {!g.moi && <Avatar nom={g.auteur} taille={32} plein={g.cabinet} className="mt-[22px]" />}
      <div className={cx("flex min-w-0 max-w-[86%] flex-col gap-1 sm:max-w-[72%]", g.moi ? "items-end" : "items-start")}>
        {!g.moi && (
          <span className="px-1 text-[12px] font-semibold text-ink-2">
            {g.auteur}
            {g.cabinet && <span className="font-normal text-muted"> · MB AxisPro Consulting</span>}
          </span>
        )}
        {g.messages.map((m, i) => {
          const dernier = i === g.messages.length - 1;
          return (
            <div key={m.id} className={cx("flex max-w-full flex-col gap-1", g.moi ? "items-end" : "items-start")}>
              <div
                className={cx(
                  "max-w-full rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed",
                  g.moi ? "bg-accent text-white shadow-[0_8px_18px_-12px_var(--accent-lueur)]" : "bg-panel-2 text-ink ring-1 ring-line",
                  dernier && (g.moi ? "rounded-br-md" : "rounded-bl-md"),
                )}
              >
                <p className="whitespace-pre-wrap break-words">
                  <TexteMessage texte={m.body} moi={g.moi} />
                </p>
                <time dateTime={m.date} className={cx("mt-0.5 block text-right text-[11px] tabular-nums", g.moi ? "text-white/90" : "text-muted")}>
                  {heure(m.date)}
                </time>
              </div>
              {m.attachments.length > 0 && (
                <ul className={cx("flex w-full flex-col gap-1.5", g.moi ? "items-end" : "items-start")} aria-label="Pièces jointes">
                  {m.attachments.map((a) => (
                    <li key={a.id} className={cx("flex w-full", g.moi ? "justify-end" : "justify-start")}>
                      <PieceJointe a={a} enCours={telechargement === a.id} onTelecharger={onTelecharger} />
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

/**
 * Fil d'un dossier : premier chargement (les 200 derniers messages), puis relecture des seuls nouveaux
 * messages toutes les 20 secondes et au retour sur l'onglet, page précédente à la demande. Les messages
 * reçus du noyau sont ensuite marqués lus (POST) : jusqu'au dernier reçu par une lecture, jamais au-delà
 * (son propre message envoyé ne doit pas faire passer pour lu un message du cabinet encore à venir).
 */
function useFil(chemin: string, onLus: () => void) {
  const [fil, setFil] = useState<Fil | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [erreurRelecture, setErreurRelecture] = useState<unknown>(null);
  const [erreurAnciens, setErreurAnciens] = useState<unknown>(null);
  const [anciens, setAnciens] = useState(false);
  const curseur = useRef(0);
  const marque = useRef(0);
  const relectureEnCours = useRef(false);
  // Lu par référence : un nouveau rappel du parent ne relance ni le chargement ni la relecture.
  const apresLecture = useRef(onLus);
  useEffect(() => {
    apresLecture.current = onLus;
  });

  const marquerLus = useCallback(async () => {
    const jusqua = curseur.current;
    if (jusqua <= marque.current || document.hidden) return;
    try {
      await apiSend("POST", `${chemin}/lu`, { message_id: jusqua });
      marque.current = Math.max(marque.current, jusqua);
      apresLecture.current();
    } catch {
      // Repris à la relecture suivante ; une coupure du réseau est signalée par celle-ci.
    }
  }, [chemin]);

  const recus = useCallback((messages: MessageRow[]) => {
    for (const m of messages) curseur.current = Math.max(curseur.current, m.id);
  }, []);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const f = await apiGet<Fil>(chemin);
      recus(f.messages);
      setFil(f);
      void marquerLus();
    } catch (e) {
      setErreur(e);
    }
  }, [chemin, recus, marquerLus]);

  const relire = useCallback(async () => {
    if (relectureEnCours.current || document.hidden) return;
    relectureEnCours.current = true;
    try {
      const f = await apiGet<Fil>(`${chemin}?after=${curseur.current}`);
      recus(f.messages);
      setFil((avant) => (avant ? { ...avant, consultant: f.consultant, closed: f.closed, messages: fusion(avant.messages, f.messages) } : avant));
      setErreurRelecture(null);
      void marquerLus();
    } catch (e) {
      setErreurRelecture(e);
    } finally {
      relectureEnCours.current = false;
    }
  }, [chemin, recus, marquerLus]);

  const plusAnciens = useCallback(async () => {
    const premier = fil?.messages[0]?.id;
    if (!premier) return;
    setAnciens(true);
    setErreurAnciens(null);
    try {
      const f = await apiGet<Fil>(`${chemin}?before=${premier}`);
      setFil((avant) => (avant ? { ...avant, more: f.more, messages: fusion(f.messages, avant.messages) } : avant));
    } catch (e) {
      setErreurAnciens(e);
    } finally {
      setAnciens(false);
    }
  }, [chemin, fil]);

  const ajouter = useCallback((m: MessageRow) => {
    setFil((avant) => (avant ? { ...avant, messages: fusion(avant.messages, [m]) } : avant));
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const pret = fil !== null;
  useEffect(() => {
    if (!pret) return;
    const minuteur = window.setInterval(() => void relire(), RELECTURE);
    const retour = () => {
      if (!document.hidden) void relire();
    };
    document.addEventListener("visibilitychange", retour);
    window.addEventListener("focus", retour);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", retour);
      window.removeEventListener("focus", retour);
    };
  }, [pret, relire]);

  return { fil, erreur, erreurRelecture, erreurAnciens, anciens, charger, relire, plusAnciens, ajouter };
}

function FilDuDossier({ dossier }: { dossier: DossierRef }) {
  const { rafraichir } = usePortail();
  const chemin = `/portail/dossiers/${dossier.id}/fil`;
  const { fil: data, erreur: error, erreurRelecture, erreurAnciens, anciens, charger, relire, plusAnciens, ajouter } = useFil(chemin, rafraichir);
  const { setRetour, bandeau } = useRetour();
  const [texte, setTexte] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [telechargement, setTelechargement] = useState<number | null>(null);
  const boite = useRef<HTMLDivElement>(null);
  const saisie = useRef<HTMLDivElement>(null);
  const enBas = useRef(true);
  const premier = useRef(true);
  const hauteurAvant = useRef<number | null>(null);

  const messages = data?.messages;
  const jours = useMemo(() => parJour(messages ?? []), [messages]);
  const nombre = messages?.length ?? 0;
  const dernierId = messages?.at(-1)?.id;

  // Messages plus anciens ajoutés en tête : la lecture reste à la même place.
  useLayoutEffect(() => {
    const el = boite.current;
    if (!el || hauteurAvant.current === null) return;
    el.scrollTop += el.scrollHeight - hauteurAvant.current;
    hauteurAvant.current = null;
  }, [nombre]);

  // Défilement vers le dernier message, sauf si le porteur relit plus haut.
  useEffect(() => {
    const el = boite.current;
    if (!el || !nombre) return;
    if (enBas.current) el.scrollTo({ top: el.scrollHeight, behavior: premier.current ? "auto" : "smooth" });
    premier.current = false;
  }, [nombre, dernierId]);

  if (error && !data) return <ErrorBox error={error} onRetry={() => void charger()} />;
  if (!data) return <Loading label="Chargement de vos échanges…" />;

  const consultant = data.consultant;

  async function envoyer() {
    if (envoi) return;
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
      ajouter(row);
      // Un message du cabinet arrivé juste avant l'envoi apparaît aussitôt.
      void relire();
      zone?.focus();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  async function telecharger(a: Attachment) {
    setTelechargement(a.id);
    try {
      await telechargerPiece(a.id, a.name);
    } catch (e) {
      setRetour({ tone: "danger", texte: `« ${a.name} » n'a pas pu être téléchargé : ${messageErreur(e)}` });
    } finally {
      setTelechargement(null);
    }
  }

  function precedents() {
    hauteurAvant.current = boite.current?.scrollHeight ?? null;
    void plusAnciens();
  }

  return (
    <div className="space-y-0">
      <EnTete surtitre="Échanges" titre="Messages" />

      {erreurRelecture !== null && (
        <div className="mb-3">
          <ErrorBox error={erreurRelecture} titre="Les nouveaux messages ne peuvent pas être relus pour l'instant." onRetry={() => void relire()} />
        </div>
      )}

      <section
        aria-label="Messagerie avec le cabinet"
        className={cx(FEUILLE, "flex h-[calc(100dvh-18.5rem)] min-h-[440px] flex-col overflow-hidden lg:h-[calc(100dvh-15rem)]")}
      >
        {/* Interlocuteur */}
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <Avatar nom={consultant?.name ?? "MB AxisPro Consulting"} taille={44} plein />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-ink">{consultant?.name ?? "L'équipe MB AxisPro Consulting"}</div>
            <div className="truncate text-[12.5px] text-muted">
              {consultant ? "Votre consultant MB AxisPro Consulting" : "Le cabinet vous répond ici"} · {dossier.reference}
            </div>
          </div>
          {consultant?.phone && (
            <LienBouton href={`tel:${consultant.phone.replace(/\s/g, "")}`} label={`Appeler ${consultant.name} au ${consultant.phone}`} className="px-3">
              <Smartphone className="h-4 w-4" />
              <span className="hidden sm:inline">{consultant.phone}</span>
            </LienBouton>
          )}
          <LienBouton href={`/portail/rendez-vous?dossier=${dossier.id}`} variant="ghost" className="hidden md:inline-flex">
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
          className="min-h-0 flex-1 overflow-y-auto bg-panel-2 px-3 pb-4 sm:px-6"
        >
          {data.more && (
            <div className="flex flex-col items-center gap-2 pt-3">
              <Button variant="ghost" size="sm" loading={anciens} onClick={precedents}>
                {!anciens && <ChevronUp className="h-4 w-4" />}
                Afficher les messages précédents
              </Button>
              {erreurAnciens !== null && <ErrorBox error={erreurAnciens} titre="Les messages précédents n'ont pas pu être chargés." onRetry={precedents} />}
            </div>
          )}
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
                  <Bulles key={g.cle} g={g} telechargement={telechargement} onTelecharger={(a) => void telecharger(a)} />
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
                <button type="button" onClick={() => setFichier(null)} disabled={envoi} aria-label={`Retirer la pièce jointe ${fichier.name}`} className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted hover:bg-panel hover:text-ink disabled:opacity-50">
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
                  disabled={envoi}
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

      {bandeau}
    </div>
  );
}

export default function Messagerie() {
  const { espace, dossier } = usePortail();
  if (espace && !espace.dossiers.length) return <PasDeDossier />;
  if (!dossier) return <Loading label="Chargement de vos échanges…" />;
  // Une clé par dossier : changer de dossier repart d'un fil vide, sans mélanger les messages.
  return <FilDuDossier key={dossier.id} dossier={dossier} />;
}
