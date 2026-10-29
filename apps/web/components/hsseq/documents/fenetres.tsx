"use client";

/**
 * Fenêtres de saisie de l'écran « Documents et urgences », ouvertes au seul Responsable HSSEQ :
 * procédure et version, alerte flash ou retour d'expérience, plan d'intervention, exercice (planifier,
 * déclarer réalisé, compléter), motif d'un archivage, d'une annulation ou d'une réouverture, contact de
 * l'annuaire de crise, action née d'un exercice. Chaque fenêtre envoie au noyau, garde son refus
 * au-dessus des boutons et se ferme sur la réussite ; en modification, seuls les champs changés partent.
 */

import { useState, type ReactNode } from "react";
import { Plus } from "@/components/icons";
import { Button, Field, Input, Modal, Notice, Segmented, Select, Textarea, cx } from "@/components/ui";
import { DOMAINE, INDICATEUR, NIVEAU_MAITRISE, texteErreur } from "@/components/hsseq/commun";
import { aujourdhui, decaler, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtGNF, pluriel } from "@/lib/format";
import type { ControlLevel, Domain, EventLine, HsseqAction, IndicatorCode, Page, Ref } from "@/lib/hsseq-types";
import {
  CONCLUSION_REVUE,
  NATURE_ALERTE,
  ORDRE_PUBLIC,
  ORDRE_SCENARIOS,
  ORDRE_TYPES,
  PREFIXE_REFERENCE,
  PUBLIC,
  RATTACHEMENTS,
  SCENARIO,
  TYPE_DOCUMENT,
  messageDocument,
  numeroLisible,
} from "./libelles";
import type {
  AudienceProfile,
  Bulletin,
  BulletinInput,
  BulletinKind,
  ContactInput,
  CrisisContact,
  DocRef,
  DocType,
  Drill,
  DrillInput,
  EmergencyPlan,
  NewDrillAction,
  NewProcedure,
  Objective,
  ObjectiveInput,
  PerformInput,
  PlanInput,
  PlanLine,
  Procedure,
  ProcedureInput,
  ProcedureLine,
  ProcedureVersion,
  ReviewInput,
  ReviewOutcome,
  Scenario,
  VersionInput,
} from "./types";

/* ─── Briques ─────────────────────────────────────────────────────────── */

/**
 * Compte interne servi par les référentiels (owners) : les conducteurs y figurent par leur nom seul,
 * `driver` vrai, pour les participants d'un exercice ; jamais pour l'auditeur.
 */
type CompteServi = Ref & { driver?: boolean };

/** Responsables possibles (d'un document, d'une action) : les comptes internes hors conducteurs. */
function sansConducteurs(owners: CompteServi[] | undefined): Ref[] {
  return (owners ?? []).filter((o) => !o.driver);
}

/** Envoi d'une fenêtre : occupé pendant l'appel, refus du noyau gardé pour l'affichage, fermeture sur la réussite. */
function useEnvoi(onClose: () => void, defaut: string, message: (e: unknown, d: string) => string = messageDocument) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  async function envoyer(appel: () => Promise<unknown>) {
    setEnvoi(true);
    setErreur(null);
    try {
      await appel();
      onClose();
    } catch (e) {
      setErreur(message(e, defaut));
    } finally {
      setEnvoi(false);
    }
  }
  return { erreur, envoi, envoyer };
}

/** Erreur d'une fenêtre : le message du noyau, au-dessus des boutons. */
function ErreurFenetre({ texte }: { texte: string | null }) {
  return texte ? <Notice tone="danger">{texte}</Notice> : null;
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

/** Groupe de cases ou de boutons, avec sa légende (hors d'un label, qui capterait les clics). */
function Groupe({ legende, aide, erreur, children, className }: { legende: string; aide?: ReactNode; erreur?: string | null; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cx("min-w-0", className)}>
      <legend className="mb-1.5 text-[13px] font-medium text-ink-2">{legende}</legend>
      {children}
      {erreur ? <p className="m-0 mt-1.5 text-[12px] font-medium leading-snug text-danger">{erreur}</p> : aide ? <p className="m-0 mt-1.5 text-[12px] leading-snug text-muted">{aide}</p> : null}
    </fieldset>
  );
}

