"use client";

import { useState, type ReactNode } from "react";
import { Bell, Pencil, Plus, RotateCcw, Send } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice, demanderConfirmation } from "@/components/ui";
import { DOMAINE } from "@/components/hsseq/commun";
import { Definitions, Panneau, Pieces, Rubrique } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, pluriel } from "@/lib/format";
import { Commandes, Historique, Lecture } from "./elements";
import { FenetreMotif, FenetreProcedure, FenetreVersion } from "./fenetres";
import {
  FORMATS_DOCUMENT,
  STATUT_PROCEDURE,
  STATUT_VERSION,
  TamponDocument,
  deposerPiece,
  messageDocument,
  profilsVises,
  publicVise,
  sitesVises,
  useRafraichir,
  type Droits,
} from "./libelles";
import type { Procedure, ProcedureStatus, ProcedureVersion } from "./types";

type Fenetre = "modifier" | "version" | "brouillon" | "archive" | "reactivate";

/** Message affiché en tête de la fiche après une écriture, ou son refus. */
interface Message {
  tone: "ok" | "danger";
  text: string;
}

/** Valeurs codées du journal d'une procédure, en clair. */
function valeurProcedure(champ: string, v: string): string {
  if (champ === "status") return STATUT_PROCEDURE[v as ProcedureStatus] ?? v;
  if (champ === "domain") return DOMAINE[v as keyof typeof DOMAINE] ?? v;
  return v;
}

/**
 * Fiche d'une procédure (GET /hsseq/procedures/{id}) à côté du registre : lecture de la version en
 * vigueur (taux, comptes qui n'ont pas lu, lectures datées), version en brouillon et son document,
 * version en vigueur, public visé, versions remplacées, journal. Les commandes suivent `rights` et
 * `transitions` : le Responsable HSSEQ joint le document du brouillon et le publie (la lecture est
 * alors demandée aux comptes visés), crée une nouvelle version, relance les lecteurs, archive ou
 * réactive avec un motif. L'auditeur ne voit aucune commande, ni les noms des lecteurs.
 */
