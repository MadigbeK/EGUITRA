"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Segmented, Select, Tag, cx, type Column, type Tri } from "@/components/ui";
import { DOMAINE } from "@/components/hsseq/commun";
import { AvecFiche, Pages, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { Recherche } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtInt } from "@/lib/format";
import type { Domain, Page } from "@/lib/hsseq-types";
import { TauxLecture } from "./elements";
import { FenetreProcedure } from "./fenetres";
import { FicheProcedure } from "./FicheProcedure";
import { ETAT_REVUE, ORDRE_TYPES, STATUT_PROCEDURE, STATUT_VERSION, TYPE_DOCUMENT, TamponDocument, parmi, publicVise, useRafraichir, type VueProps } from "./libelles";
import type { DocType, NewProcedure, Procedure, ProcedureCounts, ProcedureInput, ProcedureLine, ProcedureNode, ProcedureStatus } from "./types";

const PAR_PAGE = 100;

/** Tris servis par le noyau (sort de GET /hsseq/procedures) ; les autres colonnes ne se trient pas. */
const TRIS = ["code", "status", "next_review_date"] as const;

/**
 * Onglets du registre portés par l'adresse (`statut`) : états du document, versions qui attendent
 * l'approbation, revues échues ; sans onglet, le registre (en vigueur et en rédaction).
 */
const FILTRE_STATUT: Record<"registre" | "en-vigueur" | "en-redaction" | "a-approuver" | "revue-retard" | "archivees" | "toutes", { label: string; statuts: ProcedureStatus[] | null; extra?: Record<string, string> }> = {
  registre: { label: "Au registre", statuts: ["published", "draft"] },
  "en-vigueur": { label: "En vigueur", statuts: ["published"] },
  "en-redaction": { label: "En rédaction", statuts: ["draft"] },
  "a-approuver": { label: "À approuver", statuts: null, extra: { pending_approval: "1" } },
  "revue-retard": { label: "Revue en retard", statuts: null, extra: { review: "overdue" } },
  archivees: { label: "Archivées", statuts: ["archived"] },
  toutes: { label: "Toutes", statuts: null },
};
type FiltreStatut = keyof typeof FILTRE_STATUT;
const ORDRE_FILTRES = Object.keys(FILTRE_STATUT) as FiltreStatut[];
const TOUS_STATUTS: readonly ProcedureStatus[] = ["draft", "published", "archived"];

type Affichage = "liste" | "arbre";

/** Au téléphone, seule la première colonne reste : elle porte alors la version, la lecture et le statut. */
const TELEPHONE = "max-md:[&_th:not(:first-child)]:hidden max-md:[&_td:not(:first-child)]:hidden";

/** Paramètres du noyau pour un onglet : états, ou filtre propre (à approuver, revue en retard). */
function parametresStatut(statut: FiltreStatut): { status: string | null; pending_approval: string | null; review: string | null } {
  const f = FILTRE_STATUT[statut];
  return { status: f.statuts?.join(",") ?? null, pending_approval: f.extra?.["pending_approval"] ?? null, review: f.extra?.["review"] ?? null };
}

/** Tampons d'état d'un document : son statut, la version en préparation, sa revue quand elle presse. */
function Etats({ p }: { p: ProcedureLine }) {
  const brouillon = p.draft_version;
  const revue = p.review.state;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <TamponDocument mot={STATUT_PROCEDURE[p.status]} />
      {brouillon && p.status !== "archived" && (
        <TamponDocument mot={brouillon.status === "submitted" ? STATUT_VERSION.submitted : brouillon.document.length || brouillon.has_text ? "Brouillon à publier" : p.doc_type === "policy" ? "Texte à rédiger" : "Document à joindre"} />
      )}
      {(revue === "overdue" || revue === "due") && <TamponDocument mot={ETAT_REVUE[revue]} />}
    </span>
  );
}

/** Version en vigueur et sa date d'effet ; la version en préparation dessous. */
function Version({ p }: { p: ProcedureLine }) {
  const c = p.current_version;
  return (
    <span className="inline-flex min-w-[8.5rem] flex-col">
      {c ? (
        <>
          <span className="whitespace-nowrap text-ink">Version {c.version}</span>
          <span className="whitespace-nowrap text-[12px] text-muted">depuis le {fmtDate(c.effective_date)}</span>
        </>
      ) : (
        <span className="text-muted">Aucune en vigueur</span>
      )}
      {p.draft_version && <span className="whitespace-nowrap text-[12px] text-muted">{`${p.draft_version.status === "submitted" ? "En approbation" : "Brouillon"} ${p.draft_version.version}`}</span>}
    </span>
  );
}

