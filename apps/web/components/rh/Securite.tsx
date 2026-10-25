"use client";

/**
 * Habilitations, aptitude médicale et EPI du personnel (données lues par NIMOVA · HSSEQ) : onglet
 * « Sécurité » de la fiche salarié, écran « Habilitations et sécurité », section de « Mon espace »
 * et paramétrage des types d'habilitation. L'aptitude n'est enregistrée qu'en statut (apte, apte
 * avec réserve, inapte) et en dates : jamais de détail médical. Personne ne modifie ses propres habilitations
 * (le noyau répond 403) : son propre dossier s'affiche en lecture seule.
 */

import Link from "next/link";
import { useState } from "react";
import { Download, FileUp, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Empty, Etat, Field, Input, Kpi, Modal, Notice, PageHeader, Segmented, Select, Textarea, cx, demanderConfirmation, type Tone } from "@/components/ui";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { fmtDate, fmtInt, fmtJours, fmtPct, fmtRatio, pluriel } from "@/lib/format";
import {
  QUALIFICATION_STATE_LABELS,
  type Employee,
  type Fitness,
  type FitnessState,
  type Meta,
  type MySpace,
  type PpeIssue,
  type Qualification,
  type QualificationMatrix,
  type QualificationState,
  type QualificationStatus,
  type QualificationType,
  type SafetySummary,
} from "@/lib/rh-types";
import { FiltreSociete, Ligne, PastilleSociete, avecSociete, libelle, messageErreur, nombre, useMeta } from "./commun";

/* ─── Pastilles d'état ─────────────────────────────────────────────────── */

const TON_HABILITATION: Record<QualificationState, Tone> = { valide: "ok", a_renouveler: "warn", expiree: "danger", absente: "neutral" };

export function EtatHabilitation({ state, obligatoire }: { state: QualificationState; obligatoire?: boolean }) {
  // Une habilitation obligatoire absente bloque le départ du conducteur : elle se lit comme une alerte.
  return <Badge tone={state === "absente" && obligatoire ? "danger" : TON_HABILITATION[state]}>{QUALIFICATION_STATE_LABELS[state]}</Badge>;
}

const APTITUDE: Record<FitnessState, { label: string; tone: Tone }> = {
  apte: { label: "Apte", tone: "ok" },
  apte_reserve: { label: "Apte avec réserve", tone: "warn" },
  a_renouveler: { label: "Apte, visite à programmer", tone: "warn" },
  inapte: { label: "Inapte", tone: "danger" },
  echue: { label: "Aptitude échue", tone: "danger" },
  inconnu: { label: "Non renseignée", tone: "neutral" },
};

export function EtatAptitude({ fitness }: { fitness: Fitness | null }) {
  const a = APTITUDE[fitness?.state ?? "inconnu"];
  return <Badge tone={a.tone}>{a.label}</Badge>;
}

/** Origine des heures travaillées, base des taux de fréquence et de gravité. */
const BASE_HEURES: Record<SafetySummary["hours_basis"], string> = {
  paid: "heures payées des bulletins validés",
  presence: "estimation par la présence, sans pointage",
};

/** Délai restant avant une échéance : rouge à 7 jours et au-delà de l'échéance, orange à 30 jours. */
function tonDelai(jours: number): Tone {
  return jours <= 7 ? "danger" : jours <= 30 ? "warn" : "neutral";
}

function delai(jours: number): string {
  if (jours < 0) return `expirée depuis ${fmtJours(-jours)}`;
  if (jours === 0) return "expire aujourd'hui";
  return `dans ${fmtJours(jours)}`;
}

/* ─── Onglet « Sécurité » de la fiche salarié ──────────────────────────── */

export function SecuriteSalarie({ e, meta, ecrit, onChanged }: { e: Employee; meta: Meta; ecrit: boolean; onChanged: () => void }) {
  // Son propre dossier : lecture seule (le noyau refuserait la modification).
  const { data: moi } = useApi<MySpace>("/rh/me");
  const propre = moi?.employee?.id === e.id;
  const modifiable = ecrit && !propre;
  return (
    <div className="space-y-6">
      {ecrit && propre && <Notice tone="accent">C&apos;est votre propre dossier : vos habilitations, votre aptitude et vos EPI sont tenus par un autre membre du service RH.</Notice>}
      <div className="grid gap-6 lg:grid-cols-12">
        <Aptitude e={e} modifiable={modifiable} onChanged={onChanged} />
        <StatutsHabilitations e={e} />
      </div>
      <Habilitations e={e} meta={meta} modifiable={modifiable} onChanged={onChanged} />
      <Epi e={e} meta={meta} modifiable={modifiable} onChanged={onChanged} />
    </div>
  );
}

