"use client";

/**
 * Registre des événements de NIMOVA · HSSEQ (GET /hsseq/events, §5) : filtres en paramètres d'URL
 * (un lien du cockpit ouvre la liste déjà filtrée), compteurs par statut en onglets, tri et pages
 * tenus par le noyau, export du registre en Excel, déclaration web.
 *
 * Paramètres d'URL : statut (un statut, ou plusieurs séparés par des virgules), retard=1 (enquêtes en
 * retard), type, domaine, criticite (niveau), site, vehicule (citerne ou benne : tanker, tipper),
 * societe, du, au (date de l'événement), q (recherche), tri, page. Les clés du contrat (status,
 * domain, level, site_id, vehicle_kind, company_id, date_from, date_to, search, sort,
 * overdue_investigation) sont lues aussi : les liens du cockpit les emploient.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, X } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Field, Input, Loading, PageHeader, Select, Tabs, type Tri } from "@/components/ui";
import { CYCLE_EVENEMENT, Criticite, DOMAINE, NIVEAUX, STATUT_EVENEMENT, TYPE_EVENEMENT, TYPE_VEHICULE, Tampon, nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { apiDownload, useApi } from "@/lib/api-client";
import { fmtInt } from "@/lib/format";
import type { CriticalityLevel, Domain, EventCounts, EventLine, EventStatus, EventType, Page, Ref, VehicleKind } from "@/lib/hsseq-types";
import { EcheanceEnquete, OPTIONS_NIVEAUX, fmtHeure, messageRefus, sitesDuCompte, useReferentiels } from "./commun";
import { Declaration } from "./Declaration";

const PAR_PAGE = 50;

/** Tris acceptés par le noyau, par colonne du tableau. */
const TRIS = ["occurred_at", "criticality", "reference", "status"] as const;
type CleTri = (typeof TRIS)[number];
const TRI_DEFAUT = "-occurred_at";

/** « selection » : plusieurs statuts à la fois (lien du cockpit vers les événements ouverts). */
type Onglet = "tous" | EventStatus | "selection" | "retard";

