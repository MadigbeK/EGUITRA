"use client";

import { useState } from "react";
import { KeyRound, Plus, ShieldOff } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Etat, Field, Input, Modal, Notice, PageHeader, PasswordInput, Select, Tag, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import type { Company, Me, Profile } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { RetraitDiscussions } from "@/components/discussions/RetraitDiscussions";

// Profils des routes /admin/users, /admin/profiles et /admin/rights (addons/eguitra_api/controllers/admin.py,
// ADMIN) : l'administration seule crée, modifie, désactive un compte et remet ses accès.
const ADMINISTRATION: Profile[] = ["admin"];

interface UserRow extends Me {
  active: boolean;
  last_login: string | null;
}
/**
 * Profil de la plateforme, tel que le noyau le décrit (libellé et description du groupe : Achats compris).
 * entity : société exigée par le profil (exploitation, chantiers, immobilier : EGUITRA ; cabinet, porteur :
 * MB AxisPro Consulting) ; null pour un profil commun aux deux sociétés (direction, finance, achats).
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
  const { data: profiles, error: erreurProfils, mutate: relireProfils } = useApi<ProfileDef[]>("/admin/profiles");
  const { data: rights, error: erreurDroits, mutate: relireDroits } = useApi<RightDef[]>("/admin/rights");
  const administration = useAutorise(ADMINISTRATION);
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const label = (code: string) => profiles?.find((p) => p.code === code)?.name ?? code;
  // Profils et droits non lus : la fiche ne s'ouvrirait pas (profils) ou masquerait la saisie libre (droits).
  const erreurReferentiel = erreurProfils ?? erreurDroits;
  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        subtitle="Chaque utilisateur ne voit que le périmètre de ses profils et les sociétés qui lui sont ouvertes ; un même compte peut travailler pour les deux sociétés. La double authentification est obligatoire."
        actions={
          administration ? (
            <Button variant="primary" disabled={!profiles} onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Nouvel utilisateur
            </Button>
          ) : undefined
        }
      />
      {erreurReferentiel && (
        <div className="mb-4">
          <ErrorBox
            error={erreurReferentiel}
            titre={erreurProfils ? "Profils non chargés : les fiches des utilisateurs ne s'ouvrent pas." : "Droits complémentaires non chargés : la saisie libre des comptes ne s'affiche pas dans les fiches."}
            onRetry={() => {
              void relireProfils();
              void relireDroits();
            }}
          />
        </div>
      )}
      <Card padded={false}>
        {!users ? (
          <Etat error={error} onRetry={() => mutate()} />
        ) : (
          <DataTable
            rows={users}
            rowKey={(u) => u.id}
            onRowClick={administration && profiles ? (u) => setEditing(u) : undefined}
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
      {editing && profiles && administration && <UserForm user={editing === "new" ? null : editing} profiles={profiles} rights={rights ?? []} companies={companies} defaultCompany={defaultCompany} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
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
  const envoi = useEnvoi();

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
  /** Écriture sur le compte : close ferme la fiche (liste relue) ; sinon, le message reste dans la fiche. */
  async function run(cle: string, fn: () => Promise<unknown>, ok?: string, close = false) {
    if ((await envoi.run(cle, fn, close ? undefined : ok)) && close) onSaved();
  }
  async function reinitialiserDoubleAuth() {
    if (!user) return;
    const oui = await demanderConfirmation(`Réinitialiser la double authentification de ${user.name} ? Ses sessions sont fermées et son application d'authentification ne sert plus : il la réactivera à sa prochaine connexion.`, { action: "Réinitialiser", danger: true });
    if (oui) await run("mfa", () => apiSend("POST", `/admin/users/${user.id}/reset-mfa`), "Double authentification réinitialisée : l'utilisateur la réactivera à sa prochaine connexion.");
  }
  async function basculerActif() {
    if (!user) return;
    const oui = user.active
      ? await demanderConfirmation(`Désactiver le compte de ${user.name} ? Il ne pourra plus se connecter ; ses pièces et son historique restent. Le compte se réactive d'ici.`, { action: "Désactiver", danger: true })
      : await demanderConfirmation(`Réactiver le compte de ${user.name} ? Il pourra de nouveau se connecter avec ses profils actuels.`, { action: "Réactiver" });
    if (oui) await run("actif", () => apiSend("PATCH", `/admin/users/${user.id}`, { active: !user.active }), undefined, true);
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
      ? run("enregistrer", () => apiSend("PATCH", `/admin/users/${user.id}`, { name: form.name, email: form.email, profiles: selected, ...rightsPayload, ...(foreign.length ? {} : companyPayload) }), undefined, true)
      : run("enregistrer", () => apiSend("POST", "/admin/users", { ...form, profiles: selected, ...rightsPayload, ...companyPayload }), undefined, true);

  return (
    <Modal open wide title={user ? user.name : "Nouvel utilisateur"} onClose={onClose} footer={<Button variant="primary" loading={envoi.busy === "enregistrer"} onClick={save} disabled={envoi.busy !== null || !form.name || !form.login || !selected.length || !companyIds.length || (!user && form.password.length < 10)}>Enregistrer</Button>}>
      <div className="space-y-4">
        {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
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
              <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
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
            {manquantes.map((p) => `Le profil « ${p.name} » exige la société ${societeExigee(p) ?? (p.entity === "cabinet" ? "MB AxisPro Consulting" : "EGUITRA GROUP SARLU")}.`).join(" ")}
          </Notice>
        )}
        {user && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <PasswordReset userId={user.id} userName={user.name} />
            <Button loading={envoi.busy === "mfa"} disabled={envoi.busy !== null} onClick={reinitialiserDoubleAuth}>
              <ShieldOff className="h-4 w-4" /> Réinitialiser la double auth.
            </Button>
            <Button variant={user.active ? "danger" : "secondary"} loading={envoi.busy === "actif"} disabled={envoi.busy !== null} onClick={basculerActif}>
              {user.active ? "Désactiver" : "Réactiver"}
            </Button>
            {/* Compte désactivé : le retirer de ses conversations de la discussion interne (sans les lire). */}
            {!user.active && <RetraitDiscussions userId={user.id} nom={user.name} />}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Mot de passe provisoire remis par l'administrateur : il ferme les sessions du compte, d'où la confirmation. */
function PasswordReset({ userId, userName }: { userId: number; userName: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const envoi = useEnvoi();
  async function appliquer() {
    const oui = await demanderConfirmation(`Remettre un mot de passe provisoire à ${userName} ? Ses sessions ouvertes sont fermées ; il choisira son mot de passe à la prochaine connexion.`, { action: "Remettre le mot de passe", danger: true });
    if (oui && (await envoi.run("motdepasse", () => apiSend("POST", `/admin/users/${userId}/password`, { password }), "Mot de passe provisoire enregistré, sessions fermées."))) setPassword("");
  }
  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <KeyRound className="h-4 w-4" /> Mot de passe provisoire
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PasswordInput autoComplete="new-password" placeholder="10 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button loading={envoi.busy === "motdepasse"} disabled={password.length < 10 || envoi.busy !== null} onClick={appliquer}>
        Appliquer
      </Button>
      {envoi.message && <span className={envoi.message.tone === "danger" ? "text-xs font-medium text-danger" : "text-xs text-muted"}>{envoi.message.text}</span>}
    </div>
  );
}