/** Prochaine revue du document en vigueur. */
function Revue({ p }: { p: ProcedureLine }) {
  if (!p.review.next_review_date || p.status !== "published") return <span className="text-muted">–</span>;
  return (
    <span className={cx("whitespace-nowrap", p.review.state === "overdue" ? "font-semibold text-danger" : p.review.state === "due" ? "text-warn" : "text-ink-2")}>
      {fmtDate(p.review.next_review_date)}
    </span>
  );
}

/** Type et référence d'un document, en tête de ligne. */
function Reference({ p }: { p: Pick<ProcedureLine, "doc_type" | "code" | "domain"> }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Tag>{TYPE_DOCUMENT[p.doc_type].label}</Tag>
      <span className="font-mono text-[11.5px] text-muted">{p.code}</span>
      {p.domain && <span className="text-[12px] text-muted">{DOMAINE[p.domain]}</span>}
    </span>
  );
}

/**
 * Filtres de la liste pour leur feuille de l'export (préfixe procedures_ du noyau) : l'export des
 * registres reprend la sélection affichée.
 */
export function filtresExportProcedures(lire: (cle: string) => string): Record<string, string | null> {
  const statut: FiltreStatut = parmi(lire("statut"), FILTRE_STATUT) ?? "registre";
  const p = parametresStatut(statut);
  return {
    procedures_status: p.status,
    procedures_pending_approval: p.pending_approval,
    procedures_review: p.review,
    procedures_doc_type: parmi(lire("type"), TYPE_DOCUMENT),
    procedures_site_id: lire("site") || null,
    procedures_domain: parmi(lire("domaine"), DOMAINE),
    procedures_search: lire("q").trim() || null,
  };
}

/**
 * Politiques et procédures du groupe (GET /hsseq/procedures, ou /tree pour l'arbre) : registre par
 * onglet avec ses nombres (états, versions à approuver, revues en retard), filtres de type, de domaine,
 * de site et de recherche ; en liste, la version en vigueur, le taux de lecture et la prochaine revue
 * de chaque document ; en arbre, chaque politique et ce qui la met en œuvre. La fiche s'ouvre à côté.
 * Filtres, affichage et fiche ouverte portés par l'adresse (statut, type, domaine, site, q, affichage,
 * procedure). L'auditeur ne lit que les documents de ses sites, sans les noms des lecteurs.
 */
