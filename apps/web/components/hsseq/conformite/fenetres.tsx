"use client";

/**
 * Fenêtres de saisie de l'écran « Audits et conformité », ouvertes au seul Responsable HSSEQ :
 * planification et modification d'un audit, réalisation, motif d'une annulation ou d'une réouverture,
 * constat, action du plan (réponse à un constat ou décision de la revue de direction), exigence et
 * revue de conformité. Chaque fenêtre envoie au noyau, garde son refus au-dessus des boutons et se
 * ferme sur la réussite.
 */

import { useState, type ReactNode } from "react";
import { Button, Field, Input, Modal, Segmented, Select, Textarea, cx } from "@/components/ui";
import { NIVEAU_MAITRISE } from "@/components/hsseq/commun";
import { aujourdhui, decaler, useReferentiels } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtGNF } from "@/lib/format";
import type { ControlLevel, HsseqAction, NewAction, Page, Ref } from "@/lib/hsseq-types";
import {
  CLASSEMENT,
  ErreurFenetre,
  NORME,
  ORDRE_CLASSEMENT,
  ORDRE_NORME,
  ORDRE_REFERENTIEL,
  ORDRE_SOURCE,
  ORDRE_STATUT_EXIGENCE,
  REFERENTIEL,
  SOURCE,
  STATUT_EXIGENCE,
  messageErreur,
} from "./commun";
import type {
  Audit,
  AuditInput,
  AuditStandard,
  AuditorKind,
  Finding,
  FindingClass,
  FindingInput,
  Requirement,
  RequirementCounts,
  RequirementDetail,
  RequirementInput,
  RequirementSource,
  RequirementStandard,
  RequirementStatus,
  ReviewInput,
} from "./types";

/** Hiérarchie des mesures, de la plus forte à la plus faible. */
const ORDRE_MAITRISE: readonly ControlLevel[] = ["elimination", "substitution", "engineering", "administrative", "ppe"];

/** Seuil d'une action coûteuse quand les référentiels ne sont pas encore lus (§6). */
const SEUIL_DEFAUT = 50_000_000;

/** Envoi d'une fenêtre : occupé pendant l'appel, refus du noyau gardé pour l'affichage, fermeture sur la réussite. */
function useEnvoi(onClose: () => void, defaut: string) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  async function envoyer(appel: () => Promise<unknown>) {
    setEnvoi(true);
    setErreur(null);
    try {
      await appel();
      onClose();
    } catch (e) {
      setErreur(messageErreur(e, defaut));
    } finally {
      setEnvoi(false);
    }
  }
  return { erreur, envoi, envoyer };
}

/** Intitulé d'un groupe de boutons (bascule), hors d'un label qui capterait les clics. */
function Groupe({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
    </div>
  );
}

