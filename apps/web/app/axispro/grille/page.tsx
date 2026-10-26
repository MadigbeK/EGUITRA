"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Download, FileUp, Pencil, Search } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Etat, Field, Input, Modal, Notice, PageHeader, Segmented, Select, Textarea, demanderConfirmation } from "@/components/ui";
import { PuceCompartiment, fermerSiConfirme, messageErreur, useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { CelluleNombre, CelluleTexte, RetourFlottant, annees, borne, type Refus } from "@/components/axispro/cellules";
import type { Compartment, IndicatorInfo, PieceStandard } from "@/lib/axispro-types";
import { apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { AIDE_NOMBRE, fmtDate, fmtDec, fmtPct, fmtRatio, fmtShort, lireNombre, nombreIllisible, pluriel } from "@/lib/format";

interface PolicyRow {
  id: number;
  name: string;
  version: number;
  state: "draft" | "active" | "archived";
  date_active: string | null;
  criteria: number;
  domains: number;
  gates: number;
  documents: number;
  weighting: "flat" | "domain";
}
interface Criterion {
  id: number;
  code: string;
  name: string;
  domain_id: number;
  gate_id: number;
  weight: number;
  critical: boolean;
  knockout: boolean;
  evidence_required: boolean;
  guidance: string | null;
  requirement_type: "blocking" | "apd" | "closing";
  bankability: boolean;
  deliverable: string | null;
  pieces: string[];
  indicator: string | null;
  indicator_threshold: number | null;
  indicator_partial: number | null;
}
interface GateRow {
  id: number;
  code: string;
  name: string;
  sequence: number;
  description: string | null;
  rule_code: string;
  threshold_hold: number | null;
  threshold_go: number | null;
  score_scope: "global" | "cumulative";
  domain_ids: number[];
  /** Complétude documentaire exigée pour examiner le gate (%), null : aucune. */
  min_completeness: number | null;
  entry_requirements: string | null;
  deliverables: string | null;
  exit_criteria: string | null;
}
interface Policy {
  id: number;
  name: string;
  version: number;
  state: PolicyRow["state"];
  date_active: string | null;
  go_threshold: number;
  conditional_threshold: number;
  threshold_bankable: number;
  threshold_hold: number;
  dscr_target: number;
  weighting: "flat" | "domain";
  ko_partial_blocks: boolean;
  evidence_check: boolean;
  exclude_na: boolean;
  expiry_check: boolean;
  capex_criterion_id: number | null;
  rules: Record<string, string>;
  scopes: Record<string, string>;
  requirements: Record<string, string>;
  notes: string | null;
  integrity: {
    criteria: number; domains: number; gates: number; compartments: number; documents: number; weight: number; knockouts: number; critical: number;
    bankability: number; requirements: Record<string, number>; links: number; gates_without_criteria: string[]; notes: string[];
  };
  gates: GateRow[];
  /** Compartiments d'expertise (C0, C1…) : vide pour une grille qui n'en a pas. */
  compartments: Compartment[];
  domains: Array<{ id: number; code: string; name: string; weight: number; deliverable: string | null; compartment_id: number | null }>;
  criteria: Criterion[];
  documents: PieceStandard[];
  indicators: Record<string, IndicatorInfo & { money?: boolean }>;
}

const STATE = { draft: ["Brouillon", "warn"], active: ["En vigueur", "ok"], archived: ["Archivée", "neutral"] } as const;
const FLAGS: Array<{ key: "ko_partial_blocks" | "evidence_check" | "exclude_na" | "expiry_check"; label: string }> = [
  { key: "ko_partial_blocks", label: "Un knock-out incomplet bloque aussi" },
  { key: "evidence_check", label: "Preuve obligatoire pour valider un critère à preuve requise (colonne « preuve » de la grille)" },
  { key: "exclude_na", label: "Exclure les non applicables du score (sinon comptés 1 point)" },
  { key: "expiry_check", label: "Signaler les preuves périmées (retenues incomplètes)" },
];
const SUR_CENT = borne(0, 100, "Seuil sur 100");
const POURCENT = borne(0, 100, "Pourcentage");
const POIDS = borne(0, undefined, "Poids");
/** DSCR bancaire : positif, 10 au plus (la règle de bancabilité en dépend ; vide ou nul, tous les dossiers la passeraient). */
const DSCR = (n: number) => (n > 0 && n <= 10 ? null : "DSCR bancaire : nombre positif, 10 au plus (par exemple 1,3).");

/** Seuil d'un indicateur écrit dans son unité : « 1,30 x », « 15,0 % », « 3,0 ans », « 500 M (devise du dossier) ». */
function seuilEcrit(v: number | null, info: IndicatorInfo & { money?: boolean }): string {
  if (v === null) return "–";
  if (info.unit === "%") return fmtPct(v);
  if (info.unit === "ans") return annees(v);
  if (info.unit === "x") return fmtRatio(v);
  return info.money || info.unit ? `${fmtShort(v)} (${info.unit})` : fmtDec(v);
}

/** Texte comparé sans accents ni casse (filtre des critères). */
function simple(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default function GrillePage() {
  const { data: policies, error, mutate } = useApi<PolicyRow[]>("/axispro/policies");
  const [selected, setSelected] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  // Import, versions, mise en vigueur et réglages de la grille : profil cabinet seul (routes
  // /axispro/policies, /gates, /domains, /compartments, /criteria et /document-types en écriture) ; la
  // direction et l'administration consultent.
  const { cabinet } = useCabinet();
  const { envoyer, enCours, retour, setRetour } = useRetour();
  const current = selected ?? policies?.find((p) => p.state === "active")?.id ?? policies?.[0]?.id ?? null;
  return (
    <div>
      <PageHeader
        title="Grille d'évaluation"
        subtitle="Méthode MB AxisPro Consulting : la grille du cabinet est une donnée ; chaque modification crée une nouvelle version, et un dossier reste évalué selon la version en vigueur à son ouverture."
        actions={
          <>
            <Button loading={enCours === "modele"} onClick={() => void envoyer(() => apiDownload("/axispro/policies/template", "grille_axispro_modele.xlsx"), undefined, "modele")}><Download className="h-4 w-4" /> Classeur modèle</Button>
            {cabinet && <Button variant="primary" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" /> Importer une grille</Button>}
          </>
        }
      />
      {!policies ? (
        <Etat error={error} onRetry={() => void mutate()} label="Chargement des versions de la grille…" />
      ) : (
        <div className="space-y-6">
          {error && <ErrorBox titre="Rechargement impossible : la liste des versions peut dater." error={error} onRetry={() => void mutate()} />}
          <Card title="Versions" padded={false}>
            <DataTable
              rows={policies}
              rowKey={(p) => p.id}
              onRowClick={(p) => setSelected(p.id)}
              empty="Aucune grille : importez le classeur du cabinet."
              columns={[
                { key: "version", label: "Version", render: (p) => <span className={p.id === current ? "font-semibold text-accent" : undefined}>v{p.version}</span> },
                { key: "name", label: "Intitulé" },
                { key: "state", label: "État", render: (p) => <Badge tone={STATE[p.state][1]}>{STATE[p.state][0]}</Badge> },
                { key: "date_active", label: "En vigueur depuis", render: (p) => (p.date_active ? fmtDate(p.date_active) : "–") },
                { key: "weighting", label: "Pondération", render: (p) => (p.weighting === "flat" ? "À plat" : "Par domaine") },
                { key: "gates", label: "Gates", align: "right" },
                { key: "domains", label: "Domaines", align: "right" },
                { key: "criteria", label: "Critères", align: "right" },
                { key: "documents", label: "Pièces", align: "right" },
              ]}
            />
          </Card>
          {current !== null && <PolicyDetail key={current} id={current} onChanged={() => void mutate()} onSelect={setSelected} />}
        </div>
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(id) => { setImporting(false); void mutate(); setSelected(id); }} />}
      <RetourFlottant retour={retour} setRetour={setRetour} />
    </div>
  );
}

function PolicyDetail({ id, onChanged, onSelect }: { id: number; onChanged: () => void; onSelect: (id: number) => void }) {
  const { data: p, error, mutate } = useApi<Policy>(`/axispro/policies/${id}`);
  const [vue, setVue] = useState<"criteres" | "compartiments" | "gates" | "pieces">("criteres");
  const [edition, setEdition] = useState<PieceStandard | null>(null);
  const { cabinet } = useCabinet();
  const { envoyer, enCours, occupe, retour, setRetour } = useRetour();
  if (!p) return <Etat error={error} onRetry={() => void mutate()} label="Chargement de la version…" />;
  // Une version en brouillon se règle, par le seul profil cabinet.
  const editable = p.state === "draft" && cabinet;
  const gateCode = Object.fromEntries(p.gates.map((g) => [g.id, g.code]));
  const domainCode = Object.fromEntries(p.domains.map((d) => [d.id, d.code]));
  const compartiments = p.compartments ?? [];
  const compartimentDe = new Map(compartiments.map((k) => [k.id, k]));
  const vueAffichee = vue === "compartiments" && !compartiments.length ? "criteres" : vue;

  /** Commande (bouton, case, liste) : une à la fois, second clic ignoré ; vrai si elle a réussi. */
  async function ecrire(cle: string, fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    const fait = await envoyer(async () => {
      await fn();
      return true as const;
    }, ok, cle);
    if (!fait) return false;
    await mutate();
    onChanged();
    return true;
  }
  /** Valeur saisie sur place (seuil, poids, intitulé) : le motif d'un refus, affiché sous le champ, ou null. */
  async function enregistrer(path: string, body: Record<string, unknown>, ok: string): Promise<Refus> {
    try {
      await apiSend("PATCH", path, body);
      setRetour({ tone: "ok", text: ok });
      await mutate();
      onChanged();
      return null;
    } catch (e) {
      void mutate();
      return messageErreur(e, "Enregistrement impossible.");
    }
  }
  const patch = (c: Criterion, values: Partial<Criterion>) => void ecrire(`critere-${c.id}`, () => apiSend("PATCH", `/axispro/criteria/${c.id}`, values), `Critère ${c.code} mis à jour.`);
  const patchPolicy = (values: Record<string, unknown>) => void ecrire("reglages", () => apiSend("PATCH", `/axispro/policies/${p.id}`, values), "Réglages de la méthode enregistrés.");
  const patchGate = (g: GateRow, values: Record<string, unknown>) => void ecrire(`gate-${g.id}`, () => apiSend("PATCH", `/axispro/gates/${g.id}`, values), `Gate ${g.code} mis à jour.`);
  const patchDomain = (d: Policy["domains"][number], compartmentId: number | null) =>
    void ecrire(`domaine-${d.id}`, () => apiSend("PATCH", `/axispro/domains/${d.id}`, { compartment_id: compartmentId }), compartmentId ? `Domaine ${d.code} rattaché au compartiment ${compartimentDe.get(compartmentId)?.code ?? ""}.` : `Domaine ${d.code} retiré de son compartiment.`);
  const seuil = (key: "threshold_bankable" | "go_threshold" | "conditional_threshold" | "threshold_hold" | "dscr_target", label: string) => (
    <Field label={label}>
      {editable ? (
        <CelluleNombre label={label} className="w-full" value={p[key]} controle={key === "dscr_target" ? DSCR : SUR_CENT} onSave={(v) => enregistrer(`/axispro/policies/${p.id}`, { [key]: v }, "Réglages de la méthode enregistrés.")} />
      ) : (
        <div className="font-semibold tabular">{key === "dscr_target" ? fmtRatio(p[key]) : fmtDec(p[key])}</div>
      )}
    </Field>
  );
  async function mettreEnVigueur() {
    if (occupe || !p) return;
    if (await demanderConfirmation(`Mettre la version ${p.version} en vigueur ? La version actuelle sera archivée et ne pourra plus être remise en vigueur depuis cet écran ; les dossiers ouverts gardent leur version.`, { action: "Mettre en vigueur", danger: true })) {
      void ecrire("vigueur", () => apiSend("POST", `/axispro/policies/${p.id}/activate`), "Version mise en vigueur.");
    }
  }
  async function nouvelleVersion() {
    if (occupe || !p) return;
    const v = await envoyer(() => apiSend<Policy>("POST", `/axispro/policies/${p.id}/new-version`), "Nouvelle version créée en brouillon : ajustez-la puis mettez-la en vigueur.", "version");
    if (v) {
      onChanged();
      onSelect(v.id);
    }
  }
  const ig = p.integrity;
  const resume = [
    pluriel(ig.gates, "gate"),
    ...(ig.compartments ? [pluriel(ig.compartments, "compartiment")] : []),
    pluriel(ig.domains, "domaine"),
    `${pluriel(ig.criteria, "critère")} (${pluriel(ig.knockouts, "knock-out")}, ${pluriel(ig.critical, "critique")}, ${pluriel(ig.bankability, "retenu", "retenus")} pour la bancabilité)`,
    pluriel(ig.documents, "pièce"),
    pluriel(ig.links, "rattachement pièce-critère", "rattachements pièce-critère"),
  ].join(", ");

  return (
    <div className="space-y-4">
      {error && <ErrorBox titre="Rechargement impossible : la version affichée peut dater." error={error} onRetry={() => void mutate()} />}
      <Card
        title={`${p.name}, version ${p.version}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button variant="primary" loading={enCours === "vigueur"} disabled={occupe} onClick={() => void mettreEnVigueur()}>
                <CheckCircle2 className="h-4 w-4" /> Mettre en vigueur
              </Button>
            )}
            {cabinet && (
              <Button loading={enCours === "version"} disabled={occupe} onClick={() => void nouvelleVersion()}>
                <Copy className="h-4 w-4" /> Nouvelle version
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={STATE[p.state][1]}>{STATE[p.state][0]}</Badge>
          {p.date_active && <span className="text-muted">depuis le {fmtDate(p.date_active)}</span>}
          <span className="text-muted">· {resume}</span>
        </div>
        <p className="mt-1 text-[12.5px] text-muted">Exigences : {Object.entries(ig.requirements).map(([k, n]) => `${p.requirements[k] ?? k} ${n}`).join(", ")}.</p>
        {(ig.notes.length > 0 || ig.gates_without_criteria.length > 0) && (
          <ul className="mt-2 list-disc pl-5 text-[12.5px] text-warn">
            {ig.notes.map((n) => <li key={n}>{n}</li>)}
            {ig.gates_without_criteria.length > 0 && <li>{ig.gates_without_criteria.length > 1 ? "Gates" : "Gate"} sans critère : {ig.gates_without_criteria.join(", ")} (décidés par leur règle de passage).</li>}
          </ul>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 md:grid-cols-5">
          {seuil("threshold_bankable", "BANKABLE CANDIDATE")}
          {seuil("go_threshold", "APD READY")}
          {seuil("conditional_threshold", "CONDITIONAL GO")}
          {seuil("threshold_hold", "HOLD")}
          {seuil("dscr_target", "DSCR bancaire")}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-ink-2">Pondération des scores</div>
            {editable ? (
              <Segmented label="Pondération" value={p.weighting} onChange={(v) => !occupe && patchPolicy({ weighting: v })} options={[{ key: "flat", label: "À plat sur toute la grille" }, { key: "domain", label: "Par domaine" }]} />
            ) : <div className="text-sm">{p.weighting === "flat" ? "À plat sur toute la grille (méthode du cabinet)" : "Par domaine, selon leur pondération"}</div>}
          </div>
          <Field label="Critère contrôlé contre l'investissement de la fiche">
            {editable ? (
              <Select value={p.capex_criterion_id ?? ""} disabled={occupe} placeholder="Aucun" onChange={(e) => patchPolicy({ capex_criterion_id: e.target.value ? Number(e.target.value) : null })} options={p.criteria.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} />
            ) : <div className="text-sm">{p.criteria.find((c) => c.id === p.capex_criterion_id)?.name ?? "Aucun"}</div>}
          </Field>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 text-[13px] md:grid-cols-2">
          {FLAGS.map((f) => (
            <li key={f.key}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={p[f.key]} disabled={!editable || occupe} onChange={() => patchPolicy({ [f.key]: !p[f.key] })} />
                {f.label}
              </label>
            </li>
          ))}
        </ul>
        {p.notes && <div className="mt-4"><div className="text-xs text-muted">Principes rappelés dans chaque rapport</div><p className="whitespace-pre-wrap text-sm">{p.notes}</p></div>}
        {!editable && (
          <p className="mt-4 text-xs text-muted">
            {cabinet
              ? "Cette version n'est plus modifiable. Pour ajuster un réglage, un gate, un critère ou une pièce, créez une nouvelle version."
              : "Lecture seule : votre profil consulte la grille. Seul le profil cabinet l'importe, la règle et la met en vigueur."}
          </p>
        )}
      </Card>

      <Segmented
        label="Contenu de la grille"
        value={vueAffichee}
        onChange={setVue}
        options={[
          { key: "criteres", label: "Domaines et critères" },
          ...(compartiments.length ? [{ key: "compartiments" as const, label: "Compartiments" }] : []),
          { key: "gates", label: "Stage gates" },
          { key: "pieces", label: "Pièces de la data room" },
        ]}
      />

      {vueAffichee === "compartiments" && (
        <div className="space-y-4">
          <Card title={`Compartiments d'expertise (${compartiments.length})`}>
            <p className="mb-3 text-[12.5px] text-muted">
              Un compartiment regroupe des domaines de la grille. Dans un dossier, il se confie à un consultant du cabinet, qui suit son score, ses manques à traiter et ses études, et retrouve ses critères par « Mes compartiments » dans l&apos;évaluation.
            </p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {compartiments.map((k) => {
                const doms = p.domains.filter((x) => x.compartment_id === k.id);
                const n = p.criteria.filter((c) => doms.some((x) => x.id === c.domain_id)).length;
                return (
                  <li key={k.id} className="flex min-w-0 flex-col rounded-xl border border-line bg-panel p-3.5">
                    {editable ? (
                      <div className="flex items-start gap-2">
                        <CelluleTexte label={`Code du compartiment ${k.code}`} className="w-16 font-mono text-[12.5px] font-bold" obligatoire value={k.code} onSave={(v) => enregistrer(`/axispro/compartments/${k.id}`, { code: v }, `Compartiment ${v} mis à jour.`)} />
                        <div className="min-w-0 flex-1">
                          <CelluleTexte label={`Intitulé du compartiment ${k.code}`} className="w-full" obligatoire value={k.name} onSave={(v) => enregistrer(`/axispro/compartments/${k.id}`, { name: v }, `Compartiment ${k.code} mis à jour.`)} />
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2.5">
                        <PuceCompartiment code={k.code} className="mt-0.5" />
                        <div className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-ink">{k.name}</div>
                      </div>
                    )}
                    <div className="mt-1.5 text-[12px] text-muted">{pluriel(doms.length, "domaine")}, {pluriel(n, "critère")}</div>
                    <ul className="mt-2 space-y-1 border-t border-line pt-2 text-[12.5px]">
                      {doms.map((x) => (
                        <li key={x.id} className="flex gap-2 leading-snug">
                          <span className="font-mono text-[11.5px] text-muted">{x.code}</span>
                          <span className="min-w-0 text-ink-2">{x.name}</span>
                        </li>
                      ))}
                      {doms.length === 0 && <li className="italic text-muted">Aucun domaine rattaché.</li>}
                    </ul>
                  </li>
                );
              })}
            </ul>
            {p.domains.some((x) => !x.compartment_id) && (
              <div className="mt-3">
                <Notice tone="warn">Domaines sans compartiment : {p.domains.filter((x) => !x.compartment_id).map((x) => `${x.code} ${x.name}`).join(", ")}. Leurs critères ne sont confiés à personne dans les dossiers.</Notice>
              </div>
            )}
          </Card>
          {editable && (
            <Card title="Rattachement des domaines" padded={false}>
              <p className="px-6 pb-2 text-[12.5px] text-muted">Version en brouillon : choisissez le compartiment de chaque domaine. Les dossiers ouverts gardent la version de grille de leur ouverture.</p>
              <DataTable dense rows={p.domains} rowKey={(x) => x.id} columns={[
                { key: "code", label: "Code", render: (x) => <span className="font-mono text-xs">{x.code}</span> },
                { key: "name", label: "Domaine", render: (x) => <span className="min-w-[180px]">{x.name}</span> },
                { key: "criteria", label: "Critères", align: "right", render: (x) => String(p.criteria.filter((c) => c.domain_id === x.id).length) },
                {
                  key: "compartment",
                  label: "Compartiment",
                  render: (x) => (
                    <Select aria-label={`Compartiment du domaine ${x.code}`} className="min-h-8 w-72 py-1 text-[12.5px]" disabled={occupe} value={x.compartment_id ?? ""} placeholder="Aucun compartiment" onChange={(e) => patchDomain(x, e.target.value ? Number(e.target.value) : null)} options={compartiments.map((k) => ({ value: k.id, label: `${k.code} ${k.name}` }))} />
                  ),
                },
              ]} />
            </Card>
          )}
        </div>
      )}

      {vueAffichee === "gates" && (
        <Card title="Stage gates et règles de passage" padded={false}>
          <DataTable rows={p.gates} rowKey={(g) => g.id} columns={[
            { key: "code", label: "Gate", render: (g) => <div className="min-w-[160px]"><b>{g.code}</b> {g.name}</div> },
            { key: "rule", label: "Règle", render: (g) => (editable ? <Select className="min-h-8 w-56 py-1 text-[12.5px]" disabled={occupe} value={g.rule_code} onChange={(e) => patchGate(g, { rule_code: e.target.value })} options={Object.entries(p.rules).map(([value, label]) => ({ value, label }))} /> : <span className="text-[12.5px]">{p.rules[g.rule_code]}</span>) },
            { key: "hold", label: "Seuil HOLD", align: "right", render: (g) => (editable ? <CelluleNombre label={`Seuil HOLD du gate ${g.code}`} className="w-20" placeholder="–" value={g.threshold_hold} vide={0} controle={SUR_CENT} onSave={(v) => enregistrer(`/axispro/gates/${g.id}`, { threshold_hold: v }, `Gate ${g.code} mis à jour.`)} /> : (g.threshold_hold !== null ? fmtDec(g.threshold_hold) : "–")) },
            { key: "go", label: "Seuil GO", align: "right", render: (g) => (editable ? <CelluleNombre label={`Seuil GO du gate ${g.code}`} className="w-20" placeholder="–" value={g.threshold_go} vide={0} controle={SUR_CENT} onSave={(v) => enregistrer(`/axispro/gates/${g.id}`, { threshold_go: v }, `Gate ${g.code} mis à jour.`)} /> : (g.threshold_go !== null ? fmtDec(g.threshold_go) : "–")) },
            {
              key: "completeness",
              label: "Complétude min.",
              align: "right",
              render: (g) => (editable ? (
                <span className="inline-flex items-start gap-1" title="Exigence d'entrée : en dessous, le gate ne s'examine pas (HOLD). Vide : aucune.">
                  <CelluleNombre label={`Complétude documentaire minimale du gate ${g.code} (%)`} className="w-20" placeholder="–" value={g.min_completeness} vide={0} controle={POURCENT} onSave={(v) => enregistrer(`/axispro/gates/${g.id}`, { min_completeness: v }, `Gate ${g.code} mis à jour.`)} />
                  <span className="pt-1.5 text-muted">%</span>
                </span>
              ) : g.min_completeness ? fmtPct(g.min_completeness, 0) : "–"),
            },
            { key: "scope", label: "Portée du score", render: (g) => (editable ? <Select className="min-h-8 w-44 py-1 text-[12.5px]" disabled={occupe} value={g.score_scope} onChange={(e) => patchGate(g, { score_scope: e.target.value })} options={Object.entries(p.scopes).map(([value, label]) => ({ value, label }))} /> : <span className="text-[12.5px]">{p.scopes[g.score_scope]}</span>) },
            { key: "domains", label: "Domaines contrôlés", render: (g) => <span className="text-[12.5px]">{g.domain_ids.map((d) => domainCode[d]).join(", ") || "–"}</span> },
            { key: "texts", label: "Entrée, livrables, passage", render: (g) => <div className="max-w-[360px] space-y-0.5 text-[11.5px] text-muted">{g.entry_requirements && <div><b>Entrée.</b> {g.entry_requirements}</div>}{g.deliverables && <div><b>Livrables.</b> {g.deliverables}</div>}{g.exit_criteria && <div><b>Passage.</b> {g.exit_criteria}</div>}</div> },
          ]} />
        </Card>
      )}

      {vueAffichee === "pieces" && (
        <Card title={`Pièces de la data room (${p.documents.length})`} padded={false}>
          {editable && <p className="px-6 pb-2 text-[12.5px] text-muted">Version en brouillon : intitulé, rubrique, gate, caractère obligatoire, consignes au porteur et critères justifiés de chaque pièce se modifient ici.</p>}
          <DataTable dense rows={p.documents} rowKey={(t) => t.id} columns={[
            { key: "code", label: "Code", render: (t) => <span className="font-mono text-xs">{t.code}</span> },
            { key: "name", label: "Pièce", render: (t) => <div className="min-w-[200px]"><div>{t.name}</div>{t.guidance && <div className="text-[11.5px] text-muted">{t.guidance}</div>}</div> },
            { key: "category", label: "Rubrique", render: (t) => t.category ?? "–" },
            { key: "gate", label: "Attendue au gate", render: (t) => (t.gate_id ? gateCode[t.gate_id] : "Dès l'ouverture") },
            { key: "required", label: "", render: (t) => (t.required ? <Badge tone="accent">Obligatoire</Badge> : <Badge>Facultative</Badge>) },
            { key: "criteria", label: "Critères justifiés", render: (t) => t.criteria.join(", ") || "–" },
            ...(editable
              ? [{
                  key: "edit",
                  label: "",
                  render: (t: PieceStandard) => (
                    <Button size="sm" variant="ghost" disabled={occupe} onClick={() => setEdition(t)} aria-label={`Modifier la pièce ${t.code}`}>
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </Button>
                  ),
                }]
              : []),
          ]} />
        </Card>
      )}

      {vueAffichee === "criteres" && p.domains.map((d) => {
        const rows = p.criteria.filter((c) => c.domain_id === d.id);
        const k = d.compartment_id ? compartimentDe.get(d.compartment_id) : undefined;
        const titre = `${d.code}, ${d.name}${p.weighting === "domain" ? `, poids ${fmtDec(d.weight)}` : ""}, ${pluriel(rows.length, "critère")}`;
        return (
          <Card key={d.id} title={k ? <span className="inline-flex flex-wrap items-center gap-2"><PuceCompartiment code={k.code} nom={k.name} /><span>{titre}</span></span> : titre} actions={k ? <span className="text-[12.5px] text-muted">{k.name}</span> : undefined} padded={false}>
            {d.deliverable && <p className="px-4 pt-2 text-[12px] text-muted">Livrable type d&apos;un écart : {d.deliverable}</p>}
            <DataTable dense rows={rows} rowKey={(c) => c.id} columns={[
              { key: "code", label: "Code", render: (c) => <span className="font-mono text-xs">{c.code}</span> },
              { key: "name", label: "Critère", render: (c) => <div className="min-w-[220px]"><div>{c.name}</div>{c.pieces.length > 0 && <div className="text-[11px] text-muted">Pièces : {c.pieces.join(", ")}</div>}</div> },
              { key: "gate", label: "Gate", render: (c) => gateCode[c.gate_id] ?? "–" },
              { key: "requirement", label: "Exigence", render: (c) => (editable ? <Select className="min-h-8 w-36 py-1 text-[12.5px]" disabled={occupe} value={c.requirement_type} onChange={(e) => patch(c, { requirement_type: e.target.value as Criterion["requirement_type"] })} options={Object.entries(p.requirements).map(([value, label]) => ({ value, label }))} /> : <span className="whitespace-nowrap text-[12.5px]">{p.requirements[c.requirement_type]}</span>) },
              { key: "weight", label: "Poids", align: "right", render: (c) => (editable ? <CelluleNombre label={`Poids du critère ${c.code}`} className="w-20" value={c.weight} controle={POIDS} onSave={(v) => enregistrer(`/axispro/criteria/${c.id}`, { weight: v }, `Critère ${c.code} mis à jour.`)} /> : fmtDec(c.weight)) },
              { key: "critical", label: "Critique", align: "center", render: (c) => <Flag on={c.critical} editable={editable} occupe={occupe} onToggle={() => patch(c, { critical: !c.critical })} /> },
              { key: "knockout", label: "Knock-out", align: "center", render: (c) => <Flag on={c.knockout} editable={editable} occupe={occupe} danger onToggle={() => patch(c, { knockout: !c.knockout })} /> },
              { key: "bankability", label: "Bancabilité", align: "center", render: (c) => <Flag on={c.bankability} editable={editable} occupe={occupe} onToggle={() => patch(c, { bankability: !c.bankability })} /> },
              { key: "evidence_required", label: "Preuve", align: "center", render: (c) => <Flag on={c.evidence_required} editable={editable} occupe={occupe} onToggle={() => patch(c, { evidence_required: !c.evidence_required })} /> },
              {
                key: "indicator",
                label: "Indicateur du modèle financier",
                render: (c) => {
                  const info = c.indicator ? p.indicators[c.indicator] : null;
                  if (!editable) return info ? <span className="whitespace-nowrap text-[12.5px]">{info.label} {info.higher ? "≥" : "≤"} {seuilEcrit(c.indicator_threshold, info)}{c.indicator_partial !== null ? `, incomplet ${seuilEcrit(c.indicator_partial, info)}` : ""}</span> : <span className="text-muted">–</span>;
                  return (
                    <div className="flex flex-wrap items-start gap-1.5">
                      <Select aria-label={`Indicateur du critère ${c.code}`} className="min-h-8 w-52 py-1 text-[12.5px]" disabled={occupe} value={c.indicator ?? ""} onChange={(e) => patch(c, { indicator: e.target.value || null })} options={[{ value: "", label: "Aucun" }, ...Object.entries(p.indicators).map(([value, i]) => ({ value, label: i.label }))]} />
                      {info && (
                        <>
                          <span title={`Seuil : ${info.higher ? "au moins" : "au plus"}, en ${info.unit}`}>
                            <CelluleNombre label={`Seuil de satisfaction du critère ${c.code} (${info.unit})`} className="w-24" placeholder="Seuil" value={c.indicator_threshold} onSave={(v) => enregistrer(`/axispro/criteria/${c.id}`, { indicator_threshold: v }, `Critère ${c.code} mis à jour.`)} />
                          </span>
                          <span title="Seuil d'un statut incomplet (facultatif) : vide, il n'y en a pas">
                            <CelluleNombre label={`Seuil incomplet du critère ${c.code} (${info.unit})`} className="w-24" placeholder="Incomplet" value={c.indicator_partial} vide={null} onSave={(v) => enregistrer(`/axispro/criteria/${c.id}`, { indicator_partial: v }, `Critère ${c.code} mis à jour.`)} />
                          </span>
                        </>
                      )}
                    </div>
                  );
                },
              },
            ]} />
          </Card>
        );
      })}

      {edition && (
        <FormulairePiece
          piece={edition}
          policy={p}
          onClose={() => setEdition(null)}
          onSaved={(suite) => {
            setEdition(null);
            void mutate(suite, { revalidate: false });
            onChanged();
            setRetour({ tone: "ok", text: `Pièce ${edition.code} mise à jour.` });
          }}
        />
      )}
      <RetourFlottant retour={retour} setRetour={setRetour} />
    </div>
  );
}

function Flag({ on, editable, occupe, danger, onToggle }: { on: boolean; editable: boolean; occupe?: boolean; danger?: boolean; onToggle: () => void }) {
  if (editable) return <input type="checkbox" checked={on} disabled={occupe} onChange={onToggle} />;
  return on ? <Badge tone={danger ? "danger" : "accent"}>oui</Badge> : <span className="text-muted">–</span>;
}

/**
 * Pièce standard d'une version en brouillon (PATCH /axispro/document-types/<id>, profil cabinet) :
 * intitulé, rubrique, gate où elle est attendue, caractère obligatoire, consignes au porteur et critères
 * qu'elle justifie. Fenêtre non fermable pendant l'envoi, fermée sur confirmation quand la saisie a
 * changé ; le refus du noyau s'affiche dans la fenêtre, la saisie gardée.
 */
function FormulairePiece({ piece, policy, onClose, onSaved }: { piece: PieceStandard; policy: Policy; onClose: () => void; onSaved: (p: Policy) => void }) {
  const [depart] = useState(() => ({
    name: piece.name,
    category: piece.category ?? "",
    gate_id: piece.gate_id ? String(piece.gate_id) : "",
    required: piece.required,
    guidance: piece.guidance ?? "",
    criterion_ids: (piece.criterion_ids ?? policy.criteria.filter((c) => piece.criteria.includes(c.code)).map((c) => c.id)).slice().sort((a, b) => a - b),
  }));
  const [f, setF] = useState(depart);
  const [filtre, setFiltre] = useState("");
  const { envoyer, enCours, bandeau } = useRetour();
  const modifie = JSON.stringify(f) !== JSON.stringify(depart);
  const choisis = new Set(f.criterion_ids);
  const cherche = simple(filtre.trim());
  const proposes = policy.criteria.filter((c) => !cherche || simple(`${c.code} ${c.name}`).includes(cherche));
  async function fermer() {
    if (enCours) return;
    if (await fermerSiConfirme(modifie)) onClose();
  }
  function basculer(id: number) {
    const suite = new Set(choisis);
    if (suite.has(id)) suite.delete(id);
    else suite.add(id);
    setF({ ...f, criterion_ids: [...suite].sort((a, b) => a - b) });
  }
  async function enregistrer() {
    if (!f.name.trim() || !modifie) return;
    const suite = await envoyer(
      () => apiSend<Policy>("PATCH", `/axispro/document-types/${piece.id}`, {
        name: f.name.trim(),
        category: f.category.trim() || null,
        gate_id: f.gate_id ? Number(f.gate_id) : null,
        required: f.required,
        guidance: f.guidance.trim() || null,
        criterion_ids: f.criterion_ids,
      }),
      undefined,
      "piece",
    );
    if (suite) onSaved(suite);
  }
  return (
    <Modal open wide title={`Pièce ${piece.code}, version ${policy.version} en brouillon`} onClose={() => void fermer()} footer={
      <>
        <Button variant="ghost" disabled={!!enCours} onClick={() => void fermer()}>Annuler</Button>
        <Button variant="primary" loading={enCours === "piece"} disabled={!f.name.trim() || !modifie} onClick={() => void enregistrer()}>Enregistrer la pièce</Button>
      </>
    }>
      <fieldset disabled={!!enCours} className="min-w-0 space-y-3">
        {bandeau}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Pièce" error={f.name.trim() ? undefined : "Intitulé obligatoire."} className="md:col-span-2">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Rubrique de la data room">
            <Input value={f.category} placeholder="Exemple : A. Corporate / KYC" onChange={(e) => setF({ ...f, category: e.target.value })} />
          </Field>
          <Field label="Attendue au gate">
            <Select value={f.gate_id} onChange={(e) => setF({ ...f, gate_id: e.target.value })} options={[{ value: "", label: "Dès l'ouverture" }, ...policy.gates.map((g) => ({ value: String(g.id), label: `${g.code} ${g.name}` }))]} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-2 md:col-span-2">
            <input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />
            Pièce obligatoire (comptée dans la complétude de la data room)
          </label>
          <Field label="Consignes au porteur" className="md:col-span-2">
            <Textarea className="min-h-[60px]" value={f.guidance} onChange={(e) => setF({ ...f, guidance: e.target.value })} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-ink-2">Critères justifiés : {pluriel(f.criterion_ids.length, "critère rattaché", "critères rattachés")}</span>
            <span className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <Input aria-label="Filtrer les critères" className="min-h-8 w-64 py-1 pl-8 text-[13px]" placeholder="Code ou intitulé" value={filtre} onChange={(e) => setFiltre(e.target.value)} />
            </span>
          </div>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-line p-1.5 text-[13px]">
            {proposes.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-panel-2">
                  <input type="checkbox" className="mt-1" checked={choisis.has(c.id)} onChange={() => basculer(c.id)} />
                  <span className="font-mono text-[12px] text-muted">{c.code}</span>
                  <span className="min-w-0 flex-1 text-ink-2">{c.name}</span>
                </label>
              </li>
            ))}
            {proposes.length === 0 && <li className="px-2 py-2 text-muted">Aucun critère ne correspond au filtre.</li>}
          </ul>
        </div>
      </fieldset>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [initial] = useState({ name: "Politique d'évaluation MB AxisPro Consulting", go_threshold: "", conditional_threshold: "50", notes: "" });
  const [f, setF] = useState(initial);
  const { envoyer, enCours, bandeau } = useRetour();
  const modifie = !!file || JSON.stringify(f) !== JSON.stringify(initial);
  // Seuils lus à la française (« 65 », « 52,5 ») ; illisibles, l'import attend leur correction.
  const seuils = { go_threshold: lireNombre(f.go_threshold), conditional_threshold: lireNombre(f.conditional_threshold) };
  const erreurs = {
    go_threshold: nombreIllisible(f.go_threshold) ? AIDE_NOMBRE : seuils.go_threshold !== null ? (SUR_CENT(seuils.go_threshold) ?? undefined) : undefined,
    conditional_threshold: nombreIllisible(f.conditional_threshold) ? AIDE_NOMBRE : seuils.conditional_threshold !== null ? (SUR_CENT(seuils.conditional_threshold) ?? undefined) : undefined,
  };
  const bloque = !file || !!(erreurs.go_threshold || erreurs.conditional_threshold);
  async function fermer() {
    if (enCours) return;
    if (await fermerSiConfirme(modifie)) onClose();
  }
  async function submit() {
    if (!file || bloque) return;
    const form = new FormData();
    form.append("file", file);
    // Intitulé vidé : le noyau nomme la grille « Politique d'évaluation MB AxisPro Consulting ».
    if (f.name.trim()) form.append("name", f.name.trim());
    if (f.notes.trim()) form.append("notes", f.notes);
    for (const k of ["go_threshold", "conditional_threshold"] as const) {
      const n = seuils[k];
      if (n !== null) form.append(k, String(n));
    }
    const p = await envoyer(() => apiUpload<Policy>("/axispro/policies/import", form), undefined, "import");
    if (p) onDone(p.id);
  }
  return (
    <Modal open title="Importer une grille" onClose={() => void fermer()} footer={
      <>
        <Button variant="ghost" disabled={!!enCours} onClick={() => void fermer()}>Annuler</Button>
        <Button variant="primary" loading={enCours === "import"} disabled={bloque} onClick={() => void submit()}>Importer en brouillon</Button>
      </>
    }>
      <fieldset disabled={!!enCours} className="min-w-0 space-y-3">
        {bandeau && <div className="whitespace-pre-wrap">{bandeau}</div>}
        <Notice tone="accent">
          <b>Outil de scoring du cabinet.</b> Le classeur du cabinet (onglets Scoring, Stage_Gate, Data_Room_Index et Parametres) s&apos;importe tel quel : compartiments, domaines, critères, gates et leur complétude minimale, pièces de la data room, barème et seuils de classement en sont lus. Les codes des critères et des pièces, les aides, les livrables et les rattachements pièce-critère sont repris de la version en vigueur quand le libellé est le même, pour que dossiers, exports et analyses gardent leurs repères. Les pièces d&apos;une version en brouillon se modifient ensuite dans l&apos;onglet « Pièces de la data room ».
        </Notice>
        <p className="text-xs text-muted">
          Format générique, classeur XLSX ou CSV aux colonnes : type, code, libelle, domaine, gate, poids, critique, eliminatoire, preuve, aide ; lignes de type gate, domaine, critere et piece. Colonnes facultatives de la méthode MB AxisPro Consulting : exigence (bloquant, apd, closing), bancabilite, livrable, role (capex), règles des gates (regle, seuil_attente, seuil_go, portee, domaines, entree, passage, completude_min), compartiment des domaines (« C0 — Coordination et cadrage projet ») et rattachement des pièces (criteres). Une grille avec la colonne « exigence » est notée à plat, APD READY à 65 ; sinon, par domaine, à 70. Le détail est dans l&apos;onglet Aide du classeur modèle. La grille importée devient une nouvelle version en brouillon, à vérifier avant sa mise en vigueur.
        </p>
        <Field label="Classeur"><input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong/70 file:bg-panel file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-panel-2" /></Field>
        <Field label="Intitulé"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seuil APD READY (vide : selon le format)" error={erreurs.go_threshold}><Input inputMode="decimal" aria-invalid={erreurs.go_threshold ? true : undefined} value={f.go_threshold} onChange={(e) => setF({ ...f, go_threshold: e.target.value })} /></Field>
          <Field label="Seuil CONDITIONAL GO (vide : 50)" error={erreurs.conditional_threshold}><Input inputMode="decimal" aria-invalid={erreurs.conditional_threshold ? true : undefined} value={f.conditional_threshold} onChange={(e) => setF({ ...f, conditional_threshold: e.target.value })} /></Field>
        </div>
        <Field label="Principes de la politique (rappelés dans les rapports)"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </fieldset>
    </Modal>
  );
}
