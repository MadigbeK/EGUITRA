"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "@/components/icons";
import { BadgeEtat, BadgeGravite, CHEMIN_DEMANDES, NouvelleDemande, SyntheseSupport, graviteUtile, heures } from "@/components/compte/demandes";
import { Badge, Button, Card, DataTable, Etat, PageHeader, Segmented, Select, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { ETATS, ETATS_OUVERTS, TYPES, libelleApp, libelleType, type LigneDemande } from "@/lib/support-types";
import type { Me } from "@/lib/types";

type Vue = "demandes" | "synthese";
type Portee = "toutes" | "miennes";

/**
 * Mes demandes : chaque compte interne y dépose et suit ses demandes au support (anomalies, remarques
 * de recette, évolutions, questions) ; la direction y lit aussi celles de ses sociétés ;
 * l'administration (E-VOLUTION XP) les voit toutes, les traite et lit la synthèse.
 */
export default function MesDemandesPage() {
  const router = useRouter();
  const { data: me } = useApi<Me>("/auth/me");
  const admin = me?.profiles.includes("admin") ?? false;
  // La direction et l'administration voient aussi les demandes des autres comptes.
  const elargi = admin || (me?.profiles.includes("direction") ?? false);
  const [vue, setVue] = useState<Vue>("demandes");
  const [etat, setEtat] = useState("");
  const [type, setType] = useState("");
  const [portee, setPortee] = useState<Portee>("toutes");
  const [nouvelle, setNouvelle] = useState(false);

  const params = new URLSearchParams();
  if (etat) params.set("state", etat === "ouvertes" ? ETATS_OUVERTS.join(",") : etat);
  if (type) params.set("kind", type);
  if (portee === "miennes") params.set("mine", "1");
  const query = params.toString();
  const { data: rows, error, mutate } = useApi<LigneDemande[]>(me ? `/support/requests${query ? `?${query}` : ""}` : null);

  return (
    <div>
      <PageHeader
        title="Mes demandes"
        subtitle={
          admin
            ? "Toutes les demandes des deux sociétés : prise en charge avec accusé de réception, réponse écrite, résolution, qualification et crédit des évolutions."
            : "Anomalies, remarques de recette, demandes d'évolution et questions adressées au support de la plateforme (E-VOLUTION XP). Chaque demande reçoit un numéro, un accusé de réception à sa prise en charge et une réponse écrite dans son fil."
        }
        actions={
          <Button variant="primary" onClick={() => setNouvelle(true)} disabled={!me}>
            <Plus className="h-4 w-4" /> Nouvelle demande
          </Button>
        }
      />
      {admin && (
        <Tabs
          tabs={[
            { key: "demandes", label: "Demandes" },
            { key: "synthese", label: "Synthèse" },
          ]}
          value={vue}
          onChange={setVue}
        />
      )}
      {admin && vue === "synthese" ? (
        <SyntheseSupport />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Card padded={false}>
            <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 pb-4 pt-5">
              <Select
                aria-label="État"
                value={etat}
                onChange={(e) => setEtat(e.target.value)}
                className="w-[210px]"
                options={[{ value: "", label: "Tous les états" }, { value: "ouvertes", label: "À traiter (déposées, en cours)" }, ...ETATS.map((s) => ({ value: s.value, label: s.label }))]}
              />
              <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-[210px]" options={[{ value: "", label: "Tous les types" }, ...TYPES.map((t) => ({ value: t.value, label: t.label }))]} />
              {elargi && (
                <Segmented
                  label="Demandes affichées"
                  value={portee}
                  onChange={setPortee}
                  options={[
                    { key: "toutes", label: admin ? "Toutes" : "Mes sociétés" },
                    { key: "miennes", label: "Les miennes" },
                  ]}
                />
              )}
            </div>
            <Etat data={rows} error={error} onRetry={() => void mutate()} label="Chargement des demandes…">
              {(liste) => (
                <DataTable
                  rows={liste}
                  rowKey={(r) => r.id}
                  onRowClick={(r) => router.push(`${CHEMIN_DEMANDES}/${r.id}`)}
                  empty={query ? "Aucune demande dans cette sélection." : "Aucune demande pour l'instant : déposez la première avec « Nouvelle demande »."}
                  columns={[
                    { key: "name", label: "Numéro", className: "whitespace-nowrap font-semibold tabular", sortValue: (r) => r.name },
                    {
                      key: "title",
                      label: "Demande",
                      render: (r) => (
                        <span className="block min-w-[220px]">
                          <span className="block font-medium text-ink">{r.title}</span>
                          <span className="block text-[12.5px] text-muted">
                            {libelleType(r.kind)} · {libelleApp(r.app)}
                            {r.comment_count > 0 && ` · ${r.comment_count} ${r.comment_count > 1 ? "messages" : "message"}`}
                          </span>
                        </span>
                      ),
                    },
                    { key: "severity", label: "Gravité", render: (r) => (graviteUtile(r.kind) ? <BadgeGravite gravite={r.severity} /> : "–") },
                    {
                      key: "state",
                      label: "État",
                      render: (r) => (
                        <span className="flex flex-wrap gap-1">
                          <BadgeEtat etat={r.state} />
                          {admin && r.state === "submitted" && r.take_over.late && <Badge tone="danger">Hors délai</Badge>}
                        </span>
                      ),
                    },
                    { key: "date_submitted", label: "Déposée le", render: (r) => fmtDateTime(r.date_submitted), sortValue: (r) => r.date_submitted },
                    ...(elargi ? [{ key: "author", label: "Auteur", render: (r: LigneDemande) => <span className="block">{r.author?.name ?? "–"}<span className="block text-[12px] text-muted">{r.company.name}</span></span>, sortValue: (r: LigneDemande) => r.author?.name ?? "" }] : []),
                    ...(admin ? [{ key: "take_over", label: "Prise en charge", align: "right" as const, render: (r: LigneDemande) => (r.take_over.done ? heures(r.take_over.hours) : r.state === "submitted" ? `${heures(r.take_over.hours)} écoulées` : "–"), sortValue: (r: LigneDemande) => r.take_over.hours }] : []),
                  ]}
                />
              )}
            </Etat>
          </Card>
          <Card title="Comment une demande est suivie" className="self-start">
            <ol className="list-decimal space-y-2.5 pl-5 text-[13.5px] leading-relaxed text-ink-2">
              <li>Vous la déposez : elle reçoit aussitôt son numéro.</li>
              <li>Le support la prend en charge, avec un accusé de réception dans son fil : sous 2 heures ouvrées pour une anomalie bloquante, 4 pour une majeure, 1 jour pour une mineure ; une évolution est qualifiée sous 2 jours ouvrés.</li>
              <li>La réponse écrite et la résolution arrivent dans le fil ; vous pouvez le compléter à tout moment.</li>
              <li>Vous confirmez la résolution, ou rouvrez la demande si le problème persiste ; sans réponse sous 5 jours ouvrés, elle est close.</li>
            </ol>
            <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-snug text-muted">Du lundi au vendredi, de 8 h à 18 h. Anomalie bloquante : appelez aussi le +224 628 86 22 55.</p>
          </Card>
        </div>
      )}
      {nouvelle && me && <NouvelleDemande me={me} onClose={() => setNouvelle(false)} onDeposee={(fiche) => router.push(`${CHEMIN_DEMANDES}/${fiche.id}?depot=1`)} />}
    </div>
  );
}
