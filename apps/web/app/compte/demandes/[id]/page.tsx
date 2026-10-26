"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, use, useState, type ReactNode } from "react";
import { ChevronLeft, RotateCcw, Send } from "@/components/icons";
import { BadgeEtat, BadgeGravite, CHEMIN_DEMANDES, graviteUtile, messageErreur, texteDelai } from "@/components/compte/demandes";
import { TraitementDemande } from "@/components/compte/TraitementDemande";
import { Badge, Button, Card, Etat, Loading, Notice, Tag, Textarea, cx } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDateTime, fmtDec } from "@/lib/format";
import { GRAVITES, libelleApp, libelleType, type Commentaire, type FicheDemande } from "@/lib/support-types";

export default function FicheDemandePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading label="Chargement de la demande…" />}>
      <Fiche id={id} />
    </Suspense>
  );
}

function Fiche({ id }: { id: string }) {
  const depot = useSearchParams().get("depot") === "1";
  const { data: d, error, mutate } = useApi<FicheDemande>(`/support/requests/${id}`);
  const maj = (fiche: FicheDemande) => void mutate(fiche, { revalidate: false });

  return (
    <div>
      <Link href={CHEMIN_DEMANDES} className="mb-4 inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
        <ChevronLeft className="h-4 w-4" /> Mes demandes
      </Link>
      <Etat data={d} error={error} onRetry={() => void mutate()} label="Chargement de la demande…">
        {(fiche) => (
          <>
            <EnTete d={fiche} />
            <div className="mb-5 space-y-3">
              {depot && <AccuseDepot d={fiche} />}
              {fiche.can.close && !fiche.can.manage && <ConfirmationAuteur d={fiche} onFait={maj} />}
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Fil d={fiche} onFait={maj} />
              <div className="space-y-5">
                {fiche.can.manage && <TraitementDemande key={cleTraitement(fiche)} d={fiche} onFait={maj} />}
                <Suivi d={fiche} />
                {fiche.kind === "evolution" && <Evolution d={fiche} />}
              </div>
            </div>
          </>
        )}
      </Etat>
    </div>
  );
}

/** Le formulaire de traitement repart des valeurs enregistrées après chaque envoi. */
function cleTraitement(d: FicheDemande): string {
  return JSON.stringify([d.state, d.kind, d.severity, d.app, d.response, d.qualification, d.credit_days, d.planned_date]);
}

