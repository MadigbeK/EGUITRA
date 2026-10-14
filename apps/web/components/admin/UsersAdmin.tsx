"use client";

import { useState } from "react";
import { KeyRound, Plus, ShieldOff } from "lucide-react";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Me } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";

interface UserRow extends Me {
  active: boolean;
  last_login: string | null;
}
interface ProfileDef { code: string; name: string; description: string | null }

/** Utilisateurs : profils, sociétés, mot de passe provisoire, double authentification. */
export function UsersAdmin() {
  const { data: users, error, mutate } = useApi<UserRow[]>("/admin/users");
  const { data: profiles } = useApi<ProfileDef[]>("/admin/profiles");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const label = (code: string) => profiles?.find((p) => p.code === code)?.name ?? code;
  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        subtitle="Chaque utilisateur ne voit que le périmètre de ses profils. La double authentification est obligatoire."
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
              { key: "profiles", label: "Profils", render: (u) => <div className="flex flex-wrap gap-1">{u.profiles.map((p) => <Badge key={p} tone="accent">{label(p)}</Badge>)}</div> },
              { key: "mfa_enabled", label: "Double auth.", render: (u) => (u.mfa_enabled ? <Badge tone="ok">Activée</Badge> : <Badge tone="warn">À activer</Badge>) },
              { key: "last_login", label: "Dernière connexion", render: (u) => fmtDateTime(u.last_login) },
              { key: "active", label: "Statut", render: (u) => (u.active ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge>) },
            ]}
          />
        )}
      </Card>
      {editing && profiles && <UserForm user={editing === "new" ? null : editing} profiles={profiles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </div>
  );
}

function UserForm({ user, profiles, onClose, onSaved }: { user: UserRow | null; profiles: ProfileDef[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: user?.name ?? "", login: user?.login ?? "", email: user?.email ?? "", password: "" });
  const [selected, setSelected] = useState<string[]>(user?.profiles.filter((p) => !(p === "direction" || p === "finance") || !user.profiles.includes("admin")) ?? []);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(code: string) {
    if (code === "porteur") return setSelected(selected.includes("porteur") ? [] : ["porteur"]);
    setSelected((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s.filter((x) => x !== "porteur"), code]));
  }
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
  const save = () =>
    user
      ? run(() => apiSend("PATCH", `/admin/users/${user.id}`, { name: form.name, email: form.email, profiles: selected }), "", true)
      : run(() => apiSend("POST", "/admin/users", { ...form, profiles: selected }), "", true);

  return (
    <Modal open wide title={user ? user.name : "Nouvel utilisateur"} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={save} disabled={!form.name || !form.login || !selected.length || (!user && form.password.length < 10)}>Enregistrer</Button>}>
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
          <div className="mb-2 text-xs font-medium text-ink-2">Profils</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {profiles.map((p) => (
              <label key={p.code} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
                <input type="checkbox" className="mt-1" checked={selected.includes(p.code)} onChange={() => toggle(p.code)} />
                <span>
                  <span className="block text-sm text-ink">{p.name}</span>
                  <span className="block text-xs text-muted">{p.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
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
