"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, BookOpen, Calculator, Check, ChevronLeft, FileSpreadsheet, FileText, Lock, Plus, RefreshCw, RotateCcw, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Etapes, Etat, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, RankBars, Select, Textarea, cx, type Tone } from "@/components/ui";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import { fmtDateTime, fmtDec, fmtGNF, fmtPct, fmtShort } from "@/lib/format";
import type { Anomaly, Meta, Payroll, PayrollRow, Payslip, PayslipRow } from "@/lib/rh-types";
import { ChampMontant, EtatPaie, FiltreSociete, PastilleSociete, avecSociete, messageErreur, moisCourant, moisLong, nombre, useMeta } from "./commun";

const TON_ANOMALIE: Record<Anomaly["severity"], Tone> = { danger: "danger", warn: "warn", info: "accent" };

/**
 * Liste des paies par mois et par société (chaque société reste l'employeur légal : une paie, une
 * déclaration et une écriture chacune), et préparation du mois pour toutes les sociétés d'un coup.
 */
export function ListePaies() {
  const router = useRouter();
  const { data: meta } = useMeta();
  const [societe, setSociete] = useState<number | null>(null);
  const { data, error, mutate } = useApi<PayrollRow[]>(avecSociete("/rh/payrolls", societe));
  const [creation, setCreation] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const courant = moisCourant();
  const plusieurs = (meta?.companies.length ?? 0) > 1;
  // Le mois courant est « fait » quand chaque société du compte a sa paie (sans filtre : toutes).
  const societesVisees = societe === null ? (meta?.companies ?? []).map((c) => c.id) : [societe];
  const dejaCourant = Boolean(data) && societesVisees.length > 0 && societesVisees.every((id) => (data ?? []).some((p) => p.company.id === id && p.month.slice(0, 7) === courant.slice(0, 7)));
  return (
    <div>
      <PageHeader
        title="Paie"
        subtitle="Une paie par mois et par société employeur : préparation des bulletins, contrôles, validation, puis écriture de paie de chaque société transmise à la finance."
        actions={
          meta?.can_write && (
            <Button variant="primary" onClick={() => setCreation(true)}>
              <Plus className="h-4 w-4" /> {dejaCourant ? "Préparer une paie" : `Préparer la paie de ${moisLong(courant)}`}
            </Button>
          )
        }
      />
      {plusieurs && (
        <div className="mb-4">
          <FiltreSociete companies={meta?.companies} value={societe} onChange={setSociete} />
        </div>
      )}
      {message && (
        <div className="mb-4">
          <Notice tone="ok">{message}</Notice>
        </div>
      )}
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => mutate()} />
        ) : data.length === 0 ? (
          <Empty title="Aucune paie" hint="Préparez la paie du mois : les bulletins de tous les salariés présents sont calculés d'un coup, avec leurs absences, avances et éléments fixes." />
        ) : (
          <DataTable
            rows={data}
            rowKey={(p) => p.id}
            onRowClick={(p) => router.push(`/rh/paie/${p.id}`)}
            columns={[
              { key: "month", label: "Mois", render: (p) => <span className="font-medium capitalize text-ink">{moisLong(p.month)}</span>, sortValue: (p) => p.month },
              ...(plusieurs ? [{ key: "company", label: "Société", render: (p: PayrollRow) => <PastilleSociete company={p.company} />, sortValue: (p: PayrollRow) => p.company.name }] : []),
              { key: "headcount", label: "Bulletins", align: "right", render: (p) => String(p.totals.headcount) },
              { key: "gross", label: "Brut", align: "right", render: (p) => fmtGNF(p.totals.gross) },
              { key: "net", label: "Net à payer", align: "right", render: (p) => fmtGNF(p.totals.net) },
              { key: "cost", label: "Coût employeur", align: "right", render: (p) => fmtGNF(p.totals.employer_cost) },
              { key: "anomalies", label: "Anomalies", align: "right", render: (p) => (p.anomalies ? <Badge tone="warn">{p.anomalies}</Badge> : <span className="text-muted">0</span>) },
              { key: "state", label: "État", render: (p) => <EtatPaie state={p.state} /> },
              { key: "move", label: "Écriture", render: (p) => (p.move ? <span className="font-mono text-xs">{p.move.name}</span> : "–") },
            ]}
          />
        )}
      </Card>
      {creation && (
        <NouvellePaie
          proposition={dejaCourant ? "" : courant.slice(0, 7)}
          onClose={() => setCreation(false)}
          onDone={(p) => {
            setCreation(false);
            void mutate();
            const crees = p.created ?? [p.id];
            // Une seule société préparée : on ouvre sa paie ; plusieurs : la liste les montre.
            if (crees.length <= 1) router.push(`/rh/paie/${p.id}`);
            else setMessage(`Paie de ${moisLong(p.month)} préparée pour ${crees.length} sociétés : ouvrez chacune pour la contrôler et la valider.`);
          }}
        />
      )}
    </div>
  );
}

