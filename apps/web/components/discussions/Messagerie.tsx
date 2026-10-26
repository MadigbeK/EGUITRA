"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import useSWR, { mutate as rafraichir } from "swr";
import { ArrowUpRight, ChevronLeft, Paperclip, Plus, Search, Send, Undo2, Users, X } from "@/components/icons";
import { FORMATS, FORMATS_TEXTE, dateLongue, heure, taille } from "@/components/portail/commun";
import { Badge, Button, Empty, ErrorBox, Loading, Notice, Segmented, cx } from "@/components/ui";
import { ApiError, apiDownload, apiGet, apiSend, apiUpload, messageErreur, useApi } from "@/lib/api-client";
import {
  CLE_CONVERSATIONS,
  CLE_NON_LUS,
  OBJETS,
  RELECTURE_FIL_MS,
  RELECTURE_NON_LUS_MS,
  initiales,
  lireDiscret,
  moment,
  sansAccents,
  signalerMiseAJour,
  type Collegue,
  type Conversation,
  type DetailConversation,
  type Message,
  type NonLus,
  type PageMessages,
  type Relecture,
} from "@/lib/discussions";
import { pluriel } from "@/lib/format";
import { IconeDiscussion } from "./IconeDiscussion";

/**
 * Messagerie de la discussion interne, commune au panneau de l'en-tête (une vue à la fois) et à la page
 * /discussions (liste et fil côte à côte sur grand écran) : liste des conversations, nouvelle
 * conversation (recherche d'un collègue), fil avec saisie et pièces jointes, membres.
 */

export type Vue =
  | { ecran: "liste" }
  | { ecran: "nouvelle" }
  | { ecran: "fiche"; model: string; id: number }
  | { ecran: "fil"; id: number }
  | { ecran: "membres"; id: number };

export type Mode = "panneau" | "page";

const MAX_PIECES = 5;
const MAX_PIECE = 20 * 1024 * 1024;
const MAX_TEXTE = 5000;

const lireConversations = (cle: string) => lireDiscret<Conversation[]>(cle);

/** La liste des conversations et les non-lus de l'en-tête sont à relire (lecture, envoi, départ). */
function majListes() {
  void rafraichir(CLE_CONVERSATIONS);
  void rafraichir(CLE_NON_LUS);
  signalerMiseAJour();
}

function Avatar({ nom, sorte, petit }: { nom: string; sorte?: Conversation["kind"]; petit?: boolean }) {
  const dimension = petit ? "h-8 w-8 text-[11.5px]" : "h-10 w-10 text-[12.5px]";
  if (sorte === "group" || sorte === "object") {
    const I = sorte === "group" ? Users : IconeDiscussion;
    return (
      <span aria-hidden className={cx("grid flex-none place-items-center rounded-full bg-accent-doux text-accent", dimension)}>
        <I className={petit ? "h-4 w-4" : "h-[18px] w-[18px]"} />
      </span>
    );
  }
  return (
    <span aria-hidden className={cx("bg-accent grid flex-none place-items-center rounded-full font-display font-bold tracking-[0.04em] text-white", dimension)}>
      {initiales(nom)}
    </span>
  );
}

/** Titre d'une vue : il reçoit le focus quand la vue change (lecteurs d'écran, clavier). */
function TitreVue({ children, className, deuxLignes }: { children: ReactNode; className?: string; deuxLignes?: boolean }) {
  return (
    <h3 data-titre-vue="" tabIndex={-1} className={cx("min-w-0 font-display text-[16px] font-[620] leading-snug text-ink outline-none", deuxLignes ? "line-clamp-2 break-words" : "truncate", className)}>
      {children}
    </h3>
  );
}

/** Retour à la vue précédente ; `compact` (fil du panneau) : la flèche seule, le libellé reste lu. */
function Retour({ onClick, children = "Conversations", compact }: { onClick: () => void; children?: ReactNode; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={compact ? String(children) : undefined} className="-ml-1.5 inline-flex flex-none items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] font-semibold text-accent hover:bg-accent-doux">
      <ChevronLeft className="h-4 w-4" /> <span className={compact ? "sr-only" : "max-sm:sr-only"}>{children}</span>
    </button>
  );
}

