"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Search, X } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Input, Notice, Select, Tabs, type Tri } from "@/components/ui";
import { ORIGINE_ACTION, STATUT_ACTION, Tampon } from "@/components/hsseq/commun";
import { apiDownload, useApi } from "@/lib/api-client";
import { fmtDate, pluriel } from "@/lib/format";
import type { ActionCounts, ActionLine, ActionOrigin, ActionStatus, Page } from "@/lib/hsseq-types";
import { Origine, Retard } from "./elements";
import { FicheAction } from "./FicheAction";
import { AvecFiche, Bascule, ChampSite, Pages, aujourdhui, joursEntre, messageErreur, requete, useAdresse, useReferentiels } from "./outils";

/** Onglets du registre : le statut, avec le nombre d'actions de la sélection filtrée. */
type Onglet = "a_traiter" | "a_verifier" | "closes" | "annulees" | "toutes";

const ONGLETS: Record<Onglet, { label: string; statuts: ActionStatus[] | null }> = {
  a_traiter: { label: "À traiter", statuts: ["todo", "in_progress"] },
  a_verifier: { label: "À vérifier", statuts: ["to_verify"] },
  closes: { label: "Closes", statuts: ["closed"] },
  annulees: { label: "Annulées", statuts: ["cancelled"] },
  toutes: { label: "Toutes", statuts: null },
};
const ORDRE_ONGLETS = Object.keys(ONGLETS) as Onglet[];

/** Tris acceptés par le noyau (paramètre `sort`). */
const TRIS = ["reference", "due_date", "days_overdue", "status"] as const;

const PAR_PAGE = 50;

/**
 * Plan d'actions : registre unique des actions correctives et préventives (§3, §9.2). Filtres et
 * fiche ouverte portés par l'adresse (statut, origine, responsable, site, echeance, retard=1, q,
 * evenement, action) ; onglets par statut avec leur nombre ; la fiche s'ouvre à côté de la liste.
 * Venu d'un événement (evenement, passé au noyau en event_id), le registre montre toutes ses actions, closes comprises.
 */
