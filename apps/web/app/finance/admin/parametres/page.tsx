"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Notice, PageHeader, Select, Tag } from "@/components/ui";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { GRAVITES, gravite } from "@/components/finance/Pilotage";
import { useEnvoi } from "@/lib/envoi";
import { aujourdhui } from "@/lib/jour";
import type { AlertUnit, Severity } from "@/lib/finance-types";
import type { Profile } from "@/lib/types";
import { AIDE_NOMBRE, INSECABLE, fmtDate, fmtDec, lireNombre, nombreIllisible } from "@/lib/format";

interface Threshold { id: number; code: string; label: string; value: number; severity: Severity; active: boolean; domain: string | null; unit: AlertUnit | null; zero_disables: boolean; applicable: boolean }

const UNITE: Record<AlertUnit, string> = { gnf: "GNF", pct: "%", days: "jours", ratio: "ratio", count: "nombre", none: "" };
interface Currency { id: number; name: string; symbol: string; rate: number; inverse_rate: number; date: string | null }

// Profils des routes d'écriture du noyau : seuils (PATCH /finance/thresholds, dashboard.py) et comptes de
// trésorerie (POST /finance/treasury/journals, treasury.py) à l'administration seule ; taux de change
// (POST /finance/currencies/rates, moves.py) à l'administration et à la finance. Les autres consultent.
const SEUILS: Profile[] = ["admin"];
const TAUX: Profile[] = ["admin", "finance"];
const COMPTES: Profile[] = ["admin"];

export default function SettingsPage() {
  const { data: thresholds, error: erreurSeuils, mutate } = useApi<Threshold[]>("/finance/thresholds");
  const { data: currencies, error: erreurDevises, mutate: refreshRates } = useApi<Currency[]>("/finance/currencies");
  const ecriture = useAutorise(SEUILS);
  const envoi = useEnvoi();
  const save = (t: Threshold, patch: Partial<Threshold>) =>
    void envoi.run(`seuil-${t.id}`, async () => {
      await apiSend("PATCH", `/finance/thresholds/${t.id}`, patch);
      await mutate();
    }, `Seuil « ${t.label} » enregistré.`);
  return (
    <div className="space-y-6">
      <PageHeader title="Seuils et taux" subtitle="Seuils d'alerte de la société de travail (une valeur à 0 éteint les règles de montant, de durée ou de taux ; ailleurs, 0 vaut aucune tolérance), taux de change, comptes de banque et de caisse." />
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      <Card title="Seuils d'alerte" padded={false}>
        {thresholds && !ecriture && <p className="px-5 pb-3 text-sm text-muted">Seuils tenus par l&apos;administration : consultation seulement.</p>}
        <Etat data={thresholds} error={erreurSeuils} onRetry={() => mutate()}>
          {(rows) => (
            <DataTable
              rows={rows.filter((t) => t.applicable)}
              rowKey={(t) => t.id}
              columns={[
                { key: "domain", label: "Domaine", render: (t) => t.domain ?? "–" },
                {
                  key: "label",
                  label: "Seuil",
                  render: (t) => (
                    <span>
                      {t.label}
                      {t.zero_disables && !t.value && t.active && <span className="ml-2 text-[12px] font-semibold text-warn">règle éteinte (0)</span>}
                    </span>
                  ),
                },
                {
                  key: "value",
                  label: "Valeur",
                  render: (t) =>
                    t.unit === "none" ? (
                      <span className="text-[12.5px] text-muted">Règle sans valeur</span>
                    ) : ecriture ? (
                      <ValeurSeuil key={`${t.id}-${t.value}`} t={t} busy={envoi.busy !== null} onSave={(value) => save(t, { value })} />
                    ) : (
                      <span className="font-mono tabular">{`${fmtDec(t.value)}${t.unit ? `${INSECABLE}${UNITE[t.unit]}` : ""}`}</span>
                    ),
                },
                {
                  key: "severity",
                  label: "Gravité",
                  render: (t) =>
                    ecriture ? (
                      <Select aria-label={`Gravité : ${t.label}`} value={t.severity} disabled={envoi.busy !== null} onChange={(e) => save(t, { severity: e.target.value as Threshold["severity"] })} options={GRAVITES} />
                    ) : (
                      <Badge tone={gravite(t.severity).tone}>{gravite(t.severity).label}</Badge>
                    ),
                },
                {
                  key: "active",
                  label: "Actif",
                  render: (t) =>
                    ecriture ? (
                      <input type="checkbox" aria-label={`Seuil actif : ${t.label}`} checked={t.active} disabled={envoi.busy !== null} onChange={(e) => save(t, { active: e.target.checked })} />
                    ) : t.active ? (
                      <Badge tone="ok">Actif</Badge>
                    ) : (
                      <Badge>Inactif</Badge>
                    ),
                },
              ]}
            />
          )}
        </Etat>
      </Card>
      <Card title="Taux de change" padded={false}>
        <Etat data={currencies} error={erreurDevises} onRetry={() => refreshRates()}>
          {(liste) => <Rates currencies={liste} onSaved={() => refreshRates()} />}
        </Etat>
      </Card>
      <Card title="Comptes de banque et de caisse" padded={false}>
        <Etat data={currencies} error={erreurDevises} onRetry={() => refreshRates()}>
          {(liste) => <TreasuryAccounts currencies={liste} />}
        </Etat>
      </Card>
    </div>
  );
}

