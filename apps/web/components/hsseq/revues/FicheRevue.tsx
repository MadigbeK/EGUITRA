"use client";

/**
 * Fiche d'une revue de direction (GET /hsseq/reviews/{id}), en pleine largeur : c'est le document de
 * travail de la séance. Elle suit le plan du compte rendu rendu par le noyau, rubrique par rubrique :
 * 1. tenue de la revue ; éléments d'entrée (2. suite de la revue précédente à 9. urgences, documents et
 * télématique) ; 10. compte rendu des échanges ; 11. décisions et actions ; 12. conclusions de la
 * direction ; puis les pièces et l'historique. Un sommaire mène à chaque rubrique.
 *
 * Parcours : préparer (éléments d'entrée rassemblés, rafraîchis à la demande, ordre du jour,
 * participants, dossier de séance en PDF), tenir (participants présents, éléments figés), rédiger le
 * compte rendu, inscrire les décisions et leurs actions au plan, conclure, clore ; la revue close se
 * rouvre par le seul Responsable HSSEQ, avec un motif. Les commandes suivent `transitions` et `rights`
 * servis par le noyau, qui refuse le reste ; un lecteur (administration, auditeur) n'en voit aucune.
 * L'auditeur lit les revues des sociétés de son compte : noms du personnel interne, jamais celui d'un
 * conducteur ; dans l'historique et les pièces, la fonction de l'auteur à la place de son nom.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Circle, CheckCircle2, Download, Pencil, RefreshCw, RotateCcw } from "@/components/icons";
import { Button, Etapes, Etat, FEUILLE, FileButton, Loading, Notice, Tag, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { Definitions, FORMATS_PIECE, Pieces, aujourdhui, joursEntre } from "@/components/hsseq/actions/outils";
import { apiDownload, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDateTime, pluriel } from "@/lib/format";
import type { Me } from "@/lib/types";
import { Historique, Rubrique, TexteLong } from "./briques";
import { Decisions, type EnvoiRevue } from "./Decisions";
import { ANCRES, ElementsEntree, EnTeteEntree } from "./ElementsEntree";
import { FenetreMotif, FenetrePreparation, FenetreTenue } from "./Fenetres";
import { TamponsRevue, dateLongue, dePeriode, deposerPieceRevue, echeanceRelative, messageRevue, nombreDeMois, nomCompte, nomPdf, periodeRevue, revueEnRetard, useRafraichirRevues } from "./outils";
import type { Review, ReviewInput } from "./types";

type Fenetre = "preparation" | "tenue" | "reouverture";

interface Message {
  tone: "ok" | "danger";
  text: ReactNode;
}

/* ─── Sommaire ────────────────────────────────────────────────────────── */

interface Entree {
  ancre: string;
  numero?: number;
  label: string;
  note?: string;
  alerte?: boolean;
}

function entreesSommaire(r: Review): Entree[] {
  const redige = (t: string | null) => Boolean(t?.trim());
  return [
    { ancre: ANCRES.tenue, numero: 1, label: "Tenue de la revue" },
    { ancre: ANCRES.entree, label: "Éléments d'entrée" },
    { ancre: ANCRES.suite, numero: 2, label: "Suite de la revue précédente" },
    { ancre: ANCRES.indicateurs, numero: 3, label: "Indicateurs" },
    { ancre: ANCRES.evenements, numero: 4, label: "Événements" },
    { ancre: ANCRES.actions, numero: 5, label: "État des actions" },
    { ancre: ANCRES.audits, numero: 6, label: "Audits et exigences" },
    { ancre: ANCRES.risques, numero: 7, label: "Risques" },
    { ancre: ANCRES.environnement, numero: 8, label: "Environnement et qualité" },
    { ancre: ANCRES.urgences, numero: 9, label: "Urgences et télématique" },
    { ancre: ANCRES.compteRendu, numero: 10, label: "Compte rendu", note: redige(r.minutes) ? "rédigé" : "à rédiger", alerte: r.state === "held" && !redige(r.minutes) },
    { ancre: ANCRES.decisions, numero: 11, label: "Décisions", note: String(r.decisions.length), alerte: r.state === "held" && !r.decisions.length },
    { ancre: ANCRES.conclusions, numero: 12, label: "Conclusions", note: redige(r.conclusion) ? "rédigées" : "à rédiger", alerte: r.state === "held" && !redige(r.conclusion) },
    { ancre: ANCRES.pieces, label: "Pièces jointes", note: String(r.attachments.length) },
    { ancre: ANCRES.historique, label: "Historique" },
  ];
}