export function PlanActions() {
  const { lire, ecrire } = useAdresse();
  const { data: ref } = useReferentiels();
  // Venu de la fiche d'un événement : « evenement » (ou « event_id », clé du noyau).
  const evenement = Number(lire("evenement") || lire("event_id")) || null;
  const ongletParDefaut: Onglet = evenement ? "toutes" : "a_traiter";
  const onglet: Onglet = (ORDRE_ONGLETS as string[]).includes(lire("statut")) ? (lire("statut") as Onglet) : ongletParDefaut;
  const origine = lire("origine") as ActionOrigin | "";
  const responsable = lire("responsable");
  const site = lire("site");
  const echeance = lire("echeance");
  const retard = lire("retard") === "1";
  const recherche = lire("q");
  const choisie = Number(lire("action")) || null;

  const filtres = {
    origin: origine || null,
    owner_id: responsable && responsable !== "moi" ? responsable : null,
    mine: responsable === "moi" ? 1 : null,
    site_id: site || null,
    due_before: echeance || null,
    overdue: retard ? 1 : null,
    search: recherche || null,
    event_id: evenement,
  };
  const cle = `${requete(filtres)}|${onglet}`;
  const [tri, setTri] = useState<Tri>({ key: "due_date", dir: 1 });
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const statuts = ONGLETS[onglet].statuts;

  // Les nombres des onglets portent sur la sélection filtrée sans le statut ; la liste, sur l'onglet.
  const { data: compte } = useApi<Page<ActionLine, ActionCounts>>(`/hsseq/actions?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<ActionLine, ActionCounts>>(
    `/hsseq/actions?${requete({ ...filtres, status: statuts?.join(",") ?? null, sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const parStatut = compte?.counts.by_status;
  const nombre = (o: Onglet) => {
    if (!parStatut) return undefined;
    const s = ONGLETS[o].statuts;
    return (s ?? (Object.keys(parStatut) as ActionStatus[])).reduce((n, k) => n + (parStatut[k] ?? 0), 0);
  };

  const responsables = ref?.owners ?? [];
  const [export_, setExport] = useState<string | null>(null);

  const liste = (
    <div className="space-y-4">
      <Tabs
        value={onglet}
        onChange={(o) => ecrire({ statut: o === ongletParDefaut ? null : o })}
        tabs={ORDRE_ONGLETS.map((o) => ({ key: o, label: ONGLETS[o].label, count: nombre(o) }))}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Recherche valeur={recherche} onChange={(q) => ecrire({ q })} />
        <Field label="Origine" className="w-full sm:w-44">
          <Select value={origine} onChange={(e) => ecrire({ origine: e.target.value })} placeholder="Toutes" options={(Object.keys(ORIGINE_ACTION) as ActionOrigin[]).map((o) => ({ value: o, label: ORIGINE_ACTION[o] }))} />
        </Field>
        <Field label="Responsable" className="w-full sm:w-52">
          <Select value={responsable} onChange={(e) => ecrire({ responsable: e.target.value })} placeholder="Tous" options={[{ value: "moi", label: "Mes actions" }, ...responsables.map((o) => ({ value: o.id, label: o.name }))]} />
        </Field>
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
        <Field label="Échéance au plus tard le" className="w-full sm:w-48">
          <Input type="date" value={echeance} onChange={(e) => ecrire({ echeance: e.target.value })} />
        </Field>
        <Bascule actif={retard} onChange={(v) => ecrire({ retard: v ? "1" : null })} nombre={compte?.counts.overdue}>
          En retard
        </Bascule>
        <Button
          className="ml-auto"
          loading={export_ === "en_cours"}
          onClick={async () => {
            setExport("en_cours");
            try {
              await apiDownload(`/hsseq/actions/export.xlsx?${requete({ ...filtres, status: statuts?.join(",") ?? null })}`, `plan_actions_${aujourdhui()}.xlsx`);
              setExport(null);
            } catch (e) {
              setExport(messageErreur(e, "Export impossible."));
            }
          }}
        >
          <Download className="h-4 w-4" /> Exporter
        </Button>
      </div>
      {export_ && export_ !== "en_cours" && <Notice tone="danger">{export_}</Notice>}
      {evenement && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-accent-doux px-3.5 py-2 text-[13px] text-ink">
          <span>
            Actions de l&apos;événement{" "}
            <Link href={`/hsseq/evenements/${evenement}`} className="font-semibold text-accent underline-offset-2 hover:underline">
              {data?.items.find((a) => a.event)?.event?.reference ?? "d'origine"}
            </Link>
          </span>
          <button type="button" onClick={() => ecrire({ evenement: null, event_id: null, origine: null, statut: null })} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-ink-2 transition-colors hover:bg-panel hover:text-ink">
            <X className="h-3.5 w-3.5" /> Tout le registre
          </button>
        </div>
      )}
      <p className="text-[12.5px] leading-snug text-muted">
        Le responsable est relancé à J-7, le jour de l&apos;échéance puis chaque semaine de retard ; au-delà de 30 jours de retard, l&apos;action est escaladée au Directeur général.
      </p>
      {onglet === "a_verifier" && (compte?.counts.verifications_due ?? 0) > 0 && (
        <Notice tone="warn">
          {pluriel(compte?.counts.verifications_due ?? 0, "vérification d'efficacité échue", "vérifications d'efficacité échues")} : le Responsable HSSEQ juge l&apos;action efficace, ou la renvoie en cours avec une nouvelle échéance.
        </Notice>
      )}
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des actions…" />
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
              }}
              onRowClick={(a) => ecrire({ action: a.id })}
              empty={filtresActifs(filtres) ? "Aucune action pour ces filtres." : "Aucune action dans cet onglet."}
              columns={[
                {
                  key: "reference",
                  label: "Action",
                  render: (a) => (
                    <div className={choisie === a.id ? "min-w-[16rem] max-w-[52ch] font-medium" : "min-w-[16rem] max-w-[52ch]"}>
                      <span className="font-mono text-[11.5px] text-muted">{a.reference}</span>
                      {choisie === a.id && <span className="sr-only"> (fiche ouverte)</span>}
                      <span className="mt-0.5 line-clamp-2 block leading-snug text-ink">{a.description}</span>
                      <span className="mt-1 block text-[12px] leading-snug text-muted">
                        <Origine a={a} />, confiée à {a.owner.name}
                        {a.site ? `, ${a.site.name}` : ""}
                      </span>
                    </div>
                  ),
                },
                { key: "due_date", label: "Échéance", render: (a) => <Echeance a={a} /> },
                { key: "days_overdue", label: "Retard", align: "right", render: (a) => <Retard a={a} /> },
                {
                  key: "status",
                  label: "Statut",
                  render: (a) => (
                    <span className="inline-flex flex-col items-start gap-1">
                      <Tampon mot={STATUT_ACTION[a.status]} />
                      {a.status === "to_verify" && a.verification_date && <span className="whitespace-nowrap text-[12px] text-muted">Vérification le {fmtDate(a.verification_date)}</span>}
                      {a.approval_required && <Tampon mot="À valider" />}
                    </span>
                  ),
                },
              ]}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="actions" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>
    </div>
  );

  return (
    <AvecFiche ouverte={choisie !== null} liste={liste} fiche={choisie !== null && <FicheAction key={choisie} id={choisie} onFermer={() => ecrire({ action: null })} />} />
  );
}

function filtresActifs(f: Record<string, string | number | null>): boolean {
  return Object.values(f).some((v) => v !== null && v !== "");
}

/** Échéance, et le délai qui reste quand la relance de J-7 approche. */
function Echeance({ a }: { a: ActionLine }) {
  const ouverte = a.status === "todo" || a.status === "in_progress";
  const reste = joursEntre(aujourdhui(), a.due_date);
  return (
    <span className="inline-flex flex-col">
      <span className="whitespace-nowrap">{fmtDate(a.due_date)}</span>
      {ouverte && !a.overdue && reste >= 0 && reste <= 7 && <span className="whitespace-nowrap text-[12px] text-muted">{reste === 0 ? "Aujourd'hui" : `Dans ${pluriel(reste, "jour")}`}</span>}
    </span>
  );
}

/** Recherche dans la référence et la description, posée dans l'adresse après une courte pause de frappe. */
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
        <Input type="search" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Référence, description" className="pl-9" />
      </span>
    </Field>
  );
}
