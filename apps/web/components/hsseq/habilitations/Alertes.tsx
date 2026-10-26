"use client";

import { Badge, Card, DataTable, ErrorBox, Etat, Segmented } from "@/components/ui";
import { MOTIFS, tonHsseq } from "@/components/hsseq/commun";
import { aujourdhui, joursEntre } from "@/components/hsseq/actions/outils";
import { fmtDate, fmtDateTime, pluriel } from "@/lib/format";
import { useApi } from "@/lib/api-client";
import { NATURE_ALERTE, delai } from "./outils";
import type { ExpiryAlert, ExpiryAlertKind } from "./types";

/** Nature des échéances dans l'adresse (`nature`) et filtre `kind` du noyau. */
export type NatureAlertes = "toutes" | "personnes" | "aptitude" | "vehicules";

const KIND: Record<NatureAlertes, ExpiryAlertKind[] | null> = {
  toutes: null,
  personnes: ["qualification"],
  aptitude: ["fitness"],
  vehicules: ["vehicle_document"],
};

/**
 * Alertes d'échéance envoyées (GET /hsseq/qualifications/alerts) : une par échéance et par seuil, à
 * J-30 puis J-7, au Responsable HSSEQ, au chef de parc du site et, pour les personnes, à RH. Lue par
 * l'administration, la direction et le Responsable HSSEQ ; jamais par le chef de parc.
 */
export function Alertes({ nature, onNature }: { nature: NatureAlertes; onNature: (n: NatureAlertes) => void }) {
  const kind = KIND[nature];
  const { data, error, mutate } = useApi<ExpiryAlert[]>(`/hsseq/qualifications/alerts${kind ? `?kind=${kind.join(",")}` : ""}`, { keepPreviousData: true });
  const jour = aujourdhui();
  return (
    <div className="space-y-4">
      <p className="max-w-[90ch] text-[13px] leading-relaxed text-muted">
        Alertes envoyées 30 puis 7 jours avant chaque échéance, une seule fois par seuil : au Responsable HSSEQ, au chef de parc du site et, pour les personnes, à RH. Le jour de l&apos;échéance, le verrou de départ prend le relais : V04 pour une personne, V05 ou V06 pour un véhicule.
      </p>
      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented
          label="Nature des échéances"
          value={nature}
          onChange={onNature}
          options={[
            { key: "toutes", label: "Toutes" },
            { key: "personnes", label: "Habilitations" },
            { key: "aptitude", label: "Aptitude médicale" },
            { key: "vehicules", label: "Documents des véhicules" },
          ]}
        />
      </div>
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des alertes…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data}
              rowKey={(a) => a.id}
              empty={nature === "toutes" ? "Aucune alerte envoyée : aucune échéance dans les 30 jours." : "Aucune alerte de cette nature."}
              columns={[
                {
                  key: "expires_on",
                  label: "Échéance",
                  render: (a) => <Echeance a={a} jour={jour} />,
                },
                {
                  key: "subject",
                  label: "Concerne",
                  render: (a) => (
                    <span className="block min-w-[13rem] max-w-[34ch]">
                      <span className="block font-medium leading-snug text-ink">{a.subject}</span>
                      <span className="block text-[12.5px] leading-snug text-muted">
                        {a.label}
                        {a.kind === "fitness" ? "" : ` · ${NATURE_ALERTE[a.kind].toLocaleLowerCase("fr")}`}
                        {a.site ? `, ${a.site.name}` : ""}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "sent_at",
                  label: "Alerte",
                  sortValue: (a) => a.sent_at,
                  render: (a) => (
                    <span className="flex flex-col items-start gap-1">
                      {/* Mots à verser dans TON_HSSEQ : « J-7 » à surveiller, « J-30 » neutre. */}
                      <Badge tone={a.stage === "d7" ? tonHsseq("J-7", "warn") : tonHsseq("J-30", "neutral")}>{a.stage === "d7" ? "J-7" : "J-30"}</Badge>
                      <span className="whitespace-nowrap text-[12px] text-muted">
                        Le {fmtDateTime(a.sent_at)}, {pluriel(a.recipients, "destinataire")}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "reason_code",
                  label: "À l'échéance",
                  render: (a) => <Consequence a={a} jour={jour} />,
                },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
}

/** Date d'échéance et délai qui reste, en alerte une fois passée. */
function Echeance({ a, jour }: { a: ExpiryAlert; jour: string }) {
  const reste = joursEntre(jour, a.expires_on);
  return (
    <span className="flex flex-col">
      <span className="whitespace-nowrap">{fmtDate(a.expires_on)}</span>
      <span className={reste < 0 ? "whitespace-nowrap text-[12px] font-semibold text-danger" : "whitespace-nowrap text-[12px] text-muted"}>{delai(reste)}</span>
    </span>
  );
}

/** Motif du verrou ouvert à l'échéance : « ouvre V04 », puis « V04 ouvert » une fois échue. */
function Consequence({ a, jour }: { a: ExpiryAlert; jour: string }) {
  if (!a.reason_code) return <span className="text-[12.5px] text-muted">Sans motif : facultative</span>;
  const ouvert = joursEntre(jour, a.expires_on) < 0;
  return (
    <span title={MOTIFS[a.reason_code].libelle} className={ouvert ? "whitespace-nowrap text-[12.5px] font-semibold text-danger" : "whitespace-nowrap text-[12.5px] text-ink-2"}>
      {ouvert ? `${a.reason_code} ouvert : départ refusé` : `Ouvre ${a.reason_code}`}
    </span>
  );
}
