"use client";

/**
 * Enquête d'un événement (§5, PUT /hsseq/events/{id}/investigation) : méthode selon la criticité
 * (analyse simple, 5 Pourquoi, arbre des causes), équipe, causes immédiates, les 5M (milieu,
 * matériel, méthode, main-d'œuvre, matière), cause racine, conclusion et échéance. Le Responsable
 * HSSEQ la conduit au statut « enquête » ; la cause racine enregistrée ouvre le passage aux actions.
 */

import { useState, type ReactNode } from "react";
import { FileText, Plus, Trash2 } from "@/components/icons";
import { Button, Card, Field, Input, Modal, Notice, Select, Tag, Textarea, cx } from "@/components/ui";
import { FACTEUR_5M, METHODE_ENQUETE, NIVEAUX } from "@/components/hsseq/commun";
import { apiSend } from "@/lib/api-client";
import type { CauseNode, Event as Evenement, Factor5M, Investigation, InvestigationInput, InvestigationMethod, Referentials } from "@/lib/hsseq-types";
import { EcheanceEnquete, NATURE_FAIT, delaiEnquete, fmtJourHeure, messageRefus, methodeAttendue, seuilDe } from "./commun";

const OPTIONS_METHODES = (Object.keys(METHODE_ENQUETE) as InvestigationMethod[]).map((m) => ({ value: m, label: METHODE_ENQUETE[m] }));
const FACTEURS = Object.keys(FACTEUR_5M) as Factor5M[];

interface Brouillon {
  method: InvestigationMethod;
  team_ids: number[];
  immediate_causes: string[];
  whys: string[];
  tree: CauseNode[];
  factors_5m: Record<Factor5M, string[]>;
  root_cause: string;
  conclusion: string;
}

