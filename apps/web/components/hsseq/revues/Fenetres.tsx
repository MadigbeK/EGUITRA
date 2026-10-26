"use client";

/**
 * Fenêtres de la revue de direction, ouvertes selon les droits servis par le noyau (`rights`,
 * `transitions`) : préparation et modification de la revue, déclaration de la séance tenue, motif de la
 * réouverture, décision (et l'action qui la met en œuvre), inscription au plan d'actions d'une décision
 * déjà prise. Chaque fenêtre envoie au noyau, garde son refus au-dessus des boutons et se ferme sur la
 * réussite.
 */

import { useState, type ReactNode } from "react";
import { Button, Field, Input, Modal, Notice, Segmented, Select, Textarea, cx } from "@/components/ui";
import { NIVEAU_MAITRISE } from "@/components/hsseq/commun";
import { aujourdhui, decaler, useReferentiels } from "@/components/hsseq/actions/outils";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtGNF, pluriel } from "@/lib/format";
import type { ControlLevel, Page, Ref } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { NATURE_DECISION, ORDRE_DU_JOUR_TYPE, ORDRE_NATURES, finDeMois, intituleParDefaut, messageRevue, nombreDeMois, nomCompte, periodeRevue } from "./outils";
import type { CompteCite, DecisionActionInput, DecisionInput, DecisionTopic, HoldInput, Review, ReviewCounts, ReviewDecision, ReviewInput, ReviewLine } from "./types";

/** Hiérarchie des mesures, de la plus forte à la plus faible. */
const ORDRE_MAITRISE: readonly ControlLevel[] = ["elimination", "substitution", "engineering", "administrative", "ppe"];

/** Seuil d'une action coûteuse quand les référentiels ne sont pas encore lus (§6). */
const SEUIL_DEFAUT = 50_000_000;

/** Période d'une revue : 24 mois au plus (MAX_MONTHS du noyau). */
const MAX_MOIS = 24;

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
      setErreur(messageRevue(e, defaut));
    } finally {
      setEnvoi(false);
    }
  }
  return { erreur, envoi, envoyer };
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

function Erreur({ texte }: { texte: string | null }) {
  return texte ? <Notice tone="danger">{texte}</Notice> : null;
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

/** Rappel en tête d'une fenêtre : ce que l'envoi va faire. */
function Rappel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2", className)}>{children}</div>;
}

/**
 * Comptes proposés : les comptes internes des référentiels, hors conducteurs (servis avec `driver` pour
 * les participants d'un exercice d'urgence), plus ceux déjà retenus, par ordre alphabétique.
 */
