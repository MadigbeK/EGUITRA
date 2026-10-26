"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AlertTriangle, Calendar, CheckCircle2, Clock, Pencil, Send } from "@/components/icons";
import { Anneau, Badge, Button, Card, Empty, ErrorBox, FEUILLE, Loading, Modal, Notice, Textarea, cx } from "@/components/ui";
import { EnTete, quand } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { PasDeDossier, jour, messageErreur, useRetour } from "@/components/portail/projet/outils";
import { apiSend, useApi } from "@/lib/api-client";
import type { ActionRow } from "@/lib/portail-types";

/**
 * Brouillon du compte rendu d'une action, gardé dans l'onglet (sessionStorage) : fermer la fenêtre,
 * suivre le lien vers les pièces ou recharger la page ne perd plus le texte en cours.
 */
const cleBrouillon = (id: number) => `portail-compte-rendu-${id}`;

function lireBrouillon(id: number): string | null {
  try {
    return window.sessionStorage.getItem(cleBrouillon(id));
  } catch {
    return null;
  }
}

function garderBrouillon(id: number, texte: string | null) {
  try {
    if (texte && texte.trim()) window.sessionStorage.setItem(cleBrouillon(id), texte);
    else window.sessionStorage.removeItem(cleBrouillon(id));
  } catch {
    // Stockage indisponible : le texte reste dans la fenêtre tant qu'elle est ouverte.
  }
}

const COLONNES: Array<{ key: ActionRow["state"]; titre: string; trait: string; vide: string }> = [
  { key: "todo", titre: "À faire", trait: "bg-line-strong", vide: "Rien à faire pour l'instant." },
  { key: "in_progress", titre: "En cours", trait: "bg-accent-vif", vide: "Aucune action en cours." },
  { key: "submitted", titre: "Transmises au cabinet", trait: "bg-warn-vif", vide: "Aucune action en attente de validation." },
  { key: "done", titre: "Validées", trait: "bg-jade", vide: "Aucune action validée pour l'instant." },
];

