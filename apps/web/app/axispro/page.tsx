"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { FileText, Plus, ShieldAlert } from "@/components/icons";
import { Badge, Button, Card, DataTable, Donut, Etat, FEUILLE, Field, Input, Kpi, Modal, Notice, PageHeader, ProgressBar, Segmented, Select, Tabs, Textarea, cx } from "@/components/ui";
import { COULEUR_VERDICT } from "@/lib/couleurs";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { GATE_DECISION, RECO, type Currency, type DossierDetail, type DossierSummary, type Gate, type Recommendation } from "@/lib/axispro-types";
import { fmtPct, fmtShort, pluriel } from "@/lib/format";
import { Portefeuille } from "@/components/axispro/Portefeuille";
import { ratio } from "@/components/axispro/cellules";
import { note, useCabinet } from "@/components/axispro/dossier/commun";

type Vue = "tableau" | "liste";

const COULEUR_RECO: Record<Recommendation, string> = COULEUR_VERDICT;

/** Couleur d'un score selon les classes de la méthode (65 APD READY, 50 CONDITIONAL GO, 30 HOLD). */
function teinteScore(score: number | null) {
  if (score === null) return "bg-panel-3 text-muted";
  return score >= 65 ? "bg-ok-doux text-ok-texte" : score >= 50 ? "bg-warn-doux text-warn" : score >= 30 ? "bg-orange-100 text-orange-700" : "bg-danger-doux text-danger";
}

const FAVORABLES: Recommendation[] = ["bankable", "apd_ready", "go"];

const CLE_VUE = "nimova.axispro.vue";

export default function DossiersPage() {
  const [state, setState] = useState<"open" | "on_hold" | "closed">("open");
  const [vue, setVue] = useState<Vue>("tableau");
  const { data, error, mutate } = useApi<DossierSummary[]>(`/axispro/dossiers?state=${state}`);
  const { data: policy } = useApi<{ version: number; name: string } | null>("/axispro/policy");
  const [creating, setCreating] = useState(false);
  const { cabinet } = useCabinet();
  const rows = data ?? [];

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(CLE_VUE);
      if (v === "liste" || v === "tableau") setVue(v);
    } catch {
      /* préférence non mémorisée */
    }
  }, []);
  function choisirVue(v: Vue) {
    setVue(v);
    try {
      window.localStorage.setItem(CLE_VUE, v);
    } catch {
      /* rien à garder */
    }
  }

  // Étapes de la grille, dans leur ordre (les dossiers suivent la même politique).
  const etapes: Gate[] = (rows.find((d) => d.gates.length)?.gates ?? []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const rang = (g: Gate | null) => (g ? etapes.findIndex((e) => e.id === g.id) : -1);
  const besoin = rows.reduce((a, d) => a + (d.financing_need ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Dossiers de projets"
        subtitle={policy ? `Évaluation selon « ${policy.name} », version ${policy.version}.` : "Aucune grille en vigueur : importez-la dans Grille d'évaluation."}
        actions={
          <>
            <Segmented
              label="Présentation"
              value={vue}
              onChange={choisirVue}
              options={[
                { key: "tableau", label: "Tableau" },
                { key: "liste", label: "Liste" },
              ]}
            />
            {/* Création réservée au profil cabinet (POST /axispro/dossiers) ; la direction et l'administration lisent. */}
            {cabinet && (
              <Button variant="primary" disabled={!policy} onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Nouveau dossier
              </Button>
            )}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Dossiers" value={String(rows.length)} hint={`Besoin de financement : ${fmtShort(besoin)} GNF`} />
        <Kpi label="Bankable, APD READY ou GO" value={String(rows.filter((d) => FAVORABLES.includes(d.recommendation)).length)} tone="ok" hint={pluriel(rows.filter((d) => d.recommendation === "bankable").length, "bankable candidate")} />
        <Kpi label="CONDITIONAL GO ou HOLD" value={String(rows.filter((d) => d.recommendation === "conditional" || d.recommendation === "hold").length)} tone="warn" />
        <Kpi label="Knock-out actif" value={String(rows.filter((d) => d.knockouts > 0).length)} tone="danger" />
      </div>

      {rows.length > 0 && etapes.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-12">
          <Card title="Entonnoir des dossiers par étape" className="xl:col-span-8">
            <Entonnoir etapes={etapes} rangs={rows.map((d) => rang(d.current_gate))} />
          </Card>
          <Card title="Recommandations" className="xl:col-span-4">
            <Donut
              size={140}
              epaisseur={18}
              format={(v) => String(v)}
              centre={{ titre: "Dossiers", valeur: String(rows.length) }}
              parts={(Object.keys(RECO) as Recommendation[]).map((r) => ({ key: r, label: RECO[r].label, value: rows.filter((d) => d.recommendation === r).length, color: COULEUR_RECO[r] }))}
            />
          </Card>
        </div>
      )}

      <Portefeuille />

      <Tabs
        tabs={[
          { key: "open", label: "En cours" },
          { key: "on_hold", label: "Suspendus" },
          { key: "closed", label: "Clos" },
        ]}
        value={state}
        onChange={setState}
      />
      {!data ? (
        <Card padded={false}>
          <Etat error={error} onRetry={() => mutate()} label="Chargement des dossiers…" />
        </Card>
      ) : vue === "tableau" && etapes.length > 0 ? (
        <Tableau etapes={etapes} rows={rows} rang={rang} />
      ) : (
        <Card padded={false}>
          <Liste rows={rows} />
        </Card>
      )}
      {creating && (
        <DossierForm
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            void mutate();
            window.location.href = `/axispro/dossiers/${id}`;
          }}
        />
      )}
    </div>
  );
}

