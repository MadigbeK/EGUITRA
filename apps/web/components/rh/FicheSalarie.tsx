"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, Download, FileText, LogOut, Pencil, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Etat, Field, Input, Kpi, Modal, Notice, PageHeader, Select, Tabs, demanderConfirmation } from "@/components/ui";
import { apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { fmtDate, fmtDec, fmtGNF } from "@/lib/format";
import { CONTRACT_LABELS, type Employee, type EmployeeDocument, type Meta } from "@/lib/rh-types";
import { ChampMontant, EtatAbsence, EtatSalarie, Ligne, PastilleSociete, erreurNombre, jours, libelle, messageErreur, moisLong, nombre, periode } from "./commun";
import { FormulaireSalarie } from "./FormulaireSalarie";
import { SaisieAbsence } from "./Conges";

type Onglet = "identite" | "contrat" | "conges" | "documents" | "paie";

/** Fiche d'un salarié : identité, contrat et rémunération, congés, documents, paie. */
export function FicheSalarie({ id }: { id: string }) {
  const { data: e, error, mutate } = useApi<Employee>(`/rh/employees/${id}`);
  const { data: meta, error: erreurMeta, mutate: rafraichirMeta } = useApi<Meta>("/rh/meta");
  const [onglet, setOnglet] = useState<Onglet>("identite");
  const [edition, setEdition] = useState(false);
  const [sortie, setSortie] = useState(false);
  if (error) return <ErrorBox error={error} onRetry={() => mutate()} />;
  if (!e || !meta) return <Etat error={erreurMeta} onRetry={() => rafraichirMeta()} label="Chargement du dossier…" />;
  const ecrit = meta.can_write;
  const rafraichir = () => void mutate();

  return (
    <div>
      <Link href="/rh/salaries" className="no-print mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" /> Salariés
      </Link>
      <PageHeader
        title={e.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{e.matricule}</span>
            <PastilleSociete company={e.company} />
            <span>{[e.job_title, e.department?.name].filter(Boolean).join(", ") || "Fonction à préciser"}</span>
            <EtatSalarie state={e.state} />
            {e.absent_today && <Badge tone="accent">Absent aujourd&apos;hui</Badge>}
          </span>
        }
        actions={
          ecrit && (
            <>
              <Button onClick={() => setEdition(true)}>
                <Pencil className="h-4 w-4" /> Modifier
              </Button>
              {e.state !== "sorti" && (
                <Button variant="danger" onClick={() => setSortie(true)}>
                  <LogOut className="h-4 w-4" /> Sortie
                </Button>
              )}
            </>
          )
        }
      />
      {e.issues.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">À compléter : {e.issues.join(" ; ")}.</Notice>
        </div>
      )}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Brut mensuel" value={fmtGNF(e.monthly_gross)} hint={`Salaire de base ${fmtGNF(e.base_salary)}`} />
        <Kpi label="Ancienneté" value={`${fmtDec(e.seniority_years)} an(s)`} hint={`Embauché le ${fmtDate(e.hire_date)}`} />
        <Kpi label="Solde de congés" value={jours(e.balance.balance)} hint={e.balance.pending ? `${jours(e.balance.pending)} en attente de validation` : "Aucune demande en attente"} tone={e.balance.balance < 0 ? "danger" : "neutral"} />
        <Kpi label="Contrat" value={CONTRACT_LABELS[e.contract_type]} hint={e.contract_end ? `Jusqu'au ${fmtDate(e.contract_end)}` : e.trial_end ? `Essai jusqu'au ${fmtDate(e.trial_end)}` : "Sans terme"} tone={e.state === "essai" ? "warn" : "neutral"} />
      </div>
      <Tabs
        value={onglet}
        onChange={setOnglet}
        tabs={[
          { key: "identite", label: "Identité" },
          { key: "contrat", label: "Contrat et rémunération" },
          { key: "conges", label: "Congés", count: e.leaves.length },
          { key: "documents", label: "Documents", count: e.documents.length },
          { key: "paie", label: "Paie", count: e.payslips.length },
        ]}
      />
      {onglet === "identite" && <Identite e={e} meta={meta} />}
      {onglet === "contrat" && <Contrat e={e} meta={meta} ecrit={ecrit} onChanged={rafraichir} />}
      {onglet === "conges" && <CongesSalarie e={e} meta={meta} ecrit={ecrit} onChanged={rafraichir} />}
      {onglet === "documents" && <Documents e={e} meta={meta} ecrit={ecrit} onChanged={rafraichir} />}
      {onglet === "paie" && <PaieSalarie e={e} />}
      {edition && (
        <FormulaireSalarie
          meta={meta}
          employee={e}
          onClose={() => setEdition(false)}
          onDone={() => {
            setEdition(false);
            rafraichir();
          }}
        />
      )}
      {sortie && (
        <Sortie
          e={e}
          meta={meta}
          onClose={() => setSortie(false)}
          onDone={() => {
            setSortie(false);
            rafraichir();
          }}
        />
      )}
    </div>
  );
}

