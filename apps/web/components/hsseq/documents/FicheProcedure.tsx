"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { BadgeCheck, Bell, Download, Pencil, Plus, RotateCcw, Send, Undo2 } from "@/components/icons";
import { Badge, Button, Etat, FileButton, Loading, Notice, demanderConfirmation } from "@/components/ui";
import { DOMAINE } from "@/components/hsseq/commun";
import { Definitions, Panneau, Pieces, Rubrique } from "@/components/hsseq/actions/outils";
import { MOT_ETAT, fmtCase, fmtPrevu, tonEtatIndicateur, type EtatIndicateur } from "@/components/hsseq/cockpit/outils";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDateTime, pluriel } from "@/lib/format";
import type { IndicatorStatus } from "@/lib/hsseq-types";
import { Commandes, Historique, Lecture } from "./elements";
import { FenetreMotif, FenetreProcedure, FenetreRevue, FenetreVersion } from "./fenetres";
import {
  CONCLUSION_REVUE,
  ETAT_REVUE,
  FORMATS_DOCUMENT,
  STATUT_PROCEDURE,
  STATUT_VERSION,
  TYPE_DOCUMENT,
  TamponDocument,
  deposerPiece,
  messageDocument,
  profilsVises,
  publicVise,
  sitesVises,
  useRafraichir,
  type Droits,
} from "./libelles";
import type { DocType, Objective, Procedure, ProcedureStatus, ProcedureVersion } from "./types";

type Fenetre = "modifier" | "version" | "brouillon" | "archive" | "reactivate" | "refus" | "revue";

/** Message affiché en tête de la fiche après une écriture, ou son refus. */
interface Message {
  tone: "ok" | "danger";
  text: string;
}

const ETAT_OBJECTIF: Record<IndicatorStatus, EtatIndicateur> = { met: "conforme", watch: "surveillance", missed: "non_conforme", no_data: "sans_donnee" };

/** Valeurs codées du journal d'un document, en clair. */
function valeurProcedure(champ: string, v: string): string {
  if (champ === "status") return STATUT_PROCEDURE[v as ProcedureStatus] ?? v;
  if (champ === "domain") return DOMAINE[v as keyof typeof DOMAINE] ?? v;
  if (champ === "doc_type") return TYPE_DOCUMENT[v as DocType]?.label ?? v;
  return v;
}

/** Contenu manquant pour soumettre ou publier la version : le texte d'une politique, le document (ou le texte) des autres. */
function contenuManquant(type: DocType, v: ProcedureVersion): string | null {
  if (type === "policy") return v.has_text ? null : "Rédigez d'abord le texte de l'engagement de la direction";
  return v.document.length || v.has_text ? null : "Joignez d'abord le document de la version, ou écrivez son texte";
}

/**
 * Fiche d'un document du référentiel HSE (GET /hsseq/procedures/{id}) à côté du registre : politique,
 * procédure, instruction, consigne ou formulaire. Lecture de la version en vigueur (taux, comptes qui
 * n'ont pas lu, lectures datées), version en préparation (texte, objectifs, document) et son approbation
 * (soumission, approbation ou refus motivé, retrait), version en vigueur et son approbateur, objectifs
 * reliés au cockpit, revue périodique et ses revues tracées (et leurs actions), rattachement et documents
 * rattachés, public visé, versions remplacées, journal ; document à afficher en PDF. Les gestes suivent
 * `version_actions`, `rights` et `transitions` du noyau (quatre yeux compris). L'auditeur ne voit aucune
 * commande, ni les noms des lecteurs.
 */
