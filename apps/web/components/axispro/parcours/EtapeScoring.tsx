"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Etat, FEUILLE, Input, Select, classesBouton, cx } from "@/components/ui";
import { messageErreur, useCabinet } from "@/components/axispro/dossier/commun";
import { noterCritere, telechargerPiece, useCriteres, validerNonApplicable, type SaisieCritere } from "@/lib/axispro-api";
import { STATUTS, TYPE_EXIGENCE, numeroGate, prioriteDe } from "@/lib/axispro-parcours";
import { STATUS_LABELS, type CriterionEval, type DomainScore, type Status } from "@/lib/axispro-types";
import { fmtDate, fmtFixe, fmtInt } from "@/lib/format";
import { LienGarde, useDossier } from "./DossierParcours";

/** Score d'un domaine, arrondi à l'unité (section 7.2), « - » s'il n'est pas calculable. */
function scoreDomaine(s: number | null | undefined): string {
  return s === null || s === undefined ? "-" : fmtFixe(s, 0);
}

const TON_PRIORITE = { URGENTE: "danger", ÉLEVÉE: "warn", MOYENNE: "warn", FAIBLE: "ok" } as const;

/**
 * Étape 3, scoring (EC-07) : les critères domaine par domaine. Chaque statut s'enregistre dès le choix, les
 * autres champs à la sortie du champ, sans bouton ; le noyau renvoie tous les indicateurs recalculés, que
 * les onglets et la barre d'étapes reprennent aussitôt. Écriture : profil cabinet (PATCH
 * /axispro/evaluations/<id>), hors décision scellée et projet clos ; un compartiment confié à un autre
 * consultant reste en lecture. Les autres comptes lisent les valeurs en texte.
 */
export function EtapeScoring() {
  const { d } = useDossier();
  const { data, error, mutate } = useCriteres(d.id);
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des critères…">
      {(criteres: CriterionEval[]) => <Domaines criteres={criteres} relire={() => void mutate()} maj={(c) => void mutate((l) => l?.map((x) => (x.id === c.id ? { ...x, ...c } : x)), { revalidate: false })} />}
    </Etat>
  );
}

