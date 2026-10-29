"use client";

import { useState } from "react";
import { Download } from "@/components/icons";
import { Button, Card, DataTable, Etat, Field, Kpi, Notice, Select, Tag, type Column } from "@/components/ui";
import { requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { apiDownload, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtInt, fmtPct, pluriel } from "@/lib/format";
import { TauxLecture } from "./elements";
import { ETAT_REVUE, ORDRE_TYPES, TYPE_DOCUMENT, TamponDocument, messageDocument, parmi, type VueProps } from "./libelles";
import type { DocumentDashboard } from "./types";

type LigneDocument = DocumentDashboard["read_by_document"][number];
type LigneSite = DocumentDashboard["read_by_site"][number];

/** Taux affiché avec sa jauge (lectures sur attendues), ou « – » sans compte visé. */
function Taux({ targets, read, rate }: { targets: number; read: number; rate: number | null }) {
  return <TauxLecture stats={{ targets, read, rate }} />;
}

/**
 * Tableau de bord du référentiel documentaire HSE (GET /hsseq/procedures/dashboard) : documents en vigueur
 * par type, versions qui attendent l'approbation, revues en retard ou proches, taux de lecture par document
 * et par site, accusés manquants par personne (jamais pour l'auditeur, qui ne lit que ses sites) ; filtres
 * de type et de site portés par l'adresse ; export Excel des mêmes tableaux. Un document s'ouvre dans
 * l'onglet « Politiques et procédures ».
 */
export function TableauDeBord({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const type = parmi(lire("type"), TYPE_DOCUMENT);
  const site = Number(lire("site")) || null;
  const filtres = { doc_type: type, site_id: site };
  const qs = requete(filtres);
  const { data, error, mutate } = useApi<DocumentDashboard>(`/hsseq/procedures/dashboard${qs ? `?${qs}` : ""}`);
  const [export_, setExport] = useState<{ envoi: boolean; erreur: string | null }>({ envoi: false, erreur: null });
  const sites = (ref?.sites ?? []).filter((s) => s.active || s.id === site);
  const ouvrir = (id: number) => ecrire({ vue: "procedures", procedure: id, type: null, site: null });

  async function exporter() {
    setExport({ envoi: true, erreur: null });
    try {
      await apiDownload(`/hsseq/procedures/dashboard/export.xlsx${qs ? `?${qs}` : ""}`, "politiques_procedures_hsseq.xlsx");
      setExport({ envoi: false, erreur: null });
    } catch (e) {
      setExport({ envoi: false, erreur: messageDocument(e, "L'export n'a pas abouti.") });
    }
  }

  const colonnesDocuments: Column<LigneDocument>[] = [
    {
      key: "code",
      label: "Document",
      sortValue: (r) => r.code,
      render: (r) => (
        <div className="min-w-[14rem] max-w-[48ch]">
          <span className="flex flex-wrap items-center gap-2">
            <Tag>{TYPE_DOCUMENT[r.doc_type].label}</Tag>
            <span className="font-mono text-[11.5px] text-muted">{r.code}</span>
          </span>
          <span className="mt-1 line-clamp-2 block leading-snug text-ink">{r.title}</span>
        </div>
      ),
    },
    { key: "version", label: "Version", sortValue: (r) => r.version ?? "", render: (r) => <span className="whitespace-nowrap">{r.version ?? "–"}</span> },
    { key: "rate", label: "Lecture", sortValue: (r) => r.rate ?? -1, render: (r) => <Taux targets={r.targets} read={r.read} rate={r.rate} /> },
    {
      key: "review",
      label: "Prochaine revue",
      sortValue: (r) => r.next_review_date ?? "",
      render: (r) => (
        <span className="inline-flex flex-col gap-1">
          <span className="whitespace-nowrap">{r.next_review_date ? fmtDate(r.next_review_date) : "–"}</span>
          {(r.review_state === "overdue" || r.review_state === "due") && <TamponDocument mot={ETAT_REVUE[r.review_state]} />}
        </span>
      ),
    },
  ];

  const colonnesSites: Column<LigneSite>[] = [
    { key: "site", label: "Site", sortValue: (r) => r.site?.name ?? "~", render: (r) => r.site?.name ?? <span className="text-muted">Sans site (siège, direction, équipe HSSEQ)</span> },
    { key: "rate", label: "Lecture", sortValue: (r) => r.rate ?? -1, render: (r) => <Taux targets={r.targets} read={r.read} rate={r.rate} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Type" className="w-full sm:w-52">
          <Select value={type ?? ""} onChange={(e) => ecrire({ type: e.target.value || null })} placeholder="Tous les types" options={ORDRE_TYPES.map((t) => ({ value: t, label: TYPE_DOCUMENT[t].pluriel }))} />
        </Field>
        {sites.length > 0 && (
          <Field label="Site" className="w-full sm:w-44">
            <Select value={site ?? ""} onChange={(e) => ecrire({ site: e.target.value || null })} placeholder="Tous" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        )}
        <Button className="sm:ml-auto" loading={export_.envoi} onClick={() => void exporter()} title="Documents, revues, lecture par site et accusés manquants">
          <Download className="h-4 w-4" /> Exporter le tableau de bord
        </Button>
      </div>
      {export_.erreur && <Notice tone="danger">{export_.erreur}</Notice>}

      <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement du tableau de bord…">
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Documents en vigueur" value={fmtInt(d.totals.in_force)} hint={`sur ${pluriel(d.totals.documents, "document au registre", "documents au registre")}`} />
              <Kpi label="Taux de lecture" value={d.totals.rate === null ? "–" : fmtPct(d.totals.rate, 1)} hint={`${fmtInt(d.totals.read)} sur ${pluriel(d.totals.targets, "lecture attendue", "lectures attendues")}`} tone={d.totals.rate !== null && d.totals.rate >= 100 ? "ok" : "accent"} />
              <Kpi label="Revues en retard" value={fmtInt(d.totals.reviews_overdue)} hint={`${pluriel(d.totals.reviews_due, "autre revue", "autres revues")} à faire bientôt`} tone={d.totals.reviews_overdue ? "danger" : "neutral"} />
              <Kpi label="Versions à approuver" value={fmtInt(d.totals.pending_approval)} hint={droits.approbation ? "Soumises, en attente de leur approbateur" : "Soumises à l'approbation"} tone={d.totals.pending_approval ? "warn" : "neutral"} />
            </div>

            <Card title="Documents en vigueur par type">
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                {d.by_type.map((t) => (
                  <li key={t.doc_type} className="rounded-[12px] border border-line px-4 py-3">
                    <p className="m-0 text-[12px] text-muted">{TYPE_DOCUMENT[t.doc_type].pluriel}</p>
                    <p className="m-0 mt-1 font-display text-[22px] font-[650] leading-none text-ink tabular">{fmtInt(t.published)}</p>
                    <p className="m-0 mt-1.5 text-[12px] text-muted">
                      {[t.draft ? `${fmtInt(t.draft)} en rédaction` : null, t.pending_approval ? `${fmtInt(t.pending_approval)} à approuver` : null, t.archived ? `${fmtInt(t.archived)} archivé${t.archived > 1 ? "s" : ""}` : null].filter(Boolean).join(", ") || "Rien en attente"}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>

            {(d.reviews.length > 0 || d.pending_approval.length > 0) && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card title={`Revues à faire (${d.reviews.length})`}>
                  {d.reviews.length ? (
                    <ul className="divide-y divide-line/80">
                      {d.reviews.map((r) => (
                        <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                          <button type="button" className="w-full text-left" onClick={() => ouvrir(r.id)}>
                            <span className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono text-[11.5px] text-muted">{`${TYPE_DOCUMENT[r.doc_type].label} ${r.code}`}</span>
                              {r.review_state && <TamponDocument mot={ETAT_REVUE[r.review_state]} />}
                            </span>
                            <span className="mt-0.5 block text-[13.5px] font-semibold leading-snug text-ink">{r.title}</span>
                            <span className="mt-0.5 block text-[12px] text-muted">{`Revue le ${fmtDate(r.next_review_date)}${r.owner ? `, responsable ${r.owner.name}` : ""}`}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-[13px] text-muted">Aucune revue en retard ni proche.</p>
                  )}
                </Card>
                <Card title={`Versions à approuver (${d.pending_approval.length})`}>
                  {d.pending_approval.length ? (
                    <ul className="divide-y divide-line/80">
                      {d.pending_approval.map((r) => (
                        <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                          <button type="button" className="w-full text-left" onClick={() => ouvrir(r.id)}>
                            <span className="font-mono text-[11.5px] text-muted">{`${TYPE_DOCUMENT[r.doc_type].label} ${r.code}, version ${r.pending_version}`}</span>
                            <span className="mt-0.5 block text-[13.5px] font-semibold leading-snug text-ink">{r.title}</span>
                            <span className="mt-0.5 block text-[12px] text-muted">
                              {`Soumise${r.submitted_at ? ` le ${fmtDate(r.submitted_at)}` : ""}${r.submitted_by ? ` par ${r.submitted_by.name}` : ""}${INSECABLE}; ${r.doc_type === "policy" ? "approbation de la direction" : "approbation du Responsable HSSEQ"}`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-[13px] text-muted">Aucune version n&apos;attend d&apos;approbation.</p>
                  )}
                </Card>
              </div>
            )}

            <Card title="Lecture par document" padded={false}>
              <DataTable rows={d.read_by_document} rowKey={(r) => r.id} onRowClick={(r) => ouvrir(r.id)} empty="Aucun document en vigueur pour ces filtres." columns={colonnesDocuments} />
            </Card>

            <Card title="Lecture par site" padded={false}>
              <DataTable rows={d.read_by_site} rowKey={(r) => r.site?.id ?? 0} empty="Aucune lecture attendue." columns={colonnesSites} />
            </Card>

            {d.missing_by_person === null ? (
              <p className="m-0 text-[12.5px] leading-snug text-muted">{`Accusés manquants par personne${INSECABLE}: non communiqués à votre profil.`}</p>
            ) : (
              <Card title={`Accusés manquants par personne (${d.missing_by_person.length})`}>
                {d.missing_by_person.length ? (
                  <ul className="divide-y divide-line/80">
                    {d.missing_by_person.map((p) => (
                      <li key={p.user.id} className="py-3 first:pt-0 last:pb-0">
                        <details className="group">
                          <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 marker:text-muted">
                            <span className="text-[13.5px] font-semibold text-ink">{p.user.name}</span>
                            <span className="text-[12px] text-muted">
                              {pluriel(p.count, "document à lire", "documents à lire")}
                              {p.sites.length ? `, ${p.sites.map((s) => s.name).join(", ")}` : ""}
                            </span>
                          </summary>
                          <ul className="mt-2 space-y-1 text-[12.5px]">
                            {p.documents.map((doc) => (
                              <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-2">
                                <button type="button" className="text-left font-semibold text-accent underline-offset-2 hover:underline" onClick={() => ouvrir(doc.id)}>
                                  {`${doc.code} ${doc.title}`}
                                </button>
                                <span className="text-muted">{`version ${doc.version}${doc.days !== null ? `, en vigueur depuis ${pluriel(doc.days, "jour")}` : ""}`}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-[13px] text-muted">{`Tout est lu${INSECABLE}: chaque compte visé a accusé lecture des documents en vigueur.`}</p>
                )}
              </Card>
            )}
          </div>
        )}
      </Etat>
    </div>
  );
}
