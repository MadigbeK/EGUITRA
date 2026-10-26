"use client";

import { useState } from "react";
import { CheckCircle2, Download, Lock, LockOpen, ShieldAlert, TriangleAlert } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Modal, Notice, PageHeader, Select, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { ClotureExercice } from "@/components/finance/ClotureExercice";
import { apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { anneeEnCours } from "@/lib/jour";
import { MONTHS_FR, fmtDate, fmtDateTime, fmtDec, fmtGNF, fmtInt, pluriel } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes d'écriture (addons/eguitra_finance/controllers/closing.py et reprise.py) : la clôture
// est faite par la finance (FIN_WRITE), la réouverture motivée par la direction ou l'administration, le
// chargement des valeurs de référence de la reprise par l'administration seule. Les contrôles, le PV et
// l'annexe se lisent avec les profils de la finance (FIN_READ, direction comprise).
const CLOTURE: Profile[] = ["admin", "finance"];
const REOUVERTURE: Profile[] = ["admin", "direction"];
const REFERENCES: Profile[] = ["admin"];

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
  fx_provision: "Provision pour perte de change",
  fx_provision_reversal: "Reprise de la provision pour perte de change",
  ecl: "Pertes de crédit attendues",
};

/**
 * Mois d'une période « AAAA-MM-JJ » en toutes lettres (« septembre 2026 »), lu sur la chaîne elle-même :
 * `new Date("2026-09-01")` est minuit UTC, que le navigateur d'un poste à l'ouest de Greenwich lit encore
 * en août.
 */
