"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui";
import { useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { enregistrerDecision, telechargerPv, useCriteres, useDecisions } from "@/lib/axispro-api";
import { ETAT_CONDITION, LIBELLE_DECISION, TON_DECISION, decisionsAnciennes, estV2, optionsDecision } from "@/lib/axispro-parcours";
import type { DecisionsDossier, GateDecision, KoActif, PassageGate } from "@/lib/axispro-types";
import { aujourdhui, fmtDate, fmtFixe } from "@/lib/format";
import { useDossier } from "./DossierParcours";

/**
 * Étape 6, comité et gates (EC-10). Dossier SC-01 V2 : le noyau dit qui peut décider et pourquoi un compte ne
 * le peut pas (droit, RG-00-01, dossier clos, dernier gate), et la décision est créée et scellée en une
 * action. Ancienne méthode : le procès-verbal passe par la revue du comité (cabinet) puis le passage du gate
 * (cabinet ou direction), donc au seul associé du cabinet.
 */
export function EtapeComite() {
  const { d } = useDossier();
  return estV2(d) ? <ComiteDuNoyau /> : <ComiteAncien />;
}

function ComiteDuNoyau() {
  const { d, relire } = useDossier();
  const { data, error, mutate } = useDecisions(d.id);
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement du comité…">
      {(x: DecisionsDossier) => (
        <Vue
          x={x}
          apres={() => {
            void mutate();
            relire();
          }}
        />
      )}
    </Etat>
  );
}

function ComiteAncien() {
  const { d, relire } = useDossier();
  const { cabinet, scelle } = useCabinet();
  const { data: criteres } = useCriteres(d.id);
  return <Vue x={decisionsAnciennes(d, criteres, scelle && cabinet)} apres={relire} />;
}

function Vue({ x, apres }: { x: DecisionsDossier; apres: () => void }) {
  const { d } = useDossier();
  const { cabinet, scelle } = useCabinet();
  const g = x.gate.index;
  // Au dernier gate, le noyau sert un passage sans gate visé : rien à décider.
  const passage = x.passage?.to === null ? null : x.passage;
  // Motif en clair pour qui agit dans le dossier ; un lecteur n'a pas de commande à regretter.
  const motif = !x.can_decide && x.refusal && (cabinet || scelle) ? <Notice tone="neutral">{x.refusal}</Notice> : null;
  return (
    <div className="space-y-4">
      <Card title="Frise des gates">
        <ol className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-4 min-[900px]:grid-cols-8">
          {x.gates.map((c) => (
            <li key={c.index} aria-current={c.index === g ? "step" : undefined} className={cx("min-h-[42px] min-w-0 rounded-xl border px-3 py-2.5", c.reached ? "border-accent bg-accent text-white" : c.index === passage?.to ? "border-accent ring-1 ring-accent" : "border-line")}>
              <div className={cx("font-mono text-[11.5px] uppercase", c.reached ? "text-white/85" : "text-muted")}>Gate {c.index}</div>
              <div className={cx("mt-0.5 text-[13.5px] font-semibold leading-snug", !c.reached && "text-ink")}>{c.name}</div>
            </li>
          ))}
        </ol>
      </Card>
      {passage ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <Conditions passage={passage} aLever={x.to_lift} gate={g} />
          {x.can_decide ? <ProcesVerbal key={`${g}-${x.decisions.length}`} passage={passage} gate={g} preselection={x.preselected} apres={apres} /> : motif}
        </div>
      ) : (
        motif
      )}
      <Card title="Décisions enregistrées" padded={false}>
        <DataTable
          dense
          rows={x.decisions}
          rowKey={(l) => l.id}
          empty="Aucune décision enregistrée."
          columns={[
            { key: "date", label: "Date", render: (l) => <span className="whitespace-nowrap">{fmtDate(l.date)}</span> },
            { key: "gate", label: "Gate examiné", render: (l) => <span className="whitespace-nowrap">{l.gate.replace("->", "→")}</span> },
            { key: "decision", label: "Décision", render: (l) => <Badge tone={TON_DECISION[l.decision]}>{l.decision_label ?? LIBELLE_DECISION[l.decision]}</Badge> },
            { key: "readiness", label: "Readiness", align: "right", render: (l) => (l.readiness === null ? "–" : fmtFixe(l.readiness, 1)) },
            { key: "members", label: "Membres", render: (l) => l.members ?? "–" },
            { key: "motive", label: "Motif / conditions", render: (l) => <div className="min-w-[220px]">{l.motive || l.conditions || "–"}</div> },
            { key: "pv", label: "Procès-verbal", render: (l) => (l.pv ? <Button onClick={() => void telechargerPv(l.pv!, d.reference, l.date)}>PDF</Button> : <span className="text-muted">–</span>) },
          ]}
        />
      </Card>
    </div>
  );
}

