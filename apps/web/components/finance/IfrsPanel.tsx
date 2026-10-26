"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Kpi, Modal, Notice, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { aujourdhui } from "@/lib/jour";
import { AIDE_NOMBRE, INSECABLE, fmtDec, fmtGNF, fmtInt, fmtShort, lireNombre, nombreIllisible } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes d'écriture de l'IFRS (addons/eguitra_finance/controllers/fiscal.py, FIN_WRITE) : matrice
// des pertes attendues et comptabilisation de l'ajustement. La direction lit la passerelle.
const ECRITURE: Profile[] = ["admin", "finance"];

interface Bridge {
  lines: Array<{ label: string; section: string; amount: number; syscohada: string[] }>;
  restatements: Array<{ standard: string; label: string; amount: number; quantified: boolean; note: string }>;
  net_result_syscohada: number;
  total_restatements: number;
  net_result_ifrs: number;
  note: string;
}
interface Ecl {
  buckets: Array<{ bucket: string; label: string; rate: number; exposure: number; ecl: number; count: number }>;
  partners: Array<{ partner_id: number | null; partner: string; vat: string | null; exposure: number; overdue: number; ecl: number; worst: string }>;
  exposure: number;
  ecl: number;
  existing_impairment: number;
  adjustment: number;
  posted: boolean;
}
type Policy = Record<"not_due" | "1_30" | "31_60" | "61_90" | "over_90" | "deferred_tax_rate", number>;

const BUCKET_LABEL: Record<string, string> = { not_due: "Non échu", "1_30": "1 à 30 j", "31_60": "31 à 60 j", "61_90": "61 à 90 j", over_90: "Plus de 90 j" };
const SECTION: Record<string, string> = { actif: "Bilan, actif", passif: "Bilan, passif", resultat: "Résultat" };
const TAUX = ["not_due", "1_30", "31_60", "61_90", "over_90", "deferred_tax_rate"] as const;
/** Taux : « 5 % », « 2,5 % » (jusqu'à deux décimales, espace insécable). */
const taux = (r: number) => `${fmtDec(r)}${INSECABLE}%`;

/** Passerelle IFRS : postes regroupés, retraitements chiffrés, pertes de crédit attendues (IFRS 9). */
export function IfrsPanel({ scope }: { scope: string }) {
  const [date, setDate] = useState(aujourdhui);
  const { data, error, mutate } = useApi<Bridge>(date ? `/finance/ifrs?date=${date}&scope=${scope}` : null);
  return (
    <div className="space-y-6">
      <Field label="Arrêté au" className="no-print max-w-xs">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul de la passerelle IFRS…">
        {(d) => (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Kpi label="Résultat net SYSCOHADA" value={fmtShort(d.net_result_syscohada)} />
              <Kpi label="Retraitements chiffrés" value={fmtShort(d.total_restatements)} tone={d.total_restatements < 0 ? "warn" : "neutral"} />
              <Kpi label="Résultat net IFRS" value={fmtShort(d.net_result_ifrs)} tone="accent" />
            </div>
            <Card title="Retraitements" padded={false}>
              <DataTable
                dense
                rows={d.restatements}
                rowKey={(r) => r.standard}
                columns={[
                  { key: "standard", label: "Norme" },
                  { key: "label", label: "Retraitement" },
                  { key: "amount", label: "Impact sur le résultat", align: "right", render: (r) => (r.quantified ? fmtGNF(r.amount) : <Badge tone="neutral">Non chiffré</Badge>) },
                  { key: "note", label: "Lecture", render: (r) => <span className="text-xs text-muted">{r.note}</span> },
                ]}
              />
            </Card>
            <EclCard date={date} groupe={scope === "group"} onChanged={() => mutate()} />
            <Notice tone="warn">{d.note}</Notice>
            <Card title="Postes IFRS" padded={false}>
              <DataTable
                dense
                rows={d.lines}
                rowKey={(l) => l.label}
                columns={[
                  { key: "section", label: "État", render: (l) => SECTION[l.section] ?? l.section },
                  { key: "label", label: "Poste IFRS" },
                  { key: "syscohada", label: "Rubriques SYSCOHADA", render: (l) => l.syscohada.join(", ") },
                  { key: "amount", label: "Montant", align: "right", render: (l) => fmtInt(l.amount) },
                ]}
              />
            </Card>
          </>
        )}
      </Etat>
    </div>
  );
}

