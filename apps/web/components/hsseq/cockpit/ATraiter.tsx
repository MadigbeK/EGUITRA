"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowUpRight } from "@/components/icons";
import { Badge, Card, FEUILLE, cx } from "@/components/ui";
import { DOCUMENT_VEHICULE, MOTIFS, Tampon, TYPE_VEHICULE, etatDepart, nomRotation, tonHsseq } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtInt, pluriel } from "@/lib/format";
import type { Cockpit, Deadline, Departure, LockReason, VehicleDocumentKind } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { liens, type Perimetre } from "./outils";

/** Lien discret d'une carte vers sa liste. */
export const LIEN = "no-print inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline";

/** Grand chiffre d'une carte du cockpit, puis sa phrase. */
export function Chiffre({ valeur, ton, children }: { valeur: number; ton?: "danger" | "warn"; children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={cx("font-display text-[34px] font-[650] leading-none tracking-[-0.03em] tabular", valeur > 0 && ton === "danger" ? "text-danger" : valeur > 0 && ton === "warn" ? "text-warn" : "text-ink")}>{fmtInt(valeur)}</span>
      <span className="text-[13.5px] font-medium text-ink-2">{children}</span>
    </p>
  );
}

/**
 * À traiter aujourd'hui : départs bloqués du jour (« À contrôler » distinct de « Bloqué »), actions en
 * retard et échéances à 30 jours, puis les événements qui attendent le Responsable HSSEQ.
 */
export function ATraiter({ c }: { c: Cockpit }) {
  const p: Perimetre = c.filters;
  const ev = c.events;
  return (
    <div className="space-y-4">
      <ul aria-label="Événements à traiter" className="grid gap-3 sm:grid-cols-3">
        <Compteur valeur={ev.to_classify} ton="warn" href={liens.evenements(p, { status: "reported" })} texte={ev.to_classify > 1 ? "événements déclarés à classer" : "événement déclaré à classer"} />
        <Compteur valeur={ev.overdue_investigations} ton="danger" href={liens.evenements(p, { overdue_investigation: 1 })} texte={ev.overdue_investigations > 1 ? "enquêtes en retard" : "enquête en retard"} />
        <Compteur valeur={ev.high_open} ton="danger" href={liens.evenements(p, { level: "high" })} texte={ev.high_open > 1 ? "événements de criticité élevée ouverts" : "événement de criticité élevée ouvert"} />
      </ul>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <DepartsDuJour c={c} />
        <ActionsEnRetard c={c} />
        <Echeances c={c} />
      </div>
    </div>
  );
}

/** Compteur d'événements : un lien vers la liste filtrée, le nombre en tête. */
function Compteur({ valeur, ton, href, texte }: { valeur: number; ton: "danger" | "warn"; href: string; texte: string }) {
  return (
    <li>
      <Link href={href} className={cx(FEUILLE, "group flex h-full items-center justify-between gap-3 px-5 py-3.5 outline-offset-2 transition-shadow hover:shadow-[var(--ombre-flottante)]")}>
        <span className="flex items-baseline gap-2.5">
          <span className={cx("font-display text-[24px] font-[650] leading-none tabular", valeur > 0 ? (ton === "danger" ? "text-danger" : "text-warn") : "text-ink")}>{fmtInt(valeur)}</span>
          <span className="text-[13px] font-medium leading-snug text-ink-2">{texte}</span>
        </span>
        <ArrowUpRight className="h-4 w-4 flex-none text-muted transition-colors group-hover:text-accent" />
      </Link>
    </li>
  );
}

/* ─── Départs du jour ─────────────────────────────────────────────────── */

/** Code d'un motif ouvert : à contrôler (saisie de terrain à faire), sous dérogation ou bloquant. */
function CodeMotif({ r }: { r: LockReason }) {
  const libelle = r.label || MOTIFS[r.code].libelle;
  const etat = r.waiver_id ? "sous dérogation" : r.pending ? "saisie de terrain à faire" : r.severity === "warn" ? "avertissement" : "bloquant";
  return (
    <span title={`${libelle} (${etat})`}>
      <Badge tone={r.waiver_id || r.pending || r.severity === "warn" ? "warn" : "danger"}>{r.code}</Badge>
      <span className="sr-only">{` : ${libelle}, ${etat}`}</span>
    </span>
  );
}

