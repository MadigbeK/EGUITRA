"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Notice, PageHeader, Select } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDec } from "@/lib/format";

interface Threshold { id: number; code: string; label: string; value: number; severity: "info" | "warning" | "blocking"; active: boolean }
interface Currency { id: number; name: string; symbol: string; rate: number; inverse_rate: number; date: string | null }

export default function SettingsPage() {
  const { data: thresholds, mutate } = useApi<Threshold[]>("/finance/thresholds");
  const { data: currencies, mutate: refreshRates } = useApi<Currency[]>("/finance/currencies");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function save(t: Threshold, patch: Partial<Threshold>) {
    try {
      await apiSend("PATCH", `/finance/thresholds/${t.id}`, patch);
      setMessage({ tone: "ok", text: `Seuil « ${t.label} » enregistré.` });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Erreur" });
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Seuils et taux" subtitle="Seuils d'alerte de la société de travail et taux de change." />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Card title="Seuils d'alerte" padded={false}>
        {!thresholds ? (
          <Loading />
        ) : (
          <DataTable
            rows={thresholds}
            rowKey={(t) => t.id}
            columns={[
              { key: "label", label: "Seuil" },
              { key: "value", label: "Valeur", render: (t) => <Input className="w-40 text-right font-mono" defaultValue={String(t.value)} onBlur={(e) => Number(e.target.value) !== t.value && save(t, { value: Number(e.target.value) })} /> },
              {
                key: "severity",
                label: "Gravité",
                render: (t) => (
                  <Select value={t.severity} onChange={(e) => save(t, { severity: e.target.value as Threshold["severity"] })} options={[{ value: "info", label: "Information" }, { value: "warning", label: "Attention" }, { value: "blocking", label: "Bloquante" }]} />
                ),
              },
              { key: "active", label: "Actif", render: (t) => <input type="checkbox" checked={t.active} onChange={(e) => save(t, { active: e.target.checked })} /> },
            ]}
          />
        )}
      </Card>
      <Card title="Taux de change" padded={false}>
        {!currencies ? <Loading /> : <Rates currencies={currencies} onSaved={() => refreshRates()} />}
      </Card>
    </div>
  );
}

function Rates({ currencies, onSaved }: { currencies: Currency[]; onSaved: () => void }) {
  const foreign = currencies.filter((c) => c.name !== "GNF");
  const [form, setForm] = useState({ currency_id: String(foreign[0]?.id ?? ""), gnf_per_unit: "", date: new Date().toISOString().slice(0, 10) });
  const [message, setMessage] = useState<string | null>(null);
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
          { key: "x", label: "", render: () => <Badge>BCRG ou saisie</Badge> },
        ]}
      />
      <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
        {message && <Notice>{message}</Notice>}
        <Field label="Devise">
          <Select value={form.currency_id} onChange={(e) => setForm({ ...form, currency_id: e.target.value })} options={foreign.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="1 unité = … GNF">
          <Input inputMode="decimal" className="font-mono" value={form.gnf_per_unit} onChange={(e) => setForm({ ...form, gnf_per_unit: e.target.value })} />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Button
          variant="primary"
          disabled={!form.currency_id || !form.gnf_per_unit}
          onClick={() =>
            apiSend("POST", "/finance/currencies/rates", { currency_id: Number(form.currency_id), gnf_per_unit: Number(form.gnf_per_unit.replace(",", ".")), date: form.date })
              .then(() => {
                setMessage("Taux enregistré.");
                onSaved();
              })
              .catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"))
          }
        >
          Enregistrer le taux
        </Button>
      </div>
    </div>
  );
}
