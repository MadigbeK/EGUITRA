"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Segmented, Select, Textarea } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF, fmtShort } from "@/lib/format";
import type { Advance, AdvanceState, Meta } from "@/lib/rh-types";
import { ChampMontant, ChoixSalarie, messageErreur, moisCourant, moisLong, nombre, useMeta } from "./commun";

const ETAT: Record<AdvanceState, { label: string; tone: "warn" | "ok" | "neutral" }> = {
  open: { label: "En cours", tone: "warn" },
  done: { label: "Soldé", tone: "ok" },
  cancelled: { label: "Annulé", tone: "neutral" },
};

/**
 * Avances sur salaire et prêts au personnel : la mensualité est retenue d'elle-même sur chaque
 * bulletin à partir du premier mois de retenue, jusqu'au remboursement complet.
 */
export function AvancesPrets() {
  const { data: meta } = useMeta();
  const [filtre, setFiltre] = useState<"open" | "all">("open");
  const { data, error, mutate } = useApi<Advance[]>(`/rh/advances${filtre === "open" ? "?state=open" : ""}`);
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const encours = (data ?? []).filter((a) => a.state === "open");

  async function annuler(a: Advance) {
    if (!window.confirm(`Annuler ${a.kind === "pret" ? "le prêt" : "l'avance"} de ${a.employee.name} ? Les retenues déjà faites restent acquises.`)) return;
    try {
      await apiSend("POST", `/rh/advances/${a.id}/cancel`);
      void mutate();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Avances et prêts"
        subtitle="Avances sur salaire et prêts au personnel, remboursés par une retenue mensuelle sur le bulletin. Le versement lui-même est enregistré par la finance (compte 421 du salarié)."
        actions={
          meta?.can_write && (
            <Button variant="primary" onClick={() => setCreation(true)}>
              <Plus className="h-4 w-4" /> Nouvelle avance ou prêt
            </Button>
          )
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="En cours" value={String(encours.length)} hint="Avances et prêts non soldés" />
        <Kpi label="Reste dû" value={fmtShort(encours.reduce((s, a) => s + a.remaining, 0))} hint="Ensemble des salariés" />
        <Kpi label="Retenues mensuelles" value={fmtShort(encours.reduce((s, a) => s + Math.min(a.installment, a.remaining), 0))} hint="Sur la prochaine paie" />
      </div>
      <div className="mb-4">
        <Segmented value={filtre} onChange={setFiltre} options={[{ key: "open", label: "En cours" }, { key: "all", label: "Toutes" }]} />
      </div>
      {erreur && (
        <div className="mb-4">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      <Card padded={false}>
        {!data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data}
            rowKey={(a) => a.id}
            empty="Aucune avance ni prêt."
            columns={[
              { key: "employee", label: "Salarié", render: (a) => <Link className="font-medium text-ink hover:underline" href={`/rh/salaries/${a.employee.id}`}>{a.employee.name}</Link>, sortValue: (a) => a.employee.name },
              { key: "kind", label: "Nature", render: (a) => (a.kind === "pret" ? "Prêt" : "Avance") },
              { key: "date", label: "Date", render: (a) => fmtDate(a.date), sortValue: (a) => a.date },
              { key: "amount", label: "Montant", align: "right", render: (a) => fmtGNF(a.amount), sortValue: (a) => a.amount },
              { key: "installment", label: "Mensualité", align: "right", render: (a) => fmtGNF(a.installment) },
              { key: "first_month", label: "Retenue dès", render: (a) => moisLong(a.first_month) },
              { key: "reimbursed", label: "Remboursé", align: "right", render: (a) => fmtGNF(a.reimbursed) },
              { key: "remaining", label: "Reste dû", align: "right", render: (a) => <b>{fmtGNF(a.remaining)}</b>, sortValue: (a) => a.remaining },
              { key: "state", label: "État", render: (a) => <Badge tone={ETAT[a.state].tone}>{ETAT[a.state].label}</Badge> },
              {
                key: "x",
                label: "",
                align: "right",
                render: (a) =>
                  meta?.can_write && a.state === "open" ? (
                    <Button variant="ghost" className="min-h-0 px-2 py-1 text-xs" onClick={() => void annuler(a)}>
                      Annuler
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>
      {creation && meta && (
        <NouvelleAvance
          meta={meta}
          onClose={() => setCreation(false)}
          onDone={() => {
            setCreation(false);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function NouvelleAvance({ meta, onClose, onDone }: { meta: Meta; onClose: () => void; onDone: () => void }) {
  const [salarie, setSalarie] = useState<number | null>(null);
  const [kind, setKind] = useState<"avance" | "pret">("avance");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [montant, setMontant] = useState("");
  const [mensualite, setMensualite] = useState("");
  const [premier, setPremier] = useState(moisCourant().slice(0, 7));
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = nombre(montant);
  // Une avance se retient en une fois par défaut ; un prêt s'étale.
  const mens = nombre(mensualite) || (kind === "avance" ? m : 0);
  const nbMois = m && mens ? Math.ceil(m / mens) : null;

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    try {
      await apiSend("POST", "/rh/advances", { employee_id: salarie, kind, date, amount: m, installment: mens, first_month: `${premier}-01`, note: note.trim() || null });
      onDone();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Nouvelle avance ou prêt"
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!salarie || !m || !mens || !premier} onClick={enregistrer}>
          Enregistrer
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {erreur && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{erreur}</Notice>
          </div>
        )}
        <Field label="Salarié" className="sm:col-span-2">
          <ChoixSalarie meta={meta} value={salarie} onChange={setSalarie} />
        </Field>
        <Field label="Nature">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "avance" | "pret")} options={[{ value: "avance", label: "Avance sur salaire" }, { value: "pret", label: "Prêt" }]} />
        </Field>
        <Field label="Date du versement">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Montant (GNF)">
          <ChampMontant value={montant} onChange={setMontant} />
        </Field>
        <Field label="Mensualité retenue (GNF)" hint={kind === "avance" ? "Vide : retenue en une fois" : undefined}>
          <ChampMontant value={mensualite} onChange={setMensualite} />
        </Field>
        <Field label="Premier mois de retenue">
          <Input type="month" value={premier} onChange={(e) => setPremier(e.target.value)} />
        </Field>
        <div className="self-end pb-2 text-sm text-ink-2">{nbMois ? `${nbMois} retenue(s) mensuelle(s)` : ""}</div>
        <Field label="Commentaire" className="sm:col-span-2">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
