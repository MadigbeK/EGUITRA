"use client";

import { useEffect, useState } from "react";
import { Button, Card, Etat, Field, Input, Notice, PageHeader, Select } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, fmtDec, lireNombre, nombreIllisible } from "@/lib/format";

/**
 * Réglages des achats et des ventes de la société de travail (administration et finance) : validité des
 * offres, relance avant expiration, rapprochement des pièces d'achat, règle des trois devis, numérotation.
 * Routes : GET et PATCH /commerce/settings (addons/eguitra_commerce/controllers/settings.py).
 */
interface Numerotation { code: string; label: string; prefix: string; padding: number; next_number: number; next: string }
interface Reglages {
  company: { id: number; name: string };
  validity_days: number;
  reminder_days: number;
  match_qty_tolerance: number;
  match_price_tolerance: number;
  match_mode: "approval" | "block";
  match_modes: Array<{ value: string; label: string }>;
  three_quotes_threshold: number;
  numbering: Numerotation[];
}

export default function ReglagesCommercePage() {
  const { data, error, mutate } = useApi<Reglages>("/commerce/settings");
  const envoi = useEnvoi();
  const [f, setF] = useState<Record<string, string>>({});
  const [num, setNum] = useState<Record<string, { prefix: string; next_number: string }>>({});
  useEffect(() => {
    if (!data) return;
    setF({
      validity_days: String(data.validity_days), reminder_days: String(data.reminder_days),
      match_qty_tolerance: fmtDec(data.match_qty_tolerance), match_price_tolerance: fmtDec(data.match_price_tolerance),
      match_mode: data.match_mode, three_quotes_threshold: fmtDec(data.three_quotes_threshold),
    });
    setNum(Object.fromEntries(data.numbering.map((n) => [n.code, { prefix: n.prefix, next_number: String(n.next_number) }])));
  }, [data]);
  const nombres = ["validity_days", "reminder_days", "match_qty_tolerance", "match_price_tolerance", "three_quotes_threshold"];
  const illisible = nombres.some((k) => nombreIllisible(f[k])) || Object.values(num).some((n) => nombreIllisible(n.next_number));

  async function enregistrer() {
    if (!data) return;
    const body: Record<string, unknown> = { match_mode: f.match_mode };
    for (const k of nombres) body[k] = lireNombre(f[k]) ?? 0;
    const numbering: Record<string, unknown> = {};
    for (const n of data.numbering) {
      const v = num[n.code];
      if (!v) continue;
      const change: Record<string, unknown> = {};
      if (v.prefix !== n.prefix) change.prefix = v.prefix;
      if (Number(v.next_number) !== n.next_number) change.next_number = lireNombre(v.next_number);
      if (Object.keys(change).length) numbering[n.code] = change;
    }
    if (Object.keys(numbering).length) body.numbering = numbering;
    if (await envoi.run("enregistrer", () => apiSend("PATCH", "/commerce/settings", body), "Réglages enregistrés.")) void mutate();
  }

  return (
    <div>
      <PageHeader title="Achats et ventes" subtitle="Réglages propres à la société de travail ; chaque modification est tracée dans le journal d'audit." />
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des réglages…">
        {(d) => (
          <div className="space-y-5">
            {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
            <Notice tone="neutral">Société : {d.company.name}. Changez de société en haut de l&apos;écran pour régler l&apos;autre.</Notice>
            <Card title="Offres commerciales">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Validité par défaut (jours)" error={nombreIllisible(f.validity_days) ? AIDE_NOMBRE : undefined}><Input inputMode="numeric" value={f.validity_days ?? ""} onChange={(e) => setF({ ...f, validity_days: e.target.value })} /></Field>
                <Field label="Relance de l'auteur avant expiration (jours)" hint="0 : pas de relance. Par courriel, si le serveur de courrier est paramétré."><Input inputMode="numeric" value={f.reminder_days ?? ""} onChange={(e) => setF({ ...f, reminder_days: e.target.value })} /></Field>
              </div>
            </Card>
            <Card title="Rapprochement des pièces d'achat avec les commandes">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Tolérance sur les quantités (%)" hint="Facturé admis au-delà du reçu."><Input inputMode="decimal" value={f.match_qty_tolerance ?? ""} onChange={(e) => setF({ ...f, match_qty_tolerance: e.target.value })} /></Field>
                <Field label="Tolérance sur les prix (%)" hint="Prix facturé admis au-delà du prix commandé."><Input inputMode="decimal" value={f.match_price_tolerance ?? ""} onChange={(e) => setF({ ...f, match_price_tolerance: e.target.value })} /></Field>
                <Field label="Une pièce en écart"><Select value={f.match_mode ?? "approval"} onChange={(e) => setF({ ...f, match_mode: e.target.value })} options={d.match_modes} /></Field>
              </div>
            </Card>
            <Card title="Devis fournisseurs">
              <Field label="Trois devis exigés au-delà de (GNF HT)" hint="Engagements de plus de ce montant : trois devis de fournisseurs différents et le devis retenu, motivé. 0 : règle désactivée."><Input inputMode="decimal" value={f.three_quotes_threshold ?? ""} onChange={(e) => setF({ ...f, three_quotes_threshold: e.target.value })} /></Field>
            </Card>
            <Card title="Numérotation">
              <div className="space-y-3">
                {d.numbering.map((n) => (
                  <div key={n.code} className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
                    <div className="text-sm font-semibold">{n.label}</div>
                    <Field label="Préfixe" hint="%(year)s : l'année."><Input value={num[n.code]?.prefix ?? ""} onChange={(e) => setNum({ ...num, [n.code]: { prefix: e.target.value, next_number: num[n.code]?.next_number ?? "" } })} /></Field>
                    <Field label="Prochain numéro"><Input inputMode="numeric" value={num[n.code]?.next_number ?? ""} onChange={(e) => setNum({ ...num, [n.code]: { prefix: num[n.code]?.prefix ?? "", next_number: e.target.value } })} /></Field>
                    <div className="text-sm text-muted">Prochain : <span className="font-mono text-ink">{n.next}</span></div>
                  </div>
                ))}
              </div>
            </Card>
            <Button variant="primary" loading={envoi.busy === "enregistrer"} disabled={illisible || !!envoi.busy} onClick={() => void enregistrer()}>Enregistrer les réglages</Button>
          </div>
        )}
      </Etat>
    </div>
  );
}
