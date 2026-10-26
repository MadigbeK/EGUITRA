"use client";

/**
 * Documents à lire du compte connecté et leur accusé de lecture (GET /hsseq/my/documents) : alertes
 * flash et retours d'expérience diffusés qui le visent, puis procédures en vigueur, les non lus d'abord.
 * Une alerte se lit sur place ; une procédure se lit dans son document, téléchargé. L'accusé est daté,
 * enregistré et ne se retire pas : il est confirmé avant l'envoi.
 *
 * Composant autonome, sans l'adresse ni les droits de l'écran HSSEQ : il sert tel quel dans l'espace
 * d'un salarié ou une autre application. Le filtre « À lire seulement » est tenu par le parent s'il le
 * passe (`nonLus`, `onNonLus`), sinon sur place.
 */

import { useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { CheckCheck, Download } from "@/components/icons";
import { Button, Card, Empty, Etat, Notice, Tag, demanderConfirmation } from "@/components/ui";
import { DOMAINE } from "@/components/hsseq/commun";
import { Bascule } from "@/components/hsseq/actions/outils";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDateTime, fmtInt, pluriel } from "@/lib/format";
import type { Attachment } from "@/lib/hsseq-types";
import { NATURE_ALERTE, TamponDocument, codeRefus, messageDocument } from "./libelles";
import type { AcknowledgeInput, MyBulletin, MyDocuments, MyProcedure } from "./types";

/** Refus d'un accusé, affiché sous le document concerné. */
interface Refus {
  cle: string;
  texte: string;
}