/**
 * Pertes de crédit attendues de la société de travail : sa matrice, son ajustement et sa pièce ECL. Dans
 * la vue consolidée, le retraitement IFRS 9 additionne celles de chaque société ; la carte reste celle de
 * la société de travail, et le dit.
 */
function EclCard({ date, groupe, onChanged }: { date: string; groupe: boolean; onChanged: () => void }) {
  const { data, error, mutate } = useApi<Ecl>(date ? `/finance/ifrs/ecl?date=${date}` : null);
  const ecriture = useAutorise(ECRITURE);
  const [editing, setEditing] = useState(false);
  const envoi = useEnvoi();
  async function post() {
    const oui = await demanderConfirmation(
      "Comptabiliser l'ajustement de dépréciation du mois (pièce ECL) dans les livres de la société de travail ? Par défaut, la perte attendue reste un retraitement hors des livres ; une pièce passée ne s'annule que par extourne.",
      { action: "Comptabiliser", danger: true },
    );
    if (!oui) return;
    const resultat: { texte?: string } = {};
    const ok = await envoi.run("comptabiliser", async () => {
      const move = await apiSend<{ name: string; ref: string; amount: number }>("POST", "/finance/ifrs/ecl/post", { date });
      resultat.texte = `Pièce ${move.name} (${move.ref}) comptabilisée : ${fmtGNF(move.amount)}.`;
      await mutate();
      onChanged();
    }, undefined, "Comptabilisation impossible.");
    if (ok && resultat.texte) envoi.setMessage({ tone: "ok", text: resultat.texte });
  }
  return (
    <Card
      title={groupe ? "Pertes de crédit attendues (IFRS 9), société de travail" : "Pertes de crédit attendues (IFRS 9)"}
      padded={false}
      actions={
        ecriture ? (
          <div className="no-print flex gap-2">
            <Button size="sm" disabled={!!envoi.busy} onClick={() => setEditing(true)}>Matrice</Button>
            {data && !data.posted && data.adjustment !== 0 && (
              <Button size="sm" loading={envoi.busy === "comptabiliser"} disabled={!!envoi.busy} onClick={post}>Comptabiliser l&apos;ajustement</Button>
            )}
          </div>
        ) : undefined
      }
    >
      {groupe && (
        <div className="p-3">
          <Notice tone="accent">Vue consolidée : le retraitement IFRS 9 ci-dessus additionne les pertes attendues de chaque société. Cette carte, sa matrice et sa pièce ECL sont celles de la société de travail.</Notice>
        </div>
      )}
      {envoi.message && <div className="p-3"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
      <Etat data={data} error={error} onRetry={() => mutate()} label="Calcul des pertes attendues…">
        {(d) => (
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <Kpi label="Créances exposées" value={fmtShort(d.exposure)} />
              <Kpi label="Perte attendue" value={fmtShort(d.ecl)} />
              <Kpi label="Dépréciation déjà passée (491)" value={fmtShort(d.existing_impairment)} />
              <Kpi label={d.posted ? "Ajustement comptabilisé" : "Ajustement à retraiter"} value={fmtShort(d.adjustment)} tone={d.adjustment > 0 ? "warn" : "ok"} />
            </div>
            <DataTable dense rows={d.buckets} rowKey={(b) => b.bucket} columns={[
              { key: "label", label: "Ancienneté" },
              { key: "rate", label: "Taux", align: "right", render: (b) => taux(b.rate) },
              { key: "count", label: "Factures", align: "right", render: (b) => fmtInt(b.count) },
              { key: "exposure", label: "Encours", align: "right", render: (b) => fmtGNF(b.exposure) },
              { key: "ecl", label: "Perte attendue", align: "right", render: (b) => fmtGNF(b.ecl) },
            ]} />
            <DataTable dense rows={d.partners.slice(0, 20)} rowKey={(p) => p.partner_id ?? 0} empty="Aucune créance ouverte." columns={[
              { key: "partner", label: "Client" },
              { key: "exposure", label: "Encours", align: "right", render: (p) => fmtGNF(p.exposure) },
              { key: "overdue", label: "Dont échu", align: "right", render: (p) => fmtGNF(p.overdue) },
              { key: "worst", label: "Retard le plus ancien", render: (p) => BUCKET_LABEL[p.worst] ?? p.worst },
              { key: "ecl", label: "Perte attendue", align: "right", render: (p) => fmtGNF(p.ecl) },
            ]} />
          </div>
        )}
      </Etat>
      {editing && <PolicyForm onClose={() => setEditing(false)} onDone={() => { setEditing(false); envoi.setMessage({ tone: "ok", text: "Matrice enregistrée." }); void mutate(); onChanged(); }} />}
    </Card>
  );
}

function PolicyForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data, error, mutate } = useApi<Policy>("/finance/ifrs/policy");
  const [f, setF] = useState<Partial<Record<keyof Policy, string>>>({});
  const envoi = useEnvoi();
  const value = (key: keyof Policy) => f[key] ?? (data ? String(data[key]).replace(".", ",") : "");
  const lu = (key: keyof Policy) => (f[key] === undefined ? undefined : lireNombre(f[key]));
  const erreur = (key: keyof Policy): string | undefined => {
    const saisie = f[key];
    if (saisie === undefined) return undefined;
    if (nombreIllisible(saisie)) return AIDE_NOMBRE;
    const n = lireNombre(saisie);
    if (n === null) return "Taux requis.";
    if (n < 0 || n > 100 || (key === "deferred_tax_rate" && n >= 100)) return "Taux compris entre 0 et 100 %.";
    return undefined;
  };
  const modifies = TAUX.filter((key) => f[key] !== undefined);
  const pret = Boolean(data) && modifies.length > 0 && modifies.every((key) => !erreur(key));
  async function submit() {
    const payload = Object.fromEntries(modifies.map((key) => [key, lu(key)]));
    const ok = await envoi.run("enregistrer", () => apiSend("PATCH", "/finance/ifrs/policy", payload), undefined, "Enregistrement impossible.");
    if (ok) onDone();
  }
  return (
    <Modal open title="Matrice des pertes attendues" onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={!pret || !!envoi.busy} onClick={submit}>Enregistrer</Button>}>
      <div className="space-y-3">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
        <Notice tone="accent">Taux appliqués à l&apos;encours de chaque facture selon son ancienneté ; à arrêter avec l&apos;expert-comptable.</Notice>
        <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement de la matrice…">
          <div className="grid grid-cols-2 gap-3">
            {(["not_due", "1_30", "31_60", "61_90", "over_90"] as const).map((key) => (
              <Field key={key} label={`${BUCKET_LABEL[key]} (%)`} error={erreur(key)}>
                <Input inputMode="decimal" value={value(key)} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
              </Field>
            ))}
            <Field label="Taux d'impôt différé (%)" hint="IAS 12 ; 0 : non chiffré" error={erreur("deferred_tax_rate")}>
              <Input inputMode="decimal" value={value("deferred_tax_rate")} onChange={(e) => setF({ ...f, deferred_tax_rate: e.target.value })} />
            </Field>
          </div>
        </Etat>
      </div>
    </Modal>
  );
}
