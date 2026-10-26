"use client";

import { Fragment, useEffect, useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Modal, Notice, PageHeader, Select } from "@/components/ui";
import { AnalyticFields, fromDistribution, toDistribution, useAxes, type AxisChoice } from "@/components/finance/AnalyticFields";
import { MoveDetailModal } from "@/components/finance/MoveDetailModal";
import { ECRITURE_FINANCE, enSaisie } from "@/components/finance/communPieces";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { MOVE_STATES, type Account, type Journal, type MoveDetail, type MoveLine, type MoveSummary, type Paged } from "@/lib/finance-types";
import type { Me } from "@/lib/types";
import { fmtDate, fmtGNF } from "@/lib/format";

/**
 * Ligne d'OD saisie. partner_id : tiers de la ligne relue d'un brouillon, renvoyé tel quel ; original :
 * répartition analytique relue, renvoyée tant que ses axes ne changent pas.
 */
interface Line { account_id: string; name: string; debit: string; credit: string; axes: AxisChoice; partner?: { id: number; name: string } | null; original?: Record<string, number> }
const emptyLine = (): Line => ({ account_id: "", name: "", debit: "", credit: "", axes: {} });

/** Ligne d'un brouillon d'OD relu pour modification. */
function lineOf(l: MoveLine): Line {
  return {
    account_id: l.account ? String(l.account.id) : "",
    name: l.name ?? "",
    debit: l.debit ? enSaisie(l.debit) : "",
    credit: l.credit ? enSaisie(l.credit) : "",
    axes: {},
    partner: l.partner ?? null,
    original: l.analytic_distribution && Object.keys(l.analytic_distribution).length ? l.analytic_distribution : undefined,
  };
}
/** Les axes se proposent sur les comptes de gestion et d'immobilisation (classes 2, 6, 7 et 8). */
const ANALYTIC_CLASSES = /^[2678]/;
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
  const { data, error, mutate } = useApi<Paged<MoveSummary>>("/finance/moves?type=entry&limit=100");
  const { data: me } = useApi<Me>("/auth/me");
  // Une OD porte des comptes choisis : réservée au droit « Saisie libre des comptes », et la route
  // (POST /finance/moves, opération diverse) à la finance et à l'administration.
  const libre = me?.rights?.free_accounts === true;
  const saisie = useAutorise(ECRITURE_FINANCE);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  /** Brouillon d'OD ouvert dans le formulaire pour modification. */
  const [editing, setEditing] = useState<MoveDetail | null>(null);
  return (
    <div>
      <PageHeader
        title="Journaux et opérations diverses"
        subtitle="Écritures d'OD guidées, toujours équilibrées. Les virements internes se saisissent dans Trésorerie."
        actions={
          saisie && (
            <Button variant="primary" onClick={() => setCreating(true)} disabled={!libre}>
              <Plus className="h-4 w-4" /> Nouvelle OD
            </Button>
          )
        }
      />
      {me && saisie && !libre && (
        <div className="mb-4">
          <Notice tone="accent">
            La saisie des opérations diverses demande le droit « Saisie libre des comptes » (Administration &gt; Utilisateurs) : vos pièces prennent le compte de leur catégorie de dépense, du type d&apos;opération ou de l&apos;activité.
          </Notice>
        </div>
      )}
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => mutate()} />
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
      {editing && (
        <EntryForm
          move={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            const id = editing.id;
            setEditing(null);
            void mutate();
            setSelected(id);
          }}
        />
      )}
      {/* Remontée à chaque pièce : le règlement, le montant et l'erreur d'une pièce ne passent pas à la suivante. */}
      <MoveDetailModal
        key={selected ?? "aucune"}
        moveId={selected}
        onClose={() => setSelected(null)}
        onChanged={() => mutate()}
        onOpen={setSelected}
        // La modification d'une OD réécrit ses comptes : réservée au droit « Saisie libre des comptes ».
        onEditEntry={
          libre
            ? (m) => {
                setSelected(null);
                setEditing(m);
              }
            : undefined
        }
      />
    </div>
  );
}

/**
 * Saisie d'une opération diverse, ou modification d'un brouillon (move) : lignes, date et libellé se
 * réécrivent (PATCH), le journal d'une pièce enregistrée ne change pas.
 */