/**
 * Valeur d'un seuil, enregistrée à la sortie du champ ou sur Entrée. Une saisie illisible (« 2.500.000 »)
 * ou vide est signalée sous le champ et n'est pas envoyée : lue 0, elle éteindrait la règle en silence.
 */
function ValeurSeuil({ t, busy, onSave }: { t: Threshold; busy: boolean; onSave: (value: number) => void }) {
  const [saisie, setSaisie] = useState(fmtDec(t.value));
  const [erreur, setErreur] = useState<string | null>(null);
  function valider(texte: string) {
    if (!texte.trim()) return setErreur("Valeur requise : saisissez 0 pour éteindre la règle.");
    if (nombreIllisible(texte)) return setErreur(AIDE_NOMBRE);
    setErreur(null);
    const valeur = lireNombre(texte);
    if (valeur !== null && valeur !== t.value) onSave(valeur);
  }
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-2">
        <Input
          aria-label={`Valeur : ${t.label}`}
          aria-invalid={erreur ? true : undefined}
          inputMode="decimal"
          className="w-40 text-right font-mono"
          value={saisie}
          disabled={busy}
          onChange={(e) => {
            setSaisie(e.target.value);
            if (erreur) setErreur(null);
          }}
          onBlur={(e) => valider(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") valider(e.currentTarget.value);
          }}
        />
        <span className="text-[12px] text-muted">{t.unit ? UNITE[t.unit] : ""}</span>
      </span>
      {erreur && <span className="mt-1 max-w-[16rem] text-[12px] font-medium leading-snug text-danger">{erreur}</span>}
    </span>
  );
}

interface TreasuryAccount { journal_id: number; name: string; type: "bank" | "cash"; company: string; currency: string }

