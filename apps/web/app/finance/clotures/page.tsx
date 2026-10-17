"use client";

import { useState } from "react";
import { CheckCircle2, Download, Lock, LockOpen, ShieldAlert, TriangleAlert } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { ApiError, apiDownload, apiSend, useApi } from "@/lib/api-client";
import { MONTHS_FR, fmtDate, fmtDateTime, fmtGNF } from "@/lib/format";

interface Check {
  code: string;
  label: string;
  status: "ok" | "warning" | "blocking";
  detail: string | null;
  count: number | null;
}
interface Chain {
  journal: string;
  status: "verified" | "corrupted" | "no_data";
  message: string | null;
  first: string | null;
  last: string | null;
  last_date: string | null;
}
interface Generation { kind: string; label: string; amount: number; detail: string }
interface Snapshot {
  revenue_month: number;
  net_result_month: number;
  net_result_ytd: number;
  cash: number;
  total_assets: number;
  total_liabilities: number;
  lines_locked: number;
  depreciations: number;
}
interface Month {
  id: number | null;
  period: string;
  state: "open" | "closed";
  closed_by?: string | null;
  closed_at?: string | null;
  seal?: string | null;
  snapshot?: Snapshot | null;
  generated?: Array<{ id: number; name: string; ref: string | null; date: string; kind: string; amount: number }>;
  events: Array<{ action: string; user: string; date: string; reason: string | null; seal?: string | null }>;
}
interface SealCheck { period: string; status: "ok" | "altered" | "none"; seal: string | null; differences?: string[] }
const KINDS: Record<string, string> = {
  vat: "Liquidation de la TVA",
  accrual: "Factures à établir",
  accrual_reversal: "Extourne des factures à établir",
  fx: "Écarts de conversion",
  fx_reversal: "Extourne des écarts de conversion",
  fx_bank: "Réévaluation des devises",
  ecl: "Pertes de crédit attendues",
};

export default function ClosingPage() {
  const year = new Date().getFullYear();
  const [selectedYear, setYear] = useState(year);
  const { data, error, mutate } = useApi<{ company: string; year: number; lock_date: string | null; months: Month[] }>(`/finance/closing?year=${selectedYear}`);
  const [month, setMonth] = useState<Month | null>(null);

  return (
    <div>
      <PageHeader
        title="Clôtures et contrôles"
        subtitle="Contrôles bloquants avant clôture, verrouillage et chaînage des écritures, réouverture motivée."
        actions={
          <Select value={String(selectedYear)} onChange={(e) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map((y) => ({ value: y, label: `Exercice ${y}` }))} />
        }
      />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <Notice tone="accent">
            {data.company} : {data.lock_date ? `écritures verrouillées jusqu'au ${fmtDate(data.lock_date)}` : "aucune période clôturée pour l'instant"}.
          </Notice>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {data.months.map((m, i) => (
              <button key={m.period} type="button" onClick={() => setMonth(m)} className={cx("rounded-xl p-4 text-left transition-shadow hover:ring-1 hover:ring-inset hover:ring-line-strong/60", m.state === "closed" ? "bg-ok/[0.08]" : "bg-panel")}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold capitalize">{MONTHS_FR[i]}</span>
                  {m.state === "closed" ? <Lock className="h-4 w-4 text-ok" /> : <LockOpen className="h-4 w-4 text-muted" />}
                </div>
                <div className="mt-2 text-xs text-muted">{m.state === "closed" ? `Clôturé le ${fmtDateTime(m.closed_at)}` : "Ouvert"}</div>
              </button>
            ))}
          </div>
        </>
      )}
      <Integrity />
      {month && <MonthModal month={month} onClose={() => setMonth(null)} onChanged={() => mutate()} />}
    </div>
  );
}

const CHAIN = {
  verified: { tone: "ok" as const, label: "Intactes" },
  corrupted: { tone: "danger" as const, label: "Altération" },
  no_data: { tone: "neutral" as const, label: "Aucune" },
};

