"use client";

import { useState } from "react";
import { KeyRound, Plus, ShieldOff } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tag } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Company, Me } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";

interface UserRow extends Me {
  active: boolean;
  last_login: string | null;
}
/**
 * Profil de la plateforme, tel que le noyau le décrit (libellé et description du groupe : Achats compris).
 * entity : société exigée par le profil (exploitation, chantiers, immobilier : EGUITRA ; cabinet, porteur :
 * MB AxisPro) ; null pour un profil commun aux deux sociétés (direction, finance, achats).
 */
interface ProfileDef { code: string; name: string; description: string | null; entity: "groupe" | "cabinet" | null }
/** Droit complémentaire aux profils (free_accounts : saisie libre des comptes). */
interface RightDef { code: string; name: string; description: string | null }
type Rights = Record<string, boolean | undefined>;
/**
 * Profils de saisie comptable : la saisie libre des comptes les concerne, accordée d'office à leur ouverture.
 * Le profil Achats n'en fait pas partie : la catégorie de dépense fixe toujours son compte.
 */
const PROFILS_COMPTABLES = ["admin", "direction", "finance"];

/** Utilisateurs : profils, droits complémentaires, sociétés, mot de passe provisoire, double authentification. */
export function UsersAdmin({ companies, defaultCompany }: { companies: Company[]; defaultCompany: number }) {
  const { data: users, error, mutate } = useApi<UserRow[]>("/admin/users");
  const { data: profiles } = useApi<ProfileDef[]>("/admin/profiles");
  const { data: rights } = useApi<RightDef[]>("/admin/rights");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const label = (code: string) => profiles?.find((p) => p.code === code)?.name ?? code;
  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        subtitle="Chaque utilisateur ne voit que le périmètre de ses profils et les sociétés qui lui sont ouvertes ; un même compte peut travailler pour les deux sociétés. La double authentification est obligatoire."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Nouvel utilisateur
          </Button>
        }
      />
      {error && <ErrorBox error={error} />}
      <Card padded={false}>
        {!users ? (
          <Loading />
        ) : (
          <DataTable
            rows={users}
            rowKey={(u) => u.id}
            onRowClick={(u) => setEditing(u)}
            columns={[
              { key: "name", label: "Nom" },
              { key: "login", label: "Identifiant" },
              { key: "profiles", label: "Profils", render: (u) => <div className="flex flex-wrap gap-1">{u.profiles.map((p) => <Tag key={p}>{label(p)}</Tag>)}</div> },
              { key: "companies", label: "Sociétés", render: (u) => <div className="flex flex-wrap gap-1">{u.companies.map((c) => <Badge key={c.id} tone={c.id === u.company_id ? "ok" : "neutral"}>{c.name}</Badge>)}</div> },
              { key: "mfa_enabled", label: "Double auth.", render: (u) => (u.mfa_enabled ? <Badge tone="ok">Activée</Badge> : <Badge tone="warn">À activer</Badge>) },
              { key: "last_login", label: "Dernière connexion", render: (u) => fmtDateTime(u.last_login) },
              { key: "active", label: "Statut", render: (u) => (u.active ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge>) },
            ]}
          />
        )}
      </Card>
      {editing && profiles && <UserForm user={editing === "new" ? null : editing} profiles={profiles} rights={rights ?? []} companies={companies} defaultCompany={defaultCompany} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </div>
  );
}

