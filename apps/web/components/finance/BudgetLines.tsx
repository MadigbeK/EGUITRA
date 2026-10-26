"use client";

import { useState } from "react";
import { Download, FileUp, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Etat, Field, Input, Kpi, Modal, Notice, Segmented, Select, demanderConfirmation, type Tone } from "@/components/ui";
import { useAxes } from "./AnalyticFields";
import { ApiError, apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, MONTHS_FR, fmtDec, fmtGNF, fmtInt, fmtPct, fmtShort, lireNombre, nombreIllisible, pluriel } from "@/lib/format";
import { anneeEnCours, moisEnCours } from "@/lib/jour";
import type { Profile } from "@/lib/types";

// Profils des routes du noyau (addons/eguitra_finance/controllers/budget.py) : budgets, lignes, seuils et
// import en écriture (FIN_WRITE) ; lecture, exécution et export (FIN_READ, la direction comprise).
const ECRITURE: Profile[] = ["admin", "finance"];

type Nature = "income" | "expense" | "capex";
type View = "lignes" | "activite" | "centre_cout";

interface BudgetRef { id: number; name: string; date_from: string; budget_lines: number; underrun_pct: number }
interface Ref { id: number; name: string }
interface BudgetLine { id: number; nature: Nature; name: string; account_prefixes: string | null; residual: boolean; activity: Ref | null; cost_center: Ref | null; months: number[]; annual: number }
interface ExecLine extends BudgetLine { budget: number; actual: number; gap: number; gap_pct: number | null; status: string; status_label: string; alert: boolean; committed?: number; available?: number | null }
interface AxisRow { analytic_account_id: number | null; name: string; income_budget: number; income_actual: number; expense_budget: number; expense_actual: number; capex_budget: number; capex_actual: number; margin_budget: number; margin_actual: number }
interface Execution {
  budget: { id: number; name: string; year: number; underrun_pct: number };
  month: number;
  through: string;
  threshold_pct: number;
  underrun_pct: number;
  lines: ExecLine[];
  summary: { income_budget: number; income_actual: number; income_gap_pct: number | null; expense_budget: number; expense_actual: number; expense_gap_pct: number | null; capex_budget: number; capex_actual: number; overrun_lines: number; expense_lines: number };
  by_axis?: AxisRow[];
}

const NATURES: Record<Nature, string> = { income: "Produits", expense: "Charges", capex: "Investissements" };
const STATUS_TONE: Record<string, Tone> = { depassement: "danger", non_budgete: "danger", sous_realisation: "danger", au_dessus: "warn", en_retrait: "warn", conforme: "ok" };

/**
 * Budget par ligne budgétaire : nature, préfixes de comptes, douze mois, activité et centre de coût ;
 * cumul à fin de mois comparé au réalisé, statuts, synthèse, comparaison par axe, import et export.
 */
