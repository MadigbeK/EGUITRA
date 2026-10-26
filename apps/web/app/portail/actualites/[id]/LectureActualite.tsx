"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Flag, ShieldCheck } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, FEUILLE, Loading, cx } from "@/components/ui";
import { TexteRiche, dateLongue, quand } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { LienAction, NATURE, Retour, dateSimple, natureLien } from "@/components/portail/cabinet-porteur/briques";
import { PageIntrouvable, estIntrouvable } from "@/components/portail/projet/outils";
import { apiSend, useApi } from "@/lib/api-client";
import type { AnnouncementRow } from "@/lib/portail-types";

/** Lecture d'une communication du cabinet (la lecture est enregistrée) et accusé de lecture. */
export function LectureActualite({ id }: { id: number }) {
  const { rafraichir } = usePortail();
  const { data, error, mutate } = useApi<AnnouncementRow>(`/portail/actualites/${id}`);
  const { data: liste, error: erreurListe, mutate: mutateListe } = useApi<AnnouncementRow[]>("/portail/actualites");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [confirme, setConfirme] = useState(false);
  const [erreurLecture, setErreurLecture] = useState<unknown>(null);
  const lue = useRef<number | null>(null);

  // La lecture s'enregistre une fois la communication affichée, par une route POST : la lecture (GET)
  // n'écrit rien. Compteurs du menu et liste sont ensuite remis à jour.
  const enregistrerLecture = useCallback(
    async (annonce: number) => {
      setErreurLecture(null);
      try {
        const row = await apiSend<AnnouncementRow>("POST", `/portail/actualites/${annonce}/lue`);
        await mutate(row, false);
        rafraichir();
        void mutateListe();
      } catch (e) {
        setErreurLecture(e);
      }
    },
    [mutate, rafraichir, mutateListe],
  );

  useEffect(() => {
    if (!data || lue.current === data.id) return;
    lue.current = data.id;
    if (!data.read) void enregistrerLecture(data.id);
  }, [data, enregistrerLecture]);

  async function accuser() {
    if (!data) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const row = await apiSend<AnnouncementRow>("POST", `/portail/actualites/${data.id}/accuse`);
      await mutate(row, false);
      setConfirme(true);
      rafraichir();
      void mutateListe();
    } catch (e) {
      setErreur(e);
    } finally {
      setEnvoi(false);
    }
  }

  if (error) {
    return (
      <div>
        <Retour href="/portail/actualites">Toutes les actualités</Retour>
        {estIntrouvable(error) ? (
          <PageIntrouvable
            titre="Cette communication n'est pas disponible."
            texte="Elle a peut-être expiré, été retirée par le cabinet, ou s'adresse à d'autres porteurs."
            retour={{ href: "/portail/actualites", label: "Voir toutes les actualités" }}
          />
        ) : (
          <ErrorBox error={error} onRetry={() => void mutate()} />
        )}
      </div>
    );
  }
  if (!data) return <Loading label="Ouverture de la communication…" />;

  const n = NATURE[data.kind];
  const I = n.icon;
  const autres = (liste ?? []).filter((a) => a.id !== data.id).sort((a, b) => Number(a.read) - Number(b.read)).slice(0, 3);
  const cta = natureLien(data.cta_url) ? data.cta_url : null;

  return (
    <div>
      <Retour href="/portail/actualites">Toutes les actualités</Retour>

      {erreurLecture !== null && (
        <div className="mb-4">
          <ErrorBox error={erreurLecture} titre="Votre lecture n'a pas pu être enregistrée." onRetry={() => void enregistrerLecture(data.id)} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <article className={cx(FEUILLE, "min-w-0 overflow-hidden")}>
          <div aria-hidden className="h-1.5" style={{ background: n.trait }} />
          <div className="px-5 pb-8 pt-6 sm:px-10 sm:pt-9">
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: n.fond, color: n.encre }}>
                <I className="h-[18px] w-[18px]" />
              </span>
              <Badge tone={n.tone}>{data.kind_label}</Badge>
              {data.pinned && (
                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent">
                  <Flag className="h-3.5 w-3.5" /> Épinglée par le cabinet
                </span>
              )}
            </div>
            <h1 className="mt-4 max-w-[30ch] font-display text-[28px] font-bold leading-[1.15] tracking-[-0.01em] text-ink sm:text-[34px]">{data.title}</h1>
            <p className="mt-3 text-[13.5px] text-muted">
              {data.published_at && (
                <>
                  Publiée{" "}
                  <time dateTime={data.published_at} title={dateLongue(data.published_at, false)}>
                    {quand(data.published_at, true)}
                  </time>
                </>
              )}
              {data.author && <> par <span className="font-semibold text-ink-2">{data.author}</span></>}
              {data.expire_date && <> · Valable jusqu'au {dateSimple(data.expire_date)}</>}
            </p>

            <div className="mt-7 max-w-[70ch]">
              {data.body ? <TexteRiche source={data.body} /> : <p className="text-[15px] text-muted">{data.excerpt}</p>}
            </div>

            {cta && (
              <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl bg-panel-2 px-5 py-4">
                <span className="min-w-0 flex-1 text-[13.5px] text-ink-2">
                  {natureLien(cta) === "externe" ? "La suite se trouve sur un site extérieur au portail." : "Pour aller plus loin dans votre portail :"}
                </span>
                <LienAction url={cta}>{data.cta_label || "En savoir plus"}</LienAction>
              </div>
            )}

            {data.require_ack && (
              <div
                className={cx(
                  "mt-8 rounded-2xl border px-5 py-5",
                  data.acknowledged ? "border-ok/20 bg-ok-doux" : "border-warn/25 bg-warn-doux",
                )}
              >
                {data.acknowledged ? (
                  <div role="status" className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-ok" />
                    <div>
                      <div className="text-[14.5px] font-semibold text-ink">{confirme ? "Merci, votre lecture est confirmée." : "Vous avez confirmé la lecture de cette communication."}</div>
                      <div className="mt-0.5 text-[13px] text-ink-2">Le cabinet en est informé.</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-4">
                    <ShieldCheck className="h-6 w-6 flex-none text-warn" />
                    <div className="min-w-[220px] flex-1">
                      <div className="text-[14.5px] font-semibold text-ink">Confirmation demandée</div>
                      <div className="mt-0.5 text-[13px] leading-snug text-ink-2">Le cabinet vous demande de confirmer que vous avez lu et pris connaissance de cette communication.</div>
                    </div>
                    <Button variant="primary" loading={envoi} onClick={() => void accuser()}>
                      J'ai lu et pris connaissance
                    </Button>
                    {erreur !== null && (
                      <div className="w-full">
                        <ErrorBox error={erreur} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </article>

        <aside className="space-y-4">
          <Card title="Une question ?">
            <p className="text-[13.5px] leading-relaxed text-ink-2">Votre consultant peut vous dire si cette communication concerne votre dossier.</p>
            <Link href="/portail/messages" className="mt-3 inline-flex text-[13.5px] font-semibold text-accent hover:underline">
              Écrire à mon consultant
            </Link>
          </Card>
          {!liste && erreurListe && (
            <Card title="À lire aussi">
              <ErrorBox error={erreurListe} titre="Les autres communications n'ont pas pu être chargées." onRetry={() => void mutateListe()} />
            </Card>
          )}
          {autres.length > 0 && (
            <Card title="À lire aussi">
              <ul className="-mx-2 space-y-1">
                {autres.map((a) => (
                  <li key={a.id}>
                    <Link href={`/portail/actualites/${a.id}`} className="flex gap-2.5 rounded-xl px-2 py-2 hover:bg-panel-2">
                      <span aria-hidden className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: a.read ? "var(--line-strong)" : "var(--accent-vif)" }} />
                      <span className="min-w-0">
                        <span className={cx("block text-[13.5px] leading-snug", a.read ? "text-ink-2" : "font-semibold text-ink")}>{a.title}</span>
                        <span className="block text-[12px] text-muted">
                          {a.kind_label}, {quand(a.published_at)}
                          {!a.read && <span className="sr-only"> (non lue)</span>}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