function CarteAction({ a, ferme, onCompteRendu }: { a: ActionRow; ferme: boolean; onCompteRendu: (a: ActionRow) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const longue = (a.description?.length ?? 0) > 180;
  return (
    <article className={cx(FEUILLE, "p-4", a.overdue && "ring-1 ring-danger/35")}>
      {a.overdue && (
        <div className="mb-2">
          <Badge tone="danger">Échéance dépassée</Badge>
        </div>
      )}
      <h3 className={cx("text-[14.5px] font-semibold leading-snug", a.state === "done" ? "text-ink-2" : "text-ink")}>{a.name}</h3>
      {a.description && (
        <>
          <p className={cx("mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-muted", longue && !ouvert && "line-clamp-3")}>{a.description}</p>
          {longue && (
            <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((v) => !v)} className="mt-1 text-[12.5px] font-semibold text-accent hover:underline">
              {ouvert ? "Réduire" : "Lire la suite"}
            </button>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        {a.state === "done" ? (
          a.done_date && (
            <span className="inline-flex items-center gap-1.5 font-medium text-ok-texte">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Validée le {jour(a.done_date)}
            </span>
          )
        ) : a.due_date ? (
          <span className={cx("inline-flex items-center gap-1.5", a.overdue ? "font-semibold text-danger" : "text-ink-2")}>
            <Calendar className="h-3.5 w-3.5" />
            Échéance : {quand(a.due_date)}
          </span>
        ) : (
          <span className="text-muted">Sans échéance</span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted">{a.origin_label}</p>
      {a.porteur_comment && (
        <div className="mt-3 rounded-xl bg-panel-2 px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Votre compte rendu</div>
          <p className="mt-1 line-clamp-4 whitespace-pre-line break-words text-[13px] leading-relaxed text-ink-2">{a.porteur_comment}</p>
        </div>
      )}
      {!ferme && a.state !== "done" && (
        <>
          {a.state === "submitted" ? (
            <Button className="mt-3 w-full" onClick={() => onCompteRendu(a)}>
              <Pencil className="h-4 w-4" />
              Compléter mon compte rendu
            </Button>
          ) : (
            <Button variant="primary" className="mt-3 w-full" onClick={() => onCompteRendu(a)}>
              <CheckCircle2 className="h-4 w-4" />
              J'ai réalisé cette action
            </Button>
          )}
        </>
      )}
      {a.state === "submitted" && <p className="mt-2 text-[12px] leading-snug text-muted">Votre consultant vérifie, puis valide l'action.</p>}
    </article>
  );
}

export default function PlanActions() {
  const { espace, dossier, rafraichir } = usePortail();
  const { data, error, mutate } = useApi<ActionRow[]>(dossier ? `/portail/dossiers/${dossier.id}/actions` : null);
  const { setRetour, bandeau } = useRetour();
  const [cible, setCible] = useState<ActionRow | null>(null);
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const [brouillon, setBrouillon] = useState(false);

  const ouvrir = useCallback((a: ActionRow) => {
    const garde = lireBrouillon(a.id);
    setCible(a);
    setTexte(garde ?? a.porteur_comment ?? "");
    setBrouillon(garde !== null);
    setErreur(null);
  }, []);
  const fermer = useCallback(() => {
    if (!envoi) setCible(null);
  }, [envoi]);

  if (espace && !espace.dossiers.length) return <PasDeDossier />;
  if (error) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!data || !dossier) return <Loading label="Chargement de votre plan d'actions…" />;

  const ferme = dossier.state === "closed";
  const total = data.length;
  const validees = data.filter((a) => a.state === "done").length;
  const transmises = data.filter((a) => a.state === "submitted").length;
  const enRetard = data.filter((a) => a.overdue && a.state !== "done").length;
  const aFaire = data.filter((a) => a.state === "todo" || a.state === "in_progress").length;
  const pct = total ? Math.round((validees / total) * 100) : 0;

  async function envoyer() {
    if (!cible) return;
    const comment = texte.trim();
    if (comment.length < 3) {
      setErreur("Décrivez en quelques mots ce que vous avez réalisé.");
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await apiSend("POST", `/portail/actions/${cible.id}/report`, { comment });
      garderBrouillon(cible.id, null);
      setCible(null);
      setRetour({ tone: "ok", texte: "Compte rendu transmis : votre consultant va vérifier, puis valider l'action." });
      void mutate();
      rafraichir();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="space-y-6">
      <EnTete
        surtitre="Mon projet"
        titre="Plan d'actions"
        texte="Les actions que le cabinet vous a confiées. Quand vous en avez réalisé une, dites-le : votre consultant la vérifie, puis la valide."
      />

      {ferme && <Notice tone="neutral">Ce dossier est clos : le plan d'actions reste consultable, sans nouveau compte rendu.</Notice>}

      {total === 0 ? (
        <Card>
          <Empty title="Le cabinet ne vous a confié aucune action pour l'instant." hint="Votre consultant ajoutera ici les actions à mener pour faire avancer votre dossier. Vous serez prévenu à chaque nouvelle action." />
        </Card>
      ) : (
        <>
          {/* Progression */}
          <Card>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <Anneau value={pct} taille={104} epaisseur={11} centre={`${pct} %`} sous="validées" couleur="var(--g-jade)" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-[19px] font-semibold leading-snug text-ink">
                  {validees} action{validees > 1 ? "s" : ""} validée{validees > 1 ? "s" : ""} sur {total}
                </p>
                <p className="mt-1 text-[13.5px] text-muted">
                  {aFaire === 0
                    ? transmises
                      ? "Tout est entre les mains du cabinet : il reste à valider vos comptes rendus."
                      : "Toutes vos actions sont validées. Bravo."
                    : `Il vous reste ${aFaire} action${aFaire > 1 ? "s" : ""} à mener.`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {aFaire > 0 && (
                    <Badge tone="accent">
                      {aFaire} à mener
                    </Badge>
                  )}
                  {transmises > 0 && (
                    <Badge tone="warn">
                      {transmises} transmise{transmises > 1 ? "s" : ""} au cabinet
                    </Badge>
                  )}
                  {enRetard > 0 && (
                    <Badge tone="danger" vivant>
                      {enRetard} en retard
                    </Badge>
                  )}
                </div>
              </div>
              {enRetard > 0 && (
                <div className="flex items-start gap-2.5 rounded-xl bg-danger-doux px-4 py-3 text-[13px] text-danger sm:max-w-[280px]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                  <span>
                    {enRetard > 1 ? "Des échéances sont dépassées" : "Une échéance est dépassée"}. Un empêchement ?{" "}
                    <Link href="/portail/messages" className="font-semibold underline underline-offset-2">Prévenez votre consultant</Link>.
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* Colonnes sur grand écran, liste sur téléphone */}
          <div className="grid gap-6 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
            {COLONNES.map((c) => {
              const items = data.filter((a) => a.state === c.key);
              return (
                <section key={c.key} aria-label={c.titre} className={cx("min-w-0 md:rounded-[20px] md:bg-panel-2/70 md:p-3", !items.length && "max-md:hidden")}>
                  <h2 className="mb-3 flex items-center gap-2 px-1 text-[13.5px] font-bold text-ink">
                    <span aria-hidden className={cx("h-2.5 w-2.5 flex-none rounded-full", c.trait)} />
                    {c.titre}
                    <span className="ml-auto rounded-full bg-panel px-2 py-0.5 text-[12px] font-semibold tabular-nums text-muted ring-1 ring-line">{items.length}</span>
                  </h2>
                  {items.length ? (
                    <ul className="space-y-3">
                      {items.map((a) => (
                        <li key={a.id}>
                          <CarteAction a={a} ferme={ferme} onCompteRendu={ouvrir} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl border border-dashed border-line-strong/60 px-3 py-6 text-center text-[12.5px] text-muted">{c.vide}</p>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* Fenêtre et bandeau dans un conteneur toujours présent : l'entrée animée de la page ne les rejoue pas. */}
      <div>
        <Modal
          open={cible !== null}
          title={cible?.state === "submitted" ? "Compléter mon compte rendu" : "J'ai réalisé cette action"}
          onClose={fermer}
          footer={
            <>
              <Button variant="ghost" onClick={fermer} disabled={envoi}>
                Annuler
              </Button>
              <Button variant="primary" type="submit" form="compte-rendu-action" loading={envoi}>
                {!envoi && <Send className="h-4 w-4" />}
                Envoyer au cabinet
              </Button>
            </>
          }
        >
          {cible && (
            <form
              id="compte-rendu-action"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void envoyer();
              }}
            >
              <div className="rounded-xl bg-panel-2 px-3.5 py-3">
                <div className="text-[12px] font-medium text-muted">Action</div>
                <div className="mt-0.5 text-[14.5px] font-semibold leading-snug text-ink">{cible.name}</div>
                {cible.due_date && (
                  <div className={cx("mt-1 inline-flex items-center gap-1.5 text-[12.5px]", cible.overdue ? "text-danger" : "text-muted")}>
                    <Clock className="h-3.5 w-3.5" />
                    Échéance : {quand(cible.due_date)}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="compte-rendu-texte" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                  Votre compte rendu
                </label>
                <Textarea
                  id="compte-rendu-texte"
                  aria-label={`Compte rendu de l'action « ${cible.name} »`}
                  value={texte}
                  onChange={(e) => {
                    setTexte(e.target.value);
                    garderBrouillon(cible.id, e.target.value);
                  }}
                  rows={6}
                  maxLength={5000}
                  autoFocus
                  placeholder="Ce que vous avez fait, les résultats obtenus, ce qui reste éventuellement à faire."
                />
                {brouillon && <p className="mt-1.5 text-[12px] leading-snug text-muted">Votre brouillon a été repris là où vous l'aviez laissé.</p>}
                <p className="mt-1.5 text-[12px] leading-snug text-muted">
                  Un justificatif à joindre ? Déposez-le dans{" "}
                  <Link href={`/portail/pieces?dossier=${dossier.id}`} target="_blank" rel="noopener" className="font-semibold text-accent underline underline-offset-2">
                    Pièces et data room
                    <span className="sr-only"> (s'ouvre dans un nouvel onglet)</span>
                  </Link>
                  , un nouvel onglet qui garde ce compte rendu ouvert, puis mentionnez-le ici. Votre texte est gardé même si vous fermez cette fenêtre.
                </p>
              </div>
              {erreur && <Notice tone="danger">{erreur}</Notice>}
            </form>
          )}
        </Modal>

        {bandeau}
      </div>
    </div>
  );
}
