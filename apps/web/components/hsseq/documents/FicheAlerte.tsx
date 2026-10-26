"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, Pencil, Send } from "@/components/icons";
import { Button, Etat, Loading, Notice, demanderConfirmation } from "@/components/ui";
import { Definitions, Panneau, Rubrique } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDateTime, pluriel } from "@/lib/format";
import { Commandes, Historique, Lecture, Surligne } from "./elements";
import { FenetreAlerte, FenetreMotif } from "./fenetres";
import { NATURE_ALERTE, TamponDocument, codeRefus, messageDocument, profilsVises, publicVise, sitesVises, statutAlerte, useRafraichir, type Droits } from "./libelles";
import type { AnonymityFinding, Bulletin, BulletinKind, BulletinStatus } from "./types";

type Fenetre = "modifier" | "archive";

interface Message {
  tone: "ok" | "danger";
  text: string;
}

/** Champ du texte où un nom ou une immatriculation est relevé. */
const OU: Record<AnonymityFinding["field"], string> = { title: "dans le titre", body: "dans le texte", key_messages: "dans ce qu'il faut retenir" };

/**
 * Contrôle d'anonymat d'un brouillon (§9.4) : noms de personnes et immatriculations (codes d'ensemble
 * compris) relevés par le noyau, champ par champ ; la diffusion est refusée tant qu'il en reste.
 */
function ControleAnonymat({ constats }: { constats: AnonymityFinding[] }) {
  if (!constats.length) {
    return <Notice tone="ok">{`Contrôle d'anonymat${INSECABLE}: aucun nom de personne ni aucune immatriculation relevés dans le titre, le texte et ce qu'il faut retenir.`}</Notice>;
  }
  return (
    <Notice tone="warn">
      <p className="m-0 font-semibold text-ink">{`Diffusion refusée en l'état${INSECABLE}: le texte cite encore ${pluriel(constats.length, "élément", "éléments")} qui désignent une personne ou un véhicule.`}</p>
      <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-5">
        {constats.map((f, i) => (
          <li key={`${f.kind}-${f.field}-${i}`}>
            {f.kind === "person" ? "Nom de personne" : "Immatriculation ou code d'ensemble"}
            {`${INSECABLE}: `}
            <span className="font-semibold">{f.value}</span>, {OU[f.field]}
          </li>
        ))}
      </ul>
      <p className="m-0 mt-1.5">{`Remplacez-les par une fonction ou un objet («${INSECABLE}le conducteur${INSECABLE}», «${INSECABLE}une citerne${INSECABLE}»), puis diffusez.`}</p>
    </Notice>
  );
}

/** Valeurs codées du journal d'une alerte, en clair (le statut s'accorde à la nature du document). */
function valeurAlerte(kind: BulletinKind) {
  return (champ: string, v: string): string => {
    if (champ === "status") return statutAlerte(kind, v as BulletinStatus);
    if (champ === "kind") return NATURE_ALERTE[v as BulletinKind]?.label ?? v;
    return v;
  };
}

/**
 * Fiche d'une alerte flash ou d'un retour d'expérience (GET /hsseq/bulletins/{id}) : brouillon et son
 * contrôle d'anonymat (noms surlignés dans le texte), ce qui s'est passé, ce qu'il faut retenir,
 * lecture une fois diffusé, public visé, événement d'origine (profils de lecture complète), journal.
 * Les commandes suivent `rights` et `transitions` : le Responsable HSSEQ modifie le brouillon, le
 * diffuse, relance les lecteurs, archive avec un motif. L'auditeur ne voit aucune commande.
 */