function Conditions({ passage, aLever, gate }: { passage: PassageGate; aLever: KoActif[]; gate: number }) {
  return (
    <Card title={`Conditions de passage au Gate ${passage.to}`}>
      <ul className="space-y-1">
        {passage.conditions.map((c) => (
          <li key={c.key} className="flex min-h-[36px] items-center justify-between gap-3 text-[14px] text-ink-2">
            <span className="min-w-0">{c.label}</span>
            <Badge tone={ETAT_CONDITION[c.state].ton}>{c.state_label ?? ETAT_CONDITION[c.state].label}</Badge>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-3">
        {aLever.length > 0 && (
          <Notice tone="danger">
            <b>Knock-out à lever :</b> {aLever.map((k) => k.name).join(" ; ")}.
          </Notice>
        )}
        <Notice tone={passage.favorable ? "ok" : "warn"}>
          <b>Recommandation de l&apos;outil :</b> {passage.favorable ? `passage au Gate ${passage.to} possible.` : `maintien au Gate ${gate}.`}
        </Notice>
      </div>
    </Card>
  );
}

function ProcesVerbal({ passage, gate, preselection, apres }: { passage: PassageGate; gate: number; preselection: "go" | "hold"; apres: () => void }) {
  const { d } = useDossier();
  const { envoyer, enCours, occupe, bandeau, setRetour } = useRetour();
  // HOLD présélectionné si les conditions ne sont pas remplies.
  const [decision, setDecision] = useState<GateDecision>(preselection);
  const [date, setDate] = useState(aujourdhui());
  const [membres, setMembres] = useState("");
  const [motif, setMotif] = useState("");
  // Décision contraire à la recommandation : passage alors qu'il faut maintenir, maintien alors qu'il est possible.
  const passe = decision === "go" || decision === "conditional";
  const contraire = passage.favorable ? !passe : passe;
  async function enregistrer() {
    const texte = motif.trim();
    if (contraire && !texte) {
      setRetour({ tone: "danger", text: "Décision contraire à la recommandation : saisissez le motif." });
      return;
    }
    const ok = await envoyer(async () => {
      await enregistrerDecision(d, { decision, date, members: membres.trim(), motive: texte, conditions: decision === "conditional" ? texte : "", from_gate: gate }, contraire);
      return true;
    }, undefined, "decision");
    if (ok) apres();
  }
  return (
    <Card title="Procès-verbal de décision">
      <fieldset disabled={occupe} className="min-w-0 space-y-3">
        <Field label="Décision du comité">
          <Select value={decision} onChange={(e) => setDecision(e.target.value as GateDecision)} options={optionsDecision(gate)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date de séance"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Membres présents"><Input value={membres} onChange={(e) => setMembres(e.target.value)} /></Field>
        </div>
        <Field label="Motif, conditions et délai de réexamen">
          <Textarea rows={3} value={motif} placeholder="Motif obligatoire si la décision s'écarte de la recommandation" onChange={(e) => setMotif(e.target.value)} />
        </Field>
      </fieldset>
      {bandeau && <div className="mt-3">{bandeau}</div>}
      <Button variant="primary" className="mt-3 w-full justify-start" loading={enCours === "decision"} disabled={!date} onClick={() => void enregistrer()}>Enregistrer la décision</Button>
      <p className="mt-3 text-[12.5px] leading-snug text-muted">GO et CONDITIONAL GO font passer le projet au Gate {passage.to}. HOLD le maintient. NO-GO le clôt sans le supprimer.</p>
    </Card>
  );
}
