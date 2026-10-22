"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Notice, Select, Tabs, Textarea } from "@/components/ui";
import { apiSend } from "@/lib/api-client";
import type { Employee, EmployeeInput, Meta } from "@/lib/rh-types";
import { ChampMontant, PastilleSociete, libelleSalarie, messageErreur, nombre, nomCourt, useSocieteDeTravail } from "./commun";

type Section = "poste" | "identite" | "paiement" | "lien";

const vide = (v: string) => (v.trim() ? v.trim() : null);
const texte = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/**
 * Création ou modification d'un dossier salarié, en quatre sections : poste et contrat, identité,
 * paiement, liens (compte NIMOVA, chauffeur, solde de reprise). Seuls le nom et la date d'embauche
 * sont exigés : le reste se complète plus tard, l'échéancier rappelle ce qui manque. L'employeur se
 * choisit à la création (défaut : la société de travail) et ne change plus ensuite ; les listes de
 * choix (départements, activités, chauffeurs, comptes) suivent l'employeur.
 */
export function FormulaireSalarie({ meta, employee, onClose, onDone }: { meta: Meta; employee?: Employee; onClose: () => void; onDone: (e: Employee) => void }) {
  const [section, setSection] = useState<Section>("poste");
  const travail = useSocieteDeTravail();
  const [f, setF] = useState({
    company_id: employee ? String(employee.company.id) : meta.companies.length === 1 ? String(meta.companies[0]!.id) : "",
    name: employee?.name ?? "",
    job_title: employee?.job_title ?? "",
    department_id: texte(employee?.department?.id),
    manager_id: texte(employee?.manager?.id),
    category: employee?.category ?? "",
    contract_type: employee?.contract_type ?? "cdi",
    hire_date: employee?.hire_date ?? new Date().toISOString().slice(0, 10),
    contract_end: employee?.contract_end ?? "",
    trial_end: employee?.trial_end ?? "",
    base_salary: texte(employee?.base_salary || ""),
    salary_reason: "",
    activity_id: texte(employee?.activity?.id),
    gender: employee?.gender ?? "",
    birth_date: employee?.birth_date ?? "",
    birth_place: employee?.birth_place ?? "",
    nationality: employee?.nationality ?? "Guinéenne",
    id_number: employee?.id_number ?? "",
    cnss_number: employee?.cnss_number ?? "",
    marital_status: employee?.marital_status ?? "",
    children: texte(employee?.children ?? 0),
    phone: employee?.phone ?? "",
    email: employee?.email ?? "",
    address: employee?.address ?? "",
    emergency_contact: employee?.emergency_contact ?? "",
    emergency_phone: employee?.emergency_phone ?? "",
    payment_method: employee?.payment_method ?? "virement",
    bank_name: employee?.bank_name ?? "",
    bank_account: employee?.bank_account ?? "",
    mobile_money: employee?.mobile_money ?? "",
    user_id: texte(employee?.user?.id),
    driver_id: texte(employee?.driver?.id),
    leave_initial: texte(employee?.leave_initial ?? 0),
    leave_initial_date: employee?.leave_initial_date ?? "",
    note: employee?.note ?? "",
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const salaireChange = employee !== undefined && nombre(f.base_salary) !== employee.base_salary;
  const employeur = Number(f.company_id) || null;
  // Création : la société de travail est proposée dès que la session est lue.
  useEffect(() => {
    if (employee || f.company_id || !travail) return;
    const proposee = meta.companies.find((c) => c.id === travail) ?? meta.companies[0];
    if (proposee) setF((x) => ({ ...x, company_id: String(proposee.id) }));
  }, [employee, f.company_id, travail, meta.companies]);
  const departements = meta.departments.filter((d) => d.active && (!d.company || d.company.id === employeur));
  const activites = meta.activities.filter((a) => !a.company_id || a.company_id === employeur);
  const chauffeurs = meta.drivers.filter((d) => d.company_id === employeur);
  // Le compte déjà lié reste proposé ; sinon, les comptes ouverts à l'employeur.
  const comptes = [...(employee?.user ? [employee.user] : []), ...meta.users.filter((u) => u.id !== employee?.user?.id && employeur !== null && u.company_ids.includes(employeur))];

  /** Changer d'employeur retire les choix qui ne lui appartiennent pas. */
  function changerEmployeur(id: string) {
    const n = Number(id) || null;
    setF((x) => ({
      ...x,
      company_id: id,
      department_id: meta.departments.some((d) => String(d.id) === x.department_id && (!d.company || d.company.id === n)) ? x.department_id : "",
      activity_id: meta.activities.some((a) => String(a.id) === x.activity_id && (!a.company_id || a.company_id === n)) ? x.activity_id : "",
      driver_id: meta.drivers.some((d) => String(d.id) === x.driver_id && d.company_id === n) ? x.driver_id : "",
      user_id: meta.users.some((u) => String(u.id) === x.user_id && n !== null && u.company_ids.includes(n)) ? x.user_id : "",
    }));
  }

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const id = (v: string) => (v ? Number(v) : null);
    const body: EmployeeInput = {
      ...(employee ? {} : { company_id: employeur ?? undefined }),
      name: f.name.trim(),
      job_title: vide(f.job_title),
      department_id: id(f.department_id),
      manager_id: id(f.manager_id),
      category: (f.category || null) as EmployeeInput["category"],
      contract_type: f.contract_type as EmployeeInput["contract_type"],
      hire_date: f.hire_date,
      contract_end: f.contract_type === "cdi" ? null : f.contract_end || null,
      trial_end: f.trial_end || null,
      base_salary: nombre(f.base_salary),
      activity_id: id(f.activity_id),
      gender: (f.gender || null) as EmployeeInput["gender"],
      birth_date: f.birth_date || null,
      birth_place: vide(f.birth_place),
      nationality: vide(f.nationality),
      id_number: vide(f.id_number),
      cnss_number: vide(f.cnss_number),
      marital_status: (f.marital_status || null) as EmployeeInput["marital_status"],
      children: Math.max(0, Math.round(nombre(f.children))),
      phone: vide(f.phone),
      email: vide(f.email),
      address: vide(f.address),
      emergency_contact: vide(f.emergency_contact),
      emergency_phone: vide(f.emergency_phone),
      payment_method: f.payment_method as EmployeeInput["payment_method"],
      bank_name: vide(f.bank_name),
      bank_account: vide(f.bank_account),
      mobile_money: vide(f.mobile_money),
      user_id: id(f.user_id),
      driver_id: id(f.driver_id),
      leave_initial: nombre(f.leave_initial),
      leave_initial_date: f.leave_initial_date || null,
      note: vide(f.note),
      ...(salaireChange ? { salary_reason: vide(f.salary_reason) } : {}),
    };
    try {
      const res = employee ? await apiSend<Employee>("PATCH", `/rh/employees/${employee.id}`, body) : await apiSend<Employee>("POST", "/rh/employees", body);
      onDone(res);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }

  const valide = employeur && f.name.trim() && f.hire_date && (f.contract_type !== "cdd" || f.contract_end) && (!salaireChange || f.salary_reason.trim());
  return (
    <Modal
      open
      wide
      title={employee ? `Modifier, ${employee.name}` : "Nouveau salarié"}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-[12.5px] text-muted">Seuls le nom et la date d&apos;embauche sont exigés ; le reste peut se compléter plus tard.</span>
          <Button variant="primary" loading={busy} disabled={!valide} onClick={enregistrer}>
            {employee ? "Enregistrer" : "Créer le dossier"}
          </Button>
        </>
      }
    >
      {erreur && (
        <div className="mb-4">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      <Tabs
        value={section}
        onChange={setSection}
        tabs={[
          { key: "poste", label: "Poste et contrat" },
          { key: "identite", label: "Identité" },
          { key: "paiement", label: "Paiement" },
          { key: "lien", label: "Liens et congés" },
        ]}
      />
      {section === "poste" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom et prénoms" className="sm:col-span-2">
            <Input value={f.name} onChange={set("name")} autoFocus />
          </Field>
          {employee ? (
            <Field label="Employeur" hint="L'employeur ne change pas : une mutation se fait par une sortie et une nouvelle embauche" className="sm:col-span-2">
              <div className="flex min-h-9 items-center">
                <PastilleSociete company={employee.company} />
              </div>
            </Field>
          ) : (
            <Field label="Employeur" hint="Société qui emploie, paie et déclare le salarié" className="sm:col-span-2">
              <Select value={f.company_id} onChange={(e) => changerEmployeur(e.target.value)} placeholder="Choisir la société" options={meta.companies.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
          )}
          <Field label="Fonction">
            <Input value={f.job_title} onChange={set("job_title")} placeholder="Comptable, chauffeur…" />
          </Field>
          <Field label="Département">
            <Select value={f.department_id} onChange={set("department_id")} placeholder="Aucun" options={departements.map((d) => ({ value: d.id, label: d.company ? `${d.name} (${nomCourt(d.company)})` : d.name }))} />
          </Field>
          <Field label="Responsable hiérarchique" hint="Il approuve les absences de ce salarié">
            <Select value={f.manager_id} onChange={set("manager_id")} placeholder="Aucun" options={meta.employees.filter((e) => e.id !== employee?.id).map((e) => ({ value: e.id, label: libelleSalarie(meta, e) }))} />
          </Field>
          <Field label="Catégorie">
            <Select value={f.category} onChange={set("category")} placeholder="Non précisée" options={meta.categories.map((c) => ({ value: c.code, label: c.label }))} />
          </Field>
          <Field label="Type de contrat">
            <Select value={f.contract_type} onChange={set("contract_type")} options={meta.contract_types.map((c) => ({ value: c.code, label: c.label }))} />
          </Field>
          <Field label="Date d'embauche">
            <Input type="date" value={f.hire_date} onChange={set("hire_date")} />
          </Field>
          <Field label="Fin de la période d'essai">
            <Input type="date" value={f.trial_end} min={f.hire_date} onChange={set("trial_end")} />
          </Field>
          <Field label={f.contract_type === "cdi" ? "Fin du contrat (sans objet en CDI)" : "Fin du contrat"} error={f.contract_type === "cdd" && !f.contract_end ? "Exigée pour un CDD" : undefined}>
            <Input type="date" value={f.contract_end} min={f.hire_date} disabled={f.contract_type === "cdi"} onChange={set("contract_end")} />
          </Field>
          <Field label="Salaire de base mensuel (GNF)">
            <ChampMontant value={f.base_salary} onChange={(v) => setF({ ...f, base_salary: v })} />
          </Field>
          <Field label="Activité (imputation de la masse salariale)">
            <Select value={f.activity_id} onChange={set("activity_id")} placeholder="Non imputée" options={activites.map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
          {salaireChange && (
            <Field label="Motif du changement de salaire" className="sm:col-span-2" hint="Conservé dans l'historique du salaire">
              <Input value={f.salary_reason} onChange={set("salary_reason")} placeholder="Augmentation annuelle, promotion, avenant…" />
            </Field>
          )}
          <p className="text-[12.5px] text-muted sm:col-span-2">Les primes et indemnités fixes (transport, logement…) se règlent dans l&apos;onglet « Contrat et rémunération » de la fiche.</p>
        </div>
      )}
      {section === "identite" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sexe">
            <Select value={f.gender} onChange={set("gender")} placeholder="Non précisé" options={[{ value: "homme", label: "Homme" }, { value: "femme", label: "Femme" }]} />
          </Field>
          <Field label="Situation familiale">
            <Select value={f.marital_status} onChange={set("marital_status")} placeholder="Non précisée" options={meta.marital_statuses.map((m) => ({ value: m.code, label: m.label }))} />
          </Field>
          <Field label="Date de naissance">
            <Input type="date" value={f.birth_date} onChange={set("birth_date")} />
          </Field>
          <Field label="Lieu de naissance">
            <Input value={f.birth_place} onChange={set("birth_place")} />
          </Field>
          <Field label="Nationalité">
            <Input value={f.nationality} onChange={set("nationality")} />
          </Field>
          <Field label="Enfants à charge">
            <Input inputMode="numeric" value={f.children} onChange={set("children")} />
          </Field>
          <Field label="Pièce d'identité (numéro)">
            <Input value={f.id_number} onChange={set("id_number")} />
          </Field>
          <Field label="Numéro CNSS">
            <Input className="font-mono" value={f.cnss_number} onChange={set("cnss_number")} />
          </Field>
          <Field label="Téléphone">
            <Input type="tel" value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label="Courriel">
            <Input type="email" value={f.email} onChange={set("email")} />
          </Field>
          <Field label="Adresse" className="sm:col-span-2">
            <Input value={f.address} onChange={set("address")} />
          </Field>
          <Field label="Personne à prévenir">
            <Input value={f.emergency_contact} onChange={set("emergency_contact")} />
          </Field>
          <Field label="Son téléphone">
            <Input type="tel" value={f.emergency_phone} onChange={set("emergency_phone")} />
          </Field>
        </div>
      )}
      {section === "paiement" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mode de paiement du salaire" className="sm:col-span-2">
            <Select value={f.payment_method} onChange={set("payment_method")} options={meta.payment_methods.map((p) => ({ value: p.code, label: p.label }))} />
          </Field>
          {f.payment_method === "virement" && (
            <>
              <Field label="Banque">
                <Input value={f.bank_name} onChange={set("bank_name")} />
              </Field>
              <Field label="Compte (RIB)">
                <Input className="font-mono" value={f.bank_account} onChange={set("bank_account")} />
              </Field>
            </>
          )}
          {f.payment_method === "mobile" && (
            <Field label="Numéro de paiement mobile" className="sm:col-span-2">
              <Input type="tel" className="font-mono" value={f.mobile_money} onChange={set("mobile_money")} />
            </Field>
          )}
        </div>
      )}
      {section === "lien" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Compte NIMOVA du salarié" hint="Ouvre son espace : congés, bulletins, équipe" className="sm:col-span-2">
            <Select value={f.user_id} onChange={set("user_id")} placeholder="Aucun compte lié" options={comptes.map((u) => ({ value: u.id, label: `${u.name} (${u.login})` }))} />
          </Field>
          {chauffeurs.length > 0 && (
            <Field label="Chauffeur du transport" hint="Primes de rotation, si une prime par rotation est paramétrée" className="sm:col-span-2">
              <Select value={f.driver_id} onChange={set("driver_id")} placeholder="Pas un chauffeur" options={chauffeurs.map((d) => ({ value: d.id, label: d.name }))} />
            </Field>
          )}
          <Field label="Solde de congés de reprise (jours)" hint="Jours acquis et non pris à la date ci-contre">
            <Input inputMode="decimal" value={f.leave_initial} onChange={set("leave_initial")} />
          </Field>
          <Field label="Date du solde de reprise" hint="Vide : l'acquisition court depuis l'embauche">
            <Input type="date" value={f.leave_initial_date} onChange={set("leave_initial_date")} />
          </Field>
          <Field label="Observations" className="sm:col-span-2">
            <Textarea rows={3} value={f.note} onChange={set("note")} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