export function Messagerie({ mode, vue, onVue }: { mode: Mode; vue: Vue; onVue: (v: Vue) => void }) {
  const racine = useRef<HTMLDivElement>(null);
  const cle = vue.ecran === "liste" || vue.ecran === "nouvelle" ? vue.ecran : `${vue.ecran}-${"id" in vue ? vue.id : ""}`;
  const premiere = useRef(true);

  // Changement de vue : le focus va à son titre (pas à l'ouverture, que le panneau gère).
  useEffect(() => {
    if (premiere.current) {
      premiere.current = false;
      return;
    }
    const racineEl = racine.current;
    const titre = racineEl?.querySelector<HTMLElement>("[data-vue-detail] [data-titre-vue]") ?? racineEl?.querySelector<HTMLElement>("[data-titre-vue]");
    titre?.focus();
  }, [cle]);

  const actif = vue.ecran === "fil" || vue.ecran === "membres" ? vue.id : null;
  const liste = <ListeConversations actif={actif} onOuvrir={(id) => onVue({ ecran: "fil", id })} onNouvelle={() => onVue({ ecran: "nouvelle" })} />;
  const detail =
    vue.ecran === "nouvelle" ? (
      <NouvelleConversation onRetour={() => onVue({ ecran: "liste" })} onOuverte={(id) => onVue({ ecran: "fil", id })} />
    ) : vue.ecran === "fiche" ? (
      <OuvertureFiche key={`${vue.model}-${vue.id}`} model={vue.model} id={vue.id} onRetour={() => onVue({ ecran: "liste" })} onOuverte={(id) => onVue({ ecran: "fil", id })} />
    ) : vue.ecran === "fil" ? (
      <Fil key={vue.id} id={vue.id} retour={mode === "panneau" ? "toujours" : "telephone"} onRetour={() => onVue({ ecran: "liste" })} onMembres={() => onVue({ ecran: "membres", id: vue.id })} />
    ) : vue.ecran === "membres" ? (
      <Membres key={vue.id} id={vue.id} onRetour={() => onVue({ ecran: "fil", id: vue.id })} onQuitte={() => onVue({ ecran: "liste" })} />
    ) : null;

  if (mode === "panneau") {
    return (
      <div ref={racine} className="flex min-h-0 flex-1 flex-col">
        {detail ?? liste}
      </div>
    );
  }
  return (
    <div ref={racine} className="grid min-h-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
      <section aria-label="Conversations" className={cx(CADRE, detail && "max-lg:hidden")}>
        {liste}
      </section>
      <section aria-label="Conversation" data-vue-detail="" className={cx(CADRE, !detail && "max-lg:hidden")}>
        {detail ?? (
          <div className="grid flex-1 place-items-center">
            <Empty title="Choisissez une conversation." hint="Ou ouvrez-en une nouvelle avec un collègue ou un groupe de collègues." />
          </div>
        )}
      </section>
    </div>
  );
}

// Hauteur : l'écran sous l'en-tête et le titre de la page, sans faire défiler la page sur grand écran.
const CADRE = "flex min-w-0 flex-col overflow-hidden rounded-[20px] bg-panel shadow-[var(--ombre-feuille)] h-[min(calc(100dvh-250px),820px)] min-h-[440px] max-lg:h-[calc(100dvh-170px)]";

/* ─── Liste des conversations ─────────────────────────────────────────── */

