"use client";

import { useState, type ChangeEvent } from "react";
import { Building2, Trash2 } from "@/components/icons";
import { Button, Card, ErrorBox, Field, FileButton, Input, Loading, Notice, PageHeader } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";

interface CompanyRow {
  id: number;
  name: string;
  entity: "groupe" | "cabinet" | null;
  street: string | null;
  street2: string | null;
  zip: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  vat: string | null;
  company_registry: string | null;
  currency: string;
  country: string | null;
  logo: string | null;
}

const MAX_LOGO = 1024 * 1024;

/** Identité des sociétés : en-tête des factures, quittances et lettres de relance. */
export function CompaniesAdmin() {
  const { data, error, mutate } = useApi<CompanyRow[]>("/admin/companies");
  return (
    <div>
      <PageHeader
        title="Sociétés"
        subtitle="Raison sociale, coordonnées, identifiants légaux et logo de chaque société : ils figurent en tête des factures, des quittances et des lettres de relance. Chaque société garde sa propre comptabilité."
      />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      <div className="space-y-6">
        {data?.map((c) => <CompanyForm key={c.id} company={c} onSaved={() => mutate()} />)}
      </div>
    </div>
  );
}

function CompanyForm({ company, onSaved }: { company: CompanyRow; onSaved: () => void }) {
  const [f, setF] = useState({
    name: company.name, street: company.street ?? "", street2: company.street2 ?? "", zip: company.zip ?? "",
    city: company.city ?? "", phone: company.phone ?? "", email: company.email ?? "", website: company.website ?? "",
    vat: company.vat ?? "", company_registry: company.company_registry ?? "",
  });
  const [logo, setLogo] = useState<string | null | undefined>(undefined); // undefined : inchangé
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [key]: e.target.value });

  function pickLogo(file: File | undefined) {
    setMessage(null);
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) return setMessage({ tone: "danger", text: "Logo au format PNG ou JPEG seulement." });
    if (file.size > MAX_LOGO) return setMessage({ tone: "danger", text: "Logo trop volumineux (1 Mo au plus)." });
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await apiSend("PATCH", `/admin/companies/${company.id}`, logo === undefined ? f : { ...f, logo });
      setLogo(undefined);
      setMessage({ tone: "ok", text: "Société enregistrée." });
      onSaved();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    } finally {
      setBusy(false);
    }
  }

  const shown = logo === undefined ? company.logo : logo;
  return (
    <Card title={company.entity === "cabinet" ? "Cabinet" : "Groupe"}>
      <div className="space-y-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-16 w-40 place-items-center overflow-hidden rounded-lg border border-line bg-white">
            {shown ? <img src={shown} alt={`Logo de ${company.name}`} className="max-h-14 max-w-36 object-contain" /> : <Building2 className="h-6 w-6 text-muted" />}
          </div>
          <FileButton label={shown ? "Changer le logo" : "Ajouter le logo"} accept="image/png,image/jpeg" onFile={(f) => pickLogo(f)} />
          {shown && (
            <button type="button" className="inline-flex items-center gap-1 text-sm text-muted hover:text-danger" onClick={() => setLogo(null)}>
              <Trash2 className="h-4 w-4" /> Retirer
            </button>
          )}
          <span className="text-xs text-muted">Devise {company.currency}{company.country ? `, ${company.country}` : ""}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Raison sociale" className="md:col-span-2"><Input value={f.name} onChange={set("name")} /></Field>
          <Field label="Adresse"><Input value={f.street} onChange={set("street")} /></Field>
          <Field label="Complément d'adresse"><Input value={f.street2} onChange={set("street2")} /></Field>
          <Field label="Boîte postale"><Input value={f.zip} onChange={set("zip")} /></Field>
          <Field label="Ville"><Input value={f.city} onChange={set("city")} /></Field>
          <Field label="Téléphone"><Input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Courriel (expéditeur des relances)"><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="NIF"><Input value={f.vat} onChange={set("vat")} /></Field>
          <Field label="RCCM"><Input value={f.company_registry} onChange={set("company_registry")} /></Field>
          <Field label="Site internet" className="md:col-span-2"><Input value={f.website} onChange={set("website")} /></Field>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>Enregistrer</Button>
        </div>
      </div>
    </Card>
  );
}