/** Case à cocher en pastille, pour les choix multiples (profils, sites, contacts). */
function Case({ coche, onChange, children }: { coche: boolean; onChange: (c: boolean) => void; children: ReactNode }) {
  return (
    <label
      className={cx(
        "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-1.5 text-[13px] font-semibold transition-colors",
        coche ? "border-accent bg-accent-doux text-ink" : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink",
      )}
    >
      <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={coche} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** Ajoute ou retire une valeur d'une liste. */
function basculer<T>(liste: readonly T[], valeur: T, present: boolean): T[] {
  return present ? [...new Set([...liste, valeur])] : liste.filter((x) => x !== valeur);
}

/** Deux listes portent-elles les mêmes valeurs, dans n'importe quel ordre ? */
function memes<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Public visé d'une procédure ou d'une alerte : un profil au moins, et les sites (aucun coché : tous
 * les sites). Un compte est visé s'il porte l'un des profils et se rapporte à l'un des sites.
 */
function ChoixPublic({ profils, sites, onProfils, onSites }: { profils: AudienceProfile[]; sites: number[]; onProfils: (p: AudienceProfile[]) => void; onSites: (s: number[]) => void }) {
  const { data: ref } = useReferentiels();
  const proposes = (ref?.sites ?? []).filter((s) => s.active || sites.includes(s.id));
  return (
    <>
      <Groupe legende="Profils visés" erreur={profils.length ? null : "Choisissez au moins un profil."} className="md:col-span-2">
        <div className="flex flex-wrap gap-2">
          {ORDRE_PUBLIC.map((p) => (
            <Case key={p} coche={profils.includes(p)} onChange={(c) => onProfils(basculer(profils, p, c))}>
              {PUBLIC[p]}
            </Case>
          ))}
        </div>
      </Groupe>
      <Groupe legende="Sites visés" aide={sites.length ? "Seuls les comptes de ces sites sont visés ; la direction et l'équipe HSSEQ couvrent tous les sites." : "Aucun site coché : le document vaut pour tous les sites."} className="md:col-span-2">
        <div className="flex flex-wrap gap-2">
          {proposes.map((s) => (
            <Case key={s.id} coche={sites.includes(s.id)} onChange={(c) => onSites(basculer(sites, s.id, c))}>
              {s.name}
            </Case>
          ))}
          {!proposes.length && <span className="text-[13px] text-muted">Chargement des sites…</span>}
        </div>
      </Groupe>
    </>
  );
}

/** Nombre entier saisi (participants, durée, ordre d'appel) : nul si vide, NaN s'il est illisible. */
function entier(texte: string): number | null {
  const t = texte.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/* ─── Politiques et procédures ────────────────────────────────────────── */

/** Objectif en cours de saisie : la cible reste un texte tant qu'elle n'est pas envoyée. */
interface ObjectifSaisi {
  label: string;
  indicator_code: IndicatorCode | "";
  target: string;
}

const ORDRE_INDICATEURS = Object.keys(INDICATEUR) as IndicatorCode[];

function versObjectifs(objectifs: Objective[] | undefined): ObjectifSaisi[] {
  return (objectifs ?? []).map((o) => ({ label: o.label, indicator_code: o.indicator_code ?? "", target: o.target === null || o.target === undefined ? "" : String(o.target).replace(".", ",") }));
}

/** Nombre saisi (virgule acceptée) : nul si vide, NaN s'il est illisible. */
function decimal(texte: string): number | null {
  const t = texte.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Objectifs à envoyer ; nul si l'un d'eux est incomplet (libellé manquant, cible illisible). */
function objectifsEnvoyes(objectifs: ObjectifSaisi[]): ObjectiveInput[] | null {
  const lignes = objectifs.filter((o) => o.label.trim() || o.indicator_code || o.target.trim());
  if (lignes.some((o) => !o.label.trim() || Number.isNaN(decimal(o.target)))) return null;
  return lignes.map((o) => ({ label: o.label.trim(), indicator_code: o.indicator_code || null, target: o.indicator_code ? decimal(o.target) : null }));
}

/**
 * Objectifs chiffrés d'une version (politique surtout) : un libellé, et facultativement l'indicateur du
 * cockpit auquel il se relie et sa cible (vide : la cible des réglages). L'objectif relié se lit sur la
 * fiche avec la valeur des douze derniers mois.
 */
function EditeurObjectifs({ objectifs, onChange }: { objectifs: ObjectifSaisi[]; onChange: (o: ObjectifSaisi[]) => void }) {
  const maj = (i: number, champ: Partial<ObjectifSaisi>) => onChange(objectifs.map((o, j) => (j === i ? { ...o, ...champ } : o)));
  return (
    <Groupe legende="Objectifs" aide="Facultatifs. Reliez un objectif à un indicateur du cockpit pour lire sa valeur sur douze mois ; sans cible saisie, celle des réglages." className="md:col-span-2">
      <ul className="space-y-2.5">
        {objectifs.map((o, i) => (
          <li key={i} className="grid grid-cols-1 gap-2 rounded-[12px] border border-line p-3 sm:grid-cols-[minmax(0,1fr)_14rem_7rem_auto] sm:items-end">
            <Field label={`Objectif ${i + 1}`} error={!o.label.trim() && (o.indicator_code || o.target.trim()) ? "Libellé de l'objectif." : undefined}>
              <Input value={o.label} onChange={(e) => maj(i, { label: e.target.value })} placeholder="Zéro accident du travail avec arrêt" maxLength={300} />
            </Field>
            <Field label="Indicateur du cockpit">
              <Select value={o.indicator_code} onChange={(e) => maj(i, { indicator_code: e.target.value as IndicatorCode | "" })} placeholder="Aucun" options={ORDRE_INDICATEURS.map((c) => ({ value: c, label: INDICATEUR[c] }))} />
            </Field>
            <Field label="Cible" error={Number.isNaN(decimal(o.target)) ? "Nombre attendu." : undefined}>
              <Input inputMode="decimal" value={o.target} disabled={!o.indicator_code} onChange={(e) => maj(i, { target: e.target.value })} placeholder={o.indicator_code ? "Réglages" : "–"} />
            </Field>
            <Button size="sm" variant="ghost" onClick={() => onChange(objectifs.filter((_o, j) => j !== i))}>
              Retirer
            </Button>
          </li>
        ))}
      </ul>
      {objectifs.length < 20 && (
        <Button size="sm" className="mt-2.5" onClick={() => onChange([...objectifs, { label: "", indicator_code: "", target: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Ajouter un objectif
        </Button>
      )}
    </Groupe>
  );
}

/** Documents auxquels un document de ce type peut se rattacher (une procédure à une politique…), hors archivés. */
function useRattachements(type: DocType, actuel: DocRef | null, soi?: number) {
  const permis = RATTACHEMENTS[type];
  const { data } = useApi<Page<ProcedureLine>>(permis.length ? `/hsseq/procedures?${requete({ doc_type: permis.join(","), status: "draft,published", limit: 500 })}` : null);
  const documents: Array<Pick<DocRef, "id" | "code" | "title" | "doc_type">> = (data?.items ?? []).filter((d) => d.id !== soi);
  if (actuel && permis.includes(actuel.doc_type) && !documents.some((d) => d.id === actuel.id)) documents.unshift(actuel);
  return documents;
}

/**
 * Nouveau document (avec sa première version, en brouillon) ou modification de ses champs : type (fixé
 * une fois une version en vigueur), référence (proposée par le noyau selon le type si elle reste vide),
 * titre, document de rattachement, domaine, objet et domaine d'application, responsable, public visé,
 * périodicité de revue ; à la création, la première version : numéro, date d'effet, changements, texte
 * (l'engagement d'une politique, une consigne courte) et objectifs d'une politique. Le document d'une
 * procédure se joint ensuite sur la fiche.
 */
export function FenetreProcedure({ procedure, type: typeInitial, onClose, envoyer }: { procedure?: Procedure; type?: DocType; onClose: () => void; envoyer: (corps: NewProcedure | ProcedureInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState(() => ({
    doc_type: procedure?.doc_type ?? typeInitial ?? ("procedure" as DocType),
    code: procedure?.code ?? "",
    title: procedure?.title ?? "",
    domain: (procedure?.domain ?? "") as Domain | "",
    description: procedure?.description ?? "",
    parent_id: procedure?.parent ? String(procedure.parent.id) : "",
    owner_id: procedure?.owner ? String(procedure.owner.id) : "",
    profils: procedure ? [...procedure.audience.profiles] : (typeInitial === "policy" ? [...ORDRE_PUBLIC] : ["conducteur", "exploitation"]) as AudienceProfile[],
    sites: procedure ? procedure.audience.sites.map((s) => s.id) : ([] as number[]),
    review_months: procedure?.review.months ? String(procedure.review.months) : "",
    version: "1",
    effective_date: aujourdhui(),
    change_summary: "",
    body: "",
    objectifs: [] as ObjectifSaisi[],
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, procedure ? "Modification impossible." : "Création impossible.");
  // Le type décide de l'approbation : il ne change plus une fois une version mise en vigueur.
  const typeFige = Boolean(procedure?.versions.some((v) => v.status === "published" || v.status === "superseded"));
  const rattachements = useRattachements(f.doc_type, procedure?.parent ?? null, procedure?.id);
  const actuel = procedure?.owner ?? null;
  const comptes = sansConducteurs(ref?.owners);
  const responsables = actuel && !comptes.some((o) => o.id === actuel.id) ? [actuel, ...comptes] : comptes;
  const mois = entier(f.review_months);
  const moisValide = mois === null || (!Number.isNaN(mois) && mois >= 1 && mois <= 120);
  const objectifs = objectifsEnvoyes(f.objectifs);
  const politique = f.doc_type === "policy";
  const pret = Boolean((procedure ? f.code.trim() : true) && f.title.trim() && f.profils.length && moisValide && objectifs && (procedure || (f.version.trim() && f.effective_date)));

  function changerType(t: DocType) {
    // Un rattachement qui ne convient plus au nouveau type est retiré ; une politique vise tout le personnel.
    const parentGarde = rattachements.some((d) => String(d.id) === f.parent_id && RATTACHEMENTS[t].includes(d.doc_type));
    setF({ ...f, doc_type: t, parent_id: parentGarde ? f.parent_id : "", profils: !procedure && t === "policy" ? [...ORDRE_PUBLIC] : f.profils });
  }

  function corps(): NewProcedure | ProcedureInput {
    const domain = f.domain || null;
    const description = f.description.trim() || null;
    const owner = f.owner_id ? Number(f.owner_id) : null;
    const parent = f.parent_id ? Number(f.parent_id) : null;
    const months = mois ?? 0;
    if (!procedure) {
      // Sans responsable choisi, le noyau désigne l'auteur ; sans référence, il la propose selon le type.
      return {
        doc_type: f.doc_type, ...(f.code.trim() ? { code: f.code.trim() } : {}), title: f.title.trim(), domain, description, parent_id: parent,
        ...(owner ? { owner_id: owner } : {}), audience_profiles: f.profils, site_ids: f.sites, review_months: months,
        version: f.version.trim(), effective_date: f.effective_date, change_summary: f.change_summary.trim() || null,
        body: f.body.trim() || null, ...(objectifs?.length ? { objectives: objectifs } : {}),
      };
    }
    const c: ProcedureInput = {};
    if (f.doc_type !== procedure.doc_type) c.doc_type = f.doc_type;
    if (f.code.trim() !== procedure.code) c.code = f.code.trim();
    if (f.title.trim() !== procedure.title) c.title = f.title.trim();
    if (domain !== procedure.domain) c.domain = domain;
    if (description !== (procedure.description ?? null)) c.description = description;
    if (parent !== (procedure.parent?.id ?? null)) c.parent_id = parent;
    if (owner !== (procedure.owner?.id ?? null)) c.owner_id = owner;
    if (months !== (procedure.review.months ?? 0)) c.review_months = months;
    if (!memes(f.profils, procedure.audience.profiles)) c.audience_profiles = f.profils;
    if (!memes(f.sites, procedure.audience.sites.map((s) => s.id))) c.site_ids = f.sites;
    return c;
  }

  const permis = RATTACHEMENTS[f.doc_type];
  return (
    <Modal
      open
      wide
      title={procedure ? `Modifier ${procedure.code}` : `Nouveau document${INSECABLE}: ${TYPE_DOCUMENT[f.doc_type].label.toLocaleLowerCase("fr")}`}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={procedure ? "Enregistrer" : "Créer le document"}
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
        <Field label="Type de document" hint={typeFige ? "Fixé : une version est déjà entrée en vigueur." : politique ? "Approuvée par la direction, revue chaque année par défaut." : "Approuvé par le Responsable HSSEQ."}>
          <Select value={f.doc_type} disabled={typeFige} onChange={(e) => changerType(e.target.value as DocType)} options={ORDRE_TYPES.map((t) => ({ value: t, label: TYPE_DOCUMENT[t].label }))} />
        </Field>
        <Field label="Référence" hint={procedure ? undefined : `Vide : la suivante des ${TYPE_DOCUMENT[f.doc_type].pluriel.toLocaleLowerCase("fr")} (${PREFIXE_REFERENCE[f.doc_type]}001…).`}>
          <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder={`${PREFIXE_REFERENCE[f.doc_type]}…`} maxLength={64} required={Boolean(procedure)} />
        </Field>
        <Field label="Titre" className="md:col-span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={politique ? "Politique santé, sécurité et environnement" : "Dépotage d'une citerne chez le client"} maxLength={300} required />
        </Field>
        {permis.length > 0 && (
          <Field label={f.doc_type === "procedure" ? "Politique mise en œuvre" : "Document de rattachement"} hint={`Facultatif${INSECABLE}: ${permis.map((t) => TYPE_DOCUMENT[t].un).join(" ou ")}.`}>
            <Select value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })} placeholder="Aucun" options={rattachements.map((d) => ({ value: d.id, label: `${d.code} ${d.title}` }))} />
          </Field>
        )}
        <Field label="Domaine">
          <Select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value as Domain | "" })} placeholder="Non précisé" options={(Object.keys(DOMAINE) as Domain[]).map((d) => ({ value: d, label: DOMAINE[d] }))} />
        </Field>
        <Field label="Objet et domaine d'application" className="md:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={politique ? "Activités, sites et personnes couverts par l'engagement (salariés, sous-traitants…)" : "Opérations couvertes, du début à la fin, et qui les applique"} maxLength={4000} />
        </Field>
        <ChoixPublic profils={f.profils} sites={f.sites} onProfils={(p) => setF({ ...f, profils: p })} onSites={(s) => setF({ ...f, sites: s })} />
        <Field label="Responsable du document" hint="Il tient le document à jour, en prépare les versions et est prévenu de sa revue.">
          <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} placeholder={procedure ? "Aucun responsable" : "Vous-même"} options={responsables.map((o) => ({ value: o.id, label: o.name }))} />
        </Field>
        <Field label="Revue tous les (mois)" hint={procedure ? `Vide : la périodicité des réglages (aujourd'hui ${procedure.review.period_months} mois).` : "Vide : la périodicité des réglages pour ce type."} error={moisValide ? undefined : "De 1 à 120 mois."}>
          <Input inputMode="numeric" value={f.review_months} onChange={(e) => setF({ ...f, review_months: e.target.value })} placeholder={politique ? "12" : "Réglages"} />
        </Field>
        {!procedure && (
          <>
            <div className="md:col-span-2">
              <p className="m-0 border-t border-line pt-4 text-[13px] font-semibold text-ink">Première version</p>
              <p className="m-0 mt-1 text-[12.5px] leading-snug text-muted">
                {politique
                  ? `Elle reste en brouillon${INSECABLE}: soumettez-la à l'approbation de la direction, qui la signe${INSECABLE}; sa lecture est ensuite demandée aux comptes visés.`
                  : `Elle reste en brouillon${INSECABLE}: joignez son document sur la fiche (ou écrivez son texte), puis publiez-la ou soumettez-la${INSECABLE}; sa lecture est ensuite demandée aux comptes visés.`}
              </p>
            </div>
            <Field label="Numéro de version">
              <Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} maxLength={32} required />
            </Field>
            <Field label="Date d'effet">
              <Input type="date" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} required />
            </Field>
            <Field label="Changements apportés" className="md:col-span-2">
              <Textarea className="min-h-[60px]" value={f.change_summary} onChange={(e) => setF({ ...f, change_summary: e.target.value })} placeholder="Première édition, ou ce qui change par rapport au document précédent" maxLength={4000} />
            </Field>
            <Field label={politique ? "Engagement de la direction" : "Texte (facultatif)"} hint={politique ? "Le texte signé par la direction, affiché sur les sites et lu par les comptes visés." : "Une consigne courte se lit dans son texte ; une procédure, dans son document joint."} className="md:col-span-2">
              <Textarea className="min-h-[140px]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={politique ? "La direction d'EGUITRA GROUP s'engage à…" : "Moteur coupé, cales en place…"} maxLength={20000} />
            </Field>
            {politique && <EditeurObjectifs objectifs={f.objectifs} onChange={(o) => setF({ ...f, objectifs: o })} />}
          </>
        )}
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/** Numéro de la version suivante quand les versions sont numérotées (« 3 » après « 2 »), vide sinon. */
function versionSuivante(actuelle: string | undefined): string {
  return actuelle && /^\d+$/.test(actuelle) ? String(Number(actuelle) + 1) : "";
}

/**
 * Nouvelle version d'un document (une seule en préparation à la fois), ou modification du brouillon :
 * numéro, date d'effet, changements apportés, texte et objectifs (repris de la version en vigueur à la
 * création, sauf s'ils sont modifiés). Le document se joint ensuite sur la fiche.
 */
export function FenetreVersion({ procedure, version, onClose, envoyer }: { procedure: Procedure; version?: ProcedureVersion; onClose: () => void; envoyer: (corps: VersionInput) => Promise<unknown> }) {
  const base = version ?? procedure.current_version;
  const [f, setF] = useState(() => ({
    version: version?.version ?? versionSuivante(procedure.current_version?.version),
    effective_date: version?.effective_date ?? aujourdhui(),
    change_summary: version?.change_summary ?? "",
    body: base?.body ?? "",
    objectifs: versObjectifs(base?.objectives),
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Enregistrement impossible.");
  const politique = procedure.doc_type === "policy";
  const objectifs = objectifsEnvoyes(f.objectifs);
  const initiaux = objectifsEnvoyes(versObjectifs(base?.objectives));
  const pret = Boolean(f.version.trim() && f.effective_date && objectifs);

  function corps(): VersionInput {
    const v: VersionInput = { version: f.version.trim(), effective_date: f.effective_date, change_summary: f.change_summary.trim() || null };
    const body = f.body.trim() || null;
    const memesObjectifs = JSON.stringify(objectifs) === JSON.stringify(initiaux);
    if (!version) {
      // Texte et objectifs inchangés : le noyau reprend ceux de la version en vigueur.
      if (body !== (base?.body ?? null)) v.body = body;
      if (!memesObjectifs && objectifs) v.objectives = objectifs;
      return v;
    }
    const c: VersionInput = {};
    if (v.version !== version.version) c.version = v.version;
    if (v.effective_date !== version.effective_date) c.effective_date = v.effective_date;
    if (v.change_summary !== (version.change_summary ?? null)) c.change_summary = v.change_summary;
    if (body !== (version.body ?? null)) c.body = body;
    if (!memesObjectifs && objectifs) c.objectives = objectifs;
    return c;
  }

  return (
    <Modal
      open
      wide={politique || Boolean(f.body)}
      title={version ? `Version ${version.version} de ${procedure.code}` : `Nouvelle version de ${procedure.code}`}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={version ? "Enregistrer" : "Créer la version"}
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
        {!version && procedure.current_version && (
          <p className="m-0 rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2 md:col-span-2">
            Version {procedure.current_version.version} en vigueur depuis le {fmtDate(procedure.current_version.effective_date)}. La nouvelle version reste en préparation jusqu&apos;à sa mise en vigueur{politique ? ", après l'approbation de la direction" : ""}, qui demande de nouveau la lecture aux comptes visés.
          </p>
        )}
        <Field label="Numéro de version">
          <Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} maxLength={32} required />
        </Field>
        <Field label="Date d'effet">
          <Input type="date" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} required />
        </Field>
        <Field label="Changements apportés" hint="Lus par les comptes visés avant le document : dites ce qui change pour eux." className="md:col-span-2">
          <Textarea value={f.change_summary} onChange={(e) => setF({ ...f, change_summary: e.target.value })} placeholder="Ce qui change par rapport à la version en vigueur, et pourquoi" maxLength={4000} />
        </Field>
        <Field label={politique ? "Engagement de la direction" : "Texte (facultatif)"} hint={politique ? "Le texte signé par la direction, affiché sur les sites." : "Une consigne courte se lit dans son texte ; une procédure, dans son document joint."} className="md:col-span-2">
          <Textarea className="min-h-[140px]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={20000} />
        </Field>
        {(politique || f.objectifs.length > 0) && <EditeurObjectifs objectifs={f.objectifs} onChange={(o) => setF({ ...f, objectifs: o })} />}
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Revue périodique d'un document en vigueur : conclusion (reconduit sans changement, avec sa prochaine
 * revue ; ou nouvelle version à rédiger, préparée en brouillon depuis la version en vigueur), constats,
 * date ; et, si la revue le demande, l'action du plan d'actions qui en découle (origine « document HSE »).
 */
export function FenetreRevue({ procedure, onClose, envoyer }: { procedure: Procedure; onClose: () => void; envoyer: (corps: ReviewInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState(() => ({
    outcome: "renewed" as ReviewOutcome,
    comment: "",
    reviewed_on: aujourdhui(),
    next_review_date: "",
    version: versionSuivante(procedure.current_version?.version),
    action: false,
    description: "",
    owner_id: "",
    due_date: decaler(aujourdhui(), 30),
    expected_evidence: "",
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Revue non enregistrée.");
  const brouillon = procedure.draft_version;
  const prochaineValide = !f.next_review_date || f.next_review_date > aujourdhui();
  const actionPrete = !f.action || Boolean(f.description.trim() && f.owner_id && f.due_date);
  const pret = Boolean(f.comment.trim() && f.reviewed_on && f.reviewed_on <= aujourdhui() && prochaineValide && actionPrete);

  function corps(): ReviewInput {
    return {
      outcome: f.outcome,
      comment: f.comment.trim(),
      reviewed_on: f.reviewed_on,
      ...(f.outcome === "renewed" && f.next_review_date ? { next_review_date: f.next_review_date } : {}),
      ...(f.outcome === "revised" && !brouillon && f.version.trim() ? { version: f.version.trim() } : {}),
      ...(f.action ? { action: { description: f.description.trim(), owner_id: Number(f.owner_id), due_date: f.due_date, expected_evidence: f.expected_evidence.trim() || null } } : {}),
    };
  }

  return (
    <Modal open wide title={`Revue de ${procedure.code}`} onClose={onClose} footer={<Pied onClose={onClose} action="Enregistrer la revue" envoi={envoi} pret={pret} onEnvoyer={() => void lancer(() => envoyer(corps()))} />}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <p className="m-0 rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2 md:col-span-2">
          {procedure.review.next_review_date ? `Revue prévue le ${fmtDate(procedure.review.next_review_date)}, ` : ""}
          {`tous les ${procedure.review.period_months} mois. Version ${procedure.current_version?.version ?? ""} en vigueur depuis le ${fmtDate(procedure.current_version?.effective_date)}.`}
        </p>
        <Groupe legende="Conclusion" className="md:col-span-2">
          <Segmented<ReviewOutcome> label="Conclusion de la revue" value={f.outcome} onChange={(o) => setF({ ...f, outcome: o })} options={[{ key: "renewed", label: CONCLUSION_REVUE.renewed }, { key: "revised", label: CONCLUSION_REVUE.revised }]} />
        </Groupe>
        <Field label="Revue le">
          <Input type="date" max={aujourdhui()} value={f.reviewed_on} onChange={(e) => setF({ ...f, reviewed_on: e.target.value })} required />
        </Field>
        {f.outcome === "renewed" ? (
          <Field label="Prochaine revue le" hint={`Vide : dans ${procedure.review.period_months} mois.`} error={prochaineValide ? undefined : "Postérieure à aujourd'hui."}>
            <Input type="date" min={decaler(aujourdhui(), 1)} value={f.next_review_date} onChange={(e) => setF({ ...f, next_review_date: e.target.value })} />
          </Field>
        ) : brouillon ? (
          <p className="m-0 self-end text-[12.5px] leading-snug text-muted">{`La version ${brouillon.version}, déjà en préparation, porte la révision.`}</p>
        ) : (
          <Field label="Numéro de la nouvelle version" hint="Préparée en brouillon depuis la version en vigueur ; la prochaine revue se fixe à sa mise en vigueur.">
            <Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} maxLength={32} />
          </Field>
        )}
        <Field label="Constats et conclusion" hint="Adéquation du document aux activités, aux exigences et aux retours du terrain." className="md:col-span-2">
          <Textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} placeholder="Ce qui a été revu, ce qui reste adapté, ce qui doit changer" maxLength={4000} />
        </Field>
        <div className="md:col-span-2">
          <Case coche={f.action} onChange={(c) => setF({ ...f, action: c })}>
            Tirer une action du plan d&apos;actions
          </Case>
        </div>
        {f.action && (
          <>
            <Field label="Action" className="md:col-span-2">
              <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Afficher la politique au quai de chargement, former les nouveaux arrivants…" maxLength={4000} />
            </Field>
            <Field label="Responsable">
              <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} placeholder="À choisir" options={sansConducteurs(ref?.owners).map((o) => ({ value: o.id, label: o.name }))} />
            </Field>
            <Field label="Échéance">
              <Input type="date" min={aujourdhui()} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} required />
            </Field>
            <Field label="Preuve attendue" hint="L'action ne se clôt qu'avec sa preuve jointe." className="md:col-span-2">
              <Textarea className="min-h-[60px]" value={f.expected_evidence} onChange={(e) => setF({ ...f, expected_evidence: e.target.value })} maxLength={2000} />
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

/* ─── Alertes et retours d'expérience ─────────────────────────────────── */

/**
 * Nouvelle alerte flash ou nouveau retour d'expérience, ou modification d'un brouillon : nature, titre,
 * ce qui s'est passé, ce qu'il faut retenir, événement d'origine (jamais servi aux lecteurs), public
 * visé. Le texte reste anonyme : le noyau refuse de diffuser un nom de personne ou une immatriculation.
 */
export function FenetreAlerte({ alerte, onClose, envoyer }: { alerte?: Bulletin; onClose: () => void; envoyer: (corps: BulletinInput) => Promise<unknown> }) {
  const { data: evenements } = useApi<Page<EventLine>>("/hsseq/events?sort=-occurred_at&limit=200");
  const [f, setF] = useState(() => ({
    kind: alerte?.kind ?? ("flash_alert" as BulletinKind),
    title: alerte?.title ?? "",
    body: alerte?.body ?? "",
    key_messages: alerte?.key_messages ?? "",
    event_id: alerte?.event ? String(alerte.event.id) : "",
    profils: alerte ? [...alerte.audience.profiles] : (["conducteur", "exploitation"] as AudienceProfile[]),
    sites: alerte ? alerte.audience.sites.map((s) => s.id) : ([] as number[]),
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, alerte ? "Modification impossible." : "Création impossible.");
  const pret = Boolean(f.title.trim() && f.body.trim() && f.profils.length);
  const lie = alerte?.event ?? null;
  const options = (evenements?.items ?? []).map((e) => ({ value: e.id, label: `${e.reference}, ${e.title} (${fmtDate(e.occurred_at)})` }));
  const evenementsProposes = lie && !options.some((o) => o.value === lie.id) ? [{ value: lie.id, label: lie.reference }, ...options] : options;

  function corps(): BulletinInput {
    const v: BulletinInput = {
      kind: f.kind,
      title: f.title.trim(),
      body: f.body.trim(),
      key_messages: f.key_messages.trim() || null,
      event_id: f.event_id ? Number(f.event_id) : null,
      audience_profiles: f.profils,
      site_ids: f.sites,
    };
    if (!alerte) return v;
    const c: BulletinInput = {};
    if (v.kind !== alerte.kind) c.kind = v.kind;
    if (v.title !== alerte.title) c.title = v.title;
    if (v.body !== alerte.body) c.body = v.body;
    if (v.key_messages !== (alerte.key_messages ?? null)) c.key_messages = v.key_messages;
    if (v.event_id !== (alerte.event?.id ?? null)) c.event_id = v.event_id;
    if (!memes(f.profils, alerte.audience.profiles)) c.audience_profiles = f.profils;
    if (!memes(f.sites, alerte.audience.sites.map((s) => s.id))) c.site_ids = f.sites;
    return c;
  }

  return (
    <Modal
      open
      wide
      title={alerte ? `Modifier le brouillon ${alerte.reference}` : "Nouvelle alerte ou nouveau retour d'expérience"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={alerte ? "Enregistrer" : "Créer le brouillon"}
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
        <div className="md:col-span-2">
          <Notice tone="accent">
            Texte anonyme&nbsp;: ni nom de personne, ni immatriculation, ni code d&apos;ensemble. Le contrôle s&apos;affiche sur la fiche du brouillon, et la diffusion est refusée tant que le texte en cite.
          </Notice>
        </div>
        <Groupe legende="Nature" className="md:col-span-2">
          <Segmented<BulletinKind>
            label="Nature du document"
            value={f.kind}
            onChange={(k) => setF({ ...f, kind: k })}
            options={(Object.keys(NATURE_ALERTE) as BulletinKind[]).map((k) => ({ key: k, label: NATURE_ALERTE[k].label }))}
          />
        </Groupe>
        <Field label="Titre" className="md:col-span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ce qu'il faut savoir, en une phrase" maxLength={300} required />
        </Field>
        <Field label="Ce qui s'est passé" className="md:col-span-2">
          <Textarea className="min-h-[120px]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Les faits, le lieu et le moment, sans nommer personne ni désigner un ensemble" maxLength={8000} />
        </Field>
        <Field label="Ce qu'il faut retenir" hint="Une consigne par ligne." className="md:col-span-2">
          <Textarea value={f.key_messages} onChange={(e) => setF({ ...f, key_messages: e.target.value })} placeholder="Réduisez la vitesse avant l'entrée du virage, jamais pendant." maxLength={4000} />
        </Field>
        <Field label="Événement d'origine" hint="Jamais servi aux lecteurs ; ses personnes sont recherchées dans le texte, un seul mot de leur nom suffit." className="md:col-span-2">
          <Select value={f.event_id} onChange={(e) => setF({ ...f, event_id: e.target.value })} placeholder={evenements ? "Aucun" : "Chargement des événements…"} options={evenementsProposes} />
        </Field>
        <ChoixPublic profils={f.profils} sites={f.sites} onProfils={(p) => setF({ ...f, profils: p })} onSites={(s) => setF({ ...f, sites: s })} />
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Plans d'intervention ────────────────────────────────────────────── */

/**
 * Nouveau plan d'intervention, ou modification : site et scénario (un plan en vigueur par site et par
 * scénario), intitulé, conduite à tenir, moyens, prochaine revue, contacts à appeler (ceux du site et
 * les contacts communs à tous les sites).
 */
export function FenetrePlan({ plan, onClose, envoyer }: { plan?: EmergencyPlan; onClose: () => void; envoyer: (corps: PlanInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const { data: annuaire } = useApi<CrisisContact[]>("/hsseq/crisis-contacts");
  const [f, setF] = useState(() => ({
    site_id: plan?.site ? String(plan.site.id) : "",
    scenario: (plan?.scenario ?? "") as Scenario | "",
    title: plan?.title ?? "",
    response: plan?.response ?? "",
    resources: plan?.resources ?? "",
    review_date: plan?.review_date ?? decaler(aujourdhui(), 365),
    contacts: plan ? plan.contacts.map((c) => c.id) : ([] as number[]),
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, plan ? "Modification impossible." : "Création impossible.");
  const sites = (ref?.sites ?? []).filter((s) => s.active || String(s.id) === f.site_id);
  const site = f.site_id ? Number(f.site_id) : null;
  // Contacts proposés : ceux du site choisi et les contacts communs, dans l'ordre d'appel.
  const proposes = (annuaire ?? []).filter((c) => !c.site || c.site.id === site).sort((a, b) => a.call_order - b.call_order || a.id - b.id);
  const retenus = f.contacts.filter((id) => proposes.some((c) => c.id === id));
  // L'annuaire lu d'abord : avant, les contacts retenus ne se vérifient pas et partiraient vides.
  const pret = Boolean(annuaire && site && f.scenario && f.title.trim() && f.response.trim());

  function corps(): PlanInput {
    const v: PlanInput = {
      site_id: site ?? undefined,
      scenario: f.scenario || undefined,
      title: f.title.trim(),
      response: f.response.trim(),
      resources: f.resources.trim() || null,
      review_date: f.review_date || null,
      contact_ids: retenus,
    };
    if (!plan) return v;
    const c: PlanInput = {};
    if (v.site_id !== plan.site?.id) c.site_id = v.site_id;
    if (v.scenario !== plan.scenario) c.scenario = v.scenario;
    if (v.title !== plan.title) c.title = v.title;
    if (v.response !== plan.response) c.response = v.response;
    if (v.resources !== (plan.resources ?? null)) c.resources = v.resources;
    if (v.review_date !== (plan.review_date ?? null)) c.review_date = v.review_date;
    if (!memes(retenus, plan.contacts.map((x) => x.id))) c.contact_ids = retenus;
    return c;
  }

  return (
    <Modal
      open
      wide
      title={plan ? `Modifier le plan ${plan.reference}` : "Nouveau plan d'intervention"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={plan ? "Enregistrer" : "Créer le plan"}
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
        <Field label="Site">
          <Select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })} placeholder="À choisir" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Scénario" hint="Un seul plan en vigueur par site et par scénario.">
          <Select value={f.scenario} onChange={(e) => setF({ ...f, scenario: e.target.value as Scenario | "" })} placeholder="À choisir" options={ORDRE_SCENARIOS.map((s) => ({ value: s, label: SCENARIO[s] }))} />
        </Field>
        <Field label="Intitulé du plan" className="md:col-span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Déversement d'hydrocarbures au parc et au dépotage" maxLength={300} required />
        </Field>
        <Field label="Conduite à tenir" hint="Une étape par ligne, dans l'ordre : alerter, protéger, intervenir, rendre compte." className="md:col-span-2">
          <Textarea className="min-h-[160px]" value={f.response} onChange={(e) => setF({ ...f, response: e.target.value })} placeholder={"1. Arrêter le pompage, couper le moteur.\n2. Donner l'alerte…"} maxLength={8000} />
        </Field>
        <Field label="Moyens d'intervention" className="md:col-span-2">
          <Textarea value={f.resources} onChange={(e) => setF({ ...f, resources: e.target.value })} placeholder="Kits antidéversement, extincteurs, point de rassemblement, trousse de secours…" maxLength={4000} />
        </Field>
        <Field label="Prochaine revue du plan">
          <Input type="date" value={f.review_date} onChange={(e) => setF({ ...f, review_date: e.target.value })} />
        </Field>
        <Groupe
          legende="Contacts à appeler"
          aide={!annuaire ? "Chargement de l'annuaire de crise…" : site ? (proposes.length ? "Contacts du site et contacts communs, dans l'ordre d'appel de l'annuaire." :"Aucun contact pour ce site : ajoutez-les dans l'annuaire de crise.") : "Choisissez d'abord le site."}
          className="md:col-span-2"
        >
          <div className="flex flex-wrap gap-2">
            {site &&
              proposes.map((c) => (
                <Case key={c.id} coche={f.contacts.includes(c.id)} onChange={(x) => setF({ ...f, contacts: basculer(f.contacts, c.id, x) })}>
                  <span className="tabular text-muted">{c.call_order}.</span> {c.function}
                  <span className="font-normal text-muted">{c.site ? "" : ", tous sites"}</span>
                </Case>
              ))}
          </div>
        </Groupe>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Exercices ───────────────────────────────────────────────────────── */

/**
 * Exercice planifié sur un plan en vigueur : le plan (imposé depuis sa fiche, choisi depuis la liste des
 * exercices) et la date prévue ; il se déclare ensuite réalisé avec son bilan.
 */
export function FenetrePlanifier({ plans, planId, onClose, envoyer }: { plans: PlanLine[]; planId?: number; onClose: () => void; envoyer: (planId: number, corps: DrillInput) => Promise<unknown> }) {
  const [choisi, setChoisi] = useState(planId ? String(planId) : "");
  const [jour, setJour] = useState(decaler(aujourdhui(), 30));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Planification impossible.");
  const plan = plans.find((p) => String(p.id) === choisi) ?? null;
  const passe = Boolean(jour) && jour < aujourdhui();
  return (
    <Modal
      open
      title={planId && plan ? `Planifier un exercice du plan ${plan.reference}` : "Planifier un exercice"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action="Planifier l'exercice"
          envoi={envoi}
          pret={Boolean(plan && jour)}
          onEnvoyer={() => {
            if (plan) void lancer(() => envoyer(plan.id, { planned_date: jour }));
          }}
        />
      }
    >
      <div className="space-y-4">
        {!planId && (
          <Field label="Plan d'intervention" hint="Plans en vigueur : un plan archivé ne reçoit plus d'exercice.">
            <Select value={choisi} onChange={(e) => setChoisi(e.target.value)} placeholder="À choisir" options={plans.map((p) => ({ value: p.id, label: `${p.reference}, ${p.title}${p.site ? ` (${p.site.name})` : ""}` }))} />
          </Field>
        )}
        {plan && (
          <p className="m-0 rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2">
            {`${SCENARIO[plan.scenario]}, ${plan.site?.name ?? "site non précisé"}. `}
            {plan.last_drill ? `Dernier exercice réalisé le ${fmtDate(plan.last_drill)}` : "Aucun exercice réalisé"}
            {plan.next_drill ? `, prochain prévu le ${fmtDate(plan.next_drill)}.` : "."}
          </p>
        )}
        <Field label="Prévu le" hint={passe ? "Date passée : l'exercice apparaîtra en retard tant qu'il n'est pas déclaré réalisé." : "Le bilan se saisit une fois l'exercice réalisé."}>
          <Input type="date" value={jour} onChange={(e) => setJour(e.target.value)} required />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/**
 * Comptes proposés comme participants : les comptes internes servis par les référentiels, conducteurs
 * compris (`driver`, nom seul), plus ceux déjà retenus.
 */
function useComptes(retenus: Ref[]): CompteServi[] {
  const { data: ref } = useReferentiels();
  const comptes: CompteServi[] = ref?.owners ?? [];
  return [...retenus.filter((r) => !comptes.some((c) => c.id === r.id)), ...comptes];
}

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr");

/**
 * Comptes présents à l'exercice, cochés dans la liste des comptes internes, conducteurs compris
 * (recherche par le nom). Les personnes sans compte se comptent dans le nombre de participants.
 */
function ChoixComptes({ comptes, choisis, onChange }: { comptes: CompteServi[]; choisis: number[]; onChange: (ids: number[]) => void }) {
  const [filtre, setFiltre] = useState("");
  const cherche = sansAccents(filtre.trim());
  // Les comptes cochés restent en tête, la recherche ne les masque pas.
  const visibles = comptes.filter((c) => choisis.includes(c.id) || !cherche || sansAccents(c.name).includes(cherche)).sort((a, b) => Number(choisis.includes(b.id)) - Number(choisis.includes(a.id)));
  return (
    <Groupe legende="Comptes présents (facultatif)" aide={choisis.length ? pluriel(choisis.length, "compte coché", "comptes cochés") : "Les personnes sans compte se comptent dans le nombre de participants."} className="md:col-span-2">
      <Input type="search" value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Rechercher un nom" aria-label="Rechercher un compte" />
      <ul className="mt-2 max-h-44 overflow-y-auto rounded-[10px] border border-line">
        {visibles.map((c) => (
          <li key={c.id} className="border-b border-line/70 last:border-0">
            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] text-ink transition-colors hover:bg-panel-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={choisis.includes(c.id)} onChange={(e) => onChange(basculer(choisis, c.id, e.target.checked))} />
              {c.name}
              {c.driver && <span className="text-[12px] text-muted">conducteur</span>}
            </label>
          </li>
        ))}
        {!visibles.length && <li className="px-3 py-2 text-[13px] text-muted">Aucun compte de ce nom.</li>}
      </ul>
    </Groupe>
  );
}

/**
 * Déclaration d'un exercice réalisé : date passée ou du jour, participants (leur nombre ou les comptes
 * présents, l'un des deux au moins : 422 participants_required sinon), durée et bilan (obligatoire). Les
 * comptes et la durée partent d'abord sur l'exercice, puis la déclaration avec le bilan.
 */
export function FenetreRealiser({ exercice, onClose, envoyer }: { exercice: Drill; onClose: () => void; envoyer: (declaration: PerformInput, complement: DrillInput | null) => Promise<unknown> }) {
  const jourMax = aujourdhui();
  const comptes = useComptes(exercice.participants);
  const [f, setF] = useState(() => ({
    performed_date: exercice.planned_date <= jourMax ? exercice.planned_date : jourMax,
    participants: exercice.participants_count ? String(exercice.participants_count) : "",
    duree: exercice.duration_minutes ? String(exercice.duration_minutes) : "",
    comptes: exercice.participants.map((p) => p.id),
    debrief: exercice.debrief ?? "",
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Déclaration impossible.");
  const participants = entier(f.participants);
  const duree = entier(f.duree);
  const participantsInvalide = participants !== null && (Number.isNaN(participants) || participants < 1);
  // Des participants : leur nombre, ou des comptes présents cochés.
  const sansParticipants = participants === null && !f.comptes.length;
  const dureeInvalide = duree !== null && Number.isNaN(duree);
  const dateInvalide = !f.performed_date || f.performed_date > jourMax;
  const pret = !participantsInvalide && !sansParticipants && !dureeInvalide && !dateInvalide && Boolean(f.debrief.trim());

  function envoyerTout() {
    const complement: DrillInput = {};
    if (duree !== (exercice.duration_minutes ?? null)) complement.duration_minutes = duree;
    if (!memes(f.comptes, exercice.participants.map((p) => p.id))) complement.participant_ids = f.comptes;
    void lancer(() => envoyer({ performed_date: f.performed_date, debrief: f.debrief.trim(), participants_count: participants }, Object.keys(complement).length ? complement : null));
  }

  return (
    <Modal open wide title={`Exercice ${exercice.reference} réalisé`} onClose={onClose} footer={<Pied onClose={onClose} action="Déclarer réalisé" envoi={envoi} pret={pret} onEnvoyer={envoyerTout} />}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Réalisé le" error={f.performed_date > jourMax ? "Date passée ou du jour." : undefined}>
          <Input type="date" max={jourMax} value={f.performed_date} onChange={(e) => setF({ ...f, performed_date: e.target.value })} required />
        </Field>
        <Field label="Participants" error={participantsInvalide ? "Un nombre entier, un au moins." : undefined} hint={sansParticipants ? "Leur nombre, ou les comptes présents cochés plus bas." : undefined}>
          <Input inputMode="numeric" value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} placeholder="Nombre de personnes" />
        </Field>
        <Field label="Durée (minutes)" error={dureeInvalide ? "Un nombre entier de minutes." : undefined}>
          <Input inputMode="numeric" value={f.duree} onChange={(e) => setF({ ...f, duree: e.target.value })} placeholder="Facultatif" />
        </Field>
        <Field label="Bilan" hint="Déroulé, délais d'alerte et d'intervention, écarts constatés. Chaque écart se traite ensuite par une action du plan." className="md:col-span-3">
          <Textarea className="min-h-[120px]" value={f.debrief} onChange={(e) => setF({ ...f, debrief: e.target.value })} placeholder="Alerte donnée en 2 minutes, zone balisée en 6 minutes ; le kit du quai 2 était incomplet…" maxLength={8000} required />
        </Field>
        <div className="md:col-span-3">
          <ChoixComptes comptes={comptes} choisis={f.comptes} onChange={(ids) => setF({ ...f, comptes: ids })} />
        </div>
        <div className="md:col-span-3">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Exercice à compléter : un exercice planifié change de date ; un exercice réalisé reçoit son bilan,
 * ses participants, sa durée et ses comptes présents.
 */
export function FenetreExercice({ exercice, onClose, envoyer }: { exercice: Drill; onClose: () => void; envoyer: (corps: DrillInput) => Promise<unknown> }) {
  const realise = exercice.status === "done";
  const comptes = useComptes(exercice.participants);
  const [f, setF] = useState(() => ({
    planned_date: exercice.planned_date,
    participants: exercice.participants_count ? String(exercice.participants_count) : "",
    duree: exercice.duration_minutes ? String(exercice.duration_minutes) : "",
    comptes: exercice.participants.map((p) => p.id),
    debrief: exercice.debrief ?? "",
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Enregistrement impossible.");
  const participants = entier(f.participants);
  const duree = entier(f.duree);
  const invalide = (participants !== null && Number.isNaN(participants)) || (duree !== null && Number.isNaN(duree));
  const pret = realise ? !invalide && Boolean(f.debrief.trim()) : Boolean(f.planned_date);

  function corps(): DrillInput {
    const c: DrillInput = {};
    if (!realise) {
      if (f.planned_date !== exercice.planned_date) c.planned_date = f.planned_date;
      return c;
    }
    if (f.debrief.trim() !== (exercice.debrief ?? "")) c.debrief = f.debrief.trim();
    if (participants !== (exercice.participants_count ?? null)) c.participants_count = participants;
    if (duree !== (exercice.duration_minutes ?? null)) c.duration_minutes = duree;
    if (!memes(f.comptes, exercice.participants.map((p) => p.id))) c.participant_ids = f.comptes;
    return c;
  }

  return (
    <Modal
      open
      wide={realise}
      title={realise ? `Bilan de l'exercice ${exercice.reference}` : `Date de l'exercice ${exercice.reference}`}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action="Enregistrer"
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
      {realise ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Participants" error={participants !== null && Number.isNaN(participants) ? "Un nombre entier." : undefined}>
            <Input inputMode="numeric" value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} />
          </Field>
          <Field label="Durée (minutes)" error={duree !== null && Number.isNaN(duree) ? "Un nombre entier de minutes." : undefined}>
            <Input inputMode="numeric" value={f.duree} onChange={(e) => setF({ ...f, duree: e.target.value })} placeholder="Facultatif" />
          </Field>
          <Field label="Bilan" className="md:col-span-2">
            <Textarea className="min-h-[120px]" value={f.debrief} onChange={(e) => setF({ ...f, debrief: e.target.value })} maxLength={8000} required />
          </Field>
          <ChoixComptes comptes={comptes} choisis={f.comptes} onChange={(ids) => setF({ ...f, comptes: ids })} />
          <div className="md:col-span-2">
            <ErreurFenetre texte={erreur} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Prévu le">
            <Input type="date" value={f.planned_date} onChange={(e) => setF({ ...f, planned_date: e.target.value })} required />
          </Field>
          <ErreurFenetre texte={erreur} />
        </div>
      )}
    </Modal>
  );
}

/* ─── Motifs ──────────────────────────────────────────────────────────── */

/** Archivage, remise en vigueur, annulation ou réouverture : motif écrit obligatoire, journalisé. */
export function FenetreMotif({ titre, aide, action, danger, onClose, envoyer }: { titre: string; aide: ReactNode; action: string; danger?: boolean; onClose: () => void; envoyer: (motif: string) => Promise<unknown> }) {
  const [motif, setMotif] = useState("");
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Opération impossible.");
  return (
    <Modal open title={titre} onClose={onClose} footer={<Pied onClose={onClose} retour="Retour" action={action} danger={danger} envoi={envoi} pret={Boolean(motif.trim())} onEnvoyer={() => void lancer(() => envoyer(motif.trim()))} />}>
      <div className="space-y-3">
        <p className="m-0 text-[13px] leading-snug text-ink-2">{aide}</p>
        <Field label="Motif (obligatoire)" hint="Il est journalisé avec la décision.">
          <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={2000} />
        </Field>
        <ErreurFenetre texte={erreur} />
      </div>
    </Modal>
  );
}

/* ─── Annuaire de crise ───────────────────────────────────────────────── */

/**
 * Nouveau contact de l'annuaire de crise, ou modification : fonction, nom, organisme, téléphones,
 * courriel, site (aucun : contact commun à tous les sites), ordre d'appel, précisions.
 */
export function FenetreContact({ contact, onClose, envoyer }: { contact?: CrisisContact; onClose: () => void; envoyer: (corps: ContactInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState(() => ({
    function: contact?.function ?? "",
    name: contact?.name ?? "",
    organization: contact?.organization ?? "",
    phone: contact?.phone ?? "",
    phone2: contact?.phone2 ?? "",
    email: contact?.email ?? "",
    site_id: contact?.site ? String(contact.site.id) : "",
    call_order: contact ? String(contact.call_order) : "10",
    note: contact?.note ?? "",
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, contact ? "Modification impossible." : "Création impossible.");
  const sites = (ref?.sites ?? []).filter((s) => s.active || String(s.id) === f.site_id);
  const ordre = entier(f.call_order);
  const ordreInvalide = ordre !== null && Number.isNaN(ordre);
  const pret = Boolean(f.function.trim() && f.name.trim() && f.phone.trim()) && !ordreInvalide;

  function corps(): ContactInput {
    const v: ContactInput = {
      function: f.function.trim(),
      name: f.name.trim(),
      organization: f.organization.trim() || null,
      phone: f.phone.trim(),
      phone2: f.phone2.trim() || null,
      email: f.email.trim() || null,
      site_id: f.site_id ? Number(f.site_id) : null,
      call_order: ordre ?? 10,
      note: f.note.trim() || null,
    };
    if (!contact) return v;
    const avant: ContactInput = {
      function: contact.function,
      name: contact.name,
      organization: contact.organization,
      phone: contact.phone,
      phone2: contact.phone2,
      email: contact.email,
      site_id: contact.site?.id ?? null,
      call_order: contact.call_order,
      note: contact.note,
    };
    return Object.fromEntries(Object.entries(v).filter(([cle, valeur]) => valeur !== avant[cle as keyof ContactInput])) as ContactInput;
  }

  return (
    <Modal
      open
      wide
      title={contact ? `Modifier le contact ${contact.function}` : "Nouveau contact de crise"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={contact ? "Enregistrer" : "Ajouter à l'annuaire"}
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
        <Field label="Fonction">
          <Input value={f.function} onChange={(e) => setF({ ...f, function: e.target.value })} placeholder="Sapeurs-pompiers, chef de parc, assureur…" maxLength={200} required />
        </Field>
        <Field label="Nom">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Personne ou permanence à demander" maxLength={200} required />
        </Field>
        <Field label="Organisme">
          <Input value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} placeholder="Entreprise, protection civile, gendarmerie, hôpital…" maxLength={200} />
        </Field>
        <Field label="Site" hint="Aucun : contact commun à tous les sites.">
          <Select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })} placeholder="Tous les sites" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Téléphone" hint={f.phone.trim() ? `Composé : ${numeroLisible(f.phone)}` : "Avec l'indicatif +224 pour un numéro joignable de l'étranger."}>
          <Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+224 622 00 00 00" maxLength={64} required />
        </Field>
        <Field label="Second téléphone">
          <Input type="tel" value={f.phone2} onChange={(e) => setF({ ...f, phone2: e.target.value })} placeholder="Facultatif" maxLength={64} />
        </Field>
        <Field label="Courriel">
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Facultatif" maxLength={200} />
        </Field>
        <Field label="Ordre d'appel" hint="1 : appelé en premier." error={ordreInvalide ? "Un nombre entier." : undefined}>
          <Input inputMode="numeric" value={f.call_order} onChange={(e) => setF({ ...f, call_order: e.target.value })} />
        </Field>
        <Field label="Précisions" className="md:col-span-2">
          <Textarea className="min-h-[60px]" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ce qu'il faut dire en appelant, horaires, canal radio…" maxLength={2000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Action née d'un exercice ────────────────────────────────────────── */

/** Hiérarchie des mesures, de la plus forte à la plus faible. */
const ORDRE_MAITRISE: readonly ControlLevel[] = ["elimination", "substitution", "engineering", "administrative", "ppe"];

/** Seuil d'une action coûteuse quand les référentiels ne sont pas encore lus (§6). */
const SEUIL_DEFAUT = 50_000_000;

/**
 * Action du plan née d'un écart constaté à l'exercice (origine « exercice ») : la clôture exigera une
 * preuve jointe ; au-delà du seuil des paramètres, la direction valide la dépense avant le démarrage.
 */
export function FenetreAction({ exercice, onClose, onCreee }: { exercice: Pick<Drill, "id" | "reference" | "debrief">; onClose: () => void; onCreee: (a: HsseqAction) => void }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState({ description: "", control_level: "" as ControlLevel | "", owner_id: "", due_date: decaler(aujourdhui(), 30), expected_evidence: "", estimated_cost: "" });
  // Les champs d'une action sont ceux du plan d'actions : leurs noms en clair viennent de texteErreur.
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Création impossible.", (e, d) => texteErreur(e, {}, d));
  const cout = f.estimated_cost.trim() === "" ? null : Math.round(Number(f.estimated_cost.replace(/\s/g, "").replace(",", ".")));
  const coutValide = cout === null || (Number.isFinite(cout) && cout >= 0);
  const seuil = ref?.costly_action_threshold ?? SEUIL_DEFAUT;
  const pret = Boolean(f.description.trim() && f.owner_id && f.due_date && coutValide);

  function corps(): NewDrillAction {
    return {
      origin: "drill",
      origin_id: exercice.id,
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
      title={`Nouvelle action de l'exercice ${exercice.reference}`}
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
        {exercice.debrief && (
          <div className="rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2 md:col-span-2">
            <span className="font-semibold text-ink">{`Bilan${INSECABLE}: `}</span>
            <span className="line-clamp-3 whitespace-pre-line">{exercice.debrief}</span>
          </div>
        )}
        <Field label="Action" className="md:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ce qui sera fait, par qui et où" maxLength={4000} />
        </Field>
        <Field label="Responsable">
          <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} placeholder="À choisir" options={sansConducteurs(ref?.owners).map((o) => ({ value: o.id, label: o.name }))} />
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
          <Textarea className="min-h-[60px]" value={f.expected_evidence} onChange={(e) => setF({ ...f, expected_evidence: e.target.value })} placeholder="Inventaire du kit signé, photo, attestation de formation…" maxLength={2000} />
        </Field>
        <div className="md:col-span-2">
          <ErreurFenetre texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}
