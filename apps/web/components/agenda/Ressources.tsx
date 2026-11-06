"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Notice, Select, Textarea } from "@/components/ui";
import { apiSend, messageErreur, useApi } from "@/lib/api-client";
import type { Calendrier } from "@/lib/agenda";

const NATURES = [{ value: "room", label: "Salle de réunion" }, { value: "vehicle", label: "Véhicule de service" }, { value: "equipment", label: "Équipement" }, { value: "other", label: "Autre ressource" }];
type Reglages = { enabled: boolean; public_url: string | null; mail_server: boolean; open: boolean };
type Saisie = { id?: number; name: string; resource_type: string; capacity: number; location: string; description: string };
const VIDE: Saisie = { name: "", resource_type: "room", capacity: 0, location: "", description: "" };

/**
 * Administration de l'agenda : ressources réservables (salles, véhicules de service, équipements), leur
 * capacité et leur emplacement ; l'administration ne lit pas pour autant les réservations (« Réservé par … »
 * seulement). Ouverture de la prise de rendez-vous en ligne (adresse publique du site, serveur de courrier).
 */
export function Ressources() {
  const { data, error, mutate } = useApi<Calendrier[]>("/agenda/resources?all=1");
  const reglages = useApi<Reglages>("/agenda/admin/settings");
  const [saisie, setSaisie] = useState<Saisie>(VIDE);
  const [url, setUrl] = useState<string | null>(null);
  const [retour, setRetour] = useState<{ ton: "ok" | "danger"; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function agir(fn: () => Promise<unknown>, ok: string) {
    setOccupe(true);
    setRetour(null);
    try {
      await fn();
      setRetour({ ton: "ok", texte: ok });
      void mutate();
      void reglages.mutate();
    } catch (e) {
      setRetour({ ton: "danger", texte: messageErreur(e) });
    } finally {
      setOccupe(false);
    }
  }

  if (error) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Chargement des ressources…" />;
  const r = reglages.data;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Ressources réservables">
        {retour && <div className="mb-3"><Notice tone={retour.ton}>{retour.texte}</Notice></div>}
        <ul className="divide-y divide-line text-[13.5px]">
          {data.length === 0 && <li className="py-6 text-center text-muted">Aucune ressource : déclarez la première salle.</li>}
          {data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: c.color }} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{c.name}</span>
                <span className="block text-[12px] text-muted">{c.resource_label}{c.capacity ? `, ${c.capacity} places` : ""}{c.location ? `, ${c.location}` : ""}{c.company ? `, ${c.company}` : ""}</span>
              </span>
              {c.active === false ? <Badge tone="neutral">Retirée</Badge> : (
                <>
                  <Button size="sm" onClick={() => setSaisie({ id: c.id, name: c.name, resource_type: c.resource_type ?? "room", capacity: c.capacity ?? 0, location: c.location ?? "", description: c.description ?? "" })}>Modifier</Button>
                  <Button size="sm" variant="ghost" onClick={() => void agir(() => apiSend("DELETE", `/agenda/resources/${c.id}`), `${c.name} retirée : elle n'est plus réservable.`)}>Retirer</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <div className="space-y-5">
        <Card title={saisie.id ? "Modifier la ressource" : "Nouvelle ressource"}>
          <div className="space-y-3">
            <Field label="Nom"><Input value={saisie.name} onChange={(e) => setSaisie({ ...saisie, name: e.target.value })} placeholder="Salle du conseil" maxLength={80} /></Field>
            <Field label="Nature"><Select value={saisie.resource_type} onChange={(e) => setSaisie({ ...saisie, resource_type: e.target.value })} options={NATURES} /></Field>
            <Field label="Capacité" hint="Places d'une salle ou d'un véhicule ; 0 : sans limite."><Input type="number" min={0} value={saisie.capacity} onChange={(e) => setSaisie({ ...saisie, capacity: Number(e.target.value) || 0 })} /></Field>
            <Field label="Emplacement"><Input value={saisie.location} onChange={(e) => setSaisie({ ...saisie, location: e.target.value })} placeholder="Siège, 2e étage" /></Field>
            <Field label="Description"><Textarea value={saisie.description} onChange={(e) => setSaisie({ ...saisie, description: e.target.value })} maxLength={1000} /></Field>
            <div className="flex gap-2">
              <Button variant="primary" loading={occupe} disabled={!saisie.name.trim()} onClick={() => void agir(async () => {
                const { id, ...corps } = saisie;
                await (id ? apiSend("PATCH", `/agenda/resources/${id}`, corps) : apiSend("POST", "/agenda/resources", corps));
                setSaisie(VIDE);
              }, saisie.id ? "Ressource modifiée." : "Ressource créée.")}>{saisie.id ? "Enregistrer" : <><Plus className="h-4 w-4" /> Créer</>}</Button>
              {saisie.id && <Button onClick={() => setSaisie(VIDE)}>Annuler</Button>}
            </div>
          </div>
        </Card>
        {r && (
          <Card title="Prise de rendez-vous en ligne">
            <div className="space-y-3 text-[13.5px]">
              <p className="text-[12.5px] text-muted">Fermée par défaut. Ouverte, elle permet à chacun de publier un lien de réservation pour des personnes extérieures : créneaux libres seulement, domaines autorisés, confirmation par courriel, débit limité par adresse.</p>
              {!r.mail_server && <Notice tone="warn">Aucun serveur de courrier n&apos;est paramétré : la confirmation par courriel est impossible, la prise de rendez-vous reste fermée.</Notice>}
              <Field label="Adresse publique du site" hint="https://domaine, sans chemin : les liens de confirmation y renvoient.">
                <Input value={url ?? r.public_url ?? ""} onChange={(e) => setUrl(e.target.value)} placeholder="https://rdv.nimova.cloud" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void agir(() => apiSend("PATCH", "/agenda/admin/settings", { public_url: url ?? r.public_url ?? "" }), "Adresse enregistrée.")}>Enregistrer l&apos;adresse</Button>
                <Button variant={r.enabled ? "danger" : "primary"} onClick={() => void agir(() => apiSend("PATCH", "/agenda/admin/settings", { enabled: !r.enabled }), r.enabled ? "Prise de rendez-vous fermée." : "Prise de rendez-vous ouverte.")}>{r.enabled ? "Fermer" : "Ouvrir"}</Button>
              </div>
              <p className="text-[12.5px]">État : {r.open ? "ouverte" : r.enabled ? "activée, mais incomplète (adresse ou serveur de courrier manquant)" : "fermée"}.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