export function Procedures({ lire, ecrire, droits }: VueProps) {
  const rafraichir = useRafraichir();
  const { data: ref } = useReferentiels();
  const statut: FiltreStatut = parmi(lire("statut"), FILTRE_STATUT) ?? "registre";
  const type = parmi(lire("type"), TYPE_DOCUMENT);
  const domaine = parmi(lire("domaine"), DOMAINE);
  const site = Number(lire("site")) || null;
  const q = lire("q");
  const affichage: Affichage = lire("affichage") === "arbre" ? "arbre" : "liste";
  const choisie = Number(lire("procedure")) || null;
  const filtres = { doc_type: type, domain: domaine, site_id: site, search: q.trim() || null };
  const [tri, setTri] = useState<Tri>({ key: "code", dir: 1 });
  const cle = `${requete(filtres)}|${statut}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [creer, setCreer] = useState<DocType | null>(null);

  // En arbre, la liste n'est lue que pour les nombres des onglets (une ligne).
  const { data, error, mutate } = useApi<Page<ProcedureLine, ProcedureCounts>>(
    `/hsseq/procedures?${requete({ ...filtres, ...parametresStatut(statut), sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset: affichage === "liste" ? offset : 0, limit: affichage === "liste" ? PAR_PAGE : 1 })}`,
    { keepPreviousData: true },
  );
  const arbre = useApi<{ items: ProcedureNode[]; total_count: number }>(affichage === "arbre" ? `/hsseq/procedures/tree?${requete({ ...filtres, ...parametresStatut(statut) })}` : null);
  // Nombres des onglets : le noyau les compte aux autres filtres de la liste (la liste seule les sert).
  const compteurs = data?.counts;
  const nombre = (f: FiltreStatut): number | null => {
    if (!compteurs) return null;
    if (f === "a-approuver") return compteurs.pending_approval;
    if (f === "revue-retard") return compteurs.reviews_overdue;
    return (FILTRE_STATUT[f].statuts ?? TOUS_STATUTS).reduce((n, s) => n + (compteurs.by_status[s] ?? 0), 0);
  };
  const compact = choisie !== null;
  const sites = (ref?.sites ?? []).filter((s) => s.active || s.id === site);

  const colonnes: Array<Column<ProcedureLine> & { secondaire?: boolean }> = [
    {
      key: "code",
      label: "Document",
      sortValue: (p) => p.code,
      render: (p) => (
        <div className="min-w-[15rem] max-w-[52ch]">
          <Reference p={p} />
          {choisie === p.id && <span className="sr-only">fiche ouverte</span>}
          <span className={cx("mt-1 line-clamp-2 block leading-snug text-ink", choisie === p.id && "font-semibold")}>{p.title}</span>
          <span className="mt-1 block text-[12px] leading-snug text-muted">
            {p.parent ? `Met en œuvre ${p.parent.code}${INSECABLE}; ` : ""}
            {publicVise(p.audience)}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 md:hidden">
            <Etats p={p} />
            {p.current_version && <span className="text-[12px] text-muted">Version {p.current_version.version}</span>}
            {p.read && p.read.rate !== null && <span className="text-[12px] text-muted tabular">{`Lu à ${fmtInt(p.read.rate)}${INSECABLE}%`}</span>}
          </span>
        </div>
      ),
    },
    { key: "version", label: "Version en vigueur", secondaire: true, sortValue: (p) => p.current_version?.effective_date ?? "", render: (p) => <Version p={p} /> },
    { key: "read", label: "Lecture", secondaire: true, sortValue: (p) => p.read?.rate ?? -1, render: (p) => <TauxLecture stats={p.read} /> },
    { key: "next_review_date", label: "Prochaine revue", secondaire: true, sortValue: (p) => p.review.next_review_date ?? "", render: (p) => <Revue p={p} /> },
    { key: "status", label: "Statut", sortValue: (p) => p.status, render: (p) => <Etats p={p} /> },
  ];

  const liste = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Recherche valeur={q} onChange={(v) => ecrire({ q: v || null })} placeholder="Référence, titre" />
        <Field label="Type" className="w-full sm:w-52">
          <Select value={type ?? ""} onChange={(e) => ecrire({ type: e.target.value || null })} placeholder="Tous les types" options={ORDRE_TYPES.map((t) => ({ value: t, label: TYPE_DOCUMENT[t].pluriel }))} />
        </Field>
        <Field label="Domaine" className="w-full sm:w-40">
          <Select value={domaine ?? ""} onChange={(e) => ecrire({ domaine: e.target.value || null })} placeholder="Tous" options={(Object.keys(DOMAINE) as Domain[]).map((d) => ({ value: d, label: DOMAINE[d] }))} />
        </Field>
        {sites.length > 0 && (
          <Field label="Site" className="w-full sm:w-44">
            <Select value={site ?? ""} onChange={(e) => ecrire({ site: e.target.value || null })} placeholder="Tous" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        )}
        {droits.ecriture && (
          <Button variant="primary" className="sm:ml-auto" onClick={() => setCreer(type ?? "procedure")}>
            <Plus className="h-4 w-4" /> Nouveau document
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Segmented<FiltreStatut>
            label="Documents affichés"
            value={statut}
            onChange={(s) => ecrire({ statut: s === "registre" ? null : s })}
            options={ORDRE_FILTRES.filter((f) => f !== "a-approuver" || droits.approbation || (nombre(f) ?? 0) > 0).map((f) => ({ key: f, label: nombre(f) === null ? FILTRE_STATUT[f].label : `${FILTRE_STATUT[f].label} (${fmtInt(nombre(f))})` }))}
          />
        </div>
        <Segmented<Affichage> label="Affichage" value={affichage} onChange={(a) => ecrire({ affichage: a === "liste" ? null : a })} options={[{ key: "liste", label: "Liste" }, { key: "arbre", label: "Arbre" }]} />
      </div>
      <p className="m-0 text-[12.5px] leading-snug text-muted">
        {`Une politique entre en vigueur approuvée par la direction${INSECABLE}; les autres documents, par le Responsable HSSEQ. Chaque version en vigueur est demandée en lecture aux comptes visés, relancés à l'intervalle des réglages${INSECABLE}; chaque document se revoit à sa date, annuelle pour une politique.`}
      </p>
      {affichage === "liste" ? (
        <Card padded={false}>
          {!data ? (
            <Etat error={error} onRetry={() => void mutate()} label="Chargement des documents…" />
          ) : (
            <>
              {error && (
                <div className="p-4">
                  <ErrorBox error={error} onRetry={() => void mutate()} />
                </div>
              )}
              <div className={TELEPHONE}>
                <DataTable
                  rows={data.items}
                  rowKey={(p) => p.id}
                  sort={tri}
                  onSort={(t) => {
                    if (!(TRIS as readonly string[]).includes(t.key)) return;
                    setTri(t);
                    setPosition({ cle, offset: 0 });
                  }}
                  onRowClick={(p) => ecrire({ procedure: p.id })}
                  empty={type || domaine || site || q.trim() ? "Aucun document pour ces filtres." : statut === "archivees" ? "Aucun document archivé." : statut === "a-approuver" ? "Aucune version n'attend d'approbation." : statut === "revue-retard" ? "Aucune revue en retard." : "Aucun document dans ce registre."}
                  columns={colonnes.filter((c) => !(compact && c.secondaire))}
                />
              </div>
              <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="documents" onPage={(o) => setPosition({ cle, offset: o })} />
            </>
          )}
        </Card>
      ) : (
        <Card padded={false}>
          {!arbre.data ? (
            <Etat error={arbre.error} onRetry={() => void arbre.mutate()} label="Chargement de l'arbre…" />
          ) : arbre.data.items.length ? (
            <ul className="divide-y divide-line/80" aria-label="Arbre des politiques et procédures">
              {arbre.data.items.map((n) => (
                <Noeud key={n.id} n={n} niveau={0} choisie={choisie} onOuvrir={(id) => ecrire({ procedure: id })} compact={compact} />
              ))}
            </ul>
          ) : (
            <p className="m-0 px-6 py-8 text-center text-[13px] text-muted">Aucun document pour ces filtres.</p>
          )}
        </Card>
      )}
      {creer && (
        <FenetreProcedure
          type={creer}
          onClose={() => setCreer(null)}
          envoyer={async (corps: NewProcedure | ProcedureInput) => {
            const p = await apiSend<Procedure>("POST", "/hsseq/procedures", corps);
            void rafraichir();
            // Le nouveau document, en rédaction, s'ouvre ; un filtre qui l'écarterait de la liste est retiré.
            ecrire({ procedure: p.id, type: type && type !== p.doc_type ? null : type, ...(statut === "en-vigueur" || statut === "archivees" || statut === "a-approuver" || statut === "revue-retard" ? { statut: null } : {}) });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisie !== null} liste={liste} fiche={choisie !== null && <FicheProcedure key={choisie} id={choisie} droits={droits} onFermer={() => ecrire({ procedure: null })} onOuvrir={(id) => ecrire({ procedure: id })} />} />;
}

/**
 * Un document de l'arbre et ce qui le met en œuvre, en retrait : type, référence, titre, version en
 * vigueur, lecture et état ; un clic ouvre sa fiche.
 */
function Noeud({ n, niveau, choisie, onOuvrir, compact }: { n: ProcedureNode; niveau: number; choisie: number | null; onOuvrir: (id: number) => void; compact: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOuvrir(n.id)}
        aria-current={choisie === n.id ? "true" : undefined}
        className={cx("flex w-full flex-wrap items-start justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-panel-2", choisie === n.id && "bg-accent-doux")}
        style={{ paddingLeft: `${20 + niveau * 24}px` }}
      >
        <span className="flex min-w-0 flex-1 items-start gap-2">
          {niveau > 0 && <ChevronRight className="mt-1 h-3.5 w-3.5 flex-none text-muted" aria-hidden />}
          <span className="min-w-0">
            <Reference p={n} />
            <span className={cx("mt-1 block leading-snug text-ink", choisie === n.id && "font-semibold")}>{n.title}</span>
            <span className="mt-1 block text-[12px] text-muted">{n.current_version ? `Version ${n.current_version.version}, depuis le ${fmtDate(n.current_version.effective_date)}` : "Aucune version en vigueur"}</span>
          </span>
        </span>
        <span className="flex flex-none flex-col items-end gap-1.5">
          <Etats p={n} />
          {!compact && n.read && <TauxLecture stats={n.read} />}
        </span>
      </button>
      {n.children.length > 0 && (
        <ul className="border-t border-line/60">
          {n.children.map((c) => (
            <Noeud key={c.id} n={c} niveau={niveau + 1} choisie={choisie} onOuvrir={onOuvrir} compact={compact} />
          ))}
        </ul>
      )}
    </li>
  );
}