function Aptitude({ e, modifiable, onChanged }: { e: Employee; modifiable: boolean; onChanged: () => void }) {
  const [edition, setEdition] = useState(false);
  const f = e.fitness;
  return (
    <Card
      className="lg:col-span-5"
      title="Aptitude médicale"
      actions={
        modifiable && (
          <Button size="sm" onClick={() => setEdition(true)}>
            <Pencil className="h-3.5 w-3.5" /> Mettre à jour
          </Button>
        )
      }
    >
      <dl>
        <Ligne label="Statut">
          <EtatAptitude fitness={f} />
        </Ligne>
        <Ligne label="Dernière visite">{f.date ? fmtDate(f.date) : "–"}</Ligne>
        <Ligne label="Valable jusqu'au">{f.until ? fmtDate(f.until) : "–"}</Ligne>
      </dl>
      <p className="mt-3 text-[12.5px] text-muted">Aucun détail médical n&apos;est enregistré : seulement le statut (apte, apte avec réserve, inapte) et ses dates, comme sur la fiche d&apos;aptitude du médecin du travail. La réserve elle-même reste chez le médecin ; elle ne bloque pas le départ.</p>
      {edition && (
        <EditionAptitude
          e={e}
          onClose={() => setEdition(false)}
          onDone={() => {
            setEdition(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function EditionAptitude({ e, onClose, onDone }: { e: Employee; onClose: () => void; onDone: () => void }) {
  const [statut, setStatut] = useState<string>(e.fitness.status ?? "");
  const [date, setDate] = useState(e.fitness.date ?? "");
  const [jusqua, setJusqua] = useState(e.fitness.until ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    try {
      await apiSend("PATCH", `/rh/employees/${e.id}`, { medical_fitness: statut || null, medical_fitness_date: date || null, medical_fitness_until: jusqua || null });
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
      title={`Aptitude médicale, ${e.name}`}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={Boolean(statut) && !date} onClick={enregistrer}>
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
        <Field label="Statut" className="sm:col-span-2">
          <Select value={statut} onChange={(ev) => setStatut(ev.target.value)} placeholder="Non renseigné" options={[{ value: "apte", label: "Apte" }, { value: "apte_reserve", label: "Apte avec réserve" }, { value: "inapte", label: "Inapte" }]} />
        </Field>
        <Field label="Date de la visite">
          <Input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </Field>
        <Field label="Valable jusqu'au" hint="Rappelée dans l'échéancier">
          <Input type="date" value={jusqua} min={date || undefined} onChange={(ev) => setJusqua(ev.target.value)} />
        </Field>
        <p className="text-[12.5px] text-muted sm:col-span-2">N&apos;inscrivez ici aucune information médicale, ni la nature d&apos;une réserve : la fiche d&apos;aptitude elle-même peut rejoindre les documents du dossier.</p>
      </div>
    </Modal>
  );
}

function StatutsHabilitations({ e }: { e: Employee }) {
  return (
    <Card className="lg:col-span-7" title="Habilitations par type">
      {e.qualification_status.length === 0 ? (
        <Empty title="Aucune habilitation" hint="Permis, carte de conducteur, formation matières dangereuses, secourisme : chacune avec son échéance." />
      ) : (
        <ul className="divide-y divide-line/70">
          {e.qualification_status.map((q) => (
            <li key={q.code} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-ink">{q.name}</span>
                {q.mandatory && <span className="ml-2 text-[12px] text-muted">obligatoire pour conduire</span>}
              </span>
              <span className="flex items-center gap-2">
                {q.expiry && <span className="text-[12.5px] text-muted">jusqu&apos;au {fmtDate(q.expiry)}</span>}
                <EtatHabilitation state={q.state} obligatoire={q.mandatory} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Habilitations({ e, meta, modifiable, onChanged }: { e: Employee; meta: Meta; modifiable: boolean; onChanged: () => void }) {
  const [edition, setEdition] = useState<Qualification | "nouvelle" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function supprimer(q: Qualification) {
    if (!(await demanderConfirmation(`Supprimer l'habilitation « ${q.type.name} » de ${e.name} ?`, { action: "Supprimer", danger: true }))) return;
    setErreur(null);
    try {
      await apiSend("DELETE", `/rh/qualifications/${q.id}`);
      onChanged();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  }

  async function deposer(q: Qualification, fichier: File) {
    setErreur(null);
    const form = new FormData();
    form.append("file", fichier);
    try {
      await apiUpload(`/rh/qualifications/${q.id}/file`, form);
      onChanged();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  }

  return (
    <Card
      title="Habilitations saisies"
      actions={
        modifiable && (
          <Button size="sm" onClick={() => setEdition("nouvelle")}>
            <Plus className="h-3.5 w-3.5" /> Ajouter une habilitation
          </Button>
        )
      }
    >
      {erreur && (
        <div className="mb-3">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      {e.qualifications.length === 0 ? (
        <Empty title="Aucune habilitation saisie" />
      ) : (
        <DataTable
          dense
          rows={e.qualifications}
          rowKey={(q) => q.id}
          columns={[
            { key: "type", label: "Habilitation", render: (q) => q.type.name, sortValue: (q) => q.type.name },
            { key: "obtained", label: "Obtenue le", render: (q) => fmtDate(q.obtained_date), sortValue: (q) => q.obtained_date ?? "" },
            { key: "expiry", label: "Expire le", render: (q) => (q.expiry_date ? fmtDate(q.expiry_date) : "Sans échéance"), sortValue: (q) => q.expiry_date ?? "9999" },
            { key: "ref", label: "Référence", render: (q) => [q.reference, q.issuer].filter(Boolean).join(", ") || "–" },
            { key: "state", label: "État", render: (q) => <EtatHabilitation state={q.state} /> },
            {
              key: "x",
              label: "",
              align: "right",
              render: (q) => (
                <span className="flex flex-wrap justify-end gap-1.5">
                  {q.has_file && (
                    <Button size="sm" onClick={() => void apiDownload(`/rh/qualifications/${q.id}/file`, `${q.type.code}_${e.matricule}`)}>
                      <Download className="h-3.5 w-3.5" /> Justificatif
                    </Button>
                  )}
                  {modifiable && (
                    <>
                      <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-panel px-2.5 py-1 text-[12.5px] font-semibold text-ink hover:border-line-strong hover:bg-panel-2")} title={q.has_file ? "Remplacer le justificatif" : "Déposer le justificatif"}>
                        <FileUp className="h-3.5 w-3.5" /> {q.has_file ? "Remplacer" : "Déposer"}
                        <input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png" onChange={(ev) => ev.target.files?.[0] && void deposer(q, ev.target.files[0])} />
                      </label>
                      <Button size="sm" variant="ghost" aria-label="Modifier" onClick={() => setEdition(q)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="Supprimer" onClick={() => void supprimer(q)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
      {edition && (
        <EditionHabilitation
          e={e}
          meta={meta}
          qualification={edition === "nouvelle" ? null : edition}
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

function EditionHabilitation({ e, meta, qualification, onClose, onDone }: { e: Employee; meta: Meta; qualification: Qualification | null; onClose: () => void; onDone: () => void }) {
  const types = meta.qualification_types.filter((t) => t.active || t.id === qualification?.type.id);
  const [typeId, setTypeId] = useState(String(qualification?.type.id ?? types[0]?.id ?? ""));
  const [obtenue, setObtenue] = useState(qualification?.obtained_date ?? "");
  const [expire, setExpire] = useState(qualification?.expiry_date ?? "");
  const [reference, setReference] = useState(qualification?.reference ?? "");
  const [emetteur, setEmetteur] = useState(qualification?.issuer ?? "");
  const [note, setNote] = useState(qualification?.note ?? "");
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const type = types.find((t) => String(t.id) === typeId);

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const champs = { obtained_date: obtenue || null, expiry_date: expire || null, reference: reference.trim() || null, issuer: emetteur.trim() || null, note: note.trim() || null };
    try {
      const q = qualification
        ? await apiSend<Qualification>("PATCH", `/rh/qualifications/${qualification.id}`, champs)
        : await apiSend<Qualification>("POST", "/rh/qualifications", { employee_id: e.id, type_id: Number(typeId), ...champs });
      if (fichier) {
        const form = new FormData();
        form.append("file", fichier);
        await apiUpload(`/rh/qualifications/${q.id}/file`, form);
      }
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
      title={qualification ? `${qualification.type.name}, ${e.name}` : `Nouvelle habilitation, ${e.name}`}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!typeId} onClick={enregistrer}>
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
        {!qualification && (
          <Field label="Type d'habilitation" className="sm:col-span-2">
            <Select value={typeId} onChange={(ev) => setTypeId(ev.target.value)} placeholder="Choisir" options={types.map((t) => ({ value: t.id, label: `${t.name}${t.mandatory_for_drivers ? " (obligatoire pour conduire)" : ""}` }))} />
          </Field>
        )}
        <Field label="Date d'obtention">
          <Input type="date" value={obtenue} onChange={(ev) => setObtenue(ev.target.value)} />
        </Field>
        <Field label="Date d'expiration" hint={type?.validity_months ? `Vide : obtention + ${pluriel(type.validity_months, "mois", "mois")}` : "Vide : sans échéance"}>
          <Input type="date" value={expire} min={obtenue || undefined} onChange={(ev) => setExpire(ev.target.value)} />
        </Field>
        <Field label="Référence (numéro du titre)">
          <Input value={reference} onChange={(ev) => setReference(ev.target.value)} />
        </Field>
        <Field label="Délivrée par">
          <Input value={emetteur} onChange={(ev) => setEmetteur(ev.target.value)} />
        </Field>
        <Field label="Commentaire" className="sm:col-span-2">
          <Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </Field>
        <Field label={`Justificatif (PDF ou image)${type?.needs_document ? ", exigé pour ce type" : ", facultatif"}`} className="sm:col-span-2">
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-sm" onChange={(ev) => setFichier(ev.target.files?.[0] ?? null)} />
        </Field>
      </div>
    </Modal>
  );
}

function Epi({ e, meta, modifiable, onChanged }: { e: Employee; meta: Meta; modifiable: boolean; onChanged: () => void }) {
  const [ajout, setAjout] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  async function supprimer(p: PpeIssue) {
    if (!(await demanderConfirmation(`Supprimer la remise « ${libelle(meta.ppe_items, p.item)} » du ${fmtDate(p.date)} ?`, { action: "Supprimer", danger: true }))) return;
    setErreur(null);
    try {
      await apiSend("DELETE", `/rh/ppe/${p.id}`);
      onChanged();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  }
  return (
    <Card
      title="Équipements de protection remis"
      actions={
        modifiable && (
          <Button size="sm" onClick={() => setAjout(true)}>
            <Plus className="h-3.5 w-3.5" /> Enregistrer une remise
          </Button>
        )
      }
    >
      {erreur && (
        <div className="mb-3">
          <Notice tone="danger">{erreur}</Notice>
        </div>
      )}
      {e.ppe.length === 0 ? (
        <Empty title="Aucun équipement remis" hint="Casque, chaussures de sécurité, gants, gilet : la date de remise, la taille et le renouvellement prévu." />
      ) : (
        <DataTable
          dense
          rows={e.ppe}
          rowKey={(p) => p.id}
          columns={[
            { key: "item", label: "Équipement", render: (p) => [libelle(meta.ppe_items, p.item), p.description].filter(Boolean).join(", "), sortValue: (p) => p.item },
            { key: "size", label: "Taille", render: (p) => p.size ?? "–" },
            { key: "quantity", label: "Quantité", align: "right", render: (p) => fmtInt(p.quantity) },
            { key: "date", label: "Remis le", render: (p) => fmtDate(p.date), sortValue: (p) => p.date },
            { key: "renewal", label: "Renouvellement", render: (p) => (p.renewal_date ? fmtDate(p.renewal_date) : "–"), sortValue: (p) => p.renewal_date ?? "" },
            { key: "ack", label: "Remise signée", render: (p) => (p.acknowledged ? <Badge tone="ok">Signée</Badge> : <Badge tone="warn">À faire signer</Badge>) },
            {
              key: "x",
              label: "",
              align: "right",
              render: (p) =>
                modifiable ? (
                  <Button size="sm" variant="ghost" aria-label="Supprimer" onClick={() => void supprimer(p)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {ajout && (
        <RemiseEpi
          e={e}
          meta={meta}
          onClose={() => setAjout(false)}
          onDone={() => {
            setAjout(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function RemiseEpi({ e, meta, onClose, onDone }: { e: Employee; meta: Meta; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ item: meta.ppe_items[0]?.code ?? "casque", description: "", size: "", quantity: "1", date: new Date().toISOString().slice(0, 10), renewal_date: "", acknowledged: false, note: "" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    try {
      await apiSend("POST", "/rh/ppe", {
        employee_id: e.id,
        item: f.item,
        description: f.description.trim() || null,
        size: f.size.trim() || null,
        quantity: Math.max(1, Math.round(nombre(f.quantity))),
        date: f.date,
        renewal_date: f.renewal_date || null,
        acknowledged: f.acknowledged,
        note: f.note.trim() || null,
      });
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
      title={`Remise d'équipement, ${e.name}`}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!f.item || !f.date} onClick={enregistrer}>
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
        <Field label="Équipement">
          <Select value={f.item} onChange={(ev) => setF({ ...f, item: ev.target.value as typeof f.item })} options={meta.ppe_items.map((i) => ({ value: i.code, label: i.label }))} />
        </Field>
        <Field label="Précision (modèle, norme)">
          <Input value={f.description} onChange={(ev) => setF({ ...f, description: ev.target.value })} />
        </Field>
        <Field label="Taille">
          <Input value={f.size} onChange={(ev) => setF({ ...f, size: ev.target.value })} />
        </Field>
        <Field label="Quantité">
          <Input inputMode="numeric" value={f.quantity} onChange={(ev) => setF({ ...f, quantity: ev.target.value })} />
        </Field>
        <Field label="Date de remise">
          <Input type="date" value={f.date} onChange={(ev) => setF({ ...f, date: ev.target.value })} />
        </Field>
        <Field label="Renouvellement prévu">
          <Input type="date" value={f.renewal_date} min={f.date} onChange={(ev) => setF({ ...f, renewal_date: ev.target.value })} />
        </Field>
        <Field label="Commentaire" className="sm:col-span-2">
          <Textarea rows={2} value={f.note} onChange={(ev) => setF({ ...f, note: ev.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.acknowledged} onChange={(ev) => setF({ ...f, acknowledged: ev.target.checked })} /> Remise signée par le salarié
        </label>
      </div>
    </Modal>
  );
}

/* ─── Écran « Habilitations et sécurité » ──────────────────────────────── */

export function HabilitationsSecurite() {
  const { data: meta } = useMeta();
  const [societe, setSociete] = useState<number | null>(null);
  const [conducteurs, setConducteurs] = useState<"1" | "0">("1");
  const { data: securite, error: erreurSecurite, mutate: rafraichirSecurite } = useApi<SafetySummary>(avecSociete("/rh/safety", societe));
  const { data: matrice, error: erreurMatrice, mutate: rafraichirMatrice } = useApi<QualificationMatrix>(avecSociete(`/rh/qualifications/matrix?drivers_only=${conducteurs}`, societe));
  const plusieurs = (meta?.companies.length ?? 0) > 1;
  const [reprise, setReprise] = useState(false);
  const [telechargement, setTelechargement] = useState(false);
  const [erreurModele, setErreurModele] = useState<string | null>(null);

  async function modele() {
    setTelechargement(true);
    setErreurModele(null);
    try {
      await apiDownload(avecSociete(`/rh/qualifications/template?drivers_only=${conducteurs}`, societe), "reprise_habilitations.xlsx");
    } catch (e) {
      setErreurModele(messageErreur(e));
    } finally {
      setTelechargement(false);
    }
  }

  return (
    <div>
      <PageHeader title="Habilitations et sécurité" subtitle="Accidents du travail et taux de fréquence et de gravité sur 12 mois, échéances des habilitations et des aptitudes, matrice des conducteurs : un conducteur sans habilitation obligatoire valide ou sans aptitude ne peut pas partir." />
      {plusieurs && (
        <div className="mb-4">
          <FiltreSociete companies={meta?.companies} value={societe} onChange={setSociete} />
        </div>
      )}
      <Etat data={securite} error={erreurSecurite} onRetry={() => rafraichirSecurite()} label="Calcul des indicateurs de sécurité…">
        {(s) => (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Taux de fréquence" value={fmtRatio(s.frequency_rate)} hint={`${pluriel(s.accidents, "accident")} du travail avec arrêt × 1 000 000 ÷ heures travaillées`} tone={s.accidents ? "warn" : "ok"} />
              <Kpi label="Taux de gravité" value={fmtRatio(s.severity_rate)} hint={`${fmtJours(s.lost_days)} perdus × 1 000 ÷ heures travaillées`} tone={s.lost_days ? "warn" : "neutral"} />
              <Kpi label="Heures travaillées" value={fmtInt(s.worked_hours)} hint={`${BASE_HEURES[s.hours_basis]}, du ${fmtDate(s.date_from)} au ${fmtDate(s.date_to)}`} />
              <Kpi label="Conducteurs à jour" value={fmtPct(s.up_to_date_rate, 0)} hint={`${fmtInt(s.drivers_up_to_date)} sur ${fmtInt(s.drivers)} peuvent partir`} tone={s.up_to_date_rate === null ? "neutral" : s.up_to_date_rate < 100 ? "danger" : "ok"} />
            </div>
            <p className="-mt-3 mb-6 text-[12.5px] text-muted">Base des taux de fréquence et de gravité : {BASE_HEURES[s.hours_basis]}.</p>
            <Card className="mb-6" title="Échéances à 30 jours" actions={<Badge tone={s.expiring.some((x) => x.days_left <= 7) ? "danger" : s.expiring.length ? "warn" : "ok"}>{s.expiring.length ? pluriel(s.expiring.length, "échéance") : "Rien à renouveler"}</Badge>}>
              {s.expiring.length === 0 ? (
                <Empty title="Aucune échéance proche" hint="Habilitations et aptitudes sont à jour pour les 30 prochains jours." />
              ) : (
                <ul className="-mx-2 divide-y divide-line/70">
                  {[...s.expiring]
                    .sort((a, b) => a.days_left - b.days_left)
                    .map((x, i) => (
                      <li key={`${x.employee_id}-${x.kind}-${x.code}-${i}`}>
                        <Link href={`/rh/salaries/${x.employee_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-2 py-2.5 transition-colors hover:bg-panel-2">
                          <span className="min-w-0 text-sm">
                            <span className="font-medium text-ink">{x.employee.name}</span>
                            <span className="text-muted"> · {x.kind === "fitness" ? "Aptitude médicale" : x.name}</span>
                            {x.driver_id && <span className="ml-2 text-[12px] text-muted">conducteur</span>}
                          </span>
                          <span className="flex items-center gap-2 text-[12.5px] text-muted">
                            {fmtDate(x.expiry)}
                            <Badge tone={tonDelai(x.days_left)}>{delai(x.days_left)}</Badge>
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </Etat>
      {erreurModele && (
        <div className="mb-4">
          <Notice tone="danger">{erreurModele}</Notice>
        </div>
      )}
      <Card
        padded={false}
        title="Matrice des habilitations"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={conducteurs}
              onChange={setConducteurs}
              options={[
                { key: "1", label: "Conducteurs seulement" },
                { key: "0", label: "Tout le personnel" },
              ]}
            />
            <Button size="sm" loading={telechargement} onClick={modele} title="Classeur rempli de ce qui est déjà connu, à compléter puis importer">
              <Download className="h-4 w-4" /> Modèle de reprise
            </Button>
            {meta?.can_write && (
              <Button size="sm" onClick={() => setReprise(true)}>
                <FileUp className="h-4 w-4" /> Importer
              </Button>
            )}
          </div>
        }
      >
        <Etat data={matrice} error={erreurMatrice} onRetry={() => rafraichirMatrice()} label="Chargement de la matrice…">
          {(m) => <Matrice matrice={m} meta={meta} plusieurs={plusieurs} />}
        </Etat>
      </Card>
      {reprise && (
        <ImportReprise
          onClose={() => setReprise(false)}
          onDone={() => {
            rafraichirMatrice();
            rafraichirSecurite();
          }}
        />
      )}
    </div>
  );
}

interface ResultatReprise {
  created: number;
  updated: number;
  fitness: number;
  unchanged: number;
}

/** Reprise des habilitations et des aptitudes par le classeur modèle (tout ou rien). */
function ImportReprise({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fichier, setFichier] = useState<File | null>(null);
  const [resultat, setResultat] = useState<ResultatReprise | null>(null);
  const [erreur, setErreur] = useState<{ message: string; lignes: string[] } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  async function importer() {
    if (!fichier) return;
    setEnvoi(true);
    setErreur(null);
    setResultat(null);
    try {
      const form = new FormData();
      form.append("file", fichier);
      setResultat(await apiUpload<ResultatReprise>("/rh/qualifications/import", form));
      onDone();
    } catch (e) {
      setErreur({ message: messageErreur(e), lignes: e instanceof ApiError ? ((e.body as { errors?: string[] }).errors ?? []) : [] });
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Modal
      open
      title="Importer la reprise des habilitations"
      onClose={onClose}
      footer={
        resultat ? (
          <Button variant="primary" onClick={onClose}>
            Fermer
          </Button>
        ) : (
          <Button variant="primary" loading={envoi} disabled={!fichier} onClick={importer}>
            Importer
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Partez du « Modèle de reprise » : il contient une rangée par conducteur et par habilitation, et une rangée d&apos;aptitude par conducteur, déjà remplies de ce qui est connu. Complétez les dates (JJ/MM/AAAA), la référence et l&apos;organisme ; laissez vide une habilitation que le salarié n&apos;a pas. Une expiration vide est calculée depuis l&apos;obtention.
        </p>
        <p className="text-muted">Rien n&apos;est enregistré si une rangée est en erreur. Les justificatifs se déposent ensuite sur chaque fiche.</p>
        {erreur && (
          <Notice tone="danger">
            <div>{erreur.message}</div>
            {erreur.lignes.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {erreur.lignes.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        {resultat && (
          <Notice tone="ok">
            {resultat.created + resultat.updated + resultat.fitness === 0
              ? "Rien de nouveau : le classeur reprend ce qui est déjà enregistré."
              : [
                  resultat.created ? pluriel(resultat.created, "habilitation ajoutée", "habilitations ajoutées") : null,
                  resultat.updated ? pluriel(resultat.updated, "habilitation mise à jour", "habilitations mises à jour") : null,
                  resultat.fitness ? pluriel(resultat.fitness, "aptitude mise à jour", "aptitudes mises à jour") : null,
                ]
                  .filter(Boolean)
                  .join(", ") + "."}
          </Notice>
        )}
        {!resultat && (
          <input
            type="file"
            accept=".xlsx"
            aria-label="Classeur de reprise"
            onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
            className="text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong/70 file:bg-panel file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-panel-2"
          />
        )}
      </div>
    </Modal>
  );
}

const POINT: Record<QualificationState, string> = { valide: "bg-ok", a_renouveler: "bg-warn", expiree: "bg-danger", absente: "bg-line-strong" };

function Matrice({ matrice, meta, plusieurs }: { matrice: QualificationMatrix; meta: Meta | undefined; plusieurs: boolean }) {
  if (matrice.rows.length === 0) return <Empty title="Personne à afficher" hint="Liez les chauffeurs du transport à leur dossier salarié pour suivre leurs habilitations." />;
  const types = matrice.types.filter((t) => t.active);
  return (
    <>
      <div className="overflow-x-auto px-4 pb-2">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="sticky left-0 z-10 min-w-[13rem] bg-panel py-2 pr-3 font-semibold">Salarié</th>
              <th className="px-2 py-2 font-semibold">Aptitude</th>
              {types.map((t) => (
                <th key={t.id} title={t.name} className="px-2 py-2 text-center font-semibold">
                  <span className="block font-mono text-[11.5px]">{t.code}</span>
                  {t.mandatory_for_drivers && <span className="block text-[10.5px] font-medium text-muted">obligatoire</span>}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-semibold">Départ</th>
            </tr>
          </thead>
          <tbody>
            {matrice.rows.map((r) => {
              const societe = plusieurs ? meta?.companies.find((c) => c.id === r.employee.company_id) : undefined;
              return (
                <tr key={r.employee.id}>
                  <td className="sticky left-0 z-10 border-t border-line/60 bg-panel py-2 pr-3">
                    <Link href={`/rh/salaries/${r.employee.id}`} className="font-medium text-ink hover:underline">
                      {r.employee.name}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                      {r.employee.matricule}
                      {r.driver && <span>chauffeur {r.driver.name}</span>}
                      {societe && <PastilleSociete company={societe} />}
                    </span>
                  </td>
                  <td className="border-t border-line/60 px-2 py-2">
                    <EtatAptitude fitness={r.fitness} />
                  </td>
                  {types.map((t) => {
                    const c = r.cells[t.code];
                    const etat: QualificationState = c?.state ?? "absente";
                    const titre = `${t.name} : ${QUALIFICATION_STATE_LABELS[etat]}${c?.expiry ? `, jusqu'au ${fmtDate(c.expiry)}` : ""}`;
                    return (
                      <td key={t.id} className="border-t border-line/60 px-2 py-2 text-center" title={titre}>
                        <span className={cx("inline-block h-3 w-3 rounded-full", POINT[etat], etat === "absente" && t.mandatory_for_drivers && r.driver && "bg-danger/60 ring-2 ring-danger/30")} />
                        <span className="sr-only">{titre}</span>
                      </td>
                    );
                  })}
                  <td className="border-t border-line/60 px-2 py-2 text-right">
                    {r.blocking ? (
                      <span title={r.reasons.join("\n")}>
                        <Badge tone="danger">
                          <ShieldAlert className="h-3.5 w-3.5" /> Départ refusé
                        </Badge>
                      </span>
                    ) : r.driver ? (
                      <Badge tone="ok">
                        <ShieldCheck className="h-3.5 w-3.5" /> Peut partir
                      </Badge>
                    ) : (
                      <span className="text-[12px] text-muted">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-6 py-3 text-[12px] text-ink-2">
        {(Object.keys(POINT) as QualificationState[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cx("h-2.5 w-2.5 rounded-full", POINT[k])} /> {QUALIFICATION_STATE_LABELS[k]}
          </span>
        ))}
        <span className="text-muted">Départ refusé : motifs au survol</span>
      </div>
    </>
  );
}

/* ─── Mon espace : « Mes habilitations » ───────────────────────────────── */

export function MesHabilitations({ qualifications, fitness }: { qualifications: QualificationStatus[]; fitness: Fitness | null }) {
  if (qualifications.length === 0 && !fitness) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /> Mes habilitations</span>}>
      <ul className="divide-y divide-line/70 text-sm">
        <li className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="font-medium text-ink">Aptitude médicale</span>
          <span className="flex items-center gap-2">
            {fitness?.until && <span className="text-[12.5px] text-muted">jusqu&apos;au {fmtDate(fitness.until)}</span>}
            <EtatAptitude fitness={fitness} />
          </span>
        </li>
        {qualifications.map((q) => (
          <li key={q.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="font-medium text-ink">{q.name}</span>
              {q.mandatory && <span className="ml-2 text-[12px] text-muted">obligatoire pour conduire</span>}
            </span>
            <span className="flex items-center gap-2">
              {q.expiry && <span className="text-[12.5px] text-muted">jusqu&apos;au {fmtDate(q.expiry)}</span>}
              <EtatHabilitation state={q.state} obligatoire={q.mandatory} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-muted">Une habilitation à renouveler ou un titre à jour à transmettre ? Voyez le service RH, qui tient ces informations.</p>
    </Card>
  );
}

/* ─── Paramètres : types d'habilitation ────────────────────────────────── */

export function TypesHabilitation({ meta, ecrit, onChanged }: { meta: Meta; ecrit: boolean; onChanged: () => void }) {
  const [edition, setEdition] = useState<QualificationType | "nouveau" | null>(null);
  return (
    <Card
      padded={false}
      title="Types d'habilitation"
      actions={
        ecrit && (
          <Button size="sm" onClick={() => setEdition("nouveau")}>
            <Plus className="h-3.5 w-3.5" /> Nouveau type
          </Button>
        )
      }
    >
      <DataTable
        rows={meta.qualification_types}
        rowKey={(t) => t.id}
        empty="Aucun type d'habilitation."
        columns={[
          { key: "code", label: "Code", render: (t) => <span className="font-mono text-xs">{t.code}</span>, sortValue: (t) => t.code },
          { key: "name", label: "Habilitation", render: (t) => t.name, sortValue: (t) => t.name },
          { key: "validity", label: "Validité", align: "right", render: (t) => (t.validity_months ? pluriel(t.validity_months, "mois", "mois") : "Sans échéance") },
          { key: "mandatory", label: "Conducteurs", render: (t) => (t.mandatory_for_drivers ? <Badge tone="danger">Obligatoire</Badge> : "–") },
          { key: "doc", label: "Justificatif", render: (t) => (t.needs_document ? "Exigé" : "–") },
          { key: "active", label: "", render: (t) => (!t.active ? <Badge>Archivé</Badge> : null) },
          {
            key: "x",
            label: "",
            align: "right",
            render: (t) =>
              ecrit ? (
                <Button size="sm" variant="ghost" aria-label="Modifier" onClick={() => setEdition(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : null,
          },
        ]}
      />
      {edition && (
        <EditionTypeHabilitation
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

function EditionTypeHabilitation({ type, onClose, onDone }: { type: QualificationType | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: type?.code ?? "", name: type?.name ?? "", validity_months: String(type?.validity_months ?? 0), mandatory_for_drivers: type?.mandatory_for_drivers ?? false, needs_document: type?.needs_document ?? true, active: type?.active ?? true });
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const body = { ...f, code: f.code.trim().toUpperCase(), name: f.name.trim(), validity_months: Math.max(0, Math.round(nombre(f.validity_months))) };
    try {
      if (type) await apiSend("PATCH", `/rh/qualification-types/${type.id}`, body);
      else await apiSend("POST", "/rh/qualification-types", body);
      onDone();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }
  const coche = (k: "mandatory_for_drivers" | "needs_document" | "active", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.checked })} /> {label}
    </label>
  );
  return (
    <Modal
      open
      title={type ? type.name : "Nouveau type d'habilitation"}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} disabled={!f.code.trim() || !f.name.trim()} onClick={enregistrer}>
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
          <Input className="font-mono uppercase" value={f.code} onChange={(ev) => setF({ ...f, code: ev.target.value })} />
        </Field>
        <Field label="Durée de validité (mois, 0 : sans échéance)">
          <Input inputMode="numeric" value={f.validity_months} onChange={(ev) => setF({ ...f, validity_months: ev.target.value })} />
        </Field>
        <Field label="Libellé" className="sm:col-span-2">
          <Input value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          {coche("mandatory_for_drivers", "Obligatoire pour les conducteurs (absente ou expirée : départ refusé)")}
          {coche("needs_document", "Justificatif exigé")}
          {coche("active", "Type actif (proposé à la saisie)")}
        </div>
      </div>
    </Modal>
  );
}
