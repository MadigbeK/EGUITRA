"use client";

import { useState } from "react";
import { Badge, Button, Card, Etat, Field, Input, Notice, PageHeader } from "@/components/ui";
import { ApiError, apiGet, apiSend, messageErreur, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import type { Profile } from "@/lib/types";

// Profils des routes (controllers/invoicing.py d'eguitra_finance) : lecture par la finance, la direction et
// l'administration ; modification et aperçu de la numérotation par l'administration seule.
const REGLAGES: Profile[] = ["admin"];

interface SaleJournal {
  id: number;
  name: string;
  code: string;
  signatory: string;
  payment_methods: string;
  legacy_last_number: string | null;
  /** Dernière facture déjà numérotée : le dernier numéro de l'ancien système ne s'applique plus. */
  last_number: string | null;
  next_number: string | null;
}

interface BankJournal {
  id: number;
  name: string;
  code: string;
  currency: string;
  bank_name: string | null;
  account_number: string | null;
  iban: string | null;
  swift: string | null;
  show_on_invoices: boolean;
}

interface Settings {
  sales: SaleJournal[];
  banks: BankJournal[];
}

/** Refus de la numérotation : message et format continu le plus proche (dernier numéro à saisir). */
type Apercu = { next: string | null } | { refus: string; suggestion: string | null } | null;

/**
 * Réglages des factures imprimées de la société de travail : signataire, modes de règlement et numérotation
 * reprise de l'ancien système (journaux de vente) ; comptes bancaires listés dans les conditions de règlement.
 */
export default function InvoicingSettingsPage() {
  const { data, error, mutate } = useApi<Settings>("/finance/invoicing/settings");
  const reglage = useAutorise(REGLAGES);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Factures et journaux"
        subtitle="Ce que portent les factures de la société de travail : signataire et modes de règlement de chaque journal de vente, numéro de départ repris de l'ancien système, comptes bancaires listés au bas de la facture. L'identité de la société (adresse, téléphones, NIF, RCCM, slogan, logo) se règle dans Sociétés."
      />
      {data && !reglage && <Notice tone="accent">Réglages tenus par l&apos;administration : consultation seulement.</Notice>}
      <Card title="Journaux de vente">
        <Etat data={data} error={error} onRetry={() => mutate()}>
          {(d) =>
            d.sales.length ? (
              <div className="space-y-6">
                {d.sales.map((j) => <SaleJournalForm key={j.id} journal={j} reglage={reglage} onSaved={() => mutate()} />)}
              </div>
            ) : (
              <p className="text-sm text-muted">Aucun journal de vente dans la société.</p>
            )
          }
        </Etat>
      </Card>
      <Card title="Comptes bancaires portés sur les factures">
        <Etat data={data} error={error} onRetry={() => mutate()}>
          {(d) =>
            d.banks.length ? (
              <div className="space-y-6">
                <p className="text-sm text-muted">Chaque compte coché est listé dans les conditions de règlement des factures, avec sa banque, son numéro, son IBAN et son code SWIFT. Les comptes de trésorerie se créent dans Seuils et taux.</p>
                {d.banks.map((b) => <BankJournalForm key={b.id} journal={b} reglage={reglage} onSaved={() => mutate()} />)}
              </div>
            ) : (
              <p className="text-sm text-muted">Aucun compte bancaire dans la société.</p>
            )
          }
        </Etat>
      </Card>
    </div>
  );
}