export function MesDocuments({ nonLus, onNonLus }: { nonLus?: boolean; onNonLus?: (v: boolean) => void }) {
  const { data, error, mutate } = useApi<MyDocuments>("/hsseq/my/documents");
  const { mutate: muter } = useSWRConfig();
  const [filtreLocal, setFiltreLocal] = useState(false);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [refus, setRefus] = useState<Refus | null>(null);
  const filtre = nonLus ?? filtreLocal;
  const changerFiltre = onNonLus ?? setFiltreLocal;

  if (!data) return <Etat error={error} onRetry={() => void mutate()} label="Chargement de vos documents…" />;

  /** Taux de lecture des écrans de gestion, relus après un accusé. */
  const relireGestion = () => muter((k) => typeof k === "string" && (k.startsWith("/hsseq/procedures") || k.startsWith("/hsseq/bulletins")));

  /** Envoie l'accusé confirmé ; un refus reste sous le document, et la liste est relue s'il dit qu'elle a changé. */
  async function accuser(cle: string, chemin: string, corps: AcknowledgeInput) {
    setOccupe(cle);
    setRefus(null);
    try {
      await apiSend("POST", chemin, corps);
      await mutate();
      void relireGestion();
    } catch (e) {
      // Nouvelle version en vigueur (409) ou document retiré entre-temps (404) : la liste se relit.
      if (codeRefus(e) === "conflict" || codeRefus(e) === "not_found") void mutate();
      setRefus({ cle, texte: messageDocument(e, "L'accusé de lecture n'a pas été enregistré.") });
    } finally {
      setOccupe(null);
    }
  }

  async function lireProcedure(p: MyProcedure) {
    const ok = await demanderConfirmation(`Vous confirmez avoir lu la version ${p.version.version} de «${INSECABLE}${p.title}${INSECABLE}». Votre accusé est daté et enregistré${INSECABLE}; il ne se retire pas.`, {
      titre: `Accuser lecture de ${p.code}${INSECABLE}?`,
      action: "J'ai lu la procédure",
    });
    if (ok) await accuser(`p${p.id}`, `/hsseq/procedures/${p.id}/acknowledge`, { version_id: p.version.id });
  }

  async function lireAlerte(b: MyBulletin) {
    const nature = NATURE_ALERTE[b.kind];
    const ok = await demanderConfirmation(`Vous confirmez avoir lu ${nature.feminin ? "l'alerte" : "le retour d'expérience"} ${b.reference} et ce qu'il faut en retenir. Votre accusé est daté et enregistré${INSECABLE}; il ne se retire pas.`, {
      titre: `Accuser lecture de ${b.reference}${INSECABLE}?`,
      action: "J'ai lu",
    });
    if (ok) await accuser(`b${b.id}`, `/hsseq/bulletins/${b.id}/acknowledge`, {});
  }

  const total = data.procedures.length + data.bulletins.length;
  const alertes = data.bulletins.filter((b) => !filtre || !b.read);
  const procedures = data.procedures.filter((p) => !filtre || !p.read);

  if (!total) {
    return (
      <Card>
        <Empty title="Aucun document ne vous est adressé" hint="Les procédures en vigueur et les alertes qui visent votre profil et votre site s'afficheront ici, avec votre accusé de lecture." />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[70ch] text-[13.5px] leading-snug text-ink-2">
          {data.unread_count ? (
            <>
              <span className="font-semibold text-ink">{pluriel(data.unread_count, "document à lire", "documents à lire")}</span>
              {`${INSECABLE}: lisez-les, puis accusez-en lecture. Un rappel vous est envoyé tant qu'ils ne le sont pas.`}
            </>
          ) : (
            `Tout est lu${INSECABLE}: aucun document ne vous attend.`
          )}
        </p>
        <Bascule actif={filtre} onChange={changerFiltre} nombre={data.unread_count}>
          À lire seulement
        </Bascule>
      </div>

      {filtre && !alertes.length && !procedures.length && (
        <Card>
          <Empty title="Tout est lu" hint="Retirez le filtre pour relire les documents dont vous avez déjà accusé lecture." />
        </Card>
      )}

      {alertes.length > 0 && (
        <Card title="Alertes et retours d'expérience" padded={false}>
          <ul className="divide-y divide-line/80">
            {alertes.map((b) => (
              <li key={b.id} className="px-6 py-5">
                <AlerteALire b={b} occupe={occupe === `b${b.id}`} refus={refus?.cle === `b${b.id}` ? refus.texte : null} onLire={() => void lireAlerte(b)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {procedures.length > 0 && (
        <Card title="Procédures" padded={false}>
          <ul className="divide-y divide-line/80">
            {procedures.map((p) => (
              <li key={p.id} className="px-6 py-5">
                <ProcedureALire p={p} occupe={occupe === `p${p.id}`} refus={refus?.cle === `p${p.id}` ? refus.texte : null} onLire={() => void lireProcedure(p)} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Date de l'accusé, ou le bouton qui l'envoie ; le refus du noyau dessous. */
function Accuse({ lu, le, libelle, occupe, refus, onLire }: { lu: boolean; le: string | null; libelle: string; occupe: boolean; refus: string | null; onLire: () => void }) {
  return (
    <>
      {lu ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
          <CheckCheck className="h-3.5 w-3.5" aria-hidden />
          Lecture accusée le {fmtDateTime(le)}
        </span>
      ) : (
        <Button variant="primary" loading={occupe} onClick={onLire}>
          <CheckCheck className="h-4 w-4" /> {libelle}
        </Button>
      )}
      {refus && (
        <div className="w-full">
          <Notice tone="danger">{refus}</Notice>
        </div>
      )}
    </>
  );
}

/** En-tête d'un document : ses repères, puis « À lire » tant que l'accusé manque. */
function Reperes({ children, lu }: { children: ReactNode; lu: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12.5px] text-muted">
      {children}
      {!lu && <TamponDocument mot="À lire" />}
    </div>
  );
}

/** Ce qu'il faut retenir, une consigne par ligne. */
function ARetenir({ texte }: { texte: string }) {
  const lignes = texte
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <div className="mt-3 rounded-[12px] bg-accent-doux px-4 py-3">
      <p className="m-0 text-[12.5px] font-semibold text-ink">Ce qu&apos;il faut retenir</p>
      <ul className="m-0 mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] leading-snug text-ink">
        {lignes.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Alerte ou retour d'expérience : non lu, le texte entier et ce qu'il faut retenir ; déjà lu, le titre
 * seul, le texte se rouvrant d'un clic.
 */
function AlerteALire({ b, occupe, refus, onLire }: { b: MyBulletin; occupe: boolean; refus: string | null; onLire: () => void }) {
  const nature = NATURE_ALERTE[b.kind];
  const reperes = (
    <Reperes lu={b.read}>
      <Tag>{nature.label}</Tag>
      <span className="font-mono text-[11.5px]">{b.reference}</span>
      <span>
        diffusé{nature.feminin ? "e" : ""} le {fmtDate(b.published_at)}
      </span>
    </Reperes>
  );
  const contenu = (
    <>
      <p className="m-0 mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{b.body}</p>
      {b.key_messages && <ARetenir texte={b.key_messages} />}
    </>
  );
  if (b.read) {
    return (
      <article>
        {reperes}
        <details className="group mt-2">
          <summary className="cursor-pointer text-[15px] font-semibold leading-snug text-ink marker:text-muted">{b.title}</summary>
          {contenu}
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Accuse lu le={b.read_at} libelle="J'ai lu" occupe={false} refus={null} onLire={onLire} />
        </div>
      </article>
    );
  }
  return (
    <article>
      {reperes}
      <h3 className="m-0 mt-2 text-[15.5px] font-semibold leading-snug text-ink">{b.title}</h3>
      {contenu}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Accuse lu={false} le={null} libelle={nature.feminin ? "J'ai lu cette alerte" : "J'ai lu ce retour d'expérience"} occupe={occupe} refus={refus} onLire={onLire} />
      </div>
    </article>
  );
}

/** Procédure en vigueur : version, ce qui change, document à télécharger, accusé de lecture. */
function ProcedureALire({ p, occupe, refus, onLire }: { p: MyProcedure; occupe: boolean; refus: string | null; onLire: () => void }) {
  const [erreur, setErreur] = useState<string | null>(null);
  async function telecharger(d: Attachment) {
    setErreur(null);
    try {
      await apiDownload(d.url, d.name);
    } catch (e) {
      setErreur(messageDocument(e, "Le document n'a pas pu être téléchargé."));
    }
  }
  return (
    <article>
      <Reperes lu={p.read}>
        <span className="font-mono text-[11.5px]">{p.code}</span>
        <span>
          version {p.version.version}, en vigueur le {fmtDate(p.version.effective_date)}
        </span>
        {p.domain && <Tag>{DOMAINE[p.domain]}</Tag>}
      </Reperes>
      <h3 className="m-0 mt-2 text-[15.5px] font-semibold leading-snug text-ink">{p.title}</h3>
      {p.version.change_summary && (
        <p className="m-0 mt-1.5 whitespace-pre-line text-[13px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">{`Ce qui change${INSECABLE}: `}</span>
          {p.version.change_summary}
        </p>
      )}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {p.document.map((d) => (
          <Button key={d.id} onClick={() => void telecharger(d)} title={d.name}>
            <Download className="h-4 w-4" /> {p.document.length > 1 ? d.name : "Télécharger le document"}
            <span className="sr-only">{` ${d.name}, ${fmtInt(Math.max(1, Math.round(d.size / 1024)))}${INSECABLE}ko`}</span>
          </Button>
        ))}
        {!p.document.length && <span className="text-[12.5px] text-muted">{`Document non joint${INSECABLE}: demandez-le au Responsable HSSEQ.`}</span>}
        <Accuse lu={p.read} le={p.read_at} libelle="J'ai lu la procédure" occupe={occupe} refus={refus} onLire={onLire} />
      </div>
      {erreur && (
        <div className="mt-3">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
    </article>
  );
}
