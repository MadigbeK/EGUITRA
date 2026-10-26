"use client";

import { useCallback, useState } from "react";
import { Download, Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Kpi, Notice, Segmented, Select, cx, type Column, type Tri } from "@/components/ui";
import { Tampon } from "@/components/hsseq/commun";
import { AvecFiche, ChampSite, Pages, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtInt, fmtPct, pluriel } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { ComptesConstats, ORDRE_REFERENTIEL, REFERENTIEL, Recherche, STATUT_AUDIT, TYPE_AUDITEUR, TamponConformite, anneeCourante, auditEnRetard, messageErreur, parmi, useEtroit, useRafraichir, type VueProps } from "./commun";
import { FenetreAudit } from "./fenetres";
import { FicheAudit } from "./FicheAudit";
import type { Audit, AuditCounts, AuditLine, AuditStandard, AuditStatus, Finding, FindingCounts } from "./types";

const PAR_PAGE = 50;

/** Tris servis par le noyau (sort de GET /hsseq/audits) ; les autres colonnes ne se trient pas. */
const TRIS = ["planned_date", "reference", "status"] as const;

/** Statut dans l'adresse et sa clé dans l'API. */
const STATUT_ADRESSE: Record<"planifies" | "realises" | "clos" | "annules", AuditStatus> = { planifies: "planned", realises: "done", clos: "closed", annules: "cancelled" };
type FiltreStatut = "tous" | keyof typeof STATUT_ADRESSE;

/** Années proposées : l'année suivante (programme en préparation), l'année en cours et les deux précédentes. */
function annees(courante: number, choisie: number): number[] {
  return [...new Set([courante + 1, courante, courante - 1, courante - 2, choisie])].sort((a, b) => b - a);
}

/** Référentiel, donneur d'ordre et site d'un audit, en une ligne. */
function contexte(a: AuditLine): string {
  return [REFERENTIEL[a.standard].court, a.partner?.name, a.site?.name ?? "Sans site"].filter(Boolean).join(", ");
}

/**
 * Programme d'audits de l'année (§7) : audits réalisés contre planifiés, écarts ouverts, liste par date
 * prévue avec référentiel, site, auditeur, constats par classement et état. Recherche (référence,
 * intitulé, périmètre, auditeur externe, client), année, référentiel, site, statut et fiche ouverte
 * (audit) portés par l'adresse ; le Responsable HSSEQ planifie depuis la liste.
 */