/** Nouveau compte de trésorerie de la société de travail : journal et compte 52x (banque) ou 57x (caisse). */
function TreasuryAccounts({ currencies }: { currencies: Currency[] }) {
  const { data, error, mutate } = useApi<{ accounts: TreasuryAccount[] }>("/finance/treasury");
  const creation = useAutorise(COMPTES);
  const [f, setF] = useState({ name: "", type: "bank", code: "", bank_account_number: "", currency_id: "" });
  const envoi = useEnvoi();
  async function create() {
    let nom = "";
    const ok = await envoi.run("creer", async () => {
      const res = await apiSend<{ name: string; account: string | null }>("POST", "/finance/treasury/journals", {
        name: f.name.trim(), type: f.type, code: f.code.trim(), bank_account_number: f.bank_account_number.trim() || undefined,
        currency_id: f.currency_id ? Number(f.currency_id) : undefined,
      });
      nom = `Compte « ${res.name} » créé${res.account ? ` (compte ${res.account})` : ""}.`;
    });
    if (ok) {
      envoi.setMessage({ tone: "ok", text: nom });
      setF({ name: "", type: "bank", code: "", bank_account_number: "", currency_id: "" });
      void mutate();
    }
  }
  return (
    <div>
      <Etat data={data} error={error} onRetry={() => mutate()}>
        {(d) => (
          <DataTable
            rows={d.accounts}
            rowKey={(a) => a.journal_id}
            empty="Aucun compte de trésorerie."
            columns={[
              { key: "name", label: "Compte" },
              { key: "type", label: "Nature", render: (a) => (a.type === "bank" ? "Banque" : "Caisse") },
              { key: "currency", label: "Devise" },
              { key: "company", label: "Société" },
            ]}
          />
        )}
      </Etat>
      {creation && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          {envoi.message && <div className="w-full"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
          <Field label="Intitulé"><Input value={f.name} placeholder="Banque, agence" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Nature"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: "bank", label: "Banque" }, { value: "cash", label: "Caisse" }]} /></Field>
          <Field label="Code (5 caractères)"><Input className="w-28 font-mono uppercase" maxLength={5} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          {f.type === "bank" && <Field label="Numéro de compte"><Input className="font-mono" value={f.bank_account_number} onChange={(e) => setF({ ...f, bank_account_number: e.target.value })} /></Field>}
          <Field label="Devise"><Select value={f.currency_id} placeholder="Devise de la société" onChange={(e) => setF({ ...f, currency_id: e.target.value })} options={currencies.filter((c) => c.name !== "GNF").map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Button variant="primary" loading={envoi.busy === "creer"} disabled={!f.name.trim() || !f.code.trim()} onClick={create}>Créer le compte</Button>
        </div>
      )}
    </div>
  );
}

function Rates({ currencies, onSaved }: { currencies: Currency[]; onSaved: () => void }) {
  const foreign = currencies.filter((c) => c.name !== "GNF");
  const saisie = useAutorise(TAUX);
  const [form, setForm] = useState({ currency_id: String(foreign[0]?.id ?? ""), gnf_per_unit: "", date: aujourdhui() });
  const envoi = useEnvoi();
  const taux = lireNombre(form.gnf_per_unit);
  const tauxIllisible = nombreIllisible(form.gnf_per_unit);
  const tauxNegatif = taux !== null && taux <= 0;
  async function enregistrer() {
    if (taux === null || taux <= 0) return;
    const ok = await envoi.run("taux", () => apiSend("POST", "/finance/currencies/rates", { currency_id: Number(form.currency_id), gnf_per_unit: taux, date: form.date }), "Taux enregistré.");
    if (ok) {
      setForm({ ...form, gnf_per_unit: "" });
      onSaved();
    }
  }
  return (
    <div>
      <DataTable
        rows={foreign}
        rowKey={(c) => c.id}
        empty="Aucune devise étrangère active."
        columns={[
          { key: "name", label: "Devise" },
          { key: "inverse_rate", label: "1 unité = … GNF", align: "right", render: (c) => fmtDec(c.inverse_rate) },
          { key: "date", label: "Date du taux", render: (c) => fmtDate(c.date) },
          { key: "x", label: "", render: () => <Tag>BCRG ou saisie</Tag> },
        ]}
      />
      {saisie && foreign.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          {envoi.message && <div className="w-full"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
          <Field label="Devise">
            <Select value={form.currency_id} onChange={(e) => setForm({ ...form, currency_id: e.target.value })} options={foreign.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="1 unité = … GNF" error={tauxIllisible ? AIDE_NOMBRE : tauxNegatif ? "Le taux doit être positif." : undefined}>
            <Input inputMode="decimal" className="font-mono" aria-invalid={tauxIllisible || tauxNegatif || undefined} value={form.gnf_per_unit} onChange={(e) => setForm({ ...form, gnf_per_unit: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Button variant="primary" loading={envoi.busy === "taux"} disabled={!form.currency_id || !form.date || taux === null || taux <= 0} onClick={enregistrer}>
            Enregistrer le taux
          </Button>
        </div>
      )}
    </div>
  );
}
