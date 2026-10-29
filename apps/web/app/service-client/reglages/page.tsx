"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Modal, Notice, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { apiSend, messageErreur, useApi } from "@/lib/api-client";
import { ACTIVITES, PRIORITES, TYPES, libelle, type Categorie, type ContexteSC, type Equipe, type Priorite, type Reglages, type ReponseType } from "@/lib/service-client";

type Onglet = "reglages" | "canaux" | "categories" | "equipes" | "modeles";

/** Réglages du service client de la société de travail : l'administration les modifie, les agents tiennent les réponses types. */
export default function ReglagesPage() {
  const { data: ctx, mutate: majCtx } = useApi<ContexteSC>("/service-client/context");
  const [onglet, setOnglet] = useState<Onglet>("reglages");
  const admin = ctx?.can.settings ?? false;
  return (
    <div>
      <PageHeader title="Réglages du service client" subtitle={`${ctx?.company.name ?? ""} : heures ouvrées, délais, escalade, canaux, catégories, équipes et réponses types.`} />
      <Tabs
        tabs={[
          { key: "reglages", label: "Délais et escalade" },
          { key: "canaux", label: "Canaux" },
          { key: "categories", label: "Catégories" },
          { key: "equipes", label: "Équipes" },
          { key: "modeles", label: "Réponses types" },
        ]}
        value={onglet}
        onChange={setOnglet}
      />
      <div className="mt-5">
        {onglet === "reglages" && <Delais admin={admin} />}
        {onglet === "canaux" && <Canaux admin={admin} />}
        {onglet === "categories" && ctx && <Categories admin={admin} ctx={ctx} onFait={() => void majCtx()} />}
        {onglet === "equipes" && ctx && <Equipes admin={admin} ctx={ctx} onFait={() => void majCtx()} />}
        {onglet === "modeles" && ctx && <Modeles agent={ctx.can.manage} ctx={ctx} onFait={() => void majCtx()} />}
      </div>
    </div>
  );
}

function useReglages() {
  return useApi<Reglages>("/service-client/settings");
}

