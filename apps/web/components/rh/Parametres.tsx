"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Etat, Field, Input, Modal, Notice, PageHeader, Select, Tabs, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDec, fmtInt } from "@/lib/format";
import type { Department, Holiday, LeaveType, Meta, Rubric, Settings, TaxBracket } from "@/lib/rh-types";
import { ChampMontant, PastilleSociete, avecSociete, erreurNombre, messageErreur, nombre, nomCourt, useMeta } from "./commun";

type Onglet = "paie" | "alertes" | "comptes" | "rubriques" | "absences" | "feries" | "departements";

/**
 * Paramètres RH : paie, alertes, comptes, rubriques, absences, fériés, départements. Les règles sont
 * communes aux deux sociétés ; numéro d'employeur CNSS, taxe de formation et journal sont propres à
 * chacune (société choisie en tête, défaut : la société de travail).
 */
export function ParametresRh() {
  const { data: meta, error: erreurMeta, mutate: rafraichirMeta } = useMeta();
  const [societe, setSociete] = useState<number | null>(null);
  const { data: settings, error, mutate } = useApi<Settings>(avecSociete("/rh/settings", societe));
  const [onglet, setOnglet] = useState<Onglet>("paie");
  if (error) return <ErrorBox error={error} onRetry={() => mutate()} />;
  if (!settings || !meta) return <Etat error={erreurMeta} onRetry={() => rafraichirMeta()} label="Chargement des paramètres…" />;
  const ecrit = meta.can_write;
  return (
    <div>
      <PageHeader title="Paramètres RH" subtitle="Règles de paie, alertes, comptes de l'écriture de paie, rubriques, types d'absence, jours fériés et départements." />
      <div className="mb-3">
        <Notice tone="accent">Taux, barème, congés, heures, alertes et comptes sont communs aux deux sociétés ; numéro d&apos;employeur CNSS, taxe de formation et journal sont propres à chaque société.</Notice>
      </div>
      <div className="mb-5">
        <Notice tone="warn">Les taux, le barème de la RTS, le plafond de la CNSS et les comptes sont pré-remplis avec les valeurs légales connues (Code général des impôts, pratique CNSS). Faites-les valider par l&apos;expert-comptable avant la première paie réelle.</Notice>
      </div>
      {meta.companies.length > 1 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-ink-2">
          <span>Partie propre à la société :</span>
          <div className="w-60">
            <Select aria-label="Société" value={settings.company.id} onChange={(e) => setSociete(Number(e.target.value))} options={meta.companies.map((c) => ({ value: c.id, label: c.name }))} />
          </div>
        </div>
      )}
      <Tabs
        value={onglet}
        onChange={setOnglet}
        tabs={[
          { key: "paie", label: "Paie" },
          { key: "alertes", label: "Alertes" },
          { key: "comptes", label: "Comptes" },
          { key: "rubriques", label: "Rubriques", count: meta.rubrics.length },
          { key: "absences", label: "Types d'absence", count: meta.leave_types.length },
          { key: "feries", label: "Jours fériés" },
          { key: "departements", label: "Départements", count: meta.departments.length },
        ]}
      />
      {(onglet === "paie" || onglet === "alertes" || onglet === "comptes") && <FormulaireParametres key={`${onglet}-${settings.company.id}`} onglet={onglet} settings={settings} ecrit={ecrit} onSaved={(s) => void mutate(s, { revalidate: false })} />}
      {onglet === "rubriques" && <Rubriques meta={meta} ecrit={ecrit} onChanged={() => void rafraichirMeta()} />}
      {onglet === "absences" && <TypesAbsence meta={meta} ecrit={ecrit} onChanged={() => void rafraichirMeta()} />}
      {onglet === "feries" && <Feries ecrit={ecrit} />}
      {onglet === "departements" && <Departements meta={meta} ecrit={ecrit} onChanged={() => void rafraichirMeta()} />}
    </div>
  );
}