function ListeConversations({ actif, onOuvrir, onNouvelle }: { actif: number | null; onOuvrir: (id: number) => void; onNouvelle: () => void }) {
  const [arret, setArret] = useState(false);
  const { data, error, mutate } = useSWR<Conversation[], ApiError>(CLE_CONVERSATIONS, lireConversations, {
    refreshInterval: arret ? 0 : RELECTURE_NON_LUS_MS,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setArret(true);
    },
  });
  const [q, setQ] = useState("");
  const champId = useId();
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  const lignes = (data ?? []).filter((c) => mots.every((m) => sansAccents(`${c.title} ${c.members.map((p) => p.name).join(" ")}`).includes(m)));

  return (
    <>
      <div className="space-y-2.5 border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <TitreVue>Conversations</TitreVue>
          <Button size="sm" variant="primary" onClick={onNouvelle}>
            <Plus className="h-3.5 w-3.5" /> Nouvelle
          </Button>
        </div>
        <label htmlFor={champId} className="sr-only">
          Rechercher une conversation
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id={champId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Collègue, groupe, fiche…"
            className="min-h-9 w-full rounded-[10px] border border-line-champ bg-panel py-2 pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && !data ? (
          <div className="p-4">
            <ErrorBox error={error} onRetry={() => void mutate()} />
          </div>
        ) : !data ? (
          <Loading label="Chargement des conversations…" />
        ) : lignes.length === 0 ? (
          <Empty
            title={data.length ? "Aucune conversation ne correspond." : "Aucune conversation pour l'instant."}
            hint={data.length ? undefined : "Écrivez à un collègue, ouvrez un groupe, ou la discussion d'une fiche (bouton « Discussion » d'un dossier, d'un chantier, d'une rotation ou d'un bien)."}
          />
        ) : (
          <ul className="divide-y divide-line">
            {lignes.map((c) => (
              <LigneConversation key={c.id} c={c} actif={c.id === actif} onOuvrir={() => onOuvrir(c.id)} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function LigneConversation({ c, actif, onOuvrir }: { c: Conversation; actif: boolean; onOuvrir: () => void }) {
  const dernier = c.last_message;
  const apercu = !dernier
    ? "Aucun message pour l'instant."
    : dernier.withdrawn
      ? "Message retiré"
      : dernier.kind === "event"
        ? (dernier.excerpt ?? "")
        : `${dernier.mine ? "Vous" : (dernier.author ?? "")} : ${dernier.excerpt ?? ""}`;
  return (
    <li>
      <button
        type="button"
        onClick={onOuvrir}
        aria-current={actif ? "true" : undefined}
        className={cx("relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors", actif ? "bg-accent-doux/70" : "hover:bg-panel-2")}
      >
        {actif && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent-vif" />}
        <Avatar nom={c.title} sorte={c.kind} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cx("min-w-0 flex-1 truncate text-[14px] text-ink", c.unread > 0 ? "font-bold" : "font-semibold")}>{c.title}</span>
            {dernier && <span className="flex-none whitespace-nowrap text-[11.5px] text-muted">{moment(dernier.date)}</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={cx("min-w-0 flex-1 truncate text-[12.5px]", c.unread > 0 ? "text-ink" : "text-muted", dernier?.withdrawn && "italic")}>{apercu}</span>
            {c.unread > 0 && (
              <span className="min-w-[20px] flex-none rounded-full bg-accent-vif px-1.5 py-px text-center text-[11px] font-bold tabular text-white">
                {c.unread > 99 ? "99+" : c.unread}
                <span className="sr-only"> {c.unread > 1 ? "messages non lus" : "message non lu"}</span>
              </span>
            )}
          </span>
          {c.kind !== "direct" && <span className="mt-0.5 block truncate text-[11.5px] text-muted">{c.kind === "object" ? "Discussion de la fiche" : pluriel(c.members_count, "membre")}</span>}
        </span>
      </button>
    </li>
  );
}

/* ─── Recherche d'un collègue ─────────────────────────────────────────── */

function useCollegues(q: string) {
  const [resultat, setResultat] = useState<{ q: string; liste: Collegue[] } | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  useEffect(() => {
    let actif = true;
    const minuteur = window.setTimeout(() => {
      apiGet<Collegue[]>(`/chat/users?q=${encodeURIComponent(q.trim())}`)
        .then((liste) => {
          if (!actif) return;
          setErreur(null);
          setResultat({ q, liste });
        })
        .catch((e: unknown) => actif && setErreur(e));
    }, q ? 250 : 0);
    return () => {
      actif = false;
      window.clearTimeout(minuteur);
    };
  }, [q]);
  return { liste: resultat?.liste, enCours: resultat?.q !== q, erreur };
}

function RechercheCollegue({ choisis, onChoisir, exclus = [], multiple, label = "Rechercher un collègue" }: { choisis?: number[]; onChoisir: (c: Collegue) => void; exclus?: number[]; multiple?: boolean; label?: string }) {
  const [q, setQ] = useState("");
  const { liste, enCours, erreur } = useCollegues(q);
  const champId = useId();
  const listeId = useId();
  const proposes = (liste ?? []).filter((c) => !exclus.includes(c.id));
  return (
    <div className="space-y-2">
      <label htmlFor={champId} className="block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          id={champId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-controls={listeId}
          placeholder="Nom ou identifiant"
          autoComplete="off"
          className="min-h-9 w-full rounded-[10px] border border-line-champ bg-panel py-2 pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
      </div>
      <p className="text-[11.5px] leading-snug text-muted">Seuls les collègues qui partagent au moins une société avec vous sont proposés.</p>
      {erreur ? <ErrorBox error={erreur} /> : null}
      <ul id={listeId} aria-label="Collègues" aria-busy={enCours || undefined} className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {!liste && !erreur ? (
          <li className="px-3 py-3 text-[13px] text-muted">Recherche…</li>
        ) : proposes.length === 0 ? (
          <li className="px-3 py-3 text-[13px] text-muted">{q.trim() ? `Aucun collègue ne correspond à « ${q.trim()} ».` : "Aucun collègue à proposer."}</li>
        ) : (
          proposes.map((c) => {
            const pris = choisis?.includes(c.id) ?? false;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChoisir(c)}
                  aria-pressed={multiple ? pris : undefined}
                  className={cx("flex w-full items-center gap-3 px-3 py-2 text-left transition-colors", pris ? "bg-accent-doux" : "hover:bg-panel-2")}
                >
                  <Avatar nom={c.name} petit />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">{c.name}</span>
                    <span className="block truncate text-[11.5px] text-muted">{c.companies.join(", ")}</span>
                  </span>
                  {multiple && <span className={cx("flex-none text-[12px] font-semibold", pris ? "text-accent" : "text-muted")}>{pris ? "Choisi" : "Ajouter"}</span>}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

/* ─── Nouvelle conversation ───────────────────────────────────────────── */

function NouvelleConversation({ onRetour, onOuverte }: { onRetour: () => void; onOuverte: (id: number) => void }) {
  const [sorte, setSorte] = useState<"direct" | "group">("direct");
  const [nom, setNom] = useState("");
  const [choisis, setChoisis] = useState<Collegue[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const nomId = useId();

  async function ouvrir(corps: Record<string, unknown>) {
    setEnvoi(true);
    setErreur(null);
    try {
      const c = await apiSend<DetailConversation>("POST", "/chat/conversations", corps);
      majListes();
      onOuverte(c.id);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  function basculer(c: Collegue) {
    setChoisis((liste) => (liste.some((x) => x.id === c.id) ? liste.filter((x) => x.id !== c.id) : [...liste, c]));
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Retour onClick={onRetour} />
        <TitreVue className="flex-1 text-right">Nouvelle conversation</TitreVue>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Segmented
          label="Sorte de conversation"
          value={sorte}
          onChange={(k) => {
            setSorte(k);
            setErreur(null);
          }}
          options={[
            { key: "direct", label: "À deux" },
            { key: "group", label: "Groupe" },
          ]}
        />
        {erreur && (
          <div role="alert">
            <Notice tone="danger">{erreur}</Notice>
          </div>
        )}
        {sorte === "direct" ? (
          <RechercheCollegue label="À qui écrire ?" onChoisir={(c) => !envoi && void ouvrir({ kind: "direct", user_id: c.id })} />
        ) : (
          <>
            <div>
              <label htmlFor={nomId} className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Nom du groupe
              </label>
              <input
                id={nomId}
                value={nom}
                maxLength={80}
                onChange={(e) => setNom(e.target.value)}
                placeholder="Clôture d'octobre, chantier de Kindia…"
                className="min-h-9 w-full rounded-[10px] border border-line-champ bg-panel px-3 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
            {choisis.length > 0 && (
              <ul aria-label="Membres choisis" className="flex flex-wrap gap-1.5">
                {choisis.map((c) => (
                  <li key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-panel-2 py-0.5 pl-2.5 pr-1 text-[12.5px] text-ink">
                    <span className="truncate">{c.name}</span>
                    <button type="button" onClick={() => basculer(c)} aria-label={`Retirer ${c.name}`} className="grid h-5 w-5 flex-none place-items-center rounded-full text-muted hover:bg-panel-3 hover:text-ink">
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <RechercheCollegue multiple label="Membres du groupe" choisis={choisis.map((c) => c.id)} onChoisir={basculer} />
            <Button variant="primary" className="w-full" loading={envoi} disabled={!nom.trim() || !choisis.length} onClick={() => void ouvrir({ kind: "group", name: nom, user_ids: choisis.map((c) => c.id) })}>
              Créer le groupe
            </Button>
            <p className="text-[11.5px] leading-snug text-muted">Vous en êtes le responsable : vous seul y ajoutez ou en retirez des membres. Chacun peut le quitter.</p>
          </>
        )}
      </div>
    </>
  );
}

/* ─── Discussion d'une fiche ──────────────────────────────────────────── */

function OuvertureFiche({ model, id, onRetour, onOuverte }: { model: string; id: number; onRetour: () => void; onOuverte: (id: number) => void }) {
  const [erreur, setErreur] = useState<unknown>(null);
  const rappel = useRef(onOuverte);
  useEffect(() => {
    rappel.current = onOuverte;
  });
  useEffect(() => {
    let actif = true;
    apiSend<DetailConversation>("POST", "/chat/objects", { model, id })
      .then((c) => {
        if (!actif) return;
        majListes();
        rappel.current(c.id);
      })
      .catch((e: unknown) => actif && setErreur(e));
    return () => {
      actif = false;
    };
  }, [model, id]);
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Retour onClick={onRetour} />
        <TitreVue className="flex-1 text-right">Discussion de la fiche</TitreVue>
      </div>
      <div className="p-4">
        {erreur ? (
          <ErrorBox error={erreur} titre={erreur instanceof ApiError && erreur.status === 403 ? "Fiche non ouverte à votre compte" : undefined} />
        ) : (
          <Loading label={`Ouverture de la discussion (${OBJETS[model]?.nature ?? "fiche"})…`} />
        )}
      </div>
    </>
  );
}

/* ─── Fil d'une conversation ──────────────────────────────────────────── */

interface EtatFil {
  messages: Message[];
  plus: boolean;
  repere: string;
  luAvant: number;
}

/** Fusionne des messages reçus (nouveaux ou modifiés) dans le fil, dans l'ordre, sans doublon. */
function fusionner(liste: Message[], recus: Message[]): Message[] {
  if (!recus.length) return liste;
  const parId = new Map(liste.map((m) => [m.id, m]));
  for (const m of recus) parId.set(m.id, m);
  return [...parId.values()].sort((a, b) => a.id - b.id);
}

function annonceDe(recus: Message[]): string {
  const autres = recus.filter((m) => m.kind === "message" && !m.mine && !m.withdrawn);
  if (!autres.length) return "";
  if (autres.length > 1) return `${autres.length} nouveaux messages.`;
  const m = autres[0]!;
  const texte = m.body?.trim() || (m.attachments.length ? `pièce jointe ${m.attachments.map((a) => a.name).join(", ")}` : "");
  return `Nouveau message de ${m.author?.name ?? "un collègue"} : ${texte.slice(0, 200)}`;
}

function Fil({ id, retour, onRetour, onMembres }: { id: number; retour: "toujours" | "telephone"; onRetour: () => void; onMembres: () => void }) {
  const { data: detail, error: erreurDetail, mutate: majDetail } = useApi<DetailConversation>(`/chat/conversations/${id}`);
  const [etat, setEtat] = useState<EtatFil | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [perdu, setPerdu] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [reponse, setReponse] = useState<Message | null>(null);
  const [anciens, setAnciens] = useState(false);
  const [enBas, setEnBas] = useState(true);
  const [nouveaux, setNouveaux] = useState(false);
  const etatRef = useRef<EtatFil | null>(null);
  const luRef = useRef(0);
  const enBasRef = useRef(true);
  const zone = useRef<HTMLDivElement>(null);
  const saisie = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    etatRef.current = etat;
  }, [etat]);

  // Accusé de lecture jusqu'au dernier message affiché, onglet visible seulement.
  const marquerLu = useCallback(() => {
    const dernier = etatRef.current?.messages.at(-1)?.id ?? 0;
    if (!dernier || dernier <= luRef.current || document.visibilityState !== "visible") return;
    luRef.current = dernier;
    lireDiscret<NonLus>(`/chat/conversations/${id}/read`, { method: "POST", body: { message_id: dernier } })
      .then((n) => {
        void rafraichir(CLE_NON_LUS, n, { revalidate: false });
        void rafraichir(CLE_CONVERSATIONS);
        signalerMiseAJour();
      })
      .catch(() => undefined);
  }, [id]);

  // Chargement : les 50 derniers messages.
  useEffect(() => {
    let actif = true;
    apiGet<PageMessages>(`/chat/conversations/${id}/messages`)
      .then((p) => {
        if (!actif) return;
        const e = { messages: p.messages, plus: p.has_more, repere: p.cursor, luAvant: p.last_read_id };
        etatRef.current = e;
        setEtat(e);
        marquerLu();
      })
      .catch((e: unknown) => actif && setErreur(e));
    return () => {
      actif = false;
    };
  }, [id, marquerLu]);

  // Relecture toutes les 5 secondes, onglet visible : messages après le dernier, retraits depuis le repère.
  const charge = etat !== null;
  useEffect(() => {
    if (!charge || perdu) return;
    let enVol = false;
    const relire = async () => {
      const e = etatRef.current;
      if (!e || enVol || document.visibilityState !== "visible") return;
      enVol = true;
      try {
        const dernier = e.messages.at(-1)?.id ?? 0;
        const r = await lireDiscret<Relecture>(`/chat/conversations/${id}/updates?after=${dernier}&since=${encodeURIComponent(e.repere)}`);
        const courant = etatRef.current;
        if (!courant) return;
        const neufs = r.messages.filter((m) => !courant.messages.some((x) => x.id === m.id));
        const suivant = { ...courant, messages: fusionner(courant.messages, [...r.messages, ...r.changed]), repere: r.cursor };
        etatRef.current = suivant;
        setEtat(suivant);
        if (neufs.length) {
          const texte = annonceDe(neufs);
          if (texte) setAnnonce(texte);
          if (neufs.some((m) => m.kind === "event")) void majDetail();
          if (!enBasRef.current) setNouveaux(true);
          marquerLu();
        }
      } catch (err) {
        if (err instanceof ApiError && [401, 403, 404].includes(err.status)) {
          setPerdu(err.status === 401 ? "Session expirée : la conversation n'est plus relue. Reconnectez-vous en effectuant une action." : "Cette conversation ne vous est plus ouverte.");
        }
      } finally {
        enVol = false;
      }
    };
    const minuteur = window.setInterval(() => void relire(), RELECTURE_FIL_MS);
    const surVisibilite = () => {
      if (document.visibilityState === "visible") {
        void relire();
        marquerLu();
      }
    };
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [charge, perdu, id, marquerLu, majDetail]);

  // Position dans le fil (lue, jamais imposée par une relecture : le fil s'ancre en bas tout seul).
  const surDefilement = () => {
    const el = zone.current;
    if (!el) return;
    const bas = Math.abs(el.scrollTop) < 40;
    enBasRef.current = bas;
    setEnBas(bas);
    if (bas) setNouveaux(false);
  };
  const allerEnBas = () => {
    const el = zone.current;
    if (el) el.scrollTop = 0;
    setNouveaux(false);
  };

  async function chargerAnciens() {
    const e = etatRef.current;
    const premier = e?.messages[0]?.id;
    if (!e || !premier) return;
    setAnciens(true);
    try {
      const p = await apiGet<PageMessages>(`/chat/conversations/${id}/messages?before=${premier}`);
      const courant = etatRef.current ?? e;
      const suivant = { ...courant, messages: fusionner(courant.messages, p.messages), plus: p.has_more };
      etatRef.current = suivant;
      setEtat(suivant);
    } catch (err) {
      setErreur(err);
    } finally {
      setAnciens(false);
    }
  }

  function ajouterEnvoye(m: Message) {
    const courant = etatRef.current;
    if (!courant) return;
    const suivant = { ...courant, messages: fusionner(courant.messages, [m]) };
    etatRef.current = suivant;
    luRef.current = Math.max(luRef.current, m.id);
    setEtat(suivant);
    setReponse(null);
    allerEnBas();
    majListes();
  }

  function remplacer(m: Message) {
    const courant = etatRef.current;
    if (!courant) return;
    const suivant = { ...courant, messages: fusionner(courant.messages, [m]) };
    etatRef.current = suivant;
    setEtat(suivant);
    majListes();
  }

  function repondre(m: Message) {
    setReponse(m);
    saisie.current?.focus();
  }

  const objet = detail?.object;
  const lienFiche = objet ? OBJETS[objet.model]?.lien(objet.id) : undefined;
  const premierNonLu = etat ? etat.messages.find((m) => m.id > etat.luAvant && !m.mine && m.kind === "message")?.id : undefined;

  if (erreurDetail || erreur) {
    return (
      <>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Retour onClick={onRetour} />
          <TitreVue className="flex-1 text-right">Conversation</TitreVue>
        </div>
        <div className="p-4">
          <ErrorBox error={erreurDetail ?? erreur} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className={cx("flex-none", retour === "telephone" && "lg:hidden")}>
          <Retour onClick={onRetour} compact={retour === "toujours"} />
        </div>
        <div className="min-w-0 flex-1">
          <TitreVue deuxLignes>{detail?.title ?? "Conversation"}</TitreVue>
          {detail ? (
            <p className="truncate text-[12px] text-muted">
              {detail.kind === "direct" ? "Conversation à deux" : detail.kind === "object" ? "Discussion de la fiche, ouverte à ses lecteurs" : pluriel(detail.members_count, "membre")}
            </p>
          ) : (
            <div className="n-squelette mt-1 h-3 w-32 rounded-full" />
          )}
        </div>
        {lienFiche && (
          <Link href={lienFiche} className="inline-flex flex-none items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-accent hover:bg-accent-doux" title="Ouvrir la fiche">
            Fiche <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
        {detail && detail.kind !== "direct" && (
          <button type="button" onClick={onMembres} className="inline-flex flex-none items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-ink-2 hover:bg-panel-3 hover:text-ink" aria-label={`Membres (${detail.members_count})`}>
            <Users className="h-4 w-4" />
            <span className="tabular">{detail.members_count}</span>
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {/* Fil ancré en bas (colonne inversée) : un message reçu paraît sans défilement imposé, donc sans
            événement que la déconnexion après inactivité prendrait pour un geste de l'utilisateur. */}
        <div ref={zone} onScroll={surDefilement} className="absolute inset-0 flex flex-col-reverse overflow-y-auto bg-panel-2/40 [overflow-anchor:none]">
          <div className="px-3 py-3 sm:px-4">
            {!etat ? (
              <Loading label="Chargement des messages…" />
            ) : (
              <>
                {etat.plus && (
                  <div className="mb-3 text-center">
                    <Button size="sm" variant="ghost" loading={anciens} onClick={() => void chargerAnciens()}>
                      Messages précédents
                    </Button>
                  </div>
                )}
                {etat.messages.length === 0 ? (
                  <Empty title="Aucun message pour l'instant." hint="Écrivez le premier : les membres le verront dans quelques secondes." />
                ) : (
                  <ol aria-label="Messages" className="space-y-2.5">
                    {etat.messages.map((m, i) => {
                      const precedent = etat.messages[i - 1];
                      const jour = !precedent || new Date(precedent.date).toDateString() !== new Date(m.date).toDateString();
                      return (
                        <Fragment key={m.id}>
                          {jour && (
                            <li aria-hidden className="flex items-center gap-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                              <span className="h-px flex-1 bg-line" />
                              {dateLongue(m.date, false)}
                              <span className="h-px flex-1 bg-line" />
                            </li>
                          )}
                          {m.id === premierNonLu && (
                            <li className="flex items-center gap-3 py-1 text-[11.5px] font-bold text-accent">
                              <span aria-hidden className="h-px flex-1 bg-accent-vif/50" />
                              Nouveaux messages
                              <span aria-hidden className="h-px flex-1 bg-accent-vif/50" />
                            </li>
                          )}
                          <Bulle m={m} groupe={detail?.kind !== "direct"} onRepondre={repondre} onRetire={remplacer} />
                        </Fragment>
                      );
                    })}
                  </ol>
                )}
              </>
            )}
          </div>
        </div>
        {nouveaux && !enBas && (
          <button type="button" onClick={allerEnBas} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-[12.5px] font-semibold text-accent-ink shadow-[0_8px_18px_-10px_var(--accent-lueur)]">
            Nouveaux messages ↓
          </button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {annonce}
      </p>
      {perdu && (
        <div className="border-t border-line px-4 py-2" role="status">
          <Notice tone="warn">{perdu}</Notice>
        </div>
      )}
      {detail && !perdu && (
        <Saisie id={id} detail={detail} reponse={reponse} onAnnulerReponse={() => setReponse(null)} onEnvoye={ajouterEnvoye} champ={saisie} />
      )}
    </>
  );
}

function Bulle({ m, groupe, onRepondre, onRetire }: { m: Message; groupe: boolean; onRepondre: (m: Message) => void; onRetire: (m: Message) => void }) {
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  if (m.kind === "event") {
    return (
      <li className="px-2 py-0.5 text-center text-[12px] italic leading-snug text-muted">
        {m.body} <time dateTime={m.date} className="not-italic">{heure(m.date)}</time>
      </li>
    );
  }

  async function retirer() {
    setEnvoi(true);
    setErreur(null);
    try {
      onRetire(await apiSend<Message>("POST", `/chat/messages/${m.id}/withdraw`));
      setConfirmer(false);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  async function telecharger(pieceId: number, nom: string) {
    setErreur(null);
    try {
      await apiDownload(`/chat/messages/${m.id}/files/${pieceId}`, nom);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  function allerA(id: number) {
    const cible = document.getElementById(`message-${id}`);
    cible?.scrollIntoView({ block: "center" });
    cible?.focus();
  }

  return (
    <li id={`message-${m.id}`} tabIndex={-1} className={cx("flex outline-none", m.mine ? "justify-end" : "justify-start")}>
      <div className={cx("min-w-0 max-w-[min(100%,560px)]", m.mine && "items-end")}>
        <div
          className={cx(
            "rounded-2xl px-3.5 py-2 shadow-[0_1px_2px_rgb(16_36_31/0.05)]",
            m.withdrawn ? "border border-dashed border-line bg-panel" : m.mine ? "rounded-br-md bg-accent-doux" : "rounded-bl-md border border-line bg-panel",
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
            {(groupe || !m.mine) && <span className="font-semibold text-ink">{m.mine ? "Vous" : (m.author?.name ?? "")}</span>}
            <time dateTime={m.date} className="text-muted" title={dateLongue(m.date)}>
              {heure(m.date)}
            </time>
          </div>
          {m.reply_to && !m.withdrawn && (
            <button type="button" onClick={() => allerA(m.reply_to!.id)} className="mt-1 block w-full rounded-lg border-l-[3px] border-accent-vif/60 bg-panel-2/80 px-2 py-1 text-left text-[12px] leading-snug text-ink-2 hover:bg-panel-3">
              <span className="font-semibold">En réponse à {m.reply_to.author ?? "un message"}</span>
              <span className="block truncate">{m.reply_to.withdrawn ? "Message retiré" : m.reply_to.excerpt}</span>
            </button>
          )}
          {m.withdrawn ? (
            <p className="mt-0.5 text-[13.5px] italic text-muted">Message retiré{m.mine ? " par vous" : " par son auteur"}.</p>
          ) : (
            m.body && <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{m.body}</p>
          )}
          {m.attachments.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {m.attachments.map((a) => (
                <li key={a.id} className="max-w-full">
                  <button
                    type="button"
                    onClick={() => void telecharger(a.id, a.name)}
                    title={`Télécharger ${a.name}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-[12.5px] font-medium text-ink transition-colors hover:border-accent-vif/50 hover:text-accent"
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
        {!m.withdrawn && (
          <div className={cx("mt-0.5 flex flex-wrap items-center gap-x-1 px-1 text-[11.5px]", m.mine ? "justify-end" : "justify-start")}>
            {confirmer ? (
              <>
                <span className="text-ink-2">Retirer ce message ?</span>
                <button type="button" disabled={envoi} onClick={() => void retirer()} className="rounded px-1.5 py-0.5 font-semibold text-danger hover:bg-danger-doux">
                  Retirer
                </button>
                <button type="button" onClick={() => setConfirmer(false)} className="rounded px-1.5 py-0.5 font-semibold text-muted hover:bg-panel-3">
                  Annuler
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => onRepondre(m)} className="rounded px-1.5 py-0.5 font-semibold text-muted hover:bg-panel-3 hover:text-ink" aria-label={`Répondre au message de ${m.mine ? "vous" : (m.author?.name ?? "")}, ${heure(m.date)}`}>
                  Répondre
                </button>
                {m.mine && (
                  <button type="button" onClick={() => setConfirmer(true)} className="rounded px-1.5 py-0.5 font-semibold text-muted hover:bg-panel-3 hover:text-ink" aria-label={`Retirer votre message de ${heure(m.date)}`}>
                    Retirer
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {erreur && (
          <p role="alert" className="mt-1 text-[12px] font-medium text-danger">
            {erreur}
          </p>
        )}
      </div>
    </li>
  );
}

/* ─── Saisie ──────────────────────────────────────────────────────────── */

function Saisie({ id, detail, reponse, onAnnulerReponse, onEnvoye, champ }: { id: number; detail: DetailConversation; reponse: Message | null; onAnnulerReponse: () => void; onEnvoye: (m: Message) => void; champ: RefObject<HTMLTextAreaElement | null> }) {
  const [texte, setTexte] = useState("");
  const [pieces, setPieces] = useState<File[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const fichiers = useRef<HTMLInputElement>(null);
  const champId = useId();
  const aideId = useId();
  const bloque = !detail.can.post;
  const vide = !texte.trim() && !pieces.length;

  function ajouter(liste: FileList | null) {
    if (!liste) return;
    const nouveaux = [...pieces, ...Array.from(liste)];
    if (fichiers.current) fichiers.current.value = "";
    const trop = nouveaux.find((f) => f.size > MAX_PIECE);
    if (trop) return setErreur(`${trop.name} : fichier trop volumineux (20 Mo au plus).`);
    if (nouveaux.length > MAX_PIECES) return setErreur(`${MAX_PIECES} pièces jointes au plus par message.`);
    setErreur(null);
    setPieces(nouveaux);
  }

  async function envoyer(e?: FormEvent) {
    e?.preventDefault();
    if (vide || envoi || bloque) return;
    setEnvoi(true);
    setErreur(null);
    const form = new FormData();
    form.set("body", texte.trim());
    if (reponse) form.set("reply_to", String(reponse.id));
    for (const f of pieces) form.append("file", f);
    try {
      const m = await apiUpload<Message>(`/chat/conversations/${id}/messages`, form);
      setTexte("");
      setPieces([]);
      onEnvoye(m);
      champ.current?.focus();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  }

  function touche(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Entrée envoie, Maj + Entrée passe à la ligne (pas pendant une composition de caractères).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void envoyer();
    }
  }

  if (bloque) {
    return (
      <div className="border-t border-line px-4 py-3">
        <Notice tone="neutral">{detail.post_blocked ?? "Vous ne pouvez plus écrire dans cette conversation."}</Notice>
      </div>
    );
  }

  return (
    <form onSubmit={envoyer} className="border-t border-line bg-panel px-3 py-3 sm:px-4">
      {erreur && (
        <p role="alert" className="mb-2 rounded-lg bg-danger-doux px-2.5 py-1.5 text-[12.5px] font-medium text-danger">
          {erreur}
        </p>
      )}
      {reponse && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-[3px] border-accent-vif/60 bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink-2">
          <Undo2 className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Réponse à {reponse.mine ? "vous-même" : (reponse.author?.name ?? "un message")}</span>
            <span className="block truncate">{reponse.body || (reponse.attachments.length ? "Pièce jointe" : "")}</span>
          </span>
          <button type="button" onClick={onAnnulerReponse} aria-label="Annuler la réponse" className="grid h-5 w-5 flex-none place-items-center rounded text-muted hover:bg-panel-3 hover:text-ink">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {pieces.length > 0 && (
        <ul aria-label="Pièces jointes du message" className="mb-2 flex flex-wrap gap-1.5">
          {pieces.map((f, i) => (
            <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-[12.5px] text-ink">
              <Paperclip className="h-3.5 w-3.5 flex-none text-muted" />
              <span className="truncate">{f.name}</span>
              <span className="flex-none text-muted">{taille(f.size)}</span>
              <button type="button" aria-label={`Retirer ${f.name}`} onClick={() => setPieces((l) => l.filter((_x, j) => j !== i))} className="grid h-5 w-5 flex-none place-items-center rounded text-muted hover:bg-panel-3 hover:text-ink">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <label className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-[10px] text-accent transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-accent-vif hover:bg-accent-doux" title="Joindre des fichiers">
          <Paperclip className="h-[18px] w-[18px]" />
          <input ref={fichiers} type="file" multiple accept={FORMATS} aria-label="Joindre des fichiers au message" className="sr-only" onChange={(e) => ajouter(e.target.files)} />
        </label>
        <label htmlFor={champId} className="sr-only">
          Votre message
        </label>
        <textarea
          id={champId}
          ref={champ}
          value={texte}
          rows={1}
          maxLength={MAX_TEXTE}
          aria-describedby={aideId}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={touche}
          placeholder="Votre message…"
          className="max-h-40 min-h-9 min-w-0 flex-1 resize-none rounded-[10px] border border-line-champ bg-panel px-3 py-2 text-sm leading-relaxed text-ink outline-none transition-[border-color,box-shadow] [field-sizing:content] placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
        <Button type="submit" variant="primary" loading={envoi} disabled={vide} aria-label="Envoyer le message" className="h-9 w-9 flex-none px-0">
          {!envoi && <Send className="h-4 w-4" />}
        </Button>
      </div>
      <p id={aideId} className="mt-1.5 text-[11px] leading-snug text-muted">
        Entrée pour envoyer, Maj + Entrée pour aller à la ligne. Pièces jointes : {FORMATS_TEXTE}
      </p>
    </form>
  );
}

/* ─── Membres ─────────────────────────────────────────────────────────── */

function Membres({ id, onRetour, onQuitte }: { id: number; onRetour: () => void; onQuitte: () => void }) {
  const { data: d, error, mutate } = useApi<DetailConversation>(`/chat/conversations/${id}`);
  const [nom, setNom] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ton: "ok" | "danger"; texte: string } | null>(null);
  const [retrait, setRetrait] = useState<number | null>(null);
  const [quitter, setQuitter] = useState(false);
  const [ajout, setAjout] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const nomId = useId();
  const presents = useMemo(() => d?.members.map((m) => m.id) ?? [], [d]);

  async function agir(appel: () => Promise<unknown>, ok?: string) {
    setEnvoi(true);
    setMessage(null);
    try {
      await appel();
      majListes();
      if (ok) setMessage({ ton: "ok", texte: ok });
      return true;
    } catch (e) {
      setMessage({ ton: "danger", texte: messageErreur(e) });
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  if (!d) {
    return (
      <>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Retour onClick={onRetour}>Conversation</Retour>
          <TitreVue className="flex-1 text-right">Membres</TitreVue>
        </div>
        <div className="p-4">{error ? <ErrorBox error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement des membres…" />}</div>
      </>
    );
  }
  const moi = d.members.find((m) => m.me);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Retour onClick={onRetour}>Conversation</Retour>
        <TitreVue className="flex-1 text-right">Membres ({d.members_count})</TitreVue>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {message && (
          <div role={message.ton === "danger" ? "alert" : "status"}>
            <Notice tone={message.ton}>{message.texte}</Notice>
          </div>
        )}
        {d.can.rename && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (nom?.trim()) void agir(() => apiSend("PATCH", `/chat/conversations/${id}`, { name: nom }).then(() => mutate()), "Groupe renommé.");
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor={nomId} className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Nom du groupe
              </label>
              <input
                id={nomId}
                value={nom ?? d.title}
                maxLength={80}
                onChange={(e) => setNom(e.target.value)}
                className="min-h-9 w-full rounded-[10px] border border-line-champ bg-panel px-3 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
            <Button type="submit" loading={envoi} disabled={!nom?.trim() || nom.trim() === d.title}>
              Renommer
            </Button>
          </form>
        )}
        <ul aria-label="Membres" className="divide-y divide-line rounded-xl border border-line">
          {d.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <Avatar nom={m.name} petit />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ink">
                  {m.name}
                  {m.me && <span className="font-normal text-muted"> (vous)</span>}
                </span>
                <span className="flex flex-wrap gap-1">
                  {m.owner && <Badge tone="accent">Responsable</Badge>}
                  {m.archived && <Badge>Compte archivé</Badge>}
                </span>
              </span>
              {d.can.remove && !m.me && (
                retrait === m.id ? (
                  <span className="flex flex-none items-center gap-1 text-[12px]">
                    <button type="button" disabled={envoi} onClick={() => void agir(() => apiSend("DELETE", `/chat/conversations/${id}/members/${m.id}`).then(() => mutate()), `${m.name} ne fait plus partie du groupe.`).then(() => setRetrait(null))} className="rounded px-1.5 py-0.5 font-semibold text-danger hover:bg-danger-doux">
                      Retirer
                    </button>
                    <button type="button" onClick={() => setRetrait(null)} className="rounded px-1.5 py-0.5 font-semibold text-muted hover:bg-panel-3">
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setRetrait(m.id)} className="flex-none rounded px-1.5 py-0.5 text-[12px] font-semibold text-muted hover:bg-panel-3 hover:text-ink" aria-label={`Retirer ${m.name} du groupe`}>
                    Retirer
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
        {d.can.add &&
          (ajout ? (
            <div className="space-y-2 rounded-xl border border-line p-3">
              <RechercheCollegue
                label="Ajouter un collègue"
                exclus={presents}
                onChoisir={(c) => void agir(() => apiSend("POST", `/chat/conversations/${id}/members`, { user_ids: [c.id] }).then(() => mutate()), `${c.name} a rejoint le groupe.`)}
              />
              <p className="text-[11.5px] leading-snug text-muted">Un membre ajouté lit tout l&apos;historique de la conversation.</p>
              <Button size="sm" variant="ghost" onClick={() => setAjout(false)}>
                Fermer
              </Button>
            </div>
          ) : (
            <Button onClick={() => setAjout(true)}>
              <Plus className="h-4 w-4" /> Ajouter des membres
            </Button>
          ))}
        {d.can.leave && moi && (
          <div className="border-t border-line pt-4">
            {quitter ? (
              <div className="space-y-2">
                <p className="text-[13px] text-ink-2">
                  {d.kind === "object" ? "Quitter la discussion de cette fiche ? Vous pourrez la rouvrir depuis la fiche." : "Quitter ce groupe ? Seul son responsable pourra vous y ajouter de nouveau."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" loading={envoi} onClick={() => void agir(() => apiSend("DELETE", `/chat/conversations/${id}/members/${moi.id}`)).then((ok) => ok && onQuitte())}>
                    Quitter
                  </Button>
                  <Button onClick={() => setQuitter(false)}>Annuler</Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setQuitter(true)}>
                Quitter la conversation
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