export function BudgetLines() {
  const { data: budgets, error: erreurBudgets, mutate: refreshBudgets } = useApi<BudgetRef[]>("/finance/budgets");
  const [budgetId, setBudgetId] = useState<number | null>(null);
  const current = budgets?.find((b) => b.id === budgetId) ?? budgets?.[0];
  const [month, setMonth] = useState(moisEnCours());
  const [view, setView] = useState<View>("lignes");
  const axisParam = view === "lignes" ? "" : `&axis=${view}`;
  const { data, error, mutate } = useApi<Execution>(current ? `/finance/budgets/${current.id}/execution?month=${month}${axisParam}` : null);
  const [modal, setModal] = useState<null | "budget" | "import" | "settings" | BudgetLine | "new">(null);
  const ecriture = useAutorise(ECRITURE);
  const envoi = useEnvoi();

  function refresh() {
    void mutate();
    void refreshBudgets();
  }

  // Liste des budgets en erreur : jamais « Aucun budget » (on en créerait un second), mais l'erreur.
  if (!budgets) return <Etat error={erreurBudgets} onRetry={() => refreshBudgets()} label="Chargement des budgets…" />;
  return (
    <div className="space-y-4">
      {erreurBudgets && <ErrorBox error={erreurBudgets} onRetry={() => refreshBudgets()} />}
      <div className="flex flex-wrap items-end gap-3">
        {budgets.length > 0 && (
          <>
            <Field label="Budget">
              <Select value={String(current?.id ?? "")} onChange={(e) => setBudgetId(Number(e.target.value))} options={budgets.map((b) => ({ value: b.id, label: b.name }))} />
            </Field>
            <Field label="Cumul à fin de">
              <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={MONTHS_FR.map((m, i) => ({ value: i + 1, label: m }))} />
            </Field>
            <Segmented
              label="Lecture"
              value={view}
              onChange={setView}
              options={[
                { key: "lignes", label: "Par ligne" },
                { key: "activite", label: "Par activité" },
                { key: "centre_cout", label: "Par centre de coût" },
              ]}
            />
          </>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {ecriture && (
            <Button onClick={() => setModal("budget")}>
              <Plus className="h-4 w-4" /> Nouveau budget
            </Button>
          )}
          {current && (
            <>
              {ecriture && (
                <Button onClick={() => setModal("import")}>
                  <FileUp className="h-4 w-4" /> Importer
                </Button>
              )}
              <Button loading={envoi.busy === "export"} disabled={!!envoi.busy} onClick={() => void envoi.telecharger("export", `/finance/budgets/${current.id}/export`, `budget_${current.id}.xlsx`)}>
                <Download className="h-4 w-4" /> Exporter
              </Button>
              {ecriture && <Button onClick={() => setModal("settings")}>Seuils</Button>}
              {ecriture && (
                <Button variant="primary" onClick={() => setModal("new")}>
                  <Plus className="h-4 w-4" /> Nouvelle ligne
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      {!current ? (
        <Card><Empty title="Aucun budget" hint={ecriture ? "Créez le budget de l'exercice, puis ses lignes ou l'import du classeur." : "La finance n'a pas encore saisi de budget."} /></Card>
      ) : (
        <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul de l'exécution du budget…">
          {(d) => {
            const s = d.summary;
            return (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Kpi label="Produits budgétés" value={fmtShort(s.income_budget)} hint={`Cumul à fin ${MONTHS_FR[d.month - 1]}`} />
                  <Kpi label="Produits réalisés" value={fmtShort(s.income_actual)} hint={`Écart ${fmtPct(s.income_gap_pct)}`} tone={(s.income_gap_pct ?? 0) < -d.underrun_pct ? "danger" : (s.income_gap_pct ?? 0) < 0 ? "warn" : "ok"} />
                  <Kpi label="Charges réalisées" value={fmtShort(s.expense_actual)} hint={`Budget ${fmtShort(s.expense_budget)}, écart ${fmtPct(s.expense_gap_pct)}`} tone={(s.expense_gap_pct ?? 0) > d.threshold_pct ? "danger" : (s.expense_gap_pct ?? 0) > 0 ? "warn" : "ok"} />
                  <Kpi label="Lignes en dépassement" value={fmtInt(s.overrun_lines)} hint={`Sur ${pluriel(s.expense_lines, "poste de charges", "postes de charges")}, seuil ${fmtPct(d.threshold_pct, 0)}`} tone={s.overrun_lines ? "warn" : "ok"} />
                </div>
                {view === "lignes" ? (
                  <Card title={`Détail par ligne budgétaire, cumul à fin ${MONTHS_FR[d.month - 1]}`} padded={false}>
                    <DataTable
                      rows={d.lines}
                      rowKey={(l) => l.id}
                      onRowClick={ecriture ? (l) => setModal(l) : undefined}
                      empty={ecriture ? "Aucune ligne budgétaire : créez-en ou importez le classeur du budget." : "Aucune ligne budgétaire."}
                      columns={[
                        { key: "nature", label: "Nature", render: (l) => <Badge>{NATURES[l.nature]}</Badge> },
                        {
                          key: "name",
                          label: "Ligne budgétaire",
                          render: (l) => (
                            <div>
                              <div className="font-medium">{l.name}</div>
                              <div className="text-[12px] text-muted">
                                {[l.residual ? "Solde résiduel de la classe 6" : l.account_prefixes, l.activity?.name, l.cost_center?.name].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                          ),
                        },
                        { key: "budget", label: "Budget cumulé (GNF)", align: "right", render: (l) => fmtInt(l.budget) },
                        { key: "actual", label: "Réalisé (GNF)", align: "right", render: (l) => fmtInt(l.actual) },
                        { key: "gap", label: "Écart (GNF)", align: "right", render: (l) => <span className={l.gap < 0 === (l.nature === "income") && Math.abs(l.gap) > 0.5 ? "text-danger" : ""}>{fmtInt(l.gap)}</span> },
                        { key: "committed", label: "Engagé (GNF)", align: "right", render: (l) => (l.nature === "income" ? "–" : fmtInt(l.committed ?? 0)) },
                        { key: "available", label: "Disponible, année (GNF)", align: "right", render: (l) => (l.available === null || l.available === undefined ? "–" : <span className={l.available < 0 ? "text-danger" : ""}>{fmtInt(l.available)}</span>) },
                        { key: "gap_pct", label: "Écart %", align: "right", render: (l) => fmtPct(l.gap_pct) },
                        { key: "status", label: "Statut", render: (l) => <Badge tone={STATUS_TONE[l.status] ?? "neutral"}>{l.status_label}</Badge> },
                      ]}
                    />
                  </Card>
                ) : (
                  <Card title={view === "activite" ? "Budget et réalisé par activité" : "Budget et réalisé par centre de coût"} padded={false}>
                    <DataTable
                      rows={d.by_axis ?? []}
                      rowKey={(r) => r.analytic_account_id ?? 0}
                      empty="Aucune ligne budgétaire."
                      columns={[
                        { key: "name", label: view === "activite" ? "Activité" : "Centre de coût" },
                        { key: "income_budget", label: "Produits budgétés (GNF)", align: "right", render: (r) => fmtInt(r.income_budget) },
                        { key: "income_actual", label: "Produits réalisés (GNF)", align: "right", render: (r) => fmtInt(r.income_actual) },
                        { key: "expense_budget", label: "Charges budgétées (GNF)", align: "right", render: (r) => fmtInt(r.expense_budget) },
                        { key: "expense_actual", label: "Charges réalisées (GNF)", align: "right", render: (r) => fmtInt(r.expense_actual) },
                        { key: "margin_budget", label: "Marge budgétée (GNF)", align: "right", render: (r) => fmtInt(r.margin_budget) },
                        { key: "margin_actual", label: "Marge réalisée (GNF)", align: "right", render: (r) => <span className={r.margin_actual < r.margin_budget ? "text-danger" : "text-ok"}>{fmtInt(r.margin_actual)}</span> },
                      ]}
                    />
                    <p className="px-5 py-3 text-xs text-muted">Une ligne budgétaire affectée à une activité ou à un centre de coût ne retient que les écritures imputées à ce compte analytique ; les autres lignes figurent sous « Non affecté ».</p>
                  </Card>
                )}
              </>
            );
          }}
        </Etat>
      )}
      {modal === "budget" && <NewBudget onClose={() => setModal(null)} onDone={(id) => { setModal(null); void refreshBudgets(); setBudgetId(id); }} />}
      {modal === "import" && current && <ImportBudget budgetId={current.id} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "settings" && current && <BudgetSettings budget={current} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {current && (modal === "new" || (modal && typeof modal === "object")) && (
        <LineForm budgetId={current.id} line={modal === "new" ? null : (modal as BudgetLine)} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
    </div>
  );
}

function NewBudget({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const year = anneeEnCours();
  const [name, setName] = useState(`Budget ${year}`);
  const [y, setY] = useState(String(year));
  const envoi = useEnvoi();
  const exercice = lireNombre(y);
  const erreurExercice = exercice === null || !Number.isInteger(exercice) || exercice < 2000 || exercice > 2100 ? "Année sur quatre chiffres, par exemple 2026." : undefined;
  async function creer() {
    let id: number | null = null;
    const ok = await envoi.run("creer", async () => {
      id = (await apiSend<{ id: number }>("POST", "/finance/budgets", { name: name.trim(), year: exercice })).id;
    }, undefined, "Création impossible.");
    if (ok && id !== null) onDone(id);
  }
  return (
    <Modal open title="Nouveau budget" onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "creer"} disabled={!name.trim() || !!erreurExercice || !!envoi.busy} onClick={() => void creer()}>Créer</Button>}>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <Field label="Nom">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Exercice" error={y.trim() ? erreurExercice : undefined}>
          <Input inputMode="numeric" value={y} onChange={(e) => setY(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function BudgetSettings({ budget, onClose, onDone }: { budget: BudgetRef; onClose: () => void; onDone: () => void }) {
  const [underrun, setUnderrun] = useState(fmtDec(budget.underrun_pct ?? 10));
  const envoi = useEnvoi();
  const taux = lireNombre(underrun);
  const erreur = nombreIllisible(underrun) || taux === null ? AIDE_NOMBRE : taux < 0 || taux > 100 ? "Pourcentage de 0 à 100." : undefined;
  async function enregistrer() {
    if (await envoi.run("enregistrer", () => apiSend("PATCH", `/finance/budgets/${budget.id}`, { underrun_pct: taux }), undefined, "Enregistrement impossible.")) onDone();
  }
  return (
    <Modal open title={`Seuils, ${budget.name}`} onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={!!erreur || !!envoi.busy} onClick={() => void enregistrer()}>Enregistrer</Button>}>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <Field label="Sous-réalisation tolérée des produits (%)" error={erreur} hint="En deçà, une ligne de produits passe en « sous-réalisation ». Le dépassement des charges suit le seuil d'alerte de la société (Seuils et taux).">
          <Input inputMode="decimal" className="font-mono" value={underrun} onChange={(e) => setUnderrun(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function LineForm({ budgetId, line, onClose, onDone }: { budgetId: number; line: BudgetLine | null; onClose: () => void; onDone: () => void }) {
  const axes = useAxes();
  const activities = axes.data?.find((a) => a.key === "activite")?.accounts.filter((a) => a.active) ?? [];
  const centers = axes.data?.find((a) => a.key === "centre_cout")?.accounts.filter((a) => a.active) ?? [];
  const [form, setForm] = useState({
    nature: (line?.nature ?? "expense") as Nature,
    name: line?.name ?? "",
    account_prefixes: line?.account_prefixes ?? "",
    residual: line?.residual ?? false,
    activity_id: line?.activity ? String(line.activity.id) : "",
    cost_center_id: line?.cost_center ? String(line.cost_center.id) : "",
  });
  const [months, setMonths] = useState<string[]>((line?.months ?? Array<number>(12).fill(0)).map((m) => (m ? fmtDec(m) : "")));
  const [annual, setAnnual] = useState("");
  const envoi = useEnvoi();
  // Le solde résiduel ne vaut que pour les charges : une case cochée puis masquée (autre nature) ne
  // bloque plus la saisie des comptes.
  const residuel = form.nature === "expense" && form.residual;
  const montants = months.map((m) => (m.trim() ? lireNombre(m) : 0));
  const illisible = montants.some((m) => m === null);
  const total = montants.reduce<number>((a, m) => a + (m ?? 0), 0);
  const annuel = lireNombre(annual);
  const centresProposes = centers.filter((c) => !form.activity_id || !c.activity_id || String(c.activity_id) === form.activity_id);
  const pret = Boolean(form.name.trim()) && (residuel || Boolean(form.account_prefixes.trim())) && !illisible;

  async function enregistrer() {
    const body = {
      ...form,
      account_prefixes: residuel ? "" : form.account_prefixes,
      residual: residuel,
      activity_id: form.activity_id ? Number(form.activity_id) : null,
      cost_center_id: form.cost_center_id ? Number(form.cost_center_id) : null,
      months: montants.map((m) => m ?? 0),
    };
    if (await envoi.run("enregistrer", () => (line ? apiSend("PATCH", `/finance/budget-lines/${line.id}`, body) : apiSend("POST", `/finance/budgets/${budgetId}/budget-lines`, body)), undefined, "Enregistrement impossible.")) onDone();
  }
  async function supprimer() {
    if (!line || !(await demanderConfirmation(`Supprimer la ligne budgétaire « ${line.name} » ? Ses douze montants sont perdus.`, { action: "Supprimer", danger: true }))) return;
    if (await envoi.run("supprimer", () => apiSend("DELETE", `/finance/budget-lines/${line.id}`), undefined, "Suppression impossible.")) onDone();
  }
  return (
    <Modal
      open
      wide
      title={line ? `Ligne budgétaire, ${line.name}` : "Nouvelle ligne budgétaire"}
      onClose={onClose}
      footer={
        <>
          {line && (
            <Button variant="danger" loading={envoi.busy === "supprimer"} disabled={!!envoi.busy} onClick={() => void supprimer()}>
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
          <Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={!pret || !!envoi.busy} onClick={() => void enregistrer()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        {axes.error && <ErrorBox error={axes.error} titre="Activités et centres de coût non chargés" onRetry={() => axes.mutate()} />}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Nature">
            <Select value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value as Nature })} options={Object.entries(NATURES).map(([k, v]) => ({ value: k, label: v }))} />
          </Field>
          <Field label="Ligne budgétaire" className="md:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Carburant, salaires, loyers…" />
          </Field>
          <Field label="Comptes" hint={form.nature === "income" ? "Classe 7, par exemple « 706 »" : form.nature === "capex" ? "Classe 2, par exemple « 24, 21 »" : "Classe 6, par exemple « 6611, 664 »"}>
            <Input className="font-mono" value={residuel ? "" : form.account_prefixes} disabled={residuel} onChange={(e) => setForm({ ...form, account_prefixes: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Activité (facultatif)">
            <Select
              value={form.activity_id}
              onChange={(e) => {
                const activite = e.target.value;
                // Un centre de coût rattaché à une autre activité ne reste pas choisi en silence.
                const centre = centers.find((c) => String(c.id) === form.cost_center_id);
                const garde = !centre || !activite || !centre.activity_id || String(centre.activity_id) === activite;
                setForm({ ...form, activity_id: activite, cost_center_id: garde ? form.cost_center_id : "" });
              }}
              placeholder="Toutes"
              options={activities.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Field>
          <Field label="Centre de coût (facultatif)">
            <Select value={form.cost_center_id} onChange={(e) => setForm({ ...form, cost_center_id: e.target.value })} placeholder="Tous" options={centresProposes.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          {form.nature === "expense" && (
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={form.residual} onChange={(e) => setForm({ ...form, residual: e.target.checked })} /> Solde résiduel (charges non couvertes par les autres lignes)
            </label>
          )}
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-end gap-3">
            <Field label="Répartir un montant annuel (GNF)" error={nombreIllisible(annual) ? AIDE_NOMBRE : undefined}>
              <Input inputMode="decimal" className="w-44 font-mono" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="Total de l'année" />
            </Field>
            <Button
              disabled={annuel === null || annuel <= 0}
              onClick={() => {
                if (annuel === null) return;
                const part = Math.floor(annuel / 12);
                setMonths(Array.from({ length: 12 }, (_, i) => fmtDec(i === 11 ? annuel - part * 11 : part)));
              }}
            >
              Répartir sur douze mois
            </Button>
            <span className="ml-auto text-sm text-muted">Total annuel : {illisible ? "–" : fmtGNF(total)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {MONTHS_FR.map((m, i) => (
              <Field key={m} label={m} error={montants[i] === null ? "Illisible" : undefined}>
                <Input inputMode="decimal" className="text-right font-mono" value={months[i]} onChange={(e) => setMonths(months.map((x, j) => (j === i ? e.target.value : x)))} />
              </Field>
            ))}
          </div>
          {illisible && <p className="mt-2 text-[12px] font-medium text-danger">{AIDE_NOMBRE}</p>}
        </div>
      </div>
    </Modal>
  );
}

function ImportBudget({ budgetId, onClose, onDone }: { budgetId: number; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; lines: number } | null>(null);
  const [error, setError] = useState<{ message: string; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!file || busy) return;
    if (replace && !(await demanderConfirmation("Remplacer toutes les lignes du budget ? Les lignes actuelles sont supprimées et remplacées par celles du classeur.", { action: "Remplacer", danger: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (replace) form.append("replace", "1");
      setResult(await apiUpload(`/finance/budgets/${budgetId}/import`, form));
      onDone();
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "Import impossible.", errors: e instanceof ApiError ? ((e.body as { errors?: string[] }).errors ?? []) : [] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Importer le budget" onClose={onClose} footer={<Button variant="primary" loading={busy} disabled={!file} onClick={() => void submit()}>Importer</Button>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Classeur XLSX ou CSV, une ligne budgétaire par rangée : nature (produits, charges, investissements), ligne, comptes, residuel (oui), activite, centre_cout, puis un montant par mois (janv à dec). L&apos;export du budget donne le modèle. Une ligne déjà présente (même nature, libellé et affectation) est mise à jour.
        </p>
        {error && (
          <Notice tone="danger">
            <div>{error.message}</div>
            {error.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {error.errors.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        {result && <Notice tone="ok">{pluriel(result.created, "ligne créée", "lignes créées")}, {pluriel(result.updated, "mise à jour", "mises à jour")} ; {pluriel(result.lines, "ligne")} au budget.</Notice>}
        <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong/70 file:bg-panel file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-panel-2" />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Remplacer toutes les lignes du budget
        </label>
      </div>
    </Modal>
  );
}