export function FicheProcedure({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/procedures/${id}`;
  const { data: p, error, mutate } = useApi<Procedure>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  /** Écriture sur la procédure ; la réponse est la fiche à jour. Lève le refus du noyau pour la fenêtre qui l'a lancée. */
  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string | ((maj: Procedure) => string)): Promise<Procedure> {
    const maj = await apiSend<Procedure>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: typeof texte === "function" ? texte(maj) : texte });
    return maj;
  }

  /** Commande lancée depuis la fiche (publication, relance) : son refus s'affiche en tête. */
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
      <Panneau etiquette="Procédures" titre="Procédure" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de la procédure…" />}
      </Panneau>
    );
  }
  const procedure = p;

  async function publier(v: ProcedureVersion) {
    const actuelle = procedure.current_version;
    const remplace = actuelle ? ` Elle remplace la version ${actuelle.version}, en vigueur depuis le ${fmtDate(actuelle.effective_date)}.` : "";
    const ok = await demanderConfirmation(
      `La version ${v.version} entre en vigueur le ${fmtDate(v.effective_date)}.${remplace} Sa lecture est demandée aux comptes visés (${publicVise(procedure.audience)}), qui sont prévenus et relancés tant qu'ils ne l'ont pas lue.`,
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
      setMessage({ tone: "ok", text: `Document joint à la version ${v.version}${INSECABLE}: elle peut être publiée.` });
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  // L'auditeur lit sans écrire : le noyau ne lui sert ni transition ni droit d'écriture, l'écran non plus.
  const lecture = droits.auditeur;
  const t = new Set(lecture ? [] : p.transitions);
  const modifiable = p.rights.can_edit && !lecture;
  const brouillon = p.draft_version;
  const publiable = Boolean(brouillon) && p.rights.can_approve && !lecture;
  const remplacees = p.versions.filter((v) => v.status === "superseded");
  const reste = p.read ? p.read.targets - p.read.read : 0;
  const fermer = () => setFenetre(null);

  return (
    <Panneau
      etiquette="Procédures"
      titre={p.code}
      onFermer={onFermer}
      sousTitre={p.title}
      tampons={
        <>
          <TamponDocument mot={STATUT_PROCEDURE[p.status]} />
          {brouillon && p.status !== "archived" && <TamponDocument mot={brouillon.document.length ? "Brouillon à publier" : "Document à joindre"} />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Commandes>
        {publiable && brouillon && (
          <Button variant="primary" loading={occupe === "publier"} disabled={!brouillon.document.length} title={brouillon.document.length ? undefined : "Joignez d'abord le document de la version"} onClick={() => void publier(brouillon)}>
            <Send className="h-4 w-4" /> Publier la version {brouillon.version}
          </Button>
        )}
        {modifiable && !brouillon && (
          <Button variant={p.status === "published" ? "secondary" : "primary"} onClick={() => setFenetre("version")}>
            <Plus className="h-4 w-4" /> Nouvelle version
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
          <span className="font-semibold text-ink">{`Archivée${INSECABLE}: `}</span>
          {p.archive_reason ?? "motif non renseigné."}
        </Notice>
      )}
      {p.status === "draft" && (
        <Notice tone="accent">
          {!modifiable
            ? `En rédaction${INSECABLE}: aucune version n'est encore en vigueur.`
            : brouillon?.document.length
              ? `En rédaction${INSECABLE}: publiez la version ${brouillon.version}${INSECABLE}; sa lecture sera alors demandée aux comptes visés.`
              : `En rédaction${INSECABLE}: joignez le document de la version ${brouillon?.version ?? ""}, puis publiez-la${INSECABLE}; sa lecture sera alors demandée aux comptes visés.`}
        </Notice>
      )}

      {p.read && p.current_version && (
        <Rubrique titre={`Lecture de la version ${p.current_version.version}`}>
          <Lecture stats={p.read} readers={p.readers} unread={p.unread} />
        </Rubrique>
      )}

      {brouillon && p.status !== "archived" && (
        <Rubrique titre="Version en brouillon">
          <BlocVersion
            v={brouillon}
            pieces={
              <Pieces
                pieces={brouillon.document}
                retirable={() => modifiable}
                onRetiree={() => {
                  void mutate();
                  void rafraichir(cle);
                }}
                onErreur={(m) => setMessage({ tone: "danger", text: m })}
                vide={<p className="m-0 text-[13px] text-muted">{`Aucun document${INSECABLE}: joignez la procédure (PDF), lue par les comptes visés avant leur accusé.`}</p>}
              />
            }
            actions={
              modifiable && (
                <>
                  <FileButton small label={brouillon.document.length ? "Joindre un autre fichier" : "Joindre le document"} accept={FORMATS_DOCUMENT} onFile={(f) => void deposer(brouillon, f)} />
                  {occupe === "depot" && <span className="text-[12px] text-muted">Envoi…</span>}
                  <Button size="sm" onClick={() => setFenetre("brouillon")}>
                    <Pencil className="h-3.5 w-3.5" /> Modifier la version
                  </Button>
                </>
              )
            }
          />
        </Rubrique>
      )}

      {p.current_version && (
        <Rubrique titre="Version en vigueur">
          <BlocVersion v={p.current_version} pieces={<Pieces pieces={p.current_version.document} vide={<p className="m-0 text-[13px] text-muted">Aucun document joint.</p>} />} />
        </Rubrique>
      )}

      <Definitions
        lignes={[
          ["Profils visés", profilsVises(p.audience.profiles)],
          ["Sites visés", sitesVises(p.audience)],
          ["Responsable du document", p.owner?.name ?? "Aucun"],
          ["Domaine", p.domain ? DOMAINE[p.domain] : "Non précisé"],
          ["Société", p.company.name],
        ]}
      />

      {p.description && (
        <Rubrique titre="Objet et domaine d'application">
          <p className="m-0 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{p.description}</p>
        </Rubrique>
      )}

      {remplacees.length > 0 && (
        <Rubrique titre={`Versions remplacées (${remplacees.length})`}>
          <ul className="space-y-2">
            {remplacees.map((v) => (
              <li key={v.id}>
                <BlocVersion v={v} pieces={<Pieces pieces={v.document} />} />
              </li>
            ))}
          </ul>
        </Rubrique>
      )}

      <Historique lignes={p.history} valeur={valeurProcedure} />

      {fenetre === "modifier" && <FenetreProcedure procedure={p} onClose={fermer} envoyer={(corps) => ecrire("PATCH", cle, corps, "Procédure mise à jour.")} />}
      {fenetre === "version" && (
        <FenetreVersion procedure={p} onClose={fermer} envoyer={(corps) => ecrire("POST", `${cle}/versions`, corps, (maj) => `Version ${maj.draft_version?.version ?? ""} créée en brouillon${INSECABLE}: joignez son document, puis publiez-la.`)} />
      )}
      {fenetre === "brouillon" && brouillon && <FenetreVersion procedure={p} version={brouillon} onClose={fermer} envoyer={(corps) => ecrire("PATCH", `${cle}/versions/${brouillon.id}`, corps, "Version mise à jour.")} />}
      {fenetre === "archive" && (
        <FenetreMotif
          titre={`Archiver la procédure ${p.code}`}
          aide="Elle sort du registre en vigueur : sa lecture n'est plus demandée et ses rappels s'arrêtent. Elle se réactive ensuite avec un motif."
          action="Archiver"
          danger
          onClose={fermer}
          envoyer={(reason) => ecrire("POST", `${cle}/archive`, { reason }, "Procédure archivée.")}
        />
      )}
      {fenetre === "reactivate" && (
        <FenetreMotif
          titre={p.current_version ? `Remettre en vigueur ${p.code}` : `Réactiver ${p.code}`}
          aide={p.current_version ? `La version ${p.current_version.version} redevient en vigueur, avec les accusés déjà reçus.` : "La procédure revient en rédaction : sa première version reste à publier."}
          action={p.current_version ? "Remettre en vigueur" : "Réactiver"}
          onClose={fermer}
          envoyer={(reason) => ecrire("POST", `${cle}/reactivate`, { reason }, p.current_version ? "Procédure remise en vigueur." : "Procédure réactivée, en rédaction.")}
        />
      )}
    </Panneau>
  );
}

/** Une version : numéro et état, date d'effet, publication, changements apportés, document ; les commandes du brouillon. */
function BlocVersion({ v, pieces, actions }: { v: ProcedureVersion; pieces: ReactNode; actions?: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-line px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[14px] font-semibold text-ink">Version {v.version}</p>
        <TamponDocument mot={STATUT_VERSION[v.status]} />
      </div>
      <p className="m-0 mt-1 text-[12.5px] leading-snug text-muted">
        {`Date d'effet${INSECABLE}: ${fmtDate(v.effective_date)}`}
        {v.published_at ? `, publiée le ${fmtDate(v.published_at)}${v.published_by ? ` par ${v.published_by.name}` : ""}` : ""}
      </p>
      {v.change_summary && <p className="m-0 mt-2 whitespace-pre-line text-[13px] leading-snug text-ink-2">{v.change_summary}</p>}
      <div className="mt-3">{pieces}</div>
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
