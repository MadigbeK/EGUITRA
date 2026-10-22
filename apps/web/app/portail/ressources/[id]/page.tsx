"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { ArrowUpRight, Check, Download, FileText, Loader2, Mail, X } from "@/components/icons";
import { Card, ErrorBox, FEUILLE, Loading, cx } from "@/components/ui";
import { COULEUR, TexteRiche, iconeRubrique, taille } from "@/components/portail/commun";
import { Retour, TitreSection, dateSimple, pluriel } from "@/components/portail/cabinet-porteur/briques";
import { Lecture, Signet } from "@/components/portail/cabinet-porteur/pictos";
import { CarteRessource, FORMATS } from "@/components/portail/cabinet-porteur/ressources";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import type { ArticleDetail, ArticleRow, Attachment } from "@/lib/portail-types";

function hote(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Lecture d'un conseil du cabinet : colonne éditoriale, vidéo, fichiers, favori et avis d'utilité. */
export default function LectureRessource() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useApi<ArticleDetail>(id ? `/portail/ressources/${id}` : null);
  const [envoi, setEnvoi] = useState<"favori" | "utile" | null>(null);
  const [fichier, setFichier] = useState<number | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);

  async function reagir(corps: { bookmarked: boolean } | { helpful: boolean }, quoi: "favori" | "utile") {
    if (!data) return;
    setEnvoi(quoi);
    setErreur(null);
    try {
      const row = await apiSend<ArticleRow>("POST", `/portail/ressources/${data.id}/reaction`, corps);
      let compte = data.helpful_count;
      if ("helpful" in corps) {
        if (data.helpful !== "yes" && row.helpful === "yes") compte += 1;
        if (data.helpful === "yes" && row.helpful !== "yes") compte = Math.max(0, compte - 1);
      }
      await mutate({ ...data, ...row, helpful_count: compte }, false);
    } catch (e) {
      setErreur(e);
    } finally {
      setEnvoi(null);
    }
  }

  async function telecharger(f: Attachment) {
    if (!data) return;
    setFichier(f.id);
    setErreur(null);
    try {
      await apiDownload(`/portail/ressources/${data.id}/fichiers/${f.id}`, f.name);
    } catch (e) {
      setErreur(e);
    } finally {
      setFichier(null);
    }
  }

  if (error) {
    return (
      <div>
        <Retour href="/portail/ressources">Conseils et ressources</Retour>
        <ErrorBox error={error} onRetry={() => void mutate()} />
      </div>
    );
  }
  if (!data) return <Loading label="Ouverture du conseil…" />;

  const r = data.category;
  const couleur = r ? COULEUR[r.color] : null;
  const IR = iconeRubrique(r?.icon);
  const F = FORMATS[data.kind];
  const video = data.video_url && /^https:\/\//.test(data.video_url) ? data.video_url : null;

  const actions = (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="p-5">
          <button
            type="button"
            aria-pressed={data.bookmarked}
            disabled={envoi === "favori"}
            onClick={() => void reagir({ bookmarked: !data.bookmarked }, "favori")}
            className={cx(
              "flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] font-semibold transition-colors disabled:opacity-60",
              data.bookmarked ? "border-accent bg-accent text-white hover:bg-accent-strong" : "border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2",
            )}
          >
            {envoi === "favori" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Signet className="h-4 w-4" fill={data.bookmarked ? "currentColor" : "none"} />}
            {data.bookmarked ? "Dans mes favoris" : "Garder en favori"}
          </button>
          <p className="mt-2 text-center text-[12px] text-muted">
            {data.bookmarked ? "Retrouvez-le dans « Mes favoris »." : "Pour le retrouver en un geste."}
          </p>
        </div>
        <div className="border-t border-line p-5">
          <div id="utile" className="text-[14px] font-semibold text-ink">Ce contenu vous a-t-il été utile ?</div>
          <div role="group" aria-labelledby="utile" className="mt-3 grid grid-cols-2 gap-2">
            {([true, false] as const).map((oui) => {
              const choisi = data.helpful === (oui ? "yes" : "no");
              const I = oui ? Check : X;
              return (
                <button
                  key={String(oui)}
                  type="button"
                  aria-pressed={choisi}
                  disabled={envoi === "utile"}
                  onClick={() => !choisi && void reagir({ helpful: oui }, "utile")}
                  className={cx(
                    "inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[13.5px] font-semibold transition-colors disabled:opacity-60",
                    choisi ? (oui ? "border-ok bg-ok text-white" : "border-ink-2 bg-ink-2 text-white") : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink",
                  )}
                >
                  <I className="h-4 w-4" /> {oui ? "Oui" : "Non"}
                </button>
              );
            })}
          </div>
          <p aria-live="polite" className="mt-2.5 text-[12.5px] leading-snug text-muted">
            {data.helpful === "yes"
              ? "Merci ! Votre avis aide le cabinet à choisir ses prochains conseils."
              : data.helpful === "no"
                ? "Merci. Dites à votre consultant ce qui vous a manqué : il complétera ce conseil."
                : data.helpful_count > 0
                  ? `${pluriel(data.helpful_count, "personne")} ${data.helpful_count > 1 ? "l'ont trouvé utile" : "l'a trouvé utile"}.`
                  : "Votre avis aide le cabinet à améliorer ses conseils."}
          </p>
          {data.helpful !== null && data.helpful_count > 0 && (
            <p className="mt-1 text-[12px] text-muted">
              {pluriel(data.helpful_count, "personne")} {data.helpful_count > 1 ? "l'ont trouvé utile" : "l'a trouvé utile"}.
            </p>
          )}
        </div>
        <Link href="/portail/messages" className="flex items-center gap-3 rounded-b-[20px] border-t border-line bg-panel-2 px-5 py-4 transition-colors hover:bg-panel-3">
          <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent-doux text-accent">
            <Mail className="h-4 w-4" />
          </span>
          <span className="min-w-0 text-[13px] leading-snug">
            <span className="block font-semibold text-ink">Une question ?</span>
            <span className="block text-muted">Écrivez à votre consultant</span>
          </span>
        </Link>
      </Card>
    </div>
  );

  return (
    <div>
      <Retour href="/portail/ressources">Conseils et ressources</Retour>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className={cx(FEUILLE, "min-w-0 overflow-hidden")}>
          <header
            className="relative px-5 pb-7 pt-7 sm:px-10 sm:pt-10"
            style={{ background: couleur ? couleur.doux : "var(--accent-doux)" } as CSSProperties}
          >
            <div className="mx-auto max-w-[70ch]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] font-semibold">
                {r && (
                  <Link
                    href={`/portail/ressources?rubrique=${r.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 shadow-[0_1px_2px_rgb(16_36_31/0.08)] hover:underline"
                    style={{ color: couleur?.vif }}
                  >
                    <IR className="h-3.5 w-3.5" /> {r.name}
                  </Link>
                )}
                <span className="inline-flex items-center gap-1.5 uppercase tracking-[0.08em] text-muted">
                  <F.icon className="h-3.5 w-3.5" /> {data.kind_label || F.label}
                </span>
                {data.recommended && <span className="rounded-full bg-accent-doux px-2 py-0.5 text-accent">Recommandé pour votre étape</span>}
              </div>
              <h1 className="mt-4 font-display text-[29px] font-bold leading-[1.12] tracking-[-0.015em] text-ink sm:text-[38px]">{data.title}</h1>
              {data.summary && <p className="mt-4 text-[17px] leading-relaxed text-ink-2 sm:text-[18.5px]">{data.summary}</p>}
              <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                <span>Par <span className="font-semibold text-ink-2">{data.author}</span></span>
                {data.published_at && <span>· {dateSimple(data.published_at)}</span>}
                {data.reading_minutes > 0 && <span>· {data.reading_minutes} min de lecture</span>}
                {data.viewed && <span className="text-ok-texte">· Déjà lu</span>}
              </p>
            </div>
          </header>

          <div className="px-5 pb-10 sm:px-10">
            <div className="mx-auto max-w-[70ch]">
              {video && (
                <a
                  href={video}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group mb-8 flex items-center gap-4 overflow-hidden rounded-2xl bg-accent-strong p-5 text-white shadow-[0_24px_40px_-28px_rgb(16_40_70/0.8)]"
                >
                  <span aria-hidden className="grid h-14 w-14 flex-none place-items-center rounded-full bg-white/15 transition-transform group-hover:scale-105">
                    <Lecture className="h-7 w-7" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">Regarder la vidéo</span>
                    <span className="block truncate text-[12.5px] text-white/70">Sur {hote(video)}, dans un nouvel onglet</span>
                  </span>
                  <ArrowUpRight className="h-5 w-5 text-white/80" />
                </a>
              )}

              {data.body ? <TexteRiche source={data.body} /> : <p className="text-[15px] text-muted">Ce contenu se compose de ses fichiers à télécharger.</p>}

              {data.files.length > 0 && (
                <section aria-labelledby="fichiers" className="mt-10">
                  <h2 id="fichiers" className="mb-3 font-display text-[18px] font-bold text-ink">
                    {data.files.length > 1 ? "Fichiers à télécharger" : "Fichier à télécharger"}
                  </h2>
                  <ul className="space-y-2">
                    {data.files.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => void telecharger(f)}
                          disabled={fichier === f.id}
                          className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-accent-vif/40 hover:bg-panel-2 disabled:opacity-70"
                        >
                          <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent-doux text-accent">
                            <FileText className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-ink">{f.name}</span>
                            {f.size ? <span className="block text-[12px] text-muted">{taille(f.size)}</span> : null}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent">
                            {fichier === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            <span className="hidden sm:inline">Télécharger</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.tags.length > 0 && (
                <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-line pt-5">
                  <span className="text-[12.5px] font-semibold text-muted">Mots-clés :</span>
                  {data.tags.map((t) => (
                    <Link key={t} href={`/portail/ressources?q=${encodeURIComponent(t)}`} className="rounded-full bg-panel-2 px-2.5 py-1 text-[12.5px] font-medium text-ink-2 hover:bg-panel-3 hover:text-ink">
                      {t}
                    </Link>
                  ))}
                </div>
              )}

              {erreur !== null && (
                <div className="mt-6">
                  <ErrorBox error={erreur} />
                </div>
              )}
            </div>
          </div>
        </article>

        <aside className="lg:sticky lg:top-24 lg:self-start">{actions}</aside>
      </div>

      {data.related.length > 0 && (
        <section aria-labelledby="a-lire-ensuite" className="mt-10">
          <TitreSection id="a-lire-ensuite">À lire ensuite</TitreSection>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.related.map((a) => (
              <li key={a.id}>
                <CarteRessource a={a} rubrique={r && a.category_id === r.id ? r : null} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
