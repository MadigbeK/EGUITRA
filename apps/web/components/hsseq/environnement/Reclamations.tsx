"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Segmented, Select, cx, type Column, type Tri } from "@/components/ui";
import { AvecFiche, Bascule, ChampSite, Pages, aujourdhui, joursEntre, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { useEtroit } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtInt, pluriel } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { ChampsPeriode, Chiffre, ExportRegistres, GRAVITE, NATURE_RECLAMATION, ORDRE_GRAVITES, ORDRE_RECLAMATIONS, STATUT_RECLAMATION, Situation, TamponEnv, filtresCommuns, nombre, parmi, useRafraichir, type VueProps } from "./commun";
import { FenetreReclamation } from "./fenetres";
import { FicheReclamation } from "./FicheReclamation";
import type { Complaint, ComplaintCounts, ComplaintLine, ComplaintNature, ComplaintSeverity, ReferentielsEnvironnement } from "./types";

const PAR_PAGE = 50;

/** Statut dans l'adresse et ses clés dans l'API : en cours, ce sont les réclamations reçues ou répondues. */
const STATUT_ADRESSE: Record<"en_cours" | "closes" | "toutes", string | null> = { en_cours: "received,answered", closes: "closed", toutes: null };
type FiltreStatut = keyof typeof STATUT_ADRESSE;

const TRIS = ["received_on", "reference", "response_due", "status"];

/** Réponse d'une réclamation : délai et respect de l'échéance une fois répondue, échéance sinon. */
function Reponse({ r }: { r: ComplaintLine }) {
  if (r.responded_on) {
    return (
      <span className="inline-flex min-w-[9rem] flex-col items-start gap-1">
        <span className="whitespace-nowrap text-ink">
          Le {fmtDate(r.responded_on)}
          {r.response_days !== null ? `, en ${pluriel(r.response_days, "jour")}` : ""}
        </span>
        {r.on_time !== null && <TamponEnv mot={r.on_time ? "Dans le délai" : "Hors délai"} />}
      </span>
    );
  }
  if (!r.response_due) return <span className="text-muted">–</span>;
  const reste = joursEntre(aujourdhui(), r.response_due);
  // Le retard est celui du noyau (`overdue`) ; le délai restant se compte à l'écran, au jour près.
  return (
    <span className="inline-flex min-w-[9rem] flex-col items-start">
      <span className="whitespace-nowrap text-ink">Avant le {fmtDate(r.response_due)}</span>
      <span className={cx("whitespace-nowrap text-[12px]", r.overdue || reste < 0 ? "font-semibold text-danger" : "text-muted")}>
        {reste < 0 ? `En retard de ${pluriel(-reste, "jour")}` : reste === 0 ? "Aujourd'hui" : `Dans ${pluriel(reste, "jour")}`}
      </span>
    </span>
  );
}

/**
 * Réclamations des clients (GET /hsseq/complaints), chacune avec son texte en tête de ligne : à
 * répondre, en retard, répondues et closes en tête ; filtres par statut (en cours par défaut), retard, nature, gravité, client, site et période,
 * portés par l'adresse avec la fiche ouverte (reclamation). Le Responsable HSSEQ les saisit, y répond
 * dans le délai des paramètres et les clôt quand leurs actions le sont.
 */