function mois(period: string): string {
  return new Date(`${period.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Abréviation du mois d'une période (« sept. »), lue sur la chaîne. */
const abrege = (period: string) => MONTHS_FR[Number(period.slice(5, 7)) - 1] ?? period;

export default function ClosingPage() {
  const year = anneeEnCours();
  const [selectedYear, setYear] = useState(year);
  const { data, error, mutate } = useApi<{ company: string; year: number; lock_date: string | null; months: Month[] }>(`/finance/closing?year=${selectedYear}`);
  const [month, setMonth] = useState<Month | null>(null);

  return (
    <div>
      <PageHeader
        title="Clôtures et contrôles"
        subtitle="Contrôles bloquants avant clôture, verrouillage et chaînage des écritures, réouverture motivée."
        actions={
          <Select aria-label="Exercice" value={String(selectedYear)} onChange={(e) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map((y) => ({ value: y, label: `Exercice ${y}` }))} />
        }
      />
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement du registre des clôtures…">
        {(d) => (
          <>
            <Notice tone="accent">
              {d.company} : {d.lock_date ? `écritures verrouillées jusqu'au ${fmtDate(d.lock_date)}` : "aucune période clôturée pour l'instant"}.
            </Notice>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              {d.months.map((m) => (
                <button key={m.period} type="button" onClick={() => setMonth(m)} className={cx("rounded-xl p-4 text-left transition-shadow hover:ring-1 hover:ring-inset hover:ring-line-strong/60", m.state === "closed" ? "bg-ok/[0.08]" : "bg-panel")}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold capitalize">{abrege(m.period)}</span>
                    {m.state === "closed" ? <Lock className="h-4 w-4 text-ok" /> : <LockOpen className="h-4 w-4 text-muted" />}
                  </div>
                  <div className="mt-2 text-xs text-muted">{m.state === "closed" ? `Clôturé le ${fmtDateTime(m.closed_at)}` : "Ouvert"}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </Etat>
      <ClotureExercice year={selectedYear} />
      <Integrity />
      <RepriseValidation />
      {month && <MonthModal key={month.period} month={month} onClose={() => setMonth(null)} onChanged={() => mutate()} />}
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
  const { data, error, mutate } = useApi<{ period: string; checks: Check[]; hash_chains: Chain[] | null; seals?: SealCheck[] }>("/finance/integrity");
  return (
    <div className="mt-6">
      <Card title="Contrôles d'intégrité">
        <Etat data={data} error={error} onRetry={() => mutate()} label="Contrôles et recalcul des empreintes…">
          {(d) => (
            <div className="space-y-4">
              <p className="text-sm text-muted">Contrôles permanents du mois écoulé ({mois(d.period)}), puis recalcul de l&apos;empreinte de chaque écriture verrouillée : une écriture modifiée hors de la plateforme serait signalée.</p>
              <CheckList checks={d.checks} />
              {d.hash_chains === null ? (
                <Notice tone="accent">La vérification des empreintes est réservée aux profils de la finance.</Notice>
              ) : d.hash_chains.length === 0 ? (
                <Notice tone="accent">Aucune écriture encore chaînée : la première clôture mensuelle verrouille et chaîne les écritures du mois.</Notice>
              ) : (
                <DataTable dense rows={d.hash_chains} rowKey={(c) => c.journal} columns={[
                  { key: "journal", label: "Journal", render: (c) => c.journal },
                  { key: "status", label: "Écritures", render: (c) => <Badge tone={CHAIN[c.status]?.tone ?? "neutral"}>{CHAIN[c.status]?.label ?? c.status}</Badge> },
                  { key: "first", label: "Première pièce", render: (c) => c.first ?? "–" },
                  { key: "last", label: "Dernière pièce", render: (c) => (c.last ? `${c.last}${c.last_date ? ` du ${fmtDate(c.last_date)}` : ""}` : "–") },
                  { key: "message", label: "", render: (c) => (c.status === "corrupted" ? <span className="text-danger">{c.message}</span> : null) },
                ]} />
              )}
              {d.seals && d.seals.length > 0 && (
                <DataTable dense rows={d.seals} rowKey={(s) => s.period} columns={[
                  { key: "period", label: "Mois clôturé", render: (s) => mois(s.period) },
                  { key: "status", label: "Sceau recalculé", render: (s) => <Badge tone={s.status === "ok" ? "ok" : "danger"}>{s.status === "ok" ? "Identique au PV" : "Altération"}</Badge> },
                  { key: "seal", label: "Sceau du PV", render: (s) => <span className="font-mono text-[11px]">{s.seal ? `${s.seal.slice(0, 16)}…` : "–"}</span> },
                  { key: "differences", label: "", render: (s) => (s.status === "altered" ? <span className="text-danger">{(s.differences ?? []).join(" ; ")}</span> : null) },
                ]} />
              )}
            </div>
          )}
        </Etat>
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
  const cloture = useAutorise(CLOTURE);
  const reouverture = useAutorise(REOUVERTURE);
  const envoi = useEnvoi();
  const label = mois(month.period);

  async function controler() {
    await envoi.run("check", async () => {
      const res = await apiSend<{ checks: Check[]; can_close: boolean; generations: Generation[] }>("POST", "/finance/closing/check", { period: month.period });
      setChecks(res.checks);
      setGenerations(res.generations ?? []);
      setCanClose(res.can_close);
    }, undefined, "Contrôles impossibles.");
  }
  async function cloturer() {
    const oui = await demanderConfirmation(
      `Clôturer ${label} ? Les dotations du mois, la liquidation de la TVA et les factures à établir sont comptabilisées, puis les écritures du mois sont verrouillées, chaînées et scellées. Seules la direction et l'administration peuvent rouvrir un mois clôturé, avec un motif.`,
      { action: "Clôturer le mois", danger: true },
    );
    if (!oui) return;
    const ok = await envoi.run("close", () => apiSend("POST", "/finance/closing/close", { period: month.period }), undefined, "Clôture impossible.");
    if (ok) {
      onChanged();
      onClose();
    }
  }
  async function rouvrir() {
    const oui = await demanderConfirmation(
      `Rouvrir ${label} ? Les écritures du mois redeviennent modifiables jusqu'à la prochaine clôture ; la réouverture et son motif sont inscrits au registre des clôtures.`,
      { action: "Rouvrir le mois", danger: true },
    );
    if (!oui) return;
    const ok = await envoi.run("reopen", () => apiSend("POST", "/finance/closing/reopen", { period: month.period, reason: reason.trim() }), undefined, "Réouverture impossible.");
    if (ok) {
      onChanged();
      onClose();
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
            <Button loading={envoi.busy === "check"} disabled={!!envoi.busy} onClick={controler}>
              Lancer les contrôles
            </Button>
            {cloture && (
              <Button variant="primary" disabled={!canClose || !!envoi.busy} loading={envoi.busy === "close"} onClick={cloturer}>
                <Lock className="h-4 w-4" /> Clôturer le mois
              </Button>
            )}
          </>
        ) : (
          <>
            {month.seal && (
              <Button loading={envoi.busy === "pv"} disabled={!!envoi.busy} onClick={() => envoi.telecharger("pv", `/finance/closing/pv?period=${month.period}`, `PV-cloture-${month.period.slice(0, 7)}.pdf`)}>
                <Download className="h-4 w-4" /> PV de clôture
              </Button>
            )}
            {reouverture && (
              <Button variant="danger" disabled={reason.trim().length < 10 || !!envoi.busy} loading={envoi.busy === "reopen"} onClick={rouvrir}>
                <LockOpen className="h-4 w-4" /> Rouvrir
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-4">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
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
                <dd className="text-right font-mono">{fmtInt(month.snapshot.lines_locked)}</dd>
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
            {reouverture ? (
              <Field label="Motif de réouverture" hint="Obligatoire (dix caractères au moins), conservé au registre des clôtures.">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            ) : (
              <p className="text-[12.5px] text-muted">La réouverture d&apos;un mois clôturé est réservée à la direction et à l&apos;administration, avec un motif inscrit au registre.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            La clôture vérifie les équilibres, le compte de passage, les brouillons, le rapprochement bancaire et l&apos;ordre des mois ; elle est refusée tant qu&apos;un contrôle bloquant échoue.
            Elle comptabilise ensuite les dotations du mois, liquide la TVA (pièce datée du dernier jour du mois), passe les factures à établir (extournées le 1er du mois suivant),
            puis verrouille, chaîne et scelle la période ; le PV de clôture porte le sceau.{!cloture && " La clôture elle-même est faite par la finance ; les contrôles se lancent d'ici."}
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

interface RepriseRow { code: string; label: string; unit: "gnf" | "count"; expected: number; actual: number | null; gap: number | null; tolerance: number; ok: boolean }
interface Reprise { loaded: boolean; date_from?: string; date_to?: string; source?: string | null; computed_at?: string; rows: RepriseRow[]; conform: number; total: number }

/** Validation de la reprise : valeurs du classeur de référence face aux valeurs recalculées par la
 * plateforme (offre, chapitre 6.3), à annexer au procès-verbal de bascule. */
function RepriseValidation() {
  const { data, error, mutate } = useApi<Reprise>("/finance/reprise/validation");
  const references = useAutorise(REFERENCES);
  const envoi = useEnvoi();
  // Valeur non recalculée (donnée absente) : « – », comme partout ailleurs.
  const fmt = (r: RepriseRow, v: number | null) => (v === null ? "–" : r.unit === "gnf" ? fmtGNF(v) : fmtDec(v));
  async function charger(file: File) {
    const form = new FormData();
    form.append("file", file);
    await envoi.run("references", async () => {
      await apiUpload("/finance/reprise/references", form);
      await mutate();
    }, "Valeurs de référence chargées.", "Chargement impossible.");
  }
  return (
    <Card
      className="mt-6"
      title={data?.loaded ? `Validation de la reprise : ${pluriel(data.conform, "indicateur conforme", "indicateurs conformes")} sur ${fmtInt(data.total)}` : "Validation de la reprise"}
      padded={false}
      actions={
        <div className="flex flex-wrap gap-2">
          {data?.loaded && (
            <Button loading={envoi.busy === "annexe"} disabled={!!envoi.busy} onClick={() => envoi.telecharger("annexe", "/finance/reprise/validation.xlsx", "validation_reprise.xlsx")}>
              <Download className="h-4 w-4" /> Annexe du PV
            </Button>
          )}
          {references && (envoi.busy === "references" ? (
            <Button size="sm" loading>Chargement des valeurs</Button>
          ) : (
            <FileButton small label="Valeurs de référence (.json)" accept=".json" onFile={(file) => void charger(file)} />
          ))}
        </div>
      }
    >
      <div className="px-4 py-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <Etat data={data} error={error} onRetry={() => mutate()} label="Recalcul des valeurs de la reprise…">
          {(d) => (!d.loaded ? (
            <p className="text-sm text-muted">
              Après la reprise, {references ? "chargez" : "l'administration charge"} le fichier des valeurs du classeur de référence (scripts/reprise, extraire_reference.py) : la plateforme les recalcule et signale chaque écart au-delà de la tolérance.
            </p>
          ) : (
            <p className="text-[12.5px] text-muted">Du {fmtDate(d.date_from)} au {fmtDate(d.date_to)}{d.source ? `, source : ${d.source}` : ""} ; définitions du classeur (produits = classe 7, charges d&apos;exploitation = classe 6 hors 67 et 68, capitaux propres = 101 + 106 + 110 + résultat), distinctes des rubriques SYSCOHADA.</p>
          ))}
        </Etat>
      </div>
      {data?.loaded && (
        <DataTable dense rows={data.rows} rowKey={(r) => r.code} columns={[
          { key: "label", label: "Indicateur" },
          { key: "expected", label: "Attendu", align: "right", render: (r) => fmt(r, r.expected) },
          { key: "actual", label: "Recalculé", align: "right", render: (r) => fmt(r, r.actual) },
          { key: "gap", label: "Écart", align: "right", render: (r) => (r.gap === null ? "–" : <span className={r.ok ? "" : "font-semibold text-danger"}>{fmt(r, r.gap)}</span>) },
          { key: "ok", label: "", render: (r) => (r.ok ? <Badge tone="ok">Conforme</Badge> : <Badge tone="danger">Écart</Badge>) },
        ]} />
      )}
    </Card>
  );
}
