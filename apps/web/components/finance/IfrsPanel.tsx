"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, demanderConfirmation } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtGNF, fmtInt, fmtShort } from "@/lib/format";

interface Bridge {
  lines: Array<{ label: string; section: string; amount: number; syscohada: string[] }>;
  restatements: Array<{ standard: string; label: string; amount: number; quantified: boolean; note: string }>;
  net_result_syscohada: number;
  total_restatements: number;
  net_result_ifrs: number;
  note: string;
}
interface Ecl {
  buckets: Array<{ bucket: string; label: string; rate: number; exposure: number; ecl: number; count: number }>;
  partners: Array<{ partner_id: number | null; partner: string; vat: string | null; exposure: number; overdue: number; ecl: number; worst: string }>;
  exposure: number;
  ecl: number;
  existing_impairment: number;
  adjustment: number;
  posted: boolean;
}
type Policy = Record<"not_due" | "1_30" | "31_60" | "61_90" | "over_90" | "deferred_tax_rate", number>;

const BUCKET_LABEL: Record<string, string> = { not_due: "Non échu", "1_30": "1 à 30 j", "31_60": "31 à 60 j", "61_90": "61 à 90 j", over_90: "Plus de 90 j" };
const SECTION: Record<string, string> = { actif: "Bilan, actif", passif: "Bilan, passif", resultat: "Résultat" };

/** Passerelle IFRS : postes regroupés, retraitements chiffrés, pertes de crédit attendues (IFRS 9). */
export function IfrsPanel({ scope }: { scope: string }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useApi<Bridge>(`/finance/ifrs?date=${date}&scope=${scope}`);
  return (
    <div className="space-y-6">
      <Field label="Arrêté au" className="no-print max-w-xs">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi label="Résultat net SYSCOHADA" value={fmtShort(data.net_result_syscohada)} />
            <Kpi label="Retraitements chiffrés" value={fmtShort(data.total_restatements)} tone={data.total_restatements < 0 ? "warn" : "neutral"} />
            <Kpi label="Résultat net IFRS" value={fmtShort(data.net_result_ifrs)} tone="accent" />
          </div>
          <Card title="Retraitements" padded={false}>
            <DataTable
              dense
              rows={data.restatements}
              rowKey={(r) => r.standard}
              columns={[
                { key: "standard", label: "Norme" },
                { key: "label", label: "Retraitement" },
                { key: "amount", label: "Impact sur le résultat", align: "right", render: (r) => (r.quantified ? fmtGNF(r.amount) : <Badge tone="neutral">Non chiffré</Badge>) },
                { key: "note", label: "Lecture", render: (r) => <span className="text-xs text-muted">{r.note}</span> },
              ]}
            />
          </Card>
          <EclCard date={date} />
          <Notice tone="warn">{data.note}</Notice>
          <Card title="Postes IFRS" padded={false}>
            <DataTable
              dense
              rows={data.lines}
              rowKey={(l) => l.label}
              columns={[
                { key: "section", label: "État", render: (l) => SECTION[l.section] ?? l.section },
                { key: "label", label: "Poste IFRS" },
                { key: "syscohada", label: "Rubriques SYSCOHADA", render: (l) => l.syscohada.join(", ") },
                { key: "amount", label: "Montant", align: "right", render: (l) => fmtInt(l.amount) },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function EclCard({ date }: { date: string }) {
  const { data, error, mutate } = useApi<Ecl>(`/finance/ifrs/ecl?date=${date}`);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function post() {
    if (!(await demanderConfirmation("Comptabiliser l'ajustement de dépréciation du mois (pièce ECL) ? Par défaut, la perte attendue reste un retraitement hors des livres.", { action: "Comptabiliser" }))) return;
    setMessage(null);
    try {
      const move = await apiSend<{ name: string; ref: string; amount: number }>("POST", "/finance/ifrs/ecl/post", { date });
      setMessage({ tone: "ok", text: `Pièce ${move.name} (${move.ref}) comptabilisée : ${fmtGNF(move.amount)}.` });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Comptabilisation impossible." });
    }
  }
  return (
    <Card
      title="Pertes de crédit attendues (IFRS 9)"
      padded={false}
      actions={
        <div className="no-print flex gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>Matrice</Button>
          {data && !data.posted && data.adjustment !== 0 && <Button size="sm" onClick={post}>Comptabiliser l&apos;ajustement</Button>}
        </div>
      }
    >
      {error && <div className="p-3"><ErrorBox error={error} /></div>}
      {message && <div className="p-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {data && (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Kpi label="Créances exposées" value={fmtShort(data.exposure)} />
            <Kpi label="Perte attendue" value={fmtShort(data.ecl)} />
            <Kpi label="Dépréciation déjà passée (491)" value={fmtShort(data.existing_impairment)} />
            <Kpi label={data.posted ? "Ajustement comptabilisé" : "Ajustement à retraiter"} value={fmtShort(data.adjustment)} tone={data.adjustment > 0 ? "warn" : "ok"} />
          </div>
          <DataTable dense rows={data.buckets} rowKey={(b) => b.bucket} columns={[
            { key: "label", label: "Ancienneté" },
            { key: "rate", label: "Taux", align: "right", render: (b) => `${b.rate} %` },
            { key: "count", label: "Factures", align: "right" },
            { key: "exposure", label: "Encours", align: "right", render: (b) => fmtGNF(b.exposure) },
            { key: "ecl", label: "Perte attendue", align: "right", render: (b) => fmtGNF(b.ecl) },
          ]} />
          <DataTable dense rows={data.partners.slice(0, 20)} rowKey={(p) => p.partner_id ?? 0} empty="Aucune créance ouverte." columns={[
            { key: "partner", label: "Client" },
            { key: "exposure", label: "Encours", align: "right", render: (p) => fmtGNF(p.exposure) },
            { key: "overdue", label: "Dont échu", align: "right", render: (p) => fmtGNF(p.overdue) },
            { key: "worst", label: "Retard le plus ancien", render: (p) => BUCKET_LABEL[p.worst] ?? p.worst },
            { key: "ecl", label: "Perte attendue", align: "right", render: (p) => fmtGNF(p.ecl) },
          ]} />
        </div>
      )}
      {editing && <PolicyForm onClose={() => setEditing(false)} onDone={() => { setEditing(false); void mutate(); }} />}
    </Card>
  );
}

function PolicyForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data } = useApi<Policy>("/finance/ifrs/policy");
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const value = (key: keyof Policy) => f[key] ?? (data ? String(data[key]) : "");
  async function submit() {
    setError(null);
    try {
      const payload = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v.replace(",", "."))]));
      await apiSend("PATCH", "/finance/ifrs/policy", payload);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <Modal open title="Matrice des pertes attendues" onClose={onClose} footer={<Button variant="primary" onClick={submit}>Enregistrer</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Notice tone="accent">Taux appliqués à l&apos;encours de chaque facture selon son ancienneté ; à arrêter avec l&apos;expert-comptable.</Notice>
        <div className="grid grid-cols-2 gap-3">
          {(["not_due", "1_30", "31_60", "61_90", "over_90"] as const).map((key) => (
            <Field key={key} label={`${BUCKET_LABEL[key]} (%)`}>
              <Input inputMode="decimal" value={value(key)} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
            </Field>
          ))}
          <Field label="Taux d'impôt différé (%)" hint="IAS 12 ; 0 : non chiffré">
            <Input inputMode="decimal" value={value("deferred_tax_rate")} onChange={(e) => setF({ ...f, deferred_tax_rate: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