/** Choix exclusif en cartes (classement d'un constat, statut d'une revue) : titre et portée de chaque option. */
function ChoixCartes<K extends string>({ legende, nom, options, valeur, onChange }: { legende: string; nom: string; options: Array<{ key: K; titre: string; aide: string }>; valeur: K | null; onChange: (k: K) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-[13px] font-medium text-ink-2">{legende}</legend>
      {options.map((o) => (
        <label key={o.key} className={cx("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors", valeur === o.key ? "border-accent bg-accent-doux" : "border-line hover:border-line-strong")}>
          <input type="radio" name={nom} className="mt-1 accent-[var(--accent)]" checked={valeur === o.key} onChange={() => onChange(o.key)} />
          <span>
            <span className="block text-sm font-semibold text-ink">{o.titre}</span>
            <span className="block text-[12.5px] text-muted">{o.aide}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Clients proposés au choix du client ou donneur d'ordre : `clients` des référentiels (servis à
 * l'administration, à la direction et au Responsable HSSEQ), le client actuel compris s'il n'y est plus.
 */
function optionsClients(clients: Ref[] | undefined, actuel: Ref | null): Array<{ value: number; label: string }> {
  const liste = clients ?? [];
  return [...(actuel && !liste.some((c) => c.id === actuel.id) ? [actuel] : []), ...liste].map((c) => ({ value: c.id, label: c.name }));
}

/** Pied d'une fenêtre : retour, et le bouton qui envoie. */
function Pied({ onClose, action, envoi, pret, onEnvoyer, retour = "Annuler", danger }: { onClose: () => void; action: string; envoi: boolean; pret: boolean; onEnvoyer: () => void; retour?: string; danger?: boolean }) {
  return (
    <>
      <Button onClick={onClose}>{retour}</Button>
      <Button variant={danger ? "danger" : "primary"} loading={envoi} disabled={!pret} onClick={onEnvoyer}>
        {action}
      </Button>
    </>
  );
}

/* ─── Audits ──────────────────────────────────────────────────────────── */

/**
 * Planification (sans `audit`) ou modification d'un audit ; en modification, seuls les champs changés
 * partent. Le client ou donneur d'ordre se choisit pour un audit client (ou quand l'audit en a déjà un).
 * Un audit réalisé reçoit aussi sa date de réalisation, passée ou du jour, et sa conclusion.
 */
export function FenetreAudit({ audit, onClose, envoyer }: { audit?: Audit; onClose: () => void; envoyer: (corps: AuditInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState(() => ({
    title: audit?.title ?? "",
    standard: audit?.standard ?? ("iso_45001" as AuditStandard),
    planned_date: audit?.planned_date ?? "",
    partner_id: audit?.partner ? String(audit.partner.id) : "",
    site_id: audit?.site ? String(audit.site.id) : "",
    scope: audit?.scope ?? "",
    auditor_kind: audit?.auditor_kind ?? ("internal" as AuditorKind),
    auditor_id: audit?.auditor_kind === "internal" && audit.auditor?.id ? String(audit.auditor.id) : "",
    auditor_name: audit?.auditor_kind === "external" ? (audit.auditor?.name ?? "") : "",
    actual_date: audit?.actual_date ?? "",
    conclusion: audit?.conclusion ?? "",
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, audit ? "Modification impossible." : "Planification impossible.");
  const realise = audit?.status === "done";
  const sites = (ref?.sites ?? []).filter((s) => s.active || String(s.id) === f.site_id);
  // L'auditeur interne actuel reste proposé, même s'il n'est plus parmi les comptes servis.
  const actuel = audit?.auditor_kind === "internal" && audit.auditor?.id ? { id: audit.auditor.id, name: audit.auditor.name } : null;
  const comptes = ref?.owners ?? [];
  const auditeurs = actuel && !comptes.some((o) => o.id === actuel.id) ? [actuel, ...comptes] : comptes;
  // Le noyau refuse une réalisation datée de demain ou plus tard (422 invalid_parameter).
  const realiseeFuture = realise && Boolean(f.actual_date) && f.actual_date > aujourdhui();
  const pret = Boolean(f.title.trim() && f.planned_date && (!realise || f.actual_date)) && !realiseeFuture;
  const client = f.standard === "client" || Boolean(f.partner_id);

  function corps(): AuditInput {
    const titre = f.title.trim();
    const perimetre = f.scope.trim() || null;
    const nom = f.auditor_name.trim() || null;
    const site = f.site_id ? Number(f.site_id) : null;
    const auditeur = f.auditor_id ? Number(f.auditor_id) : null;
    const partenaire = f.partner_id ? Number(f.partner_id) : null;
    if (!audit) {
      return { title: titre, standard: f.standard, planned_date: f.planned_date, site_id: site, scope: perimetre, auditor_kind: f.auditor_kind, ...(f.auditor_kind === "internal" ? { auditor_id: auditeur } : { auditor_name: nom }), ...(partenaire ? { partner_id: partenaire } : {}) };
    }
    const c: AuditInput = {};
    if (titre !== audit.title) c.title = titre;
    if (f.standard !== audit.standard) c.standard = f.standard;
    if (f.planned_date !== audit.planned_date) c.planned_date = f.planned_date;
    if (partenaire !== (audit.partner?.id ?? null)) c.partner_id = partenaire;
    if (site !== (audit.site?.id ?? null)) c.site_id = site;
    if (perimetre !== (audit.scope ?? null)) c.scope = perimetre;
    if (f.auditor_kind !== audit.auditor_kind) c.auditor_kind = f.auditor_kind;
    if (f.auditor_kind === "internal") {
      if (auditeur !== (actuel?.id ?? null)) c.auditor_id = auditeur;
    } else if (nom !== (audit.auditor_kind === "external" ? (audit.auditor?.name ?? null) : null)) c.auditor_name = nom;
    if (realise && f.actual_date && f.actual_date !== audit.actual_date) c.actual_date = f.actual_date;
    if (realise && (f.conclusion.trim() || null) !== (audit.conclusion ?? null)) c.conclusion = f.conclusion.trim() || null;
    return c;
  }

  return (
    <Modal
      open
      wide
      title={audit ? `Modifier l'audit ${audit.reference}` : "Planifier un audit"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={audit ? "Enregistrer" : "Planifier l'audit"}
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => {
            const c = corps();
            if (!Object.keys(c).length) return onClose();
            void lancer(() => envoyer(c));
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Intitulé" className="md:col-span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Audit interne ISO 45001 du parc de Matoto" maxLength={300} required />
        </Field>
        <Field label="Référentiel">
          <Select value={f.standard} onChange={(e) => setF({ ...f, standard: e.target.value as AuditStandard })} options={ORDRE_REFERENTIEL.map((r) => ({ value: r, label: REFERENTIEL[r].long }))} />
        </Field>
        <Field label="Prévu le">
          <Input type="date" value={f.planned_date} onChange={(e) => setF({ ...f, planned_date: e.target.value })} required />
        </Field>
        {client && (
          <Field label="Client ou donneur d'ordre" hint="Le client dont l'audit vérifie les exigences." className="md:col-span-2">
            <Select value={f.partner_id} onChange={(e) => setF({ ...f, partner_id: e.target.value })} placeholder="Aucun" options={optionsClients(ref?.clients, audit?.partner ?? null)} />
          </Field>
        )}
        <Field label="Site" hint="Sans site, l'audit n'est lu que par l'administration, la direction et le Responsable HSSEQ." className="md:col-span-2">
          <Select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })} placeholder="Aucun : siège ou plusieurs sites" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Groupe label="Auditeur">
          <Segmented<AuditorKind>
            label="Auditeur interne ou externe"
            value={f.auditor_kind}
            onChange={(k) => setF({ ...f, auditor_kind: k })}
            options={[
              { key: "internal", label: "Interne" },
              { key: "external", label: "Externe" },
            ]}
          />
        </Groupe>
        {f.auditor_kind === "internal" ? (
          <Field label="Auditeur interne">
            <Select value={f.auditor_id} onChange={(e) => setF({ ...f, auditor_id: e.target.value })} placeholder="À désigner" options={auditeurs.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
        ) : (
          <Field label="Auditeur externe et son organisme">
            <Input value={f.auditor_name} onChange={(e) => setF({ ...f, auditor_name: e.target.value })} placeholder="Nom de l'auditeur, cabinet ou donneur d'ordre" maxLength={200} />
          </Field>
        )}
        <Field label="Périmètre" className="md:col-span-2">
          <Textarea value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="Activités, lieux, processus et exigences couverts" />
        </Field>
        {realise && (
          <>
            <Field label="Réalisé le" error={realiseeFuture ? "Date passée ou du jour." : undefined}>
              <Input type="date" max={aujourdhui()} value={f.actual_date} onChange={(e) => setF({ ...f, actual_date: e.target.value })} aria-invalid={realiseeFuture || undefined} required />
            </Field>
            <Field label="Conclusion" className="md:col-span-2">
              <Textarea value={f.conclusion} onChange={(e) => setF({ ...f, conclusion: e.target.value })} placeholder="Appréciation d'ensemble, points forts, écarts à traiter" />
            </Field>
          </>
        )}
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/** Déclaration de réalisation : la date (passée ou du jour), proposée à la date prévue quand elle est passée. */
export function FenetreRealisation({ audit, onClose, envoyer }: { audit: Audit; onClose: () => void; envoyer: (jour: string) => Promise<unknown> }) {
  const jourMax = aujourdhui();
  const [jour, setJour] = useState(audit.planned_date < jourMax ? audit.planned_date : jourMax);
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Déclaration impossible.");
  return (
    <Modal open title={`Audit ${audit.reference} réalisé`} onClose={onClose} footer={<Pied onClose={onClose} action="Déclarer réalisé" envoi={envoi} pret={Boolean(jour) && jour <= jourMax} onEnvoyer={() => void lancer(() => envoyer(jour))} />}>
      <div className="space-y-4">
        <p className="text-[13px] leading-snug text-ink-2">Les constats, la conclusion et le rapport se saisissent ensuite ; l&apos;audit se clôt une fois chaque écart majeur couvert par une action.</p>
        <Field label="Réalisé le" hint="Date passée ou du jour.">
          <Input type="date" max={jourMax} value={jour} onChange={(e) => setJour(e.target.value)} required />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/** Annulation ou réouverture d'un audit : motif écrit obligatoire, journalisé. */
export function FenetreMotif({ titre, aide, action, danger, onClose, envoyer }: { titre: string; aide: string; action: string; danger?: boolean; onClose: () => void; envoyer: (motif: string) => Promise<unknown> }) {
  const [motif, setMotif] = useState("");
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Opération impossible.");
  return (
    <Modal open title={titre} onClose={onClose} footer={<Pied onClose={onClose} retour="Retour" action={action} danger={danger} envoi={envoi} pret={motif.trim().length >= 5} onEnvoyer={() => void lancer(() => envoyer(motif.trim()))} />}>
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-ink-2">{aide}</p>
        <Field label="Motif (obligatoire)" hint="Cinq caractères au moins.">
          <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/* ─── Constats et actions ─────────────────────────────────────────────── */

/** Nouveau constat d'un audit, ou modification d'un constat : classement, description, exigence liée du registre. */
export function FenetreConstat({ titre, constat, onClose, envoyer }: { titre: string; constat?: Finding; onClose: () => void; envoyer: (corps: FindingInput) => Promise<unknown> }) {
  const { data: registre } = useApi<Page<Requirement, RequirementCounts>>("/hsseq/requirements?sort=reference&limit=500");
  const [classement, setClassement] = useState<FindingClass | null>(constat?.classification ?? null);
  const [description, setDescription] = useState(constat?.description ?? "");
  const [exigence, setExigence] = useState(constat?.requirement ? String(constat.requirement.id) : "");
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Enregistrement impossible.");
  const liee = constat?.requirement ?? null;
  const exigences = (registre?.items ?? []).map((r) => ({ value: r.id, label: `${r.reference} : ${r.title}` }));
  const options = liee && !exigences.some((o) => o.value === liee.id) ? [{ value: liee.id, label: `${liee.reference} : ${liee.title}` }, ...exigences] : exigences;

  function corps(): FindingInput {
    const id = exigence ? Number(exigence) : null;
    if (!constat) return { classification: classement ?? undefined, description: description.trim(), requirement_id: id };
    const c: FindingInput = {};
    if (classement && classement !== constat.classification) c.classification = classement;
    if (description.trim() !== constat.description) c.description = description.trim();
    if (id !== (liee?.id ?? null)) c.requirement_id = id;
    return c;
  }

  return (
    <Modal
      open
      title={titre}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={constat ? "Enregistrer" : "Ajouter le constat"}
          envoi={envoi}
          pret={Boolean(classement && description.trim())}
          onEnvoyer={() => {
            const c = corps();
            if (!Object.keys(c).length) return onClose();
            void lancer(() => envoyer(c));
          }}
        />
      }
    >
      <div className="space-y-4">
        <ChoixCartes legende="Classement" nom="classement" valeur={classement} onChange={setClassement} options={ORDRE_CLASSEMENT.map((c) => ({ key: c, titre: CLASSEMENT[c].label, aide: CLASSEMENT[c].aide }))} />
        <Field label="Constat">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ce qui a été observé, où, et l'exigence qui n'est pas tenue" maxLength={4000} />
        </Field>
        <Field label="Exigence liée" hint="Exigence légale, normative ou contractuelle du registre.">
          <Select value={exigence} onChange={(e) => setExigence(e.target.value)} placeholder="Aucune" options={options} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/**
 * Nouvelle action du plan : réponse à un constat (origine « audit », le constat en fiche d'origine) ou
 * décision d'une revue de direction (origine « review », la revue en fiche d'origine, exigée par le
 * noyau). La clôture exigera une preuve jointe ; au-delà du seuil des paramètres, la direction valide la
 * dépense avant le démarrage.
 */
export function FenetreAction({ titre, origine, rappel, onClose, onCreee }: { titre: string; origine: Pick<NewAction, "origin" | "origin_id">; rappel?: ReactNode; onClose: () => void; onCreee: (a: HsseqAction) => void }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState({ description: "", control_level: "" as ControlLevel | "", owner_id: "", due_date: decaler(aujourdhui(), 30), expected_evidence: "", estimated_cost: "" });
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Création impossible.");
  const cout = f.estimated_cost.trim() === "" ? null : Math.round(Number(f.estimated_cost.replace(/\s/g, "").replace(",", ".")));
  const coutValide = cout === null || (Number.isFinite(cout) && cout >= 0);
  const seuil = ref?.costly_action_threshold ?? SEUIL_DEFAUT;
  const pret = Boolean(f.description.trim() && f.owner_id && f.due_date && coutValide);

  function corps(): NewAction {
    return {
      ...origine,
      description: f.description.trim(),
      control_level: f.control_level || null,
      owner_id: Number(f.owner_id),
      due_date: f.due_date,
      expected_evidence: f.expected_evidence.trim() || null,
      estimated_cost: cout,
    };
  }

  return (
    <Modal
      open
      wide
      title={titre}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action="Créer l'action"
          envoi={envoi}
          pret={pret}
          onEnvoyer={() =>
            void lancer(async () => {
              onCreee(await apiSend<HsseqAction>("POST", "/hsseq/actions", corps()));
            })
          }
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rappel && <div className="rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2 md:col-span-2">{rappel}</div>}
        <Field label="Action" className="md:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ce qui sera fait, par qui et où" maxLength={4000} />
        </Field>
        <Field label="Responsable">
          <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} placeholder="À choisir" options={(ref?.owners ?? []).map((o) => ({ value: o.id, label: o.name }))} />
        </Field>
        <Field label="Échéance">
          <Input type="date" min={aujourdhui()} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} required />
        </Field>
        <Field label="Niveau de maîtrise" hint="De la mesure la plus forte (élimination) à la plus faible (équipement de protection).">
          <Select value={f.control_level} onChange={(e) => setF({ ...f, control_level: e.target.value as ControlLevel | "" })} placeholder="À préciser" options={ORDRE_MAITRISE.map((n) => ({ value: n, label: NIVEAU_MAITRISE[n] }))} />
        </Field>
        <Field label="Coût estimé (GNF)" hint={`Au-delà de ${fmtGNF(seuil)}, la direction valide l'action avant son démarrage.`} error={coutValide ? undefined : "Montant invalide."}>
          <Input inputMode="numeric" value={f.estimated_cost} onChange={(e) => setF({ ...f, estimated_cost: e.target.value })} placeholder="Non chiffré" />
        </Field>
        <Field label="Preuve attendue" hint="L'action ne se clôt qu'avec sa preuve jointe (photo ou PDF)." className="md:col-span-2">
          <Textarea className="min-h-[60px]" value={f.expected_evidence} onChange={(e) => setF({ ...f, expected_evidence: e.target.value })} placeholder="Compte rendu, photo, attestation…" maxLength={2000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Exigences ───────────────────────────────────────────────────────── */

/** Référence attendue selon la source de l'exigence. */
const EXEMPLE_REFERENCE: Record<RequirementSource, string> = {
  law: "Texte et article, par exemple ADR, chapitre 8.1",
  standard: "Norme et clause, par exemple ISO 45001:2018, 8.2",
  client_contract: "Contrat et article de son annexe HSE",
};

/**
 * Nouvelle exigence du registre, ou modification ; en modification, seuls les champs changés partent.
 * Le donneur d'ordre se choisit pour une exigence d'un contrat client (ou quand elle en a déjà un).
 */
export function FenetreExigence({ exigence, onClose, envoyer }: { exigence?: RequirementDetail; onClose: () => void; envoyer: (corps: RequirementInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState(() => ({
    source: exigence?.source ?? ("law" as RequirementSource),
    source_reference: exigence?.source_reference ?? "",
    title: exigence?.title ?? "",
    standard: exigence?.standard ?? ("" as RequirementStandard | ""),
    partner_id: exigence?.partner ? String(exigence.partner.id) : "",
    summary: exigence?.summary ?? "",
    expected_evidence: exigence?.expected_evidence ?? "",
    next_review_date: exigence?.next_review_date ?? "",
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Enregistrement impossible.");
  const pret = Boolean(f.source_reference.trim() && f.title.trim());
  const contrat = f.source === "client_contract" || Boolean(f.partner_id);

  function corps(): RequirementInput {
    const valeurs: RequirementInput = {
      source: f.source,
      source_reference: f.source_reference.trim(),
      title: f.title.trim(),
      standard: f.standard || null,
      partner_id: f.partner_id ? Number(f.partner_id) : null,
      summary: f.summary.trim() || null,
      expected_evidence: f.expected_evidence.trim() || null,
      next_review_date: f.next_review_date || null,
    };
    if (!exigence) return valeurs;
    const avant: RequirementInput = {
      source: exigence.source,
      source_reference: exigence.source_reference,
      title: exigence.title,
      standard: exigence.standard,
      partner_id: exigence.partner?.id ?? null,
      summary: exigence.summary,
      expected_evidence: exigence.expected_evidence,
      next_review_date: exigence.next_review_date,
    };
    return Object.fromEntries(Object.entries(valeurs).filter(([cle, v]) => v !== avant[cle as keyof RequirementInput])) as RequirementInput;
  }

  return (
    <Modal
      open
      wide
      title={exigence ? `Modifier l'exigence ${exigence.reference}` : "Nouvelle exigence"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={exigence ? "Enregistrer" : "Ajouter au registre"}
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => {
            const c = corps();
            if (!Object.keys(c).length) return onClose();
            void lancer(() => envoyer(c));
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Groupe label="Source" className="md:col-span-2">
          <Segmented<RequirementSource> label="Source de l'exigence" value={f.source} onChange={(s) => setF({ ...f, source: s })} options={ORDRE_SOURCE.map((s) => ({ key: s, label: SOURCE[s] }))} />
        </Groupe>
        <Field label="Référence du texte" className="md:col-span-2">
          <Input value={f.source_reference} onChange={(e) => setF({ ...f, source_reference: e.target.value })} placeholder={EXEMPLE_REFERENCE[f.source]} maxLength={300} required />
        </Field>
        {contrat && (
          <Field label="Client ou donneur d'ordre" hint="Le donneur d'ordre dont le contrat porte l'exigence." className="md:col-span-2">
            <Select value={f.partner_id} onChange={(e) => setF({ ...f, partner_id: e.target.value })} placeholder="Aucun" options={optionsClients(ref?.clients, exigence?.partner ?? null)} />
          </Field>
        )}
        <Field label="Exigence" className="md:col-span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ce qui est exigé, en une phrase" maxLength={300} required />
        </Field>
        <Field label="Référentiel" hint="Rattache l'exigence à une norme pour la maturité du cockpit.">
          <Select value={f.standard} onChange={(e) => setF({ ...f, standard: e.target.value as RequirementStandard | "" })} placeholder="Aucun" options={ORDRE_NORME.map((n) => ({ value: n, label: NORME[n] }))} />
        </Field>
        <Field label="Prochaine revue">
          <Input type="date" value={f.next_review_date} onChange={(e) => setF({ ...f, next_review_date: e.target.value })} />
        </Field>
        <Field label="Résumé" className="md:col-span-2">
          <Textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="Ce que le texte demande, en clair" maxLength={4000} />
        </Field>
        <Field label="Preuve attendue" className="md:col-span-2">
          <Textarea className="min-h-[60px]" value={f.expected_evidence} onChange={(e) => setF({ ...f, expected_evidence: e.target.value })} placeholder="Registre, attestation, compte rendu qui démontre la conformité" maxLength={4000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/** Portée de chaque statut d'une revue de conformité. */
const AIDE_REVUE: Record<RequirementStatus, string> = {
  compliant: "La preuve attendue est là et à jour.",
  partial: "Une partie seulement est tenue : dites l'écart dans le constat.",
  non_compliant: "L'exigence n'est pas tenue : un constat d'audit ou une action s'impose.",
  not_evaluated: "Pas encore évaluée, ou à réévaluer.",
};

/** Revue de conformité : statut, constat de la revue et prochaine revue (postérieure à aujourd'hui ; vide, aucune n'est programmée). */
export function FenetreRevue({ exigence, onClose, envoyer }: { exigence: RequirementDetail; onClose: () => void; envoyer: (corps: ReviewInput) => Promise<unknown> }) {
  const demain = decaler(aujourdhui(), 1);
  const [statut, setStatut] = useState<RequirementStatus | null>(exigence.status === "not_evaluated" ? null : exigence.status);
  const [commentaire, setCommentaire] = useState("");
  const [prochaine, setProchaine] = useState(exigence.next_review_date && exigence.next_review_date >= demain ? exigence.next_review_date : decaler(aujourdhui(), 365));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Revue impossible.");
  const pret = statut !== null && (!prochaine || prochaine >= demain);
  return (
    <Modal
      open
      title={`Revue de l'exigence ${exigence.reference}`}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action="Enregistrer la revue"
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => {
            if (!statut) return;
            void lancer(() => envoyer({ status: statut, comment: commentaire.trim() || null, next_review_date: prochaine || null }));
          }}
        />
      }
    >
      <div className="space-y-4">
        <p className="rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">Preuve attendue : </span>
          {exigence.expected_evidence || "Non précisée."}
        </p>
        <ChoixCartes legende="Conformité constatée" nom="statut-revue" valeur={statut} onChange={setStatut} options={ORDRE_STATUT_EXIGENCE.map((s) => ({ key: s, titre: STATUT_EXIGENCE[s], aide: AIDE_REVUE[s] }))} />
        <Field label="Constat de la revue">
          <Textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Preuves vues, écarts relevés" maxLength={2000} />
        </Field>
        <Field label="Prochaine revue" hint="Postérieure à aujourd'hui. Laissée vide, aucune revue n'est programmée.">
          <Input type="date" min={demain} value={prochaine} onChange={(e) => setProchaine(e.target.value)} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}
