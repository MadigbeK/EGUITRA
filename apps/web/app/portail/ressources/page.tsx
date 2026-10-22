"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";
import { Search, X } from "@/components/icons";
import { Card, Empty, ErrorBox, IconTile, Loading, Tabs, cx } from "@/components/ui";
import { COULEUR, EnTete, iconeRubrique } from "@/components/portail/commun";
import { Puce, TitreSection, pluriel, sansAccents } from "@/components/portail/cabinet-porteur/briques";
import { CarteRessource, FORMATS, ORDRE_FORMATS, QuestionsFrequentes } from "@/components/portail/cabinet-porteur/ressources";
import { useApi } from "@/lib/api-client";
import type { ArticleKind, ArticleRow, CategoryRow, Ressources } from "@/lib/portail-types";

type Vue = "tout" | "favoris";
type Format = ArticleKind | "tous";

/** Pertinence d'un contenu pour les mots cherchés : 0 s'il manque un mot, plus haut si le titre les porte. */
function pertinence(a: { titre: string; cles: string; texte: string }, mots: string[]): number {
  let score = 0;
  for (const m of mots) {
    const t = a.titre.includes(m);
    const c = a.cles.includes(m);
    const x = a.texte.includes(m);
    if (!t && !c && !x) return 0;
    score += (t ? 4 : 0) + (c ? 2 : 0) + (x ? 1 : 0);
  }
  return score;
}

