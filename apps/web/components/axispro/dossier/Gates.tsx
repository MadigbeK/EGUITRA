"use client";

import { useRef, useState } from "react";
import { ArrowRight, CheckCircle2, FileCheck2, Flag, ListChecks, ShieldAlert } from "@/components/icons";
import { Badge, Button, Card, FEUILLE, Field, Modal, Notice, Textarea, cx } from "@/components/ui";
import { ApiError, apiSend, messageErreur } from "@/lib/api-client";
import { tonEtat } from "@/lib/couleurs";
import { fmtInt, fmtPct, fmtRatio, pluriel } from "@/lib/format";
import { GATE_DECISION, HYPOTHESES, YES_NO, type DossierDetail } from "@/lib/axispro-types";
import { RULE_LABELS, useCabinet, useRetour } from "./commun";

/**
 * Stage gates : règle de passage, décision calculée et motifs, exigences d'entrée, livrables et
 * critères de passage de chacun des huit gates. Le passage au gate suivant suit la décision du gate
 * courant ; un passage contre la règle exige un motif, inscrit au journal du dossier.
 */
export function Gates({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const { bandeau, setRetour } = useRetour();
  // Passage de gate selon la règle : profil cabinet ; passage forcé : associé du cabinet ou direction
  // (POST /axispro/dossiers/<id>/advance-gate avec force_reason, décision du gérant du 22 octobre 2026),
  // toujours à deux personnes au moins.
  const { cabinet, scelle } = useCabinet();
  const [force, setForce] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  // Refus d'un passage forcé (quatre yeux : 403 « une décision du comité engage au moins deux
  // personnes… ») : affiché dans la fenêtre, restée ouverte, et non derrière elle.
  const [refusForce, setRefusForce] = useState<string | null>(null);
  const gates = d.scoring.gates;
  const courant = gates.findIndex((g) => g.code === d.current_gate?.code);
  const dernier = courant >= gates.length - 1;
  // Gate courant que sa règle ne laisse pas franchir : seul un passage forcé le permet.
  const gateCourant = courant >= 0 ? gates[courant] : undefined;
  const bloque = Boolean(gateCourant && gateCourant.decision !== "go" && gateCourant.decision !== "conditional");
  // DSCR retenu par la règle de bancabilité : modèle financier, à défaut celui déclaré dans la fiche.
  const dscr = d.financial?.dscr_min ?? d.decision_inputs.dscr_manual ?? null;
  const { no_go: nogo, go, conditional, hold } = GATE_DECISION;

  // Un seul envoi à la fois (double clic, réseau lent) ; le gate de départ part avec la demande : s'il
  // n'est plus le gate courant, le noyau refuse (409) au lieu de faire franchir un second gate.
  const envoi = useRef(false);
  const [enCours, setEnCours] = useState<"passer" | "forcer" | null>(null);

  async function passer(reason?: string) {
    if (envoi.current) return;
    envoi.current = true;
    setEnCours(reason ? "forcer" : "passer");
    setRetour(null);
    setRefusForce(null);
    try {
      await apiSend("POST", `/axispro/dossiers/${d.id}/advance-gate`, { from_gate: d.current_gate?.code ?? "", ...(reason ? { force_reason: reason } : {}) });
      setRetour({ tone: "ok", text: reason ? "Passage forcé enregistré au journal du dossier." : "Le dossier passe au gate suivant." });
      setForce(null);
      setMotif("");
      onChanged();
    } catch (e) {
      const text = messageErreur(e, "Passage impossible.");
      if (e instanceof ApiError && e.status === 409) {
        // Le dossier a déjà changé de gate (second clic, autre onglet) : on le relit.
        setForce(null);
        setRetour({ tone: "warn", text });
        onChanged();
      } else if (reason) setRefusForce(text);
      else if (e instanceof ApiError && e.status === 422 && !d.locked && scelle) setForce(text);
      else if (e instanceof ApiError && e.status === 422 && !d.locked) setRetour({ tone: "warn", text: `${text} Seul un associé du cabinet ou la direction peut forcer ce passage, motif à l'appui.` });
      else setRetour({ tone: "danger", text });
    } finally {
      envoi.current = false;
      setEnCours(null);
    }
  }
  function fermerForce() {
    // Pendant l'envoi, la fenêtre reste ouverte : la réponse (ou le refus) s'y affiche.
    if (envoi.current) return;
    setForce(null);
    setRefusForce(null);
  }

  return (
    <div className="space-y-4">
      {bandeau}
      <Card
        title="Parcours du dossier"
        actions={
          !dernier && cabinet ? (
            <Button variant="primary" loading={enCours === "passer"} disabled={d.locked || d.state === "closed" || enCours !== null} onClick={() => void passer()}>
              Passer au gate suivant <ArrowRight className="h-4 w-4" />
            </Button>
          ) : !dernier && scelle && bloque ? (
            // Direction sans profil cabinet : elle ne fait que forcer un passage que la règle refuse.
            <Button variant="danger" disabled={d.locked || d.state === "closed" || enCours !== null} onClick={() => setForce(`Gate ${gateCourant?.code} : ${GATE_DECISION[gateCourant!.decision].label}. ${gateCourant!.motifs.join(" ")}`)}>
              Forcer le passage <ArrowRight className="h-4 w-4" />
            </Button>
          ) : undefined
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
          Un knock-out actif dans le périmètre d&apos;un gate impose {nogo.label} quel que soit le score ; sous la complétude documentaire minimale d&apos;un gate, un {go.label} ou un {conditional.label} est ramené à {hold.label}. Les hypothèses de décision des gates 4 à 7 (DSCR, red flag, data room, bailleurs, conditions précédentes, signature) se renseignent dans la synthèse.
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
                {i < courant && <Badge tone={tonEtat("Franchi", "ok")}>Franchi</Badge>}
                {/* Le seul état vivant de l'écran ; la couleur de l'application ne dit pas un état. */}
                {i === courant && (
                  <Badge tone={tonEtat("En cours")} vivant>
                    Gate courant
                  </Badge>
                )}
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
                    <FileCheck2 aria-hidden className="h-3.5 w-3.5 text-muted" /> Complétude minimale {fmtPct(g.min_completeness, 0)}
                  </span>
                ) : null}
                <span>
                  {pluriel(g.available, "critère disponible", "critères disponibles")} sur {fmtInt(g.criteria)}
                </span>
                {/* Critères du gate encore à évaluer (compte du noyau ; absent d'une réponse antérieure). */}
                {(g.pending ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
                    <ListChecks aria-hidden className="h-3.5 w-3.5 text-muted" /> {pluriel(g.pending ?? 0, "critère à évaluer", "critères à évaluer")}
                  </span>
                )}
                {g.knockouts > 0 && <span className="font-semibold text-danger">{pluriel(g.knockouts, "knock-out")} du gate</span>}
                {hyp.map((h) => (
                  <span key={h.key}>
                    {h.label} : <b className="text-ink-2">{d.decision_inputs[h.key] ? YES_NO[d.decision_inputs[h.key] as string] : "non renseigné"}</b>
                  </span>
                ))}
                {g.rule === "bankability" && (
                  <span>
                    DSCR : <b className="text-ink-2">{dscr === null ? "non renseigné" : fmtRatio(dscr)}</b> (seuil {fmtRatio(d.scoring.thresholds.dscr)})
                  </span>
                )}
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
          onClose={fermerForce}
          footer={
            <>
              <Button disabled={enCours !== null} onClick={fermerForce}>Annuler</Button>
              <Button variant="danger" loading={enCours === "forcer"} disabled={motif.trim().length < 10 || enCours !== null} onClick={() => void passer(motif.trim())}>
                Forcer le passage
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {refusForce && <Notice tone="danger">{refusForce}</Notice>}
            <Notice tone="warn">{force}</Notice>
            <p className="text-muted">Le cabinet peut décider de passer outre : le motif, son auteur et la décision calculée sont inscrits au journal du dossier et figurent dans le rapport.</p>
            <Field label="Motif du passage forcé (10 caractères au moins)">
              <Textarea value={motif} disabled={enCours !== null} onChange={(e) => setMotif(e.target.value)} placeholder="Décision du comité, pièce attendue à brève échéance…" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
