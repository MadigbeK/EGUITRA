"use client";

import { useId, useState, type CSSProperties } from "react";
import { useSWRConfig } from "swr";
import { AlertTriangle, Coins, FileCheck2, ListChecks, Pencil, Percent, Scale, ShieldAlert, Target, TrendingUp } from "@/components/icons";
import { Anneau, Badge, Button, Card, Field, Input, Kpi, Notice, PasswordInput, Select, Tag, Textarea, cx } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { tonEtat } from "@/lib/couleurs";
import { GATE_DECISION, HYPOTHESES, RECO, RISK_LEVEL, STATUS_LABELS, type CompartmentScore, type CriterionBrief, type Currency, type DomainScore, type DossierDetail, type RiskLevel, type UserRef } from "@/lib/axispro-types";
import { fmtDate, fmtInt, fmtPct, fmtRatio, fmtShort, pluriel } from "@/lib/format";
import { annees, ratio } from "@/components/axispro/cellules";
import { PRIORITE_TON, PuceCompartiment, arrondi, couleurScore, montant, note, useCabinet, useRetour } from "./commun";

/** Priorité d'un domaine en toutes lettres, avec son mot ; rien pour une priorité faible. */
const PRIORITE_MOT: Partial<Record<NonNullable<DomainScore["priority"]>, string>> = {
  URGENTE: "Urgente",
  ÉLEVÉE: "Élevée",
  MOYENNE: "Moyenne",
};

/** « Où en est le dossier » : trois scores, classification, recommandation, ce qui bloque le
 * prochain gate et les cinq actions prioritaires, puis anomalies, domaines, fiche projet et
 * hypothèses de décision. */