export function Reclamations({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const etroit = useEtroit();
  const rafraichir = useRafraichir();
  const { site, du, au, api } = filtresCommuns(lire);
  const statut: FiltreStatut = parmi(lire("statut"), STATUT_ADRESSE) ?? "en_cours";
  const retard = lire("retard") === "1";
  const nature: ComplaintNature | null = parmi(lire("nature"), NATURE_RECLAMATION);
  const gravite: ComplaintSeverity | null = parmi(lire("gravite"), GRAVITE);
  const client = /^\d+$/.test(lire("client")) ? lire("client") : "";
  const choisi = Number(lire("reclamation")) || null;
  const [tri, setTri] = useState<Tri>({ key: "received_on", dir: -1 });
  const filtres = { ...api, nature, severity: gravite, partner_id: client || null, overdue: retard ? 1 : null };
  const cle = `${requete(filtres)}|${statut}|${tri.key}|${tri.dir}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [saisir, setSaisir] = useState(false);

  // Situation sur le site et la période, sans les autres filtres ; nombres de la bascule sur la sélection sans statut.
  const { data: situation } = useApi<Page<ComplaintLine, ComplaintCounts>>(`/hsseq/complaints?${requete({ ...api, limit: 1 })}`, { keepPreviousData: true });
  const { data: compte } = useApi<Page<ComplaintLine, ComplaintCounts>>(`/hsseq/complaints?${requete({ ...filtres, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<ComplaintLine, ComplaintCounts>>(
    `/hsseq/complaints?${requete({ ...filtres, status: STATUT_ADRESSE[statut], sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const s = situation?.counts;
  const parStatut = compte?.counts.by_status;
  const enCours = parStatut ? parStatut.received + parStatut.answered : 0;
  const compact = etroit || choisi !== null;

  // Clients proposés au filtre : ceux des référentiels, sinon ceux des réclamations affichées.
  const clients = (ref as ReferentielsEnvironnement | undefined)?.clients ?? [];
  const optionsClients = (clients.length ? clients : [...new Map((data?.items ?? []).map((r) => [r.partner.id, r.partner])).values()]).map((c) => ({ value: c.id, label: c.name }));
  if (client && !optionsClients.some((o) => String(o.value) === client)) {
    const lu = data?.items.find((r) => String(r.partner.id) === client)?.partner;
    optionsClients.unshift({ value: Number(client), label: lu?.name ?? "Client choisi" });
  }

  const colonnes: Column<ComplaintLine>[] = [
    {
      key: "received_on",
      label: "Réclamation",
      render: (r) => (
        <span className={cx("block min-w-[14rem] max-w-[44ch]", choisi === r.id && "font-medium")}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11.5px] text-muted">{r.reference}</span>
            {compact && <TamponEnv mot={STATUT_RECLAMATION[r.status]} />}
            {compact && r.overdue && <TamponEnv mot="En retard" />}
          </span>
          {choisi === r.id && <span className="sr-only"> (fiche ouverte)</span>}
          <span className="mt-0.5 block leading-snug text-ink">{r.partner.name}</span>
          {r.description && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-2">{r.description}</span>}
          <span className="mt-1 block text-[12px] leading-snug text-muted">
            {NATURE_RECLAMATION[r.nature]}, reçue le {fmtDate(r.received_on)}
          </span>
        </span>
      ),
    },
    ...(compact ? [] : [{ key: "severity", label: "Gravité", render: (r: ComplaintLine) => <TamponEnv mot={GRAVITE[r.severity]} /> }]),
    { key: "response_due", label: "Réponse", render: (r) => <Reponse r={r} /> },
    ...(compact
      ? []
      : [
          {
            key: "open_actions",
            label: "Actions",
            align: "right" as const,
            render: (r: ComplaintLine) => (r.open_actions ? <span className="text-ink">{pluriel(r.open_actions, "en cours", "en cours")}</span> : <span className="text-muted">–</span>),
          },
          {
            key: "status",
            label: "Statut",
            render: (r: ComplaintLine) => (
              <span className="inline-flex flex-col items-start gap-1">
                <TamponEnv mot={STATUT_RECLAMATION[r.status]} />
                {r.overdue && <TamponEnv mot="En retard" />}
              </span>
            ),
          },
        ]),
  ];

  const liste = (
    <div className="space-y-5">
      <Situation label="Situation des réclamations">
        <Chiffre valeur={nombre(s?.by_status.received)} ton={(s?.by_status.received ?? 0) > 0 ? "warn" : undefined}>
          {(s?.by_status.received ?? 0) > 1 ? "réclamations à répondre" : "réclamation à répondre"}
        </Chiffre>
        <Chiffre valeur={nombre(s?.overdue)} ton={(s?.overdue ?? 0) > 0 ? "danger" : undefined} actif={retard} onClick={() => ecrire({ retard: retard ? null : "1", statut: null })}>
          en retard de réponse
        </Chiffre>
        <Chiffre valeur={nombre(s?.by_status.answered)}>répondues, en attente de clôture</Chiffre>
        <Chiffre valeur={nombre(s?.by_status.closed)}>{(s?.by_status.closed ?? 0) > 1 ? "closes" : "close"}</Chiffre>
      </Situation>

      <div className="flex flex-wrap items-end gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Segmented<FiltreStatut>
            label="Réclamations affichées"
            value={statut}
            onChange={(x) => ecrire({ statut: x === "en_cours" ? null : x })}
            options={[
              { key: "en_cours", label: `En cours (${fmtInt(enCours)})` },
              { key: "closes", label: `Closes (${fmtInt(parStatut?.closed ?? 0)})` },
              { key: "toutes", label: `Toutes (${fmtInt(compte?.total_count ?? 0)})` },
            ]}
          />
        </div>
        <Bascule actif={retard} onChange={(v) => ecrire({ retard: v ? "1" : null })} nombre={compte?.counts.overdue}>
          En retard
        </Bascule>
        <Field label="Nature" className="w-full sm:w-52">
          <Select value={nature ?? ""} onChange={(e) => ecrire({ nature: e.target.value })} placeholder="Toutes" options={ORDRE_RECLAMATIONS.map((n) => ({ value: n, label: NATURE_RECLAMATION[n] }))} />
        </Field>
        <Field label="Gravité" className="w-full sm:w-36">
          <Select value={gravite ?? ""} onChange={(e) => ecrire({ gravite: e.target.value })} placeholder="Toutes" options={ORDRE_GRAVITES.map((g) => ({ value: g, label: GRAVITE[g] }))} />
        </Field>
        <Field label="Client" className="w-full sm:w-60">
          <Select value={client} onChange={(e) => ecrire({ client: e.target.value })} placeholder="Tous" options={optionsClients} />
        </Field>
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
        <ChampsPeriode du={du} au={au} ecrire={ecrire} libelleDu="Reçues du" />
        {droits.hsseq && (
          <Button variant="primary" className="ml-auto" onClick={() => setSaisir(true)}>
            <Plus className="h-4 w-4" /> Nouvelle réclamation
          </Button>
        )}
        <ExportRegistres filtres={api} className={droits.hsseq ? undefined : "ml-auto"} />
      </div>

      <p className="text-[12.5px] leading-snug text-muted">
        La réponse au client est attendue dans le délai des paramètres de la société (15 jours par défaut) ; la réclamation se clôt une fois ses actions closes ou annulées.
      </p>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des réclamations…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(r) => r.id}
              sort={tri}
              onSort={(t) => {
                if (TRIS.includes(t.key)) setTri(t);
              }}
              onRowClick={(r) => ecrire({ reclamation: r.id })}
              empty={statut === "en_cours" && !retard && !nature && !gravite && !client && !site && !du && !au ? "Aucune réclamation en cours." : "Aucune réclamation pour ces filtres."}
              columns={colonnes}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="réclamations" onPage={(x) => setPosition({ cle, offset: x })} />
          </>
        )}
      </Card>

      {saisir && (
        <FenetreReclamation
          droits={droits}
          onClose={() => setSaisir(false)}
          envoyer={async (corps) => {
            const r = await apiSend<Complaint>("POST", "/hsseq/complaints", corps);
            void rafraichir();
            ecrire({ reclamation: r.id, statut: statut === "toutes" ? "toutes" : null, retard: null, nature: null, gravite: null, client: null });
          }}
        />
      )}
    </div>
  );

  return <AvecFiche ouverte={choisi !== null} liste={liste} fiche={choisi !== null && <FicheReclamation key={choisi} id={choisi} droits={droits} onFermer={() => ecrire({ reclamation: null })} />} />;
}