function UserForm({ user, profiles, rights, companies, defaultCompany, onClose, onSaved }: { user: UserRow | null; profiles: ProfileDef[]; rights: RightDef[]; companies: Company[]; defaultCompany: number; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: user?.name ?? "", login: user?.login ?? "", email: user?.email ?? "", password: "" });
  const [companyIds, setCompanyIds] = useState<number[]>(user ? user.companies.map((c) => c.id) : [defaultCompany]);
  const [mainCompany, setMainCompany] = useState<number>(user?.company_id ?? defaultCompany);
  // Sociétés de l'utilisateur hors du périmètre de l'administrateur : conservées, non modifiables ici.
  const foreign = user ? user.companies.filter((c) => !companies.some((m) => m.id === c.id)) : [];
  const [selected, setSelected] = useState<string[]>(user?.profiles.filter((p) => !(p === "direction" || p === "finance") || !user.profiles.includes("admin")) ?? []);
  const [granted, setGranted] = useState<Rights>(user?.rights ?? {});
  const comptable = selected.some((p) => PROFILS_COMPTABLES.includes(p));
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(code: string) {
    const ajout = !selected.includes(code);
    // Premier profil comptable : la saisie libre des comptes est accordée d'office (décochable).
    if (ajout && PROFILS_COMPTABLES.includes(code) && !comptable) setGranted((g) => ({ ...g, free_accounts: true }));
    if (code === "porteur") setSelected(ajout ? ["porteur"] : []);
    else setSelected((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s.filter((x) => x !== "porteur"), code]));
    // Un profil propre à une société ouvre cette société au compte.
    const entite = profiles.find((p) => p.code === code)?.entity;
    const societe = entite ? companies.find((c) => c.entity === entite) : undefined;
    if (ajout && societe && !companyIds.includes(societe.id)) {
      setCompanyIds(code === "porteur" ? [societe.id] : [...companyIds, societe.id]);
      if (code === "porteur") setMainCompany(societe.id);
    }
  }
  const societeExigee = (p: ProfileDef) => (p.entity ? companies.find((c) => c.entity === p.entity)?.name : undefined);
  const manquantes = selected
    .map((code) => profiles.find((p) => p.code === code))
    .filter((p): p is ProfileDef => Boolean(p?.entity) && !companies.some((c) => c.entity === p!.entity && companyIds.includes(c.id)));
  async function run(fn: () => Promise<unknown>, ok: string, close = false) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (close) onSaved();
      else setMessage({ tone: "ok", text: ok });
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
    } finally {
      setBusy(false);
    }
  }
  function toggleCompany(id: number) {
    const next = companyIds.includes(id) ? companyIds.filter((x) => x !== id) : [...companyIds, id];
    setCompanyIds(next);
    if (!next.includes(mainCompany) && next.length) setMainCompany(next[0]!);
  }
  const companyPayload = { company_ids: companyIds, company_id: companyIds.includes(mainCompany) ? mainCompany : companyIds[0] };
  // Droits envoyés tels qu'affichés, pour un compte à profil comptable (sinon inchangés).
  const rightsPayload = comptable && rights.length ? { rights: Object.fromEntries(rights.map((r) => [r.code, Boolean(granted[r.code])])) } : {};
  const save = () =>
    user
      ? run(() => apiSend("PATCH", `/admin/users/${user.id}`, { name: form.name, email: form.email, profiles: selected, ...rightsPayload, ...(foreign.length ? {} : companyPayload) }), "", true)
      : run(() => apiSend("POST", "/admin/users", { ...form, profiles: selected, ...rightsPayload, ...companyPayload }), "", true);

  return (
    <Modal open wide title={user ? user.name : "Nouvel utilisateur"} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={save} disabled={!form.name || !form.login || !selected.length || !companyIds.length || (!user && form.password.length < 10)}>Enregistrer</Button>}>
      <div className="space-y-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Nom complet">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Identifiant">
            <Input value={form.login} disabled={Boolean(user)} onChange={(e) => setForm({ ...form, login: e.target.value })} />
          </Field>
          <Field label="Courriel">
            <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          {!user && (
            <Field label="Mot de passe provisoire" hint="10 caractères minimum ; à changer à la première connexion.">
              <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
          )}
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-ink-2">Sociétés accessibles</div>
          {foreign.length > 0 ? (
            <Notice tone="warn">Cet utilisateur a aussi accès à {foreign.map((c) => c.name).join(", ")}, hors de votre périmètre : ses sociétés ne se modifient pas d&apos;ici.</Notice>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
              {companies.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm">
                  <input type="checkbox" checked={companyIds.includes(c.id)} onChange={() => toggleCompany(c.id)} />
                  {c.name}
                </label>
              ))}
              {companyIds.length > 1 && (
                <Field label="Société à l'ouverture">
                  <Select value={mainCompany} onChange={(e) => setMainCompany(Number(e.target.value))} options={companies.filter((c) => companyIds.includes(c.id)).map((c) => ({ value: c.id, label: c.name }))} />
                </Field>
              )}
            </div>
          )}
          <p className="mt-1 text-[11px] text-muted">Comptabilités et données restent séparées par société ; l&apos;utilisateur passe de l&apos;une à l&apos;autre par le sélecteur en haut de l&apos;écran.</p>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-ink-2">Profils</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {profiles.map((p) => (
              <label key={p.code} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
                <input type="checkbox" className="mt-1" checked={selected.includes(p.code)} onChange={() => toggle(p.code)} />
                <span>
                  <span className="block text-sm text-ink">{p.name}</span>
                  <span className="block text-xs text-muted">{p.description}</span>
                  {societeExigee(p) && <span className="mt-0.5 block text-[11px] font-semibold text-accent">Société : {societeExigee(p)}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
        {comptable && rights.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium text-ink-2">Droits complémentaires</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {rights.map((r) => (
                <label key={r.code} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={Boolean(granted[r.code])} onChange={(e) => setGranted({ ...granted, [r.code]: e.target.checked })} />
                  <span>
                    <span className="block text-sm text-ink">{r.name}</span>
                    <span className="block text-xs text-muted">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {manquantes.length > 0 && (
          <Notice tone="warn">
            {manquantes.map((p) => `Le profil « ${p.name} » exige la société ${societeExigee(p) ?? (p.entity === "cabinet" ? "MB AxisPro" : "EGUITRA GROUP SARLU")}.`).join(" ")}
          </Notice>
        )}
        {user && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <PasswordReset userId={user.id} />
            <Button onClick={() => run(() => apiSend("POST", `/admin/users/${user.id}/reset-mfa`), "Double authentification réinitialisée : l'utilisateur la réactivera à sa prochaine connexion.")}>
              <ShieldOff className="h-4 w-4" /> Réinitialiser la double auth.
            </Button>
            <Button variant="danger" onClick={() => run(() => apiSend("PATCH", `/admin/users/${user.id}`, { active: !user.active }), "", true)}>
              {user.active ? "Désactiver" : "Réactiver"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PasswordReset({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <KeyRound className="h-4 w-4" /> Mot de passe provisoire
      </Button>
    );
  return (
    <div className="flex items-center gap-2">
      <Input type="password" autoComplete="new-password" placeholder="10 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button
        disabled={password.length < 10}
        onClick={() =>
          apiSend("POST", `/admin/users/${userId}/password`, { password })
            .then(() => setMessage("Mot de passe provisoire enregistré, sessions fermées."))
            .catch((e) => setMessage(e instanceof ApiError ? e.message : "Erreur"))
        }
      >
        Appliquer
      </Button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </div>
  );
}
