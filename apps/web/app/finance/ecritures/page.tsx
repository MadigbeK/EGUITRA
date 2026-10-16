"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Modal, Notice, PageHeader, Select } from "@/components/ui";
import { MoveDetailModal } from "@/components/finance/MoveDetailModal";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { MOVE_STATES, type Account, type Journal, type MoveSummary, type Paged } from "@/lib/finance-types";
import { fmtDate, fmtGNF } from "@/lib/format";

interface Line { account_id: string; name: string; debit: string; credit: string }
const emptyLine = (): Line => ({ account_id: "", name: "", debit: "", credit: "" });
const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;

/** Modèles d'OD guidées : comptes proposés selon la nature de l'opération. */
const TEMPLATES: Record<string, { label: string; lines: Array<{ prefix: string; side: "debit" | "credit"; name: string }> }> = {
  libre: { label: "Saisie libre", lines: [] },
  provision: { label: "Dotation aux provisions", lines: [{ prefix: "691", side: "debit", name: "Dotation aux provisions" }, { prefix: "49", side: "credit", name: "Provision pour dépréciation" }] },
  charge_avance: { label: "Charge constatée d'avance", lines: [{ prefix: "476", side: "debit", name: "Charge constatée d'avance" }, { prefix: "6", side: "credit", name: "Extourne de la charge" }] },
  produit_a_recevoir: { label: "Produit à recevoir", lines: [{ prefix: "4181", side: "debit", name: "Produit à recevoir" }, { prefix: "70", side: "credit", name: "Produit de la période" }] },
  salaire: { label: "Salaires du mois", lines: [{ prefix: "661", side: "debit", name: "Rémunérations du personnel" }, { prefix: "422", side: "credit", name: "Personnel, rémunérations dues" }] },
};

export default function EntriesPage() {
  const { data, mutate } = useApi<Paged<MoveSummary>>("/finance/moves?type=entry&limit=100");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div>
      <PageHeader
        title="Journaux et opérations diverses"
        subtitle="Écritures d'OD guidées, toujours équilibrées. Les virements internes se saisissent dans Trésorerie."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nouvelle OD
          </Button>
        }
      />
      <Card padded={false}>
        {!data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data.items}
            rowKey={(m) => m.id}
            onRowClick={(m) => setSelected(m.id)}
            empty="Aucune opération diverse."
            columns={[
              { key: "name", label: "Pièce", render: (m) => <span className="font-mono text-xs">{m.name ?? "Brouillon"}</span> },
              { key: "date", label: "Date", render: (m) => fmtDate(m.date) },
              { key: "journal", label: "Journal", render: (m) => m.journal?.name ?? "–" },
              { key: "ref", label: "Libellé", render: (m) => m.ref ?? "–" },
              { key: "amount_total", label: "Montant", align: "right", render: (m) => fmtGNF(m.amount_total) },
              { key: "state", label: "Statut", render: (m) => <Badge tone={MOVE_STATES[m.state]?.tone}>{MOVE_STATES[m.state]?.label}</Badge> },
            ]}
          />
        )}
      </Card>
      {creating && <EntryForm onClose={() => setCreating(false)} onDone={() => { setCreating(false); void mutate(); }} />}
      <MoveDetailModal moveId={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />
    </div>
  );
}

function EntryForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: accounts } = useApi<Account[]>("/finance/accounts?limit=3000");
  const { data: journals } = useApi<Journal[]>("/finance/journals");
  const [journalId, setJournalId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  const [template, setTemplate] = useState("libre");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const debit = lines.reduce((a, l) => a + num(l.debit), 0);
  const credit = lines.reduce((a, l) => a + num(l.credit), 0);
  const balanced = Math.abs(debit - credit) < 0.5 && debit > 0;
  const accountOptions = (accounts ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));

  function applyTemplate(key: string) {
    setTemplate(key);
    const t = TEMPLATES[key];
    if (!t || !t.lines.length) return;
    setLines(
      t.lines.map((l) => ({
        account_id: String(accounts?.find((a) => a.code.startsWith(l.prefix))?.id ?? ""),
        name: l.name,
        debit: "",
        credit: "",
      })),
    );
  }

  async function submit(post: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/finance/moves", {
        move_type: "entry",
        journal_id: Number(journalId),
        date,
        ref,
        post,
        lines: lines.filter((l) => l.account_id && (num(l.debit) || num(l.credit))).map((l) => ({ account_id: Number(l.account_id), name: l.name || ref, debit: num(l.debit), credit: num(l.credit) })),
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title="Nouvelle opération diverse"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => submit(false)} loading={busy} disabled={!balanced || !journalId}>
            Brouillon
          </Button>
          <Button variant="primary" onClick={() => submit(true)} loading={busy} disabled={!balanced || !journalId}>
            Valider
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Modèle">
            <Select value={template} onChange={(e) => applyTemplate(e.target.value)} options={Object.entries(TEMPLATES).map(([k, t]) => ({ value: k, label: t.label }))} />
          </Field>
          <Field label="Journal">
            <Select value={journalId} onChange={(e) => setJournalId(e.target.value)} placeholder="Choisir…" options={(journals ?? []).map((j) => ({ value: j.id, label: `${j.code} ${j.name}` }))} />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Libellé">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[12.5px] font-medium text-muted">
            <tr>
              <th className="px-2 py-1 text-left">Compte</th>
              <th className="px-2 py-1 text-left">Libellé</th>
              <th className="w-40 px-2 py-1 text-right">Débit</th>
              <th className="w-40 px-2 py-1 text-right">Crédit</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-2 py-1">
                  <Select value={l.account_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, account_id: e.target.value } : x)))} placeholder="Compte…" options={accountOptions} />
                </td>
                <td className="px-2 py-1">
                  <Input value={l.name} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </td>
                <td className="px-2 py-1">
                  <Input className="text-right font-mono" inputMode="numeric" value={l.debit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: "" } : x)))} />
                </td>
                <td className="px-2 py-1">
                  <Input className="text-right font-mono" inputMode="numeric" value={l.credit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: "" } : x)))} />
                </td>
                <td>
                  {lines.length > 2 && (
                    <button type="button" className="text-muted hover:text-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Supprimer">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={2}>
                <Button variant="ghost" onClick={() => setLines([...lines, emptyLine()])}>
                  <Plus className="h-4 w-4" /> Ligne
                </Button>
              </td>
              <td className="px-2 py-2 text-right font-mono">{fmtGNF(debit)}</td>
              <td className="px-2 py-2 text-right font-mono">{fmtGNF(credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        {!balanced && debit + credit > 0 && <Notice tone="warn">Écart débit - crédit : {fmtGNF(debit - credit)}. Une pièce doit être équilibrée.</Notice>}
      </div>
    </Modal>
  );
}
