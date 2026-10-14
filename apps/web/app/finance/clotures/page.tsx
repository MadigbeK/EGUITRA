"use client";

import { useState } from "react";
import { CheckCircle2, Lock, LockOpen, ShieldAlert, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { MONTHS_FR, fmtDate, fmtDateTime } from "@/lib/format";

interface Check {
  code: string;
  label: string;
  status: "ok" | "warning" | "blocking";
  detail: string | null;
  count: number | null;
}
interface Month {
  id: number | null;
  period: string;
  state: "open" | "closed";
  closed_by?: string | null;
  closed_at?: string | null;
  events: Array<{ action: string; user: string; date: string; reason: string | null }>;
}

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
            {data.company} · écritures verrouillées jusqu&apos;au {data.lock_date ? fmtDate(data.lock_date) : "— (aucune clôture)"}.
          </Notice>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {data.months.map((m, i) => (
              <button key={m.period} type="button" onClick={() => setMonth(m)} className={cx("rounded-xl border bg-panel p-4 text-left transition hover:border-accent", m.state === "closed" ? "border-ok/40" : "border-line")}>
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
      {month && <MonthModal month={month} onClose={() => setMonth(null)} onChanged={() => mutate()} />}
    </div>
  );
}

const STATUS = {
  ok: { icon: CheckCircle2, tone: "text-ok", label: "Conforme" },
  warning: { icon: TriangleAlert, tone: "text-warn", label: "À examiner" },
  blocking: { icon: ShieldAlert, tone: "text-danger", label: "Bloquant" },
};

function MonthModal({ month, onClose, onChanged }: { month: Month; onClose: () => void; onChanged: () => void }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
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
        const res = await apiSend<{ checks: Check[]; can_close: boolean }>("POST", "/finance/closing/check", { period: month.period });
        setChecks(res.checks);
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
          <Button variant="danger" disabled={reason.trim().length < 10} loading={busy === "reopen"} onClick={() => run("reopen")}>
            <LockOpen className="h-4 w-4" /> Rouvrir
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {month.state === "closed" ? (
          <>
            <Notice tone="ok">Mois clôturé par {month.closed_by} le {fmtDateTime(month.closed_at)}. Les écritures sont verrouillées et chaînées.</Notice>
            <Field label="Motif de réouverture" hint="Obligatoire, conservé au registre des clôtures. Réservé à la direction et à l'administration.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        ) : (
          <p className="text-sm text-muted">La clôture vérifie les équilibres, le compte de passage, les brouillons, le rapprochement bancaire et l&apos;ordre des mois. Elle est refusée tant qu&apos;un contrôle bloquant échoue.</p>
        )}
        {checks && (
          <ul className="space-y-2">
            {checks.map((c) => {
              const s = STATUS[c.status];
              const Icon = s.icon;
              return (
                <li key={c.code} className="flex items-start gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
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
        )}
        {month.events.length > 0 && (
          <Card title="Registre">
            <ul className="space-y-1 text-xs text-ink-2">
              {month.events.map((e, i) => (
                <li key={i}>
                  {fmtDateTime(e.date)} · {e.action === "close" ? "Clôture" : "Réouverture"} par {e.user}
                  {e.reason ? ` : ${e.reason}` : ""}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Modal>
  );
}
