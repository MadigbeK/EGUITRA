"use client";

/**
 * Suivi d'un événement : actions liées (lien vers le plan d'actions), notifications envoyées (dans
 * l'application et par courriel, pas de SMS au lot 1) et journal de la fiche (§11), en clair.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "@/components/icons";
import { Card, DataTable, Notice, classesBouton } from "@/components/ui";
import { NIVEAU_MAITRISE, STATUT_ACTION, Tampon } from "@/components/hsseq/commun";
import { CHAMP_EVENEMENT, OPERATION_EVENEMENT, operationLue, valeurLue } from "@/components/hsseq/journal";
import { INSECABLE, fmtDate, fmtInt, pluriel } from "@/lib/format";
import type { ActionLine, Event as Evenement, HistoryEntry, HsseqNotification } from "@/lib/hsseq-types";
import { CANAL, fmtJourHeure } from "./commun";

/* ─── Actions liées ───────────────────────────────────────────────────── */

export function ActionsLiees({ e }: { e: Evenement }) {
  const router = useRouter();
  const ouvertes = e.actions.filter((a) => a.status !== "closed" && a.status !== "cancelled").length;
  return (
    <div className="space-y-4">
      {e.status === "actions" && ouvertes > 0 && (
        <Notice tone="neutral">{`La clôture de l'événement attend la clôture ou l'annulation de ${pluriel(ouvertes, "action ouverte", "actions ouvertes")}.`}</Notice>
      )}
      <Card
        title="Actions liées"
        padded={false}
        actions={
          // Plan d'actions : fiche ouverte par ?action=, actions d'origine événement par ?origine=event ;
          // ?evenement= (event_id du contrat) borne la liste à cet événement quand l'écran le lit.
          <Link href={`/hsseq/actions?origine=event&evenement=${e.id}`} className={classesBouton("secondary", "sm")}>
            Plan d'actions de l'événement <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <DataTable
          rows={e.actions}
          rowKey={(a) => a.id}
          onRowClick={(a) => router.push(`/hsseq/actions?action=${a.id}`)}
          empty="Aucune action rattachée à cet événement."
          columns={[
            { key: "reference", label: "Référence", render: (a) => <span className="whitespace-nowrap font-mono text-xs">{a.reference}</span> },
            {
              key: "description",
              label: "Action",
              render: (a) => (
                <span className="block min-w-[14rem] max-w-[28rem]">
                  <span className="line-clamp-2" title={a.description}>
                    {a.description}
                  </span>
                </span>
              ),
            },
            { key: "control_level", label: "Maîtrise", render: (a) => (a.control_level ? NIVEAU_MAITRISE[a.control_level] : <span className="text-muted">–</span>) },
            { key: "owner", label: "Responsable", render: (a) => a.owner.name, sortValue: (a) => a.owner.name },
            { key: "due_date", label: "Échéance", render: (a) => <EcheanceAction a={a} /> },
            { key: "status", label: "Statut", render: (a) => <Tampon mot={STATUT_ACTION[a.status]} /> },
            { key: "verification", label: "Efficacité à J+90", render: (a) => <Verification a={a} />, sortValue: (a) => a.verification_date ?? "" },
          ]}
        />
      </Card>
    </div>
  );
}

function EcheanceAction({ a }: { a: ActionLine }) {
  return (
    <span className={a.overdue ? "block whitespace-nowrap font-semibold text-danger" : "block whitespace-nowrap"}>
      {fmtDate(a.due_date)}
      {a.overdue && <span className="block text-[12px]">{`${fmtInt(a.days_overdue)}${INSECABLE}j de retard`}</span>}
    </span>
  );
}

/** Vérification d'efficacité : la ligne d'action ne porte pas son résultat (dans la fiche de l'action). */
function Verification({ a }: { a: ActionLine }) {
  if (!a.verification_required) return <span className="text-muted">Non requise</span>;
  if (a.status === "closed") return <span className="whitespace-nowrap">Vérifiée, action close</span>;
  return <span className="whitespace-nowrap">{a.verification_date ? `Le ${fmtDate(a.verification_date)}` : "À programmer"}</span>;
}

/* ─── Notifications ───────────────────────────────────────────────────── */

export function Notifications({ e }: { e: Evenement }) {
  const lignes = [...e.notifications].sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  return (
    <Card title="Notifications envoyées" padded={false}>
      <DataTable<HsseqNotification>
        rows={lignes}
        rowKey={(n) => n.id}
        empty="Aucune notification envoyée."
        columns={[
          { key: "sent_at", label: "Envoyée le", render: (n) => <span className="whitespace-nowrap">{fmtJourHeure(n.sent_at)}</span> },
          { key: "to", label: "Destinataire", render: (n) => n.to.name, sortValue: (n) => n.to.name },
          { key: "channel", label: "Canal", render: (n) => CANAL[n.channel] ?? n.channel },
          { key: "subject", label: "Objet", render: (n) => <span className="block min-w-[14rem] max-w-[32rem]">{n.subject}</span> },
          { key: "read_at", label: "Lue", render: (n) => (n.channel === "email" ? <span className="text-muted">–</span> : n.read_at ? fmtJourHeure(n.read_at) : <span className="text-muted">Non lue</span>) },
        ]}
      />
    </Card>
  );
}

/* ─── Journal ─────────────────────────────────────────────────────────── */

/** Champ modifié, ses valeurs avant et après, en clair (codes traduits, dates à la française). */
function Detail({ h }: { h: HistoryEntry }) {
  const champ = h.field;
  if (!champ) return <span className="text-muted">–</span>;
  const lire = (v: string | null) => valeurLue(CHAMP_EVENEMENT, champ, v);
  return (
    <span>
      <span className="text-muted">{CHAMP_EVENEMENT[champ]?.label ?? champ} : </span>
      {lire(h.old_value)} <span aria-hidden>→</span>
      <span className="sr-only"> devient </span> {lire(h.new_value)}
    </span>
  );
}

export function Journal({ e }: { e: Evenement }) {
  const lignes = [...e.history].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card title="Journal" padded={false}>
      <DataTable<HistoryEntry>
        rows={lignes}
        rowKey={(h) => h.id}
        empty="Aucune entrée au journal."
        columns={[
          { key: "at", label: "Date", render: (h) => <span className="whitespace-nowrap">{fmtJourHeure(h.at)}</span> },
          { key: "by", label: "Par", render: (h) => h.by?.name ?? "Système", sortValue: (h) => h.by?.name ?? "" },
          { key: "action", label: "Opération", render: (h) => operationLue(h, OPERATION_EVENEMENT), sortValue: (h) => OPERATION_EVENEMENT[h.action] ?? h.action },
          { key: "field", label: "Détail", render: (h) => <Detail h={h} /> },
        ]}
      />
      <p className="px-6 py-3 text-[12px] text-muted">Créations, modifications, transitions et lectures sensibles, avec l'auteur et les valeurs avant et après.</p>
    </Card>
  );
}