/** Sommaire de la fiche : colonne collante au bureau, rangée défilante au téléphone. */
function Sommaire({ entrees }: { entrees: Entree[] }) {
  return (
    <>
      <nav aria-label="Sommaire de la revue" className="hidden lg:sticky lg:top-[84px] lg:block lg:self-start">
        <ol className="space-y-0.5 text-[13px]">
          {entrees.map((e) => (
            <li key={e.ancre}>
              <a href={`#${e.ancre}`} className={cx("flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-ink-2 transition-colors hover:bg-panel hover:text-ink", !e.numero && "pl-7 text-muted")}>
                {e.numero !== undefined && <span className="w-5 flex-none text-right text-[12px] tabular text-muted">{e.numero}</span>}
                <span className="min-w-0 flex-1">{e.label}</span>
                {e.note && <span className={cx("flex-none text-[11.5px] tabular", e.alerte ? "font-semibold text-warn" : "text-muted")}>{e.note}</span>}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <nav aria-label="Sommaire de la revue" className="-mx-1 overflow-x-auto pb-1 lg:hidden">
        <ol className="flex w-max gap-1.5 px-1">
          {entrees
            .filter((e) => e.numero !== undefined)
            .map((e) => (
              <li key={e.ancre}>
                <a href={`#${e.ancre}`} className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px] font-medium", e.alerte ? "border-warn/50 text-warn" : "border-line text-ink-2")}>
                  <span className="tabular text-muted">{e.numero}</span>
                  {e.label}
                </a>
              </li>
            ))}
        </ol>
      </nav>
    </>
  );
}

/* ─── Texte rédigé en séance ──────────────────────────────────────────── */

/**
 * Compte rendu ou conclusions : lecture, puis rédaction en place (PATCH du champ) tant que la revue
 * n'est pas close. Le brouillon reste à l'écran tant qu'il n'est pas enregistré, refus compris.
 */
function TexteRevue({ id, numero, titre, aide, valeur, modifiable, vide, placeholder, max, enregistrer }: { id: string; numero: number; titre: string; aide: string; valeur: string | null; modifiable: boolean; vide: string; placeholder: string; max: number; enregistrer: (texte: string | null) => Promise<unknown> }) {
  const [brouillon, setBrouillon] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer() {
    if (brouillon === null) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await enregistrer(brouillon.trim() || null);
      setBrouillon(null);
    } catch (e) {
      setErreur(messageRevue(e, "Enregistrement impossible."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Rubrique
      id={id}
      numero={numero}
      titre={titre}
      aide={aide}
      actions={
        modifiable &&
        brouillon === null && (
          <Button size="sm" onClick={() => setBrouillon(valeur ?? "")}>
            <Pencil className="h-3.5 w-3.5" /> {valeur?.trim() ? "Modifier" : "Rédiger"}
          </Button>
        )
      }
    >
      {brouillon === null ? (
        <TexteLong texte={valeur} vide={vide} />
      ) : (
        <div className="space-y-3">
          <Textarea className="min-h-[240px]" value={brouillon} onChange={(e) => setBrouillon(e.target.value)} placeholder={placeholder} maxLength={max} aria-label={titre} autoFocus />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] tabular text-muted">{`${brouillon.length.toLocaleString("fr-FR")} caractères sur ${max.toLocaleString("fr-FR")}`}</span>
            <span className="flex gap-2">
              <Button
                onClick={() => {
                  setBrouillon(null);
                  setErreur(null);
                }}
              >
                Annuler
              </Button>
              <Button variant="primary" loading={envoi} onClick={() => void envoyer()}>
                Enregistrer
              </Button>
            </span>
          </div>
          {erreur && <Notice tone="danger">{erreur}</Notice>}
        </div>
      )}
    </Rubrique>
  );
}

/* ─── Prochaine étape ─────────────────────────────────────────────────── */

/** Ce qu'il reste à faire pour clore une revue tenue, chaque point menant à sa rubrique. */
function AvantCloture({ r }: { r: Review }) {
  const points = [
    { fait: Boolean(r.minutes?.trim()), label: "Compte rendu des échanges", ancre: ANCRES.compteRendu },
    { fait: r.decisions.length > 0, label: r.decisions.length ? `Décisions (${r.decisions.length})` : "Au moins une décision", ancre: ANCRES.decisions },
    { fait: Boolean(r.conclusion?.trim()), label: "Conclusions de la direction", ancre: ANCRES.conclusions },
  ];
  const pret = points.every((p) => p.fait);
  return (
    <Notice tone={pret ? "ok" : "warn"}>
      <p className="font-semibold">{pret ? `Tout est prêt${INSECABLE}: la revue peut être close.` : `Avant de clore la revue${INSECABLE}:`}</p>
      <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
        {points.map((p) => (
          <li key={p.ancre}>
            <a href={`#${p.ancre}`} className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline">
              {p.fait ? <CheckCircle2 aria-hidden className="h-4 w-4 text-ok" /> : <Circle aria-hidden className="h-4 w-4 text-muted" />}
              {p.label}
              <span className="sr-only">{p.fait ? `${INSECABLE}: fait` : `${INSECABLE}: à faire`}</span>
            </a>
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/* ─── Fiche ───────────────────────────────────────────────────────────── */

export function FicheRevue({ id, onFermer }: { id: number; onFermer: () => void }) {
  const cle = `/hsseq/reviews/${id}`;
  const { data: r, error, mutate } = useApi<Review>(cle);
  const { data: moi } = useApi<Me>("/auth/me");
  const hsseq = useAutorise(["hsseq"]);
  const rafraichir = useRafraichirRevues();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const titreRef = useRef<HTMLHeadingElement>(null);
  const titreId = useId();

  // La fiche remplace la liste : la page remonte en haut, puis le titre prend le focus une fois la revue lue.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  const lue = Boolean(r);
  useEffect(() => {
    if (lue) titreRef.current?.focus({ preventScroll: true });
  }, [lue]);

  /** Écriture sur la revue ; la réponse est la fiche à jour. Lève le refus du noyau pour qui l'a lancée. */
  const envoyer: EnvoiRevue = async (methode, chemin, corps) => {
    const maj = await apiSend<Review>(methode, chemin, methode === "DELETE" ? undefined : (corps ?? {}));
    await mutate(maj, { revalidate: false });
    void rafraichir();
    return maj;
  };

  const retour = (
    <button type="button" onClick={onFermer} className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent underline-offset-2 hover:underline">
      <ChevronLeft className="h-4 w-4" /> Revues de direction
    </button>
  );

  if (!r) {
    return (
      <div className="space-y-4">
        {retour}
        <div className={FEUILLE}>{error ? <div className="p-5"><Etat error={error} onRetry={() => void mutate()} /></div> : <Loading label="Chargement de la revue…" />}</div>
      </div>
    );
  }
  const revue = r;
  const t = new Set(r.transitions);
  const modifiable = r.rights.can_edit;
  const plusieursSocietes = (moi?.companies.length ?? 0) > 1;
  const genere = r.inputs_generated_at?.slice(0, 10) ?? null;
  // L'auditeur lit la fonction de l'auteur d'une pièce à la place de son nom (Pieces affiche le nom).
  const pieces = r.attachments.map((p) => (p.created_by && !p.created_by.name ? { ...p, created_by: { id: p.created_by.id, name: nomCompte(p.created_by, "Utilisateur interne") } } : p));
  const ancien = r.state === "prepared" && genere !== null && joursEntre(genere, aujourdhui()) >= 1;

  /** Commande d'une transition sans fenêtre : envoi, message, refus du noyau. */
  async function lancer(cle: string, appel: () => Promise<ReactNode>, defaut: string) {
    setOccupe(cle);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await appel() });
    } catch (e) {
      setMessage({ tone: "danger", text: messageRevue(e, defaut) });
    } finally {
      setOccupe(null);
    }
  }

  async function clore() {
    const ok = await demanderConfirmation(`Compte rendu, décisions et conclusions ne se modifieront plus${INSECABLE}; seul le Responsable HSSEQ rouvre une revue close, avec un motif.`, {
      titre: `Clore la revue ${revue.reference}${INSECABLE}?`,
      action: "Clore la revue",
    });
    if (!ok) return;
    await lancer("close", async () => {
      await envoyer("POST", `/hsseq/reviews/${revue.id}/close`);
      return `Revue close${INSECABLE}: son compte rendu définitif se télécharge en PDF.`;
    }, "Clôture impossible.");
  }

  async function telecharger() {
    setOccupe("pdf");
    try {
      await apiDownload(`/hsseq/reviews/${revue.id}/report.pdf`, nomPdf(revue.reference));
    } catch (e) {
      setMessage({ tone: "danger", text: messageRevue(e, "Téléchargement impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  async function deposer(fichier: File) {
    setOccupe("depot");
    setMessage(null);
    try {
      await deposerPieceRevue(revue.id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Pièce jointe à la revue." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageRevue(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  const prepare = r.state === "prepared";
  const etapes = [
    { key: "prepared", label: "Préparation", state: prepare ? ("current" as const) : ("done" as const), title: "Période, participants, ordre du jour, éléments d'entrée" },
    { key: "held", label: r.held_on ? `Séance tenue le ${fmtDate(r.held_on)}` : `Séance prévue le ${fmtDate(r.planned_date)}`, state: prepare ? ("todo" as const) : ("done" as const), title: "Participants présents, éléments d'entrée figés" },
    { key: "closed", label: r.closed_at ? `Close le ${fmtDate(r.closed_at)}` : "Compte rendu, décisions, clôture", state: r.state === "closed" ? ("done" as const) : r.state === "held" ? ("current" as const) : ("todo" as const), title: "Compte rendu, décisions et leurs actions, conclusions" },
  ];

  return (
    <div className="space-y-5">
      {retour}

      <section aria-labelledby={titreId} className={cx(FEUILLE, "space-y-5 px-5 py-5 sm:px-7 sm:py-6")}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-[13px] text-muted">
              Revue de direction <span className="font-mono text-[12px]">{r.reference}</span>
              {plusieursSocietes ? `, ${r.company.name}` : ""}
            </p>
            <h2 ref={titreRef} id={titreId} tabIndex={-1} className="mt-1 font-display text-[24px] font-[640] leading-tight tracking-[-0.015em] text-ink outline-none sm:text-[28px]">
              {r.title}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">
              {`Période ${dePeriode(periodeRevue(r.period.from, r.period.to))} (${pluriel(nombreDeMois(r.period.from, r.period.to), "mois", "mois")})${INSECABLE}; `}
              {r.held_on ? `séance tenue le ${dateLongue(r.held_on)}.` : `séance prévue le ${dateLongue(r.planned_date)}, ${echeanceRelative(r.planned_date)}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <TamponsRevue r={r} />
          </div>
        </div>

        <Etapes steps={etapes} />

        <div className="flex flex-wrap gap-2">
          {t.has("hold") && (
            <Button variant="primary" onClick={() => setFenetre("tenue")}>
              Déclarer la revue tenue
            </Button>
          )}
          {t.has("close") && (
            <Button variant="primary" loading={occupe === "close"} onClick={() => void clore()}>
              Clore la revue
            </Button>
          )}
          {t.has("refresh") && (
            <Button
              loading={occupe === "refresh"}
              onClick={() =>
                void lancer("refresh", async () => {
                  const maj = await envoyer("POST", `/hsseq/reviews/${revue.id}/refresh`);
                  return `Éléments d'entrée rassemblés de nouveau le ${fmtDateTime(maj.inputs_generated_at)}.`;
                }, "Rafraîchissement impossible.")
              }
            >
              <RefreshCw className="h-4 w-4" /> Rafraîchir les éléments d&apos;entrée
            </Button>
          )}
          {modifiable && (
            <Button onClick={() => setFenetre("preparation")}>
              <Pencil className="h-4 w-4" /> {prepare ? "Modifier la préparation" : "Modifier la séance"}
            </Button>
          )}
          {/* Revue préparée : le dossier de séance porte les éléments d'entrée du jour, calculés à l'impression. */}
          <Button loading={occupe === "pdf"} onClick={() => void telecharger()} title={prepare ? "Ordre du jour, participants invités et éléments d'entrée du jour" : undefined}>
            <Download className="h-4 w-4" /> {prepare ? "Dossier de séance (PDF)" : "Compte rendu (PDF)"}
          </Button>
          {t.has("reopen") && (
            <Button variant="ghost" onClick={() => setFenetre("reouverture")}>
              <RotateCcw className="h-4 w-4" /> Rouvrir
            </Button>
          )}
        </div>

        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {prepare && t.has("hold") && (
          <Notice tone={revueEnRetard(r) ? "warn" : "accent"}>
            {revueEnRetard(r) ? `Séance prévue le ${fmtDate(r.planned_date)}, pas encore déclarée tenue. ` : ""}
            {ancien ? `Éléments d'entrée rassemblés le ${fmtDate(genere)}${INSECABLE}: rafraîchissez-les avant la séance. ` : "Vérifiez les éléments d'entrée, l'ordre du jour et les participants, puis diffusez le dossier de séance. "}
            Le jour de la séance, déclarez la revue tenue avec les participants présents&nbsp;: ses éléments d&apos;entrée sont figés tels que présentés, puis le compte rendu et les décisions se saisissent en séance.
          </Notice>
        )}
        {prepare && !t.has("hold") && <Notice tone="neutral">Revue en préparation&nbsp;: ses éléments d&apos;entrée se mettent à jour jusqu&apos;à la séance.</Notice>}
        {r.state === "held" && t.has("close") && <AvantCloture r={r} />}
        {r.state === "held" && !t.has("close") && <Notice tone="neutral">{`Revue tenue le ${fmtDate(r.held_on)}${INSECABLE}: compte rendu, décisions et conclusions en cours de rédaction.`}</Notice>}
        {r.state === "closed" && (
          <Notice tone="neutral">
            {`Revue close le ${fmtDateTime(r.closed_at)}${r.closed_by ? ` par ${r.closed_by.name}` : ""}${INSECABLE}; ses décisions se suivent au plan d'actions.`}
          </Notice>
        )}
        {r.reopen_reason && (
          <p className="text-[12.5px] leading-snug text-muted">
            <span className="font-semibold text-ink-2">Motif de la dernière réouverture&nbsp;: </span>
            {r.reopen_reason}
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <Sommaire entrees={entreesSommaire(r)} />
        <div className="min-w-0 space-y-5">
          <Rubrique
            id={ANCRES.tenue}
            numero={1}
            titre="Tenue de la revue"
            actions={
              modifiable && (
                <Button size="sm" onClick={() => setFenetre("preparation")}>
                  <Pencil className="h-3.5 w-3.5" /> Modifier
                </Button>
              )
            }
          >
            <Definitions
              lignes={[
                ["Séance", r.held_on ? `Tenue le ${dateLongue(r.held_on)}${r.held_on !== r.planned_date ? `, prévue le ${fmtDate(r.planned_date)}` : ""}` : `Prévue le ${dateLongue(r.planned_date)}`],
                ["Période revue", `${periodeRevue(r.period.from, r.period.to)}, du ${fmtDate(r.period.from)} au ${fmtDate(r.period.to)}`],
                plusieursSocietes && ["Société", r.company.name],
                r.closed_at && ["Close", `Le ${fmtDateTime(r.closed_at)}${r.closed_by ? `, par ${r.closed_by.name}` : ""}`],
              ]}
            />
            <div>
              <p className="mb-1.5 text-[12px] text-muted">{prepare ? "Participants invités" : "Participants"}</p>
              {r.participants.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {r.participants.map((p) => (
                    <li key={p.id}>
                      <Tag>{nomCompte(p)}</Tag>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">Aucun compte désigné.</p>
              )}
            </div>
            {r.external_participants?.trim() && (
              <div>
                <p className="mb-1.5 text-[12px] text-muted">Autres participants</p>
                <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{r.external_participants}</p>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-[12px] text-muted">Ordre du jour</p>
              {r.agenda?.trim() ? <p className="whitespace-pre-line rounded-[12px] bg-panel-2 px-4 py-3 text-[13.5px] leading-relaxed text-ink">{r.agenda}</p> : <p className="text-[13px] text-muted">Pas d&apos;ordre du jour.</p>}
            </div>
          </Rubrique>

          <EnTeteEntree r={r} />
          <ElementsEntree r={r} />

          <TexteRevue
            key={`cr-${r.state}`}
            id={ANCRES.compteRendu}
            numero={10}
            titre="Compte rendu des échanges"
            aide="Points examinés dans l'ordre du jour, échanges et avis des participants, consultation du personnel."
            valeur={r.minutes}
            modifiable={modifiable}
            vide={prepare ? "Se rédige pendant ou après la séance." : "Pas encore rédigé."}
            placeholder="Suite de la revue précédente, indicateurs, événements, audits, risques, environnement, avis du personnel…"
            max={20000}
            enregistrer={async (texte) => {
              await envoyer("PATCH", `/hsseq/reviews/${revue.id}`, { minutes: texte } satisfies ReviewInput);
              setMessage(null);
            }}
          />

          <Decisions r={r} envoyer={envoyer} />

          <TexteRevue
            key={`cl-${r.state}`}
            id={ANCRES.conclusions}
            numero={12}
            titre="Conclusions de la direction"
            aide={`Le système de management est-il toujours adapté, suffisant et efficace${INSECABLE}? Objectifs, besoins de changement, ressources.`}
            valeur={r.conclusion}
            modifiable={modifiable}
            vide={prepare ? "Se rédigent à l'issue de la séance." : "Pas encore rédigées."}
            placeholder={`Adéquation, pertinence et efficacité du système de management HSSEQ${INSECABLE}; atteinte des objectifs${INSECABLE}; orientations pour la période suivante.`}
            max={8000}
            enregistrer={async (texte) => {
              await envoyer("PATCH", `/hsseq/reviews/${revue.id}`, { conclusion: texte } satisfies ReviewInput);
              setMessage(null);
            }}
          />

          <Rubrique
            id={ANCRES.pieces}
            titre="Pièces jointes"
            aide="Convocation, présentation projetée, feuille d'émargement signée, documents remis en séance (PDF ou photo, 8 Mo au plus)."
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
              pieces={pieces}
              retirable={(p) => modifiable && (hsseq || (moi !== undefined && p.created_by?.id === moi.id))}
              onRetiree={() => void mutate()}
              onErreur={(m) => setMessage({ tone: "danger", text: m })}
              vide={<p className="text-[13px] text-muted">Aucune pièce jointe.</p>}
            />
          </Rubrique>

          <section id={ANCRES.historique} className={cx(FEUILLE, "scroll-mt-24 px-5 py-4 sm:px-6")}>
            <details>
              <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Historique ({r.history.length})</summary>
              <div className="mt-3">
                <Historique lignes={r.history} />
              </div>
            </details>
          </section>
        </div>
      </div>

      {fenetre === "preparation" && (
        <FenetrePreparation
          revue={r}
          onClose={() => setFenetre(null)}
          envoyer={async (corps) => {
            await envoyer("PATCH", `/hsseq/reviews/${revue.id}`, corps);
            const regeneree = revue.state === "prepared" && ("period_start" in corps || "period_end" in corps || "planned_date" in corps);
            setMessage({ tone: "ok", text: regeneree ? `Revue mise à jour${INSECABLE}: éléments d'entrée rassemblés de nouveau.` : "Revue mise à jour." });
          }}
        />
      )}
      {fenetre === "tenue" && (
        <FenetreTenue
          revue={r}
          onClose={() => setFenetre(null)}
          envoyer={async (corps) => {
            const maj = await envoyer("POST", `/hsseq/reviews/${revue.id}/hold`, corps);
            setMessage({ tone: "ok", text: `Revue tenue le ${fmtDate(maj.held_on)}${INSECABLE}: éléments d'entrée figés. Rédigez le compte rendu, inscrivez les décisions et leurs actions, puis closez la revue.` });
          }}
        />
      )}
      {fenetre === "reouverture" && (
        <FenetreMotif
          titre={`Rouvrir la revue ${r.reference}`}
          aide={`La revue revient à l'état «${INSECABLE}Tenue${INSECABLE}»${INSECABLE}: compte rendu, décisions et conclusions se modifient de nouveau. Le motif est journalisé.`}
          action="Rouvrir la revue"
          onClose={() => setFenetre(null)}
          envoyer={async (reason) => {
            await envoyer("POST", `/hsseq/reviews/${revue.id}/reopen`, { reason });
            setMessage({ tone: "ok", text: "Revue rouverte." });
          }}
        />
      )}
    </div>
  );
}
