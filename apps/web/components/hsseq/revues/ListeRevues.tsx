"use client";

/**
 * Liste des revues de direction (GET /hsseq/reviews) : synthèse en tête (prochaine revue, dernière revue
 * tenue, décisions en cours), onglets d'état avec leur nombre, filtre d'année, tri servi par le noyau.
 * Filtres et tri sont portés par l'adresse (etat, annee, tri) ; une ligne ouvre la fiche (revue).
 * La direction et le Responsable HSSEQ préparent une revue depuis cette liste.
 */

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, Empty, ErrorBox, Etat, Field, Select, Tabs, type Tri } from "@/components/ui";
import { Pages, requete } from "@/components/hsseq/actions/outils";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { INSECABLE, fmtDate, pluriel } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { Reference } from "./briques";
import { FenetrePreparation } from "./Fenetres";
import { TamponsRevue, dePeriode, echeanceRelative, periodeRevue, useRafraichirRevues } from "./outils";
import { SyntheseRevues } from "./Synthese";
import type { Review, ReviewCounts, ReviewLine, ReviewSort, ReviewState } from "./types";

type Onglet = "toutes" | "preparees" | "tenues" | "closes";

const ONGLETS: Record<Onglet, { label: string; etats: ReviewState[] | null; vide: string }> = {
  toutes: { label: "Toutes", etats: null, vide: "Aucune revue de direction." },
  preparees: { label: "Préparées", etats: ["prepared"], vide: "Aucune revue en préparation." },
  tenues: { label: "Tenues, à clore", etats: ["held"], vide: "Aucune revue tenue en attente de clôture." },
  closes: { label: "Closes", etats: ["closed"], vide: "Aucune revue close." },
};
const ORDRE_ONGLETS = Object.keys(ONGLETS) as Onglet[];

/** Tris servis par le noyau (`sort`) ; par défaut, la date prévue la plus récente d'abord. */
const TRIS: readonly ReviewSort[] = ["planned_date", "reference", "state"];
const TRI_DEFAUT = "-planned_date";

const PAR_PAGE = 50;

/** Profils qui préparent une revue (REVIEW_WRITE du noyau) ; les commandes d'une fiche suivent ses `rights`. */
const REDACTEURS = ["direction", "hsseq"] as const;

