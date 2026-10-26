"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, RotateCcw, Trash2 } from "@/components/icons";
import { Button, ErrorBox, Field, Input, Loading, Modal, Notice, Segmented, Select, cx } from "@/components/ui";
import { INDICATEUR } from "@/components/hsseq/commun";
import { champsEnErreur, messageErreur } from "@/components/hsseq/parametres/outils";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { INSECABLE, MONTHS_FR, fmtDateTime, pluriel } from "@/lib/format";
import type { Me } from "@/lib/types";
import { CUMUL, MODE, NATURE, NATURES_PLURIEL, SENS, UNITES, ecrireNombre, fmtPlan, libelleUnite, lireNombre } from "./outils";
import type { ReportAggregation, ReportDirection, ReportHistoryEntry, ReportIndicatorDef, ReportKey, ReportMode, ReportNature, ReportTemplateDetail, ReportTemplateInput } from "./types";

/** Profils qui lisent les tiers (GET /finance/partners) : eux seuls choisissent la fiche client du donneur d'ordre. */
const LECTEURS_TIERS = ["admin", "direction", "finance", "achats", "exploitation", "chantiers", "immobilier", "cabinet"] as const;

/** Indicateur en cours de saisie ; `cle` le tient à sa place pendant les déplacements. */
interface IndicateurEdite {
  cle: string;
  id: number | null;
  code: string;
  label: string;
  nature: ReportNature;
  mode: ReportMode;
  key: string | null;
  unit: string;
  direction: ReportDirection;
  aggregation: ReportAggregation;
  /** Douze plans saisis, de janvier à décembre (texte vide : pas de plan). */
  targets: string[];
  alert_threshold: string;
  sequence: number;
  active: boolean;
}

let compteur = 0;
const nouvelleCle = () => `indicateur-nouveau-${++compteur}`;

function depuis(i: ReportIndicatorDef): IndicateurEdite {
  return {
    cle: `indicateur-${i.id}`, id: i.id, code: i.code, label: i.label, nature: i.nature, mode: i.mode, key: i.key, unit: i.unit ?? "", direction: i.direction, aggregation: i.aggregation,
    targets: Array.from({ length: 12 }, (_, k) => ecrireNombre(i.targets[k] ?? null)), alert_threshold: ecrireNombre(i.alert_threshold), sequence: i.sequence, active: i.active,
  };
}

/** Indicateur neuf : saisi, de la nature du groupe où il s'ajoute. */
const vierge = (nature: ReportNature): IndicateurEdite => ({
  cle: nouvelleCle(), id: null, code: "", label: "", nature, mode: "manual", key: null, unit: "nbre", direction: "up", aggregation: "sum", targets: Array(12).fill(""), alert_threshold: "", sequence: 10, active: true,
});

/** Part de la cible écrite en pour cent pour un champ : 0,95 → « 95 ». */
const enPourCent = (v: number) => String(Math.round(v * 1000) / 10).replace(".", ",");

/** Un indicateur du cockpit sans plan prend la cible des réglages d'HSSEQ (_target du noyau). */
const duCockpit = (x: Pick<IndicateurEdite, "mode" | "key">) => x.mode === "computed" && x.key !== null && x.key in INDICATEUR;

/** Plan d'un indicateur en une ligne : le même chaque mois, mois par mois, ou celui des réglages. */
function resumePlan(x: IndicateurEdite): string {
  const remplis = x.targets.filter((t) => t.trim() !== "");
  if (!remplis.length) return duCockpit(x) ? "plan : cible des réglages" : "sans plan";
  const valeurs = new Set(x.targets.map((t) => lireNombre(t)));
  if (remplis.length === 12 && valeurs.size === 1) return `plan ${fmtPlan(lireNombre(remplis[0] ?? ""), x.unit || null, x.direction)} chaque mois`;
  return `plan mois par mois (${pluriel(remplis.length, "mois")})`;
}

