"use client";

/**
 * Briques communes de NIMOVA · RH : référentiels, pastilles d'état, choix d'un salarié, saisie d'un
 * montant, nombre de jours ouvrables, boutons de décision sur une absence. Les libellés viennent du
 * noyau (GET /rh/meta) ; ceux de rh-types.ts servent quand la liste n'est pas encore chargée.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Check, X } from "@/components/icons";
import { Badge, Button, Field, Input, Modal, Notice, Select, Textarea, type Tone } from "@/components/ui";
import { ApiError, apiGet, apiSend, useApi } from "@/lib/api-client";
import { fmtDec } from "@/lib/format";
import {
  LEAVE_STATE_LABELS,
  PAYROLL_STATE_LABELS,
  STATE_LABELS,
  type EmployeeState,
  type Leave,
  type LeaveState,
  type Meta,
  type Option,
  type PayrollState,
} from "@/lib/rh-types";

/** Référentiels de l'espace RH (départements, rubriques, types d'absence, listes de choix). */
export function useMeta() {
  return useApi<Meta>("/rh/meta");
}

/** Message d'une erreur d'appel, tel que le noyau l'a rédigé. */
export function messageErreur(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Une erreur est survenue.";
}

/** « 1 250 000 », « 1 250 000,5 » ou « 1250000 » vers un nombre (vide : 0). */
export function nombre(v: string): number {
  const n = Number(v.replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Libellé d'une option d'une liste du noyau, à défaut le code. */
export function libelle<K extends string>(options: Option<K>[] | undefined, code: K | null | undefined, repli?: Record<string, string>): string {
  if (!code) return "–";
  return options?.find((o) => o.code === code)?.label ?? repli?.[code] ?? code;
}

const TON_ETAT: Record<EmployeeState, Tone> = { a_venir: "accent", essai: "warn", actif: "ok", sorti: "neutral" };
export function EtatSalarie({ state }: { state: EmployeeState }) {
  return <Badge tone={TON_ETAT[state]}>{STATE_LABELS[state]}</Badge>;
}

const TON_ABSENCE: Record<LeaveState, Tone> = { submitted: "warn", approved: "ok", refused: "danger", cancelled: "neutral" };
export function EtatAbsence({ state }: { state: LeaveState }) {
  return (
    <Badge tone={TON_ABSENCE[state]} vivant={state === "submitted"}>
      {LEAVE_STATE_LABELS[state]}
    </Badge>
  );
}

const TON_PAIE: Record<PayrollState, Tone> = { draft: "warn", validated: "accent", accounted: "ok" };
export function EtatPaie({ state }: { state: PayrollState }) {
  return <Badge tone={TON_PAIE[state]}>{PAYROLL_STATE_LABELS[state]}</Badge>;
}

/** « 12 j », « 0,5 j ». */
export function jours(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : `${fmtDec(n)} j`;
}

/** Période d'une absence : « du 03/11 au 07/11/2026 », ou le jour seul. */
export function periode(from: string, to: string, half?: boolean): string {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  if (from === to) return `${f.toLocaleDateString("fr-FR")}${half ? " (demi-journée)" : ""}`;
  const memeAnnee = f.getFullYear() === t.getFullYear();
  const debut = f.toLocaleDateString("fr-FR", memeAnnee ? { day: "2-digit", month: "2-digit" } : undefined);
  return `du ${debut} au ${t.toLocaleDateString("fr-FR")}`;
}

/** Mois « AAAA-MM-01 » en toutes lettres : « octobre 2026 ». */
export function moisLong(month: string): string {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? month : d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

/** Premier jour du mois courant, « AAAA-MM-01 ». */
export function moisCourant(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Choix d'un salarié actif parmi les référentiels. */
export function ChoixSalarie({ meta, value, onChange, placeholder = "Choisir un salarié" }: { meta: Meta | undefined; value: number | null; onChange: (id: number | null) => void; placeholder?: string }) {
  return (
    <Select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      placeholder={placeholder}
      options={(meta?.employees ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.matricule})` }))}
    />
  );
}

/** Champ de montant en GNF, saisi librement (espaces acceptés). */
export function ChampMontant({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return <Input inputMode="numeric" className="font-mono" value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * Nombre de jours ouvrables d'une période (lundi au samedi, fériés exclus), calculé par le noyau
 * pendant la saisie. null tant que la période est incomplète ou incohérente.
 */
export function useJoursOuvrables(from: string, to: string, half: boolean): { days: number | null; error: string | null } {
  const [state, setState] = useState<{ days: number | null; error: string | null }>({ days: null, error: null });
  useEffect(() => {
    if (!from || !to || to < from) {
      setState({ days: null, error: from && to && to < from ? "La fin précède le début." : null });
      return;
    }
    let abandon = false;
    const t = window.setTimeout(() => {
      apiGet<{ days: number }>(`/rh/leaves/days?date_from=${from}&date_to=${to}&half_day=${half && from === to ? 1 : 0}`)
        .then((r) => !abandon && setState({ days: r.days, error: null }))
        .catch((e) => !abandon && setState({ days: null, error: messageErreur(e) }));
    }, 250);
    return () => {
      abandon = true;
      window.clearTimeout(t);
    };
  }, [from, to, half]);
  return state;
}

/**
 * Approuver ou refuser une demande d'absence. Solde insuffisant (422 insufficient_balance) : qui écrit
 * peut approuver quand même ; la direction et le responsable voient le motif.
 */
export function DecisionAbsence({ leave, peutForcer, onDone, compact }: { leave: Leave; peutForcer: boolean; onDone: () => void; compact?: boolean }) {
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [soldeInsuffisant, setSoldeInsuffisant] = useState<string | null>(null);

  async function approuver(force = false) {
    setBusy(true);
    setErreur(null);
    try {
      await apiSend("POST", `/rh/leaves/${leave.id}/approve`, { force });
      setSoldeInsuffisant(null);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "insufficient_balance") setSoldeInsuffisant(e.message);
      else setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }

  async function refuser() {
    setBusy(true);
    setErreur(null);
    try {
      await apiSend("POST", `/rh/leaves/${leave.id}/refuse`, { reason: motif });
      setRefus(false);
      onDone();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }

  const taille = compact ? "px-2 py-1 text-xs min-h-0" : undefined;
  return (
    <>
      <span className="flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="primary" className={taille} loading={busy && !refus} onClick={() => approuver(false)}>
          <Check className="h-3.5 w-3.5" /> Approuver
        </Button>
        <Button variant="danger" className={taille} disabled={busy} onClick={() => setRefus(true)}>
          <X className="h-3.5 w-3.5" /> Refuser
        </Button>
      </span>
      {erreur && !refus && (
        <div className="mt-2">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      {soldeInsuffisant !== null && (
        <Modal
          open
          title="Solde de congés insuffisant"
          onClose={() => setSoldeInsuffisant(null)}
          footer={
            peutForcer ? (
              <Button variant="primary" loading={busy} onClick={() => approuver(true)}>
                Approuver quand même
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-3 text-sm">
            <Notice tone="warn">{soldeInsuffisant}</Notice>
            <p className="text-ink-2">
              {peutForcer
                ? `Approuver quand même rend le solde de ${leave.employee.name} négatif : les jours seront repris sur les acquisitions des mois suivants.`
                : "Seul le service RH peut approuver une absence au-delà du solde acquis."}
            </p>
          </div>
        </Modal>
      )}
      {refus && (
        <Modal
          open
          title={`Refuser la demande de ${leave.employee.name}`}
          onClose={() => setRefus(false)}
          footer={
            <Button variant="danger" loading={busy} disabled={!motif.trim()} onClick={refuser}>
              Refuser la demande
            </Button>
          }
        >
          <div className="space-y-3">
            {erreur && <Notice tone="danger">{erreur}</Notice>}
            <p className="text-sm text-ink-2">
              {leave.type.name}, {periode(leave.date_from, leave.date_to, leave.half_day)} ({jours(leave.days)}). Le motif est communiqué au salarié.
            </p>
            <Field label="Motif du refus">
              <Textarea rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Ligne « libellé : valeur » d'une fiche en lecture. */
export function Ligne({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 border-b border-line/70 py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children ?? "–"}</dd>
    </div>
  );
}