/** Centre de connaissances : recherche instantanée, rubriques, recommandations, favoris, questions fréquentes. */
export default function CentreRessources() {
  const params = useSearchParams();
  const { data, error, mutate } = useApi<Ressources>("/portail/ressources");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [rubrique, setRubrique] = useState<number | null>(() => Number(params.get("rubrique")) || null);
  const [format, setFormat] = useState<Format>("tous");
  const [vue, setVue] = useState<Vue>("tout");

  const rubriques = useMemo(() => new Map<number, CategoryRow>((data?.categories ?? []).map((c) => [c.id, c])), [data]);
  const index = useMemo(() => {
    const m = new Map<number, { titre: string; cles: string; texte: string }>();
    for (const a of data?.articles ?? []) {
      const r = a.category_id ? rubriques.get(a.category_id) : undefined;
      m.set(a.id, {
        titre: sansAccents(a.title),
        cles: sansAccents([...a.tags, r?.name ?? "", a.kind_label].join(" ")),
        texte: sansAccents(a.summary),
      });
    }
    return m;
  }, [data, rubriques]);

  const mots = useMemo(() => sansAccents(q).split(/[\s,;'’]+/).filter((m) => m.length > 1), [q]);
  const enRecherche = mots.length > 0 || rubrique !== null || format !== "tous" || vue === "favoris";

  const resultats = useMemo(() => {
    const liste: Array<{ a: ArticleRow; score: number }> = [];
    for (const a of data?.articles ?? []) {
      if (vue === "favoris" && !a.bookmarked) continue;
      if (rubrique !== null && a.category_id !== rubrique) continue;
      if (format !== "tous" && a.kind !== format) continue;
      const entree = index.get(a.id);
      const score = mots.length && entree ? pertinence(entree, mots) : 1;
      if (score > 0) liste.push({ a, score });
    }
    if (mots.length) liste.sort((x, y) => y.score - x.score);
    return liste.map((x) => x.a);
  }, [data, index, mots, rubrique, format, vue]);

  if (error) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Chargement des conseils du cabinet…" />;

  const articles = data.articles;
  const favoris = articles.filter((a) => a.bookmarked).length;
  const recommandes = articles.filter((a) => a.recommended).slice(0, 6);
  const dejaVus = new Set(recommandes.map((a) => a.id));
  const aLaUne = articles.filter((a) => a.featured && !dejaVus.has(a.id)).slice(0, 3);
  const faq = articles.filter((a) => a.kind === "faq");
  const faqTrouvees = resultats.filter((a) => a.kind === "faq");
  const base = articles.filter((a) => (vue === "tout" || a.bookmarked) && (rubrique === null || a.category_id === rubrique));
  const formats = ORDRE_FORMATS.filter((k) => base.some((a) => a.kind === k));
  const rubriqueDe = (a: ArticleRow) => (a.category_id ? rubriques.get(a.category_id) ?? null : null);

  function effacer() {
    setQ("");
    setRubrique(null);
    setFormat("tous");
  }

  return (
    <div className="space-y-7">
      <EnTete
        surtitre="Le cabinet"
        titre="Conseils et ressources"
        texte="Guides, fiches outils, modèles et réponses aux questions fréquentes, choisis par vos consultants pour faire avancer votre projet."
      />

      {articles.length === 0 ? (
        <Card>
          <Empty title="Le centre de ressources se remplit." hint="Le cabinet y publiera bientôt ses guides, modèles et réponses aux questions fréquentes. En attendant, votre consultant répond à vos questions dans la messagerie." />
        </Card>
      ) : (
        <>
          <div role="search" className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Rechercher dans les conseils et ressources"
              placeholder="Rechercher : business plan, garantie, fiscalité…"
              autoComplete="off"
              className="h-13 w-full rounded-2xl border border-line bg-panel pl-12 pr-12 text-[15px] text-ink shadow-[var(--ombre-feuille)] outline-none transition-[border-color,box-shadow] placeholder:text-muted/75 focus:border-accent-vif focus:ring-4 focus:ring-accent-vif/15 [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Effacer la recherche" className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-panel-3 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Tabs<Vue>
            value={vue}
            onChange={setVue}
            tabs={[
              { key: "tout", label: "Tous les contenus", count: articles.length },
              { key: "favoris", label: "Mes favoris", count: favoris },
            ]}
          />

          {data.categories.length > 0 && (
            <section aria-labelledby="rubriques">
              <h2 id="rubriques" className="sr-only">Rubriques</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {data.categories.map((c) => {
                  const coul = COULEUR[c.color];
                  const I = iconeRubrique(c.icon);
                  const actif = rubrique === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={actif}
                      onClick={() => setRubrique(actif ? null : c.id)}
                      title={c.description ?? undefined}
                      className={cx(
                        "group flex min-w-0 items-center gap-3 rounded-2xl border p-3.5 text-left transition-[transform,box-shadow,background-color,border-color] duration-200 hover:-translate-y-0.5",
                        actif ? "border-transparent text-white shadow-[0_16px_30px_-18px_var(--vif)]" : "border-transparent hover:border-[color:var(--vif)]/30",
                      )}
                      style={{ background: actif ? coul.vif : coul.doux, "--vif": coul.vif } as CSSProperties}
                    >
                      {actif ? (
                        <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-full bg-white/20 text-white">
                          <I className="h-[18px] w-[18px]" />
                        </span>
                      ) : (
                        <IconTile icon={I} teinte={coul.teinte} />
                      )}
                      <span className="min-w-0">
                        <span className={cx("block truncate text-[14px] font-semibold leading-snug", actif ? "text-white" : "text-ink")}>{c.name}</span>
                        <span className={cx("block text-[12px]", actif ? "text-white/80" : "text-muted")}>{pluriel(c.count ?? 0, "contenu")}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {!enRecherche && recommandes.length > 0 && (
            <section aria-labelledby="recommandes">
              <TitreSection id="recommandes">Recommandé pour votre étape</TitreSection>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {recommandes.map((a) => (
                  <li key={a.id}>
                    <CarteRessource a={a} rubrique={rubriqueDe(a)} accent="recommande" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!enRecherche && aLaUne.length > 0 && (
            <section aria-labelledby="a-la-une">
              <TitreSection id="a-la-une">À la une</TitreSection>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {aLaUne.map((a) => (
                  <li key={a.id}>
                    <CarteRessource a={a} rubrique={rubriqueDe(a)} accent="une" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!enRecherche && faq.length > 0 && (
            <section aria-labelledby="faq">
              <TitreSection
                id="faq"
                compte={faq.length}
                action={
                  faq.length > 6 ? (
                    <button type="button" onClick={() => setFormat("faq")} className="text-[13px] font-semibold text-accent hover:underline">
                      Toutes les questions
                    </button>
                  ) : undefined
                }
              >
                Questions fréquentes
              </TitreSection>
              <QuestionsFrequentes items={faq.slice(0, 6)} />
            </section>
          )}

          <section aria-labelledby="contenus">
            <TitreSection
              id="contenus"
              action={
                enRecherche && vue === "tout" ? (
                  <button type="button" onClick={effacer} className="text-[13px] font-semibold text-accent hover:underline">
                    Effacer les filtres
                  </button>
                ) : undefined
              }
            >
              {vue === "favoris" ? "Mes favoris" : mots.length ? "Résultats" : rubrique !== null ? rubriques.get(rubrique)?.name ?? "Contenus" : "Tous les contenus"}
            </TitreSection>

            {formats.length > 1 && (
              <div role="group" aria-label="Filtrer par format" className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
                <Puce actif={format === "tous"} onClick={() => setFormat("tous")} compte={base.length}>Tous les formats</Puce>
                {formats.map((k) => (
                  <Puce key={k} actif={format === k} onClick={() => setFormat(format === k ? "tous" : k)} compte={base.filter((a) => a.kind === k).length}>
                    {FORMATS[k].pluriel}
                  </Puce>
                ))}
              </div>
            )}

            <p aria-live="polite" className={cx("mb-3 text-[13px] text-muted", !enRecherche && "sr-only")}>
              {resultats.length === 0 ? "Aucun contenu ne correspond." : pluriel(resultats.length, "contenu")}
              {mots.length > 0 && resultats.length > 0 && <> pour « {q.trim()} »</>}
            </p>

            {mots.length > 0 && faqTrouvees.length > 0 && format !== "faq" && (
              <div className="mb-5">
                <h3 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-muted">Réponses rapides</h3>
                <QuestionsFrequentes items={faqTrouvees.slice(0, 4)} />
              </div>
            )}

            {resultats.length === 0 ? (
              <Card>
                {vue === "favoris" && favoris === 0 ? (
                  <Empty title="Aucun favori pour l'instant." hint="Ouvrez un conseil et touchez « Garder en favori » : vous le retrouverez ici, prêt à relire." />
                ) : (
                  <div>
                    <Empty title="Aucun contenu ne correspond à votre recherche." hint="Essayez un mot plus court ou un synonyme, ou posez directement la question à votre consultant." />
                    <div className="-mt-6 flex flex-wrap justify-center gap-3 pb-6">
                      <button type="button" onClick={effacer} className="text-[13.5px] font-semibold text-accent hover:underline">Effacer la recherche</button>
                      <Link href="/portail/messages" className="text-[13.5px] font-semibold text-accent hover:underline">Écrire à mon consultant</Link>
                    </div>
                  </div>
                )}
              </Card>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {resultats.map((a) => (
                  <li key={a.id}>
                    <CarteRessource a={a} rubrique={rubriqueDe(a)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
