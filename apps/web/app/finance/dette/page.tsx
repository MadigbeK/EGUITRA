"use client";

import { useState } from "react";
import { Pencil, Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Kpi, Modal, Notice, PageHeader, Select, demanderConfirmation } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { apiSend, useApi, useAutorise, useSaisieLibre } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { aujourdhui } from "@/lib/jour";
import type { Account, DebtSummary, Journal } from "@/lib/finance-types";
import { AIDE_NOMBRE, fmtDate, fmtGNF, fmtPct, fmtRatio, fmtShort, lireNombre, nombreIllisible, pluriel } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes d'écriture de la dette (addons/eguitra_finance/controllers/loans.py, FIN_WRITE) : saisie,
// correction du brouillon, objet, mise en service, règlement d'une échéance. La direction lit seulement.
const ECRITURE: Profile[] = ["admin", "finance"];

interface Loan {
  id: number;
  name: string;
  purpose: string | null;
  kind: "loan" | "lease";
  lender: { id: number; name: string };
  principal: number;
  annual_rate: number;
  start_date: string;
  first_due_date: string | null;
  duration_months: number;
  grace_months: number;
  periodicity: string;
  method: string;
  state: "draft" | "active" | "closed";
  outstanding: number;
  principal_account: string | null;
  interest_account: string | null;
  journal: string | null;
  principal_account_id: number | null;
  interest_account_id: number | null;
  journal_id: number | null;
  // settlement : pending, règlement soumis au circuit des décaissements (comptabilisé à la dernière
  // approbation) ; rejected, refusé (« Régler » en soumet un nouveau) ; draft, pièce en brouillon hors circuit.
  schedule?: Array<{ id: number; sequence: number; due_date: string; principal: number; interest: number; total: number; remaining: number; paid: boolean; settlement?: "paid" | "pending" | "rejected" | "draft" | "due"; statement_line_id: number | null }>;
}

const STATE = { draft: { label: "Brouillon", tone: "neutral" as const }, active: { label: "En cours", tone: "accent" as const }, closed: { label: "Soldé", tone: "ok" as const } };

export default function DebtPage() {
  const { data, error, mutate } = useApi<{ items: Loan[]; summary: DebtSummary }>("/finance/loans");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const ecriture = useAutorise(ECRITURE);
  const { data: seuils } = useApi<Array<{ code: string; value: number; active: boolean }>>("/finance/thresholds");
  // Minimum de la règle d'alerte ; null : seuil à 0 ou désactivé (règle éteinte), le DSCR n'est pas jugé.
  const dscrMin = seuils?.find((t) => t.code === "dscr_min" && t.active && t.value)?.value ?? null;
  return (
    <div>
      <PageHeader
        title="Dette et financement"
        subtitle="Emprunts et crédits-bails : échéanciers, règlements comptabilisés, encours comptable, service de la dette et ratios."
        actions={
          ecriture ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Nouveau financement
            </Button>
          ) : undefined
        }
      />
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des financements…">
        {(d) => {
          const s = d.summary;
          const ecart = Math.abs(s.schedule_gap ?? 0) >= 1;
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Encours comptable" value={fmtShort(s.accounting_outstanding)} hint={`Comptes 16 et 17 · ${pluriel(s.loans, "financement")}`} tone="accent" />
                <Kpi label="Capital restant dû des échéanciers" value={fmtShort(s.outstanding)} hint={ecart ? `Écart avec la comptabilité : ${fmtShort(s.schedule_gap)}` : "Conforme à la comptabilité"} tone={ecart ? "warn" : "ok"} />
                <Kpi label="Dette nette" value={fmtShort(s.net_debt)} hint="Encours comptable moins la trésorerie" />
                <Kpi label="Gearing" value={fmtRatio(s.gearing)} hint={s.equity !== undefined && s.equity <= 0 ? "Capitaux propres négatifs ou nuls" : "Dette / capitaux propres"} tone={(s.gearing ?? 0) > 1 ? "warn" : "neutral"} />
                <Kpi label="Dette / EBE 12 mois" value={fmtRatio(s.debt_to_ebe)} hint={(s.ebe_12m ?? 0) <= 0 ? "EBE des 12 derniers mois négatif ou nul" : `EBE 12 mois : ${fmtShort(s.ebe_12m)}`} />
                <Kpi label="DSCR" value={fmtRatio(s.dscr)} hint={`EBE 12 mois / service de la dette, ${dscrMin ? `minimum ${fmtRatio(dscrMin)}` : "minimum : seuil non fixé"}`} tone={s.dscr === null || s.dscr === undefined || dscrMin === null ? "neutral" : s.dscr < dscrMin ? "danger" : "ok"} />
                <Kpi label="Service de la dette de l'exercice" value={fmtShort(s.service_fy)} hint={`Réglé : ${fmtShort(s.service_fy_paid)} · intérêts ${fmtShort(s.service_fy_interest)}`} />
                <Kpi label="Prochaine échéance" value={fmtShort(s.next_due_amount)} hint={s.next_due_date ? `Le ${fmtDate(s.next_due_date)}${s.overdue > 0 ? ` · impayé ${fmtShort(s.overdue)}` : ""}` : "Aucune"} tone={s.overdue > 0 ? "danger" : "neutral"} />
              </div>
              {ecart && (
                <Notice tone="warn">
                  L&apos;encours comptable (comptes 16 et 17) diffère de {fmtGNF(s.schedule_gap)} du capital restant dû des échéanciers : déblocage ou échéance non comptabilisé, ou financement non saisi. La clôture le signale.
                </Notice>
              )}
              <Card padded={false}>
                <DataTable
                  rows={d.items}
                  rowKey={(l) => l.id}
                  onRowClick={(l) => setSelected(l.id)}
                  empty="Aucun financement enregistré."
                  columns={[
                    { key: "name", label: "Référence" },
                    { key: "kind", label: "Nature", render: (l) => (l.kind === "lease" ? "Crédit-bail" : "Emprunt") },
                    { key: "lender", label: "Prêteur", render: (l) => l.lender.name },
                    { key: "purpose", label: "Objet", render: (l) => l.purpose ?? "–" },
                    { key: "principal", label: "Montant", align: "right", render: (l) => fmtGNF(l.principal) },
                    { key: "annual_rate", label: "Taux", align: "right", render: (l) => fmtPct(l.annual_rate, 2) },
                    { key: "outstanding", label: "Restant dû", align: "right", render: (l) => fmtGNF(l.outstanding) },
                    { key: "state", label: "Statut", render: (l) => <Badge tone={STATE[l.state].tone}>{STATE[l.state].label}</Badge> },
                  ]}
                />
              </Card>
            </div>
          );
        }}
      </Etat>
      {selected !== null && <LoanModal key={selected} id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
      {creating && <LoanForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); void mutate(); setSelected(id); }} />}
    </div>
  );
}

function LoanModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: loan, error: erreurChargement, mutate } = useApi<Loan>(`/finance/loans/${id}`);
  const ecriture = useAutorise(ECRITURE);
  const envoi = useEnvoi();
  const [objet, setObjet] = useState<string | null>(null);
  const [correction, setCorrection] = useState(false);
  async function agir(cle: string, fn: () => Promise<unknown>, ok: string) {
    return envoi.run(cle, async () => {
      await fn();
      await mutate();
      onChanged();
    }, ok);
  }
  async function mettreEnService() {
    if (!loan) return;
    const oui = await demanderConfirmation(
      `Mettre le financement ${loan.name} en service ? Son échéancier est arrêté et ne se modifiera plus ; ses échéances se règleront depuis le relevé bancaire ou par « Régler ».`,
      { action: "Mettre en service", danger: true },
    );
    if (oui) await agir("service", () => apiSend("POST", `/finance/loans/${loan.id}/activate`), "Financement mis en service.");
  }
  async function regler(ligne: NonNullable<Loan["schedule"]>[number]) {
    if (!loan) return;
    const oui = await demanderConfirmation(
      `Régler l'échéance n° ${ligne.sequence} du ${fmtDate(ligne.due_date)} ? La sortie de ${fmtGNF(ligne.total)} est comptabilisée sur ${loan.journal ?? "le journal de règlement"}, capital et intérêts en contrepartie.`,
      { action: "Régler l'échéance", danger: true },
    );
    if (!oui) return;
    let retenue = false;
    const ok = await agir(`regler-${ligne.id}`, async () => {
      const apres = await apiSend<Loan>("POST", `/finance/loans/lines/${ligne.id}/pay`, {});
      retenue = apres.schedule?.find((x) => x.id === ligne.id)?.settlement === "pending";
    }, `Échéance n° ${ligne.sequence} réglée.`);
    // Au-delà du seuil des décaissements, le règlement attend l'approbation : il n'est pas encore comptabilisé.
    if (ok && retenue) envoi.setMessage({ tone: "ok", text: `Règlement de l'échéance n° ${ligne.sequence} soumis à l'approbation (À valider) : il sera comptabilisé à la dernière approbation.` });
  }
  const brouillon = loan?.state === "draft";
  return (
    <Modal
      open
      wide
      title={loan ? `${loan.name}, ${loan.lender.name}` : "Financement"}
      onClose={onClose}
      footer={
        loan && brouillon && ecriture ? (
          <>
            <Button disabled={!!envoi.busy} onClick={() => setCorrection(true)}>
              <Pencil className="h-4 w-4" /> Corriger le brouillon
            </Button>
            <Button variant="primary" loading={envoi.busy === "service"} disabled={!!envoi.busy} onClick={mettreEnService}>
              Mettre en service
            </Button>
          </>
        ) : undefined
      }
    >
      <Etat data={loan} error={erreurChargement} onRetry={() => mutate()} label="Chargement du financement…">
        {(l) => (
          <div className="space-y-4">
            {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
            {ecriture ? (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Objet du financement" className="min-w-0 flex-1">
                  <Input value={objet ?? l.purpose ?? ""} onChange={(e) => setObjet(e.target.value)} placeholder="Acquisition de camions, fonds de roulement…" />
                </Field>
                <Button
                  loading={envoi.busy === "objet"}
                  disabled={!!envoi.busy || objet === null || objet === (l.purpose ?? "")}
                  onClick={async () => {
                    if (await agir("objet", () => apiSend("PATCH", `/finance/loans/${l.id}`, { purpose: objet }), "Objet enregistré.")) setObjet(null);
                  }}
                >
                  Enregistrer l&apos;objet
                </Button>
              </div>
            ) : (
              <p className="text-sm text-ink-2">Objet : {l.purpose ?? "–"}</p>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><div className="text-xs text-muted">Montant</div>{fmtGNF(l.principal)}</div>
              <div><div className="text-xs text-muted">Taux annuel</div>{fmtPct(l.annual_rate, 2)}</div>
              <div><div className="text-xs text-muted">Durée</div>{pluriel(l.duration_months, "mois", "mois")}{l.grace_months ? `, dont ${pluriel(l.grace_months, "mois", "mois")} de différé` : ""}</div>
              <div><div className="text-xs text-muted">Déblocage</div>{fmtDate(l.start_date)}</div>
              <div><div className="text-xs text-muted">Compte de dette</div>{l.principal_account ?? "À renseigner"}</div>
              <div><div className="text-xs text-muted">Compte d&apos;intérêts</div>{l.interest_account ?? "À renseigner"}</div>
              <div className="col-span-2"><div className="text-xs text-muted">Journal de règlement</div>{l.journal ?? "À renseigner"}</div>
            </div>
            {brouillon && (
              <p className="text-[12.5px] leading-snug text-muted">
                Brouillon : l&apos;échéancier se corrige et se recalcule tant que le financement n&apos;est pas mis en service. La mise en service exige le compte de dette, le compte d&apos;intérêts et le journal.
              </p>
            )}
            {l.state === "active" && (
              <p className="text-[12.5px] leading-snug text-muted">
                Échéance prélevée sur un compte bancaire dont vous importez les relevés : réglez-la depuis la ligne du relevé (Trésorerie, Rapprocher), qui propose l&apos;échéance. « Régler » ci-dessous comptabilise la sortie directement sur {l.journal ?? "le journal de règlement"} : à réserver à la caisse et aux comptes sans relevé, sinon la sortie serait comptée deux fois.
              </p>
            )}
            <DataTable
              dense
              rows={l.schedule ?? []}
              rowKey={(e) => e.id}
              empty="Aucune échéance : l'échéancier se calcule à l'enregistrement."
              columns={[
                { key: "sequence", label: "N°", align: "right", render: (e) => String(e.sequence) },
                { key: "due_date", label: "Échéance", render: (e) => fmtDate(e.due_date) },
                { key: "principal", label: "Capital", align: "right", render: (e) => fmtGNF(e.principal) },
                { key: "interest", label: "Intérêts", align: "right", render: (e) => fmtGNF(e.interest) },
                { key: "total", label: "Total", align: "right", render: (e) => fmtGNF(e.total) },
                { key: "remaining", label: "Restant dû", align: "right", render: (e) => fmtGNF(e.remaining) },
                {
                  key: "paid",
                  label: "",
                  align: "right",
                  render: (e) =>
                    e.paid ? (
                      <Badge tone="ok">{e.statement_line_id ? "Rapprochée du relevé" : "Réglée"}</Badge>
                    ) : e.settlement === "pending" ? (
                      <Badge tone="warn">En attente d&apos;approbation</Badge>
                    ) : e.settlement === "draft" ? (
                      <Badge tone="warn">Règlement en brouillon</Badge>
                    ) : l.state === "active" && ecriture ? (
                      <Button size="sm" loading={envoi.busy === `regler-${e.id}`} disabled={!!envoi.busy} onClick={() => regler(e)}>
                        Régler
                      </Button>
                    ) : null,
                },
              ]}
            />
          </div>
        )}
      </Etat>
      {correction && loan && (
        <LoanForm
          loan={loan}
          onClose={() => setCorrection(false)}
          onSaved={() => {
            setCorrection(false);
            envoi.setMessage({ tone: "ok", text: "Brouillon corrigé : échéancier recalculé." });
            void mutate();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

/** Texte d'un nombre reçu du noyau, repris dans un champ (virgule décimale). */
const champ = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

/**
 * Saisie d'un financement, ou correction d'un brouillon (loan) : l'échéancier est recalculé par le noyau.
 * Les comptes de dette et d'intérêts relèvent du droit « Saisie libre des comptes » : sans lui, ils ne
 * s'affichent pas et restent ceux du brouillon (un compte qui a le droit les fixe avant la mise en service).
 */
function LoanForm({ loan, onClose, onSaved }: { loan?: Loan; onClose: () => void; onSaved: (id: number) => void }) {
  const libre = useSaisieLibre();
  const { data: debtAccounts } = useApi<Account[]>(libre ? "/finance/accounts?prefix=1&limit=500" : null);
  const { data: interestAccounts } = useApi<Account[]>(libre ? "/finance/accounts?prefix=67&limit=200" : null);
  const { data: journals } = useApi<Journal[]>("/finance/journals?type=bank,cash");
  const [lender, setLender] = useState<{ id: number; name: string } | null>(loan?.lender ?? null);
  const [f, setF] = useState({
    name: loan?.name ?? "",
    purpose: loan?.purpose ?? "",
    kind: loan?.kind ?? "loan",
    principal: champ(loan?.principal),
    annual_rate: champ(loan?.annual_rate),
    start_date: loan?.start_date ?? aujourdhui(),
    first_due_date: loan?.first_due_date ?? "",
    duration_months: loan ? String(loan.duration_months) : "36",
    grace_months: loan ? String(loan.grace_months) : "0",
    periodicity: loan?.periodicity ?? "monthly",
    method: loan?.method ?? "annuity",
    principal_account_id: loan?.principal_account_id ? String(loan.principal_account_id) : "",
    interest_account_id: loan?.interest_account_id ? String(loan.interest_account_id) : "",
    journal_id: loan?.journal_id ? String(loan.journal_id) : "",
  });
  const envoi = useEnvoi();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = { principal: lireNombre(f.principal), annual_rate: lireNombre(f.annual_rate), duration_months: lireNombre(f.duration_months), grace_months: lireNombre(f.grace_months) };
  const entier = (v: number | null, min: number) => v === null || (Number.isInteger(v) && v >= min);
  const erreurs = {
    principal: nombreIllisible(f.principal) ? AIDE_NOMBRE : n.principal !== null && n.principal <= 0 ? "Montant positif attendu." : undefined,
    annual_rate: nombreIllisible(f.annual_rate) ? AIDE_NOMBRE : n.annual_rate !== null && n.annual_rate < 0 ? "Taux positif ou nul attendu." : undefined,
    duration_months: nombreIllisible(f.duration_months) ? AIDE_NOMBRE : !entier(n.duration_months, 1) ? "Nombre entier de mois, au moins 1." : undefined,
    grace_months: nombreIllisible(f.grace_months)
      ? AIDE_NOMBRE
      : !entier(n.grace_months, 0)
        ? "Nombre entier de mois."
        : n.grace_months !== null && n.duration_months !== null && n.grace_months >= n.duration_months
          ? "Le différé doit être plus court que la durée."
          : undefined,
  };
  const complet = Boolean(f.name.trim() && lender && f.start_date) && Object.values(n).every((v) => v !== null);
  const pret = complet && !Object.values(erreurs).some(Boolean);
  async function submit() {
    const body = {
      name: f.name.trim(),
      purpose: f.purpose,
      kind: f.kind,
      partner_id: lender?.id,
      principal: n.principal,
      annual_rate: n.annual_rate,
      start_date: f.start_date,
      first_due_date: f.first_due_date || null,
      duration_months: n.duration_months,
      grace_months: n.grace_months,
      periodicity: f.periodicity,
      method: f.method,
      journal_id: f.journal_id ? Number(f.journal_id) : null,
      // Sans le droit de saisie libre, les comptes ne sont pas envoyés : ceux du brouillon restent.
      ...(libre ? { principal_account_id: f.principal_account_id ? Number(f.principal_account_id) : null, interest_account_id: f.interest_account_id ? Number(f.interest_account_id) : null } : {}),
    };
    const enregistre: { id?: number } = {};
    const ok = await envoi.run("enregistrer", async () => {
      const saved = loan ? await apiSend<Loan>("PATCH", `/finance/loans/${loan.id}`, body) : await apiSend<Loan>("POST", "/finance/loans", body);
      enregistre.id = saved.id;
    }, undefined, "Enregistrement impossible.");
    if (ok && enregistre.id !== undefined) onSaved(enregistre.id);
  }
  return (
    <Modal
      open
      wide
      title={loan ? `Corriger le brouillon, ${loan.name}` : "Nouveau financement"}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={envoi.busy === "enregistrer"} onClick={submit} disabled={!pret || !!envoi.busy}>
          {loan ? "Recalculer l'échéancier" : "Calculer l'échéancier"}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {envoi.message && (
          <div className="md:col-span-3">
            <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>
          </div>
        )}
        <Field label="Référence">
          <Input value={f.name} onChange={set("name")} placeholder="Emprunt BICIGUI 2026-01" />
        </Field>
        <Field label="Prêteur" className="md:col-span-2">
          <PartnerPicker value={lender} onChange={setLender} kind="supplier" />
        </Field>
        <Field label="Objet" className="md:col-span-3">
          <Input value={f.purpose} onChange={set("purpose")} placeholder="Acquisition de camions, fonds de roulement…" />
        </Field>
        <Field label="Nature">
          <Select value={f.kind} onChange={set("kind")} options={[{ value: "loan", label: "Emprunt" }, { value: "lease", label: "Crédit-bail" }]} />
        </Field>
        <Field label="Montant (GNF)" error={erreurs.principal}>
          <Input inputMode="numeric" className="font-mono" value={f.principal} onChange={set("principal")} />
        </Field>
        <Field label="Taux annuel (%)" hint="0 pour un prêt sans intérêt" error={erreurs.annual_rate}>
          <Input inputMode="decimal" value={f.annual_rate} onChange={set("annual_rate")} />
        </Field>
        <Field label="Déblocage">
          <Input type="date" value={f.start_date} onChange={set("start_date")} />
        </Field>
        <Field label="Première échéance" hint="Vide : une période après le déblocage">
          <Input type="date" value={f.first_due_date} min={f.start_date || undefined} onChange={set("first_due_date")} />
        </Field>
        <Field label="Durée (mois)" error={erreurs.duration_months}>
          <Input inputMode="numeric" value={f.duration_months} onChange={set("duration_months")} />
        </Field>
        <Field label="Différé (mois)" hint="Intérêts seuls pendant le différé ; 0 sans différé" error={erreurs.grace_months}>
          <Input inputMode="numeric" value={f.grace_months} onChange={set("grace_months")} />
        </Field>
        <Field label="Périodicité">
          <Select value={f.periodicity} onChange={set("periodicity")} options={[{ value: "monthly", label: "Mensuelle" }, { value: "quarterly", label: "Trimestrielle" }, { value: "semiannual", label: "Semestrielle" }, { value: "annual", label: "Annuelle" }]} />
        </Field>
        <Field label="Méthode">
          <Select value={f.method} onChange={set("method")} options={[{ value: "annuity", label: "Échéances constantes" }, { value: "linear", label: "Capital constant" }]} />
        </Field>
        <Field label="Journal de règlement">
          <Select value={f.journal_id} onChange={set("journal_id")} placeholder="Choisir…" options={(journals ?? []).map((j) => ({ value: j.id, label: j.name }))} />
        </Field>
        {libre ? (
          <>
            <Field label="Compte de dette">
              <Select value={f.principal_account_id} onChange={set("principal_account_id")} placeholder="16x ou 17x" options={(debtAccounts ?? []).filter((a) => /^1[67]/.test(a.code)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
            </Field>
            <Field label="Compte d'intérêts">
              <Select value={f.interest_account_id} onChange={set("interest_account_id")} placeholder="67x" options={(interestAccounts ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
            </Field>
          </>
        ) : (
          <p className="text-[12.5px] leading-snug text-muted md:col-span-2">
            Comptes de dette et d&apos;intérêts : fixés par un compte qui a le droit « Saisie libre des comptes » ; le financement ne se met en service qu&apos;une fois ses comptes et son journal renseignés.
          </p>
        )}
      </div>
    </Modal>
  );
}
