"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, Search } from "@/components/icons";
import { BadgeEtat } from "@/components/service-client/commun";
import { Button, Card, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { apiGet, apiSend, messageErreur, useApi } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";
import { CANAUX, PRIORITES, TYPES, type ContexteSC, type EtatDossier, type FicheDossier } from "@/lib/service-client";

interface DossierOuvert {
  id: number;
  name: string;
  subject: string;
  state: EtatDossier;
  state_label: string;
  date_open: string;
}

interface Recherche {
  partners: Array<{ id: number; name: string; email: string | null; phone: string | null; open: DossierOuvert[]; accounts: number }>;
  contacts: Array<{ name: string | null; email: string | null; phone: string | null; open: DossierOuvert[] }>;
}

/**
 * Saisie pendant un appel, une visite ou un courrier : on cherche d'abord le client (nom, téléphone,
 * courriel), ses dossiers en cours s'affichent aussitôt ; on rejoint l'un d'eux ou on ouvre un nouveau
 * dossier. Priorité et équipe gardent leurs valeurs par défaut, repliées sous « Plus de détails ».
 */
export default function NouveauDossierPage() {
  const router = useRouter();
  const { data: ctx } = useApi<ContexteSC>("/service-client/context");
  const [saisie, setSaisie] = useState("");
  const [trouves, setTrouves] = useState<Recherche | null>(null);
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ contact_name: "", contact_phone: "", contact_email: "", channel: "phone", kind: "request", priority: "normal", category_id: "", subject: "", description: "", user_id: "", team_id: "", answer: "" });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const q = saisie.trim();
    if (q.length < 2) {
      setTrouves(null);
      return;
    }
    const t = setTimeout(() => {
      apiGet<Recherche>(`/service-client/clients?q=${encodeURIComponent(q)}`).then(setTrouves).catch(() => setTrouves(null));
    }, 300);
    return () => clearTimeout(t);
  }, [saisie]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function enregistrer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const corps: Record<string, unknown> = { ...f, category_id: f.category_id ? Number(f.category_id) : null, user_id: f.user_id ? Number(f.user_id) : null, team_id: f.team_id ? Number(f.team_id) : null };
      if (client) corps.partner_id = client.id;
      for (const k of ["contact_name", "contact_phone", "contact_email", "answer", "description"]) if (!corps[k]) delete corps[k];
      if (!corps.category_id) delete corps.category_id;
      const fiche = await apiSend<FicheDossier>("POST", "/service-client/tickets", corps);
      router.push(`/service-client/dossiers/${fiche.id}`);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  return (
    <div>
      <Link href="/service-client" className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
        <ChevronLeft className="h-4 w-4" /> Dossiers
      </Link>
      <PageHeader title="Nouveau dossier" subtitle="Pendant l'appel : retrouvez le client, voyez ses dossiers en cours, puis notez la demande et, s'il y a lieu, la réponse donnée sur-le-champ." />
      {/* Le client d'abord : ses dossiers en cours s'affichent avant toute saisie (rejoindre plutôt que doubler). */}
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Le client">
            <Field label="Rechercher" hint="Nom, téléphone ou courriel ; les tiers de la société et les contacts déjà connus.">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} className="pl-9" placeholder="Nom, 621 00 00 00, adresse…" />
              </div>
            </Field>
            {client ? (
              <Notice tone="ok">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Client : <strong>{client.name}</strong>
                  </span>
                  <Button size="sm" onClick={() => setClient(null)}>
                    Changer
                  </Button>
                </span>
              </Notice>
            ) : null}
            {trouves && (
              <div className="mt-4 space-y-3">
                {trouves.partners.length === 0 && trouves.contacts.length === 0 && <p className="text-[13px] text-muted">Aucun client trouvé : saisissez le contact dans « Le contact ».</p>}
                {trouves.partners.map((p) => (
                  <div key={p.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <span className="block font-semibold text-ink">{p.name}</span>
                        <span className="block text-[12.5px] text-muted">{[p.phone, p.email].filter(Boolean).join(" · ") || "Sans coordonnées"}</span>
                      </span>
                      <Button size="sm" onClick={() => setClient({ id: p.id, name: p.name })}>
                        Choisir
                      </Button>
                    </div>
                    <Ouverts dossiers={p.open} />
                  </div>
                ))}
                {trouves.contacts.map((c, i) => (
                  <div key={i} className="rounded-xl border border-dashed border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <span className="block font-semibold text-ink">{c.name ?? "Contact"}</span>
                        <span className="block text-[12.5px] text-muted">Contact non client · {[c.phone, c.email].filter(Boolean).join(" · ")}</span>
                      </span>
                      <Button size="sm" onClick={() => setF({ ...f, contact_name: c.name ?? "", contact_phone: c.phone ?? "", contact_email: c.email ?? "" })}>
                        Reprendre
                      </Button>
                    </div>
                    <Ouverts dossiers={c.open} />
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Le contact">
            <div className="space-y-3">
              <Field label="Nom">
                <Input value={f.contact_name} onChange={set("contact_name")} maxLength={120} />
              </Field>
              <Field label="Téléphone">
                <Input value={f.contact_phone} onChange={set("contact_phone")} maxLength={40} inputMode="tel" />
              </Field>
              <Field label="Courriel">
                <Input value={f.contact_email} onChange={set("contact_email")} maxLength={254} type="email" />
              </Field>
            </div>
          </Card>
        </div>
        <Card title="Le dossier">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Objet" className="sm:col-span-2">
              <Input value={f.subject} onChange={set("subject")} maxLength={200} placeholder="Par exemple : livraison incomplète du 28 octobre" />
            </Field>
            <Field label="Canal d'arrivée">
              <Select value={f.channel} onChange={set("channel")} options={CANAUX.map((c) => ({ value: c.value, label: c.label }))} />
            </Field>
            <Field label="Catégorie">
              <Select value={f.category_id} onChange={set("category_id")} options={[{ value: "", label: "À choisir" }, ...(ctx?.categories ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]} />
            </Field>
            <Field label="Type" hint="Une catégorie de réclamation propose le type « Réclamation ».">
              <Select value={f.kind} onChange={set("kind")} options={TYPES.map((t) => ({ value: t.value, label: t.label }))} />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea rows={5} value={f.description} onChange={set("description")} maxLength={10000} />
            </Field>
            <Field label="Responsable">
              <Select value={f.user_id} onChange={set("user_id")} options={[{ value: "", label: "Aucun pour l'instant" }, ...(ctx?.assignees ?? []).map((u) => ({ value: u.id, label: u.name }))]} />
            </Field>
            <Field label="Réponse donnée pendant l'appel (facultatif)" className="sm:col-span-2" hint="Notée comme première réponse au client, communiquée de vive voix.">
              <Textarea rows={3} value={f.answer} onChange={set("answer")} maxLength={10000} />
            </Field>
            {/* Priorité et équipe : valeurs par défaut (normale, celle de la catégorie), à changer au besoin. */}
            <details className="group sm:col-span-2">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Plus de détails : priorité ({PRIORITES.find((p) => p.value === f.priority)?.label.toLocaleLowerCase("fr") ?? f.priority}), équipe ({f.team_id ? (ctx?.teams ?? []).find((t) => String(t.id) === f.team_id)?.name ?? "choisie" : "celle de la catégorie"})
              </summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Priorité" hint="Elle fixe les délais de première réponse et de résolution.">
                  <Select value={f.priority} onChange={set("priority")} options={PRIORITES.map((p) => ({ value: p.value, label: p.label }))} />
                </Field>
                <Field label="Équipe">
                  <Select value={f.team_id} onChange={set("team_id")} options={[{ value: "", label: "Celle de la catégorie" }, ...(ctx?.teams ?? []).filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))]} />
                </Field>
              </div>
            </details>
          </div>
          {erreur && <p className="mt-4 text-[13px] font-semibold text-danger">{erreur}</p>}
          <div className="mt-5 flex justify-end">
            <Button variant="primary" loading={envoi} disabled={!f.subject.trim() || (!client && !f.contact_name.trim() && !f.contact_phone.trim() && !f.contact_email.trim())} onClick={enregistrer}>
              Enregistrer le dossier
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Ouverts({ dossiers }: { dossiers: DossierOuvert[] }) {
  if (!dossiers.length) return <p className="mt-2 text-[12.5px] text-muted">Aucun dossier en cours.</p>;
  return (
    <ul className="mt-2 space-y-1.5">
      {dossiers.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2 text-[13px]">
          <Link href={`/service-client/dossiers/${d.id}`} className="font-semibold tabular text-accent hover:underline">
            {d.name}
          </Link>
          <span className="text-ink-2">{d.subject}</span>
          <BadgeEtat etat={d.state} />
          <span className="text-[12px] text-muted">{fmtDate(d.date_open)}</span>
        </li>
      ))}
    </ul>
  );
}
