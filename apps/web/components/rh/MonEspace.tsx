"use client";

import Link from "next/link";
import { useState } from "react";
import { Calendar, FileText, Plus, Users } from "@/components/icons";
import { Button, Card, DataTable, Empty, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Select, Textarea, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDec, fmtGNF } from "@/lib/format";
import { CONTRACT_LABELS, type Leave, type LeaveType, type MySpace } from "@/lib/rh-types";
import { DecisionAbsence, EtatAbsence, Ligne, jours, messageErreur, moisLong, periode, useJoursOuvrables } from "./commun";

/**
 * Mon espace : le salarié voit son solde de congés, demande une absence, suit ses demandes, lit ses
 * bulletins validés ; responsable, il tranche les demandes de son équipe. Jamais les données d'un
 * autre salarié (le noyau ne les renvoie pas).
 */
export function MonEspace() {
  const { data, error, mutate } = useApi<MySpace>("/rh/me");
  const [demande, setDemande] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} onRetry={() => mutate()} />;
  if (!data) return <Loading label="Chargement de votre espace…" />;
  const e = data.employee;

  if (!e) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Mon espace" />
        <Card>
          <Empty title="Aucun dossier salarié n'est lié à votre compte" hint="Voyez le service RH : il rattache votre compte NIMOVA à votre dossier, et vous retrouvez ici vos congés et vos bulletins de paie." />
        </Card>
      </div>
    );
  }

  async function annuler(l: Leave) {
    if (!(await demanderConfirmation(`Annuler votre demande (${l.type.name}, ${periode(l.date_from, l.date_to, l.half_day)}) ?`, { action: "Annuler la demande", danger: true }))) return;
    setErreur(null);
    try {
      await apiSend("POST", `/rh/me/leaves/${l.id}/cancel`);
      void mutate();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  }

  const aujourdhui = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <PageHeader
        title={`Bonjour, ${e.name.split(" ")[0]}`}
        subtitle={`${e.job_title ?? "Salarié"}${e.department ? `, ${e.department.name}` : ""}, ${e.company}. Vos congés, vos demandes et vos bulletins de paie.`}
        actions={
          <Button variant="primary" onClick={() => setDemande(true)}>
            <Plus className="h-4 w-4" /> Demander une absence
          </Button>
        }
      />
      {erreur && (
        <div className="mb-4">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Solde de congés" value={data.balance ? jours(data.balance.balance) : "–"} hint={data.balance?.pending ? `${jours(data.balance.pending)} en attente de validation` : "Acquis au fil des mois de service"} tone={data.balance && data.balance.balance < 0 ? "danger" : "ok"} />
        <Kpi label="Ancienneté" value={`${fmtDec(e.seniority_years)} an(s)`} hint={`Depuis le ${fmtDate(e.hire_date)}, ${CONTRACT_LABELS[e.contract_type]}`} />
        <Kpi label="Dernier bulletin" value={data.payslips[0] ? fmtGNF(data.payslips[0].net) : "–"} hint={data.payslips[0] ? `Net de ${moisLong(data.payslips[0].month)}` : "Aucun bulletin validé"} />
      </div>

      {data.team_pending.length > 0 && (
        <Card className="mb-6" title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-accent" /> Demandes de votre équipe</span>}>
          <ul className="divide-y divide-line/70">
            {data.team_pending.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <div className="font-semibold text-ink">{l.employee.name}</div>
                  <div className="text-ink-2">
                    {l.type.name}, {periode(l.date_from, l.date_to, l.half_day)} : {jours(l.days)}
                  </div>
                  {l.note && <div className="mt-1 text-[12.5px] text-muted">{l.note}</div>}
                </div>
                <DecisionAbsence leave={l} peutForcer={false} onDone={() => mutate()} compact />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7" title={<span className="flex items-center gap-2"><Calendar className="h-4 w-4 text-accent" /> Mes absences</span>}>
          {data.leaves.length === 0 ? (
            <Empty title="Aucune absence" hint="Vos demandes apparaissent ici, avec leur état : à valider, approuvée, refusée." />
          ) : (
            <ul className="divide-y divide-line/70">
              {data.leaves.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{l.type.name}</div>
                    <div className="text-[12.5px] text-muted">
                      {periode(l.date_from, l.date_to, l.half_day)}, {jours(l.days)}
                      {l.refusal_reason ? ` ; motif du refus : ${l.refusal_reason}` : ""}
                    </div>
                  </div>
                  <span className="flex items-center gap-2">
                    <EtatAbsence state={l.state} />
                    {(l.state === "submitted" || (l.state === "approved" && l.date_from > aujourdhui)) && (
                      <Button variant="ghost" size="sm" onClick={() => void annuler(l)}>
                        Annuler
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6 lg:col-span-5">
          <Card title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-accent" /> Mes bulletins de paie</span>}>
            {data.payslips.length === 0 ? (
              <p className="text-sm text-muted">Aucun bulletin validé pour l&apos;instant.</p>
            ) : (
              <DataTable
                dense
                rows={data.payslips}
                rowKey={(p) => p.id}
                columns={[
                  { key: "month", label: "Mois", render: (p) => <span className="capitalize">{moisLong(p.month)}</span> },
                  { key: "net", label: "Net", align: "right", render: (p) => fmtGNF(p.net) },
                  {
                    key: "x",
                    label: "",
                    align: "right",
                    render: (p) => (
                      <Link href={`/rh/moi/bulletins/${p.id}`}>
                        <Button size="sm">Ouvrir</Button>
                      </Link>
                    ),
                  },
                ]}
              />
            )}
          </Card>
          <Card title="Mon dossier">
            <dl>
              <Ligne label="Matricule">{e.matricule}</Ligne>
              <Ligne label="Fonction">{e.job_title ?? "–"}</Ligne>
              <Ligne label="Responsable">{e.manager?.name ?? "–"}</Ligne>
              <Ligne label="Téléphone">{e.phone ?? "–"}</Ligne>
              <Ligne label="Courriel">{e.email ?? "–"}</Ligne>
            </dl>
            <p className="mt-3 text-[12.5px] text-muted">Une information à corriger ? Signalez-la au service RH.</p>
          </Card>
          {data.team_upcoming.length > 0 && (
            <Card title="Absences à venir dans l'équipe">
              <ul className="space-y-1.5 text-sm">
                {data.team_upcoming.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="font-medium text-ink">{l.employee.name}</span>
                    <span className="text-muted">{periode(l.date_from, l.date_to, l.half_day)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.manages_rh && (
            <p className="text-[12.5px] text-muted">
              Vous gérez aussi l&apos;espace RH :{" "}
              <Link className="font-semibold text-accent hover:underline" href="/rh">
                tableau de bord
              </Link>
              .
            </p>
          )}
        </div>
      </div>
      {demande && (
        <DemandeAbsence
          types={data.leave_types}
          solde={data.balance?.balance ?? null}
          onClose={() => setDemande(false)}
          onDone={() => {
            setDemande(false);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function DemandeAbsence({ types, solde, onClose, onDone }: { types: LeaveType[]; solde: number | null; onClose: () => void; onDone: () => void }) {
  const actifs = types.filter((t) => t.active);
  const [typeId, setTypeId] = useState(String(actifs[0]?.id ?? ""));
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [demi, setDemi] = useState(false);
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { days, error: erreurJours } = useJoursOuvrables(du, au || du, demi);
  const type = actifs.find((t) => String(t.id) === typeId);
  const depasse = type?.deducts_balance && solde !== null && days !== null && days > solde;

  async function envoyer() {
    setBusy(true);
    setErreur(null);
    try {
      await apiSend("POST", "/rh/me/leaves", { type_id: Number(typeId), date_from: du, date_to: au || du, half_day: demi && (!au || au === du), note: note.trim() || null });
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
      title="Demander une absence"
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!typeId || !du || Boolean(erreurJours)} onClick={envoyer}>
          Envoyer la demande
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {erreur && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{erreur}</Notice>
          </div>
        )}
        <Field label="Type d'absence" className="sm:col-span-2">
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} options={actifs.map((t) => ({ value: t.id, label: `${t.name}${t.paid ? "" : " (non rémunérée)"}` }))} />
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
          {erreurJours ? <span className="text-danger">{erreurJours}</span> : days !== null ? <span className="text-ink-2">Durée : <b>{jours(days)} ouvrable(s)</b></span> : null}
          {depasse && <span className="mt-1 block text-warn">Votre solde ({jours(solde)}) ne couvre pas cette demande : le service RH devra l&apos;accepter.</span>}
          {type && !type.paid && <span className="mt-1 block text-warn">Absence non rémunérée : retenue sur votre salaire du mois.</span>}
          {type?.needs_document && <span className="mt-1 block text-muted">Un justificatif sera demandé : remettez-le au service RH.</span>}
        </div>
        <Field label="Motif ou commentaire" className="sm:col-span-2">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-[12.5px] text-muted sm:col-span-2">La demande part à votre responsable et au service RH ; vous suivez sa réponse ici.</p>
      </div>
    </Modal>
  );
}
