"use client";

import Link from "next/link";
import { useState } from "react";
import { Calendar, Coins, HandCoins, Landmark, Plus, Target, Trash2 } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Field, Input, Kpi, Loading, Notice, ProgressBar, Select, Textarea, cx } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { FUNDING_STATE, INSTRUMENTS, type Funding, type FundingState } from "@/lib/axispro-types";
import { fmtDate, fmtPct, fmtShort, pluriel } from "@/lib/format";
import { CelluleNombre, CelluleTexte } from "./cellules";

const EN_COURS: FundingState[] = ["identified", "submitted", "review", "agreed"];
const OBTENUS: FundingState[] = ["signed", "disbursed"];

/** Financements recherchés : ceux d'un dossier (dossierId) ou tout le portefeuille, par étape. */
export function Financements({ dossierId, besoin }: { dossierId?: number; besoin?: number }) {
  const { data, error, mutate } = useApi<Funding[]>(dossierId ? `/axispro/fundings?dossier_id=${dossierId}` : "/axispro/fundings");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

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
  if (!data) return <Loading label="Chargement des financements…" />;
  const actifs = data.filter((f) => f.state !== "rejected" && f.state !== "withdrawn");
  const sollicite = actifs.reduce((s, f) => s + f.amount_requested, 0);
  const obtenu = data.filter((f) => OBTENUS.includes(f.state)).reduce((s, f) => s + f.amount_granted, 0);
  const relances = data.filter((f) => EN_COURS.includes(f.state) && f.next_date).sort((a, b) => (a.next_date ?? "").localeCompare(b.next_date ?? ""));
  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {besoin !== undefined ? (
          <Kpi label="Besoin de financement" value={fmtShort(besoin)} icon={Target} teinte="azur" hint="Annoncé à l'ouverture du dossier" />
        ) : (
          <Kpi label="Démarches en cours" value={String(data.filter((f) => EN_COURS.includes(f.state)).length)} icon={Target} teinte="azur" />
        )}
        <Kpi label="Montant sollicité" value={fmtShort(sollicite)} icon={HandCoins} teinte="ambre" hint={pluriel(actifs.length, "démarche active", "démarches actives")} />
        <Kpi label="Montant obtenu" value={fmtShort(obtenu)} icon={Coins} teinte="jade" tone={obtenu > 0 ? "ok" : "neutral"} hint="Conventions signées et décaissements" />
        <Kpi label={besoin !== undefined ? "Couverture du besoin" : "Taux d'obtention"} value={besoin ? fmtPct((obtenu / besoin) * 100, 0) : sollicite ? fmtPct((obtenu / sollicite) * 100, 0) : "–"} icon={Landmark} teinte="lagon" />
      </div>
      {besoin ? (
        <div>
          <div className="mb-1 flex justify-between text-[12.5px] text-muted">
            <span>Obtenu sur besoin</span>
            <span className="tabular">{fmtShort(obtenu)} / {fmtShort(besoin)}</span>
          </div>
          <ProgressBar value={Math.min(100, (obtenu / besoin) * 100)} tone={obtenu >= besoin ? "ok" : "accent"} />
        </div>
      ) : null}

      {!dossierId && <Pipeline data={data} />}

      {relances.length > 0 && (
        <Card title="Prochaines relances">
          <ul className="space-y-1.5 text-[13.5px]">
            {relances.slice(0, 8).map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cx("inline-flex items-center gap-1.5 font-semibold tabular", (f.next_date ?? "") < aujourdhui ? "text-danger" : "text-ink")}>
                  <Calendar className="h-3.5 w-3.5" /> {fmtDate(f.next_date)}
                </span>
                <span className="text-ink-2">{f.funder.name}</span>
                {f.dossier && (
                  <Link href={`/axispro/dossiers/${f.dossier.id}`} className="text-[12.5px] font-semibold text-accent hover:underline">
                    {f.dossier.reference}
                  </Link>
                )}
                <span className="text-muted">{f.next_step ?? FUNDING_STATE[f.state].label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={dossierId ? "Démarches auprès des financeurs" : "Toutes les démarches"} padded={false}>
        {data.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Aucune démarche de financement.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((f) => (
              <LigneFinancement key={f.id} f={f} global={!dossierId} agir={agir} />
            ))}
          </ul>
        )}
      </Card>

      {dossierId && <NouveauFinancement onCreate={(v) => agir(() => apiSend("POST", `/axispro/dossiers/${dossierId}/fundings`, v), "Démarche enregistrée.")} />}
    </div>
  );
}

