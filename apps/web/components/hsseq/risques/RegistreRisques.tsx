"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Search, X } from "@/components/icons";
import { Button, Card, ErrorBox, Etat, FEUILLE, Field, Input, Segmented, Select, Squelette, Tabs, cx, type Tri } from "@/components/ui";
import { NIVEAUX, ORDRE_NIVEAUX } from "@/components/hsseq/commun";
import { AvecFiche, Bascule, ChampSite, Pages, requete, useAdresse, useReferentiels } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import { fmtInt, pluriel } from "@/lib/format";
import type { Page, Referentials } from "@/lib/hsseq-types";
import { ONGLETS, ORDRE_ONGLETS, SANS_FILTRE, TRIS, TRI_DEFAUT, filtresActifs, lireFiltres, versApi, type FiltresRegistre } from "./adresse";
import { FicheRisque } from "./FicheRisque";
import { NATURE_RISQUE, NIVEAU_RISQUES, ORDRE_NATURES } from "./libelles";
import { Matrices } from "./Matrices";
import { TableRisques } from "./TableRisques";
import type { RiskCounts, RiskLine } from "./types";

const PAR_PAGE = 50;

const OPTIONS_NIVEAUX = [...ORDRE_NIVEAUX].reverse().map((n) => ({ value: n, label: NIVEAUX[n].label }));

type Ecrire = (maj: Record<string, string | number | null>) => void;

/**
 * Registre des risques de NIMOVA · HSSEQ (lot 2, GET /hsseq/risks) : situation du registre en tête,
 * onglets de statut, filtres, liste ou matrices 5 × 5 brute et résiduelle, fiche ouverte à côté.
 * Filtres, vue et fiche sont portés par l'adresse (voir ./adresse.ts) ; le chef de parc et l'auditeur
 * ne reçoivent du noyau que les risques de leurs sites.
 */