function Identite({ e, meta }: { e: Employee; meta: Meta }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="État civil">
        <dl>
          <Ligne label="Sexe">{e.gender === "homme" ? "Homme" : e.gender === "femme" ? "Femme" : "–"}</Ligne>
          <Ligne label="Naissance">{e.birth_date ? `${fmtDate(e.birth_date)}${e.birth_place ? ` à ${e.birth_place}` : ""}${e.age !== null ? ` (${e.age} ans)` : ""}` : "–"}</Ligne>
          <Ligne label="Nationalité">{e.nationality ?? "–"}</Ligne>
          <Ligne label="Situation familiale">{libelle(meta.marital_statuses, e.marital_status)}</Ligne>
          <Ligne label="Enfants à charge">{String(e.children)}</Ligne>
          <Ligne label="Pièce d'identité">{e.id_number ?? "–"}</Ligne>
          <Ligne label="Numéro CNSS">{e.cnss_number ? <span className="font-mono">{e.cnss_number}</span> : <span className="text-warn">À renseigner</span>}</Ligne>
        </dl>
      </Card>
      <Card title="Coordonnées">
        <dl>
          <Ligne label="Téléphone">{e.phone ?? "–"}</Ligne>
          <Ligne label="Courriel">{e.email ?? "–"}</Ligne>
          <Ligne label="Adresse">{e.address ?? "–"}</Ligne>
          <Ligne label="Personne à prévenir">{e.emergency_contact ? `${e.emergency_contact}${e.emergency_phone ? `, ${e.emergency_phone}` : ""}` : "–"}</Ligne>
          <Ligne label="Compte NIMOVA">{e.user ? `${e.user.name} (${e.user.login})` : "Aucun : pas d'accès à « Mon espace »"}</Ligne>
          {e.driver && <Ligne label="Chauffeur du transport">{e.driver.name}</Ligne>}
        </dl>
        {e.note && <p className="mt-4 whitespace-pre-line rounded-xl bg-panel-2 px-4 py-3 text-sm text-ink-2">{e.note}</p>}
      </Card>
    </div>
  );
}

