"use client";

/**
 * HSSEQ, « Dérogations » : file des dérogations au verrou de départ (GET /hsseq/waivers), en quatre
 * onglets (à valider, actives, refusées, expirées). Le Responsable HSSEQ valide ou refuse depuis la
 * fiche ; le Directeur général et l'administration lisent tout ; le chef de parc suit celles de ses
 * sites (il les demande depuis Transport, « Départs du jour »).
 */

import { useState } from "react";
import { Card, DataTable, Etat, Field, Notice, Select, Tabs } from "@/components/ui";
import { STATUT_DEROGATION, Tampon, nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { CodeMotif } from "@/components/transport/departs/motifs";
import { useApi, useAutorise } from "@/lib/api-client";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { HsseqSite, Page, Waiver, WaiverCounts, WaiverStatus } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { FicheDerogation } from "./FicheDerogation";

type Onglet = Extract<WaiverStatus, "pending_hsseq" | "active" | "refused" | "expired">;

const ONGLETS: Array<{ key: Onglet; label: string; vide: string }> = [
  { key: "pending_hsseq", label: "À valider", vide: "Aucune dérogation n'attend la seconde validation." },
  { key: "active", label: "Actives", vide: "Aucune dérogation active." },
  { key: "refused", label: "Refusées", vide: "Aucune dérogation refusée." },
  { key: "expired", label: "Expirées", vide: "Aucune dérogation expirée." },
];

/** Dérogations lues par onglet : quelques-unes par mois au plus (cible du cockpit). */
const LIMITE = 200;

type PageDerogations = Page<Waiver, WaiverCounts>;

export function Derogations() {
  const [onglet, setOnglet] = useState<Onglet>("pending_hsseq");
  const [site, setSite] = useState("");
  const [ouverte, setOuverte] = useState<Waiver | null>(null);
  const filtreSite = site ? `&site_id=${site}` : "";
  const { data: sites } = useApi<HsseqSite[]>("/hsseq/sites");
  // Les compteurs portent sur toute la sélection (tous statuts) ; la liste, sur l'onglet.
  const comptes = useApi<PageDerogations>(`/hsseq/waivers?limit=1${filtreSite}`);
  const liste = useApi<PageDerogations>(`/hsseq/waivers?status=${onglet}&limit=${LIMITE}${filtreSite}`);
  const { data: moi } = useApi<Me>("/auth/me");
  const hsseq = useAutorise(["hsseq"]);
  const direction = useAutorise(["direction"]);
  const admin = useAutorise(["admin"]);
  const exploitation = useAutorise(["exploitation"]);
  const vide = ONGLETS.find((o) => o.key === onglet)?.vide ?? "Aucune dérogation.";
  const courante = ouverte ? (liste.data?.items.find((w) => w.id === ouverte.id) ?? ouverte) : null;

  function relire() {
    void comptes.mutate();
    void liste.mutate();
  }

  return (
    <div className="space-y-5">
      {!hsseq && (direction || admin) && (
        <Notice tone="neutral">
          Lecture seule. {direction ? "Vous êtes informé de chaque dérogation à son activation. " : ""}La seconde validation revient au Responsable HSSEQ, une autre personne que le chef de parc qui a demandé.
        </Notice>
      )}
      {!hsseq && !direction && !admin && exploitation && (
        <Notice tone="neutral">Vous suivez ici les dérogations de vos sites. Une demande se fait depuis Transport, « Départs du jour », sur le départ concerné.</Notice>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Site" className="w-full sm:w-64">
          <Select value={site} onChange={(e) => setSite(e.target.value)} placeholder="Tous les sites" options={(sites ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
      </div>

      <div>
        <Tabs<Onglet>
          value={onglet}
          onChange={setOnglet}
          tabs={ONGLETS.map((o) => ({ key: o.key, label: o.label, count: comptes.data?.counts.by_status[o.key] }))}
        />
        <Card padded={false}>
          {!liste.data ? (
            <Etat error={liste.error} onRetry={() => liste.mutate()} label="Chargement des dérogations…" />
          ) : (
            <>
              <DataTable
                rows={liste.data.items}
                rowKey={(w) => w.id}
                onRowClick={(w) => setOuverte(w)}
                empty={vide}
                columns={[
                  {
                    key: "requested_at",
                    label: "Demandée",
                    sortValue: (w) => w.requested_at,
                    render: (w) => (
                      <div className="whitespace-nowrap">
                        <div className="text-ink">{fmtDateTime(w.requested_at)}</div>
                        <div className="font-mono text-[11.5px] text-muted">{w.reference}</div>
                      </div>
                    ),
                  },
                  { key: "vehicle", label: "Véhicule", sortValue: (w) => w.vehicle?.name ?? "", render: (w) => <span className="whitespace-nowrap">{nomVehicule(w.vehicle)}</span> },
                  {
                    key: "rotation",
                    label: "Rotation",
                    sortValue: (w) => w.rotation.date_loading,
                    render: (w) => (
                      <div>
                        <div className="whitespace-nowrap font-mono text-xs text-ink">{nomRotation(w.rotation)}</div>
                        <div className="text-[12px] text-muted">{w.rotation.route_name ?? "–"}</div>
                      </div>
                    ),
                  },
                  { key: "site", label: "Site", sortValue: (w) => w.site?.name ?? "", render: (w) => w.site?.name ?? "–" },
                  {
                    key: "reason_code",
                    label: "Motif",
                    sortValue: (w) => w.reason_code,
                    render: (w) => (
                      <div className="flex min-w-[220px] items-start gap-2">
                        <CodeMotif code={w.reason_code} ton={w.status === "active" ? "warn" : "danger"} />
                        <span className="text-[13px] leading-snug text-ink">{w.reason_label}</span>
                      </div>
                    ),
                  },
                  { key: "requested_by", label: "Demandeur", sortValue: (w) => w.requested_by.name, render: (w) => <span className="whitespace-nowrap">{w.requested_by.name}</span> },
                  { key: "status", label: "Statut", sortValue: (w) => w.expires ?? w.requested_at, render: (w) => <Statut w={w} moiId={moi?.id ?? null} hsseq={hsseq} /> },
                ]}
              />
              {liste.data.total_count > liste.data.items.length && (
                <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
                  Les {fmtInt(liste.data.items.length)} plus récentes sur {fmtInt(liste.data.total_count)}.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {courante && (
        <FicheDerogation
          derogation={courante}
          moiId={moi?.id ?? null}
          hsseq={hsseq}
          onClose={() => setOuverte(null)}
          onChange={(w) => {
            if (w) setOuverte(w);
            relire();
          }}
        />
      )}
    </div>
  );
}

/** Statut d'une ligne et ce qu'il reste à faire : seconde validation, échéance, refus. */
function Statut({ w, moiId, hsseq }: { w: Waiver; moiId: number | null; hsseq: boolean }) {
  let detail: string | null = null;
  if (w.status === "pending_hsseq") {
    detail = hsseq && !w.transitions.includes("approve") ? (moiId === w.requested_by.id ? "Votre demande : une autre personne valide" : "Validation ouverte à une autre personne") : "1 validation sur 2";
  } else if (w.status === "active" || w.status === "expired") {
    detail = w.expires ? `${w.status === "active" ? "Jusqu'au" : "Le"} ${fmtDateTime(w.expires)}` : null;
  } else if (w.status === "refused") {
    detail = w.refusal_reason;
  }
  return (
    <div className="min-w-[150px]">
      <Tampon mot={STATUT_DEROGATION[w.status]} />
      {detail && <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted">{detail}</div>}
    </div>
  );
}