/** Contrôles permanents du mois écoulé et vérification des empreintes des écritures verrouillées. */
function Integrity() {
  const { data, error } = useApi<{ period: string; checks: Check[]; hash_chains: Chain[] | null; seals?: SealCheck[] }>("/finance/integrity");
  const label = data ? new Date(data.period).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "";
  return (
    <div className="mt-6">
      <Card title="Contrôles d'intégrité">
        {error && <ErrorBox error={error} />}
        {!data && !error && <Loading />}
        {data && (
          <div className="space-y-4">
            <p className="text-sm text-muted">Contrôles permanents du mois écoulé ({label}), puis recalcul de l&apos;empreinte de chaque écriture verrouillée : une écriture modifiée hors de la plateforme serait signalée.</p>
            <CheckList checks={data.checks} />
            {data.hash_chains === null ? (
              <Notice tone="accent">La vérification des empreintes est réservée aux profils de la finance.</Notice>
            ) : data.hash_chains.length === 0 ? (
              <Notice tone="accent">Aucune écriture encore chaînée : la première clôture mensuelle verrouille et chaîne les écritures du mois.</Notice>
            ) : (
              <DataTable dense rows={data.hash_chains} rowKey={(c) => c.journal} columns={[
                { key: "journal", label: "Journal", render: (c) => c.journal },
                { key: "status", label: "Écritures", render: (c) => <Badge tone={CHAIN[c.status]?.tone ?? "neutral"}>{CHAIN[c.status]?.label ?? c.status}</Badge> },
                { key: "first", label: "Première pièce", render: (c) => c.first ?? "–" },
                { key: "last", label: "Dernière pièce", render: (c) => (c.last ? `${c.last}${c.last_date ? ` (${c.last_date})` : ""}` : "–") },
                { key: "message", label: "", render: (c) => (c.status === "corrupted" ? <span className="text-danger">{c.message}</span> : null) },
              ]} />
            )}
            {data.seals && data.seals.length > 0 && (
              <DataTable dense rows={data.seals} rowKey={(s) => s.period} columns={[
                { key: "period", label: "Mois clôturé", render: (s) => new Date(s.period).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) },
                { key: "status", label: "Sceau recalculé", render: (s) => <Badge tone={s.status === "ok" ? "ok" : "danger"}>{s.status === "ok" ? "Identique au PV" : "Altération"}</Badge> },
                { key: "seal", label: "Sceau du PV", render: (s) => <span className="font-mono text-[11px]">{s.seal?.slice(0, 16)}…</span> },
                { key: "differences", label: "", render: (s) => (s.status === "altered" ? <span className="text-danger">{(s.differences ?? []).join(" ; ")}</span> : null) },
              ]} />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-2">
      {checks.map((c) => {
        const s = STATUS[c.status];
        const Icon = s.icon;
        return (
          <li key={c.code} className="flex items-start gap-3 rounded-lg bg-panel-2 px-3 py-2">
            <Icon className={cx("mt-0.5 h-4 w-4 flex-none", s.tone)} />
            <div className="flex-1">
              <div className="text-sm text-ink">{c.label}</div>
              {c.detail && <div className="text-xs text-muted">{c.detail}</div>}
            </div>
            <Badge tone={c.status === "ok" ? "ok" : c.status === "warning" ? "warn" : "danger"}>{s.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS = {
  ok: { icon: CheckCircle2, tone: "text-ok", label: "Conforme" },
  warning: { icon: TriangleAlert, tone: "text-warn", label: "À examiner" },
  blocking: { icon: ShieldAlert, tone: "text-danger", label: "Bloquant" },
};

function MonthModal({ month, onClose, onChanged }: { month: Month; onClose: () => void; onChanged: () => void }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [canClose, setCanClose] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const label = new Date(month.period).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  async function run(action: "check" | "close" | "reopen") {
    setBusy(action);
    setError(null);
    try {
      if (action === "check") {
        const res = await apiSend<{ checks: Check[]; can_close: boolean; generations: Generation[] }>("POST", "/finance/closing/check", { period: month.period });
        setChecks(res.checks);
        setGenerations(res.generations ?? []);
        setCanClose(res.can_close);
      } else if (action === "close") {
        await apiSend("POST", "/finance/closing/close", { period: month.period });
        onChanged();
        onClose();
      } else {
        await apiSend("POST", "/finance/closing/reopen", { period: month.period, reason });
        onChanged();
        onClose();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      wide
      title={`Clôture de ${label}`}
      onClose={onClose}
      footer={
        month.state === "open" ? (
          <>
            <Button loading={busy === "check"} onClick={() => run("check")}>
              Lancer les contrôles
            </Button>
            <Button variant="primary" disabled={!canClose} loading={busy === "close"} onClick={() => run("close")}>
              <Lock className="h-4 w-4" /> Clôturer le mois
            </Button>
          </>
        ) : (
          <>
            {month.seal && (
              <Button onClick={() => apiDownload(`/finance/closing/pv?period=${month.period}`, `PV-cloture-${month.period.slice(0, 7)}.pdf`)}>
                <Download className="h-4 w-4" /> PV de clôture
              </Button>
            )}
            <Button variant="danger" disabled={reason.trim().length < 10} loading={busy === "reopen"} onClick={() => run("reopen")}>
              <LockOpen className="h-4 w-4" /> Rouvrir
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {month.state === "closed" ? (
          <>
            <Notice tone="ok">Mois clôturé par {month.closed_by} le {fmtDateTime(month.closed_at)}. Les écritures sont verrouillées et chaînées.</Notice>
            {month.seal && (
              <Field label="Sceau de la période (SHA-256)" hint="Imprimé sur le PV de clôture, à conserver hors du système ; recalculé dans les contrôles d'intégrité.">
                <div className="break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-xs">{month.seal}</div>
              </Field>
            )}
            {month.snapshot && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                <dt className="text-muted">Chiffre d&apos;affaires du mois</dt>
                <dd className="text-right font-mono">{fmtGNF(month.snapshot.revenue_month)}</dd>
                <dt className="text-muted">Résultat net cumulé</dt>
                <dd className="text-right font-mono">{fmtGNF(month.snapshot.net_result_ytd)}</dd>
                <dt className="text-muted">Trésorerie</dt>
                <dd className="text-right font-mono">{fmtGNF(month.snapshot.cash)}</dd>
                <dt className="text-muted">Total de l&apos;actif</dt>
                <dd className="text-right font-mono">{fmtGNF(month.snapshot.total_assets)}</dd>
                <dt className="text-muted">Dotations du mois</dt>
                <dd className="text-right font-mono">{fmtGNF(month.snapshot.depreciations)}</dd>
                <dt className="text-muted">Lignes verrouillées</dt>
                <dd className="text-right font-mono">{month.snapshot.lines_locked}</dd>
              </dl>
            )}
            {month.generated && month.generated.length > 0 && (
              <Card title="Écritures passées par la clôture" padded={false}>
                <DataTable dense rows={month.generated} rowKey={(g) => g.id} columns={[
                  { key: "kind", label: "Nature", render: (g) => KINDS[g.kind] ?? g.kind },
                  { key: "name", label: "Pièce" },
                  { key: "ref", label: "Référence", render: (g) => g.ref ?? "–" },
                  { key: "date", label: "Date", render: (g) => fmtDate(g.date) },
                  { key: "amount", label: "Montant", align: "right", render: (g) => fmtGNF(g.amount) },
                ]} />
              </Card>
            )}
            <Field label="Motif de réouverture" hint="Obligatoire, conservé au registre des clôtures. Réservé à la direction et à l'administration.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        ) : (
          <p className="text-sm text-muted">
            La clôture vérifie les équilibres, le compte de passage, les brouillons, le rapprochement bancaire et l&apos;ordre des mois ; elle est refusée tant qu&apos;un contrôle bloquant échoue.
            Elle comptabilise ensuite les dotations du mois, liquide la TVA (pièce datée du dernier jour du mois), passe les factures à établir (extournées le 1er du mois suivant),
            puis verrouille, chaîne et scelle la période ; le PV de clôture porte le sceau.
          </p>
        )}
        {checks && <CheckList checks={checks} />}
        {generations.length > 0 && (
          <Card title="Écritures que passera la clôture" padded={false}>
            <DataTable dense rows={generations} rowKey={(g) => g.kind} columns={[
              { key: "label", label: "Génération" },
              { key: "detail", label: "Détail" },
              { key: "amount", label: "Montant", align: "right", render: (g) => fmtGNF(g.amount) },
            ]} />
          </Card>
        )}
        {month.events.length > 0 && (
          <Card title="Registre">
            <ul className="space-y-1 text-xs text-ink-2">
              {month.events.map((e, i) => (
                <li key={i}>
                  {fmtDateTime(e.date)}, {e.action === "close" ? "Clôture" : "Réouverture"} par {e.user}
                  {e.reason ? ` : ${e.reason}` : ""}
                  {e.seal ? <span className="font-mono"> (sceau {e.seal.slice(0, 12)}…)</span> : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Modal>
  );
}