export function FicheAlerte({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/bulletins/${id}`;
  const { data: b, error, mutate } = useApi<Bulletin>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string | ((maj: Bulletin) => string)): Promise<Bulletin> {
    const maj = await apiSend<Bulletin>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: typeof texte === "function" ? texte(maj) : texte });
    return maj;
  }

  if (!b) {
    return (
      <Panneau etiquette="Alertes et retours d'expérience" titre="Alerte" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de l'alerte…" />}
      </Panneau>
    );
  }
  const alerte = b;
  const nature = NATURE_ALERTE[b.kind];
  const pronom = nature.feminin ? "elle" : "il";
  const accord = nature.feminin ? "e" : "";

  async function diffuser() {
    const ok = await demanderConfirmation(
      `${alerte.reference} part aux comptes visés (${publicVise(alerte.audience)}), prévenus dans l'application et par courriel, qui en accusent lecture${INSECABLE}; ${pronom} ne se modifie plus ensuite.`,
      { titre: `Diffuser ${alerte.reference}${INSECABLE}?`, action: "Diffuser" },
    );
    if (!ok) return;
    setOccupe("diffuser");
    setMessage(null);
    try {
      await ecrire("POST", `${cle}/publish`, {}, (maj) => `${nature.label} diffusé${accord}${maj.read ? ` à ${pluriel(maj.read.targets, "compte visé", "comptes visés")}` : ""}.`);
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, "Diffusion impossible.") });
      // Refus d'anonymat : le contrôle de la fiche se relit avec le texte en cause.
      if (codeRefus(e) === "not_anonymized") void mutate();
    } finally {
      setOccupe(null);
    }
  }

  async function relancer() {
    const reste = (alerte.read?.targets ?? 0) - (alerte.read?.read ?? 0);
    const ok = await demanderConfirmation(`${pluriel(reste, "compte visé n'a", "comptes visés n'ont")} pas encore accusé lecture de ${alerte.reference}${INSECABLE}: ${reste > 1 ? "ils reçoivent" : "il reçoit"} un rappel dans l'application et par courriel.`, {
      titre: `Relancer les lecteurs de ${alerte.reference}${INSECABLE}?`,
      action: "Relancer",
    });
    if (!ok) return;
    setOccupe("relancer");
    setMessage(null);
    try {
      await ecrire("POST", `${cle}/remind`, {}, (maj) => (maj.reminded ? `${pluriel(maj.reminded, "compte relancé", "comptes relancés")}.` : `Aucun compte à relancer${INSECABLE}: tous ont lu.`));
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, "Relance impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  const lecture = droits.auditeur;
  const t = new Set(lecture ? [] : b.transitions);
  const modifiable = b.rights.can_edit && !lecture;
  const constats = b.anonymity_findings;
  const surligner = (champ: AnonymityFinding["field"]) => (constats ?? []).filter((f) => f.field === champ).map((f) => f.value);
  const reste = b.read ? b.read.targets - b.read.read : 0;
  const lignes = (b.key_messages ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <Panneau
      etiquette={nature.label}
      titre={b.reference}
      onFermer={onFermer}
      sousTitre={constats?.some((f) => f.field === "title") ? <Surligne texte={b.title} valeurs={surligner("title")} /> : b.title}
      tampons={
        <>
          <TamponDocument mot={statutAlerte(b.kind, b.status)} />
          {constats && constats.length > 0 && <TamponDocument mot="Noms à retirer" />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Commandes>
        {t.has("publish") && (
          <Button variant="primary" loading={occupe === "diffuser"} onClick={() => void diffuser()}>
            <Send className="h-4 w-4" /> Diffuser
          </Button>
        )}
        {modifiable && (
          <Button onClick={() => setFenetre("modifier")}>
            <Pencil className="h-4 w-4" /> Modifier le brouillon
          </Button>
        )}
        {t.has("remind") && (
          <Button loading={occupe === "relancer"} disabled={reste <= 0} title={reste > 0 ? undefined : "Tous les comptes visés ont lu"} onClick={() => void relancer()}>
            <Bell className="h-4 w-4" /> Relancer les lecteurs
          </Button>
        )}
        {t.has("archive") && (
          <Button variant="ghost" onClick={() => setFenetre("archive")}>
            Archiver
          </Button>
        )}
      </Commandes>

      {constats && <ControleAnonymat constats={constats} />}
      {b.status === "archived" && (
        <Notice tone="neutral">
          <span className="font-semibold text-ink">{`Archivé${accord}${INSECABLE}: `}</span>
          {b.archive_reason ?? "motif non renseigné."}
        </Notice>
      )}

      <Rubrique titre="Ce qui s'est passé">
        <p className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-ink">{constats ? <Surligne texte={b.body} valeurs={surligner("body")} /> : b.body}</p>
      </Rubrique>

      {lignes.length > 0 && (
        <div className="rounded-[12px] bg-accent-doux px-4 py-3">
          <p className="m-0 text-[12.5px] font-semibold text-ink">Ce qu&apos;il faut retenir</p>
          <ul className="m-0 mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] leading-snug text-ink">
            {lignes.map((l, i) => (
              <li key={i}>{constats ? <Surligne texte={l} valeurs={surligner("key_messages")} /> : l}</li>
            ))}
          </ul>
        </div>
      )}

      {b.read && (
        <Rubrique titre="Lecture">
          <Lecture stats={b.read} readers={b.readers} unread={b.unread} />
        </Rubrique>
      )}

      <Definitions
        lignes={[
          ["Profils visés", profilsVises(b.audience.profiles)],
          ["Sites visés", sitesVises(b.audience)],
          b.published_at && [`Diffusé${accord} le`, `${fmtDateTime(b.published_at)}${b.published_by ? `, par ${b.published_by.name}` : ""}`],
          b.event && [
            "Événement d'origine",
            <Link key="evenement" href={`/hsseq/evenements/${b.event.id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
              {b.event.reference}
            </Link>,
          ],
          ["Société", b.company.name],
        ]}
      />
      {b.event && <p className="m-0 -mt-2 text-[12px] leading-snug text-muted">L&apos;événement d&apos;origine n&apos;est jamais montré aux lecteurs du document.</p>}

      <Historique lignes={b.history} valeur={valeurAlerte(b.kind)} />

      {fenetre === "modifier" && <FenetreAlerte alerte={b} onClose={() => setFenetre(null)} envoyer={(corps) => ecrire("PATCH", cle, corps, "Brouillon mis à jour : le contrôle d'anonymat est refait.")} />}
      {fenetre === "archive" && (
        <FenetreMotif
          titre={`Archiver ${b.reference}`}
          aide={`${nature.feminin ? "L'alerte" : "Le retour d'expérience"} n'est plus proposé${accord} à la lecture et ses rappels s'arrêtent ; les accusés reçus restent au dossier.`}
          action="Archiver"
          danger
          onClose={() => setFenetre(null)}
          envoyer={(reason) => ecrire("POST", `${cle}/archive`, { reason }, `${nature.label} archivé${accord}.`)}
        />
      )}
    </Panneau>
  );
}