export function Synthese({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const s = d.scoring;
  const { agir, bandeau } = useRetour();
  const [portal, setPortal] = useState({ login: "", name: "", password: "" });
  // Ouvrir l'accès du porteur : profil cabinet seul (POST /axispro/dossiers/<id>/portal-access).
  const { cabinet } = useCabinet();
  const t = s.thresholds;
  const scores = [
    { titre: "Project Readiness", valeur: s.readiness, aide: "Toute la grille" },
    { titre: "APD Readiness", valeur: s.apd, aide: "Hors exigences de due diligence et de closing" },
    { titre: "Bankability", valeur: s.bankability, aide: "Critères pertinents pour la bancabilité" },
  ];
  const next = s.next_gate;
  // Scores provisoires : la méthode recommande « À compléter » (critères des gates atteints encore à
  // évaluer). Les anneaux restent, dans la couleur de l'application, celle d'une mesure sans verdict,
  // au lieu de la couleur de leur classe ; le tampon neutre et l'avancement disent le provisoire.
  const provisoire = s.recommendation === "pending" && s.assessed > 0;
  // Le motif « à compléter » du noyau s'écrit « critère(s) » : même phrase, accordée ici.
  const detail = provisoire && s.pending_in_scope > 0 ? `${pluriel(s.pending_in_scope, "critère des gates atteints reste", "critères des gates atteints restent")} à évaluer avant la recommandation.` : s.recommendation_detail;
  return (
    <div className="space-y-6">
      {bandeau}
      <Card title="Où en est le dossier">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
          <div>
            <div className="flex flex-wrap justify-center gap-5">
              {scores.map((x) => (
                <div key={x.titre} className="flex flex-col items-center text-center">
                  <Anneau value={s.assessed ? note(x.valeur) : null} taille={112} epaisseur={10} couleur={provisoire ? "var(--accent-vif)" : couleurScore(x.valeur)} sous="/ 100" />
                  <div className="mt-1.5 text-[13px] font-semibold text-ink">{x.titre}</div>
                  <div className="max-w-[140px] text-[11.5px] text-muted">{x.aide}</div>
                </div>
              ))}
            </div>
            {provisoire && (
              <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[12.5px] text-muted">
                <Badge tone="neutral">Scores provisoires</Badge>
                <span>
                  {pluriel(s.assessed, "critère évalué", "critères évalués")} sur {fmtInt(s.criteria)}
                </span>
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-3">
            {/* La recommandation vaut pour l'étape où se trouve le dossier ; le prochain gate a sa propre décision, juste dessous. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-ink">Recommandation{d.current_gate ? ` à l'étape ${d.current_gate.code}` : ""} :</span>
              <Badge tone={RECO[s.recommendation].tone}>{RECO[s.recommendation].label}</Badge>
              <span className="text-[12.5px] font-semibold text-muted">{s.classification}</span>
            </div>
            <p className="text-[14px] text-ink-2">{detail}</p>
            {s.recommendation === "pending" && s.method_recommendation !== "pending" && s.assessed > 0 && (
              <p className="text-[12.5px] text-muted">Si l&apos;évaluation s&apos;arrêtait là, la méthode recommanderait : <b>{RECO[s.method_recommendation].label}</b>.</p>
            )}
            {next ? <Blocages d={d} /> : <Notice tone="ok">Tous les gates sont franchis : financial close effectif.</Notice>}
            <p className="text-[12px] text-muted">
              Seuils : {RECO.bankable.label} {arrondi(t.bankable)}, {RECO.apd_ready.label} {arrondi(t.go)}, {RECO.conditional.label} {arrondi(t.conditional)}, {RECO.hold.label} {arrondi(t.hold)} ; DSCR bancaire {fmtRatio(t.dscr)}. Pondération {s.policy.weighting === "flat" ? "à plat sur toute la grille" : "par domaine"}.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Knock-outs actifs" value={String(s.knockouts.length)} tone={s.knockouts.length ? "danger" : "ok"} hint={s.knockouts.length ? `${s.knockouts.map((k) => k.code).join(", ")}${s.knockouts_pending ? ` (dont ${pluriel(s.knockouts_pending, "non évalué", "non évalués")})` : ""}` : "Aucun"} />
        <Kpi label="Critiques manquants hors KO" value={String(s.critical_missing_excl_ko)} tone={s.critical_missing_excl_ko ? "warn" : "ok"} hint={`${pluriel(s.critical_open.length, "critique")} au total`} />
        <Kpi label="Complétude documentaire" value={fmtPct(s.completeness, 0)} hint={`${pluriel(s.assessed, "critère évalué", "critères évalués")} sur ${fmtInt(s.criteria)}, ${pluriel(s.proofs, "preuve")}`} />
        <Kpi label="Complétude de la data room" value={fmtPct(s.dataroom_completeness, 0)} hint={pluriel(s.documents_missing, "pièce non disponible", "pièces non disponibles")} />
      </div>

      <SuiviCompartiments d={d} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Les actions prioritaires">
          {d.gaps.length === 0 ? <p className="text-sm text-muted">Aucun écart.</p> : (
            <ol className="space-y-2">
              {d.gaps.map((g, i) => (
                <li key={g.criterion_id} className={cx("rounded-xl border bg-panel px-3.5 py-3 text-sm", g.knockout ? "border-danger/30 bg-danger-doux/40" : "border-line")}>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="bg-accent grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-bold text-white">{i + 1}</span>
                    {g.compartment && <PuceCompartiment code={g.compartment} nom={g.compartment_name} />}
                    <span className="font-medium">{g.code} {g.name}</span>
                    {g.knockout && <Badge tone="danger">Knock-out</Badge>}
                    {g.critical && <Badge tone={tonEtat("Critique")}>Critique</Badge>}
                    <span className="ml-auto text-[11.5px] font-semibold text-muted">priorité {arrondi(g.priority, 2)}</span>
                  </div>
                  <div className="mt-1.5 pl-[34px] text-[12.5px] leading-snug text-ink-2">{g.action}</div>
                  <div className="mt-1 pl-[34px] text-[12px] text-muted">
                    {g.domain} · {g.gate} · {STATUS_LABELS[g.status]}
                    {g.responsible ? ` · ${g.responsible}` : ""}
                    {g.due_date ? ` · échéance ${fmtDate(g.due_date)}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Score par domaine">
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            <span>Du domaine le plus faible au plus fort. Priorité urgente sous 30, élevée sous 50, moyenne sous 65.</span>
          </div>
          <ul className="space-y-3">
            {domainesTries(s.domains).map(({ dom, score }, i) => {
              const mot = score !== null && dom.priority ? PRIORITE_MOT[dom.priority] : undefined;
              return (
                <li key={dom.domain_id}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate text-ink-2">
                      <span className="font-semibold text-ink">{dom.code}</span> {dom.name}{" "}
                      <span className="text-[12px] text-muted">{dom.assessed}/{dom.criteria} {dom.assessed > 1 ? "évalués" : "évalué"}{dom.gaps ? `, ${pluriel(dom.gaps, "écart")}` : ""}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {mot && dom.priority && <Badge tone={tonEtat(mot, PRIORITE_TON[dom.priority])}>Priorité {mot.toLocaleLowerCase("fr")}</Badge>}
                      <span className="w-8 text-right font-display text-[16px] font-bold tabular text-ink">{score === null ? "–" : Math.round(score)}</span>
                    </span>
                  </div>
                  <div className="relative h-2.5 rounded-full bg-panel-3">
                    <div className="n-pousser-x h-full rounded-full" style={{ width: `${Math.max(score ?? 0, 1)}%`, background: couleurScore(score), "--i": i } as CSSProperties} />
                    {[30, 50, 65].map((x) => <span key={x} aria-hidden className="absolute -top-0.5 h-3.5 w-px bg-line-strong" style={{ left: `${x}%` }} />)}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {(s.anomalies.length > 0 || s.requalified.length > 0) && (
        <Card title="Contrôles de cohérence">
          <ul className="space-y-1.5 text-[13px]">
            {s.anomalies.map((a, i) => (
              <li key={i} className="flex gap-2 text-warn"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" /> {a}</li>
            ))}
          </ul>
          {s.requalified.length > 0 && <p className="mt-2 text-[12.5px] text-muted">{pluriel(s.requalified.length, "critère requalifié", "critères requalifiés")} par la politique d&apos;évaluation, sans modification de la saisie.</p>}
        </Card>
      )}

      <Fiche d={d} onChanged={onChanged} />

      <Card title="Rentabilité, risques et plan d'actions">
        {d.financial ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Mesure icone={TrendingUp} titre="VAN du projet" valeur={fmtShort(d.financial.npv)} alerte={d.financial.npv < 0} />
            <Mesure icone={Percent} titre="TRI du projet" valeur={fmtPct(d.financial.irr_project)} detail={`Fonds propres ${fmtPct(d.financial.irr_equity)}`} />
            <Mesure icone={Scale} titre="DSCR minimal" valeur={ratio(d.financial.dscr_min)} detail={`Récupération : ${annees(d.financial.payback)}`} />
            <Mesure icone={Coins} titre="Apport des promoteurs" valeur={fmtPct(d.financial.equity_share, 0)} alerte={d.financial.cash_min < 0} detail={d.financial.cash_min < 0 ? "Trésorerie négative à un moment" : "Trésorerie toujours positive"} />
          </div>
        ) : (
          <p className="text-sm text-muted">Modèle financier non saisi : onglet « Modèle financier ». À défaut, le DSCR et le TRI déclarés de la fiche servent aux gates.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3 text-[13px]">
          <span className="inline-flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted" /> {pluriel(d.risks.open, "risque ouvert", "risques ouverts")}
            {(["critical", "high"] as RiskLevel[]).map((l) => d.risks.levels[l] > 0 && <Badge key={l} tone={tonEtat(RISK_LEVEL[l].label, RISK_LEVEL[l].tone === "accent" ? undefined : RISK_LEVEL[l].tone)}>{pluriel(d.risks.levels[l], RISK_LEVEL[l].label.toLocaleLowerCase("fr"))}</Badge>)}
          </span>
          <span className="inline-flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted" /> {pluriel(d.actions.open, "action ouverte", "actions ouvertes")}
            {d.actions.overdue > 0 && <Badge tone={tonEtat("En retard", "danger")}>{fmtInt(d.actions.overdue)} en retard</Badge>}
            {d.actions.submitted > 0 && <Badge tone={tonEtat("À valider")}>{fmtInt(d.actions.submitted)} à valider</Badge>}
          </span>
        </div>
      </Card>

      <Card title="Accès du porteur au portail">
        <p className={cx("text-sm text-muted", cabinet && "mb-3")}>{d.portal_users.length ? `Accès ouvert : ${d.portal_users.map((u) => `${u.name} (${u.login})`).join(", ")}.` : "Aucun accès ouvert."}</p>
        {cabinet && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Input placeholder="Identifiant" value={portal.login} onChange={(e) => setPortal({ ...portal, login: e.target.value })} />
            <Input placeholder="Nom du porteur" value={portal.name} onChange={(e) => setPortal({ ...portal, name: e.target.value })} />
            <PasswordInput autoComplete="new-password" placeholder="Mot de passe provisoire (10+)" value={portal.password} onChange={(e) => setPortal({ ...portal, password: e.target.value })} />
            <Button variant="primary" disabled={!portal.login || !portal.name || portal.password.length < 10} onClick={() => agir(() => apiSend("POST", `/axispro/dossiers/${d.id}/portal-access`, portal), "Accès au portail ouvert.").then((r) => { if (r !== undefined) { setPortal({ login: "", name: "", password: "" }); onChanged(); } })}>Ouvrir l&apos;accès</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Domaines du plus faible au plus fort, la grille départageant les égalités. Un domaine sans critère
 * évalué n'a pas encore de score (comme un compartiment) : il passe en fin de liste, sans priorité.
 */
function domainesTries(domaines: DomainScore[]) {
  return domaines
    .map((dom, rang) => ({ dom, rang, score: dom.assessed ? dom.score : null }))
    .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity) || a.rang - b.rang);
}

/** Critères cités dans une ligne : les trois premiers par leur code et leur nom, puis le reste compté. */
function citer(liste: CriterionBrief[]) {
  const vus = liste.slice(0, 3).map((c) => `${c.code} ${c.name}`);
  const reste = liste.length - vus.length;
  return reste > 0 ? `${vus.join(", ")} et ${pluriel(reste, "autre")}` : vus.join(", ");
}

/**
 * Ce qui bloque le prochain gate, tiré du dossier déjà chargé : la décision calculée du gate et ses
 * motifs (la méthode), les critères des gates atteints encore à évaluer, les critères du gate
 * disponibles, puis les knock-outs actifs et les critères critiques manquants jusqu'à ce gate.
 * L'écran ne décide rien : il rassemble ce que le noyau a déjà établi.
 */
function Blocages({ d }: { d: DossierDetail }) {
  const titre = useId();
  const s = d.scoring;
  const next = s.next_gate;
  if (!next) return null;
  const dec = GATE_DECISION[next.decision];
  // Rang de chaque gate dans la grille, pour ne citer que ce qui précède ou concerne ce gate.
  const rang = new Map(s.gates.map((g) => [g.code, g.index]));
  const jusquIci = (c: CriterionBrief) => (rang.get(c.gate ?? "") ?? 0) <= next.index;
  const ko = s.knockouts.filter(jusquIci);
  const codesKo = new Set(s.knockouts.map((k) => k.code));
  const critiques = s.critical_open.filter((c) => !codesKo.has(c.code) && jusquIci(c));
  const indisponibles = next.criteria - next.available;
  const releve = s.pending_in_scope > 0 || indisponibles > 0 || ko.length > 0 || critiques.length > 0;
  return (
    <section aria-labelledby={titre} className="rounded-xl border border-line bg-panel-2 px-3.5 py-3 text-[13px]">
      <h3 id={titre} className="text-[13.5px] font-semibold text-ink">
        {next.decision === "conditional" ? "Ce qui conditionne le prochain gate" : "Ce qui bloque le prochain gate"}
      </h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-2">
          {next.code} {next.name}
        </span>
        <Badge tone={dec.tone}>{dec.label}</Badge>
        {next.min_completeness ? <Tag>Complétude minimale {fmtPct(next.min_completeness, 0)}</Tag> : null}
      </div>
      {next.motifs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {next.motifs.map((m, i) => (
            <li key={i} className={cx("flex gap-2", next.decision === "no_go" ? "text-danger" : "text-ink-2")}>
              {next.decision === "no_go" ? <ShieldAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none" /> : <span aria-hidden className="mt-2 h-1 w-1 flex-none rounded-full bg-current" />}
              {m}
            </li>
          ))}
        </ul>
      )}
      {releve && (
        <ul className="mt-2.5 space-y-1.5 border-t border-line pt-2.5 text-ink-2">
          {s.pending_in_scope > 0 && (
            <li className="flex gap-2">
              <ListChecks aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none text-muted" />
              <span>
                <b className="font-semibold text-ink">{pluriel(s.pending_in_scope, "critère")} à évaluer</b> dans les gates atteints
              </span>
            </li>
          )}
          {indisponibles > 0 && (
            <li className="flex gap-2">
              <FileCheck2 aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none text-muted" />
              <span>
                Critères du gate {next.code} : <b className="font-semibold text-ink">{fmtInt(next.available)} {next.available > 1 ? "disponibles" : "disponible"} sur {fmtInt(next.criteria)}</b>
              </span>
            </li>
          )}
          {ko.length > 0 && (
            <li className="flex gap-2 text-danger">
              <ShieldAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>
                <b className="font-semibold">{pluriel(ko.length, "knock-out actif", "knock-outs actifs")}</b> jusqu&apos;à {next.code} : {citer(ko)}
              </span>
            </li>
          )}
          {critiques.length > 0 && (
            <li className="flex gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none text-warn" />
              <span>
                <b className="font-semibold text-ink">{pluriel(critiques.length, "critère critique manquant", "critères critiques manquants")}</b> jusqu&apos;à {next.code} : {citer(critiques)}
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Initiales d'un consultant (pastille de l'équipe du dossier). */
function initiales(nom: string) {
  return nom.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((m) => m[0]?.toUpperCase() ?? "").join("");
}

/**
 * Suivi par compartiment : chaque bloc d'expertise de la grille (domaines regroupés) avec son score sur
 * 100, ses manques à traiter, ses études renseignées, ses knock-outs actifs et le consultant à qui il est
 * confié. Le responsable du dossier (can_assign) affecte, reprend ou retire un consultant sur place ; un
 * autre consultant du cabinet ne peut que prendre en charge un compartiment libre (POST
 * /axispro/dossiers/<id>/assignments avec son propre identifiant) ; la direction et l'administration lisent.
 * Rien ne s'affiche pour une grille sans compartiments.
 */
function SuiviCompartiments({ d }: { d: DossierDetail }) {
  const compartiments = d.scoring.compartments ?? [];
  const { cabinet, moi } = useCabinet();
  const affecte = cabinet && d.can_assign;
  const { data: consultants } = useApi<UserRef[]>(affecte && compartiments.length ? "/axispro/consultants" : null);
  const { mutate } = useSWRConfig();
  const { agir, bandeau } = useRetour();
  const [enCours, setEnCours] = useState<number | null>(null);
  if (!compartiments.length) return null;
  const confies = compartiments.filter((c) => c.owner).length;

  async function confier(c: CompartmentScore, valeur: string) {
    const userId = valeur ? Number(valeur) : null;
    const nom = userId === moi?.id ? moi.name : consultants?.find((u) => u.id === userId)?.name;
    setEnCours(c.compartment_id);
    const r = await agir(
      () => apiSend<{ status: string; compartments: CompartmentScore[] }>("POST", `/axispro/dossiers/${d.id}/assignments`, { compartment_id: c.compartment_id, user_id: userId }),
      userId ? (affecte ? `Compartiment ${c.code} confié à ${nom ?? "ce consultant"}.` : `Compartiment ${c.code} pris en charge : vous en évaluez les critères.`) : `Compartiment ${c.code} sans consultant affecté.`,
    );
    setEnCours(null);
    // Le dossier en cache prend la nouvelle équipe sans être rechargé : seule l'affectation change.
    if (r) void mutate(`/axispro/dossiers/${d.id}`, (cur?: DossierDetail) => (cur ? { ...cur, scoring: { ...cur.scoring, compartments: r.compartments } } : cur), { revalidate: false });
  }

  return (
    <Card title="Suivi par compartiment" actions={<span className="text-[12.5px] font-medium text-muted">{confies} sur {compartiments.length} confié{confies > 1 ? "s" : ""} à un consultant</span>}>
      {bandeau && <div className="mb-3">{bandeau}</div>}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {compartiments.map((c, i) => {
          const score = c.assessed ? c.score : null;
          const options = [...(consultants ?? [])];
          if (c.owner && !options.some((u) => u.id === c.owner?.id)) options.unshift(c.owner);
          return (
            <li key={c.compartment_id} className={cx("flex min-w-0 flex-col rounded-xl border p-3.5 transition-colors", c.knockouts ? "border-danger/35 bg-danger-doux/25" : "border-line bg-panel hover:border-line-strong")}>
              <div className="flex items-start gap-2.5">
                <PuceCompartiment code={c.code} nom={c.name} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold leading-snug text-ink">{c.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted" title={c.domains.join(", ")}>{c.domains.join(" · ") || "Aucun domaine"}</div>
                </div>
                <div className="flex-none text-right">
                  <span className="font-display text-[22px] font-bold leading-none tabular text-ink">{score === null ? "–" : Math.round(score)}</span>
                  <span className="block text-[10.5px] text-muted">/ 100</span>
                </div>
              </div>
              <div className="relative mt-2.5 h-2 rounded-full bg-panel-3" role="img" aria-label={score === null ? `${c.code} : aucun critère évalué` : `${c.code} : score ${Math.round(score)} sur 100`}>
                <div className="n-pousser-x h-full rounded-full" style={{ width: `${Math.max(score ?? 0, 1)}%`, background: couleurScore(score), "--i": i } as CSSProperties} />
                {[30, 50, 65].map((x) => <span key={x} aria-hidden className="absolute -top-0.5 h-3 w-px bg-line-strong" style={{ left: `${x}%` }} />)}
              </div>
              <dl className="mt-3 grid grid-cols-4 divide-x divide-line rounded-lg bg-panel-2 py-1.5 text-center">
                <Chiffre titre="Critères évalués" court="Évalués" valeur={`${c.assessed}/${c.criteria}`} />
                <Chiffre titre="Manques à traiter" court="Manques" valeur={c.gaps} ton={c.gaps ? "text-warn" : undefined} />
                <Chiffre titre="Études à produire renseignées" court="Études" valeur={c.studies} />
                <Chiffre titre="Knock-outs actifs" court="KO" valeur={c.knockouts} ton={c.knockouts ? "text-danger" : undefined} />
              </dl>
              <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5">
                <span aria-hidden className={cx("grid h-7 w-7 flex-none place-items-center rounded-full text-[11px] font-bold", c.owner ? "bg-accent text-white" : "border border-dashed border-line-strong text-muted")}>
                  {c.owner ? initiales(c.owner.name) : "?"}
                </span>
                {affecte ? (
                  <Select
                    aria-label={`Consultant du compartiment ${c.code}`}
                    className="min-h-8 min-w-0 flex-1 py-1 pl-2 text-[12.5px]"
                    value={c.owner?.id ?? ""}
                    disabled={enCours === c.compartment_id || !consultants}
                    placeholder="Non affecté"
                    onChange={(e) => confier(c, e.target.value)}
                    options={options.map((u) => ({ value: u.id, label: u.name }))}
                  />
                ) : (
                  <>
                    <span className={cx("min-w-0 flex-1 truncate text-[12.5px]", c.owner ? "font-medium text-ink" : "italic text-muted")}>{c.owner?.name ?? "Non affecté"}</span>
                    {cabinet && moi && !c.owner && (
                      <Button size="sm" loading={enCours === c.compartment_id} onClick={() => void confier(c, String(moi.id))}>
                        Prendre en charge
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[12px] text-muted">
        Un compartiment regroupe des domaines de la grille. Le consultant qui le reçoit retrouve ses critères par « Mes compartiments » dans l&apos;évaluation ; le score se lit comme celui d&apos;un domaine (repères 30, 50 et 65).
      </p>
    </Card>
  );
}

/** Chiffre d'une tuile de compartiment : libellé court, titre complet en infobulle. */
function Chiffre({ titre, court, valeur, ton }: { titre: string; court: string; valeur: string | number; ton?: string }) {
  return (
    <div title={titre} className="min-w-0 px-1">
      <dt className="truncate text-[11px] font-medium text-muted">{court}</dt>
      <dd className={cx("font-display text-[15px] font-bold tabular", ton ?? "text-ink")}>{valeur}</dd>
    </div>
  );
}

function Mesure({ icone: I, titre, valeur, detail, alerte }: { icone: typeof Target; titre: string; valeur: string; detail?: string; alerte?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
        <I className="h-3.5 w-3.5" /> {titre}
      </div>
      <div className={cx("mt-0.5 font-display text-[22px] font-bold tabular", alerte ? "text-danger" : "text-ink")}>{valeur}</div>
      {detail && <div className="text-[12px] text-muted">{detail}</div>}
    </div>
  );
}

const OUI_NON = [
  { value: "", label: "Non renseigné" },
  { value: "yes", label: "Oui" },
  { value: "no", label: "Non" },
];

/** Fiche projet et hypothèses de décision (gates 4 à 7), modifiables tant que le dossier n'est pas figé. */
function Fiche({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  // Modifier la fiche : profil cabinet seul (PATCH /axispro/dossiers/<id>).
  const { cabinet } = useCabinet();
  const { data: currencies } = useApi<Currency[]>(edit ? "/axispro/currencies" : null);
  const { agir, bandeau } = useRetour();
  const init = () => ({
    name: d.name, sector: d.sector ?? "", location: d.location ?? "", capacity: d.capacity ?? "",
    investment: String(d.investment || ""), financing_need: String(d.financing_need || ""), currency_id: String(d.currency.id),
    date_evaluation: d.date_evaluation ?? "", date_start: d.date_start ?? "", description: d.description ?? "", hypotheses: d.hypotheses ?? "",
    dscr_manual: d.decision_inputs.dscr_manual === null ? "" : String(d.decision_inputs.dscr_manual),
    irr_manual: d.decision_inputs.irr_manual === null ? "" : String(d.decision_inputs.irr_manual),
    ...Object.fromEntries(HYPOTHESES.map((h) => [h.key, d.decision_inputs[h.key] ?? ""])),
  }) as Record<string, string>;
  const [f, setF] = useState<Record<string, string>>(init);
  const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;
  async function enregistrer() {
    const r = await agir(() => apiSend("PATCH", `/axispro/dossiers/${d.id}`, {
      ...f, investment: num(f.investment ?? ""), financing_need: num(f.financing_need ?? ""), dscr_manual: num(f.dscr_manual ?? ""),
      irr_manual: num(f.irr_manual ?? ""), currency_id: Number(f.currency_id), date_start: f.date_start || null, date_evaluation: f.date_evaluation || null,
    }), "Fiche projet enregistrée.");
    if (r !== undefined) {
      setEdit(false);
      onChanged();
    }
  }
  const champ = (cle: string, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label}><Input value={f[cle] ?? ""} onChange={(e) => setF({ ...f, [cle]: e.target.value })} {...props} /></Field>
  );
  return (
    <Card
      title="Fiche projet et hypothèses de décision"
      actions={!edit && cabinet ? <Button disabled={d.locked} onClick={() => { setF(init()); setEdit(true); }}><Pencil className="h-4 w-4" /> Modifier</Button> : undefined}
    >
      {bandeau}
      {!edit ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
          {[
            ["Secteur", d.sector ?? "–"], ["Localisation", d.location ?? "–"], ["Capacité", d.capacity ?? "–"],
            ["Investissement prévu", montant(d, d.investment)], ["Besoin de financement", montant(d, d.financing_need)],
            ["Date d'évaluation", fmtDate(d.date_evaluation)], ["Démarrage prévu", fmtDate(d.date_start)],
            ["DSCR déclaré", d.decision_inputs.dscr_manual === null ? "–" : arrondi(d.decision_inputs.dscr_manual, 2)],
            ["TRI déclaré", d.decision_inputs.irr_manual === null ? "–" : `${arrondi(d.decision_inputs.irr_manual, 1)} %`],
            ...HYPOTHESES.map((h) => [h.label, d.decision_inputs[h.key] === "yes" ? "Oui" : d.decision_inputs[h.key] === "no" ? "Non" : "Non renseigné"]),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-line/70 py-1">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium text-ink">{v}</dd>
            </div>
          ))}
          {d.hypotheses && <p className="pt-2 text-ink-2 sm:col-span-2 xl:col-span-3"><b>Commentaires et hypothèses.</b> {d.hypotheses}</p>}
        </dl>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {champ("name", "Projet")}
          {champ("sector", "Secteur")}
          {champ("location", "Localisation")}
          {champ("capacity", "Capacité")}
          <Field label="Devise du dossier"><Select value={f.currency_id} onChange={(e) => setF({ ...f, currency_id: e.target.value })} options={(currencies ?? [d.currency]).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          {champ("date_evaluation", "Date d'évaluation", { type: "date" })}
          {champ("investment", "Investissement prévu", { inputMode: "numeric", className: "font-mono" })}
          {champ("financing_need", "Besoin de financement", { inputMode: "numeric", className: "font-mono" })}
          {champ("date_start", "Démarrage prévu", { type: "date" })}
          {champ("dscr_manual", "DSCR minimum déclaré (sans modèle financier)", { inputMode: "decimal" })}
          {champ("irr_manual", "TRI projet déclaré (%)", { inputMode: "decimal" })}
          {HYPOTHESES.map((h) => (
            <Field key={h.key} label={`${h.label} (${h.gate})`}>
              <Select value={f[h.key] ?? ""} onChange={(e) => setF({ ...f, [h.key]: e.target.value })} options={OUI_NON} />
            </Field>
          ))}
          <Field label="Description" className="md:col-span-3"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Commentaires et hypothèses de décision" className="md:col-span-3"><Textarea value={f.hypotheses} onChange={(e) => setF({ ...f, hypotheses: e.target.value })} /></Field>
          <div className="flex gap-2 md:col-span-3">
            <Button variant="primary" onClick={enregistrer}>Enregistrer</Button>
            <Button onClick={() => setEdit(false)}>Annuler</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