/**
 * Création ou modification d'un modèle de rapport (POST, PATCH /hsseq/reports/templates, administration
 * et Responsable HSSEQ) : nom, donneur d'ordre, société, seuils de l'état, puis les indicateurs
 * proactifs et réactifs dans l'ordre du donneur d'ordre. Rien n'est envoyé avant « Enregistrer » ;
 * l'indicateur retiré d'un modèle enregistré reste gardé pour les mois qui ont des valeurs.
 */
export function EditeurModele({ id, onClose, onDone }: { id: number | null; onClose: () => void; onDone: (t: ReportTemplateDetail, cree: boolean) => void }) {
  const { data: detail, error } = useApi<ReportTemplateDetail>(id ? `/hsseq/reports/templates/${id}` : null);
  const { data: cles } = useApi<ReportKey[]>("/hsseq/reports/keys");
  if (id && !detail) {
    return (
      <Modal open wide title="Modèle de rapport" onClose={onClose}>
        {error ? <ErrorBox error={error} /> : <Loading label="Chargement du modèle…" />}
      </Modal>
    );
  }
  return <Formulaire key={detail?.id ?? "nouveau"} detail={detail ?? null} cles={cles ?? []} onClose={onClose} onDone={onDone} />;
}

function Formulaire({ detail, cles, onClose, onDone }: { detail: ReportTemplateDetail | null; cles: ReportKey[]; onClose: () => void; onDone: (t: ReportTemplateDetail, cree: boolean) => void }) {
  const { data: me } = useApi<Me>("/auth/me");
  const lecteurTiers = useAutorise(LECTEURS_TIERS);
  const { data: tiers } = useApi<{ items: Array<{ id: number; name: string }> }>(lecteurTiers ? "/finance/partners?kind=customer&limit=200" : null);
  const [nom, setNom] = useState(detail?.name ?? "");
  const [libelle, setLibelle] = useState(detail?.client_label ?? "");
  const partenaireInitial = detail?.partner ? String(detail.partner.id) : "";
  const [partenaire, setPartenaire] = useState(partenaireInitial);
  const [societe, setSociete] = useState<string | null>(null);
  const [conforme, setConforme] = useState(enPourCent(detail?.compliant_ratio ?? 0.95));
  const [surveillance, setSurveillance] = useState(enPourCent(detail?.watch_ratio ?? 0.85));
  const [actif, setActif] = useState(detail?.active ?? true);
  const [indicateurs, setIndicateurs] = useState<IndicateurEdite[]>(() => (detail?.indicators ?? []).map(depuis));
  const [ouvert, setOuvert] = useState<IndicateurEdite | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [envoi, setEnvoi] = useState(false);
  const champs = champsEnErreur(erreur);

  // Nouveau modèle : la société du compte par défaut ; un modèle enregistré garde la sienne (vide : les deux).
  const societeChoisie = societe ?? (detail ? (detail.company ? String(detail.company.id) : "") : String(me?.company_id ?? ""));
  const c = lireNombre(conforme);
  const s = lireNombre(surveillance);
  const seuilsFaux = c === null || s === null || !(s > 0 && s <= c && c <= 150);
  const actifs = (n: ReportNature) => indicateurs.filter((i) => i.active && i.nature === n);
  const retires = indicateurs.filter((i) => !i.active);
  const complet = nom.trim() !== "" && !seuilsFaux;
  const optionsTiers = [...(tiers?.items ?? []), ...(detail?.partner && !tiers?.items.some((p) => p.id === detail.partner?.id) ? [detail.partner] : [])].map((p) => ({ value: p.id, label: p.name }));

  /** Déplace un indicateur d'un rang dans son groupe (proactifs ou réactifs en service). */
  function deplacer(cle: string, sens: -1 | 1) {
    const x = indicateurs.find((i) => i.cle === cle);
    if (!x) return;
    const groupe = actifs(x.nature);
    const voisin = groupe[groupe.indexOf(x) + sens];
    if (!voisin) return;
    const suite = [...indicateurs];
    const [a, b] = [suite.indexOf(x), suite.indexOf(voisin)];
    [suite[a], suite[b]] = [voisin, x];
    setIndicateurs(suite);
  }
  /** Retire un indicateur : jamais enregistré, il disparaît ; enregistré, il passe aux retirés. */
  function retirer(cle: string) {
    const x = indicateurs.find((i) => i.cle === cle);
    if (!x) return;
    setIndicateurs(x.id === null ? indicateurs.filter((i) => i.cle !== cle) : indicateurs.map((i) => (i.cle === cle ? { ...i, active: false } : i)));
  }
  function appliquer(x: IndicateurEdite) {
    setIndicateurs(indicateurs.some((i) => i.cle === x.cle) ? indicateurs.map((i) => (i.cle === x.cle ? x : i)) : [...indicateurs, x]);
    setOuvert(null);
  }

  async function enregistrer() {
    if (c === null || s === null) return;
    setEnvoi(true);
    setErreur(null);
    // Ordre du rapport : rang dans le groupe ; les retirés gardent le leur.
    const ordonnes = [...(["proactive", "reactive"] as const).flatMap((n) => actifs(n).map((x, k) => ({ x, sequence: (k + 1) * 10 }))), ...retires.map((x) => ({ x, sequence: x.sequence }))];
    const corps: ReportTemplateInput = {
      name: nom.trim(),
      client_label: libelle.trim() || null,
      company_id: societeChoisie ? Number(societeChoisie) : null,
      compliant_ratio: c / 100,
      watch_ratio: s / 100,
      active: actif,
      indicators: ordonnes.map(({ x, sequence }) => ({
        ...(x.id !== null ? { id: x.id } : {}),
        code: x.code,
        label: x.label,
        nature: x.nature,
        mode: x.mode,
        key: x.mode === "computed" ? x.key : null,
        unit: x.unit.trim() || null,
        direction: x.direction,
        aggregation: x.aggregation,
        targets: x.targets.map((t) => lireNombre(t)),
        alert_threshold: lireNombre(x.alert_threshold),
        sequence,
        active: x.active,
      })),
    };
    if (lecteurTiers && partenaire !== partenaireInitial) corps.partner_id = partenaire ? Number(partenaire) : null;
    try {
      const t = detail ? await apiSend<ReportTemplateDetail>("PATCH", `/hsseq/reports/templates/${detail.id}`, corps) : await apiSend<ReportTemplateDetail>("POST", "/hsseq/reports/templates", corps);
      onDone(t, !detail);
    } catch (e) {
      setErreur(e);
    } finally {
      setEnvoi(false);
    }
  }

  const nbActifs = indicateurs.filter((i) => i.active).length;
  const nbSaisis = indicateurs.filter((i) => i.active && i.mode === "manual").length;
  return (
    <>
      <Modal
        open
        wide
        title={detail ? `Modèle « ${detail.name} »` : "Nouveau modèle de rapport"}
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto self-center text-[12.5px] text-muted">
              {pluriel(nbActifs, "indicateur en service", "indicateurs en service")}, dont {pluriel(nbSaisis, "saisi", "saisis")} chaque mois.
            </span>
            <Button onClick={onClose}>Annuler</Button>
            <Button variant="primary" loading={envoi} disabled={!complet} onClick={() => void enregistrer()}>
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {erreur !== null && <Notice tone="danger">{messageErreur(erreur)}</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom du modèle" className="sm:col-span-2" error={champs.includes("name") ? "Nom à renseigner." : undefined}>
              <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Rapport HSSE mensuel, nom du donneur d'ordre" required />
            </Field>
            <Field label="Donneur d'ordre, tel qu'écrit sur le rapport" hint="Repris en tête du classeur Excel et du PDF.">
              <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} />
            </Field>
            {lecteurTiers ? (
              <Field label="Fiche client du donneur d'ordre" hint="Facultatif : le client parmi les tiers de NIMOVA.">
                <Select value={partenaire} onChange={(e) => setPartenaire(e.target.value)} placeholder="Aucune fiche" options={optionsTiers} />
              </Field>
            ) : (
              detail?.partner && (
                <Field label="Fiche client du donneur d'ordre" hint="Le choix de la fiche revient aux profils qui lisent les tiers (administration).">
                  <Input value={detail.partner.name} disabled />
                </Field>
              )
            )}
            <Field label="Société" hint="Un modèle des deux sociétés se tire pour chacune d'elles.">
              <Select value={societeChoisie} onChange={(e) => setSociete(e.target.value)} placeholder="Les deux sociétés" options={(me?.companies ?? []).map((x) => ({ value: x.id, label: x.name }))} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
              <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} /> Modèle en service, proposé au rapport mensuel
            </label>
            <Field label="Conforme à partir de (% de la cible)" error={seuilsFaux || champs.includes("compliant_ratio") ? `Entre la surveillance et 150${INSECABLE}%.` : undefined}>
              <Input inputMode="decimal" value={conforme} aria-invalid={seuilsFaux || undefined} onChange={(e) => setConforme(e.target.value)} />
            </Field>
            <Field label="Sous surveillance à partir de (% de la cible)" hint="En deçà : non conforme. Pour un indicateur où le plus bas est mieux, la cible se divise par ces parts." error={seuilsFaux || champs.includes("watch_ratio") ? `Plus de 0${INSECABLE}%, et pas plus que la conformité.` : undefined}>
              <Input inputMode="decimal" value={surveillance} aria-invalid={seuilsFaux || undefined} onChange={(e) => setSurveillance(e.target.value)} />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1 text-[15px] font-semibold text-ink">Indicateurs</legend>
            <p className="mb-3 max-w-[90ch] text-[12.5px] leading-snug text-muted">
              Dans l&apos;ordre du rapport du donneur d&apos;ordre, proactifs puis réactifs. Un indicateur est calculé par NIMOVA (une valeur du catalogue) ou saisi chaque mois par le Responsable HSSEQ ; son plan se fixe mois par mois.
            </p>
            {(champs.includes("indicators") || champs.includes("key")) && (
              <div className="mb-3">
                <Notice tone="danger">Un indicateur est refusé par le serveur : vérifiez les numéros, les libellés et la valeur calculée de chacun.</Notice>
              </div>
            )}
            <div className="space-y-5">
              {(["proactive", "reactive"] as const).map((n) => (
                <Groupe key={n} nature={n} lignes={actifs(n)} cles={cles} onModifier={setOuvert} onDeplacer={deplacer} onRetirer={retirer} onAjouter={() => setOuvert(vierge(n))} />
              ))}
            </div>
            {retires.length > 0 && (
              <details className="mt-5 rounded-xl border border-line px-4 py-3">
                <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Indicateurs retirés ({retires.length})</summary>
                <p className="mt-2 text-[12.5px] leading-snug text-muted">Gardés pour les mois qui ont des valeurs ; ils ne paraissent plus au rapport. Un indicateur retiré garde son numéro.</p>
                <ul className="mt-2 divide-y divide-line/70">
                  {retires.map((x) => (
                    <li key={x.cle} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
                      <span className="w-14 flex-none font-mono text-[12px] text-muted">{x.code}</span>
                      <span className="min-w-0 flex-1 text-ink-2">{x.label}</span>
                      <Button size="sm" variant="ghost" onClick={() => setIndicateurs(indicateurs.map((i) => (i.cle === x.cle ? { ...i, active: true } : i)))}>
                        <RotateCcw className="h-3.5 w-3.5" /> Rétablir
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </fieldset>

          {detail && <HistoriqueModele entrees={detail.history} />}
        </div>
      </Modal>
      {ouvert && <EditeurIndicateur x={ouvert} cles={cles} codesPris={indicateurs.filter((i) => i.cle !== ouvert.cle).map((i) => i.code)} onClose={() => setOuvert(null)} onValider={appliquer} />}
    </>
  );
}

/** Indicateurs en service d'une nature, dans leur ordre : monter, descendre, modifier, retirer. */
function Groupe({ nature, lignes, cles, onModifier, onDeplacer, onRetirer, onAjouter }: {
  nature: ReportNature;
  lignes: IndicateurEdite[];
  cles: ReportKey[];
  onModifier: (x: IndicateurEdite) => void;
  onDeplacer: (cle: string, sens: -1 | 1) => void;
  onRetirer: (cle: string) => void;
  onAjouter: () => void;
}) {
  const libelleCle = (k: string | null) => cles.find((c) => c.key === k)?.label ?? k ?? "valeur à choisir";
  return (
    <section aria-label={NATURES_PLURIEL[nature]}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-ink">
          {NATURES_PLURIEL[nature]} <span className="font-normal text-muted">({lignes.length})</span>
        </h3>
        <Button size="sm" onClick={onAjouter}>
          <Plus className="h-3.5 w-3.5" /> Ajouter un indicateur {NATURE[nature].toLocaleLowerCase("fr")}
        </Button>
      </div>
      {lignes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-4 text-center text-[13px] text-muted">Aucun indicateur {NATURE[nature].toLocaleLowerCase("fr")}.</p>
      ) : (
        <ol className="space-y-2">
          {lignes.map((x, k) => (
            <li key={x.cle} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line bg-panel px-3 py-2.5 sm:flex-nowrap">
              <span className="w-14 flex-none font-mono text-[12px] text-muted">{x.code || "–"}</span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-[13.5px] font-medium leading-snug text-ink">{x.label}</p>
                <p className="text-[12px] leading-snug text-muted">
                  {x.mode === "computed" ? `Calculé : ${libelleCle(x.key)}` : "Saisi chaque mois"} · {libelleUnite(x.unit || null)} · {resumePlan(x)}
                  {x.alert_threshold.trim() ? ` · seuil d'alerte ${x.alert_threshold}` : ""}
                </p>
              </div>
              <span className="flex flex-none items-center">
                <Button variant="ghost" size="sm" aria-label={`Monter ${x.code}`} title="Monter" disabled={k === 0} onClick={() => onDeplacer(x.cle, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={`Descendre ${x.code}`} title="Descendre" disabled={k === lignes.length - 1} onClick={() => onDeplacer(x.cle, 1)}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={`Modifier ${x.code}`} title="Modifier" onClick={() => onModifier(x)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={`Retirer ${x.code}`} title="Retirer du modèle" onClick={() => onRetirer(x.cle)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Un indicateur du modèle : numéro, libellé, nature, calculé (valeur du catalogue, dont l'unité, le
 * cumul et le sens sont repris) ou saisi, plan mois par mois et seuil d'alerte facultatif. « Valider »
 * le reporte dans le modèle, que « Enregistrer » envoie.
 */
function EditeurIndicateur({ x, cles, codesPris, onClose, onValider }: { x: IndicateurEdite; cles: ReportKey[]; codesPris: string[]; onClose: () => void; onValider: (x: IndicateurEdite) => void }) {
  const [f, setF] = useState(x);
  const [pourTous, setPourTous] = useState("");
  const liste = useId();
  const cle = cles.find((k) => k.key === f.key) ?? null;
  const doublon = f.code.trim() !== "" && codesPris.includes(f.code.trim());
  const ciblesFausses = f.targets.map((t) => t.trim() !== "" && lireNombre(t) === null);
  const seuilFaux = f.alert_threshold.trim() !== "" && lireNombre(f.alert_threshold) === null;
  const sansValeur = f.mode === "computed" && !f.key;
  const complet = f.code.trim() !== "" && !doublon && f.label.trim() !== "" && !sansValeur && !ciblesFausses.some(Boolean) && !seuilFaux && !(pourTous.trim() !== "" && lireNombre(pourTous) === null);

  /** Valeur du catalogue choisie : son unité, son cumul et son sens ; son libellé et sa famille pour un indicateur neuf. */
  function choisirCle(k: string) {
    const spec = cles.find((c) => c.key === k);
    if (!spec) return setF({ ...f, key: null });
    setF({ ...f, key: spec.key, unit: spec.unit, aggregation: spec.aggregation, direction: spec.direction, label: f.label.trim() ? f.label : spec.label, nature: f.id === null && !f.label.trim() ? spec.family : f.nature });
  }

  return (
    <Modal
      open
      wide
      title={x.id !== null || x.code ? `Indicateur ${x.code || "sans numéro"}` : "Nouvel indicateur"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" disabled={!complet} onClick={() => onValider({ ...f, code: f.code.trim(), label: f.label.trim(), unit: f.unit.trim(), key: f.mode === "computed" ? f.key : null })}>
            Valider l&apos;indicateur
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <Field label="N°" hint="Celui du donneur d'ordre." error={doublon ? "Déjà pris dans ce modèle, retirés compris." : undefined}>
            <Input value={f.code} maxLength={32} aria-invalid={doublon || undefined} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="A1-3" />
          </Field>
          <Field label="Libellé">
            <Input value={f.label} maxLength={300} onChange={(e) => setF({ ...f, label: e.target.value })} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Nature</span>
            <Segmented
              label="Nature de l'indicateur"
              value={f.nature}
              onChange={(nature) => setF({ ...f, nature })}
              options={[
                { key: "proactive", label: NATURE.proactive },
                { key: "reactive", label: NATURE.reactive },
              ]}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Valeur</span>
            <Segmented
              label="Mode de calcul"
              value={f.mode}
              onChange={(mode) => setF({ ...f, mode })}
              options={[
                { key: "computed", label: MODE.computed },
                { key: "manual", label: "Saisi chaque mois" },
              ]}
            />
          </div>
        </div>

        {f.mode === "computed" ? (
          <Field label="Valeur calculée" hint={cle ? `Source : ${cle.source}. Unité : ${libelleUnite(cle.unit)} ; cumul : ${CUMUL[cle.aggregation].toLocaleLowerCase("fr")} ; ${SENS[cle.direction].toLocaleLowerCase("fr")}.` : "Une valeur du catalogue que NIMOVA calcule chaque mois ; elle se fige le 5 du mois suivant."} error={sansValeur ? "Choisissez la valeur calculée." : undefined}>
            <Select value={f.key ?? ""} onChange={(e) => choisirCle(e.target.value)} placeholder="Choisir dans le catalogue" options={cles.map((k) => ({ value: k.key, label: k.label }))} />
          </Field>
        ) : (
          <p className="rounded-[10px] bg-panel-2 px-3 py-2 text-[13px] leading-snug text-ink-2">Le Responsable HSSEQ saisit la valeur de chaque mois dans le rapport mensuel, jusqu&apos;à la validation du mois.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Unité">
            <Input value={f.unit} maxLength={32} list={liste} onChange={(e) => setF({ ...f, unit: e.target.value })} />
          </Field>
          <datalist id={liste}>
            {UNITES.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <Field label="Sens favorable">
            <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as ReportDirection })} options={(Object.keys(SENS) as ReportDirection[]).map((d) => ({ value: d, label: SENS[d] }))} />
          </Field>
          <Field label="Cumul de l'année">
            <Select value={f.aggregation} onChange={(e) => setF({ ...f, aggregation: e.target.value as ReportAggregation })} options={(Object.keys(CUMUL) as ReportAggregation[]).map((a) => ({ value: a, label: CUMUL[a] }))} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-[14px] font-semibold text-ink">Plan mois par mois</legend>
          <p className="mb-3 text-[12.5px] leading-snug text-muted">{duCockpit(f) ? "Vide : la cible des réglages d'HSSEQ, celle du cockpit." : "Vide : pas de plan ce mois-là, l'état du mois est « Sans donnée »."}</p>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Field label="Même plan chaque mois" className="w-40" error={pourTous.trim() !== "" && lireNombre(pourTous) === null ? "Nombre attendu." : undefined}>
              <Input inputMode="decimal" value={pourTous} onChange={(e) => setPourTous(e.target.value)} />
            </Field>
            <Button size="sm" className="mb-0.5" disabled={pourTous.trim() === "" || lireNombre(pourTous) === null} onClick={() => setF({ ...f, targets: Array(12).fill(pourTous.trim()) })}>
              Appliquer aux douze mois
            </Button>
            <Button size="sm" variant="ghost" className="mb-0.5" onClick={() => setF({ ...f, targets: Array(12).fill("") })}>
              Vider le plan
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {f.targets.map((t, k) => (
              <Field key={MONTHS_FR[k]} label={MONTHS_FR[k] ?? String(k + 1)} error={ciblesFausses[k] ? "Nombre attendu." : undefined}>
                <Input inputMode="decimal" value={t} aria-invalid={ciblesFausses[k] || undefined} onChange={(e) => setF({ ...f, targets: f.targets.map((v, j) => (j === k ? e.target.value : v)) })} className={cx("text-right tabular", ciblesFausses[k] && "border-danger")} />
              </Field>
            ))}
          </div>
        </fieldset>

        <Field label="Seuil d'alerte (facultatif)" className="max-w-xs" hint="Entre le plan et ce seuil : « Sous surveillance » ; au-delà : « Non conforme ». Sans seuil, la marge du modèle s'applique." error={seuilFaux ? "Nombre attendu." : undefined}>
          <Input inputMode="decimal" value={f.alert_threshold} aria-invalid={seuilFaux || undefined} onChange={(e) => setF({ ...f, alert_threshold: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/** Champs suivis du modèle, en clair, pour son journal. */
const CHAMP: Readonly<Record<string, string>> = {
  name: "Nom",
  client_label: "Donneur d'ordre",
  partner_id: "Fiche client",
  compliant_ratio: "Seuil de conformité",
  watch_ratio: "Seuil de surveillance",
  active: "Mise en service",
};

/** Valeur d'un champ du journal, lisible : parts en pour cent, mise en service en mots. */
function valeurJournal(champ: string | null, v: string | null): string {
  if (champ === "active") return v && ["true", "1"].includes(v.toLowerCase()) ? "en service" : "archivé";
  if (!v) return "vide";
  if (champ === "compliant_ratio" || champ === "watch_ratio") {
    const n = Number(v);
    return Number.isFinite(n) ? `${enPourCent(n)}${INSECABLE}%` : v;
  }
  return v;
}

/** Journal du modèle, du plus récent au plus ancien ; les indicateurs n'y sont pas suivis. */
function HistoriqueModele({ entrees }: { entrees: ReportHistoryEntry[] }) {
  if (!entrees.length) return null;
  const lignes = [...entrees].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  return (
    <details>
      <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Historique du modèle ({lignes.length})</summary>
      <ol className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-ink-2">
        {lignes.map((h) => (
          <li key={h.id}>
            <span className="text-muted">{fmtDateTime(h.at)}</span>, {h.by?.name ?? "Système"} :{" "}
            {h.action === "create" ? "modèle créé" : h.action === "write" && h.field ? `${(CHAMP[h.field] ?? h.field).toLocaleLowerCase("fr")} : « ${valeurJournal(h.field, h.old_value)} » devenu « ${valeurJournal(h.field, h.new_value)} »` : h.action}
          </li>
        ))}
      </ol>
    </details>
  );
}