function Pipeline({ data }: { data: Funding[] }) {
  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3 px-1">
        {(Object.keys(FUNDING_STATE) as FundingState[]).map((etat) => {
          const items = data.filter((f) => f.state === etat);
          const montant = items.reduce((s, f) => s + (OBTENUS.includes(etat) ? f.amount_granted : f.amount_requested), 0);
          return (
            <section key={etat} className="w-[210px] flex-none rounded-2xl bg-panel-3/70 p-2.5">
              <header className="px-1 pb-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-ink">{FUNDING_STATE[etat].label}</h2>
                  <span className="rounded-full bg-panel px-2 py-0.5 text-[12px] font-bold tabular text-ink-2">{items.length}</span>
                </div>
                <div className="text-[12px] tabular text-muted">{fmtShort(montant)} GNF</div>
              </header>
              <div className="space-y-2">
                {items.map((f) => (
                  <Link key={f.id} href={f.dossier ? `/axispro/dossiers/${f.dossier.id}` : "#"} className="n-levable block rounded-xl border border-line bg-panel p-2.5 text-[12.5px] shadow-[var(--ombre-carte)]">
                    <div className="font-semibold text-ink">{f.funder.name}</div>
                    <div className="truncate text-muted">{f.dossier ? `${f.dossier.reference} ${f.dossier.name}` : ""}</div>
                    <div className="mt-1 flex justify-between tabular">
                      <span>{INSTRUMENTS[f.instrument] ?? f.instrument}</span>
                      <span className="font-semibold">{fmtShort(OBTENUS.includes(etat) ? f.amount_granted : f.amount_requested)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LigneFinancement({ f, global, agir }: { f: Funding; global: boolean; agir: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const patch = (v: Record<string, unknown>) => agir(() => apiSend("PATCH", `/axispro/fundings/${f.id}`, v));
  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{f.funder.name}</span>
            <Badge tone={FUNDING_STATE[f.state].tone}>{FUNDING_STATE[f.state].label}</Badge>
            <span className="text-[12.5px] text-muted">{INSTRUMENTS[f.instrument] ?? f.instrument}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {global && f.dossier && (
              <>
                <Link href={`/axispro/dossiers/${f.dossier.id}`} className="font-semibold text-accent hover:underline">
                  {f.dossier.reference}
                </Link>{" "}
                {f.dossier.name},{" "}
              </>
            )}
            {f.date_submitted ? `déposé le ${fmtDate(f.date_submitted)}` : "non déposé"}
            {f.date_decision ? `, décision le ${fmtDate(f.date_decision)}` : ""}
            {f.state_date ? `, étape atteinte le ${fmtDate(f.state_date)}` : ""}
          </div>
        </div>
        <Select aria-label={`Étape, ${f.funder.name}`} className="min-h-8 w-48 py-1 text-[13px]" value={f.state} onChange={(e) => patch({ state: e.target.value })} options={(Object.keys(FUNDING_STATE) as FundingState[]).map((k) => ({ value: k, label: FUNDING_STATE[k].label }))} />
        {!global && (
          <button type="button" aria-label={`Supprimer la démarche ${f.funder.name}`} title="Supprimer" className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger" onClick={() => window.confirm(`Supprimer la démarche auprès de ${f.funder.name} ?`) && agir(() => apiSend("DELETE", `/axispro/fundings/${f.id}`), "Démarche supprimée.")}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] text-muted md:grid-cols-3 xl:grid-cols-6">
        <label className="block">Sollicité<CelluleNombre label="Montant sollicité" className="mt-0.5 w-full" value={f.amount_requested} onSave={(v) => patch({ amount_requested: v })} /></label>
        <label className="block">Accordé<CelluleNombre label="Montant accordé" className="mt-0.5 w-full" value={f.amount_granted} onSave={(v) => patch({ amount_granted: v })} /></label>
        <label className="block">Taux (%)<CelluleNombre label="Taux" className="mt-0.5 w-full" value={f.rate ?? 0} onSave={(v) => patch({ rate: v })} /></label>
        <label className="block">Durée (mois)<CelluleNombre label="Durée en mois" className="mt-0.5 w-full" value={f.duration_months ?? 0} onSave={(v) => patch({ duration_months: Math.round(v) })} /></label>
        <label className="block">Prochaine étape<CelluleTexte label="Prochaine étape" className="mt-0.5 w-full" value={f.next_step ?? ""} onSave={(v) => patch({ next_step: v })} /></label>
        <label className="block">Relance le<Input aria-label="Date de relance" type="date" className="mt-0.5 min-h-8 w-full py-1 text-[13px]" defaultValue={f.next_date ?? ""} onBlur={(e) => e.target.value !== (f.next_date ?? "") && patch({ next_date: e.target.value || null })} /></label>
      </div>
      {f.conditions && <p className="mt-2 text-[13px] text-ink-2"><b>Conditions et garanties :</b> {f.conditions}</p>}
    </li>
  );
}

function NouveauFinancement({ onCreate }: { onCreate: (v: Record<string, unknown>) => Promise<void> }) {
  const [financeur, setFinanceur] = useState<{ id: number; name: string } | null>(null);
  const vierge = { instrument: "bank_loan", amount_requested: "", rate: "", duration_months: "", next_step: "", next_date: "", conditions: "" };
  const [f, setF] = useState(vierge);
  const nombre = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;
  return (
    <Card title="Nouvelle démarche">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Financeur (banque, fonds, investisseur)" className="md:col-span-2">
          <PartnerPicker value={financeur} onChange={setFinanceur} kind="supplier" placeholder="Rechercher ou créer le financeur…" />
        </Field>
        <Field label="Instrument">
          <Select value={f.instrument} onChange={(e) => setF({ ...f, instrument: e.target.value })} options={Object.entries(INSTRUMENTS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Montant sollicité (GNF)">
          <Input inputMode="numeric" className="tabular" value={f.amount_requested} onChange={(e) => setF({ ...f, amount_requested: e.target.value })} />
        </Field>
        <Field label="Taux (%)"><Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        <Field label="Durée (mois)"><Input inputMode="numeric" value={f.duration_months} onChange={(e) => setF({ ...f, duration_months: e.target.value })} /></Field>
        <Field label="Prochaine étape"><Input value={f.next_step} placeholder="Exemple : remise du plan d'affaires" onChange={(e) => setF({ ...f, next_step: e.target.value })} /></Field>
        <Field label="Relance le"><Input type="date" value={f.next_date} onChange={(e) => setF({ ...f, next_date: e.target.value })} /></Field>
        <Field label="Conditions et garanties demandées" className="md:col-span-4">
          <Textarea className="min-h-[56px]" value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={!financeur}
          onClick={() =>
            onCreate({
              ...f,
              funder_id: financeur?.id,
              amount_requested: nombre(f.amount_requested),
              rate: nombre(f.rate),
              duration_months: Math.round(nombre(f.duration_months)),
              next_date: f.next_date || null,
            }).then(() => {
              setF(vierge);
              setFinanceur(null);
            })
          }
        >
          <Plus className="h-4 w-4" /> Enregistrer
        </Button>
      </div>
    </Card>
  );
}