export function ListeRevues({ lire, ecrire }: { lire: (cle: string) => string; ecrire: (maj: Record<string, string | number | null>) => void }) {
  const redacteur = useAutorise(REDACTEURS);
  const rafraichir = useRafraichirRevues();
  const { data: moi } = useApi<Me>("/auth/me");
  const onglet: Onglet = (ORDRE_ONGLETS as string[]).includes(lire("etat")) ? (lire("etat") as Onglet) : "toutes";
  const annee = /^\d{4}$/.test(lire("annee")) ? lire("annee") : "";
  const triAdresse = lire("tri");
  const tri = (TRIS as readonly string[]).includes(triAdresse.replace(/^-/, "")) ? triAdresse : TRI_DEFAUT;
  const [preparer, setPreparer] = useState(false);

  const filtres = { year: annee || null };
  const cle = `${requete(filtres)}|${onglet}|${tri}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;

  // Les nombres des onglets portent sur la sélection filtrée sans l'état ; la liste, sur l'onglet.
  const { data: compte } = useApi<Page<ReviewLine, ReviewCounts>>(`/hsseq/reviews?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<ReviewLine, ReviewCounts>>(
    `/hsseq/reviews?${requete({ ...filtres, state: ONGLETS[onglet].etats?.join(",") ?? null, sort: tri, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const parEtat = compte?.counts.by_state;
  const nombre = (o: Onglet) => {
    if (!parEtat) return undefined;
    const etats = ONGLETS[o].etats ?? (Object.keys(parEtat) as ReviewState[]);
    return etats.reduce((s, e) => s + (parEtat[e] ?? 0), 0);
  };
  const courante = new Date().getUTCFullYear();
  const annees = [courante + 1, courante, courante - 1, courante - 2, courante - 3];
  const plusieursSocietes = (moi?.companies.length ?? 0) > 1;
  const triTableau: Tri = { key: tri.replace(/^-/, ""), dir: tri.startsWith("-") ? -1 : 1 };

  return (
    <div className="space-y-6">
      <SyntheseRevues />

      <div className="space-y-4">
        <Tabs value={onglet} onChange={(o) => ecrire({ etat: o === "toutes" ? null : o })} tabs={ORDRE_ONGLETS.map((o) => ({ key: o, label: ONGLETS[o].label, count: nombre(o) }))} />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Année de la séance" className="w-full sm:w-48">
            <Select value={annee} onChange={(e) => ecrire({ annee: e.target.value || null })} placeholder="Toutes les années" options={annees.map((a) => ({ value: a, label: String(a) }))} />
          </Field>
          {redacteur && (
            <Button variant="primary" className="ml-auto" onClick={() => setPreparer(true)}>
              <Plus className="h-4 w-4" /> Préparer une revue
            </Button>
          )}
        </div>
        <p className="text-[12.5px] leading-snug text-muted">
          Une revue préparée rassemble ses éléments d&apos;entrée depuis le module&nbsp;; tenue, elle les fige&nbsp;; close, elle ne se modifie plus et ses décisions se suivent au plan d&apos;actions.
        </p>
        <Card padded={false}>
          {!data ? (
            <Etat error={error} onRetry={() => void mutate()} label="Chargement des revues…" />
          ) : (
            <>
              {error && (
                <div className="p-4">
                  <ErrorBox error={error} onRetry={() => void mutate()} />
                </div>
              )}
              {data.items.length === 0 ? (
                <Empty
                  title={annee ? `${ONGLETS[onglet].vide.replace(/\.$/, "")} en ${annee}.` : ONGLETS[onglet].vide}
                  hint={onglet === "toutes" && !annee && redacteur ? `Préparez la première${INSECABLE}: NIMOVA en rassemble les éléments d'entrée depuis le module.` : undefined}
                />
              ) : (
                <DataTable
                  rows={data.items}
                  rowKey={(r) => r.id}
                  sort={triTableau}
                  onSort={(t) => {
                    if (!(TRIS as readonly string[]).includes(t.key)) return;
                    const sens = `${t.dir === -1 ? "-" : ""}${t.key}`;
                    ecrire({ tri: sens === TRI_DEFAUT ? null : sens });
                  }}
                  onRowClick={(r) => ecrire({ revue: r.id })}
                  columns={[
                    {
                      key: "reference",
                      label: "Revue",
                      render: (r) => (
                        <span className="block min-w-[16rem] max-w-[62ch]">
                          <Reference>{r.reference}</Reference>
                          <span className="mt-0.5 block font-medium leading-snug text-ink">{r.title}</span>
                          <span className="mt-1 block text-[12px] text-muted">
                            {`Période ${dePeriode(periodeRevue(r.period.from, r.period.to))}`}
                            {plusieursSocietes ? `, ${r.company.name}` : ""}
                          </span>
                        </span>
                      ),
                    },
                    {
                      key: "planned_date",
                      label: "Séance",
                      render: (r) => (
                        <span className="inline-flex flex-col whitespace-nowrap">
                          <span>{fmtDate(r.held_on ?? r.planned_date)}</span>
                          <span className="text-[12px] text-muted">{r.held_on ? "tenue" : r.state === "prepared" ? `prévue, ${echeanceRelative(r.planned_date)}` : "prévue"}</span>
                        </span>
                      ),
                    },
                    {
                      key: "state",
                      label: "État",
                      render: (r) => (
                        <span className="inline-flex flex-col items-start gap-1">
                          <TamponsRevue r={r} />
                        </span>
                      ),
                    },
                    {
                      key: "decisions",
                      label: "Décisions",
                      render: (r) => (
                        <span className="inline-flex min-w-[9rem] flex-col">
                          <span>{r.decisions_count ? pluriel(r.decisions_count, "décision") : r.state === "prepared" ? "À prendre en séance" : "Aucune"}</span>
                          {r.actions_count > 0 && <span className="text-[12px] text-muted">{r.open_actions ? pluriel(r.open_actions, "action ouverte", "actions ouvertes") : "Actions closes"}</span>}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
              <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="revues" onPage={(o) => setPosition({ cle, offset: o })} />
            </>
          )}
        </Card>
      </div>

      {preparer && (
        <FenetrePreparation
          onClose={() => setPreparer(false)}
          envoyer={async (corps) => {
            const r = await apiSend<Review>("POST", "/hsseq/reviews", corps);
            void rafraichir();
            // La revue préparée s'ouvre aussitôt : ses éléments d'entrée sont déjà rassemblés.
            ecrire({ revue: r.id });
          }}
        />
      )}
    </div>
  );
}