interface Filtres {
  statuts: EventStatus[];
  retard: boolean;
  type: EventType | null;
  domaine: Domain | null;
  criticite: CriticalityLevel | null;
  site: string | null;
  vehicule: VehicleKind | null;
  societe: string | null;
  du: string | null;
  au: string | null;
  q: string;
  tri: string;
  page: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function lire(sp: URLSearchParams, ...cles: string[]): string | null {
  for (const c of cles) {
    const v = sp.get(c);
    if (v) return v;
  }
  return null;
}

function parmi<T extends string>(valeur: string | null, permises: readonly T[] | Record<T, unknown>): T | null {
  if (!valeur) return null;
  const liste = Array.isArray(permises) ? permises : Object.keys(permises);
  return (liste as readonly string[]).includes(valeur) ? (valeur as T) : null;
}

/** Filtres lus dans l'URL ; une valeur inconnue est ignorée. */
function lireFiltres(sp: URLSearchParams): Filtres {
  const tri = lire(sp, "tri", "sort") ?? TRI_DEFAUT;
  const site = lire(sp, "site", "site_id");
  const societe = lire(sp, "societe", "company_id");
  const du = lire(sp, "du", "date_from");
  const au = lire(sp, "au", "date_to");
  const statuts = (lire(sp, "statut", "status") ?? "").split(",").map((x) => parmi(x.trim(), CYCLE_EVENEMENT));
  return {
    // Dans l'ordre du cycle, sans doublon.
    statuts: CYCLE_EVENEMENT.filter((s) => statuts.includes(s)),
    retard: lire(sp, "retard", "overdue_investigation") === "1",
    type: parmi(lire(sp, "type"), TYPE_EVENEMENT),
    domaine: parmi(lire(sp, "domaine", "domain"), DOMAINE),
    criticite: parmi(lire(sp, "criticite", "level"), NIVEAUX),
    site: site && /^\d+$/.test(site) ? site : null,
    vehicule: parmi(lire(sp, "vehicule", "vehicle_kind"), TYPE_VEHICULE),
    societe: societe && /^\d+$/.test(societe) ? societe : null,
    du: du && DATE.test(du) ? du : null,
    au: au && DATE.test(au) ? au : null,
    q: lire(sp, "q", "search") ?? "",
    tri: (TRIS as readonly string[]).includes(tri.replace(/^-/, "")) ? tri : TRI_DEFAUT,
    page: Math.max(1, Number.parseInt(lire(sp, "page") ?? "1", 10) || 1),
  };
}

/** Paramètres du noyau pour ces filtres ; `pourCompteurs` retire le statut et le retard (onglets). */
function versApi(f: Filtres, pourCompteurs = false): URLSearchParams {
  const p = new URLSearchParams();
  if (!pourCompteurs && f.statuts.length) p.set("status", f.statuts.join(","));
  if (!pourCompteurs && f.retard) p.set("overdue_investigation", "1");
  if (f.type) p.set("type", f.type);
  if (f.domaine) p.set("domain", f.domaine);
  if (f.criticite) p.set("level", f.criticite);
  if (f.site) p.set("site_id", f.site);
  if (f.vehicule) p.set("vehicle_kind", f.vehicule);
  if (f.societe) p.set("company_id", f.societe);
  if (f.du) p.set("date_from", f.du);
  if (f.au) p.set("date_to", f.au);
  if (f.q.trim()) p.set("search", f.q.trim());
  return p;
}

/** Paramètres d'URL de ces filtres, aux noms de l'écran ; les valeurs par défaut n'y figurent pas. */
function versUrl(f: Filtres): URLSearchParams {
  const p = new URLSearchParams();
  if (f.statuts.length) p.set("statut", f.statuts.join(","));
  if (f.retard) p.set("retard", "1");
  if (f.type) p.set("type", f.type);
  if (f.domaine) p.set("domaine", f.domaine);
  if (f.criticite) p.set("criticite", f.criticite);
  if (f.site) p.set("site", f.site);
  if (f.vehicule) p.set("vehicule", f.vehicule);
  if (f.societe) p.set("societe", f.societe);
  if (f.du) p.set("du", f.du);
  if (f.au) p.set("au", f.au);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.tri !== TRI_DEFAUT) p.set("tri", f.tri);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

const OPTIONS_TYPES = (Object.keys(TYPE_EVENEMENT) as EventType[]).map((t) => ({ value: t, label: TYPE_EVENEMENT[t].label }));
const OPTIONS_DOMAINES = (Object.keys(DOMAINE) as Domain[]).map((d) => ({ value: d, label: DOMAINE[d] }));
const OPTIONS_VEHICULES = (Object.keys(TYPE_VEHICULE) as VehicleKind[]).map((k) => ({ value: k, label: TYPE_VEHICULE[k] }));

/** Libellé d'une sélection de plusieurs statuts : « Ouverts » pour classé, enquête et actions. */
function libelleSelection(statuts: EventStatus[]): string {
  const ouverts: EventStatus[] = ["classified", "investigation", "actions"];
  if (statuts.length === ouverts.length && ouverts.every((s) => statuts.includes(s))) return "Ouverts";
  return statuts.map((s) => STATUT_EVENEMENT[s]).join(", ");
}

export function ListeEvenements() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const f = useMemo(() => lireFiltres(new URLSearchParams(sp.toString())), [sp]);
  const { data: ref } = useReferentiels();
  const [declarer, setDeclarer] = useState(false);
  const [export_, setExport] = useState<{ envoi: boolean; erreur: string | null }>({ envoi: false, erreur: null });

  // Recherche : saisie locale, reportée dans l'URL après une courte pause.
  const [texte, setTexte] = useState(f.q);
  // L'URL revenue (lien, retour arrière) reprend la main, sans retirer l'espace en cours de frappe.
  useEffect(() => setTexte((t) => (t.trim() === f.q ? t : f.q)), [f.q]);

