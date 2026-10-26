"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, DataTable, ErrorBox, Etat, Field, Input, Kpi, Notice, PageHeader, RankBars, Select, Tabs } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import type { DossierSummary, Timesheet, TimesheetSummary } from "@/lib/axispro-types";
import { useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { AIDE_NOMBRE, INSECABLE, aujourdhui, fmtDate, fmtDec, fmtInt, lireNombre, nombreIllisible, pluriel } from "@/lib/format";

/** Saisies affichées au plus (la route en sert 300 par défaut) ; les totaux, eux, portent sur tout le filtre. */
const LIMITE = 300;

const heures = (v: number) => `${fmtDec(v)}${INSECABLE}h`;

/**
 * Temps et facturation : temps passés par dossier. Les totaux et les heures par dossier viennent de
 * /axispro/timesheets/summary, calculés sur toutes les saisies du filtre ; la liste détaillée, elle, est
 * bornée et le dit. Saisie réservée au profil cabinet (POST /axispro/timesheets) : heures lues par
 * lireNombre (« 1,5 »), positives, envoi unique ; la saisie ne se vide qu'une fois enregistrée.
 */
export default function TempsPage() {
  const [filter, setFilter] = useState<"unbilled" | "all">("unbilled");
  const filtre = filter === "unbilled" ? "unbilled=1" : "";
  const { data, error, mutate } = useApi<Timesheet[]>(`/axispro/timesheets?${filtre ? `${filtre}&` : ""}limit=${LIMITE}`);
  const { data: totaux, error: erreurTotaux, mutate: relireTotaux } = useApi<TimesheetSummary>(`/axispro/timesheets/summary${filtre ? `?${filtre}` : ""}`);
  const { cabinet } = useCabinet();
  const { data: dossiers, error: erreurDossiers, mutate: relireDossiers } = useApi<DossierSummary[]>(cabinet ? "/axispro/dossiers?state=open,on_hold" : null);
  const [f, setF] = useState(() => ({ dossier_id: "", date: aujourdhui(), hours: "", description: "", billable: true }));
  const { envoyer, enCours, bandeau } = useRetour();
  const rows = data ?? [];
  const lues = lireNombre(f.hours);
  const erreurHeures = nombreIllisible(f.hours) ? AIDE_NOMBRE : lues !== null && lues <= 0 ? "Nombre d'heures positif attendu." : undefined;
  const bloque = !f.dossier_id || lues === null || !!erreurHeures || !f.description.trim() || !f.date;

  async function submit() {
    if (bloque) return;
    const fait = await envoyer(async () => {
      await apiSend("POST", "/axispro/timesheets", { ...f, dossier_id: Number(f.dossier_id), hours: lues, description: f.description.trim() });
      return true as const;
    }, "Temps enregistré.", "saisie");
    if (!fait) return;
    // La saisie ne se vide qu'une fois enregistrée : un refus garde les heures et les travaux à corriger.
    setF({ ...f, hours: "", description: "" });
    void mutate();
    void relireTotaux();
  }

  return (
    <div>
      <PageHeader title="Temps et facturation" subtitle="Temps passés par dossier ; la facture d'honoraires se crée depuis l'onglet Temps et facturation du dossier." />
      {erreurTotaux && (
        <div className="mb-4">
          <ErrorBox titre="Totaux des temps indisponibles." error={erreurTotaux} onRetry={() => void relireTotaux()} />
        </div>
      )}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Heures" value={totaux ? heures(totaux.hours) : "–"} hint={totaux ? `${pluriel(totaux.count, "saisie")}${filter === "unbilled" ? " à facturer" : ""}` : undefined} />
        <Kpi label="Heures à facturer" value={totaux ? heures(totaux.unbilled) : "–"} tone="warn" hint="Temps facturables sans facture d'honoraires" />
        <Kpi label="Dossiers concernés" value={totaux ? fmtInt(totaux.dossiers.length) : "–"} />
      </div>
      {/* Saisie des temps réservée au profil cabinet (POST /axispro/timesheets) ; la direction et l'administration lisent. */}
      {cabinet && (
        <Card title="Saisir du temps" className="mb-6">
          {bandeau && <div className="mb-3">{bandeau}</div>}
          {erreurDossiers && (
            <div className="mb-3">
              <ErrorBox titre="Dossiers indisponibles : impossible de choisir le dossier." error={erreurDossiers} onRetry={() => void relireDossiers()} />
            </div>
          )}
          <fieldset disabled={enCours === "saisie"} className="min-w-0">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
              <Field label="Dossier" className="md:col-span-2"><Select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })} placeholder="Choisir" options={(dossiers ?? []).map((d) => ({ value: d.id, label: `${d.reference}, ${d.name}` }))} /></Field>
              <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <Field label="Heures" error={erreurHeures}><Input inputMode="decimal" aria-invalid={erreurHeures ? true : undefined} placeholder="1,5" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
              <Field label="Travaux" className="md:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            </div>
          </fieldset>
          <div className="mt-3 flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={f.billable} disabled={enCours === "saisie"} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Facturable</label>
            <Button variant="primary" loading={enCours === "saisie"} disabled={bloque} onClick={() => void submit()}>Enregistrer</Button>
          </div>
        </Card>
      )}
      <Tabs tabs={[{ key: "unbilled", label: "À facturer" }, { key: "all", label: "Tous les temps" }]} value={filter} onChange={setFilter} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Heures par dossier">
          {!totaux ? (
            <Etat error={erreurTotaux} onRetry={() => void relireTotaux()} label="Calcul des heures par dossier…" />
          ) : totaux.dossiers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Aucun temps.</p>
          ) : (
            <>
              <RankBars
                couleur="var(--g-azur)"
                format={heures}
                items={totaux.dossiers.map((d) => ({ key: d.id, label: d.name, value: d.hours, detail: `${d.reference}, ${heures(d.unbilled)} à facturer` }))}
              />
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                {totaux.dossiers.map((d) => (
                  <Link key={d.id} className="rounded-md bg-accent-doux px-2 py-0.5 text-[12px] font-semibold text-accent hover:underline" href={`/axispro/dossiers/${d.id}`}>
                    {d.reference}
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>
        <Card title="Détail" padded={false} className="xl:col-span-2">
          {!data ? (
            <Etat error={error} onRetry={() => void mutate()} label="Chargement des temps…" />
          ) : (
            <>
              {error && <div className="px-4 pt-4"><ErrorBox titre="Rechargement impossible : le détail affiché peut dater." error={error} onRetry={() => void mutate()} /></div>}
              {rows.length >= LIMITE && (
                <div className="px-4 pt-4">
                  <Notice tone="neutral">Les {fmtInt(LIMITE)} saisies les plus récentes sont détaillées ; les totaux ci-dessus portent sur toutes{totaux ? `, soit ${pluriel(totaux.count, "saisie")}` : ""}.</Notice>
                </div>
              )}
              <DataTable dense rows={rows} rowKey={(t) => t.id} empty="Aucun temps." columns={[
                { key: "date", label: "Date", render: (t) => fmtDate(t.date) },
                { key: "dossier", label: "Dossier", render: (t) => t.dossier.reference },
                { key: "user", label: "Consultant" },
                { key: "description", label: "Travaux" },
                { key: "hours", label: "Heures", align: "right", render: (t) => fmtDec(t.hours) },
                { key: "invoice", label: "Facture", render: (t) => t.invoice ?? (t.billable ? <Badge tone="warn">À facturer</Badge> : "Non facturable") },
              ]} />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