function NouvellePaie({ proposition, onClose, onDone }: { proposition: string; onClose: () => void; onDone: (p: Payroll) => void }) {
  const [mois, setMois] = useState(proposition);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function creer() {
    setBusy(true);
    setErreur(null);
    try {
      onDone(await apiSend<Payroll>("POST", "/rh/payrolls", { month: `${mois}-01` }));
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Préparer une paie"
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!mois} onClick={creer}>
          <Calculator className="h-4 w-4" /> Calculer les bulletins
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-ink-2">
          La paie du mois est préparée pour chaque société qui a du personnel (chacune reste l&apos;employeur légal et a sa propre paie). Tous les salariés présents dans le mois reçoivent un bulletin : salaire de base et éléments fixes au prorata de la présence, absences non rémunérées retenues, échéances d&apos;avances et de prêts, primes de rotation des chauffeurs. Les éléments du mois se saisissent ensuite sur chaque bulletin.
        </p>
        <Field label="Mois de paie">
          <Input type="month" value={mois} onChange={(e) => setMois(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Une paie : étapes, totaux, bulletins et anomalies, éléments variables, validation, écriture. */
export function DetailPaie({ id }: { id: string }) {
  const { data: p, error, mutate } = useApi<Payroll>(`/rh/payrolls/${id}`);
  const { data: meta } = useMeta();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const [saisie, setSaisie] = useState<PayslipRow | null>(null);
  const [filtre, setFiltre] = useState<"tous" | "anomalies">("tous");
  if (error) return <ErrorBox error={error} onRetry={() => mutate()} />;
  if (!p) return <Loading label="Chargement de la paie…" />;
  const ecrit = p.can_write;
  const bloquantes = p.payslips.flatMap((s) => s.anomalies).filter((a) => a.severity === "danger").length;

  async function action(nom: "compute" | "validate" | "reopen" | "account", reussite: string) {
    setBusy(nom);
    setMessage(null);
    try {
      await mutate(await apiSend<Payroll>("POST", `/rh/payrolls/${id}/${nom}`), { revalidate: false });
      setMessage({ tone: "ok", text: reussite });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e) });
    } finally {
      setBusy(null);
    }
  }

  const etapes: Array<{ key: string; label: string; state: "done" | "current" | "todo" }> = [
    { key: "draft", label: "Préparation et contrôles", state: p.state === "draft" ? "current" : "done" },
    { key: "validated", label: "Validée : bulletins figés", state: p.state === "draft" ? "todo" : p.state === "validated" ? "current" : "done" },
    { key: "accounted", label: "Écriture transmise à la finance", state: p.state === "accounted" ? "done" : "todo" },
  ];
  const lignes = filtre === "anomalies" ? p.payslips.filter((s) => s.anomalies.length > 0) : p.payslips;

  return (
    <div>
      <Link href="/rh/paie" className="no-print mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" /> Paies
      </Link>
      <PageHeader
        title={`Paie de ${moisLong(p.month)}, ${p.company.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <PastilleSociete company={p.company} />
            <EtatPaie state={p.state} />
            {p.validated_by && <span>Validée par {p.validated_by}, {fmtDateTime(p.validated_at)}</span>}
            {p.move && (
              <span>
                Écriture <span className="font-mono text-xs">{p.move.name}</span> ({p.move.state === "posted" ? "comptabilisée par la finance" : "en brouillon, à comptabiliser par la finance"})
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button onClick={() => void apiDownload(`/rh/payrolls/${id}/export.xlsx`, `paie_${p.month.slice(0, 7)}_${p.company.entity ?? p.company.id}.xlsx`)}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            {ecrit && p.state === "draft" && (
              <>
                <Button loading={busy === "compute"} onClick={() => void action("compute", "Bulletins recalculés.")}>
                  <RefreshCw className="h-4 w-4" /> Recalculer
                </Button>
                <Button variant="primary" loading={busy === "validate"} disabled={bloquantes > 0} title={bloquantes ? "Corrigez d'abord les anomalies bloquantes" : undefined} onClick={() => void action("validate", "Paie validée : les bulletins sont figés et consultables par les salariés.")}>
                  <Lock className="h-4 w-4" /> Valider la paie
                </Button>
              </>
            )}
            {ecrit && p.state === "validated" && (
              <>
                <Button loading={busy === "reopen"} onClick={() => void action("reopen", "Paie rouverte : les bulletins sont de nouveau modifiables.")}>
                  <RotateCcw className="h-4 w-4" /> Rouvrir
                </Button>
                <Button variant="primary" loading={busy === "account"} onClick={() => void action("account", "Écriture de paie créée en brouillon dans le journal des salaires : la finance la relit et la comptabilise.")}>
                  <BookOpen className="h-4 w-4" /> Comptabiliser
                </Button>
              </>
            )}
            {ecrit && p.state === "accounted" && p.move?.state !== "posted" && (
              <Button loading={busy === "reopen"} onClick={() => void action("reopen", "Paie rouverte ; l'écriture en brouillon a été supprimée.")}>
                <RotateCcw className="h-4 w-4" /> Rouvrir
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6">
        <Etapes steps={etapes} />
      </div>
      {message && (
        <div className="mb-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      {bloquantes > 0 && p.state === "draft" && (
        <div className="mb-4">
          <Notice tone="danger">{bloquantes} anomalie(s) bloquante(s) : la paie ne peut être validée qu&apos;une fois corrigées.</Notice>
        </div>
      )}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Net à payer" value={fmtShort(p.totals.net)} hint={`${p.totals.headcount} bulletin(s)`} />
        <Kpi label="Brut" value={fmtShort(p.totals.gross)} hint={`Retenues diverses : ${fmtGNF(p.totals.deductions)}`} />
        <Kpi label="Cotisations et impôts" value={fmtShort(p.totals.cnss_employee + p.totals.cnss_employer + p.totals.rts + p.totals.vf + p.totals.training_tax)} hint={`CNSS ${fmtGNF(p.totals.cnss_employee + p.totals.cnss_employer)}, RTS ${fmtGNF(p.totals.rts)}, VF et formation ${fmtGNF(p.totals.vf + p.totals.training_tax)}`} />
        <Kpi label="Coût employeur" value={fmtShort(p.totals.employer_cost)} tone="accent" hint={p.totals.gross ? `${fmtDec(p.totals.employer_cost / p.totals.gross)} fois le brut` : undefined} />
      </div>

      <Card
        padded={false}
        title="Bulletins"
        actions={
          <span className="flex items-center gap-2">
            <Button variant={filtre === "tous" ? "secondary" : "ghost"} size="sm" onClick={() => setFiltre("tous")}>
              Tous ({p.payslips.length})
            </Button>
            <Button variant={filtre === "anomalies" ? "secondary" : "ghost"} size="sm" onClick={() => setFiltre("anomalies")}>
              <AlertTriangle className="h-3.5 w-3.5" /> Avec anomalie ({p.payslips.filter((s) => s.anomalies.length).length})
            </Button>
          </span>
        }
      >
        <DataTable
          rows={lignes}
          rowKey={(s) => s.id}
          empty={filtre === "anomalies" ? "Aucune anomalie." : "Aucun bulletin."}
          columns={[
            {
              key: "employee",
              label: "Salarié",
              sortValue: (s) => s.employee.name,
              render: (s) => (
                <span className="block min-w-0">
                  <span className="block font-medium text-ink">{s.employee.name}</span>
                  <span className="block text-[12px] text-muted">
                    {s.employee.matricule}
                    {s.department ? `, ${s.department.name}` : ""}
                  </span>
                </span>
              ),
            },
            { key: "days", label: "Jours", align: "right", render: (s) => <span title={`${s.worked_days} payé(s) sur ${s.month_days} ouvrables, ${s.unpaid_days} non rémunéré(s)`}>{`${fmtDec(s.worked_days - s.unpaid_days)} / ${fmtDec(s.month_days)}`}</span> },
            { key: "gross", label: "Brut", align: "right", render: (s) => fmtGNF(s.gross), sortValue: (s) => s.gross },
            { key: "cnss", label: "CNSS", align: "right", render: (s) => fmtGNF(s.cnss_employee) },
            { key: "rts", label: "RTS", align: "right", render: (s) => fmtGNF(s.rts) },
            { key: "deductions", label: "Retenues", align: "right", render: (s) => fmtGNF(s.deductions) },
            {
              key: "net",
              label: "Net",
              align: "right",
              sortValue: (s) => s.net,
              render: (s) => (
                <span className="block">
                  <b className={s.net < 0 ? "text-danger" : ""}>{fmtGNF(s.net)}</b>
                  {s.net_variation !== null && Math.abs(s.net_variation) >= 0.5 && <span className={cx("block text-[11.5px]", Math.abs(s.net_variation) > 20 ? "text-warn" : "text-muted")}>{`${s.net_variation > 0 ? "+" : ""}${fmtPct(s.net_variation, 0)} sur le mois précédent`}</span>}
                </span>
              ),
            },
            {
              key: "anomalies",
              label: "Contrôles",
              render: (s) =>
                s.anomalies.length === 0 ? (
                  <Badge tone="ok">Conforme</Badge>
                ) : (
                  <span className="flex flex-col items-start gap-1">
                    {s.anomalies.map((a) => (
                      <span key={a.code} title={a.message}>
                        <Badge tone={TON_ANOMALIE[a.severity]}>{a.message.length > 42 ? `${a.message.slice(0, 40)}…` : a.message}</Badge>
                      </span>
                    ))}
                  </span>
                ),
            },
            {
              key: "x",
              label: "",
              align: "right",
              render: (s) => (
                <span className="flex justify-end gap-1.5">
                  {ecrit && p.state === "draft" && (
                    <Button size="sm" onClick={() => setSaisie(s)}>
                      <Plus className="h-3.5 w-3.5" /> Éléments
                    </Button>
                  )}
                  <Link href={`/rh/paie/bulletins/${s.id}`}>
                    <Button size="sm">
                      <FileText className="h-3.5 w-3.5" /> Bulletin
                    </Button>
                  </Link>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Coût employeur par activité">
          {p.by_activity.length === 0 ? (
            <p className="text-sm text-muted">Aucune activité imputée.</p>
          ) : (
            <RankBars items={p.by_activity.map((a) => ({ key: a.name, label: a.name, value: a.employer_cost, detail: `Brut ${fmtShort(a.gross)}` }))} format={(v) => fmtShort(v)} />
          )}
        </Card>
        <Card title="Coût employeur par département">
          {p.by_department.length === 0 ? (
            <p className="text-sm text-muted">Aucun département.</p>
          ) : (
            <RankBars couleur="var(--n-or)" items={p.by_department.map((d) => ({ key: d.name, label: d.name, value: d.employer_cost, detail: `${d.headcount} pers., brut ${fmtShort(d.gross)}` }))} format={(v) => fmtShort(v)} />
          )}
        </Card>
      </div>

      {saisie && meta && (
        <ElementsVariables
          payslipId={saisie.id}
          meta={meta}
          onClose={() => {
            setSaisie(null);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

const SOURCE: Record<string, string> = { manual: "Saisi", fixed: "Élément fixe", leave: "Absence", advance: "Avance ou prêt", rotation: "Rotations" };

/** Éléments du mois d'un bulletin : primes, heures supplémentaires, retenues ; le bulletin se recalcule. */
function ElementsVariables({ payslipId, meta, onClose }: { payslipId: number; meta: Meta; onClose: () => void }) {
  const { data: b, error, mutate } = useApi<Payslip>(`/rh/payslips/${payslipId}`);
  const rubriques = meta.rubrics.filter((r) => r.active && !r.system);
  const [rubriqueId, setRubriqueId] = useState<string>("");
  const [valeur, setValeur] = useState("");
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rubrique = rubriques.find((r) => String(r.id) === rubriqueId);

  async function ajouter() {
    if (!rubrique) return;
    setBusy(true);
    setErreur(null);
    try {
      const body = rubrique.input === "hours" ? { rubric_id: rubrique.id, quantity: nombre(valeur), note: note.trim() || null } : { rubric_id: rubrique.id, amount: nombre(valeur), note: note.trim() || null };
      await mutate(await apiSend<Payslip>("POST", `/rh/payslips/${payslipId}/inputs`, body), { revalidate: false });
      setValeur("");
      setNote("");
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }

  async function retirer(inputId: number) {
    setErreur(null);
    try {
      await mutate(await apiSend<Payslip>("DELETE", `/rh/payslips/${payslipId}/inputs/${inputId}`), { revalidate: false });
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <Modal open wide title={b ? `Éléments du mois, ${b.employee.name}` : "Éléments du mois"} onClose={onClose} footer={<Button onClick={onClose}>Fermer</Button>}>
      {!b ? (
        <Etat error={error} onRetry={() => mutate()} />
      ) : (
        <div className="space-y-4">
          {erreur && <Notice tone="danger">{erreur}</Notice>}
          <div className="grid grid-cols-3 gap-3 rounded-xl bg-panel-2 px-4 py-3 text-sm">
            <span>
              Brut <b className="block font-mono tabular">{fmtGNF(b.gross)}</b>
            </span>
            <span>
              Retenues <b className="block font-mono tabular">{fmtGNF(b.cnss_employee + b.rts + b.deductions)}</b>
            </span>
            <span>
              Net <b className={cx("block font-mono tabular", b.net < 0 && "text-danger")}>{fmtGNF(b.net)}</b>
            </span>
          </div>
          <DataTable
            dense
            rows={b.inputs}
            rowKey={(i) => i.id}
            empty="Aucun élément : seuls le salaire de base et les éléments fixes sont payés."
            columns={[
              { key: "rubric", label: "Rubrique", render: (i) => i.rubric.name },
              { key: "source", label: "Origine", render: (i) => SOURCE[i.source] ?? i.source },
              { key: "value", label: "Valeur", align: "right", render: (i) => (i.rubric.input === "hours" ? `${fmtDec(i.quantity)} h` : fmtGNF(i.amount)) },
              { key: "note", label: "Motif", render: (i) => i.note ?? "–" },
              {
                key: "x",
                label: "",
                align: "right",
                render: (i) =>
                  i.source === "manual" ? (
                    <Button variant="ghost" size="sm" aria-label="Retirer" onClick={() => void retirer(i.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null,
              },
            ]}
          />
          <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Rubrique">
              <Select value={rubriqueId} onChange={(e) => setRubriqueId(e.target.value)} placeholder="Choisir" options={rubriques.map((r) => ({ value: r.id, label: `${r.name}${r.kind === "deduction" ? " (retenue)" : ""}` }))} />
            </Field>
            <Field label={rubrique?.input === "hours" ? "Heures" : "Montant (GNF)"}>
              <ChampMontant value={valeur} onChange={setValeur} />
            </Field>
            <Field label="Motif" className="sm:col-span-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <span className="text-[12.5px] text-muted">{rubrique?.input === "hours" ? `Payées au taux horaire majoré de ${fmtDec(rubrique.overtime_rate)} %.` : rubrique ? `${rubrique.cnss ? "Soumis à la CNSS" : "Hors CNSS"}, ${rubrique.taxable ? (rubrique.exempt_allowance ? "exonéré de RTS dans la limite de 25 % du brut" : "soumis à la RTS") : "hors RTS"}.` : ""}</span>
              <Button variant="primary" loading={busy} disabled={!rubrique || !nombre(valeur)} onClick={ajouter}>
                <Check className="h-4 w-4" /> Ajouter
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