export function FicheProcedure({ id, droits, onFermer, onOuvrir }: { id: number; droits: Droits; onFermer: () => void; onOuvrir?: (id: number) => void }) {
  const cle = `/hsseq/procedures/${id}`;
  const { data: p, error, mutate } = useApi<Procedure>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  /** Écriture sur le document ; la réponse est la fiche à jour. Lève le refus du noyau pour la fenêtre qui l'a lancée. */
  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string | ((maj: Procedure) => string)): Promise<Procedure> {
    const maj = await apiSend<Procedure>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: typeof texte === "function" ? texte(maj) : texte });
    return maj;
  }

  /** Commande lancée depuis la fiche (publication, approbation, relance) : son refus s'affiche en tête. */
  async function lancer(cleOccupe: string, appel: () => Promise<unknown>, defaut: string) {
    setOccupe(cleOccupe);
    setMessage(null);
    try {
      await appel();
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, defaut) });
    } finally {
      setOccupe(null);
    }
  }

  if (!p) {
    return (
      <Panneau etiquette="Politiques et procédures" titre="Document" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement du document…" />}
      </Panneau>
    );
  }
  const procedure = p;
  const type = TYPE_DOCUMENT[p.doc_type];
  const politique = p.doc_type === "policy";

  async function publier(v: ProcedureVersion) {
    const actuelle = procedure.current_version;
    const remplace = actuelle ? ` Elle remplace la version ${actuelle.version}, en vigueur depuis le ${fmtDate(actuelle.effective_date)}.` : "";
    const ok = await demanderConfirmation(
      `La version ${v.version} entre en vigueur le ${fmtDate(v.effective_date)}, approuvée à votre nom.${remplace} Sa lecture est demandée aux comptes visés (${publicVise(procedure.audience)}), qui sont prévenus et relancés tant qu'ils ne l'ont pas lue.`,
      { titre: `Publier la version ${v.version} de ${procedure.code}${INSECABLE}?`, action: "Publier" },
    );
    if (!ok) return;
    await lancer(
      "publier",
      () =>
        ecrire("POST", `${cle}/versions/${v.id}/publish`, {}, (maj) =>
          maj.read ? `Version ${v.version} publiée${INSECABLE}: sa lecture est demandée à ${pluriel(maj.read.targets, "compte visé", "comptes visés")}.` : `Version ${v.version} publiée.`,
        ),
      "Publication impossible.",
    );
  }

  async function soumettre(v: ProcedureVersion) {
    const qui = politique ? "la direction générale" : "le Responsable HSSEQ";
    const ok = await demanderConfirmation(`La version ${v.version} est soumise à l'approbation de ${qui}, qui est prévenu${politique ? "e" : ""}. Elle ne se modifie plus tant qu'elle n'est ni approuvée, ni refusée, ni retirée.`, {
      titre: `Soumettre la version ${v.version} de ${procedure.code}${INSECABLE}?`,
      action: "Soumettre",
    });
    if (!ok) return;
    await lancer("soumettre", () => ecrire("POST", `${cle}/versions/${v.id}/submit`, {}, `Version ${v.version} soumise à l'approbation de ${qui}.`), "Soumission impossible.");
  }

  async function approuver(v: ProcedureVersion) {
    const actuelle = procedure.current_version;
    const ok = await demanderConfirmation(
      `${politique ? "Vous signez la politique au nom de la direction" : "Vous approuvez le document"}${INSECABLE}: votre nom et la date d'aujourd'hui figurent sur le document à afficher. La version ${v.version} entre en vigueur${actuelle ? ` à la place de la version ${actuelle.version}` : ""} et sa lecture est demandée aux comptes visés (${publicVise(procedure.audience)}).`,
      { titre: `Approuver la version ${v.version} de ${procedure.code}${INSECABLE}?`, action: "Approuver" },
    );
    if (!ok) return;
    await lancer(
      "approuver",
      () => ecrire("POST", `${cle}/versions/${v.id}/approve`, {}, (maj) => `Version ${v.version} approuvée et en vigueur${maj.read ? `${INSECABLE}: sa lecture est demandée à ${pluriel(maj.read.targets, "compte visé", "comptes visés")}` : ""}.`),
      "Approbation impossible.",
    );
  }

  async function retirer(v: ProcedureVersion) {
    await lancer("retirer", () => ecrire("POST", `${cle}/versions/${v.id}/withdraw`, {}, `Version ${v.version} retirée de l'approbation${INSECABLE}: elle se modifie de nouveau.`), "Retrait impossible.");
  }

  async function relancer() {
    const reste = (procedure.read?.targets ?? 0) - (procedure.read?.read ?? 0);
    const ok = await demanderConfirmation(
      `${pluriel(reste, "compte visé n'a", "comptes visés n'ont")} pas encore accusé lecture de la version ${procedure.current_version?.version ?? ""}${INSECABLE}: ${reste > 1 ? "ils reçoivent" : "il reçoit"} un rappel dans l'application et par courriel.`,
      { titre: `Relancer les lecteurs de ${procedure.code}${INSECABLE}?`, action: "Relancer" },
    );
    if (!ok) return;
    await lancer(
      "relancer",
      () => ecrire("POST", `${cle}/remind`, {}, (maj) => (maj.reminded ? `${pluriel(maj.reminded, "compte relancé", "comptes relancés")}.` : `Aucun compte à relancer${INSECABLE}: tous ont lu la version en vigueur.`)),
      "Relance impossible.",
    );
  }

  async function deposer(v: ProcedureVersion, fichier: File) {
    setOccupe("depot");
    setMessage(null);
    try {
      await deposerPiece("procedure_version", v.id, fichier);
      await mutate();
      void rafraichir(cle);
      setMessage({ tone: "ok", text: `Document joint à la version ${v.version}${INSECABLE}: elle peut être ${politique ? "soumise à la direction" : "publiée"}.` });
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  /** Document à afficher (PDF au gabarit de la société) ; un projet porte la mention « Projet non approuvé ». */
  async function affiche(v: ProcedureVersion, projet: boolean) {
    await lancer(
      projet ? "apercu" : "affiche",
      async () => {
        await apiDownload(`${cle}/poster.pdf${projet ? `?version_id=${v.id}` : ""}`, `${procedure.code}_v${v.version}${projet ? "_projet" : ""}.pdf`);
      },
      "Le document à afficher n'a pas pu être préparé.",
    );
  }

  // L'auditeur lit sans écrire : le noyau ne lui sert ni transition ni geste, l'écran non plus.
  const lecture = droits.auditeur;
  const t = new Set(lecture ? [] : p.transitions);
  const gestes = new Set(lecture ? [] : p.version_actions);
  const modifiable = p.rights.can_edit && !lecture;
  const brouillon = p.draft_version;
  const soumise = brouillon?.status === "submitted";
  const manque = brouillon ? contenuManquant(p.doc_type, brouillon) : null;
  const remplacees = p.versions.filter((v) => v.status === "superseded");
  const reste = p.read ? p.read.targets - p.read.read : 0;
  const fermer = () => setFenetre(null);
  const revue = p.review;

  return (
    <Panneau
      etiquette={type.label}
      titre={p.code}
      onFermer={onFermer}
      sousTitre={p.title}
      tampons={
        <>
          <TamponDocument mot={STATUT_PROCEDURE[p.status]} />
          {brouillon && p.status !== "archived" && <TamponDocument mot={soumise ? STATUT_VERSION.submitted : manque ? (politique ? "Texte à rédiger" : "Document à joindre") : "Brouillon à publier"} />}
          {revue.state && revue.state !== "scheduled" && <TamponDocument mot={ETAT_REVUE[revue.state]} />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Commandes>
        {brouillon && gestes.has("approve") && (
          <Button variant="primary" loading={occupe === "approuver"} onClick={() => void approuver(brouillon)}>
            <BadgeCheck className="h-4 w-4" /> Approuver la version {brouillon.version}
          </Button>
        )}
        {brouillon && gestes.has("reject") && (
          <Button onClick={() => setFenetre("refus")}>Refuser</Button>
        )}
        {brouillon && gestes.has("publish") && (
          <Button variant="primary" loading={occupe === "publier"} disabled={Boolean(manque)} title={manque ?? undefined} onClick={() => void publier(brouillon)}>
            <Send className="h-4 w-4" /> Publier la version {brouillon.version}
          </Button>
        )}
        {brouillon && gestes.has("submit") && (
          <Button variant={gestes.has("publish") ? "secondary" : "primary"} loading={occupe === "soumettre"} disabled={Boolean(manque)} title={manque ?? undefined} onClick={() => void soumettre(brouillon)}>
            <Send className="h-4 w-4" /> {politique ? "Soumettre à la direction" : "Soumettre à l'approbation"}
          </Button>
        )}
        {brouillon && gestes.has("withdraw") && (
          <Button loading={occupe === "retirer"} onClick={() => void retirer(brouillon)}>
            <Undo2 className="h-4 w-4" /> Retirer de l&apos;approbation
          </Button>
        )}
        {modifiable && !brouillon && (
          <Button variant={p.status === "published" ? "secondary" : "primary"} onClick={() => setFenetre("version")}>
            <Plus className="h-4 w-4" /> Nouvelle version
          </Button>
        )}
        {t.has("review") && (
          <Button variant={revue.state === "overdue" || revue.state === "due" ? "primary" : "secondary"} onClick={() => setFenetre("revue")}>
            <RotateCcw className="h-4 w-4" /> Noter la revue
          </Button>
        )}
        {p.poster && p.current_version && (
          <Button loading={occupe === "affiche"} onClick={() => void affiche(procedure.current_version as ProcedureVersion, false)} title="PDF au gabarit de la société, à afficher sur les sites">
            <Download className="h-4 w-4" /> Document à afficher
          </Button>
        )}
        {t.has("remind") && (
          <Button loading={occupe === "relancer"} disabled={reste <= 0} title={reste > 0 ? undefined : "Tous les comptes visés ont lu la version en vigueur"} onClick={() => void relancer()}>
            <Bell className="h-4 w-4" /> Relancer les lecteurs
          </Button>
        )}
        {modifiable && (
          <Button onClick={() => setFenetre("modifier")}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )}
        {t.has("reactivate") && (
          <Button variant="primary" onClick={() => setFenetre("reactivate")}>
            <RotateCcw className="h-4 w-4" /> {p.current_version ? "Remettre en vigueur" : "Réactiver"}
          </Button>
        )}
        {t.has("archive") && (
          <Button variant="ghost" onClick={() => setFenetre("archive")}>
            Archiver
          </Button>
        )}
      </Commandes>

      {p.status === "archived" && (
        <Notice tone="neutral">
          <span className="font-semibold text-ink">{`Archivé${INSECABLE}: `}</span>
          {p.archive_reason ?? "motif non renseigné."}
        </Notice>
      )}
      {brouillon && soumise && p.status !== "archived" && (
        <Notice tone="accent">
          {`Version ${brouillon.version} soumise${brouillon.submitted_at ? ` le ${fmtDateTime(brouillon.submitted_at)}` : ""}${brouillon.submitted_by ? ` par ${brouillon.submitted_by.name}` : ""}${INSECABLE}: `}
          {politique ? "la direction générale l'approuve, jamais l'un de ses rédacteurs ni la personne qui l'a soumise." : "le Responsable HSSEQ l'approuve ou la refuse avec un motif."}
          {brouillon.edited_by.length > 0 && ` Rédacteurs${INSECABLE}: ${brouillon.edited_by.map((u) => u.name).join(", ")}.`}
        </Notice>
      )}
      {brouillon && !soumise && brouillon.reject_reason && (
        <Notice tone="danger">
          <span className="font-semibold">{`Version ${brouillon.version} refusée${INSECABLE}: `}</span>
          {brouillon.reject_reason}
        </Notice>
      )}
      {p.status === "draft" && !soumise && (
        <Notice tone="accent">
          {!modifiable
            ? `En rédaction${INSECABLE}: aucune version n'est encore en vigueur.`
            : politique
              ? `En rédaction${INSECABLE}: ${manque ? "rédigez le texte de l'engagement, puis " : ""}soumettez la version ${brouillon?.version ?? ""} à la direction${INSECABLE}; approuvée, elle entre en vigueur et sa lecture est demandée aux comptes visés.`
              : manque
                ? `En rédaction${INSECABLE}: joignez le document de la version ${brouillon?.version ?? ""} (ou écrivez son texte), puis publiez-la${INSECABLE}; sa lecture sera alors demandée aux comptes visés.`
                : `En rédaction${INSECABLE}: publiez la version ${brouillon?.version ?? ""}${INSECABLE}; sa lecture sera alors demandée aux comptes visés.`}
        </Notice>
      )}

      {p.read && p.current_version && (
        <Rubrique titre={`Lecture de la version ${p.current_version.version}`}>
          <Lecture stats={p.read} readers={p.readers} unread={p.unread} />
        </Rubrique>
      )}

      {brouillon && p.status !== "archived" && (
        <Rubrique titre={soumise ? "Version soumise à l'approbation" : "Version en brouillon"}>
          <BlocVersion
            v={brouillon}
            type={p.doc_type}
            pieces={
              <Pieces
                pieces={brouillon.document}
                retirable={() => modifiable && !soumise}
                onRetiree={() => {
                  void mutate();
                  void rafraichir(cle);
                }}
                onErreur={(m) => setMessage({ tone: "danger", text: m })}
                vide={politique || brouillon.has_text ? null : <p className="m-0 text-[13px] text-muted">{`Aucun document${INSECABLE}: joignez le document (PDF), lu par les comptes visés avant leur accusé.`}</p>}
              />
            }
            actions={
              modifiable && !soumise ? (
                <>
                  <FileButton small label={brouillon.document.length ? "Joindre un autre fichier" : "Joindre le document"} accept={FORMATS_DOCUMENT} onFile={(f) => void deposer(brouillon, f)} />
                  {occupe === "depot" && <span className="text-[12px] text-muted">Envoi…</span>}
                  <Button size="sm" onClick={() => setFenetre("brouillon")}>
                    <Pencil className="h-3.5 w-3.5" /> Modifier la version
                  </Button>
                  {brouillon.has_text && (
                    <Button size="sm" loading={occupe === "apercu"} onClick={() => void affiche(brouillon, true)}>
                      <Download className="h-3.5 w-3.5" /> Aperçu à afficher
                    </Button>
                  )}
                </>
              ) : (
                soumise &&
                brouillon.has_text &&
                !lecture && (
                  <Button size="sm" loading={occupe === "apercu"} onClick={() => void affiche(brouillon, true)}>
                    <Download className="h-3.5 w-3.5" /> Aperçu à afficher
                  </Button>
                )
              )
            }
          />
        </Rubrique>
      )}

      {p.current_version && (
        <Rubrique titre="Version en vigueur">
          <BlocVersion v={p.current_version} type={p.doc_type} pieces={<Pieces pieces={p.current_version.document} vide={p.current_version.has_text ? null : <p className="m-0 text-[13px] text-muted">Aucun document joint.</p>} />} />
        </Rubrique>
      )}

      {p.status === "published" && (
        <Rubrique titre="Revue périodique">
          <Definitions
            lignes={[
              ["Prochaine revue", revue.next_review_date ? <span className={revue.state === "overdue" ? "font-semibold text-danger" : undefined}>{fmtDate(revue.next_review_date)}</span> : "Non fixée"],
              ["Périodicité", `${pluriel(revue.period_months, "mois", "mois")}${revue.months ? " (propre au document)" : " (réglages du type)"}`],
              ["Dernière revue", revue.last_review_date ? fmtDate(revue.last_review_date) : "Aucune"],
              revue.in_progress && ["Révision", "Nouvelle version en préparation, décidée en revue"],
            ]}
          />
          {p.reviews.length > 0 && (
            <ul className="mt-3 space-y-2">
              {p.reviews.map((r) => (
                <li key={r.id} className="rounded-[12px] border border-line px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="m-0 text-[13.5px] font-semibold text-ink">{CONCLUSION_REVUE[r.outcome]}</p>
                    <span className="text-[12px] text-muted">
                      {`Revue le ${fmtDate(r.reviewed_on)}`}
                      {r.reviewer ? `, par ${r.reviewer.name || r.reviewer.function || "un compte interne"}` : ""}
                    </span>
                  </div>
                  <p className="m-0 mt-1.5 whitespace-pre-line text-[13px] leading-snug text-ink-2">{r.comment}</p>
                  <p className="m-0 mt-1.5 text-[12px] text-muted">
                    {r.next_review_date ? `Prochaine revue fixée au ${fmtDate(r.next_review_date)}.` : ""}
                    {r.new_version ? ` Nouvelle version ${r.new_version.version} (${STATUT_VERSION[r.new_version.status].toLocaleLowerCase("fr")}).` : ""}
                  </p>
                  {r.actions.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[12.5px]">
                      {r.actions.map((a) => (
                        <li key={a.id}>
                          <Link href={`/hsseq/actions/${a.id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
                            {a.reference}
                          </Link>
                          <span className="text-ink-2">{` ${a.description}, échéance ${fmtDate(a.due_date)}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Rubrique>
      )}

      {(p.parent || p.children.length > 0) && (
        <Rubrique titre="Rattachement">
          {p.parent && (
            <p className="m-0 text-[13px] text-ink-2">
              {p.doc_type === "procedure" ? "Met en œuvre " : "Se rattache à "}
              <LienDocument d={p.parent} onOuvrir={onOuvrir} />
            </p>
          )}
          {p.children.length > 0 && (
            <div className="mt-2">
              <p className="m-0 mb-1 text-[12px] text-muted">{`Documents rattachés (${p.children.length})`}</p>
              <ul className="space-y-1 text-[13px]">
                {p.children.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <LienDocument d={c} onOuvrir={onOuvrir} />
                    <TamponDocument mot={STATUT_PROCEDURE[c.status]} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Rubrique>
      )}

      <Definitions
        lignes={[
          ["Type", type.label],
          ["Profils visés", profilsVises(p.audience.profiles)],
          ["Sites visés", sitesVises(p.audience)],
          ["Responsable du document", p.owner?.name ?? "Aucun"],
          ["Domaine", p.domain ? DOMAINE[p.domain] : "Non précisé"],
          ["Approbation", politique ? "Direction générale" : "Responsable HSSEQ"],
          ["Société", p.company.name],
        ]}
      />

      {p.description && (
        <Rubrique titre={politique ? "Domaine d'application" : "Objet et domaine d'application"}>
          <p className="m-0 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{p.description}</p>
        </Rubrique>
      )}

      {remplacees.length > 0 && (
        <Rubrique titre={`Versions remplacées (${remplacees.length})`}>
          <ul className="space-y-2">
            {remplacees.map((v) => (
              <li key={v.id}>
                <BlocVersion v={v} type={p.doc_type} pieces={<Pieces pieces={v.document} />} />
              </li>
            ))}
          </ul>
        </Rubrique>
      )}

      <Historique lignes={p.history} valeur={valeurProcedure} />

      {fenetre === "modifier" && <FenetreProcedure procedure={p} onClose={fermer} envoyer={(corps) => ecrire("PATCH", cle, corps, "Document mis à jour.")} />}
      {fenetre === "version" && (
        <FenetreVersion
          procedure={p}
          onClose={fermer}
          envoyer={(corps) => ecrire("POST", `${cle}/versions`, corps, (maj) => `Version ${maj.draft_version?.version ?? ""} créée en brouillon${INSECABLE}: ${politique ? "relisez son texte et ses objectifs, puis soumettez-la à la direction" : "joignez son document, puis publiez-la"}.`)}
        />
      )}
      {fenetre === "brouillon" && brouillon && <FenetreVersion procedure={p} version={brouillon} onClose={fermer} envoyer={(corps) => ecrire("PATCH", `${cle}/versions/${brouillon.id}`, corps, "Version mise à jour.")} />}
      {fenetre === "refus" && brouillon && (
        <FenetreMotif
          titre={`Refuser la version ${brouillon.version} de ${p.code}`}
          aide="La version retourne en brouillon ; son rédacteur est prévenu avec votre motif, et la version en vigueur reste en place."
          action="Refuser"
          danger
          onClose={fermer}
          envoyer={(reason) => ecrire("POST", `${cle}/versions/${brouillon.id}/reject`, { reason }, `Version ${brouillon.version} refusée${INSECABLE}: son rédacteur est prévenu.`)}
        />
      )}
      {fenetre === "revue" && (
        <FenetreRevue
          procedure={p}
          onClose={fermer}
          envoyer={(corps) =>
            ecrire("POST", `${cle}/reviews`, corps, (maj) =>
              corps.outcome === "renewed"
                ? `Revue notée${INSECABLE}: ${type.label.toLocaleLowerCase("fr")} reconduit${p.doc_type === "form" ? "" : "e"}, prochaine revue le ${fmtDate(maj.review.next_review_date)}.`
                : `Revue notée${INSECABLE}: la version ${maj.draft_version?.version ?? ""} est préparée en brouillon.`,
            )
          }
        />
      )}
      {fenetre === "archive" && (
        <FenetreMotif
          titre={`Archiver ${p.code}`}
          aide="Le document sort du registre en vigueur : sa lecture n'est plus demandée, ses rappels et ses revues s'arrêtent. Il se réactive ensuite avec un motif."
          action="Archiver"
          danger
          onClose={fermer}
          envoyer={(reason) => ecrire("POST", `${cle}/archive`, { reason }, "Document archivé.")}
        />
      )}
      {fenetre === "reactivate" && (
        <FenetreMotif
          titre={p.current_version ? `Remettre en vigueur ${p.code}` : `Réactiver ${p.code}`}
          aide={p.current_version ? `La version ${p.current_version.version} redevient en vigueur, avec les accusés déjà reçus.` : "Le document revient en rédaction : sa première version reste à publier."}
          action={p.current_version ? "Remettre en vigueur" : "Réactiver"}
          onClose={fermer}
          envoyer={(reason) => ecrire("POST", `${cle}/reactivate`, { reason }, p.current_version ? "Document remis en vigueur." : "Document réactivé, en rédaction.")}
        />
      )}
    </Panneau>
  );
}

/** Document cité (rattachement, documents rattachés) : un lien qui ouvre sa fiche. */
function LienDocument({ d, onOuvrir }: { d: { id: number; doc_type: DocType; code: string; title: string }; onOuvrir?: (id: number) => void }) {
  const texte = `${TYPE_DOCUMENT[d.doc_type].label} ${d.code}${INSECABLE}: ${d.title}`;
  if (!onOuvrir) return <span className="text-ink">{texte}</span>;
  return (
    <button type="button" onClick={() => onOuvrir(d.id)} className="text-left font-semibold text-accent underline-offset-2 hover:underline">
      {texte}
    </button>
  );
}

/** Objectifs d'une version : libellé, et pour ceux reliés au cockpit, la cible, la valeur sur douze mois et son état. */
function Objectifs({ objectifs }: { objectifs: Objective[] }) {
  if (!objectifs.length) return null;
  return (
    <div className="mt-3">
      <p className="m-0 mb-1.5 text-[12px] font-semibold text-ink">Objectifs</p>
      <ul className="space-y-1.5">
        {objectifs.map((o) => {
          const etat = o.status ? ETAT_OBJECTIF[o.status] : null;
          return (
            <li key={o.id} className="text-[13px] leading-snug">
              <span className="text-ink">{o.label}</span>
              {o.indicator_code && o.unit && o.direction && (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <span>{`${o.indicator_label ?? ""}${INSECABLE}: cible ${fmtPrevu(o.target, o.unit, o.direction)}, sur douze mois ${fmtCase(o.value, o.unit)}`}</span>
                  {etat && <Badge tone={tonEtatIndicateur(etat)}>{MOT_ETAT[etat]}</Badge>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Une version : numéro et état, date d'effet, soumission, approbation et publication, changements, texte, objectifs, document ; les commandes du brouillon. */
function BlocVersion({ v, type, pieces, actions }: { v: ProcedureVersion; type: DocType; pieces: ReactNode; actions?: ReactNode }) {
  const [texteOuvert, setTexteOuvert] = useState(false);
  const long = (v.body ?? "").length > 600;
  return (
    <div className="rounded-[12px] border border-line px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[14px] font-semibold text-ink">Version {v.version}</p>
        <TamponDocument mot={STATUT_VERSION[v.status]} />
      </div>
      <p className="m-0 mt-1 text-[12.5px] leading-snug text-muted">
        {`Date d'effet${INSECABLE}: ${fmtDate(v.effective_date)}`}
        {v.approved_at ? `, approuvée le ${fmtDate(v.approved_at)}${v.approved_by ? ` par ${v.approved_by.name}${type === "policy" ? " (direction)" : ""}` : ""}` : v.published_at ? `, publiée le ${fmtDate(v.published_at)}${v.published_by ? ` par ${v.published_by.name}` : ""}` : ""}
      </p>
      {v.change_summary && <p className="m-0 mt-2 whitespace-pre-line text-[13px] leading-snug text-ink-2">{v.change_summary}</p>}
      {v.body && (
        <div className="mt-3 rounded-[10px] bg-panel-2 px-3 py-2.5">
          <p className="m-0 mb-1 text-[12px] font-semibold text-ink">{type === "policy" ? "Engagement de la direction" : "Texte"}</p>
          <p className={`m-0 whitespace-pre-line text-[13px] leading-relaxed text-ink-2 ${long && !texteOuvert ? "line-clamp-6" : ""}`}>{v.body}</p>
          {long && (
            <button type="button" className="mt-1 text-[12.5px] font-semibold text-accent" onClick={() => setTexteOuvert(!texteOuvert)}>
              {texteOuvert ? "Réduire" : "Lire tout le texte"}
            </button>
          )}
        </div>
      )}
      {v.objectives && <Objectifs objectifs={v.objectives} />}
      <div className="mt-3">{pieces}</div>
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