export function RegistreRisques() {
  const { lire, ecrire } = useAdresse();
  const { data: ref } = useReferentiels();
  const f = lireFiltres(lire);
  const api = versApi(f);
  const cle = `${requete(api)}|${f.tri}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const ouverte = f.risque !== null;

  const { data, error, mutate } = useApi<Page<RiskLine, RiskCounts>>(f.vue === "liste" ? `/hsseq/risks?${requete({ ...api, sort: f.tri, offset, limit: PAR_PAGE })}` : null, { keepPreviousData: true });
  const tri: Tri = { key: f.tri.replace(/^-/, ""), dir: f.tri.startsWith("-") ? -1 : 1 };

  const liste = (
    <div className="space-y-4">
      <Tabs
        value={f.onglet}
        onChange={(o) => ecrire({ statut: o === "registre" ? null : o })}
        tabs={ORDRE_ONGLETS.map((o) => ({ key: o, label: ONGLETS[o].label, count: o === f.onglet && f.vue === "liste" ? data?.total_count : undefined }))}
      />
      <Filtres f={f} ref_={ref} ecrire={ecrire} echues={f.vue === "liste" ? data?.counts.review_overdue : undefined} />
      {f.vue === "matrices" ? (
        <Matrices api={api} f={f} ecrire={ecrire} />
      ) : (
        <Card padded={false}>
          {!data ? (
            <Etat error={error} onRetry={() => void mutate()} label="Chargement du registre…" />
          ) : (
            <>
              {error && (
                <div className="p-4">
                  <ErrorBox error={error} onRetry={() => void mutate()} />
                </div>
              )}
              <TableRisques
                lignes={data.items}
                choisi={f.risque}
                compacte={ouverte}
                tri={tri}
                onTri={(t) => {
                  if (!(TRIS as readonly string[]).includes(t.key)) return;
                  const sens = `${t.dir === -1 ? "-" : ""}${t.key}`;
                  ecrire({ tri: sens === TRI_DEFAUT ? null : sens });
                }}
                onOuvrir={(id) => ecrire({ risque: id })}
                vide={filtresActifs(f) ? "Aucun risque pour ces filtres." : ONGLETS[f.onglet].vide}
              />
              <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="risques" onPage={(o) => setPosition({ cle, offset: o })} />
            </>
          )}
        </Card>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className={cx(ouverte && "max-lg:hidden")}>
        <Situation f={f} ecrire={ecrire} />
      </div>
      <AvecFiche ouverte={ouverte} liste={liste} fiche={ouverte && <FicheRisque key={f.risque} id={f.risque!} onFermer={() => ecrire({ risque: null })} />} />
    </div>
  );
}

/* ─── Situation du registre ───────────────────────────────────────────── */


/**
 * Situation du registre lisible par le compte, sans les filtres : risques en vigueur, à évaluer,
 * revues échues et niveaux résiduels (avant mesures en rappel). Chaque compte pose son filtre.
 */
function Situation({ f, ecrire }: { f: FiltresRegistre; ecrire: Ecrire }) {
  const { data } = useApi<Page<RiskLine, RiskCounts>>("/hsseq/risks?limit=1");
  const c = data?.counts;
  if (!c) {
    return (
      <div aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.9fr)]">
        {[0, 1, 2, 3].map((i) => (
          <Squelette key={i} className={cx("h-[84px]", i === 3 && "col-span-2 lg:col-span-1")} />
        ))}
      </div>
    );
  }
  // Un compte de la situation porte sur tout le registre : il remplace les filtres en cours, et un second clic le retire.
  const poser = (actif: boolean, cle: string, valeur: string) => ecrire(actif ? { [cle]: null } : { ...SANS_FILTRE, statut: null, vue: null, [cle]: valeur });
  return (
    <section aria-label="Situation du registre" className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.9fr)]">
      <Compteur valeur={c.by_status.active} actif={f.onglet === "en_vigueur"} onClick={() => poser(f.onglet === "en_vigueur", "statut", "en_vigueur")}>
        {c.by_status.active > 1 ? "risques en vigueur" : "risque en vigueur"}
      </Compteur>
      <Compteur valeur={c.by_status.draft} ton="warn" actif={f.onglet === "a_evaluer"} onClick={() => poser(f.onglet === "a_evaluer", "statut", "a_evaluer")}>
        à évaluer par le Responsable HSSEQ
      </Compteur>
      <Compteur valeur={c.review_overdue} ton="danger" actif={f.echue} onClick={() => poser(f.echue, "echue", "1")}>
        {c.review_overdue > 1 ? "revues échues" : "revue échue"}
      </Compteur>
      <div className={cx(FEUILLE, "col-span-2 px-5 py-3.5 lg:col-span-1")}>
        <p className="text-[13px] font-medium text-ink-2">Criticité résiduelle, après mesures</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {[...ORDRE_NIVEAUX].reverse().map((n) => {
            const actif = f.niveau === n;
            const valeur = c.by_residual_level[n];
            return (
              <li key={n}>
                <button
                  type="button"
                  aria-pressed={actif}
                  onClick={() => poser(actif, "niveau", n)}
                  className={cx(
                    "inline-flex min-h-8 items-center gap-2 rounded-[10px] border px-2.5 py-1 text-[13px] transition-colors",
                    actif ? "border-accent bg-accent-doux text-ink" : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink",
                  )}
                >
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: NIVEAUX[n].couleur }} />
                  <span className="font-semibold tabular text-ink">{fmtInt(valeur)}</span>
                  {valeur > 1 ? NIVEAU_RISQUES[n][1] : NIVEAU_RISQUES[n][0]}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12.5px] leading-snug text-muted">
          Avant mesures&nbsp;: {pluriel(c.by_raw_level.high, "élevé", "élevés")}, {pluriel(c.by_raw_level.significant, "significatif", "significatifs")}.
        </p>
      </div>
    </section>
  );
}

/** Nombre de la situation, bouton qui pose son filtre (pressé quand il est posé). */
function Compteur({ valeur, ton, actif, onClick, children }: { valeur: number; ton?: "warn" | "danger"; actif: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={cx(FEUILLE, "flex h-full flex-col items-start gap-1.5 px-5 py-3.5 text-left outline-offset-2 transition-shadow hover:shadow-[var(--ombre-flottante)]", actif && "ring-2 ring-accent")}
    >
      <span className={cx("font-display text-[26px] font-[650] leading-none tracking-[-0.02em] tabular", valeur > 0 && ton === "danger" ? "text-danger" : valeur > 0 && ton === "warn" ? "text-warn" : "text-ink")}>{fmtInt(valeur)}</span>
      <span className="text-[13px] font-medium leading-snug text-ink-2">{children}</span>
    </button>
  );
}

/* ─── Filtres ─────────────────────────────────────────────────────────── */

/** Filtres du registre et bascule entre la liste et les matrices. */
function Filtres({ f, ref_, ecrire, echues }: { f: FiltresRegistre; ref_: Referentials | undefined; ecrire: Ecrire; echues?: number }) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Recherche valeur={f.q} onChange={(q) => ecrire({ q })} />
        <Field label="Nature" className="w-full sm:w-52">
          <Select value={f.nature ?? ""} onChange={(e) => ecrire({ nature: e.target.value })} placeholder="Toutes" options={ORDRE_NATURES.map((n) => ({ value: n, label: NATURE_RISQUE[n].label }))} />
        </Field>
        <Field label="Profil" className="w-full sm:w-36">
          <Select
            value={f.profil ?? ""}
            onChange={(e) => ecrire({ profil: e.target.value })}
            placeholder="Tous"
            options={[
              { value: "citerne", label: "Citerne" },
              { value: "benne", label: "Benne" },
            ]}
          />
        </Field>
        <ChampSite ref_={ref_} valeur={f.site ?? ""} onChange={(v) => ecrire({ site: v })} />
        <Field label="Niveau résiduel" className="w-full sm:w-44">
          <Select value={f.niveau ?? ""} onChange={(e) => ecrire({ niveau: e.target.value })} placeholder="Tous" options={OPTIONS_NIVEAUX} />
        </Field>
        <Bascule actif={f.echue} onChange={(v) => ecrire({ echue: v ? "1" : null })} nombre={echues}>
          Revues échues
        </Bascule>
        <Bascule actif={f.miens} onChange={(v) => ecrire({ miens: v ? "1" : null })}>
          Mes risques
        </Bascule>
        <Segmented
          className="ml-auto"
          label="Affichage du registre"
          value={f.vue}
          onChange={(v) => ecrire({ vue: v === "liste" ? null : v, case: null })}
          options={[
            { key: "liste", label: "Liste" },
            { key: "matrices", label: "Matrices" },
          ]}
        />
      </div>
      {(f.brut || filtresActifs(f)) && (
        <div className="flex flex-wrap items-center gap-2">
          {f.brut && (
            <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-accent-doux py-1 pl-3 pr-1 text-[13px] text-ink">
              Avant mesures&nbsp;: {NIVEAUX[f.brut].label.toLocaleLowerCase("fr")}
              <button type="button" onClick={() => ecrire({ brut: null })} className="grid h-6 w-6 place-items-center rounded-md text-ink-2 transition-colors hover:bg-panel hover:text-ink" aria-label="Retirer le filtre de criticité avant mesures">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => ecrire(SANS_FILTRE)}>
            <X className="h-3.5 w-3.5" /> Effacer les filtres
          </Button>
        </div>
      )}
      <p className="text-[12.5px] leading-snug text-muted">
        Une revue échue relance chaque semaine le propriétaire du risque et le Responsable HSSEQ. Les filtres de profil et de site écartent les risques communs à tous les profils ou à tous les sites.
      </p>
    </>
  );
}

/** Recherche dans la référence, le danger, l'événement redouté et l'activité, posée dans l'adresse après une courte pause de frappe. */
function Recherche({ valeur, onChange }: { valeur: string; onChange: (q: string) => void }) {
  const [texte, setTexte] = useState(valeur);
  const [vue, setVue] = useState(valeur);
  // L'adresse a changé ailleurs (lien, retour arrière) : le champ la suit.
  if (vue !== valeur) {
    setVue(valeur);
    setTexte(valeur);
  }
  useEffect(() => {
    if (texte.trim() === valeur) return;
    const minute = setTimeout(() => onChange(texte.trim()), 350);
    return () => clearTimeout(minute);
  }, [texte, valeur, onChange]);
  return (
    <Field label="Rechercher" className="w-full sm:w-64">
      <span className="relative block">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input type="search" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Référence, danger, activité" className="pl-9" />
      </span>
    </Field>
  );
}
