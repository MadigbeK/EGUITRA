"use client";

import { useState } from "react";
import { ListChecks, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Field, Input, Kpi, Loading, Notice, Select, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { OWNER, RISK_LEVEL, RISK_STATE, type Risk, type RiskLevel, type RiskSummary } from "@/lib/axispro-types";
import { CelluleChoix } from "./cellules";
import { LectureSeuleCabinet, useCabinet } from "./dossier/commun";

const ECHELLE = [1, 2, 3, 4, 5];
const PROBABILITE = ["", "Rare", "Peu probable", "Possible", "Probable", "Quasi certain"];
const IMPACT = ["", "Mineur", "Modéré", "Significatif", "Majeur", "Critique"];

function niveau(score: number): RiskLevel {
  return score >= 15 ? "critical" : score >= 10 ? "high" : score >= 5 ? "moderate" : "low";
}

interface Payload {
  risks: Risk[];
  summary: RiskSummary;
  categories: Record<string, string>;
}

export function Risques({ dossierId }: { dossierId: number }) {
  const chemin = `/axispro/dossiers/${dossierId}/risks`;
  const { data, error, mutate } = useApi<Payload>(chemin);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [vue, setVue] = useState<"inherent" | "residual">("inherent");
  const [ouvert, setOuvert] = useState<number | null>(null);
  // Registre des risques : écriture réservée au profil cabinet (POST /axispro/dossiers/<id>/risks,
  // PATCH et DELETE /axispro/risks/<id>, POST /axispro/risks/<id>/action) ; la direction et
  // l'administration lisent.
  const { cabinet } = useCabinet();

  async function agir(fn: () => Promise<unknown>, ok?: string) {
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ tone: "ok", text: ok });
      await mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading label="Chargement du registre des risques…" />;
  const vivants = data.risks.filter((r) => r.state !== "closed");
  const cellule = (p: number, i: number) =>
    vivants.filter((r) => (vue === "inherent" ? r.probability === p && r.impact === i : r.residual_probability === p && r.residual_impact === i));

  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <LectureSeuleCabinet>Lecture seule : votre profil consulte le registre des risques. Seul le profil cabinet le tient à jour.</LectureSeuleCabinet>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Risques ouverts" value={String(data.summary.open)} />
        <Kpi label="Critiques" value={String(data.summary.levels.critical)} tone={data.summary.levels.critical ? "danger" : "ok"} hint="Criticité de 15 à 25" />
        <Kpi label="Élevés" value={String(data.summary.levels.high)} tone={data.summary.levels.high ? "warn" : "ok"} hint="Criticité de 10 à 14" />
        <Kpi label="Avec plan de traitement" value={`${vivants.filter((r) => r.actions > 0).length} sur ${vivants.length}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card
          title="Matrice probabilité × impact"
          className="xl:col-span-5"
          actions={
            <Select aria-label="Criticité affichée" className="min-h-8 w-44 py-1 text-[13px]" value={vue} onChange={(e) => setVue(e.target.value as "inherent" | "residual")} options={[{ value: "inherent", label: "Avant traitement" }, { value: "residual", label: "Après traitement" }]} />
          }
        >
          <div className="flex gap-2">
            <div className="flex w-5 items-center justify-center">
              <span className="-rotate-90 whitespace-nowrap text-[11.5px] font-semibold text-muted">Probabilité</span>
            </div>
            <div className="flex-1">
              <div className="grid grid-cols-5 gap-1">
                {[...ECHELLE].reverse().map((p) =>
                  ECHELLE.map((i) => {
                    const items = cellule(p, i);
                    const lvl = niveau(p * i);
                    return (
                      <div
                        key={`${p}-${i}`}
                        title={`Probabilité ${p} (${PROBABILITE[p]}), impact ${i} (${IMPACT[i]}) : ${items.map((r) => r.name).join(", ") || "aucun risque"}`}
                        className="grid aspect-square place-items-center rounded-lg text-[13px] font-bold text-white"
                        style={{ background: RISK_LEVEL[lvl].color, opacity: items.length ? 1 : 0.22 }}
                      >
                        {items.length || ""}
                      </div>
                    );
                  }),
                )}
              </div>
              <div className="mt-1 grid grid-cols-5 gap-1 text-center text-[11px] text-muted">
                {ECHELLE.map((i) => (
                  <span key={i}>{i}</span>
                ))}
              </div>
              <div className="mt-0.5 text-center text-[11.5px] font-semibold text-muted">Impact</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted">
            {(Object.keys(RISK_LEVEL) as RiskLevel[]).map((l) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: RISK_LEVEL[l].color }} /> {RISK_LEVEL[l].label}
              </span>
            ))}
          </div>
        </Card>
        {cabinet && <NouveauRisque categories={data.categories} onCreate={(v) => agir(() => apiSend("POST", chemin, v), "Risque enregistré.")} />}
      </div>

      <Card title="Registre des risques" padded={false}>
        {data.risks.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Aucun risque identifié pour ce dossier.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.risks.map((r) => (
              <li key={r.id} className={cx("px-5 py-3.5", r.state === "closed" && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-xl text-[14px] font-bold text-white" style={{ background: RISK_LEVEL[r.level].color }} title="Criticité avant traitement">
                    {r.score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button type="button" className="text-left font-semibold text-ink hover:text-accent" onClick={() => setOuvert(ouvert === r.id ? null : r.id)} aria-expanded={ouvert === r.id}>
                      {r.name}
                    </button>
                    <div className="text-[12.5px] text-muted">
                      {data.categories[r.category] ?? r.category}, probabilité {r.probability}, impact {r.impact}
                      {r.residual_score ? `, après traitement ${r.residual_score} (${RISK_LEVEL[r.residual_level ?? "low"].label.toLowerCase()})` : ""}, suivi par {OWNER[r.owner].toLowerCase()}
                    </div>
                  </div>
                  <Badge tone={RISK_LEVEL[r.level].tone}>{RISK_LEVEL[r.level].label}</Badge>
                  {cabinet ? (
                    <CelluleChoix label={`État du risque ${r.name}`} className="w-40" value={r.state} options={RISK_STATE} onSave={(v) => agir(() => apiSend("PATCH", `/axispro/risks/${r.id}`, { state: v }))} />
                  ) : (
                    <Badge>{RISK_STATE[r.state]}</Badge>
                  )}
                </div>
                {ouvert === r.id && <EditionRisque r={r} categories={data.categories} agir={agir} ecriture={cabinet} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NouveauRisque({ categories, onCreate }: { categories: Record<string, string>; onCreate: (v: Record<string, unknown>) => Promise<void> }) {
  const vierge = { name: "", category: "market", probability: "3", impact: "3", owner: "porteur", mitigation: "" };
  const [f, setF] = useState(vierge);
  return (
    <Card title="Nouveau risque" className="xl:col-span-7">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Risque" className="md:col-span-2">
          <Input value={f.name} placeholder="Exemple : hausse du prix du ciment" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Catégorie">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={Object.entries(categories).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Responsable du traitement">
          <Select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} options={Object.entries(OWNER).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Probabilité">
          <Select value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} options={ECHELLE.map((n) => ({ value: String(n), label: `${n}, ${PROBABILITE[n]}` }))} />
        </Field>
        <Field label="Impact">
          <Select value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })} options={ECHELLE.map((n) => ({ value: String(n), label: `${n}, ${IMPACT[n]}` }))} />
        </Field>
        <Field label="Mesures d'atténuation" className="md:col-span-2">
          <Textarea className="min-h-[60px]" value={f.mitigation} onChange={(e) => setF({ ...f, mitigation: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-muted">
          Criticité : <b className="text-ink">{Number(f.probability) * Number(f.impact)}</b> ({RISK_LEVEL[niveau(Number(f.probability) * Number(f.impact))].label.toLowerCase()})
        </span>
        <Button variant="primary" disabled={!f.name.trim()} onClick={() => onCreate({ ...f, probability: Number(f.probability), impact: Number(f.impact) }).then(() => setF(vierge))}>
          <Plus className="h-4 w-4" /> Enregistrer
        </Button>
      </div>
    </Card>
  );
}

/** Fiche d'un risque : modifiable par le cabinet, figée (champs lisibles, sans commande) pour les autres profils. */
function EditionRisque({ r, categories, agir, ecriture }: { r: Risk; categories: Record<string, string>; agir: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; ecriture: boolean }) {
  const [f, setF] = useState({
    description: r.description ?? "",
    mitigation: r.mitigation ?? "",
    probability: String(r.probability),
    impact: String(r.impact),
    residual_probability: String(r.residual_probability ?? ""),
    residual_impact: String(r.residual_impact ?? ""),
    category: r.category,
    owner: r.owner,
  });
  const choix = (vide: boolean, libelles: string[]) => [...(vide ? [{ value: "", label: "Non évalué" }] : []), ...ECHELLE.map((n) => ({ value: String(n), label: `${n}, ${libelles[n]}` }))];
  return (
    <div className="mt-3 rounded-xl bg-panel-2 p-3.5">
      <fieldset disabled={!ecriture} className="min-w-0">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Catégorie"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={Object.entries(categories).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Responsable"><Select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value as Risk["owner"] })} options={Object.entries(OWNER).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Probabilité"><Select value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} options={choix(false, PROBABILITE)} /></Field>
          <Field label="Impact"><Select value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })} options={choix(false, IMPACT)} /></Field>
          <Field label="Description et causes" className="md:col-span-2"><Textarea className="min-h-[60px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Mesures d'atténuation" className="md:col-span-2"><Textarea className="min-h-[60px]" value={f.mitigation} onChange={(e) => setF({ ...f, mitigation: e.target.value })} /></Field>
          <Field label="Probabilité après traitement"><Select value={f.residual_probability} onChange={(e) => setF({ ...f, residual_probability: e.target.value })} options={choix(true, PROBABILITE)} /></Field>
          <Field label="Impact après traitement"><Select value={f.residual_impact} onChange={(e) => setF({ ...f, residual_impact: e.target.value })} options={choix(true, IMPACT)} /></Field>
        </div>
      </fieldset>
      {ecriture && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="danger" onClick={async () => (await demanderConfirmation(`Supprimer le risque « ${r.name} » ?`, { action: "Supprimer", danger: true })) && agir(() => apiSend("DELETE", `/axispro/risks/${r.id}`), "Risque supprimé.")}>
            <Trash2 className="h-4 w-4" /> Supprimer
          </Button>
          <Button onClick={() => agir(() => apiSend("POST", `/axispro/risks/${r.id}/action`), "Action de traitement ajoutée au plan d'actions.")} disabled={!r.mitigation}>
            <ListChecks className="h-4 w-4" /> Créer l&apos;action de traitement
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              agir(
                () =>
                  apiSend("PATCH", `/axispro/risks/${r.id}`, {
                    ...f,
                    probability: Number(f.probability),
                    impact: Number(f.impact),
                    residual_probability: f.residual_probability ? Number(f.residual_probability) : 0,
                    residual_impact: f.residual_impact ? Number(f.residual_impact) : 0,
                  }),
                "Risque mis à jour.",
              )
            }
          >
            Enregistrer
          </Button>
        </div>
      )}
    </div>
  );
}