function Domaines({ criteres, maj, relire }: { criteres: CriterionEval[]; maj: (c: Partial<CriterionEval> & { id: number }) => void; relire: () => void }) {
  const { d } = useDossier();
  const domaines = d.scoring.domains;
  const [actif, setActif] = useState<number>(domaines[0]?.domain_id ?? 0);
  const titre = useRef<HTMLDivElement>(null);
  const rang = Math.max(0, domaines.findIndex((x) => x.domain_id === actif));
  const domaine = domaines[rang];
  const lignes = useMemo(() => criteres.filter((c) => c.domain_id === domaine?.domain_id), [criteres, domaine?.domain_id]);
  const suivant = domaines[rang + 1];
  const precedent = domaines[rang - 1];
  function aller(x: DomainScore) {
    setActif(x.domain_id);
    titre.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (!domaine) return <p className="text-sm text-muted">Aucun domaine dans la grille de ce dossier.</p>;
  const priorite = domaine.priority ?? prioriteDe(domaine.score);
  return (
    <div>
      <div role="tablist" aria-label="Domaines de la grille" className="mb-4 flex flex-wrap gap-2">
        {domaines.map((x) => (
          <button
            key={x.domain_id}
            type="button"
            role="tab"
            aria-selected={x.domain_id === domaine.domain_id}
            onClick={() => setActif(x.domain_id)}
            className={cx("inline-flex min-h-[42px] items-center gap-2 rounded-full border px-4 text-[13.5px] font-medium transition-colors", x.domain_id === domaine.domain_id ? "border-accent bg-accent text-white" : "border-line bg-panel text-ink-2 hover:border-accent hover:text-accent")}
          >
            {x.name}
            <span className="font-mono text-[12px] font-semibold">{scoreDomaine(x.score)}</span>
          </button>
        ))}
      </div>
      <section ref={titre} className={cx(FEUILLE, "min-w-0 scroll-mt-4 p-4 sm:p-6")}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="font-display text-[17px] font-[620] text-ink">{domaine.name} · {fmtInt(lignes.length)} critères</h2>
          <Badge tone={priorite ? TON_PRIORITE[priorite] : "neutral"}>Score du domaine : {scoreDomaine(domaine.score)} / 100</Badge>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">Pour chaque pièce : existe-t-elle ? Est-elle signée, datée et à jour ? Est-elle cohérente avec le reste du dossier ? Les modifications sont enregistrées dès la saisie.</p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[1040px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-left text-[12.5px] font-semibold text-muted">
                <th scope="col" className="px-3 py-2.5 font-semibold">Critère / pièce</th>
                <th scope="col" className="w-[190px] px-3 py-2.5 font-semibold">Statut</th>
                <th scope="col" className="w-[150px] px-3 py-2.5 font-semibold">Responsable</th>
                <th scope="col" className="w-[150px] px-3 py-2.5 font-semibold">Échéance</th>
                <th scope="col" className="w-[210px] px-3 py-2.5 font-semibold">Observation</th>
                <th scope="col" className="w-[120px] px-3 py-2.5 font-semibold">Pièce</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((c) => <LigneCritere key={c.id} c={c} maj={maj} relire={relire} />)}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-[13px] text-muted">{fmtInt(d.scoring.assessed)} critères sur {fmtInt(d.scoring.criteria)} notés pour ce projet. Un critère non noté compte comme « Non disponible ».</p>
          <div className="flex flex-wrap items-center gap-2">
            {precedent && <Button onClick={() => aller(precedent)}>Domaine précédent</Button>}
            {suivant ? (
              <Button variant="primary" className="whitespace-normal" onClick={() => aller(suivant)}>Domaine suivant : {suivant.name}</Button>
            ) : (
              <LienGarde href={`/axispro/dossiers/${d.id}/resultats`} className={classesBouton("primary")}>Voir les résultats</LienGarde>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Étiquette d'un critère : type d'exigence, poids, gate cible, « Critique », « Knock-out ». */
function Etiquette({ children, ton }: { children: React.ReactNode; ton?: "warn" | "danger" }) {
  return <span className={cx("rounded border px-1.5 py-px font-mono text-[11.5px]", ton === "warn" ? "border-warn text-warn" : ton === "danger" ? "border-danger text-danger" : "border-line text-muted")}>{children}</span>;
}

function LigneCritere({ c, maj, relire }: { c: CriterionEval; maj: (c: Partial<CriterionEval> & { id: number }) => void; relire: () => void }) {
  const { d, peutEcrire, majScoring } = useDossier();
  const { moi } = useCabinet();
  const ecrire = peutEcrire && c.editable_by_me;
  const [statut, setStatut] = useState<Status>(c.status);
  const [observation, setObservation] = useState(c.comment ?? "");
  const [responsable, setResponsable] = useState(c.responsible ?? "");
  const [echeance, setEcheance] = useState(c.due_date ?? "");
  // Statut choisi qui attend son observation (RG-07-02) : rien n'est enregistré sans elle.
  const [enAttente, setEnAttente] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const champObservation = useRef<HTMLDivElement>(null);
  // Enregistrements d'un même critère l'un après l'autre : deux modifications rapides arrivent dans l'ordre.
  const fileAttente = useRef<Promise<unknown>>(Promise.resolve());

  // Valeurs relues du noyau : la ligne les suit tant qu'aucun champ n'attend son enregistrement.
  useEffect(() => {
    if (enAttente) return;
    setStatut(c.status);
    setObservation(c.comment ?? "");
    setResponsable(c.responsible ?? "");
    setEcheance(c.due_date ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.status, c.comment, c.responsible, c.due_date]);

  function enregistrer(valeurs: SaisieCritere, repli: () => void) {
    setRefus(null);
    const appel = fileAttente.current.then(() => noterCritere(c.id, valeurs));
    fileAttente.current = appel.catch(() => undefined);
    void appel.then(
      (r) => {
        majScoring(r.scoring);
        maj({ id: c.id, ...(valeurs as Partial<CriterionEval>) });
        // « Non applicable » choisi ou retiré : le noyau dit s'il attend sa validation (RG-07-03).
        if (valeurs.status && (valeurs.status === "na" || c.status === "na")) relire();
      },
      (e: unknown) => {
        repli();
        setRefus(messageErreur(e, "Enregistrement impossible."));
      },
    );
  }

  function changerStatut(v: Status) {
    setStatut(v);
    if ((v === "partial" || v === "na") && !observation.trim()) {
      setEnAttente(true);
      setRefus("Justification obligatoire");
      champObservation.current?.querySelector("input")?.focus();
      return;
    }
    setEnAttente(false);
    // Statut et observation partent ensemble : le noyau refuse un « Incomplet » sans elle (RG-07-02).
    enregistrer({ status: v, comment: observation.trim() || null }, () => setStatut(c.status));
  }

  function quitterObservation() {
    const texte = observation.trim();
    if (enAttente) {
      if (!texte) return;
      setEnAttente(false);
      enregistrer({ status: statut, comment: texte }, () => {
        setStatut(c.status);
        setObservation(c.comment ?? "");
      });
      return;
    }
    if (texte === (c.comment ?? "")) return;
    if (!texte && (statut === "partial" || statut === "na")) {
      setObservation(c.comment ?? "");
      setRefus("Justification obligatoire");
      return;
    }
    enregistrer({ comment: texte || null }, () => setObservation(c.comment ?? ""));
  }

  async function validerNa() {
    try {
      const r = await validerNonApplicable(c.id);
      majScoring(r.scoring);
      maj({ ...r.evaluation, id: c.id });
    } catch (e) {
      setRefus(messageErreur(e, "Validation impossible."));
    }
  }

  const gate = numeroGate({ code: c.gate }, d.gates);
  return (
    <tr className="border-b border-line/80 align-top last:border-0">
      <td className="px-3 py-3">
        <div className="font-semibold leading-snug text-ink">{c.name}</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Etiquette>{TYPE_EXIGENCE[c.requirement] ?? c.requirement}</Etiquette>
          <Etiquette>Poids {c.weight}</Etiquette>
          <Etiquette>Gate {gate}</Etiquette>
          {c.critical && <Etiquette ton="warn">Critique</Etiquette>}
          {c.knockout && <Etiquette ton="danger">Knock-out</Etiquette>}
        </div>
        {!c.editable_by_me && peutEcrire && <p className="mt-1.5 text-[12px] text-muted">Compartiment confié à {c.owner ?? "un autre consultant"}.</p>}
      </td>
      <td className="px-3 py-3">
        {ecrire ? (
          <Select aria-label={`Statut de ${c.name}`} value={statut === "not_assessed" ? "" : statut} placeholder="Non noté" options={STATUTS} onChange={(e) => e.target.value && changerStatut(e.target.value as Status)} />
        ) : (
          <span>{statut === "not_assessed" ? "Non noté" : STATUS_LABELS[statut]}</span>
        )}
        {c.na_pending && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="warn">En attente de validation</Badge>
            {moi?.associe && <Button size="sm" onClick={() => void validerNa()}>Valider</Button>}
          </div>
        )}
        {c.na_validated && c.na_validated_by && <div className="mt-1.5 text-[12px] text-muted">Validé par {c.na_validated_by}</div>}
      </td>
      <td className="px-3 py-3">
        {ecrire ? (
          <Input aria-label={`Responsable de ${c.name}`} placeholder="Promoteur…" value={responsable} onChange={(e) => setResponsable(e.target.value)} onBlur={() => responsable.trim() !== (c.responsible ?? "") && enregistrer({ responsible: responsable.trim() || null }, () => setResponsable(c.responsible ?? ""))} />
        ) : (
          <span>{c.responsible ?? "–"}</span>
        )}
      </td>
      <td className="px-3 py-3">
        {ecrire ? (
          <Input type="date" aria-label={`Échéance de ${c.name}`} value={echeance} onChange={(e) => setEcheance(e.target.value)} onBlur={() => echeance !== (c.due_date ?? "") && enregistrer({ due_date: echeance || null }, () => setEcheance(c.due_date ?? ""))} />
        ) : (
          <span className="whitespace-nowrap">{c.due_date ? fmtDate(c.due_date) : "–"}</span>
        )}
      </td>
      <td className="px-3 py-3">
        {ecrire ? (
          <div ref={champObservation}>
            <Input aria-label={`Observation sur ${c.name}`} aria-invalid={enAttente || undefined} placeholder={statut === "partial" || statut === "na" ? "Justification obligatoire" : undefined} value={observation} onChange={(e) => setObservation(e.target.value)} onBlur={quitterObservation} />
          </div>
        ) : (
          <span>{c.comment ?? "–"}</span>
        )}
        {refus && <div className="mt-1 text-[12px] font-medium text-danger" role="alert">{refus}</div>}
      </td>
      <td className="px-3 py-3 text-[12.5px]">
        {c.documents.length === 0 ? (
          <span className={c.reference ? undefined : "text-muted"}>{c.reference || "-"}</span>
        ) : (
          <ul className="space-y-1">
            {c.documents.map((p) => (
              <li key={p.id}>
                <button type="button" className="break-all text-left text-accent underline underline-offset-2" onClick={() => void telechargerPiece(p.id, p.name).catch((e: unknown) => setRefus(messageErreur(e)))}>{p.name}</button>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}