function EnTete({ d }: { d: FicheDemande }) {
  return (
    <header className="mb-5">
      <div className="text-[13px] font-semibold tabular text-muted">
        {d.name} · {libelleType(d.kind)}
      </div>
      <h1 className="mt-1 font-display text-[26px] font-[650] leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">{d.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <BadgeEtat etat={d.state} />
        {graviteUtile(d.kind) && <BadgeGravite gravite={d.severity} />}
        <Tag>{libelleApp(d.app)}</Tag>
        <Tag>{d.company.name}</Tag>
      </div>
    </header>
  );
}

function AccuseDepot({ d }: { d: FicheDemande }) {
  const g = GRAVITES.find((x) => x.value === d.severity);
  const delai = d.kind === "evolution" ? "elle sera qualifiée par écrit sous 2 jours ouvrés" : graviteUtile(d.kind) && g ? `engagement de ${g.delais}` : "réponse sous 1 jour ouvré";
  return (
    <Notice tone="ok">
      Demande <strong>{d.name}</strong> déposée. L&apos;accusé de réception paraîtra dans le fil dès sa prise en charge ({delai}).
    </Notice>
  );
}

/** L'auteur d'une demande résolue confirme la résolution (la demande est close) ou la rouvre, avec son motif. */
function ConfirmationAuteur({ d, onFait }: { d: FicheDemande; onFait: (f: FicheDemande) => void }) {
  const [rouvrir, setRouvrir] = useState(false);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState<"clore" | "rouvrir" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function agir(action: "clore" | "rouvrir") {
    setEnvoi(action);
    setErreur(null);
    try {
      const fiche = action === "clore" ? await apiSend<FicheDemande>("POST", `/support/requests/${d.id}/close`) : await apiSend<FicheDemande>("POST", `/support/requests/${d.id}/reopen`, { body: motif.trim() });
      onFait(fiche);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <Notice tone="warn">
      <div className="space-y-3">
        <p>La demande est résolue. Confirmez la résolution pour la clore, ou rouvrez-la si le problème persiste. Sans réponse sous 5 jours ouvrés, elle sera close d&apos;office.</p>
        {erreur && <p className="font-semibold text-danger">{erreur}</p>}
        {rouvrir ? (
          <div className="space-y-2">
            <Textarea rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ce qui ne fonctionne toujours pas" aria-label="Motif de la réouverture" />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={envoi === "rouvrir"} disabled={!motif.trim() || envoi !== null} onClick={() => agir("rouvrir")}>
                <RotateCcw className="h-4 w-4" /> Rouvrir la demande
              </Button>
              <Button onClick={() => setRouvrir(false)} disabled={envoi !== null}>
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={envoi === "clore"} disabled={envoi !== null} onClick={() => agir("clore")}>
              Confirmer la résolution
            </Button>
            <Button onClick={() => setRouvrir(true)} disabled={envoi !== null}>
              <RotateCcw className="h-4 w-4" /> Le problème persiste
            </Button>
          </div>
        )}
      </div>
    </Notice>
  );
}

function jour(date: string) {
  const x = new Date(date);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
}

/** Fil de la demande : la description de l'auteur, les messages, et chaque étape du suivi. */
function Fil({ d, onFait }: { d: FicheDemande; onFait: (f: FicheDemande) => void }) {
  const auteur = d.author?.id;
  const premier: Commentaire = { id: 0, author: d.author, date: d.date_submitted, body: d.description, event: false, mine: d.mine };
  const fil = [premier, ...d.comments];
  return (
    <Card title="Échanges" padded={false} className="self-start">
      <ol className="space-y-3 bg-panel-2/40 px-4 py-4 sm:px-5" aria-live="polite">
        {fil.map((c, i) => {
          const precedent = fil[i - 1];
          return (
            <Fragment key={c.id}>
              {(!precedent || jour(precedent.date) !== jour(c.date)) && (
                <li aria-hidden className="flex items-center gap-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                  <span className="h-px flex-1 bg-line" />
                  {fmtDate(c.date)}
                  <span className="h-px flex-1 bg-line" />
                </li>
              )}
              {c.event ? <Evenement c={c} /> : <Message c={c} support={c.author?.id !== auteur} />}
            </Fragment>
          );
        })}
      </ol>
      {d.can.comment ? (
        <Saisie d={d} onFait={onFait} />
      ) : (
        <p className="border-t border-line px-5 py-3.5 text-[13px] text-muted">
          {d.state === "closed" || d.state === "refused" ? "Demande terminée : pour un nouveau besoin, déposez une nouvelle demande." : "Seuls l'auteur de la demande et le support écrivent dans ce fil."}
        </p>
      )}
    </Card>
  );
}

function Evenement({ c }: { c: Commentaire }) {
  return (
    <li className="flex gap-2.5 px-1 text-[13px] leading-relaxed text-ink-2">
      <span aria-hidden className="mt-[7px] h-2 w-2 flex-none rounded-full bg-accent-vif" />
      <div className="min-w-0">
        <p className="whitespace-pre-line">{c.body}</p>
        <p className="text-[12px] text-muted">
          Suivi · {fmtDateTime(c.date)}
          {c.author ? ` · ${c.author.name}` : ""}
        </p>
      </div>
    </li>
  );
}

function Message({ c, support }: { c: Commentaire; support: boolean }) {
  return (
    <li className={cx("flex", support ? "justify-start" : "justify-end")}>
      <div className={cx("max-w-[min(100%,620px)] rounded-2xl px-4 py-2.5 shadow-[0_1px_2px_rgb(16_36_31/0.05)]", support ? "rounded-bl-md border border-line bg-panel" : "rounded-br-md bg-accent-doux")}>
        <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
          <span className="font-semibold text-ink">{c.mine ? "Vous" : (c.author?.name ?? "–")}</span>
          {support && <span className="text-muted">support</span>}
          <time dateTime={c.date} className="text-muted">
            {fmtDateTime(c.date)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{c.body}</p>
      </div>
    </li>
  );
}

function Saisie({ d, onFait }: { d: FicheDemande; onFait: (f: FicheDemande) => void }) {
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const fiche = await apiSend<FicheDemande>("POST", `/support/requests/${d.id}/comments`, { body: texte.trim() });
      setTexte("");
      onFait(fiche);
    } catch (e) {
      setErreur(messageErreur(e, "Envoi impossible."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-line px-5 py-4">
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      <Textarea rows={3} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Précision, capture décrite, réponse à une question du support…" aria-label="Message" />
      <div className="flex justify-end">
        <Button variant="primary" loading={envoi} disabled={!texte.trim()} onClick={envoyer}>
          <Send className="h-4 w-4" /> Envoyer
        </Button>
      </div>
    </div>
  );
}

function Ligne({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2 text-[13.5px] last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

/** Suivi : dates, délais engagés et constatés, réponse écrite du support. */
function Suivi({ d }: { d: FicheDemande }) {
  return (
    <>
      <Card title="Suivi">
        <dl>
          <Ligne label="Déposée le">
            {fmtDateTime(d.date_submitted)}
            <span className="block text-[12px] text-muted">par {d.mine ? "vous" : (d.author?.name ?? "–")}</span>
          </Ligne>
          <Ligne label="Prise en charge">
            {d.date_taken ? fmtDateTime(d.date_taken) : "En attente"}
            {d.taken_by && <span className="block text-[12px] text-muted">par {d.taken_by.name}</span>}
            <span className="block text-[12px] text-muted">{texteDelai(d.take_over, "prise en charge")}</span>
            {d.take_over.late && <Badge tone="danger">Hors délai</Badge>}
          </Ligne>
          {d.kind !== "evolution" && (
            <Ligne label="Résolution">
              {d.date_resolved ? fmtDateTime(d.date_resolved) : d.state === "refused" ? "Refusée" : "En cours"}
              <span className="block text-[12px] text-muted">{texteDelai(d.resolution, "résolution")}</span>
              {d.resolution.late && <Badge tone="danger">Hors délai</Badge>}
            </Ligne>
          )}
          {d.kind === "evolution" && d.date_resolved && <Ligne label="Livrée le">{fmtDateTime(d.date_resolved)}</Ligne>}
          {d.date_closed && <Ligne label="Close le">{fmtDateTime(d.date_closed)}</Ligne>}
        </dl>
      </Card>
      {d.response && (
        <Card title={d.state === "refused" ? "Motif du refus" : "Réponse du support"}>
          <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{d.response}</p>
        </Card>
      )}
    </>
  );
}

/** Évolution : qualification, crédit imputé et crédit du trimestre (offre, chapitre 7.4). */
function Evolution({ d }: { d: FicheDemande }) {
  const c = d.credit;
  return (
    <Card title="Évolution">
      <dl>
        <Ligne label="Qualification">{d.qualification === "incluse" ? "Incluse dans le crédit" : d.qualification === "facturable" ? "Facturable sur devis" : "À qualifier sous 2 jours ouvrés"}</Ligne>
        {d.credit_days > 0 && (
          <Ligne label="Crédit imputé">
            {fmtDec(d.credit_days)} {d.credit_days >= 2 ? "jours" : "jour"}
            {d.credit_date && <span className="block text-[12px] text-muted">le {fmtDate(d.credit_date)}</span>}
          </Ligne>
        )}
        {d.planned_date && <Ligne label="Livraison proposée">{fmtDate(d.planned_date)}</Ligne>}
        {c && (
          <Ligne label={`Crédit du trimestre ${c.label}`}>
            {fmtDec(c.remaining)}{INSECABLE}j restants sur {fmtDec(c.per_quarter)}
            <span className="block text-[12px] text-muted">{fmtDec(c.used)}{INSECABLE}j consommés</span>
          </Ligne>
        )}
      </dl>
      {d.qualification === "facturable" && <p className="mt-3 text-[12.5px] leading-snug text-muted">Devis au tarif de l&apos;offre (chapitre 7.4), engagé seulement après accord écrit du client.</p>}
    </Card>
  );
}