function DepartsDuJour({ c }: { c: Cockpit }) {
  const d = c.blocked_departures;
  // L'auditeur reçoit les comptes sans les lignes (noms des conducteurs) : pas de partage bloqué / à contrôler.
  const sansDetail = d.blocked > 0 && d.items.length === 0;
  const aControler = d.items.filter((x) => x.pending_checks_only).length;
  const bloques = d.blocked - aControler;
  const [tout, setTout] = useState(false);
  const montres = tout ? d.items : d.items.slice(0, 5);
  // Les départs se font dans Transport (« Départs du jour »), ouvert à l'exploitation, pas au profil HSSEQ seul.
  const { data: me } = useApi<Me>("/auth/me");
  const transport = Boolean(me?.apps.includes("transport"));
  return (
    <Card
      title="Départs du jour"
      actions={
        transport && (
          <Link href="/transport/departs" className={LIEN}>
            Départs dans Transport <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )
      }
    >
      {d.total === 0 ? (
        <p className="text-sm text-muted">Aucun départ prévu le {fmtDate(d.date)}.</p>
      ) : (
        <>
          <Chiffre valeur={bloques} ton="danger">
            {bloques > 1 ? "départs bloqués" : "départ bloqué"} sur {pluriel(d.total, "départ")} le {fmtDate(d.date)}
          </Chiffre>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Tampon mot="Bloqué" /> <span className="tabular">{fmtInt(bloques)}</span>
            </span>
            {!sansDetail && (
              <span className="inline-flex items-center gap-1.5">
                <Tampon mot="À contrôler" /> <span className="tabular">{fmtInt(aControler)}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Tampon mot="Autorisé" /> <span className="tabular">{fmtInt(d.allowed)}</span>
            </span>
          </p>
          <p className="mt-2 text-[12px] leading-snug text-muted">
            {sansDetail ? "Le détail des départs bloqués, qui nomme les conducteurs, n'est pas servi à votre profil." : "« À contrôler » : seuls le contrôle avant départ ou l'alcootest restent à saisir au terrain."}
          </p>
          {sansDetail ? null : d.items.length > 0 ? (
            <ul className="mt-4 divide-y divide-line/80 border-t border-line/80">
              {montres.map((x) => (
                <LigneDepart key={x.rotation.id} x={x} c={c} />
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-ink-2">
              <Tampon mot="Autorisé" /> Tous les départs du jour sont autorisés.
            </p>
          )}
          {d.items.length > 5 && (
            <button type="button" onClick={() => setTout(!tout)} aria-expanded={tout} className={cx(LIEN, "mt-3")}>
              {tout ? "Afficher moins" : `Afficher les ${d.items.length} départs bloqués`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function LigneDepart({ x, c }: { x: Departure; c: Cockpit }) {
  const ouverts = x.evaluation.reasons;
  // Point critique non conforme (V02) : les non-conformités bloquantes du véhicule ; sinon ses contrôles.
  const href = ouverts.some((r) => r.code === "V02") ? liens.controles(c.filters, { vue: "non-conformites", vehicule: x.vehicle.id, bloquantes: 1, type: null }) : liens.controles(c.filters, { vehicule: x.vehicle.id });
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={href} className="font-semibold text-ink hover:underline">
            {x.vehicle.name}
            <span className="font-normal text-muted"> · {TYPE_VEHICULE[x.vehicle.vehicle_kind]}</span>
          </Link>
          <p className="mt-0.5 truncate text-[12.5px] text-muted">{[x.driver?.name ?? "Conducteur à affecter", x.site?.name, nomRotation(x.rotation)].filter(Boolean).join(" · ")}</p>
        </div>
        <Tampon mot={etatDepart(x)} />
      </div>
      {ouverts.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          {ouverts.map((r) => (
            <CodeMotif key={`${r.code}-${r.since}`} r={r} />
          ))}
        </p>
      )}
    </li>
  );
}

/* ─── Actions en retard ───────────────────────────────────────────────── */

function ActionsEnRetard({ c }: { c: Cockpit }) {
  const a = c.overdue_actions;
  return (
    <Card
      title="Actions en retard"
      actions={
        <Link href={liens.actions(c.filters, { retard: 1 })} className={LIEN}>
          Toutes <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <Chiffre valeur={a.total} ton="danger">
        {a.total > 1 ? "actions correctives ou préventives en retard" : "action corrective ou préventive en retard"}
      </Chiffre>
      {a.items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Aucune action en retard : le plan d&apos;actions tient ses échéances.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line/80 border-t border-line/80">
          {a.items.map((x) => (
            <li key={x.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={liens.actions(c.filters, { retard: 1, action: x.id })} className="min-w-0 hover:underline">
                  <span className="font-mono text-[12px] text-muted">{x.reference}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[13.5px] font-medium leading-snug text-ink">{x.description}</span>
                </Link>
                <span className="flex flex-none flex-col items-end gap-1">
                  <Tampon mot="En retard" />
                  <span className="whitespace-nowrap text-[12px] font-semibold tabular text-danger">{pluriel(x.days_overdue, "jour")}</span>
                </span>
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                {x.owner.name} · échéance {fmtDate(x.due_date)}
                {x.site ? ` · ${x.site.name}` : ""}
                {x.days_overdue > 30 && <span className="font-medium text-ink-2"> · escaladée au Directeur général</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {a.total > a.items.length && <p className="mt-2 text-[12.5px] text-muted">Les {a.items.length} plus en retard sur {a.total}.</p>}
    </Card>
  );
}

/* ─── Échéances à 30 jours ────────────────────────────────────────────── */

/** Tampon d'une échéance : échue, sous 7 jours (alerte J-7), sinon le délai en clair. */
function EtatEcheance({ e }: { e: Deadline }) {
  if (e.expired || e.days_left < 0) return <Tampon mot="Échue" />;
  if (e.days_left <= 7) return <Badge tone={tonHsseq("Sous 7 jours", "warn")}>Sous 7 jours</Badge>;
  return <span className="text-[12px] text-muted">dans {pluriel(e.days_left, "jour")}</span>;
}

function Echeances({ c }: { c: Cockpit }) {
  const items = c.deadlines.items;
  const echues = items.filter((e) => e.expired || e.days_left < 0).length;
  const personnes = items.filter((e) => e.subject.type !== "vehicle").length;
  const vehicules = items.length - personnes;
  const [tout, setTout] = useState(false);
  const montres = tout ? items : items.slice(0, 6);
  return (
    <Card title={`Échéances à ${c.deadlines.horizon_days} jours`}>
      <Chiffre valeur={echues} ton="danger">
        {echues > 1 ? "échues" : "échue"} sur {pluriel(items.length, "échéance")}
      </Chiffre>
      <p className="mt-2.5 text-[12.5px] text-muted">
        {pluriel(personnes, "habilitation")} de conducteur · {pluriel(vehicules, "document")} de véhicule. Alertes à J-30 et J-7, puis motif du verrou le jour de l&apos;expiration.
      </p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Aucune échéance dans les {c.deadlines.horizon_days} jours.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line/80 border-t border-line/80">
          {montres.map((e) => (
            <li key={`${e.kind}-${e.subject.type}-${e.subject.id}-${e.label}-${e.expires_on}`} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-ink">
                  {e.subject.name}
                  <span className="font-normal text-muted"> · {e.subject.type === "vehicle" ? "véhicule" : e.subject.type === "driver" ? "conducteur" : "salarié"}</span>
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {e.kind === "vehicle_document" && e.document_kind in DOCUMENT_VEHICULE ? DOCUMENT_VEHICULE[e.document_kind as VehicleDocumentKind] : e.label}
                  {e.site ? ` · ${e.site.name}` : ""}
                </p>
              </div>
              <div className="flex flex-none flex-col items-end gap-1 text-right">
                <EtatEcheance e={e} />
                <span className="text-[12px] tabular text-ink-2">
                  {fmtDate(e.expires_on)}
                  {e.reason_code && (
                    <span className="text-muted" title={MOTIFS[e.reason_code].libelle}>
                      {" "}
                      · {e.expired ? `${e.reason_code} ouvert` : `ouvre ${e.reason_code}`}
                    </span>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 6 && (
        <button type="button" onClick={() => setTout(!tout)} aria-expanded={tout} className={cx(LIEN, "mt-3")}>
          {tout ? "Afficher moins" : `Afficher les ${items.length} échéances`}
        </button>
      )}
    </Card>
  );
}