function SaleJournalForm({ journal, reglage, onSaved }: { journal: SaleJournal; reglage: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ signatory: journal.signatory, payment_methods: journal.payment_methods, legacy_last_number: journal.legacy_last_number ?? "" });
  const [apercu, setApercu] = useState<Apercu>(null);
  const envoi = useEnvoi();
  const numerote = Boolean(journal.last_number);
  const changes = (Object.keys(f) as Array<keyof typeof f>).filter((k) => f[k] !== (k === "legacy_last_number" ? (journal.legacy_last_number ?? "") : journal[k]));

  /** Aperçu du numéro de la prochaine facture pour le dernier numéro saisi, avant l'enregistrement. */
  async function verifier(dernier: string) {
    if (!reglage || numerote || dernier.trim() === (journal.legacy_last_number ?? "")) return setApercu(null);
    try {
      const r = await apiGet<{ next_number: string | null }>(`/finance/invoicing/journals/${journal.id}/numbering?last=${encodeURIComponent(dernier.trim())}`);
      setApercu({ next: r.next_number });
    } catch (e) {
      const suggestion = e instanceof ApiError ? ((e.body as { suggestion?: string }).suggestion ?? null) : null;
      setApercu({ refus: messageErreur(e), suggestion });
    }
  }

  function enregistrer() {
    const body = Object.fromEntries(changes.map((k) => [k, f[k].trim()]));
    void envoi.run(`journal-${journal.id}`, async () => {
      const row = await apiSend<SaleJournal>("PATCH", `/finance/invoicing/journals/${journal.id}`, body);
      setF({ signatory: row.signatory, payment_methods: row.payment_methods, legacy_last_number: row.legacy_last_number ?? "" });
      setApercu(null);
      onSaved();
    }, `Journal « ${journal.name} » enregistré.`);
  }

  const prochain = apercu && "next" in apercu ? apercu.next : journal.next_number;
  const refus = apercu && "refus" in apercu ? apercu : null;
  return (
    <fieldset disabled={!reglage || envoi.busy !== null} className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{journal.name}</h3>
        <Badge>{journal.code}</Badge>
        {prochain && <span className="text-[13px] text-muted">Prochaine facture : <span className="font-mono text-ink">{prochain}</span></span>}
      </div>
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Signataire" hint="En bas à droite, au-dessus de la raison sociale">
          <Input value={f.signatory} maxLength={120} onChange={(e) => setF({ ...f, signatory: e.target.value })} />
        </Field>
        <Field label="Modes de règlement" hint="Ligne des conditions de règlement">
          <Input value={f.payment_methods} maxLength={200} onChange={(e) => setF({ ...f, payment_methods: e.target.value })} />
        </Field>
        <Field
          label="Dernier numéro de l'ancien système"
          hint={numerote ? `Le journal numérote déjà ses factures (dernière : ${journal.last_number}) : la numérotation continue d'elle-même.` : "La première facture validée prend le numéro suivant (EG24137 donne EG24138)."}
        >
          <Input
            className="font-mono"
            value={f.legacy_last_number}
            maxLength={40}
            disabled={numerote}
            placeholder="EG24137"
            onChange={(e) => {
              setF({ ...f, legacy_last_number: e.target.value });
              setApercu(null);
            }}
            onBlur={(e) => void verifier(e.target.value)}
          />
        </Field>
      </div>
      {refus && (
        <Notice tone="danger">
          {refus.refus}
          {refus.suggestion && reglage && (
            <span className="ml-2">
              <Button size="sm" onClick={() => { const s = refus.suggestion ?? ""; setF({ ...f, legacy_last_number: s }); void verifier(s); }}>
                Saisir « {refus.suggestion} »
              </Button>
            </span>
          )}
        </Notice>
      )}
      {reglage && (
        <div className="flex justify-end">
          <Button variant="primary" loading={envoi.busy === `journal-${journal.id}`} disabled={!changes.length || Boolean(refus)} onClick={enregistrer}>
            Enregistrer
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function BankJournalForm({ journal, reglage, onSaved }: { journal: BankJournal; reglage: boolean; onSaved: () => void }) {
  const initial = { bank_name: journal.bank_name ?? "", account_number: journal.account_number ?? "", iban: journal.iban ?? "", swift: journal.swift ?? "" };
  const [f, setF] = useState(initial);
  const [affiche, setAffiche] = useState(journal.show_on_invoices);
  const envoi = useEnvoi();
  const changes = (Object.keys(f) as Array<keyof typeof f>).filter((k) => f[k] !== initial[k]);
  const modifie = changes.length > 0 || affiche !== journal.show_on_invoices;

  function enregistrer() {
    const body: Record<string, unknown> = Object.fromEntries(changes.map((k) => [k, f[k].trim()]));
    if (affiche !== journal.show_on_invoices) body.show_on_invoices = affiche;
    void envoi.run(`banque-${journal.id}`, async () => {
      // Valeurs rendues par le noyau (IBAN et SWIFT en majuscules, sans espaces).
      const row = await apiSend<BankJournal>("PATCH", `/finance/invoicing/journals/${journal.id}`, body);
      setF({ bank_name: row.bank_name ?? "", account_number: row.account_number ?? "", iban: row.iban ?? "", swift: row.swift ?? "" });
      setAffiche(row.show_on_invoices);
      onSaved();
    }, `Compte « ${journal.name} » enregistré.`);
  }

  return (
    <fieldset disabled={!reglage || envoi.busy !== null} className="space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{journal.name}</h3>
        <Badge>{journal.code}</Badge>
        <span className="text-[13px] text-muted">{journal.currency}</span>
        {journal.show_on_invoices ? <Badge tone="ok">Sur les factures</Badge> : <Badge>Hors des factures</Badge>}
      </div>
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Banque"><Input value={f.bank_name} maxLength={120} onChange={(e) => setF({ ...f, bank_name: e.target.value })} /></Field>
        <Field label="Numéro de compte"><Input className="font-mono" value={f.account_number} maxLength={64} onChange={(e) => setF({ ...f, account_number: e.target.value })} /></Field>
        <Field label="IBAN" hint="Facultatif"><Input className="font-mono uppercase" value={f.iban} maxLength={42} onChange={(e) => setF({ ...f, iban: e.target.value })} /></Field>
        <Field label="Code SWIFT" hint="Facultatif"><Input className="font-mono uppercase" value={f.swift} maxLength={11} onChange={(e) => setF({ ...f, swift: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={affiche} onChange={(e) => setAffiche(e.target.checked)} /> Afficher sur les factures
        </label>
        {reglage && (
          <Button variant="primary" loading={envoi.busy === `banque-${journal.id}`} disabled={!modifie || (affiche && !f.account_number.trim())} onClick={enregistrer}>
            Enregistrer
          </Button>
        )}
      </div>
    </fieldset>
  );
}