function comptesProposes(owners: Array<Ref & { driver?: boolean }> | undefined, deja: CompteCite[] = []): Ref[] {
  const liste: Ref[] = (owners ?? []).filter((o) => !o.driver);
  for (const r of deja) if (!liste.some((o) => o.id === r.id)) liste.push({ id: r.id, name: nomCompte(r) });
  return liste.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

/** Cases à cocher des comptes (participants) ; un filtre par nom quand la liste est longue. */
function ChoixComptes({ legende, comptes, choisis, onChange, aide }: { legende: string; comptes: Ref[]; choisis: number[]; onChange: (ids: number[]) => void; aide?: string }) {
  const [filtre, setFiltre] = useState("");
  const f = filtre.trim().toLocaleLowerCase("fr");
  const visibles = f ? comptes.filter((c) => c.name.toLocaleLowerCase("fr").includes(f)) : comptes;
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[13px] font-medium text-ink-2">
        {legende}
        {choisis.length > 0 && <span className="ml-1.5 text-muted tabular">({choisis.length})</span>}
      </legend>
      {comptes.length > 8 && <Input type="search" className="mb-2" value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer par nom" aria-label={`Filtrer${INSECABLE}: ${legende}`} />}
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-panel-2 p-2.5">
        {visibles.length === 0 && <p className="px-1.5 py-1 text-[13px] text-muted">{comptes.length ? "Aucun compte à ce nom." : "Chargement des comptes…"}</p>}
        {visibles.map((c) => (
          <label key={c.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[13.5px] text-ink hover:bg-panel-3">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={choisis.includes(c.id)} onChange={(ev) => onChange(ev.target.checked ? [...choisis, c.id] : choisis.filter((x) => x !== c.id))} />
            {c.name}
          </label>
        ))}
      </div>
      {aide && <p className="mt-1.5 text-[12px] leading-snug text-muted">{aide}</p>}
    </fieldset>
  );
}

/* ─── Préparation ─────────────────────────────────────────────────────── */

/**
 * Période proposée pour une nouvelle revue : du lendemain de la période de la dernière revue (ou du
 * 1er janvier) à la fin du mois dernier, ou à la fin du mois de début si celui-ci n'est pas passé.
 */
function periodeProposee(derniere: ReviewLine | undefined): { debut: string; fin: string } {
  const jour = aujourdhui();
  const debut = derniere ? decaler(derniere.period.to, 1) : `${jour.slice(0, 4)}-01-01`;
  const finMoisDernier = decaler(`${jour.slice(0, 7)}-01`, -1);
  return { debut, fin: finMoisDernier >= debut ? finMoisDernier : finDeMois(debut) };
}

/**
 * Préparation d'une revue (sans `revue`) ou modification de sa préparation : période, date, intitulé,
 * participants invités, ordre du jour. Le noyau génère les éléments d'entrée à la création, et les
 * régénère quand la période ou la date change tant que la revue est préparée ; une fois la revue tenue,
 * la période ne change plus. En modification, seuls les champs changés partent.
 */
export function FenetrePreparation({ revue, onClose, envoyer }: { revue?: Review; onClose: () => void; envoyer: (corps: ReviewInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const { data: moi } = useApi<Me>("/auth/me");
  const { data: dernieres } = useApi<Page<ReviewLine, ReviewCounts>>(revue ? null : "/hsseq/reviews?sort=-planned_date&limit=1");
  const propose = periodeProposee(dernieres?.items[0]);
  // Période laissée nulle tant qu'elle n'est pas touchée : la proposition suit la dernière revue, lue après l'ouverture.
  const [debut, setDebut] = useState<string | null>(revue?.period.from ?? null);
  const [fin, setFin] = useState<string | null>(revue?.period.to ?? null);
  const [f, setF] = useState(() => ({
    planned_date: revue?.planned_date ?? decaler(aujourdhui(), 14),
    title: revue?.title ?? "",
    company_id: "",
    participant_ids: revue?.participants.map((p) => p.id) ?? [],
    external_participants: revue?.external_participants ?? "",
    agenda: revue ? (revue.agenda ?? "") : ORDRE_DU_JOUR_TYPE,
  }));
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, revue ? "Modification impossible." : "Préparation impossible.");
  const periodeDebut = debut ?? propose.debut;
  const periodeFin = fin ?? propose.fin;
  const periodeFixe = Boolean(revue && revue.state !== "prepared");
  const mois = nombreDeMois(periodeDebut, periodeFin);
  const erreurPeriode = !periodeDebut || !periodeFin ? null : periodeFin < periodeDebut ? "La fin de la période précède son début." : mois > MAX_MOIS ? `Période de ${mois} mois${INSECABLE}: 24 mois au plus.` : null;
  const societes = moi?.companies ?? [];
  const societe = f.company_id || String(moi?.company_id ?? "");
  const comptes = comptesProposes(ref?.owners, revue?.participants);
  const pret = Boolean(periodeDebut && periodeFin && f.planned_date && !erreurPeriode && (!revue || f.title.trim()));

  function corps(): ReviewInput {
    const autres = f.external_participants.trim() || null;
    const agenda = f.agenda.trim() || null;
    if (!revue) {
      return {
        period_start: periodeDebut,
        period_end: periodeFin,
        planned_date: f.planned_date,
        // Sans intitulé, le noyau compose le sien à partir de la période.
        ...(f.title.trim() ? { title: f.title.trim() } : {}),
        ...(societes.length > 1 && societe ? { company_id: Number(societe) } : {}),
        participant_ids: f.participant_ids,
        external_participants: autres,
        agenda,
      };
    }
    const c: ReviewInput = {};
    if (!periodeFixe && periodeDebut !== revue.period.from) c.period_start = periodeDebut;
    if (!periodeFixe && periodeFin !== revue.period.to) c.period_end = periodeFin;
    if (f.planned_date !== revue.planned_date) c.planned_date = f.planned_date;
    if (f.title.trim() !== revue.title) c.title = f.title.trim();
    const avant = revue.participants.map((p) => p.id).sort((a, b) => a - b);
    const apres = [...f.participant_ids].sort((a, b) => a - b);
    if (avant.join(",") !== apres.join(",")) c.participant_ids = f.participant_ids;
    if (autres !== (revue.external_participants ?? null)) c.external_participants = autres;
    if (agenda !== (revue.agenda ?? null)) c.agenda = agenda;
    return c;
  }

  const regeneration = Boolean(revue && revue.state === "prepared");

  return (
    <Modal
      open
      wide
      title={revue ? `Modifier la revue ${revue.reference}` : "Préparer une revue de direction"}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={revue ? "Enregistrer" : "Préparer la revue"}
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
        {!revue && (
          <Rappel className="md:col-span-2">
            NIMOVA rassemble aussitôt les éléments d&apos;entrée de la période depuis le module&nbsp;: indicateurs, événements, actions, audits et constats, exigences, risques, environnement, urgences, suite de la revue précédente. Ils se rafraîchissent jusqu&apos;à la séance.
          </Rappel>
        )}
        <Field label="Période du" hint={periodeFixe ? `Revue tenue${INSECABLE}: la période ne change plus.` : undefined}>
          <Input type="date" value={periodeDebut} disabled={periodeFixe} onChange={(e) => setDebut(e.target.value)} required />
        </Field>
        <Field label="Jusqu'au" error={erreurPeriode ?? undefined} hint={erreurPeriode ? undefined : periodeDebut && periodeFin ? `${periodeRevue(periodeDebut, periodeFin)}, ${pluriel(mois, "mois", "mois")}.` : undefined}>
          <Input type="date" value={periodeFin} disabled={periodeFixe} min={periodeDebut || undefined} onChange={(e) => setFin(e.target.value)} required />
        </Field>
        <Field label="Séance prévue le" hint={regeneration ? "Changer la période ou la date régénère les éléments d'entrée." : undefined}>
          <Input type="date" value={f.planned_date} onChange={(e) => setF({ ...f, planned_date: e.target.value })} required />
        </Field>
        {!revue && societes.length > 1 ? (
          <Field label="Société" hint="La revue porte sur les registres de cette société.">
            <Select value={societe} onChange={(e) => setF({ ...f, company_id: e.target.value })} options={societes.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        ) : (
          <div className="hidden md:block" />
        )}
        <Field label="Intitulé" hint={revue ? undefined : "Laissé vide, NIMOVA le compose à partir de la période."} className="md:col-span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={intituleParDefaut(periodeDebut, periodeFin)} maxLength={300} required={Boolean(revue)} />
        </Field>
        <ChoixComptes
          legende={revue && revue.state !== "prepared" ? "Participants" : "Participants invités"}
          comptes={comptes}
          choisis={f.participant_ids}
          onChange={(ids) => setF({ ...f, participant_ids: ids })}
          aide={revue && revue.state !== "prepared" ? undefined : "La présence se confirme quand la revue est déclarée tenue."}
        />
        <Field label="Autres participants" hint={`Noms et fonctions des participants sans compte${INSECABLE}: délégué du personnel, invité d'un donneur d'ordre…`}>
          <Textarea className="min-h-[96px]" value={f.external_participants} onChange={(e) => setF({ ...f, external_participants: e.target.value })} maxLength={2000} />
        </Field>
        <Field label="Ordre du jour" hint={revue ? undefined : `Proposé selon les éléments d'entrée de la revue de direction (ISO 45001, 14001 et 9001, chapitre 9.3)${INSECABLE}; à adapter.`} className="md:col-span-2">
          <Textarea className="min-h-[200px]" value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} maxLength={4000} />
        </Field>
        <div className="md:col-span-2">
          <Erreur texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Séance tenue ────────────────────────────────────────────────────── */

/**
 * Déclaration de la séance tenue : la date (le jour même, ou une date passée), les participants
 * présents (invités cochés d'avance) et les autres participants. Le noyau génère les éléments d'entrée
 * une dernière fois, puis les fige.
 */
export function FenetreTenue({ revue, onClose, envoyer }: { revue: Review; onClose: () => void; envoyer: (corps: HoldInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const jour = aujourdhui();
  const passee = revue.planned_date < jour;
  const [quand, setQuand] = useState<"jour" | "autre">(passee ? "autre" : "jour");
  const [date, setDate] = useState(passee ? revue.planned_date : jour);
  const [presents, setPresents] = useState<number[]>(revue.participants.map((p) => p.id));
  const [autres, setAutres] = useState(revue.external_participants ?? "");
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Déclaration impossible.");
  const comptes = comptesProposes(ref?.owners, revue.participants);
  const dateValide = quand === "jour" || (Boolean(date) && date <= jour);
  const pret = dateValide && (presents.length > 0 || Boolean(autres.trim()));

  return (
    <Modal
      open
      wide
      title={`Revue ${revue.reference} tenue`}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action="Déclarer la revue tenue"
          envoi={envoi}
          pret={pret}
          onEnvoyer={() => void lancer(() => envoyer({ participant_ids: presents, external_participants: autres.trim() || null, ...(quand === "autre" ? { held_on: date } : {}) }))}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Rappel className="md:col-span-2">
          Les éléments d&apos;entrée sont rassemblés une dernière fois, puis figés&nbsp;: ils resteront ceux de la séance. Le compte rendu, les décisions et les conclusions se rédigent ensuite, jusqu&apos;à la clôture.
        </Rappel>
        <Groupe label="Séance tenue">
          <Segmented<"jour" | "autre">
            label="Date de la séance"
            value={quand}
            onChange={setQuand}
            options={[
              { key: "jour", label: "Aujourd'hui" },
              { key: "autre", label: "À une date passée" },
            ]}
          />
        </Groupe>
        {quand === "autre" ? (
          <Field label="Le" hint={`Prévue le ${fmtDate(revue.planned_date)}.`} error={dateValide ? undefined : "Une date passée ou du jour."}>
            <Input type="date" max={jour} value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        ) : (
          <div className="hidden md:block" />
        )}
        <ChoixComptes legende="Participants présents" comptes={comptes} choisis={presents} onChange={setPresents} aide={`Les invités sont cochés${INSECABLE}: décochez les absents.`} />
        <Field label="Autres participants" hint="Noms et fonctions des participants sans compte.">
          <Textarea className="min-h-[96px]" value={autres} onChange={(e) => setAutres(e.target.value)} maxLength={2000} />
        </Field>
        {!presents.length && !autres.trim() && (
          <p className="text-[12.5px] font-medium text-warn md:col-span-2">Désignez au moins un participant, ou nommez les participants sans compte.</p>
        )}
        <div className="md:col-span-2">
          <Erreur texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Réouverture ─────────────────────────────────────────────────────── */

/** Réouverture d'une revue close (Responsable HSSEQ) : motif écrit obligatoire, journalisé. */
export function FenetreMotif({ titre, aide, action, onClose, envoyer }: { titre: string; aide: string; action: string; onClose: () => void; envoyer: (motif: string) => Promise<unknown> }) {
  const [motif, setMotif] = useState("");
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Opération impossible.");
  return (
    <Modal open title={titre} onClose={onClose} footer={<Pied onClose={onClose} retour="Retour" action={action} envoi={envoi} pret={motif.trim().length >= 5} onEnvoyer={() => void lancer(() => envoyer(motif.trim()))} />}>
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-ink-2">{aide}</p>
        <Field label="Motif (obligatoire)" hint="Cinq caractères au moins.">
          <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={2000} />
        </Field>
        <Erreur texte={erreur} />
      </div>
    </Modal>
  );
}

/* ─── Décisions ───────────────────────────────────────────────────────── */

/** Montant saisi (« 12 000 000 », « 1,5 ») ; nul s'il est vide, NaN s'il est illisible. */
function lireMontant(texte: string): number | null {
  const t = texte.trim();
  if (!t) return null;
  return Math.round(Number(t.replace(/\s/g, "").replace(",", ".")));
}

/** Champs de l'action d'une décision : action à mener, niveau de maîtrise, coût estimé, preuve attendue. */
interface ChampsAction {
  description: string;
  control_level: ControlLevel | "";
  estimated_cost: string;
  expected_evidence: string;
}

const ACTION_VIDE: ChampsAction = { description: "", control_level: "", estimated_cost: "", expected_evidence: "" };

/** Valeurs de l'action pour le noyau : seules les clés renseignées partent (le noyau garde ses défauts pour les autres). */
function valeursAction(a: ChampsAction): DecisionActionInput {
  const cout = lireMontant(a.estimated_cost);
  return {
    ...(a.description.trim() ? { description: a.description.trim() } : {}),
    ...(a.control_level ? { control_level: a.control_level } : {}),
    ...(cout !== null ? { estimated_cost: cout } : {}),
    ...(a.expected_evidence.trim() ? { expected_evidence: a.expected_evidence.trim() } : {}),
  };
}

/** Saisie de l'action : niveau de maîtrise, coût estimé (validation de la direction au-delà du seuil), preuve attendue. */
function SaisieAction({ a, onChange, seuil, avecDescription, decision }: { a: ChampsAction; onChange: (a: ChampsAction) => void; seuil: number; avecDescription?: boolean; decision?: string }) {
  const cout = lireMontant(a.estimated_cost);
  const coutValide = cout === null || (Number.isFinite(cout) && cout >= 0);
  return (
    <>
      {avecDescription && (
        <Field label="Action à mener" hint="Laissée vide, l'action reprend le texte de la décision." className="md:col-span-2">
          <Textarea className="min-h-[72px]" value={a.description} onChange={(e) => onChange({ ...a, description: e.target.value })} placeholder={decision || "Ce qui sera fait, par qui et où"} maxLength={4000} />
        </Field>
      )}
      <Field label="Niveau de maîtrise" hint="De la mesure la plus forte (élimination) à la plus faible (équipement de protection).">
        <Select value={a.control_level} onChange={(e) => onChange({ ...a, control_level: e.target.value as ControlLevel | "" })} placeholder="À préciser" options={ORDRE_MAITRISE.map((n) => ({ value: n, label: NIVEAU_MAITRISE[n] }))} />
      </Field>
      <Field label="Coût estimé (GNF)" hint={`Au-delà de ${fmtGNF(seuil)}, la direction valide l'action avant son démarrage.`} error={coutValide ? undefined : "Montant invalide."}>
        <Input inputMode="numeric" value={a.estimated_cost} onChange={(e) => onChange({ ...a, estimated_cost: e.target.value })} placeholder="Non chiffré" />
      </Field>
      <Field label="Preuve attendue" hint="L'action ne se clôt qu'avec sa preuve jointe (photo ou PDF)." className="md:col-span-2">
        <Textarea className="min-h-[60px]" value={a.expected_evidence} onChange={(e) => onChange({ ...a, expected_evidence: e.target.value })} placeholder="Compte rendu, attestation, procès-verbal, photo…" maxLength={2000} />
      </Field>
    </>
  );
}

const montantValide = (texte: string) => {
  const n = lireMontant(texte);
  return n === null || (Number.isFinite(n) && n >= 0);
};

/** Choix de la nature d'une décision, en cartes : titre et portée de chaque nature. */
function ChoixNature({ valeur, onChange }: { valeur: DecisionTopic | null; onChange: (t: DecisionTopic) => void }) {
  return (
    <fieldset className="md:col-span-2">
      <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Nature de la décision</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ORDRE_NATURES.map((t) => (
          <label key={t} className={cx("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors", valeur === t ? "border-accent bg-accent-doux" : "border-line hover:border-line-strong")}>
            <input type="radio" name="nature-decision" className="mt-1 accent-[var(--accent)]" checked={valeur === t} onChange={() => onChange(t)} />
            <span>
              <span className="block text-sm font-semibold text-ink">{NATURE_DECISION[t].label}</span>
              <span className="block text-[12.5px] leading-snug text-muted">{NATURE_DECISION[t].aide}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Nouvelle décision (sans `decision`), avec au besoin l'action qui la met en œuvre, inscrite aussitôt au
 * plan d'actions ; ou modification d'une décision (seuls les champs changés partent).
 */
export function FenetreDecision({ revue, decision, onClose, envoyer }: { revue: Review; decision?: ReviewDecision; onClose: () => void; envoyer: (corps: DecisionInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [f, setF] = useState(() => ({
    topic: decision?.topic ?? null,
    description: decision?.description ?? "",
    owner_id: decision?.owner ? String(decision.owner.id) : "",
    due_date: decision?.due_date ?? "",
  }));
  const [avecAction, setAvecAction] = useState(false);
  const [a, setA] = useState<ChampsAction>(ACTION_VIDE);
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, decision ? "Modification impossible." : "Enregistrement impossible.");
  const comptes = comptesProposes(ref?.owners, decision?.owner ? [decision.owner] : []);
  const pret = Boolean(f.topic && f.description.trim() && (!avecAction || (f.owner_id && f.due_date && montantValide(a.estimated_cost))));

  function corps(): DecisionInput {
    const owner = f.owner_id ? Number(f.owner_id) : null;
    const due = f.due_date || null;
    if (!decision) {
      return {
        topic: f.topic ?? "improvement",
        description: f.description.trim(),
        ...(owner ? { owner_id: owner } : {}),
        ...(due ? { due_date: due } : {}),
        ...(avecAction ? { action: valeursAction(a) } : {}),
      };
    }
    const c: DecisionInput = {};
    if (f.topic && f.topic !== decision.topic) c.topic = f.topic;
    if (f.description.trim() !== decision.description) c.description = f.description.trim();
    if (owner !== (decision.owner?.id ?? null)) c.owner_id = owner;
    if (due !== (decision.due_date ?? null)) c.due_date = due;
    return c;
  }

  return (
    <Modal
      open
      wide
      title={decision ? "Modifier la décision" : `Nouvelle décision de la revue ${revue.reference}`}
      onClose={onClose}
      footer={
        <Pied
          onClose={onClose}
          action={decision ? "Enregistrer" : avecAction ? "Inscrire la décision et son action" : "Inscrire la décision"}
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
        {revue.state === "prepared" && !decision && (
          <Rappel className="md:col-span-2">
            Les décisions se prennent en séance&nbsp;; inscrites avant, elles en forment le projet, que la séance confirme ou retire.
          </Rappel>
        )}
        <ChoixNature valeur={f.topic} onChange={(t) => setF({ ...f, topic: t })} />
        <Field label="Décision" className="md:col-span-2">
          <Textarea className="min-h-[96px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ce que la direction décide, en une ou deux phrases" maxLength={4000} />
        </Field>
        <Field label="Responsable" hint={avecAction ? "Il porte aussi l'action." : undefined}>
          <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} placeholder={avecAction ? "À choisir" : "À désigner"} options={comptes.map((o) => ({ value: o.id, label: o.name }))} />
        </Field>
        <Field label="Échéance" hint={avecAction ? "Celle de l'action." : undefined}>
          <Input type="date" min={decision ? undefined : aujourdhui()} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </Field>
        {!decision && (
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line px-3 py-2.5 md:col-span-2">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={avecAction} onChange={(e) => setAvecAction(e.target.checked)} />
            <span>
              <span className="block text-sm font-semibold text-ink">Inscrire aussitôt l&apos;action au plan d&apos;actions</span>
              <span className="block text-[12.5px] leading-snug text-muted">L&apos;action d&apos;origine «&nbsp;Revue de direction&nbsp;» est suivie au plan jusqu&apos;à sa preuve, avec relances et escalade.</span>
            </span>
          </label>
        )}
        {avecAction && <SaisieAction a={a} onChange={setA} seuil={ref?.costly_action_threshold ?? SEUIL_DEFAUT} avecDescription decision={f.description.trim()} />}
        {avecAction && (!f.owner_id || !f.due_date) && <p className="text-[12.5px] font-medium text-warn md:col-span-2">L&apos;action demande un responsable et une échéance.</p>}
        <div className="md:col-span-2">
          <Erreur texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Inscription au plan d'actions d'une décision déjà prise : l'action reprend la décision, son responsable
 * et son échéance, que la fenêtre propose et laisse modifier.
 */
export function FenetreActionDecision({ decision, onClose, envoyer }: { decision: ReviewDecision; onClose: () => void; envoyer: (corps: DecisionActionInput) => Promise<unknown> }) {
  const { data: ref } = useReferentiels();
  const [owner, setOwner] = useState(decision.owner ? String(decision.owner.id) : "");
  const [due, setDue] = useState(decision.due_date && decision.due_date >= aujourdhui() ? decision.due_date : decaler(aujourdhui(), 30));
  const [a, setA] = useState<ChampsAction>({ ...ACTION_VIDE, description: decision.description });
  const { erreur, envoi, envoyer: lancer } = useEnvoi(onClose, "Inscription impossible.");
  const comptes = comptesProposes(ref?.owners, decision.owner ? [decision.owner] : []);
  const pret = Boolean(owner && due && a.description.trim() && montantValide(a.estimated_cost));

  return (
    <Modal
      open
      wide
      title="Inscrire la décision au plan d'actions"
      onClose={onClose}
      footer={<Pied onClose={onClose} action="Créer l'action" envoi={envoi} pret={pret} onEnvoyer={() => void lancer(() => envoyer({ ...valeursAction(a), owner_id: Number(owner), due_date: due }))} />}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Rappel className="md:col-span-2">
          <span className="font-semibold text-ink">Décision{INSECABLE}: </span>
          {decision.description}
        </Rappel>
        <Field label="Action à mener" className="md:col-span-2">
          <Textarea className="min-h-[96px]" value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} maxLength={4000} />
        </Field>
        <Field label="Responsable de l'action">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="À choisir" options={comptes.map((o) => ({ value: o.id, label: o.name }))} />
        </Field>
        <Field label="Échéance">
          <Input type="date" min={aujourdhui()} value={due} onChange={(e) => setDue(e.target.value)} required />
        </Field>
        <SaisieAction a={a} onChange={setA} seuil={ref?.costly_action_threshold ?? SEUIL_DEFAUT} />
        <div className="md:col-span-2">
          <Erreur texte={erreur} />
        </div>
      </div>
    </Modal>
  );
}