function Contrat({ e, meta, ecrit, onChanged }: { e: Employee; meta: Meta; ecrit: boolean; onChanged: () => void }) {
  const [edition, setEdition] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Card className="lg:col-span-5" title="Poste et contrat">
        <dl>
          <Ligne label="Employeur">{e.company.name}</Ligne>
          <Ligne label="Fonction">{e.job_title ?? "–"}</Ligne>
          <Ligne label="Département">{e.department?.name ?? "–"}</Ligne>
          <Ligne label="Responsable">{e.manager ? <Link className="hover:underline" href={`/rh/salaries/${e.manager.id}`}>{e.manager.name}</Link> : "–"}</Ligne>
          <Ligne label="Catégorie">{libelle(meta.categories, e.category)}</Ligne>
          <Ligne label="Contrat">{CONTRACT_LABELS[e.contract_type]}</Ligne>
          <Ligne label="Embauche">{fmtDate(e.hire_date)}</Ligne>
          <Ligne label="Fin d'essai">{e.trial_end ? fmtDate(e.trial_end) : "–"}</Ligne>
          <Ligne label="Fin de contrat">{e.contract_end ? fmtDate(e.contract_end) : "–"}</Ligne>
          {e.exit_date && <Ligne label="Sortie">{`${fmtDate(e.exit_date)}, ${libelle(meta.exit_reasons, e.exit_reason)}`}</Ligne>}
          <Ligne label="Activité imputée">{e.activity?.name ?? <span className="text-warn">À préciser</span>}</Ligne>
          <Ligne label="Paiement">
            {libelle(meta.payment_methods, e.payment_method)}
            {e.payment_method === "virement" && (e.bank_account ? `, ${e.bank_name ?? ""} ${e.bank_account}` : ", compte à renseigner")}
            {e.payment_method === "mobile" && (e.mobile_money ? `, ${e.mobile_money}` : ", numéro à renseigner")}
          </Ligne>
        </dl>
      </Card>
      <div className="space-y-6 lg:col-span-7">
        <Card
          title="Rémunération mensuelle"
          actions={
            ecrit && (
              <Button size="sm" onClick={() => setEdition(true)}>
                <Pencil className="h-3.5 w-3.5" /> Éléments fixes
              </Button>
            )
          }
        >
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-line/70">
                <td className="py-2 text-ink">Salaire de base</td>
                <td className="py-2 text-right font-mono tabular">{fmtGNF(e.base_salary)}</td>
              </tr>
              {e.fixed_lines.map((l) => (
                <tr key={l.id} className="border-b border-line/70">
                  <td className="py-2 text-ink-2">
                    {l.rubric.name}
                    {l.rubric.input === "hours" && <span className="text-muted"> ({fmtDec(l.quantity)} h)</span>}
                  </td>
                  <td className="py-2 text-right font-mono tabular">{l.rubric.input === "hours" ? "selon le taux horaire" : fmtGNF(l.amount)}</td>
                </tr>
              ))}
              <tr>
                <td className="pt-3 font-semibold text-ink">Brut mensuel</td>
                <td className="pt-3 text-right font-mono font-semibold tabular">{fmtGNF(e.monthly_gross)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-[12.5px] text-muted">
            Le simulateur donne le net et le coût employeur correspondants ; les éléments du mois (primes, heures supplémentaires) se saisissent sur le bulletin.
          </p>
        </Card>
        <Card title="Historique du salaire de base">
          {e.salary_history.length === 0 ? (
            <p className="text-sm text-muted">Aucun changement depuis l&apos;embauche.</p>
          ) : (
            <DataTable
              dense
              rows={e.salary_history}
              rowKey={(h) => h.id}
              columns={[
                { key: "date", label: "Date", render: (h) => fmtDate(h.date) },
                { key: "old", label: "Avant", align: "right", render: (h) => fmtGNF(h.old_salary) },
                { key: "new", label: "Après", align: "right", render: (h) => fmtGNF(h.new_salary) },
                { key: "var", label: "Écart", align: "right", render: (h) => (h.old_salary ? `${h.new_salary >= h.old_salary ? "+" : ""}${fmtDec(((h.new_salary - h.old_salary) / h.old_salary) * 100)} %` : "–") },
                { key: "reason", label: "Motif", render: (h) => `${h.reason ?? "–"} (${h.user})` },
              ]}
            />
          )}
        </Card>
      </div>
      {edition && (
        <ElementsFixes
          e={e}
          meta={meta}
          onClose={() => setEdition(false)}
          onDone={() => {
            setEdition(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Primes et indemnités versées chaque mois : remplacées en bloc (PATCH fixed_lines). */
function ElementsFixes({ e, meta, onClose, onDone }: { e: Employee; meta: Meta; onClose: () => void; onDone: () => void }) {
  const rubriques = meta.rubrics.filter((r) => r.active && !r.system && r.kind === "gain");
  const [lignes, setLignes] = useState(e.fixed_lines.map((l) => ({ rubric_id: String(l.rubric.id), valeur: String(l.rubric.input === "hours" ? l.quantity : l.amount).replace(".", ",") })));
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rubrique = (id: string) => rubriques.find((r) => r.id === Number(id));
  // Montant ou heures illisible : en erreur sous le champ, et rien n'est envoyé (il valait 0).
  const illisible = lignes.some((l) => l.rubric_id && erreurNombre(l.valeur));

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    try {
      const fixed_lines = lignes
        .filter((l) => l.rubric_id)
        .map((l) => (rubrique(l.rubric_id)?.input === "hours" ? { rubric_id: Number(l.rubric_id), quantity: nombre(l.valeur) } : { rubric_id: Number(l.rubric_id), amount: nombre(l.valeur) }));
      await apiSend("PATCH", `/rh/employees/${e.id}`, { fixed_lines });
      onDone();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title={`Éléments fixes, ${e.name}`}
      onClose={() => !busy && onClose()}
      footer={
        <Button variant="primary" loading={busy} disabled={illisible} onClick={enregistrer}>
          Enregistrer
        </Button>
      }
    >
      <div className="space-y-3">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-sm text-ink-2">
          Primes et indemnités versées chaque mois, au prorata de la présence. Les indemnités forfaitaires (logement, transport, panier, cherté de vie) sont exonérées de RTS dans la limite de 25 % du brut.
        </p>
        {lignes.length === 0 && <p className="text-sm text-muted">Aucun élément fixe : seul le salaire de base est versé.</p>}
        {lignes.map((l, i) => {
          const r = rubrique(l.rubric_id);
          return (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_10rem_auto] items-end gap-2">
              <Field label={i === 0 ? "Rubrique" : ""}>
                <Select value={l.rubric_id} placeholder="Choisir" onChange={(ev) => setLignes(lignes.map((x, j) => (j === i ? { ...x, rubric_id: ev.target.value } : x)))} options={rubriques.map((x) => ({ value: x.id, label: x.name }))} />
              </Field>
              <Field label={i === 0 ? "Montant ou heures" : ""} error={erreurNombre(l.valeur)}>
                <ChampMontant value={l.valeur} placeholder={r?.input === "hours" ? "heures" : "GNF"} onChange={(v) => setLignes(lignes.map((x, j) => (j === i ? { ...x, valeur: v } : x)))} />
              </Field>
              <Button variant="ghost" aria-label="Retirer" onClick={() => setLignes(lignes.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button onClick={() => setLignes([...lignes, { rubric_id: "", valeur: "" }])}>
          <Plus className="h-4 w-4" /> Ajouter un élément
        </Button>
      </div>
    </Modal>
  );
}

function CongesSalarie({ e, meta, ecrit, onChanged }: { e: Employee; meta: Meta; ecrit: boolean; onChanged: () => void }) {
  const [saisie, setSaisie] = useState(false);
  const b = e.balance;
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Card className="lg:col-span-4" title="Solde de congés payés">
        <dl>
          <Ligne label={b.initial_date ? `Reprise au ${fmtDate(b.initial_date)}` : "Solde de reprise"}>{jours(b.initial)}</Ligne>
          <Ligne label="Acquis depuis">{`+ ${jours(b.acquired)}`}</Ligne>
          <Ligne label="Pris">{`− ${jours(b.taken)}`}</Ligne>
          <Ligne label="Solde">
            <span className={b.balance < 0 ? "font-semibold text-danger" : "font-semibold"}>{jours(b.balance)}</span>
          </Ligne>
          <Ligne label="En attente">{jours(b.pending)}</Ligne>
        </dl>
      </Card>
      <Card
        className="lg:col-span-8"
        title="Absences"
        actions={
          ecrit && (
            <Button size="sm" onClick={() => setSaisie(true)}>
              <Plus className="h-3.5 w-3.5" /> Saisir une absence
            </Button>
          )
        }
      >
        {e.leaves.length === 0 ? (
          <Empty title="Aucune absence enregistrée" />
        ) : (
          <DataTable
            dense
            rows={e.leaves}
            rowKey={(l) => l.id}
            columns={[
              { key: "type", label: "Type", render: (l) => l.type.name },
              { key: "periode", label: "Période", render: (l) => periode(l.date_from, l.date_to, l.half_day), sortValue: (l) => l.date_from },
              { key: "days", label: "Jours", align: "right", render: (l) => jours(l.days) },
              { key: "state", label: "État", render: (l) => <EtatAbsence state={l.state} /> },
              { key: "note", label: "Motif", render: (l) => l.refusal_reason ?? l.note ?? "–" },
            ]}
          />
        )}
      </Card>
      {saisie && (
        <SaisieAbsence
          meta={meta}
          employeeId={e.id}
          onClose={() => setSaisie(false)}
          onDone={() => {
            setSaisie(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function Documents({ e, meta, ecrit, onChanged }: { e: Employee; meta: Meta; ecrit: boolean; onChanged: () => void }) {
  const [depot, setDepot] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Document en cours d'ouverture ou de suppression : son bouton est en chargement.
  const [encours, setEncours] = useState<number | null>(null);
  async function supprimer(d: EmployeeDocument) {
    if (!(await demanderConfirmation(`Supprimer le document « ${d.name} » ?`, { action: "Supprimer", danger: true }))) return;
    setErreur(null);
    setEncours(d.id);
    try {
      await apiSend("DELETE", `/rh/documents/${d.id}`);
      onChanged();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEncours(null);
    }
  }
  async function ouvrir(d: EmployeeDocument) {
    setErreur(null);
    setEncours(d.id);
    try {
      await apiDownload(`/rh/documents/${d.id}/file`, d.name);
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEncours(null);
    }
  }
  return (
    <Card
      title="Documents du dossier"
      actions={
        ecrit && (
          <Button size="sm" onClick={() => setDepot(true)}>
            <Plus className="h-3.5 w-3.5" /> Ajouter un document
          </Button>
        )
      }
    >
      {erreur && (
        <div className="mb-3">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      {e.documents.length === 0 ? (
        <Empty title="Aucun document" hint="Contrat signé, pièce d'identité, diplômes, visite médicale, permis : chacun avec sa date d'échéance, rappelée dans l'échéancier." />
      ) : (
        <DataTable
          dense
          rows={e.documents}
          rowKey={(d) => d.id}
          columns={[
            { key: "kind", label: "Nature", render: (d) => libelle(meta.document_kinds, d.kind) },
            { key: "name", label: "Document", render: (d) => d.name },
            {
              key: "expiry",
              label: "Échéance",
              render: (d) =>
                d.expiry_date ? (
                  <span className="flex items-center gap-2">
                    {fmtDate(d.expiry_date)}
                    {d.expired ? <Badge tone="danger">Expiré</Badge> : d.expires_soon ? <Badge tone="warn">Bientôt</Badge> : null}
                  </span>
                ) : (
                  "–"
                ),
              sortValue: (d) => d.expiry_date ?? "",
            },
            {
              key: "x",
              label: "",
              align: "right",
              render: (d) => (
                <span className="flex justify-end gap-1.5">
                  {d.has_file && (
                    <Button size="sm" loading={encours === d.id} disabled={encours !== null} onClick={() => void ouvrir(d)}>
                      <Download className="h-3.5 w-3.5" /> Ouvrir
                    </Button>
                  )}
                  {ecrit && (
                    <Button variant="ghost" size="sm" aria-label="Supprimer" disabled={encours !== null} onClick={() => void supprimer(d)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
      {depot && (
        <DepotDocument
          e={e}
          meta={meta}
          onClose={() => setDepot(false)}
          onDone={() => {
            setDepot(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function DepotDocument({ e, meta, onClose, onDone }: { e: Employee; meta: Meta; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<string>("contrat");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function envoyer() {
    setBusy(true);
    setErreur(null);
    const form = new FormData();
    form.append("kind", kind);
    form.append("name", name.trim() || libelle(meta.document_kinds, kind as EmployeeDocument["kind"]));
    if (expiry) form.append("expiry_date", expiry);
    if (fichier) form.append("file", fichier);
    try {
      await apiUpload(`/rh/employees/${e.id}/documents`, form);
      onDone();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Ajouter un document"
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} onClick={envoyer}>
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
        <Field label="Nature">
          <Select value={kind} onChange={(ev) => setKind(ev.target.value)} options={meta.document_kinds.map((k) => ({ value: k.code, label: k.label }))} />
        </Field>
        <Field label="Date d'échéance" hint="Rappelée dans l'échéancier">
          <Input type="date" value={expiry} onChange={(ev) => setExpiry(ev.target.value)} />
        </Field>
        <Field label="Intitulé" className="sm:col-span-2">
          <Input value={name} placeholder={libelle(meta.document_kinds, kind as EmployeeDocument["kind"])} onChange={(ev) => setName(ev.target.value)} />
        </Field>
        <Field label="Fichier (PDF, image, Word, Excel ; facultatif)" className="sm:col-span-2">
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" className="text-sm" onChange={(ev) => setFichier(ev.target.files?.[0] ?? null)} />
        </Field>
      </div>
    </Modal>
  );
}

function PaieSalarie({ e }: { e: Employee }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Bulletins de paie">
        {e.payslips.length === 0 ? (
          <Empty title="Aucun bulletin" hint="Les bulletins apparaissent dès la première paie préparée." />
        ) : (
          <DataTable
            dense
            rows={e.payslips}
            rowKey={(p) => p.id}
            columns={[
              { key: "month", label: "Mois", render: (p) => moisLong(p.month), sortValue: (p) => p.month },
              { key: "gross", label: "Brut", align: "right", render: (p) => fmtGNF(p.gross) },
              { key: "net", label: "Net", align: "right", render: (p) => fmtGNF(p.net) },
              {
                key: "x",
                label: "",
                align: "right",
                render: (p) => (
                  <Link href={`/rh/paie/bulletins/${p.id}`}>
                    <Button size="sm">
                      <FileText className="h-3.5 w-3.5" /> Bulletin
                    </Button>
                  </Link>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Card title="Avances et prêts">
        {e.advances.length === 0 ? (
          <Empty title="Aucune avance ni prêt" />
        ) : (
          <DataTable
            dense
            rows={e.advances}
            rowKey={(a) => a.id}
            columns={[
              { key: "kind", label: "Nature", render: (a) => (a.kind === "pret" ? "Prêt" : "Avance") },
              { key: "date", label: "Date", render: (a) => fmtDate(a.date) },
              { key: "amount", label: "Montant", align: "right", render: (a) => fmtGNF(a.amount) },
              { key: "remaining", label: "Reste dû", align: "right", render: (a) => fmtGNF(a.remaining) },
              { key: "state", label: "", render: (a) => <Badge tone={a.state === "open" ? "warn" : a.state === "done" ? "ok" : "neutral"}>{a.state === "open" ? "En cours" : a.state === "done" ? "Soldé" : "Annulé"}</Badge> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

/** Sortie du salarié : date et motif ; ses absences futures et ses éléments cessent à cette date. */
function Sortie({ e, meta, onClose, onDone }: { e: Employee; meta: Meta; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [motif, setMotif] = useState<string>("demission");
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function valider() {
    setBusy(true);
    setErreur(null);
    try {
      await apiSend("POST", `/rh/employees/${e.id}/exit`, { exit_date: date, exit_reason: motif });
      onDone();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={`Sortie de ${e.name}`}
      onClose={onClose}
      footer={
        <Button variant="danger" loading={busy} disabled={!date} onClick={valider}>
          Enregistrer la sortie
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-ink-2">
          Le salarié est payé jusqu&apos;à cette date (prorata sur la paie du mois). Son solde de congés à la sortie est de {jours(e.balance.balance)} : l&apos;indemnité compensatrice éventuelle se saisit sur son dernier bulletin.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date de sortie (dernier jour travaillé)">
            <Input type="date" value={date} min={e.hire_date} onChange={(ev) => setDate(ev.target.value)} />
          </Field>
          <Field label="Motif">
            <Select value={motif} onChange={(ev) => setMotif(ev.target.value)} options={meta.exit_reasons.map((r) => ({ value: r.code, label: r.label }))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
