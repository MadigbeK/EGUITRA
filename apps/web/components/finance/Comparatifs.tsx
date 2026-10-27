"use client";

import { useState } from "react";
import { CheckCircle2, ShieldAlert, TriangleAlert } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Notice, cx, demanderConfirmation } from "@/components/ui";
import { ApiError, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { fmtDate, fmtDateTime, fmtGNF, pluriel } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes (addons/eguitra_finance/controllers/comparatives.py) : ceux de la validation de la
// reprise. Lecture par les profils de la finance ; import et remplacement par l'administration seule.
const IMPORT: Profile[] = ["admin"];

interface CheckItem { code: string; label: string; field: "gross" | "depreciation" | "amount"; expected: number; actual: number; gap: number }
interface Controle {
  code: string;
  label: string;
  ok: boolean | null;
  expected: number | null;
  actual: number | null;
  gap: number | null;
  detail: string;
  items: CheckItem[];
}
interface Comparatif {
  id: number;
  company: string;
  date_from: string;
  date_to: string;
  source: string | null;
  entity_name: string | null;
  entity_vat: string | null;
  imported_by: string | null;
  imported_at: string | null;
  notes: string[];
  checks: Controle[];
  conform: number;
  total: number;
}
interface Liste { company: string; default_date_to: string; items: Comparatif[] }
interface LigneOuverture {
  side: "actif" | "passif";
  code: string;
  label: string;
  total: boolean;
  detail: boolean;
  imported: Record<string, number>;
  opening: Record<string, number>;
  gaps: Record<string, number>;
  ok: boolean;
}
interface Ouverture { available: boolean; date_to: string; opening_date?: string; accounts?: number; rows?: LigneOuverture[]; gaps?: number }

const CHAMP: Record<string, string> = { gross: "brut", depreciation: "amort. et dépréc.", amount: "net" };

/**
 * Comparatifs du premier exercice : états de l'exercice précédent importés au modèle du système normal
 * (classeur de l'expert-comptable), contrôles affichés sans bloquer, bilan d'ouverture face aux
 * à-nouveaux. Ils servent de colonne N-1 des états tant que l'exercice précédent n'a pas d'écritures.
 */
export function Comparatifs() {
  const { data, error, mutate } = useApi<Liste>("/finance/comparatives");
  const importer = useAutorise(IMPORT);
  const envoi = useEnvoi();
  const [date, setDate] = useState<string | null>(null);
  const cloture = date ?? data?.default_date_to ?? "";

  async function envoyer(file: File, remplacer: boolean): Promise<void> {
    const form = new FormData();
    form.append("file", file);
    form.append("date_to", cloture);
    if (remplacer) form.append("replace", "1");
    await apiUpload("/finance/comparatives/import", form);
  }

  async function charger(file: File) {
    await envoi.run("import", async () => {
      let remplace = false;
      try {
        await envoyer(file, false);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        const oui = await demanderConfirmation(`${e.message} Les montants actuels seront remplacés par ceux du classeur ; le remplacement est inscrit à la piste d'audit.`, {
          action: "Remplacer l'import",
          danger: true,
        });
        if (!oui) return;
        await envoyer(file, true);
        remplace = true;
      }
      await mutate();
      envoi.setMessage({ tone: "ok", text: remplace ? "Import remplacé : contrôles ci-dessous." : "États importés : contrôles ci-dessous." });
    }, undefined, "Import impossible.");
  }

  return (
    <Card
      className="mt-6"
      title="Comparatifs du premier exercice"
      padded={false}
      actions={
        importer && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Exercice clos le">
              <Input type="date" value={cloture} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {envoi.busy === "import" ? (
              <Button size="sm" loading>Import du classeur</Button>
            ) : (
              <FileButton small label="États de l'exercice (.xlsx)" accept=".xlsx" onFile={(file) => void charger(file)} />
            )}
          </div>
        )
      }
    >
      <div className="space-y-3 px-4 py-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <p className="text-sm text-muted">
          Bilan, compte de résultat et tableau des flux de l&apos;exercice précédent, au modèle du système normal que remplit l&apos;expert-comptable (feuilles Bilan, Compte de Résultat, Tableau des flux de trésorerie ; lignes lues par leur code REF). Ils servent de colonne N-1 des états tant que cet exercice n&apos;a pas d&apos;écritures dans la plateforme.
          {!importer && " L'import est fait par l'administration."}
        </p>
        <Etat data={data} error={error} onRetry={() => mutate()} label="Lecture des comparatifs…">
          {(d) => (d.items.length === 0 ? <p className="text-sm text-muted">Aucun état importé pour {d.company}.</p> : <>{d.items.map((item) => <Fiche key={item.id} item={item} />)}</>)}
        </Etat>
      </div>
    </Card>
  );
}

