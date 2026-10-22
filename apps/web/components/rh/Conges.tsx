"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "@/components/icons";
import { Button, Card, DataTable, Empty, ErrorBox, Etat, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tabs, Textarea, SERIES, cx, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";
import { LEAVE_STATE_LABELS, type BalanceRow, type Holiday, type Leave, type LeaveState, type Meta } from "@/lib/rh-types";
import { ChoixSalarie, DecisionAbsence, EtatAbsence, FiltreSociete, avecSociete, jours, messageErreur, moisCourant, periode, useJoursOuvrables, useMeta } from "./commun";

type Onglet = "valider" | "planning" | "absences" | "soldes";

/**
 * Absences et congés du personnel des sociétés du compte (filtre « Société » facultatif) : demandes
 * à valider, planning du mois, toutes les absences, soldes.
 */
export function GestionConges() {
  const { data: meta, error: erreurMeta, mutate: rafraichirMeta } = useMeta();
  const [onglet, setOnglet] = useState<Onglet>("valider");
  const [saisie, setSaisie] = useState(false);
  const [societe, setSociete] = useState<number | null>(null);
  const { data: attente, error: erreurAttente, mutate: rafraichirAttente } = useApi<Leave[]>(avecSociete("/rh/leaves?state=submitted", societe));
  const [version, setVersion] = useState(0);
  const rafraichir = () => {
    void rafraichirAttente();
    setVersion((v) => v + 1);
  };
  return (
    <div>
      <PageHeader
        title="Absences et congés"
        subtitle="Demandes à valider, planning du mois, historique des absences et soldes de congés payés. Jours comptés en jours ouvrables (lundi au samedi, fériés exclus)."
        actions={
          meta?.can_write && (
            <Button variant="primary" onClick={() => setSaisie(true)}>
              <Plus className="h-4 w-4" /> Saisir une absence
            </Button>
          )
        }
      />
      <div className="mb-3">
        <FiltreSociete companies={meta?.companies} value={societe} onChange={setSociete} />
      </div>
      <Tabs
        value={onglet}
        onChange={setOnglet}
        tabs={[
          { key: "valider", label: "À valider", count: attente?.length },
          { key: "planning", label: "Planning du mois" },
          { key: "absences", label: "Toutes les absences" },
          { key: "soldes", label: "Soldes de congés" },
        ]}
      />
      {erreurMeta && !meta && (
        <div className="mb-4">
          <ErrorBox error={erreurMeta} onRetry={() => rafraichirMeta()} />
        </div>
      )}
      {onglet === "valider" && <AValider leaves={attente} error={erreurAttente} onRetry={() => rafraichirAttente()} meta={meta} onChanged={rafraichir} />}
      {onglet === "planning" && <Planning key={version} meta={meta} societe={societe} />}
      {onglet === "absences" && <Absences key={version} meta={meta} societe={societe} onChanged={rafraichir} />}
      {onglet === "soldes" && <Soldes key={version} societe={societe} />}
      {saisie && meta && (
        <SaisieAbsence
          meta={meta}
          onClose={() => setSaisie(false)}
          onDone={() => {
            setSaisie(false);
            rafraichir();
          }}
        />
      )}
    </div>
  );
}

function AValider({ leaves, error, onRetry, meta, onChanged }: { leaves: Leave[] | undefined; error?: unknown; onRetry?: () => void; meta: Meta | undefined; onChanged: () => void }) {
  if (!leaves) return <Etat error={error} onRetry={onRetry} />;
  if (leaves.length === 0)
    return (
      <Card>
        <Empty title="Aucune demande en attente" hint="Les demandes faites depuis « Mon espace » arrivent ici, et chez le responsable hiérarchique du salarié." />
      </Card>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {leaves.map((l) => (
        <Card key={l.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/rh/salaries/${l.employee.id}`} className="font-display text-[17px] font-[620] text-ink hover:underline">
                {l.employee.name}
              </Link>
              <div className="mt-1 text-sm text-ink-2">
                {l.type.name}, {periode(l.date_from, l.date_to, l.half_day)} : <b>{jours(l.days)}</b>
              </div>
              <div className="mt-1 text-[12.5px] text-muted">
                Demandée par {l.requested_by ?? "–"}
                {l.type.deducts_balance ? ", décomptée du solde de congés" : l.type.paid ? ", absence rémunérée" : ", retenue sur salaire"}
                {l.has_document ? ", justificatif joint" : ""}
              </div>
              {l.note && <p className="mt-2 rounded-lg bg-panel-2 px-3 py-2 text-[13px] text-ink-2">{l.note}</p>}
            </div>
            {l.can_decide && <DecisionAbsence leave={l} peutForcer={Boolean(meta?.can_write)} onDone={onChanged} />}
          </div>
        </Card>
      ))}
    </div>
  );
}

function decaler(month: string, n: number): string {
  const d = new Date(`${month}T00:00:00`);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Grille salariés × jours du mois : absences colorées par type, dimanches et jours fériés grisés. */
function Planning({ meta, societe }: { meta: Meta | undefined; societe: number | null }) {
  const [mois, setMois] = useState(moisCourant());
  const debut = new Date(`${mois}T00:00:00`);
  const nbJours = new Date(debut.getFullYear(), debut.getMonth() + 1, 0).getDate();
  const fin = `${mois.slice(0, 8)}${String(nbJours).padStart(2, "0")}`;
  const { data: leaves, error, mutate } = useApi<Leave[]>(avecSociete(`/rh/leaves?state=approved,submitted&date_from=${mois}&date_to=${fin}`, societe));
  const { data: feries } = useApi<Holiday[]>(`/rh/holidays?year=${debut.getFullYear()}`);
  const types = meta?.leave_types ?? [];
  const couleur = (typeId: number) => SERIES[Math.max(0, types.findIndex((t) => t.id === typeId)) % SERIES.length]!;
  const jourListe = Array.from({ length: nbJours }, (_, i) => new Date(debut.getFullYear(), debut.getMonth(), i + 1));
  const ferieDe = new Map((feries ?? []).map((h) => [h.date, h.name]));
  const salaries = useMemo(() => {
    const absents = new Map<number, string>();
    for (const l of leaves ?? []) absents.set(l.employee.id, l.employee.name);
    const liste = (meta?.employees ?? []).filter((e) => !societe || e.company_id === societe).map((e) => ({ id: e.id, name: e.name }));
    for (const [id, name] of absents) if (!liste.some((e) => e.id === id)) liste.push({ id, name });
    return liste.sort((a, b) => Number(absents.has(b.id)) - Number(absents.has(a.id)) || a.name.localeCompare(b.name));
  }, [leaves, meta, societe]);

  function absenceDu(employeeId: number, jour: string) {
    return (leaves ?? []).find((l) => l.employee.id === employeeId && l.date_from <= jour && jour <= l.date_to && l.state !== "refused" && l.state !== "cancelled");
  }

  return (
    <Card
      padded={false}
      title={<span className="capitalize">{debut.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>}
      actions={
        <span className="flex items-center gap-1.5">
          <Button variant="ghost" aria-label="Mois précédent" onClick={() => setMois(decaler(mois, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setMois(moisCourant())}>
            Ce mois
          </Button>
          <Button variant="ghost" aria-label="Mois suivant" onClick={() => setMois(decaler(mois, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </span>
      }
    >
      {!leaves || !meta ? (
        <Etat error={error} onRetry={() => mutate()} />
      ) : salaries.length === 0 ? (
        <Empty title="Aucun salarié" />
      ) : (
        <>
          <div className="overflow-x-auto px-4 pb-2">
            <table className="w-full border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[11rem] bg-panel py-2 pr-3 text-left font-semibold text-muted">Salarié</th>
                  {jourListe.map((d) => {
                    const j = iso(d);
                    const off = d.getDay() === 0 || ferieDe.has(j);
                    return (
                      <th key={j} title={ferieDe.get(j)} className={cx("w-7 min-w-[1.75rem] py-2 text-center font-semibold tabular", off ? "text-muted/60" : "text-ink-2")}>
                        <span className="block text-[10px] font-medium uppercase">{d.toLocaleDateString("fr-FR", { weekday: "narrow" })}</span>
                        {d.getDate()}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {salaries.map((s) => (
                  <tr key={s.id}>
                    <td className="sticky left-0 z-10 truncate border-t border-line/60 bg-panel py-1.5 pr-3 font-medium text-ink">
                      <Link href={`/rh/salaries/${s.id}`} className="hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    {jourListe.map((d) => {
                      const j = iso(d);
                      const off = d.getDay() === 0 || ferieDe.has(j);
                      const a = absenceDu(s.id, j);
                      return (
                        <td key={j} className={cx("border-t border-line/60 p-0.5", off && "bg-panel-3/70")}>
                          {a && (
                            <span
                              title={`${a.type.name}, ${periode(a.date_from, a.date_to, a.half_day)} (${LEAVE_STATE_LABELS[a.state]})`}
                              className={cx("block h-5 rounded-[5px]", a.state === "submitted" && "opacity-45")}
                              style={{ background: couleur(a.type.id), opacity: off ? 0.35 : undefined }}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-6 py-3 text-[12px] text-ink-2">
            {types
              .filter((t) => t.active)
              .map((t) => (
                <span key={t.id} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: couleur(t.id) }} /> {t.name}
                </span>
              ))}
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-2.5 w-2.5 rounded-sm bg-panel-3" /> Dimanche ou jour férié
            </span>
            <span className="text-muted">Teinte pâle : demande en attente</span>
          </div>
        </>
      )}
    </Card>
  );
}

function Absences({ meta, societe, onChanged }: { meta: Meta | undefined; societe: number | null; onChanged: () => void }) {
  const [etat, setEtat] = useState<LeaveState | "">("");
  const [salarie, setSalarie] = useState<number | null>(null);
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const params = new URLSearchParams();
  if (etat) params.set("state", etat);
  if (salarie) params.set("employee_id", String(salarie));
  if (du) params.set("date_from", du);
  if (au) params.set("date_to", au);
  if (societe) params.set("company_id", String(societe));
  const requete = params.toString();
  const { data, error, mutate } = useApi<Leave[]>(`/rh/leaves${requete ? `?${requete}` : ""}`);
  const [erreur, setErreur] = useState<string | null>(null);

  async function annuler(l: Leave) {
    if (!(await demanderConfirmation(`Annuler l'absence de ${l.employee.name} (${periode(l.date_from, l.date_to, l.half_day)}) ?`, { action: "Annuler l'absence", danger: true }))) return;
    try {
      await apiSend("POST", `/rh/leaves/${l.id}/cancel`);
      void mutate();
      onChanged();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Salarié" className="w-64">
          <ChoixSalarie meta={meta} value={salarie} onChange={setSalarie} placeholder="Tous" />
        </Field>
        <Field label="État" className="w-44">
          <Select value={etat} onChange={(e) => setEtat(e.target.value as LeaveState | "")} placeholder="Tous" options={(Object.keys(LEAVE_STATE_LABELS) as LeaveState[]).map((k) => ({ value: k, label: LEAVE_STATE_LABELS[k] }))} />
        </Field>
        <Field label="Du" className="w-40">
          <Input type="date" value={du} onChange={(e) => setDu(e.target.value)} />
        </Field>
        <Field label="Au" className="w-40">
          <Input type="date" value={au} onChange={(e) => setAu(e.target.value)} />
        </Field>
      </div>
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {error && <ErrorBox error={error} />}
      <Card padded={false}>
        {!data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data}
            rowKey={(l) => l.id}
            empty="Aucune absence."
            columns={[
              { key: "employee", label: "Salarié", render: (l) => <Link className="font-medium text-ink hover:underline" href={`/rh/salaries/${l.employee.id}`}>{l.employee.name}</Link>, sortValue: (l) => l.employee.name },
              { key: "type", label: "Type", render: (l) => l.type.name, sortValue: (l) => l.type.name },
              { key: "periode", label: "Période", render: (l) => periode(l.date_from, l.date_to, l.half_day), sortValue: (l) => l.date_from },
              { key: "days", label: "Jours", align: "right", render: (l) => jours(l.days), sortValue: (l) => l.days },
              { key: "state", label: "État", render: (l) => <EtatAbsence state={l.state} />, sortValue: (l) => l.state },
              { key: "decision", label: "Décision", render: (l) => (l.approver ? `${l.approver}, ${fmtDate(l.decided_at)}` : "–") },
              {
                key: "x",
                label: "",
                align: "right",
                render: (l) =>
                  l.state === "submitted" && l.can_decide ? (
                    <DecisionAbsence compact leave={l} peutForcer={Boolean(meta?.can_write)} onDone={() => { void mutate(); onChanged(); }} />
                  ) : meta?.can_write && (l.state === "submitted" || l.state === "approved") ? (
                    <Button variant="ghost" size="sm" onClick={() => void annuler(l)}>
                      Annuler
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

function Soldes({ societe }: { societe: number | null }) {
  const { data, error } = useApi<BalanceRow[]>(avecSociete("/rh/leaves/balances", societe));
  if (error) return <ErrorBox error={error} />;
  return (
    <Card padded={false}>
      {!data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data}
          rowKey={(r) => r.employee.id}
          empty="Aucun salarié."
          columns={[
            { key: "employee", label: "Salarié", render: (r) => <Link className="font-medium text-ink hover:underline" href={`/rh/salaries/${r.employee.id}`}>{r.employee.name}</Link>, sortValue: (r) => r.employee.name },
            { key: "department", label: "Département", render: (r) => r.department?.name ?? "–", sortValue: (r) => r.department?.name ?? "" },
            { key: "initial", label: "Reprise", align: "right", render: (r) => jours(r.balance.initial) },
            { key: "acquired", label: "Acquis", align: "right", render: (r) => jours(r.balance.acquired) },
            { key: "taken", label: "Pris", align: "right", render: (r) => jours(r.balance.taken) },
            { key: "pending", label: "En attente", align: "right", render: (r) => jours(r.balance.pending) },
            {
              key: "balance",
              label: "Solde",
              align: "right",
              sortValue: (r) => r.balance.balance,
              render: (r) => <span className={cx("font-semibold", r.balance.balance < 0 ? "text-danger" : r.balance.balance > 45 ? "text-warn" : "text-ink")}>{jours(r.balance.balance)}</span>,
            },
          ]}
        />
      )}
    </Card>
  );
}

/**
 * Saisie d'une absence par le service RH pour un salarié : demande à valider, ou absence constatée
 * enregistrée comme approuvée. Le nombre de jours ouvrables s'affiche pendant la saisie.
 */
export function SaisieAbsence({ meta, employeeId, onClose, onDone }: { meta: Meta; employeeId?: number; onClose: () => void; onDone: () => void }) {
  const [salarie, setSalarie] = useState<number | null>(employeeId ?? null);
  const types = meta.leave_types.filter((t) => t.active);
  const [typeId, setTypeId] = useState<string>(String(types[0]?.id ?? ""));
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [demi, setDemi] = useState(false);
  const [note, setNote] = useState("");
  const [approuver, setApprouver] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { days, error: erreurJours } = useJoursOuvrables(du, au || du, demi);
  const type = types.find((t) => String(t.id) === typeId);

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    try {
      await apiSend("POST", "/rh/leaves", { employee_id: salarie, type_id: Number(typeId), date_from: du, date_to: au || du, half_day: demi && (!au || au === du), note: note.trim() || null, approve: approuver });
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
      title="Saisir une absence"
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!salarie || !typeId || !du || Boolean(erreurJours)} onClick={enregistrer}>
          {approuver ? "Enregistrer l'absence" : "Enregistrer la demande"}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {erreur && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{erreur}</Notice>
          </div>
        )}
        {employeeId === undefined && (
          <Field label="Salarié" className="sm:col-span-2">
            <ChoixSalarie meta={meta} value={salarie} onChange={setSalarie} />
          </Field>
        )}
        <Field label="Type d'absence" className="sm:col-span-2">
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} options={types.map((t) => ({ value: t.id, label: `${t.name}${t.paid ? "" : " (non rémunérée)"}` }))} />
        </Field>
        <Field label="Du">
          <Input type="date" value={du} onChange={(e) => setDu(e.target.value)} />
        </Field>
        <Field label="Au" hint="Vide : un seul jour">
          <Input type="date" value={au} min={du} onChange={(e) => setAu(e.target.value)} />
        </Field>
        {(!au || au === du) && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={demi} onChange={(e) => setDemi(e.target.checked)} /> Demi-journée
          </label>
        )}
        <div className="text-sm sm:col-span-2">
          {erreurJours ? <span className="text-danger">{erreurJours}</span> : days !== null ? <span className="text-ink-2">Durée : <b>{jours(days)} ouvrable(s)</b>{type?.max_days ? ` (au plus ${jours(type.max_days)} pour ce type)` : ""}</span> : null}
          {type && !type.paid && <span className="mt-1 block text-warn">Absence non rémunérée : retenue sur la paie du mois au prorata des jours ouvrables.</span>}
          {type?.needs_document && <span className="mt-1 block text-muted">Ce type d&apos;absence demande un justificatif : ajoutez-le aux documents du salarié.</span>}
        </div>
        <Field label="Motif ou commentaire" className="sm:col-span-2">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={approuver} onChange={(e) => setApprouver(e.target.checked)} /> Enregistrer comme approuvée (absence constatée ou accord déjà donné)
        </label>
      </div>
    </Modal>
  );
}