/**
 * Entonnoir : combien de dossiers ont atteint chaque étape (le dossier compte pour son étape et
 * toutes celles d'avant). Les blocs rétrécissent avec le nombre, le pourcentage est donné en clair.
 */
function Entonnoir({ etapes, rangs }: { etapes: Gate[]; rangs: number[] }) {
  const total = rangs.length || 1;
  const atteint = etapes.map((_, i) => rangs.filter((r) => r >= i).length);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px]" style={{ gridTemplateColumns: `repeat(${etapes.length}, minmax(0, 1fr))` }}>
        {etapes.map((g, i) => {
          const n = atteint[i] ?? 0;
          const h = Math.max(10, (n / total) * 100);
          return (
            <div key={g.id} className={cx("flex flex-col px-2", i > 0 && "border-l border-line")}>
              <div className="text-[12.5px] font-bold text-ink-2">{g.code}</div>
              <div className="line-clamp-2 min-h-[2.5em] text-[11.5px] leading-tight text-muted" title={g.name}>
                {g.name}
              </div>
              <div className="mt-1 font-display text-[24px] font-bold leading-none tabular text-ink">{n}</div>
              <div className="relative mt-3 flex h-[120px] items-center">
                <div
                  className="n-pousser-y w-full rounded-xl"
                  style={{ height: `${h}%`, background: "var(--accent)", opacity: 0.35 + 0.65 * (n / total), "--i": i } as CSSProperties}
                />
              </div>
              <div className="mt-2 text-center text-[12px] font-semibold tabular text-muted">{Math.round((n / total) * 100)} %</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tableau en colonnes : une colonne par étape, une carte par dossier. */
function Tableau({ etapes, rows, rang }: { etapes: Gate[]; rows: DossierSummary[]; rang: (g: Gate | null) => number }) {
  const hors = rows.filter((d) => rang(d.current_gate) < 0);
  const colonnes = [...etapes.map((g, i) => ({ cle: String(g.id), titre: `${g.code} ${g.name}`, dossiers: rows.filter((d) => rang(d.current_gate) === i) })), ...(hors.length ? [{ cle: "hors", titre: "Sans étape", dossiers: hors }] : [])];
  return (
    <div className="-mx-1 overflow-x-auto pb-3">
      <div className="flex min-w-max gap-4 px-1">
        {colonnes.map((c) => (
          <section key={c.cle} className="flex w-[292px] flex-none flex-col rounded-2xl bg-panel-3/70 p-2.5">
            <header className="flex items-center justify-between gap-2 px-1.5 pb-2.5 pt-1">
              <h2 className="truncate text-[13.5px] font-semibold text-ink">{c.titre}</h2>
              <span className="rounded-full bg-panel px-2 py-0.5 text-[12px] font-bold tabular text-ink-2 shadow-[0_1px_2px_rgb(16_36_31/0.06)]">{c.dossiers.length}</span>
            </header>
            <div className="n-cascade space-y-2.5">
              {c.dossiers.length === 0 && <div className="rounded-xl border border-dashed border-line-strong/70 px-3 py-6 text-center text-[12.5px] text-muted">Aucun dossier à cette étape</div>}
              {c.dossiers.map((d) => (
                <CarteDossier key={d.id} d={d} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function CarteDossier({ d }: { d: DossierSummary }) {
  const evalue = (d.progress.assessed / Math.max(1, d.progress.criteria)) * 100;
  return (
    <Link href={`/axispro/dossiers/${d.id}`} className={cx(FEUILLE, "n-levable block p-3.5")}>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md bg-accent-doux px-1.5 py-0.5 text-[11.5px] font-semibold tabular text-accent">{d.reference}</span>
        <span className={cx("rounded-full px-2 py-0.5 text-[12px] font-bold tabular", teinteScore(d.progress.assessed ? d.readiness : null))} title="Project Readiness Score">{d.progress.assessed ? `${note(d.readiness)} / 100` : "Non noté"}</span>
      </div>
      <div className="mt-2.5 line-clamp-2 text-[14px] font-semibold leading-snug text-ink">{d.name}</div>
      <div className="mt-0.5 truncate text-[12.5px] text-muted">{d.promoter.name}</div>
      {d.progress.assessed > 0 && (
        <div className="mt-2 flex gap-3 text-[11.5px] text-muted">
          <span>APD <b className="tabular text-ink-2">{note(d.apd)}</b></span>
          <span>Bankability <b className="tabular text-ink-2">{note(d.bankability)}</b></span>
          {d.locked && <span className="font-semibold text-accent">Décision verrouillée</span>}
        </div>
      )}
      {d.knockouts > 0 && d.progress.assessed > 0 && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-danger-doux px-2 py-1 text-[12px] font-semibold text-danger">
          <ShieldAlert className="h-3.5 w-3.5" /> {d.knockouts} knock-out{d.knockouts > 1 ? "s" : ""} actif{d.knockouts > 1 ? "s" : ""}
        </div>
      )}
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[11.5px] text-muted">
          <span>Évaluation</span>
          <span className="font-semibold tabular text-ink-2">
            {d.progress.assessed} / {d.progress.criteria}
          </span>
        </div>
        <ProgressBar value={evalue} tone={evalue >= 100 ? "ok" : "accent"} epaisseur={6} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <Badge tone={RECO[d.recommendation].tone}>{RECO[d.recommendation].label}</Badge>
        <span className="flex items-center gap-3 text-[12px] font-semibold tabular text-ink-2">
          <span className="inline-flex items-center gap-1" title="Pièces de la data room disponibles">
            <FileText className="h-3.5 w-3.5 text-muted" />
            {d.documents.available}/{d.documents.total}
          </span>
          <span className="whitespace-nowrap" title="Besoin de financement">{fmtShort(d.financing_need)}</span>
        </span>
      </div>
    </Link>
  );
}

/** Liste : un dossier par ligne, projet et promoteur réunis dans la même cellule. */
function Liste({ rows }: { rows: DossierSummary[] }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(d) => d.id}
      empty="Aucun dossier."
      columns={[
        {
          key: "name",
          label: "Projet",
          sortValue: (d) => d.name,
          render: (d) => (
            <div className="min-w-[220px]">
              <Link href={`/axispro/dossiers/${d.id}`} className="font-semibold text-ink hover:text-accent">
                {d.name}
              </Link>
              <div className="mt-0.5 text-[12.5px] text-muted">
                <span className="font-semibold text-accent">{d.reference}</span>, {d.promoter.name}
              </div>
            </div>
          ),
        },
        { key: "gate", label: "Étape", sortValue: (d) => d.current_gate?.sequence ?? -1, render: (d) => (d.current_gate ? <span className="whitespace-nowrap rounded-full bg-accent-doux px-2 py-0.5 text-[12px] font-semibold text-accent">{d.current_gate.code} {d.current_gate.name}</span> : "–") },
        {
          key: "progress",
          label: "Évaluation",
          sortValue: (d) => d.progress.assessed / Math.max(1, d.progress.criteria),
          render: (d) => (
            <div className="w-32">
              <ProgressBar value={(d.progress.assessed / Math.max(1, d.progress.criteria)) * 100} epaisseur={6} />
              <span className="text-[11.5px] text-muted">
                {d.progress.assessed} / {d.progress.criteria} critères
              </span>
            </div>
          ),
        },
        { key: "readiness", label: "Readiness", align: "right", sortValue: (d) => d.readiness, render: (d) => <span className={cx("inline-block min-w-12 rounded-full px-2 py-0.5 text-center text-[12px] font-bold", teinteScore(d.progress.assessed ? d.readiness : null))}>{d.progress.assessed ? note(d.readiness) : "–"}</span> },
        { key: "apd", label: "APD", align: "right", sortValue: (d) => d.apd, render: (d) => (d.progress.assessed ? note(d.apd) : "–") },
        { key: "bankability", label: "Bankability", align: "right", sortValue: (d) => d.bankability, render: (d) => (d.progress.assessed ? note(d.bankability) : "–") },
        { key: "recommendation", label: "Recommandation", render: (d) => <Badge tone={RECO[d.recommendation].tone}>{RECO[d.recommendation].label}</Badge> },
        { key: "next_gate", label: "Prochain gate", render: (d) => (d.next_gate ? <span className="whitespace-nowrap text-[12.5px]">{d.next_gate.code} · {GATE_DECISION[d.next_gate.decision].label}</span> : "–") },
        { key: "irr", label: "TRI", align: "right", sortValue: (d) => d.financial?.irr_project ?? null, render: (d) => fmtPct(d.financial?.irr_project) },
        { key: "dscr", label: "DSCR min.", align: "right", sortValue: (d) => d.financial?.dscr_min ?? null, render: (d) => ratio(d.financial?.dscr_min) },
        { key: "financing_need", label: "Besoin", align: "right", render: (d) => fmtShort(d.financing_need) },
        { key: "documents", label: "Data room", align: "right", sortValue: (d) => d.dataroom_completeness, render: (d) => `${Math.round(d.dataroom_completeness)} %` },
      ]}
    />
  );
}

function DossierForm({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [promoter, setPromoter] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ name: "", sector: "", location: "", capacity: "", investment: "", financing_need: "", description: "", hypotheses: "", currency_id: "", date_evaluation: new Date().toISOString().slice(0, 10) });
  const { data: currencies } = useApi<Currency[]>("/axispro/currencies");
  const devise = currencies?.find((c) => String(c.id) === f.currency_id)?.name ?? currencies?.[0]?.name ?? "GNF";
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => Number(v.replace(/\s/g, "")) || 0;
  async function submit() {
    try {
      const d = await apiSend<DossierDetail>("POST", "/axispro/dossiers", { ...f, currency_id: f.currency_id || undefined, promoter_id: promoter?.id, investment: num(f.investment), financing_need: num(f.financing_need) });
      onDone(d.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <Modal open wide title="Ouverture d'un dossier" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!f.name || !promoter}>Ouvrir le dossier</Button>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {error && <div className="md:col-span-2"><Notice tone="danger">{error}</Notice></div>}
        <Field label="Projet"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Promoteur"><PartnerPicker value={promoter} onChange={setPromoter} kind="customer" /></Field>
        <Field label="Secteur"><Input value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} /></Field>
        <Field label="Localisation"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Capacité"><Input value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <Field label="Devise du dossier"><Select value={f.currency_id} onChange={(e) => setF({ ...f, currency_id: e.target.value })} options={(currencies ?? []).map((c, i) => ({ value: i === 0 ? "" : String(c.id), label: c.name }))} /></Field>
        <Field label="Date d'évaluation"><Input type="date" value={f.date_evaluation} onChange={(e) => setF({ ...f, date_evaluation: e.target.value })} /></Field>
        <Field label={`Investissement prévu (${devise})`}><Input inputMode="numeric" className="font-mono" value={f.investment} onChange={(e) => setF({ ...f, investment: e.target.value })} /></Field>
        <Field label={`Besoin de financement (${devise})`}><Input inputMode="numeric" className="font-mono" value={f.financing_need} onChange={(e) => setF({ ...f, financing_need: e.target.value })} /></Field>
        <Field label="Description" className="md:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Hypothèses de décision" className="md:col-span-2"><Textarea value={f.hypotheses} onChange={(e) => setF({ ...f, hypotheses: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