function Statut({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Badge tone="neutral">Non vérifiable</Badge>;
  return ok ? <Badge tone="ok">Conforme</Badge> : <Badge tone="warn">Écart</Badge>;
}

function Fiche({ item }: { item: Comparatif }) {
  const [ouverture, setOuverture] = useState(false);
  return (
    <div className="rounded-lg bg-panel-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">
          Exercice du {fmtDate(item.date_from)} au {fmtDate(item.date_to)} : {pluriel(item.conform, "contrôle conforme", "contrôles conformes")} sur {item.total}
        </div>
        <Button size="sm" onClick={() => setOuverture((v) => !v)}>{ouverture ? "Masquer le bilan d'ouverture" : "Bilan d'ouverture"}</Button>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">
        {item.source ? `« ${item.source} »` : "Classeur"}
        {item.entity_name ? `, ${item.entity_name}` : ""}
        {item.entity_vat ? ` (NIF ${item.entity_vat})` : ""} ; importé par {item.imported_by ?? "–"} le {fmtDateTime(item.imported_at)}.
      </p>
      {item.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-2">
          {item.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <ul className="mt-3 space-y-2">
        {item.checks.map((c) => {
          const Icon = c.ok === null ? TriangleAlert : c.ok ? CheckCircle2 : ShieldAlert;
          return (
            <li key={c.code} className="flex items-start gap-3 rounded-lg bg-panel px-3 py-2">
              <Icon className={cx("mt-0.5 h-4 w-4 flex-none", c.ok === null ? "text-muted" : c.ok ? "text-ok" : "text-warn")} />
              <div className="flex-1 text-sm">
                <div className="text-ink">{c.label}</div>
                {c.gap !== null && !c.ok && (
                  <div className="text-xs text-muted">Attendu {fmtGNF(c.expected)}, lu {fmtGNF(c.actual)} : écart de {fmtGNF(c.gap)}.</div>
                )}
                {c.detail && (c.ok === null || !c.ok || c.code === "report_a_nouveau") && <div className="text-xs text-muted">{c.detail}</div>}
                {c.items.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                    {c.items.map((i) => (
                      <li key={`${i.code}-${i.field}`}>
                        <span className="font-mono">{i.code}</span> {i.label} ({CHAMP[i.field]}) : attendu {fmtGNF(i.expected)}, lu {fmtGNF(i.actual)}, écart {fmtGNF(i.gap)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Statut ok={c.ok} />
            </li>
          );
        })}
      </ul>
      {ouverture && <BilanOuverture dateTo={item.date_to} />}
    </div>
  );
}

/** Bilan des à-nouveaux (journal AN) à l'ouverture de l'exercice suivant, poste par poste face au bilan importé. */
function BilanOuverture({ dateTo }: { dateTo: string }) {
  const { data, error, mutate } = useApi<Ouverture>(`/finance/comparatives/opening?date_to=${dateTo}`);
  const [tout, setTout] = useState(false);
  return (
    <div className="mt-4">
      <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul du bilan d'ouverture…">
        {(d) => {
          if (!d.available || !d.rows) return <p className="text-sm text-muted">Aucun état importé pour cette date.</p>;
          const lignes = tout ? d.rows : d.rows.filter((r) => !r.ok);
          return (
            <>
              {d.accounts === 0 ? (
                <Notice tone="warn">Aucun à-nouveau (journal AN) dans l&apos;exercice ouvert le {fmtDate(d.opening_date)} : la reprise des soldes d&apos;ouverture reste à faire.</Notice>
              ) : d.gaps === 0 ? (
                <Notice tone="ok">Bilan d&apos;ouverture au {fmtDate(d.opening_date)} conforme au bilan importé, poste par poste.</Notice>
              ) : (
                <Notice tone="warn">
                  {pluriel(d.gaps ?? 0, "poste diffère", "postes diffèrent")} entre les à-nouveaux au {fmtDate(d.opening_date)} et le bilan importé. Le résultat de l&apos;exercice précédent se lit en CJ s&apos;il est repris au compte 13, en CH s&apos;il l&apos;est au compte 12 ou au compte d&apos;affectation du résultat.
                </Notice>
              )}
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={() => setTout((v) => !v)}>{tout ? "Écarts seulement" : "Tous les postes"}</Button>
              </div>
              {lignes.length > 0 && (
                <DataTable
                  dense
                  rows={lignes}
                  rowKey={(r) => r.code}
                  columns={[
                    { key: "code", label: "Réf.", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
                    { key: "label", label: "Poste", render: (r) => <span className={cx(r.total && "font-semibold", r.detail && "pl-4")}>{r.label}</span> },
                    { key: "imported", label: "Bilan importé (net)", align: "right", render: (r) => fmtGNF(r.imported.amount) },
                    { key: "opening", label: "À-nouveaux (net)", align: "right", render: (r) => fmtGNF(r.opening.amount) },
                    {
                      key: "gaps",
                      label: "Écarts",
                      align: "right",
                      render: (r) =>
                        r.ok ? (
                          "–"
                        ) : (
                          <span className="text-warn">
                            {Object.entries(r.gaps)
                              .filter(([, g]) => Math.abs(g) > 1)
                              .map(([k, g]) => `${CHAMP[k]} ${fmtGNF(g)}`)
                              .join(" ; ")}
                          </span>
                        ),
                    },
                  ]}
                />
              )}
            </>
          );
        }}
      </Etat>
    </div>
  );
}