function Delais({ admin }: { admin: boolean }) {
  const { data, error, mutate } = useReglages();
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const val = (k: string, defaut: string | number | boolean | null) => (k in f ? f[k] : defaut ?? "");
  async function enregistrer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const corps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) corps[k] = typeof v === "string" && k !== "public_url" ? Number(v.replace(",", ".")) : v;
      await mutate(await apiSend<Reglages>("PATCH", "/service-client/settings", corps), { revalidate: false });
      setF({});
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()}>
      {(r) => (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Heures ouvrées et délais">
            <p className="mb-3 text-[13px] text-ink-2">Du lundi au vendredi, jours fériés de la RH exclus. Les délais sont en heures ouvrées ; une catégorie peut en fixer de plus courts.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ouverture (heure)">
                <Input disabled={!admin} value={String(val("work_start", r.work_start))} onChange={(e) => setF({ ...f, work_start: e.target.value })} />
              </Field>
              <Field label="Fermeture (heure)">
                <Input disabled={!admin} value={String(val("work_end", r.work_end))} onChange={(e) => setF({ ...f, work_end: e.target.value })} />
              </Field>
            </div>
            <table className="mt-4 w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 font-medium">Priorité</th>
                  <th className="py-1 font-medium">Première réponse (h)</th>
                  <th className="py-1 font-medium">Résolution (h)</th>
                </tr>
              </thead>
              <tbody>
                {(["urgent", "high", "normal", "low"] as Priorite[]).map((p) => (
                  <tr key={p}>
                    <td className="py-1">{libelle(PRIORITES, p)}</td>
                    <td className="py-1 pr-2">
                      <Input disabled={!admin} value={String(val(`first_${p}`, r.delays[p].first))} onChange={(e) => setF({ ...f, [`first_${p}`]: e.target.value })} />
                    </td>
                    <td className="py-1">
                      <Input disabled={!admin} value={String(val(`resolution_${p}`, r.delays[p].resolution))} onChange={(e) => setF({ ...f, [`resolution_${p}`]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Escalade, clôture et messages automatiques">
            <div className="space-y-3">
              <Field label="Direction prévenue après (heures ouvrées de retard)" hint="Le responsable l'est dès le dépassement.">
                <Input disabled={!admin} value={String(val("escalation_hours", r.escalation_hours))} onChange={(e) => setF({ ...f, escalation_hours: e.target.value })} />
              </Field>
              <Field label="Dossier résolu clos d'office après (jours, 0 : jamais)">
                <Input disabled={!admin} value={String(val("auto_close_days", r.auto_close_days))} onChange={(e) => setF({ ...f, auto_close_days: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" disabled={!admin} checked={Boolean(val("ack_enabled", r.ack_enabled))} onChange={(e) => setF({ ...f, ack_enabled: e.target.checked })} /> Accusé de réception automatique (courriel, WhatsApp, espace client)
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" disabled={!admin} checked={Boolean(val("satisfaction_enabled", r.satisfaction_enabled))} onChange={(e) => setF({ ...f, satisfaction_enabled: e.target.checked })} /> Demande de satisfaction à la résolution
              </label>
            </div>
          </Card>
          {admin && (
            <div className="xl:col-span-2">
              {erreur && <p className="mb-2 text-[13px] font-semibold text-danger">{erreur}</p>}
              <Button variant="primary" loading={envoi} disabled={!Object.keys(f).length} onClick={enregistrer}>
                Enregistrer les réglages
              </Button>
            </div>
          )}
        </div>
      )}
    </Etat>
  );
}

function Canaux({ admin }: { admin: boolean }) {
  const { data, error, mutate } = useReglages();
  const [f, setF] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  async function enregistrer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await mutate(await apiSend<Reglages>("PATCH", "/service-client/settings", f), { revalidate: false });
      setF({});
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()}>
      {(r) => (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Courriel">
            <Notice tone={r.channels.email.active ? "ok" : "warn"}>{r.channels.email.message}</Notice>
            {!r.channels.mail_server && <div className="mt-2"><Notice tone="warn">Aucun serveur d&apos;envoi de courriel : les réponses par courriel restent dans le dossier, à communiquer par un autre canal.</Notice></div>}
            <div className="mt-3 space-y-3">
              <Field label="Adresse du service client" hint="Boîte relevée par la plateforme et expéditrice des réponses.">
                <Input disabled={!admin} value={f.mail_address ?? r.mail_address ?? ""} onChange={(e) => setF({ ...f, mail_address: e.target.value })} placeholder="service.client@…" />
              </Field>
              <Field label="Serveur de réception (authserv-id)" hint="Seul son en-tête d'authentification est cru ; sans lui, tout expéditeur est « non vérifié ».">
                <Input disabled={!admin} value={f.mail_authserv_id ?? r.mail_authserv_id ?? ""} onChange={(e) => setF({ ...f, mail_authserv_id: e.target.value })} placeholder="mx.…" />
              </Field>
            </div>
          </Card>
          <Card title="WhatsApp">
            <Notice tone={r.channels.whatsapp.active ? "ok" : "warn"}>{r.channels.whatsapp.message}</Notice>
            <p className="mt-2 text-[12.5px] text-muted">Adresse de notification à déclarer chez Meta : l&apos;adresse publique du site suivie de {r.webhook_path}. Les identifiants restent sur le serveur, jamais ici.</p>
            <div className="mt-3 grid grid-cols-[1fr_120px] gap-3">
              <Field label="Modèle approuvé (hors de la fenêtre de 24 heures)" hint="Deux paramètres : le nom du client et le numéro du dossier.">
                <Input disabled={!admin} value={f.wa_template ?? r.wa_template ?? ""} onChange={(e) => setF({ ...f, wa_template: e.target.value })} placeholder="suivi_dossier" />
              </Field>
              <Field label="Langue">
                <Input disabled={!admin} value={f.wa_template_lang ?? r.wa_template_lang} onChange={(e) => setF({ ...f, wa_template_lang: e.target.value })} />
              </Field>
            </div>
          </Card>
          <Card title="Espace client et liens des courriels">
            <Field label="Adresse publique du site (https)" hint="Pour les invitations, la satisfaction par courriel et les liens vers les dossiers ; commune aux deux sociétés.">
              <Input disabled={!admin} value={f.public_url ?? r.public_url ?? ""} onChange={(e) => setF({ ...f, public_url: e.target.value })} placeholder="https://…" />
            </Field>
          </Card>
          {admin && (
            <div className="xl:col-span-2">
              {erreur && <p className="mb-2 text-[13px] font-semibold text-danger">{erreur}</p>}
              <Button variant="primary" loading={envoi} disabled={!Object.keys(f).length} onClick={enregistrer}>
                Enregistrer
              </Button>
            </div>
          )}
        </div>
      )}
    </Etat>
  );
}

function Categories({ admin, ctx, onFait }: { admin: boolean; ctx: ContexteSC; onFait: () => void }) {
  const { data, error, mutate } = useApi<Categorie[]>("/service-client/categories");
  const [edition, setEdition] = useState<Partial<Categorie> | null>(null);
  return (
    <Card padded={false} title="Catégories" actions={admin ? <Button size="sm" onClick={() => setEdition({ activity: "autre", portal: true, active: true })}>Nouvelle catégorie</Button> : undefined}>
      <Etat data={data} error={error} onRetry={() => void mutate()}>
        {(liste) => (
          <DataTable
            rows={liste}
            rowKey={(c) => c.id}
            onRowClick={admin ? (c) => setEdition(c) : undefined}
            columns={[
              { key: "name", label: "Catégorie", render: (c) => <span className="font-medium">{c.name}</span> },
              { key: "activity", label: "Activité", render: (c) => libelle(ACTIVITES, c.activity) },
              { key: "kind", label: "Type proposé", render: (c) => (c.kind ? libelle(TYPES, c.kind) : "–") },
              { key: "delais", label: "Délais propres (h)", render: (c) => (c.first_hours || c.resolution_hours ? `${c.first_hours ?? "–"} / ${c.resolution_hours ?? "–"}` : "–") },
              { key: "team", label: "Équipe", render: (c) => c.team?.name ?? "–" },
              { key: "etat", label: "", render: (c) => <span className="flex gap-1">{!c.active && <Badge>Archivée</Badge>}{!c.portal && <Badge>Interne</Badge>}{c.hsseq_nature && <Badge tone="warn">HSSEQ</Badge>}</span> },
            ]}
          />
        )}
      </Etat>
      {edition && (
        <Edition
          titre={edition.id ? "Modifier la catégorie" : "Nouvelle catégorie"}
          chemin={edition.id ? `/service-client/categories/${edition.id}` : "/service-client/categories"}
          methode={edition.id ? "PATCH" : "POST"}
          onClose={() => setEdition(null)}
          onFait={() => {
            setEdition(null);
            void mutate();
            onFait();
          }}
          initial={{ name: edition.name ?? "", activity: edition.activity ?? "autre", kind: edition.kind ?? "", first_hours: String(edition.first_hours ?? ""), resolution_hours: String(edition.resolution_hours ?? ""), team_id: String(edition.team?.id ?? ""), portal: edition.portal ?? true, active: edition.active ?? true }}
          champs={(f, set) => (
            <>
              <Field label="Nom"><Input value={String(f.name)} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Activité"><Select value={String(f.activity)} onChange={(e) => set("activity", e.target.value)} options={ACTIVITES} /></Field>
              <Field label="Type proposé"><Select value={String(f.kind)} onChange={(e) => set("kind", e.target.value)} options={[{ value: "", label: "Aucun" }, ...TYPES]} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Première réponse (h)"><Input value={String(f.first_hours)} onChange={(e) => set("first_hours", e.target.value)} /></Field>
                <Field label="Résolution (h)"><Input value={String(f.resolution_hours)} onChange={(e) => set("resolution_hours", e.target.value)} /></Field>
              </div>
              <Field label="Équipe par défaut"><Select value={String(f.team_id)} onChange={(e) => set("team_id", e.target.value)} options={[{ value: "", label: "Aucune" }, ...ctx.teams.map((t) => ({ value: t.id, label: t.name }))]} /></Field>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={Boolean(f.portal)} onChange={(e) => set("portal", e.target.checked)} /> Proposée dans l&apos;espace client</label>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={Boolean(f.active)} onChange={(e) => set("active", e.target.checked)} /> Active</label>
            </>
          )}
          corps={(f) => ({ ...f, first_hours: Number(String(f.first_hours).replace(",", ".")) || 0, resolution_hours: Number(String(f.resolution_hours).replace(",", ".")) || 0, team_id: f.team_id ? Number(f.team_id) : null, kind: f.kind || null })}
        />
      )}
    </Card>
  );
}

function Equipes({ admin, ctx, onFait }: { admin: boolean; ctx: ContexteSC; onFait: () => void }) {
  const { data, error, mutate } = useApi<Equipe[]>("/service-client/teams");
  const [edition, setEdition] = useState<Partial<Equipe> | null>(null);
  return (
    <Card padded={false} title="Équipes" actions={admin ? <Button size="sm" onClick={() => setEdition({ active: true, members: [] })}>Nouvelle équipe</Button> : undefined}>
      <Etat data={data} error={error} onRetry={() => void mutate()}>
        {(liste) => (
          <DataTable
            rows={liste}
            rowKey={(t) => t.id}
            onRowClick={admin ? (t) => setEdition(t) : undefined}
            columns={[
              { key: "name", label: "Équipe", render: (t) => <span className="font-medium">{t.name}</span> },
              { key: "leader", label: "Responsable", render: (t) => t.leader?.name ?? "–" },
              { key: "members", label: "Membres", render: (t) => t.members.map((m) => m.name).join(", ") || "–" },
            ]}
          />
        )}
      </Etat>
      {edition && (
        <Edition
          titre={edition.id ? "Modifier l'équipe" : "Nouvelle équipe"}
          chemin={edition.id ? `/service-client/teams/${edition.id}` : "/service-client/teams"}
          methode={edition.id ? "PATCH" : "POST"}
          onClose={() => setEdition(null)}
          onFait={() => {
            setEdition(null);
            void mutate();
            onFait();
          }}
          initial={{ name: edition.name ?? "", leader_id: String(edition.leader?.id ?? ""), members: (edition.members ?? []).map((m) => String(m.id)).join(","), active: edition.active ?? true }}
          champs={(f, set) => {
            const membres = String(f.members).split(",").filter(Boolean);
            return (
              <>
                <Field label="Nom"><Input value={String(f.name)} onChange={(e) => set("name", e.target.value)} /></Field>
                <Field label="Responsable de l'équipe"><Select value={String(f.leader_id)} onChange={(e) => set("leader_id", e.target.value)} options={[{ value: "", label: "Aucun" }, ...ctx.assignees.map((u) => ({ value: u.id, label: u.name }))]} /></Field>
                <fieldset className="space-y-1">
                  <legend className="mb-1 text-[13px] font-medium text-ink-2">Membres</legend>
                  {ctx.assignees.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={membres.includes(String(u.id))} onChange={(e) => set("members", (e.target.checked ? [...membres, String(u.id)] : membres.filter((m) => m !== String(u.id))).join(","))} /> {u.name}
                    </label>
                  ))}
                </fieldset>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={Boolean(f.active)} onChange={(e) => set("active", e.target.checked)} /> Active</label>
              </>
            );
          }}
          corps={(f) => ({ name: f.name, active: f.active, leader_id: f.leader_id ? Number(f.leader_id) : null, member_ids: String(f.members).split(",").filter(Boolean).map(Number) })}
        />
      )}
    </Card>
  );
}

function Modeles({ agent, ctx, onFait }: { agent: boolean; ctx: ContexteSC; onFait: () => void }) {
  const { data, error, mutate } = useApi<ReponseType[]>("/service-client/templates");
  const [edition, setEdition] = useState<Partial<ReponseType> | null>(null);
  return (
    <Card padded={false} title="Réponses types" actions={agent ? <Button size="sm" onClick={() => setEdition({ active: true })}>Nouvelle réponse type</Button> : undefined}>
      <p className="px-5 pt-3 text-[12.5px] text-muted">Variables remplacées à l&apos;emploi : {"{client}"}, {"{numero}"}, {"{objet}"}, {"{agent}"} (prénom), {"{societe}"}.</p>
      <Etat data={data} error={error} onRetry={() => void mutate()}>
        {(liste) => (
          <DataTable
            rows={liste}
            rowKey={(t) => t.id}
            onRowClick={agent ? (t) => setEdition(t) : undefined}
            columns={[
              { key: "name", label: "Réponse type", render: (t) => <span className="font-medium">{t.name}</span> },
              { key: "category", label: "Catégorie", render: (t) => t.category?.name ?? "Toutes" },
              { key: "body", label: "Texte", render: (t) => <span className="line-clamp-2 text-[12.5px] text-ink-2">{t.body}</span> },
              { key: "active", label: "", render: (t) => (!t.active ? <Badge>Archivée</Badge> : null) },
            ]}
          />
        )}
      </Etat>
      {edition && (
        <Edition
          titre={edition.id ? "Modifier la réponse type" : "Nouvelle réponse type"}
          chemin={edition.id ? `/service-client/templates/${edition.id}` : "/service-client/templates"}
          methode={edition.id ? "PATCH" : "POST"}
          onClose={() => setEdition(null)}
          onFait={() => {
            setEdition(null);
            void mutate();
            onFait();
          }}
          initial={{ name: edition.name ?? "", body: edition.body ?? "", category_id: String(edition.category?.id ?? ""), active: edition.active ?? true }}
          champs={(f, set) => (
            <>
              <Field label="Nom"><Input value={String(f.name)} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Catégorie"><Select value={String(f.category_id)} onChange={(e) => set("category_id", e.target.value)} options={[{ value: "", label: "Toutes" }, ...ctx.categories.map((c) => ({ value: c.id, label: c.name }))]} /></Field>
              <Field label="Texte"><Textarea rows={8} value={String(f.body)} onChange={(e) => set("body", e.target.value)} maxLength={4000} /></Field>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={Boolean(f.active)} onChange={(e) => set("active", e.target.checked)} /> Active</label>
            </>
          )}
          corps={(f) => ({ ...f, category_id: f.category_id ? Number(f.category_id) : null })}
        />
      )}
    </Card>
  );
}

type Valeurs = Record<string, string | boolean>;

function Edition({ titre, chemin, methode, initial, champs, corps, onClose, onFait }: { titre: string; chemin: string; methode: "POST" | "PATCH"; initial: Valeurs; champs: (f: Valeurs, set: (k: string, v: string | boolean) => void) => ReactNode; corps: (f: Valeurs) => Record<string, unknown>; onClose: () => void; onFait: () => void }) {
  const [f, setF] = useState<Valeurs>(initial);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  async function enregistrer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await apiSend(methode, chemin, corps(f));
      onFait();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Modal
      open
      title={titre}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={envoi} onClick={enregistrer}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {champs(f, (k, v) => setF((x) => ({ ...x, [k]: v })))}
        {erreur && <p className="text-[13px] font-semibold text-danger">{erreur}</p>}
      </div>
    </Modal>
  );
}