export function Programme({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const etroit = useEtroit();
  const rafraichir = useRafraichir();
  const courante = anneeCourante();
  const annee = /^\d{4}$/.test(lire("annee")) ? Number(lire("annee")) : courante;
  const referentiel: AuditStandard | null = parmi(lire("referentiel"), REFERENTIEL);
  const site = lire("site");
  const statut: FiltreStatut = parmi(lire("statut"), STATUT_ADRESSE) ?? "tous";
  const recherche = lire("q");
  const choisi = Number(lire("audit")) || null;
  const chercher = useCallback((q: string) => ecrire({ q }), [ecrire]);

  const filtres = { year: annee, standard: referentiel, site_id: site || null, q: recherche || null };
  const cle = `${requete(filtres)}|${statut}`;
  const [tri, setTri] = useState<Tri>({ key: "planned_date", dir: 1 });
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [planifier, setPlanifier] = useState(false);
  const [export_, setExport] = useState<string | null>(null);

  // Comptes du programme sans le filtre de statut (chiffres clés, bascule) ; liste filtrée.
  const { data: compte } = useApi<Page<AuditLine, AuditCounts>>(`/hsseq/audits?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<AuditLine, AuditCounts>>(
    `/hsseq/audits?${requete({ ...filtres, status: statut === "tous" ? null : STATUT_ADRESSE[statut], sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  // Écarts encore ouverts à ce jour, toutes années confondues, sur le site choisi.
  const { data: ouverts } = useApi<Page<Finding, FindingCounts>>(`/hsseq/findings?${requete({ site_id: site || null, status: "open", limit: 1 })}`, { keepPreviousData: true });

  const n = compte?.counts;
  const parStatut = n?.by_status;
  const o = ouverts?.counts.open_by_class;
  // Liste à côté d'une fiche ouverte, ou sur téléphone : les colonnes secondaires passent sous l'audit.
  const compact = etroit || choisi !== null;

  async function exporter() {
    setExport("en_cours");
    try {
      // Les filtres de la liste : le statut et le référentiel des audits ne bornent plus la feuille des
      // exigences, qui a les siens (requirement_status, requirement_source, requirement_standard).
      await apiDownload(`/hsseq/audits/export.xlsx?${requete({ ...filtres, status: statut === "tous" ? null : STATUT_ADRESSE[statut] })}`, `audits_conformite_${annee}.xlsx`);
      setExport(null);
    } catch (e) {
      setExport(messageErreur(e, "Export impossible."));
    }
  }

  const colonnes: Column<AuditLine>[] = [
    {
      key: "reference",
      label: "Audit",
      render: (a) => (
        <span className={cx("block min-w-[15rem] max-w-[52ch]", choisi === a.id && "font-medium")}>
          <span className="font-mono text-[11.5px] text-muted">{a.reference}</span>
          {choisi === a.id && <span className="sr-only"> (fiche ouverte)</span>}
          <span className="mt-0.5 line-clamp-2 block leading-snug text-ink">{a.title}</span>
          <span className="mt-1 block text-[12px] leading-snug text-muted">{contexte(a)}</span>
          {compact && (
            <span className="mt-0.5 block text-[12px] leading-snug text-muted">
              Prévu le {fmtDate(a.planned_date)}
              {a.auditor ? `, ${a.auditor.name}` : ""}
            </span>
          )}
        </span>
      ),
    },
    ...(compact
      ? []
      : [
          {
            key: "planned_date",
            label: "Prévu le",
            render: (a: AuditLine) => (
              <span className="inline-flex flex-col">
                <span className="whitespace-nowrap">{fmtDate(a.planned_date)}</span>
                {a.actual_date && <span className="whitespace-nowrap text-[12px] text-muted">Réalisé le {fmtDate(a.actual_date)}</span>}
              </span>
            ),
          },
          {
            key: "auditor",
            label: "Auditeur",
            render: (a: AuditLine) => (
              <span className="inline-flex min-w-[9rem] flex-col">
                <span className="text-ink">{a.auditor?.name ?? "À désigner"}</span>
                <span className="text-[12px] text-muted">{TYPE_AUDITEUR[a.auditor_kind]}</span>
              </span>
            ),
          },
          { key: "findings", label: "Constats", render: (a: AuditLine) => <ComptesConstats a={a} /> },
        ]),
    {
      key: "status",
      label: "Statut",
      render: (a) => (
        <span className="inline-flex flex-col items-start gap-1">
          <TamponConformite mot={STATUT_AUDIT[a.status]} />
          {auditEnRetard(a) && <Tampon mot="En retard" />}
          {compact && a.open_findings > 0 && <span className="whitespace-nowrap text-[12px] text-muted">{pluriel(a.open_findings, "constat ouvert", "constats ouverts")}</span>}
        </span>
      ),
    },
  ];

  const liste = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Recherche valeur={recherche} onChange={chercher} placeholder="Référence, intitulé, client" />
        <Field label="Année" className="w-full sm:w-32">
          <Select value={String(annee)} onChange={(e) => ecrire({ annee: Number(e.target.value) === courante ? null : e.target.value })} options={annees(courante, annee).map((y) => ({ value: y, label: String(y) }))} />
        </Field>
        <Field label="Référentiel" className="w-full sm:w-60">
          <Select value={referentiel ?? ""} onChange={(e) => ecrire({ referentiel: e.target.value })} placeholder="Tous" options={ORDRE_REFERENTIEL.map((r) => ({ value: r, label: REFERENTIEL[r].long }))} />
        </Field>
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button loading={export_ === "en_cours"} onClick={() => void exporter()} title="Audits et constats de la liste filtrée et, pour leurs lecteurs, tout le registre des exigences">
            <Download className="h-4 w-4" /> Exporter
          </Button>
          {droits.hsseq && (
            <Button variant="primary" onClick={() => setPlanifier(true)}>
              <Plus className="h-4 w-4" /> Planifier un audit
            </Button>
          )}
        </div>
      </div>
      {export_ && export_ !== "en_cours" && <Notice tone="danger">{export_}</Notice>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          label={`Programme ${annee} réalisé`}
          value={n?.completion_rate === null || n?.completion_rate === undefined ? "–" : fmtPct(n.completion_rate, 1)}
          hint={n ? (n.planned ? `${fmtInt(n.done)} sur ${pluriel(n.planned, "audit planifié", "audits planifiés")}, annulés exclus` : "Aucun audit planifié") : undefined}
        />
        <Kpi label="Écarts majeurs ouverts" value={o ? fmtInt(o.major) : "–"} tone={!o ? "neutral" : o.major > 0 ? "danger" : "ok"} hint="Un audit ne se clôt qu'avec une action sur chacun." />
        <Kpi label="Écarts mineurs ouverts" value={o ? fmtInt(o.minor) : "–"} tone={!o ? "neutral" : o.minor > 0 ? "warn" : "ok"} hint="Soldés quand leurs actions sont closes ou annulées." />
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented<FiltreStatut>
          label="Audits affichés"
          value={statut}
          onChange={(s) => ecrire({ statut: s === "tous" ? null : s })}
          options={[
            { key: "tous", label: `Tous (${fmtInt(compte?.total_count ?? 0)})` },
            { key: "planifies", label: `Planifiés (${fmtInt(parStatut?.planned ?? 0)})` },
            { key: "realises", label: `Réalisés (${fmtInt(parStatut?.done ?? 0)})` },
            { key: "clos", label: `Clos (${fmtInt(parStatut?.closed ?? 0)})` },
            { key: "annules", label: `Annulés (${fmtInt(parStatut?.cancelled ?? 0)})` },
          ]}
        />
      </div>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement du programme d'audits…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(a) => a.id}
              sort={tri}
              onSort={(t) => {
                if (!(TRIS as readonly string[]).includes(t.key)) return;
                setTri(t);
                setPosition({ cle, offset: 0 });
              }}
              onRowClick={(a) => ecrire({ audit: a.id })}
              empty={referentiel || site || recherche || statut !== "tous" ? "Aucun audit pour ces filtres." : `Aucun audit planifié en ${annee}.`}
              columns={colonnes}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="audits" onPage={(x) => setPosition({ cle, offset: x })} />
          </>
        )}
      </Card>

      {planifier && (
        <FenetreAudit
          onClose={() => setPlanifier(false)}
          envoyer={async (corps) => {
            const a = await apiSend<Audit>("POST", "/hsseq/audits", corps);
            void rafraichir();
            // Le nouvel audit s'ouvre, dans le programme de son année.
            const sonAnnee = a.planned_date.slice(0, 4);
            ecrire({ audit: a.id, annee: Number(sonAnnee) === courante ? null : sonAnnee, statut: null });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisi !== null} liste={liste} fiche={choisi !== null && <FicheAudit key={choisi} id={choisi} droits={droits} onFermer={() => ecrire({ audit: null })} />} />;
}
