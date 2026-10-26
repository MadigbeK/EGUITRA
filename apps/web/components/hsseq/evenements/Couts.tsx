"use client";

/**
 * Coûts d'un événement (§6, exposés à Finance) : sinistres, franchises, immobilisations, pertes de
 * produit, réparations, autres. Saisie et retrait par le Responsable HSSEQ (POST et DELETE
 * /hsseq/events/{id}/costs), tant que la fiche n'est pas close ; les autres profils lisent.
 */

import { useId, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Button, Card, DataTable, Field, Input, Notice, Select, demanderConfirmation } from "@/components/ui";
import { NATURE_COUT } from "@/components/hsseq/commun";
import { apiSend } from "@/lib/api-client";
import { fmtDate, fmtGNF, fmtInt } from "@/lib/format";
import type { Cost, CostKind, Event as Evenement, Referentials } from "@/lib/hsseq-types";
import { aujourdhui, champsRefus, estResponsableHsseq, lireMontant, messageRefus } from "./commun";

/** Natures mises en avant (consigne du lot 1), puis les autres. */
const PRINCIPALES: CostKind[] = ["claim", "deductible", "downtime", "product_loss"];
const NATURES = Object.keys(NATURE_COUT) as CostKind[];

export function Couts({ e, referentiels, onMaj }: { e: Evenement; referentiels?: Referentials; onMaj: (e: Evenement) => void }) {
  // Coûts : profil hsseq (matrice des routes) ; la fiche n'a pas de droit propre aux coûts, can_edit borne à la fiche ouverte.
  const editable = e.rights.can_edit && estResponsableHsseq(referentiels);
  const [refus, setRefus] = useState<string | null>(null);
  const total = e.costs.reduce((s, c) => s + c.amount, 0);
  const parNature = new Map<CostKind, number>();
  for (const c of e.costs) parNature.set(c.kind, (parNature.get(c.kind) ?? 0) + c.amount);
  const affichees = [...PRINCIPALES, ...NATURES.filter((k) => !PRINCIPALES.includes(k) && parNature.has(k))];

  async function retirer(c: Cost) {
    if (!(await demanderConfirmation(`Retirer le coût « ${c.label} » (${fmtGNF(c.amount)}) ?`, { action: "Retirer", danger: true }))) return;
    setRefus(null);
    try {
      onMaj(await apiSend<Evenement>("DELETE", `/hsseq/events/${e.id}/costs/${c.id}`));
    } catch (err) {
      setRefus(messageRefus(err, "Le coût n'a pas été retiré."));
    }
  }

  return (
    <div className="space-y-5">
      <section aria-label="Coûts par nature" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {affichees.map((k) => (
          <div key={k} className="rounded-2xl bg-panel px-4 py-3 shadow-[var(--ombre-feuille)]">
            <div className="text-[12.5px] font-medium text-ink-2">{NATURE_COUT[k]}</div>
            <div className="mt-1 font-display text-[19px] font-[650] text-ink tabular">{fmtInt(parNature.get(k) ?? 0)}</div>
          </div>
        ))}
        <div className="rounded-2xl bg-accent px-4 py-3 text-accent-ink">
          <div className="text-[12.5px] font-medium">Total (GNF)</div>
          <div className="mt-1 font-display text-[19px] font-[650] tabular">{fmtInt(total)}</div>
        </div>
      </section>

      <Card title="Coûts enregistrés" padded={false}>
        <DataTable
          rows={e.costs}
          rowKey={(c) => c.id}
          empty="Aucun coût enregistré."
          columns={[
            { key: "date", label: "Date", render: (c) => (c.date ? fmtDate(c.date) : <span className="text-muted">–</span>) },
            { key: "kind", label: "Nature", render: (c) => NATURE_COUT[c.kind] ?? c.kind },
            { key: "label", label: "Libellé", render: (c) => c.label ?? <span className="text-muted">–</span> },
            { key: "finance_move_id", label: "Pièce comptable", render: (c) => (c.finance_move_id ? `Pièce n° ${c.finance_move_id}` : <span className="text-muted">–</span>), sortValue: (c) => c.finance_move_id ?? 0 },
            { key: "amount", label: "Montant (GNF)", align: "right", render: (c) => fmtInt(c.amount) },
            ...(editable
              ? [
                  {
                    key: "retirer",
                    label: "",
                    align: "right" as const,
                    render: (c: Cost) => (
                      <Button variant="ghost" size="sm" aria-label={`Retirer le coût ${c.label ?? NATURE_COUT[c.kind]}`} title="Retirer" onClick={() => retirer(c)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      {refus && <Notice tone="danger">{refus}</Notice>}
      {editable && <Ajout e={e} onMaj={onMaj} />}
    </div>
  );
}

function Ajout({ e, onMaj }: { e: Evenement; onMaj: (e: Evenement) => void }) {
  const id = useId();
  const [nature, setNature] = useState<CostKind>("claim");
  const [libelle, setLibelle] = useState("");
  const [montant, setMontant] = useState("");
  const [date, setDate] = useState(aujourdhui());
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [champs, setChamps] = useState<string[]>([]);
  const valeur = lireMontant(montant);
  const pret = libelle.trim() && valeur !== null && valeur > 0 && date;

  async function ajouter(ev: FormEvent) {
    ev.preventDefault();
    if (!pret) return;
    setEnvoi(true);
    setRefus(null);
    setChamps([]);
    try {
      onMaj(await apiSend<Evenement>("POST", `/hsseq/events/${e.id}/costs`, { kind: nature, label: libelle.trim(), amount: valeur, date }));
      setLibelle("");
      setMontant("");
    } catch (err) {
      setRefus(messageRefus(err, "Le coût n'a pas été enregistré."));
      setChamps(champsRefus(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Card title="Ajouter un coût">
      <form id={id} onSubmit={ajouter} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[11rem_minmax(0,1fr)_10rem_10rem_auto]">
        <Field label="Nature">
          <Select value={nature} onChange={(ev) => setNature(ev.target.value as CostKind)} options={NATURES.map((k) => ({ value: k, label: NATURE_COUT[k] }))} />
        </Field>
        <Field label="Libellé" error={champs.includes("label") ? "Libellé refusé." : undefined}>
          <Input value={libelle} maxLength={200} onChange={(ev) => setLibelle(ev.target.value)} placeholder="Franchise de l'assureur, remorquage…" />
        </Field>
        <Field label="Montant (GNF)" error={montant && valeur === null ? "Montant entier en GNF." : champs.includes("amount") ? "Montant refusé." : undefined}>
          <Input inputMode="numeric" className="font-mono" value={montant} onChange={(ev) => setMontant(ev.target.value)} />
        </Field>
        <Field label="Date" error={champs.includes("date") ? "Date refusée." : undefined}>
          <Input type="date" value={date} max={aujourdhui()} onChange={(ev) => setDate(ev.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={!pret} loading={envoi}>
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </form>
      {refus && (
        <div className="mt-3">
          <Notice tone="danger">{refus}</Notice>
        </div>
      )}
    </Card>
  );
}