const COMPTES: Array<{ cle: keyof Settings["accounts"]; label: string; aide: string }> = [
  { cle: "salary", label: "Rémunérations (charge)", aide: "6611 Appointements et salaires ; une rubrique peut avoir son propre compte" },
  { cle: "social_charges", label: "Charges sociales (charge)", aide: "6641 : part patronale de la CNSS" },
  { cle: "payroll_taxes", label: "Versement forfaitaire (charge)", aide: "6413 Taxes sur appointements et salaires" },
  { cle: "training_tax", label: "Taxe de formation (charge)", aide: "6414 : taxe d'apprentissage ou contribution à la formation" },
  { cle: "cnss", label: "CNSS (dette)", aide: "431 Sécurité sociale : parts salariale et patronale" },
  { cle: "rts", label: "RTS (dette)", aide: "447 État, impôts retenus à la source" },
  { cle: "payroll_taxes_payable", label: "VF et taxe de formation (dette)", aide: "442 État, autres impôts et taxes" },
  { cle: "net_payable", label: "Rémunérations dues", aide: "422 Personnel, rémunérations dues (par salarié)" },
  { cle: "advances", label: "Avances et prêts", aide: "421 Personnel, avances et acomptes" },
];

function FormulaireParametres({ onglet, settings, ecrit, onSaved }: { onglet: "paie" | "alertes" | "comptes"; settings: Settings; ecrit: boolean; onSaved: (s: Settings) => void }) {
  // Valeurs écrites à la française dans les champs (« 2,5 », et non « 2.5 »).
  const t = (v: number) => String(v).replace(".", ",");
  const [f, setF] = useState({
    cnss_employee_rate: t(settings.cnss_employee_rate),
    cnss_employer_rate: t(settings.cnss_employer_rate),
    cnss_ceiling: t(settings.cnss_ceiling),
    smig: t(settings.smig),
    allowance_exempt_cap: t(settings.allowance_exempt_cap),
    vf_rate: t(settings.vf_rate),
    training_tax_rate: t(settings.training_tax_rate),
    training_tax_label: settings.training_tax_label,
    leave_days_per_month: t(settings.leave_days_per_month),
    monthly_hours: t(settings.monthly_hours),
    rotation_bonus: t(settings.rotation_bonus),
    // Exonération de VF des stagiaires (CGI, art. 203 ter), paramétrable depuis eguitra_rh 19.0.1.1.0.
    intern_exemption: t((settings as Settings & { intern_exemption?: number }).intern_exemption ?? 1_200_000),
    trial_alert_days: t(settings.trial_alert_days),
    contract_alert_days: t(settings.contract_alert_days),
    document_alert_days: t(settings.document_alert_days),
    cnss_employer_number: settings.cnss_employer_number ?? "",
  });
  const [bareme, setBareme] = useState(settings.rts_brackets.map((b) => ({ from: t(b.from), rate: t(b.rate) })));
  const [comptes, setComptes] = useState({ ...settings.accounts });
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // Nombres lus à la française : illisibles ou vides, ils restent en erreur sous leur champ et rien n'est
  // envoyé (un plafond CNSS illisible valait 0, soit une assiette nulle à la paie suivante).
  const requis: Array<keyof typeof f> = onglet === "paie"
    ? ["cnss_employee_rate", "cnss_employer_rate", "cnss_ceiling", "smig", "allowance_exempt_cap", "vf_rate", "training_tax_rate", "leave_days_per_month", "monthly_hours"]
    : onglet === "alertes" ? ["trial_alert_days", "contract_alert_days", "document_alert_days"] : [];
  const erreurs: Partial<Record<keyof typeof f, string>> = {};
  for (const k of requis) erreurs[k] = erreurNombre(f[k], true);
  if (onglet === "paie") erreurs.rotation_bonus = erreurNombre(f.rotation_bonus);
  if (onglet === "paie") erreurs.intern_exemption = erreurNombre(f.intern_exemption, true);
  const baremeIllisible = onglet === "paie" && bareme.some((b) => Boolean(erreurNombre(b.from, true) || erreurNombre(b.rate, true)));
  const bloque = Object.values(erreurs).some(Boolean) || baremeIllisible;

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    setOk(false);
    let body: Partial<Settings>;
    if (onglet === "paie") {
      const brackets: TaxBracket[] = bareme.map((b) => ({ from: nombre(b.from), rate: nombre(b.rate) })).sort((a, b) => a.from - b.from);
      body = {
        cnss_employee_rate: nombre(f.cnss_employee_rate),
        cnss_employer_rate: nombre(f.cnss_employer_rate),
        cnss_ceiling: nombre(f.cnss_ceiling),
        smig: nombre(f.smig),
        allowance_exempt_cap: nombre(f.allowance_exempt_cap),
        vf_rate: nombre(f.vf_rate),
        training_tax_rate: nombre(f.training_tax_rate),
        training_tax_label: f.training_tax_label.trim(),
        leave_days_per_month: nombre(f.leave_days_per_month),
        monthly_hours: nombre(f.monthly_hours),
        rotation_bonus: nombre(f.rotation_bonus),
        ...({ intern_exemption: nombre(f.intern_exemption) } as Partial<Settings>),
        cnss_employer_number: f.cnss_employer_number.trim() || null,
        rts_brackets: brackets,
      };
    } else if (onglet === "alertes") {
      body = { trial_alert_days: nombre(f.trial_alert_days), contract_alert_days: nombre(f.contract_alert_days), document_alert_days: nombre(f.document_alert_days) };
    } else {
      body = { accounts: comptes };
    }
    try {
      onSaved(await apiSend<Settings>("PATCH", avecSociete("/rh/settings", settings.company.id), body));
      setOk(true);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }

  const pied = ecrit && (
    <div className="mt-5 flex items-center justify-end gap-3">
      {ok && <span className="text-sm text-ok">Paramètres enregistrés.</span>}
      {bloque && <span className="text-sm text-danger">Un nombre est illisible ou manquant : corrigez le champ signalé en rouge.</span>}
      <Button variant="primary" loading={busy} disabled={bloque} onClick={enregistrer}>
        Enregistrer
      </Button>
    </div>
  );

  if (onglet === "alertes")
    return (
      <Card title="Échéancier du tableau de bord">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fin de période d'essai, prévenir (jours avant)" error={erreurs.trial_alert_days}>
            <Input inputMode="numeric" disabled={!ecrit} value={f.trial_alert_days} onChange={set("trial_alert_days")} />
          </Field>
          <Field label="Fin de CDD ou de stage (jours avant)" error={erreurs.contract_alert_days}>
            <Input inputMode="numeric" disabled={!ecrit} value={f.contract_alert_days} onChange={set("contract_alert_days")} />
          </Field>
          <Field label="Échéance d'un document (jours avant)" error={erreurs.document_alert_days}>
            <Input inputMode="numeric" disabled={!ecrit} value={f.document_alert_days} onChange={set("document_alert_days")} />
          </Field>
        </div>
        {pied}
      </Card>
    );

  if (onglet === "comptes")
    return (
      <Card title="Comptes de l'écriture de paie">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="mb-4 text-sm text-ink-2">
          Comptes communs aux deux sociétés (même plan SYSCOHADA). Code ou racine : le compte est cherché par son code exact, puis par sa racine. Journal des salaires de {settings.company.name} : {settings.journal ? settings.journal.name : "créé à la première comptabilisation (code SAL)"}.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {COMPTES.map((c) => (
            <Field key={c.cle} label={c.label} hint={c.aide}>
              <Input className="font-mono" disabled={!ecrit} value={comptes[c.cle] ?? ""} onChange={(e) => setComptes({ ...comptes, [c.cle]: e.target.value.trim() })} />
            </Field>
          ))}
        </div>
        {pied}
      </Card>
    );

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <div className="space-y-6 xl:col-span-7">
      <Card title="Cotisations et taxes (communes aux deux sociétés)">
        {erreur && (
          <div className="mb-3">
            <Notice tone="danger">{erreur}</Notice>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CNSS, part salariale (%)" error={erreurs.cnss_employee_rate}>
            <Input inputMode="decimal" disabled={!ecrit} value={f.cnss_employee_rate} onChange={set("cnss_employee_rate")} />
          </Field>
          <Field label="CNSS, part patronale (%)" error={erreurs.cnss_employer_rate}>
            <Input inputMode="decimal" disabled={!ecrit} value={f.cnss_employer_rate} onChange={set("cnss_employer_rate")} />
          </Field>
          <Field label="Plafond mensuel de la CNSS (GNF)" error={erreurs.cnss_ceiling}>
            <ChampMontant disabled={!ecrit} value={f.cnss_ceiling} onChange={(v) => setF({ ...f, cnss_ceiling: v })} />
          </Field>
          <Field label="SMIG mensuel (GNF)" error={erreurs.smig} hint="Plancher de l'assiette CNSS, contrôle des salaires">
            <ChampMontant disabled={!ecrit} value={f.smig} onChange={(v) => setF({ ...f, smig: v })} />
          </Field>
          <Field label="Indemnités forfaitaires exonérées de RTS (% du brut)" error={erreurs.allowance_exempt_cap} hint="CGI, art. 55 : 25 %">
            <Input inputMode="decimal" disabled={!ecrit} value={f.allowance_exempt_cap} onChange={set("allowance_exempt_cap")} />
          </Field>
          <Field label="Versement forfaitaire (%)" error={erreurs.vf_rate} hint="CGI, art. 201 : 6 %">
            <Input inputMode="decimal" disabled={!ecrit} value={f.vf_rate} onChange={set("vf_rate")} />
          </Field>
          <Field label="Congés acquis par mois (jours ouvrables)" error={erreurs.leave_days_per_month}>
            <Input inputMode="decimal" disabled={!ecrit} value={f.leave_days_per_month} onChange={set("leave_days_per_month")} />
          </Field>
          <Field label="Heures mensuelles (taux horaire)" error={erreurs.monthly_hours}>
            <Input inputMode="decimal" disabled={!ecrit} value={f.monthly_hours} onChange={set("monthly_hours")} />
          </Field>
          <Field label="Rémunération des stagiaires exonérée de VF et de taxe de formation (GNF)" error={erreurs.intern_exemption} hint="CGI, art. 203 ter : 1 200 000 ; à faire valider par l'expert-comptable">
            <ChampMontant disabled={!ecrit} value={f.intern_exemption} onChange={(v) => setF({ ...f, intern_exemption: v })} />
          </Field>
          <Field label="Prime par rotation validée (GNF)" error={erreurs.rotation_bonus} hint="Chauffeurs liés au transport ; 0 : pas de prime automatique">
            <ChampMontant disabled={!ecrit} value={f.rotation_bonus} onChange={(v) => setF({ ...f, rotation_bonus: v })} />
          </Field>
        </div>
      </Card>
      <Card title={<span className="flex flex-wrap items-center gap-2">Propre à <PastilleSociete company={settings.company} /></span>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Taxe de formation (%)" error={erreurs.training_tax_rate} hint="2 % (apprentissage, moins de 30 salariés) ou 1,5 %">
            <Input inputMode="decimal" disabled={!ecrit} value={f.training_tax_rate} onChange={set("training_tax_rate")} />
          </Field>
          <Field label="Libellé de la taxe de formation">
            <Input disabled={!ecrit} value={f.training_tax_label} onChange={set("training_tax_label")} />
          </Field>
          <Field label="Numéro employeur CNSS" hint="Imprimé sur les bulletins de cette société" className="sm:col-span-2">
            <Input className="font-mono" disabled={!ecrit} value={f.cnss_employer_number} onChange={set("cnss_employer_number")} />
          </Field>
        </div>
        {pied}
      </Card>
      </div>
      <Card className="xl:col-span-5" title="Barème mensuel de la RTS">
        <p className="mb-3 text-[13px] text-ink-2">Chaque tranche s&apos;applique à la part du revenu imposable au-delà de son seuil (CGI, art. 63). Base : brut imposable moins la CNSS salariale.</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[12.5px] text-muted">
              <th className="pb-2 font-medium">À partir de (GNF)</th>
              <th className="pb-2 font-medium">Taux (%)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bareme.map((b, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <ChampMontant disabled={!ecrit} value={b.from} onChange={(v) => setBareme(bareme.map((x, j) => (j === i ? { ...x, from: v } : x)))} />
                </td>
                <td className="w-24 py-1 pr-2">
                  <Input inputMode="decimal" aria-invalid={erreurNombre(b.rate, true) ? true : undefined} disabled={!ecrit} value={b.rate} onChange={(e) => setBareme(bareme.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
                </td>
                <td className="w-10 py-1">
                  {ecrit && (
                    <Button variant="ghost" aria-label="Retirer la tranche" onClick={() => setBareme(bareme.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {baremeIllisible && <p role="alert" className="mt-2 text-[12.5px] font-medium text-danger">Seuil ou taux illisible ou vide dans une tranche : écrivez par exemple 1 000 000 ou 2,5.</p>}
        {ecrit && (
          <Button size="sm" className="mt-2" onClick={() => setBareme([...bareme, { from: "", rate: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Ajouter une tranche
          </Button>
        )}
        <p className="mt-3 text-[12.5px] text-muted">
          Tranches actuelles : {settings.rts_brackets.map((b) => `${fmtInt(b.from)} → ${fmtDec(b.rate)}${INSECABLE}%`).join(" ; ")}.
        </p>
      </Card>
    </div>
  );
}

function Rubriques({ meta, ecrit, onChanged }: { meta: Meta; ecrit: boolean; onChanged: () => void }) {
  const [edition, setEdition] = useState<Rubric | "nouvelle" | null>(null);
  return (
    <Card
      padded={false}
      title="Rubriques de paie"
      actions={
        ecrit && (
          <Button size="sm" onClick={() => setEdition("nouvelle")}>
            <Plus className="h-3.5 w-3.5" /> Nouvelle rubrique
          </Button>
        )
      }
    >
      <DataTable
        rows={meta.rubrics}
        rowKey={(r) => r.id}
        columns={[
          { key: "code", label: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span>, sortValue: (r) => r.code },
          { key: "name", label: "Rubrique", render: (r) => r.name, sortValue: (r) => r.name },
          { key: "kind", label: "Nature", render: (r) => (r.kind === "gain" ? "Gain" : "Retenue") },
          { key: "input", label: "Saisie", render: (r) => (r.input === "hours" ? `Heures (+${fmtDec(r.overtime_rate)}${INSECABLE}%)` : "Montant") },
          {
            key: "regles",
            label: "Règles",
            render: (r) => (
              <span className="flex flex-wrap gap-1">
                {r.cnss && <Badge>CNSS</Badge>}
                {r.taxable && <Badge>{r.exempt_allowance ? "RTS, exonérée à 25 %" : "RTS"}</Badge>}
                {!r.cnss && !r.taxable && r.kind === "gain" && <Badge tone="accent">Hors cotisations</Badge>}
              </span>
            ),
          },
          { key: "account", label: "Compte", render: (r) => <span className="font-mono text-xs">{r.account_code || "–"}</span> },
          { key: "etat", label: "", render: (r) => (r.system ? <Badge tone="neutral">Calculée</Badge> : !r.active ? <Badge tone="neutral">Archivée</Badge> : null) },
          {
            key: "x",
            label: "",
            align: "right",
            render: (r) =>
              ecrit && !r.system ? (
                <Button variant="ghost" size="sm" aria-label="Modifier" onClick={() => setEdition(r)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : null,
          },
        ]}
      />
      {edition && (
        <EditionRubrique
          rubrique={edition === "nouvelle" ? null : edition}
          onClose={() => setEdition(null)}
          onDone={() => {
            setEdition(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function EditionRubrique({ rubrique, onClose, onDone }: { rubrique: Rubric | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    code: rubrique?.code ?? "",
    name: rubrique?.name ?? "",
    kind: rubrique?.kind ?? "gain",
    input: rubrique?.input ?? "amount",
    overtime_rate: String(rubrique?.overtime_rate ?? 0).replace(".", ","),
    cnss: rubrique?.cnss ?? true,
    taxable: rubrique?.taxable ?? true,
    exempt_allowance: rubrique?.exempt_allowance ?? false,
    account_code: rubrique?.account_code ?? "6612",
    active: rubrique?.active ?? true,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const body = { ...f, code: f.code.trim().toUpperCase(), name: f.name.trim(), overtime_rate: nombre(f.overtime_rate), account_code: f.account_code.trim() };
    try {
      if (rubrique) await apiSend("PATCH", `/rh/rubrics/${rubrique.id}`, body);
      else await apiSend("POST", "/rh/rubrics", body);
      onDone();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }
  const coche = (k: "cnss" | "taxable" | "exempt_allowance" | "active", label: string, disabled?: boolean) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" disabled={disabled} checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <Modal
      open
      title={rubrique ? `Rubrique ${rubrique.code}` : "Nouvelle rubrique"}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!f.code.trim() || !f.name.trim() || Boolean(f.input === "hours" && erreurNombre(f.overtime_rate))} onClick={enregistrer}>
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
        <Field label="Code">
          <Input className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label="Nature">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Rubric["kind"], account_code: e.target.value === "deduction" ? "421" : f.account_code })} options={[{ value: "gain", label: "Gain (prime, indemnité)" }, { value: "deduction", label: "Retenue sur le net" }]} />
        </Field>
        <Field label="Libellé" className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Saisie">
          <Select value={f.input} onChange={(e) => setF({ ...f, input: e.target.value as Rubric["input"] })} options={[{ value: "amount", label: "Montant" }, { value: "hours", label: "Heures (taux horaire majoré)" }]} />
        </Field>
        <Field label="Majoration des heures (%)" error={f.input === "hours" ? erreurNombre(f.overtime_rate) : undefined}>
          <Input inputMode="decimal" disabled={f.input !== "hours"} value={f.overtime_rate} onChange={(e) => setF({ ...f, overtime_rate: e.target.value })} />
        </Field>
        <Field label="Compte" hint={f.kind === "gain" ? "Charge : 6611, 6612 primes…" : "Tiers : 421 avances…"} className="sm:col-span-2">
          <Input className="font-mono" value={f.account_code} onChange={(e) => setF({ ...f, account_code: e.target.value })} />
        </Field>
        {f.kind === "gain" && (
          <div className="space-y-2 sm:col-span-2">
            {coche("cnss", "Soumise à la CNSS")}
            {coche("taxable", "Soumise à la RTS")}
            {coche("exempt_allowance", "Indemnité forfaitaire (logement, transport, panier, cherté de vie) : exonérée de RTS dans la limite de 25 % du brut", !f.taxable)}
          </div>
        )}
        <div className="sm:col-span-2">{coche("active", "Rubrique active (proposée à la saisie)")}</div>
      </div>
    </Modal>
  );
}

function TypesAbsence({ meta, ecrit, onChanged }: { meta: Meta; ecrit: boolean; onChanged: () => void }) {
  const [edition, setEdition] = useState<LeaveType | "nouveau" | null>(null);
  return (
    <Card
      padded={false}
      title="Types d'absence"
      actions={
        ecrit && (
          <Button size="sm" onClick={() => setEdition("nouveau")}>
            <Plus className="h-3.5 w-3.5" /> Nouveau type
          </Button>
        )
      }
    >
      <DataTable
        rows={meta.leave_types}
        rowKey={(t) => t.id}
        columns={[
          { key: "code", label: "Code", render: (t) => <span className="font-mono text-xs">{t.code}</span> },
          { key: "name", label: "Type", render: (t) => t.name },
          { key: "paid", label: "Rémunérée", render: (t) => (t.paid ? "Oui" : <span className="text-warn">Non : retenue</span>) },
          { key: "balance", label: "Décompte du solde", render: (t) => (t.deducts_balance ? "Oui" : "Non") },
          { key: "doc", label: "Justificatif", render: (t) => (t.needs_document ? "Exigé" : "–") },
          { key: "max", label: "Durée maximale", align: "right", render: (t) => (t.max_days ? `${fmtDec(t.max_days)}${INSECABLE}j` : "–") },
          { key: "active", label: "", render: (t) => (!t.active ? <Badge>Archivé</Badge> : null) },
          {
            key: "x",
            label: "",
            align: "right",
            render: (t) =>
              ecrit ? (
                <Button variant="ghost" size="sm" aria-label="Modifier" onClick={() => setEdition(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : null,
          },
        ]}
      />
      {edition && (
        <EditionTypeAbsence
          type={edition === "nouveau" ? null : edition}
          onClose={() => setEdition(null)}
          onDone={() => {
            setEdition(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function EditionTypeAbsence({ type, onClose, onDone }: { type: LeaveType | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: type?.code ?? "", name: type?.name ?? "", paid: type?.paid ?? true, deducts_balance: type?.deducts_balance ?? false, needs_document: type?.needs_document ?? false, max_days: String(type?.max_days ?? 0).replace(".", ","), active: type?.active ?? true });
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const body = { ...f, code: f.code.trim().toUpperCase(), name: f.name.trim(), max_days: nombre(f.max_days) };
    try {
      if (type) await apiSend("PATCH", `/rh/leave-types/${type.id}`, body);
      else await apiSend("POST", "/rh/leave-types", body);
      onDone();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }
  const coche = (k: "paid" | "deducts_balance" | "needs_document" | "active", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <Modal
      open
      title={type ? type.name : "Nouveau type d'absence"}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!f.code.trim() || !f.name.trim() || Boolean(erreurNombre(f.max_days))} onClick={enregistrer}>
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
        <Field label="Code">
          <Input className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field error={erreurNombre(f.max_days)} label="Durée maximale par demande (jours ouvrables, 0 : sans limite)">
          <Input inputMode="decimal" value={f.max_days} onChange={(e) => setF({ ...f, max_days: e.target.value })} />
        </Field>
        <Field label="Libellé" className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          {coche("paid", "Absence rémunérée (sinon retenue sur salaire)")}
          {coche("deducts_balance", "Décomptée du solde de congés payés")}
          {coche("needs_document", "Justificatif exigé")}
          {coche("active", "Type actif (proposé aux demandes)")}
        </div>
      </div>
    </Modal>
  );
}

function Feries({ ecrit }: { ecrit: boolean }) {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const { data, error, mutate } = useApi<Holiday[]>(`/rh/holidays?year=${annee}`);
  const [date, setDate] = useState("");
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  // Envoi en cours (ajout, ou identifiant du jour retiré) : un double clic n'ajoute pas deux fois le jour.
  const [envoi, setEnvoi] = useState<"ajout" | number | null>(null);
  useEffect(() => setErreur(null), [annee]);
  async function ajouter() {
    if (envoi !== null) return;
    setErreur(null);
    setEnvoi("ajout");
    try {
      await apiSend("POST", "/rh/holidays", { date, name: nom.trim() });
      setDate("");
      setNom("");
      void mutate();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(null);
    }
  }
  async function supprimer(h: Holiday) {
    if (!(await demanderConfirmation(`Retirer le jour férié « ${h.name} » du ${fmtDate(h.date)} ?`, { action: "Retirer", danger: true }))) return;
    setErreur(null);
    setEnvoi(h.id);
    try {
      await apiSend("DELETE", `/rh/holidays/${h.id}`);
      void mutate();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(null);
    }
  }
  return (
    <Card
      title={`Jours fériés ${annee}`}
      actions={
        <span className="flex items-center gap-1">
          <Button variant="ghost" aria-label="Année précédente" onClick={() => setAnnee(annee - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" aria-label="Année suivante" onClick={() => setAnnee(annee + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </span>
      }
    >
      <p className="mb-3 text-[13px] text-ink-2">Les fêtes religieuses à date mobile (Aïd el-Fitr, Tabaski, Maouloud) suivent l&apos;annonce officielle : ajoutez-les ou corrigez leur date chaque année.</p>
      {erreur && (
        <div className="mb-3">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      {!data ? (
        <Etat error={error} onRetry={() => mutate()} />
      ) : (
        <DataTable
          dense
          rows={data}
          rowKey={(h) => h.id}
          empty="Aucun jour férié enregistré pour cette année."
          columns={[
            { key: "date", label: "Date", render: (h) => new Date(`${h.date}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), sortValue: (h) => h.date },
            { key: "name", label: "Fête", render: (h) => h.name },
            {
              key: "x",
              label: "",
              align: "right",
              render: (h) =>
                ecrit ? (
                  <Button variant="ghost" size="sm" aria-label="Retirer" loading={envoi === h.id} disabled={envoi !== null} onClick={() => void supprimer(h)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {ecrit && (
        <div className="mt-4 grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Fête">
            <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Tabaski" />
          </Field>
          <Button variant="primary" loading={envoi === "ajout"} disabled={!date || !nom.trim() || envoi !== null} onClick={ajouter}>
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
        </div>
      )}
    </Card>
  );
}

function Departements({ meta, ecrit, onChanged }: { meta: Meta; ecrit: boolean; onChanged: () => void }) {
  const [edition, setEdition] = useState<Department | "nouveau" | null>(null);
  return (
    <Card
      padded={false}
      title="Départements"
      actions={
        ecrit && (
          <Button size="sm" onClick={() => setEdition("nouveau")}>
            <Plus className="h-3.5 w-3.5" /> Nouveau département
          </Button>
        )
      }
    >
      <DataTable
        rows={meta.departments}
        rowKey={(d) => d.id}
        empty="Aucun département."
        columns={[
          { key: "name", label: "Département", render: (d) => d.name, sortValue: (d) => d.name },
          { key: "company", label: "Société", render: (d) => (d.company ? <PastilleSociete company={d.company} /> : <span className="text-[12.5px] text-muted" title={meta.companies.length > 1 ? undefined : "Géré par un compte ouvert aux deux sociétés"}>Les deux sociétés</span>), sortValue: (d) => d.company?.name ?? "" },
          { key: "manager", label: "Responsable", render: (d) => d.manager?.name ?? "–" },
          { key: "headcount", label: "Effectif", align: "right", render: (d) => String(d.headcount), sortValue: (d) => d.headcount },
          { key: "active", label: "", render: (d) => (!d.active ? <Badge>Archivé</Badge> : null) },
          {
            key: "x",
            label: "",
            align: "right",
            render: (d) =>
              ecrit && (d.company || meta.companies.length > 1) ? (
                <Button variant="ghost" size="sm" aria-label="Modifier" onClick={() => setEdition(d)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : null,
          },
        ]}
      />
      {edition && (
        <EditionDepartement
          meta={meta}
          departement={edition === "nouveau" ? null : edition}
          onClose={() => setEdition(null)}
          onDone={() => {
            setEdition(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function EditionDepartement({ meta, departement, onClose, onDone }: { meta: Meta; departement: Department | null; onClose: () => void; onDone: () => void }) {
  const [nom, setNom] = useState(departement?.name ?? "");
  const [responsable, setResponsable] = useState(departement?.manager ? String(departement.manager.id) : "");
  // Un compte ouvert à une seule société crée les départements de cette société : un département
  // commun (sans société) ne se gère que par un compte ouvert aux deux (refus 403 du noyau).
  const [societe, setSociete] = useState(departement?.company ? String(departement.company.id) : meta.companies.length === 1 ? String(meta.companies[0]!.id) : "");
  const [actif, setActif] = useState(departement?.active ?? true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const body = { name: nom.trim(), company_id: societe ? Number(societe) : null, manager_id: responsable ? Number(responsable) : null, active: actif };
    try {
      if (departement) await apiSend("PATCH", `/rh/departments/${departement.id}`, body);
      else await apiSend("POST", "/rh/departments", body);
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
      title={departement ? departement.name : "Nouveau département"}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!nom.trim()} onClick={enregistrer}>
          Enregistrer
        </Button>
      }
    >
      <div className="space-y-3">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <Field label="Nom">
          <Input value={nom} onChange={(e) => setNom(e.target.value)} />
        </Field>
        {meta.companies.length > 1 && (
          <Field label="Société" hint="Un département commun regroupe le personnel des deux sociétés">
            <Select value={societe} onChange={(e) => setSociete(e.target.value)} placeholder="Les deux sociétés" options={meta.companies.map((c) => ({ value: c.id, label: nomCourt(c) }))} />
          </Field>
        )}
        <Field label="Responsable">
          <Select value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder="Aucun" options={meta.employees.filter((e) => !societe || e.company_id === Number(societe)).map((e) => ({ value: e.id, label: `${e.name} (${e.matricule})` }))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} /> Département actif
        </label>
      </div>
    </Modal>
  );
}
