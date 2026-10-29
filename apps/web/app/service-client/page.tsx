"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "@/components/icons";
import { BadgeEtat, BadgePriorite, BadgeRetard } from "@/components/service-client/commun";
import { Badge, Card, DataTable, Etat, Input, Notice, PageHeader, Segmented, Select, classesBouton } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { CANAUX, ETATS, PRIORITES, type ContexteSC, type LigneDossier } from "@/lib/service-client";

type Vue = "ouverts" | "miens" | "libres" | "retard" | "tous";

interface Liste {
  items: LigneDossier[];
  total: number;
  counts: { open: number; mine: number; unassigned: number; late: number };
}

/** Dossiers du service client de la société de travail : file des agents, dossiers assignés pour les métiers. */
export default function DossiersPage() {
  const router = useRouter();
  const { data: ctx } = useApi<ContexteSC>("/service-client/context");
  const [vue, setVue] = useState<Vue>("ouverts");
  const [etat, setEtat] = useState("");
  const [priorite, setPriorite] = useState("");
  const [canal, setCanal] = useState("");
  const [categorie, setCategorie] = useState("");
  const [saisie, setSaisie] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(saisie.trim()), 300);
    return () => clearTimeout(t);
  }, [saisie]);

  const params = new URLSearchParams();
  if (vue === "ouverts" && !etat) params.set("state", "open");
  if (vue === "miens") params.set("mine", "1");
  if (vue === "libres") {
    params.set("unassigned", "1");
    params.set("state", "open");
  }
  if (vue === "retard") params.set("late", "1");
  if (etat) params.set("state", etat);
  if (priorite) params.set("priority", priorite);
  if (canal) params.set("channel", canal);
  if (categorie) params.set("category_id", categorie);
  if (q) params.set("q", q);
  const { data, error, mutate } = useApi<Liste>(`/service-client/tickets?${params.toString()}`, { refreshInterval: 60_000 });
  const manage = ctx?.can.manage ?? false;
  const inactifs = ctx && manage ? [ctx.channels.email, ctx.channels.whatsapp].filter((c) => !c.active) : [];

  return (
    <div>
      <PageHeader
        title="Dossiers du service client"
        subtitle={
          manage
            ? `Demandes et réclamations des clients de ${ctx?.company.name ?? "la société"} : téléphone, visite, courrier, courriel, espace client et WhatsApp.`
            : "Les dossiers qui vous sont confiés, à vous ou à votre équipe : répondez au client, notez, passez le dossier en cours ou résolu."
        }
        actions={
          manage ? (
            <Link href="/service-client/nouveau" className={classesBouton("primary")}>
              <Plus className="h-4 w-4" /> Nouveau dossier
            </Link>
          ) : undefined
        }
      />
      {inactifs.length > 0 && (
        <div className="mb-4 space-y-2">
          {inactifs.map((c) => (
            <Notice key={c.message} tone="warn">
              {c.message}
            </Notice>
          ))}
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 pb-4 pt-5">
          <Segmented
            label="Dossiers affichés"
            value={vue}
            onChange={(v) => {
              setVue(v);
              setEtat("");
            }}
            options={[
              { key: "ouverts", label: `Ouverts${data ? ` (${data.counts.open})` : ""}` },
              { key: "miens", label: `Les miens${data ? ` (${data.counts.mine})` : ""}` },
              ...(manage ? [{ key: "libres" as Vue, label: `Sans responsable${data ? ` (${data.counts.unassigned})` : ""}` }] : []),
              { key: "retard", label: `En retard${data ? ` (${data.counts.late})` : ""}` },
              { key: "tous", label: "Tous" },
            ]}
          />
          <Input aria-label="Rechercher" placeholder="Numéro, objet, client, téléphone, courriel" value={saisie} onChange={(e) => setSaisie(e.target.value)} className="w-[260px]" />
          <Select aria-label="État" value={etat} onChange={(e) => setEtat(e.target.value)} className="w-[180px]" options={[{ value: "", label: "Tous les états" }, ...ETATS.map((e) => ({ value: e.value, label: e.label }))]} />
          <Select aria-label="Priorité" value={priorite} onChange={(e) => setPriorite(e.target.value)} className="w-[150px]" options={[{ value: "", label: "Toutes priorités" }, ...PRIORITES.map((p) => ({ value: p.value, label: p.label }))]} />
          <Select aria-label="Canal" value={canal} onChange={(e) => setCanal(e.target.value)} className="w-[150px]" options={[{ value: "", label: "Tous canaux" }, ...CANAUX.map((c) => ({ value: c.value, label: c.label }))]} />
          <Select aria-label="Catégorie" value={categorie} onChange={(e) => setCategorie(e.target.value)} className="w-[200px]" options={[{ value: "", label: "Toutes catégories" }, ...(ctx?.categories ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des dossiers…">
          {(liste) => (
            <DataTable
              rows={liste.items}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/service-client/dossiers/${r.id}`)}
              empty={manage ? "Aucun dossier dans cette sélection." : "Aucun dossier ne vous est confié pour l'instant."}
              columns={[
                { key: "name", label: "Numéro", className: "whitespace-nowrap font-semibold tabular", sortValue: (r) => r.name },
                {
                  key: "subject",
                  label: "Dossier",
                  render: (r) => (
                    <span className="block min-w-[240px]">
                      <span className="block font-medium text-ink">{r.subject}</span>
                      <span className="block text-[12.5px] text-muted">
                        {r.partner?.name ?? r.contact.name ?? r.contact.email ?? r.contact.phone ?? "Contact"} · {r.kind_label} · {r.channel_label}
                        {r.category ? ` · ${r.category.name}` : ""}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "state",
                  label: "État",
                  render: (r) => (
                    <span className="flex flex-wrap gap-1">
                      <BadgeEtat etat={r.state} />
                      <BadgePriorite priorite={r.priority} />
                      <BadgeRetard late={r.late} />
                      {r.sender_unverified && <Badge tone="danger">Non vérifié</Badge>}
                    </span>
                  ),
                },
                { key: "user", label: "Responsable", render: (r) => r.user?.name ?? r.team?.name ?? "–", sortValue: (r) => r.user?.name ?? "" },
                { key: "date_open", label: "Ouvert le", render: (r) => fmtDateTime(r.date_open), sortValue: (r) => r.date_open },
                {
                  key: "due",
                  label: "Échéance",
                  render: (r) => fmtDateTime(r.first_response ? r.resolution_due : r.first_response_due),
                  sortValue: (r) => (r.first_response ? r.resolution_due : r.first_response_due) ?? "",
                },
              ]}
            />
          )}
        </Etat>
      </Card>
    </div>
  );
}