/** Texte libre du noyau (causes immédiates, facteurs 5M) en lignes : une cause par ligne. */
function lignes(texte: string | null | undefined): string[] {
  return (texte ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Enquête ouverte : date d'ouverture posée par la transition « investigate », ou statut qui la suppose. */
export function enqueteOuverte(e: Evenement): boolean {
  return Boolean(e.investigation.started_at) || e.status === "investigation" || e.status === "actions";
}

function depuis(inv: Investigation, attendue: InvestigationMethod): Brouillon {
  const f = {} as Record<Factor5M, string[]>;
  for (const k of FACTEURS) f[k] = lignes(inv.factors_5m?.[k]);
  return {
    method: inv.method ?? attendue,
    team_ids: inv.team.map((t) => t.id),
    immediate_causes: lignes(inv.immediate_causes),
    whys: [...inv.whys],
    tree: inv.tree.map((n) => ({ ...n })),
    factors_5m: f,
    root_cause: inv.root_cause ?? "",
    conclusion: inv.conclusion ?? "",
  };
}

/** Corps du PUT : lignes vides retirées ; causes immédiates et 5M en texte, une cause par ligne, nul si vide. */
function versCorps(b: Brouillon): InvestigationInput {
  const net = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);
  const texte = (l: string[]) => net(l).join("\n") || null;
  const f = {} as Record<Factor5M, string | null>;
  for (const k of FACTEURS) f[k] = texte(b.factors_5m[k]);
  return {
    method: b.method,
    team_ids: b.team_ids,
    immediate_causes: texte(b.immediate_causes),
    whys: net(b.whys).slice(0, 5),
    tree: b.tree.filter((n) => n.label.trim()).map((n) => ({ ...n, label: n.label.trim() })),
    factors_5m: f,
    root_cause: b.root_cause.trim() || null,
    conclusion: b.conclusion.trim() || null,
  };
}

export function Enquete({
  e,
  referentiels,
  onMaj,
  onOuvrir,
  onPlanifier,
  envoiPlan,
  onRapport,
  rapport,
}: {
  e: Evenement;
  referentiels?: Referentials;
  onMaj: (e: Evenement) => void;
  onOuvrir: () => void;
  onPlanifier: () => void;
  envoiPlan: boolean;
  onRapport: () => void;
  rapport: boolean;
}) {
  // Enquête que le noyau vient d'enregistrer : l'éditeur, reparti de sa réponse, le confirme.
  const [enregistree, setEnregistree] = useState<string | null>(null);
  const inv = e.investigation;
  if (!enqueteOuverte(e)) return <SansEnquete e={e} referentiels={referentiels} onOuvrir={onOuvrir} />;
  const editable = e.status === "investigation" && e.rights.can_approve;
  const cle = JSON.stringify(inv);
  return (
    <Editeur
      // Une fiche à jour (enregistrement, transition) repart de ce que le noyau a retenu.
      key={cle}
      e={e}
      inv={inv}
      editable={editable}
      enregistre={enregistree === cle}
      onEnregistre={setEnregistree}
      referentiels={referentiels}
      onMaj={onMaj}
      onPlanifier={onPlanifier}
      envoiPlan={envoiPlan}
      onRapport={onRapport}
      rapport={rapport}
    />
  );
}

function SansEnquete({ e, referentiels, onOuvrir }: { e: Evenement; referentiels?: Referentials; onOuvrir: () => void }) {
  const seuils = referentiels?.criticality_thresholds;
  const s = e.level ? seuilDe(e.level, seuils) : null;
  return (
    <Card title="Enquête">
      <div className="space-y-4 text-[13.5px] leading-relaxed text-ink-2">
        {e.status === "reported" && <p>L'enquête s'ouvre après le classement de l'événement par le Responsable HSSEQ.</p>}
        {e.status === "closed" && <p>Événement clos sans enquête.</p>}
        {e.status !== "reported" && e.status !== "closed" && e.level && s && (
          <>
            <p>
              Criticité {NIVEAUX[e.level].label.toLocaleLowerCase("fr")} :{" "}
              {s.method ? (
                <>
                  méthode attendue <b className="text-ink">{METHODE_ENQUETE[s.method]}</b>, sous {delaiEnquete(s.investigation_days)}.
                </>
              ) : (
                "pas d'enquête exigée ; clôture directe possible sans action."
              )}
            </p>
            {e.investigation_due && (
              <p className="flex flex-wrap items-center gap-2">
                Échéance : <EcheanceEnquete date={e.investigation_due} enRetard={e.investigation_overdue} />
              </p>
            )}
          </>
        )}
        {e.transitions.includes("investigate") && (
          <Button variant="primary" onClick={onOuvrir}>
            Ouvrir l'enquête
          </Button>
        )}
      </div>
    </Card>
  );
}

function Editeur({
  e,
  inv,
  editable,
  enregistre,
  onEnregistre,
  referentiels,
  onMaj,
  onPlanifier,
  envoiPlan,
  onRapport,
  rapport,
}: {
  e: Evenement;
  inv: Investigation;
  editable: boolean;
  enregistre: boolean;
  onEnregistre: (cle: string) => void;
  referentiels?: Referentials;
  onMaj: (e: Evenement) => void;
  onPlanifier: () => void;
  envoiPlan: boolean;
  onRapport: () => void;
  rapport: boolean;
}) {
  const attendue = methodeAttendue(e.level, referentiels?.criticality_thresholds);
  const [b, setB] = useState<Brouillon>(() => depuis(inv, attendue));
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const modifie = JSON.stringify(versCorps(b)) !== JSON.stringify(versCorps(depuis(inv, attendue)));
  const changer = (maj: Partial<Brouillon>) => setB((x) => ({ ...x, ...maj }));
  const equipe = referentiels?.owners ?? inv.team;

  async function enregistrer() {
    setEnvoi(true);
    setRefus(null);
    try {
      const suivant = await apiSend<Evenement>("PUT", `/hsseq/events/${e.id}/investigation`, versCorps(b));
      onEnregistre(JSON.stringify(suivant.investigation));
      onMaj(suivant);
    } catch (err) {
      setRefus(messageRefus(err, "L'enquête n'a pas été enregistrée."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card
        title="Conduite de l'enquête"
        actions={
          <Button variant="ghost" size="sm" loading={rapport} onClick={onRapport}>
            <FileText className="h-4 w-4" /> Rapport d'enquête (PDF)
          </Button>
        }
      >
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {editable ? (
              <Field label="Méthode" hint={b.method !== attendue && e.level ? `Méthode attendue pour une criticité ${NIVEAUX[e.level].label.toLocaleLowerCase("fr")} : ${METHODE_ENQUETE[attendue]}.` : undefined}>
                <Select value={b.method} onChange={(ev) => changer({ method: ev.target.value as InvestigationMethod })} options={OPTIONS_METHODES} />
              </Field>
            ) : (
              <p className="text-[13.5px] text-ink-2">
                Méthode : <b className="text-ink">{inv.method ? METHODE_ENQUETE[inv.method] : "Non précisée"}</b>
              </p>
            )}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13.5px]">
              <dt className="text-muted">Ouverte le</dt>
              <dd className="text-ink">{inv.started_at ? fmtJourHeure(inv.started_at) : "–"}</dd>
              <dt className="text-muted">Échéance</dt>
              <dd>{inv.due ? <EcheanceEnquete date={inv.due} enRetard={e.investigation_overdue} /> : <span className="text-muted">Sans échéance</span>}</dd>
              {inv.closed_at && (
                <>
                  <dt className="text-muted">Conclue le</dt>
                  <dd className="text-ink">{fmtJourHeure(inv.closed_at)}</dd>
                </>
              )}
            </dl>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Équipe d'enquête</legend>
            {editable ? (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-panel-2 p-2.5">
                {equipe.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[13.5px] text-ink hover:bg-panel-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={b.team_ids.includes(p.id)}
                      onChange={(ev) => changer({ team_ids: ev.target.checked ? [...b.team_ids, p.id] : b.team_ids.filter((x) => x !== p.id) })}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            ) : inv.team.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {inv.team.map((p) => (
                  <li key={p.id}>
                    <Tag>{p.name}</Tag>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Aucun membre désigné.</p>
            )}
          </fieldset>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Causes immédiates">
          <ListeTextes libelle="Cause immédiate" valeurs={b.immediate_causes} editable={editable} onChange={(l) => changer({ immediate_causes: l })} vide="Aucune cause immédiate relevée." />
        </Card>
        {(b.method === "five_whys" || b.whys.length > 0) && (
          <Card title="5 Pourquoi">
            <ListeTextes libelle="Pourquoi" valeurs={b.whys} editable={editable} max={5} numerote onChange={(l) => changer({ whys: l })} vide="Aucun pourquoi posé." />
          </Card>
        )}
      </div>

      {(b.method === "cause_tree" || b.tree.length > 0) && (
        <Card title="Arbre des causes">
          <ArbreCauses noeuds={b.tree} titre={e.title} editable={editable} onChange={(tree) => changer({ tree })} />
        </Card>
      )}

      <Card title="Les 5M">
        <p className="-mt-1 mb-4 text-[12.5px] text-muted">Familles de causes : milieu, matériel, méthode, main-d'œuvre, matière.</p>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
          {FACTEURS.map((k) => (
            <div key={k}>
              <h3 className="mb-2 text-[13px] font-semibold text-ink">{FACTEUR_5M[k]}</h3>
              <ListeTextes libelle={FACTEUR_5M[k]} valeurs={b.factors_5m[k]} editable={editable} onChange={(l) => changer({ factors_5m: { ...b.factors_5m, [k]: l } })} vide="Rien relevé." compacte />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Cause racine et conclusion">
        <div className="space-y-4">
          {editable ? (
            <>
              <Field label="Cause racine" hint="Obligatoire pour passer aux actions.">
                <Textarea rows={3} maxLength={2000} value={b.root_cause} onChange={(ev) => changer({ root_cause: ev.target.value })} />
              </Field>
              <Field label="Conclusion">
                <Textarea rows={3} maxLength={2000} value={b.conclusion} onChange={(ev) => changer({ conclusion: ev.target.value })} />
              </Field>
            </>
          ) : (
            <dl className="space-y-3 text-[13.5px] leading-relaxed">
              <div>
                <dt className="font-medium text-muted">Cause racine</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-ink">{inv.root_cause || "Non renseignée."}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted">Conclusion</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-ink">{inv.conclusion || "Non renseignée."}</dd>
              </div>
            </dl>
          )}
          {refus && <Notice tone="danger">{refus}</Notice>}
          {enregistre && !modifie && <Notice tone="ok">Enquête enregistrée.</Notice>}
          {editable && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!e.transitions.includes("plan") && <span className="mr-auto text-[12.5px] text-muted">La cause racine enregistrée ouvre le passage aux actions.</span>}
              <Button variant={e.transitions.includes("plan") && !modifie ? "secondary" : "primary"} disabled={!modifie} loading={envoi} onClick={enregistrer}>
                Enregistrer l'enquête
              </Button>
              {e.transitions.includes("plan") && (
                <Button variant="primary" disabled={modifie} title={modifie ? "Enregistrez d'abord l'enquête." : undefined} loading={envoiPlan} onClick={onPlanifier}>
                  Passer aux actions
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ─── Listes de textes ────────────────────────────────────────────────── */

function ListeTextes({ libelle, valeurs, onChange, editable, max = 20, numerote, vide, compacte }: { libelle: string; valeurs: string[]; onChange: (l: string[]) => void; editable: boolean; max?: number; numerote?: boolean; vide: string; compacte?: boolean }) {
  if (!editable) {
    if (!valeurs.length) return <p className="text-[13px] text-muted">{vide}</p>;
    const Liste = numerote ? "ol" : "ul";
    return (
      <Liste className={cx("space-y-1.5 text-[13.5px] leading-snug text-ink", numerote ? "list-decimal pl-5" : "list-disc pl-5")}>
        {valeurs.map((v, i) => (
          <li key={i}>{numerote ? <span><span className="sr-only">{`${libelle} ${i + 1} : `}</span>{v}</span> : v}</li>
        ))}
      </Liste>
    );
  }
  return (
    <div className="space-y-2">
      {valeurs.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {numerote && <span aria-hidden className="w-6 flex-none text-right text-[12.5px] font-semibold text-muted tabular">{i + 1}</span>}
          <Input aria-label={`${libelle} ${i + 1}`} value={v} maxLength={500} className={compacte ? "text-[13px]" : undefined} onChange={(ev) => onChange(valeurs.map((x, j) => (j === i ? ev.target.value : x)))} />
          <Button variant="ghost" size="sm" aria-label={`Retirer : ${libelle} ${i + 1}`} title="Retirer" onClick={() => onChange(valeurs.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {valeurs.length < max && (
        <Button size="sm" variant="ghost" onClick={() => onChange([...valeurs, ""])}>
          <Plus className="h-3.5 w-3.5" /> {numerote ? `${libelle} ${valeurs.length + 1}` : "Ajouter"}
          {!numerote && <span className="sr-only">{` : ${libelle}`}</span>}
        </Button>
      )}
    </div>
  );
}

/* ─── Arbre des causes ────────────────────────────────────────────────── */

/**
 * Arbre des causes : la racine (parent nul) est l'événement lui-même ; chaque fait a pour parent le
 * fait qu'il cause. Faits inhabituels (écart à la normale) et permanents (état habituel).
 */
function ArbreCauses({ noeuds, titre, editable, onChange }: { noeuds: CauseNode[]; titre: string; editable: boolean; onChange: (n: CauseNode[]) => void }) {
  const ids = new Set(noeuds.map((n) => n.id));
  const racines = noeuds.filter((n) => n.parent_id === null || !ids.has(n.parent_id));
  // Identifiants textuels du noyau : un nouveau fait prend le plus grand numéro plus un.
  const prochain = () => String(Math.max(0, ...noeuds.map((n) => Number.parseInt(n.id, 10) || 0)) + 1);

  if (!noeuds.length) {
    return editable ? (
      <div className="space-y-2">
        <p className="text-[13px] text-muted">L'arbre part de l'événement et remonte, fait par fait, vers ses causes.</p>
        <Button size="sm" onClick={() => onChange([{ id: "1", label: titre, parent_id: null, kind: "unusual_fact" }])}>
          <Plus className="h-3.5 w-3.5" /> Commencer l'arbre
        </Button>
      </div>
    ) : (
      <p className="text-[13px] text-muted">Aucun fait relevé.</p>
    );
  }

  function retirer(id: string) {
    const aRetirer = new Set([id]);
    let ajoute = true;
    while (ajoute) {
      ajoute = false;
      for (const n of noeuds) {
        if (n.parent_id !== null && aRetirer.has(n.parent_id) && !aRetirer.has(n.id)) {
          aRetirer.add(n.id);
          ajoute = true;
        }
      }
    }
    onChange(noeuds.filter((n) => !aRetirer.has(n.id)));
  }

  // Fonction de rendu, pas composant : un composant déclaré ici serait remonté à chaque frappe (focus perdu).
  function noeud(n: CauseNode, profondeur: number): ReactNode {
    const enfants = noeuds.filter((x) => x.parent_id === n.id);
    const racine = profondeur === 0;
    return (
      <li key={n.id}>
        {editable ? (
          <div className="flex flex-wrap items-center gap-1.5 py-1">
            <Select
              aria-label={`Nature du fait ${n.id}`}
              className="w-[11.5rem] text-[13px]"
              value={n.kind}
              onChange={(ev) => onChange(noeuds.map((x) => (x.id === n.id ? { ...x, kind: ev.target.value as CauseNode["kind"] } : x)))}
              options={(Object.keys(NATURE_FAIT) as CauseNode["kind"][]).map((k) => ({ value: k, label: NATURE_FAIT[k] }))}
            />
            <Input aria-label={racine ? "Événement, racine de l'arbre" : `Fait ${n.id}`} className="min-w-[12rem] flex-1 text-[13px]" maxLength={300} value={n.label} onChange={(ev) => onChange(noeuds.map((x) => (x.id === n.id ? { ...x, label: ev.target.value } : x)))} />
            <Button size="sm" variant="ghost" onClick={() => onChange([...noeuds, { id: prochain(), label: "", parent_id: n.id, kind: "unusual_fact" }])}>
              <Plus className="h-3.5 w-3.5" /> Cause<span className="sr-only">{` de : ${n.label || `fait ${n.id}`}`}</span>
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Retirer le fait ${n.label || n.id}${enfants.length ? " et ses causes" : ""}`} title="Retirer" onClick={() => retirer(n.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-2 py-1 text-[13.5px] text-ink">
            <span className={racine ? "font-semibold" : undefined}>{n.label}</span>
            <Tag>{NATURE_FAIT[n.kind]}</Tag>
          </p>
        )}
        {enfants.length > 0 && (
          <ul className="ml-3 border-l-2 border-line pl-4">{enfants.map((c) => noeud(c, profondeur + 1))}</ul>
        )}
      </li>
    );
  }

  return (
    <ul aria-label="Arbre des causes, de l'événement vers ses causes">
      {racines.map((r) => noeud(r, 0))}
    </ul>
  );
}

/* ─── Ouverture de l'enquête ──────────────────────────────────────────── */

/** Transition « investigate » : méthode (par défaut celle du niveau) et équipe. */
export function OuvrirEnquete({
  open,
  e,
  referentiels,
  onClose,
  onOuvrir,
  envoi,
  refus,
}: {
  open: boolean;
  e: Evenement;
  referentiels?: Referentials;
  onClose: () => void;
  onOuvrir: (corps: { method: InvestigationMethod; team_ids: number[] }) => void;
  envoi: boolean;
  refus: string | null;
}) {
  if (!open) return null;
  return <FenetreEnquete e={e} referentiels={referentiels} onClose={onClose} onOuvrir={onOuvrir} envoi={envoi} refus={refus} />;
}

/** Contenu monté à l'ouverture : la méthode proposée suit le niveau classé à ce moment. */
function FenetreEnquete({
  e,
  referentiels,
  onClose,
  onOuvrir,
  envoi,
  refus,
}: {
  e: Evenement;
  referentiels?: Referentials;
  onClose: () => void;
  onOuvrir: (corps: { method: InvestigationMethod; team_ids: number[] }) => void;
  envoi: boolean;
  refus: string | null;
}) {
  const attendue = methodeAttendue(e.level, referentiels?.criticality_thresholds);
  const [methode, setMethode] = useState<InvestigationMethod>(attendue);
  const [equipe, setEquipe] = useState<number[]>([]);
  return (
    <Modal
      open
      title={`Ouvrir l'enquête ${e.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={envoi} onClick={() => onOuvrir({ method: methode, team_ids: equipe })}>
            Ouvrir l'enquête
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {e.level && (
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Criticité {NIVEAUX[e.level].label.toLocaleLowerCase("fr")} : {METHODE_ENQUETE[attendue]}
            {e.investigation_due ? `, échéance le ${new Date(`${e.investigation_due.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR")}` : ""}.
          </p>
        )}
        <Field label="Méthode">
          <Select value={methode} onChange={(ev) => setMethode(ev.target.value as InvestigationMethod)} options={OPTIONS_METHODES} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Équipe d'enquête</legend>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-panel-2 p-2.5">
            {(referentiels?.owners ?? []).map((p) => (
              <label key={p.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[13.5px] text-ink hover:bg-panel-3">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={equipe.includes(p.id)} onChange={(ev) => setEquipe((l) => (ev.target.checked ? [...l, p.id] : l.filter((x) => x !== p.id)))} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        {refus && <Notice tone="danger">{refus}</Notice>}
      </div>
    </Modal>
  );
}