function EntryForm({ move, onClose, onDone }: { move?: MoveDetail; onClose: () => void; onDone: () => void }) {
  const { data: accounts } = useApi<Account[]>("/finance/accounts?limit=3000");
  const { data: journals } = useApi<Journal[]>("/finance/journals");
  const [journalId, setJournalId] = useState(move?.journal ? String(move.journal.id) : "");
  const [date, setDate] = useState(move?.date ?? new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState(move?.ref ?? "");
  const [template, setTemplate] = useState("libre");
  const [lines, setLines] = useState<Line[]>(() => (move ? move.lines.map(lineOf) : [emptyLine(), emptyLine()]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Brouillon relu : les axes de chaque ligne s'affichent une fois ceux de la société chargés.
  const [axesRelus, setAxesRelus] = useState(!move);
  const debit = lines.reduce((a, l) => a + num(l.debit), 0);
  const credit = lines.reduce((a, l) => a + num(l.credit), 0);
  const balanced = Math.abs(debit - credit) < 0.5 && debit > 0;
  const accountOptions = (accounts ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const { data: axes } = useAxes();
  const codeOf = (id: string) => accounts?.find((a) => String(a.id) === id)?.code ?? "";
  const analytic = (l: Line) => Boolean(l.account_id) && ANALYTIC_CLASSES.test(codeOf(l.account_id));
  useEffect(() => {
    if (axesRelus || !axes) return;
    setLines((ls) => ls.map((l) => (l.original ? { ...l, axes: fromDistribution(axes, l.original) } : l)));
    setAxesRelus(true);
  }, [axes, axesRelus]);

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
        axes: {},
      })),
    );
  }

  async function submit(post: boolean) {
    setBusy(true);
    setError(null);
    const corps = {
      date,
      ref,
      lines: lines
        .filter((l) => l.account_id && (num(l.debit) || num(l.credit)))
        .map((l) => ({
          account_id: Number(l.account_id),
          name: l.name || ref,
          debit: num(l.debit),
          credit: num(l.credit),
          partner_id: l.partner?.id,
          analytic_distribution: analytic(l) ? (l.original ?? toDistribution(l.axes)) : undefined,
        })),
    };
    try {
      if (!move) {
        await apiSend("POST", "/finance/moves", { move_type: "entry", journal_id: Number(journalId), post, ...corps });
        onDone();
        return;
      }
      try {
        await apiSend("PATCH", `/finance/moves/${move.id}`, corps);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
        return;
      }
      if (post) {
        try {
          await apiSend("POST", `/finance/moves/${move.id}/post`);
        } catch (e) {
          setError(`Brouillon enregistré, validation refusée : ${e instanceof ApiError ? e.message : "réseau indisponible"}`);
          return;
        }
      }
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
      title={move ? `Modifier l'opération diverse${move.ref ? ` « ${move.ref} »` : ""}` : "Nouvelle opération diverse"}
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
          <Field label="Journal" hint={move ? "Le journal d'une pièce enregistrée ne change pas." : undefined}>
            <Select value={journalId} disabled={Boolean(move)} onChange={(e) => setJournalId(e.target.value)} placeholder="Choisir…" options={(journals ?? []).map((j) => ({ value: j.id, label: `${j.code} ${j.name}` }))} />
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
              <th scope="col" className="px-2 py-1 text-left">Compte</th>
              <th scope="col" className="px-2 py-1 text-left">Libellé</th>
              <th scope="col" className="w-40 px-2 py-1 text-right">Débit</th>
              <th scope="col" className="w-40 px-2 py-1 text-right">Crédit</th>
              <th scope="col" className="w-8">
                <span className="sr-only">Supprimer</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <Fragment key={i}>
              <tr>
                <td className="px-2 py-1">
                  <Select value={l.account_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, account_id: e.target.value } : x)))} placeholder="Compte…" options={accountOptions} aria-label={`Compte, ligne ${i + 1}`} />
                </td>
                <td className="px-2 py-1">
                  <Input value={l.name} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Libellé, ligne ${i + 1}`} />
                  {l.partner && <div className="mt-0.5 text-[12px] text-muted">Tiers : {l.partner.name}</div>}
                </td>
                <td className="px-2 py-1">
                  <Input className="text-right font-mono" inputMode="numeric" value={l.debit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: "" } : x)))} aria-label={`Débit, ligne ${i + 1}`} />
                </td>
                <td className="px-2 py-1">
                  <Input className="text-right font-mono" inputMode="numeric" value={l.credit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: "" } : x)))} aria-label={`Crédit, ligne ${i + 1}`} />
                </td>
                <td>
                  {lines.length > 2 && (
                    <button type="button" className="text-muted hover:text-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Supprimer la ligne ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
              {analytic(l) && (
                <tr>
                  <td colSpan={5} className="px-2 pb-2">
                    <AnalyticFields compact axes={axes} value={l.axes} onChange={(next) => setLines(lines.map((x, j) => (j === i ? { ...x, axes: next, original: undefined } : x)))} />
                  </td>
                </tr>
              )}
              </Fragment>
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