  /** Change des filtres dans l'URL ; tout changement autre que la page revient à la première page. */
  function changer(maj: Partial<Filtres>) {
    const qs = versUrl({ ...f, page: 1, ...maj }).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    if (texte.trim() === f.q) return;
    const minuterie = setTimeout(() => changer({ q: texte }), 300);
    return () => clearTimeout(minuterie);
    // changer lit l'URL courante : seule la saisie relance la minuterie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texte]);

  const filtresApi = versApi(f);
  const liste = new URLSearchParams(filtresApi);
  liste.set("sort", f.tri);
  liste.set("offset", String((f.page - 1) * PAR_PAGE));
  liste.set("limit", String(PAR_PAGE));
  const { data, error, isLoading, mutate } = useApi<Page<EventLine, EventCounts>>(`/hsseq/events?${liste.toString()}`, { keepPreviousData: true });

  // Compteurs des onglets : la même sélection sans statut ni retard (counts porte sur la sélection filtrée).
  const ongletFiltre = Boolean(f.statuts.length || f.retard);
  const compteursQs = versApi(f, true);
  compteursQs.set("limit", "1");
  const { data: compteursSeuls } = useApi<Page<EventLine, EventCounts>>(ongletFiltre ? `/hsseq/events?${compteursQs.toString()}` : null, { keepPreviousData: true });
  const compteurs = ongletFiltre ? compteursSeuls : data;

  const onglet: Onglet = f.retard ? "retard" : f.statuts.length > 1 ? "selection" : (f.statuts[0] ?? "tous");
  const parStatut = compteurs?.counts.by_status;
  const onglets: Array<{ key: Onglet; label: string; count?: number }> = [
    { key: "tous", label: "Tous", count: compteurs?.total_count },
    ...CYCLE_EVENEMENT.map((s) => ({ key: s as Onglet, label: STATUT_EVENEMENT[s], count: parStatut?.[s] })),
    ...(f.statuts.length > 1 ? [{ key: "selection" as Onglet, label: libelleSelection(f.statuts), count: parStatut ? f.statuts.reduce((n, s) => n + (parStatut[s] ?? 0), 0) : undefined }] : []),
    { key: "retard", label: "Enquête en retard", count: compteurs?.counts.overdue_investigations },
  ];

  const sites = sitesDuCompte(ref);
  // Sociétés des sites ouverts au compte : le filtre ne s'affiche que s'il y en a plusieurs.
  const societes = [...new Map(sites.map((s) => [s.company.id, s.company] as [number, Ref])).values()];
  const filtresActifs = Boolean(f.type || f.domaine || f.criticite || f.site || f.vehicule || f.societe || f.du || f.au || f.q);
  const tri: Tri = { key: f.tri.replace(/^-/, ""), dir: f.tri.startsWith("-") ? -1 : 1 };
  const total = data?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));

  async function exporter() {
    setExport({ envoi: true, erreur: null });
    try {
      const p = new URLSearchParams(filtresApi);
      p.set("sort", f.tri);
      await apiDownload(`/hsseq/events/export.xlsx?${p.toString()}`, "evenements_hsseq.xlsx");
      setExport({ envoi: false, erreur: null });
    } catch (e) {
      setExport({ envoi: false, erreur: messageRefus(e, "L'export n'a pas abouti.") });
    }
  }

  return (
    <div>
      <PageHeader
        title="Événements"
        subtitle="Accidents, presque-accidents, situations dangereuses, déversements et atteintes à la sûreté : de la déclaration à la clôture, avec la criticité, l'enquête et les actions."
        actions={
          <>
            <Button onClick={exporter} loading={export_.envoi}>
              <Download className="h-4 w-4" /> Exporter le registre
            </Button>
            <Button variant="primary" onClick={() => setDeclarer(true)}>
              <Plus className="h-4 w-4" /> Déclarer un événement
            </Button>
          </>
        }
      />
      {export_.erreur && (
        <div className="mb-4">
          <ErrorBox error={new Error(export_.erreur)} />
        </div>
      )}

      <Card padded={false}>
        <div className="px-5 pt-3">
          <Tabs
            tabs={onglets}
            value={onglet}
            onChange={(k) => {
              if (k === "selection") return;
              changer({ statuts: k === "tous" || k === "retard" ? [] : [k], retard: k === "retard" });
            }}
          />
        </div>
        <form role="search" aria-label="Filtrer les événements" onSubmit={(e) => e.preventDefault()} className="grid gap-3 px-5 pb-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="Recherche" className="sm:col-span-2 xl:col-span-2">
            <Input type="search" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Référence, titre ou lieu" />
          </Field>
          <Field label="Type">
            <Select value={f.type ?? ""} onChange={(e) => changer({ type: parmi(e.target.value, TYPE_EVENEMENT) })} options={OPTIONS_TYPES} placeholder="Tous" />
          </Field>
          <Field label="Domaine">
            <Select value={f.domaine ?? ""} onChange={(e) => changer({ domaine: parmi(e.target.value, DOMAINE) })} options={OPTIONS_DOMAINES} placeholder="Tous" />
          </Field>
          <Field label="Criticité">
            <Select value={f.criticite ?? ""} onChange={(e) => changer({ criticite: parmi(e.target.value, NIVEAUX) })} options={OPTIONS_NIVEAUX} placeholder="Toutes" />
          </Field>
          <Field label="Site">
            <Select value={f.site ?? ""} onChange={(e) => changer({ site: e.target.value || null })} options={sites.map((s) => ({ value: s.id, label: s.name }))} placeholder="Tous" />
          </Field>
          <Field label="Citerne ou benne">
            <Select value={f.vehicule ?? ""} onChange={(e) => changer({ vehicule: parmi(e.target.value, TYPE_VEHICULE) })} options={OPTIONS_VEHICULES} placeholder="Toutes" />
          </Field>
          {(societes.length > 1 || f.societe) && (
            <Field label="Société">
              <Select value={f.societe ?? ""} onChange={(e) => changer({ societe: e.target.value || null })} options={societes.map((c) => ({ value: c.id, label: c.name }))} placeholder="Toutes" />
            </Field>
          )}
          <Field label="Du">
            <Input type="date" value={f.du ?? ""} max={f.au ?? undefined} onChange={(e) => changer({ du: e.target.value || null })} />
          </Field>
          <Field label="Au">
            <Input type="date" value={f.au ?? ""} min={f.du ?? undefined} onChange={(e) => changer({ au: e.target.value || null })} />
          </Field>
          {filtresActifs && (
            <div className="flex items-end sm:col-span-2 lg:col-span-4 xl:col-span-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTexte("");
                  changer({ type: null, domaine: null, criticite: null, site: null, vehicule: null, societe: null, du: null, au: null, q: "" });
                }}
              >
                <X className="h-3.5 w-3.5" /> Effacer les filtres
              </Button>
            </div>
          )}
        </form>

        {error && (
          <div className="px-5 pb-4">
            <ErrorBox error={error} onRetry={() => mutate()} />
          </div>
        )}
        {isLoading && !data ? (
          <Loading label="Chargement des événements…" />
        ) : (
          data && (
            <>
              <DataTable
                rows={data.items}
                rowKey={(e) => e.id}
                onRowClick={(e) => router.push(`/hsseq/evenements/${e.id}`)}
                sort={tri}
                onSort={(t) => {
                  if (!(TRIS as readonly string[]).includes(t.key)) return;
                  changer({ tri: `${t.dir === -1 ? "-" : ""}${t.key as CleTri}` });
                }}
                empty={filtresActifs || ongletFiltre ? "Aucun événement pour ces filtres." : "Aucun événement déclaré."}
                columns={[
                  {
                    key: "reference",
                    label: "Référence",
                    render: (e) => (
                      <span className="block min-w-[12rem] max-w-[22rem]">
                        <span className="block whitespace-nowrap font-mono text-xs text-ink">{e.reference}</span>
                        <span className="line-clamp-1 text-[12.5px] text-muted" title={e.title}>
                          {e.title}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "occurred_at",
                    label: "Date",
                    render: (e) => (
                      <span className="block whitespace-nowrap">
                        {new Date(e.occurred_at).toLocaleDateString("fr-FR")}
                        <span className="block text-[12px] text-muted">{fmtHeure(e.occurred_at)}</span>
                      </span>
                    ),
                  },
                  { key: "type", label: "Type", render: (e) => <span className="whitespace-nowrap">{TYPE_EVENEMENT[e.type]?.label ?? e.type}</span> },
                  { key: "domain", label: "Domaine", render: (e) => DOMAINE[e.domain] ?? e.domain },
                  {
                    key: "vehicle",
                    label: "Véhicule et rotation",
                    render: (e) =>
                      e.vehicle || e.rotation ? (
                        <span className="block whitespace-nowrap">
                          {e.vehicle ? nomVehicule(e.vehicle) : "–"}
                          {e.rotation && <span className="block text-[12px] text-muted">{nomRotation(e.rotation)}</span>}
                        </span>
                      ) : (
                        <span className="text-muted">–</span>
                      ),
                  },
                  { key: "criticality", label: "Criticité", render: (e) => <Criticite note={e.criticality} gravite={e.potential_severity} probabilite={e.probability} /> },
                  { key: "status", label: "Statut", render: (e) => <Tampon mot={STATUT_EVENEMENT[e.status]} /> },
                  { key: "investigation_due", label: "Échéance d'enquête", render: (e) => <EcheanceEnquete date={e.investigation_due} enRetard={e.investigation_overdue} /> },
                ]}
              />
              {total > PAR_PAGE && (
                <nav aria-label="Pages des événements" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
                  <span className="tabular">
                    {fmtInt((f.page - 1) * PAR_PAGE + 1)} à {fmtInt(Math.min(f.page * PAR_PAGE, total))} sur {fmtInt(total)}
                  </span>
                  <span className="flex gap-2">
                    <Button size="sm" disabled={f.page <= 1} onClick={() => changer({ page: f.page - 1 })}>
                      <ChevronLeft className="h-3.5 w-3.5" /> Précédente
                    </Button>
                    <Button size="sm" disabled={f.page >= pages} onClick={() => changer({ page: f.page + 1 })}>
                      Suivante <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </nav>
              )}
            </>
          )
        )}
      </Card>

      <Declaration
        open={declarer}
        onClose={() => setDeclarer(false)}
        onEnregistre={(e) => {
          setDeclarer(false);
          void mutate();
          router.push(`/hsseq/evenements/${e.id}`);
        }}
      />
    </div>
  );
}
