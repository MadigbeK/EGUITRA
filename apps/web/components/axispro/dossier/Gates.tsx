"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, FileCheck2, Flag, ShieldAlert } from "@/components/icons";
import { Badge, Button, Card, FEUILLE, Field, Modal, Notice, Textarea, cx } from "@/components/ui";
import { ApiError, apiSend } from "@/lib/api-client";
import { pluriel } from "@/lib/format";
import { GATE_DECISION, HYPOTHESES, YES_NO, type DossierDetail } from "@/lib/axispro-types";
import { RULE_LABELS, arrondi, useRetour } from "./commun";

/**
 * Stage gates : règle de passage, décision calculée et motifs, exigences d'entrée, livrables et
 * critères de passage de chacun des huit gates. Le passage au gate suivant suit la décision du gate
 * courant ; un passage contre la règle exige un motif, inscrit au journal du dossier.
 */
export function Gates({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const { agir, bandeau, setRetour } = useRetour();
  const [force, setForce] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  const gates = d.scoring.gates;
  const courant = gates.findIndex((g) => g.code === d.current_gate?.code);
  const dernier = courant >= gates.length - 1;

  async function passer(reason?: string) {
    setRetour(null);
    try {
      await apiSend("POST", `/axispro/dossiers/${d.id}/advance-gate`, reason ? { force_reason: reason } : {});
      setRetour({ tone: "ok", text: reason ? "Passage forcé enregistré au journal du dossier." : "Le dossier passe au gate suivant." });
      setForce(null);
      setMotif("");
      onChanged();
    } catch (e) {
      const text = e instanceof ApiError ? e.message : "Passage impossible.";
      if (!reason && e instanceof ApiError && e.status === 422 && !d.locked) setForce(text);
      else setRetour({ tone: "danger", text });
    }
  }

  return (
    <div className="space-y-4">
      {bandeau}
      <Card
        title="Parcours du dossier"
        actions={
          !dernier && (
            <Button variant="primary" disabled={d.locked} onClick={() => passer()}>
              Passer au gate suivant <ArrowRight className="h-4 w-4" />
            </Button>
          )
        }
      >
        <ol className="flex flex-wrap gap-2">
          {gates.map((g, i) => (
            <li key={g.code} className={cx("flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-semibold", i < courant ? "border-jade/40 bg-ok-doux/60 text-ok-texte" : i === courant ? "bg-accent border-transparent text-white" : "border-line text-muted")}>
              {i < courant ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Flag className="h-3.5 w-3.5" />}
              {g.code} {g.name}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12.5px] text-muted">
          Un knock-out actif dans le périmètre d&apos;un gate impose NO-GO quel que soit le score ; sous la complétude documentaire minimale d&apos;un gate, un GO ou un CONDITIONAL GO est ramené à HOLD. Les hypothèses de décision des gates 4 à 7 (DSCR, red flag, data room, bailleurs, conditions précédentes, signature) se renseignent dans la synthèse.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {gates.map((g, i) => {
          const dec = GATE_DECISION[g.decision];
          const hyp = HYPOTHESES.filter((h) => h.gate === g.code);
          return (
            <section key={g.code} className={cx(FEUILLE, "p-4", i === courant && "ring-2 ring-accent/40")}>
              <header className="flex flex-wrap items-center gap-2">
                <span className="bg-accent grid h-8 min-w-8 place-items-center rounded-full px-2 text-[12.5px] font-bold text-white">{g.code}</span>
                <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{g.name}</h3>
                {i < courant && <Badge tone="ok">Franchi</Badge>}
                {i === courant && <Badge tone="accent" vivant>Gate courant</Badge>}
                <Badge tone={dec.tone}>{dec.label}</Badge>
              </header>
              <div className="mt-1 text-[12px] text-muted">{RULE_LABELS[g.rule] ?? g.rule}</div>
              <ul className="mt-2.5 space-y-1 text-[13px]">
                {g.motifs.map((m, k) => (
                  <li key={k} className={cx("flex gap-2", g.decision === "no_go" ? "text-danger" : g.decision === "go" ? "text-ink-2" : "text-warn")}>
                    {g.decision === "no_go" ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-none" /> : <span aria-hidden className="mt-2 h-1 w-1 flex-none rounded-full bg-current" />}
                    {m}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-muted">
                {g.min_completeness ? (
                  <span title="Exigence d'entrée : en dessous, le gate ne s'examine pas (HOLD)" className="inline-flex items-center gap-1 rounded-md bg-panel-3 px-1.5 py-0.5 font-semibold text-ink-2">
                    <FileCheck2 aria-hidden className="h-3.5 w-3.5 text-muted" /> Complétude minimale {arrondi(g.min_completeness)} %
                  </span>
                ) : null}
                <span>{g.available}/{g.criteria} {g.available > 1 ? "critères disponibles" : "critère disponible"}</span>
                {g.knockouts > 0 && <span className="font-semibold text-danger">{pluriel(g.knockouts, "knock-out")} du gate</span>}
                {hyp.map((h) => (
                  <span key={h.key}>
                    {h.label} : <b className="text-ink-2">{d.decision_inputs[h.key] ? YES_NO[d.decision_inputs[h.key] as string] : "non renseigné"}</b>
                  </span>
                ))}
                {g.rule === "bankability" && <span>DSCR : <b className="text-ink-2">{d.financial?.dscr_min ?? d.decision_inputs.dscr_manual ?? "non renseigné"}</b> (seuil {d.scoring.thresholds.dscr})</span>}
              </div>
              {(g.entry_requirements || g.deliverables || g.exit_criteria) && (
                <dl className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 text-[12.5px] sm:grid-cols-3">
                  {g.entry_requirements && <div><dt className="font-semibold text-ink-2">Exigences d&apos;entrée</dt><dd className="mt-0.5 text-muted">{g.entry_requirements}</dd></div>}
                  {g.deliverables && <div><dt className="font-semibold text-ink-2">Livrables attendus</dt><dd className="mt-0.5 text-muted">{g.deliverables}</dd></div>}
                  {g.exit_criteria && <div><dt className="font-semibold text-ink-2">Critères de passage</dt><dd className="mt-0.5 text-muted">{g.exit_criteria}</dd></div>}
                </dl>
              )}
            </section>
          );
        })}
      </div>

      {force !== null && (
        <Modal
          open
          title="Passage contre la règle du gate"
          onClose={() => setForce(null)}
          footer={
            <Button variant="danger" disabled={motif.trim().length < 10} onClick={() => agir(() => passer(motif.trim()))}>
              Forcer le passage
            </Button>
          }
        >
          <div className="space-y-3 text-sm">
            <Notice tone="warn">{force}</Notice>
            <p className="text-muted">Le cabinet peut décider de passer outre : le motif, son auteur et la décision calculée sont inscrits au journal du dossier et figurent dans le rapport.</p>
            <Field label="Motif du passage forcé (10 caractères au moins)">
              <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Décision du comité, pièce attendue à brève échéance…" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
